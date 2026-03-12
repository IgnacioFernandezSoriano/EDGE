/**
 * DataTable — grouped column layout for RFID-EDI comparison
 * Column groups:
 *   1. Identity: Coverage | Receptacle (s9id) | Tag ID
 *   2. Departure pair: RFID Departure (time+centre+country) | PREDES (time+centre+country) | Dep. Lag
 *   3. Arrival pair:   RFID Arrival (time+centre+country)  | RESDES (time+centre+country) | Arr. Lead
 *   4. Transit:        RFID Transit | EDI Transit
 * For RFID Only: RFID columns show data, EDI columns show —
 * For EDI Only:  EDI columns show data (predes_origin_* / redes_dest_*), RFID columns show —
 */

import { useState, useMemo } from 'react';
import { TrackingEvent } from '@/lib/supabase';
import { exportToCsv } from '@/lib/exportCsv';

const COVERAGE_COLORS: Record<string, string> = {
  FULL:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  RFID_PREDES:'bg-blue-50 text-blue-700 border-blue-200',
  RFID_RESDES:'bg-indigo-50 text-indigo-700 border-indigo-200',
  RFID_ONLY:  'bg-amber-50 text-amber-700 border-amber-200',
  EDI_ONLY:   'bg-slate-100 text-slate-600 border-slate-200',
};

function formatHours(h: number | null): string {
  if (h === null || h === undefined) return '—';
  const abs = Math.abs(h);
  const sign = h < 0 ? '−' : '+';
  if (abs < 24) return `${sign}${abs.toFixed(1)}h`;
  return `${sign}${(abs / 24).toFixed(1)}d`;
}

function formatTime(t: string | null): string {
  if (!t) return '—';
  const d = new Date(t);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' });
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}

function truncTag(tag: string | null): string {
  if (!tag) return '—';
  // Show last 16 chars of URN tag IDs for readability
  return tag.length > 20 ? '…' + tag.slice(-16) : tag;
}

interface DataTableProps {
  events: TrackingEvent[];
  filterCoverage?: string;
  dateLabel?: string;
}

export function DataTable({ events, filterCoverage, dateLabel }: DataTableProps) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState<string>('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const pageSize = 20;

  const filtered = useMemo(() => {
    let data = events;
    if (filterCoverage && filterCoverage !== 'ALL') {
      data = data.filter(e => e.coverage_type === filterCoverage);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      data = data.filter(e =>
        (e.s9id || '').toLowerCase().includes(q) ||
        (e.tag_id || '').toLowerCase().includes(q) ||
        (e.rfid_origin_country || '').toLowerCase().includes(q) ||
        (e.redes_dest_country || '').toLowerCase().includes(q) ||
        (e.predes_origin_country || '').toLowerCase().includes(q) ||
        (e.rfid_origin_centre || '').toLowerCase().includes(q) ||
        (e.redes_dest_centre || '').toLowerCase().includes(q) ||
        (e.predes_origin_centre || '').toLowerCase().includes(q)
      );
    }
    data = [...data].sort((a, b) => {
      const av = (a as any)[sortCol];
      const bv = (b as any)[sortCol];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return data;
  }, [events, filterCoverage, search, sortCol, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const pageData = filtered.slice(page * pageSize, (page + 1) * pageSize);

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setPage(0);
  }

  function handleExport() {
    const suffix = dateLabel ? `_${dateLabel.replace(/[\s/]/g, '_')}` : '';
    const coverageSuffix = filterCoverage && filterCoverage !== 'ALL' ? `_${filterCoverage}` : '';
    exportToCsv(filtered, `tracking_events${coverageSuffix}${suffix}.csv`);
  }

  const SortIcon = ({ col }: { col: string }) => (
    <span className="ml-1 text-slate-400 text-xs">
      {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );

  const Th = ({ col, label, className = '' }: { col: string; label: string; className?: string }) => (
    <th
      onClick={() => handleSort(col)}
      className={`px-3 py-2.5 text-left font-semibold text-slate-600 whitespace-nowrap cursor-pointer hover:text-slate-900 select-none ${className}`}
    >
      {label}<SortIcon col={col} />
    </th>
  );

  return (
    <div className="space-y-3">
      {/* Search + export bar */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search by s9id, tag, country, or centre…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
        />
        <span className="text-xs text-slate-400 whitespace-nowrap">{filtered.length.toLocaleString()} records</span>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-md text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-300 transition-colors whitespace-nowrap shadow-sm"
          title="Download filtered data as CSV"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            {/* Group header row */}
            <tr className="bg-slate-100 border-b border-slate-300">
              <th colSpan={3} className="px-3 py-1.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider border-r border-slate-300">
                Identity
              </th>
              <th colSpan={5} className="px-3 py-1.5 text-left text-[10px] font-semibold text-indigo-600 uppercase tracking-wider border-r border-indigo-200 bg-indigo-50/60">
                ← Departure pair (RFID vs PREDES)
              </th>
              <th colSpan={5} className="px-3 py-1.5 text-left text-[10px] font-semibold text-emerald-600 uppercase tracking-wider border-r border-emerald-200 bg-emerald-50/60">
                ← Arrival pair (RFID vs RESDES)
              </th>
              <th colSpan={2} className="px-3 py-1.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                Transit
              </th>
            </tr>
            {/* Column header row */}
            <tr className="bg-slate-50 border-b border-slate-200">
              {/* Identity */}
              <Th col="coverage_type" label="Coverage" />
              <Th col="s9id" label="Receptacle (s9id)" />
              <th
                onClick={() => handleSort('tag_id')}
                className="px-3 py-2.5 text-left font-semibold text-slate-600 whitespace-nowrap cursor-pointer hover:text-slate-900 select-none border-r border-slate-200"
              >
                Tag ID<SortIcon col="tag_id" />
              </th>
              {/* Departure pair */}
              <Th col="rfid_origin_country" label="RFID Origin" className="bg-indigo-50/40" />
              <Th col="rfid_origin_centre" label="RFID Origin Centre" className="bg-indigo-50/40" />
              <Th col="rfid_origin_time" label="RFID Departure" className="bg-indigo-50/40" />
              <Th col="predes_time" label="PREDES" className="bg-indigo-50/40" />
              <th
                onClick={() => handleSort('departure_lag_hours')}
                className="px-3 py-2.5 text-left font-semibold text-slate-600 whitespace-nowrap cursor-pointer hover:text-slate-900 select-none border-r border-indigo-200 bg-indigo-50/40"
              >
                Dep. Lag<SortIcon col="departure_lag_hours" />
              </th>
              {/* Arrival pair */}
              <Th col="redes_dest_country" label="RFID Dest." className="bg-emerald-50/40" />
              <Th col="redes_dest_centre" label="RFID Dest. Centre" className="bg-emerald-50/40" />
              <Th col="rfid_dest_time" label="RFID Arrival" className="bg-emerald-50/40" />
              <Th col="redes_time" label="RESDES" className="bg-emerald-50/40" />
              <th
                onClick={() => handleSort('arrival_lead_hours')}
                className="px-3 py-2.5 text-left font-semibold text-slate-600 whitespace-nowrap cursor-pointer hover:text-slate-900 select-none border-r border-emerald-200 bg-emerald-50/40"
              >
                Arr. Lead<SortIcon col="arrival_lead_hours" />
              </th>
              {/* Transit */}
              <Th col="rfid_transit_hours" label="RFID Transit" />
              <Th col="edi_transit_hours" label="EDI Transit" />
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 ? (
              <tr>
                <td colSpan={15} className="px-4 py-10 text-center text-sm text-slate-400">
                  No records match the current filters.
                </td>
              </tr>
            ) : pageData.map((e, i) => {
              // Resolve origin: RFID origin if available, else PREDES origin (EDI Only)
              const originCountry = e.rfid_origin_country || e.predes_origin_country;
              const originCentre = e.rfid_origin_centre || e.predes_origin_centre;
              // Resolve destination: RFID dest if available, else REDES dest (EDI Only)
              const destCountry = e.rfid_dest_country || e.redes_dest_country;
              const destCentre = e.rfid_dest_centre || e.redes_dest_centre;

              return (
                <tr key={e.id} className={`border-b border-slate-100 hover:bg-slate-50/60 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                  {/* Identity */}
                  <td className="px-3 py-2">
                    <span className={`status-pill border text-[10px] ${COVERAGE_COLORS[e.coverage_type] || 'bg-slate-100 text-slate-600'}`}>
                      {e.coverage_type?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-2 mono-value text-slate-700 whitespace-nowrap" title={e.s9id}>{e.s9id}</td>
                  <td className="px-3 py-2 mono-value text-slate-500 whitespace-nowrap border-r border-slate-200" title={e.tag_id || ''}>{e.tag_id || '—'}</td>

                  {/* Departure pair — RFID side */}
                  <td className="px-3 py-2 text-slate-600 bg-indigo-50/20">{originCountry || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate bg-indigo-50/20" title={originCentre || ''}>{originCentre || '—'}</td>
                  <td className="px-3 py-2 mono-value text-slate-500 bg-indigo-50/20">{formatTime(e.rfid_origin_time)}</td>
                  {/* Departure pair — PREDES side */}
                  <td className="px-3 py-2 mono-value text-indigo-600 bg-indigo-50/20">{formatTime(e.predes_time)}</td>
                  <td className={`px-3 py-2 mono-value font-medium border-r border-indigo-200 bg-indigo-50/20 ${e.departure_lag_hours !== null ? (e.departure_lag_hours < 0 ? 'text-rose-600' : 'text-slate-700') : 'text-slate-400'}`}>
                    {formatHours(e.departure_lag_hours)}
                  </td>

                  {/* Arrival pair — RFID side */}
                  <td className="px-3 py-2 text-slate-600 bg-emerald-50/20">{destCountry || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate bg-emerald-50/20" title={destCentre || ''}>{destCentre || '—'}</td>
                  <td className="px-3 py-2 mono-value text-slate-500 bg-emerald-50/20">{formatTime(e.rfid_dest_time)}</td>
                  {/* Arrival pair — RESDES side */}
                  <td className="px-3 py-2 mono-value text-emerald-600 bg-emerald-50/20">{formatTime(e.redes_time)}</td>
                  <td className={`px-3 py-2 mono-value font-medium border-r border-emerald-200 bg-emerald-50/20 ${e.arrival_lead_hours !== null ? (e.arrival_lead_hours < 0 ? 'text-emerald-600' : 'text-amber-600') : 'text-slate-400'}`}>
                    {formatHours(e.arrival_lead_hours)}
                  </td>

                  {/* Transit */}
                  <td className="px-3 py-2 mono-value text-slate-600">{formatHours(e.rfid_transit_hours)}</td>
                  <td className="px-3 py-2 mono-value text-slate-600">{formatHours(e.edi_transit_hours)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">
            Página <span className="font-bold text-slate-800">{page + 1}</span> de <span className="font-bold text-slate-800">{totalPages}</span>
            <span className="ml-2 text-slate-400">·</span>
            <span className="ml-2 text-slate-500">{filtered.length.toLocaleString()} registros</span>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              title="Primera página"
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 text-base font-semibold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 active:scale-95"
            >«</button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              title="Página anterior"
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 text-base font-semibold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 active:scale-95"
            >‹</button>
            {/* Page number pills */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let p: number;
              if (totalPages <= 5) p = i;
              else if (page < 3) p = i;
              else if (page > totalPages - 4) p = totalPages - 5 + i;
              else p = page - 2 + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`h-9 min-w-[2.25rem] px-2 flex items-center justify-center rounded-lg border text-sm font-semibold shadow-sm transition-all active:scale-95 ${
                    p === page
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-indigo-200'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700'
                  }`}
                >{p + 1}</button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              title="Página siguiente"
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 text-base font-semibold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 active:scale-95"
            >›</button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              title="Última página"
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 text-base font-semibold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 active:scale-95"
            >»</button>
          </div>
        </div>
      )}
    </div>
  );
}
