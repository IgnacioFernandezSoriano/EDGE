import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchRfidMovements, supabase, type RfidMovement } from "@/lib/supabase";
import {
  filterMovements,
  distinctCountries,
  type ReportFilterState,
} from "@/lib/filter";
import { pivotByS9, type RfidEventsReport } from "@/lib/pivot";

// Bounds the movements fetch to a rolling window so the browser never pages
// the entire vw_quicksight_rfid_report_movements view into memory. A full
// date-range picker (arbitrary dateFrom/dateTo) is v2.
export const DEFAULT_WINDOW_DAYS = 365;

function defaultDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - DEFAULT_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

const INITIAL_FILTER: ReportFilterState = {
  tab: "outbound",
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const dateFrom = defaultDateFrom();
      const rows = await fetchRfidMovements(
        { dateFrom },
        token ? { token } : {}
      );
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

  const filtered = useMemo(
    () => filterMovements(movements, filter),
    [movements, filter]
  );
  const report: RfidEventsReport = useMemo(
    () => pivotByS9(filtered),
    [filtered]
  );

  // Country options come from the current tab slice (ignoring country filters).
  const tabScoped = useMemo(
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
    () => distinctCountries(tabScoped, "origin_country_code"),
    [tabScoped]
  );
  const destOptions = useMemo(
    () => distinctCountries(tabScoped, "destination_country_code"),
    [tabScoped]
  );

  return {
    loading,
    error,
    report,
    filter,
    setFilter,
    originOptions,
    destOptions,
    reload: load,
  };
}
