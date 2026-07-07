# Leg2 checkpoint-role model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive `edi_equivalent` from `matrix(role, leg, entry/exit)` instead of two drifting per-reader codes, fixing transit mislabelling and origin/destination miscodes.

**Architecture:** Role (`AMU`/`OE`/`NONE`) and the code matrix live in two new **Leg2** tables (`rfid_checkpoint_role`, `ref_checkpoint_code`). The ETL (`sql/06` + `sql/07`) emits an entry and an exit candidate per facility per leg, resolves the code by joining those tables, and falls back to legacy per-reader codes while a reader is unclassified. Transit ⇒ NULL. The editor sets role via a Leg2-side upsert.

**Tech Stack:** Postgres (Leg2 `ubgatxfwpmyaqyfrwias`), Deno edge functions, React 19 + Vite + TS + Vitest (`leg2-reporting/`).

## Global Constraints

- **Supabase writes** (apply SQL, deploy edge fn): name project + `ref` and get explicit confirmation before EACH write. Leg2 ref = `ubgatxfwpmyaqyfrwias`. Apply via scratchpad `apply.mjs` (Management API, PAT+ref pinned); NEVER the local CLI/`.env.local` (points at Study).
- **No GMS schema change.** Role is Leg2-side only.
- `sql/06` and `sql/07` share candidate/selection logic verbatim — **any change goes to both, identically** (header note enforces this).
- **Keep the existing `movement_type` literals** (`OUTBOUND`/`INBOUND`/`TRANSIT_ENTRY`/`TRANSIT_EXIT`) — `pivot.ts:56-69` and `supabase.ts:20` key on them. Entry/exit `direction` is computed **transiently** in the ETL for the matrix lookup and NOT stored, so no frontend/type change. Origin emits two `OUTBOUND` rows (2310 entry + 2320 exit) from different reads → distinct `movement_id`; destination emits two `INBOUND` rows (2400/2410).
- Merge to `main` locally, no push (user convention).
- Matrix values: AMU `2310/2320/2400/2410`; OE out-exit `2300`, in-entry `2420` (other OE cells empty); transit ⇒ NULL.

## File Structure

- Create `leg2-reporting/sql/checkpoint_role.sql` — the two tables + matrix seed + inference seed (idempotent).
- Modify `sql/06_rfid_transform_run_per_site.sql`, `sql/07_rfid_reprocess_scope_per_site.sql` — candidate generation + code resolution.
- Modify `leg2-reporting/sql/vw_reader_master.sql` — expose `checkpoint_role`.
- Modify `supabase/functions/apply-reader-edit/{index,request}.ts` (+ `request_test.ts`).
- Modify `leg2-reporting/src/lib/readerEdit.ts` (+ test), `src/components/ReaderEditorDialog.tsx` (+ test), `src/i18n/strings.ts`, `src/lib/supabase.ts` (types).
- Scratchpad throwaways for apply/verify (not committed).

---

### Task 1: Leg2 tables + matrix seed

**Files:** Create `leg2-reporting/sql/checkpoint_role.sql` (tables + `ref_checkpoint_code` seed only; inference seed added in Task 2).

- [ ] **Step 1** — Write `checkpoint_role.sql`:

```sql
create table if not exists public.rfid_checkpoint_role (
  lpi        text primary key,
  role       text not null check (role in ('AMU','OE','NONE')),
  source     text,                       -- 'inferred' | 'manual'
  updated_at timestamptz not null default now()
);
alter table public.rfid_checkpoint_role enable row level security;
drop policy if exists rcr_read on public.rfid_checkpoint_role;
create policy rcr_read on public.rfid_checkpoint_role for select to authenticated using (true);
-- writes only via service role (apply-reader-edit / ETL), no authenticated write policy.

create table if not exists public.ref_checkpoint_code (
  role text, leg text, direction text, code text,
  primary key (role, leg, direction)
);
insert into public.ref_checkpoint_code (role, leg, direction, code) values
  ('AMU','outbound','entry','2310'), ('AMU','outbound','exit','2320'),
  ('AMU','inbound','entry','2400'),  ('AMU','inbound','exit','2410'),
  ('OE','outbound','exit','2300'),   ('OE','inbound','entry','2420')
on conflict (role, leg, direction) do update set code = excluded.code;
alter table public.ref_checkpoint_code enable row level security;
drop policy if exists rcc_read on public.ref_checkpoint_code;
create policy rcc_read on public.ref_checkpoint_code for select to authenticated using (true);
```

- [ ] **Step 2** — Confirm target with user, apply via `apply.mjs checkpoint_role.sql` to Leg2 `ubgatxfwpmyaqyfrwias`. Expect HTTP 201.
- [ ] **Step 3** — Verify: `select role,leg,direction,code from ref_checkpoint_code order by 1,2,3` returns the 6 rows; `rfid_checkpoint_role` empty.
- [ ] **Step 4** — Commit `checkpoint_role.sql`.

**Interfaces produced:** tables `rfid_checkpoint_role(lpi,role)`, `ref_checkpoint_code(role,leg,direction,code)`.

---

### Task 2: Inference seed

**Files:** Modify `leg2-reporting/sql/checkpoint_role.sql` (append idempotent seed).

- [ ] **Step 1** — Append the confident-inference insert (rules from spec §Inference; only `source='inferred'`, never overwrites a `manual` row):

```sql
insert into public.rfid_checkpoint_role (lpi, role, source)
select lpi,
  case
    when lower(coalesce(facility_type,'')) like '%amu%'
         and not (edi_equivalent_outbound='2300' or edi_equivalent_inbound='2420') then 'AMU'
    when (edi_equivalent_outbound='2300' or edi_equivalent_inbound='2420')
         and not (edi_equivalent_outbound in ('2310','2320') or edi_equivalent_inbound in ('2400','2410')) then 'OE'
    when (edi_equivalent_outbound in ('2310','2320') or edi_equivalent_inbound in ('2400','2410'))
         and lower(coalesce(facility_type,'')) <> 'oe' then 'AMU'
  end as role,
  'inferred'
from public.vw_reader_master
where (edi_equivalent_outbound is not null or edi_equivalent_inbound is not null
       or facility_type ~* 'amu|oe')
on conflict (lpi) do nothing
-- filter out rows whose CASE fell through to NULL:
;
delete from public.rfid_checkpoint_role where role is null;
```

(Guard the NULL: wrap the select so only non-null roles insert — implement as `... ) s where s.role is not null` around the select; the trailing delete is a belt-and-suspenders.)

- [ ] **Step 2** — Confirm + apply to Leg2 `ubgatxfwpmyaqyfrwias`.
- [ ] **Step 3** — Verify counts match preview: `select role,count(*) from rfid_checkpoint_role group by 1` → AMU 88, OE 7. `select count(*)` = 95.
- [ ] **Step 4** — Commit.

---

### Task 3: ETL candidate + code resolution (`sql/06`)

**Files:** Modify `sql/06_rfid_transform_run_per_site.sql`.

**Interfaces consumed:** Task 1/2 tables.

- [ ] **Step 1** — Replace the 4 candidate branches (lines ~95-135) with entry+exit per leg. For each `country_group` site, produce two candidates — first read (`direction='entry'`, `row_number order by event_datetime_utc asc, edge_id asc`) and last read (`direction='exit'`, `desc`) — carrying transient `leg` (`outbound` country=origin / `inbound` country=dest / `transit` else) and `direction` columns for the matrix join. **`movement_type` keeps the existing literals**: origin→`OUTBOUND` (both candidates), destination→`INBOUND` (both), transit→`TRANSIT_ENTRY`/`TRANSIT_EXIT`. `route_country_role` = `ORIGIN`/`DESTINATION`/`TRANSIT` as today.

- [ ] **Step 2** — Single-read dedup in `selected`: when a site's entry and exit resolve to the same `edge_id`, keep only the leg representative (`exit` for outbound/transit, `entry` for inbound). Implement via `not exists` / `distinct on (edge_id, leg)` preferring the representative direction.

- [ ] **Step 3** — Replace the `edi_equivalent` CASE (line ~163) with a resolution join in the INSERT select:

```sql
-- in `selected` or the final select, join role + matrix; transit forced NULL; fallback to legacy when role NULL
coalesce(
  cc.code,                                   -- matrix hit (role known)
  case when leg <> 'transit' then            -- fallback for unclassified readers only
    case when direction='exit' then edi_equivalent_outbound else edi_equivalent_inbound end
  end
) as edi_equivalent
-- left join rfid_checkpoint_role rr on rr.lpi = reader_id
-- left join ref_checkpoint_code cc on cc.role = rr.role and cc.leg = leg and cc.direction = direction
```

(Transit: `leg='transit'` has no matrix row and the fallback branch is guarded to non-transit ⇒ NULL.)

- [ ] **Step 4** — Generalise `handover_quality_status` strings to the new `movement_type` values.
- [ ] **Step 5** — Read-only dry-run: apply to Leg2, then on the known S9s verify — `BABNXAUSJFKAAUR60008001110001` (transit) → both reads NULL; a 2-read origin AMU → 2310+2320; a destination AMU → 2400 (+2410 if 2 reads); an OE origin → 2300.
- [ ] **Step 6** — Commit `sql/06`.

---

### Task 4: Mirror to `sql/07`

**Files:** Modify `sql/07_rfid_reprocess_scope_per_site.sql` — apply Task 3 Steps 1-4 **identically** (diff sql/06 vs sql/07 candidate/selection blocks to confirm parity).

- [ ] **Step 1** — Port the changes. **Step 2** — Confirm + apply to Leg2. **Step 3** — `diff` the two functions' candidate/resolution blocks; must be identical bar the outer scope filter. **Step 4** — Commit.

---

### Task 5: Global reprocess + verify + export

- [ ] **Step 1** — Confirm + run `select * from rfid_reprocess_scope(p_filters => '{"from":"2026-01-01"}'::jsonb, p_environment=>'production', p_max_reads=>100000, p_reason=>'checkpoint_role_model')` on Leg2 (verify exact signature first via `\df`).
- [ ] **Step 2** — Verify: transit rows all `edi_equivalent IS NULL`; `2320` only ORIGIN; `2400` only DESTINATION; `2310`/`2410` now present for multi-read AMUs; 14 fallback readers keep a code.
- [ ] **Step 3** — Re-export CSV (`export-rfid-csv-to-s3`) — confirm + invoke. Non-blocking.

---

### Task 6: `vw_reader_master` exposes role

**Files:** Modify `leg2-reporting/sql/vw_reader_master.sql`.

- [ ] **Step 1** — Add `rr.role as checkpoint_role` via `left join public.rfid_checkpoint_role rr on rr.lpi = s.lpi` (keep legacy code columns for now). **Step 2** — Confirm + apply (drop+recreate per file's existing pattern). **Step 3** — Verify column present. **Step 4** — Commit.

---

### Task 7: `apply-reader-edit` writes role Leg2-side

**Files:** Modify `supabase/functions/apply-reader-edit/{index,request}.ts`, `request_test.ts`.

- [ ] **Step 1 (test first)** — Update `request_test.ts`: `operation` accepts `role` (`AMU`/`OE`/`NONE`), rejects `edi_equivalent_*`. Run: `deno test` → fails.
- [ ] **Step 2** — `request.ts`: `ALLOWED` = `['gate_purpose','handover_point','reading_direction','operations_scope','role']`; validate `role ∈ {AMU,OE,NONE}`. Split GMS-bound fields (all but `role`) from the Leg2 `role`.
- [ ] **Step 3** — `index.ts`: PATCH GMS only with the GMS-bound subset (skip PATCH if empty); upsert `rfid_checkpoint_role(lpi, role, source='manual')` via the service-role client; then existing sync → reprocess → export.
- [ ] **Step 4** — `deno test` passes. **Step 5** — Confirm + deploy `apply-reader-edit` to Leg2. **Step 6** — Commit.

---

### Task 8: Editor role dropdown

**Files:** `leg2-reporting/src/lib/readerEdit.ts`(+test), `src/components/ReaderEditorDialog.tsx`(+test), `src/i18n/strings.ts`, `src/lib/supabase.ts`.

- [ ] **Step 1 (test first)** — `readerEdit.test.ts`: `ReaderOperation` carries `role?: 'AMU'|'OE'|'NONE'|null`; `applyReaderEdit` posts it. `ReaderEditorDialog.test.tsx`: renders a Checkpoint-role `Select` (options AMU/OE/NONE), no Inbound/Outbound code selectors. Run vitest → fail.
- [ ] **Step 2** — `ReaderOperation`: drop `edi_equivalent_*`, add `role`. `ReaderEditorDialog`: replace the two code `Select`s with one role `Select`, seed from `vw_reader_master.checkpoint_role`. Add i18n (`checkpointRole`, option labels). Update `supabase.ts` `ReaderOption`/master types + `ReaderEditorDialog` props.
- [ ] **Step 3** — vitest for changed files passes. **Step 4** — `npx tsc --noEmit` + `npx vitest run` (full) + `npm run build` clean. **Step 5** — Commit.

---

### Task 9: Retire legacy code selectors

**Files:** `leg2-reporting/src/lib/ediCodes.ts`(+test) and any remaining refs; keep `checkpoints.ts` `CHECKPOINT_LABELS` (still labels pivot columns).

- [ ] **Step 1** — Remove `ediCodeOptions` and its test if now unused (grep to confirm no imports). Keep `CHECKPOINT_LABELS`/`checkpointLabel`. **Step 2** — `npx tsc --noEmit` + full `npx vitest run` + `npm run build` clean. **Step 3** — Commit.

---

## Post-implementation

- Whole-branch review, then finishing-a-development-branch (merge to `main` locally, no push).
- Follow-up (not this plan): classify the 14 active REVIEW readers via the editor, then remove the legacy fallback branch from `sql/06`/`sql/07` and drop the `edi_equivalent_*` columns from `vw_reader_master`.

## Self-review notes

- Spec coverage: role table (T1), matrix (T1), inference (T2), ETL entry+exit + resolution + fallback + transit-NULL (T3/T4), reprocess/export (T5), view (T6), editor/write-through (T7/T8), cleanup (T9). ✓
- Type consistency: `role` domain `AMU|OE|NONE` used identically in SQL check, `request.ts`, `ReaderOperation`, dropdown. ✓
- `movement_type` literals **unchanged** (resolved: `pivot.ts`/`supabase.ts` consumers keep working; `direction` is transient). `movement_id` = hash(edge_id, movement_type, country) stays unique because origin/destination entry vs exit come from different `edge_id`s; single-read facilities are dedup'd to one movement (T3 Step 2). ✓
- Fallback (Open #1 = fallback) applies to origin/destination only; transit always NULL. ✓
