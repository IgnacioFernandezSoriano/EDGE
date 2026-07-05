# Leg2 — Editor in-app del maestro de lectores (Operation) con write-through a GMS

**Fecha:** 2026-07-05
**Proyecto Leg2:** `ubgatxfwpmyaqyfrwias` · **Fuente maestra:** GMS IOT `tsvlgznfvgoqbncunumu`
**App:** `leg2-reporting/` · Continúa la feature [[leg2-edi-gap-detection]].

## Contexto y problema

Hoy, al detectar una incidencia "No RFID event code" (movimiento con lectura pero sin
`edi_equivalent`), el `CorrectionDialog` **deep-linka a la ventana completa de GMS IOT**
(`monitoring.edgeavs.net/catalog/{LPI}`), que expone TODA la información y todos los accesos
del lector. Queremos, en su lugar, **una pantalla propia y acotada** dentro de la app que
muestre solo los datos maestros que interesan y permita **editar la configuración de
Operation** del lector, escribiendo el cambio de vuelta a GMS (fuente de la verdad).

## Decisiones cerradas (brainstorming 2026-07-05)

- **Destino de escritura: write-through a GMS IOT.** GMS sigue siendo la única verdad; la
  escritura va por un backend (Edge Function en Leg2) que guarda la **service_role key de GMS**
  como **secreto** — nunca en el navegador. El snapshot de Leg2 se sigue refrescando con el sync
  (no hay override local).
- **Campos editables: solo los de Operation.** Identification se muestra **solo lectura**.
- **El editor sustituye al deep-link**: la corrección pasa a ser **100% in-app**. Se elimina el
  `CorrectionDialog` y el deep-link a GMS. Sin enlace "View in GMS" por defecto.
- **Disparador:** pulsar el **código del lector (LPI)** en las celdas "No RFID event code".
- **Guardado: un botón "Save & apply"** que encadena todo (write → sync → reproceso → export).
- **Reproceso por lector (LPI)**, no por site — robusto aunque `site_impc_code` sea nulo; reusa el
  filtro `readers` de `rfid_reprocess_scope` (sin cambios SQL en esa función).
- **Formato: modal** (coherente con `EventDetailsDialog`/el patrón actual).

## Campos curados

**Identification (solo lectura):** `lpi`, `gate_name`, `facility_name`, `facility_type`,
`site_id`, `country_code`, `country_name`, `city`, `facility_latitude`, `facility_longitude`,
`operator`, `priority`, `inactive`.

**Operation (editables):** `gate_purpose` (texto), `edi_equivalent_inbound` (Inbound Code, select
de catálogo EDI), `edi_equivalent_outbound` (Outbound Code, select de catálogo EDI),
`handover_point` (switch booleano), `reading_direction` (select), `operations_scope` (select).

**Excluidos siempre:** `product`, `nms_reader_url`, y la pestaña Maintenance
(`maintenance_payer_operator_id`, `maintenance_agreement`, `last_maintenance_invoice`,
`next_invoice`, `invoice_period_months`).

## Componentes

### 1. Vista de lectura curada — `vw_reader_master` (Leg2, extender)

Ampliar la vista existente para exponer el conjunto curado completo (Identification + Operation),
tomando de `rfid_reader_master_snapshot.raw_payload` los campos que hoy no expone: `facility_type`,
`country_name`, `city`, `facility_latitude`, `facility_longitude`, `operator`, `priority`,
`inactive`, `operations_scope` (ya expone `gate_name`, `gate_purpose`, `reading_direction`,
`facility_name`, `site_id`, `handover_point`, `edi_equivalent_inbound/outbound`, `reader_country_code`).
**No** exponer `product` ni `nms_reader_url`. GRANT SELECT a `authenticated` (ya concedido).

El frontend amplía el tipo `ReaderMaster` y las columnas del `select` de `fetchReaderMaster`.

### 2. Modal `ReaderEditorDialog` (frontend)

- Se abre al pulsar el **LPI** (código del lector) en una celda "No RFID event code" (el LPI pasa a
  ser un elemento clicable). Recibe el `lpi` y busca el registro en el `readerMap`.
- **Identification**: bloque de solo lectura (etiqueta → valor).
- **Operation**: formulario editable con estado local inicializado desde el `readerMap`:
  - `edi_equivalent_inbound` / `edi_equivalent_outbound`: `<Select>` poblado desde un **catálogo de
    códigos EDI** (constante; reusa/extiende `CHECKPOINT_LABELS`), incluyendo una opción vacía y
    garantizando que el valor actual siempre aparezca aunque no esté en el catálogo base.
  - `handover_point`: `<Switch>`.
  - `gate_purpose`: `<Input>`. `reading_direction`, `operations_scope`: `<Select>` con opciones
    conocidas (+ el valor actual).
- Botón **"Save & apply"**: envía solo los 6 campos de Operation al endpoint (abajo), con feedback de
  progreso (write → sync → reprocess → export). Al terminar OK: **recarga el informe** (`reload`) y
  re-fetch del reader master; muestra "Applied — the movement will appear under its checkpoint".
- Textos en **inglés** desde `strings.ts`. **No** muestra `product` ni `nms_reader_url`.

Todo esto **sustituye** a `CorrectionDialog.tsx` (+ su test), `reprocess.ts` (+ test) y
`gms.ts` (+ test), que se **eliminan** (quedaban del deep-link/site-reprocess).

### 3. Edge Function `apply-reader-edit` (Leg2)

`POST /functions/v1/apply-reader-edit`, **`verify_jwt=true`** (solo usuarios autenticados de Leg2).

**Request:** `{ "lpi": string, "operation": { gate_purpose?, edi_equivalent_inbound?,
edi_equivalent_outbound?, handover_point?, reading_direction?, operations_scope? } }`.

**Parser puro (whitelist):** rechaza `lpi` vacío y **cualquier clave de `operation` fuera de las 6
permitidas** (defensa: el service_role de GMS es todopoderoso; el mínimo privilegio lo impone la
función). Devuelve el objeto saneado o un error.

**Flujo (una acción):**
1. **PATCH** a GMS `readers_master?lpi=eq.{lpi}` con los campos saneados (+ `updated_at=now()`),
   usando el secreto `GMS_SERVICE_ROLE_KEY` (Authorization/apikey). Si falla → `{ok:false,
   status:"gms_write_failed", error}`.
2. `sync-site-snapshot` (trae el cambio de GMS al snapshot de Leg2).
3. `rfid_reprocess_scope({ from:"2026-01-01T00:00:00Z", readers:[lpi] })` (reproceso por lector).
4. `export-rfid-csv-to-s3` (no bloqueante).
5. **Respuesta:** `{ ok, status, movements_upserted, reprocess_run_id?, error? }`
   (reenviando `error_message` del RPC si `status<>'success'`).

**Secretos de la función:** `GMS_URL` (= `GMS_SITES_URL`), `GMS_SERVICE_ROLE_KEY` (nuevo),
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto).

**Cliente frontend:** nuevo `src/lib/readerEdit.ts` → `applyReaderEdit(lpi, operation, deps)`, mismo
patrón inyectable que `reprocess.ts` (fetchFn/token/anonKey/baseUrl para test).

### 4. Seguridad

- La **service_role key de GMS vive solo** en el secreto de la Edge Function. Nunca en el bundle ni
  en el navegador.
- **Whitelist** estricta de columnas en la función (las 6 de Operation). Nada más se escribe.
- `verify_jwt=true`; se declara en `config.toml` (`[functions.apply-reader-edit]`).

## Testing

- **Unit (Deno):** parser whitelist — acepta las 6 claves, rechaza `lpi` vacío y claves no permitidas;
  builder del PATCH (URL `?lpi=eq.{lpi}`, body solo campos saneados).
- **Unit (Vitest):** `applyReaderEdit` (POST correcto, token, parseo de respuesta ok/err);
  `ReaderEditorDialog` (Identification read-only; Operation editable; **no** aparece `product`/`nms`;
  "Save & apply" llama a `applyReaderEdit`; muestra progreso/resultado).
- **Verificación live (Leg2 `ubgatxfwpmyaqyfrwias` + GMS `tsvlgznfvgoqbncunumu`):** editar el
  Outbound Code de un lector con incidencia → Save & apply → el movimiento sale de "No RFID event
  code" a su columna de checkpoint y el CSV re-exportado lo refleja.

## Restricciones / notas

- **Regla de escritura Supabase:** antes de aplicar DDL de `vw_reader_master`, desplegar
  `apply-reader-edit`, o registrar el secreto GMS, **nombrar proyecto+ref y confirmar**. Aplica tanto a
  Leg2 como a **GMS IOT** (`tsvlgznfvgoqbncunumu`) para la primera prueba de escritura.
- **Idioma UI:** inglés desde `strings.ts`.
- Reusa `rfid_reprocess_scope` (filtro `readers`) — **sin cambios** en las funciones SQL de ETL.

## Deudas / follow-ups (no bloquean)

- **Catálogo EDI de los selects** (Inbound/Outbound Code): se parte de `CHECKPOINT_LABELS` + el valor
  actual; conviene confirmar/completar la lista exacta contra la de GMS (la ventana de GMS tiene su
  propio catálogo con etiquetas como "2320 — Exit from outbound AMU facility").
- `rfid-reprocess-site` (edge fn site-based) queda **desplegada pero sin uso** desde la app tras
  quitar `CorrectionDialog`; retirar en una limpieza futura o dejar como utilidad.
- El editor se abre solo desde las celdas de incidencia; extender el "click en LPI → editor" a todas
  las celdas del pivot es posible más adelante.
