# Leg2 — Constructor de comparaciones definidas por el usuario (Incremento 3) — Diseño

**Fecha:** 2026-07-06
**Proyecto Supabase:** EDGE Leg2 — ref `ubgatxfwpmyaqyfrwias`
**App:** `leg2-reporting/`
**Rama:** `feat/leg2-event-gaps` (continúa sobre Incrementos 1 y 2, aún sin mergear)

## 1. Objetivo y problema

El sistema actual de la pantalla "Días entre eventos" fija **4 comparaciones** (handover×RESCON/RESDES/PREDES, ARR_OE×RESCON) con lógica especial en SQL (flag `handover_point` / código `2420`). El usuario necesita **definir sus propias comparaciones**: elegir cualquier par de eventos y medir la diferencia de tiempo. Los cuatro déficits confirmados:
1. Las 4 fijas no cubren lo que necesita.
2. Quiere comparar **códigos RFID concretos**, no el agregado "handover".
3. Quiere **cualquier pareja**: RFID↔RFID, EDI↔EDI, RFID↔EDI (hoy solo RFID↔EDI).
4. El emparejamiento fijo (primer-a-primer, ±7 d) no es el adecuado.

**Insight clave del dominio:** normalmente hay **una sola lectura de cada evento por S9**. Por tanto no hace falta elegir ocurrencia ni ventana: una comparación se reduce a elegir **Evento A** y **Evento B**; el gap es `tiempo(B) − tiempo(A)` para cada S9 que tenga ambos.

## 2. Modelo genérico de comparación

Una comparación deja de tener lógica especial y pasa a ser un dato genérico:

`comparison = (comparison_key, name, a_source, a_code, b_source, b_code, priority)`

- `source ∈ {'RFID','EDI'}`.
- `code` = un código de checkpoint RFID (`2300/2310/2320/2400/2410/2420/2440/2450`), un mensaje EDI (`RESCON/RESDES/PREDES/PRECON/CARDIT/RESDIT*/POD/…`), o el pseudo-evento `'__HO__'` (RFID handover de cualquier gate = `handover_point=true`).
- `gap_days = tiempo(B) − tiempo(A)`; puede ser negativo.
- **Sin ventana** (ser el mismo S9 ya liga los eventos). **Primera ocurrencia** (`min(UTC)`) por si hubiera duplicados.
- Cualquier combinación de source/code es válida (RFID↔RFID, EDI↔EDI, RFID↔EDI).

## 3. Decisiones confirmadas

1. **Sin ventana** de emparejamiento (scoping por mismo S9).
2. **Primera ocurrencia** (`min` del UTC) — defensivo ante duplicados; normalmente hay una.
3. Se incluye el pseudo-evento **`__HO__` "RFID handover (cualquier gate)"** para conservar el agregado y expresar las 4 seeds.
4. Pantalla de gestión **compartida/global**: cualquier usuario autenticado crea/edita/borra; todos ven las mismas comparaciones (coherente con la exclusión global).
5. **Reemplaza** el concepto de las 4 fijas, pero se **siembran** esas 4 como filas editables/borrables (no se pierde nada al arrancar).
6. `gap = B − A` (el usuario decide el orden A→B).

## 4. Datos nuevos / redefinidos en Leg2 (`ubgatxfwpmyaqyfrwias`)

> **Regla de seguridad:** antes de aplicar cualquier migración/deploy se nombra proyecto + ref (`ubgatxfwpmyaqyfrwias`) y se pide confirmación explícita. Idempotente donde sea posible.

Migración (drop dependientes → recrear): la vista base, la de detalle y la función dependen de `ref_event_comparison`; el orden es `drop function` → `drop view detail` → `drop view base` → redefinir tabla → reseed → recrear vistas+función.

### 4.1 `ref_event_comparison` (redefinida, esquema genérico)
`comparison_key text pk, name text not null, a_source text not null, a_code text not null, b_source text not null, b_code text not null, priority int not null`.
- RLS: `for all to authenticated` (CRUD compartido; como `event_pair_exclusion`).
- Seed de las 4 actuales, con sus `comparison_key` originales (para que las exclusiones existentes sobrevivan):
  - `ho_rescon`  = RFID `__HO__` → EDI `RESCON`  (prioridad 1)
  - `ho_resdes`  = RFID `__HO__` → EDI `RESDES`  (2)
  - `ho_predes`  = RFID `__HO__` → EDI `PREDES`  (3)
  - `arroe_rescon` = RFID `2420` → EDI `RESCON` (4)
- Claves de comparaciones nuevas: generadas por el cliente (uuid/slug único).

### 4.2 `vw_comparison_events` (vocabulario de eventos, para el selector)
Vista que devuelve los eventos seleccionables presentes en los datos:
`source, code, n` = union de: RFID `edi_equivalent` distintos (con conteo), el pseudo `('RFID','__HO__')`, y EDI `message` distintos. El frontend pone etiqueta legible (RFID vía `CHECKPOINT_LABELS`; EDI = el propio mensaje o un mapa de nombres; `__HO__` = "Handover (cualquier gate)").

### 4.3 `vw_event_pair_gaps_s9` (base, genérica — reescrita)
CTE `events` unificado por S9: `(source, code, first_ts=min(UTC))` = union de movimientos RFID por `edi_equivalent`, el pseudo `__HO__` (min UTC donde `handover_point`), y `vw_edi_events_tz` por `message`. Luego, por cada comparación: `join events A` + `join events B` (mismo S9) → una fila por `(s9, comparison_key)` con: `origin_office/dest_office/origin_country/dest_country` (de la S9), `product` (`mail_category`), `a_utc`, `b_utc`, `gap_days = round((b_utc−a_utc)/86400,4)`, `event_month = date_trunc('month', a_utc)`, `excluded` (left join a `event_pair_exclusion`). `security_invoker = on`.
- **Nota de columnas:** las columnas de timestamp pasan de `rfid_utc/edi_utc` a **`a_utc/b_utc`** (A/B pueden ser ambos RFID o ambos EDI). El filtro de fecha de la matriz usa `a_utc`.

### 4.4 `event_pair_matrix(p_from, p_to, p_product, p_granularity)` (RPC — adaptada)
Misma firma y columnas de salida (`origin, destination, comparison_key, mean_days, n`). Filtra por `a_utc::date` en `[p_from,p_to]`, `not excluded`, producto; agrupa por corredor+comparación. `security invoker`.

### 4.5 `vw_event_pair_detail_s9` (detalle — adaptada)
Igual que hoy (base + gate/site de las lecturas rol ORIGIN/DESTINATION), con `a_utc/b_utc` en lugar de `rfid_utc/edi_utc`. `drop view if exists` + `create` (por el `select g.*`).

## 5. Frontend

### 5.1 Pantalla de gestión "Comparaciones" (nueva)
- Ruta nueva `#/comparisons`, botón en la nav, página `ComparisonsPage`.
- Lista las comparaciones (nombre, A→B con etiquetas, prioridad) y permite **crear / editar / borrar**.
- Formulario de fila: `name`, selector **Evento A** (source+code desde `vw_comparison_events`, agrupados RFID/EDI con etiqueta), selector **Evento B**, `priority`.
- Escrituras vía PostgREST directo (RLS `authenticated`): insert/update/delete en `ref_event_comparison`. Clave generada en cliente para nuevas.
- i18n en `strings.ts` (`strings.comparisons.*`).

### 5.2 Capa de datos
- `fetchComparisonEvents(deps)` → `vw_comparison_events` (vocabulario).
- CRUD: `createComparison`, `updateComparison`, `deleteComparison` (PostgREST).
- `fetchEventComparisons` (ya existe) ahora devuelve el esquema genérico completo: `comparison_key, name, priority, a_source, a_code, b_source, b_code` (los a/b se necesitan para etiquetar columnas y el detalle). La cabecera de la matriz muestra el `name`, con la etiqueta de código `A → B` (p.ej. "2320 → RESCON") como subtexto/tooltip.
- Detalle: `EventPairDetailRow` cambia `rfid_utc/edi_utc` → `a_utc/b_utc`; el diálogo etiqueta las columnas como **Evento A / Evento B** (con la etiqueta de código correspondiente de la comparación seleccionada).

### 5.3 Qué NO cambia
Matriz corredor×comparación; filtros (fecha, producto con nombre, país origen/destino); granularidad Centro/País; exclusión global de outliers; drill-down con gate/site + día de semana; clic en S9 → ATAT. La cabecera de columna pasa a mostrar el **nombre** de la comparación definida por el usuario.

## 6. Tests
- SQL: verificación de solo lectura (vocabulario no vacío; gaps por comparación con `n>0`; una comparación RFID↔RFID y una EDI↔EDI de prueba dan resultados; matriz país/centro).
- Vitest+RTL: CRUD de `ComparisonsPage` (crea/edita/borra llama al escritor correcto), selector de eventos agrupado, cabecera de matriz muestra `name`, detalle etiqueta A/B y usa `a_utc/b_utc`, construcción de params de las nuevas funciones de datos.

## 7. Migración de datos y compatibilidad
- Las exclusiones (`event_pair_exclusion`, keyed por `(s9code, comparison_key)`) **sobreviven** para las 4 seeds (mismas claves). Si el usuario borra una comparación, sus exclusiones quedan huérfanas (aceptable en v1; posible `on delete` en cascada futuro).
- La pantalla de la matriz sigue funcionando: las columnas ahora vienen de las comparaciones definidas (arranca con las 4 sembradas).

## 8. Fuera de alcance (v1)
- Ocurrencia primera/última y ventana configurables por comparación (innecesarias por el insight de "una lectura por evento"); reintroducibles si aparecen duplicados reales.
- Dirección obligatoria / filtro de colocación por comparación.
- Reordenar columnas por drag-and-drop (se usa `priority` numérica).
- Snapshots de cierre de mes (sigue siendo Incremento futuro, ver spec del Incremento 1 §7).
- Cascada de borrado de exclusiones al borrar una comparación.
