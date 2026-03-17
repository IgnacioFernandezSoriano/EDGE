-- ============================================================
-- EDGE — Refresh benchmark_rfid_edi materialized view
-- Run this script once in the Supabase SQL Editor to:
--   1. Create the RPC function callable from the frontend
--   2. Schedule a daily automatic refresh via pg_cron
-- ============================================================

-- ── 1. RPC function: refresh_benchmark_view ─────────────────
-- Callable from the frontend with supabase.rpc('refresh_benchmark_view')
-- Restricted to authenticated users with role = 'admin' via RLS policy.
CREATE OR REPLACE FUNCTION public.refresh_benchmark_view()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start  timestamptz := clock_timestamp();
  v_end    timestamptz;
  v_ms     int;
BEGIN
  -- Only allow admin users
  IF (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  REFRESH MATERIALIZED VIEW CONCURRENTLY public.benchmark_rfid_edi;

  v_end := clock_timestamp();
  v_ms  := EXTRACT(MILLISECONDS FROM (v_end - v_start))::int
         + EXTRACT(SECONDS      FROM (v_end - v_start))::int * 1000
         + EXTRACT(MINUTES      FROM (v_end - v_start))::int * 60000;

  RETURN json_build_object(
    'success',      true,
    'refreshed_at', v_end,
    'duration_ms',  v_ms
  );
END;
$$;

-- Grant execute to authenticated users (the function itself checks admin role)
GRANT EXECUTE ON FUNCTION public.refresh_benchmark_view() TO authenticated;

-- ── 2. pg_cron: daily refresh at 02:00 UTC ──────────────────
-- Requires the pg_cron extension to be enabled in Supabase
-- (Dashboard → Database → Extensions → pg_cron → Enable)
--
-- If pg_cron is already enabled, run:
SELECT cron.schedule(
  'refresh-benchmark-daily',          -- job name (unique)
  '0 2 * * *',                        -- cron expression: every day at 02:00 UTC
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.benchmark_rfid_edi$$
);

-- ── 3. Verify the cron job was created ──────────────────────
-- SELECT * FROM cron.job WHERE jobname = 'refresh-benchmark-daily';

-- ── Notes ────────────────────────────────────────────────────
-- To manually refresh from SQL Editor at any time:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY public.benchmark_rfid_edi;
--
-- To remove the cron job:
--   SELECT cron.unschedule('refresh-benchmark-daily');
--
-- To check last run status:
--   SELECT * FROM cron.job_run_details WHERE jobid = (
--     SELECT jobid FROM cron.job WHERE jobname = 'refresh-benchmark-daily'
--   ) ORDER BY start_time DESC LIMIT 5;
