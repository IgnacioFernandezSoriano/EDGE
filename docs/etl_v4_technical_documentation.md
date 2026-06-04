# Documentación técnica — ETL V4 RFID: EDGE API (AWS) → Edge Leg2 → QuickSight

**Sistema:** Pipeline RFID postal EDGE → Edge Leg2 → Amazon QuickSight
**Versión:** V4 (incorpora sincronización dinámica de maestros desde GMS IOT antes de cada ETL)
**Fecha:** 2026-06-04
**Estado:** En producción y verificado

> **Qué añade V4 sobre V3:** V3 enriquecía las lecturas contra snapshots locales de lectores y sitios que **nunca se refrescaban** (carga manual única). Esto provocaba datos en blanco/obsoletos en la vista de QuickSight (p. ej. `site_impc_code`, `edi_equivalent`, `site_name`) e incluso movimientos infracontados (lectores con `product` nulo quedaban fuera del alcance Leg2). **V4 introduce un refresco automático de los maestros (`readers_master` y `sites`) desde GMS IOT como paso previo a cada ejecución del ETL**, de modo que la transformación siempre usa el maestro vigente.

---

## 1. Proyectos y entornos (3 proyectos Supabase, 2 organizaciones)

| Rol | Proyecto | Ref | Organización |
|---|---|---|---|
| **Maestro fuente (GMS IOT)** | "Monitoring" | `tsvlgznfvgoqbncunumu` | `wvcuinlfxhgmujuhilbw` ("GMS IOT") |
| **ETL + reporting (Edge Leg2)** | "EDGE LEG2" | `ubgatxfwpmyaqyfrwias` | `hwuajreqsmhxdojtlthg` ("EDGE Study") |
| **Dashboard heredado** | "EDGE Study" | `ewyhmmixqcubqokphebh` | `hwuajreqsmhxdojtlthg` |

- **Toda la lógica ETL V4 y la vista de QuickSight viven en `ubgatxfwpmyaqyfrwias` (Edge Leg2).**
- **GMS IOT** (`tsvlgznfvgoqbncunumu`) es la **fuente externa del maestro** de lectores y sitios. Edge Leg2 lee de él por REST con la `anon` key (RLS desactivado en sus tablas maestras).
- El proyecto "EDGE Study" (`ewyhmmixqcubqokphebh`) es el dashboard heredado (tablas `RFID`, `tracking_events`, `benchmark_rfid_edi`); **no forma parte del pipeline V4** y se documenta aparte en `data_flow_dashboard.md`.

> Nota operativa: el token OAuth del servidor MCP de Supabase se acota a **una organización a la vez**; para inspeccionar GMS IOT y Edge Leg2 hay que re-autenticar cambiando de organización.

---

## 2. Arquitectura y flujo de datos

```
┌──────────────────────────────────────────────────────────────────────────┐
│ FUENTE 1 — EDGE Read API (AWS API Gateway)                                 │
│ GET https://t81an8rql2.execute-api.eu-central-1.amazonaws.com/v1/reads     │
│ Auth: header x-api-key   |  Paginación: ?limit=&cursor=&since=             │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ (ingesta incremental)
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ FUENTE 2 — GMS IOT (tsvlgznfvgoqbncunumu)                                   │
│  public.readers_master  (lpi, site_id, product[], handover, EDI, país…)    │
│  public.sites           (id, site_impc, name, country, city, timezone)     │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ REST (anon key)  ── refresco ANTES del ETL ──┐
                ▼                                              │
┌──────────────────────────────────────────────────────────────────────────┐
│ EDGE LEG2 (ubgatxfwpmyaqyfrwias)                                            │
│                                                                            │
│  [cron :25/:55] sync-masters-before-etl → Edge Function sync-site-snapshot │
│        ├─ UPSERT public.rfid_reader_master_snapshot  (por lpi)             │
│        └─ UPSERT public.rfid_site_snapshot           (por site_id)         │
│                                                                            │
│  [cron :00/:30] edge-rfid-etl-every-30-minutes → Edge Function             │
│        edge-rfid-etl-orchestrator:                                         │
│        1. rfid_start_etl_run        (lock + run en cursor_state/etl_runs)  │
│        2. Ingesta EDGE → UPSERT public.rfid_edge_input_reads (por edge_id) │
│        3. rfid_enrich_run(run_id)   (normaliza, S9, snapshots, Leg2)       │
│        4. rfid_transform_run(run_id)(movimientos por tag_id+s9_id)         │
│        5. rfid_finish_etl_run       (cursor, métricas, libera lock)        │
│                                                                            │
│  [cron :05/:35] rfid-reprocess-recoverable-every-30-minutes →             │
│        rfid_reprocess_recoverable() (recupera lecturas bloqueadas/erróneas)│
│                                                                            │
│  public.rfid_report_movements  (tabla física final de movimientos)        │
│        └─► public.vw_quicksight_rfid_report_movements (VISTA)             │
└───────────────────────────────────────────────────────────────┬──────────┘
                                                                  ▼
                                                        Amazon QuickSight
```

**Cadencia (cron, UTC):**

| Minuto | Job | Acción |
|---|---|---|
| `:25`, `:55` | `sync-masters-before-etl` | Refresca lectores + sitios desde GMS IOT (5 min antes del ETL) |
| `:00`, `:30` | `edge-rfid-etl-every-30-minutes` | Ingesta + enriquecimiento + transformación |
| `:05`, `:35` | `rfid-reprocess-recoverable-every-30-minutes` | Reproceso de lecturas recuperables |

---

## 3. Fuente 1 — EDGE Read API (AWS)

| Aspecto | Detalle |
|---|---|
| Endpoint | `https://t81an8rql2.execute-api.eu-central-1.amazonaws.com/v1/reads` (configurable vía secreto `EDGE_API_URL`) |
| Autenticación | Header `x-api-key` (secreto `EDGE_API_KEY` / `UPU_RFID_READ_KEY_EDGE_PROD`) |
| Paginación | `?limit=` (def. 1000), `?cursor=` (continuación), `?since=` (timestamp UTC inicial) |
| Respuesta | JSON con array en `data` o `reads`; cursor en `next_cursor` / `nextCursor` / `cursor` |
| Límites por run | `ETL_MAX_PAGES` (def. 25 páginas) y `ETL_TIME_BUDGET_MS` (def. 150 000 ms) |

**Normalización de cada lectura** (alias aceptados → campo canónico, en `normalizeRead`):

| Canónico | Alias aceptados | Obligatorio |
|---|---|---|
| `edge_id` | `id`, `edgeId`, `edge_id`, `readId`, `read_id` | Sí (si falta, se descarta la lectura) |
| `tag_id` | `tagId`, `tag_id`, `tag`, `epc` | Sí (validación posterior) |
| `s9_id` | `s9Id`, `s9_id`, `s9`, `postalId`, `postal_id` | Sí (validación posterior) |
| `reader_id` | `readerId`, `reader_id`, `reader`, `lpi` | Sí |
| `event_datetime_utc` | `timestamp`, `eventTimestamp`, `event_timestamp`, `readAt`, `read_at`, `createdAt`, `created_at` | Sí |
| `edge_received_at_utc` | `ingestedAt`, `ingested_at`, `receivedAt`, `received_at` | No |
| `raw_payload` | (payload completo) | Sí — trazabilidad / renormalización |

La lectura se persiste en `public.rfid_edge_input_reads` con `enrichment_status='pending'`, `transform_status='pending'`, mediante **UPSERT por `edge_id`** (idempotente: reintentar una página no duplica).

---

## 4. Fuente 2 — Maestros GMS IOT y su sincronización (novedad V4)

### 4.1 Tablas fuente en GMS IOT (`tsvlgznfvgoqbncunumu`)

**`public.readers_master`** (RLS desactivado; `anon` con SELECT). Es la verdad funcional del lector:

| Columna | Tipo | Uso |
|---|---|---|
| `lpi` | text | Identificador del lector (clave de cruce con `reader_id`) |
| `site_id` | uuid | Vínculo al sitio |
| `gate_id` | text | Puerta / punto físico |
| `country_code` | text | País del lector |
| `product` | text[] | Alcance de producto; si contiene `Leg2` el lector pertenece al pipeline |
| `handover_point` | bool | Marca de punto de traspaso (prioriza selección de movimientos) |
| `edi_equivalent_inbound` / `edi_equivalent_outbound` | text | Equivalencia EDI por sentido (p. ej. `RESDES`/`PREDES`) |
| (otros) | | `city`, `country_name`, `facility_name`, `gate_name`, `reading_direction`, `operations_scope`, … |

**`public.sites`** (RLS desactivado; `anon` con SELECT). Maestro de sitios:

| Columna | Tipo | → `rfid_site_snapshot` |
|---|---|---|
| `id` | uuid | `site_id` |
| `site_impc` | text | `site_impc_code` |
| `name` | text | `site_name` |
| `country_code` / `country_name` / `city` | text | idem |
| `timezone` | text | `timezone` |

> `sites` **no tiene columnas EDI**: el EDI es a nivel de lector (`readers_master`). Por eso el EDI a nivel de sitio se **agrega desde los lectores** durante la sincronización.

### 4.2 Edge Function `sync-site-snapshot` (refresco de maestros)

- **Ubicación:** Edge Leg2, `supabase/functions/sync-site-snapshot/index.ts`.
- **Auth:** `verify_jwt = false` (función **interna**, sin input que altere su comportamiento; solo la invoca el cron interno).
- **Secretos:** `GMS_SITES_URL` = `https://tsvlgznfvgoqbncunumu.supabase.co`, `GMS_SITES_KEY` = anon key de GMS IOT.
- **Lógica:**
  1. `GET /rest/v1/readers_master?select=*` (paginado) → **UPSERT `rfid_reader_master_snapshot`** por `lpi`. Mapea `lpi`, `site_id`, `gate_id`, `reader_country_code` (solo códigos de 2 letras; el resto → NULL), `handover_point`, `product` (text[]) y `raw_payload` (fila completa de GMS).
  2. Agrega EDI por `site_id` desde los lectores recién traídos (primer valor no nulo de inbound/outbound por sitio).
  3. `GET /rest/v1/sites?select=id,site_impc,name,country_code,country_name,city,timezone` → **UPSERT `rfid_site_snapshot`** por `site_id`, incluyendo el EDI agregado del paso 2.
- **Respuesta:** `{ ok, readers_fetched, readers_upserted, sites_fetched, sites_upserted, sites_with_edi, synced_at }`.
- **Idempotente:** UPSERT por clave; ejecutar N veces deja el mismo estado.

### 4.3 Política de refresco ANTES del ETL (cron `sync-masters-before-etl`)

- **Job pg_cron** `sync-masters-before-etl`, schedule `25,55 * * * *` (5 min antes de cada ETL de `:00`/`:30`).
- Invoca `sync-site-snapshot` vía `net.http_post`, reutilizando **en tiempo de ejecución** el Bearer JWT del cron del orquestador (`edge-rfid-etl-every-30-minutes`) — la JWT no se duplica ni se almacena en este job:
  ```sql
  select net.http_post(
    url := 'https://ubgatxfwpmyaqyfrwias.supabase.co/functions/v1/sync-site-snapshot',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization', 'Bearer ' || (
        select (regexp_match(command, 'Bearer\s+(eyJ[A-Za-z0-9_.\-]+)'))[1]
        from cron.job where jobname = 'edge-rfid-etl-every-30-minutes')),
    body := '{}'::jsonb);
  ```

> **Decisión de diseño:** el refresco se hace por un cron dedicado 5 min antes y **no** desde dentro del orquestador. Motivo: las llamadas función→función con la `service_role`/`anon` del entorno devuelven 401 en este proyecto (usa el formato de keys nuevo, no-JWT, que `verify_jwt` rechaza). El cron reutiliza el JWT que sí funciona. El resultado funcional es el mismo: maestros frescos antes de transformar.

---

## 5. Orquestador del ETL (Edge Function `edge-rfid-etl-orchestrator`)

- **Ubicación:** Edge Leg2, `supabase/functions/edge-rfid-etl-orchestrator/index.ts`. `verify_jwt = true`.
- **Disparo:** cron `edge-rfid-etl-every-30-minutes` (`*/30 * * * *`).
- **Parámetros (body o env):** `environment` (def. `production`), `mode` (def. `incremental`), `max_pages`, `page_limit`, `time_budget_ms`.

**Fases:**

| # | Paso | Implementación |
|---|---|---|
| 1 | **Arranque** | `rfid_start_etl_run(env, mode, lock_owner, lock_minutes)`: inserta/asegura fila en `rfid_edge_api_cursor_state`, toma lock lógico (advisory por estado), crea fila `running` en `rfid_etl_runs`. Si hay lock vigente → `skipped_locked`. |
| 2 | **Ingesta** | Bucle paginado contra EDGE API (`since`/`cursor`), normaliza y **UPSERT** en `rfid_edge_input_reads` por `edge_id`. Avanza cursor solo tras persistir. Respeta `max_pages` y `time_budget_ms`. |
| 3 | **Enriquecimiento** | `rfid_enrich_run(run_id)` (ver §6). |
| 4 | **Transformación** | `rfid_transform_run(run_id)` (ver §7). |
| 5 | **Cierre** | `rfid_finish_etl_run(...)`: actualiza `rfid_etl_runs` (estado, métricas, cursor), avanza `current_cursor`/`initial_since_utc` en `cursor_state`, libera lock. En `success` sin cursor nuevo, fija `initial_since_utc = max(edge_received_at_utc|event_datetime_utc)+1ms`. |

> El refresco de maestros (sync) ya NO se invoca aquí; lo hace el cron del §4.3 antes del ETL.

---

## 6. Enriquecimiento — `rfid_enrich_run(p_run_id uuid)`

`SECURITY DEFINER`. Sobre las lecturas del `run_id`, hace un UPDATE con:
```
LEFT JOIN rfid_reader_master_snapshot rm ON rm.lpi = reads.reader_id
LEFT JOIN rfid_site_snapshot          s  ON s.site_id = rm.site_id
```

**Cálculo de país (S9):**
- `origin_country_code = rfid_s9_origin_country(s9_id)` → `upper(substring(s9_id,1,2))` si casa `^[A-Za-z]{2}`.
- `destination_country_code = rfid_s9_destination_country(s9_id)` → `upper(substring(s9_id,7,2))` si casa `^[A-Za-z]{6}[A-Za-z]{2}`.

**Estado de enriquecimiento (`enrichment_status`):**
| Condición | Estado |
|---|---|
| Falta `edge_id`/`tag_id`/`s9_id`/`reader_id`/`event_datetime_utc`, o S9 inválido (`rfid_valid_s9_for_route` falso) | `invalid` |
| `reader_id` no existe en el snapshot de lectores (`rm.lpi IS NULL`) | `unknown_reader` |
| Lector existe pero `rfid_reader_is_leg2(rm.product, rm.raw_payload)` falso | `ignored_non_leg2_reader` |
| Resto | `enriched` |

**Campos resueltos (solo si el lector es Leg2; si no, NULL):** `reader_country_code` (`coalesce(s.country_code, rm.reader_country_code)`), `reader_country_name` (`s.country_name`), `reader_city` (`s.city`), `site_impc_code` (`s.site_impc_code`), `site_name` (`s.site_name`), `centre_code` (`coalesce(s.centre_code, s.site_impc_code, rm.site_id, reader_id)`), `edi_equivalent_inbound/outbound` (`s.*`), `reader_timezone` (`coalesce(nullif(s.timezone,''),'UTC')`), `handover_point`, y `event_datetime_local` (= `event_datetime_utc at time zone` la timezone resuelta).

**`rfid_reader_is_leg2(product text[], raw_payload jsonb)`:** devuelve true si `'leg2'` (case-insensitive) aparece en el array `product`, o en `raw_payload->'product'` (array), o en `raw_payload->>'product'` (texto).

---

## 7. Transformación — `rfid_transform_run(p_run_id uuid)`

`SECURITY DEFINER`. Construye movimientos por par **`tag_id + s9_id`** a partir de las lecturas `enriched` del run:

1. Determina los pares afectados (distinct `tag_id, s9_id` del run).
2. Inserta incidencias bloqueantes para lecturas no transformables (ver §9).
3. **Borra** los movimientos existentes de esos pares (reconstrucción idempotente).
4. Agrupa por país observado (`country_groups`) y calcula `country_sequence_number` (`dense_rank` por orden temporal).
5. Selecciona candidatos por tipo de movimiento, priorizando `handover_point` y luego el orden temporal:

| `movement_type` | `route_country_role` | Selección | Orden de desempate |
|---|---|---|---|
| `OUTBOUND` | ORIGIN | país = origen S9 | handover desc, fecha **desc**, edge_id desc |
| `INBOUND` | DESTINATION | país = destino S9 | handover desc, fecha **asc**, edge_id asc |
| `TRANSIT_ENTRY` | TRANSIT | país ≠ origen y ≠ destino | handover desc, fecha **asc** |
| `TRANSIT_EXIT` | TRANSIT | país ≠ origen y ≠ destino | handover desc, fecha **desc** |

6. `handover_quality_status`: `handover_ok` si el candidato es handover; si no, `non_handover_selected_for_*` (y se registra incidencia informativa).
7. **INSERT** en `rfid_report_movements` con `movement_id = rfid_make_movement_id(edge_id, movement_type, movement_country_code)` (SHA-256 hex de `edge_id|tipo|país` → clave idempotente).
8. Mapea `country_code = movement_country_code`, `country_name = reader_country_name`, `city = reader_city`, `edi_equivalent = CASE WHEN tipo IN ('OUTBOUND','TRANSIT_EXIT') THEN edi_equivalent_outbound ELSE edi_equivalent_inbound END`, `centre_code = coalesce(centre_code, site_impc_code)`, `reader_timezone = coalesce(reader_timezone,'UTC')`.
9. Marca `transform_status = 'processed'` (o `ignored_non_leg2_reader`).

---

## 8. Reproceso

| Función | Firma | Uso |
|---|---|---|
| `rfid_reprocess_recoverable` | `(p_environment text, p_max_reads int, p_reason text)` | Reproceso recuperable. Selecciona lecturas `pending`/`unknown_reader`/`ignored_non_leg2_reader`, `transform_status` `pending`/`blocked`, o con incidencias bloqueantes abiertas. **Si `p_reason='leg2_scope_migration'` selecciona TODAS las lecturas** (forzar re-enriquecido tras cambios de maestro). Renormaliza desde `raw_payload`, re-enriquece contra snapshots vigentes, cierra incidencias resueltas y **reconstruye los movimientos de los pares afectados**. Lock por `pg_try_advisory_xact_lock`. |
| `rfid_reprocess_scope` | `(p_filters jsonb, p_environment text, p_max_reads int, p_reason text)` | Reproceso acotado por filtros (subconjunto). |
| `rfid_recalculate_reader_history` | `(p_reader_id text, p_environment text, p_max_reads int)` | Recalcula el histórico de un lector concreto (botón operativo). Delega en el mecanismo recuperable. |

Cron `rfid-reprocess-recoverable-every-30-minutes` (`5,35 * * * *`) ejecuta `rfid_reprocess_recoverable('production', 5000, 'scheduled_reprocess_30m')`.

> **Operación de migración/backfill:** tras cargar/refrescar snapshots, ejecutar `select * from rfid_reprocess_recoverable('production', 50000, 'leg2_scope_migration');` para re-aplicar maestros a todo el histórico.

---

## 9. Máquina de estados e incidencias

**`enrichment_status`:** `pending` → `enriched` | `invalid` | `unknown_reader` | `ignored_non_leg2_reader`.
**`transform_status`:** `pending` → `processed` | `blocked` | `ignored_non_leg2_reader`.

**`rfid_etl_incidents`** (incidencias bloqueantes e informativas):

| `incident_type` | Bloqueante | Causa |
|---|---|---|
| `missing_edge_id` / `missing_tag_id` / `missing_s9_id` / `missing_reader_id` | Sí | Campo canónico ausente |
| `invalid_s9_id_format` | Sí | S9 no permite derivar origen/destino |
| `invalid_timestamp` | Sí | Sin fecha válida |
| `unknown_reader` | Sí (para transformar) | Lector ausente del snapshot |
| `non_handover_selected_for_*` | No | Movimiento elegido sin punto handover |

`ignored_non_leg2_reader` **no** genera incidencia de error (exclusión funcional esperada). Las incidencias recuperables se cierran en el reproceso si se corrige la causa. Hay dedup por `(source_edge_id, incident_type, status='open')`.

---

## 10. Catálogo de tablas (Edge Leg2, esquema `public`)

| Tabla | Tipo | PK / clave | Rol |
|---|---|---|---|
| `rfid_edge_api_cursor_state` | operativa | `environment` | Cursor, lock y métricas de ingesta por entorno |
| `rfid_etl_runs` | auditoría | `run_id` (uuid) | Una fila por ejecución (estado, cursores, conteos, error) |
| `rfid_edge_input_reads` | staging | `edge_id` (text) | Lectura EDGE normalizada + `raw_payload` + estado + campos enriquecidos |
| `rfid_reader_master_snapshot` | snapshot | `lpi` (text) | Copia local de `readers_master` (refrescada por sync) |
| `rfid_site_snapshot` | snapshot | `site_id` (text) | Copia local de `sites` + EDI agregado (refrescada por sync) |
| `rfid_etl_incidents` | operativa | `incident_id` | Incidencias de calidad/maestro/transformación |
| `rfid_reprocess_audit` | auditoría | `reprocess_run_id` | Auditoría de reprocesos |
| `rfid_report_movements` | final | `movement_id` (sha256) | Movimientos postales reportables |
| `vw_quicksight_rfid_report_movements` | vista | — | Contrato de lectura para QuickSight |

**`rfid_report_movements` (columnas principales):** `movement_id`, `source_edge_id`, `source_run_id`, `tag_id`, `s9_id`, `movement_type`, `route_country_role`, `origin_country_code`, `destination_country_code`, `movement_country_code`, `country_sequence_number`, `event_datetime_utc`, `event_datetime_local`, `reader_id`, `site_impc_code`, `site_name`, `country_code`, `country_name`, `city`, `centre_code`, `edi_equivalent`, `reader_timezone`, `handover_point`, `handover_quality_status`, `created_at_utc`, `updated_at_utc`.

> ⚠️ `rfid_etl_incidents` tiene **RLS desactivado** (expuesta a `anon`). Pendiente de endurecer.

---

## 11. Catálogo de funciones (`public`, Edge Leg2)

| Función | Firma | SECURITY DEFINER | Propósito |
|---|---|:--:|---|
| `rfid_start_etl_run` | `(environment, mode, lock_owner, lock_minutes)` | ✓ | Arranque + lock + run |
| `rfid_finish_etl_run` | `(run_id, environment, status, cursor_finished, pages, reads_received, reads_staged, error)` | ✓ | Cierre + cursor + libera lock |
| `rfid_enrich_run` | `(run_id)` | ✓ | Enriquecimiento contra snapshots |
| `rfid_transform_run` | `(run_id)` | ✓ | Generación de movimientos |
| `rfid_reprocess_recoverable` | `(environment, max_reads, reason)` | ✓ | Reproceso recuperable |
| `rfid_reprocess_scope` | `(filters jsonb, environment, max_reads, reason)` | ✓ | Reproceso acotado |
| `rfid_recalculate_reader_history` | `(reader_id, environment, max_reads)` | ✓ | Recalculo por lector |
| `rfid_reader_is_leg2` | `(product text[], raw_payload jsonb)` | — | Clasificación de alcance Leg2 |
| `rfid_s9_origin_country` | `(s9_id)` | — | País origen desde S9 (chars 1-2) |
| `rfid_s9_destination_country` | `(s9_id)` | — | País destino desde S9 (chars 7-8) |
| `rfid_valid_s9_for_route` | `(s9_id)` | — | Valida S9 (len≥8 + origen/destino) |
| `rfid_make_movement_id` | `(edge_id, movement_type, country_code)` | — | Clave idempotente SHA-256 |

---

## 12. Crones (pg_cron, Edge Leg2)

| jobid | jobname | schedule (UTC) | Comando |
|---|---|---|---|
| 6 | `sync-masters-before-etl` | `25,55 * * * *` | `net.http_post` → `sync-site-snapshot` (refresco de maestros) |
| 1 | `edge-rfid-etl-every-30-minutes` | `*/30 * * * *` | `net.http_post` → `edge-rfid-etl-orchestrator` (ETL) |
| 5 | `rfid-reprocess-recoverable-every-30-minutes` | `5,35 * * * *` | `rfid_reprocess_recoverable('production',5000,'scheduled_reprocess_30m')` |

---

## 13. Edge Functions (Edge Leg2)

| Slug | verify_jwt | Disparador | Función |
|---|:--:|---|---|
| `edge-rfid-etl-orchestrator` | true | cron `:00/:30` + manual | Orquesta ingesta + enrich + transform |
| `sync-site-snapshot` | **false** (interna) | cron `:25/:55` | Refresca `rfid_reader_master_snapshot` + `rfid_site_snapshot` desde GMS IOT |

---

## 14. Contrato de la vista QuickSight — `vw_quicksight_rfid_report_movements`

`SELECT * FROM rfid_report_movements` con derivaciones temporales y etiquetas. Campos publicados:

- Identificación: `movement_id`, `source_edge_id`, `tag_id`, `s9_id`, `reader_id`.
- Movimiento: `movement_type`, `route_country_role`, `country_sequence_number`.
- Países: `origin_country_code`, `destination_country_code`, `movement_country_code`, `country_code`, `country_name`.
- Localización: `site_impc_code`, `site_name`, `centre_code`, `city`, `reader_timezone`.
- Fechas: `event_datetime_utc`, `event_datetime_local`, y derivados `movement_date_local` (`::date`), `movement_hour_local` (`EXTRACT(hour)`), `movement_month_local` (`to_char 'YYYY-MM'`).
- EDI/handover: `edi_equivalent`, `handover_point`, `handover_quality_status`, `handover_label` (`'Handover point'`/`'Non-handover point'`).
- Etiqueta compacta: `reader_location_label` = `concat_ws(' - ', movement_country_code, centre_code, site_impc_code, site_name)`.
- Auditoría: `created_at_utc`, `updated_at_utc`.

---

## 15. Idempotencia y claves

| Punto | Mecanismo |
|---|---|
| Ingesta | UPSERT por `edge_id` en `rfid_edge_input_reads` |
| Snapshot lectores | UPSERT por `lpi` |
| Snapshot sitios | UPSERT por `site_id` |
| Movimientos | `movement_id = sha256(edge_id|tipo|país)`; el transform borra+reinserta por par afectado |
| Lock ETL | `rfid_edge_api_cursor_state` (lock con expiración) + advisory lock en reproceso |

---

## 16. Modelo de seguridad y huecos conocidos (pendientes)

**Diseño:** secretos en `vault`/secretos de Edge Function; QuickSight consume solo la vista. El service_role solo se usa dentro de Edge Functions.

**Pendientes de endurecer (no aplicados):**
1. `rfid_site_snapshot`: revocar `INSERT/UPDATE/DELETE/TRUNCATE` a `anon`/`authenticated`.
2. `rfid_etl_incidents`: **RLS desactivado** → activar RLS con políticas.
3. GMS IOT `public.sites` y `public.readers_master`: `anon` tiene DML completo y la anon key es pública → restringir a SELECT.
4. `sync-site-snapshot` tiene `verify_jwt=false` (función interna sin input); revisar si conviene auth propia (secreto compartido) en el repaso de seguridad.

---

## 17. Estado verificado (2026-06-04)

- `rfid_reader_master_snapshot`: 2.128 lectores (refrescado desde GMS).
- `rfid_site_snapshot`: 480 sitios (refrescado desde GMS).
- `rfid_report_movements`: **3.661** movimientos tras refresco de maestros + reproceso `leg2_scope_migration`.
- Vista QuickSight: `site_impc_code`/`site_name`/`country_name`/`city` poblados para los sitios con maestro completo; `edi_equivalent` 100% en JP/CH/TR (p. ej. Kawasaki = `RESDES`).
- **Hueco de dato origen:** sitios sin `site_impc`/`timezone`/EDI en GMS (p. ej. BT, parte de IN) salen NULL hasta que GMS los complete; al ser dinámico, se rellenan solos en el siguiente refresco.

---

## 18. Runbook operativo

| Tarea | Acción |
|---|---|
| Forzar refresco de maestros ya | Invocar `sync-site-snapshot` (POST) o esperar al cron `:25/:55` |
| Re-aplicar maestros a todo el histórico | `select * from rfid_reprocess_recoverable('production', 50000, 'leg2_scope_migration');` |
| Recalcular un lector | `select * from rfid_recalculate_reader_history('<lpi>', 'production', 5000);` |
| Ver salud de ejecuciones | `select * from rfid_etl_runs order by started_at_utc desc limit 20;` |
| Ver incidencias abiertas | `select incident_type, count(*) from rfid_etl_incidents where status='open' group by 1;` |
| Verificar la vista | conteos de NULL sobre `vw_quicksight_rfid_report_movements` |

---

## 19. Cambios V3 → V4 (resumen)

1. **Sincronización dinámica de maestros** (`readers_master` + `sites`) desde GMS IOT vía Edge Function `sync-site-snapshot`.
2. **Política de refresco antes del ETL** (cron `sync-masters-before-etl` a `:25/:55`).
3. Corrección de raíz de columnas en blanco en la vista (`site_impc_code`, `site_name`, `country_name`, `city`, `edi_equivalent`) y del infraconteo de movimientos por maestro de lectores obsoleto.
4. EDI a nivel de sitio agregado desde lectores frescos (GMS `sites` no tiene EDI).
```
