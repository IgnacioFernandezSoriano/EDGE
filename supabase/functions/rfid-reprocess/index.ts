/**
 * rfid-reprocess — Edge Function (EDGE LEG2)
 * General reprocess trigger at reader | site | global scope.
 * Flow: sync-site-snapshot -> rfid_reprocess_scope(filter) -> export CSV.
 * JWT-verified: only an authenticated Leg2 user can trigger it.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseReprocessRequest } from "./request.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DATA_START = "2026-01-01T00:00:00Z";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // Browser preflight — required so the app (a different origin) can call this.
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  const body = await req.json().catch(() => ({}));
  const parsed = parseReprocessRequest(body);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  // Optional correlation token so the client can poll this exact run's status.
  const token = typeof (body as { token?: unknown }).token === "string"
    ? (body as { token: string }).token.slice(0, 64)
    : "";
  const reason = `settings_reprocess_${parsed.scope}${token ? `:${token}` : ""}`;

  const p_filters: Record<string, unknown> = { from: DATA_START };
  if (parsed.scope === "reader") p_filters.readers = [parsed.lpi];

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Site = a CENTRE. Most centres have no site_impc_code, but every read carries
    // a centre_code, so we reprocess a centre via its readers (a reader reads only
    // at its own centre). Resolve the centre's readers, then use the readers filter.
    if (parsed.scope === "site") {
      const { data: rows, error: rErr } = await db
        .from("vw_centre_readers")
        .select("reader_id")
        .eq("centre_code", parsed.centre_code);
      if (rErr) {
        return json({ ok: false, status: "reader_lookup_failed", movements_upserted: 0, error: rErr.message }, 500);
      }
      const readers = [...new Set((rows ?? []).map((r) => r.reader_id as string).filter(Boolean))];
      if (readers.length === 0) {
        return json({ ok: true, status: "skipped_empty", movements_upserted: 0 });
      }
      p_filters.readers = readers;
    }

    // 1) Refresh masters from GMS IOT so any external reader/site change lands first.
    const syncResp = await fetch(`${SUPABASE_URL}/functions/v1/sync-site-snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: "{}",
    });
    if (!syncResp.ok) {
      const t = await syncResp.text();
      return json({ ok: false, status: "sync_failed", movements_upserted: 0, error: t.slice(0, 300) }, 502);
    }

    // 2) Reprocess the scoped pairs.
    const { data, error } = await db.rpc("rfid_reprocess_scope", {
      p_filters,
      p_environment: "production",
      p_max_reads: 100000,
      p_reason: reason,
    });
    if (error) {
      return json({ ok: false, status: "reprocess_failed", movements_upserted: 0, error: error.message }, 500);
    }
    const row = Array.isArray(data) ? data[0] : data;

    // 3) Re-export CSV (non-blocking on failure — reprocess already committed).
    await fetch(`${SUPABASE_URL}/functions/v1/export-rfid-csv-to-s3`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: "{}",
    }).catch(() => {});

    return json({
      ok: row?.status === "success",
      status: row?.status ?? "unknown",
      movements_upserted: row?.movements_upserted ?? 0,
      reprocess_run_id: row?.reprocess_run_id,
      error: row?.status === "success" ? undefined : row?.error_message ?? undefined,
    });
  } catch (e) {
    return json({ ok: false, status: "error", movements_upserted: 0, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
