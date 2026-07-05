# ATAT — Receptacle Event Timeline (Design Spec)

**Date:** 2026-07-05
**Project:** EDGE Leg2 (`leg2-reporting/`), Supabase Leg2 `ubgatxfwpmyaqyfrwias`
**Status:** Design approved (brainstorming). Next: implementation plan (writing-plans).
**Branch:** `feat/leg2-atat-receptacle-timeline` (from `main` @ `88a1fb9`).

Continuation of [[edge-leg2-rfid-events-report]] / [[leg2-edi-gap-detection-feature]].

---

## 1. Goal

A per-receptacle **ATAT** screen: a single chronological timeline that **merges RFID
movements and EDI events** for one S9 receptacle, ordered by event time, with receptacle
details from `edi_details` shown under the code and every event's details rendered
**inline** (no expand button).

Visual target: the production "RECEPTACLE" timeline (colored code badge + description +
location per row, vertical time axis). We build it from the data we actually have
(our RFID movements + our `edi_events`); some codes in the reference image, e.g. `POD`,
do not exist in our `edi_events` and simply won't appear.

## 2. Architecture (Approach A — client-side merge, no schema for the app)

All merge/dedup/sort logic lives in pure, unit-tested TS modules in `leg2-reporting/`.
No new DB views. The only DB change is a prerequisite RLS policy (Section 9). This
mirrors the existing report, whose pivot is also computed client-side. Per-receptacle
volume is tiny (~7 EDI rows + a few RFID movements), so client-side merge is trivial.

### Navigation

The app currently has no router (`App.tsx` renders `LoginPage` or `RfidEventsPage`).
Add a **minimal hash-based view switch** — no `react-router` dependency:

- `#/` (default) → **RFID Events** (existing report, behavior unchanged).
- `#/receptacle/<s9>` → **ATAT** timeline for that receptacle.
- A two-item nav in the existing header: **RFID Events** and **Receptacle (ATAT)**.
  The ATAT nav entry with no code shows a **search box** (enter/paste S9 → navigate to
  `#/receptacle/<code>`).
- In the report, the S9 receptacle code becomes a link → `#/receptacle/<code>`. This
  **replaces** the click-to-open RFID-only `EventDetailsDialog` as the primary
  drill-down. `EventDetailsDialog`/`EventDetailsTable` remain in the tree for now
  (not deleted) but are no longer wired to the S9 click.

Auth/session unchanged: ATAT is behind the same auth gate and uses the same Supabase
client and user `access_token`.

## 3. Data layer (`src/lib/supabase.ts`)

New fetchers, same paged/auth pattern as `fetchRfidMovements`, each filtered by one
`s9code`/`s9_id`:

- `fetchEdiEvents(s9, deps): Promise<EdiEvent[]>` — `edi_events?s9code=eq.<s9>`,
  select `message,event,date,location,transport,transport_date,reference`.
- `fetchEdiDetails(s9, deps): Promise<EdiDetail | null>` — `edi_details?s9code=eq.<s9>`,
  select all fields; return first row or `null`.
- `fetchMovementsByS9(s9, deps): Promise<RfidMovement[]>` — the movements view filtered
  by `s9_id=eq.<s9>`, **no date bound** (ATAT is per-receptacle, any date).

New types:

```ts
export interface EdiEvent {
  message: string | null;
  event: string | null;
  date: string | null;         // free text, multiple formats (see §5)
  location: string | null;
  transport: string | null;
  transport_date: string | null;
  reference: string | null;
}

export interface EdiDetail {
  s9code: string;
  origin_office: string | null;
  destination_office: string | null;
  mail_category: string | null;
  mail_subclass: string | null;
  rec_no: string | null;
  gross_weight: string | null;
  items: string | null;
}
```

## 4. Direction catalog (`src/lib/ediDirection.ts`)

Maps an event **code** → `"outbound" | "inbound"`. Drives the EDI dedup rule (§5).

- **Outbound (origin-side)** — keep the **last** occurrence on dedup:
  `PREDES`, `PRECON`, `CARDIT`; RFID `2000`, `2300`, `2320`.
- **Inbound (destination-side)** — keep the **first** occurrence on dedup:
  `RESDES`, `RESCON`, `POD`, and every `RESDIT*` sub-code
  (`RESDIT6/14/21/23/24/40/48/74`); RFID `2400`, `2410`, `2420`.
- **Unknown codes** (e.g. `EMC`, `null`) → default `"inbound"` (keep-first). Documented
  default; a `RESDIT` prefix match covers future numeric RESDIT sub-codes.

```ts
export type EdiDirection = "outbound" | "inbound";
export function directionForCode(code: string | null): EdiDirection;
```

## 5. Merge / dedup / sort (`src/lib/atat.ts`, pure)

### `parseEdiDate(raw: string | null): { date: Date | null; display: string }`

Handles the formats seen in `edi_events.date`:

- `"Ddd,DD-MM-YYYY HH:MM"` (e.g. `"Fri,01-05-2026 18:26"`) — the common case.
- ISO date-only `"YYYY-MM-DD"` (e.g. `"2026-07-01"`) — time defaults to `00:00`.
- Anything else / null → `date: null`, `display` = the raw string (or `""`).

Dates are treated as **naive wall-clock** (no timezone). Rationale: the EDI value has no
zone or seconds; postal S9/EMSEVT timestamps are local time of the reporting office; we
could not triangulate a zone from the data (the one co-located check had RFID and EDI
events days apart). **Explicit assumption — revisit if the EDI zone is later confirmed.**

### `AtatEvent` (unified shape)

```ts
export interface AtatEvent {
  source: "RFID" | "EDI";
  code: string;                 // "2400", "RESDES", …
  label: string;                // human description
  timestamp: Date | null;       // naive wall-clock; null → sorts last
  rawDate: string;              // original string for display
  location: string | null;
  direction: EdiDirection;
  fields: Array<{ label: string; value: string }>; // all non-empty source fields, inline
}
```

### `buildAtatTimeline(movements: RfidMovement[], edi: EdiEvent[]): AtatEvent[]`

1. Normalize each RFID movement → `AtatEvent` (`source:"RFID"`, `code = edi_equivalent
   ?? movement_type`, timestamp from `event_datetime_local` parsed as naive wall-clock,
   `fields` = reader LPI/gate, facility, city/country, tag_id, handover flag, exact
   time — non-empty only). RFID movements are already collapsed → **no dedup**.
2. Normalize each EDI row → `AtatEvent` (`source:"EDI"`, `code = message`, `label =
   event`, timestamp from `parseEdiDate`, `fields` = location, transport, transport_date,
   reference — non-empty only).
3. **Dedup EDI by `code`**: group repeats of the same `message`; for outbound codes keep
   the occurrence with the latest timestamp, for inbound keep the earliest. Ties / null
   timestamps: keep the first encountered (stable).
4. Concatenate RFID + deduped EDI; **sort ascending by `timestamp`**, nulls last, stable.

Zero React/Supabase imports → fully unit-testable.

## 6. Hash routing (`src/lib/hashRoute.ts`, pure)

```ts
export type Route = { name: "report" } | { name: "receptacle"; s9: string };
export function parseHash(hash: string): Route;      // "#/receptacle/ABC" → {receptacle, "ABC"}
export function receptacleHash(s9: string): string;  // "ABC" → "#/receptacle/ABC"
```

Trims/encodes the S9; malformed or empty → `{ name: "report" }`. `App.tsx` subscribes to
`hashchange` and renders the matching page.

## 7. UI components

- **`src/pages/AtatPage.tsx`** — reads S9 from the route. No S9 → **search box** (input +
  submit → `receptacleHash`). With S9 → runs the three fetches in parallel, builds the
  timeline, renders header + timeline. Loading / error / empty states mirror the report.
- **`src/components/ReceptacleHeader.tsx`** — the code (large, monospace) + copy button;
  beneath it, **all `edi_details` fields** as labeled pairs. No `edi_details` row →
  "sin detalle" note plus origin→destination parsed from the S9 (chars 1–6 / 7–12, always
  available).
- **`src/components/AtatTimeline.tsx`** + **`src/components/AtatEventRow.tsx`** — vertical
  timeline. Each row: left = timestamp (naive wall-clock) + date; a colored **code badge**
  (RFID vs EDI styled distinctly) + **label**; right = **location**; a small **source tag**
  (RFID/EDI). **Inline beneath the main line:** all remaining non-empty `fields` for that
  event — always shown, no expand button (requirement #5). Empty fields omitted.

Reuses shadcn/ui primitives, Tailwind v4, and i18n `strings.ts` (new `atat` block, English
UI copy consistent with the app).

## 8. Error handling & edge cases

- No data at all (no RFID, no EDI) → clear "no events found for `<code>`" state.
- RFID-only or EDI-only receptacle → render whichever exists (both common in the data).
- Unparseable EDI date → row still shown, sorted last, raw date displayed.
- Missing `edi_details` → S9-derived origin/destination fallback + note.
- Bad/whitespace S9 in search → trimmed; empty → inline validation, no navigation.
- Fetch failure (incl. RLS denial) → error state with the message (report pattern).

## 9. Prerequisite — RLS policy (confirmation-gated Supabase write)

`edi_events` and `edi_details` have RLS enabled with policies that grant **only the
`anon` role** (`anon_all_edi_events`, `anon_all_edi_details`, `cmd=ALL`, `qual=true`).
The app authenticates users and queries as role **`authenticated`**, which currently
returns **zero rows** (verified empirically with the Leg2 test user: both endpoints
return `[]`).

**Required change on Leg2 `ubgatxfwpmyaqyfrwias`:** add a permissive `SELECT` RLS policy
for `authenticated` on both tables, e.g.:

```sql
create policy authenticated_select_edi_events on public.edi_events
  for select to authenticated using (true);
create policy authenticated_select_edi_details on public.edi_details
  for select to authenticated using (true);
```

This is a write to the Leg2 database. Per the anti-confusion rule, it is applied **only
after explicitly confirming project = EDGE Leg2, ref = `ubgatxfwpmyaqyfrwias`** with the
user. It is the first task in the plan and gates the component work (the fetchers cannot
return data without it).

## 10. Testing

- `atat.test.ts` — dedup (outbound→last / inbound→first, unknown-code default), date
  parsing (both formats + unparseable), merge ordering (nulls last, stable), RFID+EDI mix.
- `ediDirection.test.ts` — every known code classified; unknown default; RESDIT-prefix.
- `hashRoute.test.ts` — parse/format round-trips, malformed hashes.
- Component tests (RTL/jsdom): `AtatPage` (search → navigate; loads & renders),
  `ReceptacleHeader` (all fields; missing-detail fallback), `AtatEventRow` (inline
  fields; empties omitted; source styling).
- Supabase fetcher tests with mocked `fetch`, mirroring `supabase.test.ts`.

## 11. Out of scope (YAGNI)

- No timezone reconciliation beyond naive wall-clock (revisit only if the EDI zone is
  confirmed).
- No raw-read drill-down under RFID movements (representative movements only).
- No editing of EDI/receptacle data from ATAT (read-only screen).
- No `react-router` / build-tooling changes.
