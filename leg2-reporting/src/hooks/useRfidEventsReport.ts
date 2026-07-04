import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchRfidMovements, fetchReaderMaster, supabase, type RfidMovement, type ReaderMaster } from "@/lib/supabase";
import {
  filterMovements,
  distinctCountries,
  type ReportFilterState,
} from "@/lib/filter";
import { pivotByS9, type RfidEventsReport } from "@/lib/pivot";
import { presetRange, type DateRange, type DatePreset } from "@/lib/datePresets";

const INITIAL_FILTER: ReportFilterState = {
  originCountry: null,
  destCountry: null,
  s9Query: "",
  rteQuery: "",
};

export function useRfidEventsReport() {
  const [movements, setMovements] = useState<RfidMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReportFilterState>(INITIAL_FILTER);
  const [dateRange, setDateRange] = useState<DateRange>(() => presetRange("last90Days"));
  const [readerMap, setReaderMap] = useState<Map<string, ReaderMaster>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const readers = await fetchReaderMaster(token ? { token } : {});
        if (!cancelled) {
          setReaderMap(new Map(readers.map((r) => [r.lpi, r])));
        }
      } catch (e) {
        // Reader enrichment is best-effort; movements report must not break.
        console.error("Failed to load reader master data", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const rows = await fetchRfidMovements(
        { dateFrom: dateRange.from, dateTo: dateRange.to },
        token ? { token } : {}
      );
      setMovements(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = useCallback((p: DatePreset) => {
    setDateRange(presetRange(p));
  }, []);

  const filtered = useMemo(
    () => filterMovements(movements, filter),
    [movements, filter]
  );
  const report: RfidEventsReport = useMemo(
    () => pivotByS9(filtered),
    [filtered]
  );

  // Country options come from all fetched movements (ignoring country/query filters).
  const allScoped = useMemo(
    () =>
      filterMovements(movements, {
        ...filter,
        originCountry: null,
        destCountry: null,
        s9Query: "",
        rteQuery: "",
      }),
    [movements, filter]
  );
  const originOptions = useMemo(
    () => distinctCountries(allScoped, "origin_country_code"),
    [allScoped]
  );
  const destOptions = useMemo(
    () => distinctCountries(allScoped, "destination_country_code"),
    [allScoped]
  );

  return {
    loading,
    error,
    report,
    readerMap,
    filter,
    setFilter,
    originOptions,
    destOptions,
    dateRange,
    setDateRange,
    applyPreset,
    reload: load,
  };
}
