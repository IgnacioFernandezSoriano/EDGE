-- ATAT: allow the authenticated report role to read EDI data.
-- edi_events/edi_details have RLS enabled with anon-only policies; the app
-- queries as `authenticated`, which otherwise returns zero rows.
-- Project: EDGE Leg2 (ubgatxfwpmyaqyfrwias).

-- Idempotent: safe to re-apply (this file is the checked-in record of a
-- manual Leg2 write; no migration harness tracks Leg2 in this repo).
drop policy if exists authenticated_select_edi_events on public.edi_events;
create policy authenticated_select_edi_events
  on public.edi_events
  for select
  to authenticated
  using (true);

drop policy if exists authenticated_select_edi_details on public.edi_details;
create policy authenticated_select_edi_details
  on public.edi_details
  for select
  to authenticated
  using (true);
