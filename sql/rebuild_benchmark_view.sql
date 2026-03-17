-- Rebuild benchmark_rfid_edi as a standard view
-- This ensures it is always up-to-date with the latest data from RFID and datos EDI

-- Step 1: Drop the existing materialized view
DROP MATERIALIZED VIEW IF EXISTS public.benchmark_rfid_edi;

-- Step 2: Create the new view
CREATE OR REPLACE VIEW public.benchmark_rfid_edi AS

WITH rfid_events AS (
    -- Aggregate RFID events by tag_id to get one row per receptacle
    SELECT
        tag_id,
        -- Origin events (first ORIGIN or DEPARTURE_FROM_CENTRE)
        MIN(CASE WHEN event_type IN (
            'ORIGIN',
            'DEPARTURE_FROM_CENTRE',
            'RFID_PREDES' -- legacy, but include for completeness
        ) THEN record_time END) AS rf_predes_time,
        
        MIN(CASE WHEN event_type IN (
            'DEPARTURE_FROM_CENTRE',
            'DEPARTURE' -- airport event
        ) THEN record_time END) AS rf_departure_time,

        -- Destination events (first ARRIVAL or ARRIVAL_AT_CENTRE)
        MIN(CASE WHEN event_type IN (
            'ARRIVAL_AT_CENTRE',
            'DESTINATION',
            'RFID_RESDES' -- legacy
        ) THEN record_time END) AS rf_resdes_time,

        MIN(CASE WHEN event_type = 'ARRIVAL' THEN record_time END) AS rf_arrival_time,

        -- Get origin/destination countries and centres from the first relevant event
        (array_agg(country ORDER BY record_time ASC) FILTER (WHERE event_type IN ('ORIGIN', 'DEPARTURE_FROM_CENTRE')))[1] AS rf_origin_country,
        (array_agg(center_name ORDER BY record_time ASC) FILTER (WHERE event_type IN ('ORIGIN', 'DEPARTURE_FROM_CENTRE')))[1] AS rf_origin_centre,
        (array_agg(impc_code ORDER BY record_time ASC) FILTER (WHERE event_type IN ('ORIGIN', 'DEPARTURE_FROM_CENTRE')))[1] AS rf_origin_impc,

        (array_agg(country ORDER BY record_time ASC) FILTER (WHERE event_type IN ('ARRIVAL_AT_CENTRE', 'DESTINATION')))[1] AS rf_dest_country,
        (array_agg(center_name ORDER BY record_time ASC) FILTER (WHERE event_type IN ('ARRIVAL_AT_CENTRE', 'DESTINATION')))[1] AS rf_dest_centre,
        (array_agg(impc_code ORDER BY record_time ASC) FILTER (WHERE event_type IN ('ARRIVAL_AT_CENTRE', 'DESTINATION')))[1] AS rf_dest_impc

    FROM public."RFID"
    GROUP BY tag_id
),

edi_data AS (
    -- Join "datos EDI" with "ID Relation" to link EDI data to tag_id
    SELECT
        ir.tagid AS tag_id,
        de.ean AS s9id,
        de.origin AS edi_origin_impc,
        de.destination AS edi_dest_impc,
        de.predes_time AS edi_predes_time,
        de.cardit_time AS edi_cardit_time,
        de.resdit74_time AS edi_resdit74_time,
        de.resdit74_impc AS edi_resdit74_impc,
        de.resdit21_time AS edi_resdit21_time,
        de.resdit21_impc AS edi_resdit21_impc,
        de.redes_time AS edi_resdes_time
    FROM public."datos EDI" de
    JOIN public."ID Relation" ir ON de.ean = ir.s9id
)

-- Final SELECT with FULL OUTER JOIN to include all receptacles from both sources
SELECT
    COALESCE(rfid.tag_id, edi.tag_id) AS tag_id,
    edi.s9id,

    -- EDI columns
    edi.edi_origin_impc,
    edi.edi_dest_impc,
    edi.edi_predes_time,
    edi.edi_cardit_time,
    edi.edi_resdit74_time,
    edi.edi_resdit74_impc,
    edi.edi_resdit21_time,
    edi.edi_resdit21_impc,
    edi.edi_resdes_time,

    -- RFID columns
    rfid.rf_predes_time,
    rfid.rf_origin_country,
    rfid.rf_origin_centre,
    rfid.rf_origin_impc,
    rfid.rf_resdes_time,
    rfid.rf_dest_country,
    rfid.rf_dest_centre,
    rfid.rf_dest_impc,
    rfid.rf_departure_time,
    rfid.rf_arrival_time,

    -- Calculated fields
    EXTRACT(EPOCH FROM (rfid.rf_arrival_time - rfid.rf_departure_time)) / 3600 AS rf_transit_hours,
    EXTRACT(EPOCH FROM (edi.edi_resdes_time - edi.edi_predes_time)) / 3600 AS edi_transit_hours,
    EXTRACT(EPOCH FROM (rfid.rf_predes_time - edi.edi_predes_time)) / 3600 AS delta_predes_hours,
    EXTRACT(EPOCH FROM (rfid.rf_resdes_time - edi.edi_resdes_time)) / 3600 AS delta_resdes_hours,

    -- Missing flags
    (edi.edi_cardit_time IS NULL) AS missing_cardit,
    (edi.edi_resdit74_time IS NULL) AS missing_resdit74,
    (edi.edi_resdit21_time IS NULL) AS missing_resdit21,
    (edi.edi_resdes_time IS NULL) AS missing_resdes,

    -- Has flags
    (rfid.rf_departure_time IS NOT NULL) AS has_rf_departure,
    (rfid.rf_arrival_time IS NOT NULL) AS has_rf_arrival,
    (rfid.rf_departure_time IS NOT NULL AND rfid.rf_arrival_time IS NOT NULL) AS has_rf_transit,
    (edi.edi_predes_time IS NOT NULL AND edi.edi_resdes_time IS NOT NULL) AS has_edi_transit

FROM rfid_events rfid
FULL OUTER JOIN edi_data edi ON rfid.tag_id = edi.tag_id;
