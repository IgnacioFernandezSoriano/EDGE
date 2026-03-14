-- ─────────────────────────────────────────────────────────────────────────────
-- EDGE Dashboard — Performance Indexes
-- Run this once in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/ewyhmmixqcubqokphebh/sql/new
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. RFID table: index on event_time_local
--    Used by fetchRfidReadings() date filter (gte/lte on event_time_local).
--    With 46k+ rows this converts a full-table scan into an index range scan.
CREATE INDEX IF NOT EXISTS rfid_event_time_local_idx
  ON "RFID" (event_time_local);

-- 2. tracking_events: index on predes_time
--    Used by the default 30-day window filter on the EDI/Benchmark tabs.
CREATE INDEX IF NOT EXISTS tracking_events_predes_time_idx
  ON tracking_events (predes_time);

-- 3. tracking_events: index on redes_time
--    Fallback date column used when predes_time is null.
CREATE INDEX IF NOT EXISTS tracking_events_redes_time_idx
  ON tracking_events (redes_time);

-- Verify indexes were created:
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE indexname IN (
  'rfid_event_time_local_idx',
  'tracking_events_predes_time_idx',
  'tracking_events_redes_time_idx'
);
