/**
 * useAuditData — Hook para gestionar datos del Audit de Carga de Datos.
 * Conecta con audit_data_load_log y master_pending_review en Supabase.
 * Solo accesible para usuarios con role = 'admin'.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ── Tipos ──────────────────────────────────────────────────────────────────
export type Severity = 'CRITICO' | 'ALTO' | 'MEDIO' | 'BAJO';
export type Resolution = 'SEND_TO_LOG' | 'AUTO_CORRECTED' | 'PENDING_REVIEW' | 'INFORMATIVO';
export type AuditCategory = 'IMPC_MISMATCH' | 'OUTLIER_TEMPORAL' | 'MAESTRO_AUSENTE' | 'CASE_NORMALIZATION';
export type MasterActionType = 'ALTA' | 'CORRECCION' | 'NORMALIZACION_CASE' | 'INACTIVO';
export type MasterStatus = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'APLICADO';
export type Confidence = 'ALTA' | 'MEDIA' | 'BAJA';

export interface AuditLogEntry {
  id: string;
  audit_run_id: string;
  audit_run_at: string;
  source_table: string;
  source_record_id?: string;
  source_s9id?: string;
  audit_check: string;
  audit_category: AuditCategory;
  severity: Severity;
  resolution: Resolution;
  field_name?: string;
  original_value?: string;
  corrected_value?: string;
  outlier_flag?: string;
  group_context?: string;
  group_median?: number;
  group_iqr_low?: number;
  group_iqr_high?: number;
  notes?: string;
  admin_decision?: 'KEEP' | 'DELETE' | null;
  admin_notes?: string;
  admin_reviewed_by?: string;
  admin_reviewed_at?: string;
  created_at: string;
}

export interface MasterPendingEntry {
  id: string;
  audit_run_id: string;
  detected_at: string;
  action_type: MasterActionType;
  impc_code: string;
  impc_code_normalized: string;
  current_country?: string;
  current_center_name?: string;
  proposed_country?: string;
  proposed_center_name?: string;
  confidence: Confidence;
  freq_rfid: number;
  freq_te: number;
  freq_edi: number;
  country_variants?: string;
  name_variants?: string;
  status: MasterStatus;
  reviewed_by?: string;
  reviewed_at?: string;
  notes?: string;
  created_at: string;
}

export interface AuditRunSummary {
  run_id: string;
  run_at: string;
  total_entries: number;
  send_to_log: number;
  auto_corrected: number;
  pending_decision: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  master_pending: number;
}

// ── Hook principal: Audit Log ──────────────────────────────────────────────
export function useAuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('audit_data_load_log')
      .select('*')
      .order('audit_run_at', { ascending: false })
      .order('severity', { ascending: true });

    if (err) {
      setError(err.message);
    } else {
      setEntries(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const updateDecision = async (
    id: string,
    decision: 'KEEP' | 'DELETE',
    notes: string,
    reviewedBy: string
  ): Promise<{ error: string | null }> => {
    const { error: err } = await supabase
      .from('audit_data_load_log')
      .update({
        admin_decision: decision,
        admin_notes: notes || null,
        admin_reviewed_by: reviewedBy,
        admin_reviewed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (err) return { error: err.message };

    // Actualizar estado local
    setEntries(prev =>
      prev.map(e =>
        e.id === id
          ? { ...e, admin_decision: decision, admin_notes: notes, admin_reviewed_by: reviewedBy, admin_reviewed_at: new Date().toISOString() }
          : e
      )
    );
    return { error: null };
  };

  const bulkUpdateDecision = async (
    ids: string[],
    decision: 'KEEP' | 'DELETE',
    reviewedBy: string
  ): Promise<{ error: string | null }> => {
    const { error: err } = await supabase
      .from('audit_data_load_log')
      .update({
        admin_decision: decision,
        admin_reviewed_by: reviewedBy,
        admin_reviewed_at: new Date().toISOString(),
      })
      .in('id', ids);

    if (err) return { error: err.message };
    await fetchEntries();
    return { error: null };
  };

  // Resumen calculado
  const summary: AuditRunSummary | null = entries.length > 0 ? (() => {
    const latestRun = entries[0];
    const runEntries = entries.filter(e => e.audit_run_id === latestRun.audit_run_id);
    const bySev: Record<string, number> = {};
    const byCat: Record<string, number> = {};
    runEntries.forEach(e => {
      bySev[e.severity] = (bySev[e.severity] || 0) + 1;
      byCat[e.audit_category] = (byCat[e.audit_category] || 0) + 1;
    });
    return {
      run_id: latestRun.audit_run_id,
      run_at: latestRun.audit_run_at,
      total_entries: runEntries.length,
      send_to_log: runEntries.filter(e => e.resolution === 'SEND_TO_LOG').length,
      auto_corrected: runEntries.filter(e => e.resolution === 'AUTO_CORRECTED').length,
      pending_decision: runEntries.filter(e => e.resolution === 'SEND_TO_LOG' && !e.admin_decision).length,
      by_severity: bySev,
      by_category: byCat,
      master_pending: 0, // se combina con useMasterPending
    };
  })() : null;

  return { entries, loading, error, summary, updateDecision, bulkUpdateDecision, refetch: fetchEntries };
}

// ── Hook: Master Pending Review ────────────────────────────────────────────
export function useMasterPending() {
  const [entries, setEntries] = useState<MasterPendingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('master_pending_review')
      .select('*')
      .order('detected_at', { ascending: false });

    if (err) {
      setError(err.message);
    } else {
      setEntries(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const updateStatus = async (
    id: string,
    status: 'APROBADO' | 'RECHAZADO',
    updates: { proposed_country?: string; proposed_center_name?: string; notes?: string },
    reviewedBy: string
  ): Promise<{ error: string | null }> => {
    const { error: err } = await supabase
      .from('master_pending_review')
      .update({
        status,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
        ...updates,
      })
      .eq('id', id);

    if (err) return { error: err.message };

    setEntries(prev =>
      prev.map(e =>
        e.id === id
          ? { ...e, status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString(), ...updates }
          : e
      )
    );
    return { error: null };
  };

  const pendingCount = entries.filter(e => e.status === 'PENDIENTE').length;

  return { entries, loading, error, pendingCount, updateStatus, refetch: fetchEntries };
}
