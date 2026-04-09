# Documentación del ETL del Informe RFID

**Proyecto:** EDGE RFID-EDI Dashboard  
**Última actualización:** Abril 2026

---

## Descripción general

El ETL RFID enriquece la tabla `RFID` de Supabase con la clasificación de eventos (`ORIGIN`, `DESTINATION`, `INTERMEDIATE`, etc.) y mantiene sincronizadas las tablas `rfid_readers_master` y `postal_centers`.

El proceso consta de dos piezas:

| Componente | Ruta | Función |
| :--- | :--- | :--- |
| Script Python | `scripts/process_rfid_etl.py` | Lógica ETL completa |
| Servidor Express | `server/index.ts` | Expone la API HTTP que invoca el script |

---

## Fases del proceso

| Fase | Descripción |
| :--- | :--- |
| **1. Extracción** | Carga datos brutos en `staging_rfid_events` desde la tabla `RFID` (modo `backfill`), desde un CSV (modo `csv`) o asume que ya están en staging (modo `incremental`). |
| **2. Transformación** | Enriquece cada evento usando `rfid_readers_master` y lo clasifica como `ORIGIN`, `DESTINATION`, `DEPARTURE`, `ARRIVAL`, `DEPARTURE_FROM_CENTRE`, `ARRIVAL_AT_CENTRE` o `INTERMEDIATE`. |
| **3. Logging** | Registra incongruencias detectadas (lectores no encontrados en el maestro) en `log_rfid_inconsistencies`. |
| **4. Carga** | Actualiza la tabla `RFID` con los datos enriquecidos usando `upsert` por lotes (`BATCH_SIZE = 500`). |
| **5. Sincronización** | Asegura que `postal_centers` contenga todos los IMPCs presentes en `rfid_readers_master`. |
| **6. Limpieza** | Vacía `staging_rfid_events` para dejar el sistema listo para el siguiente ciclo. |

---

## Modos de ejecución

| Modo | Descripción |
| :--- | :--- |
| `backfill` | Procesa todos los datos existentes en la tabla `RFID` desde cero. |
| `incremental` | Procesa solo los nuevos datos ya cargados en `staging_rfid_events`. |
| `csv` | Carga datos desde un archivo CSV externo y ejecuta el ETL completo. |
| `sync-only` | Solo sincroniza `postal_centers` con `rfid_readers_master`, sin procesar datos RFID. |

---

## API HTTP

El servidor Express (`server/index.ts`) expone los siguientes endpoints. **Todos requieren autenticación de administrador** (cabecera `Authorization: Bearer <token>` con un usuario cuyo `app_metadata.role === "admin"`).

### `GET /api/etl/rfid/status`

Devuelve el estado actual del ETL.

**Respuesta:**
```json
{
  "running": false,
  "lastRunAt": "2026-04-09T15:04:00.000Z",
  "lastRunMode": "incremental",
  "lastRunResult": "success",
  "lastRunDuration": 12.4,
  "lastRunLog": ["[INFO] Fase 1 completada...", "..."]
}
```

---

### `POST /api/etl/rfid/run`

Ejecuta el ETL en modo `backfill`, `incremental` o `sync-only`.

**Body:**
```json
{ "mode": "incremental" }
```

**Respuesta (202 Accepted):**
```json
{
  "message": "ETL iniciado en modo 'incremental'. Consulta /api/etl/rfid/status para seguir el progreso."
}
```

El proceso corre en background. Consulta `/api/etl/rfid/status` para seguir el progreso y ver el log.

---

### `POST /api/etl/rfid/upload`

Sube un archivo CSV y ejecuta el ETL en modo `csv`. El archivo se elimina automáticamente al finalizar.

**Request:** `multipart/form-data` con campo `file` (CSV, máx. 50 MB).

**Respuesta (202 Accepted):**
```json
{
  "message": "ETL iniciado. Consulta /api/etl/rfid/status para seguir el progreso.",
  "file": "datos_rfid.csv",
  "size": 1048576
}
```

---

### `GET /api/audit/status`

Estado del pipeline de auditoría de carga de datos (proceso independiente del ETL RFID).

### `POST /api/audit/run`

Ejecuta el audit pipeline vía Server-Sent Events (SSE). El cliente recibe eventos `start`, `log`, `error` y `done` en tiempo real.

---

## Autenticación

El middleware `requireAdmin` en `server/index.ts` protege todos los endpoints:

1. Extrae el token `Bearer` de la cabecera `Authorization`.
2. Valida el token con `supabase.auth.getUser(token)`.
3. Comprueba que `user.app_metadata.role === "admin"`. Si no, devuelve `403`.

---

## Variables de entorno

| Variable | Usado en | Descripción |
| :--- | :--- | :--- |
| `SUPABASE_URL` | `server/index.ts`, `process_rfid_etl.py` | URL del proyecto Supabase |
| `SUPABASE_ANON_KEY` | `server/index.ts` | Clave anon (Supabase Auth) |
| `SUPABASE_SERVICE_KEY` | `server/index.ts` → pasada al script Python | Clave service role (escritura en tablas) |
| `VITE_SUPABASE_URL` | Frontend (Vite) | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Frontend (Vite) | Clave anon para el cliente del navegador |

Las variables se configuran en `.env.local` (desarrollo local) o en el panel de Netlify / entorno de producción. Nunca se incluyen en el repositorio.

---

## Ejecución manual (CLI)

```bash
# Desde la raíz del proyecto, con las variables de entorno cargadas:
export SUPABASE_URL=https://<proyecto>.supabase.co
export SUPABASE_SERVICE_KEY=<service-role-key>

# Modo retroactivo (procesar todo desde cero):
python3.11 scripts/process_rfid_etl.py --mode backfill

# Modo incremental:
python3.11 scripts/process_rfid_etl.py --mode incremental

# Desde un CSV:
python3.11 scripts/process_rfid_etl.py --mode csv --file /ruta/al/archivo.csv

# Solo sincronizar postal_centers:
python3.11 scripts/process_rfid_etl.py --mode sync-only
```

El script genera un archivo de log con timestamp en el directorio de trabajo: `rfid_etl_YYYYMMDD_HHMMSS.log`.

---

## Archivos relevantes

| Ruta | Descripción |
| :--- | :--- |
| `scripts/process_rfid_etl.py` | Script ETL Python |
| `server/index.ts` | Servidor Express con la API HTTP |
| `client/src/pages/AdminAuditPage.tsx` | Interfaz de administración que consume la API |
| `client/src/lib/supabase.ts` | Cliente Supabase del frontend |
| `.env.local` | Variables de entorno locales (no en git) |
| `netlify.toml` | Configuración de build y redirects para Netlify |
