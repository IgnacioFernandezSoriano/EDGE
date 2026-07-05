# Leg2 — Detección y corrección de incidencias de EDI (checkpoints por site)

**Fecha:** 2026-07-04
**Proyecto Supabase:** EDGE Leg2 (`ubgatxfwpmyaqyfrwias`)
**App afectada:** `leg2-reporting/` (informe RFID events) + ETL de Leg2 (Edge Functions + RPCs Postgres)
**Fuente maestra de config:** GMS IOT (`tsvlgznfvgoqbncunumu`), ventana `monitoring.edgeavs.net/catalog/{LPI}`

## Contexto y problema

El informe RFID de Leg2 (`vw_quicksight_rfid_report_movements`) hoy solo muestra dos
checkpoints: `2320` (salida outbound) y `2400` (entrada inbound). Esto **no** se debe
a que el ETL borre lecturas: las 36.398 lecturas crudas se conservan íntegras en
`rfid_edge_input_reads`. Se debe a que:

1. `rfid_transform_run` **deriva "movements"** colapsando las lecturas de un receptáculo
   por país y rol, y **prioriza el lector de handover**; y
2. `edi_equivalent` solo se asigna a los sites cuyo lector tiene configurado el código
   en el maestro de GMS IOT (`readers_master.edi_equivalent_inbound/outbound`, agregado
   a nivel site en `rfid_site_snapshot`).

**Principio rector (corrección del modelo):** *lo que manda es que exista la lectura de
un lector.* Que a un lector/site no se le haya definido el `edi_equivalent` de su
dirección es una **incidencia de configuración a corregir en el maestro**, no un motivo
para ocultar la lectura. Una vez corregido el maestro, se reprocesan las lecturas para
que el movimiento salga en su columna de checkpoint y entre en el archivo final del ETL
(CSV a S3).

Objetivo de fondo: al publicar cada site y asignar en GMS el código EDI que le
corresponde, se **reconstruye la cadena de checkpoints completa** (equivalente a los
2300/2310/2410… del informe IPC original), no solo los dos puntos de handover.

## Regla de negocio: lecturas cruzadas por site

Dentro de **un mismo site** un mismo evento (tag/S9) puede ser visto por varios lectores
(lecturas cruzadas). Se publica **una sola** lectura por site:

- **Outbound** → la del **último** lector que ve el evento (salida real del site).
- **Inbound** → la del **primer** lector que ve el evento (entrada real al site).

La selección del representante es por **posición temporal**, **no** por el flag
`handover_point`.

## Definición de incidencia (alcance acotado)

Una incidencia es un **movimiento publicado que tiene lectura RFID pero cuyo
`edi_equivalent` de su dirección está sin definir**:

- movimiento **OUTBOUND** (o TRANSIT_EXIT) con `edi_equivalent_outbound` sin definir, o
- movimiento **INBOUND** (o TRANSIT_ENTRY) con `edi_equivalent_inbound` sin definir.

**Fuera de alcance** (no se tratan en esta feature): lectores excluidos por no llevar la
etiqueta `product = 'leg2'`, lecturas `invalid`, `unknown_reader`, y el flag
`handover_point` sin marcar.

## Componentes del diseño

### 1. ETL — `rfid_transform_run` (selección por site)

Cambio en la RPC Postgres de transformación (Leg2):

- El **representante se elige por SITE** dentro de cada país (hoy es por país):
  - **OUTBOUND / TRANSIT_EXIT** → **última** lectura del site (por `event_datetime_utc`).
  - **INBOUND / TRANSIT_ENTRY** → **primera** lectura del site.
- El **rol** sigue derivándose del país del trayecto (país origen → `OUTBOUND`, país
  destino → `INBOUND`, país intermedio → `TRANSIT_ENTRY` + `TRANSIT_EXIT`), con el
  `country_sequence_number` actual.
- La partición de selección pasa de `(tag_id, s9_id, movement_country_code)` a
  `(tag_id, s9_id, movement_country_code, site)`. El `ORDER BY` deja de priorizar
  `handover_point` y ordena solo por tiempo (desc para outbound/exit, asc para
  inbound/entry).
- **Se publica el movimiento aunque el `edi_equivalent` de su dirección sea NULL.**
- `edi_equivalent` por dirección: OUTBOUND/TRANSIT_EXIT → `edi_equivalent_outbound`;
  INBOUND/TRANSIT_ENTRY → `edi_equivalent_inbound` (ya lo hace así hoy).
- `handover_quality_status` sigue registrándose para trazabilidad.

**Clave de site:** se usará la clave de site ya presente en la lectura enriquecida
(`site_impc_code` / `centre_code`); el plan fija la columna exacta.

**Impacto aceptado:** aumenta el nº de movimientos (1 por site en vez de 1 por país) y
**cambia el output de producción** (informe y CSV a S3) para todos los datos, no solo las
incidencias.

### 2. Vistas

- `vw_quicksight_rfid_report_movements`: ya arrastra `edi_equivalent` (incluido NULL),
  `handover_point`, `reader_id`, `site_impc_code`, `country_code`, etc. **Sin cambios
  estructurales.**
- `vw_reader_master`: expone lo necesario para el modal — País, site, gate name, LPI (ya
  presentes). **No exponer `product`.** No se necesita `nms_reader_url`: el deep-link se
  compone en la app desde el LPI.

### 3. Frontend — informe (columnas "No Event Code")

Dos columnas especiales en el pivot, alineadas con el flujo del trayecto:

- **OUTBOUND sin EDI** → columna a la **izquierda**, justo tras la columna resumen
  congelada.
- **INBOUND sin EDI** → columna a la **derecha**, tras los checkpoints.
- Orden del pivot: `[Resumen S9] | [No Event Code ◄ outbound] | [2320 | 2400 | …] | [No Event Code ► inbound]`.
- Cada celda "No Event Code" que contenga un movimiento es **clicable** → abre el **modal
  de corrección** (no el modal de detalle de la fila).
- Sin pestaña/vista separada de incidencias: todo in-situ en el pivot.
- Los movimientos con `edi_equivalent = NULL` se enrutan a la columna izquierda o derecha
  según su `movement_type` (OUTBOUND/TRANSIT_EXIT → izquierda; INBOUND/TRANSIT_ENTRY →
  derecha).

Textos de UI en **inglés** desde `src/i18n/strings.ts` (etiqueta "No Event Code").

### 4. Frontend — modal de corrección + reproceso

Al clicar una celda "No Event Code":

- El modal muestra: **País, site, gate name, LPI** (copiables). **No** muestra `product`.
- Botón **"Open in reader master (GMS)"** → deep-link
  `https://monitoring.edgeavs.net/catalog/{LPI}` (abre la pestaña *Operation* del lector,
  donde se asignan *Inbound Code* / *Outbound Code* / *Handover point*). Base configurable
  por env var `VITE_GMS_READER_MASTER_URL` (por si cambia el dominio).
- Botón **"Reprocess"** → reproceso **dirigido al site del lector corregido**.

### 5. Reproceso dirigido (backend)

Nueva RPC Postgres en Leg2, p.ej. `rfid_reprocess_site(p_site_id)`, `SECURITY DEFINER`,
invocable por `authenticated` a través de una Edge Function que la app llama con el token
de sesión. Flujo del botón "Reprocess":

1. `sync-site-snapshot` (trae el EDI/handover nuevo de GMS al snapshot de Leg2).
2. Re-enrich + re-transform de los pares `(tag, S9)` que tengan **alguna lectura en ese
   site** (reutiliza la lógica de `rfid_transform_run`, que ya hace delete+insert de
   movements por par afectado).
3. Re-export del CSV a S3 (`export-rfid-csv-to-s3`) para que la corrección salga en el
   archivo final.

Ejecución **síncrona** con feedback (spinner) — el alcance dirigido es pequeño.

**Elección de scope por SITE** (no por LPI): un site puede tener varios lectores
representativos y el EDI en Leg2 se agrega a nivel site; reprocesar por site captura de
forma coherente todo lo afectado por la corrección.

## Orden de construcción

1. ETL por-site (`rfid_transform_run`) + RPC de reproceso dirigido (`rfid_reprocess_site`)
   + Edge Function de invocación.
2. Vista `vw_reader_master` (exponer lo necesario, sin `product`).
3. Columnas "No Event Code" en el pivot del frontend.
4. Modal de corrección (deep-link + botón Reprocess).

Cada pieza depende de la anterior: el frontend (3–4) necesita que el ETL (1) publique los
movimientos sin EDI para que haya incidencias que mostrar y corregir.

## Testing

- **Unitarios (libs frontend):** enrutado de movimientos sin EDI a columna izquierda
  (outbound) / derecha (inbound); construcción del deep-link desde LPI; que `product` no
  se exponga.
- **Pivot:** render de las dos columnas "No Event Code" en el orden correcto y su
  contador de eventos.
- **ETL (SQL):** selección por site (último para outbound, primero para inbound), país con
  varios sites → varios movimientos, publicación con `edi_equivalent` NULL.
- **Reproceso:** prueba dirigida sobre datos reales de Leg2 (`ubgatxfwpmyaqyfrwias`): un
  site con incidencia → tras corregir el snapshot y reprocesar, el movimiento pasa de "No
  Event Code" a su columna de checkpoint y el CSV re-exportado lo refleja.

## Restricciones y notas operativas

- **Regla de escritura en Supabase:** antes de CUALQUIER escritura en Leg2 (migración,
  `apply_migration`, deploy de Edge Function, `execute_sql` de escritura) se nombra el
  proyecto y su `ref` (`ubgatxfwpmyaqyfrwias`) y se pide confirmación explícita. Nunca
  inferir la base.
- **Fuente de la verdad del maestro:** GMS IOT. El snapshot de Leg2 se pisa en cada run
  vía `sync-site-snapshot` (UPSERT completo). Por eso la corrección se hace en GMS y en la
  app solo se *guía* (deep-link) + se reprocesa.
- **Idioma de UI:** inglés, desde `src/i18n/strings.ts`.
- **No exponer `product`** en `vw_reader_master` ni en la app.

## Deudas / follow-ups (no bloquean)

- Los ~94 lectores fuera de scope Leg2 (`product` sin `'leg2'`, ~6.495 lecturas hoy
  invisibles) quedan **fuera** de esta feature; si se quisiera cubrir, sería otra
  incidencia y otro spec.
- Autorización fina de la RPC/Edge Function de reproceso (qué usuarios de Leg2 pueden
  disparar reproceso) — definir en implementación.
- **Duplicación de la lógica de selección** de movements en `rfid_transform_run` (sql/06)
  y `rfid_reprocess_scope` (sql/07): el bloque `valid_reads→country_groups→candidates→
  selected` está copiado en ambas (ya venía así de producción). Riesgo de divergencia futura.
  Extraer a un helper compartido (función set-returning o vista parametrizada) o añadir un
  check CI que compare ambos bloques. (Detectado en review 2026-07-05.)
- **Reproceso interactivo síncrono vs wall-clock de la Edge Function**: `rfid_reprocess_scope`
  tiene `statement_timeout=240s`, pero la Edge Function tiene su propio límite de wall-clock
  (~150s) y el `fetch` del frontend puede morir antes de que el RPC devuelva → la BD reprocesa
  OK pero la UI muestra "failed". Hoy no se alcanza (máx observado 26s, JPKWSA). Fix real:
  reproceso asíncrono con job + polling, o acotar `p_max_reads` en el camino interactivo.
  (Detectado en review 2026-07-05.)
- **Filtro/marcado de inconsistencias temporales según el flujo físico.** Las columnas de
  checkpoints del pivot están ordenadas por el **flujo físico real** del trayecto (secuencia
  de checkpoints, p.ej. 2300→2310→2320→2400→2410→2420…). Para una misma fila (S9), las marcas
  de tiempo deberían ser **monótonas no decrecientes** al avanzar por las columnas en orden de
  flujo. Si un checkpoint físicamente **posterior** tiene una fecha **anterior** a uno previo,
  es una **inconsistencia temporal** y hay que marcarla (resaltar la celda/fila; opcionalmente
  un filtro "solo inconsistencias"). Nota de implementación: la ordenación física la da la
  secuencia de códigos EDI (más su rol inbound/outbound), no el orden alfabético/numérico
  simple; hay que fijar el orden canónico de checkpoints. Enlaza con el objetivo de reconstruir
  la cadena completa de checkpoints.
- **Marcar una lectura como excluida del cálculo.** A raíz de lo anterior: poder marcar una
  lectura/movimiento concreto como **fuera de consideración para el cálculo** (p.ej. una lectura
  espuria que provoca la inconsistencia temporal), y que el transform/reproceso la ignore. Implica
  una capa de override en Leg2 (tabla de exclusiones por `source_edge_id`/`movement_id`) que el
  `rfid_transform_run` y `rfid_reprocess_scope` respeten, más UI para marcar/desmarcar y reprocesar.
  Decidir dónde vive el override (Leg2 local vs GMS) sin que el sync lo pise.
