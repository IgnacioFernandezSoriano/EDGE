-- Picker + resolution views for the Settings reprocess panel.
-- Applied on EDGE Leg2 (project ubgatxfwpmyaqyfrwias).
--
-- The reprocess (rfid_reprocess_scope) operates on the RAW RFID READINGS table
-- public.rfid_edge_input_reads. Only ~4 sites carry a site_impc_code, but EVERY
-- read carries a centre (centre_code = the GMS site_id / site_impc, plus site_name
-- for display). So the Site picker lists CENTRES (all that have readings), and a
-- centre is reprocessed via its readers (rfid_reprocess_scope `readers` filter),
-- resolved through vw_centre_readers — no change to the core ETL function.

-- Centres that have RFID readings (keyed by centre_code, labelled by site_name).
-- DROP first: the column set changed from an earlier version (site_impc_code ->
-- centre_code), which `create or replace` cannot do. Safe: only the frontend reads it.
drop view if exists public.vw_reprocess_sites;
create view public.vw_reprocess_sites as
select
  r.centre_code,
  max(r.site_name)           as site_name,
  max(r.reader_country_code) as country_code
from public.rfid_edge_input_reads r
where nullif(btrim(r.centre_code), '') is not null
  and nullif(btrim(r.site_name), '') is not null
group by r.centre_code
order by max(r.site_name);

grant select on public.vw_reprocess_sites to authenticated;

-- Readers (LPI) that have RFID readings, with a best-effort facility label.
create or replace view public.vw_reprocess_readers as
select
  r.reader_id,
  max(coalesce(nullif(btrim(rm.raw_payload->>'facility_name'), ''), r.site_name, r.reader_city)) as facility_name,
  max(r.site_impc_code) as site_impc_code
from public.rfid_edge_input_reads r
left join public.rfid_reader_master_snapshot rm on rm.lpi = r.reader_id
where nullif(btrim(r.reader_id), '') is not null
group by r.reader_id
order by r.reader_id;

grant select on public.vw_reprocess_readers to authenticated;

-- Centre -> its readers, so a whole centre can be reprocessed via the readers filter.
create or replace view public.vw_centre_readers as
select distinct r.centre_code, r.reader_id
from public.rfid_edge_input_reads r
where nullif(btrim(r.centre_code), '') is not null
  and nullif(btrim(r.reader_id), '') is not null;

grant select on public.vw_centre_readers to authenticated;
