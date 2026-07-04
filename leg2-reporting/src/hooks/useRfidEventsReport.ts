import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchRfidMovements, fetchReaderMaster, supabase, type RfidMovement, type ReaderMaster } from "@/lib/supabase";
import {
  filterMovements,
  distinctCountries,
  s9sWithEventInRange,
  keepMovementsForS9Set,
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
      const rows = await fetchRfidMovements({}, token ? { token } : {});
      setMovements(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = useCallback((p: DatePreset) => {
    setDateRange(presetRange(p));
  }, []);

  // The date range selects WHICH S9 receptacles are in scope (any event in range),
  // then we show ALL of their events (full journey), including out-of-range ones.
  const windowMovements = useMemo(
    () =>
      keepMovementsForS9Set(
        movements,
        s9sWithEventInRange(movements, dateRange.from, dateRange.to)
      ),
    [movements, dateRange]
  );
  const filtered = useMemo(
    () => filterMovements(windowMovements, filter),
    [windowMovements, filter]
  );
  const report: RfidEventsReport = useMemo(
    () => pivotByS9(filtered),
    [filtered]
  );

  // Country options come from the date-window-selected movements (ignoring country/query filters).
  const originOptions = useMemo(
    () => distinctCountries(windowMovements, "origin_country_code"),
    [windowMovements]
  );
  const destOptions = useMemo(
    () => distinctCountries(windowMovements, "destination_country_code"),
    [windowMovements]
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
