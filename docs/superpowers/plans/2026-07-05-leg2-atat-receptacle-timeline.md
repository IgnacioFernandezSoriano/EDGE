# ATAT Receptacle Event Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-receptacle ATAT screen that merges RFID movements and EDI events into one chronological timeline, with receptacle details under the code and every event's fields rendered inline.

**Architecture:** Client-side merge (Approach A). Pure, unit-tested TS modules (`ediDirection.ts`, `atat.ts`, `hashRoute.ts`) compute the timeline; new fetchers in `supabase.ts` load `edi_events`, `edi_details`, and movements-by-s9; new React components render a search box, receptacle header, and vertical timeline. Minimal hash-based routing in `App.tsx` — no new dependencies. One prerequisite DB change: an RLS SELECT policy for `authenticated` on the two EDI tables.

**Tech Stack:** Vite 7, React 19, TypeScript 5.6, Tailwind v4, shadcn/ui, Vitest + @testing-library/react (jsdom), pnpm. Supabase Leg2 `ubgatxfwpmyaqyfrwias` (PostgREST + Auth).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-leg2-atat-receptacle-timeline-design.md`. Branch: `feat/leg2-atat-receptacle-timeline`.
- All work is under `leg2-reporting/`. Run tests from that directory: `pnpm test -- <path>`. Type-check: `pnpm check`.
- No new npm dependencies. No `react-router`. No new DB views.
- Times are **naive wall-clock**: never construct sort timestamps with runtime-local `new Date(str)`; build them with `Date.UTC(...)` from parsed integer components so ordering is timezone-independent. Display stays component/string based (never re-derive display from a runtime-local Date).
- All user-facing copy is **English**, added to `src/i18n/strings.ts` (new `atat` block). Never hard-code UI strings in components.
- Path alias `@/` maps to `leg2-reporting/src/`.
- EDI dedup rule: collapse repeats by event code; **outbound** codes keep the **latest** occurrence, **inbound** codes keep the **earliest**. RFID movements are already collapsed — never dedup them.
- Direction catalog: OUTBOUND = `PREDES, PRECON, CARDIT, 2000, 2300, 2320`; INBOUND = `RESDES, RESCON, POD, 2400, 2410, 2420, RESDIT*`; unknown/null → `inbound` (documented default).
- Supabase writes (Task 1 only) require explicit confirmation of **project = EDGE Leg2, ref = `ubgatxfwpmyaqyfrwias`** before applying. Never infer the project.

---

## File Structure

- `leg2-reporting/sql/atat_edi_rls.sql` — **create** — RLS SELECT policies for `authenticated` on `edi_events`/`edi_details` (Task 1).
- `leg2-reporting/src/lib/ediDirection.ts` (+`.test.ts`) — **create** — code→direction catalog (Task 2).
- `leg2-reporting/src/lib/atat.ts` (+`.test.ts`) — **create** — `parseEdiDate`, normalizers, dedup, `buildAtatTimeline` (Task 3, 4).
- `leg2-reporting/src/lib/hashRoute.ts` (+`.test.ts`) — **create** — parse/format the URL hash (Task 5).
- `leg2-reporting/src/lib/supabase.ts` — **modify** — new types + fetchers (Task 6). Test in `supabase.test.ts`.
- `leg2-reporting/src/i18n/strings.ts` — **modify** — `atat` string block (Task 7, used onward).
- `leg2-reporting/src/components/ReceptacleHeader.tsx` (+`.test.tsx`) — **create** — code + `edi_details` block (Task 7).
- `leg2-reporting/src/components/AtatEventRow.tsx` (+`.test.tsx`) — **create** — one timeline row, inline fields (Task 8).
- `leg2-reporting/src/components/AtatTimeline.tsx` — **create** — maps events to rows (Task 8).
- `leg2-reporting/src/pages/AtatPage.tsx` (+`.test.tsx`) — **create** — search + load + render (Task 9).
- `leg2-reporting/src/App.tsx` — **modify** — hash routing + nav (Task 10).
- `leg2-reporting/src/pages/RfidEventsPage.tsx` — **modify** — S9 click navigates to ATAT (Task 10).

---

## Task 1: RLS SELECT policy for authenticated on EDI tables (prerequisite)

**Files:**
- Create: `leg2-reporting/sql/atat_edi_rls.sql`

**Interfaces:**
- Produces: authenticated read access to `public.edi_events` and `public.edi_details` (fetchers in Task 6 depend on this returning rows).

**Context:** `edi_events`/`edi_details` have RLS enabled with policies granting only the `anon` role. The app queries as `authenticated`, so today both return `[]` (verified). This task adds a permissive SELECT policy for `authenticated`. **This is a Supabase write — confirm project = EDGE Leg2, ref = `ubgatxfwpmyaqyfrwias` with the user before applying.**

- [ ] **Step 1: Write the SQL file**

Create `leg2-reporting/sql/atat_edi_rls.sql`:

```sql
-- ATAT: allow the authenticated report role to read EDI data.
-- edi_events/edi_details have RLS enabled with anon-only policies; the app
-- queries as `authenticated`, which otherwise returns zero rows.
-- Project: EDGE Leg2 (ubgatxfwpmyaqyfrwias).

create policy authenticated_select_edi_events
  on public.edi_events
  for select
  to authenticated
  using (true);

create policy authenticated_select_edi_details
  on public.edi_details
  for select
  to authenticated
  using (true);
```

- [ ] **Step 2: Confirm the target project, then apply**

Ask the user to confirm: "Apply to EDGE Leg2, ref `ubgatxfwpmyaqyfrwias`?" After explicit confirmation, apply the SQL via the Management API query endpoint (scratchpad `apply.mjs`/`q.mjs` with the Leg2 PAT and ref `ubgatxfwpmyaqyfrwias`), running the contents of `atat_edi_rls.sql`.

- [ ] **Step 3: Verify authenticated reads now return rows**

Sign in as the Leg2 test user and confirm both endpoints return data (scratchpad `signin.mjs` prints the token):

```bash
TOKEN=$(node signin.mjs)
KEY="sb_publishable_diwQpIw5WRugkXdthHyipw_IGrDk95a"
curl -s "https://ubgatxfwpmyaqyfrwias.supabase.co/rest/v1/edi_events?s9code=eq.INBOMAJPKWSAAUY60597001100039&select=message,date" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN"
curl -s "https://ubgatxfwpmyaqyfrwias.supabase.co/rest/v1/edi_details?s9code=eq.INBOMAJPKWSAAUY60597001100039&select=origin_office,items" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN"
```

Expected: `edi_events` returns a non-empty JSON array (7 rows for that s9); `edi_details` returns one row. Both were `[]` before this task.

- [ ] **Step 4: Commit**

```bash
git add leg2-reporting/sql/atat_edi_rls.sql
git commit -m "feat(leg2-atat): RLS select policy for authenticated on EDI tables"
```

---

## Task 2: Direction catalog (`ediDirection.ts`)

**Files:**
- Create: `leg2-reporting/src/lib/ediDirection.ts`
- Test: `leg2-reporting/src/lib/ediDirection.test.ts`

**Interfaces:**
- Produces: `type EdiDirection = "outbound" | "inbound"`; `function directionForCode(code: string | null): EdiDirection`.

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/lib/ediDirection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { directionForCode } from "@/lib/ediDirection";

describe("directionForCode", () => {
  it("classifies origin-side codes as outbound", () => {
    for (const c of ["PREDES", "PRECON", "CARDIT", "2000", "2300", "2320"]) {
      expect(directionForCode(c)).toBe("outbound");
    }
  });

  it("classifies destination-side codes as inbound", () => {
    for (const c of ["RESDES", "RESCON", "POD", "2400", "2410", "2420"]) {
      expect(directionForCode(c)).toBe("inbound");
    }
  });

  it("treats every RESDIT sub-code as inbound", () => {
    for (const c of ["RESDIT6", "RESDIT14", "RESDIT21", "RESDIT74"]) {
      expect(directionForCode(c)).toBe("inbound");
    }
  });

  it("defaults unknown and null codes to inbound", () => {
    expect(directionForCode("EMC")).toBe("inbound");
    expect(directionForCode(null)).toBe("inbound");
    expect(directionForCode("")).toBe("inbound");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/ediDirection.test.ts`
Expected: FAIL — cannot import `directionForCode` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `leg2-reporting/src/lib/ediDirection.ts`:

```ts
export type EdiDirection = "outbound" | "inbound";

const OUTBOUND = new Set(["PREDES", "PRECON", "CARDIT", "2000", "2300", "2320"]);
const INBOUND = new Set(["RESDES", "RESCON", "POD", "2400", "2410", "2420"]);

/**
 * Direction of an event code, used to dedup repeated EDI messages
 * (outbound -> keep latest, inbound -> keep earliest) and to tag rows.
 * Unknown/null codes default to "inbound" (keep-earliest) by convention.
 */
export function directionForCode(code: string | null): EdiDirection {
  if (!code) return "inbound";
  if (OUTBOUND.has(code)) return "outbound";
  if (INBOUND.has(code)) return "inbound";
  if (code.startsWith("RESDIT")) return "inbound";
  return "inbound";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/ediDirection.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/ediDirection.ts leg2-reporting/src/lib/ediDirection.test.ts
git commit -m "feat(leg2-atat): EDI direction catalog"
```

---

## Task 3: EDI date parsing (`atat.ts` — parseEdiDate)

**Files:**
- Create: `leg2-reporting/src/lib/atat.ts`
- Test: `leg2-reporting/src/lib/atat.test.ts`

**Interfaces:**
- Produces: `function parseEdiDate(raw: string | null): { date: Date | null; display: string }`. `date` is built with `Date.UTC` from parsed components (naive, tz-independent, used only for ordering); `display` is the trimmed original string (or `""`).

**Context:** `edi_events.date` appears in two formats: `"Fri,01-05-2026 18:26"` (Ddd,DD-MM-YYYY HH:MM) and ISO date-only `"2026-07-01"`. Anything else → unparseable.

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/lib/atat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseEdiDate } from "@/lib/atat";

describe("parseEdiDate", () => {
  it("parses the day-prefixed DD-MM-YYYY HH:MM format", () => {
    const { date, display } = parseEdiDate("Fri,01-05-2026 18:26");
    expect(display).toBe("Fri,01-05-2026 18:26");
    expect(date).not.toBeNull();
    // 2026-05-01 18:26 as a UTC-built instant
    expect(date!.getTime()).toBe(Date.UTC(2026, 4, 1, 18, 26));
  });

  it("parses ISO date-only with midnight time", () => {
    const { date } = parseEdiDate("2026-07-01");
    expect(date!.getTime()).toBe(Date.UTC(2026, 6, 1, 0, 0));
  });

  it("returns null date for unparseable input, keeping the raw display", () => {
    const { date, display } = parseEdiDate("not a date");
    expect(date).toBeNull();
    expect(display).toBe("not a date");
  });

  it("handles null and empty input", () => {
    expect(parseEdiDate(null)).toEqual({ date: null, display: "" });
    expect(parseEdiDate("   ")).toEqual({ date: null, display: "" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/atat.test.ts`
Expected: FAIL — cannot import `parseEdiDate`.

- [ ] **Step 3: Write minimal implementation**

Create `leg2-reporting/src/lib/atat.ts`:

```ts
const EDI_DATE_RE = /^[A-Za-z]{3},(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse an edi_events.date string. Two formats occur in the data:
 *   "Fri,01-05-2026 18:26"  (Ddd,DD-MM-YYYY HH:MM)
 *   "2026-07-01"            (ISO date only -> midnight)
 * The returned Date is built with Date.UTC from the integer components so it
 * is a naive, timezone-independent instant used ONLY for ordering. `display`
 * is the original trimmed string. Unparseable -> date: null.
 */
export function parseEdiDate(raw: string | null): { date: Date | null; display: string } {
  const s = (raw ?? "").trim();
  if (!s) return { date: null, display: "" };
  const m1 = EDI_DATE_RE.exec(s);
  if (m1) {
    const [, dd, mm, yyyy, hh, mi] = m1;
    return { date: new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi)), display: s };
  }
  const m2 = ISO_DATE_RE.exec(s);
  if (m2) {
    const [, yyyy, mm, dd] = m2;
    return { date: new Date(Date.UTC(+yyyy, +mm - 1, +dd, 0, 0)), display: s };
  }
  return { date: null, display: s };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/atat.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/atat.ts leg2-reporting/src/lib/atat.test.ts
git commit -m "feat(leg2-atat): parse edi_events date formats"
```

---

## Task 4: Merge, normalize, dedup, sort (`atat.ts` — buildAtatTimeline)

**Files:**
- Modify: `leg2-reporting/src/lib/atat.ts`
- Test: `leg2-reporting/src/lib/atat.test.ts`

**Interfaces:**
- Consumes: `parseEdiDate` (Task 3); `directionForCode`, `EdiDirection` (Task 2); `checkpointLabel` from `@/lib/checkpoints`; `formatTimestamp` from `@/lib/time`; `RfidMovement`, `EdiEvent` from `@/lib/supabase` (types; `EdiEvent` is added in Task 6 — declare a local structural type in this task so it does not depend on Task 6's ordering, see below).
- Produces:
  - `interface AtatField { label: string; value: string }`
  - `interface AtatEvent { source: "RFID" | "EDI"; code: string; label: string; timestamp: Date | null; displayTime: string; rawDate: string; location: string | null; direction: EdiDirection; fields: AtatField[] }`
  - `function buildAtatTimeline(movements: RfidMovement[], edi: EdiEventInput[]): AtatEvent[]`

**Note on the EDI input type:** to avoid a circular dependency on Task 6, define the input shape locally in `atat.ts` as `EdiEventInput` (structurally identical to the `EdiEvent` type Task 6 exports). Task 6's `EdiEvent` is assignable to it.

- [ ] **Step 1: Write the failing test**

Append to `leg2-reporting/src/lib/atat.test.ts`:

```ts
import { buildAtatTimeline, type AtatEvent } from "@/lib/atat";
import type { RfidMovement } from "@/lib/supabase";

function mov(partial: Partial<RfidMovement>): RfidMovement {
  return {
    movement_id: "m", s9_id: "S", tag_id: "T", reader_id: "R",
    movement_type: "INBOUND", route_country_role: null, edi_equivalent: "2400",
    origin_country_code: null, destination_country_code: null,
    movement_country_code: null, country_sequence_number: null,
    event_datetime_utc: "2026-05-02T00:00:00.000",
    event_datetime_local: "2026-05-02T09:00:00.000",
    reader_timezone: "Asia/Tokyo", site_impc_code: "JPKWSA", centre_code: "JPKWSA",
    site_name: "Kawasaki", city: "Kawasaki", country_code: "JP",
    handover_point: false, handover_quality_status: null, ...partial,
  };
}
function edi(partial: Record<string, string | null>) {
  return {
    message: null, event: null, date: null, location: null,
    transport: null, transport_date: null, reference: null, ...partial,
  };
}

describe("buildAtatTimeline", () => {
  it("merges RFID + EDI and sorts ascending by naive wall-clock", () => {
    const events = buildAtatTimeline(
      [mov({ edi_equivalent: "2400", event_datetime_local: "2026-05-02T09:00:00.000" })],
      [edi({ message: "PREDES", event: "Dispatch close", date: "Fri,01-05-2026 18:26" })]
    );
    expect(events.map((e) => e.code)).toEqual(["PREDES", "2400"]);
    expect(events[0].source).toBe("EDI");
    expect(events[1].source).toBe("RFID");
  });

  it("dedups an outbound EDI code to its latest occurrence", () => {
    const events = buildAtatTimeline([], [
      edi({ message: "CARDIT", date: "Fri,01-05-2026 10:00" }),
      edi({ message: "CARDIT", date: "Fri,01-05-2026 20:00" }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].rawDate).toBe("Fri,01-05-2026 20:00");
  });

  it("dedups an inbound EDI code to its earliest occurrence", () => {
    const events = buildAtatTimeline([], [
      edi({ message: "RESDIT6", date: "Fri,01-05-2026 20:00" }),
      edi({ message: "RESDIT6", date: "Fri,01-05-2026 10:00" }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].rawDate).toBe("Fri,01-05-2026 10:00");
  });

  it("puts events with unparseable dates last, stably", () => {
    const events = buildAtatTimeline([], [
      edi({ message: "RESDES", date: "bad" }),
      edi({ message: "RESCON", date: "2026-05-01" }),
    ]);
    expect(events.map((e) => e.code)).toEqual(["RESCON", "RESDES"]);
  });

  it("includes only non-empty fields, labeled, per source", () => {
    const [e] = buildAtatTimeline([], [
      edi({ message: "RESDES", event: "Arrival", date: "2026-05-01", location: "KRSELB", reference: "X", transport: null }),
    ]);
    const labels = e.fields.map((f) => f.label);
    expect(labels).toContain("Location");
    expect(labels).toContain("Reference");
    expect(labels).not.toContain("Transport"); // null -> omitted
  });

  it("labels RFID rows with the checkpoint name and carries inline reader fields", () => {
    const [e] = buildAtatTimeline([mov({ edi_equivalent: "2400", reader_id: "R9", tag_id: "TAG1" })], []);
    expect(e.label).toBe("Entry Inbound AMU");
    const kv = Object.fromEntries(e.fields.map((f) => [f.label, f.value]));
    expect(kv["Reader"]).toBe("R9");
    expect(kv["RFID Tag"]).toBe("TAG1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/atat.test.ts`
Expected: FAIL — `buildAtatTimeline` not exported.

- [ ] **Step 3: Write the implementation**

Append to `leg2-reporting/src/lib/atat.ts`:

```ts
import type { RfidMovement } from "@/lib/supabase";
import { directionForCode, type EdiDirection } from "@/lib/ediDirection";
import { checkpointLabel } from "@/lib/checkpoints";
import { formatTimestamp } from "@/lib/time";
import { strings } from "@/i18n/strings";

/** Structural shape of an edi_events row (matches EdiEvent from supabase.ts). */
export interface EdiEventInput {
  message: string | null;
  event: string | null;
  date: string | null;
  location: string | null;
  transport: string | null;
  transport_date: string | null;
  reference: string | null;
}

export interface AtatField {
  label: string;
  value: string;
}

export interface AtatEvent {
  source: "RFID" | "EDI";
  code: string;
  label: string;
  timestamp: Date | null;
  displayTime: string;
  rawDate: string;
  location: string | null;
  direction: EdiDirection;
  fields: AtatField[];
}

const RFID_TS_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/** Naive local timestamp -> tz-independent ordering instant (Date.UTC of components). */
function rfidTimestamp(raw: string | null): Date | null {
  const m = RFID_TS_RE.exec(raw ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
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
    timestamp: rfidTimestamp(m.event_datetime_local),
    displayTime: formatTimestamp(m, "local"),
    rawDate: m.event_datetime_local,
    location: m.site_impc_code ?? m.centre_code ?? null,
    direction: directionForCode(code),
    fields: nonEmpty([
      [strings.atat.fieldMovementType, m.movement_type],
      [strings.atat.fieldReader, m.reader_id],
      [strings.atat.fieldFacility, m.site_name],
      [strings.atat.fieldCity, m.city],
      [strings.atat.fieldCountry, m.country_code],
      [strings.atat.fieldTag, m.tag_id],
      [strings.atat.fieldHandover, m.handover_point ? strings.common.yes : null],
      [strings.atat.fieldUtc, m.event_datetime_utc],
    ]),
  };
}

function normalizeEdi(e: EdiEventInput): AtatEvent {
  const { date, display } = parseEdiDate(e.date);
  const code = e.message ?? "";
  return {
    source: "EDI",
    code,
    label: e.event ?? code,
    timestamp: date,
    displayTime: display,
    rawDate: display,
    location: e.location,
    direction: directionForCode(e.message),
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
    const withTs = g.filter((x) => x.timestamp !== null);
    if (withTs.length === 0) return g[0];
    const dir = g[0].direction;
    return withTs.reduce((best, cur) => {
      const b = best.timestamp!.getTime();
      const c = cur.timestamp!.getTime();
      return dir === "outbound" ? (c > b ? cur : best) : (c < b ? cur : best);
    });
  });
}

/** Merge RFID movements + EDI events into one chronological timeline. */
export function buildAtatTimeline(
  movements: RfidMovement[],
  edi: EdiEventInput[]
): AtatEvent[] {
  const rfid = movements.map(normalizeRfid);
  const ediEvents = dedupeEdi(edi.map(normalizeEdi));
  return [...rfid, ...ediEvents]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ta = a.e.timestamp;
      const tb = b.e.timestamp;
      if (ta && tb) {
        const d = ta.getTime() - tb.getTime();
        return d !== 0 ? d : a.i - b.i;
      }
      if (ta) return -1;
      if (tb) return 1;
      return a.i - b.i;
    })
    .map(({ e }) => e);
}
```

Note: this task imports `strings.atat.*`. Task 7 adds that block. To keep Task 4 self-contained and green, **add the `atat` string block now** (it is listed as a Task 7 file but needed here) — see Task 7 Step 3 for the exact block; add it to `src/i18n/strings.ts` as part of this task's implementation step and let Task 7 assume it exists. (If executing strictly in order, add the `atat` block here.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/atat.test.ts`
Expected: PASS (all parseEdiDate + buildAtatTimeline tests).

- [ ] **Step 5: Type-check and commit**

```bash
pnpm check
git add leg2-reporting/src/lib/atat.ts leg2-reporting/src/lib/atat.test.ts leg2-reporting/src/i18n/strings.ts
git commit -m "feat(leg2-atat): merge/dedup/sort RFID+EDI into a timeline"
```

---

## Task 5: Hash routing (`hashRoute.ts`)

**Files:**
- Create: `leg2-reporting/src/lib/hashRoute.ts`
- Test: `leg2-reporting/src/lib/hashRoute.test.ts`

**Interfaces:**
- Produces:
  - `type Route = { name: "report" } | { name: "receptacle"; s9: string }` (s9 may be `""` → show the search box)
  - `function parseHash(hash: string): Route`
  - `function receptacleHash(s9: string): string`

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/lib/hashRoute.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseHash, receptacleHash } from "@/lib/hashRoute";

describe("parseHash", () => {
  it("defaults to the report", () => {
    expect(parseHash("")).toEqual({ name: "report" });
    expect(parseHash("#/")).toEqual({ name: "report" });
    expect(parseHash("#/something-else")).toEqual({ name: "report" });
  });

  it("routes to a receptacle with a decoded, trimmed s9", () => {
    expect(parseHash("#/receptacle/INBOMAJPKWSAAUY60597001100039"))
      .toEqual({ name: "receptacle", s9: "INBOMAJPKWSAAUY60597001100039" });
    expect(parseHash("#/receptacle/AB%20CD")).toEqual({ name: "receptacle", s9: "AB CD" });
  });

  it("routes to receptacle with empty s9 (search box) when no code given", () => {
    expect(parseHash("#/receptacle")).toEqual({ name: "receptacle", s9: "" });
    expect(parseHash("#/receptacle/")).toEqual({ name: "receptacle", s9: "" });
  });
});

describe("receptacleHash", () => {
  it("builds an encoded hash and round-trips", () => {
    const h = receptacleHash("  ABC 1  ");
    expect(h).toBe("#/receptacle/ABC%201");
    expect(parseHash(h)).toEqual({ name: "receptacle", s9: "ABC 1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/hashRoute.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `leg2-reporting/src/lib/hashRoute.ts`:

```ts
export type Route = { name: "report" } | { name: "receptacle"; s9: string };

const RECEPTACLE_RE = /^#\/receptacle(?:\/(.*))?$/;

export function parseHash(hash: string): Route {
  const m = RECEPTACLE_RE.exec(hash);
  if (m) {
    const s9 = decodeURIComponent(m[1] ?? "").trim();
    return { name: "receptacle", s9 };
  }
  return { name: "report" };
}

export function receptacleHash(s9: string): string {
  return `#/receptacle/${encodeURIComponent(s9.trim())}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/hashRoute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/hashRoute.ts leg2-reporting/src/lib/hashRoute.test.ts
git commit -m "feat(leg2-atat): hash-based receptacle routing"
```

---

## Task 6: Data fetchers (`supabase.ts`)

**Files:**
- Modify: `leg2-reporting/src/lib/supabase.ts`
- Test: `leg2-reporting/src/lib/supabase.test.ts`

**Interfaces:**
- Consumes: existing `fetchAllPages`, `resolveAuth`, `FetchDeps`, `SELECT_COLS`, `SUPABASE_URL` in `supabase.ts`.
- Produces:
  - `interface EdiEvent { message, event, date, location, transport, transport_date, reference: string | null }`
  - `interface EdiDetail { s9code: string; origin_office, destination_office, mail_category, mail_subclass, rec_no, gross_weight, items: string | null }`
  - `const EDI_EVENTS_SELECT_COLS: string`, `const EDI_DETAILS_SELECT_COLS: string`
  - `function buildEdiEventsUrl(baseUrl, { s9, offset, limit }): string`
  - `function fetchEdiEvents(s9: string, deps?: FetchDeps): Promise<EdiEvent[]>`
  - `function fetchEdiDetails(s9: string, deps?: FetchDeps): Promise<EdiDetail | null>`
  - `function fetchMovementsByS9(s9: string, deps?: FetchDeps): Promise<RfidMovement[]>`

- [ ] **Step 1: Write the failing test**

Append to `leg2-reporting/src/lib/supabase.test.ts`:

```ts
import {
  buildEdiEventsUrl, fetchEdiEvents, fetchEdiDetails, fetchMovementsByS9,
  EDI_EVENTS_SELECT_COLS,
} from "@/lib/supabase";

const EDI_BASE = "https://x.supabase.co/rest/v1/edi_events";
const DETAIL_BASE = "https://x.supabase.co/rest/v1/edi_details";
const MOV_BASE = "https://x.supabase.co/rest/v1/vw_quicksight_rfid_report_movements";

describe("buildEdiEventsUrl", () => {
  it("filters by s9code and selects the event columns", () => {
    const url = buildEdiEventsUrl(EDI_BASE, { s9: "ABC", offset: 0, limit: 1000 });
    expect(url).toContain("s9code=eq.ABC");
    expect(url).toContain("select=");
    expect(EDI_EVENTS_SELECT_COLS).toContain("transport_date");
  });
});

describe("fetchEdiEvents", () => {
  it("returns the rows for the s9", async () => {
    const rows = [{ message: "RESDES" }];
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
    const out = await fetchEdiEvents("ABC", {
      fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: EDI_BASE,
    });
    expect(out).toEqual(rows);
    expect(fetchFn.mock.calls[0][0]).toContain("s9code=eq.ABC");
  });

  it("throws on non-ok response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "no grant" });
    await expect(fetchEdiEvents("ABC", {
      fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: EDI_BASE,
    })).rejects.toThrow(/403/);
  });
});

describe("fetchEdiDetails", () => {
  it("returns the single row or null", async () => {
    const withRow = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ s9code: "ABC", items: "12" }] });
    expect(await fetchEdiDetails("ABC", {
      fetchFn: withRow as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: DETAIL_BASE,
    })).toEqual({ s9code: "ABC", items: "12" });

    const empty = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    expect(await fetchEdiDetails("ABC", {
      fetchFn: empty as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: DETAIL_BASE,
    })).toBeNull();
  });
});

describe("fetchMovementsByS9", () => {
  it("filters the movements view by s9_id", async () => {
    const rows = [{ movement_id: "m1" }];
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
    const out = await fetchMovementsByS9("ABC", {
      fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: MOV_BASE,
    });
    expect(out).toEqual(rows);
    expect(fetchFn.mock.calls[0][0]).toContain("s9_id=eq.ABC");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/supabase.test.ts`
Expected: FAIL — new exports not found.

- [ ] **Step 3: Write the implementation**

Add to `leg2-reporting/src/lib/supabase.ts` (after the existing reader-master section):

```ts
export interface EdiEvent {
  message: string | null;
  event: string | null;
  date: string | null;
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

const EDI_EVENTS_VIEW = "edi_events";
const EDI_DETAILS_VIEW = "edi_details";
export const EDI_EVENTS_SELECT_COLS = [
  "message", "event", "date", "location", "transport", "transport_date", "reference",
].join(",");
export const EDI_DETAILS_SELECT_COLS = [
  "s9code", "origin_office", "destination_office", "mail_category",
  "mail_subclass", "rec_no", "gross_weight", "items",
].join(",");

export function buildEdiEventsUrl(
  baseUrl: string,
  opts: { s9: string; offset: number; limit: number }
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", EDI_EVENTS_SELECT_COLS);
  url.searchParams.set("s9code", `eq.${opts.s9}`);
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("limit", String(opts.limit));
  return url.toString();
}

export async function fetchEdiEvents(s9: string, deps: FetchDeps = {}): Promise<EdiEvent[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${EDI_EVENTS_VIEW}`;
  return fetchAllPages<EdiEvent>(
    (offset, limit) => buildEdiEventsUrl(baseUrl, { s9, offset, limit }),
    fetchFn,
    headers,
    "Leg2 edi_events fetch"
  );
}

export async function fetchEdiDetails(s9: string, deps: FetchDeps = {}): Promise<EdiDetail | null> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${EDI_DETAILS_VIEW}`;
  const url = new URL(baseUrl);
  url.searchParams.set("select", EDI_DETAILS_SELECT_COLS);
  url.searchParams.set("s9code", `eq.${s9}`);
  url.searchParams.set("limit", "1");
  const res = await fetchFn(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`Leg2 edi_details fetch failed: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as EdiDetail[];
  return rows[0] ?? null;
}

export function buildMovementsByS9Url(
  baseUrl: string,
  opts: { s9: string; offset: number; limit: number }
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", SELECT_COLS);
  url.searchParams.set("s9_id", `eq.${opts.s9}`);
  url.searchParams.set("order", "event_datetime_utc.asc");
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("limit", String(opts.limit));
  return url.toString();
}

export async function fetchMovementsByS9(s9: string, deps: FetchDeps = {}): Promise<RfidMovement[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${VIEW}`;
  return fetchAllPages<RfidMovement>(
    (offset, limit) => buildMovementsByS9Url(baseUrl, { s9, offset, limit }),
    fetchFn,
    headers,
    "Leg2 movements-by-s9 fetch"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/supabase.test.ts`
Expected: PASS (existing + new tests).

- [ ] **Step 5: Type-check and commit**

```bash
pnpm check
git add leg2-reporting/src/lib/supabase.ts leg2-reporting/src/lib/supabase.test.ts
git commit -m "feat(leg2-atat): fetchers for edi_events, edi_details, movements-by-s9"
```

---

## Task 7: i18n strings + ReceptacleHeader

**Files:**
- Modify: `leg2-reporting/src/i18n/strings.ts` (if not already added in Task 4)
- Create: `leg2-reporting/src/components/ReceptacleHeader.tsx`
- Test: `leg2-reporting/src/components/ReceptacleHeader.test.tsx`

**Interfaces:**
- Consumes: `EdiDetail` from `@/lib/supabase`; `deriveOrigPoCode`, `deriveDestPoCode` from `@/lib/s9`; `strings.atat`.
- Produces: `function ReceptacleHeader({ s9, detail }: { s9: string; detail: EdiDetail | null }): JSX.Element`.

- [ ] **Step 1: Add the `atat` string block** (skip if already added in Task 4)

In `leg2-reporting/src/i18n/strings.ts`, add inside the `strings` object (before the closing `states` block or after it):

```ts
  atat: {
    title: "Receptacle timeline",
    navReport: "RFID Events",
    navReceptacle: "Receptacle (ATAT)",
    searchLabel: "Receptacle (S9) code",
    searchPlaceholder: "Enter or paste an S9 code",
    open: "Open",
    copy: "Copy",
    copied: "Copied",
    noDetail: "No receptacle detail available.",
    noEvents: "No events found for this receptacle.",
    origin: "Origin office",
    destination: "Destination office",
    mailCategory: "Mail category",
    mailSubclass: "Mail subclass",
    recNo: "Receptacle no.",
    grossWeight: "Gross weight",
    items: "Items",
    sourceRfid: "RFID",
    sourceEdi: "EDI",
    fieldMovementType: "Movement",
    fieldReader: "Reader",
    fieldFacility: "Facility",
    fieldCity: "City",
    fieldCountry: "Country",
    fieldTag: "RFID Tag",
    fieldHandover: "Handover",
    fieldUtc: "UTC time",
    fieldLocation: "Location",
    fieldTransport: "Transport",
    fieldTransportDate: "Transport date",
    fieldReference: "Reference",
  },
```

- [ ] **Step 2: Write the failing test**

Create `leg2-reporting/src/components/ReceptacleHeader.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReceptacleHeader } from "@/components/ReceptacleHeader";
import type { EdiDetail } from "@/lib/supabase";

const detail: EdiDetail = {
  s9code: "INBOMAJPKWSAAUY60597001100039",
  origin_office: "INBOMA", destination_office: "JPKWSA",
  mail_category: "U", mail_subclass: "A", rec_no: "39",
  gross_weight: "21.5", items: "120",
};

describe("ReceptacleHeader", () => {
  it("shows the code and all edi_details fields", () => {
    render(<ReceptacleHeader s9={detail.s9code} detail={detail} />);
    expect(screen.getByText(detail.s9code)).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("21.5")).toBeInTheDocument();
    expect(screen.getByText("INBOMA")).toBeInTheDocument();
  });

  it("falls back to S9-derived origin/destination when no detail row", () => {
    render(<ReceptacleHeader s9="INBOMAJPKWSAAUY60597001100039" detail={null} />);
    expect(screen.getByText(/No receptacle detail available/i)).toBeInTheDocument();
    expect(screen.getByText("INBOMA")).toBeInTheDocument();
    expect(screen.getByText("JPKWSA")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- src/components/ReceptacleHeader.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 4: Write the implementation**

Create `leg2-reporting/src/components/ReceptacleHeader.tsx`:

```tsx
import type { EdiDetail } from "@/lib/supabase";
import { deriveOrigPoCode, deriveDestPoCode } from "@/lib/s9";
import { strings } from "@/i18n/strings";

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

export function ReceptacleHeader({ s9, detail }: { s9: string; detail: EdiDetail | null }) {
  const t = strings.atat;
  return (
    <div className="border-b pb-4">
      <div className="font-mono text-lg font-semibold break-all">{s9}</div>
      {detail ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Pair label={t.origin} value={detail.origin_office ?? "—"} />
          <Pair label={t.destination} value={detail.destination_office ?? "—"} />
          <Pair label={t.mailCategory} value={detail.mail_category ?? "—"} />
          <Pair label={t.mailSubclass} value={detail.mail_subclass ?? "—"} />
          <Pair label={t.recNo} value={detail.rec_no ?? "—"} />
          <Pair label={t.grossWeight} value={detail.gross_weight ?? "—"} />
          <Pair label={t.items} value={detail.items ?? "—"} />
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-muted-foreground">{t.noDetail}</p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Pair label={t.origin} value={deriveOrigPoCode(s9)} />
            <Pair label={t.destination} value={deriveDestPoCode(s9)} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- src/components/ReceptacleHeader.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/i18n/strings.ts leg2-reporting/src/components/ReceptacleHeader.tsx leg2-reporting/src/components/ReceptacleHeader.test.tsx
git commit -m "feat(leg2-atat): receptacle header with edi_details block"
```

---

## Task 8: Timeline row + timeline list

**Files:**
- Create: `leg2-reporting/src/components/AtatEventRow.tsx`
- Create: `leg2-reporting/src/components/AtatTimeline.tsx`
- Test: `leg2-reporting/src/components/AtatEventRow.test.tsx`

**Interfaces:**
- Consumes: `AtatEvent` from `@/lib/atat`; `strings.atat`.
- Produces:
  - `function AtatEventRow({ event }: { event: AtatEvent }): JSX.Element`
  - `function AtatTimeline({ events }: { events: AtatEvent[] }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/components/AtatEventRow.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AtatEventRow } from "@/components/AtatEventRow";
import type { AtatEvent } from "@/lib/atat";

const base: AtatEvent = {
  source: "EDI", code: "RESDES", label: "Dispatch arrival at IOE",
  timestamp: new Date(Date.UTC(2026, 4, 1, 15, 28)), displayTime: "Fri,01-05-2026 15:28",
  rawDate: "Fri,01-05-2026 15:28", location: "KRSELB", direction: "inbound",
  fields: [
    { label: "Location", value: "KRSELB" },
    { label: "Transport", value: "SQ0612" },
  ],
};

describe("AtatEventRow", () => {
  it("renders code, label, time, location and all inline fields", () => {
    render(<AtatEventRow event={base} />);
    expect(screen.getByText("RESDES")).toBeInTheDocument();
    expect(screen.getByText("Dispatch arrival at IOE")).toBeInTheDocument();
    expect(screen.getByText("Fri,01-05-2026 15:28")).toBeInTheDocument();
    expect(screen.getByText("SQ0612")).toBeInTheDocument();
    expect(screen.getByText("KRSELB", { selector: "[data-role='location']" })).toBeInTheDocument();
  });

  it("tags the source (RFID vs EDI)", () => {
    render(<AtatEventRow event={{ ...base, source: "RFID" }} />);
    expect(screen.getByText("RFID")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/AtatEventRow.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the implementations**

Create `leg2-reporting/src/components/AtatEventRow.tsx`:

```tsx
import type { AtatEvent } from "@/lib/atat";
import { strings } from "@/i18n/strings";
import { cn } from "@/lib/utils";

export function AtatEventRow({ event }: { event: AtatEvent }) {
  const isRfid = event.source === "RFID";
  const sourceLabel = isRfid ? strings.atat.sourceRfid : strings.atat.sourceEdi;
  return (
    <div className="relative flex gap-4 pb-6">
      {/* time column */}
      <div className="w-36 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {event.displayTime || event.rawDate}
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

Create `leg2-reporting/src/components/AtatTimeline.tsx`:

```tsx
import type { AtatEvent } from "@/lib/atat";
import { AtatEventRow } from "@/components/AtatEventRow";

export function AtatTimeline({ events }: { events: AtatEvent[] }) {
  return (
    <div className="mt-4">
      {events.map((e, i) => (
        <AtatEventRow key={`${e.source}-${e.code}-${e.rawDate}-${i}`} event={e} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/AtatEventRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/components/AtatEventRow.tsx leg2-reporting/src/components/AtatTimeline.tsx leg2-reporting/src/components/AtatEventRow.test.tsx
git commit -m "feat(leg2-atat): timeline row and list components"
```

---

## Task 9: AtatPage (search + load + render)

**Files:**
- Create: `leg2-reporting/src/pages/AtatPage.tsx`
- Test: `leg2-reporting/src/pages/AtatPage.test.tsx`

**Interfaces:**
- Consumes: `fetchEdiEvents`, `fetchEdiDetails`, `fetchMovementsByS9`, `supabase` from `@/lib/supabase`; `buildAtatTimeline` from `@/lib/atat`; `receptacleHash` from `@/lib/hashRoute`; `ReceptacleHeader`, `AtatTimeline`; `strings.atat`.
- Produces: `export default function AtatPage({ s9 }: { s9: string | null })`. When `s9` is null/empty → search box; otherwise loads and renders the timeline.

**Note:** the fetches need the user token. Follow the pattern in `useRfidEventsReport.ts`: `const { data } = await supabase.auth.getSession(); const token = data.session?.access_token;` then pass `token ? { token } : {}` to each fetcher. In tests, inject a `deps` prop (see below) to avoid hitting Supabase.

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/pages/AtatPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AtatPage from "@/pages/AtatPage";

beforeEach(() => {
  window.location.hash = "";
});

describe("AtatPage search", () => {
  it("navigates to the receptacle hash on submit", () => {
    render(<AtatPage s9={null} />);
    const input = screen.getByLabelText(/Receptacle .* code/i);
    fireEvent.change(input, { target: { value: "  INBOMAJPKWSAAUY60597001100039 " } });
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(window.location.hash).toBe("#/receptacle/INBOMAJPKWSAAUY60597001100039");
  });
});

describe("AtatPage load", () => {
  const deps = {
    fetchMovements: vi.fn().mockResolvedValue([]),
    fetchEvents: vi.fn().mockResolvedValue([
      { message: "RESDES", event: "Dispatch arrival at IOE", date: "Fri,01-05-2026 15:28",
        location: "KRSELB", transport: "SQ0612", transport_date: null, reference: null },
    ]),
    fetchDetails: vi.fn().mockResolvedValue({
      s9code: "ABC", origin_office: "INBOMA", destination_office: "JPKWSA",
      mail_category: "U", mail_subclass: "A", rec_no: "1", gross_weight: "2", items: "3",
    }),
    getToken: vi.fn().mockResolvedValue("tok"),
  };

  it("renders the header and a timeline row", async () => {
    render(<AtatPage s9="ABC" deps={deps} />);
    await waitFor(() => expect(screen.getByText("RESDES")).toBeInTheDocument());
    expect(screen.getByText("ABC")).toBeInTheDocument();
    expect(screen.getByText("Dispatch arrival at IOE")).toBeInTheDocument();
  });

  it("shows an empty state when there are no events", async () => {
    render(<AtatPage s9="ZZZ" deps={{ ...deps,
      fetchEvents: vi.fn().mockResolvedValue([]),
      fetchDetails: vi.fn().mockResolvedValue(null),
    }} />);
    await waitFor(() => expect(screen.getByText(/No events found/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/pages/AtatPage.test.tsx`
Expected: FAIL — page not found.

- [ ] **Step 3: Write the implementation**

Create `leg2-reporting/src/pages/AtatPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import {
  fetchEdiEvents, fetchEdiDetails, fetchMovementsByS9, supabase,
  type EdiEvent, type EdiDetail, type RfidMovement,
} from "@/lib/supabase";
import { buildAtatTimeline } from "@/lib/atat";
import { receptacleHash } from "@/lib/hashRoute";
import { ReceptacleHeader } from "@/components/ReceptacleHeader";
import { AtatTimeline } from "@/components/AtatTimeline";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Injectable dependencies for testing without hitting Supabase. */
export interface AtatPageDeps {
  fetchMovements: (s9: string, token?: string) => Promise<RfidMovement[]>;
  fetchEvents: (s9: string, token?: string) => Promise<EdiEvent[]>;
  fetchDetails: (s9: string, token?: string) => Promise<EdiDetail | null>;
  getToken: () => Promise<string | undefined>;
}

const defaultDeps: AtatPageDeps = {
  fetchMovements: (s9, token) => fetchMovementsByS9(s9, token ? { token } : {}),
  fetchEvents: (s9, token) => fetchEdiEvents(s9, token ? { token } : {}),
  fetchDetails: (s9, token) => fetchEdiDetails(s9, token ? { token } : {}),
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
};

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

export default function AtatPage({ s9, deps = defaultDeps }: { s9: string | null; deps?: AtatPageDeps }) {
  const [movements, setMovements] = useState<RfidMovement[]>([]);
  const [events, setEvents] = useState<EdiEvent[]>([]);
  const [detail, setDetail] = useState<EdiDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = !!s9 && s9.length > 0;

  useEffect(() => {
    if (!active) return;
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
        setMovements(mv);
        setEvents(ev);
        setDetail(dt);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [active, s9, deps]);

  const timeline = useMemo(() => buildAtatTimeline(movements, events), [movements, events]);

  if (!active) return <SearchBox />;

  return (
    <div className="mx-auto max-w-4xl p-4">
      {loading && <p className="text-sm text-muted-foreground">{strings.states.loading}</p>}
      {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}
      {!loading && !error && (
        <>
          <ReceptacleHeader s9={s9!} detail={detail} />
          {timeline.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">{strings.atat.noEvents}</p>
          ) : (
            <AtatTimeline events={timeline} />
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/pages/AtatPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/pages/AtatPage.tsx leg2-reporting/src/pages/AtatPage.test.tsx
git commit -m "feat(leg2-atat): AtatPage with search, load, and timeline render"
```

---

## Task 10: Wire routing + nav + report S9 link

**Files:**
- Modify: `leg2-reporting/src/App.tsx`
- Modify: `leg2-reporting/src/pages/RfidEventsPage.tsx`
- Test: `leg2-reporting/src/App.test.tsx` (create)

**Interfaces:**
- Consumes: `parseHash`, `receptacleHash`, `type Route` from `@/lib/hashRoute`; `AtatPage`; existing `RfidEventsPage`, `AuthProvider`, `useAuth`.
- Produces: hash-driven view switch + a two-item nav; the report's S9 click navigates to `#/receptacle/<s9>`.

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/App.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Force an authenticated session so the Gate renders the app, not the login page.
vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({ session: { user: { email: "t@example.com" } }, user: { email: "t@example.com" }, isLoading: false, signOut: vi.fn() }),
}));

// Keep the report page cheap: stub the data hook.
vi.mock("@/hooks/useRfidEventsReport", () => ({
  useRfidEventsReport: () => ({
    loading: false, error: null,
    report: { rows: [], columns: [], hasNoEventCodeOutbound: false, hasNoEventCodeInbound: false },
    hasIncidents: false, readerMap: new Map(), filter: { onlyNoEventCode: false },
    setFilter: vi.fn(), originOptions: [], destOptions: [],
    dateRange: { from: "2026-01-01", to: "2026-12-31" }, setDateRange: vi.fn(),
    applyPreset: vi.fn(), reload: vi.fn(),
  }),
}));

import App from "@/App";

beforeEach(() => { window.location.hash = ""; });

describe("App routing", () => {
  it("shows the report by default and the ATAT search when navigating", async () => {
    render(<App />);
    expect(screen.getByText(/RFID events/i)).toBeInTheDocument();
    window.location.hash = "#/receptacle";
    fireEvent(window, new HashChangeEvent("hashchange"));
    await waitFor(() =>
      expect(screen.getByLabelText(/Receptacle .* code/i)).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/App.test.tsx`
Expected: FAIL — App renders only `RfidEventsPage` (no routing / no search box on hash change).

- [ ] **Step 3: Update `App.tsx`**

Replace `leg2-reporting/src/App.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/LoginPage";
import RfidEventsPage from "@/pages/RfidEventsPage";
import AtatPage from "@/pages/AtatPage";
import { parseHash, type Route } from "@/lib/hashRoute";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

function Nav({ route }: { route: Route }) {
  const go = (hash: string) => { window.location.hash = hash; };
  return (
    <nav className="flex items-center gap-1">
      <Button
        variant={route.name === "report" ? "default" : "outline"}
        size="sm"
        onClick={() => go("#/")}
      >
        {strings.atat.navReport}
      </Button>
      <Button
        variant={route.name === "receptacle" ? "default" : "outline"}
        size="sm"
        onClick={() => go("#/receptacle")}
      >
        {strings.atat.navReceptacle}
      </Button>
    </nav>
  );
}

function Gate() {
  const { session, isLoading, signOut, user } = useAuth();
  const route = useRoute();
  if (isLoading)
    return <div className="min-h-screen flex items-center justify-center">{strings.states.loading}</div>;
  if (!session) return <LoginPage />;

  return (
    <div className="h-screen flex flex-col">
      <header className="shrink-0 flex items-center justify-between gap-4 p-4 border-b">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold">{strings.appTitle}</h1>
          <Nav route={route} />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{user?.email}</span>
          <Button variant="outline" size="sm" onClick={() => signOut()}>{strings.auth.signOut}</Button>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-auto">
        {route.name === "receptacle"
          ? <AtatPage s9={route.s9 || null} />
          : <RfidEventsPage />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
```

- [ ] **Step 4: Update `RfidEventsPage.tsx` to navigate on S9 click**

`RfidEventsPage` currently owns its own header and opens `EventDetailsDialog`. Since `App` now provides the header/nav, and the S9 click should navigate to ATAT:

1. Add the import: `import { receptacleHash } from "@/lib/hashRoute";`
2. Remove the page's own `<header>...</header>` block (now rendered by `App`'s `Gate`) and the outer `h-screen flex flex-col` wrapper — return just the filters + table region. Keep the `ReaderEditorDialog`.
3. Change the pivot handler from opening the dialog to navigating:
   - Replace `onSelectS9={setSelectedS9}` with `onSelectS9={(s9) => { window.location.hash = receptacleHash(s9); }}`.
4. Remove the now-unused `EventDetailsDialog` usage, the `selectedS9` state, the `detail` memo, and the `useEffect` that clears `selectedS9`. Keep `editorLpi`/`ReaderEditorDialog`. Pass `selectedS9={null}` to the pivot (highlight not needed after navigation).

Resulting `RfidEventsPage.tsx`:

```tsx
import { useState } from "react";
import { useRfidEventsReport } from "@/hooks/useRfidEventsReport";
import { ReportFilters } from "@/components/ReportFilters";
import { RfidEventsPivot } from "@/components/RfidEventsPivot";
import { ReaderEditorDialog } from "@/components/ReaderEditorDialog";
import { receptacleHash } from "@/lib/hashRoute";
import { strings } from "@/i18n/strings";
import type { TimeMode } from "@/lib/time";

export default function RfidEventsPage() {
  const {
    loading, error, report, hasIncidents, readerMap, filter, setFilter, originOptions, destOptions,
    dateRange, setDateRange, applyPreset, reload,
  } = useRfidEventsReport();
  const [timeMode, setTimeMode] = useState<TimeMode>("utc");
  const [editorLpi, setEditorLpi] = useState<string | null>(null);

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
              selectedS9={null}
              onSelectS9={(s9) => { window.location.hash = receptacleHash(s9); }}
              onSelectReader={setEditorLpi}
              readerMap={readerMap}
            />
          </section>
        )}
      </div>

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

- [ ] **Step 5: Run the App test + full suite + type-check**

Run: `pnpm test -- src/App.test.tsx`
Expected: PASS.

Run: `pnpm test`
Expected: entire suite green (existing + new). `EventDetailsDialog.test.tsx` still passes (component unchanged, just unwired).

Run: `pnpm check`
Expected: no type errors. If `EventDetailsDialog`/`EventDetailsTable` imports are now unused anywhere, that is fine — the components remain in the tree per the spec; do not delete them.

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/App.tsx leg2-reporting/src/pages/RfidEventsPage.tsx leg2-reporting/src/App.test.tsx
git commit -m "feat(leg2-atat): hash routing, nav, and S9-to-ATAT navigation"
```

- [ ] **Step 7: Manual smoke test (real app)**

Start the dev server and drive it as a user:

```bash
cd leg2-reporting && pnpm dev   # http://localhost:3100
```

Verify in the browser (sign in with `leg2-report-test@holahal.com` / `Leg2Report!2026`):
1. Default view is the RFID Events report; the header shows the two-item nav.
2. Click a receptacle (S9) code in the report → URL becomes `#/receptacle/<code>`, the ATAT page loads, header shows `edi_details`, and the timeline shows merged RFID + EDI events in chronological order.
3. Click **Receptacle (ATAT)** in the nav with no code → search box; paste `INBOMAJPKWSAAUY60597001100039` → **Open** → timeline renders (this s9 has 7 EDI events + 1 detail row).
4. Try a receptacle with RFID but no EDI, and one with neither, to confirm the empty/partial states.

Expected: the timeline merges both sources, EDI codes are deduped per the direction rule, and events are ordered by time. (If EDI rows are missing, re-check Task 1 applied.)

---

## Self-Review

**1. Spec coverage:**
- §2 navigation (hash routing, two-item nav, S9 link replaces dialog) → Tasks 5, 10. ✅
- §3 data layer (three fetchers, types) → Task 6; RLS prerequisite → Task 1. ✅
- §4 direction catalog → Task 2. ✅
- §5 parseEdiDate + AtatEvent + buildAtatTimeline (normalize, dedup, sort, nulls last) → Tasks 3, 4. ✅
- §6 hash routing module → Task 5. ✅
- §7 UI (AtatPage search+load, ReceptacleHeader all fields + S9 fallback, AtatTimeline/Row inline fields, source styling) → Tasks 7, 8, 9. ✅
- §8 error/edge cases (no data, RFID-only, EDI-only, unparseable date, missing detail, bad search, fetch failure) → Tasks 3/4 (parse+null-last), 7 (fallback), 9 (empty/error states, trimmed search). ✅
- §9 RLS prerequisite → Task 1. ✅
- §10 testing → each task's tests + Task 10 full suite. ✅
- §11 out of scope respected (no react-router, no new view, read-only, naive time). ✅

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✅

**3. Type consistency:** `AtatEvent`/`AtatField` defined in Task 4 and consumed identically in Tasks 8, 9. `EdiEvent`/`EdiDetail` defined in Task 6, consumed in 7/9; Task 4 uses a local structural `EdiEventInput` to avoid ordering coupling (documented). `Route`/`parseHash`/`receptacleHash` defined in Task 5, consumed in 9, 10. `strings.atat` block added in Task 4/7 and used by 4, 7, 8, 9, 10. Fetcher signatures in Task 6 match the `defaultDeps` adapters in Task 9. ✅

One cross-task note resolved inline: the `atat` i18n block is required by Task 4 (normalizers reference `strings.atat.*`), so it is added in Task 4 and Task 7 treats it as pre-existing (Task 7 Step 1 is a no-op if already added).
