# Modelo de tiempo del ETL Leg2 — UTC canónico + local de presentación

- **Fecha:** 2026-07-03
- **Proyecto:** EDGE Leg2 (Supabase `ubgatxfwpmyaqyfrwias`, org `hwuajreqsmhxdojtlthg`)
- **Estado:** diseño aprobado (pendiente revisión del spec escrito)
- **Autor:** Iván + Claude

> ⚠️ **Regla anti-confusión:** toda escritura (migración, `execute_sql`, `apply_migration`, deploy de edge function) se confirma nombrando proyecto + ref (`ubgatxfwpmyaqyfrwias`) antes de ejecutar. Este spec NO autoriza escrituras; se ejecutan en la fase de implementación con confirmación explícita.

---

## 1. Problema

Los reports RFID de Leg2 necesitan mostrar tiempos **en UTC o en local** según el caso, y algunas métricas (duración entre dos eventos) deben calcularse **siempre en UTC** para no introducir horas artificiales por DST (verano/invierno) ni por diferencias de huso entre países.

Hoy el pipeline no cumple esto: `event_datetime_local` y `reader_timezone` están **congelados** en `rfid_report_movements` con valor `UTC` para las 7321 filas, porque el transform hace `coalesce(reader_timezone,'UTC')` y el maestro de sitios no trae zona.

## 2. Hallazgos verificados (en vivo, Leg2)

1. **La vista `vw_quicksight_rfid_report_movements` es un passthrough puro** de `rfid_report_movements`. No re-hace join a maestros; `reader_timezone` y `event_datetime_local` son columnas **almacenadas**, no cálculos vivos.
2. **`rfid_site_snapshot.timezone` es null en el 100% de los 480 sitios.** El origen GMS (`gms_iot.public.sites.timezone`) viene null en el `raw_payload` (sync fresco 2026-07-03). GMS no puebla zona y no hay ETA. La afirmación de la doc "es dinámico, se autocorrige" es **falsa**.
3. **`event_datetime_utc` es un instante absoluto CORRECTO.** El ingest (`edge-rfid-etl-orchestrator.normalizeRead`) toma el campo `timestamp` del payload EDGE, que viene en ISO-8601 **con offset real** (ej. `2026-07-03T19:50:40.907+09:00`), y Postgres lo almacena bien como UTC (`10:50:40.907+00`). Todo el ordenamiento del transform (`rfid_transform_run`) se basa en `event_datetime_utc` (`min(...)`, `order by ... event_datetime_utc`).
4. **El offset local exacto ya está en `raw_payload.timestamp`** y **varía con DST dentro del mismo país** (BA `+02:00`/`+01:00`, CH `+02:00`/`+01:00`, RO `+03:00`/`+02:00`, PL, ME). Es un dato por-lectura, DST-correcto, superior a cualquier mapa estático país→offset. El ETL actual lo descarta (copia UTC en el local y estampa `UTC`).
5. **Excepción:** Portugal manda `Z` (sin offset local) en 316 lecturas (y `+01:00` en 812). Para esas, el payload no permite recuperar el local → requiere fallback por zona IANA.

**Conclusión:** el problema es **100% de presentación del local**. No hay corrupción de UTC; las duraciones ya son correctas. No requiere reprocesar el ETL por motivo de tiempo.

## 3. Requisitos

- **R1 — Doble lectura:** los reports pueden mostrar cada tiempo en UTC o en local eligiendo columna.
- **R2 — Aritmética en UTC:** toda duración/delta entre eventos se calcula solo sobre `event_datetime_utc`. Inmune a DST y a husos.
- **R3 — Sin inconsistencias en reconstrucción ni en procesos futuros del ETL:** el mecanismo no debe depender de estado congelado que quede obsoleto.
- **R4 — Fuente de verdad de la zona = Leg2** (decisión del usuario). Tolerante a GMS: si algún día GMS puebla `timezone`, se prefiere GMS; si no, manda el mapa Leg2.

## 4. Modelo canónico

| Campo | Rol | Uso |
|---|---|---|
| `event_datetime_utc` (timestamptz) | Instante absoluto canónico | **Toda** aritmética: duraciones, deltas, orden, secuencia de países. Ya correcto. |
| `event_offset` (nuevo, text ISO ej. `+09:00` / `Z`) | Offset real de la lectura, del payload | Reconstruir el local exacto. Hecho histórico **inmutable** → se materializa sin riesgo. |
| `event_datetime_local` | Solo presentación | Hora "de pared" del país. **Nunca** para aritmética. Se calcula en la vista. |
| `reader_timezone` (IANA ej. `Asia/Tokyo`) | Etiqueta de zona + fallback | Nombre de zona para UI y para derivar local cuando el payload viene `Z`/naïve. Se calcula en la vista. |

## 5. Derivación del local (payload-first, mapa-fallback)

- **Regla A (mayoría):** `event_datetime_local = event_datetime_utc + event_offset` (offset del payload). Exacto, DST-correcto, sin depender de maestros.
- **Regla B (fallback, payload `Z`/naïve):** `event_datetime_local = event_datetime_utc AT TIME ZONE <IANA del mapa>`.
- **Mapa IANA (nuevo):** tabla Leg2 `rfid_timezone_map` con `country_code` (+ `city` opcional para países multi-zona) → zona IANA. Pocas filas. Dueña Leg2. Sirve para: (a) fallback de Regla B, (b) poblar `reader_timezone` como etiqueta.
  - Resolución de zona efectiva: `coalesce(site_snapshot.timezone, timezone_map.by(country,city), timezone_map.by(country))`. El primero respeta a GMS si algún día lo llena (R4).

## 6. Mecanismo: cálculo en la vista (self-healing)

- `event_offset` se **captura en el ingest** (`normalizeRead`) desde `raw_payload.timestamp` y se materializa en `rfid_edge_input_reads`; el transform lo arrastra a `rfid_report_movements`. Inmutable → materializarlo no reintroduce el problema de "congelado".
- `event_datetime_local` y `reader_timezone` **se calculan en `vw_quicksight_rfid_report_movements`** a partir de `event_datetime_utc` + `event_offset` + join al mapa IANA. **No se congelan.** Si se ajusta el mapa, QuickSight ve la corrección en el siguiente refresco **sin reprocesar** (R3).
- Las columnas derivadas de local (`movement_date_local`, `movement_hour_local`, `movement_month_local`) pasan a calcularse sobre el `event_datetime_local` ya corregido de la vista.

## 7. Cambios concretos

### 7.1 Esquema
- `rfid_edge_input_reads`: añadir `event_offset text`.
- `rfid_report_movements`: añadir `event_offset text`; `event_datetime_local` y `reader_timezone` dejan de ser el contrato de salida (se recalculan en la vista; se pueden conservar como columnas históricas o deprecar — decidir en el plan).
- Nueva tabla `rfid_timezone_map(country_code text not null, city text null, iana_zone text not null)` con unicidad por `(country_code, city)` tratando `city IS NULL` como fila "por defecto del país" (unique index sobre `country_code, coalesce(city,''))` o columna generada — decidir en el plan). Poblada con las zonas de los países presentes (JP, KR, CH, BA, BR, BT, CN, HK, IN, KH, KZ, ME, MY, NZ, PL, PT, RO, RS, SG, TH, TR, VN + los que salgan).

### 7.2 Ingest (`edge-rfid-etl-orchestrator/index.ts`)
- `normalizeRead`: extraer el offset del `timestamp` del payload (regex `[+-]\d{2}:?\d{2}$` o `Z`) → `event_offset`. `event_datetime_utc` sigue igual (Postgres ya convierte bien).

### 7.3 Transform (`rfid_transform_run`)
- Arrastrar `event_offset` a `rfid_report_movements`. Quitar el `coalesce(...,'UTC')` como fuente de verdad del local (el local ya no se materializa aquí).

### 7.4 Vista (`vw_quicksight_rfid_report_movements`)
- Recalcular `reader_timezone` (IANA vía mapa) y `event_datetime_local` (Regla A con `event_offset`, Regla B fallback), y los `*_local` derivados. Mantener **mismas 22 columnas y orden** que consume el CSV/QuickSight (contrato estable).

### 7.5 Export (`export-rfid-csv-to-s3`)
- Eliminar la re-derivación del offset en `time.ts` (la vista ya entrega `event_datetime_local` con offset). El export pasa a volcar la columna tal cual. Ajustar `time_test.ts`.

### 7.6 Backfill (una vez, sin llamar a EDGE)
- `UPDATE rfid_edge_input_reads SET event_offset = <regex sobre raw_payload->>'timestamp'>`.
- Propagar a `rfid_report_movements` (recomputar la columna arrastrada). La vista hace el resto en lectura.

## 8. Casos borde

- **Payload `Z` (PT):** Regla B con `Europe/Lisbon`. DST correcto vía `AT TIME ZONE`.
- **País multi-zona (BR, y a futuro US/RU/AU):** el mapa usa `city` cuando haga falta; Regla A (offset del payload) ya resuelve la mayoría sin mapa.
- **`reader_country_code` null / sin zona en el mapa:** `event_datetime_local` cae a UTC (offset `Z`) y `reader_timezone = 'UTC'` como último recurso; se registra para completar el mapa. No rompe el export.
- **`raw_payload` sin `timestamp` o sin offset y sin país:** local = UTC; auditar.

## 9. Fuera de alcance

- **Reprocess ETL desde 01/01/2026 (#2):** tema aparte, motivado por cambio de config de lectores (handover/leg2), NO por tiempo. El timezone queda **desacoplado**; no es prerequisito ni al revés.
- **Acceso GMS IOT / poblar `site_impc_code` y `sites.timezone`:** independiente; el diseño es tolerante a que GMS lo llene más tarde.
- **Rotación de la AWS key del export:** operativa, no de este diseño.

## 10. Testing

- Unit (Deno) para la extracción de offset en `normalizeRead` (casos `+09:00`, `+05:30`, `Z`, naïve).
- SQL de verificación post-backfill: para JP, `event_datetime_local` = UTC + 9h y `reader_timezone='Asia/Tokyo'`; para PT `Z`, local vía `Europe/Lisbon`; duraciones calculadas en UTC no cambian.
- Contrato del CSV: mismas 22 columnas, mismo orden, `event_datetime_local` con offset ISO.

## 11. Rollout

1. Migración esquema + tabla mapa (confirmar ref).
2. Deploy ingest con captura de offset.
3. Backfill offset desde `raw_payload`.
4. Reemplazar vista.
5. Deploy export simplificado.
6. Verificar CSV/QuickSight.
