/**
 * EDGE RFID-EDI Analysis Dashboard
 * Design: Operational Intelligence — clean white + slate + indigo accent
 * Font: DM Sans (body) + Inter (headings/numbers) + JetBrains Mono (data)
 * Data source: Supabase tracking_events table
 * Features: global date filter, CSV export, EDGE by GMS logo
 */

import { useState, useMemo, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ReferenceLine, LabelList,
  ScatterChart, Scatter, ZAxis,
  LineChart, Line, Area, AreaChart,
} from 'recharts';
import { useTrackingData } from '@/hooks/useTrackingData';
import { useEpcisData } from '@/hooks/useEpcisData';
import { fetchMatchedTagsCount } from '@/lib/supabase';
import { KpiCard } from '@/components/KpiCard';
import { DataTable } from '@/components/DataTable';
import { EpcisDataTable } from '@/components/EpcisDataTable';
import { GlobalFilters } from '@/components/GlobalFilters';
import { InfoTooltip } from '@/components/InfoTooltip';
import { OverviewAnalysis, DepartureAnalysis, ArrivalAnalysis, TransitAnalysis } from '@/components/AnalysisPanel';

const EDGE_LOGO = 'https://d2xsxph8kpxj0f.cloudfront.net/108732851/5NdCdX6TpQ4zqErLoimWrK/edge-logo_ae84570f.png';

/* ─── Color palette ─── */
const C = {
  indigo:  '#4F46E5',
  emerald: '#10B981',
  amber:   '#F59E0B',
  rose:    '#F43F5E',
  sky:     '#0EA5E9',
  slate:   '#64748B',
};

const COVERAGE_FILL: Record<string, string> = {
  FULL:        C.emerald,
  EDI_FULL:    C.slate,
  RFID_PREDES: C.sky,
  RFID_RESDES: C.indigo,
  RFID_ONLY:   C.amber,
  EDI_ONLY:    '#cbd5e1',
};

const COVERAGE_LABEL: Record<string, string> = {
  FULL:        'RFID + PREDES + RESDES',
  EDI_FULL:    'PREDES + RESDES (no RFID)',
  RFID_PREDES: 'RFID + PREDES only',
  RFID_RESDES: 'RFID + RESDES only',
  RFID_ONLY:   'RFID only (no EDI)',
  EDI_ONLY:    'EDI only (no RFID)',
};

const TABS = ['RFID', 'Departure', 'Arrival', 'Transit', 'Data'];

/* ─── Tooltip ─── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs max-w-[220px]">
      {label !== undefined && <p className="font-semibold text-slate-700 mb-1.5 truncate">{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5 mb-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.fill }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-medium text-slate-800 ml-auto pl-2">
            {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
            {(p.name?.toLowerCase().includes('hour') || p.name?.toLowerCase().includes('lag') ||
              p.name?.toLowerCase().includes('lead') || p.name?.toLowerCase().includes('transit')) ? 'h' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="border-b border-slate-200 pb-3">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function ChartCard({ title, subtitle, tooltip, children, className = '' }: { title: string; subtitle?: string; tooltip?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 p-5 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800 leading-tight">{title}</h3>
        {tooltip && <InfoTooltip content={tooltip} wide />}
      </div>
      {subtitle && <p className="text-xs text-slate-400 mt-0.5 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </div>
  );
}

function InfoBox({ color, children }: { color: 'indigo' | 'emerald' | 'amber'; children: React.ReactNode }) {
  const styles = {
    indigo:  'bg-indigo-50 border-indigo-100 text-indigo-800',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-800',
    amber:   'bg-amber-50 border-amber-100 text-amber-800',
  };
  return (
    <div className={`border rounded-lg p-4 text-xs leading-relaxed ${styles[color]}`}>
      {children}
    </div>
  );
}

/* ─── Active filter banner ─── */
function FilterBanner({
  from, to, originCountry, destCountry, count, total
}: {
  from: string | null; to: string | null;
  originCountry: string | null; destCountry: string | null;
  count: number; total: number;
}) {
  const parts: string[] = [];
  if (from && to) parts.push(`dates ${from} → ${to}`);
  else if (from) parts.push(`from ${from}`);
  else if (to) parts.push(`up to ${to}`);
  if (originCountry) parts.push(`origin: ${originCountry}`);
  if (destCountry) parts.push(`destination: ${destCountry}`);
  if (parts.length === 0) return null;
  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5 flex items-center gap-3 text-xs">
      <svg className="w-4 h-4 text-indigo-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
      </svg>
      <span className="text-indigo-700">
        <strong>Filters active:</strong> {parts.join(' · ')} — showing <strong>{count.toLocaleString()}</strong> of {total.toLocaleString()} receptacles
      </span>
    </div>
  );
}

export default function Home() {
  const {
    events, allEvents, stats, loading, error,
    dateRange, setDateRange, allDataBounds,
    effectiveDateRange,
    originCountry, setOriginCountry,
    destCountry, setDestCountry,
    allOriginCountries, allDestCountries,
  } = useTrackingData();
  const [activeTab, setActiveTab] = useState('RFID');
  const [tableFilter, setTableFilter] = useState('ALL');

  /* Matched Tags count from ID Relation table */
  const [matchedTagsData, setMatchedTagsData] = useState<{ count: number; minDate: string | null; maxDate: string | null } | null>(null);
  // Build country→IMPC map from allEvents
  const countryToImpc = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const e of allEvents) {
      if (e.predes_origin_country && e.predes_origin_impc) {
        if (!map[e.predes_origin_country]) map[e.predes_origin_country] = new Set();
        map[e.predes_origin_country].add(e.predes_origin_impc);
      }
      if (e.redes_dest_country && e.redes_dest_impc) {
        if (!map[e.redes_dest_country]) map[e.redes_dest_country] = new Set();
        map[e.redes_dest_country].add(e.redes_dest_impc);
      }
    }
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, Array.from(v)]));
  }, [allEvents]);
  useEffect(() => {
    // Use tracking_events date bounds when no date filter is active
    const dateFrom = dateRange.from || allDataBounds.min || undefined;
    const dateTo = dateRange.to || allDataBounds.max || undefined;
    const originImpcCodes = originCountry ? (countryToImpc[originCountry] || []) : undefined;
    const destImpcCodes = destCountry ? (countryToImpc[destCountry] || []) : undefined;
    fetchMatchedTagsCount(dateFrom, dateTo, originImpcCodes, destImpcCodes)
      .then(setMatchedTagsData)
      .catch(() => setMatchedTagsData(null));
  }, [dateRange.from, dateRange.to, originCountry, destCountry, countryToImpc, allDataBounds.min, allDataBounds.max]);

  /* RFID tab data — derived from tracking_events (no separate fetch) */
  const epcis = useEpcisData({
    dateFrom: dateRange.from || undefined,
    dateTo: dateRange.to || undefined,
    originCountry: originCountry || undefined,
    destCountry: destCountry || undefined,
    allEvents,
    loading,
    error,
  });

  /* Date label for CSV filename */
  const dateLabel = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return '';
    return [dateRange.from, dateRange.to].filter(Boolean).join('_to_');
  }, [dateRange]);

  /* Scatter data: departure lag vs arrival lead (FULL coverage only) */
  const scatterData = useMemo(() => {
    if (!events.length) return [];
    return events
      .filter(e => e.coverage_type === 'FULL' && e.departure_lag_hours !== null && e.arrival_lead_hours !== null)
      .map(e => ({ x: e.departure_lag_hours!, y: e.arrival_lead_hours!, s9id: e.s9id }))
      .slice(0, 800);
  }, [events]);

  /* ─── Loading ─── */
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 rounded-full mx-auto animate-spin" style={{ border: '3px solid #e2e8f0', borderTopColor: '#4F46E5' }} />
          <p className="text-sm text-slate-500 font-medium">Loading tracking data from Supabase…</p>
          <p className="text-xs text-slate-400">tracking_events · {new Date().toLocaleDateString('en-GB')}</p>
        </div>
      </div>
    );
  }

  /* ─── Error ─── */
  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-rose-200 rounded-lg p-6 max-w-md w-full text-center space-y-3">
          <div className="w-10 h-10 bg-rose-50 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-5 h-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <p className="font-semibold text-rose-600">Connection Error</p>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ─── Header ─── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="container">
          {/* Top row: logo + tabs */}
          <div className="flex items-center justify-between h-20 gap-4">
            {/* EDGE logo */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <img
                src={EDGE_LOGO}
                alt="EDGE by GMS"
                className="h-16 w-auto object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="hidden lg:block border-l border-slate-200 pl-3">
                <p className="text-base font-bold text-slate-900 leading-tight tracking-tight">LEG2 Analysis Tool</p>
                <p className="text-[10px] text-slate-400 leading-tight">
                  {effectiveDateRange.from && effectiveDateRange.to
                    ? `${effectiveDateRange.from} – ${effectiveDateRange.to}`
                    : 'Jan 2026 – Mar 2026'} · <span className="mono-value">{events.length.toLocaleString()}</span>
                  {events.length !== allEvents.length && (
                    <span className="text-indigo-500"> / {allEvents.length.toLocaleString()}</span>
                  )} receptacles
                </p>
              </div>
            </div>

            {/* Nav tabs — desktop */}
            <nav className="hidden md:flex items-end gap-3">
              {/* RFID standalone tab */}
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[9px] font-semibold uppercase tracking-widest text-indigo-400 px-1">RFID</span>
                <button
                  onClick={() => setActiveTab('RFID')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                    activeTab === 'RFID'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  RFID
                </button>
              </div>
              {/* Divider */}
              <div className="w-px h-7 bg-slate-200 self-center" />
              {/* EDI / RFID Benchmark group */}
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[9px] font-semibold uppercase tracking-widest text-amber-500 px-1">EDI / RFID Benchmark</span>
                <div className="flex items-center gap-0.5">
                  {['Departure', 'Arrival', 'Transit', 'Data'].map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                        activeTab === tab
                          ? 'bg-amber-500 text-white shadow-sm'
                          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>
            </nav>

            {/* Mobile tab select */}
            <select
              className="md:hidden text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white"
              value={activeTab}
              onChange={e => setActiveTab(e.target.value)}
            >
              {TABS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          {/* Global filters row: dates + origin + destination */}
          <div className="border-t border-slate-100 py-2">
            <GlobalFilters
              dateRange={dateRange}
              onDateChange={setDateRange}
              minDate={allDataBounds.min}
              maxDate={allDataBounds.max}
              originCountry={originCountry}
              onOriginChange={setOriginCountry}
              destCountry={destCountry}
              onDestChange={setDestCountry}
              allOriginCountries={allOriginCountries}
              allDestCountries={allDestCountries}
              filteredCount={events.length}
              totalCount={allEvents.length}
            />
          </div>
        </div>
      </header>

      {/* ─── Main content ─── */}
      <main className="container py-6 space-y-7">

        {/* Active filter banner */}
        <FilterBanner
          from={dateRange.from}
          to={dateRange.to}
          originCountry={originCountry}
          destCountry={destCountry}
          count={events.length}
          total={allEvents.length}
        />

        {/* ════════════════════ DEPARTURE ════════════════════ */}
        {activeTab === 'Departure' && (
          <Section
            title="Departure Event: RFID vs PREDES"
            subtitle="Comparison of the first RFID reading at the origin centre against the PREDES (pre-advice of dispatch) EDI message. Positive values = RFID detected AFTER PREDES."
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard title="Analysed Pairs" value={stats.departurePairs.toLocaleString()} subtitle="RFID + PREDES matches" badge={{ label: 'departure', color: 'blue' }}
                tooltip="Number of receptacles that have both an RFID reading at the origin centre AND a PREDES message. Only these pairs can be used to calculate the departure lag (time difference between administrative dispatch and physical detection)."
              />
              <KpiCard title="Avg Lag" value={`+${stats.departureAvgHours}h / ${(stats.departureAvgHours / 24).toFixed(1)}d`} subtitle="RFID after PREDES" badge={{ label: 'RFID after PREDES', color: 'amber' }}
                tooltip="The median (50th percentile) time between the PREDES message and the first RFID reading at the origin centre. The median is used instead of the mean to reduce the influence of extreme outliers. A positive value is expected and operationally normal."
              />

              <KpiCard title="RFID Before PREDES" value={`${stats.departureRfidBeforePct}%`} subtitle={`${stats.departureRfidBefore} anomalous cases`}
                badge={{ label: stats.departureRfidBeforePct < 10 ? 'Normal' : 'Review', color: stats.departureRfidBeforePct < 10 ? 'green' : 'red' }}
                tooltip="Percentage of cases where the RFID reading at origin occurred BEFORE the PREDES message was issued. This is technically anomalous (PREDES should precede physical departure). Causes: EDI transmission delays, timestamp errors, or pre-loading of receptacles before administrative processing."
              />
            </div>

            {/* ── By Origin Country ── */}
            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Departure Lag by Origin Country" subtitle="Avg hours between PREDES and first RFID reading" tooltip="Each bar shows the avg departure lag per origin country. Amber (positive) = RFID detected after PREDES (normal). Green (negative) = RFID detected before PREDES (anomalous). Reference line at 0h separates both cases.">
                <ResponsiveContainer width="100%" height={Math.max(220, stats.byOriginCountry.length * 34)}>
                  <BarChart data={stats.byOriginCountry} layout="vertical" margin={{ left: 0, right: 60, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="country" tick={{ fontSize: 11 }} width={110} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2"
                      label={{ value: '← RFID before PREDES  |  RFID after PREDES →', position: 'top', style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="avgDepartureLag" name="Avg lag (hours)" radius={[0, 3, 3, 0]}>
                      {stats.byOriginCountry.map((entry, i) => <Cell key={i} fill={entry.avgDepartureLag < 0 ? C.emerald : C.amber} />)}
                      <LabelList dataKey="avgDepartureLag" position="right" formatter={(v: number) => `${v.toFixed(0)}h / ${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Receptacles by Origin Country" subtitle="Volume of departure pairs per country" tooltip="Number of receptacles with RFID+PREDES pairs per origin country.">
                <ResponsiveContainer width="100%" height={Math.max(220, stats.byOriginCountry.length * 34)}>
                  <BarChart data={stats.byOriginCountry} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="country" tick={{ fontSize: 11 }} width={110} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Receptacles" fill={C.indigo} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── By Origin Centre ── */}
            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Departure Lag by Origin Centre" subtitle="Avg hours between PREDES and first RFID reading" tooltip="Each bar shows the avg departure lag for receptacles processed at that origin centre. Centres with longer positive bars have larger gaps between administrative preparation (PREDES) and physical RFID detection. Negative bars indicate centres where RFID typically precedes PREDES.">
                <ResponsiveContainer width="100%" height={Math.max(220, stats.departureByCentre.length * 34)}>
                  <BarChart data={stats.departureByCentre} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={140} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="avg" name="Avg lag (hours)" fill={C.indigo} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="avg" position="right" formatter={(v: number) => `${v.toFixed(0)}h / ${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="RFID Before PREDES Rate by Centre" subtitle="% of cases where RFID was detected before PREDES was issued" tooltip="Red bars show the percentage of receptacles at each centre where RFID was detected before the PREDES message. High rates at specific centres may indicate: (1) EDI message transmission delays at that origin postal operator, (2) systematic timestamp issues, or (3) early physical processing before administrative dispatch.">
                <ResponsiveContainer width="100%" height={Math.max(220, stats.departureByCentre.length * 34)}>
                  <BarChart data={stats.departureByCentre} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={140} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="rfidBeforePct" name="RFID before PREDES (%)" fill={C.rose} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="rfidBeforePct" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {stats.departureCdf.length > 0 && (
              <ChartCard
                title="Cumulative Frequency: Departure Lag"
                subtitle={`Distribution of ${stats.departurePairs.toLocaleString()} departure lag values (hours)`}
                tooltip="Cumulative distribution function (CDF) of departure lag. The Y axis shows the percentage of receptacles with a lag ≤ X hours. The steeper the curve, the more concentrated the distribution. The vertical reference line marks 0h (RFID = PREDES). Read: 'X% of receptacles have a departure lag ≤ Y hours'."
              >
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={stats.departureCdf} margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                    <defs>
                      <linearGradient id="cdfDepGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.indigo} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={C.indigo} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="x" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`}
                      label={{ value: 'Departure lag (h)', position: 'insideBottom', offset: -10, style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]}
                      label={{ value: 'Cumulative %', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2" label={{ value: '0h', position: 'top', style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <ReferenceLine y={50} stroke={C.indigo} strokeDasharray="4 2" strokeOpacity={0.4} label={{ value: 'P50', position: 'right', style: { fontSize: 9, fill: C.indigo } }} />
                    <Tooltip formatter={(v: any) => [`${v}%`, 'Cumulative']} labelFormatter={l => `Lag ≤ ${l}h`} />
                    <Area type="monotone" dataKey="pct" stroke={C.indigo} strokeWidth={2} fill="url(#cdfDepGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            <InfoBox color="indigo">
              <span className="font-semibold">Interpretation:</span> The PREDES message is issued by the origin postal operator when the dispatch is administratively prepared, typically 2–3 days before the receptacle physically departs. The avg lag of <strong>+{stats.departureAvgHours}h ({(stats.departureAvgHours/24).toFixed(1)}d)</strong> is operationally consistent with this workflow. Cases where RFID precedes PREDES ({stats.departureRfidBeforePct}%) may indicate EDI transmission delays or timestamp inconsistencies.
            </InfoBox>

            <DepartureAnalysis s={stats} />

          </Section>
        )}

        {/* ════════════════════ ARRIVAL ════════════════════ */}
        {activeTab === 'Arrival' && (
          <Section
            title="Arrival Event: RFID vs RESDES"
            subtitle="Comparison of the last RFID reading at the destination centre against the RESDES (advice of receipt) EDI message. Negative values = RFID detected BEFORE RESDES (real-time advantage)."
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard title="Analysed Pairs" value={stats.arrivalPairs.toLocaleString()} subtitle="RFID + RESDES matches" badge={{ label: 'arrival', color: 'green' }}
                tooltip="Number of receptacles with both an RFID reading at the destination centre AND a RESDES message. Only these pairs enable the arrival lead/lag calculation."
              />
              <KpiCard title="Avg Lead/Lag"
                value={`${stats.arrivalAvgHours < 0 ? '' : '+'}${stats.arrivalAvgHours.toFixed(1)}h / ${(Math.abs(stats.arrivalAvgHours)/24).toFixed(1)}d`}
                subtitle={stats.arrivalAvgHours < 0 ? `RFID before RESDES` : `RFID after RESDES`}
                badge={{ label: stats.arrivalAvgHours < 0 ? 'RFID advantage' : 'EDI faster', color: stats.arrivalAvgHours < 0 ? 'green' : 'amber' }}
                tooltip="Median time between the last RFID reading at the destination and the RESDES message. Negative = RFID detected BEFORE RESDES (RFID provides earlier visibility). Positive = RESDES issued before RFID detection (EDI is faster at this destination)."
              />
              <KpiCard title="RFID Before RESDES" value={`${stats.arrivalRfidBeforePct}%`} subtitle={`${stats.arrivalRfidBefore} cases`} badge={{ label: 'real-time visibility', color: 'green' }}
                tooltip="Percentage of arrivals where RFID detected the receptacle BEFORE the RESDES message was generated. This directly measures the real-time visibility advantage of RFID: the higher this percentage, the more value RFID adds over EDI at the destination."
              />
              <KpiCard title="RFID After RESDES" value={`${100 - stats.arrivalRfidBeforePct}%`} subtitle="EDI faster than RFID" badge={{ label: 'review', color: 'amber' }}
                tooltip="Percentage of arrivals where the RESDES message was issued BEFORE the RFID reading. In these cases EDI provides earlier visibility than RFID. May indicate: late RFID scanning at the destination, or very fast EDI processing at certain destination operators."
              />
            </div>

            {/* ── By Destination Country ── */}
            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Arrival Lead/Lag by Destination Country" subtitle="Avg hours (negative = RFID before RESDES)" tooltip="Each bar shows the avg arrival lead/lag per destination country. Green (negative) = RFID detected before RESDES — real-time advantage. Amber (positive) = RESDES issued before RFID. Reference line at 0h separates both cases.">
                <ResponsiveContainer width="100%" height={Math.max(220, stats.byDestCountry.length * 34)}>
                  <BarChart data={stats.byDestCountry} layout="vertical" margin={{ left: 0, right: 60, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="country" tick={{ fontSize: 11 }} width={110} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2"
                      label={{ value: '← RFID before RESDES  |  RFID after RESDES →', position: 'top', style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="avgArrivalLead" name="Avg lead/lag (hours)" radius={[0, 3, 3, 0]}>
                      {stats.byDestCountry.map((entry, i) => <Cell key={i} fill={entry.avgArrivalLead < 0 ? C.emerald : C.amber} />)}
                      <LabelList dataKey="avgArrivalLead" position="right" formatter={(v: number) => `${v.toFixed(0)}h / ${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Receptacles by Destination Country" subtitle="Volume of arrival pairs per country" tooltip="Number of receptacles with RFID+RESDES pairs per destination country.">
                <ResponsiveContainer width="100%" height={Math.max(220, stats.byDestCountry.length * 34)}>
                  <BarChart data={stats.byDestCountry} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="country" tick={{ fontSize: 11 }} width={110} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Receptacles" fill={C.emerald} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* ── By Destination Centre ── */}
            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Arrival Lead/Lag by Destination Centre" subtitle="Avg hours (negative = RFID before RESDES)" tooltip="Each bar shows the avg arrival lead/lag per destination centre. Green bars (negative values) = RFID detected before RESDES — RFID provides real-time advantage. Amber bars (positive values) = RESDES issued before RFID detection. The reference line at 0 separates the two cases.">
                <ResponsiveContainer width="100%" height={Math.max(220, stats.arrivalByCentre.length * 34)}>
                  <BarChart data={stats.arrivalByCentre} layout="vertical" margin={{ left: 0, right: 55, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={145} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2" />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="avg" name="Avg lead/lag (hours)" radius={[0, 3, 3, 0]}>
                      {stats.arrivalByCentre.map((entry, i) => <Cell key={i} fill={entry.avg < 0 ? C.emerald : C.amber} />)}
                      <LabelList dataKey="avg" position="right" formatter={(v: number) => `${v.toFixed(0)}h/${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="RFID Before RESDES Rate by Destination" subtitle="% of arrivals where RFID detected before RESDES" tooltip="Green bars show the percentage of arrivals at each destination centre where RFID was detected before RESDES. A high rate (close to 100%) means RFID consistently provides earlier visibility than EDI at that destination. A low rate means EDI is typically faster at that centre.">
                <ResponsiveContainer width="100%" height={Math.max(220, stats.arrivalByCentre.length * 34)}>
                  <BarChart data={stats.arrivalByCentre} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={145} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="rfidBeforePct" name="RFID before RESDES (%)" fill={C.emerald} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="rfidBeforePct" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {stats.arrivalCdf.length > 0 && (
              <ChartCard
                title="Cumulative Frequency: Arrival Lead/Lag"
                subtitle={`Distribution of ${stats.arrivalPairs.toLocaleString()} arrival lead/lag values (hours)`}
                tooltip="Cumulative distribution function (CDF) of arrival lead/lag. Negative values = RFID detected before RESDES (RFID advantage). The Y axis shows the percentage of receptacles with a lead/lag ≤ X hours. The vertical reference line at 0h separates RFID-before (left) from RFID-after (right) cases."
              >
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={stats.arrivalCdf} margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                    <defs>
                      <linearGradient id="cdfArrGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.emerald} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={C.emerald} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="x" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`}
                      label={{ value: 'Arrival lead/lag (h)', position: 'insideBottom', offset: -10, style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]}
                      label={{ value: 'Cumulative %', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2" label={{ value: '0h', position: 'top', style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <ReferenceLine y={50} stroke={C.emerald} strokeDasharray="4 2" strokeOpacity={0.4} label={{ value: 'P50', position: 'right', style: { fontSize: 9, fill: C.emerald } }} />
                    <Tooltip formatter={(v: any) => [`${v}%`, 'Cumulative']} labelFormatter={l => `Lead/lag ≤ ${l}h`} />
                    <Area type="monotone" dataKey="pct" stroke={C.emerald} strokeWidth={2} fill="url(#cdfArrGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            <InfoBox color="emerald">
              <span className="font-semibold">Key Finding:</span> In <strong>{stats.arrivalRfidBeforePct}%</strong> of arrival events, the RFID system detects the receptacle <em>before</em> the RESDES message is generated. This represents the measurable real-time visibility advantage of RFID over EDI at the destination centre — the avg lead time is <strong>{Math.abs(stats.arrivalAvgHours).toFixed(1)}h ({(Math.abs(stats.arrivalAvgHours)/24).toFixed(1)}d)</strong>.
            </InfoBox>

            <ArrivalAnalysis s={stats} />

          </Section>
        )}

        {/* ════════════════════ TRANSIT ════════════════════ */}
        {activeTab === 'Transit' && (
          <Section
            title="Transit Time Comparison"
            subtitle="For receptacles with RFID readings at both origin and destination centres: physical transit (RFID) vs declared transit (EDI: RESDES − PREDES)."
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard title="Validated Routes" value={stats.transitPairs.toLocaleString()} subtitle="Full origin→dest RFID" badge={{ label: 'end-to-end', color: 'blue' }}
                tooltip="Number of receptacles with RFID readings at both a distinct origin and destination centre (full_route_validated = true). Only these enable a direct comparison between physical transit time (RFID) and declared transit time (EDI)."
              />
              <KpiCard title="Avg RFID Transit" value={`${stats.rfidTransitAvg}h / ${(stats.rfidTransitAvg / 24).toFixed(1)}d`} subtitle="Avg physical transit (RFID)" badge={{ label: 'physical', color: 'blue' }}
                tooltip="Median physical transit time measured by RFID: the time between the last RFID reading at the origin centre and the first RFID reading at the destination centre. This is the actual time the receptacle spent in transit, as measured by the RFID infrastructure."
              />
              <KpiCard title="Avg EDI Transit" value={`${stats.ediTransitAvg}h / ${(stats.ediTransitAvg / 24).toFixed(1)}d`} subtitle="Avg declared transit (EDI)" badge={{ label: 'declared', color: 'slate' }}
                tooltip="Median declared transit time from EDI messages: RESDES timestamp minus PREDES timestamp. This is the administratively declared transit time, which may differ from the physical transit measured by RFID due to processing delays, pre-advice timing, or timestamp inconsistencies."
              />
              <KpiCard title="EDI Overestimate" value={`${stats.transitDiffAvg > 0 ? '+' : ''}${stats.transitDiffAvg}h / ${(Math.abs(stats.transitDiffAvg)/24).toFixed(1)}d`} subtitle="EDI vs RFID transit gap"
                badge={{ label: stats.transitDiffAvg > 0 ? 'EDI longer' : 'RFID longer', color: stats.transitDiffAvg > 0 ? 'amber' : 'green' }}
                tooltip="Median difference between EDI-declared transit and RFID-measured physical transit (EDI minus RFID). Positive = EDI overestimates transit time (EDI says the journey took longer than RFID measured). Negative = EDI underestimates. This gap reveals systematic biases in administrative declarations."
              />
            </div>

            {stats.transitRoutes.length > 0 ? (
              <ChartCard title="Transit Comparison by Route" subtitle="RFID physical transit vs EDI declared transit (avg hours)" tooltip="Grouped bar chart comparing RFID-measured physical transit (indigo) vs EDI-declared transit (grey) for each origin→destination route. Routes where the grey bar is longer than the indigo bar indicate EDI overestimates transit. Routes where indigo is longer indicate EDI underestimates. The difference quantifies the accuracy of EDI declarations.">
                <ResponsiveContainer width="100%" height={Math.max(200, stats.transitRoutes.length * 60)}>
                  <BarChart data={stats.transitRoutes} layout="vertical" margin={{ left: 0, right: 65, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="route" tick={{ fontSize: 10 }} width={185} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                    <Bar dataKey="rfidAvg" name="RFID Physical (h)" fill={C.indigo} radius={[0, 2, 2, 0]} barSize={13}>
                      <LabelList dataKey="rfidAvg" position="right" formatter={(v: number) => `${v.toFixed(0)}h/${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: C.indigo }} />
                    </Bar>
                    <Bar dataKey="ediAvg" name="EDI Declared (h)" fill={C.slate} radius={[0, 2, 2, 0]} barSize={13}>
                      <LabelList dataKey="ediAvg" position="right" formatter={(v: number) => `${v.toFixed(0)}h/${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: C.slate }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
                <p className="font-semibold text-amber-800 text-sm mb-1">Limited transit data</p>
                <p className="text-xs text-amber-700 leading-relaxed">
                  End-to-end transit measurement requires RFID coverage at both origin and destination. Only {stats.transitPairs} fully validated routes were found in the selected date range.
                </p>
              </div>
            )}

            {(stats.rfidTransitCdf.length > 0 || stats.ediTransitCdf.length > 0) && (
              <ChartCard
                title="Cumulative Frequency: Transit Times"
                subtitle={`Distribution of ${stats.transitPairs.toLocaleString()} transit time values — RFID physical vs EDI declared`}
                tooltip="Cumulative distribution function (CDF) comparing RFID-measured physical transit (indigo) vs EDI-declared transit (grey). A curve shifted to the left means shorter transit times. Where the indigo curve is to the left of the grey curve, RFID measures shorter transit than EDI declares. The gap between curves at any percentile quantifies the systematic over/underestimation of EDI."
              >
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                    <defs>
                      <linearGradient id="cdfRfidGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.indigo} stopOpacity={0.12} />
                        <stop offset="95%" stopColor={C.indigo} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="x" type="number" allowDuplicatedCategory={false} tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`}
                      label={{ value: 'Transit time (h)', position: 'insideBottom', offset: -10, style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]}
                      label={{ value: 'Cumulative %', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <ReferenceLine y={50} strokeDasharray="4 2" strokeOpacity={0.35} stroke="#94a3b8" label={{ value: 'P50', position: 'right', style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <Tooltip formatter={(v: any, name: string) => [`${v}%`, name]} labelFormatter={l => `Transit ≤ ${l}h`} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Line data={stats.rfidTransitCdf} type="monotone" dataKey="pct" name="RFID Physical" stroke={C.indigo} strokeWidth={2} dot={false} />
                    <Line data={stats.ediTransitCdf} type="monotone" dataKey="pct" name="EDI Declared" stroke={C.slate} strokeWidth={2} dot={false} strokeDasharray="5 3" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            <InfoBox color="indigo">
              <span className="font-semibold">Methodology:</span> Physical transit time is measured as the difference between the last RFID reading at the origin centre and the first RFID reading at the destination centre (different centres only, intermediate stops excluded). EDI transit is RESDES timestamp minus PREDES timestamp. Only routes with <span className="mono-value bg-white/60 px-1 rounded">full_route_validated = true</span> are included.
            </InfoBox>

            <TransitAnalysis s={stats} />

          </Section>
        )}

        {/* ════════════════════ RFID (PURE EPCIS) ════════════════════ */}
        {activeTab === 'RFID' && (
          <Section
            title="RFID Analysis"
            subtitle={`RFID analysis from tracking_events — ${epcis.stats.uniqueReceptacles.toLocaleString()} receptacles · ${epcis.stats.endToEndPairs.toLocaleString()} end-to-end`}
          >
            {loading && (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid #e2e8f0', borderTopColor: '#4F46E5' }} />
                <span className="ml-3 text-sm text-slate-500">Loading RFID data…</span>
              </div>
            )}
            {!loading && (
              <>
                {/* ── OVERVIEW ── */}
                <div className="mb-2">
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">Overview</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
                    <KpiCard
                      title="Matched Tags"
                      value={matchedTagsData != null ? matchedTagsData.count.toLocaleString() : '—'}
                      subtitle={matchedTagsData?.minDate && matchedTagsData?.maxDate
                        ? `${matchedTagsData.minDate} → ${matchedTagsData.maxDate}`
                        : 'tag ID ↔ s9id pairs in ID Relation'}
                      badge={{ label: 'id-match', color: 'blue' }}
                      tooltip="Number of tag ID ↔ s9id records in the ID Relation table for the selected date period. Dates shown are the first and last matching record."
                    />
                    <KpiCard
                      title="Total RFID Receptacles"
                      value={epcis.stats.uniqueReceptacles.toLocaleString()}
                      subtitle="unique s9ids with has_rfid in tracking_events"
                      badge={{ label: 'rfid', color: 'blue' }}
                      tooltip="Total unique receptacles with has_rfid = true in tracking_events."
                    />
                    <KpiCard
                      title="RFID Departures"
                      value={epcis.stats.withOriginReading.toLocaleString()}
                      subtitle="with RFID reading at origin centre"
                      badge={{ label: 'origin', color: 'blue' }}
                      tooltip="Receptacles with rfid_origin_impc set in tracking_events (BOTH + ORIGIN_ONLY cases)."
                    />
                    <KpiCard
                      title="RFID Arrivals"
                      value={epcis.stats.withDestReading.toLocaleString()}
                      subtitle="with RFID reading at destination centre"
                      badge={{ label: 'dest', color: 'green' }}
                      tooltip="Receptacles with rfid_dest_impc set in tracking_events (BOTH + DEST_ONLY cases)."
                    />
                    <KpiCard
                      title="End-to-End Pairs"
                      value={epcis.stats.endToEndPairs.toLocaleString()}
                      subtitle="RFID reading at both origin & destination"
                      badge={{ label: 'e2e', color: 'amber' }}
                      tooltip="Receptacles with RFID readings at both origin and destination centres (rfid_case = BOTH)."
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <ChartCard
                      title="Departures by Origin Country"
                      subtitle="All RFID receptacles by origin country"
                      tooltip="Number of receptacles with an RFID origin reading, grouped by origin country. Derived from datos EPCIS location field."
                    >
                      <ResponsiveContainer width="100%" height={Math.max(220, epcis.stats.byOriginCountry.length * 34)}>
                        <BarChart data={epcis.stats.byOriginCountry} layout="vertical" margin={{ left: 8, right: 50, top: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                          <YAxis type="category" dataKey="country" tick={{ fontSize: 10, fill: '#64748b' }} width={110} interval={0} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="count" name="Receptacles" fill={C.indigo} radius={[0, 3, 3, 0]}>
                            <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartCard>

                    <ChartCard
                      title="Arrivals by Destination Country"
                      subtitle="End-to-end RFID pairs by destination country"
                      tooltip="Number of receptacles with RFID readings at both origin and destination, grouped by destination country."
                    >
                      <ResponsiveContainer width="100%" height={Math.max(220, epcis.stats.byDestCountry.length * 34)}>
                        <BarChart data={epcis.stats.byDestCountry} layout="vertical" margin={{ left: 8, right: 50, top: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                          <YAxis type="category" dataKey="country" tick={{ fontSize: 10, fill: '#64748b' }} width={110} interval={0} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="count" name="Receptacles" fill={C.emerald} radius={[0, 3, 3, 0]}>
                            <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartCard>
                  </div>
                </div>

                {/* ── DEPARTURES ── */}
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">Departures</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                    <KpiCard
                      title="Total RFID Departures"
                      value={epcis.stats.withOriginReading.toLocaleString()}
                      subtitle="receptacles with RFID reading at origin centre"
                      badge={{ label: 'departures', color: 'blue' }}
                      tooltip="Receptacles with rfid_origin_impc set in tracking_events (BOTH + ORIGIN_ONLY cases)."
                    />
                    <KpiCard
                      title="Origin Countries"
                      value={epcis.stats.uniqueOrigins.toLocaleString()}
                      subtitle="distinct origin countries"
                      badge={{ label: 'countries', color: 'blue' }}
                      tooltip="Number of distinct rfid_origin_country values in tracking_events."
                    />
                    <KpiCard
                      title="Origin Centres"
                      value={epcis.stats.byOriginCentre.length.toLocaleString()}
                      subtitle="distinct origin postal centres"
                      badge={{ label: 'centres', color: 'blue' }}
                      tooltip="Number of distinct rfid_origin_centre values in tracking_events."
                    />
                    <KpiCard
                      title="Avg RFID Transit"
                      value={epcis.stats.avgTransitHours != null ? `${epcis.stats.avgTransitHours}h` : '—'}
                      subtitle="avg rfid_transit_hours (e2e pairs)"
                      badge={{ label: 'transit', color: 'amber' }}
                      tooltip="Median rfid_transit_hours from tracking_events for end-to-end pairs."
                    />
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <ChartCard
                      title="Departure Volume by Origin Centre"
                      subtitle="Receptacles with RFID last scan at origin centre"
                      tooltip="Number of receptacles with a valid RFID departure reading at each origin postal centre. Sorted by volume."
                    >
                      <ResponsiveContainer width="100%" height={Math.max(220, epcis.stats.byOriginCentre.length * 34)}>
                        <BarChart data={epcis.stats.byOriginCentre.map(x => ({ centre: x.centre, n: x.count }))} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10 }} />
                          <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={140} interval={0} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="n" name="Receptacles" fill={C.indigo} radius={[0, 3, 3, 0]}>
                            <LabelList dataKey="n" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartCard>

                    <ChartCard
                      title="Avg RFID Transit by Origin Centre"
                      subtitle="Avg hours from last origin scan to first destination scan"
                      tooltip="Each bar shows the median RFID transit time for receptacles that departed from that origin centre and arrived at a destination centre. Only end-to-end pairs are included."
                    >
                      <ResponsiveContainer width="100%" height={Math.max(220, epcis.stats.departureByCentre.length * 34)}>
                        <BarChart data={epcis.stats.departureByCentre} layout="vertical" margin={{ left: 0, right: 60, top: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                          <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={140} interval={0} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="avgH" name="Avg Transit (h)" fill={C.sky} radius={[0, 3, 3, 0]}>
                            <LabelList dataKey="avgH" position="right" formatter={(v: number) => `${v}h/${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartCard>
                  </div>

                  {epcis.stats.transitCdf.length > 0 && (
                    <ChartCard
                      title="Cumulative Frequency: RFID Transit Time"
                      subtitle={`Distribution of ${epcis.stats.endToEndPairs.toLocaleString()} end-to-end transit values (hours)`}
                      tooltip="Cumulative distribution function (CDF) of RFID physical transit time. The Y axis shows the percentage of receptacles with a transit time ≤ X hours. Steeper curve = more concentrated distribution. Read: 'X% of receptacles have a transit time ≤ Y hours'."
                    >
                      <ResponsiveContainer width="100%" height={260}>
                        <AreaChart data={epcis.stats.transitCdf} margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                          <defs>
                            <linearGradient id="cdfRfidTransitGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={C.indigo} stopOpacity={0.18} />
                              <stop offset="95%" stopColor={C.indigo} stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="x" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`}
                            label={{ value: 'Transit time (h)', position: 'insideBottom', offset: -10, style: { fontSize: 10, fill: '#94a3b8' } }} />
                          <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]}
                            label={{ value: 'Cumulative %', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                          <ReferenceLine y={50} stroke={C.indigo} strokeDasharray="4 2" strokeOpacity={0.4} label={{ value: 'P50', position: 'right', style: { fontSize: 9, fill: C.indigo } }} />
                          <Tooltip formatter={(v: any) => [`${v}%`, 'Cumulative']} labelFormatter={l => `Transit ≤ ${l}h`} />
                          <Area type="monotone" dataKey="pct" stroke={C.indigo} strokeWidth={2} fill="url(#cdfRfidTransitGrad)" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartCard>
                  )}

                  <InfoBox color="indigo">
                    <span className="font-semibold">Methodology:</span> Departure time = <span className="font-mono bg-white/60 px-1 rounded">rfid_origin_time</span>. Origin centre = <span className="font-mono bg-white/60 px-1 rounded">rfid_origin_centre</span>. Data source: <strong>tracking_events</strong> (has_rfid = true).
                  </InfoBox>
                </div>

                {/* ── ARRIVALS ── */}
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">Arrivals</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                    <KpiCard
                      title="Total RFID Arrivals"
                      value={epcis.stats.withDestReading.toLocaleString()}
                      subtitle="receptacles with RFID reading at destination centre"
                      badge={{ label: 'arrivals', color: 'green' }}
                      tooltip="Receptacles with rfid_dest_impc set in tracking_events (BOTH + DEST_ONLY cases)."
                    />
                    <KpiCard
                      title="Destination Countries"
                      value={epcis.stats.uniqueDestinations.toLocaleString()}
                      subtitle="distinct destination countries"
                      badge={{ label: 'countries', color: 'green' }}
                      tooltip="Number of distinct rfid_dest_country values in tracking_events."
                    />
                    <KpiCard
                      title="Destination Centres"
                      value={epcis.stats.byDestCentre.length.toLocaleString()}
                      subtitle="distinct destination postal centres"
                      badge={{ label: 'centres', color: 'green' }}
                      tooltip="Number of distinct rfid_dest_centre values in tracking_events."
                    />
                    <KpiCard
                      title="End-to-End Coverage"
                      value={`${epcis.stats.endToEndPct}%`}
                      subtitle={`${epcis.stats.endToEndPairs.toLocaleString()} of ${epcis.stats.uniqueReceptacles.toLocaleString()} receptacles`}
                      badge={{ label: 'e2e', color: 'amber' }}
                      tooltip="Percentage of RFID receptacles with rfid_dest_impc ≠ rfid_origin_impc in tracking_events."
                    />
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <ChartCard
                      title="Arrival Volume by Destination Centre"
                      subtitle="Receptacles with RFID first scan at destination centre"
                      tooltip="Number of receptacles with a valid RFID arrival reading at each destination postal centre. Sorted by volume."
                    >
                      <ResponsiveContainer width="100%" height={Math.max(220, epcis.stats.byDestCentre.length * 34)}>
                        <BarChart data={epcis.stats.byDestCentre.map(x => ({ centre: x.centre, n: x.count }))} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10 }} />
                          <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={145} interval={0} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="n" name="Receptacles" fill={C.emerald} radius={[0, 3, 3, 0]}>
                            <LabelList dataKey="n" position="right" style={{ fontSize: 10, fill: '#64748b' }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartCard>

                    <ChartCard
                      title="Avg RFID Transit by Destination Centre"
                      subtitle="Avg hours from last origin scan to first destination scan"
                      tooltip="Each bar shows the median RFID transit time for receptacles that arrived at that destination centre. Only end-to-end pairs are included."
                    >
                      <ResponsiveContainer width="100%" height={Math.max(220, epcis.stats.arrivalByCentre.length * 34)}>
                        <BarChart data={epcis.stats.arrivalByCentre} layout="vertical" margin={{ left: 0, right: 60, top: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                          <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={145} interval={0} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="avgH" name="Avg Transit (h)" fill={C.emerald} radius={[0, 3, 3, 0]}>
                            <LabelList dataKey="avgH" position="right" formatter={(v: number) => `${v}h/${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartCard>
                  </div>

                  <InfoBox color="emerald">
                    <span className="font-semibold">Methodology:</span> Arrival time = <span className="font-mono bg-white/60 px-1 rounded">rfid_dest_time</span>. Destination centre = <span className="font-mono bg-white/60 px-1 rounded">rfid_dest_centre</span>. End-to-end coverage: <strong>{epcis.stats.endToEndPct}%</strong> ({epcis.stats.endToEndPairs.toLocaleString()} receptacles). Data source: <strong>tracking_events</strong> (has_rfid = true).
                  </InfoBox>
                </div>

                {/* ── TRANSIT ── */}
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">Transit</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                    <KpiCard
                      title="End-to-End Pairs"
                      value={epcis.stats.endToEndPairs.toLocaleString()}
                      subtitle="Full origin→dest RFID"
                      badge={{ label: 'end-to-end', color: 'blue' }}
                      tooltip="Receptacles with rfid_dest_impc ≠ rfid_origin_impc in tracking_events."
                    />
                    <KpiCard
                      title="Avg RFID Transit"
                      value={epcis.stats.avgTransitHours != null ? `${epcis.stats.avgTransitHours}h / ${(epcis.stats.avgTransitHours / 24).toFixed(1)}d` : '—'}
                      subtitle="rfid_origin_time → rfid_dest_time"
                      badge={{ label: 'avg', color: 'blue' }}
                      tooltip="Median rfid_transit_hours from tracking_events for end-to-end pairs."
                    />
                    <KpiCard
                      title="IQR Range"
                      value={epcis.stats.p25TransitHours != null ? `${epcis.stats.p25TransitHours}h – ${epcis.stats.p75TransitHours}h` : '—'}
                      subtitle={epcis.stats.p25TransitHours != null ? `${(epcis.stats.p25TransitHours!/24).toFixed(1)}d – ${(epcis.stats.p75TransitHours!/24).toFixed(1)}d` : 'no data'}
                      badge={{ label: 'IQR', color: 'slate' }}
                      tooltip="Interquartile Range of rfid_transit_hours in tracking_events."
                    />
                    <KpiCard
                      title="Mean RFID Transit"
                      value={epcis.stats.meanTransitHours != null ? `${epcis.stats.meanTransitHours}h / ${(epcis.stats.meanTransitHours / 24).toFixed(1)}d` : '—'}
                      subtitle="average transit time"
                      badge={{ label: 'avg', color: 'amber' }}
                      tooltip="Mean rfid_transit_hours from tracking_events for end-to-end pairs."
                    />
                  </div>

                  {epcis.stats.byRoute.length > 0 ? (
                    <ChartCard
                      title="RFID Transit by Route"
                      subtitle={`${epcis.stats.byRoute.length} routes · avg rfid_transit_hours from tracking_events`}
                      tooltip="Each row is a unique rfid_origin_country → rfid_dest_country pair from tracking_events."
                    >
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-100">
                              <th className="text-left py-2 pr-4 text-slate-500 font-medium">Route (RFID)</th>
                              <th className="text-right py-2 pr-4 text-slate-500 font-medium">n</th>
                              <th className="text-right py-2 text-slate-500 font-medium">Avg Transit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {epcis.stats.byRoute.map((r, i) => (
                              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                <td className="py-2 pr-4 font-medium text-slate-800">{r.route}</td>
                                <td className="py-2 pr-4 text-right font-medium text-slate-700">{r.count}</td>
                                <td className="py-2 text-right">
                                  {r.avgH !== null ? (
                                    <>
                                      <span className="font-semibold text-indigo-600">{r.avgH}h</span>
                                      <span className="text-slate-400 ml-1">/ {(r.avgH / 24).toFixed(1)}d</span>
                                    </>
                                  ) : <span className="text-slate-300">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </ChartCard>
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
                      <p className="font-semibold text-amber-800 text-sm mb-1">Limited transit data</p>
                      <p className="text-xs text-amber-700 leading-relaxed">
                        End-to-end transit measurement requires RFID coverage at both origin and destination. Only {epcis.stats.endToEndPairs} end-to-end pairs were found in the selected date range.
                      </p>
                    </div>
                  )}

                  {epcis.stats.transitCdf.length > 0 && (
                    <ChartCard
                      title="Cumulative Frequency: RFID Transit Time"
                      subtitle={`Distribution of ${epcis.stats.endToEndPairs.toLocaleString()} RFID transit values (hours)`}
                      tooltip="Cumulative distribution function (CDF) of RFID physical transit time. The Y axis shows the percentage of receptacles with a transit time ≤ X hours. Read: 'X% of receptacles have a transit time ≤ Y hours'."
                    >
                      <ResponsiveContainer width="100%" height={260}>
                        <AreaChart data={epcis.stats.transitCdf} margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                          <defs>
                            <linearGradient id="cdfRfidTransitGrad2" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={C.indigo} stopOpacity={0.18} />
                              <stop offset="95%" stopColor={C.indigo} stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="x" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`}
                            label={{ value: 'Transit time (h)', position: 'insideBottom', offset: -10, style: { fontSize: 10, fill: '#94a3b8' } }} />
                          <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]}
                            label={{ value: 'Cumulative %', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
                          <ReferenceLine y={50} stroke={C.indigo} strokeDasharray="4 2" strokeOpacity={0.4} label={{ value: 'P50', position: 'right', style: { fontSize: 9, fill: C.indigo } }} />
                          <Tooltip formatter={(v: any) => [`${v}%`, 'Cumulative']} labelFormatter={l => `Transit ≤ ${l}h`} />
                          <Area type="monotone" dataKey="pct" stroke={C.indigo} strokeWidth={2} fill="url(#cdfRfidTransitGrad2)" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartCard>
                  )}

                  <InfoBox color="indigo">
                    <span className="font-semibold">Methodology:</span> Physical transit time = <span className="font-mono bg-white/60 px-1 rounded">rfid_transit_hours</span> from <strong>tracking_events</strong>. Only receptacles with <span className="font-mono bg-white/60 px-1 rounded">rfid_dest_impc ≠ rfid_origin_impc</span> are included.
                  </InfoBox>
                </div>

                {/* ── ANALYSIS SUMMARY ── */}
                <div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50/60 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1 h-5 rounded-full bg-indigo-500" />
                    <h4 className="text-sm font-semibold text-indigo-900">RFID Analysis Summary</h4>
                  </div>
                  <div className="space-y-2 text-sm text-indigo-800 leading-relaxed">
                    <p>
                      The RFID system captured <strong>{epcis.stats.uniqueReceptacles.toLocaleString()} unique receptacles</strong> with at least one RFID reading in <strong>tracking_events</strong>.
                      Origin readings span <strong>{epcis.stats.uniqueOrigins} countries</strong> and <strong>{epcis.stats.byOriginCentre.length} postal centres</strong>.
                    </p>
                    <p>
                      End-to-end traceability — receptacles with RFID readings at both origin and destination — stands at <strong>{epcis.stats.endToEndPairs.toLocaleString()} receptacles ({epcis.stats.endToEndPct}%)</strong>.
                      {epcis.stats.avgTransitHours != null && epcis.stats.avgTransitHours > 0 && (
                        <> These pairs yield a avg physical transit time of <strong>{epcis.stats.avgTransitHours}h ({(epcis.stats.avgTransitHours / 24).toFixed(1)} days)</strong>, measured from rfid_origin_time to rfid_dest_time.</>
                      )}
                    </p>
                    {epcis.stats.byOriginCountry.length > 0 && (
                      <p>
                        The leading origin country by RFID volume is <strong>{epcis.stats.byOriginCountry[0].country}</strong> ({epcis.stats.byOriginCountry[0].count} receptacles)
                        {epcis.stats.byOriginCountry.length > 1 ? `, followed by ${epcis.stats.byOriginCountry[1].country} (${epcis.stats.byOriginCountry[1].count})` : ''}.
                        The primary destination is <strong>{epcis.stats.byDestCountry[0]?.country || '—'}</strong> with {epcis.stats.byDestCountry[0]?.count || 0} arrivals.
                      </p>
                    )}
                  </div>
                </div>
                 {/* ════════════════════ RFID DATA TABLE ════════════════════ */}
                <div className="mt-8">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-1 h-6 rounded-full bg-indigo-500" />
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">RFID Journey Data</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {epcis.stats.uniqueReceptacles.toLocaleString()} receptacles from tracking_events — one row per unique s9id
                      </p>
                    </div>
                  </div>
                  <EpcisDataTable journeys={epcis.journeys} dateLabel={dateLabel} />
                </div>
              </>)}
          </Section>
        )}
        {/* ════════════════════ DATA TABLE ════════════════════ */}
        {activeTab === 'Data' && (
          <Section
            title="Detailed Data"
            subtitle={`All ${events.length.toLocaleString()} receptacles from the tracking_events table with pre-calculated metrics`}
          >
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'ALL', label: 'All' },
                { key: 'FULL', label: 'FULL' },
                { key: 'EDI_ONLY', label: 'EDI Only' },
                { key: 'RFID_PREDES', label: 'RFID + PREDES' },
                { key: 'RFID_RESDES', label: 'RFID + RESDES' },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setTableFilter(f.key)}
                  className={`px-3 py-1.5 text-xs rounded-md border font-medium transition-all duration-150 ${
                    tableFilter === f.key
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                  }`}
                >
                  {f.label}
                  {f.key !== 'ALL' && (
                    <span className={`ml-1.5 text-[10px] font-normal ${tableFilter === f.key ? 'text-indigo-200' : 'text-slate-400'}`}>
                      {stats.coverageBreakdown.find(c => c.type === f.key)?.count?.toLocaleString() ?? ''}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <DataTable events={events} filterCoverage={tableFilter} dateLabel={dateLabel} />
          </Section>
        )}

      </main>

      {/* ─── Footer ─── */}
      <footer className="border-t border-slate-200 bg-white mt-10">
        <div className="container py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <img src={EDGE_LOGO} alt="EDGE by GMS" className="h-5 w-auto object-contain opacity-60" />
            <span>RFID-EDI Analysis Dashboard · {effectiveDateRange.from && effectiveDateRange.to ? `${effectiveDateRange.from} – ${effectiveDateRange.to}` : 'Jan 2026 – Mar 2026'}</span>
          </div>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            Connected to Supabase · tracking_events · {allEvents.length.toLocaleString()} total records
          </span>
        </div>
      </footer>
    </div>
  );
}
