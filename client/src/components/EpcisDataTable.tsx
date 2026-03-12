/**
 * EpcisDataTable — data table for the RFID tab, sourced exclusively from datos EPCIS.
 * Columns:
 *   1. Identity:     S9ID | Tag ID
 *   2. Origin:       Country | Centre | IMPC | Time (UTC) | Readings
 *   3. Destination:  Country | Centre | IMPC | Time (UTC) | Readings  (— when no dest)
 *   4. Transit:      Hours | Days  (— when no dest)
 * Includes search, pagination, sort, and CSV export.
 * Pagination fix: useEffect resets page when journeys/filter/search/sort changes.
 */
import { useState, useMemo, useEffect } from 'react';
import { Download } from 'lucide-react';
import type { RfidJourney } from '@/hooks/useEpcisData';

/* ─── helpers ─── */
function formatTime(t: string | null): string {
  if (!t) return '—';
  const d = new Date(t);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' });
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}

function formatTransit(h: number | null): string {
  if (h === null || h === undefined) return '—';
  const abs = Math.abs(h);
  const sign = h < 0 ? '−' : '+';
  if (abs < 24) return `${sign}${abs.toFixed(1)}h`;
  return `${sign}${(abs / 24).toFixed(1)}d`;
}

function truncTag(tag: string | null): string {
  if (!tag) return '—';
  return tag.length > 20 ? '…' + tag.slice(-16) : tag;
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportJourneysToCsv(journeys: RfidJourney[], filename = 'rfid_epcis_journeys.csv') {
  const COLS = [
    { key: 's9id',            label: 'Receptacle (s9id)' },
    { key: 'tag_id',          label: 'Tag ID' },
    { key: 'origin_country',  label: 'Origin Country' },
    { key: 'origin_centre',   label: 'Origin Centre' },
    { key: 'origin_impc',     label: 'Origin IMPC' },
    { key: 'origin_time',     label: 'Origin Time (UTC)' },
    { key: 'origin_readings', label: 'Origin Readings' },
    { key: 'dest_country',    label: 'Dest Country' },
    { key: 'dest_centre',     label: 'Dest Centre' },
    { key: 'dest_impc',       label: 'Dest IMPC' },
    { key: 'dest_time',       label: 'Dest Time (UTC)' },
    { key: 'dest_readings',   label: 'Dest Readings' },
    { key: 'transit_hours',   label: 'Transit (h)' },
    { key: 'has_destination', label: 'Has Destination' },
    { key: 'centres_visited', label: 'Centres Visited' },
  ] as const;

  const header = COLS.map(c => c.label).join(',');
  const rows = journeys.map(j =>
    COLS.map(c => {
      const v = (j as any)[c.key];
      return escapeCell(Array.isArray(v) ? v.join('; ') : v);
    }).join(',')
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/* ─── sort helper ─── */
type SortKey = 's9id' | 'origin_country' | 'origin_centre' | 'origin_time' | 'dest_country' | 'dest_centre' | 'dest_time' | 'transit_hours';

function sortJourneys(data: RfidJourney[], col: SortKey, dir: 'asc' | 'desc'): RfidJourney[] {
  return [...data].sort((a, b) => {
    const av = a[col] ?? '';
    const bv = b[col] ?? '';
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });
}

/* ─── component ─── */
interface EpcisDataTableProps {
  journeys: RfidJourney[];
  dateLabel?: string;
}

export function EpcisDataTable({ journeys, dateLabel }: EpcisDataTableProps) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [filterE2E, setFilterE2E] = useState<'ALL' | 'E2E' | 'ORIGIN_ONLY'>('ALL');
  const [sortCol, setSortCol] = useState<SortKey>('origin_time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const PAGE_SIZE = 20;

  const filtered = useMemo(() => {
    let data = journeys;
    if (filterE2E === 'E2E') data = data.filter(j => j.has_destination);
    if (filterE2E === 'ORIGIN_ONLY') data = data.filter(j => !j.has_destination);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      data = data.filter(j =>
        (j.s9id || '').toLowerCase().includes(q) ||
        (j.tag_id || '').toLowerCase().includes(q) ||
        (j.origin_country || '').toLowerCase().includes(q) ||
        (j.origin_centre || '').toLowerCase().includes(q) ||
        (j.dest_country || '').toLowerCase().includes(q) ||
        (j.dest_centre || '').toLowerCase().includes(q) ||
        (j.origin_impc || '').toLowerCase().includes(q) ||
        (j.dest_impc || '').toLowerCase().includes(q)
      );
    }
    return sortJourneys(data, sortCol, sortDir);
  }, [journeys, search, filterE2E, sortCol, sortDir]);

  // Reset page to 0 whenever the filtered dataset changes to avoid being on a non-existent page
  useEffect(() => { setPage(0); }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageData = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function handleSort(col: SortKey) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortCol !== col) return <span className="text-slate-300 ml-0.5">↕</span>;
    return <span className="text-indigo-500 ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  const e2eCount = journeys.filter(j => j.has_destination).length;
  const originOnlyCount = journeys.length - e2eCount;

  return (
    <div className="space-y-3">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-2">
          {([
            { key: 'ALL',         label: 'All',          count: journeys.length },
            { key: 'E2E',         label: 'End-to-End',   count: e2eCount },
            { key: 'ORIGIN_ONLY', label: 'Origin Only',  count: originOnlyCount },
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => setFilterE2E(f.key)}
              className={`px-3 py-1.5 text-xs rounded-md border font-medium transition-all duration-150 ${
                filterE2E === f.key
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 text-[10px] font-normal ${filterE2E === f.key ? 'text-indigo-200' : 'text-slate-400'}`}>
                {f.count.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Search s9id, tag, country, centre…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 px-3 text-xs rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 w-56"
          />
          <button
            onClick={() => exportJourneysToCsv(filtered, `rfid_epcis${dateLabel ? '_' + dateLabel : ''}.csv`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-all duration-150"
            title="Download filtered data as CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {/* Group headers */}
              <th colSpan={2} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider border-r border-slate-200">
                Identity
              </th>
              <th colSpan={5} className="px-3 py-2 text-left text-[10px] font-semibold text-indigo-600 uppercase tracking-wider bg-indigo-50/30 border-r border-indigo-200">
                Origin (RFID)
              </th>
              <th colSpan={5} className="px-3 py-2 text-left text-[10px] font-semibold text-emerald-600 uppercase tracking-wider bg-emerald-50/30 border-r border-emerald-200">
                Destination (RFID)
              </th>
              <th colSpan={2} className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                Transit
              </th>
            </tr>
            <tr className="bg-white border-b-2 border-slate-200 text-[11px] font-semibold text-slate-600">
              {/* Identity */}
              <th className="px-3 py-2 text-left cursor-pointer hover:text-indigo-600 whitespace-nowrap" onClick={() => handleSort('s9id')}>
                Receptacle (s9id) <SortIcon col="s9id" />
              </th>
              <th className="px-3 py-2 text-left border-r border-slate-200 whitespace-nowrap">Tag ID</th>
              {/* Origin */}
              <th className="px-3 py-2 text-left cursor-pointer hover:text-indigo-600 bg-indigo-50/20 whitespace-nowrap" onClick={() => handleSort('origin_country')}>
                Country <SortIcon col="origin_country" />
              </th>
              <th className="px-3 py-2 text-left cursor-pointer hover:text-indigo-600 bg-indigo-50/20 whitespace-nowrap" onClick={() => handleSort('origin_centre')}>
                Centre <SortIcon col="origin_centre" />
              </th>
              <th className="px-3 py-2 text-left bg-indigo-50/20 whitespace-nowrap">IMPC</th>
              <th className="px-3 py-2 text-left cursor-pointer hover:text-indigo-600 bg-indigo-50/20 whitespace-nowrap" onClick={() => handleSort('origin_time')}>
                Time (UTC) <SortIcon col="origin_time" />
              </th>
              <th className="px-3 py-2 text-right bg-indigo-50/20 border-r border-indigo-200 whitespace-nowrap">Reads</th>
              {/* Destination */}
              <th className="px-3 py-2 text-left cursor-pointer hover:text-emerald-600 bg-emerald-50/20 whitespace-nowrap" onClick={() => handleSort('dest_country')}>
                Country <SortIcon col="dest_country" />
              </th>
              <th className="px-3 py-2 text-left cursor-pointer hover:text-emerald-600 bg-emerald-50/20 whitespace-nowrap" onClick={() => handleSort('dest_centre')}>
                Centre <SortIcon col="dest_centre" />
              </th>
              <th className="px-3 py-2 text-left bg-emerald-50/20 whitespace-nowrap">IMPC</th>
              <th className="px-3 py-2 text-left cursor-pointer hover:text-emerald-600 bg-emerald-50/20 whitespace-nowrap" onClick={() => handleSort('dest_time')}>
                Time (UTC) <SortIcon col="dest_time" />
              </th>
              <th className="px-3 py-2 text-right bg-emerald-50/20 border-r border-emerald-200 whitespace-nowrap">Reads</th>
              {/* Transit */}
              <th className="px-3 py-2 text-right cursor-pointer hover:text-slate-800 whitespace-nowrap" onClick={() => handleSort('transit_hours')}>
                Duration <SortIcon col="transit_hours" />
              </th>
              <th className="px-3 py-2 text-right whitespace-nowrap">Days</th>
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-4 py-10 text-center text-sm text-slate-400">
                  No records match the current filters.
                </td>
              </tr>
            ) : pageData.map((j, i) => (
              <tr
                key={j.s9id}
                className={`border-b border-slate-100 hover:bg-slate-50/60 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}
              >
                {/* Identity */}
                <td className="px-3 py-2 font-mono text-slate-700 max-w-[200px] truncate" title={j.s9id}>{j.s9id}</td>
                <td className="px-3 py-2 font-mono text-slate-400 max-w-[140px] truncate border-r border-slate-200" title={j.tag_id || ''}>{truncTag(j.tag_id)}</td>
                {/* Origin */}
                <td className="px-3 py-2 text-slate-700 bg-indigo-50/20">{j.origin_country || '—'}</td>
                <td className="px-3 py-2 text-slate-600 max-w-[150px] truncate bg-indigo-50/20" title={j.origin_centre}>{j.origin_centre || '—'}</td>
                <td className="px-3 py-2 font-mono text-slate-500 bg-indigo-50/20">{j.origin_impc || '—'}</td>
                <td className="px-3 py-2 font-mono text-slate-500 bg-indigo-50/20 whitespace-nowrap">{formatTime(j.origin_time)}</td>
                <td className="px-3 py-2 text-right font-mono text-indigo-600 bg-indigo-50/20 border-r border-indigo-200">{j.origin_readings}</td>
                {/* Destination */}
                <td className="px-3 py-2 text-slate-700 bg-emerald-50/20">{j.dest_country || '—'}</td>
                <td className="px-3 py-2 text-slate-600 max-w-[150px] truncate bg-emerald-50/20" title={j.dest_centre || ''}>{j.dest_centre || '—'}</td>
                <td className="px-3 py-2 font-mono text-slate-500 bg-emerald-50/20">{j.dest_impc || '—'}</td>
                <td className="px-3 py-2 font-mono text-slate-500 bg-emerald-50/20 whitespace-nowrap">{formatTime(j.dest_time)}</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-600 bg-emerald-50/20 border-r border-emerald-200">
                  {j.dest_readings > 0 ? j.dest_readings : '—'}
                </td>
                {/* Transit */}
                <td className={`px-3 py-2 text-right font-mono font-medium ${j.transit_hours !== null ? 'text-slate-700' : 'text-slate-300'}`}>
                  {formatTransit(j.transit_hours)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-500">
                  {j.transit_hours !== null ? (j.transit_hours / 24).toFixed(1) + 'd' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">
          Página <span className="font-bold text-slate-800">{safePage + 1}</span> de <span className="font-bold text-slate-800">{totalPages}</span>
          <span className="ml-2 text-slate-400">·</span>
          <span className="ml-2 text-slate-500">{filtered.length.toLocaleString()} registros</span>
          {filtered.length !== journeys.length && (
            <span className="ml-1 text-slate-400">(de {journeys.length.toLocaleString()})</span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPage(0)}
            disabled={safePage === 0}
            title="Primera página"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 text-base font-semibold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 active:scale-95"
          >«</button>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={safePage === 0}
            title="Página anterior"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 text-base font-semibold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 active:scale-95"
          >‹</button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let p: number;
            if (totalPages <= 5) p = i;
            else if (safePage < 3) p = i;
            else if (safePage > totalPages - 4) p = totalPages - 5 + i;
            else p = safePage - 2 + i;
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`h-9 min-w-[2.25rem] px-2 flex items-center justify-center rounded-lg border text-sm font-semibold shadow-sm transition-all active:scale-95 ${
                  p === safePage
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-indigo-200'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700'
                }`}
              >{p + 1}</button>
            );
          })}
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            title="Página siguiente"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 text-base font-semibold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 active:scale-95"
          >›</button>
          <button
            onClick={() => setPage(totalPages - 1)}
            disabled={safePage >= totalPages - 1}
            title="Última página"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 text-base font-semibold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 active:scale-95"
          >»</button>
        </div>
      </div>
    </div>
  );
}
