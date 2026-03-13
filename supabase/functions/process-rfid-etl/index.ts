/**
 * process-rfid-etl — Supabase Edge Function
 * ==========================================
 * ETL del Informe RFID — Proyecto EDGE
 *
 * Reemplaza el script Python process_rfid_etl.py para funcionar
 * sin servidor propio (arquitectura Netlify + Supabase).
 *
 * Fases del proceso
 * -----------------
 *   1. EXTRACCIÓN     — Parsea el CSV recibido y lo carga en staging_rfid_events
 *   2. TRANSFORMACIÓN — Enriquece y clasifica cada evento (ORIGIN/DESTINATION/INTERMEDIATE)
 *   3. LOGGING        — Registra incongruencias en log_rfid_inconsistencies
 *   4. CARGA          — Upsert en la tabla RFID con los datos enriquecidos
 *   5. SINCRONIZACIÓN — Mantiene postal_centers alineada con rfid_readers_master
 *   6. LIMPIEZA       — Vacía staging_rfid_events
 *
 * Invocación (desde el frontend)
 * --------------------------------
 *   POST https://<project>.supabase.co/functions/v1/process-rfid-etl
 *   Headers:
 *     Authorization: Bearer <anon_key>
 *     Content-Type: multipart/form-data   (cuando se sube un CSV)
 *     Content-Type: application/json      (para modo backfill/sync-only)
 *   Body (multipart): file=<csv_file>
 *   Body (json):      { "mode": "backfill" | "sync-only" }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Configuración ────────────────────────────────────────────────────────────

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH_SIZE          = 500;

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

interface EnrichedRow {
  document_id:           string;
  event_type:            string | null;
  impc_code_corrected:   string | null;
  country_corrected:     string | null;
  center_name_corrected: string | null;
  etl_processed_at:      string;
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

function classifyEvent(
  readerImpc: string,
  s9id: string
): { eventType: string; issueDetail: string } {
  if (!s9id || s9id.length < 12) {
    return { eventType: "UNKNOWN", issueDetail: `s9id demasiado corto o nulo: '${s9id}'` };
  }
  if (!readerImpc) {
    return { eventType: "UNKNOWN", issueDetail: "reader_impc es nulo" };
  }

  const originImpc = s9id.slice(0, 6).toUpperCase();
  const destImpc   = s9id.slice(6, 12).toUpperCase();
  const rImpc      = readerImpc.toUpperCase();

  if (rImpc === originImpc) {
    return { eventType: "ORIGIN", issueDetail: "" };
  } else if (rImpc === destImpc) {
    return { eventType: "DESTINATION", issueDetail: "" };
  } else {
    return {
      eventType: "INTERMEDIATE",
      issueDetail: `Lector ${rImpc} no coincide con origen (${originImpc}) ni destino (${destImpc}) del s9id`,
    };
  }
}

// ─── Parseo de CSV ────────────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  // Detectar separador (coma o punto y coma)
  const firstLine = lines[0];
  const sep = firstLine.includes(";") ? ";" : ",";

  const headers = firstLine.split(sep).map(h => h.trim().replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parseo simple respetando comillas
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
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

// ─── Helpers de Supabase ──────────────────────────────────────────────────────

async function selectAll(
  db: ReturnType<typeof createClient>,
  table: string,
  query: Record<string, string> = {}
): Promise<any[]> {
  const allRows: any[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    let q = db.from(table).select(query.select ?? "*").range(from, from + pageSize - 1);
    if (query.event_type === "is.null") q = q.is("event_type", null);
    const { data, error } = await q;
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
    const rfidRows = await selectAll(db, "RFID", {
      select: "id,document_id,event_time_local,event_time_offset,record_time,location,read_point_id,tag_id,impc_code,s9id",
      event_type: "is.null",
    });
    if (!rfidRows.length) {
      console.log("  No hay registros pendientes en RFID. ETL completado.");
      return 0;
    }
    const staging: StagingRow[] = rfidRows.map(r => ({
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

  // Modo incremental: staging ya fue cargado externamente
  const existing = await selectAll(db, "staging_rfid_events", { select: "id" });
  console.log(`  Modo incremental: ${existing.length} registros en staging.`);
  return existing.length;
}

async function fase2Transformacion(
  db: ReturnType<typeof createClient>,
  etlRunId: string,
  readersMaster: Map<string, ReaderMaster>
): Promise<{ enriched: EnrichedRow[]; issues: IssueRow[]; stagingRows: any[] }> {
  console.log("━━━ FASE 2: TRANSFORMACIÓN ━━━");

  const staging = await selectAll(db, "staging_rfid_events", { select: "*" });
  console.log(`  ${staging.length} registros en staging para procesar.`);

  const enriched: EnrichedRow[] = [];
  const issues: IssueRow[] = [];
  const now = new Date().toISOString();
  const stats = { ORIGIN: 0, DESTINATION: 0, INTERMEDIATE: 0, UNKNOWN: 0 };

  for (const row of staging) {
    const readPointId = row.read_point_id ?? "";
    const s9id        = row.s9id         ?? "";
    const tagId       = row.tag_id       ?? "";
    const docId       = row.document_id  ?? "";

    // Validación de campos obligatorios
    const missing: string[] = [];
    if (!readPointId) missing.push("read_point_id");
    if (!s9id)        missing.push("s9id");
    if (!tagId)       missing.push("tag_id");

    if (missing.length) {
      issues.push({
        etl_run_id:       etlRunId,
        source_record_id: String(row.id),
        read_point_id:    readPointId || null,
        s9id:             s9id || null,
        tag_id:           tagId || null,
        issue_type:       "MISSING_FIELD",
        issue_detail:     `Campos obligatorios nulos: ${missing.join(", ")}`,
        severity:         "ALTO",
      });
      stats.UNKNOWN++;
      continue;
    }

    // Búsqueda en el maestro de lectores
    const masterEntry = readersMaster.get(readPointId);
    let readerImpc: string;
    let country: string | null;
    let centerName: string | null;

    if (!masterEntry) {
      issues.push({
        etl_run_id:       etlRunId,
        source_record_id: String(row.id),
        read_point_id:    readPointId,
        s9id,
        tag_id:           tagId,
        issue_type:       "READER_NOT_IN_MASTER",
        issue_detail:     `Lector '${readPointId}' no encontrado en rfid_readers_master. Se usará impc_code original.`,
        severity:         "MEDIO",
      });
      readerImpc  = row.impc_code ?? "";
      country     = null;
      centerName  = null;
    } else {
      readerImpc  = masterEntry.impc_code;
      country     = masterEntry.country;
      centerName  = masterEntry.center_name;
    }

    // Clasificación del evento
    const { eventType, issueDetail } = classifyEvent(readerImpc, s9id);

    if (eventType === "UNKNOWN") {
      issues.push({
        etl_run_id:       etlRunId,
        source_record_id: String(row.id),
        read_point_id:    readPointId,
        s9id,
        tag_id:           tagId,
        issue_type:       "S9ID_INVALID",
        issue_detail:     issueDetail,
        severity:         "ALTO",
      });
    }

    stats[eventType as keyof typeof stats]++;

    if (docId) {
      enriched.push({
        document_id:           docId,
        event_type:            eventType !== "UNKNOWN" ? eventType : null,
        impc_code_corrected:   masterEntry ? readerImpc : null,
        country_corrected:     country,
        center_name_corrected: centerName,
        etl_processed_at:      now,
      });
    }
  }

  console.log(
    `  Clasificación: ORIGIN=${stats.ORIGIN}  DESTINATION=${stats.DESTINATION}  ` +
    `INTERMEDIATE=${stats.INTERMEDIATE}  UNKNOWN=${stats.UNKNOWN}`
  );
  console.log(`  Incongruencias detectadas: ${issues.length}`);

  return { enriched, issues, stagingRows: staging };
}

async function fase3Logging(
  db: ReturnType<typeof createClient>,
  issues: IssueRow[]
): Promise<void> {
  console.log("━━━ FASE 3: LOGGING ━━━");
  if (!issues.length) {
    console.log("  Sin incongruencias que registrar.");
    return;
  }
  await insertBatch(db, "log_rfid_inconsistencies", issues);
  console.log(`  ${issues.length} incongruencias registradas.`);
}

async function fase4Carga(
  db: ReturnType<typeof createClient>,
  enriched: EnrichedRow[],
  stagingRows: any[]
): Promise<number> {
  console.log("━━━ FASE 4: CARGA ━━━");
  if (!enriched.length) {
    console.log("  Sin registros enriquecidos para cargar.");
    return 0;
  }

  const RFID_COLUMNS = new Set([
    "id", "document_id", "event_time_local", "event_time_offset",
    "record_time", "location", "read_point_id", "tag_id", "impc_code", "s9id",
    "event_type", "impc_code_corrected", "country_corrected",
    "center_name_corrected", "etl_processed_at",
  ]);

  const enrichByDocId = new Map(enriched.map(e => [e.document_id, e]));

  const upsertRows: any[] = [];
  for (const row of stagingRows) {
    const docId = row.document_id;
    if (!docId || !enrichByDocId.has(docId)) continue;
    const enrich = enrichByDocId.get(docId)!;
    const merged: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      if (RFID_COLUMNS.has(k)) merged[k] = v;
    }
    merged.event_type            = enrich.event_type;
    merged.impc_code_corrected   = enrich.impc_code_corrected;
    merged.country_corrected     = enrich.country_corrected;
    merged.center_name_corrected = enrich.center_name_corrected;
    merged.etl_processed_at      = enrich.etl_processed_at;
    upsertRows.push(merged);
  }

  console.log(`  Cargando ${upsertRows.length} registros en la tabla RFID...`);
  await upsertBatch(db, "RFID", upsertRows, "document_id");
  console.log(`  Carga completada: ${upsertRows.length} registros.`);
  return upsertRows.length;
}

async function fase5Sincronizacion(
  db: ReturnType<typeof createClient>,
  readersMaster: Map<string, ReaderMaster>
): Promise<void> {
  console.log("━━━ FASE 5: SINCRONIZACIÓN (rfid_readers_master → postal_centers) ━━━");

  const pcRows = await selectAll(db, "postal_centers", { select: "impc_code" });
  const existingImpcs = new Set(pcRows.map((r: any) => r.impc_code));

  const newEntries: any[] = [];
  const seenImpcs = new Set<string>();
  for (const reader of readersMaster.values()) {
    const impc = reader.impc_code;
    if (!existingImpcs.has(impc) && !seenImpcs.has(impc)) {
      newEntries.push({ impc_code: impc, country: reader.country, center_name: reader.center_name });
      seenImpcs.add(impc);
    }
  }

  if (newEntries.length) {
    await insertBatch(db, "postal_centers", newEntries);
    console.log(`  ${newEntries.length} nuevos centros añadidos a postal_centers.`);
  } else {
    console.log(`  postal_centers ya sincronizada (${existingImpcs.size} centros). Sin cambios.`);
  }
}

async function fase6Limpieza(db: ReturnType<typeof createClient>): Promise<void> {
  console.log("━━━ FASE 6: LIMPIEZA ━━━");
  const { error } = await db.from("staging_rfid_events").delete().gte("id", 0);
  if (error) {
    console.warn(`  Advertencia al vaciar staging: ${error.message}`);
  } else {
    console.log("  Staging vaciado correctamente.");
  }
}

// ─── Orquestador Principal ────────────────────────────────────────────────────

async function runEtl(
  mode: string,
  csvRows: Record<string, string>[] | null
): Promise<Record<string, any>> {
  const etlRunId  = crypto.randomUUID();
  const startTime = Date.now();

  console.log("=".repeat(60));
  console.log("  INICIO ETL RFID (Supabase Edge Function)");
  console.log(`  Run ID : ${etlRunId}`);
  console.log(`  Modo   : ${mode}`);
  console.log(`  Inicio : ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Cargar el maestro de lectores en memoria
  const masterRows = await selectAll(db, "rfid_readers_master", { select: "*" });
  const readersMaster = new Map<string, ReaderMaster>(
    masterRows.map((r: any) => [r.read_point_id, r as ReaderMaster])
  );
  console.log(`  ${readersMaster.size} lectores cargados en el maestro.`);

  if (!readersMaster.size) {
    throw new Error("rfid_readers_master está vacío. Abortando ETL.");
  }

  let result: Record<string, any> = { etl_run_id: etlRunId, mode };

  if (mode === "sync-only") {
    await fase5Sincronizacion(db, readersMaster);
    result.sync = "ok";
  } else {
    const nStaged = await fase1Extraccion(db, mode, csvRows);
    if (nStaged === 0) {
      result.message = "Sin datos que procesar. ETL finalizado.";
      return result;
    }

    const { enriched, issues, stagingRows } = await fase2Transformacion(db, etlRunId, readersMaster);
    await fase3Logging(db, issues);
    const nLoaded = await fase4Carga(db, enriched, stagingRows);
    await fase5Sincronizacion(db, readersMaster);
    await fase6Limpieza(db);

    result = {
      ...result,
      staged:         nStaged,
      enriched:       enriched.length,
      loaded:         nLoaded,
      issues:         issues.length,
      duration_ms:    Date.now() - startTime,
    };
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("=".repeat(60));
  console.log(`  ETL RFID COMPLETADO — ${elapsed}s`);
  console.log("=".repeat(60));

  return result;
}

// ─── Handler HTTP ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // CORS headers reutilizables
  const corsHeaders = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info, x-supabase-api-version",
  };

  // CORS preflight
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
      // Subida de CSV
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
      // Modo JSON (backfill, sync-only, incremental)
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
