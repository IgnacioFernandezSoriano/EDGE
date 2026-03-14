/**
 * process-rfid-etl — Supabase Edge Function
 * ==========================================
 * ETL del Informe RFID — Proyecto EDGE
 *
 * Proceso completo:
 * -----------------
 *   1. EXTRACCIÓN     — Parsea el CSV y lo carga en staging_rfid_events
 *   2. TRANSFORMACIÓN — Para cada lectura:
 *        a) Determina el IMPC del lector desde rfid_readers_master
 *        b) Clasifica como ORIGIN/DESTINATION comparando IMPC con s9id
 *        c) Descarta lecturas INTERMEDIATE (lector no es ni origen ni destino)
 *        d) Agrupa por (tag_id, impc_code, event_type):
 *             - ORIGIN     → se queda con la lectura MÁS RECIENTE (última salida)
 *             - DESTINATION → se queda con la lectura MÁS ANTIGUA (primera entrada)
 *   3. LOGGING        — Registra incongruencias en log_rfid_inconsistencies
 *   4. CARGA          — Upsert en tabla RFID con los registros consolidados
 *   5. SINCRONIZACIÓN — Mantiene postal_centers alineada con rfid_readers_master
 *   6. LIMPIEZA       — Vacía staging_rfid_events
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Configuración ────────────────────────────────────────────────────────────

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH_SIZE           = 500;

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface StagingRow {
  document_id:       string | null;
  event_time_local:  string | null;
  event_time_offset: string | null;
  record_time:       string | null;
  location:          string | null;
  read_point_id:     string | null;
  tag_id:            string | null;
  impc_code:         string | null;
  s9id:              string | null;
  source:            string;
}

interface ReaderMaster {
  read_point_id: string;
  impc_code:     string;
  country:       string | null;
  center_name:   string | null;
}

interface RfidRecord {
  document_id:           string;
  event_time_local:      string | null;
  event_time_offset:     string | null;
  record_time:           string | null;
  location:              string | null;
  read_point_id:         string | null;
  tag_id:                string;
  impc_code:             string | null;
  s9id:                  string;
  event_type:            string;
  impc_code_corrected:   string;
  country_corrected:     string | null;
  center_name_corrected: string | null;
  etl_processed_at:      string;
  // Para agrupación interna (no se guarda en BD)
  _sort_time?:           number;
}

interface IssueRow {
  etl_run_id:       string;
  source_record_id: string;
  read_point_id:    string | null;
  s9id:             string | null;
  tag_id:           string | null;
  issue_type:       string;
  issue_detail:     string;
  severity:         string;
}

// ─── Lógica de Clasificación ──────────────────────────────────────────────────

/**
 * Determina si un centro es un AMU (Air Mail Unit) o aeropuerto.
 * Regla: el center_name o la location contienen "AMU" o "Airport" (case-insensitive).
 * Estos centros, cuando aparecen como INTERMEDIATE, se reclasifican como DESTINATION
 * porque representan la primera entrada física del objeto al país destino.
 */
function isAmuOrAirport(centerName: string | null, location: string | null): boolean {
  const haystack = `${centerName ?? ""} ${location ?? ""}`.toUpperCase();
  return haystack.includes("AMU") || haystack.includes("AIRPORT");
}

/**
 * Clasifica una lectura según el s9id estándar UPU (6 letras IMPC origen + 6 letras IMPC destino).
 * Si el s9id no sigue ese formato, devuelve "UNKNOWN" para procesamiento por orden temporal.
 */
function classifyEvent(
  readerImpc: string,
  s9id: string
): "ORIGIN" | "DESTINATION" | "INTERMEDIATE" | "UNKNOWN" {
  if (!s9id || s9id.length < 12 || !readerImpc) return "UNKNOWN";

  // Verificar que las primeras 12 posiciones son letras (s9id estándar UPU)
  const prefix12 = s9id.slice(0, 12);
  if (!/^[A-Za-z]{12}/.test(prefix12)) return "UNKNOWN";

  const originImpc = s9id.slice(0, 6).toUpperCase();
  const destImpc   = s9id.slice(6, 12).toUpperCase();
  const rImpc      = readerImpc.toUpperCase();

  if (rImpc === originImpc)  return "ORIGIN";
  if (rImpc === destImpc)    return "DESTINATION";
  return "INTERMEDIATE";
}

// ─── Parseo de CSV ────────────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  const firstLine = lines[0];
  const sep = firstLine.includes(";") ? ";" : ",";
  const headers = firstLine.split(sep).map(h => h.trim().replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === sep && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });
    rows.push(row);
  }

  return rows;
}

// ─── Helpers de Supabase ──────────────────────────────────────────────────────

async function selectAll(
  db: ReturnType<typeof createClient>,
  table: string,
  opts: { select?: string } = {}
): Promise<any[]> {
  const allRows: any[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await db
      .from(table)
      .select(opts.select ?? "*")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`selectAll(${table}): ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

async function upsertBatch(
  db: ReturnType<typeof createClient>,
  table: string,
  rows: any[],
  onConflict: string
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await db.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`upsert(${table}) batch ${i / BATCH_SIZE + 1}: ${error.message}`);
  }
}

async function insertBatch(
  db: ReturnType<typeof createClient>,
  table: string,
  rows: any[]
): Promise<void> {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await db.from(table).insert(batch);
    if (error) throw new Error(`insert(${table}) batch ${i / BATCH_SIZE + 1}: ${error.message}`);
  }
}

// ─── Fases del ETL ────────────────────────────────────────────────────────────

async function fase1Extraccion(
  db: ReturnType<typeof createClient>,
  mode: string,
  csvRows: Record<string, string>[] | null
): Promise<number> {
  console.log("━━━ FASE 1: EXTRACCIÓN ━━━");

  if (mode === "csv" && csvRows) {
    const staging: StagingRow[] = csvRows.map(row => ({
      document_id:       row["document_id"]       || null,
      event_time_local:  row["event_time_local"]   || null,
      event_time_offset: row["event_time_offset"]  || null,
      record_time:       row["record_time"]        || null,
      location:          row["location"]           || null,
      read_point_id:     row["read_point_id"]      || null,
      tag_id:            row["tag_id"]             || null,
      impc_code:         row["impc_code"]          || null,
      s9id:              row["s9id"]               || null,
      source:            "CSV",
    }));
    await insertBatch(db, "staging_rfid_events", staging);
    console.log(`  ${staging.length} registros cargados desde CSV en staging.`);
    return staging.length;
  }

  if (mode === "backfill") {
    // Backfill: procesar registros RFID que no tienen event_type
    const { data, error } = await db
      .from("RFID")
      .select("id,document_id,event_time_local,event_time_offset,record_time,location,read_point_id,tag_id,impc_code,s9id")
      .is("event_type", null);
    if (error) throw new Error(`backfill select: ${error.message}`);
    if (!data || data.length === 0) {
      console.log("  No hay registros pendientes en RFID.");
      return 0;
    }
    const staging: StagingRow[] = data.map(r => ({
      document_id:       r.document_id       ?? null,
      event_time_local:  r.event_time_local   ?? null,
      event_time_offset: r.event_time_offset  ?? null,
      record_time:       r.record_time        ?? null,
      location:          r.location           ?? null,
      read_point_id:     r.read_point_id      ?? null,
      tag_id:            r.tag_id             ?? null,
      impc_code:         r.impc_code          ?? null,
      s9id:              r.s9id               ?? null,
      source:            "BACKFILL",
    }));
    await insertBatch(db, "staging_rfid_events", staging);
    console.log(`  ${staging.length} registros cargados en staging desde RFID.`);
    return staging.length;
  }

  const existing = await selectAll(db, "staging_rfid_events", { select: "id" });
  console.log(`  Modo incremental: ${existing.length} registros en staging.`);
  return existing.length;
}

// Helper: construye un RfidRecord a partir de un Candidate con el event_type indicado
function buildRecord(
  c: { row: any; readPointId: string; s9id: string; tagId: string; docId: string;
        readerImpc: string; country: string | null; centerName: string | null;
        location: string | null; sortTime: number },
  eventType: string,
  now: string
): RfidRecord {
  return {
    document_id:           c.docId || crypto.randomUUID(),
    event_time_local:      c.row.event_time_local   ?? null,
    event_time_offset:     c.row.event_time_offset  ?? null,
    record_time:           c.row.record_time        ?? null,
    location:              c.location,
    read_point_id:         c.readPointId,
    tag_id:                c.tagId,
    impc_code:             c.row.impc_code          ?? null,
    s9id:                  c.s9id,
    event_type:            eventType,
    impc_code_corrected:   c.readerImpc,
    country_corrected:     c.country,
    center_name_corrected: c.centerName,
    etl_processed_at:      now,
    _sort_time:            c.sortTime,
  };
}

async function fase2Transformacion(
  db: ReturnType<typeof createClient>,
  etlRunId: string,
  readersMaster: Map<string, ReaderMaster>
): Promise<{ consolidated: RfidRecord[]; issues: IssueRow[]; intermediateCount: number }> {
  console.log("━━━ FASE 2: TRANSFORMACIÓN ━━━");

  const staging = await selectAll(db, "staging_rfid_events", { select: "*" });
  console.log(`  ${staging.length} registros en staging.`);

  const issues: IssueRow[] = [];
  const now = new Date().toISOString();

  // Paso 2a: Resolver IMPC y calcular tiempo para cada lectura del staging
  // Resultado: array de candidatos con su IMPC corregido y sort_time
  interface Candidate {
    row:        any;
    readPointId: string;
    s9id:       string;
    tagId:      string;
    docId:      string;
    readerImpc: string;
    country:    string | null;
    centerName: string | null;
    location:   string | null;
    sortTime:   number;
    isAmu:      boolean;
  }

  const candidates: Candidate[] = [];
  let unknownCount = 0;

  for (const row of staging) {
    const readPointId = (row.read_point_id ?? "").trim();
    const s9id        = (row.s9id         ?? "").trim();
    const tagId       = (row.tag_id       ?? "").trim();
    const docId       = (row.document_id  ?? "").trim();

    // Validar campos obligatorios
    const missing: string[] = [];
    if (!readPointId) missing.push("read_point_id");
    if (!s9id)        missing.push("s9id");
    if (!tagId)       missing.push("tag_id");

    if (missing.length) {
      issues.push({
        etl_run_id:       etlRunId,
        source_record_id: String(row.id ?? docId),
        read_point_id:    readPointId || null,
        s9id:             s9id || null,
        tag_id:           tagId || null,
        issue_type:       "MISSING_FIELD",
        issue_detail:     `Campos obligatorios nulos: ${missing.join(", ")}`,
        severity:         "ALTO",
      });
      unknownCount++;
      continue;
    }

    // Resolver IMPC desde el maestro de lectores
    const masterEntry = readersMaster.get(readPointId);
    let readerImpc:  string;
    let country:     string | null;
    let centerName:  string | null;

    if (!masterEntry) {
      issues.push({
        etl_run_id:       etlRunId,
        source_record_id: String(row.id ?? docId),
        read_point_id:    readPointId,
        s9id,
        tag_id:           tagId,
        issue_type:       "READER_NOT_IN_MASTER",
        issue_detail:     `Lector '${readPointId}' no encontrado en rfid_readers_master. Se usará impc_code original.`,
        severity:         "MEDIO",
      });
      readerImpc = (row.impc_code ?? "").trim();
      country    = null;
      centerName = null;
    } else {
      readerImpc = masterEntry.impc_code;
      country    = masterEntry.country;
      centerName = masterEntry.center_name;
    }

    // Calcular tiempo para ordenación
    let sortTime = 0;
    try {
      sortTime = new Date(row.event_time_local ?? row.record_time ?? "").getTime();
      if (isNaN(sortTime)) sortTime = 0;
    } catch { sortTime = 0; }

    candidates.push({
      row, readPointId, s9id, tagId, docId,
      readerImpc, country, centerName,
      location: row.location ?? null,
      sortTime,
      isAmu: isAmuOrAirport(centerName, row.location ?? null),
    });
  }

  // Paso 2b: Clasificar cada candidato
  //
  // Regla 1 — S9id estándar UPU (primeros 12 caracteres son letras):
  //   ORIGIN / DESTINATION según posición en el s9id.
  //   INTERMEDIATE: si el centro es AMU/Airport → reclasificar como DESTINATION.
  //                 si no → descartar.
  //
  // Regla 2 — S9id no estándar (sin IMPC en el identificador):
  //   Agrupar por tag_id, ordenar por timestamp.
  //   Primero = ORIGIN, último = DESTINATION, medio = INTERMEDIATE.
  //   INTERMEDIATE AMU/Airport → reclasificar como DESTINATION (entrada al país).
  //
  // La regla AMU/Airport aplica en ambos casos.

  const classified: RfidRecord[] = [];
  let intermediateCount = 0;

  // Separar s9ids estándar de no estándar
  const standardCandidates  = candidates.filter(c => /^[A-Za-z]{12}/.test(c.s9id));
  const nonStandardCandidates = candidates.filter(c => !/^[A-Za-z]{12}/.test(c.s9id));

  // ── Regla 1: S9ids estándar ──
  for (const c of standardCandidates) {
    const eventType = classifyEvent(c.readerImpc, c.s9id);

    if (eventType === "INTERMEDIATE") {
      if (c.isAmu) {
        // AMU/Airport intermedio → reclasificar como DESTINATION
        classified.push(buildRecord(c, "DESTINATION", now));
        issues.push({
          etl_run_id:       etlRunId,
          source_record_id: String(c.row.id ?? c.docId),
          read_point_id:    c.readPointId,
          s9id:             c.s9id,
          tag_id:           c.tagId,
          issue_type:       "AMU_RECLASSIFIED_AS_DESTINATION",
          issue_detail:     `Centro AMU/Airport '${c.readerImpc}' (${c.centerName}) reclasificado de INTERMEDIATE a DESTINATION.`,
          severity:         "INFO",
        });
      } else {
        intermediateCount++;
        issues.push({
          etl_run_id:       etlRunId,
          source_record_id: String(c.row.id ?? c.docId),
          read_point_id:    c.readPointId,
          s9id:             c.s9id,
          tag_id:           c.tagId,
          issue_type:       "INTERMEDIATE_DISCARDED",
          issue_detail:     `Lector ${c.readerImpc} no es ni origen (${c.s9id.slice(0,6)}) ni destino (${c.s9id.slice(6,12)}) del s9id. Lectura descartada.`,
          severity:         "INFO",
        });
      }
      continue;
    }

    if (eventType === "UNKNOWN") {
      unknownCount++;
      issues.push({
        etl_run_id:       etlRunId,
        source_record_id: String(c.row.id ?? c.docId),
        read_point_id:    c.readPointId,
        s9id:             c.s9id,
        tag_id:           c.tagId,
        issue_type:       "UNKNOWN_EVENT_TYPE",
        issue_detail:     `No se pudo clasificar la lectura (s9id: '${c.s9id}', impc: '${c.readerImpc}').`,
        severity:         "MEDIO",
      });
      continue;
    }

    classified.push(buildRecord(c, eventType, now));
  }

  // ── Regla 2: S9ids no estándar — clasificación por orden temporal ──
  // Agrupar por (tag_id, s9id) y ordenar por sortTime
  const nonStdGroups = new Map<string, Candidate[]>();
  for (const c of nonStandardCandidates) {
    const key = `${c.tagId}|${c.s9id}`;
    if (!nonStdGroups.has(key)) nonStdGroups.set(key, []);
    nonStdGroups.get(key)!.push(c);
  }

  for (const [, group] of nonStdGroups) {
    group.sort((a, b) => a.sortTime - b.sortTime);

    if (group.length === 1) {
      // Solo una lectura: no se puede determinar rol, se descarta
      const c = group[0];
      unknownCount++;
      issues.push({
        etl_run_id:       etlRunId,
        source_record_id: String(c.row.id ?? c.docId),
        read_point_id:    c.readPointId,
        s9id:             c.s9id,
        tag_id:           c.tagId,
        issue_type:       "SINGLE_READ_NO_ROUTE",
        issue_detail:     `S9id no estándar con una sola lectura — no se puede determinar ORIGIN/DESTINATION.`,
        severity:         "BAJO",
      });
      continue;
    }

    // Primera lectura = ORIGIN
    classified.push(buildRecord(group[0], "ORIGIN", now));

    // Lecturas intermedias: descartar salvo AMU/Airport → DESTINATION
    // Si hay un AMU/Airport, se convierte en el DESTINATION real y se ignoran las posteriores
    let destinationAssigned = false;
    for (let i = 1; i < group.length - 1; i++) {
      const c = group[i];
      if (!destinationAssigned && c.isAmu) {
        classified.push(buildRecord(c, "DESTINATION", now));
        destinationAssigned = true;
        issues.push({
          etl_run_id:       etlRunId,
          source_record_id: String(c.row.id ?? c.docId),
          read_point_id:    c.readPointId,
          s9id:             c.s9id,
          tag_id:           c.tagId,
          issue_type:       "AMU_RECLASSIFIED_AS_DESTINATION",
          issue_detail:     `Centro AMU/Airport '${c.readerImpc}' (${c.centerName}) reclasificado de INTERMEDIATE a DESTINATION (s9id no estándar).`,
          severity:         "INFO",
        });
      } else {
        intermediateCount++;
        issues.push({
          etl_run_id:       etlRunId,
          source_record_id: String(c.row.id ?? c.docId),
          read_point_id:    c.readPointId,
          s9id:             c.s9id,
          tag_id:           c.tagId,
          issue_type:       "INTERMEDIATE_DISCARDED",
          issue_detail:     `Lectura intermedia descartada (s9id no estándar, lector: ${c.readerImpc}).`,
          severity:         "INFO",
        });
      }
    }

    // Última lectura = DESTINATION (si no se asignó ya por AMU)
    if (!destinationAssigned) {
      classified.push(buildRecord(group[group.length - 1], "DESTINATION", now));
    } else {
      // Si ya hay DESTINATION por AMU, la última lectura es INTERMEDIATE
      intermediateCount++;
      const last = group[group.length - 1];
      issues.push({
        etl_run_id:       etlRunId,
        source_record_id: String(last.row.id ?? last.docId),
        read_point_id:    last.readPointId,
        s9id:             last.s9id,
        tag_id:           last.tagId,
        issue_type:       "INTERMEDIATE_DISCARDED",
        issue_detail:     `Lectura posterior al AMU/Airport descartada — DESTINATION ya asignado (lector: ${last.readerImpc}).`,
        severity:         "INFO",
      });
    }
  }

  console.log(`  Clasificados: ${classified.length} válidos, ${intermediateCount} intermedias descartadas, ${unknownCount} desconocidos.`);

  // Paso 2c: Agrupar por (tag_id, impc_code_corrected, event_type)
  //   - ORIGIN      → conservar la lectura MÁS RECIENTE (última salida del centro)
  //   - DESTINATION → conservar la lectura MÁS ANTIGUA  (primera entrada al centro)
  const groupMap = new Map<string, RfidRecord>();

  for (const rec of classified) {
    const key = `${rec.tag_id}|${rec.impc_code_corrected}|${rec.event_type}`;
    const existing = groupMap.get(key);

    if (!existing) {
      groupMap.set(key, rec);
    } else {
      if (rec.event_type === "ORIGIN") {
        if ((rec._sort_time ?? 0) > (existing._sort_time ?? 0)) groupMap.set(key, rec);
      } else {
        if ((rec._sort_time ?? 0) < (existing._sort_time ?? 0)) groupMap.set(key, rec);
      }
    }
  }

  const consolidated = Array.from(groupMap.values()).map(r => {
    const { _sort_time, ...rest } = r;
    return rest as RfidRecord;
  });

  console.log(`  Consolidados: ${classified.length} lecturas → ${consolidated.length} registros únicos.`);

  return { consolidated, issues, intermediateCount };
}

async function fase3Logging(
  db: ReturnType<typeof createClient>,
  issues: IssueRow[]
): Promise<void> {
  console.log("━━━ FASE 3: LOGGING ━━━");
  if (!issues.length) {
    console.log("  Sin incongruencias.");
    return;
  }
  await insertBatch(db, "log_rfid_inconsistencies", issues);
  console.log(`  ${issues.length} incongruencias registradas.`);
}

async function fase4Carga(
  db: ReturnType<typeof createClient>,
  records: RfidRecord[]
): Promise<number> {
  console.log("━━━ FASE 4: CARGA ━━━");
  if (!records.length) {
    console.log("  Sin registros para cargar.");
    return 0;
  }
  // Mapear a las columnas reales de la tabla RFID (sin columnas _corrected)
  const rows = records.map(r => ({
    document_id:       r.document_id,
    event_time_local:  r.event_time_local,
    event_time_offset: r.event_time_offset,
    record_time:       r.record_time,
    location:          r.location,
    read_point_id:     r.read_point_id,
    tag_id:            r.tag_id,
    impc_code:         r.impc_code_corrected,  // usar el IMPC corregido por el maestro
    s9id:              r.s9id,
    event_type:        r.event_type,
    etl_processed_at:  r.etl_processed_at,
  }));
  await upsertBatch(db, "RFID", rows, "document_id");
  console.log(`  ${rows.length} registros cargados en tabla RFID.`);
  return rows.length;
}

async function fase5Sincronizacion(
  db: ReturnType<typeof createClient>,
  readersMaster: Map<string, ReaderMaster>
): Promise<void> {
  console.log("━━━ FASE 5: SINCRONIZACIÓN postal_centers ━━━");

  const existing = await selectAll(db, "postal_centers", { select: "impc_code" });
  const existingSet = new Set(existing.map((r: any) => r.impc_code));

  // Construir mapa deduplicado por impc_code (varios lectores pueden tener el mismo IMPC)
  const toInsertMap = new Map<string, any>();
  for (const [, reader] of readersMaster) {
    if (!toInsertMap.has(reader.impc_code)) {
      toInsertMap.set(reader.impc_code, {
        impc_code:   reader.impc_code,
        country:     reader.country ?? "",
        center_name: reader.center_name ?? reader.impc_code,
      });
    }
  }
  const toInsert = Array.from(toInsertMap.values());

  if (toInsert.length) {
    // Usar upsert para evitar errores de clave duplicada en ejecuciones sucesivas
    await upsertBatch(db, "postal_centers", toInsert, "impc_code");
    console.log(`  ${toInsert.length} centros sincronizados en postal_centers.`);
  } else {
    console.log("  postal_centers ya está sincronizada.");
  }
}

async function fase6Limpieza(
  db: ReturnType<typeof createClient>
): Promise<void> {
  console.log("━━━ FASE 6: LIMPIEZA ━━━");
  const { error } = await db.from("staging_rfid_events").delete().neq("id", 0);
  if (error) {
    // Intentar con gt
    const { error: e2 } = await db.from("staging_rfid_events").delete().gt("id", 0);
    if (e2) console.warn(`  Advertencia al limpiar staging: ${e2.message}`);
    else console.log("  staging_rfid_events vaciado.");
  } else {
    console.log("  staging_rfid_events vaciado.");
  }
}

// ─── Orquestador ─────────────────────────────────────────────────────────────

async function runEtl(
  mode: string,
  csvRows: Record<string, string>[] | null
): Promise<Record<string, any>> {
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const etlRunId  = crypto.randomUUID();
  const startTime = Date.now();

  console.log("=".repeat(60));
  console.log(`ETL RFID — run_id: ${etlRunId} — modo: ${mode}`);
  console.log("=".repeat(60));

  // Cargar maestro de lectores
  const masterRows = await selectAll(db, "rfid_readers_master", { select: "*" });
  const readersMaster = new Map<string, ReaderMaster>(
    masterRows.map((r: any) => [r.read_point_id, r as ReaderMaster])
  );
  console.log(`  Maestro de lectores: ${readersMaster.size} entradas.`);

  let result: Record<string, any> = { etl_run_id: etlRunId, mode };

  if (mode === "sync-only") {
    await fase5Sincronizacion(db, readersMaster);
    result.sync = "ok";
  } else {
    const nStaged = await fase1Extraccion(db, mode, csvRows);
    if (nStaged === 0) {
      result = { ...result, staged: 0, consolidated: 0, loaded: 0, issues: 0, intermediate_discarded: 0, duration_ms: Date.now() - startTime };
    } else {
      const { consolidated, issues, intermediateCount } = await fase2Transformacion(db, etlRunId, readersMaster);
      await fase3Logging(db, issues);
      const nLoaded = await fase4Carga(db, consolidated);
      await fase5Sincronizacion(db, readersMaster);
      await fase6Limpieza(db);

      result = {
        ...result,
        staged:               nStaged,
        consolidated:         consolidated.length,
        intermediate_discarded: intermediateCount,
        loaded:               nLoaded,
        issues:               issues.length,
        duration_ms:          Date.now() - startTime,
      };
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("=".repeat(60));
  console.log(`  ETL RFID COMPLETADO — ${elapsed}s`);
  console.log("=".repeat(60));

  return result;
}

// ─── Handler HTTP ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info, x-supabase-api-version",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    let mode = "backfill";
    let csvRows: Record<string, string>[] | null = null;

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return new Response(JSON.stringify({ error: "No se recibió ningún archivo CSV" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      const text = await file.text();
      csvRows = parseCsv(text);
      mode = "csv";
      console.log(`  CSV recibido: ${csvRows.length} filas, archivo: ${file.name}`);
    } else {
      const body = await req.json().catch(() => ({}));
      mode = body.mode ?? "backfill";
    }

    const result = await runEtl(mode, csvRows);

    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err: any) {
    console.error("ERROR en process-rfid-etl:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message ?? String(err) }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
