/**
 * EDGE RFID-EDI Analysis Dashboard
 * Design: Operational Intelligence — clean white + slate + indigo accent
 * Font: DM Sans (body) + Inter (headings/numbers) + JetBrains Mono (data)
 * Data source: Supabase tracking_events table
 * Features: global date filter, CSV export, EDGE by GMS logo
 */

import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ReferenceLine, LabelList,
  ScatterChart, Scatter, ZAxis,
  LineChart, Line, Area, AreaChart,
} from 'recharts';
import { useTrackingData } from '@/hooks/useTrackingData';
import { KpiCard } from '@/components/KpiCard';
import { DataTable } from '@/components/DataTable';
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
  RFID_PREDES: C.sky,
  RFID_RESDES: C.indigo,
  RFID_ONLY:   C.amber,
  EDI_ONLY:    C.slate,
};

const COVERAGE_LABEL: Record<string, string> = {
  FULL:        'RFID + PREDES + RESDES',
  RFID_PREDES: 'RFID + PREDES only',
  RFID_RESDES: 'RFID + RESDES only',
  RFID_ONLY:   'RFID only (no EDI)',
  EDI_ONLY:    'EDI only (no RFID)',
};

const TABS = ['Overview', 'Departure', 'Arrival', 'Transit', 'RFID Transit', 'Data'];

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
  const [activeTab, setActiveTab] = useState('Overview');
  const [tableFilter, setTableFilter] = useState('ALL');

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
                <p className="text-xs font-semibold text-slate-700 leading-tight">RFID-EDI Analysis</p>
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
            <nav className="hidden md:flex items-center gap-0.5">
              {TABS.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                    activeTab === tab
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {tab}
                </button>
              ))}
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

        {/* ════════════════════ OVERVIEW ════════════════════ */}
        {activeTab === 'Overview' && (
          <Section
            title="Dashboard Overview"
            subtitle={`RFID vs EDI tracking performance summary for ${events.length.toLocaleString()} receptacles${dateRange.from || dateRange.to ? ' (filtered)' : effectiveDateRange.from && effectiveDateRange.to ? ` · ${effectiveDateRange.from} – ${effectiveDateRange.to}` : ' · Jan 2026 – Mar 2026'}`}
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                title="Total Receptacles"
                value={stats.totalReceptacles.toLocaleString()}
                subtitle="Unique s9id tracked"
                badge={{ label: 'all sources', color: 'slate' }}
                tooltip="Total number of unique postal receptacles (s9id) found in the tracking_events table, combining all data sources: RFID readings, PREDES messages, and RESDES messages."
              />
              <KpiCard
                title="Full Coverage"
                value={stats.fullCoverage.toLocaleString()}
                subtitle={`${Math.round((stats.fullCoverage / stats.totalReceptacles) * 100)}% of total`}
                badge={{ label: 'RFID + PREDES + RESDES', color: 'green' }}
                tooltip="Receptacles with all three data types: an RFID reading at origin, a PREDES (pre-advice of dispatch) EDI message, and a RESDES (advice of receipt) EDI message. These enable the full temporal comparison between physical and administrative events."
              />
              <KpiCard
                title="Departure Median Lag"
                value={`+${stats.departureMedianHours}h / ${(stats.departureMedianHours / 24).toFixed(1)}d`}
                subtitle={`RFID detected after PREDES`}
                badge={{ label: `${stats.departurePairs} pairs`, color: 'blue' }}
                tooltip="Median time difference between the PREDES message (administrative dispatch) and the first RFID reading at the origin centre. Positive = RFID detected after PREDES. Typically 2–3 days because PREDES is issued when the dispatch is prepared, before physical departure."
              />
              <KpiCard
                title="Arrival Median Lead"
                value={`${stats.arrivalMedianHours < 0 ? '' : '+'}${stats.arrivalMedianHours}h / ${(Math.abs(stats.arrivalMedianHours) / 24).toFixed(1)}d`}
                subtitle={stats.arrivalMedianHours < 0
                  ? `RFID before RESDES`
                  : `RFID after RESDES`}
                badge={{ label: `${stats.arrivalPairs} pairs`, color: stats.arrivalMedianHours < 0 ? 'green' : 'amber' }}
                tooltip="Median time difference between the last RFID reading at the destination centre and the RESDES message. Negative = RFID detected BEFORE RESDES — this is the real-time visibility advantage of RFID over EDI at arrival."
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                title="RFID Only"
                value={stats.rfidOnly.toLocaleString()}
                subtitle="No EDI match"
                badge={{ label: `${Math.round((stats.rfidOnly / stats.totalReceptacles) * 100)}%`, color: 'amber' }}
                tooltip="Receptacles with at least one RFID reading but no matching EDI messages (no PREDES or RESDES). The receptacle physically passed through an RFID-equipped centre but no administrative EDI trace was found in the dataset."
              />
              <KpiCard
                title="EDI Only"
                value={stats.ediOnly.toLocaleString()}
                subtitle="No RFID reading"
                badge={{ label: `${Math.round((stats.ediOnly / stats.totalReceptacles) * 100)}%`, color: 'slate' }}
                tooltip="Receptacles with EDI messages (PREDES and/or RESDES) but no RFID reading. The postal operator transmitted administrative messages, but the receptacle did not pass through any RFID-equipped centre in this dataset."
              />
              <KpiCard
                title="Validated Transit Routes"
                value={stats.transitPairs.toLocaleString()}
                subtitle="Full origin→dest RFID"
                badge={{ label: 'end-to-end', color: 'blue' }}
                tooltip="Receptacles where RFID was detected at both the origin centre AND the destination centre (different centres). This enables end-to-end physical transit time measurement, which can then be compared against the EDI-declared transit time."
              />
              <KpiCard
                title="Transit Difference"
                value={`${stats.transitDiffMedian > 0 ? '+' : ''}${stats.transitDiffMedian}h / ${(Math.abs(stats.transitDiffMedian) / 24).toFixed(1)}d`}
                subtitle="EDI vs RFID median transit"
                badge={{ label: stats.transitDiffMedian > 0 ? 'EDI longer' : 'RFID longer', color: stats.transitDiffMedian > 0 ? 'amber' : 'green' }}
                tooltip="Median difference between EDI-declared transit (RESDES minus PREDES) and RFID-measured physical transit. Positive = EDI overestimates transit time. Negative = EDI underestimates. Helps identify systematic biases in administrative declarations."
              />
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Coverage Distribution" subtitle="Receptacle classification by data availability" tooltip="Donut chart showing the proportion of receptacles in each coverage category. FULL (green) enables complete analysis. RFID+PREDES (blue) enables departure analysis. RFID+RESDES (indigo) enables arrival analysis. RFID Only (amber) has physical tracking but no EDI. EDI Only (grey) has administrative messages but no physical tracking.">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={stats.coverageBreakdown} dataKey="count" nameKey="type" cx="50%" cy="50%" outerRadius={82} innerRadius={48} paddingAngle={2}>
                      {stats.coverageBreakdown.map(e => <Cell key={e.type} fill={COVERAGE_FILL[e.type]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any, n: any) => [v.toLocaleString(), COVERAGE_LABEL[n] || n]} />
                    <Legend iconType="circle" iconSize={8} formatter={v => <span className="text-xs text-slate-600">{COVERAGE_LABEL[v] || v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Departure Lag by Origin Country" subtitle="Median hours between PREDES and first RFID reading" tooltip="Horizontal bar chart showing the median departure lag per origin country. Departure lag = time between the PREDES message and the first RFID reading at the origin centre. Positive bars = RFID detected after PREDES (normal). Negative bars = RFID detected before PREDES (anomalous — may indicate EDI delays or timestamp issues).">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.byOriginCountry} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="country" tick={{ fontSize: 11 }} width={85} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="medianDepartureLag" name="Median lag (hours)" fill={C.indigo} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="medianDepartureLag" position="right" formatter={(v: number) => `${v.toFixed(0)}h/${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <OverviewAnalysis s={stats} />

          </Section>
        )}

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
              <KpiCard title="Median Lag" value={`+${stats.departureMedianHours}h / ${(stats.departureMedianHours / 24).toFixed(1)}d`} subtitle="RFID after PREDES" badge={{ label: 'RFID after PREDES', color: 'amber' }}
                tooltip="The median (50th percentile) time between the PREDES message and the first RFID reading at the origin centre. The median is used instead of the mean to reduce the influence of extreme outliers. A positive value is expected and operationally normal."
              />
              <KpiCard title="IQR Range" value={`${stats.departureP25}h – ${stats.departureP75}h`} subtitle={`${(stats.departureP25/24).toFixed(1)}d – ${(stats.departureP75/24).toFixed(1)}d`} badge={{ label: 'IQR', color: 'slate' }}
                tooltip="Interquartile Range: the range between the 25th and 75th percentile of departure lags. This shows the spread of the middle 50% of the data. A narrow IQR indicates consistent timing; a wide IQR suggests high variability across different flows."
              />
              <KpiCard title="RFID Before PREDES" value={`${stats.departureRfidBeforePct}%`} subtitle={`${stats.departureRfidBefore} anomalous cases`}
                badge={{ label: stats.departureRfidBeforePct < 10 ? 'Normal' : 'Review', color: stats.departureRfidBeforePct < 10 ? 'green' : 'red' }}
                tooltip="Percentage of cases where the RFID reading at origin occurred BEFORE the PREDES message was issued. This is technically anomalous (PREDES should precede physical departure). Causes: EDI transmission delays, timestamp errors, or pre-loading of receptacles before administrative processing."
              />
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Departure Lag by Origin Centre" subtitle="Median hours between PREDES and first RFID reading" tooltip="Each bar shows the median departure lag for receptacles processed at that origin centre. Centres with longer positive bars have larger gaps between administrative preparation (PREDES) and physical RFID detection. Negative bars indicate centres where RFID typically precedes PREDES.">
                <ResponsiveContainer width="100%" height={Math.max(220, stats.departureByCentre.length * 34)}>
                  <BarChart data={stats.departureByCentre} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={140} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="median" name="Median lag (hours)" fill={C.indigo} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="median" position="right" formatter={(v: number) => `${v.toFixed(0)}h / ${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
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
              <span className="font-semibold">Interpretation:</span> The PREDES message is issued by the origin postal operator when the dispatch is administratively prepared, typically 2–3 days before the receptacle physically departs. The median lag of <strong>+{stats.departureMedianHours}h ({(stats.departureMedianHours/24).toFixed(1)}d)</strong> is operationally consistent with this workflow. Cases where RFID precedes PREDES ({stats.departureRfidBeforePct}%) may indicate EDI transmission delays or timestamp inconsistencies.
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
              <KpiCard title="Median Lead/Lag"
                value={`${stats.arrivalMedianHours < 0 ? '' : '+'}${stats.arrivalMedianHours.toFixed(1)}h / ${(Math.abs(stats.arrivalMedianHours)/24).toFixed(1)}d`}
                subtitle={stats.arrivalMedianHours < 0 ? `RFID before RESDES` : `RFID after RESDES`}
                badge={{ label: stats.arrivalMedianHours < 0 ? 'RFID advantage' : 'EDI faster', color: stats.arrivalMedianHours < 0 ? 'green' : 'amber' }}
                tooltip="Median time between the last RFID reading at the destination and the RESDES message. Negative = RFID detected BEFORE RESDES (RFID provides earlier visibility). Positive = RESDES issued before RFID detection (EDI is faster at this destination)."
              />
              <KpiCard title="RFID Before RESDES" value={`${stats.arrivalRfidBeforePct}%`} subtitle={`${stats.arrivalRfidBefore} cases`} badge={{ label: 'real-time visibility', color: 'green' }}
                tooltip="Percentage of arrivals where RFID detected the receptacle BEFORE the RESDES message was generated. This directly measures the real-time visibility advantage of RFID: the higher this percentage, the more value RFID adds over EDI at the destination."
              />
              <KpiCard title="RFID After RESDES" value={`${100 - stats.arrivalRfidBeforePct}%`} subtitle="EDI faster than RFID" badge={{ label: 'review', color: 'amber' }}
                tooltip="Percentage of arrivals where the RESDES message was issued BEFORE the RFID reading. In these cases EDI provides earlier visibility than RFID. May indicate: late RFID scanning at the destination, or very fast EDI processing at certain destination operators."
              />
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Arrival Lead/Lag by Destination Centre" subtitle="Median hours (negative = RFID before RESDES)" tooltip="Each bar shows the median arrival lead/lag per destination centre. Green bars (negative values) = RFID detected before RESDES — RFID provides real-time advantage. Amber bars (positive values) = RESDES issued before RFID detection. The reference line at 0 separates the two cases.">
                <ResponsiveContainer width="100%" height={Math.max(220, stats.arrivalByCentre.length * 34)}>
                  <BarChart data={stats.arrivalByCentre} layout="vertical" margin={{ left: 0, right: 55, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={145} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2" />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="median" name="Median lead/lag (hours)" radius={[0, 3, 3, 0]}>
                      {stats.arrivalByCentre.map((entry, i) => <Cell key={i} fill={entry.median < 0 ? C.emerald : C.amber} />)}
                      <LabelList dataKey="median" position="right" formatter={(v: number) => `${v.toFixed(0)}h/${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: '#64748b' }} />
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
              <span className="font-semibold">Key Finding:</span> In <strong>{stats.arrivalRfidBeforePct}%</strong> of arrival events, the RFID system detects the receptacle <em>before</em> the RESDES message is generated. This represents the measurable real-time visibility advantage of RFID over EDI at the destination centre — the median lead time is <strong>{Math.abs(stats.arrivalMedianHours).toFixed(1)}h ({(Math.abs(stats.arrivalMedianHours)/24).toFixed(1)}d)</strong>.
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
              <KpiCard title="RFID Median Transit" value={`${stats.rfidTransitMedian}h / ${(stats.rfidTransitMedian / 24).toFixed(1)}d`} subtitle="Physical transit (RFID)" badge={{ label: 'physical', color: 'blue' }}
                tooltip="Median physical transit time measured by RFID: the time between the last RFID reading at the origin centre and the first RFID reading at the destination centre. This is the actual time the receptacle spent in transit, as measured by the RFID infrastructure."
              />
              <KpiCard title="EDI Median Transit" value={`${stats.ediTransitMedian}h / ${(stats.ediTransitMedian / 24).toFixed(1)}d`} subtitle="Declared transit (EDI)" badge={{ label: 'declared', color: 'slate' }}
                tooltip="Median declared transit time from EDI messages: RESDES timestamp minus PREDES timestamp. This is the administratively declared transit time, which may differ from the physical transit measured by RFID due to processing delays, pre-advice timing, or timestamp inconsistencies."
              />
              <KpiCard title="EDI Overestimate" value={`${stats.transitDiffMedian > 0 ? '+' : ''}${stats.transitDiffMedian}h / ${(Math.abs(stats.transitDiffMedian)/24).toFixed(1)}d`} subtitle="EDI vs RFID transit gap"
                badge={{ label: stats.transitDiffMedian > 0 ? 'EDI longer' : 'RFID longer', color: stats.transitDiffMedian > 0 ? 'amber' : 'green' }}
                tooltip="Median difference between EDI-declared transit and RFID-measured physical transit (EDI minus RFID). Positive = EDI overestimates transit time (EDI says the journey took longer than RFID measured). Negative = EDI underestimates. This gap reveals systematic biases in administrative declarations."
              />
            </div>

            {stats.transitRoutes.length > 0 ? (
              <ChartCard title="Transit Comparison by Route" subtitle="RFID physical transit vs EDI declared transit (median hours)" tooltip="Grouped bar chart comparing RFID-measured physical transit (indigo) vs EDI-declared transit (grey) for each origin→destination route. Routes where the grey bar is longer than the indigo bar indicate EDI overestimates transit. Routes where indigo is longer indicate EDI underestimates. The difference quantifies the accuracy of EDI declarations.">
                <ResponsiveContainer width="100%" height={Math.max(200, stats.transitRoutes.length * 60)}>
                  <BarChart data={stats.transitRoutes} layout="vertical" margin={{ left: 0, right: 65, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="route" tick={{ fontSize: 10 }} width={185} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                    <Bar dataKey="rfidMedian" name="RFID Physical (h)" fill={C.indigo} radius={[0, 2, 2, 0]} barSize={13}>
                      <LabelList dataKey="rfidMedian" position="right" formatter={(v: number) => `${v.toFixed(0)}h/${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: C.indigo }} />
                    </Bar>
                    <Bar dataKey="ediMedian" name="EDI Declared (h)" fill={C.slate} radius={[0, 2, 2, 0]} barSize={13}>
                      <LabelList dataKey="ediMedian" position="right" formatter={(v: number) => `${v.toFixed(0)}h/${(v/24).toFixed(1)}d`} style={{ fontSize: 10, fill: C.slate }} />
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

        {/* ════════════════════ RFID TRANSIT (PURE) ════════════════════ */}
        {activeTab === 'RFID Transit' && (
          <Section
            title="Pure RFID Transit Analysis"
            subtitle="Transit times measured exclusively from RFID readings: first scan at origin centre → first scan at destination centre. No EDI data required."
          >
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                title="RFID Receptacles"
                value={stats.rfidPureTotal.toLocaleString()}
                subtitle="with at least one RFID reading"
                badge={{ label: 'rfid', color: 'blue' }}
                tooltip="Total number of receptacles that have at least one RFID reading, regardless of EDI coverage. This is the universe for pure RFID analysis."
              />
              <KpiCard
                title="With Origin + Dest"
                value={stats.rfidPureWithDest.toLocaleString()}
                subtitle={`${stats.rfidPureTotal > 0 ? Math.round((stats.rfidPureWithDest / stats.rfidPureTotal) * 100) : 0}% of RFID receptacles`}
                badge={{ label: 'transit pair', color: 'green' }}
                tooltip="Receptacles with RFID readings at two different centres (origin ≠ destination), enabling a direct measurement of physical transit time without any EDI data."
              />
              <KpiCard
                title="Median RFID Transit"
                value={`${stats.rfidPureMedianHours}h / ${(stats.rfidPureMedianHours / 24).toFixed(1)}d`}
                subtitle="origin → destination (RFID only)"
                badge={{ label: 'median', color: 'blue' }}
                tooltip="The median time between the first RFID scan at the origin centre and the first RFID scan at the destination centre. This is a pure physical measurement — no EDI timestamps involved."
              />
              <KpiCard
                title="IQR (P25–P75)"
                value={`${stats.rfidPureP25}h – ${stats.rfidPureP75}h`}
                subtitle={`${(stats.rfidPureP25 / 24).toFixed(1)}d – ${(stats.rfidPureP75 / 24).toFixed(1)}d`}
                badge={{ label: 'spread', color: 'amber' }}
                tooltip="Interquartile range of pure RFID transit times. The middle 50% of receptacles have a transit time within this window. A narrow IQR indicates consistent transit performance; a wide IQR suggests high variability."
              />
            </div>

            {/* Routes table */}
            <ChartCard
              title="RFID Transit by Route"
              subtitle={`${stats.rfidPureRoutes.length} routes · sorted by volume`}
              tooltip="Each row is a unique origin IMPC → destination IMPC pair observed via RFID. Median, min and max are all calculated from RFID timestamps only — no EDI data is used. Routes with a single receptacle are included."
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 pr-4 text-slate-500 font-medium">Route (RFID)</th>
                      <th className="text-left py-2 pr-4 text-slate-500 font-medium">Origin</th>
                      <th className="text-left py-2 pr-4 text-slate-500 font-medium">Destination</th>
                      <th className="text-right py-2 pr-4 text-slate-500 font-medium">n</th>
                      <th className="text-right py-2 pr-4 text-slate-500 font-medium">Median</th>
                      <th className="text-right py-2 pr-4 text-slate-500 font-medium">Min</th>
                      <th className="text-right py-2 text-slate-500 font-medium">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.rfidPureRoutes.map((r, i) => (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="py-2 pr-4 font-mono text-[10px] text-slate-600">{r.route}</td>
                        <td className="py-2 pr-4">
                          <div className="font-medium text-slate-800">{r.origName}</div>
                          <div className="text-slate-400">{r.origCountry}</div>
                        </td>
                        <td className="py-2 pr-4">
                          <div className="font-medium text-slate-800">{r.destName}</div>
                          <div className="text-slate-400">{r.destCountry}</div>
                        </td>
                        <td className="py-2 pr-4 text-right font-medium text-slate-700">{r.n}</td>
                        <td className="py-2 pr-4 text-right">
                          <span className="font-semibold text-indigo-600">{r.medianH}h</span>
                          <span className="text-slate-400 ml-1">/ {(r.medianH / 24).toFixed(1)}d</span>
                        </td>
                        <td className="py-2 pr-4 text-right text-emerald-600">{r.minH}h</td>
                        <td className="py-2 text-right text-rose-500">{r.maxH}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>

            {/* Two column: by origin centre + by dest centre */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <ChartCard
                title="Median Transit by Origin Centre"
                subtitle="RFID first scan at origin"
                tooltip="For each origin centre, the median RFID transit time across all receptacles that departed from that centre and were subsequently detected at a different destination centre. Centres with more receptacles are shown first."
              >
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.rfidPureByOriginCentre.slice(0, 10)} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10, fill: '#64748b' }} width={90} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="medianH" name="Median transit (h)" fill={C.indigo} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="medianH" position="right" style={{ fontSize: 9, fill: '#64748b' }} formatter={(v: number) => `${v}h / ${(v / 24).toFixed(1)}d`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title="Median Transit by Destination Centre"
                subtitle="RFID first scan at destination"
                tooltip="For each destination centre, the median RFID transit time across all receptacles that arrived at that centre from a different origin. Centres with more receptacles are shown first."
              >
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.rfidPureByDestCentre.slice(0, 10)} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10, fill: '#64748b' }} width={90} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="medianH" name="Median transit (h)" fill={C.emerald} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="medianH" position="right" style={{ fontSize: 9, fill: '#64748b' }} formatter={(v: number) => `${v}h / ${(v / 24).toFixed(1)}d`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* CDF */}
            {stats.rfidPureCdf.length > 0 && (
              <ChartCard
                title="Cumulative Frequency — Pure RFID Transit"
                subtitle={`Distribution of RFID transit times across ${stats.rfidPureWithDest} receptacles with origin + destination readings`}
                tooltip="Each point on this curve shows the percentage of receptacles whose RFID transit time is at or below the value on the X axis. Reading example: if the curve reaches 50% at 72h, then half of all receptacles were physically scanned at their destination within 3 days of being scanned at origin."
              >
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={stats.rfidPureCdf} margin={{ left: 0, right: 20, top: 8, bottom: 4 }}>
                    <defs>
                      <linearGradient id="rfidPureGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.indigo} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={C.indigo} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="x" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `${v}h`} label={{ value: 'RFID transit time (h)', position: 'insideBottom', offset: -2, style: { fontSize: 10, fill: '#94a3b8' } }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                    <ReferenceLine y={50} strokeDasharray="4 2" strokeOpacity={0.4} stroke="#94a3b8" label={{ value: 'P50', position: 'right', style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <ReferenceLine y={90} strokeDasharray="4 2" strokeOpacity={0.3} stroke="#f59e0b" label={{ value: 'P90', position: 'right', style: { fontSize: 9, fill: '#f59e0b' } }} />
                    <Tooltip formatter={(v: any) => [`${v}%`, 'Cumulative %']} labelFormatter={l => `Transit ≤ ${l}h (${(Number(l) / 24).toFixed(1)}d)`} />
                    <Area type="monotone" dataKey="pct" name="Cumulative %" stroke={C.indigo} strokeWidth={2} fill="url(#rfidPureGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            <InfoBox color="indigo">
              <span className="font-semibold">Methodology:</span> Pure RFID transit time = <span className="mono-value bg-white/60 px-1 rounded">rfid_dest_time − rfid_origin_time</span> from the <span className="mono-value bg-white/60 px-1 rounded">tracking_events</span> table. Only receptacles with readings at two <em>different</em> IMPC centres are included (origin ≠ destination). No EDI messages (PREDES/RESDES) are required — this analysis is valid even for RFID_ONLY receptacles. The global date and country filters apply.
            </InfoBox>

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
                { key: 'RFID_ONLY', label: 'RFID Only' },
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
