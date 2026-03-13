/**
 * run-audit-benchmark — Supabase Edge Function
 *
 * Ejecuta los checks de calidad de datos sobre la tabla tracking_events:
 *   Check 4: IMPC_MISMATCH_RFID     — impc_code RFID no coincide con el s9id
 *   Check 5: CASE_NORMALIZATION     — IMPC en minúsculas en los datos de origen
 *   Check 6: MAESTRO_AUSENTE        — IMPC aparece en datos pero no existe en postal_centers
 *
 * Escribe los resultados en audit_data_load_log.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS ──────────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
};

// ── Tipos ─────────────────────────────────────────────────────────────────
interface TrackingEvent {
  id:                    string;
  s9id:                  string | null;
  tag_id:                string | null;
  rfid_origin_impc:      string | null;
  rfid_dest_impc:        string | null;
  predes_origin_impc:    string | null;
  redes_dest_impc:       string | null;
  rfid_origin_country:   string | null;
  rfid_dest_country:     string | null;
  rfid_case:             string | null;
}

interface AuditEntry {
  audit_run_id:    string;
  audit_run_at:    string;
  source_table:    string;
  source_record_id?: string;
  source_s9id?:    string;
  audit_check:     string;
  audit_category:  string;
  severity:        string;
  resolution:      string;
  field_name?:     string;
  original_value?: string;
  corrected_value?: string;
  notes?:          string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extrae el IMPC de origen (posiciones 1-6) y destino (7-12) del s9id.
 * Formato s9id: XXXXXXYYYYYYZZZZZZZ donde XX=origen, YY=destino
 * Ejemplo: "ESMADB3JPKWSA00012345" → origen=ESMADB, destino=JPKWSA
 */
function extractImpcFromS9id(s9id: string): { origin: string; dest: string } | null {
  if (!s9id || s9id.length < 12) return null;
  // El s9id tiene formato: 2 letras país origen + 3 letras centro origen + 1 letra clase
  //                      + 2 letras país destino + 3 letras centro destino + ...
  // Los primeros 6 caracteres = IMPC origen, los siguientes 6 = IMPC destino
  const origin = s9id.substring(0, 6).toUpperCase();
  const dest   = s9id.substring(6, 12).toUpperCase();
  return { origin, dest };
}

/**
 * Determina la severidad según el tipo de check.
 */
function getSeverity(check: string): string {
  if (check === "IMPC_MISMATCH_RFID")    return "ALTO";
  if (check === "CASE_NORMALIZATION")    return "BAJO";
  if (check === "MAESTRO_AUSENTE")       return "MEDIO";
  return "MEDIO";
}

/**
 * Determina la resolución según el tipo de check.
 */
function getResolution(check: string): string {
  if (check === "CASE_NORMALIZATION")    return "AUTO_CORRECTED";
  if (check === "MAESTRO_AUSENTE")       return "PENDING_REVIEW";
  return "SEND_TO_LOG";
}

// ── Handler principal ─────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase     = createClient(supabaseUrl, serviceKey);

    const runId  = crypto.randomUUID();
    const runAt  = new Date().toISOString();
    const logs: string[] = [];
    const entries: AuditEntry[] = [];

    logs.push(`[00] Iniciando Audit de Benchmark — run_id: ${runId}`);

    // ── 1. Cargar datos necesarios ────────────────────────────────────────
    logs.push("[01] Cargando tracking_events...");

    // Paginar tracking_events (máx 1000 por petición en Supabase)
    let allEvents: TrackingEvent[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("tracking_events")
        .select("id,s9id,tag_id,rfid_origin_impc,rfid_dest_impc,predes_origin_impc,redes_dest_impc,rfid_origin_country,rfid_dest_country,rfid_case")
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (error) throw new Error(`Error cargando tracking_events: ${error.message}`);
      if (!data || data.length === 0) break;
      allEvents = allEvents.concat(data as TrackingEvent[]);
      if (data.length < PAGE_SIZE) break;
      page++;
    }
    logs.push(`[02] tracking_events cargados: ${allEvents.length} registros`);

    // Cargar postal_centers como Set para lookup rápido
    logs.push("[03] Cargando postal_centers...");
    const { data: centersData, error: centersErr } = await supabase
      .from("postal_centers")
      .select("impc_code");
    if (centersErr) throw new Error(`Error cargando postal_centers: ${centersErr.message}`);
    const knownImpcSet = new Set((centersData || []).map((c: { impc_code: string }) => c.impc_code.toUpperCase()));
    logs.push(`[04] postal_centers cargados: ${knownImpcSet.size} IMPCs conocidos`);

    // ── Check 4: IMPC_MISMATCH_RFID ──────────────────────────────────────
    logs.push("[05] Ejecutando Check 4: IMPC_MISMATCH_RFID...");
    let mismatchCount = 0;

    for (const ev of allEvents) {
      if (!ev.s9id) continue;
      const extracted = extractImpcFromS9id(ev.s9id);
      if (!extracted) continue;

      // Verificar IMPC de origen RFID vs s9id
      if (ev.rfid_origin_impc) {
        const rfidOriginUpper = ev.rfid_origin_impc.toUpperCase();
        if (rfidOriginUpper !== extracted.origin) {
          entries.push({
            audit_run_id:    runId,
            audit_run_at:    runAt,
            source_table:    "tracking_events",
            source_record_id: String(ev.id),
            source_s9id:     ev.s9id,
            audit_check:     "IMPC_MISMATCH_RFID",
            audit_category:  "IMPC_MISMATCH",
            severity:        "ALTO",
            resolution:      "SEND_TO_LOG",
            field_name:      "rfid_origin_impc",
            original_value:  ev.rfid_origin_impc,
            corrected_value: extracted.origin,
            notes:           `IMPC de origen RFID (${ev.rfid_origin_impc}) no coincide con el s9id (${extracted.origin}). Fuente de verdad: s9id.`,
          });
          mismatchCount++;
        }
      }

      // Verificar IMPC de destino RFID vs s9id
      if (ev.rfid_dest_impc) {
        const rfidDestUpper = ev.rfid_dest_impc.toUpperCase();
        if (rfidDestUpper !== extracted.dest) {
          entries.push({
            audit_run_id:    runId,
            audit_run_at:    runAt,
            source_table:    "tracking_events",
            source_record_id: String(ev.id),
            source_s9id:     ev.s9id,
            audit_check:     "IMPC_MISMATCH_RFID",
            audit_category:  "IMPC_MISMATCH",
            severity:        "ALTO",
            resolution:      "SEND_TO_LOG",
            field_name:      "rfid_dest_impc",
            original_value:  ev.rfid_dest_impc,
            corrected_value: extracted.dest,
            notes:           `IMPC de destino RFID (${ev.rfid_dest_impc}) no coincide con el s9id (${extracted.dest}). Fuente de verdad: s9id.`,
          });
          mismatchCount++;
        }
      }
    }
    logs.push(`[06] IMPC_MISMATCH_RFID: ${mismatchCount} incongruencias detectadas`);

    // ── Check 5: CASE_NORMALIZATION ───────────────────────────────────────
    logs.push("[07] Ejecutando Check 5: CASE_NORMALIZATION...");
    let caseCount = 0;
    const caseFields: Array<keyof TrackingEvent> = [
      "rfid_origin_impc", "rfid_dest_impc", "predes_origin_impc", "redes_dest_impc"
    ];

    for (const ev of allEvents) {
      for (const field of caseFields) {
        const val = ev[field] as string | null;
        if (!val) continue;
        if (val !== val.toUpperCase()) {
          entries.push({
            audit_run_id:    runId,
            audit_run_at:    runAt,
            source_table:    "tracking_events",
            source_record_id: String(ev.id),
            source_s9id:     ev.s9id ?? undefined,
            audit_check:     "CASE_NORMALIZATION",
            audit_category:  "CASE_NORMALIZATION",
            severity:        "BAJO",
            resolution:      "AUTO_CORRECTED",
            field_name:      field,
            original_value:  val,
            corrected_value: val.toUpperCase(),
            notes:           `El campo ${field} contiene el IMPC en minúsculas. Propuesta: normalizar a "${val.toUpperCase()}".`,
          });
          caseCount++;
        }
      }
    }
    logs.push(`[08] CASE_NORMALIZATION: ${caseCount} campos con formato incorrecto`);

    // ── Check 6: MAESTRO_AUSENTE ──────────────────────────────────────────
    logs.push("[09] Ejecutando Check 6: MAESTRO_AUSENTE...");
    let maestroCount = 0;
    const reportedMissing = new Set<string>();

    const allImpcFields: Array<{ field: keyof TrackingEvent; label: string }> = [
      { field: "rfid_origin_impc",   label: "RFID origen" },
      { field: "rfid_dest_impc",     label: "RFID destino" },
      { field: "predes_origin_impc", label: "PREDES origen" },
      { field: "redes_dest_impc",    label: "REDES destino" },
    ];

    for (const ev of allEvents) {
      for (const { field, label } of allImpcFields) {
        const val = ev[field] as string | null;
        if (!val) continue;
        const valUpper = val.toUpperCase();
        if (!knownImpcSet.has(valUpper) && !reportedMissing.has(valUpper)) {
          reportedMissing.add(valUpper);
          entries.push({
            audit_run_id:    runId,
            audit_run_at:    runAt,
            source_table:    "tracking_events",
            source_record_id: String(ev.id),
            source_s9id:     ev.s9id ?? undefined,
            audit_check:     "MAESTRO_AUSENTE",
            audit_category:  "MAESTRO_AUSENTE",
            severity:        "MEDIO",
            resolution:      "PENDING_REVIEW",
            field_name:      field,
            original_value:  val,
            notes:           `El IMPC "${valUpper}" aparece en ${label} de tracking_events pero no existe en postal_centers. Puede ser un centro nuevo, un código mal escrito o un alias no registrado.`,
          });
          maestroCount++;
        }
      }
    }
    logs.push(`[10] MAESTRO_AUSENTE: ${maestroCount} IMPCs no encontrados en el maestro`);

    // ── Insertar resultados en audit_data_load_log ────────────────────────
    logs.push(`[11] Insertando ${entries.length} entradas en audit_data_load_log...`);

    if (entries.length > 0) {
      // Insertar en lotes de 500
      const BATCH = 500;
      let inserted = 0;
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH);
        const { error: insertErr } = await supabase
          .from("audit_data_load_log")
          .insert(batch);
        if (insertErr) throw new Error(`Error insertando lote ${Math.floor(i/BATCH)+1}: ${insertErr.message}`);
        inserted += batch.length;
      }
      logs.push(`[12] ${inserted} entradas insertadas correctamente`);
    } else {
      logs.push("[12] No se detectaron incongruencias — audit_data_load_log sin cambios");
    }

    logs.push("[13] Audit completado correctamente");

    return new Response(JSON.stringify({
      success:       true,
      run_id:        runId,
      run_at:        runAt,
      total_events:  allEvents.length,
      total_entries: entries.length,
      by_check: {
        IMPC_MISMATCH_RFID:  mismatchCount,
        CASE_NORMALIZATION:  caseCount,
        MAESTRO_AUSENTE:     maestroCount,
      },
      logs,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("run-audit-benchmark error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
