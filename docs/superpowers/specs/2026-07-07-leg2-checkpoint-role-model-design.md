# Leg2 checkpoint-role model — design

**Date:** 2026-07-07
**Status:** proposed (awaiting user review)
**Target DB:** EDGE Leg2 `ubgatxfwpmyaqyfrwias` (no GMS schema change)

## Problem

`edi_equivalent` (the IPC checkpoint a reading represents) is derived by a rule that
conflates two independent axes into the reader's two code slots
(`edi_equivalent_inbound` / `edi_equivalent_outbound`):

```
edi_equivalent = CASE WHEN movement_type IN ('OUTBOUND','TRANSIT_EXIT')
                      THEN edi_equivalent_outbound ELSE edi_equivalent_inbound END
```

Consequences observed in live data (`ubgatxfwpmyaqyfrwias`):

- **Transit facilities are mislabelled.** A receptacle whose route is BA→US passing
  through CH (Zurich) is neither origin nor destination in CH, so both readings are
  `TRANSIT`. The transform maps physical entry→`edi_equivalent_inbound` (2400) and
  physical exit→`edi_equivalent_outbound` (2320): one AMU visit reported as "entered
  the *inbound* AMU, exited the *outbound* AMU." (S9 `BABNXAUSJFKAAUR60008001110001`.)
- **Origin/destination legs are also miscoded.** `2320` (outbound-exit) appears on
  DESTINATION (35) and TRANSIT (110); `2400` (inbound-entry) on ORIGIN (127) and
  TRANSIT (110). Per-reader codes have drifted; one reader has them swapped
  (`out=2400, in=2320`); many `facility_type='OE'` readers carry AMU codes.
- **`2310` and `2410` never appear** — the ETL emits only one representative per
  origin/destination leg, so entry-at-outbound-AMU and exit-at-inbound-AMU are lost.

Root cause: the checkpoint code is a function of **(facility role × leg × entry/exit)**,
but the model stores only two per-reader codes and the transform picks by an
overloaded axis. The universal IPC codes (2310/2320/2400/2410, 2300/2420) do not vary
per reader; storing them per reader is redundant and is why they have drifted.

## Goal

Derive `edi_equivalent` from three well-sourced facts, with one authoritative code
matrix, and stop storing universal codes per reader:

- **Leg** — from the S9 route: reader country = origin → `outbound`; = destination →
  `inbound`; a different country between origin and destination → `transit`.
- **Entry / exit** — position of the read within the facility: first read = entry,
  last read = exit (the rule the ETL already uses for transit).
- **Role** — what kind of checkpoint the facility is: `AMU`, `OE`, or `NONE`.

```
edi_equivalent = matrix(role, leg, entry|exit)   -- transit ⇒ NULL (no matrix row)
```

### The matrix

| role | outbound·entry | outbound·exit | inbound·entry | inbound·exit |
|------|----------------|---------------|---------------|--------------|
| AMU  | 2310           | 2320          | 2400          | 2410         |
| OE   | —              | 2300          | 2420          | —            |
| NONE | —              | —             | —             | —            |
| *transit (any role)* | NULL | NULL | NULL | NULL |

OE emits only departure at origin (2300) and arrival at destination (2420); the other
two cells are empty. `AMU OE` facilities are treated as `AMU`.

## Storage — Leg2-side, no GMS change

The checkpoint role is a Leg2-reporting concept, not a physical-reader fact, and adding
a GMS `readers_master` column needs GMS DDL access (flagged pending). So role and matrix
live in Leg2:

- **`public.rfid_checkpoint_role(lpi text primary key, role text not null check (role in
  ('AMU','OE','NONE')), source text, updated_at timestamptz default now())`** — one row
  per classified reader. Not touched by `sync-site-snapshot` (survives GMS re-sync).
- **`public.ref_checkpoint_code(role text, leg text, direction text, code text, primary
  key (role, leg, direction))`** — the matrix, data-driven so codes/roles change without
  a function edit. Seeded with the AMU and OE rows above. No transit rows (⇒ NULL).

`edi_equivalent_inbound` / `edi_equivalent_outbound` remain in GMS/snapshot but stop
driving the ETL. See **Rollout** for the fallback during transition.

## ETL changes (`sql/06_rfid_transform_run_per_site.sql` + `sql/07_…scope…` — keep in sync)

The two functions share the candidate/selection logic verbatim; both change identically.

1. **Emit entry and exit per leg.** Replace the 4 candidate branches
   (OUTBOUND / INBOUND / TRANSIT_ENTRY / TRANSIT_EXIT) with, per facility site within a
   country group, a **first read (entry)** and a **last read (exit)** candidate, tagged
   with `leg ∈ {outbound, inbound, transit}` (from origin/destination/neither) and
   `direction ∈ {entry, exit}`. `movement_type` becomes `{leg}_{direction}` for
   provenance (e.g. `outbound_exit`).
2. **Single-read facility (first read = last read).** Emit **one** movement, not two:
   the leg's handover representative — `exit` for outbound, `entry` for inbound, `exit`
   for transit. Preserves today's behaviour for single-read sites; only sites with ≥2
   reads gain the second checkpoint.
3. **Resolve the code** by joining the selected movement to `rfid_checkpoint_role`
   (by `lpi`) and `ref_checkpoint_code` (by `role, leg, direction`):
   `edi_equivalent = ref.code` (NULL when transit, role NULL/NONE, or no matrix row).
4. **`handover_quality_status`** keyed on the new `movement_type` values (generalise the
   existing `non_handover_selected_for_*` strings). `handover_point` unchanged (per-reader).
5. Transit movements are still **published with NULL `edi_equivalent`** (they remain
   visible in the ATAT timeline as physical reads).

## Inference seeding (`rfid_checkpoint_role`)

Seed only where signals agree (no contradiction); leave the rest NULL for manual review.
Confidence rules (applied in order):

1. `facility_type` contains `AMU` **and** no OE codes ⇒ `AMU`.
2. codes are OE-set (`out=2300` or `in=2420`) **and** not AMU-set ⇒ `OE`.
3. codes are AMU-set (`out∈{2310,2320}` or `in∈{2400,2410}`) **and** `facility_type`
   not `OE` ⇒ `AMU`.
4. otherwise ⇒ leave NULL (manual review).

Live preview (readers with codes or an AMU/OE-ish `facility_type`):

| inferred | readers | active |
|----------|---------|--------|
| AMU      | 88      | 39     |
| OE       | 7       | 5      |
| REVIEW (NULL) | 72 | 14     |

Seeded rows get `source='inferred'`; operator edits set `source='manual'`.

## Editor / write-through

- **`ReaderEditorDialog` Operation tab:** replace the two code selectors
  (Inbound/Outbound Code) with a single **Checkpoint role** dropdown (`AMU` / `OE` /
  `NONE` / unset). Keep `gate_purpose`, `handover_point`, `reading_direction`,
  `operations_scope`, product.
- **`apply-reader-edit`:** role is Leg2-side, so instead of PATCHing GMS for the code
  fields, upsert `rfid_checkpoint_role(lpi, role, source='manual')` in Leg2, then run the
  existing sync → `rfid_reprocess_scope({readers:[lpi]})` → export chain. Remove
  `edi_equivalent_inbound/outbound` from the GMS whitelist (`request.ts` ALLOWED).
- **`vw_reader_master`:** add `checkpoint_role` (LEFT JOIN `rfid_checkpoint_role`).
  Keep exposing the legacy code columns read-only during transition.
- Frontend `ediCodeOptions` / code selectors retired; `CHECKPOINT_LABELS` retained
  (still used to label columns in the pivot/report).

## Rollout & back-compat

- **Fallback during transition (recommended):** when a reader's `role` is NULL, the ETL
  falls back to the legacy per-reader `edi_equivalent_{inbound,outbound}` for
  origin/destination legs (transit still forced NULL). This guarantees **no regression**
  for the 14 active REVIEW readers while they are classified; remove the fallback once
  all active readers have a role. (Open decision — alternative: NULL for unclassified,
  forcing immediate cleanup.)
- Ship order: (1) tables + matrix seed; (2) inference seed; (3) ETL functions; (4) global
  reprocess; (5) editor + apply-reader-edit; (6) drop fallback after cleanup.

## Reprocess

After the ETL functions change, run a global `rfid_reprocess_scope` (from
`2026-01-01`) to rebuild all movements, then re-export the CSV. The 220 transit rows
with codes, the ORIGIN `2400` / DESTINATION `2320` miscodes, and the missing
`2310/2410` all resolve in one pass.

## Edge cases & risks

- **Single-read facilities** — handled (emit one representative, §ETL 2).
- **Country visited twice** (loop) — `country_sequence_number` already distinguishes; the
  first/last read is per (country, site) as today.
- **REVIEW readers** — 14 active; fallback keeps them working until classified.
- **QuickSight/S3 export** reads `vw_quicksight_rfid_report_movements` → picks up the
  corrected `edi_equivalent` after reprocess + re-export automatically.
- **New codes 2310/2410 appear** in the report pivot and event-pair gaps — intended;
  confirm downstream consumers tolerate new columns.

## Testing

- ETL unit fixtures (Leg2 SQL): transit → NULL; origin AMU 2-read → 2310+2320; dest AMU
  2-read → 2400+2410; origin OE → 2300 only; single-read origin → one 2320; NULL role +
  fallback → legacy code; NULL role no legacy → NULL.
- `request.ts` ALLOWED no longer accepts code fields; accepts nothing new (role is
  Leg2-side, not GMS).
- Frontend: editor renders role dropdown; `applyReaderEdit` posts `{role}`.
- Post-deploy verification queries: transit rows all NULL; `2320` only on ORIGIN; `2400`
  only on DESTINATION; `2310/2410` present for multi-read AMUs.

## Open decisions for review

1. **Fallback vs hard-NULL** for unclassified (REVIEW) readers — recommend fallback.
2. **OE matrix** — confirmed 2300 (out-exit) / 2420 (in-entry), other two cells empty?
3. **Emit both entry+exit** at origin/destination (new 2310/2410 movements) — confirmed?
4. Matrix as a **ref table** (editable) vs hardcoded in the function — recommend table.
