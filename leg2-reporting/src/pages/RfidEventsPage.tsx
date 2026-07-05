import { useState } from "react";
import { useRfidEventsReport } from "@/hooks/useRfidEventsReport";
import { ReportFilters } from "@/components/ReportFilters";
import { RfidEventsPivot } from "@/components/RfidEventsPivot";
import { ReaderEditorDialog } from "@/components/ReaderEditorDialog";
import { AtatDialog } from "@/components/AtatDialog";
import { strings } from "@/i18n/strings";
import type { TimeMode } from "@/lib/time";

export default function RfidEventsPage() {
  const {
    loading, error, report, hasIncidents, readerMap, filter, setFilter, originOptions, destOptions,
    dateRange, setDateRange, applyPreset, reload,
  } = useRfidEventsReport();
  const [timeMode, setTimeMode] = useState<TimeMode>("utc");
  const [editorLpi, setEditorLpi] = useState<string | null>(null);
  const [dialogS9, setDialogS9] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b bg-background px-4 py-3">
        <ReportFilters
          filter={filter}
          setFilter={setFilter}
          originOptions={originOptions}
          destOptions={destOptions}
          hasIncidents={hasIncidents}
          timeMode={timeMode}
          onTimeModeChange={setTimeMode}
          dateRange={dateRange}
          onDateChange={setDateRange}
          onApplyPreset={applyPreset}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {loading && <p className="text-sm text-muted-foreground">{strings.states.loading}</p>}
        {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}

        {!loading && !error && (
          <section className="border rounded-md">
            <RfidEventsPivot
              report={report}
              timeMode={timeMode}
              selectedS9={dialogS9}
              onSelectS9={(s9) => setDialogS9(s9)}
              onSelectReader={setEditorLpi}
              readerMap={readerMap}
            />
          </section>
        )}
      </div>

      <AtatDialog
        s9={dialogS9}
        open={dialogS9 !== null}
        onOpenChange={(o) => { if (!o) setDialogS9(null); }}
        initialMode={timeMode}
      />

      <ReaderEditorDialog
        open={editorLpi !== null}
        onOpenChange={(o) => { if (!o) setEditorLpi(null); }}
        reader={editorLpi ? readerMap.get(editorLpi) ?? null : null}
        onApplied={() => { reload(); }}
      />
    </div>
  );
}
