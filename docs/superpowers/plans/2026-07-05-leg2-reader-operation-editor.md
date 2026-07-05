# Leg2 Reader Operation Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **NOTE:** backend tasks write to Leg2 AND to GMS IOT and register a secret — each such write has a **CONFIRMATION GATE**; do not auto-apply.

**Goal:** Replace the GMS deep-link with an in-app modal that shows a curated reader master (Identification read-only + Operation editable) and, on "Save & apply", writes the Operation fields back to GMS IOT, re-syncs, reprocesses by reader, and re-exports — so the corrected reader surfaces under its checkpoint.

**Architecture:** A curated Leg2 read view (`vw_reader_master`, extended) feeds a `ReaderEditorDialog`. Saving calls a new Leg2 Edge Function `apply-reader-edit` (JWT-verified) that holds the GMS service_role key as a secret, PATCHes GMS `readers_master` (whitelisted columns only), then chains `sync-site-snapshot` → `rfid_reprocess_scope({readers:[lpi]})` → `export-rfid-csv-to-s3`.

**Tech Stack:** Supabase (Postgres view, Deno edge function, PostgREST), React 19 + Vite + TS, Vitest + @testing-library/react, Deno test.

## Global Constraints

- **Projects:** Leg2 = `ubgatxfwpmyaqyfrwias` (org `hwuajreqsmhxdojtlthg`); GMS IOT = `tsvlgznfvgoqbncunumu` (org `wvcuinlfxhgmujuhilbw`). **Before ANY write** (apply view DDL, register secret, deploy function, first live PATCH to GMS) name the project + ref and get explicit confirmation. **Never infer the database.**
- **GMS service_role key lives ONLY as an Edge Function secret** (`GMS_SERVICE_ROLE_KEY`) — never in the browser bundle, never committed.
- **Editable whitelist (exactly these 6 Operation columns):** `gate_purpose`, `edi_equivalent_inbound`, `edi_equivalent_outbound`, `handover_point`, `reading_direction`, `operations_scope`. The function must reject any other key.
- **Never expose `product` or `nms_reader_url`** in the view or the UI.
- **UI language:** English, from `leg2-reporting/src/i18n/strings.ts`.
- **apply-reader-edit contract:** `POST /functions/v1/apply-reader-edit`, JWT-verified, body `{ "lpi": string, "operation": { <whitelisted fields> } }`, response `{ "ok": boolean, "status": string, "movements_upserted": number, "reprocess_run_id"?: string, "error"?: string }`.
- **Reprocess by reader:** `rfid_reprocess_scope({ from:"2026-01-01T00:00:00Z", readers:[lpi] })` — no SQL function changes.
- Applying/verifying SQL and invoking functions: Management API + Leg2 PAT via `scratchpad/q.mjs` / `apply.mjs`; deploy via `npx supabase functions deploy … --project-ref ubgatxfwpmyaqyfrwias`.
- Frontend commands run from `leg2-reporting/` with `pnpm`; Deno tests from repo root with `deno test`.

---

## File Structure

- `leg2-reporting/sql/vw_reader_master.sql` — modify: extend curated read columns.
- `supabase/functions/apply-reader-edit/request.ts` — create: pure parser + whitelist.
- `supabase/functions/apply-reader-edit/request_test.ts` — create: Deno tests.
- `supabase/functions/apply-reader-edit/index.ts` — create: handler.
- `supabase/config.toml` — modify: declare `[functions.apply-reader-edit] verify_jwt = true`.
- `leg2-reporting/src/lib/supabase.ts` — modify: extend `ReaderMaster` + `READER_MASTER_SELECT_COLS`.
- `leg2-reporting/src/lib/ediCodes.ts` (+ `.test.ts`) — create: EDI code select options.
- `leg2-reporting/src/lib/readerEdit.ts` (+ `.test.ts`) — create: `applyReaderEdit` client.
- `leg2-reporting/src/components/ReaderEditorDialog.tsx` (+ `.test.tsx`) — create: the modal.
- `leg2-reporting/src/components/RfidEventsPivot.tsx` (+ test) — modify: clickable LPI → `onSelectReader`.
- `leg2-reporting/src/pages/RfidEventsPage.tsx` — modify: wire `ReaderEditorDialog`.
- `leg2-reporting/src/i18n/strings.ts` — modify: add `readerEditor.*`.
- **Delete:** `CorrectionDialog.tsx` (+test), `reprocess.ts` (+test), `gms.ts` (+test).

---

## Backend

### Task 1: Extend `vw_reader_master` with the curated read fields

**Files:** Modify `leg2-reporting/sql/vw_reader_master.sql`

**Interfaces:**
- Produces: `vw_reader_master` exposing (all as columns): `lpi, gate_id, gate_name, gate_purpose, reading_direction, facility_name, facility_type, site_id, reader_country_code, country_name, city, facility_latitude, facility_longitude, operator, priority, inactive, operations_scope, handover_point, edi_equivalent_inbound, edi_equivalent_outbound`. NOT `product`, NOT `nms_reader_url`.

- [ ] **Step 1: Rewrite the view DDL**

Replace the body of `leg2-reporting/sql/vw_reader_master.sql` (keep the header comment, update it to mention the Operation editor) with:
```sql
create or replace view public.vw_reader_master as
select
  lpi,
  gate_id,
  raw_payload->>'gate_name'               as gate_name,
  raw_payload->>'gate_purpose'            as gate_purpose,
  raw_payload->>'reading_direction'       as reading_direction,
  raw_payload->>'facility_name'           as facility_name,
  raw_payload->>'facility_type'           as facility_type,
  site_id,
  reader_country_code,
  raw_payload->>'country_name'            as country_name,
  raw_payload->>'city'                    as city,
  raw_payload->>'facility_latitude'       as facility_latitude,
  raw_payload->>'facility_longitude'      as facility_longitude,
  raw_payload->>'operator'                as operator,
  raw_payload->>'priority'                as priority,
  (raw_payload->>'inactive')::boolean     as inactive,
  raw_payload->>'operations_scope'        as operations_scope,
  handover_point,
  raw_payload->>'edi_equivalent_inbound'  as edi_equivalent_inbound,
  raw_payload->>'edi_equivalent_outbound' as edi_equivalent_outbound
from public.rfid_reader_master_snapshot;

grant select on public.vw_reader_master to authenticated;
```

- [ ] **Step 2: CONFIRMATION GATE — apply to Leg2**

Confirm: *"Apply CREATE OR REPLACE VIEW vw_reader_master to EDGE Leg2 `ubgatxfwpmyaqyfrwias`?"* On approval, run the file via `node apply.mjs …/vw_reader_master.sql`.

- [ ] **Step 3: Verify columns + no leakage**

```bash
node q.mjs "select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='vw_reader_master';"
```
Expected: includes `facility_type, city, operator, operations_scope, edi_equivalent_inbound, edi_equivalent_outbound`; **excludes** `product` and `nms_reader_url`. Then a data smoke:
```bash
node q.mjs "select lpi, gate_purpose, edi_equivalent_outbound, operations_scope from vw_reader_master where edi_equivalent_outbound is not null limit 2;"
```

- [ ] **Step 4: Commit**

```bash
git add leg2-reporting/sql/vw_reader_master.sql
git commit -m "feat(leg2): expand vw_reader_master with curated Operation/Identification fields"
```

---

### Task 2: `apply-reader-edit` request parser (whitelist)

**Files:** Create `supabase/functions/apply-reader-edit/request.ts`, `supabase/functions/apply-reader-edit/request_test.ts`

**Interfaces:**
- Produces: `parseReaderEditRequest(body: unknown): { ok: true; lpi: string; operation: Record<string,unknown> } | { ok: false; error: string }`. Allowed operation keys exactly: `gate_purpose, edi_equivalent_inbound, edi_equivalent_outbound, handover_point, reading_direction, operations_scope`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/apply-reader-edit/request_test.ts`:
```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseReaderEditRequest } from "./request.ts";

Deno.test("accepts a valid lpi + whitelisted operation fields", () => {
  const r = parseReaderEditRequest({
    lpi: "J11D1",
    operation: { edi_equivalent_outbound: "2320", handover_point: true },
  });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.lpi, "J11D1");
    assertEquals(r.operation, { edi_equivalent_outbound: "2320", handover_point: true });
  }
});

Deno.test("rejects a missing lpi", () => {
  assertEquals(parseReaderEditRequest({ operation: { gate_purpose: "x" } }).ok, false);
});

Deno.test("rejects an unknown operation key", () => {
  const r = parseReaderEditRequest({ lpi: "J11D1", operation: { product: ["leg2"] } });
  assertEquals(r.ok, false);
});

Deno.test("rejects an empty operation", () => {
  assertEquals(parseReaderEditRequest({ lpi: "J11D1", operation: {} }).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/apply-reader-edit/request_test.ts`
Expected: FAIL — `Module not found "./request.ts"`.

- [ ] **Step 3: Implement the parser**

Create `supabase/functions/apply-reader-edit/request.ts`:
```ts
const ALLOWED = [
  "gate_purpose",
  "edi_equivalent_inbound",
  "edi_equivalent_outbound",
  "handover_point",
  "reading_direction",
  "operations_scope",
] as const;

export type ParsedReaderEdit =
  | { ok: true; lpi: string; operation: Record<string, unknown> }
  | { ok: false; error: string };

export function parseReaderEditRequest(body: unknown): ParsedReaderEdit {
  const b = (body ?? {}) as { lpi?: unknown; operation?: unknown };
  const lpi = typeof b.lpi === "string" ? b.lpi.trim() : "";
  if (!lpi) return { ok: false, error: "lpi is required" };
  const opIn = (b.operation ?? {}) as Record<string, unknown>;
  if (typeof opIn !== "object" || opIn === null || Array.isArray(opIn)) {
    return { ok: false, error: "operation must be an object" };
  }
  const operation: Record<string, unknown> = {};
  for (const key of Object.keys(opIn)) {
    if (!(ALLOWED as readonly string[]).includes(key)) {
      return { ok: false, error: `field not allowed: ${key}` };
    }
    operation[key] = opIn[key];
  }
  if (Object.keys(operation).length === 0) {
    return { ok: false, error: "operation has no editable fields" };
  }
  return { ok: true, lpi, operation };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/apply-reader-edit/request_test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/apply-reader-edit/request.ts supabase/functions/apply-reader-edit/request_test.ts
git commit -m "feat(leg2): apply-reader-edit request parser with column whitelist"
```

---

### Task 3: `apply-reader-edit` handler + secret + deploy + live verify

**Files:** Create `supabase/functions/apply-reader-edit/index.ts`; modify `supabase/config.toml`

**Interfaces:**
- Consumes: `parseReaderEditRequest` (Task 2); GMS `readers_master` (PATCH); `sync-site-snapshot`, `rfid_reprocess_scope`, `export-rfid-csv-to-s3`.
- Produces: the endpoint per the Global-Constraints contract.

- [ ] **Step 1: Write the handler**

Create `supabase/functions/apply-reader-edit/index.ts`:
```ts
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
    status, headers: { "Content-Type": "application/json" },
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
```

- [ ] **Step 2: Type-check the handler**

Run: `deno check supabase/functions/apply-reader-edit/index.ts`
Expected: `Check …/index.ts` with no errors.

- [ ] **Step 3: Declare verify_jwt in config.toml**

Add to `supabase/config.toml`:
```toml
[functions.apply-reader-edit]
verify_jwt = true
```

- [ ] **Step 4: CONFIRMATION GATE — register the GMS secret**

Ask the user for the GMS IOT service_role key and confirm: *"Set secret GMS_SERVICE_ROLE_KEY on EDGE Leg2 `ubgatxfwpmyaqyfrwias`?"* On approval:
```bash
SUPABASE_ACCESS_TOKEN=<Leg2 PAT> npx supabase@latest secrets set GMS_SERVICE_ROLE_KEY=<gms key> --project-ref ubgatxfwpmyaqyfrwias
```
(Confirm `GMS_SITES_URL` already exists as a secret; if the function reads `GMS_URL`, it falls back to `GMS_SITES_URL`.)

- [ ] **Step 5: CONFIRMATION GATE — deploy the function**

Confirm: *"Deploy apply-reader-edit to EDGE Leg2 `ubgatxfwpmyaqyfrwias` (verify_jwt=true)?"* On approval:
```bash
SUPABASE_ACCESS_TOKEN=<Leg2 PAT> npx supabase@latest functions deploy apply-reader-edit --project-ref ubgatxfwpmyaqyfrwias
```

- [ ] **Step 6: Verify auth gating (no write)**

Sign in as the Leg2 test user (`scratchpad/signin.mjs`), then:
```bash
# empty body -> 400
curl -s -o /dev/null -w "%{http_code}\n" -X POST ".../functions/v1/apply-reader-edit" -H "apikey: <pub>" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
# no auth -> 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST ".../functions/v1/apply-reader-edit" -H "Content-Type: application/json" -d '{"lpi":"x","operation":{"gate_purpose":"y"}}'
```
Expected: `400` then `401`.

- [ ] **Step 7: CONFIRMATION GATE — live end-to-end write to GMS**

Pick a reader with an incident (a `reader_id` behind a NULL-edi movement):
```bash
node q.mjs "select reader_id, site_impc_code from rfid_report_movements where edi_equivalent is null and reader_id is not null limit 1;"
node q.mjs "select edi_equivalent_outbound, edi_equivalent_inbound from rfid_reader_master_snapshot where lpi='<that reader>';"
```
Confirm: *"Live test: PATCH reader `<lpi>` in GMS IOT `tsvlgznfvgoqbncunumu` (set the missing Outbound or Inbound Code) via apply-reader-edit, then sync+reprocess+export on Leg2?"* On approval, invoke with the test-user token and a value for the missing direction. Expected: `{ ok:true, status:"success", movements_upserted:>=1 }`, and the movement for that reader now has a non-null `edi_equivalent`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/apply-reader-edit/index.ts supabase/config.toml
git commit -m "feat(leg2): apply-reader-edit edge function (whitelist PATCH to GMS -> reprocess)"
```

---

## Frontend

### Task 4: Extend `ReaderMaster` type + fetch columns

**Files:** Modify `leg2-reporting/src/lib/supabase.ts`; Test `leg2-reporting/src/lib/supabase.test.ts`

**Interfaces:**
- Produces: `ReaderMaster` gains `facility_type, country_name, city, facility_latitude, facility_longitude, operator, priority, inactive, operations_scope, edi_equivalent_inbound, edi_equivalent_outbound`.

- [ ] **Step 1: Write the failing test**

Append to `leg2-reporting/src/lib/supabase.test.ts` (it already tests `buildReaderMasterUrl`):
```ts
import { buildReaderMasterUrl, READER_MASTER_SELECT_COLS } from "@/lib/supabase";

describe("reader master select columns", () => {
  it("requests the curated Operation + Identification fields, never product/nms", () => {
    const cols = READER_MASTER_SELECT_COLS;
    for (const c of [
      "edi_equivalent_inbound", "edi_equivalent_outbound", "operations_scope",
      "facility_type", "city", "operator",
    ]) {
      expect(cols).toContain(c);
    }
    expect(cols).not.toContain("product");
    expect(cols).not.toContain("nms_reader_url");
  });
});
```
(If `READER_MASTER_SELECT_COLS` is not exported, export it in Step 3.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir leg2-reporting test supabase`
Expected: FAIL — `READER_MASTER_SELECT_COLS` undefined / missing columns.

- [ ] **Step 3: Extend the type + columns**

In `leg2-reporting/src/lib/supabase.ts`, replace the `ReaderMaster` interface and `READER_MASTER_SELECT_COLS` with:
```ts
export interface ReaderMaster {
  lpi: string;
  gate_id: string | number | null;
  gate_name: string | null;
  gate_purpose: string | null;
  reading_direction: string | null;
  facility_name: string | null;
  facility_type: string | null;
  site_id: string | null;
  reader_country_code: string | null;
  country_name: string | null;
  city: string | null;
  facility_latitude: string | null;
  facility_longitude: string | null;
  operator: string | null;
  priority: string | null;
  inactive: boolean | null;
  operations_scope: string | null;
  handover_point: boolean;
  edi_equivalent_inbound: string | null;
  edi_equivalent_outbound: string | null;
}

export const READER_MASTER_SELECT_COLS = [
  "lpi", "gate_id", "gate_name", "gate_purpose", "reading_direction",
  "facility_name", "facility_type", "site_id", "reader_country_code",
  "country_name", "city", "facility_latitude", "facility_longitude",
  "operator", "priority", "inactive", "operations_scope", "handover_point",
  "edi_equivalent_inbound", "edi_equivalent_outbound",
].join(",");
```
(Change `const READER_MASTER_SELECT_COLS` to `export const`; leave `buildReaderMasterUrl`/`fetchReaderMaster` as-is — they already use the constant.)

- [ ] **Step 4: Run test + type-check**

Run: `pnpm --dir leg2-reporting test supabase && pnpm --dir leg2-reporting exec tsc --noEmit`
Expected: supabase tests PASS; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/supabase.ts leg2-reporting/src/lib/supabase.test.ts
git commit -m "feat(leg2-report): fetch curated reader-master fields for the editor"
```

---

### Task 5: EDI code select options

**Files:** Create `leg2-reporting/src/lib/ediCodes.ts`, `leg2-reporting/src/lib/ediCodes.test.ts`

**Interfaces:**
- Consumes: `CHECKPOINT_LABELS` from `@/lib/checkpoints`.
- Produces: `ediCodeOptions(current: string | null): { value: string; label: string }[]` — a leading empty option, the known IPC codes (ascending), and `current` appended if not already present.

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/lib/ediCodes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ediCodeOptions } from "@/lib/ediCodes";

describe("ediCodeOptions", () => {
  it("starts with an empty option and includes known codes with labels", () => {
    const opts = ediCodeOptions(null);
    expect(opts[0]).toEqual({ value: "", label: "—" });
    const codes = opts.map((o) => o.value);
    expect(codes).toContain("2320");
    expect(opts.find((o) => o.value === "2320")?.label).toMatch(/2320/);
  });
  it("appends the current value when it is not a known code", () => {
    const opts = ediCodeOptions("9999");
    expect(opts.some((o) => o.value === "9999")).toBe(true);
  });
  it("does not duplicate a current value that is already known", () => {
    const opts = ediCodeOptions("2320");
    expect(opts.filter((o) => o.value === "2320")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir leg2-reporting test ediCodes`
Expected: FAIL — cannot find `@/lib/ediCodes`.

- [ ] **Step 3: Implement**

Create `leg2-reporting/src/lib/ediCodes.ts`:
```ts
import { CHECKPOINT_LABELS } from "@/lib/checkpoints";

export interface EdiCodeOption {
  value: string;
  label: string;
}

// NOTE: seeded from the known IPC checkpoint codes. The GMS master may carry a
// broader catalog; the current value is always appended so nothing is lost.
export function ediCodeOptions(current: string | null): EdiCodeOption[] {
  const codes = Object.keys(CHECKPOINT_LABELS).sort((a, b) => Number(a) - Number(b));
  const options: EdiCodeOption[] = [{ value: "", label: "—" }];
  for (const code of codes) {
    options.push({ value: code, label: `${code} — ${CHECKPOINT_LABELS[code]}` });
  }
  if (current && !codes.includes(current)) {
    options.push({ value: current, label: current });
  }
  return options;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir leg2-reporting test ediCodes`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/ediCodes.ts leg2-reporting/src/lib/ediCodes.test.ts
git commit -m "feat(leg2-report): EDI code select options for the reader editor"
```

---

### Task 6: `applyReaderEdit` client

**Files:** Create `leg2-reporting/src/lib/readerEdit.ts`, `leg2-reporting/src/lib/readerEdit.test.ts`

**Interfaces:**
- Produces: `ReaderOperation` (partial of the 6 whitelisted fields) and `applyReaderEdit(lpi: string, operation: ReaderOperation, deps?): Promise<ApplyResult>` where `ApplyResult = { ok: boolean; status: string; movements_upserted: number; reprocess_run_id?: string; error?: string }`.

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/lib/readerEdit.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { applyReaderEdit } from "@/lib/readerEdit";

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}
function errResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as Response;
}

describe("applyReaderEdit", () => {
  it("POSTs { lpi, operation } with the bearer token and returns the result", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      okResponse({ ok: true, status: "success", movements_upserted: 1 })
    );
    const res = await applyReaderEdit(
      "J11D1",
      { edi_equivalent_outbound: "2320", handover_point: true },
      { fetchFn, token: "tok", anonKey: "anon", baseUrl: "https://x/functions/v1/apply-reader-edit" }
    );
    expect(res).toEqual({ ok: true, status: "success", movements_upserted: 1 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://x/functions/v1/apply-reader-edit");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({
      lpi: "J11D1",
      operation: { edi_equivalent_outbound: "2320", handover_point: true },
    });
  });

  it("returns ok:false with an error on a non-2xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(errResponse(502, { error: "gms down" }));
    const res = await applyReaderEdit("J11D1", { gate_purpose: "x" }, {
      fetchFn, token: "tok", anonKey: "anon", baseUrl: "https://x/functions/v1/apply-reader-edit",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("gms down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir leg2-reporting test readerEdit`
Expected: FAIL — cannot find `@/lib/readerEdit`.

- [ ] **Step 3: Implement**

Create `leg2-reporting/src/lib/readerEdit.ts`:
```ts
import { supabase } from "@/lib/supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface ReaderOperation {
  gate_purpose?: string | null;
  edi_equivalent_inbound?: string | null;
  edi_equivalent_outbound?: string | null;
  handover_point?: boolean;
  reading_direction?: string | null;
  operations_scope?: string | null;
}

export interface ApplyResult {
  ok: boolean;
  status: string;
  movements_upserted: number;
  reprocess_run_id?: string;
  error?: string;
}

type Deps = { fetchFn?: typeof fetch; token?: string; anonKey?: string; baseUrl?: string };

export async function applyReaderEdit(
  lpi: string,
  operation: ReaderOperation,
  deps: Deps = {}
): Promise<ApplyResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const anonKey = deps.anonKey ?? SUPABASE_ANON_KEY;
  let token = deps.token;
  if (!token) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? anonKey;
  }
  const url = deps.baseUrl ?? `${SUPABASE_URL}/functions/v1/apply-reader-edit`;

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ lpi, operation }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ApplyResult>;
  if (!res.ok) {
    return {
      ok: false,
      status: data.status ?? `http_${res.status}`,
      movements_upserted: 0,
      error: data.error ?? `HTTP ${res.status}`,
    };
  }
  return {
    ok: data.ok ?? false,
    status: data.status ?? "unknown",
    movements_upserted: data.movements_upserted ?? 0,
    reprocess_run_id: data.reprocess_run_id,
    error: data.error,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir leg2-reporting test readerEdit`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/readerEdit.ts leg2-reporting/src/lib/readerEdit.test.ts
git commit -m "feat(leg2-report): apply-reader-edit client"
```

---

### Task 7: `ReaderEditorDialog` + strings

**Files:** Create `leg2-reporting/src/components/ReaderEditorDialog.tsx`, `leg2-reporting/src/components/ReaderEditorDialog.test.tsx`; modify `leg2-reporting/src/i18n/strings.ts`

**Interfaces:**
- Consumes: `ReaderMaster` (Task 4), `ediCodeOptions` (Task 5), `applyReaderEdit` (Task 6), `Dialog*` from `@/components/ui/dialog`, `Switch`, `Input`, `Button`, `Label`, `Select*`.
- Produces: `ReaderEditorDialog` props `{ open, onOpenChange, reader: ReaderMaster | null, onApplied: () => void }`.

- [ ] **Step 1: Add strings**

In `leg2-reporting/src/i18n/strings.ts` add a `readerEditor` block (after `correction`):
```ts
  readerEditor: {
    title: "Reader master",
    identification: "Identification",
    operation: "Operation",
    save: "Save & apply",
    saving: "Applying…",
    applied: "Applied — the movement will appear under its checkpoint.",
    gatePurpose: "Gate purpose",
    inboundCode: "Inbound Code",
    outboundCode: "Outbound Code",
    handoverPoint: "Handover point",
    readingDirection: "Reading direction",
    operationsScope: "Operations scope",
  },
```

- [ ] **Step 2: Write the failing tests**

Create `leg2-reporting/src/components/ReaderEditorDialog.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReaderEditorDialog } from "@/components/ReaderEditorDialog";
import type { ReaderMaster } from "@/lib/supabase";

vi.mock("@/lib/readerEdit", () => ({
  applyReaderEdit: vi.fn().mockResolvedValue({ ok: true, status: "success", movements_upserted: 1 }),
}));
import { applyReaderEdit } from "@/lib/readerEdit";

const reader: ReaderMaster = {
  lpi: "J11DJ0002100000037", gate_id: "G1", gate_name: "Office", gate_purpose: "Office entrance and exit",
  reading_direction: "Entry/Exit", facility_name: "Kawasaki", facility_type: "AMU", site_id: "S",
  reader_country_code: "JP", country_name: "Japan", city: "Kawasaki", facility_latitude: "35.5",
  facility_longitude: "139.7", operator: "JP Post", priority: "1", inactive: false,
  operations_scope: "International", handover_point: true,
  edi_equivalent_inbound: "2320", edi_equivalent_outbound: null,
};

describe("ReaderEditorDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows read-only Identification and does not show product/nms", () => {
    render(<ReaderEditorDialog open onOpenChange={() => {}} reader={reader} onApplied={() => {}} />);
    expect(screen.getByText("J11DJ0002100000037")).toBeInTheDocument();
    expect(screen.getByText(/Kawasaki/)).toBeInTheDocument();
    expect(screen.queryByText(/product/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nms_reader_url/i)).not.toBeInTheDocument();
  });

  it("saves only the Operation fields via applyReaderEdit and reports applied", async () => {
    const onApplied = vi.fn();
    render(<ReaderEditorDialog open onOpenChange={() => {}} reader={reader} onApplied={onApplied} />);
    fireEvent.click(screen.getByText("Save & apply"));
    await waitFor(() => expect(applyReaderEdit).toHaveBeenCalledTimes(1));
    const [lpi, operation] = (applyReaderEdit as unknown as { mock: { calls: any[][] } }).mock.calls[0];
    expect(lpi).toBe("J11DJ0002100000037");
    expect(Object.keys(operation).sort()).toEqual([
      "edi_equivalent_inbound", "edi_equivalent_outbound", "gate_purpose",
      "handover_point", "operations_scope", "reading_direction",
    ]);
    await waitFor(() => expect(screen.getByText(/Applied/)).toBeInTheDocument());
    expect(onApplied).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --dir leg2-reporting test ReaderEditorDialog`
Expected: FAIL — cannot find `@/components/ReaderEditorDialog`.

- [ ] **Step 4: Implement the dialog**

Create `leg2-reporting/src/components/ReaderEditorDialog.tsx`:
```tsx
import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { ReaderMaster } from "@/lib/supabase";
import { ediCodeOptions } from "@/lib/ediCodes";
import { applyReaderEdit, type ReaderOperation } from "@/lib/readerEdit";
import { strings } from "@/i18n/strings";

type Status = "idle" | "saving" | "done" | "error";
const EMPTY = "__empty__";

function opFromReader(r: ReaderMaster): Required<ReaderOperation> {
  return {
    gate_purpose: r.gate_purpose ?? "",
    edi_equivalent_inbound: r.edi_equivalent_inbound ?? "",
    edi_equivalent_outbound: r.edi_equivalent_outbound ?? "",
    handover_point: r.handover_point ?? false,
    reading_direction: r.reading_direction ?? "",
    operations_scope: r.operations_scope ?? "",
  };
}

function ReadOnlyRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value == null || value === "" ? "—" : String(value)}</span>
    </div>
  );
}

export function ReaderEditorDialog({
  open, onOpenChange, reader, onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reader: ReaderMaster | null;
  onApplied: () => void;
}) {
  const [op, setOp] = useState<Required<ReaderOperation>>(
    reader ? opFromReader(reader) : opFromReader({} as ReaderMaster)
  );
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (reader) {
      setOp(opFromReader(reader));
      setStatus("idle");
      setMessage("");
    }
  }, [reader]);

  if (!reader) return null;
  const inboundOpts = ediCodeOptions(reader.edi_equivalent_inbound);
  const outboundOpts = ediCodeOptions(reader.edi_equivalent_outbound);

  async function handleSave() {
    if (!reader) return;
    setStatus("saving");
    setMessage("");
    try {
      const res = await applyReaderEdit(reader.lpi, op);
      if (!res.ok) throw new Error(res.error ?? res.status);
      setStatus("done");
      setMessage(strings.readerEditor.applied);
      onApplied();
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{strings.readerEditor.title}: {reader.lpi}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6">
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">{strings.readerEditor.identification}</h3>
            <ReadOnlyRow label={strings.columns.rfidReader} value={reader.lpi} />
            <ReadOnlyRow label={strings.columns.gate} value={reader.gate_name} />
            <ReadOnlyRow label="Facility" value={reader.facility_name} />
            <ReadOnlyRow label="Facility type" value={reader.facility_type} />
            <ReadOnlyRow label={strings.columns.site} value={reader.site_id} />
            <ReadOnlyRow label="Country" value={reader.country_name ?? reader.reader_country_code} />
            <ReadOnlyRow label="City" value={reader.city} />
            <ReadOnlyRow label="Operator" value={reader.operator} />
            <ReadOnlyRow label="Priority" value={reader.priority} />
            <ReadOnlyRow label="Inactive" value={reader.inactive} />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{strings.readerEditor.operation}</h3>
            <div className="space-y-1">
              <Label>{strings.readerEditor.gatePurpose}</Label>
              <Input
                value={op.gate_purpose ?? ""}
                onChange={(e) => setOp((o) => ({ ...o, gate_purpose: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{strings.readerEditor.inboundCode}</Label>
              <Select
                value={op.edi_equivalent_inbound || EMPTY}
                onValueChange={(v) => setOp((o) => ({ ...o, edi_equivalent_inbound: v === EMPTY ? "" : v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {inboundOpts.map((o) => (
                    <SelectItem key={o.value || EMPTY} value={o.value || EMPTY}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{strings.readerEditor.outboundCode}</Label>
              <Select
                value={op.edi_equivalent_outbound || EMPTY}
                onValueChange={(v) => setOp((o) => ({ ...o, edi_equivalent_outbound: v === EMPTY ? "" : v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {outboundOpts.map((o) => (
                    <SelectItem key={o.value || EMPTY} value={o.value || EMPTY}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="ho"
                checked={op.handover_point}
                onCheckedChange={(c) => setOp((o) => ({ ...o, handover_point: c }))}
              />
              <Label htmlFor="ho">{strings.readerEditor.handoverPoint}</Label>
            </div>
            <div className="space-y-1">
              <Label>{strings.readerEditor.readingDirection}</Label>
              <Input
                value={op.reading_direction ?? ""}
                onChange={(e) => setOp((o) => ({ ...o, reading_direction: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>{strings.readerEditor.operationsScope}</Label>
              <Input
                value={op.operations_scope ?? ""}
                onChange={(e) => setOp((o) => ({ ...o, operations_scope: e.target.value }))}
              />
            </div>
          </section>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={status === "saving"}>
            {status === "saving" ? strings.readerEditor.saving : strings.readerEditor.save}
          </Button>
          {message && (
            <span className={status === "error" ? "text-red-600 text-sm" : "text-green-700 text-sm"}>
              {message}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --dir leg2-reporting test ReaderEditorDialog`
Expected: PASS (2 tests). (If a shadcn `Select` interaction warns in jsdom, the test only clicks Save — no Select interaction — so it is unaffected.)

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/components/ReaderEditorDialog.tsx leg2-reporting/src/components/ReaderEditorDialog.test.tsx leg2-reporting/src/i18n/strings.ts
git commit -m "feat(leg2-report): reader Operation editor modal"
```

---

### Task 8: Wire clickable LPI; remove CorrectionDialog / reprocess / gms

**Files:** Modify `leg2-reporting/src/components/RfidEventsPivot.tsx` (+ test), `leg2-reporting/src/pages/RfidEventsPage.tsx`; **delete** `CorrectionDialog.tsx` (+test), `reprocess.ts` (+test), `gms.ts` (+test)

**Interfaces:**
- Consumes: `ReaderEditorDialog` (Task 7).
- Produces: `RfidEventsPivot` prop `onSelectReader: (lpi: string) => void` (replaces `onSelectIncident`).

- [ ] **Step 1: Update the pivot — clickable LPI**

In `leg2-reporting/src/components/RfidEventsPivot.tsx`: rename the prop `onSelectIncident: (movements: RfidMovement[]) => void` to `onSelectReader: (lpi: string) => void` (in both the destructuring and the type). In `NoEventCodeCell`, change its `onSelectIncident` prop to `onSelectReader: (lpi: string) => void`, and make the reader id clickable instead of the whole cell:
```tsx
    <TableCell className="font-mono text-xs bg-amber-50/40">
      <div className="font-semibold">{parts.date} ({parts.weekday})</div>
      <div className="font-semibold">{parts.time}</div>
      <button
        type="button"
        className="text-blue-700 underline"
        onClick={(e) => { e.stopPropagation(); onSelectReader(m.reader_id); }}
      >
        {m.reader_id}
      </button>
      <div className="text-muted-foreground">
        {strings.columns.gate}: {reader?.gate_name ?? "—"}
      </div>
      {movements.length > 1 && (
        <div className="text-[10px] text-amber-800">+{movements.length - 1}</div>
      )}
    </TableCell>
```
Update the two `<NoEventCodeCell … onSelectIncident={onSelectIncident} />` usages to `onSelectReader={onSelectReader}`.

- [ ] **Step 2: Update the pivot test**

In `leg2-reporting/src/components/RfidEventsPivot.test.tsx`: replace every `onSelectIncident={…}` prop with `onSelectReader={…}`. Replace the incident-click test body with:
```tsx
  it("fires onSelectReader with the LPI when the reader code is clicked", () => {
    const onReader = vi.fn();
    render(
      <RfidEventsPivot
        report={reportWithGap}
        timeMode="utc"
        selectedS9={null}
        onSelectS9={() => {}}
        onSelectReader={onReader}
        readerMap={readerMap}
      />
    );
    fireEvent.click(screen.getByText("R2"));
    expect(onReader).toHaveBeenCalledWith("R2");
  });
```
(The gap fixture's `noEventCodeOutbound[0].reader_id` is `"R2"`.)

- [ ] **Step 3: Wire the page**

In `leg2-reporting/src/pages/RfidEventsPage.tsx`: remove the `CorrectionDialog` import and its `<CorrectionDialog … />` block and the `incident` state; add:
```ts
import { ReaderEditorDialog } from "@/components/ReaderEditorDialog";
```
```ts
  const [editorLpi, setEditorLpi] = useState<string | null>(null);
```
Pass to the pivot: `onSelectReader={setEditorLpi}` (replacing `onSelectIncident`). Render:
```tsx
      <ReaderEditorDialog
        open={editorLpi !== null}
        onOpenChange={(o) => { if (!o) setEditorLpi(null); }}
        reader={editorLpi ? readerMap.get(editorLpi) ?? null : null}
        onApplied={() => { reload(); }}
      />
```
Add `reload` to the hook destructuring (the hook already returns `reload: load`). Remove the now-unused `RfidMovement` import if nothing else needs it.

- [ ] **Step 4: Delete the superseded files**

```bash
git rm leg2-reporting/src/components/CorrectionDialog.tsx leg2-reporting/src/components/CorrectionDialog.test.tsx \
       leg2-reporting/src/lib/reprocess.ts leg2-reporting/src/lib/reprocess.test.ts \
       leg2-reporting/src/lib/gms.ts leg2-reporting/src/lib/gms.test.ts
```

- [ ] **Step 5: Full suite + type-check + build**

Run:
```bash
pnpm --dir leg2-reporting test && pnpm --dir leg2-reporting exec tsc --noEmit && pnpm --dir leg2-reporting build
```
Expected: all tests PASS; `tsc` clean; build succeeds. (Fix any dangling import of the deleted modules — e.g. `strings.correction` is now unused but harmless; leave it or delete the block.)

- [ ] **Step 6: Commit**

```bash
git add -A leg2-reporting/src
git commit -m "feat(leg2-report): open reader editor from the reader code; drop GMS deep-link flow"
```

---

## Self-Review

- **Spec coverage:** curated read view (Task 1) ✓; editable-only-Operation whitelist (Tasks 2,3,7) ✓; write-through to GMS with service_role secret (Task 3) ✓; verify_jwt (Task 3) ✓; editor replaces deep-link, triggered by LPI (Task 8) ✓; Save & apply = write→sync→reprocess(readers)→export (Task 3 handler) ✓; modal (Task 7) ✓; no product/nms in view or UI (Tasks 1,4,7 + tests) ✓; reprocess by reader, no SQL fn change (Task 3) ✓; removals (Task 8) ✓.
- **Placeholder scan:** none — every code step carries full code. The EDI-catalog completeness and reading_direction/operations_scope-as-inputs are documented spec debts, not placeholders.
- **Type consistency:** `ReaderMaster` extended (Task 4) consumed by Tasks 7,8; `applyReaderEdit(lpi, operation)` signature consistent (Tasks 6,7); `ApplyResult` matches the edge-function contract (Task 3); `onSelectReader: (lpi: string) => void` consistent across pivot (Task 8) and page (Task 8); `ediCodeOptions` shape consistent (Tasks 5,7).
- **Backend gates:** view apply, GMS secret, deploy, first live GMS PATCH — all gated (Tasks 1,3).
