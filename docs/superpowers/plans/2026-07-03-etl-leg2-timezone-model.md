# ETL Leg2 Timezone Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Leg2 RFID reports show correct local time (with real offset) while keeping UTC as the single canonical instant for all arithmetic, and make the fix self-healing (no reprocess needed) by resolving the IANA zone in the QuickSight view.

**Architecture:** `event_datetime_utc` (already a correct absolute instant from EDGE payloads) stays canonical and untouched. A new Leg2-owned table `rfid_timezone_map` (country/city → IANA zone) drives a rewritten `vw_quicksight_rfid_report_movements` that computes `reader_timezone` (real IANA) and `event_datetime_local` at read time. The existing export code (`time.ts`) already derives the offset correctly once it receives a real IANA zone, so it needs no change. The EDGE ingest additionally captures each read's raw offset into `rfid_edge_input_reads.event_offset` for audit/QA and as a fallback for reads with no country.

**Tech Stack:** Supabase Postgres (Leg2 `ubgatxfwpmyaqyfrwias`), Deno edge functions (TypeScript), MCP `supabase-leg2` tools (`apply_migration`, `execute_sql`), Deno test runner.

## Global Constraints

- **Target project (ALL DB writes):** Supabase Leg2, ref `ubgatxfwpmyaqyfrwias`, org `hwuajreqsmhxdojtlthg`. **Before every `apply_migration` / `execute_sql` write, state the project + ref and get explicit user confirmation.** Never infer the base. (Anti-confusion rule.)
- **UTC is canonical:** never change `event_datetime_utc`; never compute durations/deltas from local.
- **View output contract is fixed:** `vw_quicksight_rfid_report_movements` must keep the SAME columns in the SAME order (31 columns as today) so the CSV export / QuickSight manifest keep working. Verify column list is unchanged after the rewrite.
- **Idempotency:** all DDL uses `IF NOT EXISTS` / `CREATE OR REPLACE`; seeds use `ON CONFLICT DO UPDATE`; backfills are safe to re-run.
- **No export code change is required** for correctness; any `time.ts` cleanup is explicitly out of scope for this plan.

---

## File / Object Structure

**Database (Leg2, via MCP):**
- Create table: `public.rfid_timezone_map` — country/city → IANA zone (Leg2-owned source of truth).
- Alter table: `public.rfid_edge_input_reads` — add `event_offset text`.
- Replace view: `public.vw_quicksight_rfid_report_movements` — resolve IANA + compute local.

**Edge functions (local repo, Deno):**
- Create: `supabase/functions/edge-rfid-etl-orchestrator/offset.ts` — pure `extractOffset()` helper.
- Create: `supabase/functions/edge-rfid-etl-orchestrator/offset_test.ts` — Deno unit tests.
- Modify: `supabase/functions/edge-rfid-etl-orchestrator/index.ts` — import + use `extractOffset` in `normalizeRead`.

**Docs / memory:**
- Modify: `docs/etl_v5_technical_documentation.md` — correct §8.5/§19 ("dynamic self-heal" was false; document the map + view mechanism).
- Modify: memory `rfid-csv-s3-export-and-timezone-gap.md` — mark timezone gap resolved.

---

## Task 1: Timezone map table + seed

**Files (DB objects, Leg2 `ubgatxfwpmyaqyfrwias`):**
- Create: table `public.rfid_timezone_map`
- Verify: seeded rows against `pg_timezone_names`

**Interfaces:**
- Produces: table `rfid_timezone_map(country_code text, city text null, iana_zone text)` with a country-default row (`city IS NULL`) per country and optional city overrides; consumed by the view in Task 2 via `country_code` (+ optional `city`).

- [ ] **Step 1: Confirm target project**

State to the user: "Voy a crear `rfid_timezone_map` y sembrarla en Leg2 `ubgatxfwpmyaqyfrwias`. ¿Confirmas?" Wait for explicit yes before any write.

- [ ] **Step 2: Create table (apply_migration)**

Migration name: `create_rfid_timezone_map`.

```sql
create table if not exists public.rfid_timezone_map (
  country_code text not null,
  city         text,
  iana_zone    text not null,
  created_at_utc timestamptz not null default now(),
  updated_at_utc timestamptz not null default now()
);
-- Unicidad: una fila por (país, ciudad); city NULL = zona por defecto del país.
create unique index if not exists rfid_timezone_map_uq
  on public.rfid_timezone_map (country_code, coalesce(city, ''));
comment on table public.rfid_timezone_map is
  'Leg2-owned map country/city -> IANA zone. Fuente de verdad de reader_timezone en la vista QuickSight. GMS no puebla timezone; ver spec 2026-07-03.';
```

- [ ] **Step 3: Seed the countries present in the data (execute_sql, confirm ref again)**

```sql
insert into public.rfid_timezone_map (country_code, city, iana_zone) values
  ('JP', null, 'Asia/Tokyo'),
  ('KR', null, 'Asia/Seoul'),
  ('CH', null, 'Europe/Zurich'),
  ('BA', null, 'Europe/Sarajevo'),
  ('BR', null, 'America/Sao_Paulo'),
  ('BT', null, 'Asia/Thimphu'),
  ('CN', null, 'Asia/Shanghai'),
  ('HK', null, 'Asia/Hong_Kong'),
  ('IN', null, 'Asia/Kolkata'),
  ('KH', null, 'Asia/Phnom_Penh'),
  ('KZ', null, 'Asia/Almaty'),
  ('ME', null, 'Europe/Podgorica'),
  ('MY', null, 'Asia/Kuala_Lumpur'),
  ('NZ', null, 'Pacific/Auckland'),
  ('PL', null, 'Europe/Warsaw'),
  ('PT', null, 'Europe/Lisbon'),
  ('RO', null, 'Europe/Bucharest'),
  ('RS', null, 'Europe/Belgrade'),
  ('SG', null, 'Asia/Singapore'),
  ('TH', null, 'Asia/Bangkok'),
  ('TR', null, 'Europe/Istanbul'),
  ('VN', null, 'Asia/Ho_Chi_Minh')
on conflict (country_code, coalesce(city, '')) do update
  set iana_zone = excluded.iana_zone, updated_at_utc = now();
```

- [ ] **Step 4: Verify all seeded zones are valid IANA names**

Run (execute_sql):

```sql
select m.country_code, m.iana_zone
from public.rfid_timezone_map m
left join pg_timezone_names z on z.name = m.iana_zone
where z.name is null;
```

Expected: **0 rows** (every zone exists in the Postgres tz database). If any row returns, fix that seed value and re-run Step 3.

- [ ] **Step 5: Verify coverage vs data**

Run (execute_sql):

```sql
select distinct r.reader_country_code
from public.rfid_report_movements m
join public.rfid_edge_input_reads r on r.reader_id = m.reader_id
left join public.rfid_timezone_map tz on tz.country_code = m.movement_country_code and tz.city is null
where tz.country_code is null and m.movement_country_code is not null;
```

Expected: **0 rows** for countries that actually have movements. Any country returned must be added to the seed (Step 3). Note countries with no movements yet can be ignored.

---

## Task 2: Rewrite the QuickSight view to resolve IANA + compute local

**Files (DB objects, Leg2 `ubgatxfwpmyaqyfrwias`):**
- Replace: view `public.vw_quicksight_rfid_report_movements`

**Interfaces:**
- Consumes: `rfid_timezone_map` (Task 1); `rfid_report_movements`, `rfid_reader_master_snapshot`, `rfid_site_snapshot` (existing).
- Produces: same 31 output columns as before, but `reader_timezone` = resolved IANA, and `event_datetime_local`, `movement_date_local`, `movement_hour_local`, `movement_month_local` derived from the resolved zone. Consumed by `export-rfid-csv-to-s3` unchanged.

- [ ] **Step 1: Capture the current column contract (baseline)**

Run (execute_sql) and save the output:

```sql
select ordinal_position, column_name
from information_schema.columns
where table_schema='public' and table_name='vw_quicksight_rfid_report_movements'
order by ordinal_position;
```

Keep this list — Step 4 must match it exactly.

- [ ] **Step 2: Confirm target project, then replace the view (apply_migration)**

State: "Voy a reemplazar la vista `vw_quicksight_rfid_report_movements` en Leg2 `ubgatxfwpmyaqyfrwias`. ¿Confirmas?" Wait for yes.

Migration name: `rewrite_vw_quicksight_rfid_local_from_iana`.

```sql
create or replace view public.vw_quicksight_rfid_report_movements as
with resolved as (
  select
    m.*,
    coalesce(
      nullif(ss.timezone, ''),      -- respeta GMS si algún día lo puebla (R4)
      tz_city.iana_zone,            -- override por ciudad (países multi-zona)
      tz_country.iana_zone,         -- default del país
      'UTC'                         -- último recurso
    ) as resolved_zone
  from public.rfid_report_movements m
  left join public.rfid_reader_master_snapshot rm on rm.lpi = m.reader_id
  left join public.rfid_site_snapshot ss on ss.site_id = rm.site_id
  left join public.rfid_timezone_map tz_city
    on tz_city.country_code = m.movement_country_code and tz_city.city = m.city
  left join public.rfid_timezone_map tz_country
    on tz_country.country_code = m.movement_country_code and tz_country.city is null
)
select
  movement_id,
  source_edge_id,
  tag_id,
  s9_id,
  reader_id,
  movement_type,
  route_country_role,
  origin_country_code,
  destination_country_code,
  movement_country_code,
  country_sequence_number,
  event_datetime_utc,
  (event_datetime_utc at time zone resolved_zone) as event_datetime_local,
  (event_datetime_utc at time zone resolved_zone)::date as movement_date_local,
  extract(hour from (event_datetime_utc at time zone resolved_zone))::integer as movement_hour_local,
  to_char((event_datetime_utc at time zone resolved_zone), 'YYYY-MM') as movement_month_local,
  country_code,
  country_name,
  centre_code,
  site_impc_code,
  site_name,
  city,
  edi_equivalent,
  resolved_zone as reader_timezone,
  handover_point,
  handover_quality_status,
  case when handover_point then 'Handover point' else 'Non-handover point' end as handover_label,
  concat_ws(' - ', movement_country_code, centre_code, site_impc_code, site_name) as reader_location_label,
  created_at_utc,
  updated_at_utc
from resolved;
```

- [ ] **Step 3: Verify the column contract is unchanged**

Re-run the Step 1 query. Expected: identical `ordinal_position` / `column_name` list to the baseline. If any column name or order changed, fix the SELECT list and re-apply.

- [ ] **Step 4: Verify local derivation is correct (spot checks)**

Run (execute_sql):

```sql
select reader_timezone,
       min(event_datetime_utc)  as sample_utc,
       min(event_datetime_local) as sample_local,
       count(*) as n
from public.vw_quicksight_rfid_report_movements
group by reader_timezone
order by n desc;
```

Expected: JP rows show `reader_timezone='Asia/Tokyo'` and `event_datetime_local` = UTC + 9h; CH rows show `Europe/Zurich` with +1h/+2h depending on DST; PT rows show `Europe/Lisbon` (NOT `UTC`). No row should still show `reader_timezone='UTC'` for a country present in the map.

- [ ] **Step 5: Verify UTC arithmetic is untouched**

Run (execute_sql):

```sql
select count(*) as changed_utc
from public.vw_quicksight_rfid_report_movements v
join public.rfid_report_movements m using (movement_id)
where v.event_datetime_utc is distinct from m.event_datetime_utc;
```

Expected: `changed_utc = 0` (UTC canonical instant unchanged).

---

## Task 3: `extractOffset` helper (pure, TDD)

**Files:**
- Create: `supabase/functions/edge-rfid-etl-orchestrator/offset.ts`
- Test: `supabase/functions/edge-rfid-etl-orchestrator/offset_test.ts`

**Interfaces:**
- Produces: `export function extractOffset(timestamp: string | null): string | null` — returns normalized offset (`"+09:00"`, `"+05:30"`, `"Z"`) or `null` when the timestamp carries no offset. Consumed by `index.ts` (Task 4).

- [ ] **Step 1: Write the failing test**

`supabase/functions/edge-rfid-etl-orchestrator/offset_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractOffset } from "./offset.ts";

Deno.test("offset with colon", () => {
  assertEquals(extractOffset("2026-07-03T19:50:40.907+09:00"), "+09:00");
});
Deno.test("half-hour offset", () => {
  assertEquals(extractOffset("2026-07-03T20:20:40.907+05:30"), "+05:30");
});
Deno.test("compact offset is normalized to include colon", () => {
  assertEquals(extractOffset("2026-07-03T20:20:40.907+0530"), "+05:30");
});
Deno.test("negative offset", () => {
  assertEquals(extractOffset("2026-07-03T07:50:40.907-03:00"), "-03:00");
});
Deno.test("Z means UTC", () => {
  assertEquals(extractOffset("2026-07-03T10:50:40.907Z"), "Z");
});
Deno.test("naive timestamp has no offset", () => {
  assertEquals(extractOffset("2026-07-03 10:50:40.907"), null);
});
Deno.test("empty and null", () => {
  assertEquals(extractOffset(""), null);
  assertEquals(extractOffset(null), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/edge-rfid-etl-orchestrator/offset_test.ts`
Expected: FAIL — cannot resolve `./offset.ts` / `extractOffset` is not defined.

- [ ] **Step 3: Implement the helper**

`supabase/functions/edge-rfid-etl-orchestrator/offset.ts`:

```ts
/**
 * Extrae el offset ISO-8601 del final de un timestamp de EDGE.
 * Devuelve "+09:00" / "+05:30" / "Z", o null si el timestamp no lleva offset.
 * Normaliza el formato compacto "+0530" a "+05:30".
 */
export function extractOffset(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const m = timestamp.match(/(Z|[+-]\d{2}:?\d{2})$/);
  if (!m) return null;
  if (m[1] === "Z") return "Z";
  const off = m[1];
  return off.includes(":") ? off : `${off.slice(0, -2)}:${off.slice(-2)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/edge-rfid-etl-orchestrator/offset_test.ts`
Expected: PASS (all 8 test cases).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/edge-rfid-etl-orchestrator/offset.ts supabase/functions/edge-rfid-etl-orchestrator/offset_test.ts
git commit -m "feat(etl-ingest): add extractOffset helper for EDGE timestamp offset"
```

---

## Task 4: Capture `event_offset` at ingest

**Files:**
- Modify: `supabase/functions/edge-rfid-etl-orchestrator/index.ts` (`normalizeRead`, ~lines 33-55)
- Alter (DB, Leg2 `ubgatxfwpmyaqyfrwias`): `public.rfid_edge_input_reads` add `event_offset text`

**Interfaces:**
- Consumes: `extractOffset` (Task 3).
- Produces: new column `rfid_edge_input_reads.event_offset` populated on every new read; used by Task 5 QA and as a documented fallback signal.

- [ ] **Step 1: Confirm target project, then add the column (apply_migration)**

State: "Voy a añadir la columna `event_offset` a `rfid_edge_input_reads` en Leg2 `ubgatxfwpmyaqyfrwias`. ¿Confirmas?" Wait for yes.

Migration name: `add_event_offset_to_rfid_edge_input_reads`.

```sql
alter table public.rfid_edge_input_reads
  add column if not exists event_offset text;
comment on column public.rfid_edge_input_reads.event_offset is
  'Offset ISO del timestamp del payload EDGE (p.ej. +09:00, Z). Hecho histórico inmutable. Auditoría/QA del mapa de zonas y fallback sin país.';
```

- [ ] **Step 2: Import the helper in `index.ts`**

At the top of `supabase/functions/edge-rfid-etl-orchestrator/index.ts`, after the existing `createClient` import (line 1), add:

```ts
import { extractOffset } from "./offset.ts";
```

- [ ] **Step 3: Populate `event_offset` in `normalizeRead`**

In `normalizeRead`, the returned object currently sets `event_datetime_utc: timestamp` (line 49). Add `event_offset` to the returned object, right after `event_datetime_utc`:

```ts
    event_datetime_utc: timestamp,
    event_offset: extractOffset(timestamp),
```

(No other change; `timestamp` is already computed at line 40.)

- [ ] **Step 4: Verify the function still type-checks**

Run: `deno check supabase/functions/edge-rfid-etl-orchestrator/index.ts`
Expected: no errors.

- [ ] **Step 5: Confirm target project, then deploy the function (deploy_edge_function)**

State: "Voy a desplegar `edge-rfid-etl-orchestrator` en Leg2 `ubgatxfwpmyaqyfrwias`. ¿Confirmas?" Wait for yes, then deploy via `mcp__supabase-leg2__deploy_edge_function`.

- [ ] **Step 6: Verify new reads capture the offset**

After the next ETL run (or trigger one), run (execute_sql):

```sql
select event_offset, count(*) n
from public.rfid_edge_input_reads
where event_datetime_utc > now() - interval '1 day'
group by 1 order by n desc;
```

Expected: recent rows show real offsets (`+09:00`, etc.), not all null.

- [ ] **Step 7: Commit the code change**

```bash
git add supabase/functions/edge-rfid-etl-orchestrator/index.ts
git commit -m "feat(etl-ingest): capture event_offset from EDGE payload timestamp"
```

---

## Task 5: Backfill `event_offset` + validate the map against reality

**Files (DB, Leg2 `ubgatxfwpmyaqyfrwias`):**
- Update: `public.rfid_edge_input_reads.event_offset` from `raw_payload`

**Interfaces:**
- Consumes: `rfid_edge_input_reads.raw_payload`, `rfid_timezone_map`.
- Produces: historical `event_offset` populated; a QA report comparing payload offset vs map-derived offset (detects wrong seeds).

- [ ] **Step 1: Confirm target project, then backfill (execute_sql)**

State: "Voy a hacer backfill de `event_offset` en `rfid_edge_input_reads` (solo lectura de raw_payload, UPDATE idempotente) en Leg2 `ubgatxfwpmyaqyfrwias`. ¿Confirmas?" Wait for yes.

```sql
update public.rfid_edge_input_reads r
set event_offset = case
      when raw ~ 'Z$' then 'Z'
      when off is null then null
      when off ~ ':' then off
      else left(off, 3) || ':' || right(off, 2)   -- +0530 -> +05:30
    end
from (
  select id,
         raw_payload->>'timestamp' as raw,
         substring(raw_payload->>'timestamp' from '[+-]\d{2}:?\d{2}$') as off
  from public.rfid_edge_input_reads
  where raw_payload ? 'timestamp'
) src
where src.id = r.id
  and r.event_offset is null;
```

- [ ] **Step 2: Verify backfill coverage**

Run (execute_sql):

```sql
select
  count(*) filter (where event_offset is not null) as with_offset,
  count(*) filter (where event_offset is null)     as without_offset,
  count(*) as total
from public.rfid_edge_input_reads;
```

Expected: `without_offset` only accounts for reads whose payload timestamp genuinely had no offset (rare). Investigate if unexpectedly high.

- [ ] **Step 3: QA — does the map agree with the payload offset?**

Run (execute_sql). This compares, for reads whose payload carried a real offset, the payload offset vs the offset the map's IANA zone yields at that instant:

```sql
select r.reader_country_code,
       r.event_offset as payload_offset,
       round((extract(epoch from
         ((r.event_datetime_utc at time zone tz.iana_zone) - (r.event_datetime_utc at time zone 'UTC'))
       )/3600)::numeric, 2) as map_offset_hours,   -- horas de desfase según el mapa
       count(*) n
from public.rfid_edge_input_reads r
join public.rfid_timezone_map tz
  on tz.country_code = r.reader_country_code and tz.city is null
where r.event_offset is not null and r.event_offset <> 'Z'
group by 1,2,3
order by 1;
```

Expected: for each country the payload offset (e.g. `+09:00`) matches the map's derived offset (e.g. `9` hours). A mismatch means a wrong seed (fix in Task 1 Step 3) or a genuine multi-zone country needing a `city` override row. Document any mismatch; `Z`-payload reads (PT) are intentionally excluded because the map is what corrects them.

- [ ] **Step 4: No commit needed**

This task is data-only (no repo files changed). Record the QA result in the task notes / PR description.

---

## Task 6: End-to-end verification of the CSV export (no code change)

**Files:** none modified. Verifies `export-rfid-csv-to-s3` produces correct output through the new view.

**Interfaces:**
- Consumes: rewritten view (Task 2). Confirms the export's existing `toLocalIsoWithOffset(event_datetime_utc, reader_timezone)` now yields correct local ISO with offset.

- [ ] **Step 1: Dry-run the export sample**

Invoke `export-rfid-csv-to-s3` in dry-run mode (per its `dry_run` param; do NOT upload to S3). Confirm the sample rows show, for JP, `event_datetime_local` like `2026-...T..+09:00` and `reader_timezone=Asia/Tokyo`; for PT, `Europe/Lisbon` with the correct offset (not `Z`).

- [ ] **Step 2: Confirm the 22-column CSV contract is intact**

Check the dry-run output header/order matches the documented 22 columns (etl_v5 §8.4). No column added or reordered.

- [ ] **Step 3: Spot-check a duration is stable across UTC vs local**

Pick a tag with events in two countries; confirm the duration computed from `event_datetime_utc` is unchanged by the timezone work (it must be, since UTC is untouched — Task 2 Step 5 already proved this at the row level). Record the check.

---

## Task 7: Correct the docs and memory

**Files:**
- Modify: `docs/etl_v5_technical_documentation.md` (§8.5 note and §19)
- Modify: memory `rfid-csv-s3-export-and-timezone-gap.md` + `MEMORY.md` pointer

- [ ] **Step 1: Fix the false "dynamic self-heal" claim in §8.5**

Replace the "Hueco de dato origen (abierto)" note that says `reader_timezone` self-corrects when GMS publishes zones. New text: GMS does not populate `sites.timezone` (100% null, no ETA); Leg2 owns the zone via `rfid_timezone_map`; the view resolves IANA from the map (GMS-tolerant via `coalesce`), so local self-heals when the map changes — no reprocess. UTC was always correct; the gap was display-only.

- [ ] **Step 2: Update §19 open-gaps list**

Move `reader_timezone=UTC` from "open gap" to "resolved (map + view, 2026-07-03)". Keep the AWS key rotation gap as-is (out of scope here).

- [ ] **Step 3: Update memory**

In `...\memory\rfid-csv-s3-export-and-timezone-gap.md`, change the timezone-gap line to resolved (map-driven, self-healing view; UTC canonical). Update the one-line hook in `MEMORY.md` accordingly.

- [ ] **Step 4: Commit docs**

```bash
git add docs/etl_v5_technical_documentation.md
git commit -m "docs(etl): timezone resolved via rfid_timezone_map + view (UTC canonical, self-healing)"
```

---

## Self-Review

- **Spec coverage:** R1 (UTC or local per report) → Task 2 exposes both columns. R2 (durations in UTC) → UTC untouched, proven in Task 2 Step 5 + Task 6 Step 3. R3 (no frozen state) → local computed in view (Task 2), map editable without reprocess. R4 (Leg2 source of truth, GMS-tolerant) → `rfid_timezone_map` + `coalesce(gms, map)` in Task 2. Backfill of existing rows → handled by the view at read time (no movement rewrite needed) + `event_offset` backfill Task 5. Payload `Z` (PT) → map fallback, verified Task 2 Step 4. Multi-zone countries → `city` override rows, QA in Task 5 Step 3.
- **Out of scope confirmed:** reprocess #2, GMS access, AWS key rotation — none required by this plan.
- **Placeholder scan:** none — all SQL, TS, and commands are concrete.
- **Type/name consistency:** `extractOffset` signature identical in Tasks 3 and 4; `rfid_timezone_map(country_code, city, iana_zone)` and `resolved_zone` used consistently across Tasks 1, 2, 5; view column `reader_timezone` = `resolved_zone` matches the export's existing consumption.

**Note discovered during planning:** the export needs no code change — the existing `time.ts` already converts correctly once `reader_timezone` is a real IANA zone. `event_offset` capture is retained (per the approved design) as audit/QA + no-country fallback, not as the primary local driver.
