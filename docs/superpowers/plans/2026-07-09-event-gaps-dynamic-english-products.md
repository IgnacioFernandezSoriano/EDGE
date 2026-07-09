# Event-gaps dynamic English product filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Event gaps screen, show product filter names in English and list only products that actually have records for the current date/country filters (dynamic).

**Architecture:** A new `security invoker` Postgres RPC `event_pair_products` returns the distinct products present in `vw_event_pair_gaps_s9` for the current filters, name-joined to `ref_mail_category` (whose seed names become English). The React hook re-fetches this list whenever the date/country filters change (not the product), splits it into named options + a `hasNoProduct` flag, and reconciles the selected product if it leaves the set. The filters component renders English names and shows `(no product)` only when null-product records exist.

**Tech Stack:** PostgreSQL / PostgREST (Supabase Leg2 `ubgatxfwpmyaqyfrwias`), React + TypeScript, Vitest + Testing Library.

## Global Constraints

- Target DB is Leg2 `ubgatxfwpmyaqyfrwias`. This session's MCP is `onems-dev` and **cannot** reach Leg2 — do **not** run `apply_migration`/`execute_sql` against Leg2 here. The user applies the SQL themselves. Task 1's deliverable is the edited SQL file only.
- SQL source of truth: `leg2-reporting/sql/event_pair_gaps.sql`. New objects mirror the existing `event_pair_matrix` conventions: `language sql stable security invoker`, `grant execute … to authenticated`.
- Frontend fetch functions mirror the existing pattern: `deps: FetchDeps = {}`, `resolveAuth(deps)`, RPC via POST to `${SUPABASE_URL}/rest/v1/rpc/<name>` with a `deps.baseUrl` override for tests.
- English names (exact copy): A=`Airmail / Priority`, B=`Non-priority`, C=`S.A.L. (Surface Air Lifted)`, D=`Surface`, E=`EMS`, LC=`Letters (LC/AO)`.
- Product sentinels are unchanged: `PRODUCT_ALL = "all"`, `PRODUCT_NONE = "__none__"` (from `@/lib/eventGaps`).
- Run tests from the `leg2-reporting/` directory with `npm test`.

---

### Task 1: DB — English rename + `event_pair_products` RPC (SQL file only)

**Files:**
- Modify: `leg2-reporting/sql/event_pair_gaps.sql:93-100` (rename seed) and insert a new RPC after `:201` (after the `event_pair_matrix` grant).

**Interfaces:**
- Produces (for the user to apply to Leg2, and for later tasks to call): RPC
  `public.event_pair_products(p_from date, p_to date, p_origin_country text, p_dest_country text)`
  returning `table(code text, name text)`. One row per distinct present product; a `code IS NULL` row when null-product records exist in the filter.

- [ ] **Step 1: Replace the Spanish seed names with English**

In `leg2-reporting/sql/event_pair_gaps.sql`, replace the `insert into public.ref_mail_category` values block (lines 93–100) with:

```sql
insert into public.ref_mail_category (code, name) values
  ('A',  'Airmail / Priority'),
  ('B',  'Non-priority'),
  ('C',  'S.A.L. (Surface Air Lifted)'),
  ('D',  'Surface'),
  ('E',  'EMS'),
  ('LC', 'Letters (LC/AO)')
on conflict (code) do update set name = excluded.name;
```

- [ ] **Step 2: Add the `event_pair_products` RPC**

Immediately after the `grant execute on function public.event_pair_matrix(...)` line (currently line 201), insert:

```sql
-- 5b) Distinct products present for the current filters (name-joined). Powers the
-- Product dropdown: only codes with records; new codes appear automatically. NOT
-- filtered by the selected product. Country columns are granularity-independent.
create or replace function public.event_pair_products(
  p_from date, p_to date, p_origin_country text, p_dest_country text
) returns table(code text, name text)
language sql stable security invoker as $$
  select distinct g.product as code,
         coalesce(m.name, g.product) as name
    from public.vw_event_pair_gaps_s9 g
    left join public.ref_mail_category m on m.code = g.product
   where not g.excluded
     and g.a_utc::date between p_from and p_to
     and (p_origin_country is null or g.origin_country = p_origin_country)
     and (p_dest_country  is null or g.dest_country  = p_dest_country)
$$;
grant execute on function public.event_pair_products(date, date, text, text) to authenticated;
```

- [ ] **Step 3: Commit**

```bash
git add leg2-reporting/sql/event_pair_gaps.sql
git commit -m "feat(leg2): English mail-category names + event_pair_products RPC"
```

> **Apply note (user action, outside this session):** apply `event_pair_gaps.sql` to Leg2 `ubgatxfwpmyaqyfrwias`. Verify: `select * from ref_mail_category order by code;` shows English names, and `select * from event_pair_products('2026-01-01','2026-12-31',null,null);` returns only codes with records.

---

### Task 2: `fetchEventPairProducts` fetch function

**Files:**
- Modify: `leg2-reporting/src/lib/supabase.ts` (add types, RPC const, body builder, fetch fn near `fetchEventPairMatrix` ~`:507`)
- Test: `leg2-reporting/src/lib/supabase.eventPairProducts.test.ts` (new)

**Interfaces:**
- Consumes: `FetchDeps`, `resolveAuth` (existing, private in `supabase.ts`).
- Produces:
  - `export interface EventPairProductsParams { from: string; to: string; originCountry: string; destCountry: string; }`
  - `export interface AvailableProduct { code: string | null; name: string | null; }`
  - `export function buildEventPairProductsBody(p: EventPairProductsParams): Record<string, unknown>` → `{ p_from, p_to, p_origin_country, p_dest_country }` where an empty-string country becomes `null`.
  - `export async function fetchEventPairProducts(params: EventPairProductsParams, deps?: FetchDeps): Promise<AvailableProduct[]>`

- [ ] **Step 1: Write the failing test**

Create `leg2-reporting/src/lib/supabase.eventPairProducts.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  buildEventPairProductsBody,
  fetchEventPairProducts,
  type AvailableProduct,
} from "@/lib/supabase";

describe("buildEventPairProductsBody", () => {
  it("maps params to RPC args and empty country -> null", () => {
    expect(
      buildEventPairProductsBody({ from: "2026-01-01", to: "2026-03-31", originCountry: "", destCountry: "" })
    ).toEqual({ p_from: "2026-01-01", p_to: "2026-03-31", p_origin_country: null, p_dest_country: null });
  });

  it("passes through non-empty countries", () => {
    expect(
      buildEventPairProductsBody({ from: "2026-01-01", to: "2026-03-31", originCountry: "IN", destCountry: "JP" })
    ).toEqual({ p_from: "2026-01-01", p_to: "2026-03-31", p_origin_country: "IN", p_dest_country: "JP" });
  });
});

describe("fetchEventPairProducts", () => {
  it("POSTs to the RPC and returns the rows", async () => {
    const rows: AvailableProduct[] = [
      { code: "A", name: "Airmail / Priority" },
      { code: null, name: null },
    ];
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
    const out = await fetchEventPairProducts(
      { from: "2026-01-01", to: "2026-03-31", originCountry: "", destCountry: "" },
      { fetchFn, baseUrl: "http://x/rpc/event_pair_products" }
    );
    expect(out).toEqual(rows);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("http://x/rpc/event_pair_products");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      p_from: "2026-01-01", p_to: "2026-03-31", p_origin_country: null, p_dest_country: null,
    });
  });

  it("throws on a non-ok response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    await expect(
      fetchEventPairProducts(
        { from: "a", to: "b", originCountry: "", destCountry: "" },
        { fetchFn, baseUrl: "http://x/rpc/event_pair_products" }
      )
    ).rejects.toThrow(/event_pair_products failed: 500/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && npm test -- src/lib/supabase.eventPairProducts.test.ts`
Expected: FAIL — `buildEventPairProductsBody`/`fetchEventPairProducts` not exported.

- [ ] **Step 3: Write minimal implementation**

In `leg2-reporting/src/lib/supabase.ts`, add the RPC const alongside the other RPC consts (near `:392`):

```ts
const EVENT_PAIR_PRODUCTS_RPC = "event_pair_products";
```

Add the types + body builder near `EventPairMatrixParams` (~`:379`):

```ts
export interface EventPairProductsParams {
  from: string;
  to: string;
  originCountry: string;  // "" = no constraint
  destCountry: string;    // "" = no constraint
}

export interface AvailableProduct {
  code: string | null;    // null = null-product records exist
  name: string | null;
}

export function buildEventPairProductsBody(p: EventPairProductsParams): Record<string, unknown> {
  return {
    p_from: p.from,
    p_to: p.to,
    p_origin_country: p.originCountry === "" ? null : p.originCountry,
    p_dest_country: p.destCountry === "" ? null : p.destCountry,
  };
}
```

Add the fetch fn right after `fetchEventPairMatrix` (~`:517`):

```ts
export async function fetchEventPairProducts(
  params: EventPairProductsParams, deps: FetchDeps = {}
): Promise<AvailableProduct[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/rpc/${EVENT_PAIR_PRODUCTS_RPC}`;
  const res = await fetchFn(baseUrl, {
    method: "POST", headers, body: JSON.stringify(buildEventPairProductsBody(params)),
  });
  if (!res.ok) throw new Error(`Leg2 event_pair_products failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as AvailableProduct[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd leg2-reporting && npm test -- src/lib/supabase.eventPairProducts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/lib/supabase.ts leg2-reporting/src/lib/supabase.eventPairProducts.test.ts
git commit -m "feat(leg2): fetchEventPairProducts RPC caller"
```

---

### Task 3: `useEventGaps` — dynamic options + selection reconciliation

**Files:**
- Modify: `leg2-reporting/src/hooks/useEventGaps.ts`
- Test: `leg2-reporting/src/hooks/useEventGaps.test.tsx`

**Interfaces:**
- Consumes: `fetchEventPairProducts`, `AvailableProduct` (Task 2); `PRODUCT_ALL`, `PRODUCT_NONE`, `MailCategory` (from `@/lib/eventGaps`).
- Produces (hook return additions): `productOptions: MailCategory[]` (non-null-code rows, sorted by `name`), `hasNoProduct: boolean`. `fetchMailCategories` is no longer used by the hook.

- [ ] **Step 1: Update the hook test (write the new expectations)**

Replace `leg2-reporting/src/hooks/useEventGaps.test.tsx` in full:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { comparisons, matrix, products } = vi.hoisted(() => ({
  comparisons: [{ comparison_key: "ho_rescon", priority: 1, label: "HO vs RESCON" }],
  matrix: [
    { origin: "IN", destination: "JP", comparison_key: "ho_rescon", mean_days: 3.2, n: 4 },
    { origin: "BR", destination: "PT", comparison_key: "ho_rescon", mean_days: 2.1, n: 2 },
  ],
  products: [
    { code: "A", name: "Airmail / Priority" },
    { code: null, name: null },
  ],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchEventComparisons: vi.fn().mockResolvedValue(comparisons),
  fetchEventPairMatrix: vi.fn().mockResolvedValue(matrix),
  fetchEventPairProducts: vi.fn().mockResolvedValue(products),
}));

import { useEventGaps } from "@/hooks/useEventGaps";
import { fetchEventPairMatrix, fetchEventPairProducts } from "@/lib/supabase";

describe("useEventGaps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads comparisons and the pivoted matrix", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.comparisons).toHaveLength(1);
    const inRow = result.current.rows.find((r) => r.origin === "IN");
    expect(inRow).toMatchObject({ origin: "IN", destination: "JP" });
    expect(inRow?.cells.ho_rescon).toEqual({ mean_days: 3.2, n: 4 });
  });

  it("splits products into named options and a hasNoProduct flag", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.productOptions).toEqual([{ code: "A", name: "Airmail / Priority" }]);
    expect(result.current.hasNoProduct).toBe(true);
    expect(result.current.countryOptions).toEqual(["BR", "IN", "JP", "PT"]);
  });

  it("re-fetches product options when the date range changes", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    (fetchEventPairProducts as any).mockClear();
    act(() => result.current.setDateRange({ from: "2026-05-01", to: "2026-05-31" }));
    await waitFor(() =>
      expect(fetchEventPairProducts).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-05-01", to: "2026-05-31" }),
        expect.anything()
      )
    );
  });

  it("does NOT re-fetch product options when the product changes", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    (fetchEventPairProducts as any).mockClear();
    act(() => result.current.setProduct("A"));
    // give any stray effect a chance to fire
    await waitFor(() => expect(fetchEventPairMatrix).toHaveBeenCalled());
    expect(fetchEventPairProducts).not.toHaveBeenCalled();
  });

  it("resets a selected product that leaves the option set", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setProduct("A"));
    await waitFor(() => expect(result.current.product).toBe("A"));
    // next options fetch returns a set without "A"
    (fetchEventPairProducts as any).mockResolvedValueOnce([{ code: "B", name: "Non-priority" }]);
    act(() => result.current.setDateRange({ from: "2026-05-01", to: "2026-05-31" }));
    await waitFor(() => expect(result.current.product).toBe("all"));
  });

  it("filters rows by originCountry", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(2);
    act(() => result.current.setOriginCountry("IN"));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0]).toMatchObject({ origin: "IN", destination: "JP" });
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && npm test -- src/hooks/useEventGaps.test.tsx`
Expected: FAIL — `fetchEventPairProducts` not imported by the hook / `hasNoProduct` undefined.

- [ ] **Step 3: Implement the hook changes**

In `leg2-reporting/src/hooks/useEventGaps.ts`:

Update the supabase import (drop `fetchMailCategories`, add `fetchEventPairProducts`):

```ts
import {
  supabase, fetchEventComparisons, fetchEventPairMatrix, fetchEventPairProducts,
} from "@/lib/supabase";
```

Add a `hasNoProduct` state next to `productOptions` (~`:22`):

```ts
  const [productOptions, setProductOptions] = useState<MailCategory[]>([]);
  const [hasNoProduct, setHasNoProduct] = useState(false);
```

Replace the "Mail categories load once" effect (lines ~45–57) with an options effect keyed on the filters (not product):

```ts
  // Product options follow the current date/country filters (never the product).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchEventPairProducts(
          { from: dateRange.from, to: dateRange.to, originCountry, destCountry },
          await token()
        );
        if (cancelled) return;
        const named = rows
          .filter((r): r is { code: string; name: string } => r.code != null)
          .map((r) => ({ code: r.code, name: r.name ?? r.code }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const noneAvail = rows.some((r) => r.code == null);
        setProductOptions(named);
        setHasNoProduct(noneAvail);
        const codes = new Set(named.map((c) => c.code));
        setProduct((prev) =>
          prev === PRODUCT_ALL ? prev
            : prev === PRODUCT_NONE ? (noneAvail ? prev : PRODUCT_ALL)
            : codes.has(prev) ? prev : PRODUCT_ALL
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [dateRange.from, dateRange.to, originCountry, destCountry]);
```

Add `PRODUCT_NONE` to the `@/lib/eventGaps` import (it currently imports `PRODUCT_ALL` only):

```ts
import {
  pivotMatrix, endpointCountry, PRODUCT_ALL, PRODUCT_NONE,
  type Granularity, type EventComparison, type EventPairMatrixRow, type CorridorRow,
  type MailCategory, type GapUnit,
} from "@/lib/eventGaps";
```

Add `hasNoProduct` to the returned object (in the `return { … }`):

```ts
    countryOptions, productOptions, hasNoProduct,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd leg2-reporting && npm test -- src/hooks/useEventGaps.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/hooks/useEventGaps.ts leg2-reporting/src/hooks/useEventGaps.test.tsx
git commit -m "feat(leg2): event-gaps product options follow filters + reconcile selection"
```

---

### Task 4: `EventGapsFilters` — conditional `(no product)` + English names

**Files:**
- Modify: `leg2-reporting/src/components/EventGapsFilters.tsx`
- Test: `leg2-reporting/src/components/EventGapsFilters.test.tsx`

**Interfaces:**
- Consumes: `productOptions: MailCategory[]`, new prop `hasNoProduct: boolean` (from Task 3).
- Produces: `EventGapsFiltersProps` gains `hasNoProduct: boolean`.

- [ ] **Step 1: Add the failing tests**

In `leg2-reporting/src/components/EventGapsFilters.test.tsx`, add `hasNoProduct: false` to the default props in `setup` (in the props object, e.g. after `productOptions`):

```tsx
    productOptions: [{ code: "A", name: "Airmail / Priority" }],
    hasNoProduct: false,
```

Update the existing name test to the English label and add two new tests inside the `describe`:

```tsx
  it("shows the product option's name, not its code", () => {
    setup();
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    expect(screen.getByText("Airmail / Priority")).toBeInTheDocument();
  });

  it("hides (no product) when hasNoProduct is false", () => {
    setup({ hasNoProduct: false });
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    expect(screen.queryByText("(no product)")).not.toBeInTheDocument();
    expect(screen.getByText("All products")).toBeInTheDocument();
  });

  it("shows (no product) when hasNoProduct is true", () => {
    setup({ hasNoProduct: true });
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    expect(screen.getByText("(no product)")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd leg2-reporting && npm test -- src/components/EventGapsFilters.test.tsx`
Expected: FAIL — `(no product)` still always rendered; `hasNoProduct` prop unknown to component.

- [ ] **Step 3: Implement the component change**

In `leg2-reporting/src/components/EventGapsFilters.tsx`, add the prop to the interface (after `productOptions`):

```ts
  productOptions: MailCategory[];
  hasNoProduct: boolean;
```

Destructure it in the function signature (alongside `product, onProductChange, productOptions`):

```ts
  product, onProductChange, productOptions, hasNoProduct,
```

Make the `(no product)` item conditional in the product `SelectContent`:

```tsx
          <SelectContent>
            <SelectItem value={PRODUCT_ALL}>{strings.gaps.allProducts}</SelectItem>
            {hasNoProduct && (
              <SelectItem value={PRODUCT_NONE}>{strings.gaps.noProduct}</SelectItem>
            )}
            {productOptions.map((c) => (
              <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
            ))}
          </SelectContent>
```

(`PRODUCT_ALL` / `PRODUCT_NONE` are already imported at the top of the file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd leg2-reporting && npm test -- src/components/EventGapsFilters.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add leg2-reporting/src/components/EventGapsFilters.tsx leg2-reporting/src/components/EventGapsFilters.test.tsx
git commit -m "feat(leg2): conditional (no product) item in event-gaps filters"
```

---

### Task 5: Wire the page + remove dead `fetchMailCategories`

**Files:**
- Modify: `leg2-reporting/src/pages/EventGapsPage.tsx` (pass `hasNoProduct`)
- Modify: `leg2-reporting/src/pages/EventGapsPage.test.tsx` (swap the mock)
- Modify: `leg2-reporting/src/lib/supabase.ts` (delete now-unused `fetchMailCategories`)

**Interfaces:**
- Consumes: `hasNoProduct` from `useEventGaps` (Task 3); `hasNoProduct` prop on `EventGapsFilters` (Task 4).

- [ ] **Step 1: Update the page test mock**

In `leg2-reporting/src/pages/EventGapsPage.test.tsx`, in the `vi.hoisted` block rename `mailCategories` to `products` with the new shape, and in `vi.mock("@/lib/supabase", …)` replace the `fetchMailCategories` line:

```tsx
  products: [{ code: "A", name: "Airmail / Priority" }, { code: null, name: null }],
```

```tsx
  fetchEventPairProducts: vi.fn().mockResolvedValue(products),
```

- [ ] **Step 2: Run the page test to verify it fails**

Run: `cd leg2-reporting && npm test -- src/pages/EventGapsPage.test.tsx`
Expected: FAIL — the hook now calls `fetchEventPairProducts`, which the old mock didn't provide (or a `hasNoProduct` prop gap), so the page render/assertions break.

- [ ] **Step 3: Pass `hasNoProduct` through the page**

In `leg2-reporting/src/pages/EventGapsPage.tsx`, add `hasNoProduct` to the destructured hook result (~`:21`):

```tsx
    product, setProduct, productOptions, hasNoProduct, granularity, setGranularity, reload,
```

And pass it to `EventGapsFilters` (in the JSX, on the product line ~`:79`):

```tsx
          product={product} onProductChange={setProduct}
          productOptions={productOptions} hasNoProduct={hasNoProduct}
```

- [ ] **Step 4: Remove the dead `fetchMailCategories`**

In `leg2-reporting/src/lib/supabase.ts`, delete the entire `fetchMailCategories` function (~`:530-539`). Confirm no remaining references:

Run: `cd leg2-reporting && grep -rn "fetchMailCategories" src`
Expected: no matches.

(If `MailCategory` is now unused in `supabase.ts`'s imports, drop it from that import line; the hook and components still import `MailCategory` from `@/lib/eventGaps`, which is unchanged.)

- [ ] **Step 5: Run the full suite**

Run: `cd leg2-reporting && npm test`
Expected: PASS — all suites green (page test included).

- [ ] **Step 6: Commit**

```bash
git add leg2-reporting/src/pages/EventGapsPage.tsx leg2-reporting/src/pages/EventGapsPage.test.tsx leg2-reporting/src/lib/supabase.ts
git commit -m "feat(leg2): wire hasNoProduct through Event gaps page; drop fetchMailCategories"
```

---

## Verification (after all tasks)

- `cd leg2-reporting && npm test` — full suite green.
- `cd leg2-reporting && npm run build` — typecheck/build passes (catches any leftover `fetchMailCategories`/`MailCategory` import).
- Manual (after the user applies the SQL to Leg2 and runs the app): open **Event gaps**, open the Product dropdown → names are English, only codes with records for the current range appear, `(no product)` shows only when null-product records exist, and narrowing the date range so the selected product vanishes resets it to **All products**.

## Self-review notes

- **Spec coverage:** English rename → Task 1; dynamic RPC → Task 1+2; follow filters (date+country, not product) → Task 3 effect deps; selection reconciliation → Task 3; conditional `(no product)` → Task 4; English names rendered → Task 4; page wiring → Task 5; DB-apply-by-user constraint → Task 1 note. All spec sections covered.
- **Type consistency:** `AvailableProduct { code: string|null; name: string|null }` (Task 2) → filtered to `MailCategory { code: string; name: string }` in the hook (Task 3) → consumed by `EventGapsFilters` (Task 4). `hasNoProduct: boolean` consistent across hook return, page, and component prop. RPC name `event_pair_products` and arg names `p_from/p_to/p_origin_country/p_dest_country` identical in SQL (Task 1) and body builder (Task 2).
