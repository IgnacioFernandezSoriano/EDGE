# Event gaps: unit selector + wider detail + S9 new tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global Days/Hours unit toggle to the Event gaps screen, widen the detail dialog, and open per-S9 receptacle detail in a new browser tab (in both Event gaps and RFID Report), replacing the nested ATAT dialog.

**Architecture:** Pure frontend in `leg2-reporting`. The gap datum stays in days (`mean_days`/`gap_days`); Hours is a client-side ×24 presentation. A `unit` state lives in `useEventGaps` and is threaded to the filters, matrix and detail dialog. The already-existing `#/receptacle/{s9}` hash route (rendered by `AtatPage`) is the target of a `window.open(..., "_blank")` call; the `AtatDialog` component is deleted.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + @testing-library/react, Tailwind, shadcn/ui.

## Global Constraints

- Underlying data stays in **days**; Hours = `value * 24`, formatted to **1 decimal**. No backend/RPC/edge-function changes.
- Unit default is **"days"**; the preference is **not persisted** (resets on reload).
- Rename ATAT → **"Receptacle Events"** in **visible text only**; do NOT rename code identifiers (`AtatPage`, `AtatView`, `atat.ts`, `strings.atat`, etc.).
- Every commit must keep the build and the full test suite green. Run tests from `leg2-reporting/`.
- Test runner: `cd leg2-reporting && npx vitest run <path>` for a file; `npx vitest run` for all.

---

### Task 1: `formatGap(value, unit)` helper + `GapUnit` type

**Files:**
- Modify: `leg2-reporting/src/lib/eventGaps.ts` (replace `formatGapDays`, add `GapUnit`)
- Modify: `leg2-reporting/src/components/EventGapsMatrix.tsx:1,50`
- Modify: `leg2-reporting/src/components/EventGapsDetailDialog.tsx:2,81`
- Test: `leg2-reporting/src/lib/eventGaps.test.ts`

**Interfaces:**
- Produces: `export type GapUnit = "days" | "hours"` and `export function formatGap(v: number | null | undefined, unit: GapUnit): string`. Removes `formatGapDays`.

- [ ] **Step 1: Write the failing test**

Add to `leg2-reporting/src/lib/eventGaps.test.ts`:

```ts
import { formatGap } from "@/lib/eventGaps";

describe("formatGap", () => {
  it("formats days with one decimal", () => {
    expect(formatGap(3.2, "days")).toBe("3.2");
  });
  it("converts to hours (x24) with one decimal", () => {
    expect(formatGap(2, "hours")).toBe("48.0");
    expect(formatGap(3.08, "hours")).toBe("73.9");
  });
  it("renders an em dash for null / NaN", () => {
    expect(formatGap(null, "days")).toBe("—");
    expect(formatGap(undefined, "hours")).toBe("—");
    expect(formatGap(NaN, "hours")).toBe("—");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && npx vitest run src/lib/eventGaps.test.ts`
Expected: FAIL — `formatGap` is not exported.

- [ ] **Step 3: Replace `formatGapDays` with `formatGap` in `eventGaps.ts`**

In `leg2-reporting/src/lib/eventGaps.ts`, replace the `formatGapDays` block (lines 57-60) with:

```ts
export type GapUnit = "days" | "hours";

export function formatGap(v: number | null | undefined, unit: GapUnit): string {
  if (v == null || Number.isNaN(v)) return "—";
  return (unit === "hours" ? v * 24 : v).toFixed(1);
}
```

- [ ] **Step 4: Update the two existing call sites (hardcode "days" for now — behavior unchanged)**

In `leg2-reporting/src/components/EventGapsMatrix.tsx` line 1, change the import `formatGapDays` → `formatGap`; at line 50 change `{formatGapDays(cell.mean_days)}` → `{formatGap(cell.mean_days, "days")}`.

In `leg2-reporting/src/components/EventGapsDetailDialog.tsx` line 2, change the import `formatGapDays` → `formatGap`; at line 81 change `{formatGapDays(r.gap_days)}` → `{formatGap(r.gap_days, "days")}`.

- [ ] **Step 5: Run tests to verify green**

Run: `cd leg2-reporting && npx vitest run src/lib/eventGaps.test.ts src/components/EventGapsMatrix.test.tsx src/components/EventGapsDetailDialog.test.tsx`
Expected: PASS (matrix/detail output unchanged; new `formatGap` tests pass).

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/lib/eventGaps.ts leg2-reporting/src/lib/eventGaps.test.ts leg2-reporting/src/components/EventGapsMatrix.tsx leg2-reporting/src/components/EventGapsDetailDialog.tsx
git commit -m "refactor(leg2): formatGap(value,unit) replaces formatGapDays"
```

---

### Task 2: i18n strings for unit + gap-column headers

**Files:**
- Modify: `leg2-reporting/src/i18n/strings.ts:178` (inside `gaps: { ... }`)
- Modify: `leg2-reporting/src/components/EventGapsDetailDialog.tsx:60`

**Interfaces:**
- Produces: `strings.gaps.unit`, `strings.gaps.unitDays`, `strings.gaps.unitHours`, `strings.gaps.colGapDays`, `strings.gaps.colGapHours`. Removes `strings.gaps.colGap`.

- [ ] **Step 1: Edit strings**

In `leg2-reporting/src/i18n/strings.ts`, inside the `gaps:` object, replace the line `colGap: "Gap (days)",` with:

```ts
    unit: "Unit",
    unitDays: "Days",
    unitHours: "Hours",
    colGapDays: "Gap (days)",
    colGapHours: "Gap (hours)",
```

- [ ] **Step 2: Update the detail header to the renamed key**

In `leg2-reporting/src/components/EventGapsDetailDialog.tsx` line 60, change `{strings.gaps.colGap}` → `{strings.gaps.colGapDays}`.

- [ ] **Step 3: Run tests + typecheck to verify green**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsDetailDialog.test.tsx && npx tsc --noEmit`
Expected: PASS, no TS errors (no remaining references to `colGap`).

- [ ] **Step 4: Commit**

```bash
git add leg2-reporting/src/i18n/strings.ts leg2-reporting/src/components/EventGapsDetailDialog.tsx
git commit -m "i18n(leg2): unit + gap-column header strings for event gaps"
```

---

### Task 3: `receptacleUrl(s9)` helper

**Files:**
- Modify: `leg2-reporting/src/lib/hashRoute.ts`
- Test: `leg2-reporting/src/lib/hashRoute.test.ts`

**Interfaces:**
- Produces: `export function receptacleUrl(s9: string): string` — absolute-relative URL (pathname + search + receptacle hash) suitable for `window.open`.

- [ ] **Step 1: Write the failing test**

Add to `leg2-reporting/src/lib/hashRoute.test.ts`:

```ts
import { receptacleUrl } from "@/lib/hashRoute";

describe("receptacleUrl", () => {
  it("builds pathname + search + receptacle hash", () => {
    const orig = window.location;
    // jsdom default location is http://localhost/
    expect(receptacleUrl("S9A")).toBe("/#/receptacle/S9A");
  });
  it("url-encodes the s9", () => {
    expect(receptacleUrl("A B")).toBe("/#/receptacle/A%20B");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && npx vitest run src/lib/hashRoute.test.ts`
Expected: FAIL — `receptacleUrl` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `leg2-reporting/src/lib/hashRoute.ts`:

```ts
export function receptacleUrl(s9: string): string {
  return `${window.location.pathname}${window.location.search}${receptacleHash(s9)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd leg2-reporting && npx vitest run src/lib/hashRoute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/hashRoute.ts leg2-reporting/src/lib/hashRoute.test.ts
git commit -m "feat(leg2): receptacleUrl helper for opening S9 in a new tab"
```

---

### Task 4: `EventGapsMatrix` honors a `unit` prop

**Files:**
- Modify: `leg2-reporting/src/components/EventGapsMatrix.tsx`
- Test: `leg2-reporting/src/components/EventGapsMatrix.test.tsx`

**Interfaces:**
- Consumes: `GapUnit`, `formatGap` from `@/lib/eventGaps`.
- Produces: `EventGapsMatrixProps` gains `unit?: GapUnit` (default `"days"`), applied to every cell value.

- [ ] **Step 1: Write the failing test**

Add to `leg2-reporting/src/components/EventGapsMatrix.test.tsx` (reuse the file's existing `comparisons`/`rows` fixtures; a `mean_days` of `3.2` becomes `76.8` in hours):

```ts
it("renders cell values in hours when unit=hours", () => {
  render(
    <EventGapsMatrix comparisons={comparisons} rows={rows} unit="hours" onSelectCell={() => {}} />
  );
  expect(screen.getByText("76.8")).toBeInTheDocument();
});
```

If the existing fixture's `mean_days` differs from `3.2`, use that value ×24 instead. Confirm the fixture value first by reading the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsMatrix.test.tsx`
Expected: FAIL — value still shown in days (or `unit` prop rejected by types).

- [ ] **Step 3: Add the prop and use it**

In `leg2-reporting/src/components/EventGapsMatrix.tsx`:
- Import `GapUnit`: change line 1 to `import { formatGap, comparisonCodeLabel, type CorridorRow, type EventComparison, type GapUnit } from "@/lib/eventGaps";`
- In `EventGapsMatrixProps`, add `unit?: GapUnit;`
- In the component signature, destructure with a default: `export function EventGapsMatrix({ comparisons, rows, unit = "days", onSelectCell }: EventGapsMatrixProps) {`
- At the cell (line ~50), change `{formatGap(cell.mean_days, "days")}` → `{formatGap(cell.mean_days, unit)}`

- [ ] **Step 4: Run tests to verify green**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsMatrix.test.tsx`
Expected: PASS (both the existing days test and the new hours test).

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/components/EventGapsMatrix.tsx leg2-reporting/src/components/EventGapsMatrix.test.tsx
git commit -m "feat(leg2): EventGapsMatrix renders values in selected unit"
```

---

### Task 5: `EventGapsDetailDialog` honors `unit` + wider layout

**Files:**
- Modify: `leg2-reporting/src/components/EventGapsDetailDialog.tsx`
- Test: `leg2-reporting/src/components/EventGapsDetailDialog.test.tsx`

**Interfaces:**
- Consumes: `GapUnit`, `formatGap` from `@/lib/eventGaps`.
- Produces: `EventGapsDetailDialogProps` gains `unit?: GapUnit` (default `"days"`). Gap column header switches between `colGapDays`/`colGapHours`; value uses `unit`. `DialogContent` widened to `sm:max-w-[95vw]` with a horizontal-scroll wrapper around the table.

- [ ] **Step 1: Write the failing test**

Add to `leg2-reporting/src/components/EventGapsDetailDialog.test.tsx` (reuse the file's existing `rows` fixture; confirm its `gap_days` value first — plan assumes `3.08` → `73.9` hours):

```ts
it("shows the gap column in hours when unit=hours", () => {
  render(
    <EventGapsDetailDialog
      open title="t" rows={rows} loading={false} unit="hours"
      onOpenChange={() => {}} onToggleExclude={() => {}} onSelectS9={() => {}}
    />
  );
  expect(screen.getByText("Gap (hours)")).toBeInTheDocument();
  expect(screen.getByText("73.9")).toBeInTheDocument();
});
```

Match the render props to whatever the existing tests in this file already pass (same prop names/order) plus `unit="hours"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsDetailDialog.test.tsx`
Expected: FAIL — header still "Gap (days)" / value in days / `unit` prop rejected.

- [ ] **Step 3: Implement prop, dynamic header, value, and wider layout**

In `leg2-reporting/src/components/EventGapsDetailDialog.tsx`:
- Import `GapUnit`: change line 2 to `import { formatGap, type GapUnit } from "@/lib/eventGaps";`
- Add `unit?: GapUnit;` to `EventGapsDetailDialogProps`.
- Destructure with default: add `unit = "days",` to the component's destructured params.
- Widen the dialog: change `<DialogContent className="max-h-[75vh] overflow-auto sm:max-w-4xl">` → `<DialogContent className="max-h-[75vh] overflow-auto sm:max-w-[95vw]">`.
- Wrap the `<Table>...</Table>` (the whole block currently at lines ~51-93) in a horizontal-scroll container: `<div className="overflow-x-auto">` ... `</div>`.
- Gap header (line ~60): `{unit === "hours" ? strings.gaps.colGapHours : strings.gaps.colGapDays}`.
- Gap value (line ~81): `{formatGap(r.gap_days, unit)}`.

- [ ] **Step 4: Run tests to verify green**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsDetailDialog.test.tsx`
Expected: PASS (existing days tests + new hours test).

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/components/EventGapsDetailDialog.tsx leg2-reporting/src/components/EventGapsDetailDialog.test.tsx
git commit -m "feat(leg2): detail dialog honors unit + widened for horizontal view"
```

---

### Task 6: `useEventGaps` exposes `unit` / `setUnit`

**Files:**
- Modify: `leg2-reporting/src/hooks/useEventGaps.ts`

**Interfaces:**
- Consumes: `GapUnit` from `@/lib/eventGaps`.
- Produces: hook return gains `unit: GapUnit` (default `"days"`) and `setUnit: (u: GapUnit) => void`. Presentation-only — does NOT appear in the `load` dependency array (no refetch).

- [ ] **Step 1: Add the state**

In `leg2-reporting/src/hooks/useEventGaps.ts`:
- Add `GapUnit` to the type import from `@/lib/eventGaps` (line ~5-9): add `type GapUnit,`.
- After the `productOptions` state (line ~22) add: `const [unit, setUnit] = useState<GapUnit>("days");`
- In the returned object (lines ~93-100), add `unit, setUnit,` (e.g. alongside `granularity, setGranularity`).

- [ ] **Step 2: Typecheck to verify green**

Run: `cd leg2-reporting && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add leg2-reporting/src/hooks/useEventGaps.ts
git commit -m "feat(leg2): useEventGaps exposes unit/setUnit (presentation-only)"
```

---

### Task 7: `EventGapsFilters` Days/Hours toggle

**Files:**
- Modify: `leg2-reporting/src/components/EventGapsFilters.tsx`
- Test: `leg2-reporting/src/components/EventGapsFilters.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `GapUnit` from `@/lib/eventGaps`.
- Produces: `EventGapsFiltersProps` gains `unit: GapUnit` and `onUnitChange: (u: GapUnit) => void`. Renders a two-button toggle (Days | Hours) mirroring the Granularity toggle.

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/components/EventGapsFilters.test.tsx`:

```ts
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventGapsFilters } from "@/components/EventGapsFilters";
import { PRODUCT_ALL } from "@/lib/eventGaps";

function renderFilters(overrides = {}) {
  const props = {
    dateRange: { from: "2026-01-01", to: "2026-03-01" },
    onDateChange: vi.fn(), onApplyPreset: vi.fn(),
    product: PRODUCT_ALL, onProductChange: vi.fn(), productOptions: [],
    originCountry: "", destCountry: "",
    onOriginCountryChange: vi.fn(), onDestCountryChange: vi.fn(), countryOptions: [],
    granularity: "centre" as const, onGranularityChange: vi.fn(),
    unit: "days" as const, onUnitChange: vi.fn(),
    ...overrides,
  };
  render(<EventGapsFilters {...props} />);
  return props;
}

describe("EventGapsFilters unit toggle", () => {
  it("calls onUnitChange('hours') when Hours is clicked", () => {
    const props = renderFilters();
    fireEvent.click(screen.getByRole("button", { name: "Hours" }));
    expect(props.onUnitChange).toHaveBeenCalledWith("hours");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsFilters.test.tsx`
Expected: FAIL — `unit`/`onUnitChange` not in props; no "Hours" button.

- [ ] **Step 3: Add the toggle**

In `leg2-reporting/src/components/EventGapsFilters.tsx`:
- Import `GapUnit`: change the `@/lib/eventGaps` import to include `type GapUnit`.
- Add to `EventGapsFiltersProps`: `unit: GapUnit;` and `onUnitChange: (u: GapUnit) => void;`
- Add `unit, onUnitChange,` to the destructured params.
- After the Granularity block (the `<div>` ending at line ~111), add a matching block:

```tsx
      <div className="flex flex-col gap-1">
        <Label>{strings.gaps.unit}</Label>
        <div className="flex gap-1">
          <Button type="button" size="sm"
            variant={unit === "days" ? "default" : "outline"}
            onClick={() => onUnitChange("days")}>
            {strings.gaps.unitDays}
          </Button>
          <Button type="button" size="sm"
            variant={unit === "hours" ? "default" : "outline"}
            onClick={() => onUnitChange("hours")}>
            {strings.gaps.unitHours}
          </Button>
        </div>
      </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd leg2-reporting && npx vitest run src/components/EventGapsFilters.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/components/EventGapsFilters.tsx leg2-reporting/src/components/EventGapsFilters.test.tsx
git commit -m "feat(leg2): Days/Hours toggle in EventGapsFilters"
```

---

### Task 8: `EventGapsPage` — wire unit end-to-end + open S9 in a new tab

**Files:**
- Modify: `leg2-reporting/src/pages/EventGapsPage.tsx`
- Test: `leg2-reporting/src/pages/EventGapsPage.test.tsx`

**Interfaces:**
- Consumes: `unit`/`setUnit` from `useEventGaps`; `receptacleUrl` from `@/lib/hashRoute`.
- Produces: filters/matrix/detail all receive `unit`; clicking an S9 calls `window.open(receptacleUrl(s9), "_blank", "noopener")`. `AtatDialog`, its import, and the `atatS9` state are removed.

- [ ] **Step 1: Update the page test**

In `leg2-reporting/src/pages/EventGapsPage.test.tsx`:
- Delete the `vi.mock("@/components/AtatDialog", ...)` block (lines 29-31).
- Replace the last test ("opens the ATAT dialog...") with a new-tab assertion:

```ts
it("opens the receptacle detail in a new tab when an S9 is clicked", async () => {
  const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
  render(<EventGapsPage />);
  await waitFor(() => expect(screen.getByText("3.2")).toBeInTheDocument());
  fireEvent.click(screen.getByText("3.2"));
  await waitFor(() => expect(screen.getByText("S9A")).toBeInTheDocument());
  fireEvent.click(screen.getByText("S9A"));
  expect(openSpy).toHaveBeenCalledWith("/#/receptacle/S9A", "_blank", "noopener");
  openSpy.mockRestore();
});
```

- Add a unit-toggle test:

```ts
it("switches matrix values to hours via the unit toggle", async () => {
  render(<EventGapsPage />);
  await waitFor(() => expect(screen.getByText("3.2")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Hours" }));
  await waitFor(() => expect(screen.getByText("76.8")).toBeInTheDocument());
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd leg2-reporting && npx vitest run src/pages/EventGapsPage.test.tsx`
Expected: FAIL — S9 still opens dialog (`window.open` not called); no "Hours" button wired.

- [ ] **Step 3: Wire the page**

In `leg2-reporting/src/pages/EventGapsPage.tsx`:
- Remove `import { AtatDialog } from "@/components/AtatDialog";` (line 7).
- Add `import { receptacleUrl } from "@/lib/hashRoute";`.
- Add `unit, setUnit,` to the destructured `useEventGaps()` return (around lines 18-23).
- Remove the `atatS9` state (line 28: `const [atatS9, setAtatS9] = useState<string | null>(null);`).
- Pass unit to `EventGapsFilters`: add `unit={unit} onUnitChange={setUnit}` to its props (around line 83).
- Pass unit to `EventGapsMatrix`: add `unit={unit}` (around line 91).
- Pass unit to `EventGapsDetailDialog`: add `unit={unit}` (around line 100).
- Change `onSelectS9={setAtatS9}` (line 107) → `onSelectS9={(s9) => window.open(receptacleUrl(s9), "_blank", "noopener")}`.
- Delete the entire `<AtatDialog ... />` block (lines 109-114).

- [ ] **Step 4: Run tests to verify green**

Run: `cd leg2-reporting && npx vitest run src/pages/EventGapsPage.test.tsx`
Expected: PASS (all page tests, including exclusion + product-filter tests).

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/pages/EventGapsPage.tsx leg2-reporting/src/pages/EventGapsPage.test.tsx
git commit -m "feat(leg2): event gaps wires unit + opens S9 detail in a new tab"
```

---

### Task 9: `RfidEventsPage` — open S9 in a new tab

**Files:**
- Modify: `leg2-reporting/src/pages/RfidEventsPage.tsx`
- Test: `leg2-reporting/src/pages/RfidEventsPage.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `receptacleUrl` from `@/lib/hashRoute`.
- Produces: pivot `onSelectS9` calls `window.open(receptacleUrl(s9), "_blank", "noopener")`; `selectedS9` fixed to `null`. `AtatDialog`, its import, and the `dialogS9` state are removed. The `RfidEventsPivot` prop contract (`selectedS9`/`onSelectS9`) is unchanged.

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/pages/RfidEventsPage.test.tsx`. Mirror the mock shape from `useRfidEventsReport.test.tsx` (the `@/lib/supabase` mock exposes `supabase`, `fetchRfidMovements`, `fetchReaderMaster`). Use the same movement fixture: `s9_id: "S1"` with `event_datetime_utc: "2026-07-03T10:00:00+00:00"`, which falls inside the page's default last-90-days window (current date 2026-07-08), so the S9 renders as a clickable cell in the pivot.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { RfidMovement } from "@/lib/supabase";

const fetchMovements = vi.fn();
const fetchReaderMaster = vi.fn().mockResolvedValue([
  { lpi: "R1", gate_id: "G1", gate_name: "MT", gate_purpose: "exit", reading_direction: "out", facility_name: "Facility A", site_id: "S1", reader_country_code: "IN", handover_point: true },
]);
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchRfidMovements: (...a: unknown[]) => fetchMovements(...a),
  fetchReaderMaster: (...a: unknown[]) => fetchReaderMaster(...a),
}));

import RfidEventsPage from "@/pages/RfidEventsPage";

function mov(p: Partial<RfidMovement>): RfidMovement {
  return {
    movement_id: "m", s9_id: "S1", tag_id: "G.1UPU.X", reader_id: "R1",
    movement_type: "OUTBOUND", route_country_role: "ORIGIN", edi_equivalent: "2320",
    origin_country_code: "IN", destination_country_code: "JP",
    movement_country_code: "IN", country_sequence_number: 1,
    event_datetime_utc: "2026-07-03T10:00:00+00:00",
    event_datetime_local: "2026-07-03T19:00:00", reader_timezone: "Asia/Kolkata",
    site_impc_code: "INMUBA", centre_code: "INMUBA", site_name: "Mumbai",
    city: "Mumbai", country_code: "IN", handover_point: true, handover_quality_status: "handover_ok",
    ...p,
  };
}

describe("RfidEventsPage new-tab S9", () => {
  beforeEach(() => { fetchMovements.mockReset(); fetchReaderMaster.mockClear(); });

  it("opens receptacle detail in a new tab when an S9 cell is clicked", async () => {
    fetchMovements.mockResolvedValue([mov({ s9_id: "S1" })]);
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(<RfidEventsPage />);
    const s9El = await screen.findByText("S1");
    fireEvent.click(s9El);
    expect(openSpy).toHaveBeenCalledWith("/#/receptacle/S1", "_blank", "noopener");
    openSpy.mockRestore();
  });
});
```

If the S9 text `"S1"` collides with another cell (e.g. a site id), narrow the query — read `RfidEventsPivot.tsx` to see which element carries `onClick={() => onSelectS9(row.s9_id)}` and target its role/class. The page owns the handler, so keep the assertion at the page level.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && npx vitest run src/pages/RfidEventsPage.test.tsx`
Expected: FAIL — click currently opens a dialog; `window.open` not called.

- [ ] **Step 3: Wire the page**

In `leg2-reporting/src/pages/RfidEventsPage.tsx`:
- Remove `import { AtatDialog } from "@/components/AtatDialog";` (line 6).
- Add `import { receptacleUrl } from "@/lib/hashRoute";`.
- Remove the `dialogS9` state (line 17: `const [dialogS9, setDialogS9] = useState<string | null>(null);`).
- On `RfidEventsPivot` (lines 45-46): change `selectedS9={dialogS9}` → `selectedS9={null}` and `onSelectS9={(s9) => setDialogS9(s9)}` → `onSelectS9={(s9) => window.open(receptacleUrl(s9), "_blank", "noopener")}`.
- Delete the entire `<AtatDialog ... />` block (lines 54-59).
- If `useState` is now unused, drop it from the React import; keep it if `editorLpi`/`timeMode` still use it (they do — `useState` stays).

- [ ] **Step 4: Run tests to verify green**

Run: `cd leg2-reporting && npx vitest run src/pages/RfidEventsPage.test.tsx src/components/RfidEventsPivot.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/pages/RfidEventsPage.tsx leg2-reporting/src/pages/RfidEventsPage.test.tsx
git commit -m "feat(leg2): RFID report opens S9 detail in a new tab"
```

---

### Task 10: Delete `AtatDialog`; rename visible ATAT text; add heading to `AtatPage`

**Files:**
- Delete: `leg2-reporting/src/components/AtatDialog.tsx`
- Delete: `leg2-reporting/src/components/AtatDialog.test.tsx`
- Modify: `leg2-reporting/src/i18n/strings.ts:117`
- Modify: `leg2-reporting/src/pages/AtatPage.tsx`
- Test: `leg2-reporting/src/pages/AtatPage.test.tsx`

**Interfaces:**
- Consumes: `strings.atat.title` (now "Receptacle Events") for the standalone page heading.
- Produces: no `AtatDialog` in the codebase; `AtatPage` renders a visible `<h2>` with `strings.atat.title`.

- [ ] **Step 1: Delete the dead component + its test**

```bash
git rm leg2-reporting/src/components/AtatDialog.tsx leg2-reporting/src/components/AtatDialog.test.tsx
```

- [ ] **Step 2: Rename the visible string**

In `leg2-reporting/src/i18n/strings.ts` line 117, change `title: "Receptacle timeline",` → `title: "Receptacle Events",`.

- [ ] **Step 3: Write the failing test for the page heading**

In `leg2-reporting/src/pages/AtatPage.test.tsx`, add (mirror the existing render/deps setup in that file):

```ts
it("shows the Receptacle Events heading when an s9 is active", () => {
  render(<AtatPage s9="S9A" deps={deps} />);
  expect(screen.getByRole("heading", { name: "Receptacle Events" })).toBeInTheDocument();
});
```

Use the same `deps` mock the file's other tests use.

- [ ] **Step 4: Run test to verify it fails**

Run: `cd leg2-reporting && npx vitest run src/pages/AtatPage.test.tsx`
Expected: FAIL — no such heading.

- [ ] **Step 5: Add the heading to `AtatPage`**

In `leg2-reporting/src/pages/AtatPage.tsx`, add `import { strings } from "@/i18n/strings";` if not already imported (it is, line 5). In the active branch (the `return` at lines 44-50), add a heading as the first child inside the wrapper `<div className="mx-auto max-w-4xl p-4">`:

```tsx
      <h2 className="mb-3 text-lg font-semibold">{strings.atat.title}</h2>
```

- [ ] **Step 6: Run the full suite to verify green**

Run: `cd leg2-reporting && npx vitest run && npx tsc --noEmit`
Expected: PASS, no TS errors, no dangling imports of `AtatDialog`.

- [ ] **Step 7: Commit**

```bash
git add leg2-reporting/src/i18n/strings.ts leg2-reporting/src/pages/AtatPage.tsx leg2-reporting/src/pages/AtatPage.test.tsx
git commit -m "refactor(leg2): drop AtatDialog; 'Receptacle Events' heading + label"
```

---

## Final verification

- [ ] Run the full suite: `cd leg2-reporting && npx vitest run` → all green.
- [ ] Typecheck: `cd leg2-reporting && npx tsc --noEmit` → clean.
- [ ] Manual (browser) smoke: unit toggle flips matrix + detail between days/hours; detail dialog is wide with all columns visible; clicking an S9 in both Event gaps and RFID Report opens a new tab at the Receptacle Events screen for that S9.

## Notes / risks

- New-tab auth: the opened tab loads the app fresh; `AuthProvider` restores the Supabase session from `localStorage`, so no re-login is expected. Confirm during the browser smoke test.
- `window.open` URL in jsdom resolves against `http://localhost/`, so tests assert `"/#/receptacle/<s9>"`. If a test harness sets a different base path, adjust the expected string accordingly.
