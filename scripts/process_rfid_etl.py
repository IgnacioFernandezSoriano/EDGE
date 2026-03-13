#!/usr/bin/env python3.11
"""
process_rfid_etl.py
===================
ETL del Informe RFID — Proyecto EDGE
Autor: Manus AI / Ignacio Fernandez Soriano

Descripción
-----------
Proceso ETL completo para enriquecer la tabla RFID con la clasificación
de eventos (ORIGIN, DESTINATION, INTERMEDIATE) y mantener sincronizadas
las tablas rfid_readers_master y postal_centers durante el período de
convivencia paralela con el informe de Benchmark.

Fases del proceso
-----------------
  1. EXTRACCIÓN       — Carga datos brutos en staging_rfid_events
  2. TRANSFORMACIÓN   — Enriquece y clasifica cada evento
  3. LOGGING          — Registra incongruencias en log_rfid_inconsistencies
  4. CARGA            — Actualiza la tabla RFID con los datos enriquecidos
  5. SINCRONIZACIÓN   — Mantiene postal_centers alineada con rfid_readers_master
  6. LIMPIEZA         — Vacía staging_rfid_events

Uso
---
  # Procesar datos desde la tabla RFID existente (modo retroactivo):
  python3.11 process_rfid_etl.py --mode backfill

  # Procesar nuevos datos desde staging (modo incremental):
  python3.11 process_rfid_etl.py --mode incremental

  # Procesar un archivo CSV:
  python3.11 process_rfid_etl.py --mode csv --file /ruta/al/archivo.csv

  # Solo sincronizar postal_centers (sin procesar datos RFID):
  python3.11 process_rfid_etl.py --mode sync-only
"""

import os
import sys
import uuid
import json
import logging
import argparse
import csv
from datetime import datetime, timezone
from typing import Optional

import requests

# ─── Configuración ────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get(
    "SUPABASE_URL",
    "https://ewyhmmixqcubqokphebh.supabase.co"
)
SUPABASE_KEY = os.environ.get(
    "SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eWhtbWl4cWN1YnFva3BoZWJoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjk5NzcyMywiZXhwIjoyMDg4NTczNzIzfQ.7UPBH4yhb2niowAPsVA7xdAf9G89XnzZxo5JO1TBCQk"
)

REST_URL = f"{SUPABASE_URL}/rest/v1"
BATCH_SIZE = 500  # Número de registros por lote en las operaciones de escritura

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(f"rfid_etl_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")
    ]
)
log = logging.getLogger("rfid_etl")


# ─── Cliente Supabase ─────────────────────────────────────────────────────────

class SupabaseClient:
    """Cliente HTTP mínimo para la API REST de Supabase."""

    def __init__(self, url: str, key: str):
        self.url = url
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }

    def _get_headers(self, extra: dict = None) -> dict:
        h = dict(self.headers)
        if extra:
            h.update(extra)
        return h

    def select(self, table: str, params: dict = None, count: bool = False) -> list:
        """Obtiene todos los registros de una tabla con paginación automática."""
        encoded = requests.utils.quote(table)
        all_rows = []
        offset = 0
        page_size = 1000

        while True:
            p = dict(params or {})
            p["limit"] = str(page_size)
            p["offset"] = str(offset)
            h = self._get_headers({"Prefer": "count=exact"} if count else {})
            r = requests.get(f"{self.url}/{encoded}", headers=h, params=p)
            r.raise_for_status()
            rows = r.json()
            if not rows:
                break
            all_rows.extend(rows)
            if len(rows) < page_size:
                break
            offset += page_size

        return all_rows

    def upsert(self, table: str, rows: list, on_conflict: str = None) -> None:
        """Inserta o actualiza registros en lotes."""
        if not rows:
            return
        encoded = requests.utils.quote(table)
        prefer = "resolution=merge-duplicates,return=minimal"
        if on_conflict:
            prefer += f",on_conflict={on_conflict}"

        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i:i + BATCH_SIZE]
            r = requests.post(
                f"{self.url}/{encoded}",
                headers=self._get_headers({"Prefer": prefer}),
                json=batch
            )
            if r.status_code not in (200, 201, 204):
                raise RuntimeError(
                    f"Error upsert en {table}: {r.status_code} — {r.text[:300]}"
                )

    def update_by_id(self, table: str, rows: list, id_field: str = "id") -> None:
        """Actualiza registros individualmente por su ID (para tablas con UUID PK)."""
        if not rows:
            return
        encoded = requests.utils.quote(table)
        errors = []
        for row in rows:
            record_id = row.get(id_field)
            if not record_id:
                continue
            payload = {k: v for k, v in row.items() if k != id_field}
            r = requests.patch(
                f"{self.url}/{encoded}",
                headers=self._get_headers({"Prefer": "return=minimal"}),
                params={id_field: f"eq.{record_id}"},
                json=payload
            )
            if r.status_code not in (200, 204):
                errors.append(f"id={record_id}: {r.status_code} {r.text[:100]}")

        if errors:
            log.warning(f"  {len(errors)} errores en update_by_id para {table}")
            for e in errors[:5]:
                log.warning(f"    {e}")

    def insert(self, table: str, rows: list) -> None:
        """Inserta registros nuevos en lotes."""
        if not rows:
            return
        encoded = requests.utils.quote(table)
        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i:i + BATCH_SIZE]
            r = requests.post(
                f"{self.url}/{encoded}",
                headers=self._get_headers({"Prefer": "return=minimal"}),
                json=batch
            )
            if r.status_code not in (200, 201, 204):
                raise RuntimeError(
                    f"Error insert en {table}: {r.status_code} — {r.text[:300]}"
                )

    def delete_all(self, table: str) -> int:
        """Elimina todos los registros de una tabla (TRUNCATE via DELETE)."""
        encoded = requests.utils.quote(table)
        r = requests.delete(
            f"{self.url}/{encoded}",
            headers=self._get_headers({"Prefer": "return=minimal"}),
            params={"id": "gte.0"}  # Condición que aplica a todos los registros
        )
        if r.status_code not in (200, 204):
            raise RuntimeError(
                f"Error al vaciar {table}: {r.status_code} — {r.text[:200]}"
            )
        return 0


# ─── Lógica de Clasificación ──────────────────────────────────────────────────

def classify_event(reader_impc: str, s9id: str) -> tuple[str, str]:
    """
    Clasifica un evento RFID como ORIGIN, DESTINATION o INTERMEDIATE.

    La lógica se basa en el formato del código s9id:
      - Posiciones 0-5  (6 chars): IMPC del centro de ORIGEN
      - Posiciones 6-11 (6 chars): IMPC del centro de DESTINO

    Si el IMPC del lector coincide con el de origen → ORIGIN
    Si el IMPC del lector coincide con el de destino → DESTINATION
    En cualquier otro caso → INTERMEDIATE

    Retorna: (event_type, issue_detail_or_empty)
    """
    if not s9id or len(s9id) < 12:
        return "UNKNOWN", f"s9id demasiado corto o nulo: '{s9id}'"

    if not reader_impc:
        return "UNKNOWN", "reader_impc es nulo"

    origin_impc = s9id[0:6].upper()
    dest_impc   = s9id[6:12].upper()
    reader_impc = reader_impc.upper()

    if reader_impc == origin_impc:
        return "ORIGIN", ""
    elif reader_impc == dest_impc:
        return "DESTINATION", ""
    else:
        return "INTERMEDIATE", (
            f"Lector {reader_impc} no coincide con origen ({origin_impc}) "
            f"ni destino ({dest_impc}) del s9id"
        )


# ─── Fases del ETL ────────────────────────────────────────────────────────────

def fase1_extraccion(db: SupabaseClient, mode: str, csv_file: str = None) -> int:
    """
    FASE 1 — EXTRACCIÓN
    Carga los datos de entrada en la tabla staging_rfid_events.
    En modo 'backfill' o 'incremental', usa los datos ya existentes en RFID.
    En modo 'csv', carga desde un archivo CSV.
    """
    log.info("━━━ FASE 1: EXTRACCIÓN ━━━")

    if mode == "csv" and csv_file:
        log.info(f"  Cargando datos desde CSV: {csv_file}")
        rows = []
        with open(csv_file, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append({
                    "document_id":       row.get("document_id"),
                    "event_time_local":  row.get("event_time_local"),
                    "event_time_offset": row.get("event_time_offset"),
                    "record_time":       row.get("record_time"),
                    "location":          row.get("location"),
                    "read_point_id":     row.get("read_point_id"),
                    "tag_id":            row.get("tag_id"),
                    "impc_code":         row.get("impc_code"),
                    "s9id":              row.get("s9id"),
                    "source":            "CSV"
                })
        db.insert("staging_rfid_events", rows)
        log.info(f"  {len(rows)} registros cargados desde CSV en staging.")
        return len(rows)

    elif mode in ("backfill", "incremental"):
        # En modo backfill: procesar todos los registros de RFID sin event_type
        # En modo incremental: procesar solo los de staging (ya cargados externamente)
        log.info(f"  Modo {mode}: verificando registros pendientes en staging...")
        staging = db.select("staging_rfid_events", {"select": "id"})
        if staging:
            log.info(f"  {len(staging)} registros ya en staging, continuando.")
            return len(staging)
        else:
            log.info("  Staging vacío. Cargando desde tabla RFID (registros sin procesar)...")
            rfid_rows = db.select("RFID", {
                "select": "id,document_id,event_time_local,event_time_offset,record_time,location,read_point_id,tag_id,impc_code,s9id",
                "event_type": "is.null"
            })
            if not rfid_rows:
                log.info("  No hay registros pendientes en RFID. ETL completado.")
                return 0

            staging_rows = [{
                "document_id":       r.get("document_id"),
                "event_time_local":  r.get("event_time_local"),
                "event_time_offset": r.get("event_time_offset"),
                "record_time":       r.get("record_time"),
                "location":          r.get("location"),
                "read_point_id":     r.get("read_point_id"),
                "tag_id":            r.get("tag_id"),
                "impc_code":         r.get("impc_code"),
                "s9id":              r.get("s9id"),
                "source":            "BACKFILL"
            } for r in rfid_rows]

            db.insert("staging_rfid_events", staging_rows)
            log.info(f"  {len(staging_rows)} registros cargados en staging desde RFID.")
            return len(staging_rows)

    else:
        log.error(f"  Modo desconocido: {mode}")
        return 0


def fase2_transformacion(
    db: SupabaseClient,
    etl_run_id: str,
    readers_master: dict
) -> tuple[list, list, list]:
    """
    FASE 2 — TRANSFORMACIÓN
    Lee staging, enriquece cada evento usando rfid_readers_master
    y clasifica como ORIGIN, DESTINATION o INTERMEDIATE.

    Retorna: (registros_enriquecidos, incongruencias, staging_rows_originales)
    """
    log.info("━━━ FASE 2: TRANSFORMACIÓN ━━━")

    staging = db.select("staging_rfid_events", {"select": "*"})
    log.info(f"  {len(staging)} registros en staging para procesar.")

    enriched = []
    issues = []
    now = datetime.now(timezone.utc).isoformat()

    stats = {"ORIGIN": 0, "DESTINATION": 0, "INTERMEDIATE": 0, "UNKNOWN": 0}

    for row in staging:
        read_point_id = row.get("read_point_id") or ""
        s9id          = row.get("s9id") or ""
        tag_id        = row.get("tag_id") or ""
        doc_id        = row.get("document_id") or ""

        # ── Validación de campos obligatorios ──
        missing = []
        if not read_point_id: missing.append("read_point_id")
        if not s9id:          missing.append("s9id")
        if not tag_id:        missing.append("tag_id")

        if missing:
            issues.append({
                "etl_run_id":       etl_run_id,
                "source_record_id": str(row.get("id")),
                "read_point_id":    read_point_id or None,
                "s9id":             s9id or None,
                "tag_id":           tag_id or None,
                "issue_type":       "MISSING_FIELD",
                "issue_detail":     f"Campos obligatorios nulos: {', '.join(missing)}",
                "severity":         "ALTO"
            })
            stats["UNKNOWN"] += 1
            continue

        # ── Búsqueda en el maestro de lectores ──
        master_entry = readers_master.get(read_point_id)

        if not master_entry:
            issues.append({
                "etl_run_id":       etl_run_id,
                "source_record_id": str(row.get("id")),
                "read_point_id":    read_point_id,
                "s9id":             s9id,
                "tag_id":           tag_id,
                "issue_type":       "READER_NOT_IN_MASTER",
                "issue_detail":     f"Lector '{read_point_id}' no encontrado en rfid_readers_master. Se usará impc_code original.",
                "severity":         "MEDIO"
            })
            # Usar el impc_code original como fallback
            reader_impc  = row.get("impc_code") or ""
            country      = None
            center_name  = None
        else:
            reader_impc  = master_entry["impc_code"]
            country      = master_entry.get("country")
            center_name  = master_entry.get("center_name")

        # ── Clasificación del evento ──
        event_type, issue_detail = classify_event(reader_impc, s9id)

        if event_type == "UNKNOWN":
            issues.append({
                "etl_run_id":       etl_run_id,
                "source_record_id": str(row.get("id")),
                "read_point_id":    read_point_id,
                "s9id":             s9id,
                "tag_id":           tag_id,
                "issue_type":       "S9ID_INVALID",
                "issue_detail":     issue_detail,
                "severity":         "ALTO"
            })

        stats[event_type] += 1

        enriched.append({
            "document_id":          doc_id,
            "event_type":           event_type if event_type != "UNKNOWN" else None,
            "impc_code_corrected":  reader_impc if master_entry else None,
            "country_corrected":    country,
            "center_name_corrected": center_name,
            "etl_processed_at":     now
        })

    log.info(f"  Clasificación: ORIGIN={stats['ORIGIN']}  DESTINATION={stats['DESTINATION']}  INTERMEDIATE={stats['INTERMEDIATE']}  UNKNOWN={stats['UNKNOWN']}")
    log.info(f"  Incongruencias detectadas: {len(issues)}")

    return enriched, issues, staging


def fase3_logging(db: SupabaseClient, issues: list) -> None:
    """
    FASE 3 — LOGGING
    Persiste las incongruencias detectadas en log_rfid_inconsistencies.
    """
    log.info("━━━ FASE 3: LOGGING ━━━")
    if not issues:
        log.info("  Sin incongruencias que registrar.")
        return

    db.insert("log_rfid_inconsistencies", issues)
    log.info(f"  {len(issues)} incongruencias registradas en log_rfid_inconsistencies.")

    # Resumen por tipo
    from collections import Counter
    by_type = Counter(i["issue_type"] for i in issues)
    for issue_type, count in by_type.most_common():
        log.info(f"    {issue_type}: {count}")


def fase4_carga(db: SupabaseClient, enriched: list, rfid_all: list) -> int:
    """
    FASE 4 — CARGA
    Actualiza la tabla RFID con los datos enriquecidos usando upsert por lotes.
    Construye los registros completos combinando los datos originales con el
    enriquecimiento calculado en la fase de transformación.
    """
    log.info("━━━ FASE 4: CARGA ━━━")

    if not enriched:
        log.info("  Sin registros enriquecidos para cargar.")
        return 0

    # Construir índice de enriquecimiento por document_id
    enrich_by_docid = {r["document_id"]: r for r in enriched if r.get("document_id")}
    skipped = len(enriched) - len(enrich_by_docid)
    if skipped:
        log.warning(f"  {skipped} registros sin document_id, omitidos.")

    if not enrich_by_docid:
        log.info("  Sin registros válidos para actualizar.")
        return 0

    # Columnas válidas en la tabla RFID (excluir columnas de staging que no existen en RFID)
    RFID_COLUMNS = {
        "id", "document_id", "event_time_local", "event_time_offset",
        "record_time", "location", "read_point_id", "tag_id", "impc_code", "s9id",
        "event_type", "impc_code_corrected", "country_corrected",
        "center_name_corrected", "etl_processed_at"
    }

    # Construir los registros completos para upsert
    # Combinamos los campos originales de RFID con los campos enriquecidos
    upsert_rows = []
    for rfid_row in rfid_all:
        doc_id = rfid_row.get("document_id")
        if not doc_id or doc_id not in enrich_by_docid:
            continue
        enrich = enrich_by_docid[doc_id]
        # Solo incluir columnas que existen en la tabla RFID
        merged = {k: v for k, v in rfid_row.items() if k in RFID_COLUMNS}
        merged["event_type"]            = enrich.get("event_type")
        merged["impc_code_corrected"]   = enrich.get("impc_code_corrected")
        merged["country_corrected"]     = enrich.get("country_corrected")
        merged["center_name_corrected"] = enrich.get("center_name_corrected")
        merged["etl_processed_at"]      = enrich.get("etl_processed_at")
        upsert_rows.append(merged)

    log.info(f"  Cargando {len(upsert_rows)} registros en lotes de {BATCH_SIZE}...")

    H = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal"
    }

    errors = 0
    loaded = 0
    for i in range(0, len(upsert_rows), BATCH_SIZE):
        batch = upsert_rows[i:i + BATCH_SIZE]
        r = requests.post(
            f"{REST_URL}/RFID",
            headers=H,
            json=batch
        )
        if r.status_code in (200, 201, 204):
            loaded += len(batch)
            log.info(f"  Lote {i//BATCH_SIZE + 1}: {len(batch)} registros OK")
        else:
            errors += len(batch)
            log.warning(f"  Error en lote {i//BATCH_SIZE + 1}: {r.status_code} {r.text[:200]}")

    log.info(f"  Cargados: {loaded}  Errores: {errors}")
    return loaded


def fase5_sincronizacion(db: SupabaseClient, readers_master: dict) -> None:
    """
    FASE 5 — SINCRONIZACIÓN
    Mantiene postal_centers alineada con rfid_readers_master.
    Solo añade centros que falten; nunca modifica ni elimina los existentes.
    Garantiza que el proceso de Benchmark siga funcionando sin cambios.
    """
    log.info("━━━ FASE 5: SINCRONIZACIÓN (rfid_readers_master → postal_centers) ━━━")

    # Obtener IMPCs ya existentes en postal_centers
    pc_rows = db.select("postal_centers", {"select": "impc_code"})
    existing_impcs = {r["impc_code"] for r in pc_rows}

    # Determinar qué IMPCs del maestro de lectores faltan en postal_centers
    new_entries = []
    seen_impcs = set()
    for reader in readers_master.values():
        impc = reader["impc_code"]
        if impc not in existing_impcs and impc not in seen_impcs:
            new_entries.append({
                "impc_code":   impc,
                "country":     reader.get("country"),
                "center_name": reader.get("center_name")
            })
            seen_impcs.add(impc)

    if new_entries:
        db.insert("postal_centers", new_entries)
        log.info(f"  {len(new_entries)} nuevos centros añadidos a postal_centers: {[e['impc_code'] for e in new_entries]}")
    else:
        log.info(f"  postal_centers ya está sincronizada ({len(existing_impcs)} centros). Sin cambios.")


def fase6_limpieza(db: SupabaseClient) -> None:
    """
    FASE 6 — LIMPIEZA
    Vacía la tabla staging_rfid_events una vez que el ciclo ETL
    se ha completado con éxito. Libera recursos para el siguiente ciclo.
    """
    log.info("━━━ FASE 6: LIMPIEZA ━━━")

    # Obtener el conteo antes de limpiar
    staging = db.select("staging_rfid_events", {"select": "id"})
    count = len(staging)

    if count == 0:
        log.info("  Staging ya estaba vacío.")
        return

    # Eliminar todos los registros de staging
    H = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "return=minimal"
    }
    r = requests.delete(
        f"{REST_URL}/staging_rfid_events",
        headers=H,
        params={"id": "gte.0"}
    )
    if r.status_code in (200, 204):
        log.info(f"  Staging vaciado: {count} registros eliminados.")
    else:
        log.warning(f"  Error al vaciar staging: {r.status_code} {r.text[:200]}")


# ─── Orquestador Principal ────────────────────────────────────────────────────

def run_etl(mode: str = "backfill", csv_file: str = None):
    """Orquesta la ejecución completa del ETL."""

    etl_run_id = str(uuid.uuid4())
    start_time = datetime.now(timezone.utc)

    log.info("=" * 60)
    log.info(f"  INICIO ETL RFID")
    log.info(f"  Run ID : {etl_run_id}")
    log.info(f"  Modo   : {mode}")
    log.info(f"  Inicio : {start_time.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    log.info("=" * 60)

    db = SupabaseClient(REST_URL, SUPABASE_KEY)

    # ── Cargar el maestro de lectores en memoria ──
    log.info("  Cargando rfid_readers_master en memoria...")
    master_rows = db.select("rfid_readers_master", {"select": "*"})
    readers_master = {r["read_point_id"]: r for r in master_rows}
    log.info(f"  {len(readers_master)} lectores cargados en el maestro.")

    if not readers_master:
        log.error("  ERROR: rfid_readers_master está vacío. Abortando ETL.")
        sys.exit(1)

    # ── Ejecutar fases ──
    try:
        if mode == "sync-only":
            fase5_sincronizacion(db, readers_master)
        else:
            n_staged = fase1_extraccion(db, mode, csv_file)
            if n_staged == 0:
                log.info("  Sin datos que procesar. ETL finalizado.")
                return

            enriched, issues, staging_rows = fase2_transformacion(db, etl_run_id, readers_master)
            fase3_logging(db, issues)
            n_updated = fase4_carga(db, enriched, staging_rows)
            fase5_sincronizacion(db, readers_master)
            fase6_limpieza(db)

    except Exception as e:
        log.error(f"  ERROR CRÍTICO en el ETL: {e}")
        log.error("  El staging NO ha sido vaciado para permitir diagnóstico.")
        raise

    # ── Resumen final ──
    elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
    log.info("=" * 60)
    log.info(f"  ETL RFID COMPLETADO")
    log.info(f"  Duración: {elapsed:.1f}s")
    log.info("=" * 60)


# ─── Punto de entrada ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="ETL del Informe RFID — Proyecto EDGE"
    )
    parser.add_argument(
        "--mode",
        choices=["backfill", "incremental", "csv", "sync-only"],
        default="backfill",
        help=(
            "backfill: procesa todos los registros RFID sin event_type. "
            "incremental: procesa solo los registros en staging. "
            "csv: carga desde un archivo CSV. "
            "sync-only: solo sincroniza postal_centers."
        )
    )
    parser.add_argument(
        "--file",
        default=None,
        help="Ruta al archivo CSV (solo para --mode csv)."
    )
    args = parser.parse_args()

    if args.mode == "csv" and not args.file:
        parser.error("--mode csv requiere --file <ruta_al_csv>")

    run_etl(mode=args.mode, csv_file=args.file)
