import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchRfidMovements, supabase, type RfidMovement } from "@/lib/supabase";
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
