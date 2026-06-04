import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_EDGE_URL = "https://t81an8rql2.execute-api.eu-central-1.amazonaws.com/v1/reads";

type Json = Record<string, unknown>;

type StartRun = {
  acquired: boolean;
  run_id: string;
  since_used_utc: string | null;
  cursor_started: string | null;
  reason: string;
};

function jsonResponse(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Connection": "keep-alive",
    },
  });
}

function pickString(obj: Json, names: string[]): string | null {
  for (const name of names) {
    const value = obj[name];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

function normalizeRead(raw: Json, runId: string): Json | null {
  const edgeId = pickString(raw, ["id", "edgeId", "edge_id", "readId", "read_id"]);
  if (!edgeId) return null;

  const tagId = pickString(raw, ["tagId", "tag_id", "tag", "epc"]);
  const s9Id = pickString(raw, ["s9Id", "s9_id", "s9", "postalId", "postal_id"]);
  const readerId = pickString(raw, ["readerId", "reader_id", "reader", "lpi"]);
  const timestamp = pickString(raw, ["timestamp", "eventTimestamp", "event_timestamp", "readAt", "read_at", "createdAt", "created_at"]);
  const ingestedAt = pickString(raw, ["ingestedAt", "ingested_at", "receivedAt", "received_at"]);

  return {
    edge_id: edgeId,
    run_id: runId,
    tag_id: tagId,
    s9_id: s9Id,
    reader_id: readerId,
    event_datetime_utc: timestamp,
    raw_payload: raw,
    edge_received_at_utc: ingestedAt,
    enrichment_status: "pending",
    transform_status: "pending",
  };
}

function parseReads(payload: Json): Json[] {
  const data = payload["data"];
  const reads = payload["reads"];
  const items = Array.isArray(data) ? data : Array.isArray(reads) ? reads : [];
  return items.filter((x): x is Json => typeof x === "object" && x !== null && !Array.isArray(x)) as Json[];
}

function parseNextCursor(payload: Json): string | null {
  const value = payload["next_cursor"] ?? payload["nextCursor"] ?? payload["cursor"];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

async function finishRun(supabase: ReturnType<typeof createClient>, args: Json) {
  const { error } = await supabase.rpc("rfid_finish_etl_run", args);
  if (error) console.error("finish_run_error", error.message);
}

// Nota: el refresco de maestros (GMS IOT readers_master + sites -> snapshots) se ejecuta
// ANTES del ETL mediante el cron 'sync-masters-before-etl' (:25/:55), que invoca la
// Edge Function sync-site-snapshot. No se llama desde aquí para evitar acoplamiento.

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Use POST" }, 405);

  const startedAt = Date.now();
  const body = await req.json().catch(() => ({}));
  const environment = typeof body.environment === "string" ? body.environment : "production";
  const mode = typeof body.mode === "string" ? body.mode : "incremental";
  const maxPages = Number(body.max_pages ?? Deno.env.get("ETL_MAX_PAGES") ?? 25);
  const pageLimit = Number(body.page_limit ?? Deno.env.get("EDGE_PAGE_LIMIT") ?? 1000);
  const timeBudgetMs = Number(body.time_budget_ms ?? Deno.env.get("ETL_TIME_BUDGET_MS") ?? 150000);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const edgeApiKey = Deno.env.get("EDGE_API_KEY")
    ?? Deno.env.get("UPU_RFID_READ_KEY_EDGE_PROD")
    ?? Deno.env.get("upu-rfid-read-key-edge-prod");
  const edgeApiUrl = Deno.env.get("EDGE_API_URL") ?? DEFAULT_EDGE_URL;

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing Supabase service environment" }, 500);
  }
  if (!edgeApiKey) {
    return jsonResponse({ error: "Missing EDGE_API_KEY secret" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const lockOwner = `edge-function-${crypto.randomUUID()}`;
  const { data: startRows, error: startError } = await supabase.rpc("rfid_start_etl_run", {
    p_environment: environment,
    p_mode: mode,
    p_lock_owner: lockOwner,
    p_lock_minutes: Math.max(5, Math.ceil(timeBudgetMs / 60000) + 5),
  });

  if (startError) return jsonResponse({ error: "Cannot start ETL run", detail: startError.message }, 500);

  const start = Array.isArray(startRows) ? startRows[0] as StartRun : null;
  if (!start?.run_id) return jsonResponse({ error: "Start function returned no run" }, 500);
  if (!start.acquired) return jsonResponse({ status: "skipped_locked", run_id: start.run_id, reason: start.reason }, 200);

  let cursor: string | null = start.cursor_started;
  let finalCursor: string | null = start.cursor_started;
  let cursorExhausted = false;
  let pages = 0;
  let readsReceived = 0;
  let readsStaged = 0;

  try {
    while (pages < maxPages && Date.now() - startedAt < timeBudgetMs) {
      const url = new URL(edgeApiUrl);
      url.searchParams.set("limit", String(pageLimit));
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      } else if (start.since_used_utc) {
        url.searchParams.set("since", start.since_used_utc);
      } else {
        throw new Error("No cursor and no since timestamp available.");
      }

      const edgeResp = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "x-api-key": edgeApiKey,
          "Accept": "application/json",
        },
      });

      pages += 1;

      if (!edgeResp.ok) {
        const text = await edgeResp.text();
        throw new Error(`EDGE API error ${edgeResp.status}: ${text.slice(0, 500)}`);
      }

      const payload = await edgeResp.json() as Json;
      const reads = parseReads(payload);
      const nextCursor = parseNextCursor(payload);
      readsReceived += reads.length;

      const rows = reads.map((r) => normalizeRead(r, start.run_id)).filter((r): r is Json => r !== null);
      if (rows.length > 0) {
        const { error: insertError } = await supabase
          .from("rfid_edge_input_reads")
          .upsert(rows, { onConflict: "edge_id", ignoreDuplicates: false });
        if (insertError) throw new Error(`Staging insert failed: ${insertError.message}`);
        readsStaged += rows.length;
      }

      if (nextCursor) {
        finalCursor = nextCursor;
        cursor = nextCursor;
        cursorExhausted = false;
      } else {
        cursorExhausted = true;
        finalCursor = null;
        break;
      }

      if (reads.length === 0) {
        cursorExhausted = true;
        finalCursor = null;
        break;
      }
    }

    const { error: enrichError } = await supabase.rpc("rfid_enrich_run", { p_run_id: start.run_id });
    if (enrichError) throw new Error(`Enrichment failed: ${enrichError.message}`);

    const { error: transformError } = await supabase.rpc("rfid_transform_run", { p_run_id: start.run_id });
    if (transformError) throw new Error(`Transform failed: ${transformError.message}`);

    await finishRun(supabase, {
      p_run_id: start.run_id,
      p_environment: environment,
      p_status: "success",
      p_cursor_finished: cursorExhausted ? null : finalCursor,
      p_pages_requested: pages,
      p_reads_received: readsReceived,
      p_reads_staged: readsStaged,
      p_error_message: null,
    });

    return jsonResponse({
      status: "success",
      run_id: start.run_id,
      pages_requested: pages,
      reads_received: readsReceived,
      reads_staged: readsStaged,
      cursor_finished: finalCursor,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(supabase, {
      p_run_id: start.run_id,
      p_environment: environment,
      p_status: readsStaged > 0 ? "partial_staged" : "failed",
      p_cursor_finished: readsStaged > 0 ? finalCursor : null,
      p_pages_requested: pages,
      p_reads_received: readsReceived,
      p_reads_staged: readsStaged,
      p_error_message: message,
    });
    return jsonResponse({
      status: readsStaged > 0 ? "partial_staged" : "failed",
      run_id: start.run_id,
      pages_requested: pages,
      reads_received: readsReceived,
      reads_staged: readsStaged,
      error: message,
    }, 500);
  }
});
