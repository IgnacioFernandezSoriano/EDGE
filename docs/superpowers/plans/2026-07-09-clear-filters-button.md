# Clear Filters Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Clear filters" button to both filter panels (Report and Event gaps) that resets every filter to its default value and is disabled when already at defaults.

**Architecture:** Reset logic and the "is anything non-default?" (`isDirty`) computation live in the state-owning hooks (`useRfidEventsReport`, `useEventGaps`). Filter components stay presentational, gaining two props (`onClear`, `canClear`) and rendering a ghost button. For the Report page, `timeMode` lives in the page, so the page composes `resetFilters()` + `setTimeMode("utc")` and OR-s `timeMode !== "utc"` into `canClear`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + @testing-library/react, Tailwind, lucide-react, Radix UI.

## Global Constraints

- All work is inside `leg2-reporting/`. Run every command from that directory.
- User-facing strings live in `src/i18n/strings.ts` — never hardcode copy in components.
- Button uses shadcn `Button` (`@/components/ui/button`) with `variant="ghost"` and `size="sm"`; icon is `FilterX` from `lucide-react`.
- Defaults are exact:
  - Report filter default (`INITIAL_FILTER`): `{ originCountry: null, destCountry: null, s9Query: "", rteQuery: "", onlyNoEventCode: false }`.
  - Report `timeMode` default: `"utc"`.
  - Event gaps defaults: `product = PRODUCT_ALL`, `originCountry = ""`, `destCountry = ""`, `granularity = "centre"`, `unit = "days"`.
  - Date range default (both panels): `presetRange("last90Days")`; "at default" is tested via `activePreset(dateRange) === "last90Days"`.
- Test command (single file): `pnpm exec vitest run <path>`. Full suite: `pnpm test`.
- Commit after each task.

---

### Task 1: Add the `clearFilters` i18n string

**Files:**
- Modify: `src/i18n/strings.ts` (the `filters` object, ~lines 49-60)

**Interfaces:**
- Produces: `strings.filters.clearFilters: "Clear filters"` — consumed by Tasks 3 and 6.

- [ ] **Step 1: Add the string**

In `src/i18n/strings.ts`, inside the `filters: { ... }` object, add a `clearFilters` entry (place it after `onlyNoEventCode`):

```ts
  filters: {
    origCountry: "Orig country",
    destCountry: "Dest country",
    s9: "S9",
    rfidTag: "RFID Tag",
    all: "All",
    searchS9: "Search S9",
    searchRfidTag: "Search RFID Tag",
    from: "From",
    to: "To",
    onlyNoEventCode: "Only No RFID event code",
    clearFilters: "Clear filters",
  },
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm exec vitest run src/smoke.test.ts`
Expected: PASS (confirms the strings module still compiles/imports cleanly).

- [ ] **Step 3: Commit**

```bash
git add src/i18n/strings.ts
git commit -m "feat(leg2): add Clear filters i18n string"
```

---

### Task 2: `useRfidEventsReport` — `resetFilters()` and `isDirty`

**Files:**
- Modify: `src/hooks/useRfidEventsReport.ts`
- Test: `src/hooks/useRfidEventsReport.test.tsx`

**Interfaces:**
- Consumes: existing `INITIAL_FILTER`, `presetRange`, `setFilter`, `setDateRange`.
- Produces (added to the hook's returned object):
  - `resetFilters: () => void` — sets `filter` to `INITIAL_FILTER` and `dateRange` to `presetRange("last90Days")`.
  - `isDirty: boolean` — `true` when any filter field differs from `INITIAL_FILTER`, or `activePreset(dateRange) !== "last90Days"`.

- [ ] **Step 1: Write the failing tests**

Append these tests inside the `describe("useRfidEventsReport", ...)` block in `src/hooks/useRfidEventsReport.test.tsx`:

```tsx
  it("isDirty is false at defaults and true after a filter change", async () => {
    fetchMovements.mockResolvedValue([mov({ s9_id: "S1" })]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setFilter((f) => ({ ...f, s9Query: "abc" })));
    await waitFor(() => expect(result.current.isDirty).toBe(true));
  });

  it("isDirty is true when the date range leaves the default preset", async () => {
    fetchMovements.mockResolvedValue([mov({ s9_id: "S1" })]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setDateRange({ from: "2026-01-01", to: "2026-01-31" }));
    await waitFor(() => expect(result.current.isDirty).toBe(true));
  });

  it("resetFilters returns filter and dateRange to defaults", async () => {
    fetchMovements.mockResolvedValue([mov({ s9_id: "S1" })]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setFilter((f) => ({ ...f, s9Query: "abc", originCountry: "IN" }));
      result.current.setDateRange({ from: "2026-01-01", to: "2026-01-31" });
    });
    await waitFor(() => expect(result.current.isDirty).toBe(true));

    act(() => result.current.resetFilters());
    await waitFor(() => expect(result.current.isDirty).toBe(false));
    expect(result.current.filter).toEqual({
      originCountry: null, destCountry: null, s9Query: "", rteQuery: "", onlyNoEventCode: false,
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/hooks/useRfidEventsReport.test.tsx`
Expected: FAIL — `result.current.isDirty` is `undefined`, `result.current.resetFilters is not a function`.

- [ ] **Step 3: Implement `resetFilters` and `isDirty`**

In `src/hooks/useRfidEventsReport.ts`:

Update the datePresets import to add `activePreset`:

```ts
import { presetRange, activePreset, type DateRange, type DatePreset } from "@/lib/datePresets";
```

Add `useCallback` reset and the `isDirty` derivation just after `applyPreset` (around line 76), before `windowMovements`:

```ts
  const resetFilters = useCallback(() => {
    setFilter(INITIAL_FILTER);
    setDateRange(presetRange("last90Days"));
  }, []);

  const isDirty =
    filter.originCountry !== INITIAL_FILTER.originCountry ||
    filter.destCountry !== INITIAL_FILTER.destCountry ||
    filter.s9Query !== INITIAL_FILTER.s9Query ||
    filter.rteQuery !== INITIAL_FILTER.rteQuery ||
    filter.onlyNoEventCode !== INITIAL_FILTER.onlyNoEventCode ||
    activePreset(dateRange) !== "last90Days";
```

Add both to the returned object (extend the existing `return { ... }`):

```ts
    dateRange,
    setDateRange,
    applyPreset,
    resetFilters,
    isDirty,
    reload: load,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/hooks/useRfidEventsReport.test.tsx`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRfidEventsReport.ts src/hooks/useRfidEventsReport.test.tsx
git commit -m "feat(leg2): resetFilters + isDirty in useRfidEventsReport"
```

---

### Task 3: `ReportFilters` — render the Clear button

**Files:**
- Modify: `src/components/ReportFilters.tsx`
- Test: `src/components/ReportFilters.test.tsx`

**Interfaces:**
- Consumes: `strings.filters.clearFilters` (Task 1).
- Produces: `ReportFilters` gains two required props — `onClear: () => void` and `canClear: boolean`. Consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Add these tests inside the `describe("ReportFilters", ...)` block in `src/components/ReportFilters.test.tsx`. Note: the existing tests call `render(<ReportFilters ... />)` without the new props — update ALL existing `ReportFilters` renders in this file to also pass `onClear={() => {}}` and `canClear={false}` (add both lines next to `onApplyPreset` in each render). Then add:

```tsx
  it("disables Clear filters when canClear is false", () => {
    render(
      <ReportFilters
        filter={base}
        setFilter={() => {}}
        originOptions={[]}
        destOptions={[]}
        hasIncidents
        timeMode="utc"
        onTimeModeChange={() => {}}
        dateRange={baseDateRange}
        onDateChange={() => {}}
        onApplyPreset={() => {}}
        onClear={() => {}}
        canClear={false}
      />
    );
    expect(screen.getByRole("button", { name: strings.filters.clearFilters })).toBeDisabled();
  });

  it("clicking Clear filters fires onClear when enabled", () => {
    const onClear = vi.fn();
    render(
      <ReportFilters
        filter={base}
        setFilter={() => {}}
        originOptions={[]}
        destOptions={[]}
        hasIncidents
        timeMode="utc"
        onTimeModeChange={() => {}}
        dateRange={baseDateRange}
        onDateChange={() => {}}
        onApplyPreset={() => {}}
        onClear={onClear}
        canClear
      />
    );
    fireEvent.click(screen.getByRole("button", { name: strings.filters.clearFilters }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/components/ReportFilters.test.tsx`
Expected: FAIL — no button named "Clear filters" (and TypeScript errors on the new props).

- [ ] **Step 3: Implement the button**

In `src/components/ReportFilters.tsx`:

Add the icon import at the top (after the existing imports):

```ts
import { FilterX } from "lucide-react";
```

Extend the props type — add `onClear` and `canClear` to the destructured params and the type annotation:

```tsx
export function ReportFilters({
  filter,
  setFilter,
  originOptions,
  destOptions,
  hasIncidents,
  timeMode,
  onTimeModeChange,
  dateRange,
  onDateChange,
  onApplyPreset,
  onClear,
  canClear,
}: {
  filter: ReportFilterState;
  setFilter: Dispatch<SetStateAction<ReportFilterState>>;
  originOptions: string[];
  destOptions: string[];
  hasIncidents: boolean;
  timeMode: TimeMode;
  onTimeModeChange: (m: TimeMode) => void;
  dateRange: DateRange;
  onDateChange: (r: DateRange) => void;
  onApplyPreset: (p: DatePreset) => void;
  onClear: () => void;
  canClear: boolean;
}) {
```

Replace the right-hand side of the top row (the `<div className="flex items-center gap-2">` holding the tz toggle) so the Clear button sits to its left, wrapped in a group:

```tsx
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canClear}
            onClick={onClear}
          >
            <FilterX />
            {strings.filters.clearFilters}
          </Button>
          <div className="flex items-center gap-2">
            <Label htmlFor="tz">{strings.timeMode.utc}</Label>
            <Switch
              id="tz"
              checked={timeMode === "local"}
              onCheckedChange={(c) => onTimeModeChange(c ? "local" : "utc")}
            />
            <Label htmlFor="tz">{strings.timeMode.local}</Label>
          </div>
        </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/components/ReportFilters.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReportFilters.tsx src/components/ReportFilters.test.tsx
git commit -m "feat(leg2): Clear filters button in ReportFilters"
```

---

### Task 4: Wire `RfidEventsPage` — compose `timeMode` into clear

**Files:**
- Modify: `src/pages/RfidEventsPage.tsx`
- Test: `src/pages/RfidEventsPage.test.tsx`

**Interfaces:**
- Consumes: `resetFilters`, `isDirty` (Task 2); `ReportFilters` `onClear`/`canClear` (Task 3).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Add this test to `src/pages/RfidEventsPage.test.tsx`. It needs `strings`; add the import at the top if absent: `import { strings } from "@/i18n/strings";`. Add inside the `describe`:

```tsx
  it("Clear filters resets timeMode and disables itself", async () => {
    fetchMovements.mockResolvedValue([mov({ s9_id: "S1" })]);
    render(<RfidEventsPage />);

    const clearBtn = await screen.findByRole("button", { name: strings.filters.clearFilters });
    expect(clearBtn).toBeDisabled();

    // Only timeMode changes (UTC -> Local); the "UTC" label targets the tz switch.
    fireEvent.click(screen.getByLabelText(strings.timeMode.utc));
    expect(clearBtn).toBeEnabled();

    fireEvent.click(clearBtn);
    expect(clearBtn).toBeDisabled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/pages/RfidEventsPage.test.tsx`
Expected: FAIL — `ReportFilters` isn't receiving `onClear`/`canClear`, so no such button exists yet (and TS errors on missing props).

- [ ] **Step 3: Wire the page**

In `src/pages/RfidEventsPage.tsx`:

Pull `resetFilters` and `isDirty` out of the hook (extend the existing destructure):

```ts
  const {
    loading, error, report, hasIncidents, readerMap, filter, setFilter, originOptions, destOptions,
    dateRange, setDateRange, applyPreset, resetFilters, isDirty, reload,
  } = useRfidEventsReport();
```

Add the composed handlers just before the `return` (after the `useState` lines):

```ts
  const canClear = isDirty || timeMode !== "utc";
  const onClear = () => {
    resetFilters();
    setTimeMode("utc");
  };
```

Pass them to `<ReportFilters>` (add two props alongside `onApplyPreset`):

```tsx
          onApplyPreset={applyPreset}
          onClear={onClear}
          canClear={canClear}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/pages/RfidEventsPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/RfidEventsPage.tsx src/pages/RfidEventsPage.test.tsx
git commit -m "feat(leg2): wire Clear filters (incl. timeMode) in RfidEventsPage"
```

---

### Task 5: `useEventGaps` — `resetFilters()` and `isDirty`

**Files:**
- Modify: `src/hooks/useEventGaps.ts`
- Test: `src/hooks/useEventGaps.test.tsx`

**Interfaces:**
- Consumes: existing `PRODUCT_ALL`, `presetRange`, and the `setProduct`/`setOriginCountry`/`setDestCountry`/`setGranularity`/`setUnit`/`setDateRange` setters.
- Produces (added to the hook's returned object):
  - `resetFilters: () => void` — sets `product = PRODUCT_ALL`, `originCountry = ""`, `destCountry = ""`, `granularity = "centre"`, `unit = "days"`, `dateRange = presetRange("last90Days")`.
  - `isDirty: boolean` — `true` when any of those differ from default, or `activePreset(dateRange) !== "last90Days"`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("useEventGaps", ...)` block in `src/hooks/useEventGaps.test.tsx`:

```tsx
  it("isDirty is false at defaults and true after a filter change", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setOriginCountry("IN"));
    await waitFor(() => expect(result.current.isDirty).toBe(true));
  });

  it("resetFilters returns product, countries, granularity, unit and dateRange to defaults", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setProduct("A");
      result.current.setOriginCountry("IN");
      result.current.setDestCountry("JP");
      result.current.setGranularity("country");
      result.current.setUnit("hours");
      result.current.setDateRange({ from: "2026-01-01", to: "2026-01-31" });
    });
    await waitFor(() => expect(result.current.isDirty).toBe(true));

    act(() => result.current.resetFilters());
    await waitFor(() => expect(result.current.isDirty).toBe(false));
    expect(result.current.product).toBe("all");
    expect(result.current.originCountry).toBe("");
    expect(result.current.destCountry).toBe("");
    expect(result.current.granularity).toBe("centre");
    expect(result.current.unit).toBe("days");
  });
```

(`PRODUCT_ALL` is the string `"all"`; the test asserts the literal to avoid an extra import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/hooks/useEventGaps.test.tsx`
Expected: FAIL — `isDirty` is `undefined`, `resetFilters is not a function`.

- [ ] **Step 3: Implement `resetFilters` and `isDirty`**

In `src/hooks/useEventGaps.ts`:

Update the datePresets import to add `activePreset`:

```ts
import { presetRange, activePreset, type DateRange, type DatePreset } from "@/lib/datePresets";
```

Add the reset callback and `isDirty` just after `applyPreset` (around line 94):

```ts
  const resetFilters = useCallback(() => {
    setProduct(PRODUCT_ALL);
    setOriginCountry("");
    setDestCountry("");
    setGranularity("centre");
    setUnit("days");
    setDateRange(presetRange("last90Days"));
  }, []);

  const isDirty =
    product !== PRODUCT_ALL ||
    originCountry !== "" ||
    destCountry !== "" ||
    granularity !== "centre" ||
    unit !== "days" ||
    activePreset(dateRange) !== "last90Days";
```

Add both to the returned object (extend the existing `return { ... }`):

```ts
    unit, setUnit,
    originCountry, setOriginCountry, destCountry, setDestCountry,
    countryOptions, productOptions, hasNoProduct,
    resetFilters, isDirty,
    reload: load,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/hooks/useEventGaps.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useEventGaps.ts src/hooks/useEventGaps.test.tsx
git commit -m "feat(leg2): resetFilters + isDirty in useEventGaps"
```

---

### Task 6: `EventGapsFilters` Clear button + wire `EventGapsPage`

**Files:**
- Modify: `src/components/EventGapsFilters.tsx`
- Modify: `src/pages/EventGapsPage.tsx`
- Test: `src/components/EventGapsFilters.test.tsx`

**Interfaces:**
- Consumes: `strings.filters.clearFilters` (Task 1); `resetFilters`, `isDirty` (Task 5).
- Produces: `EventGapsFilters` gains `onClear: () => void` and `canClear: boolean` in `EventGapsFiltersProps`.

- [ ] **Step 1: Write the failing tests**

In `src/components/EventGapsFilters.test.tsx`, add `onClear` and `canClear` to the default props in the `setup()` helper so existing tests keep compiling:

```ts
    unit: "days" as const,
    onUnitChange: vi.fn(),
    onClear: vi.fn(),
    canClear: false,
    ...over,
```

Then add these tests inside the `describe`:

```tsx
  it("disables Clear filters when canClear is false", () => {
    setup({ canClear: false });
    expect(screen.getByRole("button", { name: strings.filters.clearFilters })).toBeDisabled();
  });

  it("clicking Clear filters fires onClear when enabled", () => {
    const props = setup({ canClear: true });
    fireEvent.click(screen.getByRole("button", { name: strings.filters.clearFilters }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/components/EventGapsFilters.test.tsx`
Expected: FAIL — no "Clear filters" button (and TS errors on `onClear`/`canClear`).

- [ ] **Step 3: Implement the button in the component**

In `src/components/EventGapsFilters.tsx`:

Add the icon import at the top:

```ts
import { FilterX } from "lucide-react";
```

Add the two props to `EventGapsFiltersProps`:

```ts
  unit: GapUnit;
  onUnitChange: (u: GapUnit) => void;
  onClear: () => void;
  canClear: boolean;
}
```

Add them to the destructured params:

```tsx
export function EventGapsFilters({
  dateRange, onDateChange, onApplyPreset,
  product, onProductChange, productOptions, hasNoProduct,
  originCountry, destCountry, onOriginCountryChange, onDestCountryChange, countryOptions,
  granularity, onGranularityChange,
  unit, onUnitChange,
  onClear, canClear,
}: EventGapsFiltersProps) {
```

Wrap the existing single filter bar in a column with a header row that right-aligns the Clear button. Change the outer element from `<div className="flex flex-wrap items-end gap-3">` to:

```tsx
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canClear}
          onClick={onClear}
        >
          <FilterX />
          {strings.filters.clearFilters}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {/* ...all the existing filter fields unchanged... */}
      </div>
    </div>
  );
```

Move the existing children (date inputs, presets, product, countries, granularity, unit) inside the new inner `<div className="flex flex-wrap items-end gap-3">`, and keep the original closing `</div>` as the inner close, adding the extra outer `</div>`.

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `pnpm exec vitest run src/components/EventGapsFilters.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `EventGapsPage`**

In `src/pages/EventGapsPage.tsx`:

Pull `resetFilters` and `isDirty` from the hook (extend the destructure):

```ts
    originCountry, setOriginCountry, destCountry, setDestCountry, countryOptions,
    unit, setUnit, resetFilters, isDirty,
  } = useEventGaps();
```

Pass them to `<EventGapsFilters>` (add two props at the end of its prop list):

```tsx
          granularity={granularity} onGranularityChange={setGranularity}
          unit={unit} onUnitChange={setUnit}
          onClear={resetFilters} canClear={isDirty}
```

- [ ] **Step 6: Run the full suite + typecheck**

Run: `pnpm test`
Expected: PASS (all files).

Run: `pnpm check`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/EventGapsFilters.tsx src/components/EventGapsFilters.test.tsx src/pages/EventGapsPage.tsx
git commit -m "feat(leg2): Clear filters button in Event gaps panel"
```

---

## Self-Review

**Spec coverage:**
- Report panel button → Tasks 2, 3, 4. ✓
- Event gaps panel button → Tasks 5, 6. ✓
- Reset everything to default (incl. dateRange, granularity, unit, timeMode) → Report: Task 2 (filter+dateRange) + Task 4 (timeMode); Event gaps: Task 5. ✓
- Disabled when at defaults → `isDirty`/`canClear` in Tasks 2, 4, 5 + button `disabled` in Tasks 3, 6. ✓
- i18n key → Task 1. ✓
- Ghost button + FilterX icon + placement → Tasks 3 (top row, left of tz toggle) and 6 (header row above bar). ✓
- Tests for hooks and components → each task's Step 1. ✓
- AtatView out of scope → untouched. ✓

**Placeholder scan:** none — every code step shows complete code.

**Type consistency:** `resetFilters: () => void` and `isDirty: boolean` are named identically across hooks, pages, and component props (`onClear`/`canClear`). `activePreset`, `presetRange`, `INITIAL_FILTER`, `PRODUCT_ALL` all reference existing exports. `FilterX` is a valid `lucide-react` export.
