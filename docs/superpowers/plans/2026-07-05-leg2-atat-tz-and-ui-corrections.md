# ATAT Corrections — EDI UTC Canonicalization + UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add EDI UTC canonicalization in the DB (per-site timezone reference + view) and correct the ATAT screen: UTC/Local toggle, modal from the report, separated timestamp with an explicit zone badge, and unified RFID/EDI date formatting.

**Architecture:** Timezone conversion lives in Postgres (a per-site reference table `edi_location_timezone` + a self-healing view `vw_edi_events_tz` that parses the text date, resolves the zone, and emits canonical UTC). The client reads the view, sorts the timeline by canonical UTC (naive fallback), and renders both sources through one formatter with a UTC/Local toggle. The loaded ATAT content becomes a reusable `AtatView` shared by the full-page `AtatPage` and a new `AtatDialog` (modal from the report).

**Tech Stack:** Vite 7, React 19, TypeScript 5.6, Tailwind v4, shadcn/ui, Vitest + @testing-library/react (jsdom), pnpm. Supabase Leg2 `ubgatxfwpmyaqyfrwias` (PostgREST + Auth).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-leg2-atat-tz-and-ui-corrections-design.md`. Branch: `feat/leg2-atat-tz-and-ui-corrections`.
- All client work under `leg2-reporting/`. Tests from there: `pnpm test -- <path>`. Type-check: `pnpm check`. Build: `pnpm build`.
- No new npm dependencies. No `react-router`. Path alias `@/` → `leg2-reporting/src/`.
- **Timezone is site-level (per centre), never country-level.** Zone resolves only via the `edi_location_timezone` reference table; unmapped codes → `tz_resolved=false`, shown as `no TZ`, never a fabricated UTC.
- **UTC is canonical.** Conversion happens in Postgres (`AT TIME ZONE`), never in the browser. Sort keys built with `Date.UTC(...)`/`Date.parse` of ISO — never runtime-local `new Date(textWithoutOffset)`.
- All user-facing copy is English, in `src/i18n/strings.ts` (`strings.atat`). Never hard-code UI strings.
- Supabase writes (Tasks 1–2) require explicit confirmation of **project = EDGE Leg2, ref = `ubgatxfwpmyaqyfrwias`** before applying. Never infer the project.
- EDI dedup rule unchanged: repeats collapsed by code, outbound→latest, inbound→earliest; RFID never deduped.

---

## File Structure

- `leg2-reporting/sql/edi_location_timezone.sql` — **create** — reference table + 92-row seed + RLS (Task 1).
- `leg2-reporting/sql/vw_edi_events_tz.sql` — **create** — the self-healing view + unresolved view (Task 2).
- `leg2-reporting/src/lib/supabase.ts` — **modify** — `EdiEvent` new fields; select cols; view target (Task 3).
- `leg2-reporting/src/lib/time.ts` — **modify** — `formatIso` helper (Task 4).
- `leg2-reporting/src/lib/atat.ts` — **modify** — `AtatEvent`/`EdiEventInput` reshape; normalizers; sort by UTC (Task 4).
- `leg2-reporting/src/i18n/strings.ts` — **modify** — `strings.atat.noTz`, `timeLabel` (Task 5).
- `leg2-reporting/src/components/AtatEventRow.tsx` — **modify** — separated timestamp block + zone badge + `mode` prop (Task 5).
- `leg2-reporting/src/components/AtatTimeline.tsx` — **modify** — pass `mode` through (Task 5).
- `leg2-reporting/src/hooks/useReceptacleTimeline.ts` — **create** — shared fetch+build hook (Task 6).
- `leg2-reporting/src/components/AtatView.tsx` — **create** — header + toggle + timeline (Task 6).
- `leg2-reporting/src/pages/AtatPage.tsx` — **modify** — use the hook + `AtatView` (Task 6).
- `leg2-reporting/src/components/AtatDialog.tsx` — **create** — modal wrapping `AtatView` (Task 7).
- `leg2-reporting/src/pages/RfidEventsPage.tsx` — **modify** — S9 click opens `AtatDialog` (Task 7).

---

## Task 1: `edi_location_timezone` reference table + seed (Leg2 write)

**Files:**
- Create: `leg2-reporting/sql/edi_location_timezone.sql`

**Interfaces:**
- Produces: table `public.edi_location_timezone(location text pk, iana_zone text, kind text, note text)` populated for all 92 distinct `edi_events.location` codes; readable by `authenticated`.

**Context:** Per-site timezone reference. Seeded from each code's centre city (IMPC codes embed an IATA-style city in chars 3–5) and OpenFlights for airports. **Leg2 write — confirm project = EDGE Leg2, ref `ubgatxfwpmyaqyfrwias` before applying. Also present the seed list to the user for validation before applying** (agreed: user validates zones country-by-country).

- [ ] **Step 1: Write the SQL file**

Create `leg2-reporting/sql/edi_location_timezone.sql` (idempotent):

```sql
-- ATAT: per-site timezone reference for EDI event locations.
-- One row per distinct edi_events.location code (IMPC office or IATA airport),
-- mapped to the centre's actual IANA zone (site-level, not country).
-- Project: EDGE Leg2 (ubgatxfwpmyaqyfrwias).

create table if not exists public.edi_location_timezone (
  location  text primary key,
  iana_zone text not null,
  kind      text,          -- 'office' | 'airport'
  note      text
);

insert into public.edi_location_timezone (location, iana_zone, kind, note) values
  -- airports (IATA)
  ('AKL','Pacific/Auckland','airport','Auckland'),
  ('BKK','Asia/Bangkok','airport','Bangkok'),
  ('BOM','Asia/Kolkata','airport','Mumbai'),
  ('BRU','Europe/Brussels','airport','Brussels'),
  ('BUD','Europe/Budapest','airport','Budapest'),
  ('CDG','Europe/Paris','airport','Paris CDG'),
  ('CGK','Asia/Jakarta','airport','Jakarta'),
  ('CMB','Asia/Colombo','airport','Colombo'),
  ('CWB','America/Sao_Paulo','airport','Curitiba'),
  ('DEL','Asia/Kolkata','airport','Delhi'),
  ('DOH','Asia/Qatar','airport','Doha'),
  ('DXB','Asia/Dubai','airport','Dubai'),
  ('FRA','Europe/Berlin','airport','Frankfurt'),
  ('GRU','America/Sao_Paulo','airport','Sao Paulo'),
  ('HKG','Asia/Hong_Kong','airport','Hong Kong'),
  ('HND','Asia/Tokyo','airport','Tokyo Haneda'),
  ('ICN','Asia/Seoul','airport','Seoul Incheon'),
  ('IST','Europe/Istanbul','airport','Istanbul'),
  ('JFK','America/New_York','airport','New York JFK'),
  ('JNB','Africa/Johannesburg','airport','Johannesburg'),
  ('KUL','Asia/Kuala_Lumpur','airport','Kuala Lumpur'),
  ('LHR','Europe/London','airport','London Heathrow'),
  ('LIS','Europe/Lisbon','airport','Lisbon'),
  ('LOS','Africa/Lagos','airport','Lagos'),
  ('MEX','America/Mexico_City','airport','Mexico City'),
  ('MNL','Asia/Manila','airport','Manila'),
  ('OTP','Europe/Bucharest','airport','Bucharest Otopeni'),
  ('SIN','Asia/Singapore','airport','Singapore'),
  ('SVO','Europe/Moscow','airport','Moscow Sheremetyevo'),
  ('WAW','Europe/Warsaw','airport','Warsaw'),
  ('YVR','America/Vancouver','airport','Vancouver'),
  ('ZRH','Europe/Zurich','airport','Zurich'),
  -- offices (IMPC)
  ('AEDXBA','Asia/Dubai','office','Dubai'),
  ('AUSYDB','Australia/Sydney','office','Sydney'),
  ('BABNXA','Europe/Sarajevo','office','Banja Luka'),
  ('BDDACA','Asia/Dhaka','office','Dhaka'),
  ('BEBRUA','Europe/Brussels','office','Brussels'),
  ('BRCWBA','America/Sao_Paulo','office','Curitiba'),
  ('BRSAOD','America/Sao_Paulo','office','Sao Paulo'),
  ('BTTHIA','Asia/Thimphu','office','Thimphu'),
  ('CAYVRA','America/Vancouver','office','Vancouver'),
  ('CHATTC','Europe/Zurich','office','Switzerland'),
  ('CHZRHB','Europe/Zurich','office','Zurich'),
  ('CNBJSA','Asia/Shanghai','office','Beijing'),
  ('CNCAND','Asia/Shanghai','office','Guangzhou'),
  ('DEFRAA','Europe/Berlin','office','Frankfurt'),
  ('FRROIC','Europe/Paris','office','Roissy'),
  ('GBCVTA','Europe/London','office','Coventry'),
  ('GBLALA','Europe/London','office','UK'),
  ('GBLONH','Europe/London','office','London'),
  ('HKHKGA','Asia/Hong_Kong','office','Hong Kong'),
  ('HUBUDA','Europe/Budapest','office','Budapest'),
  ('IDJKTC','Asia/Jakarta','office','Jakarta'),
  ('INBOMA','Asia/Kolkata','office','Mumbai'),
  ('INBOMB','Asia/Kolkata','office','Mumbai'),
  ('INBOMC','Asia/Kolkata','office','Mumbai'),
  ('INCCUB','Asia/Kolkata','office','Kolkata'),
  ('INDELB','Asia/Kolkata','office','Delhi'),
  ('JPKWSA','Asia/Tokyo','office','Kawasaki'),
  ('JPTYOA','Asia/Tokyo','office','Tokyo'),
  ('JPTYOB','Asia/Tokyo','office','Tokyo'),
  ('JPTYOC','Asia/Tokyo','office','Tokyo'),
  ('KHPNHA','Asia/Phnom_Penh','office','Phnom Penh'),
  ('KRSELB','Asia/Seoul','office','Seoul'),
  ('LKCMBA','Asia/Colombo','office','Colombo'),
  ('LKCMBE','Asia/Colombo','office','Colombo'),
  ('METGDA','Europe/Podgorica','office','Podgorica'),
  ('MXMEXD','America/Mexico_City','office','Mexico City'),
  ('MYKULA','Asia/Kuala_Lumpur','office','Kuala Lumpur'),
  ('NPKTMA','Asia/Kathmandu','office','Kathmandu'),
  ('NZAKLA','Pacific/Auckland','office','Auckland'),
  ('PHMNLB','Asia/Manila','office','Manila'),
  ('PLWAWA','Europe/Warsaw','office','Warsaw'),
  ('PTLISA','Europe/Lisbon','office','Lisbon'),
  ('PTLISE','Europe/Lisbon','office','Lisbon'),
  ('PTLISR','Europe/Lisbon','office','Lisbon'),
  ('QADOHA','Asia/Qatar','office','Doha'),
  ('ROBUHA','Europe/Bucharest','office','Bucharest'),
  ('ROBUHB','Europe/Bucharest','office','Bucharest'),
  ('ROBUHC','Europe/Bucharest','office','Bucharest'),
  ('RUMOWT','Europe/Moscow','office','Moscow'),
  ('SGSINA','Asia/Singapore','office','Singapore'),
  ('SGSIND','Asia/Singapore','office','Singapore'),
  ('SZMTSA','Africa/Mbabane','office','Manzini'),
  ('THBKKA','Asia/Bangkok','office','Bangkok'),
  ('THBKKB','Asia/Bangkok','office','Bangkok'),
  ('THBKKD','Asia/Bangkok','office','Bangkok'),
  ('TRISTE','Europe/Istanbul','office','Istanbul'),
  ('TWTPEA','Asia/Taipei','office','Taipei'),
  ('USJFKA','America/New_York','office','New York'),
  -- non-standard codes present in the data
  ('BERN','Europe/Zurich','office','Bern'),
  ('PARIS','Europe/Paris','office','Paris')
on conflict (location) do update
  set iana_zone = excluded.iana_zone, kind = excluded.kind, note = excluded.note;

alter table public.edi_location_timezone enable row level security;
drop policy if exists authenticated_select_edi_location_timezone on public.edi_location_timezone;
create policy authenticated_select_edi_location_timezone
  on public.edi_location_timezone for select to authenticated using (true);
```

- [ ] **Step 2: Present the seed for validation, confirm project, then apply**

Show the user the 92-row zone list and ask them to validate (country-by-country) before applying.
After validation, ask: "Apply to EDGE Leg2, ref `ubgatxfwpmyaqyfrwias`?" On confirmation, apply the
SQL via the Management API (scratchpad `q.mjs`/`apply.mjs` with the Leg2 PAT and ref).

- [ ] **Step 3: Verify the seed loaded and every zone is a valid IANA name**

```bash
node q.mjs "select count(*) rows, count(*) filter (where iana_zone in (select name from pg_timezone_names)) valid_zones from edi_location_timezone"
node q.mjs "with edi as (select distinct location from edi_events where location is not null) select count(*) codes, count(t.location) mapped from edi e left join edi_location_timezone t on t.location=e.location"
```

Expected: `rows=92`, `valid_zones=92`; `codes=92, mapped=92` (every location resolved).

- [ ] **Step 4: Commit**

```bash
git add leg2-reporting/sql/edi_location_timezone.sql
git commit -m "feat(leg2-atat): per-site EDI location timezone reference table + seed"
```

---

## Task 2: `vw_edi_events_tz` + `vw_edi_locations_unresolved` (Leg2 write)

**Files:**
- Create: `leg2-reporting/sql/vw_edi_events_tz.sql`

**Interfaces:**
- Consumes: `edi_events`, `edi_location_timezone` (Task 1), `pg_timezone_names`.
- Produces: view `public.vw_edi_events_tz` with columns `s9code, message, event, date, location,
  transport, transport_date, reference, event_datetime_local (timestamp), resolved_zone (text),
  event_datetime_utc (timestamptz), tz_resolved (boolean)`; view `public.vw_edi_locations_unresolved(location)`.

**Context:** Self-healing view. Parses the two `date` text formats (proven:
`regexp_replace(date,'^[A-Za-z]{3},','')` then `to_timestamp(...,'DD-MM-YYYY HH24:MI')`; ISO
`to_timestamp(date,'YYYY-MM-DD')`), resolves the zone via a single join, converts to UTC with
`AT TIME ZONE`. **Leg2 write — confirm project+ref before applying.**

- [ ] **Step 1: Write the SQL file**

Create `leg2-reporting/sql/vw_edi_events_tz.sql`:

```sql
-- ATAT: self-healing EDI events view with canonical UTC.
-- Parses the text date (two formats), resolves the location's IANA zone from
-- edi_location_timezone (site-level), and converts local -> UTC via AT TIME ZONE.
-- Project: EDGE Leg2 (ubgatxfwpmyaqyfrwias).

create or replace view public.vw_edi_events_tz as
with parsed as (
  select
    e.s9code, e.message, e.event, e.date, e.location,
    e.transport, e.transport_date, e.reference,
    case
      when e.date ~ '^[A-Za-z]{3},\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}$'
        then to_timestamp(regexp_replace(e.date, '^[A-Za-z]{3},', ''), 'DD-MM-YYYY HH24:MI')::timestamp
      when e.date ~ '^\d{4}-\d{2}-\d{2}$'
        then to_timestamp(e.date, 'YYYY-MM-DD')::timestamp
      else null
    end as event_datetime_local,
    t.iana_zone as resolved_zone
  from public.edi_events e
  left join public.edi_location_timezone t on t.location = e.location
)
select
  p.s9code, p.message, p.event, p.date, p.location,
  p.transport, p.transport_date, p.reference,
  p.event_datetime_local,
  p.resolved_zone,
  case
    when p.event_datetime_local is not null and p.resolved_zone is not null
      then p.event_datetime_local at time zone p.resolved_zone
    else null
  end as event_datetime_utc,
  (p.event_datetime_local is not null and p.resolved_zone is not null) as tz_resolved
from parsed p;

create or replace view public.vw_edi_locations_unresolved as
select distinct location
from public.vw_edi_events_tz
where not tz_resolved and location is not null;
```

- [ ] **Step 2: Confirm project, then apply**

Confirm "Apply to EDGE Leg2, ref `ubgatxfwpmyaqyfrwias`?"; on confirmation apply via `q.mjs`.

- [ ] **Step 3: Verify conversion + coverage**

```bash
# JPKWSA (Asia/Tokyo, +9): local 08:30 -> UTC 23:30 previous day (-9h)
node q.mjs "select date, event_datetime_local, resolved_zone, event_datetime_utc, tz_resolved from vw_edi_events_tz where location='JPKWSA' and date like 'Mon,16-02-2026%' limit 1"
# coverage: with a full seed, no location-based unresolved rows remain
node q.mjs "select count(*) unresolved_locations from vw_edi_locations_unresolved"
# rows with a date but no utc should only be null-date/unparseable
node q.mjs "select count(*) total, count(event_datetime_utc) with_utc, count(*) filter (where not tz_resolved) unresolved from vw_edi_events_tz"
```

Expected: the JPKWSA row shows `event_datetime_utc` = its local minus 9h and `tz_resolved=true`;
`unresolved_locations=0` (all 92 codes seeded); `unresolved` equals only rows whose `date` is
null/unparseable or `location` is null.

- [ ] **Step 4: Commit**

```bash
git add leg2-reporting/sql/vw_edi_events_tz.sql
git commit -m "feat(leg2-atat): vw_edi_events_tz canonical-UTC view + unresolved-locations view"
```

---

## Task 3: Client fetch targets the tz view (`supabase.ts`)

**Files:**
- Modify: `leg2-reporting/src/lib/supabase.ts`
- Test: `leg2-reporting/src/lib/supabase.test.ts`

**Interfaces:**
- Consumes: existing `EDI_EVENTS_VIEW`, `EDI_EVENTS_SELECT_COLS`, `fetchEdiEvents` in `supabase.ts`.
- Produces: `EdiEvent` extended with `event_datetime_local: string | null`, `event_datetime_utc:
  string | null`, `resolved_zone: string | null`, `tz_resolved: boolean`; `fetchEdiEvents` reads
  `vw_edi_events_tz`.

- [ ] **Step 1: Update the failing test**

In `leg2-reporting/src/lib/supabase.test.ts`, add to the existing `describe("buildEdiEventsUrl", …)`
(or a new one) an assertion that the select columns include the tz fields, and update the base:

```ts
it("selects the canonical-UTC columns from the tz view", () => {
  const url = buildEdiEventsUrl("https://x.supabase.co/rest/v1/vw_edi_events_tz", { s9: "ABC", offset: 0, limit: 1000 });
  expect(EDI_EVENTS_SELECT_COLS).toContain("event_datetime_utc");
  expect(EDI_EVENTS_SELECT_COLS).toContain("resolved_zone");
  expect(EDI_EVENTS_SELECT_COLS).toContain("tz_resolved");
  expect(url).toContain("s9code=eq.ABC");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/supabase.test.ts`
Expected: FAIL — `EDI_EVENTS_SELECT_COLS` lacks the new columns.

- [ ] **Step 3: Update the implementation**

In `leg2-reporting/src/lib/supabase.ts`:

Extend the `EdiEvent` interface:

```ts
export interface EdiEvent {
  message: string | null;
  event: string | null;
  date: string | null;
  location: string | null;
  transport: string | null;
  transport_date: string | null;
  reference: string | null;
  event_datetime_local: string | null;
  event_datetime_utc: string | null;
  resolved_zone: string | null;
  tz_resolved: boolean;
}
```

Change the view constant and select columns:

```ts
const EDI_EVENTS_VIEW = "vw_edi_events_tz";
export const EDI_EVENTS_SELECT_COLS = [
  "message", "event", "date", "location", "transport", "transport_date", "reference",
  "event_datetime_local", "event_datetime_utc", "resolved_zone", "tz_resolved",
].join(",");
```

(`buildEdiEventsUrl` and `fetchEdiEvents` bodies are unchanged — they use these constants.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/supabase.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check and commit**

```bash
pnpm check
git add leg2-reporting/src/lib/supabase.ts leg2-reporting/src/lib/supabase.test.ts
git commit -m "feat(leg2-atat): fetch EDI events from vw_edi_events_tz with canonical UTC"
```

---

## Task 4: Timeline sorts by canonical UTC; unified formatting (`atat.ts`, `time.ts`)

**Files:**
- Modify: `leg2-reporting/src/lib/time.ts`
- Modify: `leg2-reporting/src/lib/atat.ts`
- Test: `leg2-reporting/src/lib/atat.test.ts`

**Interfaces:**
- Consumes: `EdiEvent` fields from Task 3; `RfidMovement`; `checkpointLabel`; `directionForCode`.
- Produces:
  - `time.ts`: `export function formatIso(iso: string | null): string` — component-based, tz-safe.
  - `atat.ts`: `EdiEventInput` gains `event_datetime_local/utc`, `resolved_zone`, `tz_resolved`;
    `AtatEvent` reshaped to `{ source, code, label, location, direction, fields, eventDatetimeUtc:
    string|null, eventDatetimeLocal: string|null, localZone: string|null, tzResolved: boolean,
    rawDate: string, sortKey: number|null }`; `buildAtatTimeline` sorts by `sortKey`.
- Note: `parseEdiDate` is **removed** — the view is now the single date parser (DRY). Its tests go too.

- [ ] **Step 1: Add `formatIso` to `time.ts` (with test)**

Add to `leg2-reporting/src/lib/time.ts` (reuses existing `TS_RE`, `MONTHS`, `WD`):

```ts
/**
 * Format an ISO-ish timestamp string as "DD Mon YYYY (Wd), HH:MM:SS", reading
 * the wall-clock components directly (tz-safe — never constructs a local Date).
 * For a UTC string ("…+00:00") the components ARE UTC; for a naive local string
 * they are the local wall time.
 */
export function formatIso(iso: string | null): string {
  if (!iso) return "";
  const match = TS_RE.exec(iso);
  if (!match) return iso;
  const [, year, month, day, hour, minute, second] = match;
  const monthAbbrev = MONTHS[Number(month) - 1] ?? month;
  const weekday = WD[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
  return `${day} ${monthAbbrev} ${year} (${weekday}), ${hour}:${minute}:${second}`;
}
```

Add to `leg2-reporting/src/lib/time.test.ts` (create the file if absent, else append):

```ts
import { describe, it, expect } from "vitest";
import { formatIso } from "@/lib/time";

describe("formatIso", () => {
  it("formats a UTC ISO string by its wall-clock components", () => {
    expect(formatIso("2026-07-03T15:14:22.934+00:00")).toBe("03 Jul 2026 (Fri), 15:14:22");
  });
  it("formats a naive local ISO string", () => {
    expect(formatIso("2026-02-16T08:30:00")).toBe("16 Feb 2026 (Mon), 08:30:00");
  });
  it("returns empty string for null and echoes unparseable input", () => {
    expect(formatIso(null)).toBe("");
    expect(formatIso("nope")).toBe("nope");
  });
});
```

Run: `pnpm test -- src/lib/time.test.ts` → after adding `formatIso`, PASS.

- [ ] **Step 2: Rewrite the `atat.test.ts` expectations (failing)**

Replace `leg2-reporting/src/lib/atat.test.ts` with (drops parseEdiDate tests; adds UTC-sort + fields):

```ts
import { describe, it, expect } from "vitest";
import { buildAtatTimeline } from "@/lib/atat";
import type { RfidMovement } from "@/lib/supabase";

function mov(p: Partial<RfidMovement>): RfidMovement {
  return {
    movement_id: "m", s9_id: "S", tag_id: "T", reader_id: "R", movement_type: "INBOUND",
    route_country_role: null, edi_equivalent: "2400", origin_country_code: null,
    destination_country_code: null, movement_country_code: null, country_sequence_number: null,
    event_datetime_utc: "2026-05-02T00:00:00.000+00:00", event_datetime_local: "2026-05-02T09:00:00.000",
    reader_timezone: "Asia/Tokyo", site_impc_code: "JPKWSA", centre_code: "JPKWSA",
    site_name: "Kawasaki", city: "Kawasaki", country_code: "JP", handover_point: false,
    handover_quality_status: null, ...p,
  };
}
function edi(p: Record<string, unknown>) {
  return {
    message: null, event: null, date: null, location: null, transport: null,
    transport_date: null, reference: null, event_datetime_local: null,
    event_datetime_utc: null, resolved_zone: null, tz_resolved: false, ...p,
  };
}

describe("buildAtatTimeline", () => {
  it("orders by canonical UTC across sources", () => {
    // RFID at UTC 00:00; EDI resolved at UTC 01:00 -> EDI after RFID by true UTC
    const events = buildAtatTimeline(
      [mov({ code: undefined, event_datetime_utc: "2026-05-02T00:00:00+00:00" } as never)],
      [edi({ message: "RESDES", event: "Arrival", event_datetime_utc: "2026-05-02T01:00:00+00:00",
             event_datetime_local: "2026-05-02T10:00:00", resolved_zone: "Asia/Tokyo", tz_resolved: true })]
    );
    expect(events.map((e) => e.source)).toEqual(["RFID", "EDI"]);
    expect(events[1].tzResolved).toBe(true);
    expect(events[1].localZone).toBe("Asia/Tokyo");
  });

  it("dedups an outbound EDI code to its latest UTC occurrence", () => {
    const events = buildAtatTimeline([], [
      edi({ message: "CARDIT", event_datetime_utc: "2026-05-01T10:00:00+00:00", tz_resolved: true, resolved_zone: "UTC", event_datetime_local: "2026-05-01T10:00:00" }),
      edi({ message: "CARDIT", event_datetime_utc: "2026-05-01T20:00:00+00:00", tz_resolved: true, resolved_zone: "UTC", event_datetime_local: "2026-05-01T20:00:00" }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].eventDatetimeUtc).toBe("2026-05-01T20:00:00+00:00");
  });

  it("falls back to naive local ordering when UTC is unresolved, sorts nulls last", () => {
    const events = buildAtatTimeline([], [
      edi({ message: "RESDES", event_datetime_local: "2026-05-01T09:00:00", tz_resolved: false }),
      edi({ message: "RESCON", date: "bad", event_datetime_local: null, tz_resolved: false }),
    ]);
    expect(events.map((e) => e.code)).toEqual(["RESDES", "RESCON"]);
    expect(events[0].tzResolved).toBe(false);
  });

  it("marks unresolved EDI and never invents a UTC", () => {
    const [e] = buildAtatTimeline([], [
      edi({ message: "RESDES", event_datetime_local: "2026-05-01T09:00:00", resolved_zone: null, tz_resolved: false }),
    ]);
    expect(e.eventDatetimeUtc).toBeNull();
    expect(e.tzResolved).toBe(false);
  });

  it("carries inline reader fields for RFID but not a UTC-time field", () => {
    const [e] = buildAtatTimeline([mov({ reader_id: "R9", tag_id: "TAG1" })], []);
    const labels = e.fields.map((f) => f.label);
    expect(labels).toContain("Reader");
    expect(labels).not.toContain("UTC time");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- src/lib/atat.test.ts`
Expected: FAIL — `AtatEvent` lacks `eventDatetimeUtc`/`tzResolved`/`localZone`; `parseEdiDate` import gone.

- [ ] **Step 4: Rewrite `atat.ts`**

Replace `leg2-reporting/src/lib/atat.ts` with:

```ts
import type { RfidMovement } from "@/lib/supabase";
import { directionForCode, type EdiDirection } from "@/lib/ediDirection";
import { checkpointLabel } from "@/lib/checkpoints";
import { strings } from "@/i18n/strings";

/** Structural shape of a vw_edi_events_tz row (matches EdiEvent from supabase.ts). */
export interface EdiEventInput {
  message: string | null;
  event: string | null;
  date: string | null;
  location: string | null;
  transport: string | null;
  transport_date: string | null;
  reference: string | null;
  event_datetime_local: string | null;
  event_datetime_utc: string | null;
  resolved_zone: string | null;
  tz_resolved: boolean;
}

export interface AtatField {
  label: string;
  value: string;
}

export interface AtatEvent {
  source: "RFID" | "EDI";
  code: string;
  label: string;
  location: string | null;
  direction: EdiDirection;
  fields: AtatField[];
  eventDatetimeUtc: string | null;   // ISO with offset (canonical) or null
  eventDatetimeLocal: string | null; // ISO naive local or null
  localZone: string | null;          // reader_timezone / resolved_zone
  tzResolved: boolean;               // canonical UTC available
  rawDate: string;                   // fallback display text
  sortKey: number | null;            // ordering: UTC epoch if available, else naive-local epoch
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/** Naive ISO components -> epoch as if UTC (tz-independent ordering key). */
function naiveEpoch(iso: string | null): number | null {
  const m = ISO_RE.exec(iso ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi);
}

/** Ordering key: true UTC epoch when a canonical UTC exists, else naive local. */
function sortKeyOf(utc: string | null, local: string | null): number | null {
  if (utc) {
    const t = Date.parse(utc);
    if (!Number.isNaN(t)) return t;
  }
  return naiveEpoch(local);
}

function nonEmpty(pairs: Array<[string, string | null | undefined]>): AtatField[] {
  return pairs
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([label, v]) => ({ label, value: String(v) }));
}

function normalizeRfid(m: RfidMovement): AtatEvent {
  const code = m.edi_equivalent ?? m.movement_type;
  const label = m.edi_equivalent ? checkpointLabel(m.edi_equivalent) : m.movement_type;
  return {
    source: "RFID",
    code,
    label,
    location: m.site_impc_code ?? m.centre_code ?? null,
    direction: directionForCode(code),
    eventDatetimeUtc: m.event_datetime_utc,
    eventDatetimeLocal: m.event_datetime_local,
    localZone: m.reader_timezone ?? null,
    tzResolved: !!m.event_datetime_utc,
    rawDate: m.event_datetime_local,
    sortKey: sortKeyOf(m.event_datetime_utc, m.event_datetime_local),
    fields: nonEmpty([
      [strings.atat.fieldMovementType, m.movement_type],
      [strings.atat.fieldReader, m.reader_id],
      [strings.atat.fieldFacility, m.site_name],
      [strings.atat.fieldCity, m.city],
      [strings.atat.fieldCountry, m.country_code],
      [strings.atat.fieldTag, m.tag_id],
      [strings.atat.fieldHandover, m.handover_point ? strings.common.yes : null],
    ]),
  };
}

function normalizeEdi(e: EdiEventInput): AtatEvent {
  const code = e.message ?? "";
  return {
    source: "EDI",
    code,
    label: e.event ?? code,
    location: e.location,
    direction: directionForCode(e.message),
    eventDatetimeUtc: e.event_datetime_utc,
    eventDatetimeLocal: e.event_datetime_local,
    localZone: e.resolved_zone,
    tzResolved: e.tz_resolved,
    rawDate: e.date ?? "",
    sortKey: sortKeyOf(e.event_datetime_utc, e.event_datetime_local),
    fields: nonEmpty([
      [strings.atat.fieldLocation, e.location],
      [strings.atat.fieldTransport, e.transport],
      [strings.atat.fieldTransportDate, e.transport_date],
      [strings.atat.fieldReference, e.reference],
    ]),
  };
}

/** Collapse repeated EDI codes: outbound -> latest, inbound -> earliest. Stable. */
function dedupeEdi(events: AtatEvent[]): AtatEvent[] {
  const groups = new Map<string, AtatEvent[]>();
  const order: string[] = [];
  for (const e of events) {
    if (!groups.has(e.code)) {
      groups.set(e.code, []);
      order.push(e.code);
    }
    groups.get(e.code)!.push(e);
  }
  return order.map((code) => {
    const g = groups.get(code)!;
    if (g.length === 1) return g[0];
    const withKey = g.filter((x) => x.sortKey !== null);
    if (withKey.length === 0) return g[0];
    const dir = g[0].direction;
    return withKey.reduce((best, cur) =>
      dir === "outbound"
        ? (cur.sortKey! > best.sortKey! ? cur : best)
        : (cur.sortKey! < best.sortKey! ? cur : best)
    );
  });
}

/**
 * Merge RFID movements + EDI events into one chronological timeline, ordered by
 * canonical UTC when available (RFID always; EDI when its location zone is
 * resolved), falling back to naive local wall-clock for unresolved rows.
 */
export function buildAtatTimeline(
  movements: RfidMovement[],
  edi: EdiEventInput[]
): AtatEvent[] {
  const rfid = movements.map(normalizeRfid);
  const ediEvents = dedupeEdi(edi.map(normalizeEdi));
  return [...rfid, ...ediEvents]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ka = a.e.sortKey;
      const kb = b.e.sortKey;
      if (ka !== null && kb !== null) {
        return ka !== kb ? ka - kb : a.i - b.i;
      }
      if (ka !== null) return -1;
      if (kb !== null) return 1;
      return a.i - b.i;
    })
    .map(({ e }) => e);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- src/lib/atat.test.ts src/lib/time.test.ts`
Expected: PASS. (`parseEdiDate` is gone; no test references it.)

- [ ] **Step 6: Type-check**

Run: `pnpm check`
Expected: fails in `AtatEventRow.tsx`/`AtatTimeline.tsx`/`AtatPage.tsx` (they use the old
`displayTime`/`timestamp` shape). That is expected — Tasks 5–6 update them. **To keep this task's
commit green, also apply the minimal Task 5 row change now if executing strictly in order**; the
subagent-driven flow instead lets Task 5 fix the consumers. If you need a green `pnpm check` at this
commit, proceed to Task 5 before committing. Otherwise commit the lib change and let Task 5 restore
the type-check.

- [ ] **Step 7: Commit**

```bash
git add leg2-reporting/src/lib/atat.ts leg2-reporting/src/lib/time.ts leg2-reporting/src/lib/atat.test.ts leg2-reporting/src/lib/time.test.ts
git commit -m "feat(leg2-atat): order timeline by canonical UTC; formatIso; drop client date parser"
```

---

## Task 5: Separated timestamp block + zone badge + mode (`AtatEventRow`, `AtatTimeline`, i18n)

**Files:**
- Modify: `leg2-reporting/src/i18n/strings.ts`
- Modify: `leg2-reporting/src/components/AtatEventRow.tsx`
- Modify: `leg2-reporting/src/components/AtatTimeline.tsx`
- Test: `leg2-reporting/src/components/AtatEventRow.test.tsx`

**Interfaces:**
- Consumes: reshaped `AtatEvent` (Task 4); `formatIso` (Task 4); `TimeMode` from `@/lib/time`.
- Produces: `AtatEventRow({ event, mode }: { event: AtatEvent; mode: TimeMode })`;
  `AtatTimeline({ events, mode })`.

- [ ] **Step 1: Add i18n keys**

In `leg2-reporting/src/i18n/strings.ts`, inside the `atat` block, add:

```ts
    noTz: "no TZ",
    timeLabel: "Time",
```

- [ ] **Step 2: Rewrite the failing test**

Replace `leg2-reporting/src/components/AtatEventRow.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AtatEventRow } from "@/components/AtatEventRow";
import type { AtatEvent } from "@/lib/atat";

const resolved: AtatEvent = {
  source: "EDI", code: "RESDES", label: "Dispatch arrival at IOE",
  location: "JPKWSA", direction: "inbound", fields: [{ label: "Transport", value: "SQ0612" }],
  eventDatetimeUtc: "2026-05-01T23:30:00+00:00", eventDatetimeLocal: "2026-05-02T08:30:00",
  localZone: "Asia/Tokyo", tzResolved: true, rawDate: "Fri,02-05-2026 08:30",
  sortKey: Date.parse("2026-05-01T23:30:00+00:00"),
};

describe("AtatEventRow", () => {
  it("shows the UTC time and a UTC badge in utc mode", () => {
    render(<AtatEventRow event={resolved} mode="utc" />);
    expect(screen.getByText("01 May 2026 (Fri), 23:30:00")).toBeInTheDocument();
    expect(screen.getByText("UTC", { selector: "[data-role='zone']" })).toBeInTheDocument();
  });

  it("shows the local time and the zone badge in local mode", () => {
    render(<AtatEventRow event={resolved} mode="local" />);
    expect(screen.getByText("02 May 2026 (Sat), 08:30:00")).toBeInTheDocument();
    expect(screen.getByText("Asia/Tokyo", { selector: "[data-role='zone']" })).toBeInTheDocument();
  });

  it("flags unresolved EDI as 'no TZ' and never fabricates a UTC", () => {
    const unresolved: AtatEvent = {
      ...resolved, eventDatetimeUtc: null, localZone: null, tzResolved: false,
    };
    render(<AtatEventRow event={unresolved} mode="utc" />);
    // falls back to the local wall time, flagged no TZ
    expect(screen.getByText("02 May 2026 (Sat), 08:30:00")).toBeInTheDocument();
    expect(screen.getByText("no TZ", { selector: "[data-role='zone']" })).toBeInTheDocument();
  });

  it("does not render a UTC-time inline field", () => {
    render(<AtatEventRow event={resolved} mode="utc" />);
    expect(screen.queryByText(/UTC time/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- src/components/AtatEventRow.test.tsx`
Expected: FAIL — `AtatEventRow` doesn't accept `mode`, no `data-role="zone"` block.

- [ ] **Step 4: Rewrite `AtatEventRow.tsx`**

```tsx
import type { AtatEvent } from "@/lib/atat";
import { formatIso, type TimeMode } from "@/lib/time";
import { strings } from "@/i18n/strings";
import { cn } from "@/lib/utils";

/** Which timestamp + zone label to show for the current mode. */
function timeFor(event: AtatEvent, mode: TimeMode): { text: string; zone: string } {
  if (mode === "utc") {
    if (event.eventDatetimeUtc) {
      return { text: formatIso(event.eventDatetimeUtc), zone: "UTC" };
    }
    // unresolved: show the local wall time, flagged no TZ
    return { text: formatIso(event.eventDatetimeLocal) || event.rawDate, zone: strings.atat.noTz };
  }
  return {
    text: formatIso(event.eventDatetimeLocal) || event.rawDate,
    zone: event.localZone ?? strings.atat.noTz,
  };
}

export function AtatEventRow({ event, mode }: { event: AtatEvent; mode: TimeMode }) {
  const isRfid = event.source === "RFID";
  const sourceLabel = isRfid ? strings.atat.sourceRfid : strings.atat.sourceEdi;
  const { text, zone } = timeFor(event, mode);
  return (
    <div className="relative flex gap-4 pb-6">
      {/* time column */}
      <div className="w-40 shrink-0 text-right">
        <div className="font-mono text-xs">{text}</div>
        <div data-role="zone" className="text-[10px] font-semibold uppercase text-muted-foreground">
          {zone}
        </div>
      </div>
      {/* axis dot */}
      <div className="relative flex justify-center">
        <span className="mt-1 h-3 w-3 rounded-full border-2 border-background bg-foreground/70" />
        <span className="absolute top-1 h-full w-px bg-border" />
      </div>
      {/* content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded px-2 py-0.5 text-xs font-semibold",
              isRfid ? "bg-sky-100 text-sky-900" : "bg-rose-100 text-rose-900"
            )}
          >
            {event.code || "—"}
          </span>
          <span className="text-sm font-medium">{event.label}</span>
          <span className="ml-auto flex items-center gap-2">
            {event.location && (
              <span data-role="location" className="font-mono text-xs text-muted-foreground">
                {event.location}
              </span>
            )}
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {sourceLabel}
            </span>
          </span>
        </div>
        {event.fields.length > 0 && (
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
            {event.fields.map((f) => (
              <div key={f.label} className="flex gap-1 text-xs">
                <dt className="text-muted-foreground">{f.label}:</dt>
                <dd className="min-w-0 truncate">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update `AtatTimeline.tsx` to pass `mode`**

```tsx
import type { AtatEvent } from "@/lib/atat";
import type { TimeMode } from "@/lib/time";
import { AtatEventRow } from "@/components/AtatEventRow";

export function AtatTimeline({ events, mode }: { events: AtatEvent[]; mode: TimeMode }) {
  return (
    <div className="mt-4">
      {events.map((e, i) => (
        <AtatEventRow key={`${e.source}-${e.code}-${e.rawDate}-${i}`} event={e} mode={mode} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm test -- src/components/AtatEventRow.test.tsx`
Expected: PASS. (`pnpm check` still fails until `AtatPage`/`AtatView` pass `mode` — fixed in Task 6.)

- [ ] **Step 7: Commit**

```bash
git add leg2-reporting/src/components/AtatEventRow.tsx leg2-reporting/src/components/AtatTimeline.tsx leg2-reporting/src/components/AtatEventRow.test.tsx leg2-reporting/src/i18n/strings.ts
git commit -m "feat(leg2-atat): separated timestamp block with UTC/Local zone badge"
```

---

## Task 6: `AtatView` + shared timeline hook; refactor `AtatPage`

**Files:**
- Create: `leg2-reporting/src/hooks/useReceptacleTimeline.ts`
- Create: `leg2-reporting/src/components/AtatView.tsx`
- Modify: `leg2-reporting/src/pages/AtatPage.tsx`
- Test: `leg2-reporting/src/components/AtatView.test.tsx`
- Test: `leg2-reporting/src/pages/AtatPage.test.tsx` (update)

**Interfaces:**
- Consumes: `fetchEdiEvents`/`fetchEdiDetails`/`fetchMovementsByS9`/`supabase` (`supabase.ts`);
  `buildAtatTimeline`, `AtatEvent` (`atat.ts`); `EdiDetail` (`supabase.ts`); `TimeMode` (`time.ts`).
- Produces:
  - `useReceptacleTimeline(s9: string | null, deps?): { loading, error, detail, events }`
    where `deps` is the existing `AtatPageDeps` shape (moved here).
  - `AtatView({ s9, detail, events, initialMode }: { s9: string; detail: EdiDetail | null; events:
    AtatEvent[]; initialMode?: TimeMode })` — owns the `mode` toggle, renders `ReceptacleHeader` +
    switch + `AtatTimeline`/empty state.
  - `AtatPage` unchanged public shape `AtatPage({ s9, deps? })`.

- [ ] **Step 1: Write the failing `AtatView` test**

Create `leg2-reporting/src/components/AtatView.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AtatView } from "@/components/AtatView";
import type { AtatEvent } from "@/lib/atat";

const ev: AtatEvent = {
  source: "EDI", code: "RESDES", label: "Arrival", location: "JPKWSA", direction: "inbound",
  fields: [], eventDatetimeUtc: "2026-05-01T23:30:00+00:00", eventDatetimeLocal: "2026-05-02T08:30:00",
  localZone: "Asia/Tokyo", tzResolved: true, rawDate: "Fri,02-05-2026 08:30",
  sortKey: Date.parse("2026-05-01T23:30:00+00:00"),
};

describe("AtatView", () => {
  it("defaults to UTC and toggles to Local", () => {
    render(<AtatView s9="ABC" detail={null} events={[ev]} />);
    expect(screen.getByText("01 May 2026 (Fri), 23:30:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("02 May 2026 (Sat), 08:30:00")).toBeInTheDocument();
  });

  it("honors initialMode", () => {
    render(<AtatView s9="ABC" detail={null} events={[ev]} initialMode="local" />);
    expect(screen.getByText("02 May 2026 (Sat), 08:30:00")).toBeInTheDocument();
  });

  it("shows the empty state with no events", () => {
    render(<AtatView s9="ABC" detail={null} events={[]} />);
    expect(screen.getByText(/No events found/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/AtatView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the hook**

Create `leg2-reporting/src/hooks/useReceptacleTimeline.ts`:

```ts
import { useEffect, useMemo, useState } from "react";
import {
  fetchEdiEvents, fetchEdiDetails, fetchMovementsByS9, supabase,
  type EdiEvent, type EdiDetail, type RfidMovement,
} from "@/lib/supabase";
import { buildAtatTimeline, type AtatEvent } from "@/lib/atat";

export interface ReceptacleTimelineDeps {
  fetchMovements: (s9: string, token?: string) => Promise<RfidMovement[]>;
  fetchEvents: (s9: string, token?: string) => Promise<EdiEvent[]>;
  fetchDetails: (s9: string, token?: string) => Promise<EdiDetail | null>;
  getToken: () => Promise<string | undefined>;
}

export const defaultTimelineDeps: ReceptacleTimelineDeps = {
  fetchMovements: (s9, token) => fetchMovementsByS9(s9, token ? { token } : {}),
  fetchEvents: (s9, token) => fetchEdiEvents(s9, token ? { token } : {}),
  fetchDetails: (s9, token) => fetchEdiDetails(s9, token ? { token } : {}),
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
};

export function useReceptacleTimeline(
  s9: string | null,
  deps: ReceptacleTimelineDeps = defaultTimelineDeps
): { loading: boolean; error: string | null; detail: EdiDetail | null; events: AtatEvent[] } {
  const [movements, setMovements] = useState<RfidMovement[]>([]);
  const [ediEvents, setEdiEvents] = useState<EdiEvent[]>([]);
  const [detail, setDetail] = useState<EdiDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = !!s9 && s9.length > 0;

  useEffect(() => {
    if (!active) {
      setMovements([]); setEdiEvents([]); setDetail(null); setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await deps.getToken();
        const [mv, ev, dt] = await Promise.all([
          deps.fetchMovements(s9!, token),
          deps.fetchEvents(s9!, token),
          deps.fetchDetails(s9!, token),
        ]);
        if (cancelled) return;
        setMovements(mv); setEdiEvents(ev); setDetail(dt);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [active, s9, deps]);

  const events = useMemo(() => buildAtatTimeline(movements, ediEvents), [movements, ediEvents]);
  return { loading, error, detail, events };
}
```

- [ ] **Step 4: Create `AtatView.tsx`**

```tsx
import { useState } from "react";
import type { AtatEvent } from "@/lib/atat";
import type { EdiDetail } from "@/lib/supabase";
import type { TimeMode } from "@/lib/time";
import { ReceptacleHeader } from "@/components/ReceptacleHeader";
import { AtatTimeline } from "@/components/AtatTimeline";
import { strings } from "@/i18n/strings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function AtatView({
  s9, detail, events, initialMode = "utc",
}: {
  s9: string;
  detail: EdiDetail | null;
  events: AtatEvent[];
  initialMode?: TimeMode;
}) {
  const [mode, setMode] = useState<TimeMode>(initialMode);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <ReceptacleHeader s9={s9} detail={detail} />
        <div className="ml-4 flex shrink-0 items-center gap-2">
          <Label htmlFor="atat-tz">{strings.timeMode.utc}</Label>
          <Switch
            id="atat-tz"
            checked={mode === "local"}
            onCheckedChange={(c) => setMode(c ? "local" : "utc")}
          />
          <Label htmlFor="atat-tz">{strings.timeMode.local}</Label>
        </div>
      </div>
      {events.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{strings.atat.noEvents}</p>
      ) : (
        <AtatTimeline events={events} mode={mode} />
      )}
    </div>
  );
}
```

(Note: `ReceptacleHeader` renders its own bottom border; the flex wrapper keeps the toggle aligned
to the top-right. Acceptable — do not restructure `ReceptacleHeader`.)

- [ ] **Step 5: Refactor `AtatPage.tsx` to use the hook + `AtatView`**

```tsx
import { useState } from "react";
import { useReceptacleTimeline, defaultTimelineDeps, type ReceptacleTimelineDeps } from "@/hooks/useReceptacleTimeline";
import { AtatView } from "@/components/AtatView";
import { receptacleHash } from "@/lib/hashRoute";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SearchBox() {
  const [value, setValue] = useState("");
  const submit = () => {
    const s9 = value.trim();
    if (s9) window.location.hash = receptacleHash(s9);
  };
  return (
    <div className="mx-auto mt-16 max-w-md">
      <Label htmlFor="atat-s9">{strings.atat.searchLabel}</Label>
      <div className="mt-2 flex gap-2">
        <Input
          id="atat-s9"
          value={value}
          placeholder={strings.atat.searchPlaceholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <Button onClick={submit}>{strings.atat.open}</Button>
      </div>
    </div>
  );
}

export default function AtatPage({
  s9, deps = defaultTimelineDeps,
}: {
  s9: string | null;
  deps?: ReceptacleTimelineDeps;
}) {
  const active = !!s9 && s9.length > 0;
  const { loading, error, detail, events } = useReceptacleTimeline(active ? s9 : null, deps);

  if (!active) return <SearchBox />;

  return (
    <div className="mx-auto max-w-4xl p-4">
      {loading && <p className="text-sm text-muted-foreground">{strings.states.loading}</p>}
      {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}
      {!loading && !error && <AtatView s9={s9!} detail={detail} events={events} />}
    </div>
  );
}
```

- [ ] **Step 6: Update `AtatPage.test.tsx`**

The page's `deps` shape is unchanged (same four functions), so the existing load test still works if
its `deps` object matches `ReceptacleTimelineDeps`. Update the import if the test referenced
`AtatPageDeps` (now removed): replace any `AtatPageDeps` type import with `ReceptacleTimelineDeps`
from `@/hooks/useReceptacleTimeline`. The three existing tests (search navigates; renders header +
row; empty state) remain valid — the rendered timestamp text now comes from `formatIso`; if a test
asserted an exact old-format time string, update it to the `formatIso` output (e.g.
`"01 May 2026 (Fri), 23:30:00"`). Keep the search and empty-state assertions as-is.

- [ ] **Step 7: Run tests + type-check**

Run: `pnpm test -- src/components/AtatView.test.tsx src/pages/AtatPage.test.tsx`
Expected: PASS.

Run: `pnpm check`
Expected: clean (all consumers now use the reshaped `AtatEvent` + `mode`).

- [ ] **Step 8: Commit**

```bash
git add leg2-reporting/src/hooks/useReceptacleTimeline.ts leg2-reporting/src/components/AtatView.tsx leg2-reporting/src/components/AtatView.test.tsx leg2-reporting/src/pages/AtatPage.tsx leg2-reporting/src/pages/AtatPage.test.tsx
git commit -m "feat(leg2-atat): extract AtatView + timeline hook; UTC/Local toggle"
```

---

## Task 7: `AtatDialog` modal from the report

**Files:**
- Create: `leg2-reporting/src/components/AtatDialog.tsx`
- Modify: `leg2-reporting/src/pages/RfidEventsPage.tsx`
- Test: `leg2-reporting/src/components/AtatDialog.test.tsx`

**Interfaces:**
- Consumes: `useReceptacleTimeline`, `defaultTimelineDeps`, `ReceptacleTimelineDeps` (Task 6);
  `AtatView` (Task 6); shadcn `Dialog` primitives; `TimeMode`.
- Produces: `AtatDialog({ s9, open, onOpenChange, initialMode, deps }: { s9: string | null; open:
  boolean; onOpenChange: (o: boolean) => void; initialMode?: TimeMode; deps?: ReceptacleTimelineDeps })`.

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/components/AtatDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AtatDialog } from "@/components/AtatDialog";

const deps = {
  fetchMovements: vi.fn().mockResolvedValue([]),
  fetchEvents: vi.fn().mockResolvedValue([
    { message: "RESDES", event: "Arrival", date: "Fri,02-05-2026 08:30", location: "JPKWSA",
      transport: null, transport_date: null, reference: null,
      event_datetime_local: "2026-05-02T08:30:00", event_datetime_utc: "2026-05-01T23:30:00+00:00",
      resolved_zone: "Asia/Tokyo", tz_resolved: true },
  ]),
  fetchDetails: vi.fn().mockResolvedValue(null),
  getToken: vi.fn().mockResolvedValue("tok"),
};

describe("AtatDialog", () => {
  it("loads and renders the timeline when open", async () => {
    render(<AtatDialog s9="ABC" open onOpenChange={() => {}} deps={deps} />);
    await waitFor(() => expect(screen.getByText("RESDES")).toBeInTheDocument());
    expect(screen.getByText("ABC")).toBeInTheDocument();
  });

  it("renders nothing visible when closed", () => {
    render(<AtatDialog s9="ABC" open={false} onOpenChange={() => {}} deps={deps} />);
    expect(screen.queryByText("RESDES")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/AtatDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `AtatDialog.tsx`**

```tsx
import { useReceptacleTimeline, defaultTimelineDeps, type ReceptacleTimelineDeps } from "@/hooks/useReceptacleTimeline";
import { AtatView } from "@/components/AtatView";
import { strings } from "@/i18n/strings";
import type { TimeMode } from "@/lib/time";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function AtatDialog({
  s9, open, onOpenChange, initialMode = "utc", deps = defaultTimelineDeps,
}: {
  s9: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialMode?: TimeMode;
  deps?: ReceptacleTimelineDeps;
}) {
  // Only fetch while open with an s9.
  const { loading, error, detail, events } = useReceptacleTimeline(open ? s9 : null, deps);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{strings.atat.title}</DialogTitle>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">{strings.states.loading}</p>}
        {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}
        {!loading && !error && s9 && (
          <AtatView s9={s9} detail={detail} events={events} initialMode={initialMode} />
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/AtatDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the report's S9 click to open the dialog**

In `leg2-reporting/src/pages/RfidEventsPage.tsx`:
1. Remove the `import { receptacleHash } from "@/lib/hashRoute";` line.
2. Add imports: `import { AtatDialog } from "@/components/AtatDialog";`.
3. Add state: `const [dialogS9, setDialogS9] = useState<string | null>(null);`
4. Change the pivot handler from navigation to opening the dialog:
   `onSelectS9={(s9) => setDialogS9(s9)}` and `selectedS9={dialogS9}`.
5. Render the dialog, passing the report's current `timeMode` as `initialMode`:

```tsx
      <AtatDialog
        s9={dialogS9}
        open={dialogS9 !== null}
        onOpenChange={(o) => { if (!o) setDialogS9(null); }}
        initialMode={timeMode}
      />
```

Resulting `RfidEventsPage.tsx`:

```tsx
import { useState } from "react";
import { useRfidEventsReport } from "@/hooks/useRfidEventsReport";
import { ReportFilters } from "@/components/ReportFilters";
import { RfidEventsPivot } from "@/components/RfidEventsPivot";
import { ReaderEditorDialog } from "@/components/ReaderEditorDialog";
import { AtatDialog } from "@/components/AtatDialog";
import { strings } from "@/i18n/strings";
import type { TimeMode } from "@/lib/time";

export default function RfidEventsPage() {
  const {
    loading, error, report, hasIncidents, readerMap, filter, setFilter, originOptions, destOptions,
    dateRange, setDateRange, applyPreset, reload,
  } = useRfidEventsReport();
  const [timeMode, setTimeMode] = useState<TimeMode>("utc");
  const [editorLpi, setEditorLpi] = useState<string | null>(null);
  const [dialogS9, setDialogS9] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b bg-background px-4 py-3">
        <ReportFilters
          filter={filter}
          setFilter={setFilter}
          originOptions={originOptions}
          destOptions={destOptions}
          hasIncidents={hasIncidents}
          timeMode={timeMode}
          onTimeModeChange={setTimeMode}
          dateRange={dateRange}
          onDateChange={setDateRange}
          onApplyPreset={applyPreset}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {loading && <p className="text-sm text-muted-foreground">{strings.states.loading}</p>}
        {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}

        {!loading && !error && (
          <section className="border rounded-md">
            <RfidEventsPivot
              report={report}
              timeMode={timeMode}
              selectedS9={dialogS9}
              onSelectS9={(s9) => setDialogS9(s9)}
              onSelectReader={setEditorLpi}
              readerMap={readerMap}
            />
          </section>
        )}
      </div>

      <AtatDialog
        s9={dialogS9}
        open={dialogS9 !== null}
        onOpenChange={(o) => { if (!o) setDialogS9(null); }}
        initialMode={timeMode}
      />

      <ReaderEditorDialog
        open={editorLpi !== null}
        onOpenChange={(o) => { if (!o) setEditorLpi(null); }}
        reader={editorLpi ? readerMap.get(editorLpi) ?? null : null}
        onApplied={() => { reload(); }}
      />
    </div>
  );
}
```

(The nav item **Receptacle (ATAT)** and the search box in `App.tsx` still route to the full-page
`AtatPage` via the hash — unchanged. Only the report's S9 click switches to the modal.)

- [ ] **Step 6: Run the full suite, type-check, build**

Run: `pnpm test`
Expected: entire suite green (existing + new). `App.test.tsx` still passes (routing unchanged).

Run: `pnpm check` → clean. Run: `pnpm build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add leg2-reporting/src/components/AtatDialog.tsx leg2-reporting/src/components/AtatDialog.test.tsx leg2-reporting/src/pages/RfidEventsPage.tsx
git commit -m "feat(leg2-atat): open ATAT as a modal from the report (page stays for nav/search)"
```

- [ ] **Step 8: Manual smoke test (real app)**

```bash
cd leg2-reporting && pnpm dev   # http://localhost:3100
```

Sign in (`leg2-report-test@holahal.com` / `Leg2Report!2026`) and verify:
1. Report → click an S9 → **modal** opens with the merged timeline; close → back to the list with
   filters intact.
2. Toggle **UTC/Local** in the modal → every row's time and zone badge switch; EDI resolved rows
   show their IANA zone in Local and `UTC` in UTC; RFID and EDI use the same date format.
3. Nav **Receptacle (ATAT)** → search `INBOMAJPKWSAAUY60597001100039` → full page renders the same
   view; JPKWSA EDI events show Asia/Tokyo local and correct UTC.
4. Look for any `no TZ` badge — with the full seed there should be none except null/unparseable dates.

---

## Self-Review

**1. Spec coverage:**
- §3.1 `edi_location_timezone` (per-site, 92 rows, RLS) → Task 1. ✅
- §3.2 `vw_edi_events_tz` (parse, resolve, UTC, tz_resolved) + §3.3 `vw_edi_locations_unresolved` → Task 2. ✅
- §4 client reads view, EdiEvent fields, sort by UTC, unified format → Tasks 3, 4. ✅
- §5 #1 toggle (Task 6 AtatView), #2 modal (Task 7), #3 separated timestamp + zone badge (Task 5),
  #4 unified format (Task 4 formatIso), zone clarity/`no TZ` (Tasks 4/5). ✅
- §6 maintenance (unresolved view) → Task 2 + manual step. ✅
- §7 edge cases (unparseable/null → no TZ, sorted last; modal preserves list) → Tasks 4/5/7. ✅
- §8 testing → each task's tests + Task 7 full suite/build. ✅
- §9 out of scope respected (no GMS sourcing, no materialized column, no seed editor). ✅

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; the seed is fully enumerated. ✅

**3. Type consistency:** `AtatEvent` reshaped in Task 4 and consumed identically in Tasks 5, 6, 7
(`eventDatetimeUtc`, `eventDatetimeLocal`, `localZone`, `tzResolved`, `sortKey`, `rawDate`).
`EdiEvent` fields (Task 3) match `EdiEventInput` (Task 4) and the view columns (Task 2).
`ReceptacleTimelineDeps` (Task 6) replaces the old `AtatPageDeps`; Tasks 6/7 both use it.
`formatIso` (Task 4) consumed in Task 5. `mode: TimeMode` threaded AtatView→AtatTimeline→AtatEventRow.
The removed `parseEdiDate` has no remaining consumers (Task 4 deletes its tests). ✅

One ordering caveat noted inline: after Task 4, `pnpm check` is red until Task 5/6 update the row and
page. This is expected in subagent-driven execution (each task's own tests pass; the whole-branch
type-check is green by Task 6/7). Commit boundaries are per-task; the branch is type-clean at Task 6+.
