/**
 * process-rfid-etl — Supabase Edge Function
 * ==========================================
 * ETL del Informe RFID — Proyecto EDGE (v3)
 *
 * Criterio de clasificación (v3):
 * ─────────────────────────────────
 * 1. EXTRACCIÓN  — Parsea CSV o lee staging_rfid_events / RFID directamente.
 * 2. TRANSFORMACIÓN — Para cada tag_id:
 *      a) Resuelve el centro (impc_code, country, center_name) desde rfid_readers_master.
 *         Si el lector no está en el maestro → aviso READER_NOT_IN_MASTER, registro descartado.
 *      b) Ordena todas las lecturas por event_time_local ASC.
 *      c) Agrupa lecturas consecutivas del mismo impc_code en bloques de centro.
 *         - Primera lectura del bloque → ARRIVAL_AT_CENTRE (entrada al centro)
 *         - Última lectura del bloque  → DEPARTURE_FROM_CENTRE (salida del centro)
 *         - Lecturas intermedias       → INTERMEDIATE
 *      d) Clasifica eventos de nivel superior:
 *         - Primera lectura del viaje → ORIGIN
 *         - Última lectura del viaje  → DESTINATION
 *         - Última lectura antes de cambio de país → DEPARTURE (frontera)
 *         - Primera lectura después de cambio de país → ARRIVAL (frontera)
 *      e) Prioridad de event_type: DEPARTURE/ARRIVAL > ORIGIN/DESTINATION > DEPARTURE_FROM_CENTRE/ARRIVAL_AT_CENTRE > INTERMEDIATE
 *      f) status: COMPLETE si lecturas en >1 país, PENDING si solo 1 país.
 * 3. LOGGING     — Registra avisos en log_rfid_inconsistencies.
 * 4. CARGA       — Upsert en tabla RFID con los registros clasificados.
 * 5. SINCRONIZACIÓN — Mantiene postal_centers alineada con rfid_readers_master.
 * 6. LIMPIEZA    — Vacía staging_rfid_events.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Configuración ────────────────────────────────────────────────────────────
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH_SIZE           = 500;
const ETL_VERSION          = "v3";

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface StagingRow {
  id?:               string | null;
  document_id:       string | null;
  event_time_local:  string | null;
  event_time_offset: string | null;
  record_time:       string | null;
  location:          string | null;
  read_point_id:     string | null;
  tag_id:            string | null;
  impc_code:         string | null;
  s9id:              string | null;
  source?:           string;
}

interface ReaderMaster {
  read_point_id: string;
  impc_code:     string;
  country:       string | null;
  center_name:   string | null;
  td_reader:     boolean | null;  // true = AMU/border reader, false = internal OE centre
}

interface EnrichedReading {
  document_id:        string;
  event_time_local:   string | null;
  event_time_offset:  string | null;
  record_time:        string | null;
  location:           string | null;
  read_point_id:      string | null;
  tag_id:             string;
  impc_code:          string;
  s9id:               string | null;
  country:            string;
  center_name:        string | null;
  td_reader:          boolean;  // true = AMU/border reader, false = internal OE centre
  sort_time:          number;
}

interface RfidRecord {
  document_id:              string;
  event_time_local:         string | null;
  event_time_offset:        string | null;
  record_time:              string | null;
  location:                 string | null;
  read_point_id:            string | null;
  tag_id:                   string;
  impc_code:                string;
  s9id:                     string | null;
  event_type:               string;
  status:                   string;
  country:                  string;
  center_name:              string | null;
  is_international_boundary: boolean;
  etl_version:              string;
  etl_processed_at:         string;
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

// ─── Prioridad de event_type ──────────────────────────────────────────────────
const EVENT_PRIORITY: Record<string, number> = {
  "DEPARTURE": 5,
  "ARRIVAL":   5,
  "ORIGIN":    4,
  "DESTINATION": 4,
  "DEPARTURE_FROM_CENTRE": 3,
  "ARRIVAL_AT_CENTRE":     3,
  "INTERMEDIATE":          1,
};

function pickBestEventType(types: string[]): string {
  if (!types.length) return "INTERMEDIATE";
  return types.reduce((best, t) =>
    (EVENT_PRIORITY[t] ?? 0) > (EVENT_PRIORITY[best] ?? 0) ? t : best
  );
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
  params: Record<string, string>
): Promise<any[]> {
  const PAGE = 10000;
  let from = 0;
  const all: any[] = [];
  while (true) {
    let q = db.from(table).select(params.select ?? "*").range(from, from + PAGE - 1);
    if (params.filter_null_event_type === "true") q = q.is("event_type", null);
    const { data, error } = await q;
    if (error) throw new Error(`selectAll ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function insertBatch(
  db: ReturnType<typeof createClient>,
  table: string,
  rows: any[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await db.from(table).insert(batch);
    if (error) throw new Error(`insertBatch ${table}: ${error.message}`);
  }
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
    if (error) throw new Error(`upsertBatch ${table}: ${error.message}`);
  }
}

// ─── Fase 1: Extracción ───────────────────────────────────────────────────────
async function fase1Extraccion(
  db: ReturnType<typeof createClient>,
  mode: string,
  csvText?: string
): Promise<StagingRow[]> {
  console.log("━━━ FASE 1: EXTRACCIÓN ━━━");

  if (mode === "csv" && csvText) {
    const parsed = parseCsv(csvText);
    const staging: StagingRow[] = parsed.map(r => ({
      document_id:       r["document_id"]       || crypto.randomUUID(),
      event_time_local:  r["event_time_local"]   || null,
      event_time_offset: r["event_time_offset"]  || null,
      record_time:       r["record_time"]        || null,
      location:          r["location"]           || null,
      read_point_id:     r["read_point_id"]      || null,
      tag_id:            r["tag_id"]             || null,
      impc_code:         r["impc_code"]          || null,
      s9id:              r["s9id"]               || null,
      source:            "CSV",
    }));
    console.log(`  ${staging.length} registros cargados desde CSV.`);
    return staging;
  }

  if (mode === "backfill") {
    // Leer TODOS los registros de RFID para reclasificar con el nuevo criterio
    console.log("  Modo backfill: leyendo todos los registros de RFID...");
    const data = await selectAll(db, "RFID", {
      select: "id,document_id,event_time_local,event_time_offset,record_time,location,read_point_id,tag_id,impc_code,s9id"
    });
    const staging: StagingRow[] = data.map(r => ({ ...r, source: "BACKFILL" }));
    console.log(`  ${staging.length} registros cargados desde RFID.`);
    return staging;
  }

  // Modo incremental: leer staging_rfid_events
  const data = await selectAll(db, "staging_rfid_events", { select: "*" });
  console.log(`  ${data.length} registros en staging_rfid_events.`);
  return data as StagingRow[];
}

// ─── Fase 2: Transformación ───────────────────────────────────────────────────
async function fase2Transformacion(
  staging: StagingRow[],
  readersMaster: Map<string, ReaderMaster>,
  etlRunId: string
): Promise<{ records: RfidRecord[]; issues: IssueRow[] }> {
  console.log("━━━ FASE 2: TRANSFORMACIÓN ━━━");
  const issues: IssueRow[] = [];
  const now = new Date().toISOString();

  // Paso 2a: Enriquecer cada lectura con datos del maestro
  const enriched: EnrichedReading[] = [];
  for (const row of staging) {
    const readPointId = row.read_point_id?.trim() ?? "";
    const tagId       = row.tag_id?.trim() ?? "";
    const docId       = row.document_id ?? crypto.randomUUID();

    if (!readPointId || !tagId) {
      issues.push({
        etl_run_id: etlRunId, source_record_id: String(row.id ?? docId),
        read_point_id: row.read_point_id, s9id: row.s9id, tag_id: row.tag_id,
        issue_type: "MISSING_FIELD",
        issue_detail: `Campos obligatorios nulos: ${!readPointId ? "read_point_id" : ""} ${!tagId ? "tag_id" : ""}`.trim(),
        severity: "ALTO"
      });
      continue;
    }

    const master = readersMaster.get(readPointId);
    if (!master) {
      issues.push({
        etl_run_id: etlRunId, source_record_id: String(row.id ?? docId),
        read_point_id: readPointId, s9id: row.s9id, tag_id: tagId,
        issue_type: "READER_NOT_IN_MASTER",
        issue_detail: `Lector '${readPointId}' no encontrado en rfid_readers_master. Registro pendiente de resolución manual.`,
        severity: "ALTO"
      });
      continue; // Descartar — no procesar con fallback
    }

    // Regla de Selección de Eventos del Trayecto: ordenar por record_time (tiempo de captura)
    let sortTime = 0;
    try {
      sortTime = new Date(row.record_time ?? row.event_time_local ?? "").getTime();
      if (isNaN(sortTime)) sortTime = 0;
    } catch { sortTime = 0; }

    enriched.push({
      document_id:       docId,
      event_time_local:  row.event_time_local  ?? null,
      event_time_offset: row.event_time_offset ?? null,
      record_time:       row.record_time       ?? null,
      location:          row.location          ?? null,
      read_point_id:     readPointId,
      tag_id:            tagId,
      impc_code:         master.impc_code,
      s9id:              row.s9id              ?? null,
      country:           master.country        ?? "",
      center_name:       master.center_name    ?? null,
      td_reader:         master.td_reader      ?? false,
      sort_time:         sortTime,
    });
  }

  // Paso 2b: Agrupar por tag_id
  const byTag = new Map<string, EnrichedReading[]>();
  for (const r of enriched) {
    if (!byTag.has(r.tag_id)) byTag.set(r.tag_id, []);
    byTag.get(r.tag_id)!.push(r);
  }

  const records: RfidRecord[] = [];

  for (const [tagId, readings] of byTag) {
    // Ordenar por tiempo
    readings.sort((a, b) => a.sort_time - b.sort_time);

    // Paso 2c: Agrupar en bloques de centro consecutivos
    const centreBlocks: EnrichedReading[][] = [];
    let currentBlock: EnrichedReading[] = [readings[0]];
    for (let i = 1; i < readings.length; i++) {
      if (readings[i].impc_code === currentBlock[currentBlock.length - 1].impc_code) {
        currentBlock.push(readings[i]);
      } else {
        centreBlocks.push(currentBlock);
        currentBlock = [readings[i]];
      }
    }
    centreBlocks.push(currentBlock);

    // Paso 2d: Asignar event_types por bloque
    // Cada lectura puede acumular múltiples tipos; al final se elige el de mayor prioridad
    const eventTypes = new Map<string, string[]>(); // document_id → [types]
    const intlBoundary = new Set<string>();          // document_ids con frontera internacional

    for (const block of centreBlocks) {
      const first = block[0];
      const last  = block[block.length - 1];
      if (!eventTypes.has(first.document_id)) eventTypes.set(first.document_id, []);
      if (!eventTypes.has(last.document_id))  eventTypes.set(last.document_id, []);
      eventTypes.get(first.document_id)!.push("ARRIVAL_AT_CENTRE");
      eventTypes.get(last.document_id)!.push("DEPARTURE_FROM_CENTRE");
      for (let i = 1; i < block.length - 1; i++) {
        const mid = block[i];
        if (!eventTypes.has(mid.document_id)) eventTypes.set(mid.document_id, []);
        eventTypes.get(mid.document_id)!.push("INTERMEDIATE");
      }
    }

    // Paso 2e: Eventos de viaje completo
    const allReadings = centreBlocks.flat();
    const firstReading = allReadings[0];
    const lastReading  = allReadings[allReadings.length - 1];
    eventTypes.get(firstReading.document_id)!.push("ORIGIN");
    eventTypes.get(lastReading.document_id)!.push("DESTINATION");

    // Paso 2f: Detectar cambios de país → DEPARTURE / ARRIVAL
    // Regla de Selección de Eventos del Trayecto:
    // - DEPARTURE: última lectura del bloque de origen (último bloque antes del cambio de país)
    //   Si td_reader=true en ese bloque → es el AMU Outbound
    // - ARRIVAL: primera lectura del primer bloque en el país de destino
    //   Si td_reader=true en ese bloque → es el AMU Inbound
    for (let i = 0; i < centreBlocks.length - 1; i++) {
      const currentCountry = centreBlocks[i][0].country;
      const nextCountry    = centreBlocks[i + 1][0].country;
      if (currentCountry !== nextCountry) {
        // DEPARTURE: última lectura del bloque origen (last reading of origin block)
        const departureReading = centreBlocks[i][centreBlocks[i].length - 1];
        // ARRIVAL: primera lectura del bloque destino (first reading of dest block)
        const arrivalReading   = centreBlocks[i + 1][0];
        eventTypes.get(departureReading.document_id)!.push("DEPARTURE");
        eventTypes.get(arrivalReading.document_id)!.push("ARRIVAL");
        intlBoundary.add(departureReading.document_id);
        intlBoundary.add(arrivalReading.document_id);
        // Log td_reader classification for traceability
        const depTdReader = departureReading.td_reader ? "AMU_OUTBOUND" : "OE_ORIGIN";
        const arrTdReader = arrivalReading.td_reader   ? "AMU_INBOUND"  : "OE_DESTINATION";
        console.log(`  [${tagId}] Country change ${currentCountry}→${nextCountry}: DEPARTURE(${depTdReader}) ARRIVAL(${arrTdReader})`);
      }
    }

    // Paso 2g: Determinar status del tag
    const countries = new Set(readings.map(r => r.country));
    const status = countries.size > 1 ? "COMPLETE" : "PENDING";

    // Paso 2h: Construir registros finales
    for (const reading of allReadings) {
      const types = eventTypes.get(reading.document_id) ?? ["INTERMEDIATE"];
      records.push({
        document_id:              reading.document_id,
        event_time_local:         reading.event_time_local,
        event_time_offset:        (reading as any).event_time_offset ?? null,
        record_time:              reading.record_time,
        location:                 reading.location,
        read_point_id:            reading.read_point_id,
        tag_id:                   tagId,
        impc_code:                reading.impc_code,
        s9id:                     reading.s9id,
        event_type:               pickBestEventType(types),
        status,
        country:                  reading.country,
        center_name:              reading.center_name,
        is_international_boundary: intlBoundary.has(reading.document_id),
        etl_version:              ETL_VERSION,
        etl_processed_at:         now,
      });
    }
  }

  // Resumen
  const typeCounts: Record<string, number> = {};
  for (const r of records) typeCounts[r.event_type] = (typeCounts[r.event_type] ?? 0) + 1;
  console.log(`  Registros procesados: ${records.length.toLocaleString()}`);
  console.log(`  Distribución event_type: ${JSON.stringify(typeCounts)}`);
  console.log(`  Avisos: ${issues.length}`);

  return { records, issues };
}

// ─── Fase 3: Logging ──────────────────────────────────────────────────────────
async function fase3Logging(
  db: ReturnType<typeof createClient>,
  issues: IssueRow[]
): Promise<void> {
  console.log("━━━ FASE 3: LOGGING ━━━");
  if (!issues.length) { console.log("  Sin avisos."); return; }
  await insertBatch(db, "log_rfid_inconsistencies", issues);
  const byType: Record<string, number> = {};
  for (const i of issues) byType[i.issue_type] = (byType[i.issue_type] ?? 0) + 1;
  console.log(`  ${issues.length} avisos registrados: ${JSON.stringify(byType)}`);
}

// ─── Fase 4: Carga ────────────────────────────────────────────────────────────
async function fase4Carga(
  db: ReturnType<typeof createClient>,
  records: RfidRecord[]
): Promise<void> {
  console.log("━━━ FASE 4: CARGA ━━━");
  if (!records.length) { console.log("  Sin registros para cargar."); return; }
  await upsertBatch(db, "RFID", records, "document_id");
  console.log(`  ${records.length.toLocaleString()} registros cargados en RFID.`);
}

// ─── Fase 5: Sincronización ───────────────────────────────────────────────────
async function fase5Sincronizacion(
  db: ReturnType<typeof createClient>,
  readersMaster: Map<string, ReaderMaster>
): Promise<void> {
  console.log("━━━ FASE 5: SINCRONIZACIÓN ━━━");
  const existing = await selectAll(db, "postal_centers", { select: "impc_code" });
  const existingSet = new Set(existing.map((r: any) => r.impc_code));
  const newEntries: any[] = [];
  const seen = new Set<string>();
  for (const reader of readersMaster.values()) {
    if (!existingSet.has(reader.impc_code) && !seen.has(reader.impc_code)) {
      newEntries.push({ impc_code: reader.impc_code, country: reader.country, center_name: reader.center_name });
      seen.add(reader.impc_code);
    }
  }
  if (newEntries.length) {
    await insertBatch(db, "postal_centers", newEntries);
    console.log(`  ${newEntries.length} nuevos centros añadidos a postal_centers.`);
  } else {
    console.log(`  postal_centers ya sincronizada (${existingSet.size} centros).`);
  }
}

// ─── Fase 6: Limpieza ─────────────────────────────────────────────────────────
async function fase6Limpieza(
  db: ReturnType<typeof createClient>
): Promise<void> {
  console.log("━━━ FASE 6: LIMPIEZA ━━━");
  const { error } = await db.from("staging_rfid_events").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) console.warn(`  Advertencia al vaciar staging: ${error.message}`);
  else console.log("  Staging vaciado.");
}

// ─── Handler principal ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const etlRunId = crypto.randomUUID();
  const startTime = Date.now();
  console.log("=".repeat(60));
  console.log(`INICIO ETL RFID ${ETL_VERSION} | Run: ${etlRunId}`);
  console.log("=".repeat(60));

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Cargar maestro de lectores
    const masterRows = await selectAll(db, "rfid_readers_master", { select: "*" });
    const readersMaster = new Map<string, ReaderMaster>(
      masterRows.map((r: any) => [r.read_point_id, r as ReaderMaster])
    );
    console.log(`Maestro de lectores: ${readersMaster.size} entradas.`);

    // Determinar modo y CSV
    let mode = "incremental";
    let csvText: string | undefined;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      const modeParam = form.get("mode") as string | null;
      if (file) csvText = await file.text();
      if (modeParam) mode = modeParam;
      if (csvText) mode = "csv";
    } else if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      mode = body.mode ?? "incremental";
    }
    console.log(`Modo: ${mode}`);

    // Ejecutar fases
    const staging = await fase1Extraccion(db, mode, csvText);
    if (!staging.length) {
      return new Response(JSON.stringify({ ok: true, message: "Sin datos que procesar." }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const { records, issues } = await fase2Transformacion(staging, readersMaster, etlRunId);
    await fase3Logging(db, issues);
    await fase4Carga(db, records);
    await fase5Sincronizacion(db, readersMaster);
    if (mode !== "backfill") await fase6Limpieza(db);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("=".repeat(60));
    console.log(`ETL RFID ${ETL_VERSION} COMPLETADO en ${elapsed}s`);
    console.log("=".repeat(60));

    return new Response(JSON.stringify({
      ok: true, etl_version: ETL_VERSION, etl_run_id: etlRunId,
      records_processed: records.length, issues: issues.length,
      elapsed_seconds: parseFloat(elapsed)
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error(`ERROR CRÍTICO: ${err}`);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});
