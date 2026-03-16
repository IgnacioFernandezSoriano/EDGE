/**
 * BenchmarkPanel — RFID vs EDI Benchmark Report
 *
 * Three direct comparisons:
 *   1. RF-PREDES vs PREDES  (origin departure preparation)
 *   2. RF-RESDES vs RESDES  (destination delivery)
 *   3. Transit RFID (DEP→ARR) vs Transit EDI (PREDES→RESDES)
 *
 * Plus EDI chain completeness (PREDES→CARDIT→RESDIT74→RESDIT21→RESDES)
 * shown as gap analysis — no RFID equivalent for intermediate events.
 */

import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ScatterChart, Scatter,
  LineChart, Line, LabelList,
} from 'recharts';
import { useBenchmarkData, BenchmarkRow, RouteStats } from '@/hooks/useBenchmarkData';

/* ── Palette ────────────────────────────────────────────────────────────────── */
const C = {
  rfid:   '#4F46E5', // indigo  — RFID
  edi:    '#64748b', // slate   — EDI
  ok:     '#22c55e', // green
  warn:   '#f59e0b', // amber
  danger: '#ef4444', // red
  bg:     '#f8fafc',
};

/* ── Small helpers ──────────────────────────────────────────────────────────── */
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
  const abs  = Math.abs(h);
  return `${sign}${abs.toFixed(1)}h`;
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
  if (Math.abs(h) <= 2) return 'text-emerald-600';
  if (Math.abs(h) <= 12) return 'text-amber-600';
  return 'text-rose-600';
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
function ChainBar({ label, present, total }: { label: string; present: number; total: number }) {
  const p = total ? Math.round((present / total) * 100) : 0;
  const barColor = p >= 90 ? 'bg-emerald-500' : p >= 60 ? 'bg-amber-400' : 'bg-rose-400';
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-24 text-xs font-mono font-semibold text-slate-600 shrink-0">{label}</div>
      <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${p}%` }} />
      </div>
      <div className="w-20 text-right text-xs text-slate-500">{present.toLocaleString()} / {total.toLocaleString()}</div>
      <div className={`w-10 text-right text-xs font-semibold ${p >= 90 ? 'text-emerald-600' : p >= 60 ? 'text-amber-600' : 'text-rose-600'}`}>{p}%</div>
    </div>
  );
}

/* ── Detail table ───────────────────────────────────────────────────────────── */
type DetailView = 'departure' | 'arrival' | 'transit';

function DetailTable({ rows, view }: { rows: BenchmarkRow[]; view: DetailView }) {
  const [page, setPage] = useState(0);
  const PAGE = 20;

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
                  <th className="px-3 py-2 text-left font-semibold text-indigo-600">RF-PREDES</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">Δ PREDES</th>
                </>
              )}
              {view !== 'departure' && (
                <>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">EDI RESDES</th>
                  <th className="px-3 py-2 text-left font-semibold text-indigo-600">RF-RESDES</th>
                  <th className="px-3 py-2 text-center font-semibold text-slate-600">Δ RESDES</th>
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
              const route = `${r.edi_origin_impc ?? r.rf_origin_impc ?? '?'} → ${r.edi_dest_impc ?? r.rf_dest_impc ?? '?'}`;
              const missing = [
                !r.edi_cardit_time   ? 'CARDIT'   : null,
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
                      <td className="px-3 py-2 text-indigo-600 whitespace-nowrap">{fmt(r.rf_predes_time)}</td>
                      <td className={`px-3 py-2 text-center font-semibold whitespace-nowrap ${deltaColor(r.delta_predes_hours)}`}>{fmtH(r.delta_predes_hours)}</td>
                    </>
                  )}
                  {view !== 'departure' && (
                    <>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmt(r.edi_resdes_time)}</td>
                      <td className="px-3 py-2 text-indigo-600 whitespace-nowrap">{fmt(r.rf_resdes_time)}</td>
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
      {pages > 1 && (
        <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
          <span>{total.toLocaleString()} records</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">‹</button>
            <span className="px-2 py-1">{page + 1} / {pages}</span>
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">›</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────────────── */
export function BenchmarkPanel() {
  const { rows, stats, loading, error } = useBenchmarkData();
  const [detailView, setDetailView] = useState<DetailView>('departure');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 rounded-full mx-auto animate-spin" style={{ border: '3px solid #e2e8f0', borderTopColor: C.rfid }} />
          <p className="text-sm text-slate-500">Loading benchmark data…</p>
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
    route: r.route,
    rfidAvg:  r.avgRfH  ?? 0,
    ediAvg:   r.avgEdiH ?? 0,
    count:    r.count,
  })).filter(r => r.rfidAvg > 0 || r.ediAvg > 0);

  /* ── Delta PREDES scatter ── */
  const deltaPredesData = rows
    .filter(r => r.has_rf_departure && r.delta_predes_hours !== null)
    .map(r => ({
      x: new Date(r.edi_predes_time!).getTime(),
      y: r.delta_predes_hours!,
      s9id: r.s9id,
    }))
    .slice(0, 500);

  /* ── Delta RESDES scatter ── */
  const deltaResdesData = rows
    .filter(r => r.has_rf_arrival && r.delta_resdes_hours !== null)
    .map(r => ({
      x: new Date(r.edi_resdes_time!).getTime(),
      y: r.delta_resdes_hours!,
      s9id: r.s9id,
    }))
    .slice(0, 500);

  return (
    <div className="space-y-2">

      {/* ── 1. Coverage KPIs ── */}
      <Section title="Coverage Overview" subtitle={`${stats.totalPairs.toLocaleString()} receptacles with RFID ↔ EDI pair via ID Relation`}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          <KPI label="Total Pairs"       value={stats.totalPairs}     color="slate" />
          <KPI label="Departure Pairs"   value={stats.departurePairs} sub="RFID DEP + EDI" color="indigo" />
          <KPI label="Arrival Pairs"     value={stats.arrivalPairs}   sub="RFID ARR + EDI" color="indigo" />
          <KPI label="Transit Pairs"     value={stats.transitPairs}   sub="DEP+ARR + PREDES+RESDES" color="indigo" />
          <KPI label="RF-PREDES cover"   value={pct(stats.hasRfPredes, stats.totalPairs)}  sub={`${stats.hasRfPredes} receptacles`} color="green" />
          <KPI label="RF-RESDES cover"   value={pct(stats.hasRfResdes, stats.totalPairs)}  sub={`${stats.hasRfResdes} receptacles`} color="green" />
        </div>
      </Section>

      {/* ── 2. RF-PREDES vs EDI PREDES ── */}
      <Section
        title="RF-PREDES vs EDI PREDES"
        subtitle={`Departure preparation: first RFID reading (ORIGIN) vs EDI PREDES timestamp — ${stats.departurePairs} pairs`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <KPI label="Departure pairs"    value={stats.departurePairs} color="indigo" />
          <KPI label="Avg Δ PREDES"       value={fmtH(stats.avgDeltaPredesH)} sub="RF minus EDI (+ = RFID later)" color={stats.avgDeltaPredesH !== null && Math.abs(stats.avgDeltaPredesH) <= 4 ? 'green' : 'amber'} />
          <KPI label="EDI PREDES cover"   value={pct(stats.hasEdiPredes, stats.totalPairs)} sub={`${stats.hasEdiPredes} / ${stats.totalPairs}`} color="slate" />
          <KPI label="RF-PREDES cover"    value={pct(stats.hasRfPredes, stats.totalPairs)}  sub={`${stats.hasRfPredes} / ${stats.totalPairs}`} color="green" />
        </div>

        {deltaPredesData.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3">
            <p className="text-xs font-semibold text-slate-600 mb-3">
              Δ PREDES over time — RF-PREDES minus EDI PREDES (hours). Positive = RFID reads later than EDI declares.
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="x" type="number" domain={['auto', 'auto']} tick={false}
                  label={{ value: 'Time →', position: 'insideBottom', offset: -2, style: { fontSize: 10, fill: '#94a3b8' } }} />
                <YAxis dataKey="y" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`}
                  label={{ value: 'Δ (h)', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 2" />
                <Tooltip formatter={(v: any) => [`${v}h`, 'Δ PREDES']} labelFormatter={() => ''} />
                <Scatter data={deltaPredesData} fill={C.rfid} opacity={0.5} r={3} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* ── 3. RF-RESDES vs EDI RESDES ── */}
      <Section
        title="RF-RESDES vs EDI RESDES"
        subtitle={`Delivery confirmation: last RFID reading (DESTINATION) vs EDI RESDES timestamp — ${stats.arrivalPairs} pairs`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <KPI label="Arrival pairs"     value={stats.arrivalPairs}   color="indigo" />
          <KPI label="Avg Δ RESDES"      value={fmtH(stats.avgDeltaResdesH)} sub="RF minus EDI (+ = RFID later)" color={stats.avgDeltaResdesH !== null && Math.abs(stats.avgDeltaResdesH) <= 4 ? 'green' : 'amber'} />
          <KPI label="EDI RESDES cover"  value={pct(stats.hasEdiResdes, stats.totalPairs)} sub={`${stats.hasEdiResdes} / ${stats.totalPairs}`} color="slate" />
          <KPI label="RF-RESDES cover"   value={pct(stats.hasRfResdes, stats.totalPairs)}  sub={`${stats.hasRfResdes} / ${stats.totalPairs}`} color="green" />
        </div>

        {deltaResdesData.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3">
            <p className="text-xs font-semibold text-slate-600 mb-3">
              Δ RESDES over time — RF-RESDES minus EDI RESDES (hours). Positive = RFID reads later than EDI declares.
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="x" type="number" domain={['auto', 'auto']} tick={false}
                  label={{ value: 'Time →', position: 'insideBottom', offset: -2, style: { fontSize: 10, fill: '#94a3b8' } }} />
                <YAxis dataKey="y" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`}
                  label={{ value: 'Δ (h)', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 2" />
                <Tooltip formatter={(v: any) => [`${v}h`, 'Δ RESDES']} labelFormatter={() => ''} />
                <Scatter data={deltaResdesData} fill="#10b981" opacity={0.5} r={3} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* ── 4. Transit time comparison ── */}
      <Section
        title="Transit Time: RFID vs EDI"
        subtitle={`RFID: DEPARTURE → ARRIVAL · EDI: PREDES → RESDES — ${stats.transitPairs} pairs with full origin+destination match`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <KPI label="Transit pairs"      value={stats.transitPairs}    color="indigo" />
          <KPI label="Avg RFID transit"   value={fmtHAbs(stats.avgRfTransitH)}  color="indigo" />
          <KPI label="Avg EDI transit"    value={fmtHAbs(stats.avgEdiTransitH)} color="slate" />
          <KPI label="Median RFID"        value={fmtHAbs(stats.medRfTransitH)}  color="indigo" />
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
                <Bar dataKey="rfidAvg" name="RFID (DEP→ARR)" fill={C.rfid} radius={[0, 3, 3, 0]} barSize={11}>
                  <LabelList dataKey="rfidAvg" position="right" formatter={(v: number) => `${v.toFixed(0)}h`} style={{ fontSize: 9, fill: C.rfid }} />
                </Bar>
                <Bar dataKey="ediAvg"  name="EDI (PREDES→RESDES)" fill={C.edi} radius={[0, 3, 3, 0]} barSize={11}>
                  <LabelList dataKey="ediAvg"  position="right" formatter={(v: number) => `${v.toFixed(0)}h`} style={{ fontSize: 9, fill: C.edi }} />
                </Bar>
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
                <Line data={stats.rfTransitCdf}  type="monotone" dataKey="pct" name="RFID" stroke={C.rfid} strokeWidth={2} dot={false} />
                <Line data={stats.ediTransitCdf} type="monotone" dataKey="pct" name="EDI"  stroke={C.edi}  strokeWidth={2} dot={false} strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* ── 5. EDI Chain completeness (gap analysis) ── */}
      <Section
        title="EDI Chain Completeness"
        subtitle={`Events received per receptacle across the full EDI chain: PREDES → CARDIT → RESDIT74 → RESDIT21 → RESDES — ${stats.totalPairs} total pairs`}
      >
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <p className="text-[11px] text-slate-400 mb-3 italic">
            RFID has no equivalent for CARDIT, RESDIT74 or RESDIT21. Where these are missing, RFID readings provide the only physical evidence of the receptacle's location.
          </p>
          <ChainBar label="PREDES"   present={stats.hasEdiPredes}   total={stats.totalPairs} />
          <ChainBar label="CARDIT"   present={stats.hasEdiCardit}   total={stats.totalPairs} />
          <ChainBar label="RESDIT74" present={stats.hasEdiResdit74} total={stats.totalPairs} />
          <ChainBar label="RESDIT21" present={stats.hasEdiResdit21} total={stats.totalPairs} />
          <ChainBar label="RESDES"   present={stats.hasEdiResdes}   total={stats.totalPairs} />
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
                  <th className="px-3 py-2 text-center font-semibold text-amber-600">Missing CARDIT</th>
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
                    <td className="px-3 py-2 text-center"><GapBadge pct={r.missingCarditPct} /></td>
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
