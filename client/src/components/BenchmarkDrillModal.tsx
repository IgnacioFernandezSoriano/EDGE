/**
 * BenchmarkDrillModal — shows the list of BenchmarkRow records that make up a
 * clicked bar / table row in the Benchmark report, with CSV export.
 *
 * Usage:
 *   <BenchmarkDrillModal
 *     open={!!drill}
 *     title="AMU Outbound: Lisbon AMU"
 *     subtitle="142 receptacles"
 *     rows={drill?.rows ?? []}
 *     onClose={() => setDrill(null)}
 *   />
 */
import React, { useMemo, useState } from 'react';
import { X, Download, Search } from 'lucide-react';
import type { BenchmarkRow } from '@/hooks/useBenchmarkData';

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  rows: BenchmarkRow[];
  onClose: () => void;
}

/* ── CSV helpers ── */
function escapeCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCSV(rows: BenchmarkRow[], filename: string) {
  const headers = [
    's9id', 'tag_id',
    'rf_origin_country', 'rf_origin_centre', 'rf_origin_impc', 'rf_origin_time',
    'rf_departure_country', 'rf_departure_centre', 'rf_departure_impc', 'rf_departure_time',
    'rf_arrival_country', 'rf_arrival_centre', 'rf_arrival_impc', 'rf_arrival_time',
    'rf_dest_country', 'rf_dest_centre', 'rf_dest_impc', 'rf_dest_time',
    'rf_transit_hours',
    'edi_origin_impc', 'edi_dest_impc',
    'edi_predes_time', 'edi_cardit_time',
    'edi_resdit74_time', 'edi_resdit74_impc',
    'edi_resdit21_time', 'edi_resdit21_impc',
    'edi_resdes_time', 'edi_transit_hours',
    'delta_predes_hours', 'delta_resdes_hours',
    'has_rf_departure', 'has_rf_arrival', 'has_rf_transit', 'has_edi_transit',
    'missing_cardit', 'missing_resdit74', 'missing_resdit21', 'missing_resdes',
  ];
  const lines = [
    headers.join(','),
    ...rows.map(r =>
      headers.map(h => escapeCell((r as any)[h])).join(',')
    ),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmt(t: string | null): string {
  if (!t) return '—';
  try {
    return new Date(t).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: '2-digit',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    });
  } catch { return t; }
}

function fmtH(h: number | null): string {
  if (h === null) return '—';
  const sign = h < 0 ? '−' : '+';
  return `${sign}${(Math.abs(h) / 24).toFixed(1)}d`;
}

const PAGE = 50;

export default function BenchmarkDrillModal({ open, title, subtitle, rows, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<keyof BenchmarkRow>('s9id');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return rows.filter(r =>
      !q ||
      (r.s9id ?? '').toLowerCase().includes(q) ||
      (r.tag_id ?? '').toLowerCase().includes(q) ||
      (r.rf_origin_centre ?? '').toLowerCase().includes(q) ||
      (r.rf_departure_centre ?? '').toLowerCase().includes(q) ||
      (r.rf_arrival_centre ?? '').toLowerCase().includes(q) ||
      (r.rf_origin_country ?? '').toLowerCase().includes(q) ||
      (r.rf_dest_country ?? '').toLowerCase().includes(q) ||
      (r.edi_origin_impc ?? '').toLowerCase().includes(q) ||
      (r.edi_dest_impc ?? '').toLowerCase().includes(q)
    );
  }, [rows, query]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = (a as any)[sortKey] ?? '';
      const bv = (b as any)[sortKey] ?? '';
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortAsc]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const slice = sorted.slice(page * PAGE, (page + 1) * PAGE);

  // Reset page when filter changes
  React.useEffect(() => { setPage(0); }, [query, sortKey, sortAsc]);

  function toggleSort(key: keyof BenchmarkRow) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  function Th({ k, label }: { k: keyof BenchmarkRow; label: string }) {
    const active = sortKey === k;
    return (
      <th
        className={`px-2 py-2 text-left text-[10px] font-semibold whitespace-nowrap cursor-pointer select-none ${active ? 'text-indigo-600' : 'text-slate-500'}`}
        onClick={() => toggleSort(k)}
      >
        {label} {active ? (sortAsc ? '↑' : '↓') : ''}
      </th>
    );
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.45)' }}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-6xl max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-800">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={() => downloadCSV(filtered, `benchmark_drill_${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
            >
              <Download size={13} />
              Download CSV
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by s9id, tag, centre, country, IMPC…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-8 pr-4 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} records
          </p>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
              <tr>
                <Th k="s9id" label="s9id" />
                <Th k="rf_origin_country" label="Origin Country" />
                <Th k="rf_origin_centre" label="Origin Centre" />
                <Th k="edi_origin_impc" label="Origin IMPC" />
                <Th k="rf_departure_time" label="RFID Outbound" />
                <Th k="edi_predes_time" label="EDI PREDES" />
                <Th k="delta_predes_hours" label="Δ Outbound (d)" />
                <Th k="rf_dest_country" label="Dest Country" />
                <Th k="rf_dest_centre" label="Dest Centre" />
                <Th k="edi_dest_impc" label="Dest IMPC" />
                <Th k="rf_arrival_time" label="RFID Inbound" />
                <Th k="edi_resdes_time" label="EDI RESDES" />
                <Th k="delta_resdes_hours" label="Δ Inbound (d)" />
                <Th k="rf_transit_hours" label="RFID Transit (d)" />
                <Th k="edi_transit_hours" label="EDI Transit (d)" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {slice.map((r, i) => {
                const deltaPredesColor = r.delta_predes_hours === null ? 'text-slate-400'
                  : r.delta_predes_hours >= 0 ? 'text-emerald-600' : 'text-rose-600';
                const deltaResdesColor = r.delta_resdes_hours === null ? 'text-slate-400'
                  : r.delta_resdes_hours >= 0 ? 'text-emerald-600' : 'text-rose-600';
                return (
                  <tr key={i} className="hover:bg-indigo-50 transition-colors">
                    <td className="px-2 py-1.5 font-mono text-slate-700 whitespace-nowrap">{r.s9id || '—'}</td>
                    <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{r.rf_origin_country || '—'}</td>
                    <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{r.rf_origin_centre || '—'}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-500 whitespace-nowrap">{r.edi_origin_impc || '—'}</td>
                    <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{fmt(r.rf_departure_time)}</td>
                    <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{fmt(r.edi_predes_time)}</td>
                    <td className={`px-2 py-1.5 font-semibold whitespace-nowrap ${deltaPredesColor}`}>{fmtH(r.delta_predes_hours)}</td>
                    <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{r.rf_dest_country || r.rf_arrival_country || '—'}</td>
                    <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{r.rf_dest_centre || r.rf_arrival_centre || '—'}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-500 whitespace-nowrap">{r.edi_dest_impc || '—'}</td>
                    <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{fmt(r.rf_arrival_time)}</td>
                    <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{fmt(r.edi_resdes_time)}</td>
                    <td className={`px-2 py-1.5 font-semibold whitespace-nowrap ${deltaResdesColor}`}>{fmtH(r.delta_resdes_hours)}</td>
                    <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{r.rf_transit_hours !== null ? `${(r.rf_transit_hours / 24).toFixed(1)}d` : '—'}</td>
                    <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{r.edi_transit_hours !== null ? `${(r.edi_transit_hours / 24).toFixed(1)}d` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {slice.length === 0 && (
            <p className="text-xs text-slate-400 italic text-center py-8">No records match the current filter.</p>
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-xs text-slate-500">
            <span>Page {page + 1} of {pages} · {sorted.length.toLocaleString()} records</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">«</button>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">‹</button>
              {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                const start = Math.max(0, Math.min(page - 2, pages - 5));
                const p = start + i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`px-2 py-1 rounded border text-xs ${p === page ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 hover:bg-slate-50'}`}>
                    {p + 1}
                  </button>
                );
              })}
              <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">›</button>
              <button onClick={() => setPage(pages - 1)} disabled={page >= pages - 1} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">»</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
