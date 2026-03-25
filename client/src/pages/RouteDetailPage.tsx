/**
 * RouteDetailPage — Standalone route-level transit analysis page.
 *
 * Opened in a new browser tab via the "Analyse" button in the RFID Transit by Route table.
 * Data is passed via localStorage under the key "route_detail_payload".
 *
 * Features:
 *  1. Sticky header with route title + live-updated KPI strip
 *  2. Histogram of transit hours (bars) with cumulative % line (red) + Tukey fence reference
 *  3. Outlier table with:
 *     - Checkbox to exclude individual records from the calculation (recalculates live)
 *     - "Track" button that opens /tag-track in a new tab with SearchID data for that tag
 */

import { useEffect, useState, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import type { RfidJourney } from '@/hooks/useEpcisData';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface RfidReadingRaw {
  tag_id: string | null;
  s9id: string | null;
  event_type: string | null;
  location: string | null;
  impc_code: string | null;
  event_time_local: string | null;
  record_time: string | null;
  country: string | null;
  center_name: string | null;
  read_point_id: string | null;
  status: string | null;
}

interface ReaderMasterRaw {
  read_point_id: string;
  impc_code: string | null;
  country: string | null;
  center_name: string | null;
  td_reader: boolean | null;
}

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
  // Pre-loaded readings + reader master for instant Track lookup
  allReadings?: RfidReadingRaw[];
  readerMap?: [string, ReaderMasterRaw][];
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

function r1(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10;
}

function fmt(h: number | null): string {
  if (h === null) return '—';
  const rounded = Math.round(h * 10) / 10;
  if (rounded < 24) return `${rounded}h`;
  return `${Math.round(rounded / 24 * 10) / 10}d (${rounded}h)`;
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
  let cum = 0;
  for (const b of bins) {
    cum += b.count;
    b.cumPct = Math.round((cum / hours.length) * 1000) / 10;
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
  // Set of tag_ids excluded from calculation
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem('route_detail_payload');
      if (!raw) {
        setError('No route data found. Please open this page from the Transit by Route table.');
        return;
      }
      const data = JSON.parse(raw) as RouteDetailPayload;
      setPayload(data);
      document.title = `Route Analysis: ${data.route}`;
    } catch {
      setError('Failed to parse route data.');
    }
  }, []);

  /* ── Toggle exclusion ── */
  const toggleExclude = (tag_id: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(tag_id)) next.delete(tag_id);
      else next.add(tag_id);
      return next;
    });
  };

  /* ── Derived stats (recalculated when exclusions change) ── */
  const { hours, p25, p75, iqrFence, lowerFence, outliers, histData, binSize, avgH, p50H } = useMemo(() => {
    if (!payload) {
      return { hours: [], p25: null, p75: null, iqrFence: null, lowerFence: null, outliers: [], histData: [], binSize: 6, avgH: null, p50H: null };
    }

    // Active journeys (not excluded)
    const active = payload.journeys.filter(j => !excluded.has(j.tag_id));

    const hrs = active
      .map(j => j.international_transit_hours)
      .filter((h): h is number => h !== null && h > 0);

    const q1 = percentile(hrs, 25) ?? 0;
    const q3 = percentile(hrs, 75) ?? 0;
    const iqr = q3 - q1;
    const lf = Math.max(0, q1 - 1.5 * iqr);
    const uf = q3 + 1.5 * iqr;

    // Outliers from the FULL payload (not filtered by excluded), so user can still see and re-include them
    const allHrs = payload.journeys
      .map(j => j.international_transit_hours)
      .filter((h): h is number => h !== null && h > 0);
    const allQ1 = percentile(allHrs, 25) ?? 0;
    const allQ3 = percentile(allHrs, 75) ?? 0;
    const allIqr = allQ3 - allQ1;
    const allUf = allQ3 + 1.5 * allIqr;
    const allLf = Math.max(0, allQ1 - 1.5 * allIqr);

    const outlierJourneys = payload.journeys.filter(j => {
      const h = j.international_transit_hours;
      return h !== null && h > 0 && (h < allLf || h > allUf);
    }).sort((a, b) => (b.international_transit_hours ?? 0) - (a.international_transit_hours ?? 0));

    // Auto bin size
    const maxH = hrs.length ? Math.max(...hrs) : 100;
    const rawBin = maxH / 20;
    const niceBins = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 96, 120, 168];
    const bs = niceBins.find(b => b >= rawBin) ?? 24;

    return {
      hours: hrs,
      p25: r1(q1),
      p75: r1(q3),
      iqrFence: r1(uf),
      lowerFence: r1(lf),
      outliers: outlierJourneys,
      histData: buildHistogram(hrs, bs),
      binSize: bs,
      avgH: r1(mean(hrs)),
      p50H: r1(percentile(hrs, 50)),
    };
  }, [payload, excluded]);

  /* ── Download CSV of non-excluded outliers ── */
  const downloadOutliersCSV = () => {
    const active = outliers.filter(j => !excluded.has(j.tag_id));
    if (!active.length) return;
    const headers = ['S9id', 'Tag ID', 'Transit (h)', 'Transit (d)', 'Departure centre', 'Departure time', 'Arrival centre', 'Arrival time'];
    const rows = active.map(j => {
      const h = j.international_transit_hours ?? 0;
      return [
        j.s9id || '',
        j.tag_id,
        (Math.round(h * 10) / 10).toString(),
        (Math.round(h / 24 * 10) / 10).toString(),
        j.departure_centre || j.origin_centre || '',
        j.departure_time || j.origin_time || '',
        j.arrival_centre || j.dest_centre || '',
        j.arrival_time || j.dest_time || '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`);
    });
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `outliers_${payload?.route?.replace(/[^a-z0-9]/gi, '_') ?? 'route'}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ── Open tag tracker in new tab ── */
  const openTracker = (j: RfidJourney) => {
    if (payload?.allReadings && payload?.readerMap) {
      // Filter only the readings for this specific tag — instant, no network call
      const tagReadings = payload.allReadings.filter(r =>
        (r.tag_id && r.tag_id === j.tag_id) ||
        (r.s9id   && r.s9id   === j.tag_id) ||
        (j.s9id && r.tag_id === j.s9id) ||
        (j.s9id && r.s9id   === j.s9id)
      );
      localStorage.setItem('tag_track_payload', JSON.stringify({
        tag_id: j.tag_id,
        s9id: j.s9id,
        readings: tagReadings,
        readerMap: payload.readerMap,
      }));
    } else {
      // Fallback: let TagTrackPage fetch from Supabase
      localStorage.setItem('tag_track_payload', JSON.stringify({
        tag_id: j.tag_id,
        s9id: j.s9id,
      }));
    }
    window.open('/tag-track', '_blank');
  };

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

  const activeCount = payload.journeys.filter(j => !excluded.has(j.tag_id)).length;
  const fenceLabel = iqrFence !== null ? `Fence: ${iqrFence}h` : '';

  return (
    <div className="min-h-screen bg-slate-50 font-sans">

      {/* ══════════════════════════════════════════════════════════════════════
          STICKY HEADER — fixed at top during scroll
      ══════════════════════════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-8 py-4">
          {/* Title row */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-0.5">RFID Transit Analysis</p>
              <h1 className="text-xl font-bold text-slate-900 leading-tight">{payload.route}</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {payload.count.toLocaleString()} receptacles · {hours.length.toLocaleString()} with transit time data
                {excluded.size > 0 && (
                  <span className="ml-2 text-amber-600 font-semibold">
                    · {excluded.size} excluded from calculation
                    <button
                      onClick={() => setExcluded(new Set())}
                      className="ml-1.5 underline hover:no-underline text-amber-700"
                    >
                      reset
                    </button>
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* KPI strip — live updated */}
          <div className="grid grid-cols-4 gap-3 mt-3">
            {[
              { label: 'N (active)', value: activeCount.toLocaleString(), color: 'text-slate-800' },
              { label: 'Avg transit', value: fmt(avgH), color: 'text-indigo-600' },
              { label: 'Median (P50)', value: fmt(p50H), color: 'text-emerald-600' },
              { label: 'IQR (P25–P75)', value: `${fmt(p25)} – ${fmt(p75)}`, color: 'text-slate-700' },
            ].map(k => (
              <div key={k.label} className="bg-slate-50 rounded-lg border border-slate-200 px-3 py-2">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{k.label}</p>
                <p className={`text-base font-bold ${k.color} leading-tight mt-0.5`}>{k.value}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════════
          MAIN CONTENT
      ══════════════════════════════════════════════════════════════════════ */}
      <main className="max-w-5xl mx-auto px-8 py-8 space-y-8">

        {/* ── Histogram ── */}
        <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-slate-800">Transit Time Distribution</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Frequency histogram ({binSize}h bins) with cumulative % line (red).
              Dashed red line = Tukey upper fence (Q3 + 1.5 × IQR = {iqrFence}h).
              {excluded.size > 0 && <span className="text-amber-600 font-medium"> Excludes {excluded.size} manually removed record{excluded.size !== 1 ? 's' : ''}.</span>}
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
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
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
                {iqrFence !== null && (() => {
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
                Receptacles outside the Tukey fence (&gt; {iqrFence}h or &lt; {lowerFence}h).
                Check the box to exclude a record from the calculation above.
                Use the <span className="font-semibold text-indigo-600">Track</span> button to investigate a specific tag.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {excluded.size > 0 && (
                <button
                  onClick={() => setExcluded(new Set())}
                  className="text-xs px-2.5 py-1 rounded-md border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-all"
                >
                  Reset all ({excluded.size})
                </button>
              )}
              {outliers.filter(j => !excluded.has(j.tag_id)).length > 0 && (
                <button
                  onClick={downloadOutliersCSV}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download CSV
                </button>
              )}
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                {outliers.length} outlier{outliers.length !== 1 ? 's' : ''}
              </span>
            </div>
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
                    <th className="py-2.5 px-3 text-slate-500 font-semibold w-8">
                      <span className="sr-only">Exclude</span>
                    </th>
                    <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">S9id</th>
                    <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">Tag ID</th>
                    <th className="text-right py-2.5 px-3 text-slate-500 font-semibold">Transit</th>
                    <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">Departure centre</th>
                    <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">Departure time</th>
                    <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">Arrival centre</th>
                    <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">Arrival time</th>
                    <th className="py-2.5 px-3 text-slate-500 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {outliers.map((j, i) => {
                    const h = j.international_transit_hours ?? 0;
                    const isExcluded = excluded.has(j.tag_id);
                    const isHigh = iqrFence !== null && h > iqrFence;
                    return (
                      <tr
                        key={i}
                        className={`border-b border-slate-50 transition-colors ${
                          isExcluded
                            ? 'opacity-40 bg-slate-50'
                            : isHigh
                              ? 'bg-red-50/40 hover:bg-red-50'
                              : 'bg-amber-50/40 hover:bg-amber-50'
                        }`}
                      >
                        {/* Exclude checkbox */}
                        <td className="py-2 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isExcluded}
                            onChange={() => toggleExclude(j.tag_id)}
                            title={isExcluded ? 'Re-include in calculation' : 'Exclude from calculation'}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 cursor-pointer accent-indigo-600"
                          />
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-700 font-medium">{j.s9id || '—'}</td>
                        <td className="py-2 px-3 font-mono text-slate-600">{j.tag_id}</td>
                        <td className="py-2 px-3 text-right">
                          <span className={`font-bold ${isHigh ? 'text-red-600' : 'text-amber-600'}`}>
                            {Math.round(h * 10) / 10}h
                          </span>
                          <span className="text-slate-400 ml-1 text-[10px]">({Math.round(h / 24 * 10) / 10}d)</span>
                        </td>
                        <td className="py-2 px-3 text-slate-600">{j.departure_centre || j.origin_centre || '—'}</td>
                        <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{fmtDate(j.departure_time || j.origin_time)}</td>
                        <td className="py-2 px-3 text-slate-600">{j.arrival_centre || j.dest_centre || '—'}</td>
                        <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{fmtDate(j.arrival_time || j.dest_time)}</td>
                        {/* Track button */}
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={() => openTracker(j)}
                            title="Open tag tracking in new tab"
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 transition-all shadow-sm whitespace-nowrap"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                            </svg>
                            Track
                          </button>
                        </td>
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
          EDGE · Route analysis · {new Date().toLocaleString('en-GB')} · Outlier method: Tukey fence (Q3 + 1.5 × IQR)
        </p>
      </main>
    </div>
  );
}
