# Leg2 — Pantalla "Días entre eventos" (Event-pair gaps) — Diseño

**Fecha:** 2026-07-06
**Proyecto Supabase:** EDGE Leg2 — ref `ubgatxfwpmyaqyfrwias` (org `hwuajreqsmhxdojtlthg`)
**App:** `leg2-reporting/` (React 19 + Vite + TS + Tailwind v4 + shadcn/ui)
**Rama:** `feat/leg2-event-gaps`
**Origen de requerimientos:** `eventos_comparacion_s9_receptaculo.md` (extracto EDGE LEG2 V3, granularidad receptáculo/S9) + conversación de brainstorming.

---

## 1. Objetivo

Nueva pantalla que muestra la **media de días** transcurridos entre pares de eventos
(RFID ↔ EDI) a nivel de **receptáculo (S9)**, agregada por **corredor origen→destino**
y desglosada por las **comparaciones** definidas en el documento, filtrable por
**periodo** y **producto**. Permite abrir el detalle de cada casilla y **excluir
permanentemente** registros erróneos/outliers del cálculo (marcable/desmarcable).

Esta es la **v1 (Incremento 1): cálculo dinámico**. Los snapshots de cierre de mes
son el **Incremento 2** (diferido, ver §7).

---

## 2. Modelo conceptual → datos reales

Los nombres del documento son **conceptuales**; nuestros eventos RFID llevan
**códigos IPC de 4 cifras** y un flag `handover_point` curado por lector en GMS.
El mapeo se resuelve como **dato configurable** (tabla `ref_event_comparison`),
no hardcodeado en código (principio "no hardcodear códigos" del doc).

### Catálogo RFID (checkpoints IPC de 4 cifras)

| Código | Significado |
|---|---|
| 2300 | Exit From Outbound OE |
| 2310 | Entry Outbound AMU |
| 2320 | Exit Outbound AMU |
| 2400 | Entry Inbound AMU |
| 2410 | Exit Inbound AMU |
| 2420 | Entry Inbound OE |

### Resolución de los eventos conceptuales

- **`RFID_400` (handover)** = cualquier movimiento con **`handover_point = true`**
  (el negocio ya cura qué lector es punto de cambio de responsabilidad; editable
  desde la app; es lo que usa el badge HO). **No** depende de un código fijo.
- **`RFID_ARR_OE` (llegada a la oficina de cambio)** = código **`2420`**
  (Entry Inbound OE). *Confirmado por el usuario en revisión de diseño.*
- **EDI:** `RESCON`, `RESDES`, `PREDES` provienen de `edi_events.message`, con UTC
  canónico vía `vw_edi_events_tz` (incremento ATAT ya mergeado).

### Las 4 comparaciones (semilla de `ref_event_comparison`)

| `comparison_key` | prioridad | RFID (selector) | EDI (`message`) | `requires_colocation` | `direction` | etiqueta |
|---|---|---|---|---|---|---|
| `ho_rescon` | 1 | `handover_flag` | `RESCON` | true | `rfid_first` | Handover vs recepción transporte |
| `ho_resdes` | 2 | `handover_flag` | `RESDES` | true | `rfid_first` | Handover vs apertura en OE |
| `ho_predes` | 3 | `handover_flag` | `PREDES` | false | `either` | Handover vs anuncio despacho |
| `arroe_rescon` | 4 | `2420` | `RESCON` | true | `rfid_first` | Llegada OE vs recepción transporte |

---

## 3. Reglas de emparejamiento (v1)

- **Ancla RFID:** el **primer** (mínimo `event_datetime_utc`) movimiento de la S9 que
  cumpla el selector de la comparación:
  - `handover_flag` → `handover_point = true`.
  - código `2420` → `edi_equivalent = '2420'`.
- **Ancla EDI:** el **primer** (mínimo UTC canónico) `edi_events` de la misma S9 cuyo
  `message` ∈ el set de la comparación, dentro de **`pairing_window_days` = 7** días
  respecto al ancla RFID.
- **`gap_days`** = `(edi_utc - rfid_utc)` en días (UTC). Puede ser **negativo** (EDI
  antes que RFID en par `rfid_first` → anomalía de secuencia; se conserva).
- **Colocación:** se calcula el flag `colocation_valid` pero en v1 **no se filtra**
  (se muestran todos los pares). Enforcement de colocación = refinamiento posterior.
- **Producto:** `mail_category` de `edi_details` para la S9. Nulo → `(sin producto)`.
- **Corredor:** derivado de la S9 — `origPoCode = s9[0:6]`, `destPoCode = s9[6:12]`
  (oficinas IMPC). Granularidad seleccionable:
  - **Centro** = oficina IMPC completa (6 car.), p.ej. `INBOMB → JPTYOA`.
  - **País** = 2 primeros caracteres, p.ej. `IN → JP`.
- Solo se genera fila para una `(S9, comparación)` que tenga **ambos** anclas.

---

## 4. Datos nuevos en Leg2 (`ubgatxfwpmyaqyfrwias`)

> **Regla de seguridad (global CLAUDE.md):** antes de aplicar CUALQUIER migración,
> `execute_sql`, `apply_migration` o deploy, se nombra proyecto + ref
> (`ubgatxfwpmyaqyfrwias`) y se pide confirmación explícita. Nunca inferir la base.

### 4.1 `ref_event_comparison` (tabla-dato, semilla)
Columnas: `comparison_key text primary key`, `priority int`, `rfid_selector text`
(`'handover_flag'` | código de 4 cifras), `edi_messages text[]`,
`requires_colocation boolean`, `direction text`, `label text`.
Sembrada con las 4 filas de §2. RLS: lectura `authenticated`.

### 4.2 `event_pair_exclusion` (tabla)
Exclusiones **permanentes** y **globales** (limpieza de dato compartida — afecta a
todos los usuarios). Columnas: `s9code text`, `comparison_key text`,
`excluded_by text` (email), `excluded_at timestamptz default now()`,
`reason text null`. **PK `(s9code, comparison_key)`**.
RLS: `authenticated` puede `select` / `insert` / `delete`.

### 4.3 `vw_event_pair_gaps_s9` (vista — el detalle)
Una fila por `(s9code, comparison_key)` con ambos anclas. Columnas expuestas:
`s9code`, `comparison_key`, `origin_office` (6), `dest_office` (6),
`origin_country` (2), `dest_country` (2), `product` (`mail_category`),
`rfid_utc`, `edi_utc`, `gap_days numeric`, `event_month date` (mes UTC del ancla
RFID, truncado a día 1), `colocation_valid boolean`, `excluded boolean`
(left join a `event_pair_exclusion`).

### 4.4 RPC `event_pair_matrix(p_from date, p_to date, p_product text, p_granularity text)`
Agrega la vista al conjunto de la matriz. `p_granularity ∈ {'centre','country'}`
elige si origen/destino se agrupan por oficina (6) o país (2). `p_product` filtra
por `mail_category` (o `null`/`'all'` = todos). Filtra por la fecha del ancla RFID
(`rfid_utc::date`) en `[p_from, p_to]` — filtrado preciso al día, no truncado a mes
(`event_month` se reserva para la agregación de snapshots del Incr. 2).
**Excluye** las filas con `excluded = true`.
Devuelve: `origin`, `destination`, `comparison_key`, `mean_days numeric`,
`n int` (nº de pares). El frontend pivota `comparison_key` a columnas.

---

## 5. Frontend (`leg2-reporting/`)

### 5.1 Routing y navegación
- Nueva ruta `#/gaps` en `lib/hashRoute.ts` (`{ name: "gaps" }`).
- Nuevo botón en `Nav` (`App.tsx`) con string i18n `strings.gaps.nav`.
- Nueva página `pages/EventGapsPage.tsx`.

### 5.2 Controles (arriba)
- **Rango de fechas:** reutiliza el patrón de `ReportFilters` / `lib/datePresets`.
- **Producto:** `Select` con `mail_category` (A/B/D/LC… + "Todos" + "(sin producto)").
- **Granularidad:** toggle Centro ↔ País (default **Centro**).
- Métrica fija = **media de días** en v1 (sin selector).

### 5.3 Matriz
- Filas = corredor `origen → destino` (a la granularidad elegida), ordenadas por
  `n` desc (o alfabético — decidir en plan; default alfabético por origen,destino).
- Columnas = las 4 comparaciones, **ordenadas por `priority`**, encabezado con la
  `label` (tooltip) y `comparison_key`.
- Casilla = `mean_days` formateada (1 decimal) con `n` como subtexto pequeño.
  Casilla vacía (`—`) si no hay pares.

### 5.4 Diálogo de detalle (clic en casilla)
- Abre `EventGapsDetailDialog` con los pares S9 que componen esa casilla
  (fetch a `vw_event_pair_gaps_s9` filtrado por corredor + comparación + producto +
  rango). El filtro de corredor usa la granularidad activa: Centro →
  `origin_office`/`dest_office` (6 car.); País → `origin_country`/`dest_country`
  (2 car.). El detalle **no** filtra por `excluded` (muestra las excluidas tachadas
  para poder reincluirlas).
- Columnas: `s9code`, `origen→destino`, producto, `rfid_utc`, `edi_utc`,
  `gap_days`, **checkbox "Excluir"**.
- Marcar/desmarcar → `insert`/`delete` en `event_pair_exclusion` vía PostgREST
  (RLS `authenticated`; sin edge function) → refetch de matriz + diálogo.
- Filas excluidas: tachadas, no cuentan en la media.

### 5.5 Capa de datos (`lib/supabase.ts` + helpers)
- `fetchEventPairMatrix(params, deps)` → RPC `event_pair_matrix`.
- `fetchEventPairDetail(corridor, comparisonKey, product, range, deps)` → vista.
- `setEventPairExclusion(s9, comparisonKey, excluded, deps)` → insert/delete.
- Interfaces TS: `EventPairMatrixRow`, `EventPairDetailRow`.
- Helper puro `lib/eventGaps.ts`: pivota filas de matriz → columnas por comparación
  (para la tabla), y utilidades de formato de `gap_days`.

---

## 6. Tests (Vitest + React Testing Library, patrón existente)

- `lib/eventGaps.test.ts`: pivot filas→columnas por `comparison_key`; casillas
  ausentes → `—`; orden de columnas por prioridad; formato de `gap_days`.
- `lib/supabase.test.ts` (extensión): construcción de URL/params de la RPC y de la
  vista de detalle; params de exclusión insert/delete.
- `components/EventGapsMatrix.test.tsx`: render de la matriz, casilla vacía, clic
  dispara callback con corredor+comparación.
- `components/EventGapsDetailDialog.test.tsx`: render de filas, toggle de exclusión
  llama al escritor y refleja tachado.
- `pages/EventGapsPage.test.tsx`: cambio de granularidad y de producto re-consulta;
  integración controles↔matriz.
- **SQL:** validación manual con consultas de solo lectura contra Leg2 (no hay BD
  local; `config.toml`/`.env.local` apuntan a Study, NO a Leg2 — trampa conocida).

---

## 7. Incremento 2 — Snapshots de cierre de mes (DIFERIDO, no en v1)

Habilitador: la métrica es la **media**, luego un snapshot solo necesita
`suma_días` + `conteo` por `(corredor, comparación, producto, mes)`:
- Rango de periodos = sumar meses → media exacta recombinada.
- Excluir un outlier de un mes cerrado = `suma -= gap; conteo -= 1` (O(1), exacto);
  re-incluir = revertir. No hace falta recalcular del detalle.

Componentes (Incremento 2):
- Tabla `fact_event_pair_month` (`origin`, `destination`, `comparison_key`,
  `product`, `event_month`, `sum_days`, `cnt`).
- Cron de cierre mensual que la puebla (pg_cron, patrón de los cron ETL existentes).
- Umbral de antigüedad: meses cerrados < umbral → leer snapshot; meses recientes →
  vista dinámica; el RPC combina ambos.
- Ajuste incremental de `sum_days`/`cnt` al excluir/reincluir en meses ya cerrados.

El detalle (`edi_events`, movimientos) nunca se purga → el snapshot es una **caché**;
el detalle es la fuente de verdad.

---

## 8. Decisiones cerradas (confirmadas en brainstorming)

1. Las **4 comparaciones** del documento entran en v1.
2. `RFID_400` = flag **`handover_point = true`** (no código fijo).
3. `RFID_ARR_OE` = código **`2420`**.
4. Rejilla: filas = corredor `origen→destino`; columnas = comparaciones;
   casilla = **media de días**; periodo y producto = **filtros**.
5. Métrica = **media** (se acumula limpio en snapshots).
6. Granularidad = **Centro (6 car.), agrupable a País (2 car.)**, toggle en el
   informe; default Centro.
7. Ventana de emparejamiento = **7 días**.
8. Exclusión = **global** y por **`(s9, comparación)`**; permanente, toggleable.
9. Colocación = calculada (`colocation_valid`) pero **no filtrada** en v1.
10. Enfoque = **A (dinámico primero)**; snapshots = Incremento 2.

---

## 9. Fuera de alcance (v1)

- Eventos/comparaciones a nivel ítem (S10): EMD/EDB/EDC/EMF — excluidos por el doc.
- Percentiles (mediana/p90/p99) y % dentro de umbral — el doc los menciona; v1 solo
  media. Posible incremento posterior (requiere guardar distribución en snapshots).
- Enforcement de colocación (filtro por `colocation_valid`).
- Snapshots de cierre de mes y cron (Incremento 2).
- Export a CSV/S3 de esta pantalla.
