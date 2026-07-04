# Leg2 EDI-gap — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface movements that have an RFID read but no `edi_equivalent` as two "No Event Code" columns in the pivot (outbound on the left, inbound on the right), and let the user open the GMS IOT reader master for that reader and trigger a targeted per-site reprocess from a correction dialog.

**Architecture:** Pure client logic in `src/lib` (pivot routing, deep-link builder, reprocess client) with Vitest unit tests; presentation in `src/components` (two new pivot columns + a `CorrectionDialog`) wired through `RfidEventsPage`. Data comes from the existing `vw_quicksight_rfid_report_movements` read and the new `rfid-reprocess-site` Edge Function (backend plan).

**Tech Stack:** Vite 7, React 19, TypeScript 5.6, Tailwind v4, shadcn/ui (Radix Dialog), Vitest + @testing-library/react (jsdom).

## Global Constraints

- **UI language:** English only, sourced from `leg2-reporting/src/i18n/strings.ts`. Data values (site codes, gate names, LPIs) are exempt.
- **Do NOT display `product`** anywhere.
- **Deep-link:** base from `import.meta.env.VITE_GMS_READER_MASTER_URL` (default `https://monitoring.edgeavs.net/catalog`); URL = `${base}/${encodeURIComponent(lpi)}`.
- **Reprocess Edge Function contract (must match the backend plan):** `POST ${VITE_SUPABASE_URL}/functions/v1/rfid-reprocess-site`, headers `apikey` + `Authorization: Bearer <session token>`, body `{ "site_impc_code": string }`, response `{ "ok": boolean, "status": string, "movements_upserted": number, "reprocess_run_id"?: string, "error"?: string }`.
- **Movement → column routing:** `edi_equivalent == null` AND `movement_type ∈ {OUTBOUND, TRANSIT_EXIT}` → left "No Event Code"; `edi_equivalent == null` AND `movement_type ∈ {INBOUND, TRANSIT_ENTRY}` → right "No Event Code". Movements with a non-null `edi_equivalent` are unchanged.
- **Tests:** every `src/lib` change is TDD (test first). Run all with `pnpm --dir leg2-reporting test`.
- Working dir for commands: repo root `c:\Users\fernandezi\projects\EDGE`. The app lives in `leg2-reporting/`.

---

## File Structure

- `leg2-reporting/src/lib/pivot.ts` — modify: route NULL-edi movements into two new arrays; add report-level flags.
- `leg2-reporting/src/lib/gms.ts` — create: deep-link builder.
- `leg2-reporting/src/lib/reprocess.ts` — create: reprocess Edge Function client.
- `leg2-reporting/src/i18n/strings.ts` — modify: add `columns.noEventCode` + `correction.*`.
- `leg2-reporting/src/components/RfidEventsPivot.tsx` — modify: render the two columns + `onSelectIncident` prop.
- `leg2-reporting/src/components/CorrectionDialog.tsx` — create: correction modal.
- `leg2-reporting/src/pages/RfidEventsPage.tsx` — modify: wire incident selection + dialog.
- `leg2-reporting/.env.local` + `leg2-reporting/.env.example` — add `VITE_GMS_READER_MASTER_URL`.
- Test files (create/modify): `pivot.test.ts`, `gms.test.ts`, `reprocess.test.ts`, `RfidEventsPivot.test.tsx`, `CorrectionDialog.test.tsx`.

---

### Task 1: Route NULL-edi movements in `pivot.ts`

**Files:**
- Modify: `leg2-reporting/src/lib/pivot.ts`
- Test: `leg2-reporting/src/lib/pivot.test.ts`

**Interfaces:**
- Produces:
  - `S9PivotRow` gains `noEventCodeOutbound: RfidMovement[]` and `noEventCodeInbound: RfidMovement[]`.
  - `RfidEventsReport` gains `hasNoEventCodeOutbound: boolean` and `hasNoEventCodeInbound: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `leg2-reporting/src/lib/pivot.test.ts` (the `mov()` factory already exists at the top):
```ts
  it("routes NULL-edi outbound/transit-exit movements to noEventCodeOutbound", () => {
    const report = pivotByS9([
      mov({ s9_id: "S1", edi_equivalent: null, movement_type: "OUTBOUND" }),
      mov({ s9_id: "S1", edi_equivalent: null, movement_type: "TRANSIT_EXIT" }),
    ]);
    expect(report.rows[0].noEventCodeOutbound).toHaveLength(2);
    expect(report.rows[0].noEventCodeInbound).toHaveLength(0);
    expect(report.hasNoEventCodeOutbound).toBe(true);
    expect(report.hasNoEventCodeInbound).toBe(false);
    expect(report.columns).toHaveLength(0); // NULL edi produces no checkpoint column
  });

  it("routes NULL-edi inbound/transit-entry movements to noEventCodeInbound", () => {
    const report = pivotByS9([
      mov({ s9_id: "S1", edi_equivalent: null, movement_type: "INBOUND" }),
      mov({ s9_id: "S1", edi_equivalent: null, movement_type: "TRANSIT_ENTRY" }),
    ]);
    expect(report.rows[0].noEventCodeInbound).toHaveLength(2);
    expect(report.hasNoEventCodeInbound).toBe(true);
  });

  it("keeps NULL-edi movements out of the checkpoint cells", () => {
    const report = pivotByS9([
      mov({ s9_id: "S1", edi_equivalent: "2320", movement_type: "OUTBOUND" }),
      mov({ s9_id: "S1", edi_equivalent: null, movement_type: "OUTBOUND" }),
    ]);
    expect(Object.keys(report.rows[0].cells)).toEqual(["2320"]);
    expect(report.rows[0].noEventCodeOutbound).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir leg2-reporting test pivot`
Expected: FAIL — `noEventCodeOutbound` undefined / `hasNoEventCodeOutbound` undefined.

- [ ] **Step 3: Implement the routing**

In `leg2-reporting/src/lib/pivot.ts`:

Add the two fields to `S9PivotRow` (after `cells`):
```ts
  cells: Record<string, RfidMovement>;
  noEventCodeOutbound: RfidMovement[];
  noEventCodeInbound: RfidMovement[];
```
Add the two flags to `RfidEventsReport`:
```ts
export interface RfidEventsReport {
  columns: CheckpointColumn[];
  rows: S9PivotRow[];
  hasNoEventCodeOutbound: boolean;
  hasNoEventCodeInbound: boolean;
}
```
Replace the per-group cell loop (the block starting `const cells: Record<string, RfidMovement> = {};` through the `transits` line) with:
```ts
    const cells: Record<string, RfidMovement> = {};
    const noEventCodeOutbound: RfidMovement[] = [];
    const noEventCodeInbound: RfidMovement[] = [];
    for (const m of group) {
      if (!m.edi_equivalent) {
        if (m.movement_type === "OUTBOUND" || m.movement_type === "TRANSIT_EXIT") {
          noEventCodeOutbound.push(m);
        } else if (m.movement_type === "INBOUND" || m.movement_type === "TRANSIT_ENTRY") {
          noEventCodeInbound.push(m);
        }
        continue;
      }
      const existing = cells[m.edi_equivalent];
      if (!existing || m.event_datetime_utc < existing.event_datetime_utc) {
        cells[m.edi_equivalent] = m;
      }
    }
    const transits = group.filter(
      (m) => m.movement_type === "TRANSIT_ENTRY" || m.movement_type === "TRANSIT_EXIT"
    );
```
Add the two arrays to the `rows.push({ … })` object (after `cells,`):
```ts
      cells,
      noEventCodeOutbound,
      noEventCodeInbound,
```
Replace the final `return { columns, rows };` with:
```ts
  const hasNoEventCodeOutbound = rows.some((r) => r.noEventCodeOutbound.length > 0);
  const hasNoEventCodeInbound = rows.some((r) => r.noEventCodeInbound.length > 0);
  return { columns, rows, hasNoEventCodeOutbound, hasNoEventCodeInbound };
```

- [ ] **Step 4: Update existing `RfidEventsReport`/`S9PivotRow` literals so type-check passes**

Some test fixtures build these objects by hand. In `leg2-reporting/src/components/RfidEventsPivot.test.tsx`, add to the `report` object `hasNoEventCodeOutbound: false, hasNoEventCodeInbound: false,` and to its single row `noEventCodeOutbound: [], noEventCodeInbound: [],`. Do the same for any literal in `leg2-reporting/src/hooks/useRfidEventsReport.test.tsx` if present (search for `columns:` and `cells:`).

- [ ] **Step 5: Run tests + type-check to verify they pass**

Run: `pnpm --dir leg2-reporting test pivot && pnpm --dir leg2-reporting exec tsc --noEmit`
Expected: pivot tests PASS; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/lib/pivot.ts leg2-reporting/src/lib/pivot.test.ts leg2-reporting/src/components/RfidEventsPivot.test.tsx
git commit -m "feat(leg2-report): route NULL-edi movements into no-event-code buckets"
```

---

### Task 2: Deep-link builder `src/lib/gms.ts`

**Files:**
- Create: `leg2-reporting/src/lib/gms.ts`
- Create: `leg2-reporting/src/lib/gms.test.ts`
- Modify: `leg2-reporting/.env.local`, `leg2-reporting/.env.example`

**Interfaces:**
- Produces: `buildReaderMasterUrl(lpi: string, base?: string): string`.

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/lib/gms.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildReaderMasterUrl } from "@/lib/gms";

describe("buildReaderMasterUrl", () => {
  it("appends the LPI to the base path", () => {
    expect(buildReaderMasterUrl("J11DJ0002100000037", "https://monitoring.edgeavs.net/catalog"))
      .toBe("https://monitoring.edgeavs.net/catalog/J11DJ0002100000037");
  });
  it("trims a trailing slash on the base", () => {
    expect(buildReaderMasterUrl("R1", "https://x.net/catalog/"))
      .toBe("https://x.net/catalog/R1");
  });
  it("URL-encodes the LPI", () => {
    expect(buildReaderMasterUrl("A B", "https://x.net/c")).toBe("https://x.net/c/A%20B");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir leg2-reporting test gms`
Expected: FAIL — cannot find `@/lib/gms`.

- [ ] **Step 3: Implement**

Create `leg2-reporting/src/lib/gms.ts`:
```ts
const DEFAULT_BASE = "https://monitoring.edgeavs.net/catalog";

export function readerMasterBase(): string {
  return (import.meta.env.VITE_GMS_READER_MASTER_URL as string | undefined) ?? DEFAULT_BASE;
}

/** Deep-link to the GMS IOT reader master (Operation tab) for a given LPI. */
export function buildReaderMasterUrl(lpi: string, base: string = readerMasterBase()): string {
  return `${base.replace(/\/$/, "")}/${encodeURIComponent(lpi)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir leg2-reporting test gms`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the env var**

Append to `leg2-reporting/.env.local` and `leg2-reporting/.env.example`:
```
VITE_GMS_READER_MASTER_URL=https://monitoring.edgeavs.net/catalog
```

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/lib/gms.ts leg2-reporting/src/lib/gms.test.ts leg2-reporting/.env.example
git commit -m "feat(leg2-report): GMS reader-master deep-link builder"
```
(Do NOT commit `.env.local` — it is gitignored.)

---

### Task 3: Reprocess client `src/lib/reprocess.ts`

**Files:**
- Create: `leg2-reporting/src/lib/reprocess.ts`
- Create: `leg2-reporting/src/lib/reprocess.test.ts`

**Interfaces:**
- Produces: `reprocessSite(siteImpcCode: string, deps?): Promise<ReprocessResult>` where `ReprocessResult = { ok: boolean; status: string; movements_upserted: number; reprocess_run_id?: string; error?: string }`.

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/lib/reprocess.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { reprocessSite } from "@/lib/reprocess";

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}
function errResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as Response;
}

describe("reprocessSite", () => {
  it("POSTs the site_impc_code with the bearer token and returns the parsed result", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      okResponse({ ok: true, status: "success", movements_upserted: 3 })
    );
    const res = await reprocessSite("INMUBA", {
      fetchFn, token: "tok", anonKey: "anon", baseUrl: "https://x/functions/v1/rfid-reprocess-site",
    });
    expect(res).toEqual({ ok: true, status: "success", movements_upserted: 3 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://x/functions/v1/rfid-reprocess-site");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ site_impc_code: "INMUBA" });
  });

  it("returns ok:false with an error on a non-2xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(errResponse(500, { error: "boom" }));
    const res = await reprocessSite("INMUBA", {
      fetchFn, token: "tok", anonKey: "anon", baseUrl: "https://x/functions/v1/rfid-reprocess-site",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("boom");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir leg2-reporting test reprocess`
Expected: FAIL — cannot find `@/lib/reprocess`.

- [ ] **Step 3: Implement**

Create `leg2-reporting/src/lib/reprocess.ts`:
```ts
import { supabase } from "@/lib/supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface ReprocessResult {
  ok: boolean;
  status: string;
  movements_upserted: number;
  reprocess_run_id?: string;
  error?: string;
}

type ReprocessDeps = {
  fetchFn?: typeof fetch;
  token?: string;
  anonKey?: string;
  baseUrl?: string;
};

export async function reprocessSite(
  siteImpcCode: string,
  deps: ReprocessDeps = {}
): Promise<ReprocessResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const anonKey = deps.anonKey ?? SUPABASE_ANON_KEY;
  let token = deps.token;
  if (!token) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? anonKey;
  }
  const url = deps.baseUrl ?? `${SUPABASE_URL}/functions/v1/rfid-reprocess-site`;

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ site_impc_code: siteImpcCode }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ReprocessResult>;
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir leg2-reporting test reprocess`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/reprocess.ts leg2-reporting/src/lib/reprocess.test.ts
git commit -m "feat(leg2-report): reprocess-site edge-function client"
```

---

### Task 4: "No Event Code" columns + strings in `RfidEventsPivot.tsx`

**Files:**
- Modify: `leg2-reporting/src/i18n/strings.ts`
- Modify: `leg2-reporting/src/components/RfidEventsPivot.tsx`
- Test: `leg2-reporting/src/components/RfidEventsPivot.test.tsx`

**Interfaces:**
- Consumes: `RfidEventsReport.hasNoEventCodeOutbound/Inbound`, `S9PivotRow.noEventCodeOutbound/Inbound` (Task 1).
- Produces: `RfidEventsPivot` gains prop `onSelectIncident: (movements: RfidMovement[]) => void`.

- [ ] **Step 1: Add the strings**

In `leg2-reporting/src/i18n/strings.ts`, add to `columns` (after `gate: "Gate",`):
```ts
    gate: "Gate",
    noEventCode: "No Event Code",
```
Add a new top-level `correction` block (before the closing `states` / after `common`):
```ts
  correction: {
    title: "Fix missing event code",
    help: "This reader has RFID reads but its EDI event code is not set. Assign the Inbound/Outbound code in the GMS reader master, then reprocess.",
    openInMaster: "Open in reader master (GMS)",
    reprocess: "Reprocess",
    reprocessing: "Reprocessing…",
    reprocessDone: "Reprocess complete. The movement will appear under its checkpoint.",
  },
```

- [ ] **Step 2: Write the failing tests**

Append to `leg2-reporting/src/components/RfidEventsPivot.test.tsx` (inside `describe`). First extend the shared `report` fixture: give its row `noEventCodeOutbound: [{ reader_id: "R1", site_impc_code: "INMUBA", country_code: "IN", movement_type: "OUTBOUND", edi_equivalent: null, event_datetime_utc: "2026-07-02T08:00:00+00:00", event_datetime_local: "2026-07-02T13:30:00" } as any]`, keep `noEventCodeInbound: []`, and set `hasNoEventCodeOutbound: true, hasNoEventCodeInbound: false` on the report. Then add:
```ts
  it("renders a left 'No Event Code' column when outbound gaps exist", () => {
    render(
      <RfidEventsPivot
        report={report}
        timeMode="utc"
        selectedS9={null}
        onSelectS9={() => {}}
        onSelectIncident={() => {}}
        readerMap={readerMap}
      />
    );
    expect(screen.getByText("No Event Code")).toBeInTheDocument();
  });

  it("fires onSelectIncident with the gap movements when a No Event Code cell is clicked", () => {
    const onIncident = vi.fn();
    render(
      <RfidEventsPivot
        report={report}
        timeMode="utc"
        selectedS9={null}
        onSelectS9={() => {}}
        onSelectIncident={onIncident}
        readerMap={readerMap}
      />
    );
    fireEvent.click(screen.getByText("02 Jul 2026 (Thu)"));
    expect(onIncident).toHaveBeenCalledTimes(1);
    expect(onIncident.mock.calls[0][0][0].reader_id).toBe("R1");
  });
```
Also add `onSelectIncident={() => {}}` to the three pre-existing `render(<RfidEventsPivot … />)` calls so they type-check.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --dir leg2-reporting test RfidEventsPivot`
Expected: FAIL — `onSelectIncident` not a prop / "No Event Code" not found.

- [ ] **Step 4: Implement the columns**

In `leg2-reporting/src/components/RfidEventsPivot.tsx`:

Add `onSelectIncident` to the props type and destructuring:
```ts
  onSelectS9,
  onSelectIncident,
  readerMap,
}: {
  report: RfidEventsReport;
  timeMode: TimeMode;
  selectedS9: string | null;
  onSelectS9: (s9: string) => void;
  onSelectIncident: (movements: RfidMovement[]) => void;
  readerMap: Map<string, ReaderMaster>;
}) {
```
Add the `RfidMovement` import:
```ts
import type { RfidMovement } from "@/lib/supabase";
```
Add a module-level helper component (above `RfidEventsPivot`):
```tsx
function NoEventCodeCell({
  movements, timeMode, readerMap, onSelectIncident,
}: {
  movements: RfidMovement[];
  timeMode: TimeMode;
  readerMap: Map<string, ReaderMaster>;
  onSelectIncident: (movements: RfidMovement[]) => void;
}) {
  if (movements.length === 0) {
    return <TableCell className="bg-amber-50/40" />;
  }
  const m = movements[0];
  const reader = readerMap.get(m.reader_id);
  const parts = formatTimestampParts(m, timeMode);
  return (
    <TableCell
      className="font-mono text-xs bg-amber-50/40 cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onSelectIncident(movements);
      }}
    >
      <div className="font-semibold">{parts.date} ({parts.weekday})</div>
      <div className="font-semibold">{parts.time}</div>
      <div className="text-muted-foreground">{m.reader_id}</div>
      <div className="text-muted-foreground">
        {strings.columns.gate}: {reader?.gate_name ?? "—"}
      </div>
      {movements.length > 1 && (
        <div className="text-[10px] text-amber-800">+{movements.length - 1}</div>
      )}
    </TableCell>
  );
}
```
In the header row, after the S9 `<TableHead>` add the left column, and after the `report.columns.map(...)` add the right column:
```tsx
            {report.hasNoEventCodeOutbound && (
              <TableHead className="sticky top-0 z-30 bg-amber-100/70 border-r">
                {strings.columns.noEventCode}
              </TableHead>
            )}
            {report.columns.map((c) => ( /* unchanged */
```
```tsx
            ))}
            {report.hasNoEventCodeInbound && (
              <TableHead className="sticky top-0 z-30 bg-amber-100/70 border-l">
                {strings.columns.noEventCode}
              </TableHead>
            )}
```
In the body row, after the frozen summary `<TableCell>` add the left cell, and after the `report.columns.map(...)` cells add the right cell:
```tsx
                {report.hasNoEventCodeOutbound && (
                  <NoEventCodeCell
                    movements={row.noEventCodeOutbound}
                    timeMode={timeMode}
                    readerMap={readerMap}
                    onSelectIncident={onSelectIncident}
                  />
                )}
                {report.columns.map((c) => { /* unchanged */
```
```tsx
                })}
                {report.hasNoEventCodeInbound && (
                  <NoEventCodeCell
                    movements={row.noEventCodeInbound}
                    timeMode={timeMode}
                    readerMap={readerMap}
                    onSelectIncident={onSelectIncident}
                  />
                )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --dir leg2-reporting test RfidEventsPivot && pnpm --dir leg2-reporting exec tsc --noEmit`
Expected: all RfidEventsPivot tests PASS; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/i18n/strings.ts leg2-reporting/src/components/RfidEventsPivot.tsx leg2-reporting/src/components/RfidEventsPivot.test.tsx
git commit -m "feat(leg2-report): No Event Code columns (outbound left, inbound right)"
```

---

### Task 5: `CorrectionDialog` + wire into `RfidEventsPage`

**Files:**
- Create: `leg2-reporting/src/components/CorrectionDialog.tsx`
- Create: `leg2-reporting/src/components/CorrectionDialog.test.tsx`
- Modify: `leg2-reporting/src/pages/RfidEventsPage.tsx`

**Interfaces:**
- Consumes: `buildReaderMasterUrl` (Task 2), `reprocessSite` (Task 3), `strings.correction` (Task 4), `RfidEventsPivot.onSelectIncident` (Task 4).
- Produces: `CorrectionDialog` with props `{ open, onOpenChange, movements: RfidMovement[], readerMap: Map<string, ReaderMaster> }`.

- [ ] **Step 1: Write the failing tests**

Create `leg2-reporting/src/components/CorrectionDialog.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CorrectionDialog } from "@/components/CorrectionDialog";
import type { ReaderMaster, RfidMovement } from "@/lib/supabase";

vi.mock("@/lib/reprocess", () => ({
  reprocessSite: vi.fn().mockResolvedValue({ ok: true, status: "success", movements_upserted: 2 }),
}));
import { reprocessSite } from "@/lib/reprocess";

const movements = [
  {
    reader_id: "J11DJ0002100000037", site_impc_code: "INMUBA", country_code: "IN",
    movement_type: "OUTBOUND", edi_equivalent: null,
    event_datetime_utc: "2026-07-02T08:00:00+00:00", event_datetime_local: "2026-07-02T13:30:00",
  } as RfidMovement,
];
const readerMap = new Map<string, ReaderMaster>([
  ["J11DJ0002100000037", {
    lpi: "J11DJ0002100000037", gate_id: "G1", gate_name: "Office", gate_purpose: "in/out",
    reading_direction: "Entry/Exit", facility_name: "F", site_id: "S", reader_country_code: "IN",
    handover_point: true,
  }],
]);

describe("CorrectionDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows site, gate, LPI and a deep-link to the GMS reader master", () => {
    render(<CorrectionDialog open onOpenChange={() => {}} movements={movements} readerMap={readerMap} />);
    expect(screen.getByText(/INMUBA/)).toBeInTheDocument();
    expect(screen.getByText(/Office/)).toBeInTheDocument();
    expect(screen.getByText("J11DJ0002100000037")).toBeInTheDocument();
    const link = screen.getByText("Open in reader master (GMS)").closest("a")!;
    expect(link.getAttribute("href")).toBe(
      "https://monitoring.edgeavs.net/catalog/J11DJ0002100000037"
    );
  });

  it("does NOT show the product field", () => {
    render(<CorrectionDialog open onOpenChange={() => {}} movements={movements} readerMap={readerMap} />);
    expect(screen.queryByText(/product/i)).not.toBeInTheDocument();
  });

  it("calls reprocessSite for the site and shows success", async () => {
    render(<CorrectionDialog open onOpenChange={() => {}} movements={movements} readerMap={readerMap} />);
    fireEvent.click(screen.getByText("Reprocess"));
    await waitFor(() => expect(reprocessSite).toHaveBeenCalledWith("INMUBA"));
    await waitFor(() =>
      expect(screen.getByText(/Reprocess complete/)).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir leg2-reporting test CorrectionDialog`
Expected: FAIL — cannot find `@/components/CorrectionDialog`.

- [ ] **Step 3: Implement `CorrectionDialog`**

Create `leg2-reporting/src/components/CorrectionDialog.tsx`:
```tsx
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ReaderMaster, RfidMovement } from "@/lib/supabase";
import { buildReaderMasterUrl } from "@/lib/gms";
import { reprocessSite } from "@/lib/reprocess";
import { strings } from "@/i18n/strings";

type Status = "idle" | "running" | "done" | "error";

export function CorrectionDialog({
  open, onOpenChange, movements, readerMap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  movements: RfidMovement[];
  readerMap: Map<string, ReaderMaster>;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  // Distinct readers (by LPI) behind this gap cell, and the sites to reprocess.
  const distinct = Array.from(
    new Map(movements.map((m) => [m.reader_id, m])).values()
  );
  const sites = Array.from(
    new Set(movements.map((m) => m.site_impc_code).filter((s): s is string => !!s))
  );

  async function handleReprocess() {
    setStatus("running");
    setMessage("");
    try {
      for (const site of sites) {
        const res = await reprocessSite(site);
        if (!res.ok) throw new Error(res.error ?? res.status);
      }
      setStatus("done");
      setMessage(strings.correction.reprocessDone);
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.correction.title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{strings.correction.help}</p>
        <ul className="space-y-3">
          {distinct.map((m) => {
            const reader = readerMap.get(m.reader_id);
            return (
              <li key={m.reader_id} className="border rounded-md p-3 text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">{strings.columns.site}: </span>
                  {m.site_impc_code ?? "—"}
                  {m.country_code ? ` (${m.country_code})` : ""}
                </div>
                <div>
                  <span className="text-muted-foreground">{strings.columns.gate}: </span>
                  {reader?.gate_name ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">{strings.columns.rfidReader}: </span>
                  <span className="font-mono">{m.reader_id}</span>
                </div>
                <a
                  className="text-blue-600 underline"
                  href={buildReaderMasterUrl(m.reader_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {strings.correction.openInMaster}
                </a>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-3">
          <Button onClick={handleReprocess} disabled={status === "running" || sites.length === 0}>
            {status === "running" ? strings.correction.reprocessing : strings.correction.reprocess}
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --dir leg2-reporting test CorrectionDialog`
Expected: PASS (3 tests). (If the dialog import path differs, confirm `@/components/ui/dialog` exports `Dialog/DialogContent/DialogHeader/DialogTitle`, matching `EventDetailsDialog.tsx`.)

- [ ] **Step 5: Wire into `RfidEventsPage`**

In `leg2-reporting/src/pages/RfidEventsPage.tsx`:

Add imports:
```ts
import { CorrectionDialog } from "@/components/CorrectionDialog";
import type { RfidMovement } from "@/lib/supabase";
```
Add state (next to `selectedS9`):
```ts
  const [incident, setIncident] = useState<RfidMovement[] | null>(null);
```
Pass the handler to the pivot:
```tsx
            <RfidEventsPivot
              report={report}
              timeMode={timeMode}
              selectedS9={selectedS9}
              onSelectS9={setSelectedS9}
              onSelectIncident={setIncident}
              readerMap={readerMap}
            />
```
Render the dialog (next to `EventDetailsDialog`):
```tsx
      <CorrectionDialog
        open={incident !== null}
        onOpenChange={(o) => { if (!o) setIncident(null); }}
        movements={incident ?? []}
        readerMap={readerMap}
      />
```

- [ ] **Step 6: Run the full suite + type-check + build**

Run:
```bash
pnpm --dir leg2-reporting test && pnpm --dir leg2-reporting exec tsc --noEmit && pnpm --dir leg2-reporting build
```
Expected: all tests PASS; `tsc` clean; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add leg2-reporting/src/components/CorrectionDialog.tsx leg2-reporting/src/components/CorrectionDialog.test.tsx leg2-reporting/src/pages/RfidEventsPage.tsx
git commit -m "feat(leg2-report): correction dialog with GMS deep-link and reprocess"
```

---

## Self-Review

- **Spec coverage:** No Event Code columns outbound-left / inbound-right (Task 4) ✓; clickable → correction modal (Tasks 4–5) ✓; modal shows País/site/gate/LPI, not product (Task 5 + test) ✓; deep-link `monitoring.edgeavs.net/catalog/{LPI}` configurable (Task 2) ✓; Reprocess button → per-site reprocess (Tasks 3, 5) ✓; English strings from `strings.ts` (Task 4) ✓.
- **Placeholder scan:** none — every code step carries full code.
- **Type consistency:** `noEventCodeOutbound/Inbound` (Task 1) consumed in Tasks 4–5; `onSelectIncident: (movements: RfidMovement[]) => void` consistent across pivot (Task 4) and page (Task 5); `reprocessSite(siteImpcCode)` signature consistent (Tasks 3, 5); `ReprocessResult` shape matches the Edge Function contract (backend plan).
- **Cross-plan dependency:** the Reprocess button only works end-to-end once the backend plan's `rfid-reprocess-site` function is deployed; until then the UI, deep-link, and unit tests (mocked fetch) still pass.
