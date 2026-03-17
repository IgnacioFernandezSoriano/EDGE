-- ============================================================
-- Fix: rfid_kpi_counts — apply p_origin_country / p_dest_country filters
-- Run this in Supabase SQL Editor to replace the existing function.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rfid_kpi_counts(
  p_date_from     text DEFAULT NULL,
  p_date_to       text DEFAULT NULL,
  p_origin_country text DEFAULT NULL,
  p_dest_country   text DEFAULT NULL
)
RETURNS TABLE (
  total_tags      bigint,
  rfid_departures bigint,
  rf_predes       bigint,
  rf_resdes       bigint,
  rfid_arrivals   bigint,
  rf_e2e          bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_date_from  date := CASE WHEN p_date_from IS NOT NULL THEN p_date_from::date ELSE NULL END;
  v_date_to    date := CASE WHEN p_date_to   IS NOT NULL THEN p_date_to::date   ELSE NULL END;
BEGIN
  RETURN QUERY
  WITH
  -- All RFID rows matching date range (no country filter yet)
  base AS (
    SELECT
      r.tag_id,
      r.s9id,
      r.event_type,
      r.country,
      r.event_time_local::date AS event_date
    FROM "RFID" r
    WHERE
      (v_date_from IS NULL OR r.event_time_local::date >= v_date_from)
      AND (v_date_to   IS NULL OR r.event_time_local::date <= v_date_to)
  ),

  -- Per tag: identify origin country (ORIGIN event, else DEPARTURE)
  tag_origin AS (
    SELECT DISTINCT ON (tag_id)
      tag_id,
      country AS origin_country
    FROM base
    WHERE event_type IN ('ORIGIN', 'DEPARTURE')
    ORDER BY tag_id,
      CASE event_type WHEN 'ORIGIN' THEN 1 WHEN 'DEPARTURE' THEN 2 ELSE 3 END
  ),

  -- Per tag: identify destination country (DESTINATION event, else ARRIVAL)
  tag_dest AS (
    SELECT DISTINCT ON (tag_id)
      tag_id,
      country AS dest_country
    FROM base
    WHERE event_type IN ('DESTINATION', 'ARRIVAL')
    ORDER BY tag_id,
      CASE event_type WHEN 'DESTINATION' THEN 1 WHEN 'ARRIVAL' THEN 2 ELSE 3 END
  ),

  -- Tags that pass the country filter
  filtered_tags AS (
    SELECT b.tag_id
    FROM (SELECT DISTINCT tag_id FROM base) b
    LEFT JOIN tag_origin o ON o.tag_id = b.tag_id
    LEFT JOIN tag_dest   d ON d.tag_id = b.tag_id
    WHERE
      (p_origin_country IS NULL OR o.origin_country = p_origin_country)
      AND (p_dest_country   IS NULL OR d.dest_country   = p_dest_country)
  ),

  -- Filtered RFID rows
  filtered AS (
    SELECT b.*
    FROM base b
    INNER JOIN filtered_tags ft ON ft.tag_id = b.tag_id
  ),

  -- Unique tags with each event type
  counts AS (
    SELECT
      COUNT(DISTINCT tag_id)                                                       AS total_tags,
      COUNT(DISTINCT CASE WHEN event_type IN ('ORIGIN','DEPARTURE')    THEN tag_id END) AS rfid_departures,
      COUNT(DISTINCT CASE WHEN event_type = 'DEPARTURE'                THEN tag_id END) AS rf_predes,
      COUNT(DISTINCT CASE WHEN event_type = 'ARRIVAL'                  THEN tag_id END) AS rf_resdes,
      COUNT(DISTINCT CASE WHEN event_type IN ('DESTINATION','ARRIVAL') THEN tag_id END) AS rfid_arrivals,
      COUNT(DISTINCT CASE WHEN event_type = 'DESTINATION'              THEN tag_id END) AS rf_e2e_dest
    FROM filtered
  ),

  -- E2E: tags that have both a departure-side AND arrival-side event
  e2e AS (
    SELECT COUNT(DISTINCT d.tag_id) AS rf_e2e
    FROM (SELECT DISTINCT tag_id FROM filtered WHERE event_type IN ('ORIGIN','DEPARTURE'))    d
    JOIN (SELECT DISTINCT tag_id FROM filtered WHERE event_type IN ('DESTINATION','ARRIVAL')) a
      ON a.tag_id = d.tag_id
  )

  SELECT
    c.total_tags,
    c.rfid_departures,
    c.rf_predes,
    c.rf_resdes,
    c.rfid_arrivals,
    e.rf_e2e
  FROM counts c, e2e e;
END;
$$;

-- Grant execute to authenticated and anon roles
GRANT EXECUTE ON FUNCTION public.rfid_kpi_counts(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rfid_kpi_counts(text, text, text, text) TO anon;
