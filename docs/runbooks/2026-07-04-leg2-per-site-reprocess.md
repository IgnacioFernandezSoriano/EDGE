# Runbook — Leg2 per-site reprocess migration (2026-07-04)

**Project:** EDGE Leg2 `ubgatxfwpmyaqyfrwias`. One-off migration to rebuild all
`rfid_report_movements` with the new **per-site, time-ordered** selection (functions
`rfid_transform_run` and `rfid_reprocess_scope`, sql/06 & sql/07).

Why: the selection now picks the representative read **per site** by **time**
(last=outbound/exit, first=inbound/entry) instead of preferring the handover reader per
country. Existing movements must be rebuilt so production output (report + CSV to S3)
matches the new logic.

## Baseline (before)

- `movements_before` = **8229**
- `null_edi_before` = **15**
- Enriched reads by site: TRISTF 307, INMUBA 1286, CHZRHC 3306, JPKWSA 12339 (4 sites).

## Smoke test (validates the new `sites` filter path on a small scope)

```sql
select * from rfid_reprocess_scope(
  jsonb_build_object('from','2026-01-01T00:00:00Z','sites', jsonb_build_array('TRISTF')),
  'production', 5000, 'per_site_smoke');
```
Expect `status = success`. (Transactionally safe: on error the function rolls the data
changes back and returns `status = failed` with `error_message`.)

## Full-history reprocess

```sql
select * from rfid_reprocess_scope(
  jsonb_build_object('from','2026-01-01T00:00:00Z'),
  'production', 100000, 'per_site_migration');
```
Reads staged since 2026-01-01 ≈ 36k < the 100000 `p_max_reads` cap → a single call covers
all history.

## Verification (after)

```sql
select count(*) as movements_after,
       count(*) filter (where edi_equivalent is null) as null_edi_after
from rfid_report_movements;

select edi_equivalent is null as gap, movement_type, count(*)
from rfid_report_movements group by 1,2 order by 3 desc;
```

## Final step

Re-export the CSV to S3 so the final ETL file reflects the rebuilt movements
(Edge Function `export-rfid-csv-to-s3`, empty POST body).

## Results (2026-07-05)

- Smoke (`TRISTF`): `status = success`, `movements_upserted = 136` (89 affected pairs).
- Full reprocess (`per_site_migration`, run `2bd9b4c0-c436-41c6-bb13-9fd7e0fb8de9`):
  `reads_selected = 36586`, `reads_enriched = 28373`, `affected_pairs = 7745`,
  `movements_upserted = 8430`, `incidents_created = 2`, `status = success`.
- `movements_after` = **8430** (was 8229), `null_edi_after` = **18** (was 15).
  Gap movements by direction: OUTBOUND 7 + TRANSIT_EXIT 3 (left column), INBOUND 8 (right column).
- CSV re-export: `ok = true`, `rows_exported = 8430`, `bytes = 3063273`,
  `s3_key = quicksight/rfid/current/rfid_movements.csv`.
