/**
 * rfid-reprocess-site — Edge Function (EDGE LEG2)
 * Targeted, per-site reprocess after a reader-master EDI correction in GMS IOT.
 * Flow: sync-site-snapshot -> rfid_reprocess_scope({from, sites:[site]}) -> export CSV.
 * JWT-verified: only an authenticated Leg2 user can trigger it.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseReprocessRequest } from "./request.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DATA_START = "2026-01-01T00:00:00Z";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  const parsed = parseReprocessRequest(await req.json().catch(() => ({})));
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  const site = parsed.site_impc_code;

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // 1) Refresh masters from GMS IOT so the corrected EDI lands in the snapshot.
    const syncResp = await fetch(`${SUPABASE_URL}/functions/v1/sync-site-snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: "{}",
    });
    if (!syncResp.ok) {
      const t = await syncResp.text();
      return json(
        { ok: false, status: "sync_failed", movements_upserted: 0, error: t.slice(0, 300) },
        502,
      );
    }

    // 2) Reprocess only the (tag,s9) pairs that touched this site.
    const { data, error } = await db.rpc("rfid_reprocess_scope", {
      p_filters: { from: DATA_START, sites: [site] },
      p_environment: "production",
      p_max_reads: 100000,
      p_reason: "site_correction_reprocess",
    });
    if (error) {
      return json(
        { ok: false, status: "reprocess_failed", movements_upserted: 0, error: error.message },
        500,
      );
    }
    const row = Array.isArray(data) ? data[0] : data;

    // 3) Re-export the CSV (non-blocking on failure — reprocess already succeeded).
    await fetch(`${SUPABASE_URL}/functions/v1/export-rfid-csv-to-s3`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: "{}",
    }).catch(() => {});

    return json({
      ok: row?.status === "success",
      status: row?.status ?? "unknown",
      movements_upserted: row?.movements_upserted ?? 0,
      reprocess_run_id: row?.reprocess_run_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, status: "error", movements_upserted: 0, error: msg }, 500);
  }
});
