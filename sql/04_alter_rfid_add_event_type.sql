-- ============================================================
-- SCRIPT 4 de 4: Modificar tabla RFID y sincronizar maestros
-- ============================================================

-- ── PARTE A: Añadir columna event_type a la tabla RFID ──────
-- Esta columna será calculada y rellenada por el ETL.
-- Valores posibles: ORIGIN, DESTINATION, INTERMEDIATE

ALTER TABLE "RFID"
    ADD COLUMN IF NOT EXISTS event_type          text,
    ADD COLUMN IF NOT EXISTS impc_code_corrected text,
    ADD COLUMN IF NOT EXISTS country_corrected   text,
    ADD COLUMN IF NOT EXISTS center_name_corrected text,
    ADD COLUMN IF NOT EXISTS etl_processed_at    timestamptz;

COMMENT ON COLUMN "RFID".event_type IS
    'Clasificacion del evento calculada por el ETL: ORIGIN, DESTINATION o INTERMEDIATE.
     Se determina comparando el impc_code del lector (via rfid_readers_master) con los
     IMPCs codificados en el s9id del receptaculo.';

COMMENT ON COLUMN "RFID".impc_code_corrected IS
    'IMPC correcto del centro donde se realizo la lectura, obtenido de rfid_readers_master.
     Puede diferir del campo impc_code original que proviene de la fuente de datos bruta.';

COMMENT ON COLUMN "RFID".country_corrected IS
    'Pais correcto del centro, obtenido de rfid_readers_master.';

COMMENT ON COLUMN "RFID".center_name_corrected IS
    'Nombre correcto del centro, obtenido de rfid_readers_master.';

COMMENT ON COLUMN "RFID".etl_processed_at IS
    'Timestamp de cuando el ETL proceso y enriquecio este registro.';


-- ── PARTE B: Sincronización de postal_centers ───────────────
-- El ETL mantendrá postal_centers sincronizada con rfid_readers_master
-- para que el proceso de Benchmark existente siga funcionando.
-- Este bloque asegura que todos los IMPCs conocidos en el maestro
-- de lectores también existan en postal_centers.
--
-- NOTA: Este INSERT solo añade centros que falten. Nunca modifica
-- ni elimina registros existentes en postal_centers.

INSERT INTO postal_centers (impc_code, country, center_name)
SELECT DISTINCT
    r.impc_code,
    r.country,
    r.center_name
FROM rfid_readers_master r
WHERE NOT EXISTS (
    SELECT 1 FROM postal_centers pc WHERE pc.impc_code = r.impc_code
)
ON CONFLICT (impc_code) DO NOTHING;

-- Verificación final
SELECT
    'rfid_readers_master' AS tabla, COUNT(*) AS filas FROM rfid_readers_master
UNION ALL
SELECT
    'postal_centers', COUNT(*) FROM postal_centers
UNION ALL
SELECT
    'RFID (con event_type)', COUNT(*) FROM "RFID" WHERE event_type IS NOT NULL;
