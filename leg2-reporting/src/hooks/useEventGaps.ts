import { useCallback, useEffect, useMemo, useState } from "react";
import {
  supabase, fetchEventComparisons, fetchEventPairMatrix, fetchEventPairProducts,
} from "@/lib/supabase";
import {
  pivotMatrix, endpointCountry, PRODUCT_ALL, PRODUCT_NONE,
  type Granularity, type EventComparison, type EventPairMatrixRow, type CorridorRow,
  type MailCategory, type GapUnit,
} from "@/lib/eventGaps";
import { presetRange, activePreset, type DateRange, type DatePreset } from "@/lib/datePresets";

export function useEventGaps() {
  const [comparisons, setComparisons] = useState<EventComparison[]>([]);
  const [matrix, setMatrix] = useState<EventPairMatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>(() => presetRange("last90Days"));
  const [product, setProduct] = useState<string>(PRODUCT_ALL);
  const [granularity, setGranularity] = useState<Granularity>("centre");
  const [originCountry, setOriginCountry] = useState<string>("");
  const [destCountry, setDestCountry] = useState<string>("");
  const [productOptions, setProductOptions] = useState<MailCategory[]>([]);
  const [hasNoProduct, setHasNoProduct] = useState(false);
  const [unit, setUnit] = useState<GapUnit>("days");

  async function token(): Promise<{ token: string } | {}> {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    return t ? { token: t } : {};
  }

  // Comparisons load once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await fetchEventComparisons(await token());
        if (!cancelled) setComparisons(c);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
          .filter((r): r is { code: string; name: string } => r.code != null && r.code !== "")
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchEventPairMatrix(
        { from: dateRange.from, to: dateRange.to, product, granularity },
        await token()
      );
      setMatrix(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dateRange.from, dateRange.to, product, granularity]);

  useEffect(() => { load(); }, [load]);

  const applyPreset = useCallback((p: DatePreset) => setDateRange(presetRange(p)), []);

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

  const allRows: CorridorRow[] = useMemo(() => pivotMatrix(matrix), [matrix]);

  const countryOptions: string[] = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) {
      set.add(endpointCountry(r.origin, granularity));
      set.add(endpointCountry(r.destination, granularity));
    }
    return [...set].sort();
  }, [allRows, granularity]);

  const rows: CorridorRow[] = useMemo(() => allRows.filter((row) =>
    (originCountry === "" || endpointCountry(row.origin, granularity) === originCountry) &&
    (destCountry === "" || endpointCountry(row.destination, granularity) === destCountry)
  ), [allRows, granularity, originCountry, destCountry]);

  return {
    loading, error, comparisons, rows,
    dateRange, setDateRange, applyPreset,
    product, setProduct, granularity, setGranularity, unit, setUnit,
    originCountry, setOriginCountry, destCountry, setDestCountry,
    countryOptions, productOptions, hasNoProduct,
    resetFilters, isDirty,
    reload: load,
  };
}
