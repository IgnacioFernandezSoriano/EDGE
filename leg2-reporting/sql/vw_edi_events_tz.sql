-- ATAT: self-healing EDI events view with canonical UTC.
-- Parses the text date (two formats) into a naive timestamp (session-tz
-- independent: reformat to ISO then cast), resolves the location's IANA zone
-- from edi_location_timezone (site-level), and converts local -> UTC via
-- AT TIME ZONE. Project: EDGE Leg2 (ubgatxfwpmyaqyfrwias).

create or replace view public.vw_edi_events_tz as
with parsed as (
  select
    e.s9code, e.message, e.event, e.date, e.location,
    e.transport, e.transport_date, e.reference,
    case
      when e.date ~ '^[A-Za-z]{3},\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}$'
        then (regexp_replace(e.date,
               '^[A-Za-z]{3},(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$',
               '\3-\2-\1 \4:\5'))::timestamp
      when e.date ~ '^\d{4}-\d{2}-\d{2}$'
        then e.date::timestamp
      else null
    end as event_datetime_local,
    t.iana_zone as resolved_zone
  from public.edi_events e
  left join public.edi_location_timezone t on t.location = e.location
)
select
  p.s9code, p.message, p.event, p.date, p.location,
  p.transport, p.transport_date, p.reference,
  p.event_datetime_local,
  p.resolved_zone,
  case
    when p.event_datetime_local is not null and p.resolved_zone is not null
      then p.event_datetime_local at time zone p.resolved_zone
    else null
  end as event_datetime_utc,
  (p.event_datetime_local is not null and p.resolved_zone is not null) as tz_resolved
from parsed p;

-- Distinct locations that still need a timezone row. Excludes SQL NULL and the
-- literal 'null' string (a data artifact, not a real place).
create or replace view public.vw_edi_locations_unresolved as
select distinct location
from public.vw_edi_events_tz
where not tz_resolved
  and location is not null
  and location <> 'null';
