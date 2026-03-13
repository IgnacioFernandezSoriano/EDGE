-- Eliminar columnas redundantes de la tabla RFID
-- El ETL escribe directamente en impc_code el valor corregido desde rfid_readers_master.
-- La información de país y nombre de centro se consulta desde rfid_readers_master cuando se necesita.

ALTER TABLE "RFID"
  DROP COLUMN IF EXISTS impc_code_corrected,
  DROP COLUMN IF EXISTS country_corrected,
  DROP COLUMN IF EXISTS center_name_corrected;
