// Supabase client for EDGE RFID-EDI Dashboard
// Connects to tracking_events table and supporting tables

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = 'https://ewyhmmixqcubqokphebh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eWhtbWl4cWN1YnFva3BoZWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTc3MjMsImV4cCI6MjA4ODU3MzcyM30.xMtcrn12c9r0Q_Q0e46Ptsci7Y31YnB5V9MSBHgj20k';

// Cliente SDK de Supabase — gestiona sesión, tokens y RLS automáticamente
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Helper: obtener las cabeceras con el token del usuario autenticado
async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function fetchAll(table: string, params: Record<string, string> = {}): Promise<any[]> {
  const headers = await getAuthHeaders();
  const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`);
  url.searchParams.set('select', params.select || '*');
  if (params.order) url.searchParams.set('order', params.order);
  if (params.limit) url.searchParams.set('limit', params.limit);
  if (params.filter) {
    const [col, op, val] = params.filter.split(':');
    url.searchParams.set(col, `${op}.${val}`);
  }

  let allData: any[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const pageUrl = new URL(url.toString());
    pageUrl.searchParams.set('offset', String(offset));
    pageUrl.searchParams.set('limit', String(pageSize));

    const res = await fetch(pageUrl.toString(), { headers });
    if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    allData = allData.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return allData;
}

export interface TrackingEvent {
  id: number;
  s9id: string;
  tag_id: string | null;
  has_rfid: boolean;
  has_predes: boolean;
  has_resdes: boolean;
  coverage_type: string;
  rfid_origin_impc: string | null;
  rfid_origin_country: string | null;
  rfid_origin_centre: string | null;
  rfid_origin_reader: string | null;
  rfid_origin_time: string | null;
  rfid_origin_readings: number | null;
  rfid_dest_impc: string | null;
  rfid_dest_country: string | null;
  rfid_dest_centre: string | null;
  rfid_dest_reader: string | null;
  rfid_dest_time: string | null;
  rfid_dest_readings: number | null;
  rfid_intermediate_centres: string[] | null;
  rfid_total_readings: number | null;
  predes_time: string | null;
  predes_origin_impc: string | null;
  predes_origin_country: string | null;
  predes_origin_centre: string | null;
  redes_time: string | null;
  redes_dest_impc: string | null;
  redes_dest_country: string | null;
  redes_dest_centre: string | null;
  departure_lag_hours: number | null;
  arrival_lead_hours: number | null;
  rfid_transit_hours: number | null;
  edi_transit_hours: number | null;
  transit_diff_hours: number | null;
  origin_match: boolean | null;
  dest_match: boolean | null;
  full_route_validated: boolean | null;
}

/** Fetch count of ID Relation records within a date range */
function applyIdRelationFilters(
  url: URL,
  dateFrom?: string,
  dateTo?: string,
  originImpcCodes?: string[],
  destImpcCodes?: string[]
) {
  if (dateFrom) url.searchParams.append('timestamp', `gte.${dateFrom}T00:00:00`);
  if (dateTo)   url.searchParams.append('timestamp', `lte.${dateTo}T23:59:59`);
  if (originImpcCodes && originImpcCodes.length > 0) {
    const orFilter = originImpcCodes.map(c => `s9id.like.${c}*`).join(',');
    url.searchParams.set('or', `(${orFilter})`);
  }
}

export async function fetchMatchedTagsCount(
  dateFrom?: string,
  dateTo?: string,
  originImpcCodes?: string[],
  destImpcCodes?: string[]
): Promise<{ count: number; minDate: string | null; maxDate: string | null }> {
  const headers = await getAuthHeaders();
  const baseUrl = `${SUPABASE_URL}/rest/v1/${encodeURIComponent('ID Relation')}`;
  const hasDestFilter = destImpcCodes && destImpcCodes.length > 0;
  const hasOriginFilter = originImpcCodes && originImpcCodes.length > 0;

  if (hasDestFilter) {
    const fetchUrl = new URL(baseUrl);
    fetchUrl.searchParams.set('select', 's9id,timestamp');
    if (dateFrom) fetchUrl.searchParams.append('timestamp', `gte.${dateFrom}T00:00:00`);
    if (dateTo)   fetchUrl.searchParams.append('timestamp', `lte.${dateTo}T23:59:59`);
    if (hasOriginFilter) {
      const orFilter = originImpcCodes!.map(c => `s9id.like.${c}*`).join(',');
      fetchUrl.searchParams.set('or', `(${orFilter})`);
    }
    fetchUrl.searchParams.set('limit', '10000');
    const res = await fetch(fetchUrl.toString(), { headers });
    if (!res.ok) return { count: 0, minDate: null, maxDate: null };
    const rows: { s9id: string; timestamp: string }[] = await res.json();
    const filtered = rows.filter(r => destImpcCodes!.some(c => r.s9id.slice(6, 12).toUpperCase() === c.toUpperCase()));
    const count = filtered.length;
    if (count === 0) return { count: 0, minDate: null, maxDate: null };
    const timestamps = filtered.map(r => r.timestamp).sort();
    return { count, minDate: timestamps[0].slice(0, 10), maxDate: timestamps[timestamps.length - 1].slice(0, 10) };
  }

  const countUrl = new URL(baseUrl);
  countUrl.searchParams.set('select', 'id');
  if (dateFrom) countUrl.searchParams.append('timestamp', `gte.${dateFrom}T00:00:00`);
  if (dateTo)   countUrl.searchParams.append('timestamp', `lte.${dateTo}T23:59:59`);
  if (hasOriginFilter) {
    const orFilter = originImpcCodes!.map(c => `s9id.like.${c}*`).join(',');
    countUrl.searchParams.set('or', `(${orFilter})`);
  }
  const countRes = await fetch(countUrl.toString(), {
    headers: { ...headers, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' },
  });
  if (!countRes.ok) return { count: 0, minDate: null, maxDate: null };
  const rangeHeader = countRes.headers.get('content-range') || '';
  const countMatch = rangeHeader.match(/\/(\d+)$/);
  const count = countMatch ? parseInt(countMatch[1], 10) : 0;

  const minUrl = new URL(baseUrl);
  minUrl.searchParams.set('select', 'timestamp');
  minUrl.searchParams.set('order', 'timestamp.asc');
  minUrl.searchParams.set('limit', '1');
  if (dateFrom) minUrl.searchParams.append('timestamp', `gte.${dateFrom}T00:00:00`);
  if (dateTo)   minUrl.searchParams.append('timestamp', `lte.${dateTo}T23:59:59`);
  if (hasOriginFilter) {
    const orFilter = originImpcCodes!.map(c => `s9id.like.${c}*`).join(',');
    minUrl.searchParams.set('or', `(${orFilter})`);
  }
  const minRes = await fetch(minUrl.toString(), { headers });
  const minData = minRes.ok ? await minRes.json() : [];
  const minDate = minData[0]?.timestamp ? minData[0].timestamp.slice(0, 10) : null;

  const maxUrl = new URL(baseUrl);
  maxUrl.searchParams.set('select', 'timestamp');
  maxUrl.searchParams.set('order', 'timestamp.desc');
  maxUrl.searchParams.set('limit', '1');
  if (dateFrom) maxUrl.searchParams.append('timestamp', `gte.${dateFrom}T00:00:00`);
  if (dateTo)   maxUrl.searchParams.append('timestamp', `lte.${dateTo}T23:59:59`);
  if (hasOriginFilter) {
    const orFilter = originImpcCodes!.map(c => `s9id.like.${c}*`).join(',');
    maxUrl.searchParams.set('or', `(${orFilter})`);
  }
  const maxRes = await fetch(maxUrl.toString(), { headers });
  const maxData = maxRes.ok ? await maxRes.json() : [];
  const maxDate = maxData[0]?.timestamp ? maxData[0].timestamp.slice(0, 10) : null;

  return { count, minDate, maxDate };
}

export async function fetchTrackingEvents(): Promise<TrackingEvent[]> {
  return fetchAll('tracking_events', {
    select: '*',
    order: 'id.asc',
  });
}

/**
 * Obtiene el conjunto de S9IDs que el administrador ha marcado como DELETE
 * en el Audit de Carga de Datos. Estos registros deben ser excluidos de los
 * informes de benchmark RFID vs EDI para no distorsionar los KPIs.
 */
export async function fetchAuditExcludedS9ids(): Promise<Set<string>> {
  const headers = await getAuthHeaders();
  const url = new URL(`${SUPABASE_URL}/rest/v1/audit_data_load_log`);
  url.searchParams.set('select', 'source_s9id');
  url.searchParams.set('admin_decision', 'eq.DELETE');
  url.searchParams.set('source_s9id', 'not.is.null');

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) return new Set();
  const data: { source_s9id: string }[] = await res.json();
  return new Set(data.map(r => r.source_s9id).filter(Boolean));
}

// ── RFID table types and fetcher ───────────────────────────────────────────

/**
 * Represents a single RFID reading row from the RFID table.
 * The `event_type` column is set by the ETL pipeline v3:
 *   ORIGIN               — first reading of the tag (start of full journey)
 *   DESTINATION          — last reading of the tag (end of full journey)
 *   DEPARTURE            — last reading before crossing a country border (international transit start)
 *   ARRIVAL              — first reading after crossing a country border (international transit end)
 *   DEPARTURE_FROM_CENTRE — last reading at a specific centre block
 *   ARRIVAL_AT_CENTRE    — first reading at a specific centre block
 *   INTERMEDIATE         — reading within a centre block (not first/last)
 */
export interface RfidReading {
  tag_id: string | null;
  event_type:
    | 'ORIGIN'
    | 'DESTINATION'
    | 'DEPARTURE'
    | 'ARRIVAL'
    | 'DEPARTURE_FROM_CENTRE'
    | 'ARRIVAL_AT_CENTRE'
    | 'INTERMEDIATE'
    | 'UNKNOWN'
    | null;
  location: string | null;
  impc_code: string | null;
  s9id: string | null;
  event_time_local: string | null;
  record_time: string | null;
  country: string | null;
  center_name: string | null;
  is_international_boundary: boolean | null;
}

// Helper: fetch a single page with up to MAX_RETRIES retries on failure
async function fetchPage(
  url: string,
  headers: Record<string, string>,
  offset: number,
  rangeEnd: number,
  maxRetries = 3
): Promise<RfidReading[]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { ...headers, 'Range-Unit': 'items', 'Range': `${offset}-${rangeEnd}` },
      });
      if (res.ok) return res.json() as Promise<RfidReading[]>;
      // 500/503 — wait and retry
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    } catch {
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  console.warn(`[EDGE] Failed to fetch page offset=${offset} after ${maxRetries} retries, returning empty`);
  return [];
}

/**
 * Fetches all rows from the RFID table.
 * Supports optional date filtering on event_time_local.
 */
export async function fetchRfidReadings(
  dateFrom?: string,
  dateTo?: string
): Promise<RfidReading[]> {
  const baseHeaders = await getAuthHeaders();
  const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent('RFID')}`);
  // Only fetch fields needed by readingsToJourneys — reduces payload ~60%
  url.searchParams.set('select', 'tag_id,event_type,location,impc_code,s9id,event_time_local,record_time,country,center_name,is_international_boundary');
  // Fetch all event types relevant for journey reconstruction
  url.searchParams.set('event_type', 'in.(ORIGIN,DESTINATION,DEPARTURE,ARRIVAL,DEPARTURE_FROM_CENTRE,ARRIVAL_AT_CENTRE)');
  url.searchParams.set('order', 'event_time_local.asc');
  if (dateFrom) url.searchParams.append('event_time_local', `gte.${dateFrom}T00:00:00`);
  if (dateTo)   url.searchParams.append('event_time_local', `lte.${dateTo}T23:59:59`);

  // Supabase PostgREST enforces max-rows=1000 per request.
  // Strategy: fetch page 0 to get total count, then fetch remaining pages
  // in batches of CONCURRENCY to avoid HTTP/2 connection limits on Supabase.
  const PAGE_SIZE = 1000;
  const CONCURRENCY = 5; // reduced to avoid ERR_HTTP2_PROTOCOL_ERROR

  // Step 1: fetch first page and get total count from content-range header
  const firstHeaders = {
    ...baseHeaders,
    'Range-Unit': 'items',
    'Range': `0-${PAGE_SIZE - 1}`,
    'Prefer': 'count=exact',
  };
  const firstRes = await fetch(url.toString(), { headers: firstHeaders });
  if (!firstRes.ok) throw new Error(`Supabase RFID error: ${firstRes.status} ${await firstRes.text()}`);

  const firstData: RfidReading[] = await firstRes.json();
  const cr = firstRes.headers.get('content-range') ?? '';
  const totalMatch = cr.match(/\/(\d+)$/);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : firstData.length;

  if (total <= PAGE_SIZE) return firstData;

  // Step 2: build list of remaining page offsets
  const remainingOffsets: number[] = [];
  for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
    remainingOffsets.push(offset);
  }

  // Step 3: fetch in batches of CONCURRENCY with retries
  const allPages: RfidReading[][] = [firstData];
  for (let i = 0; i < remainingOffsets.length; i += CONCURRENCY) {
    const batch = remainingOffsets.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((offset) => {
        const rangeEnd = Math.min(offset + PAGE_SIZE - 1, total - 1);
        return fetchPage(url.toString(), baseHeaders, offset, rangeEnd);
      })
    );
    allPages.push(...batchResults);
  }

  // Merge all pages in order
  return ([] as RfidReading[]).concat(...allPages);
}

/**
 * Like fetchRfidReadings but reports progress via a callback after each batch.
 * Used for background loading of older data.
 */
export async function fetchRfidReadingsWithProgress(
  dateFrom?: string,
  dateTo?: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<RfidReading[]> {
  const baseHeaders = await getAuthHeaders();
  const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent('RFID')}`);
  url.searchParams.set('select', 'tag_id,event_type,location,impc_code,s9id,event_time_local,record_time,country,center_name,is_international_boundary');
  url.searchParams.set('event_type', 'in.(ORIGIN,DESTINATION,DEPARTURE,ARRIVAL,DEPARTURE_FROM_CENTRE,ARRIVAL_AT_CENTRE)');
  url.searchParams.set('order', 'event_time_local.asc');
  if (dateFrom) url.searchParams.append('event_time_local', `gte.${dateFrom}T00:00:00`);
  if (dateTo)   url.searchParams.append('event_time_local', `lte.${dateTo}T23:59:59`);

  const PAGE_SIZE = 1000;
  const CONCURRENCY = 10;

  // Step 1: get first page + total count
  const firstRes = await fetch(url.toString(), {
    headers: { ...baseHeaders, 'Range-Unit': 'items', 'Range': `0-${PAGE_SIZE - 1}`, 'Prefer': 'count=exact' },
  });
  if (!firstRes.ok) throw new Error(`Supabase RFID error: ${firstRes.status}`);
  const firstData: RfidReading[] = await firstRes.json();
  const cr = firstRes.headers.get('content-range') ?? '';
  const totalMatch = cr.match(/\/(\d+)$/);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : firstData.length;

  if (total <= PAGE_SIZE) return firstData;

  const remainingOffsets: number[] = [];
  for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
    remainingOffsets.push(offset);
  }

  const allPages: RfidReading[][] = [firstData];
  let loaded = PAGE_SIZE;
  onProgress?.(loaded, total);

  for (let i = 0; i < remainingOffsets.length; i += CONCURRENCY) {
    const batch = remainingOffsets.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((offset) => {
        const rangeEnd = Math.min(offset + PAGE_SIZE - 1, total - 1);
        return fetchPage(url.toString(), baseHeaders, offset, rangeEnd);
      })
    );
    allPages.push(...batchResults);
    loaded += batch.length * PAGE_SIZE;
    onProgress?.(Math.min(loaded, total), total);
  }

  return ([] as RfidReading[]).concat(...allPages);
}

/**
 * Fetches the 3 main RFID KPIs via the rfid_kpi_counts RPC function:
 * - departures (rf_predes):  unique tag_ids with event_type = ORIGIN
 * - arrivals   (rf_resdes):  unique tag_ids with event_type = DESTINATION
 * - endToEnd:               unique tag_ids with both ORIGIN and DESTINATION
 * Uses a server-side SQL function to avoid the REST API 1,000-row limit.
 */
export async function fetchRfidEventCounts(
  dateFrom?: string,
  dateTo?: string,
  originCountry?: string,
  destCountry?: string
): Promise<{ totalTags: number; rfidDepartures: number; rfPredes: number; rfResdes: number; rfidArrivals: number; rfE2e: number }> {
  const headers = await getAuthHeaders();

  const body: Record<string, string> = {};
  if (dateFrom) body['p_date_from'] = dateFrom;
  if (dateTo)   body['p_date_to']   = dateTo;
  if (originCountry && originCountry !== 'ALL') body['p_origin_country'] = originCountry;
  if (destCountry   && destCountry   !== 'ALL') body['p_dest_country']   = destCountry;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rfid_kpi_counts`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) return { totalTags: 0, rfidDepartures: 0, rfPredes: 0, rfResdes: 0, rfidArrivals: 0, rfE2e: 0 };

  const data = await res.json();
  const row = Array.isArray(data) ? data[0] : data;
  return {
    totalTags:      Number(row?.total_tags      ?? 0),
    rfidDepartures: Number(row?.rfid_departures ?? 0),
    rfPredes:       Number(row?.rf_predes       ?? 0),
    rfResdes:       Number(row?.rf_resdes       ?? 0),
    rfidArrivals:   Number(row?.rfid_arrivals   ?? 0),
    rfE2e:          Number(row?.rf_e2e          ?? 0),
  };
}
