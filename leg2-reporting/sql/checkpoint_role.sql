-- checkpoint_role.sql — Leg2 (ubgatxfwpmyaqyfrwias)
-- Role-driven checkpoint model: edi_equivalent = matrix(role, leg, entry/exit).
-- Role + matrix live Leg2-side (no GMS change); the ETL joins these tables.
-- Idempotent: safe to re-apply. NEVER overwrites a manually-set role.

-- 1) Per-reader checkpoint role. USER/derived DATA: not touched by sync-site-snapshot.
create table if not exists public.rfid_checkpoint_role (
  lpi        text primary key,
  role       text not null check (role in ('AMU','OE','NONE')),
  source     text,                         -- 'inferred' | 'manual'
  updated_at timestamptz not null default now()
);
alter table public.rfid_checkpoint_role enable row level security;
drop policy if exists rcr_read on public.rfid_checkpoint_role;
create policy rcr_read on public.rfid_checkpoint_role
  for select to authenticated using (true);
-- Writes only via service role (apply-reader-edit / ETL); no authenticated write policy.

-- 2) The code matrix. Data-driven so codes/roles change without a function edit.
create table if not exists public.ref_checkpoint_code (
  role      text,
  leg       text,   -- 'outbound' | 'inbound'  (no 'transit' rows => transit is NULL)
  direction text,   -- 'entry' | 'exit'
  code      text,
  primary key (role, leg, direction)
);
insert into public.ref_checkpoint_code (role, leg, direction, code) values
  ('AMU','outbound','entry','2310'), ('AMU','outbound','exit','2320'),
  ('AMU','inbound','entry','2400'),  ('AMU','inbound','exit','2410'),
  ('OE','outbound','exit','2300'),   ('OE','inbound','entry','2420')
on conflict (role, leg, direction) do update set code = excluded.code;
alter table public.ref_checkpoint_code enable row level security;
drop policy if exists rcc_read on public.ref_checkpoint_code;
create policy rcc_read on public.ref_checkpoint_code
  for select to authenticated using (true);

-- 3) Confident inference seed. Only where signals agree; contradictions stay unset
-- for manual review. Never overwrites an existing (e.g. manual) row.
insert into public.rfid_checkpoint_role (lpi, role, source)
select lpi, role, 'inferred'
from (
  select lpi,
    case
      -- explicit AMU tag, no OE codes present
      when lower(coalesce(facility_type,'')) like '%amu%'
           and not (edi_equivalent_outbound = '2300' or edi_equivalent_inbound = '2420')
        then 'AMU'
      -- OE codes present, no AMU codes
      when (edi_equivalent_outbound = '2300' or edi_equivalent_inbound = '2420')
           and not (edi_equivalent_outbound in ('2310','2320')
                    or edi_equivalent_inbound in ('2400','2410'))
        then 'OE'
      -- AMU codes present, facility_type not literally 'OE'
      when (edi_equivalent_outbound in ('2310','2320')
            or edi_equivalent_inbound in ('2400','2410'))
           and lower(coalesce(facility_type,'')) <> 'oe'
        then 'AMU'
    end as role
  from public.vw_reader_master
  where edi_equivalent_outbound is not null
     or edi_equivalent_inbound is not null
     or facility_type ~* 'amu|oe'
) s
where s.role is not null
on conflict (lpi) do nothing;
