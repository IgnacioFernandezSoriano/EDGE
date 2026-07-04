import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRfidEventsReport } from "@/hooks/useRfidEventsReport";
import { ReportFilters } from "@/components/ReportFilters";
import { RfidEventsPivot } from "@/components/RfidEventsPivot";
import { EventDetailsDialog } from "@/components/EventDetailsDialog";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import type { TimeMode } from "@/lib/time";

export default function RfidEventsPage() {
  const { signOut, user } = useAuth();
  const {
    loading, error, report, filter, setFilter, originOptions, destOptions,
    dateRange, setDateRange, applyPreset,
  } = useRfidEventsReport();
  const [timeMode, setTimeMode] = useState<TimeMode>("utc");
  const [selectedS9, setSelectedS9] = useState<string | null>(null);

  const detail = useMemo(
    () => report.rows.find((r) => r.s9_id === selectedS9)?.all ?? [],
    [report, selectedS9]
  );

  return (
    <div className="p-4 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{strings.appTitle}</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{user?.email}</span>
          <Button variant="outline" size="sm" onClick={() => signOut()}>{strings.auth.signOut}</Button>
        </div>
      </header>

      <ReportFilters
        filter={filter}
        setFilter={setFilter}
        originOptions={originOptions}
        destOptions={destOptions}
        timeMode={timeMode}
        onTimeModeChange={setTimeMode}
        dateRange={dateRange}
        onDateChange={setDateRange}
        onApplyPreset={applyPreset}
      />

      {loading && <p className="text-sm text-muted-foreground">{strings.states.loading}</p>}
      {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}

      {!loading && !error && (
        <section className="border rounded-md overflow-auto">
          <RfidEventsPivot
            report={report}
            timeMode={timeMode}
            selectedS9={selectedS9}
            onSelectS9={setSelectedS9}
          />
        </section>
      )}

      <EventDetailsDialog
        open={selectedS9 !== null}
        onOpenChange={(o) => {
          if (!o) setSelectedS9(null);
        }}
        s9={selectedS9}
        movements={detail}
        timeMode={timeMode}
      />
    </div>
  );
}
