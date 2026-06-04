/**
 * export-rfid-csv-to-s3 — Supabase Edge Function (EDGE LEG2)
 * =========================================================
 * Último paso del ETL: lee vw_quicksight_rfid_report_movements, construye un CSV
 * estricto para QuickSight (UTF-8 sin BOM, 22 columnas en orden) y lo sube
 * (sobrescribiendo la misma key) a s3://upu-rfid-reporting/quicksight/rfid/current/rfid_movements.csv
 * mediante AWS SigV4. La invoca el orquestador tras rfid_finish_etl_run.
 *
 * Secretos: AWS_S3_ACCESS_KEY_ID, AWS_S3_SECRET_ACCESS_KEY, AWS_S3_REGION,
 *           S3_BUCKET, S3_PREFIX, S3_OBJECT_KEY. (SUPABASE_URL/SERVICE_ROLE_KEY auto-inyectadas.)
 * verify_jwt = false.
 */
import { toUtcIso, toLocalIsoWithOffset } from "./time.ts";
import { csvRow } from "./csv.ts";
import { buildS3PutRequest } from "./sigv4.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const COLUMNS = [
  "source_edge_id", "tag_id", "s9_id", "reader_id", "movement_type",
  "event_datetime_utc", "event_datetime_local", "movement_date_local",
  "movement_hour_local", "movement_month_local", "country_code", "country_name",
  "centre_code", "site_impc_code", "site_name", "city", "edi_equivalent",
  "reader_timezone", "handover_point", "handover_label", "reader_location_label",
  "created_at_utc",
] as const;

// Columnas que pedimos a PostgREST (las 22; event_datetime_utc/reader_timezone ya están y
// son la fuente para event_datetime_local).
const SELECT = COLUMNS.join(",");

type Row = Record<string, unknown>;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function fetchAllRows(): Promise<Row[]> {
  const PAGE = 1000;
  let offset = 0;
  const out: Row[] = [];
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/vw_quicksight_rfid_report_movements` +
      `?select=${SELECT}&order=source_edge_id.asc&limit=${PAGE}&offset=${offset}`;
    const resp = await fetch(url, {
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, Accept: "application/json" },
    });
    if (!resp.ok) {
      throw new Error(`view fetch ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    }
    const page = (await resp.json()) as Row[];
    out.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

function buildCsv(rows: Row[]): string {
  const lines: string[] = [COLUMNS.join(",")]; // cabecera (sin escapar: nombres seguros)
  for (const r of rows) {
    lines.push(csvRow([
      r.source_edge_id,
      r.tag_id,
      r.s9_id,
      r.reader_id,
      r.movement_type,
      toUtcIso(r.event_datetime_utc as string | null),
      toLocalIsoWithOffset(r.event_datetime_utc as string | null, r.reader_timezone as string | null),
      r.movement_date_local,
      r.movement_hour_local,
      r.movement_month_local,
      r.country_code,
      r.country_name,
      r.centre_code,
      r.site_impc_code,
      r.site_name,
      r.city,
      r.edi_equivalent,
      r.reader_timezone,
      r.handover_point,
      r.handover_label,
      r.reader_location_label,
      toUtcIso(r.created_at_utc as string | null),
    ]));
  }
  return lines.join("\n") + "\n";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "Missing Supabase service environment" }, 500);

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;

  try {
    const rows = await fetchAllRows();
    const csv = buildCsv(rows);
    const bytes = new TextEncoder().encode(csv); // UTF-8 sin BOM
    const firstByteHex = bytes.length ? bytes[0].toString(16).padStart(2, "0") : "";

    if (dryRun) {
      const sample = csv.split("\n").slice(1, 4).filter((l) => l.length > 0);
      return json({
        ok: true, dry_run: true, rows_exported: rows.length, bytes: bytes.length,
        first_byte_hex: firstByteHex, header: COLUMNS.join(","), sample,
      });
    }

    const accessKeyId = Deno.env.get("AWS_S3_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("AWS_S3_SECRET_ACCESS_KEY");
    const region = Deno.env.get("AWS_S3_REGION");
    const bucket = Deno.env.get("S3_BUCKET");
    const prefix = Deno.env.get("S3_PREFIX");
    const objectName = Deno.env.get("S3_OBJECT_KEY");
    if (!accessKeyId) return json({ ok: false, error: "Missing AWS_S3_ACCESS_KEY_ID secret" }, 500);
    if (!secretAccessKey) return json({ ok: false, error: "Missing AWS_S3_SECRET_ACCESS_KEY secret" }, 500);
    if (!region || !bucket || !prefix || !objectName) {
      return json({ ok: false, error: "Missing AWS_S3_REGION / S3_BUCKET / S3_PREFIX / S3_OBJECT_KEY secret" }, 500);
    }

    const objectKey = `${prefix}/${objectName}`;
    const { url, headers } = await buildS3PutRequest({
      accessKeyId, secretAccessKey, region, bucket, objectKey,
      body: bytes, contentType: "text/csv", now: new Date(),
    });

    const put = await fetch(url, { method: "PUT", headers, body: bytes });
    if (!put.ok) {
      const errText = (await put.text()).slice(0, 500);
      return json({ ok: false, error: `S3 PutObject ${put.status}: ${errText}` }, 502);
    }

    return json({
      ok: true, rows_exported: rows.length, bytes: bytes.length, first_byte_hex: firstByteHex,
      s3_key: objectKey, uploaded_at: new Date().toISOString(),
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});
