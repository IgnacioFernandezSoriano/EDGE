import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useEventGaps } from "@/hooks/useEventGaps";
import { EventGapsFilters } from "@/components/EventGapsFilters";
import { EventGapsMatrix } from "@/components/EventGapsMatrix";
import { EventGapsDetailDialog } from "@/components/EventGapsDetailDialog";
import {
  supabase, fetchEventPairDetail, setEventPairExclusion, type EventPairDetailRow,
} from "@/lib/supabase";
import { strings } from "@/i18n/strings";

interface Selection { origin: string; destination: string; comparisonKey: string; }

export default function EventGapsPage() {
  const { user } = useAuth();
  const {
    loading, error, comparisons, rows,
    dateRange, setDateRange, applyPreset,
    product, setProduct, granularity, setGranularity, reload,
  } = useEventGaps();

  const [selection, setSelection] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<EventPairDetailRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Product options = distinct real products seen in the current matrix rows are
  // not available (matrix is aggregated), so derive from a fixed known set plus
  // whatever detail exposes. Keep the known categories from the data.
  const productOptions = useMemo(() => ["A", "B", "D", "LC"], []);

  async function token(): Promise<{ token: string } | {}> {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    return t ? { token: t } : {};
  }

  const loadDetail = useCallback(async (sel: Selection) => {
    setDetailLoading(true);
    try {
      const d = await fetchEventPairDetail(
        {
          origin: sel.origin, destination: sel.destination, comparisonKey: sel.comparisonKey,
          product, from: dateRange.from, to: dateRange.to, granularity,
        },
        await token()
      );
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  }, [product, dateRange.from, dateRange.to, granularity]);

  useEffect(() => {
    if (selection) loadDetail(selection);
  }, [selection, loadDetail]);

  const onToggleExclude = useCallback(async (row: EventPairDetailRow, excluded: boolean) => {
    await setEventPairExclusion(
      { s9code: row.s9code, comparisonKey: row.comparison_key, excluded, excludedBy: user?.email ?? "" },
      await token()
    );
    if (selection) await loadDetail(selection); // refresh the dialog
    await reload();                              // refresh the matrix means
  }, [selection, loadDetail, reload, user?.email]);

  const title = selection ? `${selection.origin} → ${selection.destination}` : "";

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b bg-background px-4 py-3">
        <EventGapsFilters
          dateRange={dateRange} onDateChange={setDateRange} onApplyPreset={applyPreset}
          product={product} onProductChange={setProduct} productOptions={productOptions}
          granularity={granularity} onGranularityChange={setGranularity}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {loading && <p className="text-sm text-muted-foreground">{strings.states.loading}</p>}
        {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}
        {!loading && !error && (
          <section className="rounded-md border">
            <EventGapsMatrix
              comparisons={comparisons}
              rows={rows}
              onSelectCell={(corridor, comparisonKey) =>
                setSelection({ ...corridor, comparisonKey })}
            />
          </section>
        )}
      </div>
      <EventGapsDetailDialog
        open={selection !== null}
        onOpenChange={(o) => { if (!o) setSelection(null); }}
        title={title}
        rows={detail}
        loading={detailLoading}
        onToggleExclude={onToggleExclude}
      />
    </div>
  );
}
