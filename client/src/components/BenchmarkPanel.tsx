/**
 * BenchmarkPanel — RFID vs EDI Benchmark Report
 *
 * Three direct comparisons:
 *   1. RFID Outbound vs PREDES  (origin departure preparation)
 *   2. RFID Inbound vs RESDES   (destination delivery)
 *   3. Transit RFID (DEP→ARR) vs Transit EDI (PREDES→RESDES)
 *
 * Plus EDI chain completeness (PREDES→RESDIT74→RESDIT21→RESDES).
 * Filtered by global date / origin country / destination country.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Download } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
  LineChart, Line,
} from 'recharts';
import { useBenchmarkData, BenchmarkRow, RouteStats, CentreStats, BenchmarkFilters } from '@/hooks/useBenchmarkData';
import type { RfidJourney } from '@/hooks/useEpcisData';

/* ── Palette ────────────────────────────────────────────────────────────────── */
const C = {
  rfid:   '#4F46E5',
  edi:    '#64748b',
  ok:     '#22c55e',
  warn:   '#f59e0b',
  danger: '#ef4444',
};

/* ── Helpers ────────────────────────────────────────────────────────────────── */
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
  return `${sign}${Math.abs(h).toFixed(1)}h`;
}
function fmtHAbs(h: number | null): string {
  if (h === null) return '—';
  return `${h.toFixed(1)}h (${(h / 24).toFixed(1)}d)`;
}
function pct(n: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}
function deltaColor(h: number | null): string {
  if (h === null) return 'text-slate-400';
  return h >= 0 ? 'text-emerald-600' : 'text-rose-600';
}
function deltaBg(h: number | null): string {
  if (h === null) return '';
  return h >= 0 ? 'bg-emerald-50' : 'bg-rose-50';
}

/* ── KPI Card ───────────────────────────────────────────────────────────────── */
function KPI({ label, value, sub, color = 'indigo' }: { label: string; value: string | number; sub?: string; color?: string }) {
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    slate:  'bg-slate-50  border-slate-200  text-slate-700',
    green:  'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber:  'bg-amber-50  border-amber-200  text-amber-700',
    rose:   'bg-rose-50   border-rose-200   text-rose-700',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${colorMap[color] ?? colorMap.slate}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70 mb-1">{label}</div>
      <div className="text-2xl font-bold leading-none">{value}</div>
      {sub && <div className="text-[11px] mt-1 opacity-60">{sub}</div>}
    </div>
  );
}

/* ── Section wrapper ────────────────────────────────────────────────────────── */
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/* ── Gap badge ──────────────────────────────────────────────────────────────── */
function GapBadge({ pct }: { pct: number }) {
  const cls = pct === 0
    ? 'bg-emerald-100 text-emerald-700'
    : pct < 20
    ? 'bg-amber-100 text-amber-700'
    : 'bg-rose-100 text-rose-700';
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{pct}%</span>;
}

/* ── EDI Chain completeness bar ─────────────────────────────────────────────── */
function ChainBar({ label, present, total, rfid = false }: { label: string; present: number; total: number; rfid?: boolean }) {
  const p = total ? Math.round((present / total) * 100) : 0;
  const barColor = rfid
    ? 'bg-indigo-500'
    : p >= 90 ? 'bg-emerald-500' : p >= 60 ? 'bg-amber-400' : 'bg-rose-400';
  const pctColor = rfid
    ? 'text-indigo-600'
    : p >= 90 ? 'text-emerald-600' : p >= 60 ? 'text-amber-600' : 'text-rose-600';
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className={`w-28 text-xs font-mono font-semibold shrink-0 ${rfid ? 'text-indigo-600' : 'text-slate-600'}`}>{label}</div>
      <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${p}%` }} />
      </div>
      <div className="w-20 text-right text-xs text-slate-500">{present.toLocaleString()} / {total.toLocaleString()}</div>
      <div className={`w-10 text-right text-xs font-semibold ${pctColor}`}>{p}%</div>
    </div>
  );
}

/* ── Centre delta table ─────────────────────────────────────────────────────── */
function CentreTable({ data, label }: { data: CentreStats[]; label: string }) {
  if (!data.length) return <p className="text-xs text-slate-400 italic py-2">No data.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-3 py-2 text-left font-semibold text-slate-600">Centre</th>
            <th className="px-3 py-2 text-left font-semibold text-slate-500">IMPC</th>
            <th className="px-3 py-2 text-left font-semibold text-slate-500">Country</th>
            <th className="px-3 py-2 text-center font-semibold text-slate-600">N</th>
            <th className="px-3 py-2 text-center font-semibold text-indigo-600">Avg {label}</th>
            <th className="px-3 py-2 text-center font-semibold text-indigo-600">Median {label}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map(r => (
            <tr key={r.centre + r.impc} className={`hover:bg-slate-50 ${deltaBg(r.mean)}`}>
              <td className="px-3 py-2 font-semibold text-slate-700">{r.centre}</td>
              <td className="px-3 py-2 font-mono text-slate-500">{r.impc}</td>
              <td className="px-3 py-2 text-slate-500">{r.country}</td>
              <td className="px-3 py-2 text-center text-slate-600">{r.n}</td>
              <td className={`px-3 py-2 text-center font-semibold ${deltaColor(r.mean)}`}>{fmtH(r.mean)}</td>
              <td className={`px-3 py-2 text-center font-semibold ${deltaColor(r.median)}`}>{fmtH(r.median)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── CSV export helper ───────────────────────────────────────────────────────────────────────── */
function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportBenchmarkCsv(rows: BenchmarkRow[], view: DetailView) {
  const cols: { key: keyof BenchmarkRow | 'route' | 'transit_delta'; label: string }[] = [
    { key: 's9id',               label: 'Receptacle (s9id)' },
    { key: 'edi_origin_impc',    label: 'Origin IMPC' },
    { key: 'rf_origin_country',  label: 'Origin Country' },
    { key: 'rf_origin_centre',   label: 'Origin Centre' },
    { key: 'edi_dest_impc',      label: 'Dest IMPC' },
    { key: 'rf_dest_country',    label: 'Dest Country' },
    { key: 'rf_dest_centre',     label: 'Dest Centre' },
    ...(view !== 'arrival' ? [
      { key: 'edi_predes_time'    as keyof BenchmarkRow, label: 'EDI PREDES' },
      { key: 'rf_departure_time' as keyof BenchmarkRow, label: 'RFID Outbound' },
      { key: 'delta_predes_hours' as keyof BenchmarkRow, label: 'Δ Outbound (h)' },
    ] : []),
    ...(view !== 'departure' ? [
      { key: 'edi_resdes_time'    as keyof BenchmarkRow, label: 'EDI RESDES' },
      { key: 'rf_arrival_time'   as keyof BenchmarkRow, label: 'RFID Inbound' },
      { key: 'delta_resdes_hours' as keyof BenchmarkRow, label: 'Δ Inbound (h)' },
    ] : []),
    ...(view === 'transit' ? [
      { key: 'rf_transit_hours'  as keyof BenchmarkRow, label: 'RFID Transit (h)' },
      { key: 'edi_transit_hours' as keyof BenchmarkRow, label: 'EDI Transit (h)' },
    ] : []),
    { key: 'edi_resdit74_time',  label: 'RESDIT74' },
    { key: 'edi_resdit21_time',  label: 'RESDIT21' },
  ];

  const header = cols.map(c => c.label).join(',');
  const lines = rows.map(r => {
    const route = `${r.edi_origin_impc ?? r.rf_origin_impc ?? r.rf_departure_impc ?? '?'}→${r.edi_dest_impc ?? r.rf_dest_impc ?? r.rf_arrival_impc ?? '?'}`;
    return cols.map(c => {
      if (c.key === 'route') return escapeCell(route);
      if (c.key === 'transit_delta') {
        const d = r.rf_transit_hours !== null && r.edi_transit_hours !== null
          ? Math.round((r.rf_transit_hours - r.edi_transit_hours) * 10) / 10 : null;
        return escapeCell(d);
      }
      return escapeCell((r as any)[c.key]);
    }).join(',');
  });
  const csv = [header, ...lines].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `benchmark_${view}_records.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* ── Detail table ────────────────────────────────────────────────────────────────────────────────── */
type DetailView = 'departure' | 'arrival' | 'transit';

function DetailTable({ rows, view }: { rows: BenchmarkRow[]; view: DetailView }) {
  const [page, setPage] = useState(0);
  const PAGE = 25;

  // Reset page when view or rows change
  useEffect(() => { setPage(0); }, [view, rows]);

  const filtered = useMemo(() => {
    if (view === 'departure') return rows.filter(r => r.has_rf_departure);
    if (view === 'arrival')   return rows.filter(r => r.has_rf_arrival);
    return rows.filter(r => r.has_rf_transit && r.has_edi_transit);
  }, [rows, view]);

  const total = filtered.length;
  const slice = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const pages = Math.ceil(total / PAGE);

  if (!total) return <p className="text-xs text-slate-400 italic py-4">No data for this view.</p>;

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Receptacle (s9id)</th>
              {view !== 'arrival' && (
                <>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">EDI PREDES</th>
                  <th className="px-3 py-2 text-left font-semibold text-indigo-600">RFID Outbound</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">Δ Outbound</th>
                </>
              )}
              {view !== 'departure' && (
                <>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">EDI RESDES</th>
                  <th className="px-3 py-2 text-left font-semibold text-indigo-600">RFID Inbound</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">Δ Inbound</th>
                </>
              )}
              {view === 'transit' && (
                <>
                  <th className="px-3 py-2 text-center font-semibold text-indigo-600">RFID Transit</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">EDI Transit</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">Δ Transit</th>
                </>
              )}
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Route</th>
              <th className="px-3 py-2 text-center font-semibold text-amber-600">Missing EDI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {slice.map(r => {
              const transitDelta = (r.rf_transit_hours !== null && r.edi_transit_hours !== null)
                ? Math.round((r.rf_transit_hours - r.edi_transit_hours) * 10) / 10
                : null;
              const route = `${r.edi_origin_impc ?? r.rf_origin_impc ?? r.rf_departure_impc ?? '?'} → ${r.edi_dest_impc ?? r.rf_dest_impc ?? r.rf_arrival_impc ?? '?'}`;
              const missing = [
                !r.edi_resdit74_time ? 'RESDIT74' : null,
                !r.edi_resdit21_time ? 'RESDIT21' : null,
                !r.edi_resdes_time   ? 'RESDES'   : null,
              ].filter(Boolean);
              return (
                <tr key={r.s9id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500 max-w-[180px] truncate" title={r.s9id}>{r.s9id}</td>
                  {view !== 'arrival' && (
                    <>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmt(r.edi_predes_time)}</td>
                      <td className="px-3 py-2 text-indigo-600 whitespace-nowrap">{fmt(r.rf_departure_time)}</td>
                      <td className={`px-3 py-2 text-center font-semibold whitespace-nowrap ${deltaColor(r.delta_predes_hours)}`}>{fmtH(r.delta_predes_hours)}</td>
                    </>
                  )}
                  {view !== 'departure' && (
                    <>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmt(r.edi_resdes_time)}</td>
                      <td className="px-3 py-2 text-indigo-600 whitespace-nowrap">{fmt(r.rf_arrival_time)}</td>
                      <td className={`px-3 py-2 text-center font-semibold whitespace-nowrap ${deltaColor(r.delta_resdes_hours)}`}>{fmtH(r.delta_resdes_hours)}</td>
                    </>
                  )}
                  {view === 'transit' && (
                    <>
                      <td className="px-3 py-2 text-center text-indigo-600 font-semibold">{fmtHAbs(r.rf_transit_hours)}</td>
                      <td className="px-3 py-2 text-center text-slate-500 font-semibold">{fmtHAbs(r.edi_transit_hours)}</td>
                      <td className={`px-3 py-2 text-center font-semibold ${deltaColor(transitDelta)}`}>{fmtH(transitDelta)}</td>
                    </>
                  )}
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{route}</td>
                  <td className="px-3 py-2 text-center">
                    {missing.length === 0
                      ? <span className="text-emerald-500 text-[10px]">✓ Complete</span>
                      : <span className="text-rose-500 text-[10px] font-mono">{missing.join(', ')}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Pagination + CSV */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">
            Page <span className="font-bold text-slate-800">{page + 1}</span> of <span className="font-bold text-slate-800">{pages}</span>
            <span className="ml-2 text-slate-400">·</span>
            <span className="ml-2 text-slate-500">{total.toLocaleString()} records</span>
          </span>
          <button
            onClick={() => exportBenchmarkCsv(filtered, view)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 transition-all shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            Download CSV
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setPage(0)} disabled={page === 0} title="First page"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 text-base font-semibold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 active:scale-95">«</button>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} title="Previous page"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 text-base font-semibold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 active:scale-95">‹</button>
          {Array.from({ length: Math.min(5, pages) }, (_, i) => {
            let p: number;
            if (pages <= 5) p = i;
            else if (page < 3) p = i;
            else if (page > pages - 4) p = pages - 5 + i;
            else p = page - 2 + i;
            return (
              <button key={p} onClick={() => setPage(p)}
                className={`h-9 min-w-[2.25rem] px-2 flex items-center justify-center rounded-lg border text-sm font-semibold shadow-sm transition-all active:scale-95 ${
                  p === page
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-indigo-200'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700'
                }`}>{p + 1}</button>
            );
          })}
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} title="Next page"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 text-base font-semibold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 active:scale-95">›</button>
          <button onClick={() => setPage(pages - 1)} disabled={page >= pages - 1} title="Last page"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 text-base font-semibold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-700 active:scale-95">»</button>
        </div>
      </div>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────────── */
interface BenchmarkPanelProps {
  filters?: BenchmarkFilters;
  journeys: RfidJourney[];
  rfidBackgroundLoading?: boolean;
  rfidBackgroundProgress?: { loaded: number; total: number } | null;
}

export function BenchmarkPanel({ filters = {}, journeys, rfidBackgroundLoading = false, rfidBackgroundProgress = null }: BenchmarkPanelProps) {
  const { rows, stats, loading, error, ediProgress, backgroundLoading, backgroundProgress } = useBenchmarkData(journeys, filters, rfidBackgroundLoading, rfidBackgroundProgress);
  const [detailView, setDetailView] = useState<DetailView>('departure');

  if (loading) {
    const pctEdi = ediProgress && ediProgress.total > 0 ? Math.round(ediProgress.loaded / ediProgress.total * 100) : null;
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3" style={{ minWidth: 280 }}>
          <div className="w-8 h-8 rounded-full mx-auto animate-spin" style={{ border: '3px solid #e2e8f0', borderTopColor: C.rfid }} />
          <p className="text-sm text-slate-500">Loading benchmark data…</p>
          {ediProgress && (
            <div className="space-y-1">
              <p className="text-xs text-slate-400">
                EDI data: {ediProgress.loaded.toLocaleString()} / {ediProgress.total.toLocaleString()} rows
                {pctEdi !== null && ` (${pctEdi}%)`}
              </p>
              <div className="w-full bg-slate-100 rounded-full h-1.5">
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${pctEdi ?? 0}%`, background: C.rfid }} />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (error) {
    return <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-700">{error}</div>;
  }
  if (!stats) return null;

  /* ── Route chart data ── */
  const routeChartData = stats.byRoute.slice(0, 12).map(r => ({
    route:   r.route,
    rfidAvg: r.avgRfH  ?? 0,
    ediAvg:  r.avgEdiH ?? 0,
    count:   r.count,
  })).filter(r => r.rfidAvg > 0 || r.ediAvg > 0);

  // Coverage summary counts
  const hasOriginBoth = rows.filter(r => (r.rf_origin_country ?? r.rf_departure_country) && r.edi_origin_impc).length;
  const hasDestBoth   = rows.filter(r => (r.rf_dest_country   ?? r.rf_arrival_country)   && r.edi_dest_impc).length;
  const hasFullBoth   = rows.filter(r => (r.rf_origin_country ?? r.rf_departure_country) && (r.rf_dest_country ?? r.rf_arrival_country) && r.edi_origin_impc && r.edi_dest_impc).length;

  const bgPct = backgroundProgress && backgroundProgress.total > 0
    ? Math.round(backgroundProgress.loaded / backgroundProgress.total * 100) : null;

  return (
    <div className="space-y-2">

      {/* Background RFID loading banner */}
      {backgroundLoading && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
          <div className="w-4 h-4 rounded-full flex-shrink-0 animate-spin" style={{ border: '2px solid #fde68a', borderTopColor: '#f59e0b' }} />
          <div className="flex-1 min-w-0">
            <span className="text-amber-700 font-medium">Loading historical RFID data…</span>
            {backgroundProgress && (
              <span className="text-amber-600 ml-2">
                {backgroundProgress.loaded.toLocaleString()} / {backgroundProgress.total.toLocaleString()} events
                {bgPct !== null && ` · ${bgPct}%`}
              </span>
            )}
            {backgroundProgress && backgroundProgress.total > 0 && (
              <div className="mt-1 w-full bg-amber-100 rounded-full h-1">
                <div className="h-1 rounded-full transition-all" style={{ width: `${bgPct ?? 0}%`, background: '#f59e0b' }} />
              </div>
            )}
          </div>
          <span className="text-amber-500 text-xs flex-shrink-0">Benchmark updates as data loads</span>
        </div>
      )}

      {/* ── 0. Coverage summary ── */}
      <Section
        title="Benchmark Coverage"
        subtitle={`Receptacles linked between RFID and EDI via ID Relation — ${stats.totalPairs} total`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
          <KPI label="Total linked" value={stats.totalPairs} sub="RFID ↔ EDI via s9id" color="indigo" />
          <KPI label="Origin comparison" value={hasOriginBoth} sub={`${pct(hasOriginBoth, stats.totalPairs)} have RFID+EDI origin`} color="green" />
          <KPI label="Dest comparison"   value={hasDestBoth}   sub={`${pct(hasDestBoth, stats.totalPairs)} have RFID+EDI dest`}   color="green" />
          <KPI label="Full transit"       value={hasFullBoth}   sub={`${pct(hasFullBoth, stats.totalPairs)} have both sides`}       color="amber" />
        </div>
        <p className="text-[11px] text-slate-500 italic">
          Only receptacles with a match in the ID Relation table (tag_id ↔ s9id) are included.
          Domestic movements (same origin and destination country) are excluded.
        </p>
      </Section>

      {/* ── 1. RFID Outbound vs EDI PREDES ── */}
      <Section
        title="RFID Outbound vs EDI PREDES"
        subtitle={`Departure preparation: RFID Outbound (DEPARTURE event) vs EDI PREDES — ${stats.departurePairs} pairs with both events`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <KPI label="Pairs with both"        value={stats.hasRfPredes}    color="indigo" />
          <KPI label="Avg Δ Outbound"         value={fmtH(stats.avgDeltaPredesH)} sub="RFID Outbound minus EDI (+ = RFID later)" color={stats.avgDeltaPredesH !== null && stats.avgDeltaPredesH >= 0 ? 'green' : 'rose'} />
          <KPI label="EDI PREDES cover"       value={pct(stats.hasEdiPredes, stats.totalPairs)} sub={`${stats.hasEdiPredes} / ${stats.totalPairs}`} color="slate" />
          <KPI label="RFID Outbound cover"    value={pct(stats.hasRfPredes, stats.totalPairs)}  sub={`${stats.hasRfPredes} / ${stats.totalPairs}`} color="green" />
        </div>

        <p className="text-[11px] text-slate-500 mb-2 italic">
          Δ = RFID Outbound minus EDI PREDES (hours). Negative = RFID reads <strong>before</strong> EDI declares; positive = RFID reads <strong>after</strong>.
          Colour: green = positive · red = negative.
        </p>
        <CentreTable data={stats.byOriginCentre} label="Δ" />
      </Section>

      {/* ── 2. RFID Inbound vs EDI RESDES ── */}
      <Section
        title="RFID Inbound vs EDI RESDES"
        subtitle={`Delivery confirmation: RFID Inbound (ARRIVAL event) vs EDI RESDES — ${stats.arrivalPairs} pairs with both events`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <KPI label="Pairs with both"       value={stats.hasRfResdes}    color="indigo" />
          <KPI label="Avg Δ Inbound"         value={fmtH(stats.avgDeltaResdesH)} sub="RFID Inbound minus EDI (+ = RFID later)" color={stats.avgDeltaResdesH !== null && stats.avgDeltaResdesH >= 0 ? 'green' : 'rose'} />
          <KPI label="EDI RESDES cover"      value={pct(stats.hasEdiResdes, stats.totalPairs)} sub={`${stats.hasEdiResdes} / ${stats.totalPairs}`} color="slate" />
          <KPI label="RFID Inbound cover"    value={pct(stats.hasRfResdes, stats.totalPairs)}  sub={`${stats.hasRfResdes} / ${stats.totalPairs}`} color="green" />
        </div>

        <p className="text-[11px] text-slate-500 mb-2 italic">
          Δ = RFID Inbound minus EDI RESDES (hours). Negative = RFID reads <strong>before</strong> EDI declares; positive = RFID reads <strong>after</strong>.
          Colour: green = positive · red = negative.
        </p>
        <CentreTable data={stats.byDestCentre} label="Δ" />
      </Section>

      {/* ── 4. Transit time comparison ── */}
      <Section
        title="Transit Time: RFID vs EDI"
        subtitle={`RFID Outbound → RFID Inbound vs EDI PREDES → RESDES — ${stats.transitPairs} international pairs`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <KPI label="Transit pairs"     value={stats.transitPairs}    color="indigo" />
          <KPI label="Avg RFID transit"  value={fmtHAbs(stats.avgRfTransitH)}  color="indigo" />
          <KPI label="Avg EDI transit"   value={fmtHAbs(stats.avgEdiTransitH)} color="slate" />
          <KPI label="Median RFID"       value={fmtHAbs(stats.medRfTransitH)}  color="indigo" />
        </div>

        {routeChartData.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3">
            <p className="text-xs font-semibold text-slate-600 mb-3">Average transit time by route — RFID physical vs EDI declared</p>
            <ResponsiveContainer width="100%" height={Math.max(220, routeChartData.length * 32)}>
              <BarChart data={routeChartData} layout="vertical" margin={{ left: 10, right: 60, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                <YAxis type="category" dataKey="route" tick={{ fontSize: 10 }} width={140} />
                <Tooltip formatter={(v: number) => [`${v.toFixed(1)}h (${(v / 24).toFixed(1)}d)`, '']} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="rfidAvg" name="RFID (Outbound→Inbound)" fill={C.rfid} radius={[0, 3, 3, 0]} barSize={11} />
                <Bar dataKey="ediAvg"  name="EDI (PREDES→RESDES)"  fill={C.edi}  radius={[0, 3, 3, 0]} barSize={11} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {(stats.rfTransitCdf.length > 0 || stats.ediTransitCdf.length > 0) && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-600 mb-3">Cumulative distribution — transit times</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart margin={{ left: 10, right: 20, top: 5, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="x" type="number" allowDuplicatedCategory={false} tick={{ fontSize: 10 }}
                  tickFormatter={v => `${v}h`}
                  label={{ value: 'Transit time (h)', position: 'insideBottom', offset: -10, style: { fontSize: 10, fill: '#94a3b8' } }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]}
                  label={{ value: 'Cumulative %', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                <ReferenceLine y={50} strokeDasharray="4 2" strokeOpacity={0.4} stroke="#94a3b8"
                  label={{ value: 'P50', position: 'right', style: { fontSize: 9, fill: '#94a3b8' } }} />
                <Tooltip formatter={(v: any, name: string) => [`${v}%`, name]} labelFormatter={l => `≤ ${l}h`} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Line data={stats.rfTransitCdf}  type="monotone" dataKey="pct" name="RFID (Outbound→Inbound)" stroke={C.rfid} strokeWidth={2} dot={false} />
                <Line data={stats.ediTransitCdf} type="monotone" dataKey="pct" name="EDI"  stroke={C.edi}  strokeWidth={2} dot={false} strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* ── 5. EDI Chain completeness (gap analysis) ── */}
      <Section
        title="EDI Chain Completeness"
        subtitle={`Events received per receptacle across the full chain: PREDES → RFID Outbound → RESDIT74 → RESDIT21 → RFID Inbound → RESDES — ${stats.totalPairs} total pairs`}
      >
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <p className="text-[11px] text-slate-400 mb-3 italic">
            RFID has no equivalent for RESDIT74 or RESDIT21. Where these are missing, RFID readings provide the only physical evidence of the receptacle's location.
          </p>
          <ChainBar label="PREDES"        present={stats.hasEdiPredes}   total={stats.totalPairs} />
          <ChainBar label="RFID Outbound" present={stats.hasRfPredes}    total={stats.totalPairs} rfid />
          <ChainBar label="RESDIT74"      present={stats.hasEdiResdit74} total={stats.totalPairs} />
          <ChainBar label="RESDIT21"      present={stats.hasEdiResdit21} total={stats.totalPairs} />
          <ChainBar label="RFID Inbound"  present={stats.hasRfResdes}    total={stats.totalPairs} rfid />
          <ChainBar label="RESDES"        present={stats.hasEdiResdes}   total={stats.totalPairs} />
        </div>

        {/* Gap by route */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-semibold text-slate-600">Missing EDI events by route — % of receptacles lacking each event</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Route</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">Pairs</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">DEP</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">ARR</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">Transit</th>
                  <th className="px-3 py-2 text-center font-semibold text-amber-600">Missing RESDIT74</th>
                  <th className="px-3 py-2 text-center font-semibold text-amber-600">Missing RESDIT21</th>
                  <th className="px-3 py-2 text-center font-semibold text-rose-600">Missing RESDES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.byRoute.map(r => (
                  <tr key={r.route} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-semibold text-slate-700">{r.route}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{r.count}</td>
                    <td className="px-3 py-2 text-center text-indigo-600 font-semibold">{r.depCount}</td>
                    <td className="px-3 py-2 text-center text-indigo-600 font-semibold">{r.arrCount}</td>
                    <td className="px-3 py-2 text-center text-indigo-600 font-semibold">{r.transitCount}</td>
                    <td className="px-3 py-2 text-center"><GapBadge pct={r.missingResdit74Pct} /></td>
                    <td className="px-3 py-2 text-center"><GapBadge pct={r.missingResdit21Pct} /></td>
                    <td className="px-3 py-2 text-center"><GapBadge pct={r.missingResdesPct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* ── 6. Detail table ── */}
      <Section title="Detail Records">
        <div className="flex gap-2 mb-3">
          {(['departure', 'arrival', 'transit'] as DetailView[]).map(v => (
            <button key={v} onClick={() => setDetailView(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                detailView === v
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
              }`}>
              {v === 'departure' ? `Departure (${stats.departurePairs})`
               : v === 'arrival' ? `Arrival (${stats.arrivalPairs})`
               : `Transit (${stats.transitPairs})`}
            </button>
          ))}
        </div>
        <DetailTable rows={rows} view={detailView} />
      </Section>

    </div>
  );
}
