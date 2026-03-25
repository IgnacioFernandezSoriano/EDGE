/**
 * RouteDetailPage — Standalone page for route-level transit analysis.
 *
 * Opened in a new browser tab by the "Analyse" button in the RFID Transit by Route table.
 * Data is passed via localStorage under the key "route_detail_payload".
 *
 * Contents:
 *  1. Route title + summary stats
 *  2. Histogram of transit hours (bar chart) with cumulative frequency line (red)
 *  3. Outlier table — receptacles outside IQR fence with s9id, tag_id and investigation data
 */

import { useEffect, useState, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import type { RfidJourney } from '@/hooks/useEpcisData';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface RouteDetailPayload {
  route: string;
  origin: string;
  dest: string;
  avgH: number | null;
  p50H: number | null;
  p25H: number | null;
  p75H: number | null;
  count: number;
  journeys: RfidJourney[];
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function percentile(arr: number[], p: number): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mean(arr: number[]): number | null {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function fmt(h: number | null): string {
  if (h === null) return '—';
  if (h < 24) return `${Math.round(h * 10) / 10}h`;
  return `${Math.round(h / 24 * 10) / 10}d (${Math.round(h * 10) / 10}h)`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

/* ─── Histogram builder ──────────────────────────────────────────────────── */
function buildHistogram(hours: number[], binSizeH: number) {
  if (!hours.length) return [];
  const max = Math.max(...hours);
  const bins: { label: string; from: number; to: number; count: number; cumPct: number }[] = [];
  for (let start = 0; start <= max; start += binSizeH) {
    const end = start + binSizeH;
    const count = hours.filter(h => h >= start && h < end).length;
    bins.push({ label: `${start}–${end}h`, from: start, to: end, count, cumPct: 0 });
  }
  // Compute cumulative %
  let cum = 0;
  for (const b of bins) {
    cum += b.count;
    b.cumPct = Math.round((cum / hours.length) * 1000) / 10; // one decimal
  }
  return bins;
}

/* ─── Custom tooltip ─────────────────────────────────────────────────────── */
function HistoTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5 mb-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.fill }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-medium text-slate-800 ml-auto pl-2">
            {p.name === 'Cumulative %' ? `${p.value}%` : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export default function RouteDetailPage() {
  const [payload, setPayload] = useState<RouteDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('route_detail_payload');
      if (!raw) { setError('No route data found. Please open this page from the Transit by Route table.'); return; }
      const data = JSON.parse(raw) as RouteDetailPayload;
      setPayload(data);
      document.title = `Route Analysis: ${data.route}`;
    } catch (e) {
      setError('Failed to parse route data.');
    }
  }, []);

  /* ── Derived stats ── */
  const { hours, p25, p75, iqrFence, outliers, histData, binSize } = useMemo(() => {
    if (!payload) return { hours: [], p25: null, p75: null, iqrFence: null, outliers: [], histData: [], binSize: 6 };

    const hrs = payload.journeys
      .map(j => j.international_transit_hours)
      .filter((h): h is number => h !== null && h > 0);

    const q1 = percentile(hrs, 25) ?? 0;
    const q3 = percentile(hrs, 75) ?? 0;
    const iqr = q3 - q1;
    // Standard Tukey fence: 1.5 × IQR
    const lowerFence = Math.max(0, q1 - 1.5 * iqr);
    const upperFence = q3 + 1.5 * iqr;

    const outlierJourneys = payload.journeys.filter(j => {
      const h = j.international_transit_hours;
      return h !== null && h > 0 && (h < lowerFence || h > upperFence);
    }).sort((a, b) => (b.international_transit_hours ?? 0) - (a.international_transit_hours ?? 0));

    // Auto bin size: ~20 bins across the range
    const maxH = hrs.length ? Math.max(...hrs) : 100;
    const rawBin = maxH / 20;
    const niceBins = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 96, 120, 168];
    const bs = niceBins.find(b => b >= rawBin) ?? 24;

    return {
      hours: hrs,
      p25: q1,
      p75: q3,
      iqrFence: upperFence,
      outliers: outlierJourneys,
      histData: buildHistogram(hrs, bs),
      binSize: bs,
    };
  }, [payload]);

  /* ── Loading / error states ── */
  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white rounded-xl border border-red-200 p-8 max-w-md text-center shadow">
          <p className="text-red-600 font-semibold mb-2">Unable to load route data</p>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <svg className="animate-spin w-8 h-8 text-indigo-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  const avgH = mean(hours);
  const p50H = percentile(hours, 50);

  /* ── IQR fence label for reference line ── */
  const fenceLabel = iqrFence !== null ? `Outlier fence (${Math.round(iqrFence * 10) / 10}h)` : '';

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* ── Header ── */}
      <header className="bg-white border-b border-slate-200 px-8 py-5 shadow-sm">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-400 mb-1">RFID Transit Analysis</p>
          <h1 className="text-2xl font-bold text-slate-900">{payload.route}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {payload.count.toLocaleString()} receptacles · {hours.length.toLocaleString()} with transit time data
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-8 space-y-8">

        {/* ── Summary KPI strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'N (transit pairs)', value: payload.count.toLocaleString(), color: 'text-slate-800' },
            { label: 'Avg transit', value: fmt(avgH), color: 'text-indigo-600' },
            { label: 'Median (P50)', value: fmt(p50H), color: 'text-emerald-600' },
            { label: 'IQR (P25–P75)', value: `${fmt(p25)} – ${fmt(p75)}`, color: 'text-slate-700' },
          ].map(k => (
            <div key={k.label} className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-1">{k.label}</p>
              <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* ── Histogram ── */}
        <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-slate-800">Transit Time Distribution</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Frequency histogram (bars, {binSize}h bins) with cumulative percentage line (red).
              Dashed red line marks the Tukey upper fence (Q3 + 1.5 × IQR) — receptacles to the right are potential outliers.
            </p>
          </div>
          {histData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={histData} margin={{ top: 10, right: 50, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                  height={60}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  label={{ value: 'Count', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 10, fill: '#94a3b8' } }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 100]}
                  tickFormatter={v => `${v}%`}
                  tick={{ fontSize: 10, fill: '#ef4444' }}
                  label={{ value: 'Cumulative %', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 10, fill: '#ef4444' } }}
                />
                <Tooltip content={<HistoTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  formatter={(value) => <span className="text-slate-600">{value}</span>}
                />
                <Bar
                  yAxisId="left"
                  dataKey="count"
                  name="Receptacles"
                  fill="#6366f1"
                  fillOpacity={0.8}
                  radius={[2, 2, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cumPct"
                  name="Cumulative %"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={false}
                />
                {/* Outlier fence reference line */}
                {iqrFence !== null && (() => {
                  // Find the bin index that contains the fence value
                  const fenceBin = histData.find(b => b.from <= iqrFence && b.to > iqrFence);
                  return fenceBin ? (
                    <ReferenceLine
                      yAxisId="left"
                      x={fenceBin.label}
                      stroke="#ef4444"
                      strokeDasharray="6 3"
                      strokeWidth={1.5}
                      label={{ value: fenceLabel, position: 'top', fontSize: 10, fill: '#ef4444' }}
                    />
                  ) : null;
                })()}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-slate-400 py-8 text-center">No transit time data available for this route.</p>
          )}
        </div>

        {/* ── Outlier table ── */}
        <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Potential Outliers</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Receptacles outside the Tukey fence (transit &lt; {Math.round((p25 ?? 0 - 1.5 * ((p75 ?? 0) - (p25 ?? 0))) * 10) / 10}h
                or &gt; {Math.round((iqrFence ?? 0) * 10) / 10}h).
                Sorted by transit time descending.
              </p>
            </div>
            <span className="flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
              {outliers.length} outlier{outliers.length !== 1 ? 's' : ''}
            </span>
          </div>

          {outliers.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-700">
              No outliers detected — all receptacles fall within the expected transit range.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">S9id</th>
                    <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">Tag ID</th>
                    <th className="text-right py-2.5 px-3 text-slate-500 font-semibold">Transit (h)</th>
                    <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">Departure centre</th>
                    <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">Departure time</th>
                    <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">Arrival centre</th>
                    <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">Arrival time</th>
                    <th className="text-right py-2.5 px-3 text-slate-500 font-semibold">Origin readings</th>
                    <th className="text-right py-2.5 px-3 text-slate-500 font-semibold">Dest readings</th>
                  </tr>
                </thead>
                <tbody>
                  {outliers.map((j, i) => {
                    const h = j.international_transit_hours ?? 0;
                    const isHigh = iqrFence !== null && h > iqrFence;
                    return (
                      <tr
                        key={i}
                        className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${isHigh ? 'bg-red-50/40' : 'bg-amber-50/40'}`}
                      >
                        <td className="py-2 px-3 font-mono text-slate-700 font-medium">{j.s9id || '—'}</td>
                        <td className="py-2 px-3 font-mono text-slate-600">{j.tag_id}</td>
                        <td className="py-2 px-3 text-right">
                          <span className={`font-bold ${isHigh ? 'text-red-600' : 'text-amber-600'}`}>
                            {Math.round(h * 10) / 10}h
                          </span>
                          <span className="text-slate-400 ml-1">({Math.round(h / 24 * 10) / 10}d)</span>
                        </td>
                        <td className="py-2 px-3 text-slate-600">{j.departure_centre || j.origin_centre || '—'}</td>
                        <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{fmtDate(j.departure_time || j.origin_time)}</td>
                        <td className="py-2 px-3 text-slate-600">{j.arrival_centre || j.dest_centre || '—'}</td>
                        <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{fmtDate(j.arrival_time || j.dest_time)}</td>
                        <td className="py-2 px-3 text-right text-slate-500">{j.origin_readings}</td>
                        <td className="py-2 px-3 text-right text-slate-500">{j.dest_readings}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <p className="text-center text-xs text-slate-400 pb-4">
          EDGE · Route analysis generated {new Date().toLocaleString('en-GB')} · Outlier method: Tukey fence (Q3 + 1.5 × IQR)
        </p>
      </main>
    </div>
  );
}
