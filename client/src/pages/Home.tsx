/**
 * EDGE RFID-EDI Analysis Dashboard
 * Design: Operational Intelligence — clean white + slate + indigo accent
 * Font: DM Sans (body) + Inter (headings/numbers) + JetBrains Mono (data)
 * Data source: Supabase tracking_events table
 */

import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ReferenceLine, LabelList,
  ScatterChart, Scatter, ZAxis,
} from 'recharts';
import { useTrackingData } from '@/hooks/useTrackingData';
import { KpiCard } from '@/components/KpiCard';
import { DataTable } from '@/components/DataTable';

/* ─── Color palette ─── */
const C = {
  indigo:  '#4F46E5',
  emerald: '#10B981',
  amber:   '#F59E0B',
  rose:    '#F43F5E',
  sky:     '#0EA5E9',
  slate:   '#64748B',
  violet:  '#7C3AED',
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

const TABS = ['Overview', 'Coverage', 'Departure', 'Arrival', 'Transit', 'Data'];

/* ─── Tooltip personalizado ─── */
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
            {(p.name?.toLowerCase().includes('hour') || p.name?.toLowerCase().includes('lag') || p.name?.toLowerCase().includes('lead') || p.name?.toLowerCase().includes('transit')) ? 'h' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Section wrapper ─── */
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

/* ─── Chart card ─── */
function ChartCard({ title, subtitle, children, className = '' }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 p-5 shadow-sm ${className}`}>
      <h3 className="text-sm font-bold text-slate-800 leading-tight">{title}</h3>
      {subtitle && <p className="text-xs text-slate-400 mt-0.5 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </div>
  );
}

/* ─── Info box ─── */
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

/* ─── Main component ─── */
export default function Home() {
  const { events, stats, loading, error } = useTrackingData();
  const [activeTab, setActiveTab] = useState('Overview');
  const [tableFilter, setTableFilter] = useState('ALL');

  /* Scatter data: departure lag vs arrival lead (FULL coverage only) */
  const scatterData = useMemo(() => {
    if (!events.length) return [];
    return events
      .filter(e => e.coverage_type === 'FULL' && e.departure_lag_hours !== null && e.arrival_lead_hours !== null)
      .map(e => ({ x: e.departure_lag_hours!, y: e.arrival_lead_hours!, s9id: e.s9id }))
      .slice(0, 800); // limit for perf
  }, [events]);

  /* ─── Loading ─── */
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div
            className="w-10 h-10 rounded-full mx-auto animate-spin"
            style={{ border: '3px solid #e2e8f0', borderTopColor: '#4F46E5' }}
          />
          <p className="text-sm text-slate-500 font-medium">Cargando datos desde Supabase…</p>
          <p className="text-xs text-slate-400">tracking_events · {new Date().toLocaleDateString('es-ES')}</p>
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
          <p className="font-semibold text-rose-600">Error de conexión</p>
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
          <div className="flex items-center justify-between h-14 gap-4">
            {/* Brand */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="w-8 h-8 bg-indigo-600 rounded-md flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75V16.5zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                </svg>
              </div>
              <div className="hidden sm:block">
                <h1 className="text-sm font-bold text-slate-900 leading-tight">EDGE RFID-EDI Analysis</h1>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Dic 2025 – Mar 2026 · <span className="mono-value">{stats.totalReceptacles.toLocaleString()}</span> receptáculos
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

            {/* Nav tabs — mobile */}
            <select
              className="md:hidden text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white"
              value={activeTab}
              onChange={e => setActiveTab(e.target.value)}
            >
              {TABS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </header>

      {/* ─── Main content ─── */}
      <main className="container py-7 space-y-8">

        {/* ════════════════════ OVERVIEW ════════════════════ */}
        {activeTab === 'Overview' && (
          <Section
            title="Dashboard Overview"
            subtitle={`Resumen de rendimiento RFID vs EDI para ${stats.totalReceptacles.toLocaleString()} receptáculos postales · Dic 2025 – Mar 2026`}
          >
            {/* KPI row 1 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                title="Total Receptáculos"
                value={stats.totalReceptacles.toLocaleString()}
                subtitle="s9id únicos rastreados"
                badge={{ label: 'todas las fuentes', color: 'slate' }}
              />
              <KpiCard
                title="Cobertura Completa"
                value={stats.fullCoverage.toLocaleString()}
                subtitle={`${Math.round((stats.fullCoverage / stats.totalReceptacles) * 100)}% del total`}
                badge={{ label: 'RFID + PREDES + RESDES', color: 'green' }}
              />
              <KpiCard
                title="Lag Mediano Salida"
                value={`+${stats.departureMedianHours}h`}
                subtitle={`RFID detectado ${(stats.departureMedianHours / 24).toFixed(1)}d después de PREDES`}
                badge={{ label: `${stats.departurePairs} pares`, color: 'blue' }}
              />
              <KpiCard
                title="Lead Mediano Llegada"
                value={`${stats.arrivalMedianHours < 0 ? '' : '+'}${stats.arrivalMedianHours}h`}
                subtitle={stats.arrivalMedianHours < 0 ? `RFID ${Math.abs(stats.arrivalMedianHours)}h antes de RESDES` : `RFID ${stats.arrivalMedianHours}h después de RESDES`}
                badge={{ label: `${stats.arrivalPairs} pares`, color: stats.arrivalMedianHours < 0 ? 'green' : 'amber' }}
              />
            </div>

            {/* KPI row 2 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                title="Solo RFID"
                value={stats.rfidOnly.toLocaleString()}
                subtitle="Sin coincidencia EDI"
                badge={{ label: `${Math.round((stats.rfidOnly / stats.totalReceptacles) * 100)}%`, color: 'amber' }}
              />
              <KpiCard
                title="Solo EDI"
                value={stats.ediOnly.toLocaleString()}
                subtitle="Sin lectura RFID"
                badge={{ label: `${Math.round((stats.ediOnly / stats.totalReceptacles) * 100)}%`, color: 'slate' }}
              />
              <KpiCard
                title="Rutas Validadas"
                value={stats.transitPairs.toLocaleString()}
                subtitle="RFID origen→destino completo"
                badge={{ label: 'extremo a extremo', color: 'blue' }}
              />
              <KpiCard
                title="Diferencia Tránsito"
                value={`${stats.transitDiffMedian > 0 ? '+' : ''}${stats.transitDiffMedian}h`}
                subtitle="EDI vs RFID tránsito mediano"
                badge={{ label: stats.transitDiffMedian > 0 ? 'EDI más largo' : 'RFID más largo', color: stats.transitDiffMedian > 0 ? 'amber' : 'green' }}
              />
            </div>

            {/* Quick charts */}
            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Distribución de Cobertura" subtitle="Clasificación de receptáculos por disponibilidad de datos">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={stats.coverageBreakdown}
                      dataKey="count"
                      nameKey="type"
                      cx="50%"
                      cy="50%"
                      outerRadius={82}
                      innerRadius={48}
                      paddingAngle={2}
                    >
                      {stats.coverageBreakdown.map(e => (
                        <Cell key={e.type} fill={COVERAGE_FILL[e.type]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any, n: any) => [v.toLocaleString(), COVERAGE_LABEL[n] || n]} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      formatter={v => <span className="text-xs text-slate-600">{COVERAGE_LABEL[v] || v}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Lag de Salida por País de Origen" subtitle="Mediana de horas entre PREDES y primera lectura RFID">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stats.byOriginCountry} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="country" tick={{ fontSize: 11 }} width={85} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="medianDepartureLag" name="Lag mediano (horas)" fill={C.indigo} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="medianDepartureLag" position="right" formatter={(v: number) => `${v.toFixed(0)}h`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Scatter: departure lag vs arrival lead */}
            {scatterData.length > 0 && (
              <ChartCard
                title="Correlación: Lag de Salida vs Lead de Llegada"
                subtitle={`${scatterData.length} receptáculos con cobertura FULL — cada punto es un receptáculo`}
              >
                <ResponsiveContainer width="100%" height={280}>
                  <ScatterChart margin={{ left: 10, right: 20, top: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Lag salida"
                      tick={{ fontSize: 10 }}
                      tickFormatter={v => `${v}h`}
                      label={{ value: 'Lag salida (h)', position: 'insideBottom', offset: -5, style: { fontSize: 10, fill: '#94a3b8' } }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Lead llegada"
                      tick={{ fontSize: 10 }}
                      tickFormatter={v => `${v}h`}
                      label={{ value: 'Lead llegada (h)', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }}
                    />
                    <ZAxis range={[20, 20]} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2" />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 2" />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="bg-white border border-slate-200 rounded-lg shadow p-2.5 text-xs">
                            <p className="mono-value text-slate-600 truncate max-w-[180px]">{d.s9id}</p>
                            <p className="text-slate-700 mt-1">Lag salida: <strong>{d.x.toFixed(1)}h</strong></p>
                            <p className="text-slate-700">Lead llegada: <strong>{d.y.toFixed(1)}h</strong></p>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={scatterData} fill={C.indigo} fillOpacity={0.35} />
                  </ScatterChart>
                </ResponsiveContainer>
                <p className="text-[10px] text-slate-400 mt-2 text-center">
                  Cuadrante superior-derecho: RFID tarde en salida Y tarde en llegada · Cuadrante inferior-izquierdo: RFID temprano en ambos
                </p>
              </ChartCard>
            )}
          </Section>
        )}

        {/* ════════════════════ COVERAGE ════════════════════ */}
        {activeTab === 'Coverage' && (
          <Section
            title="Análisis de Cobertura"
            subtitle={`Clasificación de los ${stats.totalReceptacles.toLocaleString()} receptáculos por disponibilidad de datos RFID y EDI`}
          >
            {/* Coverage cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {stats.coverageBreakdown.map(c => (
                <div key={c.type} className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm text-center">
                  <div className="kpi-number text-2xl mb-1" style={{ color: COVERAGE_FILL[c.type] }}>
                    {c.count.toLocaleString()}
                  </div>
                  <div className="text-sm font-bold text-slate-700 mb-1">{c.pct}%</div>
                  <div className="text-[10px] text-slate-400 leading-tight">{COVERAGE_LABEL[c.type]}</div>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Distribución de Cobertura" subtitle="Proporción de cada tipo de cobertura">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={stats.coverageBreakdown}
                      dataKey="count"
                      nameKey="type"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      innerRadius={55}
                      paddingAngle={2}
                      label={({ type, pct }) => `${pct}%`}
                      labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                    >
                      {stats.coverageBreakdown.map(e => (
                        <Cell key={e.type} fill={COVERAGE_FILL[e.type]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any, n: any) => [v.toLocaleString(), COVERAGE_LABEL[n] || n]} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      formatter={v => <span className="text-xs text-slate-600">{COVERAGE_LABEL[v] || v}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Nota Metodológica" subtitle="Cómo se establece la correspondencia RFID-EDI">
                <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
                  <p>
                    Cada receptáculo (<span className="mono-value bg-slate-100 px-1 rounded">s9id</span>) se clasifica en una de cinco categorías según la disponibilidad de lecturas RFID en <span className="font-semibold">datos EPCIS</span> y mensajes EDI en <span className="font-semibold">datos EDI</span>.
                  </p>
                  <p>
                    La correspondencia entre sistemas se establece a través de la tabla <span className="font-semibold">ID Relation</span>: el <span className="mono-value bg-slate-100 px-1 rounded">tag_id</span> en EPCIS corresponde al <span className="mono-value bg-slate-100 px-1 rounded">tagid</span> en ID Relation (con normalización de prefijos), y el <span className="mono-value bg-slate-100 px-1 rounded">s9id</span> en ID Relation corresponde al <span className="mono-value bg-slate-100 px-1 rounded">ean</span> en datos EDI.
                  </p>
                  <p>
                    La <span className="font-semibold text-emerald-700">cobertura FULL</span> ({stats.fullCoverage.toLocaleString()} receptáculos, {Math.round((stats.fullCoverage / stats.totalReceptacles) * 100)}%) permite la comparación temporal completa entre la detección física RFID y las declaraciones administrativas EDI.
                  </p>
                  <p>
                    La categoría <span className="font-semibold text-slate-600">Solo EDI</span> ({stats.ediOnly.toLocaleString()} receptáculos) representa flujos donde el operador postal transmite mensajes EDI pero el receptáculo no pasó por ningún centro equipado con RFID en este conjunto de datos.
                  </p>
                  <div className="bg-slate-50 rounded-md p-3 mt-2">
                    <p className="font-semibold text-slate-700 mb-1">Regla de primer/último centro:</p>
                    <p>Para la reconstrucción del trayecto, se usa el primer centro RFID como origen y el último como destino. Los centros intermedios se excluyen del análisis de tránsito.</p>
                  </div>
                </div>
              </ChartCard>
            </div>
          </Section>
        )}

        {/* ════════════════════ DEPARTURE ════════════════════ */}
        {activeTab === 'Departure' && (
          <Section
            title="Evento de Salida: RFID vs PREDES"
            subtitle="Comparación de la primera lectura RFID en el centro de origen con el mensaje PREDES (pre-aviso de despacho). Valores positivos = RFID detectado DESPUÉS del PREDES."
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                title="Pares Analizados"
                value={stats.departurePairs.toLocaleString()}
                subtitle="RFID + PREDES coincidentes"
                badge={{ label: 'salida', color: 'blue' }}
              />
              <KpiCard
                title="Lag Mediano"
                value={`+${stats.departureMedianHours}h`}
                subtitle={`${(stats.departureMedianHours / 24).toFixed(1)} días`}
                badge={{ label: 'RFID después de PREDES', color: 'amber' }}
              />
              <KpiCard
                title="Rango IQR"
                value={`${stats.departureP25}h – ${stats.departureP75}h`}
                subtitle="Percentil 25 – 75"
                badge={{ label: 'IQR', color: 'slate' }}
              />
              <KpiCard
                title="RFID Antes de PREDES"
                value={`${stats.departureRfidBeforePct}%`}
                subtitle={`${stats.departureRfidBefore} casos anómalos`}
                badge={{ label: stats.departureRfidBeforePct < 10 ? 'Normal' : 'Revisar', color: stats.departureRfidBeforePct < 10 ? 'green' : 'red' }}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard
                title="Lag de Salida por Centro de Origen"
                subtitle="Mediana de horas entre PREDES y primera lectura RFID"
              >
                <ResponsiveContainer width="100%" height={Math.max(220, stats.departureByCentre.length * 34)}>
                  <BarChart data={stats.departureByCentre} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={140} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="median" name="Lag mediano (horas)" fill={C.indigo} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="median" position="right" formatter={(v: number) => `${v.toFixed(0)}h`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title="Tasa RFID Antes de PREDES por Centro"
                subtitle="% de casos donde RFID fue detectado antes de que se emitiera el PREDES"
              >
                <ResponsiveContainer width="100%" height={Math.max(220, stats.departureByCentre.length * 34)}>
                  <BarChart data={stats.departureByCentre} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={140} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="rfidBeforePct" name="RFID antes de PREDES (%)" fill={C.rose} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="rfidBeforePct" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <InfoBox color="indigo">
              <span className="font-semibold">Interpretación:</span> El mensaje PREDES es emitido por el operador postal de origen cuando el despacho está administrativamente preparado, típicamente 2–3 días antes de que el receptáculo parta físicamente. El lag mediano de <strong>+{stats.departureMedianHours}h</strong> es operacionalmente consistente con este flujo de trabajo. Los casos donde RFID precede a PREDES ({stats.departureRfidBeforePct}%) pueden indicar retrasos en la transmisión EDI o inconsistencias en los timestamps.
            </InfoBox>
          </Section>
        )}

        {/* ════════════════════ ARRIVAL ════════════════════ */}
        {activeTab === 'Arrival' && (
          <Section
            title="Evento de Llegada: RFID vs RESDES"
            subtitle="Comparación de la última lectura RFID en el centro de destino con el mensaje RESDES (aviso de recepción). Valores negativos = RFID detectado ANTES del RESDES (ventaja de tiempo real)."
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                title="Pares Analizados"
                value={stats.arrivalPairs.toLocaleString()}
                subtitle="RFID + RESDES coincidentes"
                badge={{ label: 'llegada', color: 'green' }}
              />
              <KpiCard
                title="Lead/Lag Mediano"
                value={`${stats.arrivalMedianHours < 0 ? '' : '+'}${stats.arrivalMedianHours.toFixed(1)}h`}
                subtitle={stats.arrivalMedianHours < 0
                  ? `RFID ${Math.abs(stats.arrivalMedianHours).toFixed(1)}h antes de RESDES`
                  : `RFID ${stats.arrivalMedianHours.toFixed(1)}h después de RESDES`}
                badge={{ label: stats.arrivalMedianHours < 0 ? 'ventaja RFID' : 'EDI más rápido', color: stats.arrivalMedianHours < 0 ? 'green' : 'amber' }}
              />
              <KpiCard
                title="RFID Antes de RESDES"
                value={`${stats.arrivalRfidBeforePct}%`}
                subtitle={`${stats.arrivalRfidBefore} casos`}
                badge={{ label: 'visibilidad en tiempo real', color: 'green' }}
              />
              <KpiCard
                title="RFID Después de RESDES"
                value={`${100 - stats.arrivalRfidBeforePct}%`}
                subtitle="EDI más rápido que RFID"
                badge={{ label: 'revisar', color: 'amber' }}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard
                title="Lead/Lag de Llegada por Centro de Destino"
                subtitle="Mediana de horas (negativo = RFID antes de RESDES)"
              >
                <ResponsiveContainer width="100%" height={Math.max(220, stats.arrivalByCentre.length * 34)}>
                  <BarChart data={stats.arrivalByCentre} layout="vertical" margin={{ left: 0, right: 55, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={145} />
                    <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="4 2" />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="median" name="Lead/Lag mediano (horas)" radius={[0, 3, 3, 0]}>
                      {stats.arrivalByCentre.map((entry, i) => (
                        <Cell key={i} fill={entry.median < 0 ? C.emerald : C.amber} />
                      ))}
                      <LabelList dataKey="median" position="right" formatter={(v: number) => `${v.toFixed(0)}h`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard
                title="Tasa RFID Antes de RESDES por Destino"
                subtitle="% de llegadas donde RFID fue detectado antes del RESDES"
              >
                <ResponsiveContainer width="100%" height={Math.max(220, stats.arrivalByCentre.length * 34)}>
                  <BarChart data={stats.arrivalByCentre} layout="vertical" margin={{ left: 0, right: 50, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                    <YAxis type="category" dataKey="centre" tick={{ fontSize: 10 }} width={145} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="rfidBeforePct" name="RFID antes de RESDES (%)" fill={C.emerald} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="rfidBeforePct" position="right" formatter={(v: number) => `${v}%`} style={{ fontSize: 10, fill: '#64748b' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <InfoBox color="emerald">
              <span className="font-semibold">Hallazgo clave:</span> En <strong>{stats.arrivalRfidBeforePct}%</strong> de los eventos de llegada, el sistema RFID detecta el receptáculo <em>antes</em> de que se genere el mensaje RESDES. Esto representa la ventaja medible de visibilidad en tiempo real del RFID sobre el EDI en el centro de destino — el lead time mediano es de <strong>{Math.abs(stats.arrivalMedianHours).toFixed(1)} horas</strong>.
            </InfoBox>
          </Section>
        )}

        {/* ════════════════════ TRANSIT ════════════════════ */}
        {activeTab === 'Transit' && (
          <Section
            title="Comparación de Tiempo de Tránsito"
            subtitle="Para receptáculos con lecturas RFID en centros de origen Y destino: comparación del tránsito físico (RFID) vs tránsito declarado (EDI: RESDES − PREDES)."
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard
                title="Rutas Validadas"
                value={stats.transitPairs.toLocaleString()}
                subtitle="RFID origen→destino completo"
                badge={{ label: 'extremo a extremo', color: 'blue' }}
              />
              <KpiCard
                title="Tránsito RFID Mediano"
                value={`${stats.rfidTransitMedian}h`}
                subtitle={`${(stats.rfidTransitMedian / 24).toFixed(1)} días físico`}
                badge={{ label: 'físico', color: 'blue' }}
              />
              <KpiCard
                title="Tránsito EDI Mediano"
                value={`${stats.ediTransitMedian}h`}
                subtitle={`${(stats.ediTransitMedian / 24).toFixed(1)} días declarado`}
                badge={{ label: 'declarado', color: 'slate' }}
              />
              <KpiCard
                title="Sobreestimación EDI"
                value={`${stats.transitDiffMedian > 0 ? '+' : ''}${stats.transitDiffMedian}h`}
                subtitle="Diferencia EDI vs RFID"
                badge={{ label: stats.transitDiffMedian > 0 ? 'EDI más largo' : 'RFID más largo', color: stats.transitDiffMedian > 0 ? 'amber' : 'green' }}
              />
            </div>

            {stats.transitRoutes.length > 0 ? (
              <ChartCard
                title="Comparación de Tránsito por Ruta"
                subtitle="Tránsito físico RFID vs tránsito declarado EDI (horas medianas)"
              >
                <ResponsiveContainer width="100%" height={Math.max(200, stats.transitRoutes.length * 60)}>
                  <BarChart
                    data={stats.transitRoutes}
                    layout="vertical"
                    margin={{ left: 0, right: 65, top: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}h`} />
                    <YAxis type="category" dataKey="route" tick={{ fontSize: 10 }} width={185} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                    <Bar dataKey="rfidMedian" name="RFID Físico (h)" fill={C.indigo} radius={[0, 2, 2, 0]} barSize={13}>
                      <LabelList dataKey="rfidMedian" position="right" formatter={(v: number) => `${v.toFixed(0)}h`} style={{ fontSize: 10, fill: C.indigo }} />
                    </Bar>
                    <Bar dataKey="ediMedian" name="EDI Declarado (h)" fill={C.slate} radius={[0, 2, 2, 0]} barSize={13}>
                      <LabelList dataKey="ediMedian" position="right" formatter={(v: number) => `${v.toFixed(0)}h`} style={{ fontSize: 10, fill: C.slate }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
                <p className="font-semibold text-amber-800 text-sm mb-1">Datos de tránsito limitados</p>
                <p className="text-xs text-amber-700 leading-relaxed">
                  El conjunto de datos actual contiene lectores RFID principalmente en centros de origen. La medición del tránsito extremo a extremo requiere cobertura RFID tanto en origen como en destino. Solo se encontraron {stats.transitPairs} rutas completamente validadas.
                </p>
              </div>
            )}

            <InfoBox color="indigo">
              <span className="font-semibold">Metodología:</span> El tiempo de tránsito físico se mide como la diferencia entre la última lectura RFID en el centro de origen y la primera lectura RFID en el centro de destino (solo centros diferentes, paradas intermedias excluidas). El tránsito EDI es el timestamp RESDES menos el timestamp PREDES. Solo se incluyen rutas con <span className="mono-value bg-white/60 px-1 rounded">full_route_validated = true</span>.
            </InfoBox>
          </Section>
        )}

        {/* ════════════════════ DATA TABLE ════════════════════ */}
        {activeTab === 'Data' && (
          <Section
            title="Datos Detallados"
            subtitle={`Todos los ${stats.totalReceptacles.toLocaleString()} receptáculos de la tabla tracking_events con métricas pre-calculadas`}
          >
            {/* Filter buttons */}
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'ALL', label: 'Todos' },
                { key: 'FULL', label: 'FULL' },
                { key: 'RFID_ONLY', label: 'Solo RFID' },
                { key: 'EDI_ONLY', label: 'Solo EDI' },
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

            <DataTable events={events} filterCoverage={tableFilter} />
          </Section>
        )}

      </main>

      {/* ─── Footer ─── */}
      <footer className="border-t border-slate-200 bg-white mt-10">
        <div className="container py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>EDGE RFID-EDI Analysis Dashboard · Dic 2025 – Mar 2026</span>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            Conectado a Supabase · tracking_events · {stats.totalReceptacles.toLocaleString()} registros
          </span>
        </div>
      </footer>
    </div>
  );
}
