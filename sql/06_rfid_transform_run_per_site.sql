-- rfid_transform_run — per-site movement selection (2026-07-07)
-- Entry (first read) + exit (last read) representative per (tag, s9, country, SITE).
-- edi_equivalent = matrix(role, leg, entry/exit) via rfid_checkpoint_role + ref_checkpoint_code;
-- transit ⇒ NULL; unclassified (role NULL) origin/destination fall back to the legacy
-- per-reader edi_equivalent_{inbound,outbound} for the leg representative only.
-- NOTE: identical candidate/selection/resolution logic is duplicated in rfid_reprocess_scope
-- (sql/07_…); keep in sync (only the run-id variable differs).

CREATE OR REPLACE FUNCTION public.rfid_transform_run(p_run_id uuid)
 RETURNS TABLE(affected_pairs integer, movements_upserted integer, incidents_created integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
    v_affected_pairs integer := 0;
    v_movements integer := 0;
    v_incidents integer := 0;
begin
    create temporary table tmp_affected_pairs on commit drop as
    select distinct tag_id, s9_id
    from public.rfid_edge_input_reads
    where run_id = p_run_id
      and tag_id is not null
      and s9_id is not null;

    select count(*) into v_affected_pairs from tmp_affected_pairs;

    -- Blocking incidents for new Leg2-scope reads only. Non-Leg2 readers are ignored, not reported as errors.
    insert into public.rfid_etl_incidents(
        run_id, incident_type, source_edge_id, tag_id, s9_id, reader_id,
        event_datetime_utc, incident_description, severity, is_blocking, metadata
    )
    select p_run_id, incident_type, edge_id, tag_id, s9_id, reader_id,
           event_datetime_utc, incident_description, 'error', true, '{}'::jsonb
    from (
        select edge_id, tag_id, s9_id, reader_id, event_datetime_utc,
               case
                   when enrichment_status = 'ignored_non_leg2_reader' then null
                   when edge_id is null then 'missing_edge_id'
                   when tag_id is null or btrim(tag_id) = '' then 'missing_tag_id'
                   when s9_id is null or btrim(s9_id) = '' then 'missing_s9_id'
                   when not public.rfid_valid_s9_for_route(s9_id) then 'invalid_s9_id_format'
                   when reader_id is null or btrim(reader_id) = '' then 'missing_reader_id'
                   when event_datetime_utc is null then 'invalid_timestamp'
                   when enrichment_status = 'unknown_reader' then 'unknown_reader'
                   else null
               end as incident_type,
               case
                   when enrichment_status = 'ignored_non_leg2_reader' then null
                   when edge_id is null then 'EDGE read has no id.'
                   when tag_id is null or btrim(tag_id) = '' then 'EDGE read has no tagId.'
                   when s9_id is null or btrim(s9_id) = '' then 'EDGE read has no s9Id.'
                   when not public.rfid_valid_s9_for_route(s9_id) then 'S9 id does not allow origin/destination parsing.'
                   when reader_id is null or btrim(reader_id) = '' then 'EDGE read has no readerId.'
                   when event_datetime_utc is null then 'EDGE read has no valid timestamp.'
                   when enrichment_status = 'unknown_reader' then 'Reader was not found in reader master snapshot.'
                   else null
               end as incident_description
        from public.rfid_edge_input_reads
        where run_id = p_run_id
    ) x
    where incident_type is not null;

    get diagnostics v_incidents = row_count;

    delete from public.rfid_report_movements m
    using tmp_affected_pairs p
    where m.tag_id = p.tag_id
      and m.s9_id = p.s9_id;

    with valid_reads as (
        select r.*,
               public.rfid_s9_origin_country(r.s9_id) as origin_cc,
               public.rfid_s9_destination_country(r.s9_id) as dest_cc,
               coalesce(r.reader_country_code, r.origin_country_code, r.destination_country_code) as read_cc
        from public.rfid_edge_input_reads r
        join tmp_affected_pairs p on p.tag_id = r.tag_id and p.s9_id = r.s9_id
        where r.edge_id is not null
          and r.tag_id is not null
          and r.s9_id is not null
          and public.rfid_valid_s9_for_route(r.s9_id)
          and r.reader_id is not null
          and r.event_datetime_utc is not null
          and r.enrichment_status = 'enriched'
          and coalesce(r.reader_country_code, r.origin_country_code, r.destination_country_code) is not null
    ), country_groups as (
        select tag_id,
               s9_id,
               read_cc as movement_country_code,
               min(origin_cc) as origin_cc,
               min(dest_cc) as dest_cc,
               dense_rank() over (partition by tag_id, s9_id order by min(event_datetime_utc)) as country_sequence_number
        from valid_reads
        group by tag_id, s9_id, read_cc
    ), candidates as (
        -- entry (first read) + exit (last read) per (tag, s9, country, site).
        -- leg from country role; movement_type keeps existing literals (frontend keys on them).
        select 'entry'::text as direction,
               case when c.movement_country_code = c.origin_cc then 'outbound'
                    when c.movement_country_code = c.dest_cc   then 'inbound'
                    else 'transit' end as leg,
               (case when c.movement_country_code = c.origin_cc then 'OUTBOUND'
                     when c.movement_country_code = c.dest_cc   then 'INBOUND'
                     else 'TRANSIT_ENTRY' end)::varchar as movement_type,
               case when c.movement_country_code = c.origin_cc then 'ORIGIN'
                    when c.movement_country_code = c.dest_cc   then 'DESTINATION'
                    else 'TRANSIT' end as route_country_role,
               c.country_sequence_number,
               r.*, c.origin_cc as candidate_origin_cc, c.dest_cc as candidate_dest_cc, c.movement_country_code,
               row_number() over (partition by r.tag_id, r.s9_id, c.movement_country_code, coalesce(r.site_impc_code, r.centre_code, r.reader_id) order by r.event_datetime_utc asc, r.edge_id asc) as rn
        from valid_reads r
        join country_groups c on c.tag_id = r.tag_id and c.s9_id = r.s9_id and c.movement_country_code = r.read_cc
        union all
        select 'exit'::text,
               case when c.movement_country_code = c.origin_cc then 'outbound'
                    when c.movement_country_code = c.dest_cc   then 'inbound'
                    else 'transit' end,
               (case when c.movement_country_code = c.origin_cc then 'OUTBOUND'
                     when c.movement_country_code = c.dest_cc   then 'INBOUND'
                     else 'TRANSIT_EXIT' end)::varchar,
               case when c.movement_country_code = c.origin_cc then 'ORIGIN'
                    when c.movement_country_code = c.dest_cc   then 'DESTINATION'
                    else 'TRANSIT' end,
               c.country_sequence_number,
               r.*, c.origin_cc, c.dest_cc, c.movement_country_code,
               row_number() over (partition by r.tag_id, r.s9_id, c.movement_country_code, coalesce(r.site_impc_code, r.centre_code, r.reader_id) order by r.event_datetime_utc desc, r.edge_id desc)
        from valid_reads r
        join country_groups c on c.tag_id = r.tag_id and c.s9_id = r.s9_id and c.movement_country_code = r.read_cc
    ), ranked as (
        select *,
               (direction = case when leg = 'inbound' then 'entry' else 'exit' end) as is_rep
        from candidates where rn = 1
    ), site_picks as (
        -- entry-pick vs exit-pick per site. Collapse when they are the same physical
        -- detection (same reader at the same instant: single-read sites AND duplicate
        -- reads) to avoid a business-key clash on
        -- (tag_id, s9_id, movement_type, event_datetime_utc, reader_id).
        select tag_id, s9_id, movement_country_code,
               coalesce(site_impc_code, centre_code, reader_id) as site_key,
               max(reader_id)          filter (where direction = 'entry') as entry_reader,
               max(event_datetime_utc) filter (where direction = 'entry') as entry_ts,
               max(reader_id)          filter (where direction = 'exit')  as exit_reader,
               max(event_datetime_utc) filter (where direction = 'exit')  as exit_ts
        from ranked
        group by tag_id, s9_id, movement_country_code, coalesce(site_impc_code, centre_code, reader_id)
    ), selected as (
        -- Emit both entry & exit for classified readers and for transit (keeps the timeline);
        -- for unclassified (role NULL) origin/destination keep only the leg representative.
        -- A single physical read (entry_edge = exit_edge) collapses to the representative.
        select rk.*,
               rr.role as checkpoint_role,
               case
                   when coalesce(rk.handover_point,false) then 'handover_ok'
                   else 'non_handover_selected_for_' || lower(rk.route_country_role) || '_' || rk.direction
               end as handover_quality_status
        from ranked rk
        join site_picks sp
          on sp.tag_id = rk.tag_id and sp.s9_id = rk.s9_id
         and sp.movement_country_code = rk.movement_country_code
         and sp.site_key = coalesce(rk.site_impc_code, rk.centre_code, rk.reader_id)
        left join public.rfid_checkpoint_role rr on rr.lpi = rk.reader_id
        where ( rk.is_rep or rk.leg = 'transit' or rr.role is not null )
          and not (sp.entry_reader = sp.exit_reader and sp.entry_ts = sp.exit_ts and not rk.is_rep)
    )
    insert into public.rfid_report_movements(
        movement_id, source_edge_id, source_run_id, tag_id, s9_id, movement_type, route_country_role,
        origin_country_code, destination_country_code, movement_country_code, country_sequence_number,
        event_datetime_utc, event_datetime_local, reader_id, site_impc_code, site_name, country_code,
        country_name, city, edi_equivalent, handover_point, handover_quality_status,
        centre_code, reader_timezone, created_at_utc, updated_at_utc
    )
    select public.rfid_make_movement_id(s.edge_id, s.movement_type, s.movement_country_code),
           s.edge_id, p_run_id, s.tag_id, s.s9_id, s.movement_type, s.route_country_role,
           s.candidate_origin_cc, s.candidate_dest_cc, s.movement_country_code, s.country_sequence_number,
           s.event_datetime_utc,
           coalesce(s.event_datetime_local, (s.event_datetime_utc at time zone coalesce(s.reader_timezone,'UTC'))),
           s.reader_id, s.site_impc_code, s.site_name, s.movement_country_code,
           s.reader_country_name, s.reader_city,
           coalesce(
               cc.code,
               case when s.checkpoint_role is null then
                   case when s.leg = 'outbound' and s.direction = 'exit'  then s.edi_equivalent_outbound
                        when s.leg = 'inbound'  and s.direction = 'entry' then s.edi_equivalent_inbound
                        else null end
               end
           ),
           coalesce(s.handover_point,false), s.handover_quality_status,
           coalesce(s.centre_code, s.site_impc_code), coalesce(s.reader_timezone,'UTC'), now(), now()
    from selected s
    left join public.ref_checkpoint_code cc
      on cc.role = s.checkpoint_role and cc.leg = s.leg and cc.direction = s.direction;

    get diagnostics v_movements = row_count;

    insert into public.rfid_etl_incidents(
        run_id, incident_type, source_edge_id, tag_id, s9_id, reader_id, event_datetime_utc,
        incident_description, severity, is_blocking, movement_type, route_country_role,
        movement_country_code, metadata
    )
    select p_run_id, handover_quality_status, source_edge_id, tag_id, s9_id, reader_id, event_datetime_utc,
           'Movement selected without a configured handover point. Review reader configuration or missing physical handover read.',
           'warning', false, movement_type, route_country_role, movement_country_code,
           jsonb_build_object('handover_point', handover_point)
    from public.rfid_report_movements
    where source_run_id = p_run_id
      and handover_quality_status <> 'handover_ok';

    get diagnostics v_incidents = row_count;

    update public.rfid_edge_input_reads r
    set transform_status = case when r.enrichment_status = 'ignored_non_leg2_reader' then 'ignored_non_leg2_reader' else 'processed' end,
        updated_at_utc = now()
    from tmp_affected_pairs p
    where r.tag_id = p.tag_id and r.s9_id = p.s9_id;

    update public.rfid_etl_runs
    set affected_pairs = v_affected_pairs,
        movements_upserted = v_movements,
        incidents_created = public.rfid_etl_runs.incidents_created + v_incidents,
        updated_at_utc = now()
    where run_id = p_run_id;

    return query select v_affected_pairs, v_movements, v_incidents;
end;
$function$
