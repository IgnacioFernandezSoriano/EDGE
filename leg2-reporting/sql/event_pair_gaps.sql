-- Event-pair gaps (Leg2, ubgatxfwpmyaqyfrwias): generic, user-defined event
-- comparisons. Each comparison = (A_source,A_code) vs (B_source,B_code); gap =
-- B_ts - A_ts per S9 (first occurrence, no window). Increment 3.

-- 1) Comparison config — GENERIC schema. Holds USER DATA: never drop-recreate on
-- re-apply. One-time migration from the old (rfid_selector/edi_messages) schema is
-- guarded so re-applying preserves user-created comparisons.
create table if not exists public.ref_event_comparison (
  comparison_key text primary key,
  name           text,
  a_source       text,
  a_code         text,
  b_source       text,
  b_code         text,
  priority       int
);

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='ref_event_comparison'
               and column_name='rfid_selector') then
    -- dependent objects reference the old columns; drop them before altering.
    drop function if exists public.event_pair_matrix(date, date, text, text);
    drop view if exists public.vw_event_pair_detail_s9;
    drop view if exists public.vw_event_pair_gaps_s9;
    -- backfill new columns from the old ones for the existing 4 rows.
    update public.ref_event_comparison set
      name     = coalesce(name, label),
      a_source = 'RFID',
      a_code   = case when rfid_selector = 'handover_flag' then '__HO__' else rfid_selector end,
      b_source = 'EDI',
      b_code   = edi_messages[1]
    where a_code is null;
    alter table public.ref_event_comparison
      drop column if exists rfid_selector,
      drop column if exists edi_messages,
      drop column if exists requires_colocation,
      drop column if exists direction,
      drop column if exists label;
  end if;
end $$;

-- Fresh-install seed (editable). do-nothing so re-apply never clobbers user edits.
insert into public.ref_event_comparison (comparison_key, name, a_source, a_code, b_source, b_code, priority) values
  ('ho_rescon',    'Handover → RESCON', 'RFID', '__HO__', 'EDI', 'RESCON', 1),
  ('ho_resdes',    'Handover → RESDES', 'RFID', '__HO__', 'EDI', 'RESDES', 2),
  ('ho_predes',    'Handover → PREDES', 'RFID', '__HO__', 'EDI', 'PREDES', 3),
  ('arroe_rescon', 'Arr OE (2420) → RESCON', 'RFID', '2420', 'EDI', 'RESCON', 4)
on conflict (comparison_key) do nothing;

-- enforce NOT NULL once rows are guaranteed populated (safe on re-apply).
alter table public.ref_event_comparison
  alter column name set not null,
  alter column a_source set not null,
  alter column a_code set not null,
  alter column b_source set not null,
  alter column b_code set not null,
  alter column priority set not null;

alter table public.ref_event_comparison enable row level security;
drop policy if exists rec_all on public.ref_event_comparison;
drop policy if exists rec_read on public.ref_event_comparison;
create policy rec_all on public.ref_event_comparison
  for all to authenticated using (true) with check (true);

-- 2) Permanent, global outlier exclusions, keyed by (s9code, comparison_key).
create table if not exists public.event_pair_exclusion (
  s9code         text not null,
  comparison_key text not null,
  excluded_by    text,
  excluded_at    timestamptz not null default now(),
  reason         text,
  primary key (s9code, comparison_key)
);
alter table public.event_pair_exclusion enable row level security;
drop policy if exists epx_all on public.event_pair_exclusion;
create policy epx_all on public.event_pair_exclusion
  for all to authenticated using (true) with check (true);

-- 2b) Mail-category display names (editable). Product filter shows name; pipeline keys on code.
create table if not exists public.ref_mail_category (
  code text primary key,
  name text not null
);
insert into public.ref_mail_category (code, name) values
  ('A',  'Aéreo / Prioritario'),
  ('B',  'No prioritario'),
  ('C',  'S.A.L. (Surface Air Lifted)'),
  ('D',  'Superficie'),
  ('E',  'EMS'),
  ('LC', 'Cartas (LC/AO)')
on conflict (code) do update set name = excluded.name;
alter table public.ref_mail_category enable row level security;
drop policy if exists rmc_read on public.ref_mail_category;
create policy rmc_read on public.ref_mail_category
  for select to authenticated using (true);

-- 3) Selectable event vocabulary (for the comparison builder's pickers).
create or replace view public.vw_comparison_events
with (security_invoker = on) as
select 'RFID'::text as source, edi_equivalent as code, count(*)::int as n
  from public.vw_quicksight_rfid_report_movements
  where edi_equivalent is not null
  group by edi_equivalent
union all
select 'RFID', '__HO__', count(*)::int
  from public.vw_quicksight_rfid_report_movements
  where handover_point = true
union all
select 'EDI', message, count(*)::int
  from public.vw_edi_events_tz
  where message is not null
  group by message;

-- 4) Generic base gaps view: one row per (S9, comparison) that has BOTH events.
create or replace view public.vw_event_pair_gaps_s9
with (security_invoker = on) as
with events as (
  -- RFID checkpoint events, first per (S9, code)
  select s9_id as s9code, 'RFID'::text as source, edi_equivalent as code, min(event_datetime_utc) as ts
    from public.vw_quicksight_rfid_report_movements
    where edi_equivalent is not null and event_datetime_utc is not null
    group by s9_id, edi_equivalent
  union all
  -- RFID handover pseudo-event (any handover gate), first per S9
  select s9_id, 'RFID', '__HO__', min(event_datetime_utc)
    from public.vw_quicksight_rfid_report_movements
    where handover_point = true and event_datetime_utc is not null
    group by s9_id
  union all
  -- EDI events (canonical UTC), first per (S9, message)
  select s9code, 'EDI', message, min(event_datetime_utc)
    from public.vw_edi_events_tz
    where message is not null and event_datetime_utc is not null
    group by s9code, message
)
select
  ea.s9code,
  c.comparison_key,
  substr(ea.s9code, 1, 6) as origin_office,
  substr(ea.s9code, 7, 6) as dest_office,
  substr(ea.s9code, 1, 2) as origin_country,
  substr(ea.s9code, 7, 2) as dest_country,
  d.mail_category         as product,
  ea.ts                   as a_utc,
  eb.ts                   as b_utc,
  round((extract(epoch from (eb.ts - ea.ts)) / 86400.0)::numeric, 4) as gap_days,
  date_trunc('month', ea.ts)::date as event_month,
  (x.s9code is not null) as excluded
from public.ref_event_comparison c
join events ea on ea.source = c.a_source and ea.code = c.a_code
join events eb on eb.source = c.b_source and eb.code = c.b_code and eb.s9code = ea.s9code
left join public.edi_details d on d.s9code = ea.s9code
left join public.event_pair_exclusion x on x.s9code = ea.s9code and x.comparison_key = c.comparison_key;

-- 5) Aggregation to the grid. security invoker -> base-data country RLS applies.
create or replace function public.event_pair_matrix(
  p_from date, p_to date, p_product text, p_granularity text
) returns table(origin text, destination text, comparison_key text, mean_days numeric, n int)
language sql stable security invoker as $$
  select
    case when p_granularity = 'country' then g.origin_country else g.origin_office end,
    case when p_granularity = 'country' then g.dest_country   else g.dest_office   end,
    g.comparison_key,
    round(avg(g.gap_days), 2),
    count(*)::int
  from public.vw_event_pair_gaps_s9 g
  where not g.excluded
    and g.a_utc::date between p_from and p_to
    and (
      p_product = 'all'
      or (p_product = '__none__' and g.product is null)
      or g.product = p_product
    )
  group by 1, 2, g.comparison_key
$$;
grant execute on function public.event_pair_matrix(date, date, text, text) to authenticated;

-- 6) Detail-enrichment view: base + ORIGIN/DESTINATION-role reading gate+site.
-- drop+recreate (g.* would reorder on a base-view column change).
drop view if exists public.vw_event_pair_detail_s9;
create view public.vw_event_pair_detail_s9
with (security_invoker = on) as
select
  g.*,
  orm.gate_name as origin_gate,
  ord.site_name as origin_site,
  drm.gate_name as dest_gate,
  drd.site_name as dest_site
from public.vw_event_pair_gaps_s9 g
left join lateral (
  select m.reader_id, m.site_name
  from public.vw_quicksight_rfid_report_movements m
  where m.s9_id = g.s9code and m.route_country_role = 'ORIGIN'
    and m.event_datetime_utc is not null
  order by m.event_datetime_utc asc limit 1
) ord on true
left join public.vw_reader_master orm on orm.lpi = ord.reader_id
left join lateral (
  select m.reader_id, m.site_name
  from public.vw_quicksight_rfid_report_movements m
  where m.s9_id = g.s9code and m.route_country_role = 'DESTINATION'
    and m.event_datetime_utc is not null
  order by m.event_datetime_utc asc limit 1
) drd on true
left join public.vw_reader_master drm on drm.lpi = drd.reader_id;
