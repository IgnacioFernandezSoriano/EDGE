# Credenciales del proceso ETL V4 RFID

**Sistema:** Pipeline RFID postal EDGE → Edge Leg2 → Amazon QuickSight
**Documento padre:** [etl_v4_technical_documentation.md](etl_v4_technical_documentation.md)
**Fecha:** 2026-06-04
**Clasificación:** INTERNO — no publicar fuera del equipo

> ⚠️ **Este documento inventaría QUÉ credenciales intervienen y DÓNDE viven, no sus valores.**
> Los valores reales (anon keys, service_role, api-keys, JWT) **nunca** deben escribirse aquí ni
> commitearse al repositorio. Se obtienen del dashboard de Supabase / del proveedor de la EDGE API
> y se guardan exclusivamente en los *secretos de Edge Function* o en el `vault` del proyecto.

---

## 1. Referencias de proyecto (no son secretos, pero contextualizan)

| Rol | Proyecto | Ref (project id) | Organización |
|---|---|---|---|
| Maestro fuente (GMS IOT) | "Monitoring" | `tsvlgznfvgoqbncunumu` | `wvcuinlfxhgmujuhilbw` ("GMS IOT") |
| ETL + reporting (Edge Leg2) | "EDGE LEG2" | `ubgatxfwpmyaqyfrwias` | `hwuajreqsmhxdojtlthg` ("EDGE Study") |
| Dashboard heredado | "EDGE Study" | `ewyhmmixqcubqokphebh` | `hwuajreqsmhxdojtlthg` |

---

## 2. Inventario de credenciales

| # | Credencial | Tipo | Dónde se guarda | Quién la usa | Origen / cómo obtenerla |
|---|---|---|---|---|---|
| 1 | `EDGE_API_KEY` (alias `UPU_RFID_READ_KEY_EDGE_PROD`) | API key (header `x-api-key`) | Secreto de Edge Function en **Edge Leg2** | `edge-rfid-etl-orchestrator` para llamar a la EDGE Read API (AWS) | La emite el proveedor de la EDGE Read API (AWS API Gateway) |
| 2 | `EDGE_API_URL` | URL (config, no secreta) | Secreto/env de Edge Function en **Edge Leg2** | Orquestador | Endpoint AWS: `https://t81an8rql2.execute-api.eu-central-1.amazonaws.com/v1/reads` |
| 3 | `SUPABASE_URL` | URL (no secreta) | Inyectada automáticamente por Supabase en cada Edge Function | Orquestador y `sync-site-snapshot` | `https://ubgatxfwpmyaqyfrwias.supabase.co` (Edge Leg2) |
| 4 | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (**SECRETO ALTO**) | Inyectada automáticamente por Supabase en cada Edge Function de **Edge Leg2** | Orquestador y `sync-site-snapshot` para escribir en las tablas (bypass RLS) | Dashboard Edge Leg2 → Settings → API. **Nunca exponer en cliente.** |
| 5 | `GMS_SITES_URL` | URL (no secreta) | Secreto de Edge Function en **Edge Leg2** | `sync-site-snapshot` | `https://tsvlgznfvgoqbncunumu.supabase.co` (GMS IOT) |
| 6 | `GMS_SITES_KEY` | anon key de **GMS IOT** | Secreto de Edge Function en **Edge Leg2** | `sync-site-snapshot` para leer `readers_master` y `sites` por REST | Dashboard GMS IOT (`tsvlgznfvgoqbncunumu`) → Settings → API → anon/public key |
| 7 | Bearer JWT del cron del orquestador | JWT en el comando del job pg_cron `edge-rfid-etl-every-30-minutes` | Tabla `cron.job` (DB de **Edge Leg2**) | El cron `sync-masters-before-etl` lo **reutiliza en tiempo de ejecución** (regexp del comando) para invocar `sync-site-snapshot` | Generado al crear el cron del orquestador; no se duplica ni se almacena en el job de sync |
| 8 | Token OAuth del servidor MCP de Supabase | OAuth (operación/desarrollo) | Sesión del agente / herramienta MCP | Inspección y administración vía MCP | Flujo OAuth de Supabase MCP; **acotado a UNA organización a la vez** (re-autenticar para cambiar de org) |
| 9 | `AWS_S3_ACCESS_KEY_ID` | AWS access key id | Secreto de Edge Function en **Edge Leg2** | `export-rfid-csv-to-s3` | Canal seguro AWS. ⚠️ **Rotar cuanto antes** (estuvo en texto plano en el documento fuente) |
| 10 | `AWS_S3_SECRET_ACCESS_KEY` | AWS secret access key (**SECRETO ALTO**) | Secreto de Edge Function en **Edge Leg2** | `export-rfid-csv-to-s3` | Canal seguro AWS. ⚠️ **Rotar cuanto antes** (estuvo en texto plano en el documento fuente) |
| 11 | `AWS_S3_REGION` | `eu-central-1` (config, no secreta) | Env de Edge Function en **Edge Leg2** | `export-rfid-csv-to-s3` | Fijada en el spec del consumidor |
| 12 | `S3_BUCKET` | `upu-rfid-reporting` (config) | Env de Edge Function en **Edge Leg2** | `export-rfid-csv-to-s3` | Fijada en el spec del consumidor |
| 13 | `S3_PREFIX` | `quicksight/rfid/current` (config) | Env de Edge Function en **Edge Leg2** | `export-rfid-csv-to-s3` | Fijada en el spec del consumidor |
| 14 | `S3_OBJECT_KEY` | `rfid_movements.csv` (config) | Env de Edge Function en **Edge Leg2** | `export-rfid-csv-to-s3` | Fijada en el spec del consumidor |
| 15 | `EDGE_INTERNAL_INVOKE_KEY` | JWT anon legacy del proyecto (clave pública anon, baja sensibilidad) | Secreto de Edge Function en **Edge Leg2** (orquestador) | `edge-rfid-etl-orchestrator` para invocar a `export-rfid-csv-to-s3` a través del gateway (`verify_jwt=false`) | Es el mismo `eyJ…` rol anon que el cron del orquestador ya usa como `apikey`; no duplica valor nuevo |

---

## 3. Notas por credencial

### 3.1 `EDGE_API_KEY` / `UPU_RFID_READ_KEY_EDGE_PROD` (#1)
- Se envía como header `x-api-key` a la EDGE Read API de AWS.
- El código acepta tres nombres de env (en orden): `EDGE_API_KEY`, `UPU_RFID_READ_KEY_EDGE_PROD`, `upu-rfid-read-key-edge-prod`. Basta con definir uno.
- Si falta, el orquestador responde `500 Missing EDGE_API_KEY secret`.

### 3.2 `SUPABASE_SERVICE_ROLE_KEY` (#4) — máxima sensibilidad
- Da acceso total a la DB de Edge Leg2 (salta RLS). Solo debe vivir dentro de Edge Functions.
- Supabase la inyecta automáticamente; no hace falta declararla manualmente en condiciones normales.
- Nunca debe aparecer en cliente, repos, logs ni en QuickSight (que solo consume la vista).

### 3.3 `GMS_SITES_KEY` (#6) — anon key de GMS IOT
- Es la anon/public key de **GMS IOT**, no de Edge Leg2.
- Funciona para SELECT porque las tablas maestras de GMS IOT tienen **RLS desactivado**.
- ⚠️ **Hueco de seguridad conocido:** en GMS IOT, `anon` tiene DML completo sobre `public.sites` y `public.readers_master`, y esta anon key es pública → pendiente de restringir a SELECT (ver §16.3 del doc técnico).

### 3.4 Bearer JWT reutilizado por el cron (#7)
- Decisión de diseño: las llamadas función→función con la `service_role`/`anon` del entorno devuelven **401** en Edge Leg2 (usa el formato de keys nuevo, no-JWT, que `verify_jwt` rechaza).
- Por eso `sync-masters-before-etl` extrae con regexp el `Bearer eyJ…` del comando del cron del orquestador, que sí pasa `verify_jwt`, y lo reutiliza. La JWT no se copia a un segundo sitio.

### 3.5 Token OAuth MCP (#8)
- Solo para operación/inspección con el servidor MCP de Supabase; no interviene en el runtime del ETL.
- Recordatorio operativo: re-autenticar cambiando de organización para alternar entre GMS IOT y Edge Leg2.

### 3.6 `AWS_S3_ACCESS_KEY_ID` / `AWS_S3_SECRET_ACCESS_KEY` (#9 y #10)
- La política IAM de la key **solo** otorga `s3:PutObject` acotado al prefijo `quicksight/rfid/current/` del bucket `upu-rfid-reporting`. No tiene permisos de lectura (`GetObject`), listado (`ListBucket`) ni acceso a ningún otro bucket.
- El `PutObject` **no** envía header de ACL (el bucket tiene ACLs desactivadas; incluir un header ACL devuelve HTTP 400).
- ⚠️ **Estas claves deben rotarse cuanto antes**: el documento fuente del consumidor las contenía en texto plano y pueden considerarse potencialmente comprometidas. Tras la rotación, actualizar los dos secretos de Edge Function en Edge Leg2 y redeploy de `export-rfid-csv-to-s3` si es necesario.

### 3.7 `EDGE_INTERNAL_INVOKE_KEY` (#15)
- Existe por la misma razón que el JWT reutilizado por el cron del §3.4: las keys del entorno de Edge Leg2 son del **formato nuevo no-JWT**, y el gateway de Functions exige una clave de proyecto válida en formato JWT para enrutar la petición (sin ella, devuelve 401 función→función).
- Se guarda como secreto separado en el orquestador para que el código no tenga que extraer el JWT del comando del cron; el valor es la clave pública anon del proyecto (baja sensibilidad).
- Con `verify_jwt=false` en `export-rfid-csv-to-s3`, el JWT basta para enrutar; la función no lo reverifica. El acceso a la DB sigue usando `SUPABASE_SERVICE_ROLE_KEY` inyectada automáticamente.

---

## 4. Matriz de uso (qué credencial necesita cada componente)

| Componente | Credenciales que consume |
|---|---|
| `edge-rfid-etl-orchestrator` (Edge Function) | #1 `EDGE_API_KEY`, #2 `EDGE_API_URL`, #3 `SUPABASE_URL`, #4 `SUPABASE_SERVICE_ROLE_KEY`, #15 `EDGE_INTERNAL_INVOKE_KEY` |
| `sync-site-snapshot` (Edge Function) | #3 `SUPABASE_URL`, #4 `SUPABASE_SERVICE_ROLE_KEY`, #5 `GMS_SITES_URL`, #6 `GMS_SITES_KEY` |
| `export-rfid-csv-to-s3` (Edge Function) | #3 `SUPABASE_URL`, #4 `SUPABASE_SERVICE_ROLE_KEY`, #9 `AWS_S3_ACCESS_KEY_ID`, #10 `AWS_S3_SECRET_ACCESS_KEY`, #11 `AWS_S3_REGION`, #12 `S3_BUCKET`, #13 `S3_PREFIX`, #14 `S3_OBJECT_KEY` |
| Cron `edge-rfid-etl-every-30-minutes` | #7 Bearer JWT (en su propio comando) |
| Cron `sync-masters-before-etl` | #7 Bearer JWT (reutilizado del cron anterior) |
| QuickSight | Ninguna del pipeline — solo re-importa el CSV desde `s3://upu-rfid-reporting/quicksight/rfid/current/rfid_movements.csv` según su manifest |

---

## 5. Rotación y buenas prácticas

- **Rotar** `EDGE_API_KEY` y `GMS_SITES_KEY` según la política del proveedor; actualizar el secreto de Edge Function correspondiente y redeploy si aplica.
- **Si se rota la service_role** de Edge Leg2, Supabase la propaga a las Edge Functions automáticamente; verificar igualmente que el orquestador y el sync sigan operativos.
- **Si se recrea el cron del orquestador**, el Bearer JWT cambia: confirmar que `sync-masters-before-etl` sigue extrayéndolo correctamente (mismo `jobname` en la regexp).
- **Nunca** commitear valores reales; usar siempre secretos de Edge Function / `vault`.
- Revisar los huecos de seguridad pendientes en §16 del documento técnico (DML de `anon`, RLS de `rfid_etl_incidents`, `verify_jwt=false` de `sync-site-snapshot`).
- ⚠️ **`AWS_S3_ACCESS_KEY_ID` / `AWS_S3_SECRET_ACCESS_KEY`: rotar AHORA** — las claves estuvieron en texto plano en el documento fuente del consumidor y deben considerarse potencialmente comprometidas. Tras la rotación, actualizar los dos secretos de Edge Function en Edge Leg2 (`AWS_S3_ACCESS_KEY_ID` y `AWS_S3_SECRET_ACCESS_KEY`) y redeploy de `export-rfid-csv-to-s3` si Supabase no propaga automáticamente los secretos manuales.
