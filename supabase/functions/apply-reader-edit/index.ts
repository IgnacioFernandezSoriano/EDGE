/**
 * apply-reader-edit — Edge Function (EDGE LEG2)
 * Write-through editor for reader Operation fields:
 *   whitelist PATCH -> GMS readers_master -> sync-site-snapshot ->
 *   rfid_reprocess_scope({readers:[lpi]}) -> export CSV.
 * JWT-verified: only an authenticated Leg2 user may edit.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseReaderEditRequest } from "./request.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMS_URL = Deno.env.get("GMS_URL") ?? Deno.env.get("GMS_SITES_URL")!;
const GMS_KEY = Deno.env.get("GMS_SERVICE_ROLE_KEY")!;
const DATA_START = "2026-01-01T00:00:00Z";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  const parsed = parseReaderEditRequest(await req.json().catch(() => ({})));
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  const { lpi, operation } = parsed;

  try {
    // 1) Write-through to GMS readers_master (whitelisted fields only).
    const patchUrl =
      `${GMS_URL}/rest/v1/readers_master?lpi=eq.${encodeURIComponent(lpi)}`;
    const gmsResp = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        apikey: GMS_KEY,
        Authorization: `Bearer ${GMS_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ ...operation, updated_at: new Date().toISOString() }),
    });
    if (!gmsResp.ok) {
      const t = await gmsResp.text();
      return json({ ok: false, status: "gms_write_failed", movements_upserted: 0, error: t.slice(0, 300) }, 502);
    }
    const patched = (await gmsResp.json().catch(() => [])) as unknown[];
    if (!Array.isArray(patched) || patched.length === 0) {
      return json({ ok: false, status: "gms_reader_not_found", movements_upserted: 0, error: `No reader ${lpi} in GMS` }, 404);
    }

    const db = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 2) Refresh the Leg2 snapshot from GMS.
    const syncResp = await fetch(`${SUPABASE_URL}/functions/v1/sync-site-snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: "{}",
    });
    if (!syncResp.ok) {
      const t = await syncResp.text();
      return json({ ok: false, status: "sync_failed", movements_upserted: 0, error: t.slice(0, 300) }, 502);
    }

    // 3) Reprocess only the pairs read by this reader.
    const { data, error } = await db.rpc("rfid_reprocess_scope", {
      p_filters: { from: DATA_START, readers: [lpi] },
      p_environment: "production",
      p_max_reads: 100000,
      p_reason: "reader_edit_reprocess",
    });
    if (error) {
      return json({ ok: false, status: "reprocess_failed", movements_upserted: 0, error: error.message }, 500);
    }
    const row = Array.isArray(data) ? data[0] : data;

    // 4) Re-export CSV (non-blocking).
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
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, status: "error", movements_upserted: 0, error: msg }, 500);
  }
});
