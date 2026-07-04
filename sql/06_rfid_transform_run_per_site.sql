-- rfid_transform_run — per-site movement selection (2026-07-04)
-- Representative per (tag, s9, country, SITE) by time (last=outbound/exit, first=inbound/entry).
-- Handover flag no longer participates in selection. Movements with NULL edi_equivalent are published.
-- NOTE: identical selection logic is duplicated in rfid_reprocess_scope (sql/07_…); keep in sync.
-- Generated from the live Leg2 definition with only the partition/order edits applied.

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
        select 'OUTBOUND'::varchar as movement_type,
               'ORIGIN'::text as route_country_role,
               c.country_sequence_number,
               r.edge_id, r.tag_id, r.s9_id, r.origin_cc, r.dest_cc, c.movement_country_code,
               r.event_datetime_utc, r.event_datetime_local, r.reader_id, r.site_impc_code, r.site_name,
               r.reader_country_name, r.reader_city, r.edi_equivalent_outbound, r.edi_equivalent_inbound,
               r.handover_point, r.centre_code, r.reader_timezone,
               row_number() over (partition by r.tag_id, r.s9_id, c.movement_country_code, coalesce(r.site_impc_code, r.centre_code, r.reader_id) order by r.event_datetime_utc desc, r.edge_id desc) as rn
        from valid_reads r
        join country_groups c on c.tag_id = r.tag_id and c.s9_id = r.s9_id and c.movement_country_code = r.read_cc
        where c.movement_country_code = c.origin_cc
        union all
        select 'TRANSIT_ENTRY'::varchar, 'TRANSIT'::text, c.country_sequence_number,
               r.edge_id, r.tag_id, r.s9_id, r.origin_cc, r.dest_cc, c.movement_country_code,
               r.event_datetime_utc, r.event_datetime_local, r.reader_id, r.site_impc_code, r.site_name,
               r.reader_country_name, r.reader_city, r.edi_equivalent_outbound, r.edi_equivalent_inbound,
               r.handover_point, r.centre_code, r.reader_timezone,
               row_number() over (partition by r.tag_id, r.s9_id, c.movement_country_code, coalesce(r.site_impc_code, r.centre_code, r.reader_id) order by r.event_datetime_utc asc, r.edge_id asc) as rn
        from valid_reads r
        join country_groups c on c.tag_id = r.tag_id and c.s9_id = r.s9_id and c.movement_country_code = r.read_cc
        where c.movement_country_code <> c.origin_cc and c.movement_country_code <> c.dest_cc
        union all
        select 'TRANSIT_EXIT'::varchar, 'TRANSIT'::text, c.country_sequence_number,
               r.edge_id, r.tag_id, r.s9_id, r.origin_cc, r.dest_cc, c.movement_country_code,
               r.event_datetime_utc, r.event_datetime_local, r.reader_id, r.site_impc_code, r.site_name,
               r.reader_country_name, r.reader_city, r.edi_equivalent_outbound, r.edi_equivalent_inbound,
               r.handover_point, r.centre_code, r.reader_timezone,
               row_number() over (partition by r.tag_id, r.s9_id, c.movement_country_code, coalesce(r.site_impc_code, r.centre_code, r.reader_id) order by r.event_datetime_utc desc, r.edge_id desc) as rn
        from valid_reads r
        join country_groups c on c.tag_id = r.tag_id and c.s9_id = r.s9_id and c.movement_country_code = r.read_cc
        where c.movement_country_code <> c.origin_cc and c.movement_country_code <> c.dest_cc
        union all
        select 'INBOUND'::varchar, 'DESTINATION'::text, c.country_sequence_number,
               r.edge_id, r.tag_id, r.s9_id, r.origin_cc, r.dest_cc, c.movement_country_code,
               r.event_datetime_utc, r.event_datetime_local, r.reader_id, r.site_impc_code, r.site_name,
               r.reader_country_name, r.reader_city, r.edi_equivalent_outbound, r.edi_equivalent_inbound,
               r.handover_point, r.centre_code, r.reader_timezone,
               row_number() over (partition by r.tag_id, r.s9_id, c.movement_country_code, coalesce(r.site_impc_code, r.centre_code, r.reader_id) order by r.event_datetime_utc asc, r.edge_id asc) as rn
        from valid_reads r
        join country_groups c on c.tag_id = r.tag_id and c.s9_id = r.s9_id and c.movement_country_code = r.read_cc
        where c.movement_country_code = c.dest_cc
    ), selected as (
        select candidates.*,
               case
                   when coalesce(handover_point,false) then 'handover_ok'
                   when movement_type = 'OUTBOUND' then 'non_handover_selected_for_origin_exit'
                   when movement_type = 'TRANSIT_ENTRY' then 'non_handover_selected_for_transit_entry'
                   when movement_type = 'TRANSIT_EXIT' then 'non_handover_selected_for_transit_exit'
                   when movement_type = 'INBOUND' then 'non_handover_selected_for_destination_entry'
                   else 'unknown'
               end as handover_quality_status
        from candidates
        where rn = 1
    )
    insert into public.rfid_report_movements(
        movement_id, source_edge_id, source_run_id, tag_id, s9_id, movement_type, route_country_role,
        origin_country_code, destination_country_code, movement_country_code, country_sequence_number,
        event_datetime_utc, event_datetime_local, reader_id, site_impc_code, site_name, country_code,
        country_name, city, edi_equivalent, handover_point, handover_quality_status,
        centre_code, reader_timezone, created_at_utc, updated_at_utc
    )
    select public.rfid_make_movement_id(edge_id, movement_type, movement_country_code),
           edge_id, p_run_id, tag_id, s9_id, movement_type, route_country_role,
           origin_cc, dest_cc, movement_country_code, country_sequence_number,
           event_datetime_utc,
           coalesce(event_datetime_local, (event_datetime_utc at time zone coalesce(reader_timezone,'UTC'))),
           reader_id, site_impc_code, site_name, movement_country_code,
           reader_country_name, reader_city,
           case when movement_type in ('OUTBOUND','TRANSIT_EXIT') then edi_equivalent_outbound else edi_equivalent_inbound end,
           coalesce(handover_point,false), handover_quality_status,
           coalesce(centre_code, site_impc_code), coalesce(reader_timezone,'UTC'), now(), now()
    from selected;

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

