-- Event-pair gaps (Leg2, ubgatxfwpmyaqyfrwias): days between the first RFID
-- handover (or arrival-at-OE) event and the first matching EDI event per S9.
-- Config-driven by ref_event_comparison (no hardcoded codes in app code).
-- Increment 1: dynamic. Month-end snapshots are Increment 2.

-- 1) Comparison config (seed data). The event->code mapping lives HERE.
create table if not exists public.ref_event_comparison (
  comparison_key      text primary key,
  priority            int  not null,
  rfid_selector       text not null,       -- 'handover_flag' | a 4-digit code, e.g. '2420'
  edi_messages        text[] not null,     -- e.g. {RESCON}
  requires_colocation boolean not null default false,  -- reserved (v1 does not filter on colocation)
  direction           text not null,       -- 'rfid_first' | 'either' (reserved; v1 uses a symmetric ±7d window, not enforced)
  label               text not null
);

insert into public.ref_event_comparison
  (comparison_key, priority, rfid_selector, edi_messages, requires_colocation, direction, label)
values
  ('ho_rescon',    1, 'handover_flag', array['RESCON'], true,  'rfid_first', '2320/2400/2420 → RESCON'),
  ('ho_resdes',    2, 'handover_flag', array['RESDES'], true,  'rfid_first', '2320/2400/2420 → RESDES'),
  ('ho_predes',    3, 'handover_flag', array['PREDES'], false, 'either',     '2320/2400/2420 → PREDES'),
  ('arroe_rescon', 4, '2420',          array['RESCON'], true,  'rfid_first', '2420 → RESCON')
on conflict (comparison_key) do update set
  priority            = excluded.priority,
  rfid_selector       = excluded.rfid_selector,
  edi_messages        = excluded.edi_messages,
  requires_colocation = excluded.requires_colocation,
  direction           = excluded.direction,
  label               = excluded.label;

alter table public.ref_event_comparison enable row level security;
drop policy if exists rec_read on public.ref_event_comparison;
create policy rec_read on public.ref_event_comparison
  for select to authenticated using (true);

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

-- 2b) Mail-category display names (UPU transport category). Editable config: the
-- product filter shows `name`; the pipeline still keys on `code` (mail_category).
-- Seeded with best-known UPU names — CORRECT THEM HERE if any are off.
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

-- 3) Detail view: one row per (S9, comparison) that has both anchors within ±7d.
create or replace view public.vw_event_pair_gaps_s9
with (security_invoker = on) as
with
rfid_flag as (  -- handover anchor: earliest handover_point movement per S9
  select s9_id as s9code, min(event_datetime_utc) as rfid_utc
  from public.vw_quicksight_rfid_report_movements
  where handover_point = true and event_datetime_utc is not null
  group by s9_id
),
rfid_code as (  -- code anchor: earliest movement per (S9, edi_equivalent)
  select s9_id as s9code, edi_equivalent as code, min(event_datetime_utc) as rfid_utc
  from public.vw_quicksight_rfid_report_movements
  where edi_equivalent is not null and event_datetime_utc is not null
  group by s9_id, edi_equivalent
),
anchor as (     -- resolve each comparison's RFID selector to a per-S9 anchor
  select c.comparison_key, c.edi_messages, a.s9code, a.rfid_utc
  from public.ref_event_comparison c
  cross join lateral (
    select rf.s9code, rf.rfid_utc from rfid_flag rf
      where c.rfid_selector = 'handover_flag'
    union all
    select rc.s9code, rc.rfid_utc from rfid_code rc
      where c.rfid_selector = rc.code
  ) a
),
pairs as (
  -- earliest EDI of the matching type WITHIN the ±7-day window of the RFID
  -- anchor. Aggregate over the RAW events (not a pre-collapsed per-message
  -- min), so an out-of-window earlier duplicate does not shadow a valid
  -- in-window match — the window is the only thing that constrains the min().
  select
    an.comparison_key, an.s9code, an.rfid_utc,
    (select min(e.event_datetime_utc) from public.vw_edi_events_tz e
     where e.s9code = an.s9code
       and e.message = any(an.edi_messages)
       and e.event_datetime_utc is not null
       and e.event_datetime_utc between an.rfid_utc - interval '7 days'
                                    and an.rfid_utc + interval '7 days') as edi_utc
  from anchor an
)
select
  p.s9code,
  p.comparison_key,
  substr(p.s9code, 1, 6) as origin_office,
  substr(p.s9code, 7, 6) as dest_office,
  substr(p.s9code, 1, 2) as origin_country,
  substr(p.s9code, 7, 2) as dest_country,
  d.mail_category        as product,
  p.rfid_utc,
  p.edi_utc,
  round((extract(epoch from (p.edi_utc - p.rfid_utc)) / 86400.0)::numeric, 4) as gap_days,
  date_trunc('month', p.rfid_utc)::date as event_month,
  true as colocation_valid,  -- v1 stub: computed-not-enforced; reserved for the colocation increment
  (x.s9code is not null) as excluded
from pairs p
left join public.edi_details d on d.s9code = p.s9code
left join public.event_pair_exclusion x
  on x.s9code = p.s9code and x.comparison_key = p.comparison_key
where p.edi_utc is not null;  -- drops anchors with no matching EDI in the window

-- 4) Aggregation to the grid. security invoker -> country RLS on base data applies.
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
    and g.rfid_utc::date between p_from and p_to
    and (
      p_product = 'all'
      or (p_product = '__none__' and g.product is null)
      or g.product = p_product
    )
  group by 1, 2, g.comparison_key
$$;

grant execute on function public.event_pair_matrix(date, date, text, text) to authenticated;

-- 5) Detail-enrichment view: the base gaps view + the receptacle's ORIGIN-role
-- and DESTINATION-role RFID readings (earliest of each), with gate name (from the
-- reader master) and site name. Kept SEPARATE from the base view so the matrix
-- aggregation stays lean and unaffected. Used only by the cell drill-down.
-- drop+recreate (not create-or-replace): g.* expands the base view's columns,
-- so if the base view later gains a column a plain replace would fail on reorder.
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
  order by m.event_datetime_utc asc
  limit 1
) ord on true
left join public.vw_reader_master orm on orm.lpi = ord.reader_id
left join lateral (
  select m.reader_id, m.site_name
  from public.vw_quicksight_rfid_report_movements m
  where m.s9_id = g.s9code and m.route_country_role = 'DESTINATION'
    and m.event_datetime_utc is not null
  order by m.event_datetime_utc asc
  limit 1
) drd on true
left join public.vw_reader_master drm on drm.lpi = drd.reader_id;
