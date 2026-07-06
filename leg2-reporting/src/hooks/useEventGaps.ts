import { useCallback, useEffect, useMemo, useState } from "react";
import {
  supabase, fetchEventComparisons, fetchEventPairMatrix, fetchMailCategories,
} from "@/lib/supabase";
import {
  pivotMatrix, endpointCountry, PRODUCT_ALL,
  type Granularity, type EventComparison, type EventPairMatrixRow, type CorridorRow,
  type MailCategory,
} from "@/lib/eventGaps";
import { presetRange, type DateRange, type DatePreset } from "@/lib/datePresets";

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

  // Mail categories load once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await fetchMailCategories(await token());
        if (!cancelled) setProductOptions(c);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
    product, setProduct, granularity, setGranularity,
    originCountry, setOriginCountry, destCountry, setDestCountry,
    countryOptions, productOptions,
    reload: load,
  };
}
