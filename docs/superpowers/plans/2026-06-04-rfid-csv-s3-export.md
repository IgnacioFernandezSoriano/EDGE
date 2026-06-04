# RFID CSV → S3 Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As the final step of each ETL run, export `vw_quicksight_rfid_report_movements` to a QuickSight-strict CSV and upload it (overwriting one fixed key) to `s3://upu-rfid-reporting/quicksight/rfid/current/rfid_movements.csv` via a dedicated Edge Function the orchestrator invokes.

**Architecture:** New Deno Edge Function `export-rfid-csv-to-s3` (Edge Leg2, `verify_jwt=false`) with three pure helper modules (`time.ts`, `csv.ts`, `sigv4.ts`) and an `index.ts` that paginates the view (service_role REST), builds the CSV (UTF-8 no BOM), and `PutObject`s to S3 using a self-contained AWS SigV4 signer. The orchestrator invokes it non-blocking after `rfid_finish_etl_run`, authenticating to the Functions gateway with a legacy anon JWT.

**Tech Stack:** Deno (Supabase Edge Functions), Web Crypto (`crypto.subtle`), `Intl.DateTimeFormat` (IANA offsets), AWS Signature V4, PostgREST. Tests run with `deno test`.

**Spec:** [docs/superpowers/specs/2026-06-04-rfid-csv-s3-export-design.md](../specs/2026-06-04-rfid-csv-s3-export-design.md)

**Project ref (Edge Leg2):** `ubgatxfwpmyaqyfrwias`

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/export-rfid-csv-to-s3/time.ts` | ISO-8601 formatting; local-time-with-offset from UTC instant + IANA zone |
| `supabase/functions/export-rfid-csv-to-s3/csv.ts` | CSV field escaping + row joining (QuickSight rules) |
| `supabase/functions/export-rfid-csv-to-s3/sigv4.ts` | AWS SigV4 signer → builds the S3 PutObject URL + headers |
| `supabase/functions/export-rfid-csv-to-s3/index.ts` | Entry: read secrets, paginate view, build CSV, PutObject (or dry_run) |
| `supabase/functions/export-rfid-csv-to-s3/time_test.ts` | Unit tests for `time.ts` (not deployed) |
| `supabase/functions/export-rfid-csv-to-s3/csv_test.ts` | Unit tests for `csv.ts` (not deployed) |
| `supabase/functions/export-rfid-csv-to-s3/sigv4_test.ts` | Unit tests for `sigv4.ts` (not deployed) |
| `supabase/functions/edge-rfid-etl-orchestrator/index.ts` | MODIFY: non-blocking invoke of export after finishRun |
| `docs/etl_v4_credentials.md` | MODIFY: add AWS S3 + internal-invoke credential entries (names only) |
| `docs/etl_v4_technical_documentation.md` | MODIFY: document new function, step, secrets |

**Column order (the 22 CSV columns, exact):**
`source_edge_id, tag_id, s9_id, reader_id, movement_type, event_datetime_utc, event_datetime_local, movement_date_local, movement_hour_local, movement_month_local, country_code, country_name, centre_code, site_impc_code, site_name, city, edi_equivalent, reader_timezone, handover_point, handover_label, reader_location_label, created_at_utc`

---

## Task 0: Ensure Deno is available for tests

**Files:** none (local tooling)

- [ ] **Step 1: Check for Deno**

Run: `deno --version`
Expected: prints a version. If `command not found`, continue to Step 2.

- [ ] **Step 2: Install Deno (Windows) if missing**

Run (PowerShell): `winget install --id=DenoLand.Deno -e --silent`
Fallback if winget unavailable: `irm https://deno.land/install.ps1 | iex` then restart the shell.
Expected: `deno --version` now prints a version (e.g. `deno 2.x`).

> If Deno cannot be installed in this environment, the unit tests in Tasks 1–3 cannot run locally; in that case rely on the dry_run + integration verification in Task 6 and note the skipped local tests explicitly. Do not silently skip.

---

## Task 1: `time.ts` — ISO-8601 + local-offset formatting

**Files:**
- Create: `supabase/functions/export-rfid-csv-to-s3/time.ts`
- Test: `supabase/functions/export-rfid-csv-to-s3/time_test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/export-rfid-csv-to-s3/time_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { toUtcIso, offsetForZone, toLocalIsoWithOffset } from "./time.ts";

Deno.test("toUtcIso keeps Z, drops millis", () => {
  assertEquals(toUtcIso("2026-05-27T02:48:19.000Z"), "2026-05-27T02:48:19Z");
  assertEquals(toUtcIso("2026-05-27T02:48:19Z"), "2026-05-27T02:48:19Z");
});

Deno.test("toUtcIso returns null for empty/invalid", () => {
  assertEquals(toUtcIso(null), null);
  assertEquals(toUtcIso(""), null);
  assertEquals(toUtcIso("not-a-date"), null);
});

Deno.test("offsetForZone resolves IANA zones incl. DST", () => {
  assertEquals(offsetForZone(new Date("2026-05-27T02:48:19Z"), "Asia/Tokyo"), "+09:00");
  assertEquals(offsetForZone(new Date("2026-07-01T12:00:00Z"), "America/New_York"), "-04:00");
  assertEquals(offsetForZone(new Date("2026-01-01T12:00:00Z"), "America/New_York"), "-05:00");
  assertEquals(offsetForZone(new Date("2026-05-27T02:48:19Z"), "UTC"), "Z");
});

Deno.test("toLocalIsoWithOffset derives local wall time + offset", () => {
  // Tokyo +09:00: 02:48:19Z -> 11:48:19+09:00 (matches spec example)
  assertEquals(
    toLocalIsoWithOffset("2026-05-27T02:48:19Z", "Asia/Tokyo"),
    "2026-05-27T11:48:19+09:00",
  );
  // No zone -> UTC with Z
  assertEquals(toLocalIsoWithOffset("2026-05-27T02:48:19Z", null), "2026-05-27T02:48:19Z");
  // Null instant -> null
  assertEquals(toLocalIsoWithOffset(null, "Asia/Tokyo"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/export-rfid-csv-to-s3/time_test.ts`
Expected: FAIL — `Module not found "./time.ts"`.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/functions/export-rfid-csv-to-s3/time.ts`:

```ts
/** ISO-8601 en UTC, sin milisegundos. null si la entrada es vacía/ inválida. */
export function toUtcIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Offset "+09:00" / "-05:00" para un instante en una zona IANA (respeta DST). "Z" si es UTC. */
export function offsetForZone(instant: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
  const name = dtf.formatToParts(instant).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-]\d{1,2}:?\d{2})?/);
  if (!m || !m[1]) return "Z";
  let off = m[1];
  if (!off.includes(":")) off = `${off.slice(0, -2)}:${off.slice(-2)}`; // "+0900" -> "+09:00"
  const [sign, rest] = [off[0], off.slice(1)];
  const [h, mm] = rest.split(":");
  return `${sign}${h.padStart(2, "0")}:${mm}`;
}

/** event_datetime_local en ISO-8601 con offset, derivado del instante UTC + zona IANA. */
export function toLocalIsoWithOffset(utcValue: string | null, timeZone: string | null): string | null {
  if (!utcValue) return null;
  const instant = new Date(utcValue);
  if (isNaN(instant.getTime())) return null;
  if (!timeZone) return toUtcIso(utcValue);
  const offset = offsetForZone(instant, timeZone);
  if (offset === "Z") return toUtcIso(utcValue);
  const sign = offset.startsWith("-") ? -1 : 1;
  const [oh, om] = offset.slice(1).split(":").map(Number);
  const localMs = instant.getTime() + sign * (oh * 60 + om) * 60000;
  const iso = new Date(localMs).toISOString().replace(/\.\d{3}Z$/, "");
  return `${iso}${offset}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/export-rfid-csv-to-s3/time_test.ts`
Expected: PASS (all 5 tests `ok`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/export-rfid-csv-to-s3/time.ts supabase/functions/export-rfid-csv-to-s3/time_test.ts
git commit -m "feat(export): ISO-8601 + IANA local-offset time helpers"
```

---

## Task 2: `csv.ts` — QuickSight-strict CSV escaping

**Files:**
- Create: `supabase/functions/export-rfid-csv-to-s3/csv.ts`
- Test: `supabase/functions/export-rfid-csv-to-s3/csv_test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/export-rfid-csv-to-s3/csv_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { csvEscape, csvRow } from "./csv.ts";

Deno.test("csvEscape: plain text unchanged", () => {
  assertEquals(csvEscape("abc"), "abc");
});
Deno.test("csvEscape: null/undefined -> empty field", () => {
  assertEquals(csvEscape(null), "");
  assertEquals(csvEscape(undefined), "");
});
Deno.test("csvEscape: quotes comma/quote/newline, doubles inner quotes", () => {
  assertEquals(csvEscape("a,b"), '"a,b"');
  assertEquals(csvEscape('she said "hi"'), '"she said ""hi"""');
  assertEquals(csvEscape("line\nbreak"), '"line\nbreak"');
  assertEquals(csvEscape("carriage\rreturn"), '"carriage\rreturn"');
});
Deno.test("csvEscape: booleans and numbers", () => {
  assertEquals(csvEscape(true), "true");
  assertEquals(csvEscape(false), "false");
  assertEquals(csvEscape(0), "0");
  assertEquals(csvEscape(23), "23");
});
Deno.test("csvRow joins escaped fields with comma", () => {
  assertEquals(csvRow(["a", "b,c", null, true]), 'a,"b,c",,true');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/export-rfid-csv-to-s3/csv_test.ts`
Expected: FAIL — `Module not found "./csv.ts"`.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/functions/export-rfid-csv-to-s3/csv.ts`:

```ts
/** Escapa un campo CSV según reglas de QuickSight (delimitador ',', cualificador '"'). */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Une una fila de valores ya en orden de columnas. */
export function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(",");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/export-rfid-csv-to-s3/csv_test.ts`
Expected: PASS (all 5 tests `ok`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/export-rfid-csv-to-s3/csv.ts supabase/functions/export-rfid-csv-to-s3/csv_test.ts
git commit -m "feat(export): QuickSight-strict CSV escaping helpers"
```

---

## Task 3: `sigv4.ts` — AWS Signature V4 for S3 PutObject

**Files:**
- Create: `supabase/functions/export-rfid-csv-to-s3/sigv4.ts`
- Test: `supabase/functions/export-rfid-csv-to-s3/sigv4_test.ts`

> Cryptographic correctness is ultimately verified by a real `PutObject` (Task 6). The unit tests here lock the parts we can assert deterministically: the known empty-string SHA-256, the `x-amz-date` format, the canonical path encoding, and signature determinism for a fixed clock.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/export-rfid-csv-to-s3/sigv4_test.ts`:

```ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sha256Hex, buildS3PutRequest } from "./sigv4.ts";

const enc = new TextEncoder();

Deno.test("sha256Hex: known empty-string digest", async () => {
  assertEquals(
    await sha256Hex(enc.encode("")),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

const fixed = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secretExampleKey",
  region: "eu-central-1",
  bucket: "upu-rfid-reporting",
  objectKey: "quicksight/rfid/current/rfid_movements.csv",
  body: enc.encode("source_edge_id\nabc\n"),
  contentType: "text/csv",
  now: new Date("2026-06-04T12:34:56.000Z"),
};

Deno.test("buildS3PutRequest: url, amz-date, signed headers, no ACL", async () => {
  const { url, headers } = await buildS3PutRequest(fixed);
  assertEquals(url, "https://upu-rfid-reporting.s3.eu-central-1.amazonaws.com/quicksight/rfid/current/rfid_movements.csv");
  assertEquals(headers["x-amz-date"], "20260604T123456Z");
  assertEquals(headers["Content-Type"], "text/csv");
  assert(headers["Authorization"].startsWith("AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260604/eu-central-1/s3/aws4_request"));
  assert(headers["Authorization"].includes("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date"));
  assert(/Signature=[0-9a-f]{64}$/.test(headers["Authorization"]));
  // x-amz-content-sha256 == sha256 of the body
  assertEquals(headers["x-amz-content-sha256"], await sha256Hex(fixed.body));
  // No ACL header is ever set
  assert(!("x-amz-acl" in headers));
});

Deno.test("buildS3PutRequest: deterministic for fixed clock", async () => {
  const a = await buildS3PutRequest(fixed);
  const b = await buildS3PutRequest(fixed);
  assertEquals(a.headers["Authorization"], b.headers["Authorization"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/export-rfid-csv-to-s3/sigv4_test.ts`
Expected: FAIL — `Module not found "./sigv4.ts"`.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/functions/export-rfid-csv-to-s3/sigv4.ts`:

```ts
const enc = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", data);
  return hex(new Uint8Array(h));
}

async function hmac(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return new Uint8Array(sig);
}

// RFC 3986 encoding por segmento (no encodea '/').
function encodeSegment(seg: string): string {
  return encodeURIComponent(seg).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export interface S3PutParams {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  objectKey: string; // p.ej. "quicksight/rfid/current/rfid_movements.csv"
  body: Uint8Array;
  contentType: string;
  now: Date;
}

export async function buildS3PutRequest(
  p: S3PutParams,
): Promise<{ url: string; headers: Record<string, string> }> {
  const host = `${p.bucket}.s3.${p.region}.amazonaws.com`;
  const canonicalUri = "/" + p.objectKey.split("/").map(encodeSegment).join("/");
  const amzDate = p.now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(p.body);

  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders =
    `content-type:${p.contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "", // canonical query string (none)
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${p.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(enc.encode(canonicalRequest)),
  ].join("\n");

  const kDate = await hmac(enc.encode("AWS4" + p.secretAccessKey), dateStamp);
  const kRegion = await hmac(kDate, p.region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      "Content-Type": p.contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "Authorization": authorization,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/export-rfid-csv-to-s3/sigv4_test.ts`
Expected: PASS (4 tests `ok`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/export-rfid-csv-to-s3/sigv4.ts supabase/functions/export-rfid-csv-to-s3/sigv4_test.ts
git commit -m "feat(export): self-contained AWS SigV4 signer for S3 PutObject"
```

---

## Task 4: `index.ts` — read view, build CSV, upload (or dry_run)

**Files:**
- Create: `supabase/functions/export-rfid-csv-to-s3/index.ts`

> No standalone unit test for `index.ts` (it depends on live secrets, the DB, and S3). It is verified end-to-end in Task 6 via `dry_run` then real upload. Keep all testable logic in the helper modules (already covered).

- [ ] **Step 1: Write the implementation**

Create `supabase/functions/export-rfid-csv-to-s3/index.ts`:

```ts
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

// Columnas que pedimos a PostgREST (las 22; event_datetime_utc/reader_timezone ya están e
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
```

- [ ] **Step 2: Type-check (no live deps needed)**

Run: `deno check supabase/functions/export-rfid-csv-to-s3/index.ts`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/export-rfid-csv-to-s3/index.ts
git commit -m "feat(export): export-rfid-csv-to-s3 Edge Function (view -> CSV -> S3)"
```

---

## Task 5: Wire the orchestrator to invoke export (non-blocking)

**Files:**
- Modify: `supabase/functions/edge-rfid-etl-orchestrator/index.ts` (success path, before the success `return jsonResponse(...)` near line 203)

- [ ] **Step 1: Add the non-blocking invocation**

In `supabase/functions/edge-rfid-etl-orchestrator/index.ts`, replace the success return block (currently lines ~192-210, from `await finishRun(...)` through the `return jsonResponse({ status: "success", ... })`) with:

```ts
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

    // ── ÚLTIMO PASO: exportar la vista a CSV y subirla a S3 (no bloqueante) ──
    // La vista ya está refrescada por rfid_transform_run. Un fallo aquí NO marca el run
    // como fallido: el ETL ya terminó OK. Auth del gateway: JWT anon legacy (no sensible),
    // porque las keys del entorno son formato nuevo no-JWT (401 función→función).
    let csvExport: Json = { ok: false, error: "not attempted" };
    try {
      const invokeKey = Deno.env.get("EDGE_INTERNAL_INVOKE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      const exportResp = await fetch(`${supabaseUrl}/functions/v1/export-rfid-csv-to-s3`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": invokeKey,
          "Authorization": `Bearer ${invokeKey}`,
        },
        body: "{}",
      });
      csvExport = await exportResp.json().catch(() => ({ ok: false, error: `non-JSON ${exportResp.status}` }));
      if (!exportResp.ok) console.error("csv_export_failed", JSON.stringify(csvExport));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("csv_export_error", msg);
      csvExport = { ok: false, error: msg };
    }

    return jsonResponse({
      status: "success",
      run_id: start.run_id,
      pages_requested: pages,
      reads_received: readsReceived,
      reads_staged: readsStaged,
      cursor_finished: finalCursor,
      csv_export: csvExport,
    });
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/edge-rfid-etl-orchestrator/index.ts`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/edge-rfid-etl-orchestrator/index.ts
git commit -m "feat(etl): orchestrator invokes CSV->S3 export as final, non-blocking step"
```

---

## Task 6: Set secrets, deploy, and verify end-to-end

**Files:** none (deployment + verification via Supabase MCP / HTTP)

> Uses Supabase MCP. Confirm the MCP OAuth session is on the org owning `ubgatxfwpmyaqyfrwias` ("EDGE Study"). The AWS key values come from the spec's secure source — set them via MCP, never write values into the repo.

- [ ] **Step 1: Set the export function secrets**

Set these as Edge Function secrets on `ubgatxfwpmyaqyfrwias` (via MCP `deploy_edge_function` secret config, or the dashboard if MCP cannot set secrets):
`AWS_S3_ACCESS_KEY_ID`, `AWS_S3_SECRET_ACCESS_KEY` (values from the secure channel),
`AWS_S3_REGION=eu-central-1`, `S3_BUCKET=upu-rfid-reporting`, `S3_PREFIX=quicksight/rfid/current`, `S3_OBJECT_KEY=rfid_movements.csv`.

Set on the **orchestrator**: `EDGE_INTERNAL_INVOKE_KEY` = the legacy anon JWT (the `eyJ…` role `anon` value already present in cron jobid 1 as `apikey`).

Expected: secrets listed for the project.

- [ ] **Step 2: Deploy `export-rfid-csv-to-s3` with `verify_jwt = false`**

Deploy via MCP `deploy_edge_function` with files `index.ts`, `time.ts`, `csv.ts`, `sigv4.ts` (NOT the `*_test.ts`) and `verify_jwt: false`.
Expected: deploy succeeds; function appears in `list_edge_functions`.

- [ ] **Step 3: Verify format with dry_run (no upload)**

Invoke (PowerShell), using the legacy anon JWT:
```powershell
$jwt = "<legacy anon JWT>"
Invoke-RestMethod -Method Post `
  -Uri "https://ubgatxfwpmyaqyfrwias.supabase.co/functions/v1/export-rfid-csv-to-s3" `
  -Headers @{ apikey = $jwt; Authorization = "Bearer $jwt"; "Content-Type" = "application/json" } `
  -Body '{"dry_run":true}' | ConvertTo-Json -Depth 5
```
Expected: `ok=true`, `dry_run=true`, `rows_exported` ≈ current view count (~3661), `first_byte_hex` = `73` (the `s` of `source_edge_id` — **NOT** `ef`, which would be a BOM), `header` exactly the 22 columns in order, and `sample` rows where a `Asia/Tokyo` row shows `event_datetime_local` ending in `+09:00`.

- [ ] **Step 4: Confirm the dry_run row count matches the view**

Run (MCP `execute_sql`, project `ubgatxfwpmyaqyfrwias`):
```sql
SELECT count(*) FROM public.vw_quicksight_rfid_report_movements;
```
Expected: equals `rows_exported` from Step 3.

- [ ] **Step 5: Real upload**

Invoke the same endpoint with body `{}` (no dry_run).
Expected: `ok=true`, `s3_key="quicksight/rfid/current/rfid_movements.csv"`, `uploaded_at` set, no error. (A `403 SignatureDoesNotMatch` means a SigV4 bug — revisit Task 3; a `400` mentioning ACL means an ACL header leaked — confirm none is set.)

- [ ] **Step 6: Verify the orchestrator's final step end-to-end**

Invoke the orchestrator (body `{"environment":"production","mode":"incremental"}`) with the legacy anon JWT as `apikey` + Bearer.
Expected: response `status="success"` and `csv_export.ok=true` with `rows_exported`/`s3_key`. If `csv_export.ok=false` with a 401, the gateway rejected the internal call → confirm `EDGE_INTERNAL_INVOKE_KEY` is the legacy anon JWT (fallback: invoke export from its own pg_cron reusing the orchestrator JWT, per spec §2 alternative).

- [ ] **Step 7: Notify QuickSight owner (manual, one-time)**

Per spec §6 of the consumer doc: after the first successful upload, notify the QuickSight integration owner that `s3://upu-rfid-reporting/quicksight/rfid/current/rfid_movements.csv` is live. (Manual step — flag to the user; do not automate.)

---

## Task 7: Update documentation

**Files:**
- Modify: `docs/etl_v4_credentials.md`
- Modify: `docs/etl_v4_technical_documentation.md`

- [ ] **Step 1: Add the AWS + internal-invoke credentials to the inventory**

In `docs/etl_v4_credentials.md` §2, append rows (names + locations only, **no values**):
`AWS_S3_ACCESS_KEY_ID`, `AWS_S3_SECRET_ACCESS_KEY` (Edge Function secrets in Edge Leg2, used by `export-rfid-csv-to-s3`; origin = AWS secure channel; **rotate ASAP — exposed in plaintext in the source doc**), `AWS_S3_REGION`/`S3_BUCKET`/`S3_PREFIX`/`S3_OBJECT_KEY` (config, not secret), and `EDGE_INTERNAL_INVOKE_KEY` (legacy anon JWT, public anon key, used by the orchestrator for the internal invoke). Add a usage-matrix row for `export-rfid-csv-to-s3` and update the orchestrator's row.

- [ ] **Step 2: Document the new function and step in the technical doc**

In `docs/etl_v4_technical_documentation.md`: add `export-rfid-csv-to-s3` to the Edge Functions section; add the CSV→S3 step as the orchestrator's final (non-blocking) phase; note the new secrets and the `verify_jwt=false` + legacy-anon-JWT invocation; add S3 destination + QuickSight hand-off details.

- [ ] **Step 3: Commit**

```bash
git add docs/etl_v4_credentials.md docs/etl_v4_technical_documentation.md
git commit -m "docs: document CSV->S3 export function, step, and credentials (names only)"
```

---

## Task 8: Open the pull request

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feat/rfid-csv-s3-export
gh pr create --base main --head feat/rfid-csv-s3-export \
  --title "feat: export QuickSight RFID dataset to S3 as final ETL step" \
  --body "Adds export-rfid-csv-to-s3 Edge Function (view -> QuickSight-strict CSV -> S3 PutObject via SigV4), invoked non-blocking by the orchestrator after the view refresh. Spec + plan under docs/superpowers/. No secret values committed."
```
Expected: PR created against `main`.

> Confirm with the user before pushing (per the session's commit policy: branch + PR, push on user's OK).

---

## Self-Review

- **Spec coverage:** §2 architecture → Tasks 4/5; verify_jwt + invoke auth → Tasks 5/6; §3 pagination → Task 4 `fetchAllRows`; §4 CSV rules → Tasks 1/2 + `buildCsv`; §5 columns → `COLUMNS` in Task 4; §6 SigV4/no-ACL → Task 3; §7 secrets → Task 6; §8 contract + dry_run → Task 4; §9 error handling → Task 4 (status codes) + Task 5 (non-blocking); §10 verification → Task 6; §11 docs → Task 7. All covered.
- **Placeholders:** none — every code/test step is complete; the only deliberately manual items (AWS key values, QuickSight notification) are flagged, not silent.
- **Type consistency:** `toUtcIso`/`toLocalIsoWithOffset`/`offsetForZone` (time.ts) ↔ used in index.ts; `csvEscape`/`csvRow` (csv.ts) ↔ index.ts; `sha256Hex`/`buildS3PutRequest`/`S3PutParams` (sigv4.ts) ↔ index.ts; `COLUMNS`/`SELECT` consistent; orchestrator uses existing `Json` type and `supabaseUrl`/`serviceRoleKey` already in scope.
