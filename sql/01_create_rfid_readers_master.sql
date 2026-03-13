-- ============================================================
-- SCRIPT 1 de 4: Maestro de Lectores RFID
-- Tabla: rfid_readers_master
-- Propósito: Fuente de verdad para la ubicación correcta de
--            cada lector físico RFID. Uso exclusivo del ETL
--            del informe RFID. No afecta a tracking_events.
-- ============================================================

CREATE TABLE IF NOT EXISTS rfid_readers_master (
    read_point_id           text        PRIMARY KEY,
    impc_code               text        NOT NULL,
    country                 text,
    center_name             text,
    reader_location_details text,
    created_at              timestamptz DEFAULT now(),
    updated_at              timestamptz DEFAULT now()
);

COMMENT ON TABLE rfid_readers_master IS
    'Maestro de lectores RFID: fuente de verdad para la ubicacion correcta de cada lector. Uso exclusivo del ETL del informe RFID.';

COMMENT ON COLUMN rfid_readers_master.read_point_id IS
    'Identificador unico del lector fisico. Clave primaria.';
COMMENT ON COLUMN rfid_readers_master.impc_code IS
    'Codigo IMPC CORRECTO del centro al que pertenece el lector. Puede diferir del impc_code almacenado en la tabla RFID bruta.';
COMMENT ON COLUMN rfid_readers_master.reader_location_details IS
    'Descripcion de la ubicacion fisica del lector dentro del centro (ej. Gate 1, Dock B, Outbound).';

-- Poblar con los 18 lectores conocidos y sus IMPCs correctos
-- (Datos verificados del análisis de la tabla RFID)
INSERT INTO rfid_readers_master (read_point_id, impc_code, country, center_name, reader_location_details)
VALUES
    ('J11DJ0000900000005', 'INBOMC', 'India',       'Kolkata OE',            NULL),
    ('J11DJ0000900000007', 'INBOMA', 'India',       'Mumbai OE',             NULL),
    ('J11DJ0000900000008', 'INBOMA', 'India',       'Mumbai OE',             NULL),
    ('J11DJ0000900000012', 'KRSELB', 'South Korea', 'Seoul Int Post Office', NULL),
    ('J11DJ0001000000016', 'HKHKGA', 'Hong Kong',   'Hong Kong AMU',         NULL),
    ('J11DJ0001800000116', 'JPKWSA', 'Japan',       'Kawasaki Higashi OE',   NULL),
    ('J11DJ0001800000118', 'JPKWSA', 'Japan',       'Kawasaki Higashi OE',   NULL),
    ('J11DJ0001900000033', 'BRCWBA', 'Brazil',      'Curitiba CEINT',        NULL),
    ('J11DJ0001900000034', 'BRCWBA', 'Brazil',      'Curitiba CEINT',        NULL),
    ('J11DJ0001900000035', 'BRCWBA', 'Brazil',      'Curitiba CEINT',        NULL),
    ('J11DJ0001900000036', 'BRCWBA', 'Brazil',      'Curitiba CEINT',        NULL),
    ('J11DJ0001900000057', 'BTTHIA', 'Bhutan',      'Thimphu GPO',           NULL),
    ('J11DJ0002000000123', 'SGSINA', 'Singapore',   'Singapore AMU',         NULL),
    ('J11DJ0002000000125', 'SGSIND', 'Singapore',   'Singapore OE',          NULL),
    ('J11DJ0002000000129', 'SGSINA', 'Singapore',   'Singapore AMU',         NULL),
    ('J11DJ0002100000017', 'BRSAOD', 'Brazil',      'São Paulo CEINT',       NULL),
    ('J11DJ0002100000020', 'BRSAOD', 'Brazil',      'São Paulo CEINT',       NULL),
    ('J11DJ0002100000025', 'BRSAOD', 'Brazil',      'São Paulo CEINT',       NULL)
ON CONFLICT (read_point_id) DO NOTHING;
