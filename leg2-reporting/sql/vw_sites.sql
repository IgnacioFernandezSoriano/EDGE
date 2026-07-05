-- vw_sites — curated site list for the Settings reprocess picker.
-- One row per site (incl. sites with no movements). Source: rfid_site_snapshot
-- (local mirror of GMS IOT sites, refreshed by sync-site-snapshot).
-- Applied on EDGE Leg2 (project ubgatxfwpmyaqyfrwias).
create or replace view public.vw_sites as
select site_impc_code, site_name, country_name
from public.rfid_site_snapshot
where site_impc_code is not null
order by site_impc_code;

grant select on public.vw_sites to authenticated;
