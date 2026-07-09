# Clear Filters button — design

**Date:** 2026-07-09
**App:** `leg2-reporting`
**Branch:** `feat/leg2-auth-screens` (current) — implementation may branch from here.

## Goal

Add a **"Clear filters"** button to every filter panel that resets all filters to
their default values. The button is disabled when the panel is already at its
defaults.

## Scope

The app has two filter panels:

- `ReportFilters` — used by `RfidEventsPage` (Report view).
- `EventGapsFilters` — used by `EventGapsPage` (Event gaps view).

The `AtatView` (Receptacle) exposes only a UTC/Local time toggle, not a data
filter panel, so it is **out of scope**.

## Behavior (agreed)

The button resets **everything to default** and is **disabled when already at
default**.

| Panel | Field → default |
|---|---|
| **Report** | `originCountry → null`, `destCountry → null`, `s9Query → ""`, `rteQuery → ""`, `onlyNoEventCode → false`, `dateRange → presetRange("last90Days")`, `timeMode → "utc"` |
| **Event gaps** | `product → PRODUCT_ALL`, `originCountry → ""`, `destCountry → ""`, `granularity → "centre"`, `unit → "days"`, `dateRange → presetRange("last90Days")` |

Note: Event gaps has no time-zone toggle; `timeMode` applies only to Report.

## Architecture

The reset logic and the "is it dirty?" computation live in the **hooks**, where
the state lives. Filter components stay presentational and receive two new props.

### `useRfidEventsReport`

- Add `resetFilters()`: `setFilter(INITIAL_FILTER)` and
  `setDateRange(presetRange("last90Days"))`.
- Add `isDirty: boolean`, computed as:
  - `filter` deep-differs from `INITIAL_FILTER`, **or**
  - `activePreset(dateRange) !== "last90Days"`.
- Expose `resetFilters` and `isDirty` from the hook's return object.

`timeMode` lives in `RfidEventsPage` (not the hook), so the page composes the
final wiring:

```ts
const onClear = () => { resetFilters(); setTimeMode("utc"); };
const canClear = isDirty || timeMode !== "utc";
```

The `isDirty` filter comparison compares each field explicitly against
`INITIAL_FILTER` (no deep-equal dependency needed — the shape is a flat 5-field
object).

### `useEventGaps`

- Add `resetFilters()`: reset `product`, `originCountry`, `destCountry`,
  `granularity`, `unit`, and `dateRange` to their defaults
  (`PRODUCT_ALL`, `""`, `""`, `"centre"`, `"days"`, `presetRange("last90Days")`).
- Add `isDirty: boolean`, true when any of those differ from default (dateRange
  checked via `activePreset(dateRange) !== "last90Days"`).
- Expose `resetFilters` and `isDirty`. `EventGapsPage` passes them straight
  through as `onClear` / `canClear`.

### Components

Both filter components gain two props:

```ts
onClear: () => void;
canClear: boolean;
```

They render a button in the panel's top-right area:

```tsx
<Button
  variant="ghost"
  size="sm"
  disabled={!canClear}
  onClick={onClear}
>
  <FilterX />
  {strings.filters.clearFilters}
</Button>
```

- `variant="ghost"` keeps it visually subordinate to the preset buttons
  (`default`/`outline`).
- Icon: `FilterX` from `lucide-react` (already in the dependency tree).
- **ReportFilters**: place it in the existing top row, alongside the UTC/Local
  toggle (the row already uses `justify-between`).
- **EventGapsFilters**: the panel is a single `flex flex-wrap` bar with no
  header row. Wrap the existing bar so the Clear button sits at the top-right —
  add a header row (`flex items-center justify-between`) above the filter
  `flex-wrap`, with the button on the right. No title text is required.

### i18n

Add one key, reused by both panels:

```ts
filters: {
  ...
  clearFilters: "Clear filters",
}
```

## Data flow

```
User clicks Clear
  → component onClear()
    → (Report) page: resetFilters() + setTimeMode("utc")
    → (Event gaps) hook: resetFilters()
  → hook setState calls update filter/dateRange/etc.
  → existing effects re-run (load / product-options) with default filters
  → isDirty recomputes → false → button becomes disabled
```

No new data fetching path is introduced; reset simply drives the existing state
setters, and the existing `useEffect`/`useMemo` chains react as they do for any
manual filter change.

## Error handling

None specific. Reset is pure client state; it cannot fail. Reset while a load is
in flight is fine — the setters trigger the same effects that a manual change
would, and the last write wins as it does today.

## Testing (TDD)

**Hooks** (`useRfidEventsReport.test.tsx`, `useEventGaps.test.tsx`):
- `isDirty` is `false` on initial mount.
- After changing a filter field, `isDirty` becomes `true`.
- After changing the date range off `last90Days`, `isDirty` becomes `true`.
- `resetFilters()` returns all owned state to defaults and `isDirty` back to
  `false`.

**Components** (`ReportFilters.test.tsx`, `EventGapsFilters.test.tsx`):
- Button renders with its label and the `FilterX` icon.
- Button is `disabled` when `canClear={false}`, enabled when `canClear={true}`.
- Clicking the enabled button calls `onClear` once.

**Page-level (Report timeMode composition)** — covered where page tests exist
(`RfidEventsPage.test.tsx` if present): clearing also returns `timeMode` to
`utc`, and `canClear` is true when only `timeMode` differs.

## Out of scope / YAGNI

- No URL/query-string persistence of filters.
- No per-field "clear" affordances (single Clear-all only).
- No confirmation dialog (reset is cheap and reversible by re-filtering).
- AtatView time toggle unchanged.
