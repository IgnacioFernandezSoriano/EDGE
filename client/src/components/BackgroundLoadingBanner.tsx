/**
 * BackgroundLoadingBanner — shared progress banner for all report tabs.
 * Shows amber spinner + progress bar while historical RFID data loads in background.
 * Shows green checkmark when complete.
 */
import React from 'react';

interface Props {
  loading: boolean;
  progress: { loaded: number; total: number } | null;
  totalLabel?: string; // e.g. "receptacles" or "events"
}

export function BackgroundLoadingBanner({ loading, progress, totalLabel = 'events' }: Props) {
  if (!loading && !progress) return null;

  const pct = progress && progress.total > 0
    ? Math.round((progress.loaded / progress.total) * 100)
    : null;

  if (!loading) {
    // Complete
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 mb-4 rounded-lg border text-xs font-medium bg-emerald-50 border-emerald-200 text-emerald-800">
        <span className="text-emerald-600 text-sm">✓</span>
        <span>
          Complete dataset loaded
          {progress && ` — ${progress.total.toLocaleString()} ${totalLabel}`}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 mb-4 rounded-lg border text-xs font-medium bg-amber-50 border-amber-200 text-amber-800">
      <div
        className="w-3.5 h-3.5 rounded-full animate-spin flex-shrink-0"
        style={{ border: '2px solid #fde68a', borderTopColor: '#F59E0B' }}
      />
      <div className="flex-1 min-w-0">
        <span>
          ⚠ Showing last 30 days — loading full history in background
          {progress && progress.total > 0 && (
            <span className="ml-1 font-normal opacity-75">
              ({pct}% — {progress.loaded.toLocaleString()} / {progress.total.toLocaleString()} {totalLabel})
            </span>
          )}
          {(!progress || progress.total === 0) && (
            <span className="ml-1 font-normal opacity-75">(loading historical data…)</span>
          )}
        </span>
        {progress && progress.total > 0 && (
          <div className="mt-1.5 w-full bg-amber-200 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-300"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
