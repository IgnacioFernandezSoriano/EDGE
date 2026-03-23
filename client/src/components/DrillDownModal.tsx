/**
 * DrillDownModal — shows the list of RfidJourney records that make up a
 * clicked bar / table row, with CSV export.
 *
 * Usage:
 *   <DrillDownModal
 *     open={!!drill}
 *     title="Portugal → Switzerland"
 *     subtitle="810 receptacles"
 *     journeys={drill?.journeys ?? []}
 *     onClose={() => setDrill(null)}
 *   />
 */

import React, { useMemo, useState } from 'react';
import type { RfidJourney } from '@/hooks/useEpcisData';

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  journeys: RfidJourney[];
  onClose: () => void;
}

/* ── CSV helpers ── */
function escapeCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCSV(rows: RfidJourney[], filename: string) {
  const headers = [
    'tag_id', 's9id',
    'origin_country', 'origin_centre', 'origin_impc', 'origin_time',
    'departure_country', 'departure_centre', 'departure_impc', 'departure_time',
    'arrival_country', 'arrival_centre', 'arrival_impc', 'arrival_time',
    'dest_country', 'dest_centre', 'dest_impc', 'dest_time',
    'international_transit_hours', 'transit_hours', 'full_journey_hours',
    'has_origin', 'has_destination', 'has_international', 'is_complete',
  ];
  const lines = [
    headers.join(','),
    ...rows.map(j =>
      [
        j.tag_id, j.s9id,
        j.origin_country, j.origin_centre, j.origin_impc, j.origin_time,
        j.departure_country, j.departure_centre, j.departure_impc, j.departure_time,
        j.arrival_country, j.arrival_centre, j.arrival_impc, j.arrival_time,
        j.dest_country, j.dest_centre, j.dest_impc, j.dest_time,
        j.international_transit_hours, j.transit_hours, j.full_journey_hours,
        j.has_origin, j.has_destination, j.has_international, j.is_complete,
      ].map(escapeCell).join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Component ── */
export default function DrillDownModal({ open, title, subtitle, journeys, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<keyof RfidJourney>('origin_time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? journeys.filter(j =>
          (j.tag_id || '').toLowerCase().includes(q) ||
          (j.s9id || '').toLowerCase().includes(q) ||
          (j.origin_centre || '').toLowerCase().includes(q) ||
          (j.departure_centre || '').toLowerCase().includes(q) ||
          (j.arrival_centre || '').toLowerCase().includes(q) ||
          (j.dest_centre || '').toLowerCase().includes(q)
        )
      : journeys;
  }, [journeys, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSort(k: keyof RfidJourney) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
    setPage(0);
  }

  function handleSearch(v: string) { setSearch(v); setPage(0); }

  if (!open) return null;

  const csvFilename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;

  const SortIcon = ({ k }: { k: keyof RfidJourney }) => (
    <span className="ml-0.5 opacity-50 text-[10px]">
      {sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  );

  const Th = ({ label, k }: { label: string; k: keyof RfidJourney }) => (
    <th
      className="py-2 px-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-slate-700"
      onClick={() => toggleSort(k)}
    >
      {label}<SortIcon k={k} />
    </th>
  );

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div className="bg-white rounded-xl shadow-2xl flex flex-col w-full max-w-6xl mx-4 max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 ml-4 flex-shrink-0">
            {/* CSV download */}
            <button
              onClick={() => downloadCSV(filtered, csvFilename)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download CSV ({filtered.length.toLocaleString()})
            </button>
            {/* Close */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search + count */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-50">
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search tag, s9id, centre…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <span className="text-xs text-slate-400">
            {filtered.length.toLocaleString()} receptacles
            {filtered.length !== journeys.length && ` (of ${journeys.length.toLocaleString()})`}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[900px]">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 z-10">
              <tr>
                <Th label="Tag ID" k="tag_id" />
                <Th label="S9 ID" k="s9id" />
                <Th label="Origin Centre" k="origin_centre" />
                <Th label="OE Time" k="origin_time" />
                <Th label="Dep. Centre (AMU)" k="departure_centre" />
                <Th label="AMU Out Time" k="departure_time" />
                <Th label="Arr. Centre (AMU)" k="arrival_centre" />
                <Th label="AMU In Time" k="arrival_time" />
                <Th label="Dest. Centre (OE)" k="dest_centre" />
                <Th label="OE Dest Time" k="dest_time" />
                <Th label="Transit (h)" k="international_transit_hours" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((j, i) => (
                <tr key={j.tag_id + i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="py-1.5 px-3 font-mono text-slate-700 whitespace-nowrap">{j.tag_id || '—'}</td>
                  <td className="py-1.5 px-3 font-mono text-slate-500 whitespace-nowrap">{j.s9id || '—'}</td>
                  <td className="py-1.5 px-3 text-slate-700 whitespace-nowrap">{j.origin_centre || '—'}</td>
                  <td className="py-1.5 px-3 text-slate-500 whitespace-nowrap">{j.origin_time ? j.origin_time.slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td className="py-1.5 px-3 text-slate-700 whitespace-nowrap">
                    {j.departure_centre
                      ? <span className="text-indigo-700 font-medium">{j.departure_centre}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-1.5 px-3 text-slate-500 whitespace-nowrap">{j.departure_time ? j.departure_time.slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td className="py-1.5 px-3 text-slate-700 whitespace-nowrap">
                    {j.arrival_centre
                      ? <span className="text-emerald-700 font-medium">{j.arrival_centre}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-1.5 px-3 text-slate-500 whitespace-nowrap">{j.arrival_time ? j.arrival_time.slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td className="py-1.5 px-3 text-slate-700 whitespace-nowrap">{j.dest_centre || <span className="text-slate-300">—</span>}</td>
                  <td className="py-1.5 px-3 text-slate-500 whitespace-nowrap">{j.dest_time ? j.dest_time.slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td className="py-1.5 px-3 text-right whitespace-nowrap">
                    {j.international_transit_hours != null
                      ? <span className="font-semibold text-indigo-600">{j.international_transit_hours}h</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={11} className="py-10 text-center text-slate-400 text-xs">No receptacles found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 text-xs text-slate-500">
            <span>Page {page + 1} of {totalPages} ({sorted.length.toLocaleString()} rows)</span>
            <div className="flex gap-1">
              <button disabled={page === 0} onClick={() => setPage(0)}
                className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50">«</button>
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50">‹</button>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50">›</button>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}
                className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50">»</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
