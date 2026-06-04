# Flujo de datos del dashboard EDGE

**Proyecto:** EDGE RFID-EDI Dashboard
**URL pública:** https://edgedashboard.netlify.app/
**Proyecto Supabase:** `ewyhmmixqcubqokphebh`
**Última actualización:** 2026-05-06

> Este documento traza, de extremo a extremo, **de dónde sale cada dato** que aparece en pantalla y **qué se hace con él** en cada paso. Empieza por las fuentes (CSV / API / staging), pasa por el ETL que enriquece y clasifica los eventos, y termina en el componente concreto del frontend que lo presenta. Para cada paso intermedio se indica el archivo o tabla donde está implementada la lógica, de modo que sea trazable.

---

## 0. Mapa de un vistazo

```
                      ┌────────────────────────────────────────┐
                      │  FUENTES DE ORIGEN                      │
                      │  - CSV (admin upload)                   │
                      │  - API (ingesta push)                   │
                      │  - Tabla "RFID" en backfill             │
                      └────────────────┬───────────────────────┘
                                       │
                                       ▼
                              staging_rfid_events
                                       │
                       ┌───────────────┴───────────────┐
                       │  ETL v3 (Edge Function)        │
                       │  process-rfid-etl/index.ts     │
                       │   1. Extracción                │
                       │   2. Transformación (bloques)  │
                       │   3. Logging                   │
                       │   4. Carga (upsert RFID)       │
                       │   5. Sincronización            │
                       │   6. Limpieza                  │
                       └────┬────────────────────┬──────┘
                            │                    │
                            ▼                    ▼
                  log_rfid_inconsistencies   "RFID" enriquecido
                  (issues + decisión admin)  (event_type, country,
                                              center_name, status,
                                              is_international_boundary)
                                       │
                       ┌───────────────┴────────────────────┐
                       │                                    │
                       ▼                                    ▼
              tracking_events                       benchmark_rfid_edi
              (RFID ⨝ EDI por s9id,                 (vista materializada,
               coverage, lags, transit)              refresco diario pg_cron)
                       │                                    │
                       │                ┌───────────────────┘
                       ▼                ▼
                run-audit-benchmark (Edge Function)
                       │                │
                       ▼                ▼
              audit_data_load_log   master_pending_review
                       │                │
                       └───────┬────────┘
                               │
                               ▼
        ┌──────────────────────┴────────────────────────────┐
        │           FRONTEND (Vite + React)                  │
        │  Hooks → Componentes → Pestañas en Home.tsx        │
        └────────────────────────────────────────────────────┘
```

---

## 1. Fuentes de origen

| Fuente | Descripción | Quién la genera |
|---|---|---|
| **CSV** | Subida manual por administrador desde `AdminAuditPage`/UI ETL | Operador humano |
| **API push** | Sistema externo escribe en `staging_rfid_events` directamente | Integración externa (lectores RFID en aeropuertos / centros postales) |
| **Backfill** | Reprocesa filas existentes de `RFID` con `event_type IS NULL` | Job manual / admin |
| **Datos EDI** | Tabla `datos EDI` (cabeceras PREDES, CARDIT, RESDIT74, RESDIT21, RESDES) | Carga independiente del ETL RFID |
| **ID Relation** | Mapeo `tagid ↔ s9id` | Carga independiente, prerequisito para benchmark |
| **rfid_readers_master** | Maestro de los 18 lectores físicos (read_point_id → IMPC, país, centro, td_reader) | Mantenimiento manual ([sql/01_create_rfid_readers_master.sql](../sql/01_create_rfid_readers_master.sql)) |

### Estructura del `s9id` (clave de toda la clasificación)

```
ESMADB JPKWSA ZZZZZZZ
└──┬─┘ └──┬─┘
   │       └─ posiciones 6-11 → IMPC destino
   └────────  posiciones 0-5  → IMPC origen
```

Esto se usa tanto en el ETL (clasificación) como en `run-audit-benchmark` (verificación cruzada).

---

## 2. Esquema intermedio

### 2.1 `staging_rfid_events` — zona de aterrizaje

Definida en [sql/02_create_staging_rfid_events.sql](../sql/02_create_staging_rfid_events.sql). Tabla **temporal**: se vacía al final de cada ciclo ETL exitoso (Fase 6).

Campos clave: `document_id`, `event_time_local`, `event_time_offset`, `record_time`, `location`, `read_point_id`, `tag_id`, `impc_code`, `s9id`, `source` (`API`/`CSV`/`BACKFILL`).

### 2.2 `RFID` — tabla principal enriquecida

Tras Fase 4 del ETL queda con estas columnas nuevas (ver [sql/04_alter_rfid_add_event_type.sql](../sql/04_alter_rfid_add_event_type.sql) y [sql/05_drop_redundant_rfid_columns.sql](../sql/05_drop_redundant_rfid_columns.sql)):

- `event_type` — clasificación final del evento
- `impc_code` — corregido desde `rfid_readers_master`
- `country` — derivado del maestro
- `center_name` — derivado del maestro
- `status` — `COMPLETE` (lecturas en >1 país) o `PENDING`
- `is_international_boundary` — true si la lectura marca DEPARTURE o ARRIVAL
- `etl_version`, `etl_processed_at`

Volumen: ~169 000 filas (índice `rfid_event_time_local_idx` en [supabase/indexes.sql](../supabase/indexes.sql)).

### 2.3 `tracking_events` — vista plana RFID + EDI

Una fila por `s9id`. Contiene 50+ columnas precomputadas:
- Coverage (`has_rfid`, `has_predes`, `has_resdes`, `coverage_type`)
- RFID: `rfid_origin_*`, `rfid_dest_*`, `rfid_intermediate_centres`, `rfid_total_readings`
- EDI: `predes_*`, `redes_*`
- Tiempos: `departure_lag_hours`, `arrival_lead_hours`, `rfid_transit_hours`, `edi_transit_hours`, `transit_diff_hours`
- Validación: `origin_match`, `dest_match`, `full_route_validated`

Es la **fuente plana del dashboard** (`useTrackingData`). Construida y mantenida fuera del repo (no hay SQL de creación versionado en él).

### 2.4 `benchmark_rfid_edi` — vista materializada

Definida en [sql/rebuild_benchmark_view.sql](../sql/rebuild_benchmark_view.sql). FULL OUTER JOIN entre RFID agregado por `tag_id` y `datos EDI` ⨝ `ID Relation`. Refresco diario a las 02:00 UTC vía `pg_cron` (`refresh_benchmark_view` RPC en [sql/refresh_benchmark_view.sql](../sql/refresh_benchmark_view.sql)).

> **Nota**: el cliente React **no consume directamente** esta vista. Sí la dispara `AdminAuditPage` mediante `supabase.rpc('refresh_benchmark_view')`. La construcción de benchmark en pantalla la hace `useBenchmarkData` en cliente uniendo `useEpcisData` + paginado de `ID Relation` + `datos EDI`.

### 2.5 Tablas de auditoría

- `log_rfid_inconsistencies` — issues del ETL: `READER_NOT_IN_MASTER`, `MISSING_FIELD`, `S9ID_INVALID`, `DUPLICATE_EVENT`, `S9ID_IMPC_MISMATCH`. Ver [sql/03_create_log_rfid_inconsistencies.sql](../sql/03_create_log_rfid_inconsistencies.sql).
- `audit_data_load_log` — issues de auditoría de benchmark: `IMPC_MISMATCH_RFID`, `CASE_NORMALIZATION`, `MAESTRO_AUSENTE`, `OUTLIER_TEMPORAL`. Generadas por la Edge Function `run-audit-benchmark`.
- `master_pending_review` — propuestas de altas/correcciones al maestro (ALTA/CORRECCION/NORMALIZACION_CASE/INACTIVO).
- `access_requests` — solicitudes de acceso para registro nuevo (login/UserMenu admin panel).

---

## 3. ETL — `process-rfid-etl` (Edge Function v3)

Implementación principal: [supabase/functions/process-rfid-etl/index.ts](../supabase/functions/process-rfid-etl/index.ts). Existe también el equivalente Python [scripts/process_rfid_etl.py](../scripts/process_rfid_etl.py) con clasificación más simple (solo `ORIGIN`/`DESTINATION`/`INTERMEDIATE`); el frontend depende del enriquecimiento v3.

Se ejecuta en tres modos: `incremental` (lee `staging_rfid_events`), `csv` (acepta archivo en multipart) y `backfill` (relee toda la `RFID`).

### Fase 1 — Extracción

- Modo `csv`: parsea con detección de separador `;` o `,` y comillas; construye filas con `document_id`, `event_time_local`, `record_time`, `location`, `read_point_id`, `tag_id`, `impc_code`, `s9id`.
- Modo `incremental`: lee `staging_rfid_events` paginado de 10 000 en 10 000.
- Modo `backfill`: lee `RFID` completa.

### Fase 2 — Transformación (la lógica clave del v3)

1. **Enriquecimiento por lector**: para cada lectura, busca `read_point_id` en `rfid_readers_master`. Si no está, descarta el registro y emite issue `READER_NOT_IN_MASTER`. Si está, reemplaza `impc_code`, `country`, `center_name`, y captura el flag `td_reader` (true = AMU/lector frontera, false = lector interno OE).

2. **Ordenación**: por `tag_id`, ordena por `record_time` (tiempo de captura).

3. **Bloques de centro**: agrupa lecturas consecutivas con el mismo `impc_code` en un solo bloque.

4. **Asignación de event_type por bloque**:
   - Primera lectura del bloque → `ARRIVAL_AT_CENTRE`
   - Última del bloque → `DEPARTURE_FROM_CENTRE`
   - Intermedias → `INTERMEDIATE`

5. **Eventos de viaje completo (sobreescriben los del bloque cuando aplica)**:
   - Primera lectura del viaje → `ORIGIN`
   - Última lectura del viaje → `DESTINATION`

6. **Detección de cambio de país (frontera internacional)**:
   - Para cada par de bloques consecutivos con países distintos: la última lectura del bloque origen recibe `DEPARTURE`, la primera del destino `ARRIVAL`. Ambas marcan `is_international_boundary = true`.
   - Si esa lectura está en un lector con `td_reader = true`, el log lo etiqueta como `AMU_OUTBOUND`/`AMU_INBOUND` para trazabilidad.

7. **Prioridad de tipos** (cuando una lectura recibe varios):
   ```
   DEPARTURE | ARRIVAL              = 5  (más alta)
   ORIGIN    | DESTINATION          = 4
   DEPARTURE_FROM_CENTRE | ARRIVAL_AT_CENTRE = 3
   INTERMEDIATE                     = 1
   ```

8. **Status del tag**: `COMPLETE` si las lecturas tocan ≥2 países, `PENDING` si solo uno.

### Fase 3 — Logging

`log_rfid_inconsistencies` con `etl_run_id` (UUID generado en cada corrida) para poder agrupar issues por ejecución.

### Fase 4 — Carga

`upsert` por `document_id` en lotes de 500. Conserva los IDs originales y solo añade los campos enriquecidos.

### Fase 5 — Sincronización

Compara `rfid_readers_master.impc_code` con `postal_centers.impc_code` y añade los IMPCs nuevos. **Nunca elimina ni modifica** centros existentes (precaución para no romper Benchmark).

### Fase 6 — Limpieza

Vacía `staging_rfid_events` con un `DELETE` masivo. **Si el ETL falla** en cualquier fase anterior, el staging se conserva para diagnóstico.

---

## 4. Auditoría — `run-audit-benchmark` (Edge Function)

Implementación: [supabase/functions/run-audit-benchmark/index.ts](../supabase/functions/run-audit-benchmark/index.ts). Independiente del ETL RFID. Se dispara desde `AdminAuditPage`.

Lee `tracking_events` (paginado 1 000) y `postal_centers`, y ejecuta tres checks:

| Check | Descripción | Severity | Resolution |
|---|---|---|---|
| `IMPC_MISMATCH_RFID` | El IMPC RFID (origen/destino) no coincide con los 6 chars del `s9id`. Fuente de verdad = `s9id` | ALTO | SEND_TO_LOG |
| `CASE_NORMALIZATION` | El IMPC viene en minúsculas en algún campo (`rfid_origin_impc`, `rfid_dest_impc`, `predes_origin_impc`, `redes_dest_impc`) | BAJO | AUTO_CORRECTED |
| `MAESTRO_AUSENTE` | IMPC presente en `tracking_events` que no existe en `postal_centers` | MEDIO | PENDING_REVIEW |

Inserta los hallazgos en `audit_data_load_log` (lotes de 500). El admin marca `KEEP` o `DELETE`; las marcadas `DELETE` se filtran luego en frontend (`fetchAuditExcludedS9ids`) para no contaminar KPIs.

---

## 5. Frontend — del hook al componente

Cliente Supabase: [client/src/lib/supabase.ts](../client/src/lib/supabase.ts).

### 5.1 Hooks (capa de obtención + transformación)

| Hook | Tabla/RPC origen | Transformación principal | Salida |
|---|---|---|---|
| **`useTrackingData`** | `tracking_events` (paginado completo) | Agrupaciones por país origen/destino, por `coverage_type`, por ruta. Percentiles 25/75, mean, median de `departure_lag_hours`, `arrival_lead_hours`, `rfid_transit_hours`, `edi_transit_hours`. CDFs por centro. | `DashboardStats` (~50 campos) + `TrackingEvent[]` |
| **`useEpcisData`** | `RFID` (filtro `event_type IN (ORIGIN,DESTINATION,DEPARTURE,ARRIVAL,DEPARTURE_FROM_CENTRE,ARRIVAL_AT_CENTRE)`, paginado mensual) + `rfid_readers_master` + (`ID Relation` ⨝ `datos EDI`) | Reconstruye `RfidJourney[]` agrupando lecturas por `s9id`/`tag_id`. Identifica pares ORIGIN→DESTINATION y DEPARTURE→ARRIVAL. Calcula `transit_hours`. Etiqueta bloques OE vs AMU usando `td_reader`. | `EpcisStats` + `RfidJourney[]` |
| **`useBenchmarkData`** | `useEpcisData.journeys` + cachés módulo de `ID Relation` y `datos EDI` (paginadas 1 000) | Para cada journey, busca `s9id` y carga campos EDI: `predes_time`, `cardit_time`, `resdit74_time`, `resdit21_time`, `redes_time`. Calcula deltas RFID-vs-EDI en horas. Agrupa por ruta y por centro. | `BenchmarkStats` + `RouteStats[]` + `CentreStats[]` |
| **`useAuditData`** (`useAuditLog`) | `audit_data_load_log` | Filtros por severity/category/resolution; counts; updates `admin_decision` y notas. | `AuditLogEntry[]` + summary |
| **`useAuditData`** (`useMasterPending`) | `master_pending_review` | Approval workflow (PENDIENTE → APROBADO/RECHAZADO/APLICADO). | `MasterPendingEntry[]` |

#### KPIs vía RPC (atajo servidor)

`fetchRfidEventCounts` llama a `rpc/rfid_kpi_counts` ([sql/fix_rfid_kpi_counts.sql](../sql/fix_rfid_kpi_counts.sql)) con `p_date_from`, `p_date_to`, `p_origin_country`, `p_dest_country`. Devuelve los seis KPIs principales agregados en SQL para esquivar el límite de 1 000 filas de PostgREST y el `statement_timeout` ~3s del rol anon.

| KPI | Fórmula |
|---|---|
| `total_tags` | `COUNT(DISTINCT tag_id)` en el rango filtrado |
| `rfid_departures` | tags con event_type ∈ {`ORIGIN`,`DEPARTURE`} |
| `rf_predes` | tags con event_type = `DEPARTURE` |
| `rf_resdes` | tags con event_type = `ARRIVAL` |
| `rfid_arrivals` | tags con event_type ∈ {`DESTINATION`,`ARRIVAL`} |
| `rf_e2e` | tags con ambos lados (departure ∧ arrival) |

### 5.2 Pestañas y paneles de [Home.tsx](../client/src/pages/Home.tsx)

#### Pestaña RFID
- **Hook**: `useEpcisData`
- **Origen último**: tabla `RFID` enriquecida (output del ETL v3)
- **Componentes**:
  - `KpiCard × N` con KPIs precomputados por `rfid_kpi_counts` RPC
  - `EpcisDataTable` (tabla paginada de viajes con export CSV)
  - `Map` (flujos origen→destino, datos `RfidJourney[]`)
  - `SearchID` (búsqueda por tag_id/s9id; muestra hitos `ORIGIN`/`DEPARTURE`/`ARRIVAL`/`DESTINATION`)
  - Gráficos de rutas, centros por origen/destino, CDFs de tránsito

#### Pestaña Tracking
- **Hook**: `useTrackingData`
- **Origen último**: `tracking_events` (que es ya un join precomputado de RFID + EDI fuera del cliente)
- **Componentes**:
  - `DataTable` (filas crudas con filtro por `coverage_type`)
  - `AnalysisPanel × {Overview, Departure, Arrival, Transit}` — bloques narrativos con KPIs derivados (lag medio, p25/p75, % full_route_validated)
  - Distribuciones por país y centro

#### Pestaña EDI+RFID (Benchmark)
- **Hook**: `useBenchmarkData` (que internamente usa `useEpcisData`)
- **Origen último**: `RFID` ⨝ `rfid_readers_master` ⨝ `ID Relation` ⨝ `datos EDI` (todo armado en cliente)
- **Componentes**:
  - `BenchmarkPanel` con KPIs RFID-vs-EDI (delta PREDES, delta RESDES, transit)
  - `BenchmarkDrillModal` con detalle por ruta o centro
  - Tablas de routes/centres
  - CDFs de tránsito comparativos

### 5.3 Páginas adicionales

| Página | Origen de datos | Qué muestra |
|---|---|---|
| **`RouteDetailPage`** ([client/src/pages/RouteDetailPage.tsx](../client/src/pages/RouteDetailPage.tsx)) | `localStorage` (payload precomputado en Home) | KPIs sticky de la ruta, histograma de transit hours, CDF, Tukey fence, tabla de outliers con checkboxes que recalculan en vivo |
| **`TagTrackPage`** ([client/src/pages/TagTrackPage.tsx](../client/src/pages/TagTrackPage.tsx)) | `fetch` directo a `${SUPABASE_URL}/rest/v1/RFID?tag_id=eq.X` | Hitos `OE_ORIGIN` → `AMU_OUTBOUND` → `AMU_INBOUND` → `OE_DEST` con sus timestamps |
| **`AdminAuditPage`** ([client/src/pages/AdminAuditPage.tsx](../client/src/pages/AdminAuditPage.tsx)) | `useAuditLog` + `useMasterPending` + RPC `refresh_benchmark_view` | Dashboard de la última corrida de auditoría; tabla de issues con bulk `KEEP/DELETE`; tabla de propuestas al maestro con flujo de aprobación; botón para refrescar la vista materializada |
| **`LoginPage`** | Insert en `access_requests` | Form de solicitud de acceso |

### 5.4 Llamadas Supabase fuera de `lib/supabase.ts`

| Archivo | Tabla/RPC | Operación |
|---|---|---|
| `Home.tsx` | `access_requests`, RPC `admin_list_users` | Admin Panel: aprobar/rechazar accesos |
| `Home.tsx` | `auth.admin.createUser` | Alta de usuarios |
| `LoginPage.tsx` | `access_requests` | INSERT solicitud |
| `AdminAuditPage.tsx` | RPC `refresh_benchmark_view` | Materializar vista |
| `useBenchmarkData.ts` | `ID Relation`, `datos EDI` | SELECT paginado (caché módulo) |
| `useAuditData.ts` | `audit_data_load_log`, `master_pending_review` | SELECT + UPDATE bulk |
| `TagTrackPage.tsx` | `RFID` | SELECT directo por tag_id |

---

## 6. Trazabilidad: KPI → consulta → tabla → ETL → origen

A continuación, los caminos completos para los KPIs más visibles:

### KPI: "Tags con tránsito completo end-to-end"

```
Componente:    KpiCard "End-to-End" en pestaña RFID
Hook:          fetchRfidEventCounts() → useEpcisData / Home
RPC:           rfid_kpi_counts(p_date_from, p_date_to, ...)
Implementación: sql/fix_rfid_kpi_counts.sql
Tabla origen:  RFID (event_type ∈ {ORIGIN, DEPARTURE} ∩ {DESTINATION, ARRIVAL})
ETL que la pobla: process-rfid-etl/index.ts Fase 2 (clasificación por bloques + cambio de país)
Datos brutos: staging_rfid_events ← CSV / API push / backfill
Maestro: rfid_readers_master (read_point_id → IMPC, country, td_reader)
```

### KPI: "Departure lag medio (RFID DEPARTURE − EDI PREDES)"

```
Componente:    AnalysisPanel "Departure" en pestaña Tracking
Hook:          useTrackingData → DashboardStats.avgDepartureLag
Tabla origen:  tracking_events (columna departure_lag_hours)
Construcción:  precomputada server-side fuera del repo
Insumos:       RFID (DEPARTURE event_time) + datos EDI (predes_time)
                joinados por ID Relation (tagid → s9id → ean)
```

### KPI: "Coverage = FULL"

```
Componente:    DataTable + KpiCard en pestaña Tracking
Tabla origen:  tracking_events.coverage_type
Categorías:    FULL, EDI_FULL, RFID_ONLY, EDI_ONLY, RFID_PREDES, RFID_RESDES
Insumos:       has_rfid + has_predes + has_resdes (booleanos derivados)
```

### KPI: "Outliers de tránsito en una ruta"

```
Componente:    Tabla de outliers en RouteDetailPage
Hook:          (datos pasados via localStorage desde Home/useEpcisData)
Cálculo:       Tukey fence sobre rfid_transit_hours del array RfidJourney
Tabla origen:  RFID (event_type DEPARTURE+ARRIVAL para calcular tránsito)
```

### Issue de auditoría: "IMPC origen no coincide con s9id"

```
Componente:    AdminAuditPage → tabla audit_data_load_log filtrada por audit_check
Hook:          useAuditLog
Tabla origen:  audit_data_load_log
Generador:     run-audit-benchmark/index.ts (Check 4: IMPC_MISMATCH_RFID)
Insumo:        tracking_events.rfid_origin_impc + s9id[0:6]
Decisión:      admin_decision (KEEP/DELETE) → consumida por fetchAuditExcludedS9ids
                en frontend para excluir s9ids de los KPIs RFID/EDI
```

---

## 7. Periodicidad y orquestación

| Proceso | Disparador | Frecuencia | Implementación |
|---|---|---|---|
| `process-rfid-etl` modo `incremental` | API HTTP (`POST /functions/v1/process-rfid-etl`) | A demanda — esperable cron externo | Edge Function |
| `process-rfid-etl` modo `csv` | Upload manual desde `AdminAuditPage` | Manual | Edge Function (`multipart/form-data`) |
| `run-audit-benchmark` | Botón "Run audit" en `AdminAuditPage` | Manual | Edge Function |
| `refresh_benchmark_view` | `pg_cron` job `refresh-benchmark-daily` | Diario 02:00 UTC | [sql/refresh_benchmark_view.sql](../sql/refresh_benchmark_view.sql) |
| Reverse-flow `RFID → tracking_events` | **No documentado en este repo** | Opaca | Probable trigger o vista server-side fuera del repo |

> ⚠️ **Brecha de documentación**: cómo se construye `tracking_events` a partir de `RFID` + `datos EDI` no está versionado en este repo. Es la pieza precomputada que alimenta toda la pestaña Tracking y la mitad de los KPIs. Vale la pena recuperar su DDL del Supabase Dashboard y versionarlo en `sql/`.

---

## 8. Riesgos y consideraciones operativas

1. **Datos sensibles**: `tracking_events` y `RFID` contienen `s9id` (identificador de receptáculo postal) que puede ser reidentificable. RLS en `public` debería bloquear acceso a `anon` salvo lo estrictamente público.
2. **Servicio role en Edge Functions**: `process-rfid-etl` usa `SUPABASE_SERVICE_ROLE_KEY` (línea 34) y bypassa RLS. Cualquier bug en el parsing CSV impacta directamente.
3. **`TagTrackPage` consulta `RFID` con anon**: si la tabla no tiene RLS adecuado, cualquier usuario logueado podría enumerar lecturas. Verificar.
4. **`ID Relation` y `datos EDI` no tienen pipeline en este repo**: su carga es asumida y opaca; conviene documentar de dónde vienen.
5. **Diferencia entre los dos ETL**: el script Python clasifica `ORIGIN/DESTINATION/INTERMEDIATE` (3 tipos), la Edge Function v3 clasifica con 7 tipos. **El frontend depende de los 7**. Mantener ambos sincronizados o deprecar el Python.
6. **Vista materializada vs. cliente**: `benchmark_rfid_edi` se refresca de noche pero el cliente la ignora y reconstruye en RAM cada vez (~169k filas RFID + paginado de EDI). Si el dataset crece, esto se romperá; conviene migrar `useBenchmarkData` a consumir la vista materializada.

---

## 9. Archivos clave (resumen)

| Archivo | Rol |
|---|---|
| [supabase/functions/process-rfid-etl/index.ts](../supabase/functions/process-rfid-etl/index.ts) | ETL v3 — fuente de verdad de la clasificación |
| [supabase/functions/run-audit-benchmark/index.ts](../supabase/functions/run-audit-benchmark/index.ts) | Auditoría de calidad de datos |
| [scripts/process_rfid_etl.py](../scripts/process_rfid_etl.py) | ETL CLI (clasificación simplificada — legado) |
| [sql/01_create_rfid_readers_master.sql](../sql/01_create_rfid_readers_master.sql) | Maestro de los 18 lectores |
| [sql/02_create_staging_rfid_events.sql](../sql/02_create_staging_rfid_events.sql) | Staging |
| [sql/03_create_log_rfid_inconsistencies.sql](../sql/03_create_log_rfid_inconsistencies.sql) | Log de issues ETL |
| [sql/04_alter_rfid_add_event_type.sql](../sql/04_alter_rfid_add_event_type.sql) | Columnas enriquecidas en `RFID` |
| [sql/rebuild_benchmark_view.sql](../sql/rebuild_benchmark_view.sql) | Vista `benchmark_rfid_edi` |
| [sql/refresh_benchmark_view.sql](../sql/refresh_benchmark_view.sql) | RPC + cron de refresco |
| [sql/fix_rfid_kpi_counts.sql](../sql/fix_rfid_kpi_counts.sql) | RPC `rfid_kpi_counts` |
| [supabase/indexes.sql](../supabase/indexes.sql) | Índices de rendimiento |
| [client/src/lib/supabase.ts](../client/src/lib/supabase.ts) | Cliente Supabase + funciones de fetch |
| [client/src/hooks/useTrackingData.ts](../client/src/hooks/useTrackingData.ts) | Hook pestaña Tracking |
| [client/src/hooks/useEpcisData.ts](../client/src/hooks/useEpcisData.ts) | Hook pestaña RFID |
| [client/src/hooks/useBenchmarkData.ts](../client/src/hooks/useBenchmarkData.ts) | Hook pestaña EDI+RFID |
| [client/src/hooks/useAuditData.ts](../client/src/hooks/useAuditData.ts) | Hook AdminAuditPage |
| [client/src/pages/Home.tsx](../client/src/pages/Home.tsx) | Pestañas RFID/Tracking/EDI+RFID |
| [client/src/pages/RouteDetailPage.tsx](../client/src/pages/RouteDetailPage.tsx) | Detalle de ruta |
| [client/src/pages/TagTrackPage.tsx](../client/src/pages/TagTrackPage.tsx) | Trazabilidad de un tag |
| [client/src/pages/AdminAuditPage.tsx](../client/src/pages/AdminAuditPage.tsx) | Panel de auditoría |
