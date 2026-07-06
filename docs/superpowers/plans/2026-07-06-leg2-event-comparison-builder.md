# Leg2 Event-Comparison Builder (Increment 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use `- [ ]`. Branch `feat/leg2-event-gaps` (continues Increments 1 & 2, not yet merged).

**Goal:** Replace the 4 fixed event comparisons with a generic, user-defined comparison model — any event (RFID checkpoint code / EDI message / handover pseudo) vs any event — plus a shared CRUD management screen; the gaps matrix is then driven by whatever comparisons the user has defined.

**Architecture:** The comparison config becomes generic `(a_source, a_code, b_source, b_code)`. A unified `events` CTE (RFID `edi_equivalent` + `__HO__` handover pseudo + EDI `message`, first UTC per S9) lets the SQL pair ANY two events per S9: `gap = B_ts − A_ts`, no window, first occurrence. Matrix RPC + detail view are rewritten around it. Frontend gains a `#/comparisons` CRUD screen writing directly to `ref_event_comparison` (RLS authenticated), and the existing matrix/detail adapt to the generic columns.

**Tech Stack:** React 19 + Vite + TS + Tailwind + shadcn/ui; Vitest + RTL; Supabase Postgres (PostgREST + RPC). `@/` → `leg2-reporting/src/`. Tests run from `leg2-reporting/` (`npx vitest run <path>`, `npx tsc --noEmit`, `npm run build`). SQL applied to Leg2 via the scratchpad helper `apply.mjs` (Management API, PAT+ref pinned).

## Global Constraints

- **Supabase project = EDGE Leg2, ref `ubgatxfwpmyaqyfrwias`.** Before applying ANY DB write, name project+ref and get explicit user confirmation. Apply SQL via `apply.mjs` (NOT the CLI/local stack — repo config points at the wrong project). SQL must be idempotent AND preserve user-created comparison rows on re-apply (guard the destructive one-time migration; seed with `on conflict do nothing`).
- **Generic comparison model:** `ref_event_comparison(comparison_key text pk, name text, a_source text, a_code text, b_source text, b_code text, priority int)`. `source ∈ {'RFID','EDI'}`. `a_code`/`b_code` = a checkpoint code (`2300`…`2450`), an EDI message (`RESCON`,`RESDES`,`PREDES`,…), or `'__HO__'` (RFID handover, any gate).
- **Pairing:** `gap_days = B_ts − A_ts` (may be negative); **no window**; **first occurrence** (`min(UTC)`) per (S9, source, code). Same-S9 scoping.
- **4 seeds (editable, keys preserved so existing exclusions survive):** `ho_rescon`=RFID `__HO__`→EDI `RESCON` (prio 1); `ho_resdes`=`__HO__`→`RESDES` (2); `ho_predes`=`__HO__`→`PREDES` (3); `arroe_rescon`=RFID `2420`→EDI `RESCON` (4).
- **Management screen is shared/global** (any authenticated user CRUDs; everyone sees the same), RLS `for all to authenticated`.
- Detail timestamp columns rename `rfid_utc`/`edi_utc` → **`a_utc`/`b_utc`**; the unused `colocation_valid` column is dropped.
- Exclusion keyed by `(s9code, comparison_key)` is UNCHANGED; deleting a comparison orphans its exclusions (accepted, no cascade in v1).
- All user-facing English text in `src/i18n/strings.ts`.

---

### Task 1: SQL — generic comparison data layer (Leg2)

Rewrites the comparison table (guarded migration), the base gaps view, the matrix function, the detail view, and adds the event-vocabulary view. This is the whole data layer; frontend tasks only read/write it.

**Files:**
- Modify (full rewrite of sections): `leg2-reporting/sql/event_pair_gaps.sql`
- Apply to: Leg2 `ubgatxfwpmyaqyfrwias` via `apply.mjs`

**Interfaces produced (read by Tasks 2–5):**
- `ref_event_comparison(comparison_key, name, a_source, a_code, b_source, b_code, priority)` — RLS `for all to authenticated`.
- `vw_event_pair_gaps_s9(s9code, comparison_key, origin_office, dest_office, origin_country, dest_country, product, a_utc, b_utc, gap_days, event_month, excluded)`.
- `event_pair_matrix(p_from date, p_to date, p_product text, p_granularity text) returns table(origin, destination, comparison_key, mean_days, n)` — filters `a_utc::date`.
- `vw_event_pair_detail_s9` = base + `origin_gate, origin_site, dest_gate, dest_site` (unchanged laterals).
- `vw_comparison_events(source text, code text, n int)` — the selectable event vocabulary.

- [ ] **Step 1: Rewrite the SQL file**

Replace the entire contents of `leg2-reporting/sql/event_pair_gaps.sql` with:

```sql
-- Event-pair gaps (Leg2, ubgatxfwpmyaqyfrwias): generic, user-defined event
-- comparisons. Each comparison = (A_source,A_code) vs (B_source,B_code); gap =
-- B_ts - A_ts per S9 (first occurrence, no window). Increment 3.

-- 1) Comparison config — GENERIC schema. Holds USER DATA: never drop-recreate on
-- re-apply. One-time migration from the old (rfid_selector/edi_messages) schema is
-- guarded so re-applying preserves user-created comparisons.
create table if not exists public.ref_event_comparison (
  comparison_key text primary key,
  name           text,
  a_source       text,
  a_code         text,
  b_source       text,
  b_code         text,
  priority       int
);

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='ref_event_comparison'
               and column_name='rfid_selector') then
    -- dependent objects reference the old columns; drop them before altering.
    drop function if exists public.event_pair_matrix(date, date, text, text);
    drop view if exists public.vw_event_pair_detail_s9;
    drop view if exists public.vw_event_pair_gaps_s9;
    -- backfill new columns from the old ones for the existing 4 rows.
    update public.ref_event_comparison set
      name     = coalesce(name, label),
      a_source = 'RFID',
      a_code   = case when rfid_selector = 'handover_flag' then '__HO__' else rfid_selector end,
      b_source = 'EDI',
      b_code   = edi_messages[1]
    where a_code is null;
    alter table public.ref_event_comparison
      drop column if exists rfid_selector,
      drop column if exists edi_messages,
      drop column if exists requires_colocation,
      drop column if exists direction,
      drop column if exists label;
  end if;
end $$;

-- Fresh-install seed (editable). do-nothing so re-apply never clobbers user edits.
insert into public.ref_event_comparison (comparison_key, name, a_source, a_code, b_source, b_code, priority) values
  ('ho_rescon',    'Handover → RESCON', 'RFID', '__HO__', 'EDI', 'RESCON', 1),
  ('ho_resdes',    'Handover → RESDES', 'RFID', '__HO__', 'EDI', 'RESDES', 2),
  ('ho_predes',    'Handover → PREDES', 'RFID', '__HO__', 'EDI', 'PREDES', 3),
  ('arroe_rescon', 'Arr OE (2420) → RESCON', 'RFID', '2420', 'EDI', 'RESCON', 4)
on conflict (comparison_key) do nothing;

-- enforce NOT NULL once rows are guaranteed populated (safe on re-apply).
alter table public.ref_event_comparison
  alter column name set not null,
  alter column a_source set not null,
  alter column a_code set not null,
  alter column b_source set not null,
  alter column b_code set not null,
  alter column priority set not null;

alter table public.ref_event_comparison enable row level security;
drop policy if exists rec_all on public.ref_event_comparison;
drop policy if exists rec_read on public.ref_event_comparison;
create policy rec_all on public.ref_event_comparison
  for all to authenticated using (true) with check (true);

-- 2) Permanent, global outlier exclusions, keyed by (s9code, comparison_key).
create table if not exists public.event_pair_exclusion (
  s9code         text not null,
  comparison_key text not null,
  excluded_by    text,
  excluded_at    timestamptz not null default now(),
  reason         text,
  primary key (s9code, comparison_key)
);
alter table public.event_pair_exclusion enable row level security;
drop policy if exists epx_all on public.event_pair_exclusion;
create policy epx_all on public.event_pair_exclusion
  for all to authenticated using (true) with check (true);

-- 2b) Mail-category display names (editable). Product filter shows name; pipeline keys on code.
create table if not exists public.ref_mail_category (
  code text primary key,
  name text not null
);
insert into public.ref_mail_category (code, name) values
  ('A',  'Aéreo / Prioritario'),
  ('B',  'No prioritario'),
  ('C',  'S.A.L. (Surface Air Lifted)'),
  ('D',  'Superficie'),
  ('E',  'EMS'),
  ('LC', 'Cartas (LC/AO)')
on conflict (code) do update set name = excluded.name;
alter table public.ref_mail_category enable row level security;
drop policy if exists rmc_read on public.ref_mail_category;
create policy rmc_read on public.ref_mail_category
  for select to authenticated using (true);

-- 3) Selectable event vocabulary (for the comparison builder's pickers).
create or replace view public.vw_comparison_events
with (security_invoker = on) as
select 'RFID'::text as source, edi_equivalent as code, count(*)::int as n
  from public.vw_quicksight_rfid_report_movements
  where edi_equivalent is not null
  group by edi_equivalent
union all
select 'RFID', '__HO__', count(*)::int
  from public.vw_quicksight_rfid_report_movements
  where handover_point = true
union all
select 'EDI', message, count(*)::int
  from public.vw_edi_events_tz
  where message is not null
  group by message;

-- 4) Generic base gaps view: one row per (S9, comparison) that has BOTH events.
create or replace view public.vw_event_pair_gaps_s9
with (security_invoker = on) as
with events as (
  -- RFID checkpoint events, first per (S9, code)
  select s9_id as s9code, 'RFID'::text as source, edi_equivalent as code, min(event_datetime_utc) as ts
    from public.vw_quicksight_rfid_report_movements
    where edi_equivalent is not null and event_datetime_utc is not null
    group by s9_id, edi_equivalent
  union all
  -- RFID handover pseudo-event (any handover gate), first per S9
  select s9_id, 'RFID', '__HO__', min(event_datetime_utc)
    from public.vw_quicksight_rfid_report_movements
    where handover_point = true and event_datetime_utc is not null
    group by s9_id
  union all
  -- EDI events (canonical UTC), first per (S9, message)
  select s9code, 'EDI', message, min(event_datetime_utc)
    from public.vw_edi_events_tz
    where message is not null and event_datetime_utc is not null
    group by s9code, message
)
select
  ea.s9code,
  c.comparison_key,
  substr(ea.s9code, 1, 6) as origin_office,
  substr(ea.s9code, 7, 6) as dest_office,
  substr(ea.s9code, 1, 2) as origin_country,
  substr(ea.s9code, 7, 2) as dest_country,
  d.mail_category         as product,
  ea.ts                   as a_utc,
  eb.ts                   as b_utc,
  round((extract(epoch from (eb.ts - ea.ts)) / 86400.0)::numeric, 4) as gap_days,
  date_trunc('month', ea.ts)::date as event_month,
  (x.s9code is not null) as excluded
from public.ref_event_comparison c
join events ea on ea.source = c.a_source and ea.code = c.a_code
join events eb on eb.source = c.b_source and eb.code = c.b_code and eb.s9code = ea.s9code
left join public.edi_details d on d.s9code = ea.s9code
left join public.event_pair_exclusion x on x.s9code = ea.s9code and x.comparison_key = c.comparison_key;

-- 5) Aggregation to the grid. security invoker -> base-data country RLS applies.
create or replace function public.event_pair_matrix(
  p_from date, p_to date, p_product text, p_granularity text
) returns table(origin text, destination text, comparison_key text, mean_days numeric, n int)
language sql stable security invoker as $$
  select
    case when p_granularity = 'country' then g.origin_country else g.origin_office end,
    case when p_granularity = 'country' then g.dest_country   else g.dest_office   end,
    g.comparison_key,
    round(avg(g.gap_days), 2),
    count(*)::int
  from public.vw_event_pair_gaps_s9 g
  where not g.excluded
    and g.a_utc::date between p_from and p_to
    and (
      p_product = 'all'
      or (p_product = '__none__' and g.product is null)
      or g.product = p_product
    )
  group by 1, 2, g.comparison_key
$$;
grant execute on function public.event_pair_matrix(date, date, text, text) to authenticated;

-- 6) Detail-enrichment view: base + ORIGIN/DESTINATION-role reading gate+site.
-- drop+recreate (g.* would reorder on a base-view column change).
drop view if exists public.vw_event_pair_detail_s9;
create view public.vw_event_pair_detail_s9
with (security_invoker = on) as
select
  g.*,
  orm.gate_name as origin_gate,
  ord.site_name as origin_site,
  drm.gate_name as dest_gate,
  drd.site_name as dest_site
from public.vw_event_pair_gaps_s9 g
left join lateral (
  select m.reader_id, m.site_name
  from public.vw_quicksight_rfid_report_movements m
  where m.s9_id = g.s9code and m.route_country_role = 'ORIGIN'
    and m.event_datetime_utc is not null
  order by m.event_datetime_utc asc limit 1
) ord on true
left join public.vw_reader_master orm on orm.lpi = ord.reader_id
left join lateral (
  select m.reader_id, m.site_name
  from public.vw_quicksight_rfid_report_movements m
  where m.s9_id = g.s9code and m.route_country_role = 'DESTINATION'
    and m.event_datetime_utc is not null
  order by m.event_datetime_utc asc limit 1
) drd on true
left join public.vw_reader_master drm on drm.lpi = drd.reader_id;
```

- [ ] **Step 2: Get explicit confirmation, then apply to Leg2**

Tell the user verbatim: "Voy a re-aplicar `event_pair_gaps.sql` (migración a esquema genérico de comparaciones + reescritura de vistas/función + vocabulario) a **EDGE Leg2, ref `ubgatxfwpmyaqyfrwias`**. Preserva comparaciones de usuario (migración guardada, seed do-nothing). ¿Confirmas?" Wait for an explicit yes.

Then (from the scratchpad dir): `node apply.mjs "c:/Users/fernandezi/projects/EDGE/leg2-reporting/sql/event_pair_gaps.sql"`
Expected: `HTTP 201` / `[]`.

- [ ] **Step 3: Verify with read-only queries** (`node q.mjs "<sql>"`)

```sql
select comparison_key, name, a_source, a_code, b_source, b_code from ref_event_comparison order by priority;
```
Expected: 4 rows, generic schema, `ho_*` with `a_code='__HO__'`, `arroe_rescon` with `a_code='2420'`.

```sql
select source, count(*) kinds from vw_comparison_events group by source order by source;
```
Expected: rows for `EDI` and `RFID` (RFID includes `__HO__`).

```sql
select comparison_key, count(*) n, round(avg(gap_days),2) avg from vw_event_pair_gaps_s9 group by comparison_key order by comparison_key;
```
Expected: 4 rows, `n>0` each.

Insert a temporary RFID↔RFID and an EDI↔EDI comparison to prove genericity, then read and delete them:
```sql
insert into ref_event_comparison values ('t_rr','2320→2420','RFID','2320','RFID','2420',98),('t_ee','PREDES→RESDES','EDI','PREDES','EDI','RESDES',99);
select comparison_key, count(*) n, round(avg(gap_days),2) avg from vw_event_pair_gaps_s9 where comparison_key in ('t_rr','t_ee') group by comparison_key;
delete from ref_event_comparison where comparison_key in ('t_rr','t_ee');
```
Expected: both temp comparisons yield `n>0` (RFID↔RFID and EDI↔EDI work). Then they're removed.

```sql
select * from event_pair_matrix('2026-01-01','2026-12-31','all','country') order by n desc limit 3;
```
Expected: rows with 2-char origin/destination, numeric `mean_days`, int `n`.

- [ ] **Step 4: Commit**
```bash
git add leg2-reporting/sql/event_pair_gaps.sql
git commit -m "feat(leg2): incr3 generic event-comparison SQL (unified events, any A vs B)"
```

---

### Task 2: `eventGaps.ts` — generic comparison type + label helpers

**Files:**
- Modify: `leg2-reporting/src/lib/eventGaps.ts`
- Test: `leg2-reporting/src/lib/eventGaps.test.ts` (extend)

**Interfaces produced (read by Tasks 3,4,5):**
- `EventComparison` gains `name, a_source, b_source: string; a_code, b_code: string;` (keep `comparison_key, priority`; REMOVE `label`).
- `interface EventVocabItem { source: string; code: string; n: number }`
- `const HANDOVER_CODE = "__HO__"`
- `function eventShortCode(source: string, code: string): string` — `code===HANDOVER_CODE ? "HO" : code`.
- `function eventFullLabel(source: string, code: string): string` — `__HO__`→"Handover (any gate)"; RFID→`${code}${CHECKPOINT_LABELS[code] ? " · "+CHECKPOINT_LABELS[code] : ""}`; EDI→`code`.
- `function comparisonCodeLabel(c: { a_source: string; a_code: string; b_source: string; b_code: string }): string` — `${eventShortCode(a_source,a_code)} → ${eventShortCode(b_source,b_code)}`.

- [ ] **Step 1: Write the failing test** — append to `eventGaps.test.ts`:
```ts
import {
  eventShortCode, eventFullLabel, comparisonCodeLabel, HANDOVER_CODE,
} from "@/lib/eventGaps";

describe("event label helpers", () => {
  it("eventShortCode maps handover to HO, else the code", () => {
    expect(eventShortCode("RFID", HANDOVER_CODE)).toBe("HO");
    expect(eventShortCode("RFID", "2320")).toBe("2320");
    expect(eventShortCode("EDI", "RESCON")).toBe("RESCON");
  });
  it("eventFullLabel names handover and annotates known RFID codes", () => {
    expect(eventFullLabel("RFID", HANDOVER_CODE)).toBe("Handover (any gate)");
    expect(eventFullLabel("RFID", "2320")).toBe("2320 · Exit Outbound AMU");
    expect(eventFullLabel("EDI", "RESCON")).toBe("RESCON");
  });
  it("comparisonCodeLabel joins A and B with an arrow", () => {
    expect(comparisonCodeLabel({ a_source: "RFID", a_code: HANDOVER_CODE, b_source: "EDI", b_code: "RESCON" }))
      .toBe("HO → RESCON");
  });
});
```

- [ ] **Step 2: Run → FAIL** — `cd leg2-reporting && npx vitest run src/lib/eventGaps.test.ts` (module members missing).

- [ ] **Step 3: Implement** — in `eventGaps.ts`:
  - Add `import { CHECKPOINT_LABELS } from "@/lib/checkpoints";` at top.
  - Replace the `EventComparison` interface with:
    ```ts
    export interface EventComparison {
      comparison_key: string;
      name: string;
      a_source: string;
      a_code: string;
      b_source: string;
      b_code: string;
      priority: number;
    }
    ```
  - Append:
    ```ts
    export interface EventVocabItem { source: string; code: string; n: number }
    export const HANDOVER_CODE = "__HO__";

    export function eventShortCode(_source: string, code: string): string {
      return code === HANDOVER_CODE ? "HO" : code;
    }
    export function eventFullLabel(source: string, code: string): string {
      if (code === HANDOVER_CODE) return "Handover (any gate)";
      if (source === "RFID") {
        const l = CHECKPOINT_LABELS[code];
        return l ? `${code} · ${l}` : code;
      }
      return code;
    }
    export function comparisonCodeLabel(c: {
      a_source: string; a_code: string; b_source: string; b_code: string;
    }): string {
      return `${eventShortCode(c.a_source, c.a_code)} → ${eventShortCode(c.b_source, c.b_code)}`;
    }
    ```

- [ ] **Step 4: Run → PASS** (`npx vitest run src/lib/eventGaps.test.ts`) + `npx tsc --noEmit` will FAIL in dependents (EventComparison.label removed) — that's expected; those are fixed in Tasks 3–4. Do NOT fix them here. Just confirm this test file passes.

- [ ] **Step 5: Commit**
```bash
git add leg2-reporting/src/lib/eventGaps.ts leg2-reporting/src/lib/eventGaps.test.ts
git commit -m "feat(leg2): incr3 generic EventComparison + event label helpers"
```

---

### Task 3: `supabase.ts` — generic comparisons, a/b rename, vocabulary, CRUD

**Files:**
- Modify: `leg2-reporting/src/lib/supabase.ts`
- Test: `leg2-reporting/src/lib/eventGapsApi.test.ts` (extend)

**Interfaces produced (read by Tasks 4,5):**
- `EventPairDetailRow`: rename `rfid_utc`→`a_utc`, `edi_utc`→`b_utc`; REMOVE `colocation_valid`.
- `fetchEventComparisons` selects `comparison_key,name,priority,a_source,a_code,b_source,b_code` (order `priority`).
- `fetchComparisonEvents(deps?): Promise<EventVocabItem[]>` — GET `vw_comparison_events?select=source,code,n&order=source,code`.
- `createComparison(c, deps?)`, `updateComparison(key, patch, deps?)`, `deleteComparison(key, deps?)` — PostgREST insert/patch/delete on `ref_event_comparison`.

- [ ] **Step 1: Write the failing test** — append to `eventGapsApi.test.ts`:
```ts
import {
  buildEventPairDetailUrl, buildComparisonUpsertBody, buildComparisonDeleteUrl,
} from "@/lib/supabase";

describe("incr3 comparison CRUD + detail rename", () => {
  it("detail url selects a_utc/b_utc and filters by a_utc range", () => {
    const u = buildEventPairDetailUrl("https://x.supabase.co/rest/v1/vw_event_pair_detail_s9", {
      origin: "IN", destination: "JP", comparisonKey: "ho_rescon",
      product: "all", from: "2026-01-01", to: "2026-03-31", granularity: "country",
      offset: 0, limit: 1000,
    });
    expect(u).toContain("a_utc");
    expect(u).not.toContain("rfid_utc");
    expect(decodeURIComponent(u)).toContain("a_utc=gte.2026-01-01T00:00:00");
  });
  it("buildComparisonUpsertBody maps fields", () => {
    expect(buildComparisonUpsertBody({
      comparison_key: "k1", name: "N", a_source: "RFID", a_code: "2320",
      b_source: "EDI", b_code: "RESCON", priority: 5,
    })).toEqual({ comparison_key: "k1", name: "N", a_source: "RFID", a_code: "2320",
      b_source: "EDI", b_code: "RESCON", priority: 5 });
  });
  it("buildComparisonDeleteUrl filters by key", () => {
    expect(buildComparisonDeleteUrl("https://x.supabase.co/rest/v1/ref_event_comparison", "k1"))
      .toContain("comparison_key=eq.k1");
  });
});
```

- [ ] **Step 2: Run → FAIL** — `cd leg2-reporting && npx vitest run src/lib/eventGapsApi.test.ts`.

- [ ] **Step 3: Implement** — in `supabase.ts`:
  - Add `EventVocabItem` to the existing `@/lib/eventGaps` import.
  - `EventPairDetailRow`: change `rfid_utc: string;`→`a_utc: string;`, `edi_utc: string;`→`b_utc: string;`, delete the `colocation_valid: boolean;` line.
  - `EVENT_PAIR_DETAIL_SELECT_COLS`: replace `"rfid_utc", "edi_utc"` with `"a_utc", "b_utc"` and delete `"colocation_valid"`.
  - In `buildEventPairDetailUrl`, replace the two `url.searchParams.append("rfid_utc", …)` lines with `a_utc`:
    ```ts
    url.searchParams.append("a_utc", `gte.${opts.from}T00:00:00`);
    url.searchParams.append("a_utc", `lte.${opts.to}T23:59:59`);
    ```
  - `fetchEventComparisons`: change the select line to
    `url.searchParams.set("select", "comparison_key,name,priority,a_source,a_code,b_source,b_code");`
  - Add a constant `const COMPARISON_TABLE = "ref_event_comparison";` and `const COMPARISON_EVENTS_VIEW = "vw_comparison_events";` near the other consts, plus:
    ```ts
    export function buildComparisonUpsertBody(c: EventComparison): Record<string, unknown> {
      return {
        comparison_key: c.comparison_key, name: c.name,
        a_source: c.a_source, a_code: c.a_code,
        b_source: c.b_source, b_code: c.b_code, priority: c.priority,
      };
    }
    export function buildComparisonDeleteUrl(baseUrl: string, comparisonKey: string): string {
      const url = new URL(baseUrl);
      url.searchParams.set("comparison_key", `eq.${comparisonKey}`);
      return url.toString();
    }
    export async function fetchComparisonEvents(deps: FetchDeps = {}): Promise<EventVocabItem[]> {
      const { fetchFn, headers } = resolveAuth(deps);
      const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${COMPARISON_EVENTS_VIEW}`;
      const url = new URL(baseUrl);
      url.searchParams.set("select", "source,code,n");
      url.searchParams.set("order", "source,code");
      const res = await fetchFn(url.toString(), { headers });
      if (!res.ok) throw new Error(`Leg2 comparison events fetch failed: ${res.status} ${await res.text()}`);
      return (await res.json()) as EventVocabItem[];
    }
    export async function createComparison(c: EventComparison, deps: FetchDeps = {}): Promise<void> {
      const { fetchFn, headers } = resolveAuth(deps);
      const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${COMPARISON_TABLE}`;
      const res = await fetchFn(baseUrl, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(buildComparisonUpsertBody(c)),
      });
      if (!res.ok) throw new Error(`Leg2 comparison insert failed: ${res.status} ${await res.text()}`);
    }
    export async function updateComparison(key: string, c: EventComparison, deps: FetchDeps = {}): Promise<void> {
      const { fetchFn, headers } = resolveAuth(deps);
      const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${COMPARISON_TABLE}`;
      const url = buildComparisonDeleteUrl(baseUrl, key); // same key filter
      const res = await fetchFn(url, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(buildComparisonUpsertBody(c)),
      });
      if (!res.ok) throw new Error(`Leg2 comparison update failed: ${res.status} ${await res.text()}`);
    }
    export async function deleteComparison(key: string, deps: FetchDeps = {}): Promise<void> {
      const { fetchFn, headers } = resolveAuth(deps);
      const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${COMPARISON_TABLE}`;
      const res = await fetchFn(buildComparisonDeleteUrl(baseUrl, key), { method: "DELETE", headers });
      if (!res.ok) throw new Error(`Leg2 comparison delete failed: ${res.status} ${await res.text()}`);
    }
    ```

- [ ] **Step 4: Run → PASS** (`npx vitest run src/lib/eventGapsApi.test.ts`). `tsc` still red in components (fixed next task) — acceptable; do not fix here.

- [ ] **Step 5: Commit**
```bash
git add leg2-reporting/src/lib/supabase.ts leg2-reporting/src/lib/eventGapsApi.test.ts
git commit -m "feat(leg2): incr3 data — generic comparisons, a/b rename, vocabulary, CRUD"
```

---

### Task 4: Adapt matrix + detail + page to the generic model

Makes the existing gaps screen compile and render the generic comparisons (header shows `name` + code label; detail uses `a_utc/b_utc` and labels columns Event A / Event B). Restores `tsc`/build green.

**Files:**
- Modify: `leg2-reporting/src/components/EventGapsMatrix.tsx`
- Modify: `leg2-reporting/src/components/EventGapsDetailDialog.tsx`
- Modify: `leg2-reporting/src/pages/EventGapsPage.tsx`
- Modify: `leg2-reporting/src/i18n/strings.ts` (add `gaps.colEventA`, `gaps.colEventB`)
- Test: `EventGapsMatrix.test.tsx`, `EventGapsDetailDialog.test.tsx`, `EventGapsPage.test.tsx`

**Consumes:** `EventComparison` (generic), `comparisonCodeLabel`, `EventPairDetailRow` (a_utc/b_utc, no colocation_valid).

- [ ] **Step 1: Update the matrix test** — in `EventGapsMatrix.test.tsx`, change the `comparisons` fixture from `{comparison_key, priority, label}` to the generic shape and assert the NAME renders and the code label is present:
```ts
const comparisons = [
  { comparison_key: "ho_rescon", name: "Handover → RESCON", priority: 1,
    a_source: "RFID", a_code: "__HO__", b_source: "EDI", b_code: "RESCON" },
  { comparison_key: "ho_resdes", name: "Handover → RESDES", priority: 2,
    a_source: "RFID", a_code: "__HO__", b_source: "EDI", b_code: "RESDES" },
];
// in the render test:
expect(screen.getByText("Handover → RESCON")).toBeInTheDocument();
expect(screen.getByText("HO → RESCON")).toBeInTheDocument(); // code label subtext
```
Run → FAIL.

- [ ] **Step 2: Update `EventGapsMatrix.tsx`** — header cell renders name + code label:
```tsx
import { formatGapDays, comparisonCodeLabel, type CorridorRow, type EventComparison } from "@/lib/eventGaps";
// ...
{comparisons.map((c) => (
  <TableHead key={c.comparison_key} className="sticky top-0 z-20 bg-background" title={comparisonCodeLabel(c)}>
    <div>{c.name}</div>
    <div className="text-[10px] font-normal text-muted-foreground">{comparisonCodeLabel(c)}</div>
  </TableHead>
))}
```
Run the matrix test → PASS.

- [ ] **Step 3: Update the detail dialog** — in `EventGapsDetailDialog.tsx`:
  - It currently reads `r.rfid_utc` / `r.edi_utc` and uses `strings.gaps.colRfid` / `colEdi`. Change the two data cells to `utcStamp(r.a_utc)` and `utcStamp(r.b_utc)`, and the two `TableHead`s to `strings.gaps.colEventA` / `strings.gaps.colEventB`.
  - Add strings `colEventA: "Event A"`, `colEventB: "Event B"` under `strings.gaps`.
  - Update `EventGapsDetailDialog.test.tsx` sample rows: rename `rfid_utc`→`a_utc`, `edi_utc`→`b_utc`, remove `colocation_valid`. Keep the weekday-regex and gate/site assertions.
Run → PASS.

- [ ] **Step 4: Update `EventGapsPage.tsx`** — it builds the detail dialog `title` and passes `rows`. No structural change is required for the rename (rows flow through), but if the page references `rfid_utc`/`edi_utc`/`colocation_valid` anywhere, update them. Also, in the page's `EventGapsPage.test.tsx`, the `fetchEventPairDetail` mock rows must rename `rfid_utc`→`a_utc`, `edi_utc`→`b_utc`, drop `colocation_valid`, and the `comparisons` mock (fetchEventComparisons) must use the generic shape. Keep existing assertions.

- [ ] **Step 5: Full green** — `cd leg2-reporting && npx vitest run && npx tsc --noEmit && npm run build`. All pass.

- [ ] **Step 6: Commit**
```bash
git add leg2-reporting/src/components/EventGapsMatrix.tsx leg2-reporting/src/components/EventGapsDetailDialog.tsx leg2-reporting/src/pages/EventGapsPage.tsx leg2-reporting/src/i18n/strings.ts leg2-reporting/src/components/EventGapsMatrix.test.tsx leg2-reporting/src/components/EventGapsDetailDialog.test.tsx leg2-reporting/src/pages/EventGapsPage.test.tsx
git commit -m "feat(leg2): incr3 adapt matrix/detail/page to generic comparison model"
```

---

### Task 5: `ComparisonsPage` — shared CRUD management screen + nav

New screen to create/edit/delete comparisons, with event pickers grouped RFID/EDI.

**Files:**
- Create: `leg2-reporting/src/pages/ComparisonsPage.tsx`
- Modify: `leg2-reporting/src/lib/hashRoute.ts` (+ test), `leg2-reporting/src/App.tsx` (+ test), `leg2-reporting/src/i18n/strings.ts`
- Test: `leg2-reporting/src/pages/ComparisonsPage.test.tsx`

**Consumes (Tasks 2,3):** `EventComparison`, `EventVocabItem`, `eventFullLabel`, `fetchEventComparisons`, `fetchComparisonEvents`, `createComparison`, `updateComparison`, `deleteComparison`.

- [ ] **Step 1: Route** — in `hashRoute.ts` add `{ name: "comparisons" }` to `Route`, a `COMPARISONS_RE = /^#\/comparisons\b/` checked in `parseHash` (return `{ name: "comparisons" }`), and `export function comparisonsHash() { return "#/comparisons"; }`. In `hashRoute.test.ts` add: `expect(parseHash("#/comparisons")).toEqual({ name: "comparisons" })`. Run the hashRoute test → PASS.

- [ ] **Step 2: Strings** — add under the top-level `strings` object:
```ts
  comparisons: {
    nav: "Comparisons",
    title: "Event comparisons",
    add: "Add comparison",
    name: "Name",
    eventA: "Event A",
    eventB: "Event B",
    priority: "Priority",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    remove: "Delete",
    confirmDelete: "Delete this comparison?",
    rfidGroup: "RFID events",
    ediGroup: "EDI events",
    empty: "No comparisons yet. Add one.",
  },
```

- [ ] **Step 3: Page test** — create `ComparisonsPage.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const comparisons = [
  { comparison_key: "ho_rescon", name: "Handover → RESCON", priority: 1,
    a_source: "RFID", a_code: "__HO__", b_source: "EDI", b_code: "RESCON" },
];
const vocab = [
  { source: "RFID", code: "__HO__", n: 8000 },
  { source: "RFID", code: "2320", n: 1300 },
  { source: "EDI", code: "RESCON", n: 8600 },
  { source: "EDI", code: "RESDES", n: 10000 },
];
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchEventComparisons: vi.fn().mockResolvedValue(comparisons),
  fetchComparisonEvents: vi.fn().mockResolvedValue(vocab),
  createComparison: vi.fn().mockResolvedValue(undefined),
  updateComparison: vi.fn().mockResolvedValue(undefined),
  deleteComparison: vi.fn().mockResolvedValue(undefined),
}));

import ComparisonsPage from "@/pages/ComparisonsPage";
import { createComparison, deleteComparison } from "@/lib/supabase";

describe("ComparisonsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists existing comparisons", async () => {
    render(<ComparisonsPage />);
    await waitFor(() => expect(screen.getByText("Handover → RESCON")).toBeInTheDocument());
  });

  it("creates a comparison from the add form", async () => {
    render(<ComparisonsPage />);
    await waitFor(() => expect(screen.getByText("Handover → RESCON")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add comparison" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My cmp" } });
    fireEvent.change(screen.getByLabelText("Event A"), { target: { value: "RFID|2320" } });
    fireEvent.change(screen.getByLabelText("Event B"), { target: { value: "EDI|RESDES" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(createComparison).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My cmp", a_source: "RFID", a_code: "2320", b_source: "EDI", b_code: "RESDES" }),
      expect.anything()
    ));
  });

  it("deletes a comparison", async () => {
    render(<ComparisonsPage />);
    await waitFor(() => expect(screen.getByText("Handover → RESCON")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Delete/i }));
    await waitFor(() => expect(deleteComparison).toHaveBeenCalledWith("ho_rescon", expect.anything()));
  });
});
```
Run → FAIL (page missing).

- [ ] **Step 4: Implement `ComparisonsPage.tsx`** — native `<select>` for the event pickers (value `"SOURCE|CODE"`), grouped by RFID/EDI via `<optgroup>`, labels from `eventFullLabel`. Client-generates a `comparison_key` for new rows (`crypto.randomUUID()`):
```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  supabase, fetchEventComparisons, fetchComparisonEvents,
  createComparison, updateComparison, deleteComparison,
} from "@/lib/supabase";
import { eventFullLabel, type EventComparison, type EventVocabItem } from "@/lib/eventGaps";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function token(): Promise<{ token: string } | {}> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { token: t } : {};
}

interface Draft { comparison_key: string; name: string; a: string; b: string; priority: number; }

function toDraft(c: EventComparison): Draft {
  return { comparison_key: c.comparison_key, name: c.name,
    a: `${c.a_source}|${c.a_code}`, b: `${c.b_source}|${c.b_code}`, priority: c.priority };
}
function fromDraft(d: Draft): EventComparison {
  const [a_source, a_code] = d.a.split("|");
  const [b_source, b_code] = d.b.split("|");
  return { comparison_key: d.comparison_key, name: d.name, a_source, a_code, b_source, b_code, priority: d.priority };
}

function EventSelect({ id, label, vocab, value, onChange }: {
  id: string; label: string; vocab: EventVocabItem[]; value: string; onChange: (v: string) => void;
}) {
  const rfid = vocab.filter((v) => v.source === "RFID");
  const edi = vocab.filter((v) => v.source === "EDI");
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} aria-label={label} className="border rounded h-9 px-2"
        value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        <optgroup label={strings.comparisons.rfidGroup}>
          {rfid.map((v) => <option key={v.code} value={`RFID|${v.code}`}>{eventFullLabel("RFID", v.code)}</option>)}
        </optgroup>
        <optgroup label={strings.comparisons.ediGroup}>
          {edi.map((v) => <option key={v.code} value={`EDI|${v.code}`}>{eventFullLabel("EDI", v.code)}</option>)}
        </optgroup>
      </select>
    </div>
  );
}

export default function ComparisonsPage() {
  const [rows, setRows] = useState<EventComparison[]>([]);
  const [vocab, setVocab] = useState<EventVocabItem[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await fetchEventComparisons(await token())); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let c = false;
    (async () => { try { const v = await fetchComparisonEvents(await token()); if (!c) setVocab(v); }
      catch (e) { if (!c) setError(e instanceof Error ? e.message : String(e)); } })();
    return () => { c = true; };
  }, []);

  const startAdd = () => setDraft({ comparison_key: crypto.randomUUID(), name: "", a: "", b: "",
    priority: (rows.reduce((m, r) => Math.max(m, r.priority), 0) + 1) });
  const save = async () => {
    if (!draft) return;
    const c = fromDraft(draft);
    const exists = rows.some((r) => r.comparison_key === c.comparison_key);
    try {
      if (exists) await updateComparison(c.comparison_key, c, await token());
      else await createComparison(c, await token());
      setDraft(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const remove = async (key: string) => {
    if (!window.confirm(strings.comparisons.confirmDelete)) return;
    try { await deleteComparison(key, await token()); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const sorted = useMemo(() => [...rows].sort((a, b) => a.priority - b.priority), [rows]);

  return (
    <div className="p-4 flex flex-col gap-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{strings.comparisons.title}</h2>
        <Button size="sm" onClick={startAdd}>{strings.comparisons.add}</Button>
      </div>
      {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}
      {sorted.length === 0 && <p className="text-sm text-muted-foreground">{strings.comparisons.empty}</p>}

      <ul className="flex flex-col gap-2">
        {sorted.map((c) => (
          <li key={c.comparison_key} className="flex items-center justify-between border rounded p-2">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">
                {eventFullLabel(c.a_source, c.a_code)} → {eventFullLabel(c.b_source, c.b_code)} · #{c.priority}
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => setDraft(toDraft(c))}>{strings.comparisons.edit}</Button>
              <Button size="sm" variant="outline" onClick={() => remove(c.comparison_key)}>{strings.comparisons.remove}</Button>
            </div>
          </li>
        ))}
      </ul>

      {draft && (
        <div className="border rounded p-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="cmp-name">{strings.comparisons.name}</Label>
            <Input id="cmp-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <EventSelect id="cmp-a" label={strings.comparisons.eventA} vocab={vocab}
            value={draft.a} onChange={(v) => setDraft({ ...draft, a: v })} />
          <EventSelect id="cmp-b" label={strings.comparisons.eventB} vocab={vocab}
            value={draft.b} onChange={(v) => setDraft({ ...draft, b: v })} />
          <div className="flex flex-col gap-1 w-32">
            <Label htmlFor="cmp-prio">{strings.comparisons.priority}</Label>
            <Input id="cmp-prio" type="number" value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save}
              disabled={!draft.name || !draft.a || !draft.b}>{strings.comparisons.save}</Button>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>{strings.comparisons.cancel}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire nav + route in `App.tsx`** — import `ComparisonsPage`; add a nav button after the gaps button:
```tsx
      <Button variant={route.name === "comparisons" ? "default" : "outline"} size="sm" onClick={() => go("#/comparisons")}>
        {strings.comparisons.nav}
      </Button>
```
and extend the `Gate` route switch: add `route.name === "comparisons" ? <ComparisonsPage /> :` before the `gaps` branch. In `App.test.tsx` add: `expect(screen.getByRole("button", { name: strings.comparisons.nav })).toBeInTheDocument();` (do NOT navigate to it).

- [ ] **Step 6: Full green** — `cd leg2-reporting && npx vitest run && npx tsc --noEmit && npm run build`.

- [ ] **Step 7: Commit**
```bash
git add leg2-reporting/src/pages/ComparisonsPage.tsx leg2-reporting/src/lib/hashRoute.ts leg2-reporting/src/lib/hashRoute.test.ts leg2-reporting/src/App.tsx leg2-reporting/src/App.test.tsx leg2-reporting/src/i18n/strings.ts leg2-reporting/src/pages/ComparisonsPage.test.tsx
git commit -m "feat(leg2): incr3 comparisons CRUD screen + nav"
```

---

### Task 6: Manual end-to-end verification (browser)

- [ ] Run `cd leg2-reporting && npm run dev` (or reuse the running server), sign in.
- [ ] **Comparisons** nav → the 4 seeded comparisons list. **Add** one RFID↔RFID (e.g. `2320 → 2420`) and one EDI↔EDI (e.g. `PREDES → RESDES`); Save.
- [ ] **Event gaps** → new columns appear for the added comparisons; cells show mean days; headers show the name + `A → B` code label.
- [ ] Click a cell → detail dialog; columns **Event A / Event B** with day-of-week; gate/site; S9 → ATAT.
- [ ] Back in **Comparisons**, edit a comparison's name → reflects in the matrix header after refresh; delete the two test comparisons.
- [ ] Report results (screenshots).

---

## Self-Review

**1. Spec coverage:**
- Generic model (any A vs B, RFID/EDI/__HO__) → Task 1 (SQL events CTE + generic view), Task 2 (types). ✓
- gap=B−A, no window, first occurrence → Task 1. ✓
- Shared CRUD management screen → Task 5; data fns Task 3. ✓
- Replace 4 fixed, seed as editable, keys preserved → Task 1 (guarded migration + do-nothing seed). ✓
- Vocabulary picker from real data → `vw_comparison_events` (Task 1) + `fetchComparisonEvents` (Task 3) + `EventSelect` (Task 5). ✓
- Header shows name + code label; detail labels A/B; a_utc/b_utc rename; drop colocation_valid → Tasks 3,4. ✓
- Exclusions survive for seeds; orphan on delete (accepted) → Task 1 keys preserved. ✓
- What stays same (filters, exclusion, drill-down, ATAT) → untouched by Tasks 4/5. ✓

**2. Placeholder scan:** none. `crypto.randomUUID()` is available in the browser/jsdom (Node 19+). The temp RFID↔RFID/EDI↔EDI verification rows in Task 1 Step 3 are explicitly deleted.

**3. Type consistency:** `EventComparison` generic shape defined in Task 2 and used verbatim in Tasks 3/4/5. `EventVocabItem` (Task 2) consumed in Tasks 3/5. `a_utc/b_utc` rename applied consistently in Task 3 (interface + select cols + url builder) and Task 4 (dialog + test fixtures). `comparison_key` remains the stable id across SQL, exclusion, and CRUD. RPC arg names unchanged.
```
