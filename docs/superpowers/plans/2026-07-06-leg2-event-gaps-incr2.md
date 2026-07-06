# Leg2 Event-pair Gaps — Increment 2 (UI refinements) Plan

> **For agentic workers:** implemented task-by-task via subagent-driven-development. Steps use `- [ ]`. Branch `feat/leg2-event-gaps` (continues Increment 1, not yet merged).

**Goal:** Apply six browser-feedback refinements to the Event-pair gaps screen: (1) origin/dest country filters, (2) product filter shown by NAME, (3) real IPC RFID codes in comparison headers, (4) origin/dest gate+site in the cell detail, (5) weekday next to each date in the detail, (6) clicking an S9 in the detail opens the ATAT dialog.

**Architecture:** SQL already applied to Leg2 (`ubgatxfwpmyaqyfrwias`): comparison labels reseeded to IPC codes (`2320/2400/2420 → RESCON`…), new editable `ref_mail_category(code,name)`, new `vw_event_pair_detail_s9` (base gaps view + ORIGIN/DESTINATION-role reading gate[reader master]+site). So #3 needs no frontend change (header already renders `comparison.label`). The remaining work is frontend only.

**Tech Stack:** React 19 + Vite + TS + Tailwind + shadcn/ui; Vitest + RTL. `@/` → `leg2-reporting/src/`. Run tests from `leg2-reporting/` with `npx vitest run <path>`; also `npx tsc --noEmit`.

## Global Constraints

- No hardcoded product/RFID codes in a way that defeats config: product NAMES come from `ref_mail_category` (fetched), comparison labels come from `ref_event_comparison` (already fetched via `fetchEventComparisons`).
- The pipeline still keys/filters product by the CODE (`mail_category`); only the DISPLAYED option label changes to the name.
- Country filtering is CLIENT-SIDE over the already-fetched matrix rows (no RPC signature change). At granularity `country` a corridor's `origin`/`destination` IS the 2-char country; at `centre` it is the 6-char office whose first 2 chars are the country.
- Reuse the existing `AtatDialog` component (`@/components/AtatDialog`) for #6 — do not build a new receptacle view. It takes props `{ s9, open, onOpenChange, initialMode }` (see its usage in `src/pages/RfidEventsPage.tsx`).
- All user-facing English text lives in `src/i18n/strings.ts` under `strings.gaps`.
- Keep every existing test green; update tests whose component contracts change.

---

### Task 1: Data layer — detail view fields + mail categories

**Files:**
- Modify: `leg2-reporting/src/lib/supabase.ts`
- Modify: `leg2-reporting/src/lib/eventGaps.ts` (add `MailCategory` type + a country helper)
- Test: `leg2-reporting/src/lib/eventGapsApi.test.ts` (extend)

**Interfaces produced (consumed by Tasks 3,4,5):**
- `interface MailCategory { code: string; name: string }`
- `EventPairDetailRow` gains: `origin_gate: string | null; origin_site: string | null; dest_gate: string | null; dest_site: string | null`.
- `fetchMailCategories(deps?): Promise<MailCategory[]>` — GET `ref_mail_category?select=code,name&order=code`.
- `fetchEventPairDetail` now reads the view `vw_event_pair_detail_s9` (not `vw_event_pair_gaps_s9`).

Steps:
- [ ] **Step 1 (test first):** In `eventGapsApi.test.ts`, add a test that `buildEventPairDetailUrl(...)` output contains `origin_gate` and `dest_site` in the `select=` list (proving the new columns are requested). Run it → FAIL.
- [ ] **Step 2:** In `supabase.ts`:
  - Add `const EVENT_PAIR_DETAIL_VIEW = "vw_event_pair_detail_s9";` and point `fetchEventPairDetail`'s default `baseUrl` at it (replace the `EVENT_PAIR_GAPS_VIEW` usage inside `fetchEventPairDetail` only; leave the matrix RPC untouched).
  - Append `"origin_gate","origin_site","dest_gate","dest_site"` to `EVENT_PAIR_DETAIL_SELECT_COLS`.
  - Add the four fields to `EventPairDetailRow`.
  - Add `MailCategory` import from `@/lib/eventGaps` and `fetchMailCategories`:
    ```ts
    export async function fetchMailCategories(deps: FetchDeps = {}): Promise<MailCategory[]> {
      const { fetchFn, headers } = resolveAuth(deps);
      const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/ref_mail_category`;
      const url = new URL(baseUrl);
      url.searchParams.set("select", "code,name");
      url.searchParams.set("order", "code");
      const res = await fetchFn(url.toString(), { headers });
      if (!res.ok) throw new Error(`Leg2 mail categories fetch failed: ${res.status} ${await res.text()}`);
      return (await res.json()) as MailCategory[];
    }
    ```
- [ ] **Step 3:** In `eventGaps.ts` add:
  ```ts
  export interface MailCategory { code: string; name: string }
  // 2-char country of a corridor endpoint at the given granularity.
  export function endpointCountry(endpoint: string, g: Granularity): string {
    return g === "country" ? endpoint : endpoint.slice(0, 2);
  }
  ```
- [ ] **Step 4:** Run `npx vitest run src/lib/eventGapsApi.test.ts` (PASS) and `npx tsc --noEmit` (clean).
- [ ] **Step 5:** Commit: `feat(leg2): incr2 data layer — detail gate/site fields + mail categories`.

---

### Task 2: EventGapsFilters — country selects + product names

**Files:**
- Modify: `leg2-reporting/src/components/EventGapsFilters.tsx`
- Modify: `leg2-reporting/src/i18n/strings.ts` (add `gaps.origCountry`, `gaps.destCountry`)
- Test: `leg2-reporting/src/components/EventGapsFilters.test.tsx`

**Interface change (consumed by Task 5):** `EventGapsFiltersProps` gains:
`originCountry: string; destCountry: string; onOriginCountryChange: (c: string) => void; onDestCountryChange: (c: string) => void; countryOptions: string[];` and `productOptions` CHANGES TYPE from `string[]` to `MailCategory[]` (`{code,name}[]`), where each option renders `name` as label and `code` as value. Keep the existing `PRODUCT_ALL`/`PRODUCT_NONE` options (labels from `strings.gaps.allProducts`/`noProduct`).

Steps:
- [ ] **Step 1:** Add strings `origCountry: "Orig country"`, `destCountry: "Dest country"` under `strings.gaps`.
- [ ] **Step 2 (test):** Update `EventGapsFilters.test.tsx`: pass `productOptions={[{code:"A",name:"Aéreo / Prioritario"}]}`, `countryOptions={["IN","JP"]}`, the new country props. Assert: the product Select shows "Aéreo / Prioritario" (the NAME) as an option; two country selects labelled "Orig country"/"Dest country" render; selecting a country calls the right handler with the code. Run → FAIL.
- [ ] **Step 3:** Implement: add two `Select`s (origin/dest country) modeled on the existing product `Select`, each with an "All" option (value `PRODUCT_ALL`? use a dedicated sentinel — reuse the `__all__` pattern from `ReportFilters.tsx`: a local `const ALL_COUNTRY = "__all__"`, mapping to `""`/all). Change the product `Select` to iterate `MailCategory[]` rendering `<SelectItem value={c.code}>{c.name}</SelectItem>`. Import `MailCategory` from `@/lib/eventGaps`.
- [ ] **Step 4:** `npx vitest run src/components/EventGapsFilters.test.tsx` (PASS) + `npx tsc --noEmit`.
- [ ] **Step 5:** Commit: `feat(leg2): incr2 filters — country selects + product names`.

Note on country "All": represent an unset country filter as the empty string `""` in the parent state; the Select uses a `__all__` sentinel item that maps to `""`. Keep it consistent with what Task 4/5 expect (empty string = no country filter).

---

### Task 3: EventGapsDetailDialog — weekday, gate/site, S9→ATAT

**Files:**
- Modify: `leg2-reporting/src/components/EventGapsDetailDialog.tsx`
- Modify: `leg2-reporting/src/i18n/strings.ts` (add `gaps.colOrigin`, `gaps.colDest`, `gaps.gate` if not present, `gaps.site`)
- Test: `leg2-reporting/src/components/EventGapsDetailDialog.test.tsx`

**Interface change (consumed by Task 5):** `EventGapsDetailDialogProps` gains `onSelectS9: (s9: string) => void;`.

Behavior:
- Each date cell shows the weekday in parentheses next to the date: format `YYYY-MM-DD HH:mm (Ddd)`. Use a small local helper computing the weekday from the UTC ISO string (e.g. via `new Date(iso).toLocaleDateString("en-US",{weekday:"short"})`), OR reuse `formatTimestampParts` from `@/lib/time` if it fits a plain ISO. Keep it deterministic in tests (the existing tests use fixed UTC ISO strings).
- Two new columns before/after the gap: **Origin** = `origin_gate` + `origin_site` (each may be null → `—`), **Dest** = `dest_gate` + `dest_site`. Render gate and site stacked (site under gate) in one cell per side, like the report's gate/site rendering.
- The `s9code` cell becomes a button that calls `onSelectS9(row.s9code)` (stop propagation). Keep the struck-through style for excluded rows.

Steps:
- [ ] **Step 1 (test):** Update the test: pass an `onSelectS9` spy + rows that include `origin_gate/origin_site/dest_gate/dest_site`. Assert: weekday appears next to a date (e.g. text matching `/\(\w{3}\)/`); the origin site and dest gate render; clicking the s9code button calls `onSelectS9` with the s9code. Keep the existing exclusion-toggle assertions. Run → FAIL.
- [ ] **Step 2:** Implement the weekday helper, the two gate/site columns (add `TableHead`s `strings.gaps.colOrigin`/`colDest`), and the s9code button. Add the needed strings.
- [ ] **Step 3:** `npx vitest run src/components/EventGapsDetailDialog.test.tsx` (PASS) + `npx tsc --noEmit`.
- [ ] **Step 4:** Commit: `feat(leg2): incr2 detail — weekday, origin/dest gate+site, S9→ATAT`.

---

### Task 4: useEventGaps — country filter + options + mail categories

**Files:**
- Modify: `leg2-reporting/src/hooks/useEventGaps.ts`
- Test: `leg2-reporting/src/hooks/useEventGaps.test.tsx`

**Interface produced (consumed by Task 5):** the hook return gains:
`originCountry: string; setOriginCountry; destCountry: string; setDestCountry; countryOptions: string[]; productOptions: MailCategory[];`
and `rows` becomes the COUNTRY-FILTERED pivoted rows. `countryOptions` = sorted distinct countries derived from the UNFILTERED pivoted rows (union of origins and destinations, mapped through `endpointCountry(x, granularity)`).

Behavior:
- Add state `originCountry`/`destCountry` (default `""` = all).
- Load `fetchMailCategories()` once (like comparisons); expose as `productOptions` (fallback to `[]`). 
- Compute `allRows = pivotMatrix(matrix)` (unfiltered), `countryOptions` from `allRows`, and `rows` = `allRows` filtered so that (originCountry === "" || endpointCountry(row.origin, granularity) === originCountry) AND same for destCountry/row.destination.

Steps:
- [ ] **Step 1 (test):** Extend `useEventGaps.test.tsx`: mock `fetchMailCategories` in the `@/lib/supabase` mock (returns `[{code:"A",name:"Aéreo"}]`). Add a test: after load, set `setOriginCountry("IN")` and assert `rows` only contains corridors whose origin country is IN; assert `countryOptions` contains the distinct countries; assert `productOptions` has the mocked category. Keep existing tests (add `fetchMailCategories` to the mock so they don't break). Run → FAIL.
- [ ] **Step 2:** Implement per Behavior. Import `fetchMailCategories`, `endpointCountry`, `MailCategory`.
- [ ] **Step 3:** `npx vitest run src/hooks/useEventGaps.test.tsx` (PASS) + `npx tsc --noEmit`.
- [ ] **Step 4:** Commit: `feat(leg2): incr2 hook — country filter + product/country options`.

---

### Task 5: EventGapsPage — wire filters, product names, ATAT on S9

**Files:**
- Modify: `leg2-reporting/src/pages/EventGapsPage.tsx`
- Test: `leg2-reporting/src/pages/EventGapsPage.test.tsx`

Behavior:
- Pass the new hook fields to `EventGapsFilters`: `originCountry/destCountry/onOriginCountryChange/onDestCountryChange/countryOptions`, and `productOptions` (now `MailCategory[]`). Remove the hardcoded `["A","B","D","LC"]` — use the hook's `productOptions`.
- Add `AtatDialog` state: `atatS9: string | null`. Pass `onSelectS9={setAtatS9}` to `EventGapsDetailDialog`. Render `<AtatDialog s9={atatS9} open={atatS9!==null} onOpenChange={(o)=>{if(!o)setAtatS9(null)}} initialMode="utc" />` (import from `@/components/AtatDialog`).
- Detail rows already carry the new gate/site fields (from Task 1 view) — no page change needed for that beyond passing `rows` through.

Steps:
- [ ] **Step 1 (test):** Update `EventGapsPage.test.tsx`: extend the `@/lib/supabase` mock with `fetchMailCategories` (returns a category) and give the detail mock rows the new gate/site fields. Add assertions: the product option name renders in the filter; clicking an S9 in the opened detail dialog mounts the ATAT dialog (mock `@/components/AtatDialog` to render a marker like its `s9` prop, and assert the marker shows the clicked s9). Keep the existing matrix-click + exclusion-write assertions. Run → FAIL.
- [ ] **Step 2:** Implement the wiring.
- [ ] **Step 3:** Run the FULL suite `npx vitest run`, `npx tsc --noEmit`, `npm run build` — all green.
- [ ] **Step 4:** Commit: `feat(leg2): incr2 page — wire country/product filters + ATAT on S9`.

---

## Self-Review
- #1 country filters → Tasks 4 (state+filter+options), 2 (UI), 5 (wire). ✓
- #2 product names → Tasks 1 (fetch), 2 (UI labels), 4 (options), 5 (wire). ✓
- #3 RFID codes in header → SQL label reseed (done); no frontend change (matrix renders `comparison.label`). ✓
- #4 detail gate/site → SQL view (done) + Tasks 1 (fields), 3 (columns). ✓
- #5 weekday → Task 3. ✓
- #6 S9→ATAT → Tasks 3 (callback), 5 (AtatDialog reuse). ✓
- Types: `MailCategory`, `endpointCountry`, new `EventPairDetailRow` fields, `onSelectS9` defined in early tasks and consumed by later ones consistently. ✓
