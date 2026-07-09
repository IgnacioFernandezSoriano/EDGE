# Event-gaps product filter: English names + dynamic "has records" list

Date: 2026-07-09
Area: `leg2-reporting` (Event gaps screen) + Leg2 DB (`ubgatxfwpmyaqyfrwias`)

## Problem

On the **Event gaps** screen the **Product** dropdown has two issues:

1. Names are in Spanish (`Aéreo / Prioritario`, `No prioritario`, `S.A.L. (Surface
   Air Lifted)`, `Superficie`, `EMS`, `Cartas (LC/AO)`). They must be in English.
2. It lists **every** row of `ref_mail_category` (a fixed 6-code enum) regardless
   of whether any records exist for that code. It must show **only products that
   actually have records**, and stay correct as new product codes appear in the
   data over time (dynamic).

## Current implementation (baseline)

- `ref_mail_category(code, name)` seeded in `leg2-reporting/sql/event_pair_gaps.sql`
  (lines 88–100) with Spanish names, codes `A/B/C/D/E/LC`. `on conflict … do
  update set name = excluded.name` — re-apply overwrites names, so editing the
  seed is idempotent.
- `fetchMailCategories()` (`src/lib/supabase.ts`) does a REST `select=code,name`
  over the whole `ref_mail_category` table.
- `useEventGaps()` loads the categories **once** into `productOptions`.
- `EventGapsFilters` renders `All products`, `(no product)`, then one item per
  option using `c.name`.
- The gap data source `vw_event_pair_gaps_s9` already exposes per-S9 columns:
  `product` (= `edi_details.mail_category`, nullable), `origin_country`,
  `dest_country` (both 2-char), `a_utc`, `excluded`.
- Country filtering is done **client-side** in the hook via `endpointCountry`.
  Note: `endpointCountry` yields the same 2-char value in both granularities, so
  the `origin_country` / `dest_country` columns are granularity-independent.

## Decisions

- **English names live in the DB** (`ref_mail_category`), keeping a single editable
  source of truth. Unknown/new codes fall back to the raw code.
- **The product list follows the current filters** — date range **and** origin/dest
  country — but **not** the selected product (so choosing a product does not
  collapse the list to itself).
- **Approach A**: a new server-side RPC returns the distinct products present for
  the current filters, name-joined. (Rejected: broadening the matrix payload —
  the matrix aggregates product away; and a raw REST pull + client dedupe —
  PostgREST has no `DISTINCT`.)
- **DB apply**: the user applies the SQL to Leg2 themselves. This session's MCP is
  `onems-dev` and cannot reach Leg2. No `apply_migration` / `execute_sql` against
  Leg2 from here.

## Design

### DB — `leg2-reporting/sql/event_pair_gaps.sql`

**1. English rename** of the `ref_mail_category` seed:

| code | new name |
|------|----------|
| A    | Airmail / Priority |
| B    | Non-priority |
| C    | S.A.L. (Surface Air Lifted) |
| D    | Surface |
| E    | EMS |
| LC   | Letters (LC/AO) |

Idempotent via the existing `on conflict … do update`.

**2. New RPC `event_pair_products`** — mirrors `event_pair_matrix`'s conventions
(`language sql stable security invoker`, granted to `authenticated`):

```sql
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

- Emits a row with `code IS NULL` (and `name IS NULL`) when null-product records
  exist in the current filter — the frontend uses this to decide whether to show
  `(no product)`.
- Granularity is **not** a parameter (country columns are granularity-independent).

### Frontend — `leg2-reporting`

**3. `src/lib/supabase.ts`** — new `fetchEventPairProducts(params, deps)` calling
the RPC via `rpc/event_pair_products` (POST, same auth/deps pattern as
`fetchEventPairMatrix`). Params: `{ from, to, originCountry, destCountry }`; empty
country string maps to `null` in the request body. Returns `AvailableProduct[]`
where `AvailableProduct = { code: string | null; name: string | null }`.

**4. `src/hooks/useEventGaps.ts`** —
- Replace the load-once mail-categories effect with one keyed on
  `dateRange.from`, `dateRange.to`, `originCountry`, `destCountry` (deliberately
  **not** `product`).
- Split the response into: `productOptions: MailCategory[]` (rows with non-null
  code, sorted by name) and `hasNoProduct: boolean` (any row with null code).
- **Reconcile selection**: after options load, if the selected `product` is not
  `PRODUCT_ALL`, not `PRODUCT_NONE`, and not among the returned codes, reset
  `product` to `PRODUCT_ALL`. (If `product === PRODUCT_NONE` and `hasNoProduct`
  becomes false, also reset to `PRODUCT_ALL`.)
- Expose `hasNoProduct` alongside `productOptions`.

**5. `src/components/EventGapsFilters.tsx`** —
- New prop `hasNoProduct: boolean`.
- `All products` always rendered.
- `(no product)` rendered only when `hasNoProduct` is true.
- Category items render the English `name` from `productOptions` (unchanged
  mechanism; names now arrive in English).

No i18n string changes: `All products` / `(no product)` are already English in
`strings.ts`; category names come from the DB.

## Data flow

```
filters change (from/to/orig/dest)
  → useEventGaps effect → fetchEventPairProducts(RPC)
    → { productOptions (non-null, named), hasNoProduct }
    → reconcile selected product
  → EventGapsFilters renders All / [ (no product)? ] / <English names>
```

The matrix fetch (`event_pair_matrix`) is unchanged and still keys on the selected
product.

## Edge cases

- **Selected product disappears** when the date/country filter narrows: reset to
  `All products` (reconcile step).
- **Brand-new code** not yet in `ref_mail_category`: appears with its raw code as
  the label (`coalesce`).
- **No records at all** for the filter: options empty, only `All products` shown;
  `(no product)` hidden.
- **Empty country string** (the "All" sentinel): sent as `null` → no country
  constraint.

## Testing (TDD)

- `supabase.ts`: `fetchEventPairProducts` — request URL/body (RPC name, params,
  empty-country→null), and response → `AvailableProduct[]` mapping.
- `useEventGaps`: options re-fetch on filter change but not on product change;
  `productOptions`/`hasNoProduct` split; selected-product reconciliation (reset to
  `all` when the selection leaves the set; `__none__` reset when `hasNoProduct`
  goes false).
- `EventGapsFilters`: `(no product)` shown iff `hasNoProduct`; `All products`
  always; English category names rendered.
- SQL: verified by the user against Leg2 after applying (rename visible, RPC
  returns only present codes for a sample window).

## Out of scope

- RBAC / privilege hardening.
- Changing the matrix RPC or country-filter mechanism.
- Any other screen's product filter (only Event gaps uses `ref_mail_category`
  today).
