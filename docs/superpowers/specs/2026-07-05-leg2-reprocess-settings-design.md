# Reprocess Control Panel (Settings screen) — Design Spec

**Date:** 2026-07-05
**Project:** EDGE Leg2 (`leg2-reporting/`), Supabase Leg2 `ubgatxfwpmyaqyfrwias`
**Status:** Design approved (brainstorming). Next: implementation plan (writing-plans).
**Branch:** `feat/leg2-reprocess-settings` (from `main` @ `bc03085`).

A **Settings** screen with a **Reprocess / Recalculate** control that lets an authenticated user
trigger an RFID reprocess at three scopes — a single **reader**, a whole **site**, or **global**
(all movements). This surfaces, self-service, what today is done only via the per-site edge
function ([[edge-leg2-rfid-events-report]] `rfid-reprocess-site`) or the runbook SQL. Primary
driver: reader/facility changes made directly in GMS (e.g. a Brazil centre) that need the report
+ CSV rebuilt without editing anything in the app.

Split out of the parked [[leg2-site-facility-editor]] design (whose §5 "Reprocess this site"
button will reuse the same edge function once that feature resumes).

---

## 1. Goal

One screen, one action: choose a **scope** and recalculate.

- **Reader** — reprocess only the (tag, s9) pairs read by one LPI.
- **Site** — reprocess only the pairs that touched one site (IMPC code).
- **Global** — reprocess all reads from the fixed data start (2026-01-01), rebuilding every
  movement. Heavy, full-history; guarded by a confirm.

All three run the same chain as `rfid-reprocess-site`: refresh masters from GMS → reprocess the
scoped pairs → re-export the QuickSight CSV to S3. No editing of master data here — this is a
recalc trigger only.

Access follows the current model (any authenticated user; RLS `authenticated`). Per-user scoping
is out of scope, consistent with [[leg2-site-facility-editor]].

## 2. Edge function `rfid-reprocess` (Leg2, verify_jwt)

New function generalizing `rfid-reprocess-site` over scope. `rfid-reprocess-site` stays untouched
(back-compat for anything already calling it).

- **Request:** `{ scope: "reader" | "site" | "global", lpi?: string, site_impc_code?: string }`.
- **Validation** (new `request.ts`, unit-tested):
  - `scope` must be one of the three literals → else 400.
  - `scope="reader"` requires non-empty trimmed `lpi`; `scope="site"` requires non-empty trimmed
    `site_impc_code`; `scope="global"` takes neither. Missing/blank required value → 400.
- **Filter built for `rfid_reprocess_scope`** (`DATA_START = "2026-01-01T00:00:00Z"`):
  - reader → `{ from: DATA_START, readers: [lpi] }`
  - site → `{ from: DATA_START, sites: [site_impc_code] }`
  - global → `{ from: DATA_START }`
- **Actions (service role):** POST `sync-site-snapshot` `{}` → `db.rpc("rfid_reprocess_scope",
  { p_filters, p_environment:"production", p_max_reads:100000, p_reason:"settings_reprocess_<scope>" })`
  → POST `export-rfid-csv-to-s3` `{}` (awaited, failure swallowed — reprocess already committed).
- **Response:** `{ ok, status, movements_upserted, reprocess_run_id, error? }` — the shape the
  existing client helpers already expect. Sync/RPC failures return the upstream status
  (`sync_failed` / `reprocess_failed`) mirroring `rfid-reprocess-site`.
- `config.toml`: `[functions.rfid-reprocess] verify_jwt = true`.

## 3. DB — `vw_sites` (Leg2 read)

Small curated view backing the **site** dropdown (a complete list, incl. sites with no movements):

```sql
create or replace view public.vw_sites as
select site_impc_code, site_name, country_name
from public.rfid_site_snapshot
where site_impc_code is not null
order by site_impc_code;
grant select on public.vw_sites to authenticated;
```

The **reader** dropdown reuses the existing `vw_reader_master` (already `grant`ed to
`authenticated`) — LPI + facility_name for the label.

## 4. Client

- **`reprocess.ts`** (new): `ReprocessScope = "reader" | "site" | "global"`; `ReprocessResult`
  (`ok, status, movements_upserted, reprocess_run_id?, error?`); `triggerReprocess(scope, value,
  deps)` POSTing to `/functions/v1/rfid-reprocess` with the scope-appropriate body (mirrors
  `readerEdit.ts`: deps-injectable fetch, session token, anon fallback).
- **`supabase.ts`:** `SiteOption` type + `fetchSites(deps)` (from `vw_sites`). Reader options come
  from the existing `fetchReaderMaster`.
- All copy in `strings.settings.*`.

## 5. UI

- **`SettingsPage`** at `#/settings`, reachable from a new header nav item **"Settings"** (third
  item, alongside RFID Events and Receptacle (ATAT)).
- A **Reprocess** card:
  - Scope selector (segmented / radio): **Reader · Site · Global**.
  - Reader → searchable `Select` of LPIs (from `fetchReaderMaster`, label `lpi — facility_name`).
  - Site → searchable `Select` of sites (from `fetchSites`, label `site_impc_code — site_name`).
  - Global → no picker; a warning line that it rebuilds **all** movements.
  - **Recalcular** button, disabled until the scope's required value is chosen (Global always
    enabled). Clicking opens a **confirm dialog** (states scope + target + that it rewrites
    production movements and re-exports the CSV). Confirm → `triggerReprocess`.
  - While running: spinner / disabled. On done: inline success (`movements_upserted`, run id) or
    error string. Same visual pattern as the reader editor's apply feedback.
- **Routing:** `hashRoute.ts` gains `{ name: "settings" }` (`#/settings`); `App.tsx` nav + route.

## 6. Error handling & edge cases

- Invalid/missing scope value → the button stays disabled (client) and the function 400s (server).
- `sync` / `reprocess` upstream failure → surfaced with the returned `status` + `error`.
- Reprocess is transactional inside `rfid_reprocess_scope` (rolls back on failure, `status=failed`).
- CSV export failure does not fail the action (reprocess already committed) — mirrors existing
  functions; not separately surfaced beyond the success status.
- Global confirm requires an explicit second click (dialog) — no accidental full rebuilds.

## 7. Testing

- **Edge function (Deno):** `request.ts` parser — accepts each valid scope with/without its value,
  rejects unknown scope, rejects reader/site missing their value, accepts global with no value.
- **Client (Vitest/TDD):** `triggerReprocess` posts the right body per scope; `fetchSites` hits
  `vw_sites`; `hashRoute` parses `#/settings`; `SettingsPage` — scope switch shows the right
  picker, button disabled until a value is picked (except global), confirm dialog gates the call,
  success + error render; `App` routes to Settings and shows the nav item.

## 8. Out of scope (YAGNI)

- No date-range / partial-window reprocess — always from the fixed data start (matches the edge
  functions and runbook).
- No multi-select (several readers/sites at once) — one target per run.
- No RBAC / per-user scoping (deferred, same as [[leg2-site-facility-editor]]).
- No scheduling / history log of past reprocess runs (the run id is returned; run rows already
  live in the ETL tables).
- `rfid-reprocess-site` is left in place, not migrated to the new function in this build.
