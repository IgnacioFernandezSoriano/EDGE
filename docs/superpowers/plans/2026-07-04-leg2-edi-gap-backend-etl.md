# Leg2 EDI-gap — Backend/ETL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **NOTE:** every task that writes to Leg2 (apply DDL, run reprocess, deploy Edge Function) has a **CONFIRMATION GATE** — the operator must name the project + ref and approve before the write. Do not auto-apply.

**Goal:** Make the Leg2 RFID ETL derive one movement **per site** (not per country), publish movements even when their `edi_equivalent` is unset (so gaps are visible), and expose a targeted, per-site reprocess the app can trigger after a correction is made in the GMS IOT reader master.

**Architecture:** Two Postgres functions in Leg2 carry a duplicated copy of the movement-selection logic — `rfid_transform_run(p_run_id)` (incremental) and `rfid_reprocess_scope(p_filters, …)` (manual recalc). Both get the identical per-site change. A new `rfid-reprocess-site` Edge Function chains snapshot-sync → `rfid_reprocess_scope({sites:[…]})` → CSV export.

**Tech Stack:** Supabase (Postgres plpgsql, `SECURITY DEFINER` RPCs), Deno Edge Functions, Supabase Management API (SQL via PAT) for applying/verifying DDL.

## Global Constraints

- **Supabase project:** EDGE Leg2 `ubgatxfwpmyaqyfrwias` (org `hwuajreqsmhxdojtlthg`). **Before ANY write** (apply_migration / execute_sql write / deploy) name the project + ref and get explicit confirmation. **Never infer the database.**
- **Duplicated logic:** the movement-selection CTE chain (`valid_reads` → `country_groups` → `candidates` → `selected`) exists **verbatim in both** `rfid_transform_run` AND `rfid_reprocess_scope`. The per-site change MUST be applied identically to both, or incremental runs and reprocesses will produce divergent movements.
- **Data start date:** 2026-01-01 (no pre-2026 data exists).
- **Reprocess Edge Function contract (must match the frontend plan):** `POST /functions/v1/rfid-reprocess-site`, JWT-verified (authenticated Leg2 user). Request body `{ "site_impc_code": string }`. Response `{ "ok": boolean, "status": string, "movements_upserted": number, "reprocess_run_id"?: string, "error"?: string }`.
- **Site key** available on `rfid_edge_input_reads` after enrichment: `site_impc_code` (text), fallback `centre_code`, fallback `reader_id`. `rfid_report_movements` carries `site_impc_code` and `centre_code` (no `site_id`).
- **Applying/verifying SQL:** use the Management API with the Leg2 PAT (see `.mcp.json`, gitignored). Helper `scratchpad/q.mjs` (node, `fetch`) runs a query and prints JSON.

---

## File Structure

- `sql/06_rfid_transform_run_per_site.sql` — new, records the full `CREATE OR REPLACE FUNCTION rfid_transform_run` with the per-site change.
- `sql/07_rfid_reprocess_scope_per_site.sql` — new, records the full `CREATE OR REPLACE FUNCTION rfid_reprocess_scope` with the per-site change **and** the new `sites` filter.
- `docs/runbooks/2026-07-04-leg2-per-site-reprocess.md` — new, one-off migration runbook (the full-history reprocess command + verification).
- `supabase/functions/rfid-reprocess-site/index.ts` — new Edge Function.
- `supabase/functions/rfid-reprocess-site/request.ts` — new, pure request parser/validator.
- `supabase/functions/rfid-reprocess-site/request_test.ts` — new, Deno unit test.

The DDL of both functions currently lives ONLY in the Leg2 DB. These `sql/*.sql` files bring the changed versions into the repo as the source of record.

---

### Task 1: Per-site selection in `rfid_transform_run`

**Files:**
- Create: `sql/06_rfid_transform_run_per_site.sql`

**Interfaces:**
- Consumes: current `rfid_transform_run(p_run_id uuid)` body (read it from the DB, see Step 1).
- Produces: `rfid_transform_run` that publishes one movement per `(tag_id, s9_id, movement_country_code, site)` per role, selected by time (not by handover flag).

**The change (applies to the `candidates` CTE, all four UNION branches):**
- Old partition: `partition by r.tag_id, r.s9_id, c.movement_country_code`
- New partition: `partition by r.tag_id, r.s9_id, c.movement_country_code, coalesce(r.site_impc_code, r.centre_code, r.reader_id)`
- Old order (OUTBOUND / TRANSIT_EXIT): `order by coalesce(r.handover_point,false) desc, r.event_datetime_utc desc, r.edge_id desc`
- New order (OUTBOUND / TRANSIT_EXIT): `order by r.event_datetime_utc desc, r.edge_id desc`
- Old order (INBOUND / TRANSIT_ENTRY): `order by coalesce(r.handover_point,false) desc, r.event_datetime_utc asc, r.edge_id asc`
- New order (INBOUND / TRANSIT_ENTRY): `order by r.event_datetime_utc asc, r.edge_id asc`

Nothing else changes (roles still derive from country; movements with NULL `edi_equivalent` are still inserted; `handover_quality_status` still recorded).

- [ ] **Step 1: Capture the current function body**

Run (from `scratchpad/`):
```bash
node q.mjs "select pg_get_functiondef(oid) src from pg_proc where proname='rfid_transform_run';" > /tmp/transform_current.json
```
Read `src`. This is the baseline you edit.

- [ ] **Step 2: Write the new DDL to the repo file**

Create `sql/06_rfid_transform_run_per_site.sql` containing the FULL `CREATE OR REPLACE FUNCTION public.rfid_transform_run(p_run_id uuid) …` from Step 1, with **only** the partition/order edits above applied to each of the four `row_number() over (…)` clauses in the `candidates` CTE. Add a header comment:
```sql
-- rfid_transform_run — per-site movement selection (2026-07-04)
-- Representative per (tag, s9, country, SITE) by time (last=outbound/exit, first=inbound/entry).
-- Handover flag no longer participates in selection. Movements with NULL edi_equivalent are published.
-- NOTE: identical selection logic is duplicated in rfid_reprocess_scope (sql/07_…); keep in sync.
```

- [ ] **Step 3: CONFIRMATION GATE — apply to Leg2**

Ask the operator to confirm: *"Apply CREATE OR REPLACE FUNCTION rfid_transform_run to EDGE Leg2 `ubgatxfwpmyaqyfrwias`?"* On explicit approval, run the file's SQL via the Management API (`q.mjs` with the file contents as the query).

- [ ] **Step 4: Verify the function compiles and is replaced**

Run:
```bash
node q.mjs "select proname, md5(pg_get_functiondef(oid)) from pg_proc where proname='rfid_transform_run';"
```
Expected: one row (no error). The function now contains the site key in its partition (spot-check by dumping and grepping for `site_impc_code, r.centre_code`).

- [ ] **Step 5: Commit**

```bash
git add sql/06_rfid_transform_run_per_site.sql
git commit -m "feat(leg2-etl): per-site movement selection in rfid_transform_run"
```

---

### Task 2: Per-site selection + `sites` filter in `rfid_reprocess_scope`

**Files:**
- Create: `sql/07_rfid_reprocess_scope_per_site.sql`

**Interfaces:**
- Consumes: current `rfid_reprocess_scope(p_filters jsonb, p_environment text, p_max_reads integer, p_reason text)` body.
- Produces: same signature; adds a `sites` filter key and the per-site selection change. New filter: `p_filters->'sites'` = JSON array of `site_impc_code` strings.

**Changes:**
1. Apply the **exact same** partition/order edits from Task 1 to the four `row_number() over (…)` clauses in this function's embedded `candidates` CTE.
2. Add a `sites` filter:
   - Declare (with the other filter vars):
     ```sql
     v_sites text[] := coalesce((select array_agg(e) from jsonb_array_elements_text(p_filters->'sites') e), '{}'::text[]);
     ```
   - Add this predicate to **both** the `count(*) into v_reads_matched_total` query and the `create temporary table tmp_reprocess_reads` query (alongside the existing `v_readers` predicate):
     ```sql
     and (cardinality(v_sites) = 0 or r.site_impc_code = any(v_sites))
     ```

- [ ] **Step 1: Capture the current function body**

Run (from `scratchpad/`):
```bash
node q.mjs "select pg_get_functiondef(oid) src from pg_proc where proname='rfid_reprocess_scope';" > /tmp/reprocess_current.json
```

- [ ] **Step 2: Write the new DDL to the repo file**

Create `sql/07_rfid_reprocess_scope_per_site.sql` with the full function from Step 1 plus the two changes above. Header comment:
```sql
-- rfid_reprocess_scope — per-site movement selection + `sites` filter (2026-07-04)
-- Mirrors the selection logic of rfid_transform_run (sql/06_…); keep in sync.
-- New filter: p_filters->'sites' = array of site_impc_code to scope the reprocess.
```

- [ ] **Step 3: CONFIRMATION GATE — apply to Leg2**

Confirm with operator, then apply the file's SQL to `ubgatxfwpmyaqyfrwias` via the Management API.

- [ ] **Step 4: Verify parity + the sites filter**

Run a dry parity check on a single already-processed pair (no writes beyond the reprocess of one S9). Ask the operator to pick a known `s9_id`, then:
```bash
node q.mjs "select * from rfid_reprocess_scope(jsonb_build_object('from','2026-01-01T00:00:00Z','s9_id','<PICKED_S9>'), 'production', 5000, 'parity_check');"
```
Expected: `status = success`, `movements_upserted >= 1`. Then confirm the `sites` filter matches reads:
```bash
node q.mjs "select site_impc_code, count(*) from rfid_edge_input_reads where enrichment_status='enriched' group by 1 order by 2 desc limit 3;"
```
(Use one of those `site_impc_code` values in a later `sites` scope test in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add sql/07_rfid_reprocess_scope_per_site.sql
git commit -m "feat(leg2-etl): per-site selection + sites filter in rfid_reprocess_scope"
```

---

### Task 3: Full-history reprocess (apply per-site to all data) + CSV export

**Files:**
- Create: `docs/runbooks/2026-07-04-leg2-per-site-reprocess.md`

**Interfaces:**
- Consumes: `rfid_reprocess_scope` (Task 2), `export-rfid-csv-to-s3` Edge Function.
- Produces: `rfid_report_movements` rebuilt per-site for all data since 2026-01-01; CSV re-exported to S3.

- [ ] **Step 1: Record the baseline movement count**

```bash
node q.mjs "select count(*) as movements_before, count(*) filter (where edi_equivalent is null) as null_edi_before from rfid_report_movements;"
```
Write the numbers into the runbook file.

- [ ] **Step 2: Write the runbook**

Create `docs/runbooks/2026-07-04-leg2-per-site-reprocess.md` documenting: purpose (one-off migration to per-site movements), the exact command below, the baseline numbers, and the verification query. (36,398 reads < the 100,000 `p_max_reads` cap, so a single call covers all history.)

- [ ] **Step 3: CONFIRMATION GATE — run the full reprocess**

Confirm: *"Run full-history per-site reprocess on EDGE Leg2 `ubgatxfwpmyaqyfrwias` (rewrites all movements since 2026-01-01)?"* On approval:
```bash
node q.mjs "select * from rfid_reprocess_scope(jsonb_build_object('from','2026-01-01T00:00:00Z'), 'production', 100000, 'per_site_migration');"
```
Expected: `status = success`; `reads_selected` ≈ 28k (enriched); `movements_upserted` > baseline.

- [ ] **Step 4: Verify per-site movements + visible gaps**

```bash
node q.mjs "select count(*) as movements_after, count(*) filter (where edi_equivalent is null) as null_edi_after from rfid_report_movements;"
node q.mjs "select edi_equivalent is null as gap, movement_type, count(*) from rfid_report_movements group by 1,2 order by 3 desc;"
```
Expected: `movements_after` > baseline; `null_edi_after` > baseline (per-site gaps now surface). Record in the runbook.

- [ ] **Step 5: CONFIRMATION GATE — re-export the CSV to S3**

Confirm, then invoke the export Edge Function (empty POST body) so the final ETL file reflects the rebuilt movements. Record the response `ok`/key in the runbook.

- [ ] **Step 6: Commit**

```bash
git add docs/runbooks/2026-07-04-leg2-per-site-reprocess.md
git commit -m "docs(leg2-etl): runbook for one-off per-site reprocess migration"
```

---

### Task 4: `rfid-reprocess-site` Edge Function

**Files:**
- Create: `supabase/functions/rfid-reprocess-site/request.ts`
- Create: `supabase/functions/rfid-reprocess-site/request_test.ts`
- Create: `supabase/functions/rfid-reprocess-site/index.ts`

**Interfaces:**
- Produces: the Edge Function endpoint per the Global-Constraints contract.
- Consumes: `sync-site-snapshot` (Edge Function), `rfid_reprocess_scope` (RPC), `export-rfid-csv-to-s3` (Edge Function).

- [ ] **Step 1: Write the failing test for the request parser**

Create `supabase/functions/rfid-reprocess-site/request_test.ts`:
```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseReprocessRequest } from "./request.ts";

Deno.test("accepts a valid site_impc_code", () => {
  assertEquals(parseReprocessRequest({ site_impc_code: "INMUBA" }), {
    ok: true, site_impc_code: "INMUBA",
  });
});

Deno.test("rejects a missing site_impc_code", () => {
  const r = parseReprocessRequest({});
  assertEquals(r.ok, false);
});

Deno.test("rejects a blank site_impc_code", () => {
  const r = parseReprocessRequest({ site_impc_code: "  " });
  assertEquals(r.ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/rfid-reprocess-site/request_test.ts`
Expected: FAIL — `Module not found "./request.ts"`.

- [ ] **Step 3: Implement the request parser**

Create `supabase/functions/rfid-reprocess-site/request.ts`:
```ts
export type ParsedReprocessRequest =
  | { ok: true; site_impc_code: string }
  | { ok: false; error: string };

export function parseReprocessRequest(body: unknown): ParsedReprocessRequest {
  const raw = (body as { site_impc_code?: unknown })?.site_impc_code;
  const site = typeof raw === "string" ? raw.trim() : "";
  if (!site) return { ok: false, error: "site_impc_code is required" };
  return { ok: true, site_impc_code: site };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/rfid-reprocess-site/request_test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the Edge Function handler**

Create `supabase/functions/rfid-reprocess-site/index.ts`:
```ts
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
    status, headers: { "Content-Type": "application/json" },
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
      return json({ ok: false, status: "sync_failed", movements_upserted: 0, error: t.slice(0, 300) }, 502);
    }

    // 2) Reprocess only the (tag,s9) pairs that touched this site.
    const { data, error } = await db.rpc("rfid_reprocess_scope", {
      p_filters: { from: DATA_START, sites: [site] },
      p_environment: "production",
      p_max_reads: 100000,
      p_reason: "site_correction_reprocess",
    });
    if (error) return json({ ok: false, status: "reprocess_failed", movements_upserted: 0, error: error.message }, 500);
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
```

- [ ] **Step 6: CONFIRMATION GATE — deploy to Leg2**

Confirm: *"Deploy Edge Function rfid-reprocess-site to EDGE Leg2 `ubgatxfwpmyaqyfrwias` (verify_jwt = true)?"* On approval, deploy it (ensure JWT verification is enabled so only authenticated Leg2 users can call it).

- [ ] **Step 7: Verify end-to-end on a real incident site**

Pick a `site_impc_code` that currently has a NULL-edi movement:
```bash
node q.mjs "select site_impc_code, count(*) from rfid_report_movements where edi_equivalent is null and site_impc_code is not null group by 1 order by 2 desc limit 1;"
```
Invoke the function (POST `{ "site_impc_code": "<that site>" }`) with an authenticated Leg2 user token. Expected response: `{ ok: true, status: "success", movements_upserted: >=1, … }`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/rfid-reprocess-site/
git commit -m "feat(leg2-etl): rfid-reprocess-site edge function (sync -> scoped reprocess -> export)"
```

---

## Self-Review

- **Spec coverage:** per-site selection (Tasks 1–2) ✓; publish NULL-edi movements (unchanged insert, verified Task 3 Step 4) ✓; targeted per-site reprocess (Tasks 2 + 4) ✓; snapshot-sync before reprocess (Task 4 Step 5.1) ✓; CSV re-export (Tasks 3 + 4) ✓; correction stays in GMS (no writes to snapshot here) ✓.
- **Duplicated-logic risk:** Tasks 1 and 2 both carry the same edit, called out in each and in Global Constraints.
- **Confirmation gates:** every Leg2 write (Tasks 1/2/3/4) is gated.
- **Out of scope (per spec):** non-`leg2` readers, invalid/unknown reads, `handover_point` gaps.
