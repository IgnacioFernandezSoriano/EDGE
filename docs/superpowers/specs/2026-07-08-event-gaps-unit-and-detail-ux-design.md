# Event gaps: selector días/horas, detalle más ancho y S9 en pestaña nueva

Fecha: 2026-07-08
App: `leg2-reporting`
Rama base: `feat/leg2-auth-screens` (o rama nueva dedicada)

## Objetivo

Mejorar la experiencia de la pantalla **Event gaps** ("Days between events") con tres cambios, todos de frontend. No se toca la base de datos ni las RPC (`event_pair_matrix`, `fetchEventPairDetail`); el dato de origen sigue en días.

## Alcance (decisiones tomadas en brainstorming)

1. **Selector Días / Horas — global.** Un único toggle controla la unidad a la vez en la matriz y en el diálogo de detalle.
2. **Diálogo de detalle más ancho**, para ver las columnas en horizontal sin apretujarse.
3. **Detalle del S9 en pestaña nueva**, en ambos flujos (Event gaps **y** RFID Events/Report). Se elimina el diálogo `AtatDialog` anidado.
4. **Renombrado ATAT → "Receptacle Events"**: solo texto visible. Sin renombrar archivos/componentes/identificadores de código.

---

## 1. Selector Días / Horas (global)

### Modelo

- Nuevo tipo `GapUnit = "days" | "hours"` en `src/lib/eventGaps.ts`.
- El dato subyacente está en días (`mean_days` en la matriz, `gap_days` en el detalle). La conversión a horas es exacta y client-side: `valor * 24`.

### Helper de formato

Reemplazar `formatGapDays(v)` por `formatGap(v, unit)` en `src/lib/eventGaps.ts`:

```ts
export function formatGap(v: number | null | undefined, unit: GapUnit): string {
  if (v == null || Number.isNaN(v)) return "—";
  return (unit === "hours" ? v * 24 : v).toFixed(1);
}
```

Se actualizan las dos llamadas actuales:
- `EventGapsMatrix.tsx:50` → `formatGap(cell.mean_days, unit)`
- `EventGapsDetailDialog.tsx:81` → `formatGap(r.gap_days, unit)`

(Se retira `formatGapDays`; no tiene más usos.)

### Estado

- `unit` (`GapUnit`, default `"days"`) vive en el hook `useEventGaps`, junto a `granularity`/`product`, con su setter `setUnit`. Es solo presentación: **no** dispara recarga de datos.
- `EventGapsPage` lee `unit`/`setUnit` del hook y los pasa a `EventGapsFilters`, `EventGapsMatrix` y `EventGapsDetailDialog`.

### UI

- En `EventGapsFilters.tsx`, un toggle **Días | Horas** con el mismo patrón visual que el toggle de Granularidad (dos `Button` `size="sm"`, el activo `variant="default"`).
- Props nuevas: `unit: GapUnit`, `onUnitChange: (u: GapUnit) => void`.
- Cabecera de la columna Gap del detalle: "Gap (days)" cuando `unit==="days"`, "Gap (hours)" cuando `unit==="hours"`.

### i18n (`strings.gaps`)

- `unit: "Unit"`, `unitDays: "Days"`, `unitHours: "Hours"`.
- `colGapDays: "Gap (days)"`, `colGapHours: "Gap (hours)"` (sustituyen a `colGap`).

---

## 2. Diálogo de detalle más ancho

- En `EventGapsDetailDialog.tsx`, el `DialogContent` pasa de `sm:max-w-4xl` a `sm:max-w-[95vw]`, manteniendo `max-h-[75vh] overflow-auto`.
- Envolver la `Table` en un contenedor con `overflow-x-auto` para que, si el ancho no alcanza, haya scroll horizontal interno en vez de romper el layout (regla de artefactos: el body nunca hace scroll horizontal).
- Objetivo: las 8 columnas (S9, Product, Origin, Dest, Event A, Event B, Gap, Exclude) se ven holgadas en una sola fila.

---

## 3. Detalle del S9 en pestaña nueva (ambos flujos)

Ya existe la ruta `#/receptacle/{s9}` que renderiza la pantalla `AtatPage` completa (`hashRoute.ts:receptacleHash`, `App.tsx` route `receptacle`). "Pestaña nueva" = abrir esa URL en `_blank`.

### Helper

Nueva función en `src/lib/hashRoute.ts`:

```ts
export function receptacleUrl(s9: string): string {
  return `${window.location.pathname}${window.location.search}${receptacleHash(s9)}`;
}
```

(Construye la URL absoluta-relativa para que `window.open` navegue a la ruta correcta con el hash, sin depender del hash actual.)

### Cambios en páginas

- **`EventGapsPage`**: la prop `onSelectS9` del diálogo pasa a `(s9) => window.open(receptacleUrl(s9), "_blank", "noopener")`. Se elimina el estado `atatS9`, el `<AtatDialog>` y su import.
- **`RfidEventsPage`**: `onSelectS9` del pivot pasa a `(s9) => window.open(receptacleUrl(s9), "_blank", "noopener")`. Se elimina el estado `dialogS9`, el `<AtatDialog>` y su import. `RfidEventsPivot` conserva `selectedS9`/`onSelectS9`; `selectedS9` puede fijarse a `null` (ya no hay selección persistente) o retirarse si no aporta resaltado — decisión menor durante implementación, sin cambiar el contrato del pivot.

### Código muerto

- `AtatDialog` queda sin usos → se elimina `src/components/AtatDialog.tsx` y `src/components/AtatDialog.test.tsx`.

### Sesión en la pestaña nueva

La nueva pestaña carga la app desde cero; `AuthProvider` restaura la sesión de Supabase desde `localStorage`, así que la pantalla `Receptacle Events` se muestra autenticada sin re-login.

---

## 4. Renombrado ATAT → "Receptacle Events" (solo texto)

- `strings.atat.title`: `"Receptacle timeline"` → `"Receptacle Events"`.
- La pantalla `AtatPage` (destino de la pestaña nueva) añade un encabezado visible **"Receptacle Events"** (`strings.atat.title`), que hoy no tiene. Así el usuario que aterriza vía pestaña nueva ve el nombre correcto.
- El nav ya dice "Receptacle Events" (commit b6a47c8) — sin cambios.
- **No** se renombran identificadores de código (`AtatPage`, `AtatView`, `atat.ts`, `strings.atat`, etc.).

---

## Tests (TDD)

- `eventGaps.test.ts`: `formatGap` en days y hours (incl. `null`/`NaN` → "—"; `2.0` días → `"48.0"` horas).
- `EventGapsMatrix.test.tsx`: la celda muestra el valor convertido según `unit`.
- `EventGapsDetailDialog.test.tsx`: columna Gap con cabecera y valor según `unit`; `DialogContent` con clase de ancho ampliado.
- `EventGapsPage.test.tsx`: retirar el mock de `AtatDialog`; al pulsar un S9 se llama `window.open` con la URL `#/receptacle/{s9}` y `_blank` (mock de `window.open`). Toggle de unidad cambia lo mostrado en matriz y detalle.
- `RfidEventsPage` / `useRfidEventsReport.test.tsx`: clic en S9 → `window.open(...)` en vez de abrir diálogo.
- Eliminar `AtatDialog.test.tsx` junto con el componente.
- `hashRoute.test.ts`: `receptacleUrl` produce la URL esperada.

## No-objetivos

- Sin cambios en la BD, RPC ni edge functions.
- Sin conversión de unidad en el backend ni persistencia de la preferencia (el default vuelve a "Días" al recargar).
- Sin renombrado de identificadores de código.
- Sin tocar el comportamiento del editor de lectores ni de exclusiones.
