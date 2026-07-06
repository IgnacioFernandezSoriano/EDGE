-- Reprocess run status for the Settings panel to poll.
-- Applied on EDGE Leg2 (project ubgatxfwpmyaqyfrwias).
-- Exposes rfid_reprocess_audit rows (with the reason lifted out of metadata) so
-- an authenticated user can follow a run they triggered — a run is correlated by
-- a unique token embedded in the reason (settings_reprocess_<scope>:<token>).
create or replace view public.vw_reprocess_status as
select
  reprocess_run_id,
  status,
  reads_selected,
  movements_upserted,
  incidents_created,
  error_message,
  started_at_utc,
  finished_at_utc,
  metadata->>'reason' as reason
from public.rfid_reprocess_audit;

grant select on public.vw_reprocess_status to authenticated;
