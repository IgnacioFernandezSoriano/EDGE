-- vw_reader_master — reader-master view for the Leg2 RFID reporting frontend.
-- Applied on EDGE Leg2 (project ubgatxfwpmyaqyfrwias).
-- Source: public.rfid_reader_master_snapshot (a local mirror of GMS IOT
-- public.readers_master, refreshed by the sync-site-snapshot Edge Function).
-- The frontend reads this view (authenticated) to enrich each RFID reading with
-- the reader LPI, gate name, handover flag, reading direction and EDI equivalents.

create or replace view public.vw_reader_master as
select
  lpi,
  gate_id,
  raw_payload->>'gate_name'               as gate_name,
  raw_payload->>'gate_purpose'            as gate_purpose,
  raw_payload->>'reading_direction'       as reading_direction,
  raw_payload->>'facility_name'           as facility_name,
  site_id,
  reader_country_code,
  handover_point,
  raw_payload->>'edi_equivalent_inbound'  as edi_equivalent_inbound,
  raw_payload->>'edi_equivalent_outbound' as edi_equivalent_outbound
from public.rfid_reader_master_snapshot;

grant select on public.vw_reader_master to authenticated;
