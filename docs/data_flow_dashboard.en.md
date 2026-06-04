# EDGE Dashboard — Data Flow

**Project:** EDGE RFID-EDI Dashboard
**Public URL:** https://edgedashboard.netlify.app/
**Supabase project:** `ewyhmmixqcubqokphebh`
**Last updated:** 2026-05-06

> This document traces, end to end, **where every value on screen comes from** and **what is done with it** at each step. It starts at the sources (CSV / API / staging), goes through the ETL that enriches and classifies events, and ends at the specific frontend component that displays the data. For every intermediate step, the file or table where the logic lives is referenced so the path is auditable.

---

## 0. Big picture

```
                      ┌────────────────────────────────────────┐
                      │  ORIGIN SOURCES                         │
                      │  - CSV (admin upload)                   │
                      │  - API (push ingest)                    │
                      │  - "RFID" table in backfill mode        │
                      └────────────────┬───────────────────────┘
                                       │
                                       ▼
                              staging_rfid_events
                                       │
                       ┌───────────────┴───────────────┐
                       │  ETL v3 (Edge Function)        │
                       │  process-rfid-etl/index.ts     │
                       │   1. Extraction                │
                       │   2. Transformation (blocks)   │
                       │   3. Logging                   │
                       │   4. Load (upsert RFID)        │
                       │   5. Sync                      │
                       │   6. Cleanup                   │
                       └────┬────────────────────┬──────┘
                            │                    │
                            ▼                    ▼
                  log_rfid_inconsistencies   "RFID" enriched
                  (issues + admin decision)  (event_type, country,
                                              center_name, status,
                                              is_international_boundary)
                                       │
                       ┌───────────────┴────────────────────┐
                       │                                    │
                       ▼                                    ▼
              tracking_events                       benchmark_rfid_edi
              (RFID ⨝ EDI by s9id,                  (materialized view,
               coverage, lags, transit)              daily pg_cron refresh)
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
        │  Hooks → Components → Tabs in Home.tsx             │
        └────────────────────────────────────────────────────┘
```

---

## 1. Origin sources

| Source | Description | Producer |
|---|---|---|
| **CSV** | Manual upload by an admin from `AdminAuditPage` / ETL UI | Human operator |
| **API push** | External system writes directly into `staging_rfid_events` | External integration (RFID readers in airports / postal centres) |
| **Backfill** | Re-processes existing rows in `RFID` where `event_type IS NULL` | Manual job / admin |
| **EDI data** | `datos EDI` table (PREDES, CARDIT, RESDIT74, RESDIT21, RESDES headers) | Independent load — outside the RFID ETL |
| **ID Relation** | `tagid ↔ s9id` mapping | Independent load, prerequisite for benchmark |
| **rfid_readers_master** | Master of the 18 physical readers (read_point_id → IMPC, country, centre, td_reader) | Manual maintenance ([sql/01_create_rfid_readers_master.sql](../sql/01_create_rfid_readers_master.sql)) |

### `s9id` structure (the key to all classification)

```
ESMADB JPKWSA ZZZZZZZ
└──┬─┘ └──┬─┘
   │       └─ positions 6-11 → destination IMPC
   └────────  positions 0-5  → origin IMPC
```

Used both by the ETL (classification) and by `run-audit-benchmark` (cross-check).

---

## 2. Intermediate schema

### 2.1 `staging_rfid_events` — landing zone

Defined in [sql/02_create_staging_rfid_events.sql](../sql/02_create_staging_rfid_events.sql). **Temporary** table: emptied at the end of every successful ETL cycle (Phase 6).

Key fields: `document_id`, `event_time_local`, `event_time_offset`, `record_time`, `location`, `read_point_id`, `tag_id`, `impc_code`, `s9id`, `source` (`API`/`CSV`/`BACKFILL`).

### 2.2 `RFID` — main enriched table

After Phase 4 of the ETL the table holds these added columns (see [sql/04_alter_rfid_add_event_type.sql](../sql/04_alter_rfid_add_event_type.sql) and [sql/05_drop_redundant_rfid_columns.sql](../sql/05_drop_redundant_rfid_columns.sql)):

- `event_type` — final event classification
- `impc_code` — corrected from `rfid_readers_master`
- `country` — derived from the master
- `center_name` — derived from the master
- `status` — `COMPLETE` (readings in >1 country) or `PENDING`
- `is_international_boundary` — true if the reading is a `DEPARTURE` or `ARRIVAL`
- `etl_version`, `etl_processed_at`

Volume: ~169,000 rows (index `rfid_event_time_local_idx` in [supabase/indexes.sql](../supabase/indexes.sql)).

### 2.3 `tracking_events` — flat RFID + EDI view

One row per `s9id`. Holds 50+ pre-computed columns:
- Coverage (`has_rfid`, `has_predes`, `has_resdes`, `coverage_type`)
- RFID: `rfid_origin_*`, `rfid_dest_*`, `rfid_intermediate_centres`, `rfid_total_readings`
- EDI: `predes_*`, `redes_*`
- Times: `departure_lag_hours`, `arrival_lead_hours`, `rfid_transit_hours`, `edi_transit_hours`, `transit_diff_hours`
- Validation: `origin_match`, `dest_match`, `full_route_validated`

This is the **flat source for the dashboard** (`useTrackingData`). Built and maintained outside this repo (no DDL versioned here).

### 2.4 `benchmark_rfid_edi` — materialized view

Defined in [sql/rebuild_benchmark_view.sql](../sql/rebuild_benchmark_view.sql). FULL OUTER JOIN between RFID aggregated by `tag_id` and `datos EDI` ⨝ `ID Relation`. Refreshed daily at 02:00 UTC via `pg_cron` (`refresh_benchmark_view` RPC in [sql/refresh_benchmark_view.sql](../sql/refresh_benchmark_view.sql)).

> **Note**: the React client **does not consume this view directly**. `AdminAuditPage` does trigger it via `supabase.rpc('refresh_benchmark_view')`. The on-screen benchmark is reconstructed by `useBenchmarkData` in the client, joining `useEpcisData` + paginated reads of `ID Relation` + `datos EDI`.

### 2.5 Audit tables

- `log_rfid_inconsistencies` — ETL issues: `READER_NOT_IN_MASTER`, `MISSING_FIELD`, `S9ID_INVALID`, `DUPLICATE_EVENT`, `S9ID_IMPC_MISMATCH`. See [sql/03_create_log_rfid_inconsistencies.sql](../sql/03_create_log_rfid_inconsistencies.sql).
- `audit_data_load_log` — benchmark audit issues: `IMPC_MISMATCH_RFID`, `CASE_NORMALIZATION`, `MAESTRO_AUSENTE`, `OUTLIER_TEMPORAL`. Generated by the `run-audit-benchmark` Edge Function.
- `master_pending_review` — proposed master changes (ALTA/CORRECCION/NORMALIZACION_CASE/INACTIVO).
- `access_requests` — sign-up requests (login / UserMenu admin panel).

---

## 3. ETL — `process-rfid-etl` (Edge Function v3)

Main implementation: [supabase/functions/process-rfid-etl/index.ts](../supabase/functions/process-rfid-etl/index.ts). A Python equivalent exists at [scripts/process_rfid_etl.py](../scripts/process_rfid_etl.py) with simpler classification (only `ORIGIN`/`DESTINATION`/`INTERMEDIATE`); the frontend depends on the v3 enrichment.

Three modes: `incremental` (reads `staging_rfid_events`), `csv` (accepts a multipart file), `backfill` (re-reads the entire `RFID` table).

### Phase 1 — Extraction

- `csv` mode: parses the file with auto-detected `;` or `,` separator and quote handling; builds rows with `document_id`, `event_time_local`, `record_time`, `location`, `read_point_id`, `tag_id`, `impc_code`, `s9id`.
- `incremental` mode: reads `staging_rfid_events` paginated 10,000 at a time.
- `backfill` mode: reads the entire `RFID` table.

### Phase 2 — Transformation (the v3 core logic)

1. **Reader enrichment**: for each reading, look up `read_point_id` in `rfid_readers_master`. If missing, drop the reading and emit a `READER_NOT_IN_MASTER` issue. Otherwise replace `impc_code`, `country`, `center_name`, and capture the `td_reader` flag (true = AMU/border reader, false = internal OE reader).

2. **Sort**: by `tag_id`, ordering by `record_time` (capture timestamp).

3. **Centre blocks**: group consecutive readings with the same `impc_code` into a single block.

4. **`event_type` per block**:
   - First reading of the block → `ARRIVAL_AT_CENTRE`
   - Last reading of the block → `DEPARTURE_FROM_CENTRE`
   - Inner readings → `INTERMEDIATE`

5. **Full-journey events (override block-level types when they apply)**:
   - First reading of the journey → `ORIGIN`
   - Last reading of the journey → `DESTINATION`

6. **Country-change detection (international border)**:
   - For each pair of consecutive blocks with different countries: the last reading of the origin block becomes `DEPARTURE` and the first reading of the destination block becomes `ARRIVAL`. Both are flagged with `is_international_boundary = true`.
   - If those readings sit on a reader with `td_reader = true`, the log labels them as `AMU_OUTBOUND`/`AMU_INBOUND` for traceability.

7. **Type priority** (when a single reading collects several):
   ```
   DEPARTURE | ARRIVAL              = 5  (highest)
   ORIGIN    | DESTINATION          = 4
   DEPARTURE_FROM_CENTRE | ARRIVAL_AT_CENTRE = 3
   INTERMEDIATE                     = 1
   ```

8. **Tag status**: `COMPLETE` if readings span ≥2 countries, `PENDING` otherwise.

### Phase 3 — Logging

`log_rfid_inconsistencies` is written with an `etl_run_id` (UUID generated per run) so issues can be grouped by execution.

### Phase 4 — Load

`upsert` by `document_id` in batches of 500. Original IDs are preserved; only the enriched fields are added.

### Phase 5 — Sync

Compares `rfid_readers_master.impc_code` with `postal_centers.impc_code` and inserts the missing IMPCs. **Never deletes or modifies** existing centres (to avoid breaking the Benchmark process).

### Phase 6 — Cleanup

Empties `staging_rfid_events` with a bulk `DELETE`. **If the ETL fails** at any earlier phase, the staging table is preserved for diagnosis.

---

## 4. Audit — `run-audit-benchmark` (Edge Function)

Implementation: [supabase/functions/run-audit-benchmark/index.ts](../supabase/functions/run-audit-benchmark/index.ts). Independent from the RFID ETL. Triggered from `AdminAuditPage`.

It reads `tracking_events` (paginated 1,000) and `postal_centers`, and runs three checks:

| Check | Description | Severity | Resolution |
|---|---|---|---|
| `IMPC_MISMATCH_RFID` | RFID IMPC (origin/destination) does not match the first 6 chars of the `s9id`. Source of truth = `s9id` | HIGH | SEND_TO_LOG |
| `CASE_NORMALIZATION` | The IMPC is lowercase in some field (`rfid_origin_impc`, `rfid_dest_impc`, `predes_origin_impc`, `redes_dest_impc`) | LOW | AUTO_CORRECTED |
| `MAESTRO_AUSENTE` | An IMPC present in `tracking_events` is missing from `postal_centers` | MEDIUM | PENDING_REVIEW |

Findings are inserted into `audit_data_load_log` (batches of 500). The admin marks them `KEEP` or `DELETE`; entries marked `DELETE` are filtered out by the frontend (`fetchAuditExcludedS9ids`) so they don't pollute KPIs.

---

## 5. Frontend — from hook to component

Supabase client: [client/src/lib/supabase.ts](../client/src/lib/supabase.ts).

### 5.1 Hooks (fetch + transformation layer)

| Hook | Source table/RPC | Main transformation | Output |
|---|---|---|---|
| **`useTrackingData`** | `tracking_events` (full paginated read) | Group by origin/destination country, by `coverage_type`, by route. Percentiles 25/75, mean and median of `departure_lag_hours`, `arrival_lead_hours`, `rfid_transit_hours`, `edi_transit_hours`. CDFs by centre. | `DashboardStats` (~50 fields) + `TrackingEvent[]` |
| **`useEpcisData`** | `RFID` (filter `event_type IN (ORIGIN, DESTINATION, DEPARTURE, ARRIVAL, DEPARTURE_FROM_CENTRE, ARRIVAL_AT_CENTRE)`, monthly chunked pagination) + `rfid_readers_master` + (`ID Relation` ⨝ `datos EDI`) | Builds `RfidJourney[]` by grouping readings per `s9id`/`tag_id`. Identifies ORIGIN→DESTINATION and DEPARTURE→ARRIVAL pairs. Computes `transit_hours`. Tags blocks as OE vs AMU using `td_reader`. | `EpcisStats` + `RfidJourney[]` |
| **`useBenchmarkData`** | `useEpcisData.journeys` + module-level caches of `ID Relation` and `datos EDI` (paginated 1,000) | For each journey, looks up the `s9id` and pulls EDI fields: `predes_time`, `cardit_time`, `resdit74_time`, `resdit21_time`, `redes_time`. Computes RFID-vs-EDI deltas in hours. Groups by route and by centre. | `BenchmarkStats` + `RouteStats[]` + `CentreStats[]` |
| **`useAuditData`** (`useAuditLog`) | `audit_data_load_log` | Filters by severity/category/resolution; counts; updates `admin_decision` and notes. | `AuditLogEntry[]` + summary |
| **`useAuditData`** (`useMasterPending`) | `master_pending_review` | Approval workflow (PENDIENTE → APROBADO/RECHAZADO/APLICADO). | `MasterPendingEntry[]` |

#### KPIs via RPC (server-side shortcut)

`fetchRfidEventCounts` calls `rpc/rfid_kpi_counts` ([sql/fix_rfid_kpi_counts.sql](../sql/fix_rfid_kpi_counts.sql)) with `p_date_from`, `p_date_to`, `p_origin_country`, `p_dest_country`. It returns the six main KPIs aggregated in SQL to dodge PostgREST's 1,000-row cap and the ~3s `statement_timeout` on the anon role.

| KPI | Formula |
|---|---|
| `total_tags` | `COUNT(DISTINCT tag_id)` within the filtered range |
| `rfid_departures` | tags with event_type ∈ {`ORIGIN`,`DEPARTURE`} |
| `rf_predes` | tags with event_type = `DEPARTURE` |
| `rf_resdes` | tags with event_type = `ARRIVAL` |
| `rfid_arrivals` | tags with event_type ∈ {`DESTINATION`,`ARRIVAL`} |
| `rf_e2e` | tags that have both sides (departure ∧ arrival) |

### 5.2 Tabs and panels in [Home.tsx](../client/src/pages/Home.tsx)

#### RFID tab
- **Hook**: `useEpcisData`
- **Underlying source**: enriched `RFID` table (output of v3 ETL)
- **Components**:
  - `KpiCard × N` with KPIs precomputed by the `rfid_kpi_counts` RPC
  - `EpcisDataTable` (paginated journey table with CSV export)
  - `Map` (origin→destination flows, fed with `RfidJourney[]`)
  - `SearchID` (search by tag_id/s9id; shows `ORIGIN`/`DEPARTURE`/`ARRIVAL`/`DESTINATION` milestones)
  - Charts of routes, centres by origin/destination, transit-time CDFs

#### Tracking tab
- **Hook**: `useTrackingData`
- **Underlying source**: `tracking_events` (already a server-side precomputed RFID + EDI join)
- **Components**:
  - `DataTable` (raw rows filtered by `coverage_type`)
  - `AnalysisPanel × {Overview, Departure, Arrival, Transit}` — narrative blocks with derived KPIs (mean lag, p25/p75, % full_route_validated)
  - Country and centre distributions

#### EDI+RFID (Benchmark) tab
- **Hook**: `useBenchmarkData` (which internally consumes `useEpcisData`)
- **Underlying source**: `RFID` ⨝ `rfid_readers_master` ⨝ `ID Relation` ⨝ `datos EDI` (assembled on the client)
- **Components**:
  - `BenchmarkPanel` with RFID-vs-EDI KPIs (PREDES delta, RESDES delta, transit)
  - `BenchmarkDrillModal` with route/centre detail
  - Routes and centres tables
  - Comparative transit CDFs

### 5.3 Other pages

| Page | Data source | What it shows |
|---|---|---|
| **`RouteDetailPage`** ([client/src/pages/RouteDetailPage.tsx](../client/src/pages/RouteDetailPage.tsx)) | `localStorage` (payload precomputed in Home) | Sticky route KPIs, transit-hours histogram, CDF, Tukey fence, outlier table with checkboxes that recalc live |
| **`TagTrackPage`** ([client/src/pages/TagTrackPage.tsx](../client/src/pages/TagTrackPage.tsx)) | Direct `fetch` to `${SUPABASE_URL}/rest/v1/RFID?tag_id=eq.X` | Milestones `OE_ORIGIN` → `AMU_OUTBOUND` → `AMU_INBOUND` → `OE_DEST` with timestamps |
| **`AdminAuditPage`** ([client/src/pages/AdminAuditPage.tsx](../client/src/pages/AdminAuditPage.tsx)) | `useAuditLog` + `useMasterPending` + RPC `refresh_benchmark_view` | Last audit run dashboard; issue table with bulk `KEEP/DELETE`; master proposal table with approval workflow; button to refresh the materialized view |
| **`LoginPage`** | INSERT into `access_requests` | Sign-up request form |

### 5.4 Supabase calls outside `lib/supabase.ts`

| File | Table/RPC | Operation |
|---|---|---|
| `Home.tsx` | `access_requests`, RPC `admin_list_users` | Admin Panel: approve/reject access |
| `Home.tsx` | `auth.admin.createUser` | Create user |
| `LoginPage.tsx` | `access_requests` | INSERT request |
| `AdminAuditPage.tsx` | RPC `refresh_benchmark_view` | Refresh materialized view |
| `useBenchmarkData.ts` | `ID Relation`, `datos EDI` | Paginated SELECT (module cache) |
| `useAuditData.ts` | `audit_data_load_log`, `master_pending_review` | SELECT + bulk UPDATE |
| `TagTrackPage.tsx` | `RFID` | Direct SELECT by tag_id |

---

## 6. Traceability: KPI → query → table → ETL → origin

End-to-end paths for the most visible KPIs:

### KPI: "Tags with full end-to-end transit"

```
Component:        KpiCard "End-to-End" in the RFID tab
Hook:             fetchRfidEventCounts() → useEpcisData / Home
RPC:              rfid_kpi_counts(p_date_from, p_date_to, ...)
Implementation:   sql/fix_rfid_kpi_counts.sql
Source table:     RFID (event_type ∈ {ORIGIN, DEPARTURE} ∩ {DESTINATION, ARRIVAL})
Populated by ETL: process-rfid-etl/index.ts Phase 2 (block classification + country change)
Raw data:         staging_rfid_events ← CSV / API push / backfill
Master:           rfid_readers_master (read_point_id → IMPC, country, td_reader)
```

### KPI: "Mean departure lag (RFID DEPARTURE − EDI PREDES)"

```
Component:    AnalysisPanel "Departure" in the Tracking tab
Hook:         useTrackingData → DashboardStats.avgDepartureLag
Source table: tracking_events (column departure_lag_hours)
Built by:     Server-side precomputation outside this repo
Inputs:       RFID (DEPARTURE event_time) + datos EDI (predes_time)
              joined via ID Relation (tagid → s9id → ean)
```

### KPI: "Coverage = FULL"

```
Component:    DataTable + KpiCard in the Tracking tab
Source table: tracking_events.coverage_type
Categories:   FULL, EDI_FULL, RFID_ONLY, EDI_ONLY, RFID_PREDES, RFID_RESDES
Inputs:       has_rfid + has_predes + has_resdes (derived booleans)
```

### KPI: "Transit outliers per route"

```
Component:    Outliers table in RouteDetailPage
Hook:         (data passed via localStorage from Home/useEpcisData)
Calculation:  Tukey fence on rfid_transit_hours of the RfidJourney array
Source table: RFID (DEPARTURE+ARRIVAL events, used to compute transit)
```

### Audit issue: "Origin IMPC does not match s9id"

```
Component:    AdminAuditPage → audit_data_load_log filtered by audit_check
Hook:         useAuditLog
Source table: audit_data_load_log
Producer:     run-audit-benchmark/index.ts (Check 4: IMPC_MISMATCH_RFID)
Input:        tracking_events.rfid_origin_impc + s9id[0:6]
Decision:     admin_decision (KEEP/DELETE) → consumed by fetchAuditExcludedS9ids
              in the frontend to exclude s9ids from RFID/EDI KPIs
```

---

## 7. Scheduling and orchestration

| Process | Trigger | Frequency | Implementation |
|---|---|---|---|
| `process-rfid-etl` `incremental` mode | HTTP API (`POST /functions/v1/process-rfid-etl`) | On demand — likely external cron | Edge Function |
| `process-rfid-etl` `csv` mode | Manual upload from `AdminAuditPage` | Manual | Edge Function (`multipart/form-data`) |
| `run-audit-benchmark` | "Run audit" button in `AdminAuditPage` | Manual | Edge Function |
| `refresh_benchmark_view` | `pg_cron` job `refresh-benchmark-daily` | Daily 02:00 UTC | [sql/refresh_benchmark_view.sql](../sql/refresh_benchmark_view.sql) |
| Reverse flow `RFID → tracking_events` | **Not documented in this repo** | Opaque | Likely a server-side trigger or view outside the repo |

> ⚠️ **Documentation gap**: how `tracking_events` is built from `RFID` + `datos EDI` is not versioned in this repo. It is the precomputed piece feeding the entire Tracking tab and half of the KPIs. It is worth recovering its DDL from the Supabase Dashboard and committing it under `sql/`.

---

## 8. Risks and operational notes

1. **Sensitive data**: `tracking_events` and `RFID` contain `s9id` (postal receptacle identifier) which can be re-identifiable. RLS on `public` should block `anon` access except for what is genuinely public.
2. **Service role inside Edge Functions**: `process-rfid-etl` uses `SUPABASE_SERVICE_ROLE_KEY` (line 34) and bypasses RLS. Any bug in CSV parsing has direct impact.
3. **`TagTrackPage` queries `RFID` with anon**: if the table lacks proper RLS, any logged-in user could enumerate readings. Verify.
4. **`ID Relation` and `datos EDI` have no pipeline in this repo**: their loading is assumed and opaque; document where they come from.
5. **Two ETL implementations**: the Python script classifies `ORIGIN/DESTINATION/INTERMEDIATE` (3 types), the v3 Edge Function classifies 7 types. **The frontend depends on all 7**. Keep them in sync or deprecate the Python script.
6. **Materialized view vs. client**: `benchmark_rfid_edi` refreshes overnight, but the client ignores it and rebuilds the join in memory each time (~169k RFID rows + paginated EDI). This will not scale; migrate `useBenchmarkData` to consume the materialized view.

---

## 9. Key files (summary)

| File | Role |
|---|---|
| [supabase/functions/process-rfid-etl/index.ts](../supabase/functions/process-rfid-etl/index.ts) | v3 ETL — source of truth for classification |
| [supabase/functions/run-audit-benchmark/index.ts](../supabase/functions/run-audit-benchmark/index.ts) | Data-quality audit |
| [scripts/process_rfid_etl.py](../scripts/process_rfid_etl.py) | CLI ETL (simplified classification — legacy) |
| [sql/01_create_rfid_readers_master.sql](../sql/01_create_rfid_readers_master.sql) | Master of the 18 readers |
| [sql/02_create_staging_rfid_events.sql](../sql/02_create_staging_rfid_events.sql) | Staging |
| [sql/03_create_log_rfid_inconsistencies.sql](../sql/03_create_log_rfid_inconsistencies.sql) | ETL issue log |
| [sql/04_alter_rfid_add_event_type.sql](../sql/04_alter_rfid_add_event_type.sql) | Enriched columns in `RFID` |
| [sql/rebuild_benchmark_view.sql](../sql/rebuild_benchmark_view.sql) | `benchmark_rfid_edi` view |
| [sql/refresh_benchmark_view.sql](../sql/refresh_benchmark_view.sql) | Refresh RPC + cron |
| [sql/fix_rfid_kpi_counts.sql](../sql/fix_rfid_kpi_counts.sql) | RPC `rfid_kpi_counts` |
| [supabase/indexes.sql](../supabase/indexes.sql) | Performance indexes |
| [client/src/lib/supabase.ts](../client/src/lib/supabase.ts) | Supabase client + fetch helpers |
| [client/src/hooks/useTrackingData.ts](../client/src/hooks/useTrackingData.ts) | Tracking-tab hook |
| [client/src/hooks/useEpcisData.ts](../client/src/hooks/useEpcisData.ts) | RFID-tab hook |
| [client/src/hooks/useBenchmarkData.ts](../client/src/hooks/useBenchmarkData.ts) | EDI+RFID-tab hook |
| [client/src/hooks/useAuditData.ts](../client/src/hooks/useAuditData.ts) | AdminAuditPage hook |
| [client/src/pages/Home.tsx](../client/src/pages/Home.tsx) | RFID/Tracking/EDI+RFID tabs |
| [client/src/pages/RouteDetailPage.tsx](../client/src/pages/RouteDetailPage.tsx) | Route detail |
| [client/src/pages/TagTrackPage.tsx](../client/src/pages/TagTrackPage.tsx) | Per-tag traceability |
| [client/src/pages/AdminAuditPage.tsx](../client/src/pages/AdminAuditPage.tsx) | Audit panel |

---

## 10. Field-by-field transformation logic

This section documents, for **every derived field** in the pipeline, exactly how its value is produced. Fields marked **(verbatim)** have a known formula in code; fields marked **(inferred)** are derived from naming and usage because their DDL is not in this repo.

### 10.1 `staging_rfid_events` — raw, no transformation

| Column | Source / formula |
|---|---|
| `id` | `bigserial`, autogenerated |
| `document_id` | Pass-through from CSV column / API payload `document_id`. If absent in CSV, generated `crypto.randomUUID()` (Edge Function only — Python script keeps null) |
| `event_time_local` | Pass-through (timestamp the reader assigns locally) |
| `event_time_offset` | Pass-through (timezone offset in minutes/hours from UTC) |
| `record_time` | Pass-through (timestamp when the reading was captured/recorded centrally — used for ordering in Phase 2) |
| `location` | Pass-through (free-text reader location) |
| `read_point_id` | Pass-through (FK to `rfid_readers_master.read_point_id`) |
| `tag_id` | Pass-through (RFID tag identifier) |
| `impc_code` | Pass-through from raw source — **considered untrusted**, will be replaced in Phase 2 |
| `s9id` | Pass-through (receptacle identifier — embeds origin/destination IMPC) |
| `loaded_at` | `DEFAULT now()` |
| `source` | `'API'` if pushed via REST, `'CSV'` set by Edge Function on multipart upload, `'BACKFILL'` set by Python script in backfill mode |

### 10.2 `RFID` enriched columns (verbatim — `process-rfid-etl/index.ts` v3)

| Column | Logic |
|---|---|
| `impc_code` | **Overwritten** with `rfid_readers_master.impc_code` for the matching `read_point_id`. If reader is missing in master, the row is **dropped** and a `READER_NOT_IN_MASTER` issue is logged |
| `country` | `rfid_readers_master.country` for the matching `read_point_id` |
| `center_name` | `rfid_readers_master.center_name` for the matching `read_point_id` |
| `event_type` | Computed in 4 layers, then resolved by **priority** (highest wins): <br>1. **Block-level** (consecutive readings with same `impc_code`): first→`ARRIVAL_AT_CENTRE` (priority 3), last→`DEPARTURE_FROM_CENTRE` (3), middle→`INTERMEDIATE` (1). <br>2. **Journey-level**: first reading of the tag→`ORIGIN` (4); last reading→`DESTINATION` (4). <br>3. **Country-change**: for each pair of consecutive blocks with `country[i] ≠ country[i+1]`: last reading of block `i`→`DEPARTURE` (5); first of block `i+1`→`ARRIVAL` (5). <br>4. **Resolution**: when one reading collects multiple labels, the **highest priority** is kept (`pickBestEventType` in [supabase/functions/process-rfid-etl/index.ts](../supabase/functions/process-rfid-etl/index.ts)) |
| `is_international_boundary` | `true` if the reading was tagged `DEPARTURE` or `ARRIVAL` in step 3 above; `false` otherwise |
| `status` | Per `tag_id`: <br>• `'COMPLETE'` if `COUNT(DISTINCT country) > 1` across all readings <br>• `'PENDING'` if `COUNT(DISTINCT country) == 1` |
| `etl_version` | Hard-coded constant `'v3'` |
| `etl_processed_at` | `new Date().toISOString()` captured once at the start of Phase 2 |
| `document_id`, `event_time_local`, `event_time_offset`, `record_time`, `location`, `read_point_id`, `tag_id`, `s9id` | Pass-through from staging |

> **Reader OE vs AMU labelling**: when a `DEPARTURE`/`ARRIVAL` lands on a reader with `td_reader = true`, the run log emits `AMU_OUTBOUND`/`AMU_INBOUND` — this is **only logged**, not persisted to a column. The semantic is reconstructed in the client (`useEpcisData`) by joining back to `rfid_readers_master`.

### 10.3 `tracking_events` — derived columns (inferred — DDL not in repo)

These formulae are inferred from the column names, the audit code in `run-audit-benchmark`, and the way the columns are consumed by `useTrackingData`. **Confirm against the actual server-side DDL before relying on them.**

#### Identification
| Column | Inferred logic |
|---|---|
| `id` | Surrogate PK |
| `s9id` | Natural key — one row per receptacle |
| `tag_id` | `ID Relation.tagid` for the matching `s9id` (LEFT JOIN; null when no RFID tag is bound) |

#### Coverage flags
| Column | Inferred logic |
|---|---|
| `has_rfid` | `EXISTS (SELECT 1 FROM RFID r WHERE r.tag_id = ID_Relation.tagid)` — at least one RFID reading bound to the same s9id |
| `has_predes` | `datos EDI.predes_time IS NOT NULL` |
| `has_resdes` | `datos EDI.redes_time IS NOT NULL` |
| `coverage_type` | Categorical bucket: <br>• `FULL` — has_rfid ∧ has_predes ∧ has_resdes <br>• `EDI_FULL` — has_predes ∧ has_resdes ∧ ¬has_rfid <br>• `RFID_ONLY` — has_rfid ∧ ¬has_predes ∧ ¬has_resdes <br>• `EDI_ONLY` — (has_predes ∨ has_resdes) ∧ ¬has_rfid <br>• `RFID_PREDES` — has_rfid ∧ has_predes ∧ ¬has_resdes <br>• `RFID_RESDES` — has_rfid ∧ has_resdes ∧ ¬has_predes |

#### RFID-side fields (from `RFID` aggregated by tag_id)
| Column | Inferred logic |
|---|---|
| `rfid_origin_impc` | `impc_code` of the `ORIGIN` event (or earliest `DEPARTURE_FROM_CENTRE` if no `ORIGIN`) |
| `rfid_origin_country` | `country` of the same row |
| `rfid_origin_centre` | `center_name` of the same row |
| `rfid_origin_reader` | `read_point_id` of the same row |
| `rfid_origin_time` | `record_time` (or `event_time_local`) of the same row |
| `rfid_origin_readings` | `COUNT(*) FROM RFID WHERE tag_id = X AND impc_code = rfid_origin_impc` |
| `rfid_dest_*` | Symmetric to `rfid_origin_*` but using the `DESTINATION` event (fallback `ARRIVAL_AT_CENTRE`) |
| `rfid_intermediate_centres` | `array_agg(DISTINCT impc_code) FROM RFID WHERE tag_id = X AND impc_code NOT IN (origin, dest)` |
| `rfid_total_readings` | `COUNT(*) FROM RFID WHERE tag_id = X` |

#### EDI-side fields (from `datos EDI`)
| Column | Inferred logic |
|---|---|
| `predes_time` | `datos EDI.predes_time` |
| `predes_origin_impc` | `datos EDI.origin` |
| `predes_origin_country` | First 2 chars of `predes_origin_impc` (ISO country) |
| `predes_origin_centre` | Lookup of `predes_origin_impc` in `postal_centers.center_name` |
| `redes_time` | `datos EDI.redes_time` |
| `redes_dest_impc` | `datos EDI.destination` |
| `redes_dest_country` | First 2 chars of `redes_dest_impc` |
| `redes_dest_centre` | Lookup in `postal_centers.center_name` |

#### Time deltas (the core KPIs)
| Column | Formula |
|---|---|
| `departure_lag_hours` | `EXTRACT(EPOCH FROM (rfid_origin_time - predes_time)) / 3600` — positive ⇒ RFID later than PREDES (departure was reported later than expected) |
| `arrival_lead_hours` | `EXTRACT(EPOCH FROM (redes_time - rfid_dest_time)) / 3600` — positive ⇒ EDI RESDES emitted later than RFID arrival |
| `rfid_transit_hours` | `EXTRACT(EPOCH FROM (rfid_dest_time - rfid_origin_time)) / 3600` |
| `edi_transit_hours` | `EXTRACT(EPOCH FROM (redes_time - predes_time)) / 3600` |
| `transit_diff_hours` | `rfid_transit_hours - edi_transit_hours` |

#### Validation flags
| Column | Formula |
|---|---|
| `origin_match` | `UPPER(rfid_origin_impc) = UPPER(SUBSTRING(s9id, 1, 6))` |
| `dest_match` | `UPPER(rfid_dest_impc) = UPPER(SUBSTRING(s9id, 7, 6))` |
| `full_route_validated` | `origin_match ∧ dest_match ∧ has_rfid ∧ has_predes ∧ has_resdes` |

### 10.4 `benchmark_rfid_edi` materialized view (verbatim — [sql/rebuild_benchmark_view.sql](../sql/rebuild_benchmark_view.sql))

Aggregated **by `tag_id`** from `RFID`, then joined with `datos EDI` ⨝ `ID Relation`.

#### CTE `rfid_events` (one row per tag_id)
| Output column | SQL |
|---|---|
| `rf_predes_time` | `MIN(record_time) FILTER (WHERE event_type IN ('ORIGIN','DEPARTURE_FROM_CENTRE','RFID_PREDES'))` |
| `rf_departure_time` | `MIN(record_time) FILTER (WHERE event_type IN ('DEPARTURE_FROM_CENTRE','DEPARTURE'))` |
| `rf_resdes_time` | `MIN(record_time) FILTER (WHERE event_type IN ('ARRIVAL_AT_CENTRE','DESTINATION','RFID_RESDES'))` |
| `rf_arrival_time` | `MIN(record_time) FILTER (WHERE event_type = 'ARRIVAL')` |
| `rf_origin_country` | `(array_agg(country ORDER BY record_time ASC) FILTER (WHERE event_type IN ('ORIGIN','DEPARTURE_FROM_CENTRE')))[1]` — first by record_time |
| `rf_origin_centre` | Same pattern, with `center_name` |
| `rf_origin_impc` | Same pattern, with `impc_code` |
| `rf_dest_country` | `(array_agg(country ORDER BY record_time ASC) FILTER (WHERE event_type IN ('ARRIVAL_AT_CENTRE','DESTINATION')))[1]` |
| `rf_dest_centre` | Same pattern, with `center_name` |
| `rf_dest_impc` | Same pattern, with `impc_code` |

#### CTE `edi_data` (one row per tag_id)
| Output column | SQL |
|---|---|
| `tag_id` | `ID Relation.tagid` |
| `s9id` | `datos EDI.ean` |
| `edi_origin_impc` | `datos EDI.origin` |
| `edi_dest_impc` | `datos EDI.destination` |
| `edi_predes_time` | `datos EDI.predes_time` |
| `edi_cardit_time` | `datos EDI.cardit_time` |
| `edi_resdit74_time` | `datos EDI.resdit74_time` |
| `edi_resdit74_impc` | `datos EDI.resdit74_impc` |
| `edi_resdit21_time` | `datos EDI.resdit21_time` |
| `edi_resdit21_impc` | `datos EDI.resdit21_impc` |
| `edi_resdes_time` | `datos EDI.redes_time` |

Joined as `de.ean = ir.s9id`.

#### Final `SELECT` — derived columns
| Output column | SQL |
|---|---|
| `tag_id` | `COALESCE(rfid.tag_id, edi.tag_id)` (FULL OUTER JOIN) |
| `rf_transit_hours` | `EXTRACT(EPOCH FROM (rf_arrival_time - rf_departure_time)) / 3600` |
| `edi_transit_hours` | `EXTRACT(EPOCH FROM (edi_resdes_time - edi_predes_time)) / 3600` |
| `delta_predes_hours` | `EXTRACT(EPOCH FROM (rf_predes_time - edi_predes_time)) / 3600` |
| `delta_resdes_hours` | `EXTRACT(EPOCH FROM (rf_resdes_time - edi_resdes_time)) / 3600` |
| `missing_cardit` | `edi_cardit_time IS NULL` |
| `missing_resdit74` | `edi_resdit74_time IS NULL` |
| `missing_resdit21` | `edi_resdit21_time IS NULL` |
| `missing_resdes` | `edi_resdes_time IS NULL` |
| `has_rf_departure` | `rf_departure_time IS NOT NULL` |
| `has_rf_arrival` | `rf_arrival_time IS NOT NULL` |
| `has_rf_transit` | `rf_departure_time IS NOT NULL AND rf_arrival_time IS NOT NULL` |
| `has_edi_transit` | `edi_predes_time IS NOT NULL AND edi_resdes_time IS NOT NULL` |

### 10.5 `rfid_kpi_counts` RPC outputs (verbatim — [sql/fix_rfid_kpi_counts.sql](../sql/fix_rfid_kpi_counts.sql))

Filters applied to `RFID`: `event_time_local::date BETWEEN p_date_from AND p_date_to`, plus per-tag origin/destination country.

| Output | SQL formula |
|---|---|
| `total_tags` | `COUNT(DISTINCT tag_id)` over filtered rows |
| `rfid_departures` | `COUNT(DISTINCT CASE WHEN event_type IN ('ORIGIN','DEPARTURE') THEN tag_id END)` |
| `rf_predes` | `COUNT(DISTINCT CASE WHEN event_type = 'DEPARTURE' THEN tag_id END)` |
| `rf_resdes` | `COUNT(DISTINCT CASE WHEN event_type = 'ARRIVAL' THEN tag_id END)` |
| `rfid_arrivals` | `COUNT(DISTINCT CASE WHEN event_type IN ('DESTINATION','ARRIVAL') THEN tag_id END)` |
| `rf_e2e` | `COUNT(DISTINCT tag_id)` of tags that appear in **both** the departures-side set (`ORIGIN`∨`DEPARTURE`) **and** the arrivals-side set (`DESTINATION`∨`ARRIVAL`) — implemented as an INNER JOIN of two distinct subqueries |

**Country-filter logic** (per tag, picked by event_type priority):
- `tag_origin.origin_country` = country of the `ORIGIN` event if present, else `DEPARTURE` event (`DISTINCT ON (tag_id)` with `CASE event_type WHEN 'ORIGIN' THEN 1 WHEN 'DEPARTURE' THEN 2 ELSE 3 END`)
- `tag_dest.dest_country` = symmetric for `DESTINATION` / `ARRIVAL`
- A tag passes the filter when both `origin_country` and `dest_country` match the parameters (NULL parameter = wildcard)

### 10.6 `audit_data_load_log` — field semantics ([supabase/functions/run-audit-benchmark/index.ts](../supabase/functions/run-audit-benchmark/index.ts))

| Column | Set by |
|---|---|
| `audit_run_id` | `crypto.randomUUID()` once at the start of the audit run |
| `audit_run_at` | `new Date().toISOString()` captured at the start of the run |
| `source_table` | Constant `'tracking_events'` |
| `source_record_id` | `tracking_events.id` of the offending row |
| `source_s9id` | `tracking_events.s9id` of the offending row |
| `audit_check` | One of `'IMPC_MISMATCH_RFID'`, `'CASE_NORMALIZATION'`, `'MAESTRO_AUSENTE'` |
| `audit_category` | Same value as `audit_check` for the three current checks |
| `severity` | `getSeverity(check)`: `IMPC_MISMATCH_RFID`→`'ALTO'`, `CASE_NORMALIZATION`→`'BAJO'`, `MAESTRO_AUSENTE`→`'MEDIO'` |
| `resolution` | `getResolution(check)`: `CASE_NORMALIZATION`→`'AUTO_CORRECTED'`, `MAESTRO_AUSENTE`→`'PENDING_REVIEW'`, otherwise `'SEND_TO_LOG'` |
| `field_name` | The offending column name (`rfid_origin_impc`, `rfid_dest_impc`, `predes_origin_impc`, `redes_dest_impc`) |
| `original_value` | Value as it appears in `tracking_events` |
| `corrected_value` | Proposed value (e.g. `original_value.toUpperCase()` for `CASE_NORMALIZATION`; `extracted.origin`/`extracted.dest` derived from `s9id` for `IMPC_MISMATCH_RFID`) |
| `notes` | Human-readable Spanish text generated by the function (templates per check) |
| `admin_decision` | Set by humans through `AdminAuditPage`: `'KEEP'` or `'DELETE'` |
| `admin_notes`, `admin_reviewed_by`, `admin_reviewed_at` | Set when admin saves a decision |
| `outlier_flag`, `group_context`, `group_median`, `group_iqr_low`, `group_iqr_high` | Reserved columns for an `OUTLIER_TEMPORAL` check that is **not yet implemented** in the function we read |

**`s9id` extraction** used by `IMPC_MISMATCH_RFID` (`extractImpcFromS9id` in the Edge Function):
```
extracted.origin = s9id.substring(0, 6).toUpperCase()
extracted.dest   = s9id.substring(6, 12).toUpperCase()
```

### 10.7 `log_rfid_inconsistencies` — field semantics ([supabase/functions/process-rfid-etl/index.ts](../supabase/functions/process-rfid-etl/index.ts))

| Column | Set by |
|---|---|
| `etl_run_id` | `crypto.randomUUID()` at the start of the ETL run |
| `etl_run_at` | `DEFAULT now()` |
| `source_record_id` | `String(staging.id ?? document_id)` |
| `read_point_id`, `s9id`, `tag_id` | Pass-through from the staging row |
| `issue_type` | One of `'READER_NOT_IN_MASTER'`, `'MISSING_FIELD'`, `'S9ID_INVALID'`, `'DUPLICATE_EVENT'`, `'S9ID_IMPC_MISMATCH'` |
| `issue_detail` | Spanish template per `issue_type` (e.g. `"Lector 'X' no encontrado en rfid_readers_master..."`) |
| `severity` | `'ALTO'` for missing fields and unknown readers; `'MEDIO'` informative |
| `admin_decision`, `admin_notes`, `admin_reviewed_by`, `admin_reviewed_at` | Set later by humans (mirrors `audit_data_load_log` flow) |

### 10.8 Client-side derived KPIs

#### `useEpcisData` — `RfidJourney[]` per s9id ([client/src/hooks/useEpcisData.ts](../client/src/hooks/useEpcisData.ts))

For each tag, after fetching `RFID` rows in monthly chunks (`fetchRfidReadingsWithProgress`):

| Field | Logic |
|---|---|
| `journey.s9id` / `journey.tag_id` | Direct from RFID readings |
| `journey.origin` | Reading where `event_type = 'ORIGIN'` (fallback: earliest `DEPARTURE_FROM_CENTRE`) |
| `journey.destination` | Reading where `event_type = 'DESTINATION'` (fallback: latest `ARRIVAL_AT_CENTRE`) |
| `journey.departure` | Reading where `event_type = 'DEPARTURE'` |
| `journey.arrival` | Reading where `event_type = 'ARRIVAL'` |
| `journey.transit_hours` | `(arrival.event_time_local - departure.event_time_local) / 3600` (or null if either side missing) |
| `journey.full_journey_hours` | `(destination.event_time_local - origin.event_time_local) / 3600` |
| `journey.intermediate_centres` | `Array.from(new Set(readings.filter(INTERMEDIATE).map(r => r.impc_code)))` |
| `journey.is_amu_outbound` / `is_amu_inbound` | `journey.departure?.read_point_id` (or `arrival`) joined to `rfid_readers_master.td_reader === true` |

#### `useTrackingData` — `DashboardStats` ([client/src/hooks/useTrackingData.ts](../client/src/hooks/useTrackingData.ts))

For each numeric column on `tracking_events`, aggregations are computed **after applying the global filters** (date range + origin/dest country):

| Stat | Formula |
|---|---|
| `mean(x)` | `sum(x) / count(x)` over non-null values |
| `median(x)` | 50th percentile via `array.sort((a,b)=>a-b)[floor(n/2)]` |
| `p25(x)` / `p75(x)` | Linear interpolation at index `0.25 * n` and `0.75 * n` of the sorted non-null array |
| `cdf(x)` | `Array.from({length: bins}, (_, i) => values.filter(v => v <= bin_i).length / n)` |
| `byCoverage[c].count` | `events.filter(e => e.coverage_type === c).length` |
| `byCountry[country].avg_lag` | `mean(events.filter(e => e.rfid_origin_country === country).map(e => e.departure_lag_hours))` |
| `byRoute[origin→dest].outliers` | Tukey: values outside `[Q1 - 1.5·IQR, Q3 + 1.5·IQR]` of `rfid_transit_hours` |

#### `useBenchmarkData` — `BenchmarkStats` ([client/src/hooks/useBenchmarkData.ts](../client/src/hooks/useBenchmarkData.ts))

For each `RfidJourney` joined with the cached `ID Relation` and `datos EDI`:

| Field | Formula |
|---|---|
| `row.s9id` | `idRelationMap.get(journey.tag_id)?.s9id` |
| `row.edi_predes_time` etc. | `ediMap.get(row.s9id)?.predes_time` etc. |
| `row.delta_predes_hours` | `(rfDepartureTime - ediPredesTime) / 3_600_000` (ms) |
| `row.delta_resdes_hours` | `(ediResdesTime - rfArrivalTime) / 3_600_000` |
| `row.rf_transit_hours` | `(rfArrivalTime - rfDepartureTime) / 3_600_000` |
| `row.edi_transit_hours` | `(ediResdesTime - ediPredesTime) / 3_600_000` |
| `routeStats[origin→dest].mean_delta_predes` | `mean(rows.filter(r => r.route === route).map(r => r.delta_predes_hours))` |
| `centreStats[centre].count_outliers` | Tukey fence on `rf_transit_hours` per centre |

> **Cross-reference**: the same `delta_predes_hours` / `delta_resdes_hours` formulas exist in three places — the materialized view (`benchmark_rfid_edi`), the `tracking_events` precomputation, and `useBenchmarkData`. They should always agree, but only the SQL view is currently versioned in this repo. If you change one, change all three.

### 10.9 Field provenance summary (one-glance table)

| Where the field lives | Where the value is computed |
|---|---|
| `staging_rfid_events.*` | Untransformed pass-through from CSV/API |
| `RFID.event_type` / `country` / `center_name` / `status` / `is_international_boundary` | `process-rfid-etl/index.ts` Phase 2 |
| `tracking_events.*` | Server-side precomputation **outside this repo** |
| `benchmark_rfid_edi.*` | `sql/rebuild_benchmark_view.sql` |
| `rfid_kpi_counts(...)` returns | `sql/fix_rfid_kpi_counts.sql` |
| `audit_data_load_log.*` | `run-audit-benchmark/index.ts` |
| `log_rfid_inconsistencies.*` | `process-rfid-etl/index.ts` Phase 3 |
| `DashboardStats`, `EpcisStats`, `BenchmarkStats` | Client hooks (`useTrackingData`, `useEpcisData`, `useBenchmarkData`) |

---

## 11. Known ETL gaps (investigated 2026-06-03)

This section documents a real production gap found while inspecting why the QuickSight view `vw_quicksight_rfid_report_movements` shows blank site/EDI fields. The diagnosis is complete and the fix is planned but **not yet applied**.

### 11.1 Symptom

The view `public.vw_quicksight_rfid_report_movements` is a thin wrapper over the table `public.rfid_report_movements`. In QuickSight the following columns come back empty for every row:

| Column | NULL rate |
|---|---|
| `site_impc_code` | 2,815 / 2,815 (100%) |
| `site_name` | 2,815 / 2,815 (100%) |
| `country_name` | 2,815 / 2,815 (100%) |
| `city` | 2,815 / 2,815 (100%) |
| `edi_equivalent` | 2,815 / 2,815 (100%) |

All other columns are fully populated (`country_code`, `origin_country_code`, `destination_country_code`, `movement_country_code`, `country_sequence_number`, `handover_quality_status`, `source_run_id`, etc.).

### 11.2 Real architecture — three Supabase projects, not two

The data flow involves three independent Supabase projects, not the two documented in earlier sections:

```
┌──────────────────────────────┐
│ ubgatxfwpmyaqyfrwias         │ ← Orchestrator project (#3)
│ Edge Function:               │
│ edge-rfid-etl-orchestrator   │
└──────────────┬───────────────┘
               │ invoked every 30 min by pg_cron
               │ job 'edge-rfid-etl-every-30-minutes' in #2
               ▼
┌──────────────────────────────┐         ┌──────────────────────────┐
│ ewyhmmixqcubqokphebh         │ ──?──► │ tsvlgznfvgoqbncunumu      │
│ Data project (#2)             │  sync   │ Site master project (#1)  │
│   - rfid_report_movements    │  is     │ Source of truth for site  │
│   - rfid_site_snapshot (EMPTY)│ MISSING │ master records            │
│   - rfid_edge_input_reads    │         │                           │
│   - vw_quicksight_*          │         │                           │
└──────────────────────────────┘         └──────────────────────────┘
```

### 11.3 Causal chain (from view back to root cause)

1. The view returns whatever is in `rfid_report_movements`.
2. `rfid_report_movements` is written by **`public.rfid_transform_run(p_run_id uuid)`**. That function's `INSERT INTO rfid_report_movements(...)` **does include** the five missing columns — they are copied verbatim from `rfid_edge_input_reads`.
3. `rfid_edge_input_reads` is enriched by **`public.rfid_enrich_run(p_run_id uuid)`** via:
   ```
   LEFT JOIN rfid_reader_master_snapshot rm ON rm.lpi = base.reader_id
   LEFT JOIN rfid_site_snapshot          s  ON s.site_id = rm.site_id
   ```
   Each missing column is `CASE WHEN rfid_reader_is_leg2(rm.product, rm.raw_payload) THEN s.<column> ELSE NULL END`. With Leg2 = true and the JOIN failing, every `s.<column>` evaluates to NULL.
4. **`rfid_site_snapshot` contains 0 rows.** Of the 2,128 readers in `rfid_reader_master_snapshot`, **2,119 (99.6%) point to a `site_id` that has no matching row in `rfid_site_snapshot`** (9 readers have a NULL `site_id`).
5. **No function in this database can populate `rfid_site_snapshot`**: no `INSERT`/`UPDATE`/`TRUNCATE`/`COPY` exists in any routine, no triggers fire on the table, and no cron job mentions it. The two cron jobs that exist are `edge-rfid-etl-every-30-minutes` (invokes the orchestrator on project #3) and `rfid-reprocess-recoverable-every-30-minutes` (reprocesses local errors).
6. The `pg_net`, `pg_cron` and `supabase_vault` extensions are installed (so cross-project sync is technically possible) but `vault.decrypted_secrets` is empty and no function uses `pg_net.http_*`. **The sync to `tsvlgznfvgoqbncunumu` lives outside the database** — either inside the orchestrator Edge Function on project #3, or in an external job that was never deployed (or was deployed and broke).

### 11.4 Evidence trail (verified via SQL Editor)

| # | Query | Result | Interpretation |
|---|---|---|---|
| 1 | `pg_get_viewdef('public.vw_quicksight_rfid_report_movements')` | Plain `SELECT * FROM rfid_report_movements` | The view doesn't compute — values come from the underlying table |
| 2 | NULL distribution of `rfid_report_movements` | 5 columns at 100% NULL; the rest at 0% | The gap is in 5 specific columns, the rest is healthy |
| 3 | `pg_get_functiondef('public.rfid_transform_run')` | `INSERT INTO rfid_report_movements(... site_impc_code, site_name, country_name, city, edi_equivalent ...)` | Bug is NOT in the transform — it does pass the values through |
| 4 | `pg_get_functiondef('public.rfid_enrich_run')` | Joins `rfid_site_snapshot` for those 5 columns | The values should come from the snapshot |
| 5 | `SELECT COUNT(*) FROM rfid_site_snapshot` | **0** | The snapshot is empty |
| 6 | Readers with orphan `site_id` | 2,119 / 2,128 (99.6%) | Virtually every reader cannot resolve its site |
| 7 | Routines that write to `rfid_site_snapshot` (regex precise) | **None** | No code path in this DB populates it |
| 8 | Triggers on `rfid_site_snapshot` | **None** | No trigger fires |
| 9 | `pg_foreign_server` / `information_schema.foreign_tables` | Empty | No FDW link to project #1 |
| 10 | Routines using `pg_net.http_*` / `vault.decrypted_secrets` | **None** | No cross-project HTTP call from inside Postgres |
| 11 | `cron.job` (all jobs) | Only orchestrator caller + reprocessor; nothing on `rfid_site_snapshot` | No scheduled refresh |

### 11.5 Security finding (orthogonal to the gap)

While auditing privileges on `rfid_site_snapshot`, found that **`anon` and `authenticated` roles have `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`** on the master table. Combined with the anon key being public (embedded in the dashboard JS bundle), this means any visitor to the dashboard could **poison or wipe the master** once it gets populated. The DML grants should be revoked before loading the snapshot.

A second smaller issue: the cron `command` for `edge-rfid-etl-every-30-minutes` carries an `Authorization: Bearer eyJ...` token in plaintext within `cron.job.command` — readable by anyone with DB-level visibility on `cron.job`. Should be moved to `vault.decrypted_secrets`.

### 11.6 Fix plan (to be applied 2026-06-04)

#### Step 1 — Lock down permissions (security first)

```sql
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.rfid_site_snapshot FROM anon, authenticated;
```

#### Step 2 — Initial load of `rfid_site_snapshot` from project #1

Connect to `tsvlgznfvgoqbncunumu` with `psql`, export the site master, import into project #2:

```bash
# Export from tsvlgznfvgoqbncunumu
psql "<conn-string-tsvlg>" -c "\COPY (
  SELECT site_id, site_impc_code, site_name, country_code, country_name,
         city, centre_code, timezone,
         edi_equivalent_inbound, edi_equivalent_outbound
  FROM <source_table>
) TO 'sites.csv' WITH CSV HEADER"

# Import into ewyhmmixqcubqokphebh
psql "<conn-string-ewyhm>" -c "
  TRUNCATE public.rfid_site_snapshot;
  \COPY public.rfid_site_snapshot FROM 'sites.csv' WITH CSV HEADER;
"
```

> Confirm column names against the actual schema of both projects before running.

#### Step 3 — Backfill existing 2,815 movements

```sql
-- Re-runs enrich + transform on already-processed runs, picking up the new snapshot data
SELECT * FROM public.rfid_reprocess_recoverable('production', 5000, 'manual_site_snapshot_backfill');
```

Verify by re-running the NULL-distribution query from §11.4 row 2.

#### Step 4 — Automate the sync going forward

Two options, in order of preference:

**A. Edge Function + pg_cron (recommended).** Create a `sync-site-snapshot` Edge Function in project #2 that pulls from project #1 via REST and `UPSERT`s into `rfid_site_snapshot`. Schedule with pg_cron, store the project #1 service_role key in `vault.decrypted_secrets`:

```sql
-- Store the secret once
SELECT vault.create_secret('<service_role_key_of_tsvlg>', 'tsvlg_service_role', 'Site master sync key');

-- Schedule daily refresh at 02:00 UTC
SELECT cron.schedule(
  'sync-site-snapshot-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ewyhmmixqcubqokphebh.supabase.co/functions/v1/sync-site-snapshot',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_self')
    )
  );
  $$
);
```

**B. Extend the existing orchestrator (`edge-rfid-etl-orchestrator` in project #3)** to call the sync before enrich+transform. Pros: single entry point. Cons: couples site master refresh to the 30-min ETL cadence (likely too often).

#### Step 5 — Cleanup

```sql
DROP FUNCTION IF EXISTS public.exec_sql_admin(text);
NOTIFY pgrst, 'reload schema';
```

### 11.7 Verification checklist after the fix

- [ ] `SELECT COUNT(*) FROM rfid_site_snapshot` > 0 and covers ≥2,119 distinct `site_id` values
- [ ] `SELECT COUNT(*) FROM rfid_report_movements WHERE site_impc_code IS NULL` returns 0 (or near 0)
- [ ] `vw_quicksight_rfid_report_movements` shows `site_impc_code`, `site_name`, `country_name`, `city`, `edi_equivalent` populated for new rows
- [ ] `cron.job_run_details` shows `sync-site-snapshot-daily` succeeding daily
- [ ] `anon` and `authenticated` no longer appear in `information_schema.table_privileges` for `rfid_site_snapshot` with DML rights
- [ ] `exec_sql_admin` no longer exists (dropped after the investigation)
