-- ============================================================
-- SCRIPT 2 de 4: Tabla de Staging para datos brutos RFID
-- Tabla: staging_rfid_events
-- Propósito: Zona de aterrizaje temporal para los datos de
--            entrada (API o CSV). Se vacía automáticamente
--            al final de cada ciclo ETL exitoso.
-- ============================================================

CREATE TABLE IF NOT EXISTS staging_rfid_events (
    id                  bigserial   PRIMARY KEY,
    document_id         text,
    event_time_local    timestamptz,
    event_time_offset   text,
    record_time         timestamptz,
    location            text,
    read_point_id       text,
    tag_id              text,
    impc_code           text,
    s9id                text,
    loaded_at           timestamptz DEFAULT now(),
    source              text        DEFAULT 'API'  -- 'API' o 'CSV'
);

COMMENT ON TABLE staging_rfid_events IS
    'Tabla de staging temporal para la ingesta de datos brutos RFID. Estructura identica a la fuente de datos. Se vacia al final de cada ciclo ETL exitoso.';

COMMENT ON COLUMN staging_rfid_events.source IS
    'Origen de la carga: API (carga automatica) o CSV (carga manual).';
COMMENT ON COLUMN staging_rfid_events.loaded_at IS
    'Timestamp de cuando el registro fue cargado en staging.';
