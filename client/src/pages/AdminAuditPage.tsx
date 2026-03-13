/**
 * AdminAuditPage — Panel de administración del Audit de Carga de Datos.
 * Solo accesible para usuarios con role = 'admin'.
 * Secciones: Dashboard resumen | Registro de Audit | Revisión de Maestros
 *
 * Design: Operational Intelligence — white + slate + indigo accent
 * Font: DM Sans (body) + Inter (headings/numbers) — consistente con Home.tsx
 */
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditLog, useMasterPending } from '@/hooks/useAuditData';
import type { AuditLogEntry, MasterPendingEntry } from '@/hooks/useAuditData';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

// ── Helpers ────────────────────────────────────────────────────────────────
const SEVERITY_COLOR: Record<string, string> = {
  CRITICO: 'bg-red-100 text-red-700 border-red-200',
  ALTO:    'bg-orange-100 text-orange-700 border-orange-200',
  MEDIO:   'bg-amber-100 text-amber-700 border-amber-200',
  BAJO:    'bg-slate-100 text-slate-600 border-slate-200',
};
const SEVERITY_DOT: Record<string, string> = {
  CRITICO: 'bg-red-500',
  ALTO:    'bg-orange-500',
  MEDIO:   'bg-amber-400',
  BAJO:    'bg-slate-400',
};
const RESOLUTION_LABEL: Record<string, string> = {
  SEND_TO_LOG:    'Pendiente decisión',
  AUTO_CORRECTED: 'Auto-corregido',
  PENDING_REVIEW: 'En revisión',
  INFORMATIVO:    'Informativo',
};
const CATEGORY_LABEL: Record<string, string> = {
  IMPC_MISMATCH:       'IMPC Mismatch',
  OUTLIER_TEMPORAL:    'Outlier Temporal',
  MAESTRO_AUSENTE:     'Maestro Ausente',
  CASE_NORMALIZATION:  'Normalización Case',
};
const CATEGORY_DESC: Record<string, string> = {
  IMPC_MISMATCH:      'El código IMPC registrado en la lectura RFID no coincide con el que indica el S9ID. La fuente de verdad es el S9ID. Los registros auto-corregidos ya han sido ajustados; los pendientes requieren decisión manual.',
  OUTLIER_TEMPORAL:   'El tiempo registrado (departure lag, arrival lead o tránsito EDI) se desvía significativamente de la mediana del grupo (centro o ruta). Estos registros son candidatos a ser eliminados de los datos operativos para que NO distorsionen los informes de benchmark de comparación entre RFID y EDI. Causas habituales: error de captura de timestamp, problema de zona horaria en el centro de origen, o caso genuinamente atípico que requiere investigación.',
  MAESTRO_AUSENTE:    'El código IMPC aparece en los datos operativos (EDI o RFID) pero no existe en la tabla de centros postales (postal_centers). Puede ser un centro nuevo, un código mal escrito o un alias no registrado.',
  CASE_NORMALIZATION: 'El código IMPC está escrito en minúsculas o con formato incorrecto en los datos de origen. Se propone normalizar a mayúsculas para mantener la consistencia con el maestro.',
};
// ── Contexto explicativo por tipo de outlier temporal ────────────────────
function getOutlierContext(entry: AuditLogEntry): { label: string; detail: string } | null {
  if (entry.audit_category !== 'OUTLIER_TEMPORAL') return null;
  const val = entry.original_value ? parseFloat(entry.original_value) : null;
  const valStr = val !== null ? `${val > 0 ? '+' : ''}${val.toFixed(2)}h` : '—';
  const group = entry.group_context || '—';
  const flag = entry.outlier_flag || '';

  if (entry.audit_check === 'DEPARTURE_LAG_OUTLIER') {
    if (flag === 'NEGATIVO') {
      return {
        label: 'Lag salida negativo',
        detail: `La lectura RFID en ${group} ocurrió ${Math.abs(val || 0).toFixed(2)}h ANTES del PREDES (${valStr}). Posible error de zona horaria en el centro de origen.`,
      };
    }
    return {
      label: 'Lag salida outlier',
      detail: `Tiempo entre PREDES y lectura RFID de origen en ${group}: ${valStr}. Se desvía del rango normal del centro.`,
    };
  }
  if (entry.audit_check === 'ARRIVAL_LEAD_OUTLIER') {
    if (flag === 'NEGATIVO') {
      return {
        label: 'Lead llegada negativo',
        detail: `La lectura RFID de destino en ${group} ocurrió ${Math.abs(val || 0).toFixed(2)}h ANTES del REDES (${valStr}). Posible error de captura.`,
      };
    }
    return {
      label: 'Lead llegada outlier',
      detail: `Tiempo entre lectura RFID de destino y REDES en ruta ${group}: ${valStr}. Se desvía del rango normal de la ruta.`,
    };
  }
  if (entry.audit_check === 'EDI_TRANSIT_OUTLIER') {
    return {
      label: 'Tránsito EDI outlier',
      detail: `Tiempo de tránsito EDI (PREDES→REDES) en ruta ${group}: ${valStr}. Se desvía del rango normal de esa ruta. Excluir para no distorsionar el benchmark RFID vs EDI.`,
    };
  }
  return null;
}

const ACTION_LABEL: Record<string, string> = {
  ALTA:               'Alta nueva',
  CORRECCION:         'Corrección',
  NORMALIZACION_CASE: 'Normalización',
  INACTIVO:           'Inactivo',
};
const STATUS_COLOR: Record<string, string> = {
  PENDIENTE: 'bg-amber-100 text-amber-700 border-amber-200',
  APROBADO:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  RECHAZADO: 'bg-red-100 text-red-700 border-red-200',
  APLICADO:  'bg-blue-100 text-blue-700 border-blue-200',
};
const CONFIDENCE_COLOR: Record<string, string> = {
  ALTA:  'text-emerald-600',
  MEDIA: 'text-amber-600',
  BAJA:  'text-red-500',
};

function Badge({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>
      {text}
    </span>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color || 'text-slate-800'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── Sección: Dashboard ─────────────────────────────────────────────────────
function DashboardSection({ summary, masterPendingCount }: {
  summary: ReturnType<typeof useAuditLog>['summary'];
  masterPendingCount: number;
}) {
  if (!summary) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <svg className="w-12 h-12 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm">No hay ejecuciones de audit registradas aún.</p>
        <p className="text-xs mt-1 text-slate-300">Ejecuta el script de audit para ver los resultados aquí.</p>
      </div>
    );
  }

  const runDate = new Date(summary.run_at).toLocaleString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  return (
    <div className="space-y-6">
      {/* Header de la última ejecución */}
      <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-3">
        <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
        <div>
          <p className="text-sm font-semibold text-indigo-800">Última ejecución del Audit</p>
          <p className="text-xs text-indigo-500">{runDate} · Run ID: <span className="font-mono">{summary.run_id.slice(0, 8)}…</span></p>
        </div>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total incidencias" value={summary.total_entries} />
        <KpiCard label="Pendientes decisión" value={summary.pending_decision}
          color={summary.pending_decision > 0 ? 'text-red-600' : 'text-emerald-600'}
          sub={summary.pending_decision > 0 ? 'Requieren acción' : 'Todo revisado'} />
        <KpiCard label="Auto-corregidos" value={summary.auto_corrected} color="text-emerald-600" />
        <KpiCard label="Maestros pendientes" value={masterPendingCount}
          color={masterPendingCount > 0 ? 'text-amber-600' : 'text-emerald-600'} />
      </div>

      {/* Distribución por severidad */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Por severidad</h3>
          <div className="space-y-2.5">
            {(['CRITICO', 'ALTO', 'MEDIO', 'BAJO'] as const).map(sev => {
              const count = summary.by_severity[sev] || 0;
              const pct = summary.total_entries > 0 ? (count / summary.total_entries) * 100 : 0;
              return (
                <div key={sev} className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[sev]}`} />
                  <span className="text-xs text-slate-600 w-16">{sev}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-indigo-500 transition-all"
                      style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Por categoría</h3>
          <div className="space-y-2.5">
            {Object.entries(CATEGORY_LABEL).map(([key, label]) => {
              const count = summary.by_category[key] || 0;
              const pct = summary.total_entries > 0 ? (count / summary.total_entries) * 100 : 0;
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full flex-shrink-0 bg-indigo-400" />
                  <span className="text-xs text-slate-600 flex-1 truncate">{label}</span>
                  <div className="w-20 bg-slate-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-indigo-400 transition-all"
                      style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Detalle de entrada de audit ────────────────────────────────────
function AuditDetailModal({
  entry,
  onClose,
  onDecision,
  reviewerEmail,
}: {
  entry: AuditLogEntry;
  onClose: () => void;
  onDecision: (id: string, decision: 'KEEP' | 'DELETE', notes: string) => Promise<void>;
  reviewerEmail: string;
}) {
  const [notes, setNotes] = useState(entry.admin_notes || '');
  const [saving, setSaving] = useState(false);

  const handleDecision = async (decision: 'KEEP' | 'DELETE') => {
    setSaving(true);
    await onDecision(entry.id, decision, notes);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge text={entry.severity} className={SEVERITY_COLOR[entry.severity]} />
              <Badge text={CATEGORY_LABEL[entry.audit_category]} className="bg-indigo-50 text-indigo-700 border-indigo-100" />
            </div>
            <h2 className="text-base font-semibold text-slate-800 mt-2">{entry.audit_check}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-4 mt-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Cuerpo */}
        <div className="p-6 space-y-4">
          {/* Datos del registro */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {entry.source_s9id && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">S9ID</p>
                <p className="font-mono text-slate-700 text-xs bg-slate-50 rounded px-2 py-1">{entry.source_s9id}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Tabla origen</p>
              <p className="font-mono text-slate-700 text-xs bg-slate-50 rounded px-2 py-1">{entry.source_table}</p>
            </div>
            {entry.field_name && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Campo</p>
                <p className="font-mono text-slate-700 text-xs bg-slate-50 rounded px-2 py-1">{entry.field_name}</p>
              </div>
            )}
            {entry.original_value && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Valor original</p>
                <p className="font-mono text-red-600 text-xs bg-red-50 rounded px-2 py-1">{entry.original_value}</p>
              </div>
            )}
            {entry.corrected_value && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Valor corregido</p>
                <p className="font-mono text-emerald-700 text-xs bg-emerald-50 rounded px-2 py-1">{entry.corrected_value}</p>
              </div>
            )}
          </div>

          {/* Contexto IQR */}
          {entry.group_context && (
            <div className="bg-slate-50 rounded-lg p-3 text-xs">
              <p className="font-semibold text-slate-600 mb-1.5">Contexto del grupo dinámico</p>
              <p className="text-slate-500 mb-2">{entry.group_context}</p>
              {(entry.group_median !== null && entry.group_median !== undefined) && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-white rounded p-1.5 border border-slate-200">
                    <p className="text-slate-400 text-[10px]">Límite inferior</p>
                    <p className="font-semibold text-slate-700">{entry.group_iqr_low?.toFixed(1)}h</p>
                  </div>
                  <div className="bg-indigo-50 rounded p-1.5 border border-indigo-100">
                    <p className="text-indigo-400 text-[10px]">Mediana</p>
                    <p className="font-semibold text-indigo-700">{entry.group_median?.toFixed(1)}h</p>
                  </div>
                  <div className="bg-white rounded p-1.5 border border-slate-200">
                    <p className="text-slate-400 text-[10px]">Límite superior</p>
                    <p className="font-semibold text-slate-700">{entry.group_iqr_high?.toFixed(1)}h</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notas del audit */}
          {entry.notes && (
            <div className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg p-3">
              <span className="font-semibold text-amber-700">Nota: </span>{entry.notes}
            </div>
          )}

          {/* Resolución actual */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Resolución:</span>
            <Badge text={RESOLUTION_LABEL[entry.resolution]}
              className={entry.resolution === 'AUTO_CORRECTED'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                : 'bg-amber-50 text-amber-700 border-amber-100'} />
          </div>

          {/* Decisión previa */}
          {entry.admin_decision && (
            <div className="bg-slate-50 rounded-lg p-3 text-xs">
              <p className="font-semibold text-slate-600 mb-1">Decisión anterior</p>
              <p className="text-slate-500">
                <span className={entry.admin_decision === 'DELETE' ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'}>
                  {entry.admin_decision === 'DELETE' ? 'Eliminar' : 'Mantener'}
                </span>
                {entry.admin_reviewed_by && ` · por ${entry.admin_reviewed_by}`}
                {entry.admin_reviewed_at && ` · ${new Date(entry.admin_reviewed_at).toLocaleDateString('es-ES')}`}
              </p>
              {entry.admin_notes && <p className="text-slate-400 mt-1 italic">"{entry.admin_notes}"</p>}
            </div>
          )}

          {/* Notas del admin */}
          {entry.resolution === 'SEND_TO_LOG' && (
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Notas (opcional)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Añade una nota sobre esta decisión..."
                className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-700"
              />
            </div>
          )}
        </div>

        {/* Footer con acciones */}
        {entry.resolution === 'SEND_TO_LOG' && (
          <div className="flex gap-3 p-6 pt-0">
            <button
              onClick={() => handleDecision('DELETE')}
              disabled={saving}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Eliminar de operativos'}
            </button>
            <button
              onClick={() => handleDecision('KEEP')}
              disabled={saving}
              className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Mantener'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sección: Registro de Audit ──────────────────────────────────────────────────────────────────────────────────
type SortField = 'severity' | 'audit_category' | 'source_s9id' | 'original_value' | 'admin_decision';
type SortDir = 'asc' | 'desc';
const SEVERITY_ORDER: Record<string, number> = { CRITICO: 0, ALTO: 1, MEDIO: 2, BAJO: 3 };

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className="ml-1 inline-flex flex-col gap-[1px] align-middle">
      <svg className={`w-2 h-2 ${active && dir === 'asc' ? 'text-indigo-600 opacity-100' : 'opacity-30'}`} viewBox="0 0 8 5" fill="currentColor"><path d="M4 0L8 5H0z"/></svg>
      <svg className={`w-2 h-2 ${active && dir === 'desc' ? 'text-indigo-600 opacity-100' : 'opacity-30'}`} viewBox="0 0 8 5" fill="currentColor"><path d="M4 5L0 0h8z"/></svg>
    </span>
  );
}

function AuditLogSection({ user }: { user: { email?: string } }) {
  const { entries, loading, error, updateDecision, bulkUpdateDecision, refetch } = useAuditLog();
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL');
  const [filterResolution, setFilterResolution] = useState<string>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterDecision, setFilterDecision] = useState<string>('ALL');
  const [filterAuditCheck, setFilterAuditCheck] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('severity');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    const base = entries.filter(e => {
      if (filterSeverity !== 'ALL' && e.severity !== filterSeverity) return false;
      if (filterResolution !== 'ALL' && e.resolution !== filterResolution) return false;
      if (filterCategory !== 'ALL' && e.audit_category !== filterCategory) return false;
      if (filterAuditCheck !== 'ALL' && e.audit_check !== filterAuditCheck) return false;
      if (filterDecision === 'PENDING' && e.admin_decision !== null && e.admin_decision !== undefined) return false;
      if (filterDecision === 'KEEP' && e.admin_decision !== 'KEEP') return false;
      if (filterDecision === 'DELETE' && e.admin_decision !== 'DELETE') return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (e.source_s9id || '').toLowerCase().includes(q) ||
          (e.audit_check || '').toLowerCase().includes(q) ||
          (e.original_value || '').toLowerCase().includes(q) ||
          (e.notes || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
    // Ordenación bidireccional por columna
    return [...base].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'severity') {
        cmp = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
      } else if (sortField === 'audit_category') {
        cmp = (a.audit_category || '').localeCompare(b.audit_category || '');
      } else if (sortField === 'source_s9id') {
        cmp = (a.source_s9id || '').localeCompare(b.source_s9id || '');
      } else if (sortField === 'original_value') {
        // Ordenación numérica cuando el valor es un número (horas), alfabética en otro caso
        const numA = parseFloat(a.original_value || '');
        const numB = parseFloat(b.original_value || '');
        if (!isNaN(numA) && !isNaN(numB)) {
          cmp = numA - numB;
        } else {
          cmp = (a.original_value || '').localeCompare(b.original_value || '');
        }
      } else if (sortField === 'admin_decision') {
        cmp = (a.admin_decision || 'z').localeCompare(b.admin_decision || 'z');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [entries, filterSeverity, filterResolution, filterCategory, filterDecision, filterAuditCheck, search, sortField, sortDir]);

  const handleDecision = async (id: string, decision: 'KEEP' | 'DELETE', notes: string) => {
    const { error: err } = await updateDecision(id, decision, notes, user.email || 'admin');
    if (err) toast.error(`Error: ${err}`);
    else toast.success(decision === 'DELETE' ? 'Registro marcado para eliminar' : 'Registro marcado para mantener');
  };

  const handleBulkDecision = async (decision: 'KEEP' | 'DELETE') => {
    if (selectedIds.size === 0) return;
    const { error: err } = await bulkUpdateDecision([...selectedIds], decision, user.email || 'admin');
    if (err) toast.error(`Error: ${err}`);
    else {
      toast.success(`${selectedIds.size} registros actualizados`);
      setSelectedIds(new Set());
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(e => e.id)));
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <svg className="animate-spin w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="ml-3 text-sm text-slate-500">Cargando registros…</span>
    </div>
  );

  if (error) return (
    <div className="text-center py-10 text-red-500 text-sm">Error al cargar: {error}</div>
  );

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Buscar por S9ID, descripción…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 w-56 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="ALL">Todas las severidades</option>
          <option value="CRITICO">Crítico</option>
          <option value="ALTO">Alto</option>
          <option value="MEDIO">Medio</option>
          <option value="BAJO">Bajo</option>
        </select>
        <div className="flex flex-col gap-1">
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="ALL">Todas las categorías</option>
            <option value="IMPC_MISMATCH">IMPC Mismatch</option>
            <option value="OUTLIER_TEMPORAL">Outlier Temporal</option>
            <option value="MAESTRO_AUSENTE">Maestro Ausente</option>
            <option value="CASE_NORMALIZATION">Normalización Case</option>
          </select>
          {filterCategory !== 'ALL' && CATEGORY_DESC[filterCategory] && (
            <p className="text-xs text-slate-500 max-w-sm leading-relaxed bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
              <span className="font-semibold text-indigo-700">{CATEGORY_LABEL[filterCategory]}:</span>{' '}
              {CATEGORY_DESC[filterCategory]}
            </p>
          )}
        </div>
        {/* Subcategoría — se actualiza dinámicamente según la categoría seleccionada */}
        <div className="flex flex-col gap-1">
          <select
            value={filterAuditCheck}
            onChange={e => setFilterAuditCheck(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="ALL">Todas las subcategorías</option>
            {/* OUTLIER_TEMPORAL */}
            <option value="DEPARTURE_LAG_OUTLIER">Lag de salida (RFID vs PREDES)</option>
            <option value="ARRIVAL_LEAD_OUTLIER">Lead de llegada (RFID vs REDES)</option>
            <option value="EDI_TRANSIT_OUTLIER">Tránsito EDI (PREDES→REDES)</option>
            {/* IMPC_MISMATCH */}
            <option value="IMPC_MISMATCH_RFID">IMPC Mismatch RFID</option>
            <option value="IMPC_MISMATCH_INTERMEDIATE">IMPC Mismatch intermedio</option>
            {/* MAESTRO */}
            <option value="IMPC_NOT_IN_MASTER">IMPC no en maestro</option>
            <option value="CASE_NORMALIZATION">Normalización de case</option>
          </select>
          {filterAuditCheck !== 'ALL' && (() => {
            const desc: Record<string, string> = {
              DEPARTURE_LAG_OUTLIER: 'Diferencia entre la lectura RFID de origen y el PREDES. Solo se considera incidencia si |valor| ≥ 48h.',
              ARRIVAL_LEAD_OUTLIER: 'Diferencia entre la lectura RFID de destino y el REDES. Solo se considera incidencia si |valor| ≥ 48h.',
              EDI_TRANSIT_OUTLIER: 'Tiempo de tránsito EDI (PREDES→REDES) por ruta. Outliers que distorsionan el benchmark RFID vs EDI.',
              IMPC_MISMATCH_RFID: 'El impc_code de la lectura RFID no coincide con el IMPC que indica el s9id. Fuente de verdad: s9id.',
              IMPC_MISMATCH_INTERMEDIATE: 'Lecturas RFID intermedias cuyo IMPC no puede determinarse automáticamente.',
              IMPC_NOT_IN_MASTER: 'Código IMPC presente en datos operativos pero ausente en postal_centers.',
              CASE_NORMALIZATION: 'Código IMPC en minúsculas en los datos de origen. Propuesta de normalización a mayúsculas.',
            };
            return desc[filterAuditCheck] ? (
              <p className="text-xs text-slate-500 max-w-sm leading-relaxed bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <span className="font-semibold text-amber-700">Subcategoría:</span>{' '}{desc[filterAuditCheck]}
              </p>
            ) : null;
          })()}
        </div>

        <select value={filterDecision} onChange={e => setFilterDecision(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="ALL">Todas las decisiones</option>
          <option value="PENDING">Sin decisión</option>
          <option value="KEEP">Mantener</option>
          <option value="DELETE">Eliminar</option>
        </select>
        <button onClick={refetch}
          className="ml-auto text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 border border-indigo-200 rounded-lg px-3 py-2">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualizar
        </button>
      </div>

      {/* Acciones masivas */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2.5">
          <span className="text-sm font-medium text-indigo-700">{selectedIds.size} seleccionados</span>
          <button onClick={() => handleBulkDecision('DELETE')}
            className="text-xs bg-red-500 text-white rounded-lg px-3 py-1.5 hover:bg-red-600 transition-colors">
            Eliminar todos
          </button>
          <button onClick={() => handleBulkDecision('KEEP')}
            className="text-xs bg-emerald-500 text-white rounded-lg px-3 py-1.5 hover:bg-emerald-600 transition-colors">
            Mantener todos
          </button>
          <button onClick={() => setSelectedIds(new Set())}
            className="text-xs text-slate-500 hover:text-slate-700 ml-auto">
            Cancelar
          </button>
        </div>
      )}

      {/* Contador */}
      <p className="text-xs text-slate-400">{filtered.length} registros {filtered.length !== entries.length ? `(de ${entries.length} totales)` : ''}</p>

      {/* Tabla */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          No hay registros que coincidan con los filtros.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left w-8">
                  <input type="checkbox"
                    checked={selectedIds.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-indigo-600" onClick={() => handleSort('severity')}>
                  Severidad <SortIcon active={sortField === 'severity'} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-indigo-600" onClick={() => handleSort('audit_category')}>
                  Categoría <SortIcon active={sortField === 'audit_category'} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Subcategoría / Centro</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Descripción</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-indigo-600" onClick={() => handleSort('source_s9id')}>
                  Identificador <SortIcon active={sortField === 'source_s9id'} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-indigo-600" onClick={() => handleSort('original_value')}>
                  Desviación <SortIcon active={sortField === 'original_value'} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-indigo-600" onClick={() => handleSort('admin_decision')}>
                  Decisión <SortIcon active={sortField === 'admin_decision'} dir={sortDir} />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(entry => (
                <tr key={entry.id}
                  className={`hover:bg-slate-50 transition-colors ${selectedIds.has(entry.id) ? 'bg-indigo-50/50' : ''}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox"
                      checked={selectedIds.has(entry.id)}
                      onChange={() => toggleSelect(entry.id)}
                      className="rounded border-slate-300" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[entry.severity]}`} />
                      <span className="text-xs font-medium text-slate-600">{entry.severity}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge text={CATEGORY_LABEL[entry.audit_category]}
                      className="bg-indigo-50 text-indigo-600 border-indigo-100 whitespace-nowrap" />
                  </td>
                  {/* Subcategoría / Centro */}
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-xs font-mono font-semibold text-slate-600">{entry.audit_check}</p>
                      {entry.group_context && (
                        <p className="text-xs text-slate-400 mt-0.5">{entry.group_context}</p>
                      )}
                    </div>
                  </td>
                  {/* Descripción contextual */}
                  <td className="px-4 py-3 max-w-[260px]">
                    {(() => {
                      const ctx = getOutlierContext(entry);
                      if (ctx) {
                        return <p className="text-xs text-slate-500 leading-snug">{ctx.detail}</p>;
                      }
                      return <p className="text-slate-500 text-xs">{entry.notes || '—'}</p>;
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const num = entry.original_value ? parseFloat(entry.original_value) : null;
                      if (num !== null && !isNaN(num)) {
                        const isNeg = num < 0;
                        return (
                          <span className={`font-mono text-xs font-semibold ${
                            isNeg ? 'text-red-600' : num > 100 ? 'text-orange-600' : 'text-slate-600'
                          }`}>
                            {num > 0 ? '+' : ''}{num.toFixed(2)}h
                          </span>
                        );
                      }
                      return <span className="font-mono text-xs text-slate-500">{entry.original_value || '—'}</span>;
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    {entry.admin_decision ? (
                      <Badge
                        text={entry.admin_decision === 'DELETE' ? 'Eliminar' : 'Mantener'}
                        className={entry.admin_decision === 'DELETE'
                          ? 'bg-red-50 text-red-600 border-red-100'
                          : 'bg-emerald-50 text-emerald-600 border-emerald-100'} />
                    ) : entry.resolution === 'SEND_TO_LOG' ? (
                      <Badge text="Sin decisión" className="bg-amber-50 text-amber-600 border-amber-100" />
                    ) : (
                      <Badge text={RESOLUTION_LABEL[entry.resolution]} className="bg-slate-50 text-slate-500 border-slate-100" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedEntry(entry)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium hover:underline">
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de detalle */}
      {selectedEntry && (
        <AuditDetailModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onDecision={handleDecision}
          reviewerEmail={user.email || 'admin'}
        />
      )}
    </div>
  );
}

// ── Modal: Detalle de maestro ──────────────────────────────────────────────
function MasterDetailModal({
  entry,
  onClose,
  onUpdate,
  reviewerEmail,
}: {
  entry: MasterPendingEntry;
  onClose: () => void;
  onUpdate: (id: string, status: 'APROBADO' | 'RECHAZADO', updates: any, reviewer: string) => Promise<void>;
  reviewerEmail: string;
}) {
  const [country, setCountry] = useState(entry.proposed_country || entry.current_country || '');
  const [centerName, setCenterName] = useState(entry.proposed_center_name || entry.current_center_name || '');
  const [notes, setNotes] = useState(entry.notes || '');
  const [saving, setSaving] = useState(false);

  const handleAction = async (status: 'APROBADO' | 'RECHAZADO') => {
    setSaving(true);
    await onUpdate(entry.id, status, { proposed_country: country, proposed_center_name: centerName, notes }, reviewerEmail);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between p-6 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge text={ACTION_LABEL[entry.action_type]} className="bg-indigo-50 text-indigo-700 border-indigo-100" />
              <span className={`text-xs font-semibold ${CONFIDENCE_COLOR[entry.confidence]}`}>
                Confianza {entry.confidence}
              </span>
            </div>
            <h2 className="text-base font-semibold text-slate-800 mt-1 font-mono">{entry.impc_code_normalized}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-4">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Frecuencias */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-400">En RFID</p>
              <p className="text-lg font-bold text-slate-700">{entry.freq_rfid}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-400">En tracking</p>
              <p className="text-lg font-bold text-slate-700">{entry.freq_te}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-400">En EDI</p>
              <p className="text-lg font-bold text-slate-700">{entry.freq_edi}</p>
            </div>
          </div>

          {/* Datos actuales */}
          {entry.current_center_name && (
            <div className="bg-slate-50 rounded-lg p-3 text-xs">
              <p className="font-semibold text-slate-600 mb-1">Datos actuales en maestro</p>
              <p className="text-slate-500">{entry.current_center_name} · {entry.current_country}</p>
            </div>
          )}

          {/* Variantes detectadas */}
          {entry.country_variants && (
            <div className="text-xs text-slate-500">
              <span className="font-medium text-slate-600">Variantes de país: </span>
              {entry.country_variants}
            </div>
          )}
          {entry.name_variants && (
            <div className="text-xs text-slate-500">
              <span className="font-medium text-slate-600">Variantes de nombre: </span>
              {entry.name_variants}
            </div>
          )}

          {/* Campos editables */}
          {entry.status === 'PENDIENTE' && (
            <>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">País propuesto</label>
                <input value={country} onChange={e => setCountry(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Nombre del centro propuesto</label>
                <input value={centerName} onChange={e => setCenterName(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Notas</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            </>
          )}

          {/* Estado si ya revisado */}
          {entry.status !== 'PENDIENTE' && (
            <div className="bg-slate-50 rounded-lg p-3 text-xs">
              <p className="font-semibold text-slate-600 mb-1">Revisado</p>
              <p className="text-slate-500">
                <Badge text={entry.status} className={STATUS_COLOR[entry.status]} />
                {entry.reviewed_by && ` · por ${entry.reviewed_by}`}
              </p>
            </div>
          )}
        </div>

        {entry.status === 'PENDIENTE' && (
          <div className="flex gap-3 p-6 pt-0">
            <button onClick={() => handleAction('RECHAZADO')} disabled={saving}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50">
              {saving ? 'Guardando…' : 'Rechazar'}
            </button>
            <button onClick={() => handleAction('APROBADO')} disabled={saving}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50">
              {saving ? 'Guardando…' : 'Aprobar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sección: Revisión de Maestros ──────────────────────────────────────────
function MasterReviewSection({ user }: { user: { email?: string } }) {
  const { entries, loading, error, updateStatus, refetch } = useMasterPending();
  const [selectedEntry, setSelectedEntry] = useState<MasterPendingEntry | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('PENDIENTE');
  const [filterAction, setFilterAction] = useState<string>('ALL');

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (filterStatus !== 'ALL' && e.status !== filterStatus) return false;
      if (filterAction !== 'ALL' && e.action_type !== filterAction) return false;
      return true;
    });
  }, [entries, filterStatus, filterAction]);

  const handleUpdate = async (id: string, status: 'APROBADO' | 'RECHAZADO', updates: any, reviewer: string) => {
    const { error: err } = await updateStatus(id, status, updates, reviewer);
    if (err) toast.error(`Error: ${err}`);
    else toast.success(status === 'APROBADO' ? 'Propuesta aprobada' : 'Propuesta rechazada');
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <svg className="animate-spin w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="ml-3 text-sm text-slate-500">Cargando propuestas…</span>
    </div>
  );

  if (error) return <div className="text-center py-10 text-red-500 text-sm">Error: {error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="ALL">Todos los estados</option>
          <option value="PENDIENTE">Pendiente</option>
          <option value="APROBADO">Aprobado</option>
          <option value="RECHAZADO">Rechazado</option>
          <option value="APLICADO">Aplicado</option>
        </select>
        <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
          <option value="ALL">Todas las acciones</option>
          <option value="ALTA">Alta nueva</option>
          <option value="CORRECCION">Corrección</option>
          <option value="NORMALIZACION_CASE">Normalización</option>
        </select>
        <button onClick={refetch}
          className="ml-auto text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 border border-indigo-200 rounded-lg px-3 py-2">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualizar
        </button>
      </div>

      <p className="text-xs text-slate-400">{filtered.length} propuestas</p>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          No hay propuestas que coincidan con los filtros.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">IMPC</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Acción</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">País propuesto</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Centro propuesto</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Confianza</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Estado</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(entry => (
                <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm font-semibold text-slate-700">{entry.impc_code_normalized}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge text={ACTION_LABEL[entry.action_type]} className="bg-indigo-50 text-indigo-600 border-indigo-100" />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{entry.proposed_country || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-600 max-w-[160px] truncate">{entry.proposed_center_name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold ${CONFIDENCE_COLOR[entry.confidence]}`}>{entry.confidence}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge text={entry.status} className={STATUS_COLOR[entry.status]} />
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setSelectedEntry(entry)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium hover:underline">
                      {entry.status === 'PENDIENTE' ? 'Revisar' : 'Ver detalle'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedEntry && (
        <MasterDetailModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onUpdate={handleUpdate}
          reviewerEmail={user.email || 'admin'}
        />
      )}
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────
// ── Componente: Carga RFID ────────────────────────────────────────────────
// URL de la Supabase Edge Function del ETL RFID
const EDGE_FUNCTION_URL = 'https://ewyhmmixqcubqokphebh.supabase.co/functions/v1/process-rfid-etl';

interface EtlResult {
  success: boolean;
  etl_run_id?: string;
  mode?: string;
  staged?: number;
  enriched?: number;
  loaded?: number;
  issues?: number;
  duration_ms?: number;
  message?: string;
  error?: string;
}

function RfidUploadSection() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState<EtlResult | null>(null);

  const getToken = async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setLastResult(null);
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data: EtlResult = await res.json();
      setLastResult(data);
      if (data.success) {
        const secs = data.duration_ms ? (data.duration_ms / 1000).toFixed(1) : '?';
        toast.success(`ETL completado: ${data.loaded ?? 0} registros cargados en ${secs}s`);
        setFile(null);
      } else {
        toast.error(data.error || 'El ETL finalizó con errores');
      }
    } catch (e) {
      toast.error('Error de conexión con la Edge Function');
    } finally {
      setUploading(false);
    }
  };

  const handleBackfill = async () => {
    setUploading(true);
    setLastResult(null);
    try {
      const token = await getToken();
      const res = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'backfill' }),
      });
      const data: EtlResult = await res.json();
      setLastResult(data);
      if (data.success) {
        const secs = data.duration_ms ? (data.duration_ms / 1000).toFixed(1) : '?';
        toast.success(`Backfill completado: ${data.loaded ?? 0} registros en ${secs}s`);
      } else {
        toast.error(data.error || 'El backfill finalizó con errores');
      }
    } catch (e) {
      toast.error('Error de conexión con la Edge Function');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.endsWith('.csv')) setFile(dropped);
    else toast.error('Solo se permiten archivos CSV');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-800">Carga de Datos RFID</h2>
        <p className="text-sm text-slate-500 mt-1">
          Sube un archivo CSV con datos brutos de lecturas RFID. El pipeline ETL transformará,
          clasificará y cargará los datos automáticamente en la tabla RFID.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel de subida */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Subir archivo CSV</h3>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
            }`}
            onClick={() => document.getElementById('rfid-file-input')?.click()}
          >
            <input
              id="rfid-file-input" type="file" accept=".csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }}
            />
            <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            {file ? (
              <div>
                <p className="text-sm font-medium text-indigo-700">{file.name}</p>
                <p className="text-xs text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-slate-600">Arrastra tu CSV aquí</p>
                <p className="text-xs text-slate-400 mt-1">o haz clic para seleccionar</p>
              </div>
            )}
          </div>
          <div className="mt-4 p-3 bg-slate-50 rounded-lg">
            <p className="text-xs font-semibold text-slate-600 mb-1">Columnas esperadas:</p>
            <p className="text-xs font-mono text-slate-500 leading-relaxed break-all">
              document_id, event_time_local, event_time_offset, record_time, location, read_point_id, tag_id, impc_code, s9id
            </p>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="flex-1 bg-indigo-600 text-white text-sm font-medium py-2.5 px-4 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {uploading && polling ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Procesando...
                </>
              ) : 'Subir y procesar'}
            </button>
            {file && (
              <button onClick={() => setFile(null)} disabled={uploading}
                className="px-3 py-2.5 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40">
                Cancelar
              </button>
            )}
          </div>
        </div>

        {/* Panel de resultado del ETL */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Resultado del ETL</h3>

          {uploading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <svg className="w-8 h-8 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-slate-500">Ejecutando ETL en Supabase...</p>
              <p className="text-xs text-slate-400">Esto puede tardar entre 10 y 60 segundos según el volumen de datos.</p>
            </div>
          ) : !lastResult ? (
            <div className="text-center py-10">
              <p className="text-sm text-slate-400">Sube un CSV o ejecuta un backfill para ver el resultado.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  lastResult.success ? 'bg-emerald-400' : 'bg-red-400'
                }`} />
                <p className="text-sm font-medium text-slate-700">
                  {lastResult.success ? 'ETL completado con éxito' : 'ETL finalizado con errores'}
                </p>
              </div>
              {lastResult.success && (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Registros en staging', value: lastResult.staged ?? 0 },
                    { label: 'Registros cargados', value: lastResult.loaded ?? 0 },
                    { label: 'Incongruencias', value: lastResult.issues ?? 0 },
                    { label: 'Duración', value: lastResult.duration_ms ? `${(lastResult.duration_ms / 1000).toFixed(1)}s` : '-' },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-400">{label}</p>
                      <p className="text-lg font-bold text-slate-800">{value}</p>
                    </div>
                  ))}
                </div>
              )}
              {!lastResult.success && lastResult.error && (
                <div className="bg-red-50 border border-red-100 rounded-lg p-3">
                  <p className="text-xs text-red-700 font-mono">{lastResult.error}</p>
                </div>
              )}
              {lastResult.message && (
                <p className="text-xs text-slate-500">{lastResult.message}</p>
              )}
            </div>
          )}

          <div className="border-t border-slate-100 mt-4 pt-4">
            <p className="text-xs font-semibold text-slate-500 mb-3">Acciones manuales</p>
            <button
              onClick={handleBackfill}
              disabled={uploading}
              className="w-full text-sm text-slate-600 border border-slate-200 py-2 px-4 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Reprocesar todos los registros (backfill)
            </button>
            <p className="text-xs text-slate-400 mt-1.5">
              Reclasifica todos los registros de la tabla RFID sin event_type.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ────────────────────────────────────────────────
type Tab = 'dashboard' | 'audit-log' | 'master-review' | 'rfid-upload';

export default function AdminAuditPage() {
  const { user, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const { summary, loading: auditLoading, refetch: refetchAudit } = useAuditLog();
  const { pendingCount, loading: masterLoading } = useMasterPending();

  // ── Ejecución manual del Audit ─────────────────────────────────────────
  const [auditRunning, setAuditRunning] = useState(false);
  const [showRunLog, setShowRunLog] = useState(false);
  const [runLogs, setRunLogs] = useState<{ type: string; message: string }[]>([]);
  const [runResult, setRunResult] = useState<{ success: boolean; message: string } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [runLogs]);

  const handleRunAudit = useCallback(async () => {
    if (auditRunning) return;
    setAuditRunning(true);
    setShowRunLog(true);
    setRunLogs([{ type: 'info', message: 'Iniciando Audit de Carga de Datos...' }]);
    setRunResult(null);

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setRunLogs([{ type: 'error', message: 'No se pudo obtener el token de sesión.' }]);
      setRunResult({ success: false, message: 'Error de autenticación' });
      setAuditRunning(false);
      return;
    }

    try {
      const response = await fetch('/api/audit/run', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });

      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({ error: 'Error desconocido' }));
        setRunLogs(prev => [...prev, { type: 'error', message: err.error || `HTTP ${response.status}` }]);
        setRunResult({ success: false, message: err.error || 'Error al iniciar el audit' });
        setAuditRunning(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(part.slice(6));
            if (event.type === 'done') {
              setRunResult({ success: event.success, message: event.message });
              setAuditRunning(false);
              if (event.success) {
                toast.success('Audit completado. Recargando datos...');
                setTimeout(() => refetchAudit(), 1500);
              } else {
                toast.error('El audit finalizó con errores.');
              }
            } else {
              setRunLogs(prev => [...prev, { type: event.type, message: event.message }]);
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error de red';
      setRunLogs(prev => [...prev, { type: 'error', message: msg }]);
      setRunResult({ success: false, message: msg });
      setAuditRunning(false);
    }
  }, [auditRunning, refetchAudit]);

  // Guardia de seguridad: solo admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-700">Acceso restringido</h2>
          <p className="text-sm text-slate-400 mt-1">Esta sección es solo para administradores.</p>
        </div>
      </div>
    );
  }

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    {
      id: 'audit-log',
      label: 'Registro de Audit',
      badge: summary?.pending_decision && summary.pending_decision > 0 ? summary.pending_decision : undefined,
    },
    {
      id: 'master-review',
      label: 'Revisión de Maestros',
      badge: pendingCount > 0 ? pendingCount : undefined,
    },
    { id: 'rfid-upload', label: 'Carga RFID' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-semibold text-indigo-600 uppercase tracking-widest">Admin</span>
              <span className="text-slate-300">·</span>
              <span className="text-xs text-slate-400">EDGE Dashboard</span>
            </div>
            <h1 className="text-xl font-bold text-slate-800">Audit de Carga de Datos</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleRunAudit}
              disabled={auditRunning}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                auditRunning
                  ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm hover:shadow-md'
              }`}
            >
              {auditRunning ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Ejecutando...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Ejecutar Audit
                </>
              )}
            </button>
            <div className="text-xs text-slate-400 text-right">
              <p className="font-medium text-slate-600">{user?.email}</p>
              <p>Administrador</p>
            </div>
          </div>
        </div>
      </div>

      {/* Panel de log de ejecución */}
      {showRunLog && (
        <div className="bg-slate-900 border-b border-slate-700">
          <div className="max-w-7xl mx-auto px-6 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Log de ejecución del Audit</p>
              {!auditRunning && (
                <button onClick={() => setShowRunLog(false)}
                  className="text-slate-500 hover:text-slate-300 text-xs">Cerrar</button>
              )}
            </div>
            <div className="bg-slate-950 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs">
              {runLogs.map((log, i) => (
                <div key={i} className={`py-0.5 ${
                  log.type === 'error' ? 'text-red-400' :
                  log.type === 'warning' ? 'text-amber-400' :
                  log.type === 'success' ? 'text-emerald-400' :
                  'text-slate-300'
                }`}>
                  <span className="text-slate-600 mr-2">[{i.toString().padStart(2, '0')}]</span>
                  {log.message}
                </div>
              ))}
              {auditRunning && (
                <div className="text-indigo-400 animate-pulse py-0.5">▶ Procesando...</div>
              )}
              <div ref={logEndRef} />
            </div>
            {runResult && (
              <div className={`mt-2 px-3 py-2 rounded-lg text-xs font-semibold ${
                runResult.success
                  ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700'
                  : 'bg-red-900/50 text-red-300 border border-red-700'
              }`}>
                {runResult.success ? '✓' : '✗'} {runResult.message}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-7xl mx-auto flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {tab.label}
              {tab.badge !== undefined && (
                <span className="bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {tab.badge > 9 ? '9+' : tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === 'dashboard' && (
          <DashboardSection
            summary={auditLoading ? null : summary}
            masterPendingCount={masterLoading ? 0 : pendingCount}
          />
        )}
        {activeTab === 'audit-log' && <AuditLogSection user={user || {}} />}
        {activeTab === 'master-review' && <MasterReviewSection user={user || {}} />}
        {activeTab === 'rfid-upload' && <RfidUploadSection />}
      </div>
    </div>
  );
}
