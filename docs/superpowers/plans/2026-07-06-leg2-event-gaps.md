# Leg2 Event-pair Gaps Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new "Days between events" screen: a matrix of mean gap-days per corridor (origin→destination) × event comparison, filtered by period + product, with a cell drill-down dialog that lists the constituent S9 pairs and lets the user permanently exclude outliers.

**Architecture:** Dynamic SQL computation (Increment 1). A Postgres view `vw_event_pair_gaps_s9` pairs the first RFID handover event with the first matching EDI event per S9 (config driven by a seed table `ref_event_comparison`); a `event_pair_matrix(...)` function aggregates to the grid; a `event_pair_exclusion` table holds permanent global exclusions. The React SPA fetches the aggregated matrix via the RPC, the per-cell detail via the view, and toggles exclusions via direct PostgREST writes. Month-end snapshots are explicitly deferred to Increment 2.

**Tech Stack:** React 19 + Vite + TypeScript + Tailwind v4 + shadcn/ui; Vitest + React Testing Library; Supabase Postgres (PostgREST + RPC); Deno edge functions (not needed here).

## Global Constraints

- **Supabase project = EDGE Leg2, ref `ubgatxfwpmyaqyfrwias`.** Before applying ANY DB write (migration / `execute_sql` / view / function / RLS / seed), name the project + ref out loud and get the user's explicit confirmation. Never infer the base. (Global CLAUDE.md rule.)
- **Trap:** the repo's `supabase/config.toml` and `.env.local` point to `ewyhmmixqcubqokphebh` (Study, legacy), NOT Leg2. Do not use the Supabase CLI/local stack for Leg2 DB work. Apply SQL via the scratchpad helper `apply.mjs` (Management API, PAT + ref pinned to Leg2).
- **Do not hardcode RFID/EDI codes in application code.** The event→code mapping lives in the seed table `ref_event_comparison` and drives both the SQL view and the frontend columns.
- **The 4 comparisons (seed, ordered by priority):** `ho_rescon` (1, handover_flag vs RESCON), `ho_resdes` (2, handover_flag vs RESDES), `ho_predes` (3, handover_flag vs PREDES), `arroe_rescon` (4, code `2420` vs RESCON).
- **RFID_400 (handover) = movement with `handover_point = true`** (not a fixed code). **RFID_ARR_OE = `edi_equivalent = '2420'`.**
- **Corridor** derived from the S9 id: `origin_office = s9[1..6]`, `dest_office = s9[7..12]`, `origin_country = s9[1..2]`, `dest_country = s9[7..12→1..2]`. Granularity toggle: Centre (6 char) ↔ Country (2 char), default Centre.
- **Metric = mean gap-days** (rounded to 2 in SQL, displayed to 1 decimal). **Pairing window = ±7 days.** `gap_days` may be negative (kept).
- **Exclusion = global** (shared data cleansing) and keyed by **`(s9code, comparison_key)`**; permanent, toggleable. Writes go direct to PostgREST (RLS `authenticated`), no edge function.
- **Product** = `edi_details.mail_category`. Null product → the sentinel category `(no product)`.
- All user-facing English text lives in `src/i18n/strings.ts`. Code references use markdown links.
- New view runs with `security_invoker = on` so base-table country RLS applies per user.

---

### Task 1: SQL data foundation (Leg2)

Creates the seed comparison table, the exclusion table + RLS, the detail view, and the aggregation function. This is the whole data layer; later tasks only read/write it.

**Files:**
- Create: `leg2-reporting/sql/event_pair_gaps.sql`
- Apply to: Leg2 `ubgatxfwpmyaqyfrwias` via `apply.mjs`

**Interfaces:**
- Produces (read by Task 4):
  - View `public.vw_event_pair_gaps_s9(s9code text, comparison_key text, origin_office text, dest_office text, origin_country text, dest_country text, product text, rfid_utc timestamptz, edi_utc timestamptz, gap_days numeric, event_month date, colocation_valid boolean, excluded boolean)`
  - Function `public.event_pair_matrix(p_from date, p_to date, p_product text, p_granularity text) returns table(origin text, destination text, comparison_key text, mean_days numeric, n int)`
  - Table `public.ref_event_comparison(comparison_key text pk, priority int, rfid_selector text, edi_messages text[], requires_colocation boolean, direction text, label text)`
  - Table `public.event_pair_exclusion(s9code text, comparison_key text, excluded_by text, excluded_at timestamptz, reason text, pk(s9code, comparison_key))`

- [ ] **Step 1: Write the SQL file**

Create `leg2-reporting/sql/event_pair_gaps.sql`:

```sql
-- Event-pair gaps (Leg2, ubgatxfwpmyaqyfrwias): days between the first RFID
-- handover (or arrival-at-OE) event and the first matching EDI event per S9.
-- Config-driven by ref_event_comparison (no hardcoded codes in app code).
-- Increment 1: dynamic. Month-end snapshots are Increment 2.

-- 1) Comparison config (seed data). The event->code mapping lives HERE.
create table if not exists public.ref_event_comparison (
  comparison_key      text primary key,
  priority            int  not null,
  rfid_selector       text not null,       -- 'handover_flag' | a 4-digit code, e.g. '2420'
  edi_messages        text[] not null,     -- e.g. {RESCON}
  requires_colocation boolean not null default false,
  direction           text not null,       -- 'rfid_first' | 'either'
  label               text not null
);

insert into public.ref_event_comparison
  (comparison_key, priority, rfid_selector, edi_messages, requires_colocation, direction, label)
values
  ('ho_rescon',    1, 'handover_flag', array['RESCON'], true,  'rfid_first', 'HO vs RESCON'),
  ('ho_resdes',    2, 'handover_flag', array['RESDES'], true,  'rfid_first', 'HO vs RESDES'),
  ('ho_predes',    3, 'handover_flag', array['PREDES'], false, 'either',     'HO vs PREDES'),
  ('arroe_rescon', 4, '2420',          array['RESCON'], true,  'rfid_first', 'ARR_OE vs RESCON')
on conflict (comparison_key) do update set
  priority            = excluded.priority,
  rfid_selector       = excluded.rfid_selector,
  edi_messages        = excluded.edi_messages,
  requires_colocation = excluded.requires_colocation,
  direction           = excluded.direction,
  label               = excluded.label;

alter table public.ref_event_comparison enable row level security;
drop policy if exists rec_read on public.ref_event_comparison;
create policy rec_read on public.ref_event_comparison
  for select to authenticated using (true);

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

-- 3) Detail view: one row per (S9, comparison) that has both anchors within ±7d.
create or replace view public.vw_event_pair_gaps_s9
with (security_invoker = on) as
with
rfid_flag as (  -- handover anchor: earliest handover_point movement per S9
  select s9_id as s9code, min(event_datetime_utc) as rfid_utc
  from public.vw_quicksight_rfid_report_movements
  where handover_point = true and event_datetime_utc is not null
  group by s9_id
),
rfid_code as (  -- code anchor: earliest movement per (S9, edi_equivalent)
  select s9_id as s9code, edi_equivalent as code, min(event_datetime_utc) as rfid_utc
  from public.vw_quicksight_rfid_report_movements
  where edi_equivalent is not null and event_datetime_utc is not null
  group by s9_id, edi_equivalent
),
edi as (        -- EDI anchor: earliest canonical-UTC event per (S9, message)
  select s9code, message, min(event_datetime_utc) as edi_utc
  from public.vw_edi_events_tz
  where event_datetime_utc is not null
  group by s9code, message
),
anchor as (     -- resolve each comparison's RFID selector to a per-S9 anchor
  select c.comparison_key, c.edi_messages, a.s9code, a.rfid_utc
  from public.ref_event_comparison c
  cross join lateral (
    select rf.s9code, rf.rfid_utc from rfid_flag rf
      where c.rfid_selector = 'handover_flag'
    union all
    select rc.s9code, rc.rfid_utc from rfid_code rc
      where c.rfid_selector = rc.code
  ) a
),
pairs as (
  select
    an.comparison_key, an.s9code, an.rfid_utc,
    (select min(e.edi_utc) from edi e
     where e.s9code = an.s9code and e.message = any(an.edi_messages)) as edi_utc
  from anchor an
)
select
  p.s9code,
  p.comparison_key,
  substr(p.s9code, 1, 6) as origin_office,
  substr(p.s9code, 7, 6) as dest_office,
  substr(p.s9code, 1, 2) as origin_country,
  substr(p.s9code, 7, 2) as dest_country,
  d.mail_category        as product,
  p.rfid_utc,
  p.edi_utc,
  round((extract(epoch from (p.edi_utc - p.rfid_utc)) / 86400.0)::numeric, 4) as gap_days,
  date_trunc('month', p.rfid_utc)::date as event_month,
  true as colocation_valid,  -- v1 stub: computed-not-enforced; reserved for the colocation increment
  (x.s9code is not null) as excluded
from pairs p
left join public.edi_details d on d.s9code = p.s9code
left join public.event_pair_exclusion x
  on x.s9code = p.s9code and x.comparison_key = p.comparison_key
where p.edi_utc is not null
  and p.edi_utc between p.rfid_utc - interval '7 days' and p.rfid_utc + interval '7 days';

-- 4) Aggregation to the grid. security invoker -> country RLS on base data applies.
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
    and g.rfid_utc::date between p_from and p_to
    and (
      p_product = 'all'
      or (p_product = '__none__' and g.product is null)
      or g.product = p_product
    )
  group by 1, 2, g.comparison_key
$$;

grant execute on function public.event_pair_matrix(date, date, text, text) to authenticated;
```

- [ ] **Step 2: Get explicit confirmation, then apply to Leg2**

Tell the user verbatim: "Voy a aplicar `event_pair_gaps.sql` (2 tablas + seed + vista + función + RLS) a **EDGE Leg2, ref `ubgatxfwpmyaqyfrwias`**. ¿Confirmas?" Wait for an explicit yes.

Then run (from the scratchpad dir):
```bash
node apply.mjs "c:/Users/fernandezi/projects/EDGE/leg2-reporting/sql/event_pair_gaps.sql"
```
Expected: `HTTP 200` and a JSON body (usually `[]` for DDL).

- [ ] **Step 3: Verify with read-only queries**

Run each via `node q.mjs "<sql>"` and confirm:

```sql
select count(*) from ref_event_comparison;
```
Expected: `4`.

```sql
select comparison_key, count(*) n, round(avg(gap_days),2) avg_gap
from vw_event_pair_gaps_s9 group by comparison_key order by comparison_key;
```
Expected: 4 rows (`arroe_rescon`, `ho_predes`, `ho_rescon`, `ho_resdes`) each with `n > 0`.

```sql
select * from event_pair_matrix('2026-01-01','2026-12-31','all','country') order by n desc limit 5;
```
Expected: rows with 2-char `origin`/`destination` (e.g. `IN`/`JP`), a `comparison_key`, numeric `mean_days`, integer `n`.

```sql
select * from event_pair_matrix('2026-01-01','2026-12-31','all','centre') order by n desc limit 3;
```
Expected: 6-char `origin`/`destination` (e.g. `INBOMB`/`JPTYOA`).

- [ ] **Step 4: Commit**

```bash
git add leg2-reporting/sql/event_pair_gaps.sql
git commit -m "feat(leg2): event-pair gaps SQL foundation (view + matrix fn + exclusion)"
```

---

### Task 2: `gaps` route

**Files:**
- Modify: `leg2-reporting/src/lib/hashRoute.ts`
- Test: `leg2-reporting/src/lib/hashRoute.test.ts`

**Interfaces:**
- Produces (read by Tasks 9): `Route` now includes `{ name: "gaps" }`; `gapsHash()` returns `"#/gaps"`.

- [ ] **Step 1: Write the failing test**

Append to `leg2-reporting/src/lib/hashRoute.test.ts`:

```ts
import { gapsHash } from "@/lib/hashRoute";

describe("gaps route", () => {
  it("parses #/gaps to the gaps route", () => {
    expect(parseHash("#/gaps")).toEqual({ name: "gaps" });
  });
  it("gapsHash builds the hash", () => {
    expect(gapsHash()).toBe("#/gaps");
  });
  it("keeps #/receptacle working", () => {
    expect(parseHash("#/receptacle/ABC")).toEqual({ name: "receptacle", s9: "ABC" });
  });
});
```
(If `hashRoute.test.ts` does not import `parseHash` at the top, add `import { parseHash } from "@/lib/hashRoute";`.)

- [ ] **Step 2: Run it, verify it fails**

Run: `cd leg2-reporting && npx vitest run src/lib/hashRoute.test.ts`
Expected: FAIL — `gapsHash` is not exported / gaps route not parsed.

- [ ] **Step 3: Implement**

Replace `leg2-reporting/src/lib/hashRoute.ts` with:

```ts
export type Route =
  | { name: "report" }
  | { name: "receptacle"; s9: string }
  | { name: "gaps" };

const RECEPTACLE_RE = /^#\/receptacle(?:\/(.*))?$/;
const GAPS_RE = /^#\/gaps\b/;

export function parseHash(hash: string): Route {
  const m = RECEPTACLE_RE.exec(hash);
  if (m) {
    const s9 = decodeURIComponent(m[1] ?? "").trim();
    return { name: "receptacle", s9 };
  }
  if (GAPS_RE.test(hash)) return { name: "gaps" };
  return { name: "report" };
}

export function receptacleHash(s9: string): string {
  return `#/receptacle/${encodeURIComponent(s9.trim())}`;
}

export function gapsHash(): string {
  return "#/gaps";
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd leg2-reporting && npx vitest run src/lib/hashRoute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/hashRoute.ts leg2-reporting/src/lib/hashRoute.test.ts
git commit -m "feat(leg2): add #/gaps route"
```

---

### Task 3: Pure helpers `lib/eventGaps.ts`

Types + matrix pivot + formatting + product sentinels. No I/O.

**Files:**
- Create: `leg2-reporting/src/lib/eventGaps.ts`
- Test: `leg2-reporting/src/lib/eventGaps.test.ts`

**Interfaces:**
- Produces (read by Tasks 4, 6, 7, 8):
  - `type Granularity = "centre" | "country"`
  - `const PRODUCT_ALL = "all"`, `const PRODUCT_NONE = "__none__"`
  - `interface EventComparison { comparison_key: string; priority: number; label: string }`
  - `interface EventPairMatrixRow { origin: string; destination: string; comparison_key: string; mean_days: number; n: number }`
  - `interface CorridorRow { origin: string; destination: string; cells: Record<string, { mean_days: number; n: number } | undefined> }`
  - `function pivotMatrix(rows: EventPairMatrixRow[]): CorridorRow[]`
  - `function formatGapDays(v: number | null | undefined): string`

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/lib/eventGaps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pivotMatrix, formatGapDays, type EventPairMatrixRow } from "@/lib/eventGaps";

const rows: EventPairMatrixRow[] = [
  { origin: "IN", destination: "JP", comparison_key: "ho_rescon", mean_days: 3.2, n: 10 },
  { origin: "IN", destination: "JP", comparison_key: "ho_resdes", mean_days: 4.1, n: 8 },
  { origin: "IN", destination: "GB", comparison_key: "ho_rescon", mean_days: 2.1, n: 5 },
];

describe("pivotMatrix", () => {
  it("groups rows into one corridor row per origin/destination with per-comparison cells", () => {
    const out = pivotMatrix(rows);
    expect(out).toHaveLength(2);
    const injp = out.find((r) => r.origin === "IN" && r.destination === "JP")!;
    expect(injp.cells.ho_rescon).toEqual({ mean_days: 3.2, n: 10 });
    expect(injp.cells.ho_resdes).toEqual({ mean_days: 4.1, n: 8 });
    expect(injp.cells.ho_predes).toBeUndefined();
  });
  it("sorts corridors alphabetically by origin then destination", () => {
    const out = pivotMatrix(rows);
    expect(out.map((r) => `${r.origin}-${r.destination}`)).toEqual(["IN-GB", "IN-JP"]);
  });
});

describe("formatGapDays", () => {
  it("formats to 1 decimal", () => {
    expect(formatGapDays(3.25)).toBe("3.3");
    expect(formatGapDays(-0.5)).toBe("-0.5");
  });
  it("returns em-dash for null/undefined/NaN", () => {
    expect(formatGapDays(null)).toBe("—");
    expect(formatGapDays(undefined)).toBe("—");
    expect(formatGapDays(NaN)).toBe("—");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd leg2-reporting && npx vitest run src/lib/eventGaps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `leg2-reporting/src/lib/eventGaps.ts`:

```ts
// Pure helpers for the Event-pair gaps screen. No I/O.

export type Granularity = "centre" | "country";

// Product filter sentinels. PRODUCT_ALL = every product; PRODUCT_NONE = rows
// whose edi_details.mail_category is NULL. Any other value is a real category.
export const PRODUCT_ALL = "all";
export const PRODUCT_NONE = "__none__";

// A comparison column, sourced from ref_event_comparison (never hardcoded).
export interface EventComparison {
  comparison_key: string;
  priority: number;
  label: string;
}

// One aggregated row returned by the event_pair_matrix RPC.
export interface EventPairMatrixRow {
  origin: string;
  destination: string;
  comparison_key: string;
  mean_days: number;
  n: number;
}

// A corridor pivoted across comparisons: cells keyed by comparison_key.
export interface CorridorRow {
  origin: string;
  destination: string;
  cells: Record<string, { mean_days: number; n: number } | undefined>;
}

export function pivotMatrix(rows: EventPairMatrixRow[]): CorridorRow[] {
  const byCorridor = new Map<string, CorridorRow>();
  for (const r of rows) {
    const key = `${r.origin} ${r.destination}`;
    let row = byCorridor.get(key);
    if (!row) {
      row = { origin: r.origin, destination: r.destination, cells: {} };
      byCorridor.set(key, row);
    }
    row.cells[r.comparison_key] = { mean_days: r.mean_days, n: r.n };
  }
  return [...byCorridor.values()].sort((a, b) =>
    a.origin === b.origin
      ? a.destination.localeCompare(b.destination)
      : a.origin.localeCompare(b.origin)
  );
}

export function formatGapDays(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(1);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd leg2-reporting && npx vitest run src/lib/eventGaps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/eventGaps.ts leg2-reporting/src/lib/eventGaps.test.ts
git commit -m "feat(leg2): eventGaps pure helpers (pivot + format)"
```

---

### Task 4: Data functions in `lib/supabase.ts`

Fetch comparisons, fetch matrix (RPC), fetch cell detail (view), toggle exclusion (PostgREST write). Pure URL/body builders are tested; network functions wrap them.

**Files:**
- Modify: `leg2-reporting/src/lib/supabase.ts` (append at end)
- Test: `leg2-reporting/src/lib/eventGapsApi.test.ts`

**Interfaces:**
- Consumes (Task 3): `Granularity`, `PRODUCT_ALL`, `PRODUCT_NONE`, `EventComparison`, `EventPairMatrixRow`.
- Produces (read by Task 8):
  - `interface EventPairDetailRow { s9code; comparison_key; origin_office; dest_office; origin_country; dest_country; product: string | null; rfid_utc; edi_utc; gap_days: number; colocation_valid: boolean; excluded: boolean }`
  - `interface EventPairMatrixParams { from: string; to: string; product: string; granularity: Granularity }`
  - `interface EventPairDetailParams { origin; destination; comparisonKey; product; from; to; granularity }`
  - `buildEventPairMatrixBody(p: EventPairMatrixParams): Record<string, unknown>`
  - `buildEventPairDetailUrl(baseUrl, opts): string`
  - `buildExclusionDeleteUrl(baseUrl, s9code, comparisonKey): string`
  - `fetchEventComparisons(deps?): Promise<EventComparison[]>`
  - `fetchEventPairMatrix(params, deps?): Promise<EventPairMatrixRow[]>`
  - `fetchEventPairDetail(params, deps?): Promise<EventPairDetailRow[]>`
  - `setEventPairExclusion(args: { s9code; comparisonKey; excluded; excludedBy }, deps?): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/lib/eventGapsApi.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildEventPairMatrixBody,
  buildEventPairDetailUrl,
  buildExclusionDeleteUrl,
} from "@/lib/supabase";

describe("buildEventPairMatrixBody", () => {
  it("maps params to RPC arg names", () => {
    expect(
      buildEventPairMatrixBody({ from: "2026-01-01", to: "2026-03-31", product: "A", granularity: "country" })
    ).toEqual({ p_from: "2026-01-01", p_to: "2026-03-31", p_product: "A", p_granularity: "country" });
  });
});

describe("buildEventPairDetailUrl", () => {
  const base = "https://x.supabase.co/rest/v1/vw_event_pair_gaps_s9";
  it("filters by 6-char office columns when granularity=centre", () => {
    const u = buildEventPairDetailUrl(base, {
      origin: "INBOMB", destination: "JPTYOA", comparisonKey: "ho_rescon",
      product: "all", from: "2026-01-01", to: "2026-03-31", granularity: "centre",
      offset: 0, limit: 1000,
    });
    expect(u).toContain("origin_office=eq.INBOMB");
    expect(u).toContain("dest_office=eq.JPTYOA");
    expect(u).toContain("comparison_key=eq.ho_rescon");
    expect(u).not.toContain("product="); // 'all' -> no product filter
  });
  it("filters by 2-char country columns when granularity=country", () => {
    const u = buildEventPairDetailUrl(base, {
      origin: "IN", destination: "JP", comparisonKey: "ho_rescon",
      product: "__none__", from: "2026-01-01", to: "2026-03-31", granularity: "country",
      offset: 0, limit: 1000,
    });
    expect(u).toContain("origin_country=eq.IN");
    expect(u).toContain("dest_country=eq.JP");
    expect(u).toContain("product=is.null"); // __none__ -> null products
  });
  it("filters by explicit product and by rfid_utc range", () => {
    const u = buildEventPairDetailUrl(base, {
      origin: "IN", destination: "JP", comparisonKey: "ho_rescon",
      product: "A", from: "2026-01-01", to: "2026-03-31", granularity: "country",
      offset: 0, limit: 1000,
    });
    expect(u).toContain("product=eq.A");
    expect(decodeURIComponent(u)).toContain("rfid_utc=gte.2026-01-01T00:00:00");
    expect(decodeURIComponent(u)).toContain("rfid_utc=lte.2026-03-31T23:59:59");
  });
});

describe("buildExclusionDeleteUrl", () => {
  it("builds a filtered DELETE url", () => {
    const u = buildExclusionDeleteUrl(
      "https://x.supabase.co/rest/v1/event_pair_exclusion", "S9X", "ho_rescon"
    );
    expect(u).toContain("s9code=eq.S9X");
    expect(u).toContain("comparison_key=eq.ho_rescon");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd leg2-reporting && npx vitest run src/lib/eventGapsApi.test.ts`
Expected: FAIL — builders not exported.

- [ ] **Step 3: Implement**

Append to `leg2-reporting/src/lib/supabase.ts`:

```ts
// ── Event-pair gaps ────────────────────────────────────────────────────────
import {
  PRODUCT_ALL, PRODUCT_NONE,
  type Granularity, type EventComparison, type EventPairMatrixRow,
} from "@/lib/eventGaps";

export interface EventPairDetailRow {
  s9code: string;
  comparison_key: string;
  origin_office: string;
  dest_office: string;
  origin_country: string;
  dest_country: string;
  product: string | null;
  rfid_utc: string;
  edi_utc: string;
  gap_days: number;
  colocation_valid: boolean;
  excluded: boolean;
}

export interface EventPairMatrixParams {
  from: string;
  to: string;
  product: string;     // PRODUCT_ALL | PRODUCT_NONE | a mail_category
  granularity: Granularity;
}

export interface EventPairDetailParams {
  origin: string;
  destination: string;
  comparisonKey: string;
  product: string;
  from: string;
  to: string;
  granularity: Granularity;
}

const REF_COMPARISON_VIEW = "ref_event_comparison";
const EVENT_PAIR_MATRIX_RPC = "event_pair_matrix";
const EVENT_PAIR_GAPS_VIEW = "vw_event_pair_gaps_s9";
const EVENT_PAIR_EXCLUSION_TABLE = "event_pair_exclusion";

const EVENT_PAIR_DETAIL_SELECT_COLS = [
  "s9code", "comparison_key", "origin_office", "dest_office",
  "origin_country", "dest_country", "product", "rfid_utc", "edi_utc",
  "gap_days", "colocation_valid", "excluded",
].join(",");

export function buildEventPairMatrixBody(p: EventPairMatrixParams): Record<string, unknown> {
  return { p_from: p.from, p_to: p.to, p_product: p.product, p_granularity: p.granularity };
}

export function buildEventPairDetailUrl(
  baseUrl: string,
  opts: EventPairDetailParams & { offset: number; limit: number }
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", EVENT_PAIR_DETAIL_SELECT_COLS);
  url.searchParams.set("comparison_key", `eq.${opts.comparisonKey}`);
  const originCol = opts.granularity === "country" ? "origin_country" : "origin_office";
  const destCol = opts.granularity === "country" ? "dest_country" : "dest_office";
  url.searchParams.set(originCol, `eq.${opts.origin}`);
  url.searchParams.set(destCol, `eq.${opts.destination}`);
  if (opts.product === PRODUCT_NONE) {
    url.searchParams.set("product", "is.null");
  } else if (opts.product !== PRODUCT_ALL) {
    url.searchParams.set("product", `eq.${opts.product}`);
  }
  url.searchParams.append("rfid_utc", `gte.${opts.from}T00:00:00`);
  url.searchParams.append("rfid_utc", `lte.${opts.to}T23:59:59`);
  url.searchParams.set("order", "gap_days.desc");
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("limit", String(opts.limit));
  return url.toString();
}

export function buildExclusionDeleteUrl(baseUrl: string, s9code: string, comparisonKey: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("s9code", `eq.${s9code}`);
  url.searchParams.set("comparison_key", `eq.${comparisonKey}`);
  return url.toString();
}

export async function fetchEventComparisons(deps: FetchDeps = {}): Promise<EventComparison[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${REF_COMPARISON_VIEW}`;
  const url = new URL(baseUrl);
  url.searchParams.set("select", "comparison_key,priority,label");
  url.searchParams.set("order", "priority");
  const res = await fetchFn(url.toString(), { headers });
  if (!res.ok) throw new Error(`Leg2 comparisons fetch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as EventComparison[];
}

export async function fetchEventPairMatrix(
  params: EventPairMatrixParams, deps: FetchDeps = {}
): Promise<EventPairMatrixRow[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/rpc/${EVENT_PAIR_MATRIX_RPC}`;
  const res = await fetchFn(baseUrl, {
    method: "POST", headers, body: JSON.stringify(buildEventPairMatrixBody(params)),
  });
  if (!res.ok) throw new Error(`Leg2 event_pair_matrix failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as EventPairMatrixRow[];
}

export async function fetchEventPairDetail(
  params: EventPairDetailParams, deps: FetchDeps = {}
): Promise<EventPairDetailRow[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${EVENT_PAIR_GAPS_VIEW}`;
  return fetchAllPages<EventPairDetailRow>(
    (offset, limit) => buildEventPairDetailUrl(baseUrl, { ...params, offset, limit }),
    fetchFn, headers, "Leg2 event_pair detail fetch"
  );
}

export async function setEventPairExclusion(
  args: { s9code: string; comparisonKey: string; excluded: boolean; excludedBy: string },
  deps: FetchDeps = {}
): Promise<void> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${EVENT_PAIR_EXCLUSION_TABLE}`;
  if (args.excluded) {
    const res = await fetchFn(baseUrl, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        s9code: args.s9code, comparison_key: args.comparisonKey, excluded_by: args.excludedBy,
      }),
    });
    if (!res.ok) throw new Error(`Leg2 exclusion insert failed: ${res.status} ${await res.text()}`);
  } else {
    const url = buildExclusionDeleteUrl(baseUrl, args.s9code, args.comparisonKey);
    const res = await fetchFn(url, { method: "DELETE", headers });
    if (!res.ok) throw new Error(`Leg2 exclusion delete failed: ${res.status} ${await res.text()}`);
  }
}
```

Note: the `import { ... } from "@/lib/eventGaps"` line must go at the TOP of `supabase.ts` with the other imports, not mid-file — move it up when implementing. `PRODUCT_ALL`/`PRODUCT_NONE`/`EventComparison` are used above; keep them imported.

- [ ] **Step 4: Run tests, verify pass**

Run: `cd leg2-reporting && npx vitest run src/lib/eventGapsApi.test.ts`
Expected: PASS. Also run `npx tsc --noEmit` — expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/supabase.ts leg2-reporting/src/lib/eventGapsApi.test.ts
git commit -m "feat(leg2): event-pair gaps data functions (matrix rpc, detail, exclusion)"
```

---

### Task 5: Strings + `EventGapsFilters` component

**Files:**
- Modify: `leg2-reporting/src/i18n/strings.ts` (add `gaps` block)
- Create: `leg2-reporting/src/components/EventGapsFilters.tsx`
- Test: `leg2-reporting/src/components/EventGapsFilters.test.tsx`

**Interfaces:**
- Consumes (Task 3): `Granularity`, `PRODUCT_ALL`, `PRODUCT_NONE`.
- Produces (read by Task 9):
  - `interface EventGapsFiltersProps { dateRange: DateRange; onDateChange: (r: DateRange) => void; onApplyPreset: (p: DatePreset) => void; product: string; onProductChange: (p: string) => void; productOptions: string[]; granularity: Granularity; onGranularityChange: (g: Granularity) => void; }`
  - Component `EventGapsFilters(props): JSX.Element`

- [ ] **Step 1: Add strings**

In `leg2-reporting/src/i18n/strings.ts`, add a `gaps` key inside the top-level `strings` object (e.g. after the `settings` block):

```ts
  gaps: {
    nav: "Event gaps",
    title: "Days between events",
    product: "Product",
    allProducts: "All products",
    noProduct: "(no product)",
    granularity: "Granularity",
    granularityCentre: "Centre",
    granularityCountry: "Country",
    corridor: "Corridor",
    pairs: "pairs",
    detailTitle: "Pairs",
    exclude: "Exclude",
    excluded: "Excluded",
    colS9: "S9",
    colProduct: "Product",
    colRfid: "RFID (handover)",
    colEdi: "EDI",
    colGap: "Gap (days)",
    noRows: "No pairs for this filter.",
  },
```

- [ ] **Step 2: Write the failing test**

Create `leg2-reporting/src/components/EventGapsFilters.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventGapsFilters } from "@/components/EventGapsFilters";

function setup(over: Partial<React.ComponentProps<typeof EventGapsFilters>> = {}) {
  const props = {
    dateRange: { from: "2026-01-01", to: "2026-03-31" },
    onDateChange: vi.fn(),
    onApplyPreset: vi.fn(),
    product: "all",
    onProductChange: vi.fn(),
    productOptions: ["A", "B"],
    granularity: "centre" as const,
    onGranularityChange: vi.fn(),
    ...over,
  };
  render(<EventGapsFilters {...props} />);
  return props;
}

describe("EventGapsFilters", () => {
  it("renders the date inputs with the current range", () => {
    setup();
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-01-01");
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("2026-03-31");
  });
  it("toggles granularity to country", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Country" }));
    expect(props.onGranularityChange).toHaveBeenCalledWith("country");
  });
  it("emits a date change when From is edited", () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-02-01" } });
    expect(props.onDateChange).toHaveBeenCalledWith({ from: "2026-02-01", to: "2026-03-31" });
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsFilters.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 4: Implement**

Create `leg2-reporting/src/components/EventGapsFilters.tsx`:

```tsx
import { PRESET_ORDER, type DateRange, type DatePreset } from "@/lib/datePresets";
import { PRODUCT_ALL, PRODUCT_NONE, type Granularity } from "@/lib/eventGaps";
import { strings } from "@/i18n/strings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export interface EventGapsFiltersProps {
  dateRange: DateRange;
  onDateChange: (r: DateRange) => void;
  onApplyPreset: (p: DatePreset) => void;
  product: string;
  onProductChange: (p: string) => void;
  productOptions: string[];
  granularity: Granularity;
  onGranularityChange: (g: Granularity) => void;
}

export function EventGapsFilters({
  dateRange, onDateChange, onApplyPreset,
  product, onProductChange, productOptions,
  granularity, onGranularityChange,
}: EventGapsFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="gaps-from">{strings.filters.from}</Label>
        <Input id="gaps-from" type="date" value={dateRange.from}
          onChange={(e) => onDateChange({ ...dateRange, from: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="gaps-to">{strings.filters.to}</Label>
        <Input id="gaps-to" type="date" value={dateRange.to}
          onChange={(e) => onDateChange({ ...dateRange, to: e.target.value })} />
      </div>
      <div className="flex items-end gap-2">
        {PRESET_ORDER.map((p) => (
          <Button key={p} type="button" variant="outline" size="sm" onClick={() => onApplyPreset(p)}>
            {strings.datePresets[p]}
          </Button>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <Label>{strings.gaps.product}</Label>
        <Select value={product} onValueChange={onProductChange}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={PRODUCT_ALL}>{strings.gaps.allProducts}</SelectItem>
            <SelectItem value={PRODUCT_NONE}>{strings.gaps.noProduct}</SelectItem>
            {productOptions.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label>{strings.gaps.granularity}</Label>
        <div className="flex gap-1">
          <Button type="button" size="sm"
            variant={granularity === "centre" ? "default" : "outline"}
            onClick={() => onGranularityChange("centre")}>
            {strings.gaps.granularityCentre}
          </Button>
          <Button type="button" size="sm"
            variant={granularity === "country" ? "default" : "outline"}
            onClick={() => onGranularityChange("country")}>
            {strings.gaps.granularityCountry}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsFilters.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/i18n/strings.ts leg2-reporting/src/components/EventGapsFilters.tsx leg2-reporting/src/components/EventGapsFilters.test.tsx
git commit -m "feat(leg2): event gaps filters (period, product, granularity)"
```

---

### Task 6: `EventGapsMatrix` component

**Files:**
- Create: `leg2-reporting/src/components/EventGapsMatrix.tsx`
- Test: `leg2-reporting/src/components/EventGapsMatrix.test.tsx`

**Interfaces:**
- Consumes (Task 3): `CorridorRow`, `EventComparison`, `formatGapDays`.
- Produces (read by Task 9):
  - `interface EventGapsMatrixProps { comparisons: EventComparison[]; rows: CorridorRow[]; onSelectCell: (corridor: { origin: string; destination: string }, comparisonKey: string) => void; }`
  - Component `EventGapsMatrix(props): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/components/EventGapsMatrix.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventGapsMatrix } from "@/components/EventGapsMatrix";
import type { CorridorRow, EventComparison } from "@/lib/eventGaps";

const comparisons: EventComparison[] = [
  { comparison_key: "ho_rescon", priority: 1, label: "HO vs RESCON" },
  { comparison_key: "ho_resdes", priority: 2, label: "HO vs RESDES" },
];
const rows: CorridorRow[] = [
  { origin: "IN", destination: "JP", cells: { ho_rescon: { mean_days: 3.25, n: 10 } } },
];

describe("EventGapsMatrix", () => {
  it("renders a column per comparison and the corridor rows", () => {
    render(<EventGapsMatrix comparisons={comparisons} rows={rows} onSelectCell={() => {}} />);
    expect(screen.getByText("HO vs RESCON")).toBeInTheDocument();
    expect(screen.getByText("HO vs RESDES")).toBeInTheDocument();
    expect(screen.getByText("IN → JP")).toBeInTheDocument();
    expect(screen.getByText("3.3")).toBeInTheDocument(); // mean_days 1-dp
  });
  it("shows an em-dash for a missing cell", () => {
    render(<EventGapsMatrix comparisons={comparisons} rows={rows} onSelectCell={() => {}} />);
    expect(screen.getByText("—")).toBeInTheDocument(); // ho_resdes empty for IN→JP
  });
  it("fires onSelectCell with corridor + comparison when a populated cell is clicked", () => {
    const onSel = vi.fn();
    render(<EventGapsMatrix comparisons={comparisons} rows={rows} onSelectCell={onSel} />);
    fireEvent.click(screen.getByText("3.3"));
    expect(onSel).toHaveBeenCalledWith({ origin: "IN", destination: "JP" }, "ho_rescon");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsMatrix.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

Create `leg2-reporting/src/components/EventGapsMatrix.tsx`:

```tsx
import { formatGapDays, type CorridorRow, type EventComparison } from "@/lib/eventGaps";
import { strings } from "@/i18n/strings";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export interface EventGapsMatrixProps {
  comparisons: EventComparison[];
  rows: CorridorRow[];
  onSelectCell: (corridor: { origin: string; destination: string }, comparisonKey: string) => void;
}

export function EventGapsMatrix({ comparisons, rows, onSelectCell }: EventGapsMatrixProps) {
  if (rows.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{strings.gaps.noRows}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 top-0 z-30 bg-background border-r">
            {strings.gaps.corridor}
          </TableHead>
          {comparisons.map((c) => (
            <TableHead key={c.comparison_key} className="sticky top-0 z-20 bg-background" title={c.label}>
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.origin}-${row.destination}`}>
            <TableCell className="sticky left-0 z-10 bg-background border-r font-mono text-sm">
              {row.origin} → {row.destination}
            </TableCell>
            {comparisons.map((c) => {
              const cell = row.cells[c.comparison_key];
              if (!cell) {
                return <TableCell key={c.comparison_key} className="text-muted-foreground">—</TableCell>;
              }
              return (
                <TableCell key={c.comparison_key}>
                  <button
                    type="button"
                    className="text-blue-700 underline font-semibold"
                    onClick={() => onSelectCell({ origin: row.origin, destination: row.destination }, c.comparison_key)}
                  >
                    {formatGapDays(cell.mean_days)}
                  </button>
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {cell.n} {strings.gaps.pairs}
                  </span>
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsMatrix.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/components/EventGapsMatrix.tsx leg2-reporting/src/components/EventGapsMatrix.test.tsx
git commit -m "feat(leg2): event gaps matrix component"
```

---

### Task 7: `EventGapsDetailDialog` component

Lists the S9 pairs behind a cell; each row has an Exclude checkbox that calls back. Excluded rows render struck-through. This component is presentational — the parent (Task 9) owns fetching and the write call.

**Files:**
- Create: `leg2-reporting/src/components/EventGapsDetailDialog.tsx`
- Test: `leg2-reporting/src/components/EventGapsDetailDialog.test.tsx`

**Interfaces:**
- Consumes (Task 4): `EventPairDetailRow`.
- Produces (read by Task 9):
  - `interface EventGapsDetailDialogProps { open: boolean; onOpenChange: (o: boolean) => void; title: string; rows: EventPairDetailRow[]; loading: boolean; onToggleExclude: (row: EventPairDetailRow, excluded: boolean) => void; }`
  - Component `EventGapsDetailDialog(props): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/components/EventGapsDetailDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventGapsDetailDialog } from "@/components/EventGapsDetailDialog";
import type { EventPairDetailRow } from "@/lib/supabase";

const rows: EventPairDetailRow[] = [
  {
    s9code: "INBOMBJPTYOAAEM60760004100101", comparison_key: "ho_rescon",
    origin_office: "INBOMB", dest_office: "JPTYOA", origin_country: "IN", dest_country: "JP",
    product: "A", rfid_utc: "2026-02-01T10:00:00+00:00", edi_utc: "2026-02-04T12:00:00+00:00",
    gap_days: 3.08, colocation_valid: true, excluded: false,
  },
  {
    s9code: "INBOMBJPTYOAAEM60760004100102", comparison_key: "ho_rescon",
    origin_office: "INBOMB", dest_office: "JPTYOA", origin_country: "IN", dest_country: "JP",
    product: "A", rfid_utc: "2026-02-02T10:00:00+00:00", edi_utc: "2026-02-20T12:00:00+00:00",
    gap_days: 18.08, colocation_valid: true, excluded: true,
  },
];

describe("EventGapsDetailDialog", () => {
  it("renders a row per pair with its gap", () => {
    render(<EventGapsDetailDialog open title="IN → JP" rows={rows} loading={false}
      onOpenChange={() => {}} onToggleExclude={() => {}} />);
    expect(screen.getByText("INBOMBJPTYOAAEM60760004100101")).toBeInTheDocument();
    expect(screen.getByText("3.1")).toBeInTheDocument();
  });
  it("checks the box for an already-excluded row", () => {
    render(<EventGapsDetailDialog open title="IN → JP" rows={rows} loading={false}
      onOpenChange={() => {}} onToggleExclude={() => {}} />);
    const boxes = screen.getAllByRole("checkbox");
    expect((boxes[0] as HTMLInputElement).checked).toBe(false);
    expect((boxes[1] as HTMLInputElement).checked).toBe(true);
  });
  it("calls onToggleExclude with the row and the new state", () => {
    const onToggle = vi.fn();
    render(<EventGapsDetailDialog open title="IN → JP" rows={rows} loading={false}
      onOpenChange={() => {}} onToggleExclude={onToggle} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith(rows[0], true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsDetailDialog.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

Create `leg2-reporting/src/components/EventGapsDetailDialog.tsx`:

```tsx
import type { EventPairDetailRow } from "@/lib/supabase";
import { formatGapDays } from "@/lib/eventGaps";
import { strings } from "@/i18n/strings";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export interface EventGapsDetailDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  rows: EventPairDetailRow[];
  loading: boolean;
  onToggleExclude: (row: EventPairDetailRow, excluded: boolean) => void;
}

function utcMinute(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

export function EventGapsDetailDialog({
  open, onOpenChange, title, rows, loading, onToggleExclude,
}: EventGapsDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{strings.gaps.detailTitle} — {title}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">{strings.states.loading}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.gaps.noRows}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{strings.gaps.colS9}</TableHead>
                <TableHead>{strings.gaps.colProduct}</TableHead>
                <TableHead>{strings.gaps.colRfid}</TableHead>
                <TableHead>{strings.gaps.colEdi}</TableHead>
                <TableHead className="text-right">{strings.gaps.colGap}</TableHead>
                <TableHead className="text-center">{strings.gaps.exclude}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.s9code} className={cn(r.excluded && "line-through opacity-60")}>
                  <TableCell className="font-mono text-xs">{r.s9code}</TableCell>
                  <TableCell>{r.product ?? strings.gaps.noProduct}</TableCell>
                  <TableCell className="font-mono text-xs">{utcMinute(r.rfid_utc)}</TableCell>
                  <TableCell className="font-mono text-xs">{utcMinute(r.edi_utc)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatGapDays(r.gap_days)}</TableCell>
                  <TableCell className="text-center">
                    <input
                      type="checkbox"
                      aria-label={`${strings.gaps.exclude} ${r.s9code}`}
                      checked={r.excluded}
                      onChange={(e) => onToggleExclude(r, e.target.checked)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsDetailDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/components/EventGapsDetailDialog.tsx leg2-reporting/src/components/EventGapsDetailDialog.test.tsx
git commit -m "feat(leg2): event gaps detail dialog with exclusion toggle"
```

---

### Task 8: `useEventGaps` hook

Owns filter state, loads comparisons once, loads the matrix on filter change, derives product options, and exposes the pivoted rows.

**Files:**
- Create: `leg2-reporting/src/hooks/useEventGaps.ts`
- Test: `leg2-reporting/src/hooks/useEventGaps.test.tsx`

**Interfaces:**
- Consumes (Tasks 3, 4): `Granularity`, `PRODUCT_ALL`, `pivotMatrix`, `fetchEventComparisons`, `fetchEventPairMatrix`.
- Produces (read by Task 9): a hook returning
  `{ loading, error, comparisons, rows, dateRange, setDateRange, applyPreset, product, setProduct, granularity, setGranularity, reload }`
  where `rows: CorridorRow[]`, `comparisons: EventComparison[]`.

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/hooks/useEventGaps.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const comparisons = [{ comparison_key: "ho_rescon", priority: 1, label: "HO vs RESCON" }];
const matrix = [{ origin: "IN", destination: "JP", comparison_key: "ho_rescon", mean_days: 3.2, n: 4 }];

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchEventComparisons: vi.fn().mockResolvedValue(comparisons),
  fetchEventPairMatrix: vi.fn().mockResolvedValue(matrix),
}));

import { useEventGaps } from "@/hooks/useEventGaps";
import { fetchEventPairMatrix } from "@/lib/supabase";

describe("useEventGaps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads comparisons and the pivoted matrix", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.comparisons).toHaveLength(1);
    expect(result.current.rows[0]).toMatchObject({ origin: "IN", destination: "JP" });
    expect(result.current.rows[0].cells.ho_rescon).toEqual({ mean_days: 3.2, n: 4 });
  });

  it("refetches the matrix when granularity changes", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    (fetchEventPairMatrix as any).mockClear();
    act(() => result.current.setGranularity("country"));
    await waitFor(() =>
      expect(fetchEventPairMatrix).toHaveBeenCalledWith(
        expect.objectContaining({ granularity: "country" }),
        expect.anything()
      )
    );
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd leg2-reporting && npx vitest run src/hooks/useEventGaps.test.tsx`
Expected: FAIL — hook not found.

- [ ] **Step 3: Implement**

Create `leg2-reporting/src/hooks/useEventGaps.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  supabase, fetchEventComparisons, fetchEventPairMatrix,
} from "@/lib/supabase";
import {
  pivotMatrix, PRODUCT_ALL,
  type Granularity, type EventComparison, type EventPairMatrixRow, type CorridorRow,
} from "@/lib/eventGaps";
import { presetRange, type DateRange, type DatePreset } from "@/lib/datePresets";

export function useEventGaps() {
  const [comparisons, setComparisons] = useState<EventComparison[]>([]);
  const [matrix, setMatrix] = useState<EventPairMatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>(() => presetRange("last90Days"));
  const [product, setProduct] = useState<string>(PRODUCT_ALL);
  const [granularity, setGranularity] = useState<Granularity>("centre");

  async function token(): Promise<{ token: string } | {}> {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    return t ? { token: t } : {};
  }

  // Comparisons load once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await fetchEventComparisons(await token());
        if (!cancelled) setComparisons(c);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchEventPairMatrix(
        { from: dateRange.from, to: dateRange.to, product, granularity },
        await token()
      );
      setMatrix(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dateRange.from, dateRange.to, product, granularity]);

  useEffect(() => { load(); }, [load]);

  const applyPreset = useCallback((p: DatePreset) => setDateRange(presetRange(p)), []);
  const rows: CorridorRow[] = useMemo(() => pivotMatrix(matrix), [matrix]);

  return {
    loading, error, comparisons, rows,
    dateRange, setDateRange, applyPreset,
    product, setProduct, granularity, setGranularity,
    reload: load,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd leg2-reporting && npx vitest run src/hooks/useEventGaps.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/hooks/useEventGaps.ts leg2-reporting/src/hooks/useEventGaps.test.tsx
git commit -m "feat(leg2): useEventGaps hook (filters + matrix load)"
```

---

### Task 9: `EventGapsPage` + App wiring

Composes filters + matrix + detail dialog; owns cell selection, detail fetch, product options, and the exclusion write. Wires the `#/gaps` route and nav button.

**Files:**
- Create: `leg2-reporting/src/pages/EventGapsPage.tsx`
- Modify: `leg2-reporting/src/App.tsx`
- Test: `leg2-reporting/src/pages/EventGapsPage.test.tsx`
- Modify: `leg2-reporting/src/App.test.tsx` (add a nav-renders-gaps assertion)

**Interfaces:**
- Consumes: Tasks 3–8 (`useEventGaps`, `EventGapsFilters`, `EventGapsMatrix`, `EventGapsDetailDialog`, `fetchEventPairDetail`, `setEventPairExclusion`, `useAuth`).

- [ ] **Step 1: Write the failing page test**

Create `leg2-reporting/src/pages/EventGapsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const matrix = [{ origin: "IN", destination: "JP", comparison_key: "ho_rescon", mean_days: 3.2, n: 4 }];
const comparisons = [{ comparison_key: "ho_rescon", priority: 1, label: "HO vs RESCON" }];
const detail = [{
  s9code: "S9A", comparison_key: "ho_rescon", origin_office: "INBOMB", dest_office: "JPTYOA",
  origin_country: "IN", dest_country: "JP", product: "A",
  rfid_utc: "2026-02-01T10:00:00+00:00", edi_utc: "2026-02-04T12:00:00+00:00",
  gap_days: 3.08, colocation_valid: true, excluded: false,
}];

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchEventComparisons: vi.fn().mockResolvedValue(comparisons),
  fetchEventPairMatrix: vi.fn().mockResolvedValue(matrix),
  fetchEventPairDetail: vi.fn().mockResolvedValue(detail),
  setEventPairExclusion: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { email: "u@example.com" } }),
}));

import EventGapsPage from "@/pages/EventGapsPage";
import { setEventPairExclusion } from "@/lib/supabase";

describe("EventGapsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the matrix and opens the detail dialog on cell click", async () => {
    render(<EventGapsPage />);
    await waitFor(() => expect(screen.getByText("3.2")).toBeInTheDocument());
    fireEvent.click(screen.getByText("3.2"));
    await waitFor(() => expect(screen.getByText("S9A")).toBeInTheDocument());
  });

  it("writes an exclusion when a detail checkbox is toggled", async () => {
    render(<EventGapsPage />);
    await waitFor(() => expect(screen.getByText("3.2")).toBeInTheDocument());
    fireEvent.click(screen.getByText("3.2"));
    await waitFor(() => expect(screen.getByText("S9A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(setEventPairExclusion).toHaveBeenCalledWith(
        expect.objectContaining({ s9code: "S9A", comparisonKey: "ho_rescon", excluded: true, excludedBy: "u@example.com" }),
        expect.anything()
      )
    );
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd leg2-reporting && npx vitest run src/pages/EventGapsPage.test.tsx`
Expected: FAIL — page not found.

- [ ] **Step 3: Implement the page**

Create `leg2-reporting/src/pages/EventGapsPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useEventGaps } from "@/hooks/useEventGaps";
import { EventGapsFilters } from "@/components/EventGapsFilters";
import { EventGapsMatrix } from "@/components/EventGapsMatrix";
import { EventGapsDetailDialog } from "@/components/EventGapsDetailDialog";
import {
  supabase, fetchEventPairDetail, setEventPairExclusion, type EventPairDetailRow,
} from "@/lib/supabase";
import { strings } from "@/i18n/strings";

interface Selection { origin: string; destination: string; comparisonKey: string; }

export default function EventGapsPage() {
  const { user } = useAuth();
  const {
    loading, error, comparisons, rows,
    dateRange, setDateRange, applyPreset,
    product, setProduct, granularity, setGranularity, reload,
  } = useEventGaps();

  const [selection, setSelection] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<EventPairDetailRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Product options = distinct real products seen in the current matrix rows are
  // not available (matrix is aggregated), so derive from a fixed known set plus
  // whatever detail exposes. Keep the known categories from the data.
  const productOptions = useMemo(() => ["A", "B", "D", "LC"], []);

  async function token(): Promise<{ token: string } | {}> {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    return t ? { token: t } : {};
  }

  const loadDetail = useCallback(async (sel: Selection) => {
    setDetailLoading(true);
    try {
      const d = await fetchEventPairDetail(
        {
          origin: sel.origin, destination: sel.destination, comparisonKey: sel.comparisonKey,
          product, from: dateRange.from, to: dateRange.to, granularity,
        },
        await token()
      );
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  }, [product, dateRange.from, dateRange.to, granularity]);

  useEffect(() => {
    if (selection) loadDetail(selection);
  }, [selection, loadDetail]);

  const onToggleExclude = useCallback(async (row: EventPairDetailRow, excluded: boolean) => {
    await setEventPairExclusion(
      { s9code: row.s9code, comparisonKey: row.comparison_key, excluded, excludedBy: user?.email ?? "" },
      await token()
    );
    if (selection) await loadDetail(selection); // refresh the dialog
    await reload();                              // refresh the matrix means
  }, [selection, loadDetail, reload, user?.email]);

  const title = selection ? `${selection.origin} → ${selection.destination}` : "";

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b bg-background px-4 py-3">
        <EventGapsFilters
          dateRange={dateRange} onDateChange={setDateRange} onApplyPreset={applyPreset}
          product={product} onProductChange={setProduct} productOptions={productOptions}
          granularity={granularity} onGranularityChange={setGranularity}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {loading && <p className="text-sm text-muted-foreground">{strings.states.loading}</p>}
        {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}
        {!loading && !error && (
          <section className="rounded-md border">
            <EventGapsMatrix
              comparisons={comparisons}
              rows={rows}
              onSelectCell={(corridor, comparisonKey) =>
                setSelection({ ...corridor, comparisonKey })}
            />
          </section>
        )}
      </div>
      <EventGapsDetailDialog
        open={selection !== null}
        onOpenChange={(o) => { if (!o) setSelection(null); }}
        title={title}
        rows={detail}
        loading={detailLoading}
        onToggleExclude={onToggleExclude}
      />
    </div>
  );
}
```

Note on `productOptions`: the known `mail_category` values in Leg2 are `A/B/D/LC` (verified in the data). If a future category appears, add it here or replace with a `fetchDistinctProducts()` helper — out of scope for v1.

- [ ] **Step 4: Wire the route + nav in `App.tsx`**

In `leg2-reporting/src/App.tsx`:

1. Add the import near the other page imports:
```tsx
import EventGapsPage from "@/pages/EventGapsPage";
```
2. In `Nav`, add a button after the receptacle button:
```tsx
      <Button
        variant={route.name === "gaps" ? "default" : "outline"}
        size="sm"
        onClick={() => go("#/gaps")}
      >
        {strings.gaps.nav}
      </Button>
```
3. In `Gate`, extend the route switch so `gaps` renders the page:
```tsx
        {route.name === "settings"
          ? <SettingsPage />
          : route.name === "gaps"
            ? <EventGapsPage />
            : route.name === "receptacle"
              ? <AtatPage s9={route.s9 || null} />
              : <RfidEventsPage />}
```

- [ ] **Step 5: Update `App.test.tsx`**

Add a test asserting the gaps nav button appears when authenticated. Mirror the existing authenticated-render test in `App.test.tsx` (reuse its auth mock/setup) and assert:
```tsx
expect(screen.getByRole("button", { name: "Event gaps" })).toBeInTheDocument();
```
If `App.test.tsx` already renders the authenticated shell in a helper, add the single assertion there; otherwise copy that test's setup into a new `it("shows the Event gaps nav", ...)`.

- [ ] **Step 6: Run the full suite + typecheck + build**

Run: `cd leg2-reporting && npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests PASS, no TS errors, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add leg2-reporting/src/pages/EventGapsPage.tsx leg2-reporting/src/App.tsx leg2-reporting/src/pages/EventGapsPage.test.tsx leg2-reporting/src/App.test.tsx
git commit -m "feat(leg2): event gaps page + nav wiring"
```

---

### Task 10: Manual end-to-end verification (browser)

**Files:** none (verification only).

- [ ] **Step 1: Run the app** — `cd leg2-reporting && npm run dev` (serves on http://localhost:3100). Sign in with a Leg2 user.
- [ ] **Step 2:** Click **Event gaps** in the nav. Confirm the matrix renders with corridor rows (centre-level `INBOMB → JPTYOA`) and 4 comparison columns.
- [ ] **Step 3:** Toggle **Country** — confirm rows collapse to 2-char (`IN → JP`) and means recompute.
- [ ] **Step 4:** Change the product filter and a date preset — confirm the matrix refetches.
- [ ] **Step 5:** Click a populated cell — confirm the dialog lists the S9 pairs (sorted by gap desc).
- [ ] **Step 6:** Tick **Exclude** on the largest-gap row — confirm it strikes through, and after the dialog/matrix refresh the cell's mean drops and `n` decreases. Untick it — confirm the mean returns. (Verifies permanent global exclusion round-trips.)
- [ ] **Step 7:** Report results (screenshots of matrix + dialog, before/after exclusion).

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- Matrix corridor×comparison, cell=mean days → Tasks 1 (matrix fn), 6 (matrix UI). ✓
- Period + product filters, granularity toggle Centre↔Country → Tasks 4, 5, 8. ✓
- Cell drill-down popup → Task 7 + 9. ✓
- Permanent global per-(s9,comparison) exclusion, toggleable → Tasks 1 (table), 4 (write), 7 (UI), 9 (wiring). ✓
- 4 comparisons, config-driven (no hardcoded codes) → Task 1 `ref_event_comparison` seed + view join; frontend columns via `fetchEventComparisons`. ✓
- RFID_400=handover_point, RFID_ARR_OE=2420, pairing window ±7d, UTC → Task 1 view. ✓
- Snapshots deferred to Increment 2 → not in plan, documented in spec §7. ✓
- Security rule (name Leg2 ref + confirm before DB writes) → Task 1 Step 2. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". `colocation_valid` is a documented v1 stub (spec §3/§9), not a placeholder. `productOptions` uses the verified `A/B/D/LC` set with a documented note. ✓

**3. Type consistency:** `EventPairMatrixRow`, `CorridorRow`, `EventComparison`, `Granularity`, `PRODUCT_ALL/NONE` defined in `eventGaps.ts` (Task 3) and imported everywhere. `EventPairDetailRow` defined in `supabase.ts` (Task 4), imported by Tasks 7/9. Comparison keys (`ho_rescon`/`ho_resdes`/`ho_predes`/`arroe_rescon`) consistent across SQL seed and tests. RPC arg names (`p_from/p_to/p_product/p_granularity`) match between Task 1 SQL and Task 4 builder. ✓
```
