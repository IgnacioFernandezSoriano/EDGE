-- vw_reader_master — curated reader-master view for the Leg2 RFID reporting frontend.
-- Applied on EDGE Leg2 (project ubgatxfwpmyaqyfrwias).
-- Source: public.rfid_reader_master_snapshot (a local mirror of GMS IOT
-- public.readers_master, refreshed by the sync-site-snapshot Edge Function).
-- Exposes the curated Identification + Operation fields consumed by the in-app
-- reader editor (ReaderEditorDialog). NEVER exposes `product` or `nms_reader_url`.

-- DROP + CREATE (not CREATE OR REPLACE): the curated column order differs from
-- the previous view, and CREATE OR REPLACE only allows appending columns.
-- Safe: no database objects depend on this view (frontend read-only consumer).
drop view if exists public.vw_reader_master;

create view public.vw_reader_master as
select
  lpi,
  gate_id,
  raw_payload->>'gate_name'               as gate_name,
  raw_payload->>'gate_purpose'            as gate_purpose,
  raw_payload->>'reading_direction'       as reading_direction,
  raw_payload->>'facility_name'           as facility_name,
  raw_payload->>'facility_type'           as facility_type,
  site_id,
  reader_country_code,
  raw_payload->>'country_name'            as country_name,
  raw_payload->>'city'                    as city,
  raw_payload->>'facility_latitude'       as facility_latitude,
  raw_payload->>'facility_longitude'      as facility_longitude,
  raw_payload->>'operator'                as operator,
  raw_payload->>'priority'                as priority,
  case
    when lower(raw_payload->>'inactive') in ('true','false','t','f','yes','no','1','0')
    then (raw_payload->>'inactive')::boolean
    else null
  end                                     as inactive,
  raw_payload->>'operations_scope'        as operations_scope,
  handover_point,
  raw_payload->>'edi_equivalent_inbound'  as edi_equivalent_inbound,
  raw_payload->>'edi_equivalent_outbound' as edi_equivalent_outbound
from public.rfid_reader_master_snapshot;

grant select on public.vw_reader_master to authenticated;
