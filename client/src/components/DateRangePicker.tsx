import { DateRange } from '@/hooks/useTrackingData';

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  minDate?: string | null;
  maxDate?: string | null;
  filteredCount: number;
  totalCount: number;
}

export function DateRangePicker({
  value,
  onChange,
  minDate,
  maxDate,
  filteredCount,
  totalCount,
}: DateRangePickerProps) {
  const isFiltered = value.from || value.to;

  function handleClear() {
    onChange({ from: null, to: null });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Label */}
      <span className="text-xs text-slate-500 font-medium whitespace-nowrap hidden sm:inline">Date range:</span>

      {/* From */}
      <div className="flex items-center gap-1">
        <input
          type="date"
          value={value.from || ''}
          min={minDate || undefined}
          max={value.to || maxDate || undefined}
          onChange={e => onChange({ ...value, from: e.target.value || null })}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 w-[130px]"
          placeholder="From"
        />
        <span className="text-slate-400 text-xs">–</span>
        <input
          type="date"
          value={value.to || ''}
          min={value.from || minDate || undefined}
          max={maxDate || undefined}
          onChange={e => onChange({ ...value, to: e.target.value || null })}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 w-[130px]"
          placeholder="To"
        />
      </div>

      {/* Clear button + count badge */}
      {isFiltered ? (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5 font-medium whitespace-nowrap">
            {filteredCount.toLocaleString()} / {totalCount.toLocaleString()}
          </span>
          <button
            onClick={handleClear}
            className="text-[10px] text-slate-400 hover:text-rose-500 transition-colors px-1.5 py-0.5 rounded hover:bg-rose-50 border border-transparent hover:border-rose-200 whitespace-nowrap"
            title="Clear date filter"
          >
            ✕ Clear
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
