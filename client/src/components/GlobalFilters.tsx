import { DateRange } from '@/hooks/useTrackingData';

interface GlobalFiltersProps {
  // Date range
  dateRange: DateRange;
  onDateChange: (range: DateRange) => void;
  minDate?: string | null;
  maxDate?: string | null;
  // Country filters
  originCountry: string | null;
  onOriginChange: (c: string | null) => void;
  destCountry: string | null;
  onDestChange: (c: string | null) => void;
  allOriginCountries: string[];
  allDestCountries: string[];
  // Counts
  filteredCount: number;
  totalCount: number;
}

export function GlobalFilters({
  dateRange,
  onDateChange,
  minDate,
  maxDate,
  originCountry,
  onOriginChange,
  destCountry,
  onDestChange,
  allOriginCountries,
  allDestCountries,
  filteredCount,
  totalCount,
}: GlobalFiltersProps) {
  const isFiltered =
    dateRange.from || dateRange.to || originCountry || destCountry;

  function handleClearAll() {
    onDateChange({ from: null, to: null });
    onOriginChange(null);
    onDestChange(null);
  }

  const selectCls =
    'text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 cursor-pointer';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">

      {/* ── Date range ── */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap hidden sm:inline">Dates:</span>
        <input
          type="date"
          value={dateRange.from || ''}
          min={minDate || undefined}
          max={dateRange.to || maxDate || undefined}
          onChange={e => onDateChange({ ...dateRange, from: e.target.value || null })}
          className={`${selectCls} w-[130px]`}
        />
        <span className="text-slate-300 text-xs">–</span>
        <input
          type="date"
          value={dateRange.to || ''}
          min={dateRange.from || minDate || undefined}
          max={maxDate || undefined}
          onChange={e => onDateChange({ ...dateRange, to: e.target.value || null })}
          className={`${selectCls} w-[130px]`}
        />
      </div>

      {/* ── Origin country ── */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap hidden sm:inline">Origin:</span>
        <select
          value={originCountry || ''}
          onChange={e => onOriginChange(e.target.value || null)}
          className={`${selectCls} min-w-[130px] max-w-[170px]`}
        >
          <option value="">All countries</option>
          {allOriginCountries.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* ── Destination country ── */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap hidden sm:inline">Destination:</span>
        <select
          value={destCountry || ''}
          onChange={e => onDestChange(e.target.value || null)}
          className={`${selectCls} min-w-[130px] max-w-[170px]`}
        >
          <option value="">All countries</option>
          {allDestCountries.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* ── Active badge + clear ── */}
      {isFiltered ? (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5 font-medium whitespace-nowrap">
            {filteredCount.toLocaleString()} / {totalCount.toLocaleString()}
          </span>
          <button
            onClick={handleClearAll}
            className="text-[10px] text-slate-400 hover:text-rose-500 transition-colors px-1.5 py-0.5 rounded hover:bg-rose-50 border border-transparent hover:border-rose-200 whitespace-nowrap"
            title="Clear all filters"
          >
            ✕ Clear all
          </button>
        </div>
      ) : (
        <span className="text-[10px] text-slate-400 whitespace-nowrap hidden sm:inline">
          All {totalCount.toLocaleString()} records
        </span>
      )}
    </div>
  );
}
