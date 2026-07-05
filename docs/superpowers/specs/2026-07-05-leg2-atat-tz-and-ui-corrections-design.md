# ATAT Corrections — EDI UTC Canonicalization + UI (Design Spec)

**Date:** 2026-07-05
**Project:** EDGE Leg2 (`leg2-reporting/`), Supabase Leg2 `ubgatxfwpmyaqyfrwias`
**Status:** Design approved (brainstorming). Next: implementation plan (writing-plans).
**Branch:** `feat/leg2-atat-tz-and-ui-corrections` (from `main` @ `3fe04d4`).

Corrections to the just-merged [[leg2-atat-receptacle-timeline]] screen. Continuation of the
timezone-canonicalization approach used in [[rfid-csv-s3-export-and-timezone-gap]] (UTC canonical,
local only for presentation).

---

## 1. Goal

Five corrections to the ATAT receptacle timeline, plus the DB sub-feature they depend on:

1. **UTC/Local toggle** in ATAT (same control as the RFID report).
2. **Modal popup** when ATAT is opened from the RFID report (close → back to the list); the
   nav/search entry stays a full page.
3. **Timestamp shown separately** in each event's detail (its own block, not an inline field).
4. **Unified date format** for RFID and EDI events (the clean RFID style, applied to EDI too).
5. *(withdrawn by the user — no fifth correction).*

**Sub-feature (enables #1/#4 and time-difference calculations): EDI UTC canonicalization in the
DB.** EDI event times are local wall-clock of the `location` office (confirmed empirically against
Japan RFID: EDI `08:30` matched Tokyo local `11:44`, not UTC `02:44`). To get a canonical UTC —
needed for correct cross-zone ordering and future duration calculations — we resolve each event's
timezone and convert in Postgres.

## 2. Architecture

Timezone conversion lives in the **database** (a self-healing view), mirroring the RFID timezone
fix. Postgres has the full IANA/DST database (`AT TIME ZONE`); the browser deliberately avoids tz
math. UTC is canonical; local + an explicit zone label are for presentation. No external API — the
only reference data is a small static seed (90 distinct location codes in the data).

**Proven SQL** (validated against Leg2):
- Parse `"Mon,16-02-2026 08:30"` → `regexp_replace(date,'^[A-Za-z]{3},','')` then
  `to_timestamp(…, 'DD-MM-YYYY HH24:MI')::timestamp` → `2026-02-16 08:30`.
- Parse ISO `"2026-07-01"` → `to_timestamp(date,'YYYY-MM-DD')::timestamp`.
- `('2026-02-16 08:30'::timestamp AT TIME ZONE 'Asia/Tokyo')` → `2026-02-15 23:30+00` (−9h). ✓

## 3. DB layer (Leg2 — confirmation-gated writes)

### 3.1 `edi_iata_timezone` (seed table)

```
iata text primary key,
iana_zone text not null
```

Seeded with the **32 IATA airport codes** present in `edi_events.location` (3-char codes), zones
from OpenFlights open data (e.g. `GRU→America/Sao_Paulo`, `BOM→Asia/Kolkata`, `ICN→Asia/Seoul`,
`HND→Asia/Tokyo`, `FRA→Europe/Berlin`, `SIN→Asia/Singapore`, …). One-time seed; a new airport is
one INSERT. Gets a `SELECT` RLS policy for `authenticated` (same pattern as `atat_edi_rls.sql`).

### 3.2 `vw_edi_events_tz` (self-healing view over `edi_events`)

Per row, exposes the original columns plus:
- `event_datetime_local timestamp` — parsed naive wall-clock (both text formats; unparseable → null).
- `resolved_zone text` — IANA zone:
  - `location` length 6 (IMPC office) → `left(location,2)` country → `rfid_timezone_map.iana_zone`
    (prefer a `city`-specific row if one exists, else the country row with `city is null`),
  - `location` length 3 (IATA airport) → `edi_iata_timezone.iana_zone`,
  - else → `null`.
- `event_datetime_utc timestamptz` — `event_datetime_local AT TIME ZONE resolved_zone` when
  `resolved_zone` and `event_datetime_local` are both non-null; else `null`.
- `tz_resolved boolean` — `event_datetime_utc is not null`.

Serialized by PostgREST, `event_datetime_local`/`event_datetime_utc` reach the client as ISO
strings, consistent with the movements view.

### 3.3 `vw_edi_locations_unresolved`

`select distinct location from vw_edi_events_tz where not tz_resolved and location is not null`.
Surfaces new/unmapped codes so they can be corrected (detect→correct, like "No RFID event code").

## 4. Client — data + ordering

- `fetchEdiEvents` (in `supabase.ts`) reads **`vw_edi_events_tz`** instead of `edi_events`;
  `EDI_EVENTS_SELECT_COLS` adds `event_datetime_local, event_datetime_utc, resolved_zone,
  tz_resolved`. The `EdiEvent`/`EdiEventInput` types gain those fields.
- **`buildAtatTimeline` sorts by canonical UTC when available**, falling back to naive local for
  unresolved rows (retires the previous naive-wall-clock cross-zone caveat). RFID uses its UTC.
  Sort remains ascending, stable, nulls last.
- EDI normalizer carries `event_datetime_utc`/`event_datetime_local`/`resolved_zone`/`tz_resolved`
  so rows format through the **same path as RFID** (`formatTimestamp`), giving #4 for free. The
  old client-side `parseEdiDate` is retained only as a fallback for rows the view left null.

## 5. Client — UI corrections

Extract the loaded ATAT content into a reusable **`AtatView`** (header + toggle + timeline),
consumed by both `AtatPage` (full page) and a new **`AtatDialog`** (modal).

- **#1 Toggle** — `AtatView` owns `timeMode: TimeMode` (default `"utc"`) with the same switch as the
  report (`strings.timeMode`). Opened as a modal from the report, it initializes from the report's
  current mode. Both sources render via the shared `formatTimestamp(_, mode)`.
- **#2 Modal from report** — `RfidEventsPage`'s S9 click opens `<AtatDialog s9=…>` (a shadcn
  `Dialog`, large/scrollable) **instead of** setting `window.location.hash`. Closing returns to the
  list with filters intact. The nav item **Receptacle (ATAT)** and the search box keep the full-page
  hash route (`#/receptacle/<s9>`, shareable). Both render the same `AtatView`.
- **#3 Timestamp separated** — in `AtatEventRow`, the event time moves out of the inline
  key-value `fields` into its own block (own line, styled apart), showing the time in the current
  mode plus a zone badge. The RFID `UTC time` entry is removed from `fields` (it becomes the row's
  time block).
- **#4 Unified format** — both sources format via `formatTimestampParts`/`formatTimestamp`;
  identical output.
- **Zone clarity** — each row's time block carries an explicit badge: `UTC` in UTC mode; in Local
  mode the event's zone (RFID `reader_timezone`; EDI `resolved_zone`), or **`no TZ`** when
  `tz_resolved=false`. In UTC mode an unresolved EDI event shows its local value flagged `no TZ`
  (never a fabricated UTC). New i18n keys under `strings.atat` (English UI copy).

## 6. Maintenance — new offices / airports

- **Offices (6-char):** auto-resolve via country → `rfid_timezone_map`; zero maintenance. A new
  country only needs the row you already maintain there for RFID.
- **Airports (3-char):** a new code surfaces in `vw_edi_locations_unresolved` and renders `no TZ`;
  fix is one INSERT into `edi_iata_timezone` (zone from OpenFlights). No silent wrong conversion.

## 7. Error handling & edge cases

- Unparseable EDI `date` → `event_datetime_local` null → `tz_resolved` false → row still shown,
  sorted last, raw `date` text displayed, `no TZ` badge.
- `location` null → unresolved; row shown, `no TZ`.
- Multi-zone countries (BR/US/RU) resolve at country granularity — acceptable; a `city` override
  row in `rfid_timezone_map` refines when needed.
- Modal open with no data / RFID-only / EDI-only → same states as the full page.
- Report list state (filters, scroll) preserved because the modal never navigates.

## 8. Testing

- **DB:** verification queries — both date formats parse; office→country→zone; airport→seed→zone;
  unresolved→(null utc, false); a known JPKWSA row converts to UTC −9h; `vw_edi_locations_unresolved`
  lists only unmapped codes.
- **Client (Vitest/TDD):**
  - `buildAtatTimeline` orders by UTC when present, naive-local fallback, stable, nulls last.
  - EDI + RFID format identically; unresolved EDI flagged `no TZ`, never given a fake UTC.
  - `AtatView` toggle switches every row's displayed time and zone badge.
  - `AtatDialog` opens from the report S9 click and closes back to the list without losing filters.
  - `AtatEventRow` renders the timestamp as a separated block with the correct zone badge; the
    `UTC time` inline field is gone.
  - `fetchEdiEvents` targets `vw_edi_events_tz` and maps the new fields.

## 9. Out of scope (YAGNI)

- No in-app editor for the IATA seed table (correction is a one-row INSERT; surfaced by the
  unresolved view). Revisit only if new airports become frequent.
- No city-level office overrides beyond what `rfid_timezone_map` already provides.
- No duration/time-between-events UI yet — this spec only establishes the canonical UTC that such a
  feature would consume.
- No materialized column on `edi_events` (the view is canonical; revisit only if query performance
  on the view becomes a problem).
