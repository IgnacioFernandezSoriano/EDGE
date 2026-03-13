-- ============================================================
-- SCRIPT 3 de 4: Log de incongruencias del ETL RFID
-- Tabla: log_rfid_inconsistencies
-- Propósito: Registrar todas las anomalías detectadas durante
--            el proceso ETL para revisión por el administrador.
-- ============================================================

CREATE TABLE IF NOT EXISTS log_rfid_inconsistencies (
    id                  bigserial   PRIMARY KEY,
    etl_run_id          uuid        NOT NULL,
    etl_run_at          timestamptz DEFAULT now(),
    source_record_id    text,                       -- id del registro en staging
    read_point_id       text,
    s9id                text,
    tag_id              text,
    issue_type          text        NOT NULL,        -- ver valores posibles abajo
    issue_detail        text,                       -- descripción detallada del problema
    severity            text        DEFAULT 'MEDIO', -- ALTO, MEDIO, BAJO
    admin_decision      text,                       -- KEEP, DELETE, CORRECTED
    admin_notes         text,
    admin_reviewed_by   text,
    admin_reviewed_at   timestamptz,
    created_at          timestamptz DEFAULT now()
);

COMMENT ON TABLE log_rfid_inconsistencies IS
    'Log de incongruencias detectadas durante el ETL del informe RFID. Para revision y decision por el administrador.';

COMMENT ON COLUMN log_rfid_inconsistencies.issue_type IS
    'Tipo de incongruencia. Valores posibles:
     READER_NOT_IN_MASTER   - El read_point_id no existe en rfid_readers_master.
     S9ID_INVALID           - El s9id no tiene el formato esperado o no contiene IMPCs validos.
     S9ID_IMPC_MISMATCH     - El IMPC del lector no coincide con ninguno de los IMPCs del s9id.
     DUPLICATE_EVENT        - El evento ya existe en la tabla RFID (mismo document_id).
     MISSING_FIELD          - Falta un campo obligatorio (s9id, read_point_id, tag_id).';

COMMENT ON COLUMN log_rfid_inconsistencies.severity IS
    'Nivel de severidad: ALTO (impide el procesamiento), MEDIO (procesado con advertencia), BAJO (informativo).';

COMMENT ON COLUMN log_rfid_inconsistencies.admin_decision IS
    'Decision del administrador: KEEP (mantener el registro), DELETE (eliminar), CORRECTED (se ha corregido manualmente).';

-- Índice para facilitar la consulta por ejecución ETL
CREATE INDEX IF NOT EXISTS idx_log_rfid_etl_run_id
    ON log_rfid_inconsistencies (etl_run_id);

-- Índice para facilitar la consulta de registros pendientes de revisión
CREATE INDEX IF NOT EXISTS idx_log_rfid_pending
    ON log_rfid_inconsistencies (admin_decision)
    WHERE admin_decision IS NULL;
