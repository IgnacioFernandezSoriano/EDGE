# Diseño — Export CSV de RFID a S3 para QuickSight

**Fecha:** 2026-06-04
**Sistema:** Pipeline RFID postal — Edge Leg2 (`ubgatxfwpmyaqyfrwias`)
**Documento fuente (spec del consumidor):** `Edge leg2 AWS S3 Bucket Specifications for development.md`
**Doc técnico padre:** [etl_v4_technical_documentation.md](../../etl_v4_technical_documentation.md)
**Clasificación:** INTERNO

> ⚠️ **Aviso de seguridad:** el documento fuente contenía las claves AWS reales en texto plano
> (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`). Esas claves deben tratarse como potencialmente
> comprometidas (pasaron por canal no seguro) y rotarse cuanto antes. **Sus valores no se escriben
> en este repo**: viven solo como *secretos de Edge Function* en Edge Leg2.

---

## 1. Objetivo

Como **último paso** del ciclo del ETL (tras `rfid_finish_etl_run`, cuando la vista
`vw_quicksight_rfid_report_movements` ya refleja los datos nuevos), generar un CSV con el dataset
de la vista y subirlo, **sobrescribiendo siempre la misma key**, a:

```
s3://upu-rfid-reporting/quicksight/rfid/current/rfid_movements.csv   (región eu-central-1)
```

QuickSight ya tiene su manifest y re-importa por horario desde esa key. No hay base de datos ni
UPSERT en AWS: solo se entrega el fichero.

## 2. Arquitectura

Nueva Edge Function de **responsabilidad única**: **`export-rfid-csv-to-s3`** (Edge Leg2).

```
cron */30  ──▶  edge-rfid-etl-orchestrator
                   ├─ rfid_start_etl_run
                   ├─ ingest EDGE API → rfid_edge_input_reads
                   ├─ rfid_enrich_run
                   ├─ rfid_transform_run         (refresca la vista)
                   ├─ rfid_finish_etl_run
                   └─ [ÚLTIMO PASO] invoca export-rfid-csv-to-s3  (try/catch, no bloqueante)
                                         │
                                         ├─ lee vw_quicksight_rfid_report_movements (REST paginado, service_role)
                                         ├─ construye CSV (UTF-8 sin BOM, formato QuickSight)
                                         └─ PutObject SigV4 → s3://upu-rfid-reporting/.../rfid_movements.csv
```

### Decisiones

- **Función dedicada** (no inline en el orquestador): unidad aislada, testeable sola, sin mezclar
  ETL con export. Un fallo de S3 no debe ensuciar la lógica del ETL.
- **`verify_jwt = false`** en la nueva función (igual que `sync-site-snapshot`). Motivo: en este
  proyecto las llamadas función→función con la `service_role`/`anon` del entorno devuelven **401**
  (las keys son del formato nuevo no‑JWT que `verify_jwt` rechaza). Con `verify_jwt=false` el
  orquestador la invoca sin fricción de auth.
- **Aislamiento de fallos:** el orquestador la llama dentro de un `try/catch`. Si el export falla
  (S3 caído, credencial inválida, etc.) se **loguea** y el run del ETL **termina OK igualmente**.
  El export no es condición de éxito del ETL.
- **Alternativa descartada:** cron propio (p. ej. `*5,*35`) que dispare el export tras el ETL.
  Más desacople, pero no es estrictamente "último paso de la generación de la vista" y añade otro
  cron a mantener. Se documenta por si en el futuro se prefiere separar.

## 3. Lectura de la vista

- Vía **REST (PostgREST)** con `SUPABASE_SERVICE_ROLE_KEY`, **paginando con `Range` headers**
  (mismo patrón que el orquestador y `sync-site-snapshot`) hasta agotar filas. Evita el límite de
  1000 filas aunque la vista crezca.
- Se seleccionan **solo las 22 columnas** del §5, en ese orden. Para el cálculo de la hora local
  con offset (ver §4) también se necesita el instante UTC y la zona, ambos ya incluidos en las 22.

## 4. Formato CSV (estricto — §3 del spec del consumidor)

| Regla | Implementación |
|---|---|
| Encoding | UTF‑8 **sin BOM** (`new TextEncoder()` no añade BOM). |
| Cabecera | Primera fila = nombres de columna del §5, en orden. |
| Delimitador | `,` |
| Cualificador de texto | `"`; se entrecomilla cualquier campo que contenga `,`, `"`, `\n` o `\r`; las `"` internas se duplican (`""`). |
| `NULL` | Campo vacío (sin comillas). |
| Booleanos | `true` / `false`. |
| Hora entera | `movement_hour_local` como entero `0–23`. |
| Fecha | `movement_date_local` como `YYYY-MM-DD`; `movement_month_local` como `YYYY-MM` (ya vienen así de la vista). |
| Timestamps UTC | `event_datetime_utc` y `created_at_utc` en ISO‑8601 con `Z`. |
| Timestamp local con offset | **`event_datetime_local` se deriva de `event_datetime_utc` + `reader_timezone`** (no del campo `timestamp without time zone` de la vista, que no lleva offset). Se usa `Intl.DateTimeFormat` con `timeZone` para obtener el offset correcto (respeta DST) y se emite ISO‑8601 con offset, p. ej. `2026-05-27T11:48:19+09:00`. Si falta `reader_timezone`, se cae a UTC (`Z`). |
| Sin ACL | El `PutObject` **no** envía header de ACL (el bucket tiene ACLs desactivadas → un ACL devuelve HTTP 400). |
| Consistencia | Mismas columnas, mismo orden, cada carga. Un único fichero. |

## 5. Columnas (orden exacto)

Todas verificadas como existentes en `vw_quicksight_rfid_report_movements`.

| # | Columna CSV | Origen en la vista | Formato de salida |
|---|---|---|---|
| 1 | `source_edge_id` | `source_edge_id` (text) | texto (clave de idempotencia) |
| 2 | `tag_id` | `tag_id` (text) | texto |
| 3 | `s9_id` | `s9_id` (text) | texto (puede ir vacío) |
| 4 | `reader_id` | `reader_id` (text) | texto |
| 5 | `movement_type` | `movement_type` (varchar) | texto |
| 6 | `event_datetime_utc` | `event_datetime_utc` (timestamptz) | ISO‑8601 `Z` |
| 7 | `event_datetime_local` | derivado de `event_datetime_utc` + `reader_timezone` | ISO‑8601 con offset |
| 8 | `movement_date_local` | `movement_date_local` (date) | `YYYY-MM-DD` |
| 9 | `movement_hour_local` | `movement_hour_local` (int) | entero `0–23` |
| 10 | `movement_month_local` | `movement_month_local` (text) | `YYYY-MM` |
| 11 | `country_code` | `country_code` (varchar) | ISO 3166‑1 alpha‑2 |
| 12 | `country_name` | `country_name` (text) | texto UTF‑8 |
| 13 | `centre_code` | `centre_code` (text) | texto |
| 14 | `site_impc_code` | `site_impc_code` (text) | texto |
| 15 | `site_name` | `site_name` (text) | texto |
| 16 | `city` | `city` (text) | texto UTF‑8 |
| 17 | `edi_equivalent` | `edi_equivalent` (text) | texto |
| 18 | `reader_timezone` | `reader_timezone` (text) | IANA, p. ej. `Asia/Tokyo` |
| 19 | `handover_point` | `handover_point` (boolean) | `true`/`false` |
| 20 | `handover_label` | `handover_label` (text) | texto |
| 21 | `reader_location_label` | `reader_location_label` (text) | texto |
| 22 | `created_at_utc` | `created_at_utc` (timestamptz) | ISO‑8601 `Z` |

## 6. Subida a S3 (AWS Signature V4)

- Implementación **propia y autocontenida** de SigV4 para `PutObject`, usando **Web Crypto** de
  Deno (HMAC‑SHA256 para la cadena de firmado, SHA‑256 del payload). **Sin SDK de AWS** ni nuevas
  dependencias.
- Petición: `PUT https://upu-rfid-reporting.s3.eu-central-1.amazonaws.com/quicksight/rfid/current/rfid_movements.csv`
  - `Content-Type: text/csv`
  - `x-amz-content-sha256: <hex del payload>`
  - `x-amz-date`, `Authorization` (Credential / SignedHeaders / Signature)
  - **Sin** header de ACL.
- La key solo puede `PutObject` en esa ruta (no lista ni lee el bucket): el flujo no depende de más
  permisos.

## 7. Secretos (Edge Function secrets de Edge Leg2 — nunca en repo)

| Secreto | Valor / origen |
|---|---|
| `AWS_S3_ACCESS_KEY_ID` | del canal seguro (rotar cuanto antes) |
| `AWS_S3_SECRET_ACCESS_KEY` | del canal seguro (rotar cuanto antes) |
| `AWS_S3_REGION` | `eu-central-1` |
| `S3_BUCKET` | `upu-rfid-reporting` |
| `S3_PREFIX` | `quicksight/rfid/current` |
| `S3_OBJECT_KEY` | `rfid_movements.csv` |

> Se usa el prefijo `AWS_S3_` en las claves para evitar choques con variables que Supabase pueda
> reservar/inyectar. `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya están auto‑inyectadas.

## 8. Contrato de la función

**Entrada:** invocación POST sin body (o body vacío) desde el orquestador.

**Salida (200):**
```json
{ "ok": true, "rows_exported": 3661, "bytes": 1234567, "s3_key": "quicksight/rfid/current/rfid_movements.csv", "uploaded_at": "2026-06-04T...Z" }
```

**Error (≥400):** `{ "ok": false, "error": "<mensaje>" }` (sin filtrar secretos en el mensaje).

## 9. Manejo de errores

- Falta de secreto → `500` con mensaje claro (`Missing AWS_S3_ACCESS_KEY_ID secret`), sin valor.
- Fallo al leer la vista → `502`, se aborta sin subir nada (no se sube un CSV parcial).
- Fallo de S3 (no‑2xx) → `502` propagando código + cuerpo de S3 (recortado), **sin** credenciales.
- En el orquestador: cualquier error del export se captura, se loguea en la respuesta del run y el
  ETL termina OK (no bloqueante).

## 10. Pruebas / verificación

1. Invocar `export-rfid-csv-to-s3` manualmente y comprobar `{ ok, rows_exported }`.
2. Descargar la key de S3 y validar: cabecera presente, sin BOM (primer byte ≠ `0xEF`), 22 columnas
   en orden, conteo de filas == `rows_exported`, timestamps con offset correcto en un par de filas
   japonesas (`Asia/Tokyo` → `+09:00`).
3. Forzar el flujo completo (orquestador) y confirmar que el CSV se actualiza en cada run.
4. Checklist operativo §6 del spec del consumidor.

## 11. Cambios en seguridad / docs

- Ampliar `docs/etl_v4_credentials.md` con las 6 entradas AWS (nombre + dónde viven, **sin valores**).
- Actualizar el doc técnico (`etl_v4_technical_documentation.md`): nueva Edge Function, nuevo paso
  del orquestador, nuevos secretos.

## 12. Fuera de alcance (YAGNI)

- Sin versionado propio del CSV (el bucket ya versiona).
- Sin export incremental/delta (se sobrescribe el dataset completo; el volumen actual lo permite).
- Sin cron separado (se invoca desde el orquestador). Documentado como alternativa futura.
- Sin notificación automática al owner de QuickSight (paso manual de "going live", una sola vez).
