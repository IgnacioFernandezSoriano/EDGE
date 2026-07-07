-- vw_reader_master — curated reader-master view for the Leg2 RFID reporting frontend.
-- Applied on EDGE Leg2 (project ubgatxfwpmyaqyfrwias).
-- Source: public.rfid_reader_master_snapshot (a local mirror of GMS IOT
-- public.readers_master, refreshed by the sync-site-snapshot Edge Function).
-- Exposes the curated Identification + Operation fields consumed by the in-app
-- reader editor (ReaderEditorDialog). NEVER exposes `product` or `nms_reader_url`.
-- checkpoint_role is Leg2-side (public.rfid_checkpoint_role), not from GMS; it drives
-- edi_equivalent in the ETL. The legacy edi_equivalent_{inbound,outbound} remain for the
-- transition fallback (unclassified readers) and are read-only.

-- CREATE OR REPLACE (not drop): view vw_event_pair_detail_s9 depends on this view.
-- checkpoint_role is appended as the LAST column so replace stays append-compatible.
create or replace view public.vw_reader_master as
select
  s.lpi,
  s.gate_id,
  s.raw_payload->>'gate_name'               as gate_name,
  s.raw_payload->>'gate_purpose'            as gate_purpose,
  s.raw_payload->>'reading_direction'       as reading_direction,
  s.raw_payload->>'facility_name'           as facility_name,
  s.raw_payload->>'facility_type'           as facility_type,
  s.site_id,
  s.reader_country_code,
  s.raw_payload->>'country_name'            as country_name,
  s.raw_payload->>'city'                    as city,
  s.raw_payload->>'facility_latitude'       as facility_latitude,
  s.raw_payload->>'facility_longitude'      as facility_longitude,
  s.raw_payload->>'operator'                as operator,
  s.raw_payload->>'priority'                as priority,
  case
    when lower(s.raw_payload->>'inactive') in ('true','false','t','f','yes','no','1','0')
    then (s.raw_payload->>'inactive')::boolean
    else null
  end                                       as inactive,
  s.raw_payload->>'operations_scope'        as operations_scope,
  s.handover_point,
  s.raw_payload->>'edi_equivalent_inbound'  as edi_equivalent_inbound,
  s.raw_payload->>'edi_equivalent_outbound' as edi_equivalent_outbound,
  rr.role                                   as checkpoint_role
from public.rfid_reader_master_snapshot s
left join public.rfid_checkpoint_role rr on rr.lpi = s.lpi;

grant select on public.vw_reader_master to authenticated;
