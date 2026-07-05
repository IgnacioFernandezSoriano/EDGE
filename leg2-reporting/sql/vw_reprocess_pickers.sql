-- Picker views for the Settings reprocess panel.
-- Applied on EDGE Leg2 (project ubgatxfwpmyaqyfrwias).
--
-- The reprocess (rfid_reprocess_scope) operates on the RAW RFID READINGS
-- table public.rfid_edge_input_reads: the `sites` filter matches
-- reads.site_impc_code and the `readers` filter matches reads.reader_id
-- (== readers_master.lpi). So the pickers must list ONLY the sites/readers
-- that actually have readings in the solution — NOT the master snapshot
-- (which carries hundreds of sites, only a handful with any reads).

-- Sites that have RFID readings, with a display name + country.
create or replace view public.vw_reprocess_sites as
select
  r.site_impc_code,
  max(r.site_name)    as site_name,
  max(s.country_name) as country_name
from public.rfid_edge_input_reads r
left join public.rfid_site_snapshot s on s.site_impc_code = r.site_impc_code
where nullif(btrim(r.site_impc_code), '') is not null
group by r.site_impc_code
order by r.site_impc_code;

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
