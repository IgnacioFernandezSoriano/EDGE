-- rfid_reprocess_scope — per-site movement selection + `sites` filter (2026-07-04)
-- Mirrors the selection logic of rfid_transform_run (sql/06_…); keep in sync.
-- New filter: p_filters->'sites' = array of site_impc_code to scope the reprocess.
-- Generated from the live Leg2 definition with only the documented edits applied.

CREATE OR REPLACE FUNCTION public.rfid_reprocess_scope(p_filters jsonb DEFAULT '{}'::jsonb, p_environment text DEFAULT 'production'::text, p_max_reads integer DEFAULT 50000, p_reason text DEFAULT 'manual_recalc'::text)
 RETURNS TABLE(reprocess_run_id uuid, etl_run_id uuid, status text, reads_matched_total bigint, reads_selected integer, reads_enriched integer, reads_still_blocked integer, affected_pairs integer, movements_upserted integer, incidents_created integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
    v_reprocess_run_id  uuid    := extensions.gen_random_uuid();
    v_etl_run_id        uuid    := extensions.gen_random_uuid();
    v_lock_acquired     boolean := false;

    v_from              timestamptz := nullif(p_filters->>'from','')::timestamptz;
    v_to                timestamptz := nullif(p_filters->>'to','')::timestamptz;
    v_readers           text[] := coalesce((select array_agg(e) from jsonb_array_elements_text(p_filters->'readers') e), '{}'::text[]);
    v_origin            text[] := coalesce((select array_agg(e) from jsonb_array_elements_text(p_filters->'origin_countries') e), '{}'::text[]);
    v_destination       text[] := coalesce((select array_agg(e) from jsonb_array_elements_text(p_filters->'destination_countries') e), '{}'::text[]);
    v_reader_countries  text[] := coalesce((select array_agg(e) from jsonb_array_elements_text(p_filters->'reader_countries') e), '{}'::text[]);
    v_tag_id            text   := nullif(btrim(coalesce(p_filters->>'tag_id','')),'');
    v_s9_id             text   := nullif(btrim(coalesce(p_filters->>'s9_id','')),'');
    v_sites             text[] := coalesce((select array_agg(e) from jsonb_array_elements_text(p_filters->'sites') e), '{}'::text[]);

    v_reads_matched_total bigint := 0;
    v_reads_selected      integer := 0;
    v_reads_renormalized  integer := 0;
    v_reads_enriched      integer := 0;
    v_reads_still_blocked integer := 0;
    v_affected_pairs      integer := 0;
    v_movements           integer := 0;
    v_incidents           integer := 0;
    v_rows                integer := 0;
begin
    if coalesce(p_max_reads, 0) > 100000 then
        return query select v_reprocess_run_id, null::uuid, 'failed'::text, 0::bigint, 0, 0, 0, 0, 0, 0,
                            'p_max_reads cannot exceed 100000'::text;
        return;
    end if;

    v_lock_acquired := pg_try_advisory_xact_lock(
        hashtext('rfid_reprocess_scope:' || coalesce(p_environment,'production'))
    );
    if not v_lock_acquired then
        insert into public.rfid_reprocess_audit(reprocess_run_id, status, max_reads, error_message, metadata, finished_at_utc)
        values (v_reprocess_run_id, 'skipped_locked', greatest(1, coalesce(p_max_reads, 50000)),
                'Another rfid_reprocess_scope run is active.',
                jsonb_build_object('scope','manual','reason',p_reason,'filters',p_filters),
                now());
        return query select v_reprocess_run_id, null::uuid, 'skipped_locked'::text, 0::bigint, 0, 0, 0, 0, 0, 0, null::text;
        return;
    end if;

    insert into public.rfid_etl_runs(run_id, environment, mode, status, started_at_utc, pages_requested, reads_received, reads_inserted)
    values (v_etl_run_id, coalesce(p_environment,'production'), 'manual', 'running', now(), 0, 0, 0);

    insert into public.rfid_reprocess_audit(reprocess_run_id, etl_run_id, status, max_reads, metadata)
    values (v_reprocess_run_id, v_etl_run_id, 'running', greatest(1, coalesce(p_max_reads, 50000)),
            jsonb_build_object('scope','manual','reason',p_reason,'filters',p_filters));

    select count(*) into v_reads_matched_total
    from public.rfid_edge_input_reads r
    where r.edge_id is not null
      and (v_from is null or r.event_datetime_utc >= v_from)
      and (v_to   is null or r.event_datetime_utc <= v_to)
      and (cardinality(v_readers)           = 0 or r.reader_id                = any(v_readers))
      and (cardinality(v_origin)            = 0 or r.origin_country_code      = any(v_origin))
      and (cardinality(v_destination)       = 0 or r.destination_country_code = any(v_destination))
      and (cardinality(v_reader_countries)  = 0 or r.reader_country_code      = any(v_reader_countries))
      and (v_tag_id is null or r.tag_id ilike '%' || v_tag_id || '%')
      and (v_s9_id  is null or r.s9_id  ilike '%' || v_s9_id  || '%')
      and (cardinality(v_sites) = 0 or r.site_impc_code = any(v_sites));

    create temporary table tmp_reprocess_reads on commit drop as
    select r.edge_id
    from public.rfid_edge_input_reads r
    where r.edge_id is not null
      and (v_from is null or r.event_datetime_utc >= v_from)
      and (v_to   is null or r.event_datetime_utc <= v_to)
      and (cardinality(v_readers)           = 0 or r.reader_id                = any(v_readers))
      and (cardinality(v_origin)            = 0 or r.origin_country_code      = any(v_origin))
      and (cardinality(v_destination)       = 0 or r.destination_country_code = any(v_destination))
      and (cardinality(v_reader_countries)  = 0 or r.reader_country_code      = any(v_reader_countries))
      and (v_tag_id is null or r.tag_id ilike '%' || v_tag_id || '%')
      and (v_s9_id  is null or r.s9_id  ilike '%' || v_s9_id  || '%')
      and (cardinality(v_sites) = 0 or r.site_impc_code = any(v_sites))
    order by coalesce(r.updated_at_utc, r.created_at_utc), r.edge_id
    limit greatest(1, coalesce(p_max_reads, 50000));

    select count(*) into v_reads_selected from tmp_reprocess_reads;

    if v_reads_selected = 0 then
        update public.rfid_reprocess_audit
        set status = 'skipped_empty', finished_at_utc = now(), updated_at_utc = now()
        where public.rfid_reprocess_audit.reprocess_run_id = v_reprocess_run_id;
        update public.rfid_etl_runs
        set status = 'success', finished_at_utc = now(), updated_at_utc = now()
        where run_id = v_etl_run_id;
        return query select v_reprocess_run_id, v_etl_run_id, 'skipped_empty'::text,
                            v_reads_matched_total, 0, 0, 0, 0, 0, 0, null::text;
        return;
    end if;

    update public.rfid_edge_input_reads r
    set tag_id    = coalesce(nullif(r.tag_id,''),    nullif(r.raw_payload->>'tagId',''),   nullif(r.raw_payload->>'tag_id',''),    nullif(r.raw_payload->>'tag',''),     nullif(r.raw_payload->>'epc','')),
        s9_id     = coalesce(nullif(r.s9_id,''),     nullif(r.raw_payload->>'s9Id',''),    nullif(r.raw_payload->>'s9_id',''),     nullif(r.raw_payload->>'s9',''),      nullif(r.raw_payload->>'postalId',''), nullif(r.raw_payload->>'postal_id','')),
        reader_id = coalesce(nullif(r.reader_id,''), nullif(r.raw_payload->>'readerId',''), nullif(r.raw_payload->>'reader_id',''), nullif(r.raw_payload->>'reader',''), nullif(r.raw_payload->>'lpi','')),
        updated_at_utc = now()
    from tmp_reprocess_reads t
    where r.edge_id = t.edge_id;
    get diagnostics v_reads_renormalized = row_count;

    update public.rfid_edge_input_reads r
    set origin_country_code = public.rfid_s9_origin_country(r.s9_id),
        destination_country_code = public.rfid_s9_destination_country(r.s9_id),
        enrichment_status = case
            when r.edge_id is null
              or r.tag_id is null or btrim(r.tag_id) = ''
              or r.s9_id is null or btrim(r.s9_id) = ''
              or not public.rfid_valid_s9_for_route(r.s9_id)
              or r.reader_id is null or btrim(r.reader_id) = ''
              or r.event_datetime_utc is null then 'invalid'
            when rm.lpi is null then 'unknown_reader'
            when not public.rfid_reader_is_leg2(rm.product, rm.raw_payload) then 'ignored_non_leg2_reader'
            else 'enriched'
        end,
        reader_country_code = coalesce(s.country_code, rm.reader_country_code),
        reader_country_name = s.country_name,
        reader_city = s.city,
        site_impc_code = s.site_impc_code,
        site_name = s.site_name,
        centre_code = coalesce(s.centre_code, s.site_impc_code, rm.site_id, r.reader_id),
        edi_equivalent_inbound = s.edi_equivalent_inbound,
        edi_equivalent_outbound = s.edi_equivalent_outbound,
        reader_timezone = coalesce(nullif(s.timezone, ''), 'UTC'),
        handover_point = case when public.rfid_reader_is_leg2(rm.product, rm.raw_payload) then coalesce(rm.handover_point, false) else false end,
        transform_status = case when rm.lpi is not null and not public.rfid_reader_is_leg2(rm.product, rm.raw_payload) then 'ignored_non_leg2_reader' else r.transform_status end,
        event_datetime_local = case
            when r.event_datetime_utc is null then null
            when public.rfid_reader_is_leg2(rm.product, rm.raw_payload) then r.event_datetime_utc at time zone coalesce(nullif(s.timezone, ''), 'UTC')
            else null
        end,
        run_id = v_etl_run_id,
        updated_at_utc = now()
    from tmp_reprocess_reads t
    join public.rfid_edge_input_reads base on base.edge_id = t.edge_id
    left join public.rfid_reader_master_snapshot rm on rm.lpi = base.reader_id
    left join public.rfid_site_snapshot s on s.site_id = rm.site_id
    where r.edge_id = t.edge_id;

    select count(*) into v_reads_enriched
    from public.rfid_edge_input_reads r
    join tmp_reprocess_reads t on t.edge_id = r.edge_id
    where r.enrichment_status = 'enriched';

    select count(*) into v_reads_still_blocked
    from public.rfid_edge_input_reads r
    join tmp_reprocess_reads t on t.edge_id = r.edge_id
    where r.enrichment_status in ('invalid','unknown_reader');

    create temporary table tmp_affected_pairs on commit drop as
    select distinct r.tag_id, r.s9_id
    from public.rfid_edge_input_reads r
    join tmp_reprocess_reads t on t.edge_id = r.edge_id
    where r.tag_id is not null
      and r.s9_id is not null;

    select count(*) into v_affected_pairs from tmp_affected_pairs;

    update public.rfid_etl_incidents i
    set status = 'resolved',
        resolved_at_utc = now(),
        resolution_run_id = v_etl_run_id,
        resolution_note = 'Resolved by manual recalc (rfid_reprocess_scope).'
    from tmp_reprocess_reads t
    join public.rfid_edge_input_reads r on r.edge_id = t.edge_id
    where i.source_edge_id = t.edge_id
      and coalesce(i.status,'open') in ('open','superseded')
      and r.enrichment_status = 'enriched'
      and r.tag_id is not null and btrim(r.tag_id) <> ''
      and r.s9_id is not null and btrim(r.s9_id) <> ''
      and public.rfid_valid_s9_for_route(r.s9_id)
      and r.reader_id is not null and btrim(r.reader_id) <> ''
      and r.event_datetime_utc is not null
      and i.incident_type in (
          'unknown_reader', 'missing_tag_id', 'missing_s9_id', 'missing_reader_id',
          'invalid_timestamp', 'invalid_s9_id_format', 'missing_edge_id'
      );

    update public.rfid_etl_incidents i
    set status = 'resolved',
        resolved_at_utc = now(),
        resolution_run_id = v_etl_run_id,
        resolution_note = 'Resolved by manual recalc: reader is no longer Leg2.'
    from tmp_reprocess_reads t
    join public.rfid_edge_input_reads r on r.edge_id = t.edge_id
    where i.source_edge_id = t.edge_id
      and coalesce(i.status,'open') in ('open','superseded')
      and r.enrichment_status = 'ignored_non_leg2_reader'
      and i.incident_type in (
          'unknown_reader', 'missing_tag_id', 'missing_s9_id', 'missing_reader_id',
          'invalid_timestamp', 'invalid_s9_id_format', 'missing_edge_id'
      );

    insert into public.rfid_etl_incidents(run_id, incident_type, source_edge_id, tag_id, s9_id, reader_id, event_datetime_utc, incident_description, severity, is_blocking, metadata, status)
    select v_etl_run_id, incident_type, edge_id, tag_id, s9_id, reader_id, event_datetime_utc, incident_description, 'error', true,
           jsonb_build_object('reprocess_run_id', v_reprocess_run_id, 'scope','manual'), 'open'
    from (
        select r.edge_id, r.tag_id, r.s9_id, r.reader_id, r.event_datetime_utc,
               case
                   when r.enrichment_status = 'ignored_non_leg2_reader' then null
                   when r.edge_id is null then 'missing_edge_id'
                   when r.tag_id is null or btrim(r.tag_id) = '' then 'missing_tag_id'
                   when r.s9_id is null or btrim(r.s9_id) = '' then 'missing_s9_id'
                   when not public.rfid_valid_s9_for_route(r.s9_id) then 'invalid_s9_id_format'
                   when r.reader_id is null or btrim(r.reader_id) = '' then 'missing_reader_id'
                   when r.event_datetime_utc is null then 'invalid_timestamp'
                   when r.enrichment_status = 'unknown_reader' then 'unknown_reader'
                   else null
               end as incident_type,
               case
                   when r.enrichment_status = 'ignored_non_leg2_reader' then null
                   when r.edge_id is null then 'EDGE read has no id.'
                   when r.tag_id is null or btrim(r.tag_id) = '' then 'EDGE read has no tagId.'
                   when r.s9_id is null or btrim(r.s9_id) = '' then 'EDGE read has no s9Id.'
                   when not public.rfid_valid_s9_for_route(r.s9_id) then 'S9 id does not allow origin/destination parsing.'
                   when r.reader_id is null or btrim(r.reader_id) = '' then 'EDGE read has no readerId.'
                   when r.event_datetime_utc is null then 'EDGE read has no valid timestamp.'
                   when r.enrichment_status = 'unknown_reader' then 'Reader was not found in reader master snapshot.'
                   else null
               end as incident_description
        from public.rfid_edge_input_reads r
        join tmp_reprocess_reads t on t.edge_id = r.edge_id
    ) x
    where incident_type is not null
      and not exists (
          select 1 from public.rfid_etl_incidents i
          where i.source_edge_id = x.edge_id
            and i.incident_type = x.incident_type
            and coalesce(i.status,'open') = 'open'
      );
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
        select tag_id, s9_id, read_cc as movement_country_code, min(origin_cc) as origin_cc, min(dest_cc) as dest_cc,
               dense_rank() over (partition by tag_id, s9_id order by min(event_datetime_utc)) as country_sequence_number
        from valid_reads
        group by tag_id, s9_id, read_cc
    ), candidates as (
        select 'OUTBOUND'::varchar as movement_type, 'ORIGIN'::text as route_country_role, c.country_sequence_number,
               r.*, c.origin_cc as candidate_origin_cc, c.dest_cc as candidate_dest_cc, c.movement_country_code,
               row_number() over (partition by r.tag_id, r.s9_id, c.movement_country_code, coalesce(r.site_impc_code, r.centre_code, r.reader_id) order by r.event_datetime_utc desc, r.edge_id desc) as rn
        from valid_reads r
        join country_groups c on c.tag_id = r.tag_id and c.s9_id = r.s9_id and c.movement_country_code = r.read_cc
        where c.movement_country_code = c.origin_cc
        union all
        select 'TRANSIT_ENTRY'::varchar, 'TRANSIT'::text, c.country_sequence_number,
               r.*, c.origin_cc, c.dest_cc, c.movement_country_code,
               row_number() over (partition by r.tag_id, r.s9_id, c.movement_country_code, coalesce(r.site_impc_code, r.centre_code, r.reader_id) order by r.event_datetime_utc asc, r.edge_id asc)
        from valid_reads r
        join country_groups c on c.tag_id = r.tag_id and c.s9_id = r.s9_id and c.movement_country_code = r.read_cc
        where c.movement_country_code <> c.origin_cc and c.movement_country_code <> c.dest_cc
        union all
        select 'TRANSIT_EXIT'::varchar, 'TRANSIT'::text, c.country_sequence_number,
               r.*, c.origin_cc, c.dest_cc, c.movement_country_code,
               row_number() over (partition by r.tag_id, r.s9_id, c.movement_country_code, coalesce(r.site_impc_code, r.centre_code, r.reader_id) order by r.event_datetime_utc desc, r.edge_id desc)
        from valid_reads r
        join country_groups c on c.tag_id = r.tag_id and c.s9_id = r.s9_id and c.movement_country_code = r.read_cc
        where c.movement_country_code <> c.origin_cc and c.movement_country_code <> c.dest_cc
        union all
        select 'INBOUND'::varchar, 'DESTINATION'::text, c.country_sequence_number,
               r.*, c.origin_cc, c.dest_cc, c.movement_country_code,
               row_number() over (partition by r.tag_id, r.s9_id, c.movement_country_code, coalesce(r.site_impc_code, r.centre_code, r.reader_id) order by r.event_datetime_utc asc, r.edge_id asc)
        from valid_reads r
        join country_groups c on c.tag_id = r.tag_id and c.s9_id = r.s9_id and c.movement_country_code = r.read_cc
        where c.movement_country_code = c.dest_cc
    ), selected as (
        select *,
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
           edge_id, v_etl_run_id, tag_id, s9_id, movement_type, route_country_role,
           candidate_origin_cc, candidate_dest_cc, movement_country_code, country_sequence_number,
           event_datetime_utc,
           coalesce(event_datetime_local, (event_datetime_utc at time zone coalesce(reader_timezone,'UTC'))),
           reader_id, site_impc_code, site_name, movement_country_code,
           reader_country_name, reader_city,
           case when movement_type in ('OUTBOUND','TRANSIT_EXIT') then edi_equivalent_outbound else edi_equivalent_inbound end,
           coalesce(handover_point,false), handover_quality_status,
           coalesce(centre_code, site_impc_code), coalesce(reader_timezone,'UTC'), now(), now()
    from selected;
    get diagnostics v_movements = row_count;

    insert into public.rfid_etl_incidents(run_id, incident_type, source_edge_id, tag_id, s9_id, reader_id, event_datetime_utc, incident_description, severity, is_blocking, movement_type, route_country_role, movement_country_code, metadata, status)
    select v_etl_run_id, handover_quality_status, source_edge_id, tag_id, s9_id, reader_id, event_datetime_utc,
           'Movement selected without a configured handover point. Review reader configuration or missing physical handover read.',
           'warning', false, movement_type, route_country_role, movement_country_code,
           jsonb_build_object('handover_point', handover_point, 'reprocess_run_id', v_reprocess_run_id, 'scope','manual'), 'open'
    from public.rfid_report_movements m
    where m.source_run_id = v_etl_run_id
      and m.handover_quality_status <> 'handover_ok'
      and not exists (
          select 1 from public.rfid_etl_incidents i
          where i.source_edge_id = m.source_edge_id
            and i.incident_type = m.handover_quality_status
            and coalesce(i.movement_type,'') = coalesce(m.movement_type,'')
            and coalesce(i.route_country_role,'') = coalesce(m.route_country_role,'')
            and coalesce(i.movement_country_code,'') = coalesce(m.movement_country_code,'')
            and i.status = 'open'
            and coalesce(i.is_blocking,false) = false
      );
    get diagnostics v_rows = row_count;
    v_incidents := v_incidents + v_rows;

    update public.rfid_edge_input_reads r
    set transform_status = case
            when r.enrichment_status = 'enriched' then 'processed'
            when r.enrichment_status = 'ignored_non_leg2_reader' then 'ignored_non_leg2_reader'
            else 'blocked'
        end,
        updated_at_utc = now()
    from tmp_reprocess_reads t
    where r.edge_id = t.edge_id;

    update public.rfid_etl_runs
    set status = 'success', finished_at_utc = now(),
        reads_received = v_reads_selected, reads_inserted = v_reads_selected,
        affected_pairs = v_affected_pairs, movements_upserted = v_movements,
        incidents_created = v_incidents, updated_at_utc = now()
    where run_id = v_etl_run_id;

    update public.rfid_reprocess_audit
    set status = 'success', finished_at_utc = now(),
        reads_selected = v_reads_selected, reads_renormalized = v_reads_renormalized,
        reads_enriched = v_reads_enriched, reads_still_blocked = v_reads_still_blocked,
        affected_pairs = v_affected_pairs, movements_upserted = v_movements,
        incidents_created = v_incidents,
        metadata = metadata || jsonb_build_object('reads_matched_total', v_reads_matched_total),
        updated_at_utc = now()
    where public.rfid_reprocess_audit.reprocess_run_id = v_reprocess_run_id;

    return query select v_reprocess_run_id, v_etl_run_id, 'success'::text,
                        v_reads_matched_total, v_reads_selected, v_reads_enriched, v_reads_still_blocked,
                        v_affected_pairs, v_movements, v_incidents, null::text;

exception when others then
    update public.rfid_etl_runs
    set status = 'failed', finished_at_utc = now(), error_message = sqlerrm, updated_at_utc = now()
    where run_id = v_etl_run_id;

    update public.rfid_reprocess_audit
    set status = 'failed', finished_at_utc = now(), error_message = sqlerrm, updated_at_utc = now()
    where public.rfid_reprocess_audit.reprocess_run_id = v_reprocess_run_id;

    return query select v_reprocess_run_id, v_etl_run_id, 'failed'::text,
                        v_reads_matched_total, v_reads_selected, v_reads_enriched, v_reads_still_blocked,
                        v_affected_pairs, v_movements, v_incidents, sqlerrm::text;
end;
$function$

