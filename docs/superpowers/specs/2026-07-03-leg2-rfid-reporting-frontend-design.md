# Leg2 RFID Reporting — Frontend Design Spec

**Fecha:** 2026-07-03
**Estado:** Diseño aprobado (pendiente de review del usuario antes de escribir el plan)
**Autor:** sesión Claude Code (workspace EDGE)

## 1. Objetivo

Construir un **frontend nuevo y autocontenido** que replique el reporte
"Receptacle Tracking — RFID events" de IPC (MicroStrategy, reporting.ipc.be),
alimentado por los datos del proyecto **Supabase Leg2**
(`ubgatxfwpmyaqyfrwias`). No es una página dentro del dashboard legacy: es un
app propio cuyo backend primario y único es Leg2.

El reporte es **predefinido** (no ad-hoc): un pivot maestro por receptáculo (S9)
con los checkpoints como columnas y un panel de detalle maestro-detalle.

## 2. Contexto y restricciones heredadas

- **Proyecto de datos:** Leg2 `ubgatxfwpmyaqyfrwias` (org `hwuajreqsmhxdojtlthg`).
  NO confundir con EDGE Study `ewyhmmixqcubqokphebh` (legacy), al que apunta el
  `edge-rfid-dashboard` existente. El app nuevo ignora Study por completo.
- **Regla anti-confusión (CLAUDE.md):** antes de CUALQUIER escritura en Supabase
  (migración, execute_sql, apply_migration, deploy) nombrar proyecto+ref y pedir
  confirmación explícita. Nunca inferir la base.
- **Modelo de tiempo (ya resuelto en el ETL, ver
  `2026-07-03-etl-leg2-timezone-model-design.md`):** `event_datetime_utc` es el
  instante canónico. La vista `vw_quicksight_rfid_report_movements` recomputa
  `event_datetime_local` al vuelo vía `rfid_timezone_map` (self-healing). Ambos
  timestamps vienen ya en la vista.
- **Despliegue:** el `edge-rfid-dashboard` se sirve en Netlify como estático
  (`dist/public`); su server Express NO corre en prod. El app nuevo hereda ese
  modelo: **SPA estático, sin backend propio**; habla PostgREST directo a Leg2.

## 3. Fuente de datos

### 3.1 Vista principal

`public.vw_quicksight_rfid_report_movements` (Leg2). Columnas relevantes
(la vista expone 30; las que usa el reporte):

| Columna | Uso en el reporte |
|---|---|
| `s9_id` | **S9** — clave del pivot (1 fila por S9) |
| `tag_id` | **Rte** (GID RFID, formato `G.1UPU....`) |
| `movement_id` | **Event Id** (detalle) |
| `source_edge_id` | id de lectura origen (auditoría) |
| `reader_id` | **Rp** (LPI del lector, `J11D...`) |
| `movement_type` | Inbound/Outbound: `INBOUND` / `OUTBOUND` / `TRANSIT_ENTRY` / `TRANSIT_EXIT` |
| `route_country_role` | `ORIGIN` / `DESTINATION` / `TRANSIT` (refuerza la pestaña) |
| `edi_equivalent` | **Checkpoint code**: `2320` (Exit Outbound) / `2400` (Entry Inbound) |
| `origin_country_code` | filtro Orig country |
| `destination_country_code` | filtro Dest country |
| `movement_country_code` | país donde ocurre el movimiento |
| `country_sequence_number` | orden del país en la ruta |
| `event_datetime_utc` | timestamp canónico (toda aritmética) |
| `event_datetime_local` | timestamp presentación (toggle) |
| `reader_timezone` | zona IANA resuelta (informativo) |
| `site_impc_code` | **Site Code** (preferente) |
| `centre_code` | **Site Code** (fallback si `site_impc_code` null) |
| `site_name`, `city`, `country_name` | etiquetas legibles |
| `handover_point`, `handover_quality_status` | calidad del handover (badge) |

### 3.2 Columnas de checkpoint DINÁMICAS (requisito explícito)

El pivot del IPC tiene ~9 columnas de checkpoint (2300/2310/2320/2400/2410/2420/
2440/2450). **Leg2 hoy solo captura los puntos de handover**: `2320` (salida de
origen) y `2400` (entrada en destino), más los TRANSIT. Distribución real
(2026-07-03): INBOUND 6521, OUTBOUND 1377, TRANSIT_ENTRY 110, TRANSIT_EXIT 110;
`edi_equivalent` ∈ {2320, 2400}; ~15/8118 con EDI null (hueco fuente GMS).

**Regla de diseño (crítica):** las columnas-checkpoint del pivot NO se
hardcodean. Se **derivan del dato en runtime**: el conjunto de columnas = los
valores DISTINTOS de `edi_equivalent` presentes en el dataset filtrado (según
pestaña/filtros activos). Así, cuando el ETL empiece a producir checkpoints
nuevos (porque se suman lectores/puntos con otros `edi_equivalent_inbound/
outbound` en GMS), **las columnas nuevas aparecen solas, sin tocar código**.
Hoy salen 2 columnas; el día que aparezca un `2410`, sale una tercera
automáticamente.

- **Orden de columnas:** ascendente por el valor numérico del código. Esto
  coincide con el orden semántico del IPC (2300→2310→2320 salida, luego
  2400→2410→2420 entrada, 2440/2450 al final) y ordena razonablemente cualquier
  código futuro desconocido.
- **Etiqueta de columna:** mapa `CHECKPOINT_LABELS` (código→nombre legible); si
  un código no está mapeado, se muestra **el código crudo** tal cual (cero
  mantenimiento para que aparezca; se le pone nombre bonito después). Mapa base:

  | code | label |
  |---|---|
  | 2300 | Exit From Outbound OE |
  | 2310 | Entry Outbound AMU |
  | 2320 | Exit Outbound AMU |
  | 2400 | Entry Inbound AMU |
  | 2410 | Exit Inbound AMU |
  | 2420 | Entry Inbound OE |
  | 2440 | Incorrect Inbound |
  | 2450 | Backup |

- **Celda:** el `Reg Time` del movimiento cuyo `edi_equivalent` = ese código para
  ese S9 (según toggle UTC/Local). Si un S9 tiene varios movimientos en el mismo
  checkpoint, la celda muestra el **más temprano** (`min event_datetime_utc`);
  todos quedan visibles en el panel de detalle. Vacío si no hubo paso.
- Movimientos con `edi_equivalent` null NO generan columna (no hay checkpoint);
  se listan igualmente en el detalle del S9.

### 3.3 Derivaciones (confirmadas contra el código legacy y el estándar UPU S9)

- **Orig Po Code** = `s9_id.slice(0, 6)` (IMPC de oficina de cambio origen).
- **Dest Po Code** = `s9_id.slice(6, 12)` (IMPC de oficina de cambio destino).
  (El legacy usa exactamente `s9id.slice(6,12)` para el destino y
  `s9id.like.<code>*` para el origen — mismo esquema.)
- **Site Code** = `site_impc_code ?? centre_code`.
- **Inbound/Outbound** (pestañas): `movement_type IN ('OUTBOUND','TRANSIT_EXIT')`
  → Outbound; `IN ('INBOUND','TRANSIT_ENTRY')` → Inbound.

### 3.4 Terminología (la del usuario, NO la de IPC)

Los encabezados/etiquetas usan la terminología del usuario, no la de IPC.
Defaults en inglés (i18n-ready, ver §4.5):

| IPC | Campo Leg2 | Etiqueta (default EN) |
|---|---|---|
| Rp | `reader_id` | **RFID Reader** |
| Rte | `tag_id` | **RFID Tag** |
| S9 | `s9_id` | **S9** |
| Orig Po Code | `s9_id[0:6]` | **Origin IMPC** |
| Dest Po Code | `s9_id[6:12]` | **Destination IMPC** |
| Event Id | `movement_id` | **Movement Id** |
| Reg Time | `event_datetime_*` | **Time** |
| Site Code | `site_impc_code ?? centre_code` | **Site** |

Las columnas-checkpoint conservan su nombre estándar EDI vía `CHECKPOINT_LABELS`
(§3.2); son códigos de evento, no terminología IPC de campos.

## 4. Arquitectura del app

### 4.1 Ubicación y stack

- Carpeta nueva autocontenida en el repo EDGE: **`leg2-reporting/`** (raíz del
  repo), con su propio `package.json`, `vite.config.ts`, `tsconfig`, build y
  deploy independientes. No se modifica `edge-rfid-dashboard`.
- Stack idéntico al probado: **React 19 + Vite 7 + Tailwind v4 + shadcn/ui +
  wouter**. Se copian los componentes reutilizables (`ui/*`, `DataTable`,
  `DateRangePicker`) y los patrones de `AuthContext`/`ThemeContext`, adaptados a
  Leg2.
- SPA 100% estático (sin server Express). Deploy como el legacy (Netlify o
  equivalente): `dist` + redirect SPA `/* → index.html`.

### 4.2 Acceso a datos

- Cliente único `lib/supabase.ts` → `createClient(VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY)` apuntando a **Leg2**. Las `VITE_*` se inlinean en el
  bundle (key pública, mismo modelo que el legacy).
- Fetch vía PostgREST con paginación (patrón `fetchRfidReadings` del legacy:
  páginas de 1000, `Range`/`content-range`, reintentos). Volumen ~8k filas →
  una carga simple es suficiente; paginar por robustez.
- El token del usuario autenticado (Supabase Auth de Leg2) va en `Authorization`;
  RLS de Leg2 gobierna el acceso.

### 4.3 Autenticación

- **Supabase Auth de Leg2.** Login (email/password) contra el Auth del propio
  proyecto Leg2. `AuthContext` gestiona sesión/refresh (patrón legacy).
- Rutas protegidas con `ProtectedRoute`; sin sesión → `LoginPage`.

### 4.4 Cambio requerido en Leg2 (única escritura — se confirma aparte)

La vista hoy no tiene grants a roles de cliente. Para que el rol
`authenticated` la lea:

```sql
GRANT SELECT ON public.vw_quicksight_rfid_report_movements TO authenticated;
```

La vista corre como su owner (security_invoker por defecto = false), por lo que
lee las tablas base bajo el owner y el `GRANT SELECT` sobre la vista basta; no
hace falta tocar la RLS de `rfid_report_movements`. Si en review se decide
restringir por usuario, se añadirá una policy; v1 asume "cualquier usuario
autenticado del proyecto Leg2 puede leer el reporte".

> Esta sentencia se ejecutará **nombrando proyecto+ref (Leg2
> `ubgatxfwpmyaqyfrwias`) y pidiendo confirmación explícita**, conforme a la
> regla anti-confusión.

### 4.5 Preparado para i18n (traducción futura)

El desarrollo es en **inglés**, pero se deja listo para traducir a varios
idiomas más adelante (NO se construye el módulo de i18n ahora — YAGNI). Regla:
**toda cadena visible sale de un único diccionario** `src/i18n/strings.ts`
(inglés), y las etiquetas de checkpoint de `CHECKPOINT_LABELS`
(`src/lib/checkpoints.ts`). Los componentes NUNCA hardcodean texto visible: lo
referencian desde ese diccionario. Así, añadir un idioma luego = añadir un
locale y un selector, sin tocar los componentes ni cazar strings dispersos. v1
expone un solo locale (`en`).

## 5. UI del reporte

### 5.1 Layout

Ruta protegida `/` (principal). Cabecera con título, `DateRangePicker`, toggle
**UTC ↔ Local**, y pestañas **Inbound / Outbound**.

```
┌───────────────────────────────────────────────────────────────┐
│ Leg2 RFID Reporting        [Date range]  [UTC|Local]  [user ▾] │
│ ( Inbound ) ( Outbound )                                        │
│ Filtros: Orig country ▾  Dest country ▾  S9 [search] Rte [srch]│
├───────────────────────────────────────────────────────────────┤
│ RFID events (pivot — 1 fila por S9; columnas checkpoint dinámicas) │
│ S9 | Orig Po | Dest Po | Rte | «2320 Exit Outbound» | «2400 Entry» │
│    |         |         |     |  timestamp           |  timestamp   │
│    |         |         |     |  (columnas = edi_equivalent presentes,│
│    |         |         |     |   crecen solas al sumar checkpoints)  │
│  … (clic en fila → carga el detalle abajo)                     │
├───────────────────────────────────────────────────────────────┤
│ Event details (detalle del S9 seleccionado)                   │
│ S9 | Rte | Event Id | Reg Time | Site Code | Rp | handover     │
└───────────────────────────────────────────────────────────────┘
```

### 5.2 Pivot superior ("RFID events")

- Una fila por **S9** dentro de la pestaña activa (Inbound/Outbound).
- Columnas fijas (izquierda): `S9`, `Orig Po Code`, `Dest Po Code`, `Rte`
  (tag_id).
- **Columnas-checkpoint DINÁMICAS** (§3.2): una por cada `edi_equivalent`
  presente en el dataset filtrado, ordenadas por código numérico, etiquetadas
  vía `CHECKPOINT_LABELS` (o el código crudo si no está mapeado). La celda
  muestra el `Reg Time` (según toggle) del movimiento de ese S9 en ese
  checkpoint; vacío si no hubo paso. Hoy salen 2 (2320/2400); crecen solas.
- Tránsitos (TRANSIT_ENTRY/EXIT): se muestran como movimientos adicionales del
  mismo S9 (indicador de tránsito); v1 los lista en el detalle.
- Orden de filas por defecto: `Reg Time` desc.

### 5.3 Detalle inferior ("Event details")

- Se puebla al seleccionar un S9 en el pivot: todos los movimientos de ese S9
  (una fila por movimiento), ordenados por `event_datetime_utc`.
- Columnas: `S9`, `Rte` (tag_id), `Event Id` (movement_id), `Reg Time`
  (según toggle), `Site Code` (`site_impc_code ?? centre_code`), `Rp`
  (reader_id), y badge de `handover_quality_status`.

### 5.4 Filtros

- **Orig country / Dest country**: dropdowns poblados desde los valores
  presentes en el dataset (`origin_country_code` / `destination_country_code`).
- **S9**: búsqueda por texto (contains).
- **Rte**: búsqueda por texto sobre `tag_id`.
- **Report date**: rango sobre `event_datetime_utc` (el filtrado de rango es por
  instante canónico, no por local).
- Pestañas Inbound/Outbound aplican el filtro `movement_type` descrito en §3.3.

### 5.5 Toggle UTC ↔ Local (requisito explícito del usuario)

- Switch global. **Regla dura:** cualquier **duración entre dos eventos se
  calcula SIEMPRE con `event_datetime_utc`** (inmune a DST y cambios de huso).
  El toggle **solo** cambia qué timestamp se *muestra* (`event_datetime_utc` vs
  `event_datetime_local`). Nunca se computa un delta sobre el local.
- v1 no muestra duraciones calculadas todavía, pero la regla queda fijada en el
  helper de formato para cuando se añadan (v2: tiempos entre checkpoints).

## 6. Componentes y ficheros (estructura propuesta)

```
leg2-reporting/
  package.json, vite.config.ts, tsconfig*.json, index.html, tailwind config
  src/
    main.tsx, App.tsx                    # router wouter + providers
    lib/
      supabase.ts                        # cliente Leg2 + fetchRfidMovements()
      checkpoints.ts                     # CHECKPOINT_LABELS + columnas dinámicas
      time.ts                            # formato UTC/Local + regla de duración
      utils.ts                           # cn(), helpers
    contexts/
      AuthContext.tsx                    # Supabase Auth de Leg2
      ThemeContext.tsx
    hooks/
      useRfidEventsReport.ts             # fetch + pivot por S9 + filtros
    pages/
      RfidEventsPage.tsx                 # layout principal (pivot + detalle)
      LoginPage.tsx
    components/
      RfidEventsPivot.tsx                # tabla pivot superior
      EventDetailsTable.tsx              # tabla detalle inferior
      ReportFilters.tsx                  # orig/dest/S9/Rte/date/toggle/tabs
      ui/*                               # shadcn copiados según necesidad
```

### 6.1 Interfaces clave

```ts
// lib/supabase.ts
export interface RfidMovement {
  movement_id: string;
  s9_id: string;
  tag_id: string | null;
  reader_id: string;
  movement_type: 'INBOUND' | 'OUTBOUND' | 'TRANSIT_ENTRY' | 'TRANSIT_EXIT';
  route_country_role: 'ORIGIN' | 'DESTINATION' | 'TRANSIT' | null;
  edi_equivalent: string | null;             // '2320' | '2400' | null
  origin_country_code: string | null;
  destination_country_code: string | null;
  movement_country_code: string | null;
  country_sequence_number: number | null;
  event_datetime_utc: string;                // ISO UTC
  event_datetime_local: string;              // sin offset (presentación)
  reader_timezone: string;
  site_impc_code: string | null;
  centre_code: string;
  site_name: string | null;
  city: string | null;
  handover_point: boolean;
  handover_quality_status: string | null;
}

export async function fetchRfidMovements(filters: {
  dateFrom?: string; dateTo?: string;
}): Promise<RfidMovement[]>;

// lib/checkpoints.ts
export const CHECKPOINT_LABELS: Record<string, string> = {
  '2300': 'Exit From Outbound OE',
  '2310': 'Entry Outbound AMU',
  '2320': 'Exit Outbound AMU',
  '2400': 'Entry Inbound AMU',
  '2410': 'Exit Inbound AMU',
  '2420': 'Entry Inbound OE',
  '2440': 'Incorrect Inbound',
  '2450': 'Backup',
};
/** label conocido, o el código crudo si no está mapeado */
export function checkpointLabel(code: string): string;
/** columnas dinámicas: códigos distintos presentes, ordenados por valor numérico asc */
export function checkpointColumnsFromData(movs: RfidMovement[]): CheckpointColumn[];

export interface CheckpointColumn {
  code: string;    // edi_equivalent, p.ej. '2320'
  label: string;   // checkpointLabel(code)
}

// hooks/useRfidEventsReport.ts
export interface S9PivotRow {
  s9_id: string;
  origPoCode: string;   // s9_id.slice(0,6)
  destPoCode: string;   // s9_id.slice(6,12)
  rte: string | null;   // tag_id
  // celda por checkpoint: código edi_equivalent -> movimiento representativo
  // (el de min event_datetime_utc si hay varios). Claves = columnas dinámicas.
  cells: Record<string, RfidMovement>;
  transits: RfidMovement[];
  all: RfidMovement[];  // para el detalle
}

export interface RfidEventsReport {
  columns: CheckpointColumn[];  // dinámicas, ordenadas (derivadas del dataset)
  rows: S9PivotRow[];
}
```

## 7. Estrategia de testing

- **Lógica pura primero (Vitest):** el pivotado y las derivaciones son funciones
  puras testeables sin red:
  - `deriveOrigPoCode('INBOMBJPTYOA...') === 'INBOMB'`,
    `deriveDestPoCode(...) === 'JPTYOA'`.
  - **Columnas dinámicas:** `checkpointColumnsFromData([mov2400, mov2320])`
    devuelve `[{code:'2320'...},{code:'2400'...}]` (orden numérico asc); si el
    input incluye un `2410` inédito, aparece una tercera columna sin cambios de
    código; un código no mapeado (p.ej. `9999`) usa su código crudo como label.
  - `pivotByS9([mov2320, mov2400, ...])` agrupa por s9_id y coloca cada
    movimiento en `cells[edi_equivalent]`; con dos movimientos del mismo
    checkpoint, `cells[code]` = el de `min event_datetime_utc`.
  - `classifyTab('OUTBOUND') === 'outbound'`,
    `classifyTab('TRANSIT_ENTRY') === 'inbound'`.
  - `formatTimestamp(mov, 'utc'|'local')` devuelve el campo correcto.
  - Regla dura: un helper `durationHours(a, b)` que SIEMPRE usa
    `event_datetime_utc` (test que verifica que ignora el local).
- **Fetch:** test del armado de URL/params PostgREST y de la paginación con
  `content-range` mockeado (sin red real).
- **Componentes:** smoke test de render del pivot con datos de ejemplo y del
  cambio de pestaña/toggle.
- No hay tests e2e contra Leg2 en v1 (evita depender de credenciales en CI).

## 8. Manejo de errores

- Fetch: reintentos por página (patrón legacy); si una página falla tras
  reintentos, se registra y se continúa (no romper todo el reporte).
- Sin sesión / token expirado: redirigir a `LoginPage`.
- Vista sin grant (401/403 PostgREST): mensaje claro "sin permiso de lectura
  sobre el reporte en Leg2" (indica que falta el `GRANT SELECT`).
- Dataset vacío tras filtros: estado vacío explícito, no spinner infinito.

## 9. Fuera de alcance (v2+)

- Cálculo y visualización de **duraciones entre checkpoints** (la regla UTC ya
  queda fijada para cuando se añada).
- Checkpoints internos no-handover (2300/2310/2410/2420/2440/2450): Leg2 no los
  tiene; requerirían nueva captura en el ETL.
- Export a CSV/Excel desde el app (el CSV de QuickSight ya existe por otra vía).
- SSO con el portal OAuth (v1 usa Supabase Auth de Leg2).

## 10. Riesgos / notas

- **Seguridad:** rotación pendiente de la access key AWS del export (no afecta a
  este app, pero sigue abierta).
- **EDI null:** ~15 movimientos con `edi_equivalent` null caerán fuera de las
  columnas 2320/2400; se listan igualmente en el detalle. Es hueco de fuente
  (GMS), self-healing en el próximo sync.
- **Grant a `authenticated`:** expone el reporte a todo usuario autenticado de
  Leg2. Si se requiere granularidad por usuario/país, se añadirá RLS en v2.
```