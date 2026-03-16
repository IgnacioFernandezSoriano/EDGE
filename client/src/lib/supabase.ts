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

/**
 * Fetches all rows from the RFID table.
 * Supports optional date filtering on event_time_local.
 */
export async function fetchRfidReadings(
  dateFrom?: string,
  dateTo?: string
): Promise<RfidReading[]> {
  const headers = await getAuthHeaders();
  const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent('RFID')}`);
  // Only fetch fields needed by readingsToJourneys — reduces payload ~60%
  url.searchParams.set('select', 'tag_id,event_type,location,impc_code,s9id,event_time_local,record_time,country,center_name,is_international_boundary');
  // Fetch all event types relevant for journey reconstruction
  url.searchParams.set('event_type', 'in.(ORIGIN,DESTINATION,DEPARTURE,ARRIVAL,DEPARTURE_FROM_CENTRE,ARRIVAL_AT_CENTRE)');
  url.searchParams.set('order', 'event_time_local.asc');
  if (dateFrom) url.searchParams.append('event_time_local', `gte.${dateFrom}T00:00:00`);
  if (dateTo)   url.searchParams.append('event_time_local', `lte.${dateTo}T23:59:59`);

  let allData: RfidReading[] = [];
  let offset = 0;
  const pageSize = 5000; // Increased from 1000 to reduce number of requests

  while (true) {
    const pageUrl = new URL(url.toString());
    pageUrl.searchParams.set('offset', String(offset));
    pageUrl.searchParams.set('limit', String(pageSize));

    const res = await fetch(pageUrl.toString(), { headers });
    if (!res.ok) throw new Error(`Supabase RFID error: ${res.status} ${await res.text()}`);
    const data: RfidReading[] = await res.json();
    allData = allData.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return allData;
}

/**
 * Fetches direct counts from the RFID table for the 3 main KPIs:
 * - departures:  row count with event_type IN (ORIGIN, DEPARTURE)
 * - arrivals:    row count with event_type IN (DESTINATION, ARRIVAL)
 * - endToEnd:    count of unique s9ids that have BOTH a departure-type AND an arrival-type row
 * Supports optional date and country filtering.
 */
export async function fetchRfidEventCounts(
  dateFrom?: string,
  dateTo?: string,
  originCountry?: string,
  destCountry?: string
): Promise<{ departures: number; arrivals: number; endToEnd: number }> {
  const headers = await getAuthHeaders();
  const base = `${SUPABASE_URL}/rest/v1/${encodeURIComponent('RFID')}`;

  // Build base date filter params (shared)
  function applyDateFilters(url: URL) {
    if (dateFrom) url.searchParams.append('event_time_local', `gte.${dateFrom}T00:00:00`);
    if (dateTo)   url.searchParams.append('event_time_local', `lte.${dateTo}T23:59:59`);
  }

  // Count rows for given event types + optional country filter
  async function countRows(eventTypes: string[], country?: string): Promise<number> {
    const url = new URL(base);
    url.searchParams.set('select', 'id');
    url.searchParams.set('event_type', `in.(${eventTypes.join(',')})`);
    applyDateFilters(url);
    if (country) url.searchParams.set('country', `eq.${country}`);
    const res = await fetch(url.toString(), {
      headers: { ...headers, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' },
    });
    if (!res.ok) return 0;
    const rangeHeader = res.headers.get('content-range') || '';
    const match = rangeHeader.match(/\/(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  }

  // Fetch s9ids for a given set of event types (paginated, only s9id field)
  async function fetchS9ids(eventTypes: string[], country?: string): Promise<Set<string>> {
    const url = new URL(base);
    url.searchParams.set('select', 's9id');
    url.searchParams.set('event_type', `in.(${eventTypes.join(',')})`);
    url.searchParams.set('s9id', 'not.is.null');
    applyDateFilters(url);
    if (country) url.searchParams.set('country', `eq.${country}`);

    const s9ids = new Set<string>();
    let offset = 0;
    const pageSize = 10000;
    while (true) {
      const pageUrl = new URL(url.toString());
      pageUrl.searchParams.set('offset', String(offset));
      pageUrl.searchParams.set('limit', String(pageSize));
      const res = await fetch(pageUrl.toString(), { headers });
      if (!res.ok) break;
      const data: { s9id: string }[] = await res.json();
      for (const row of data) if (row.s9id) s9ids.add(row.s9id);
      if (data.length < pageSize) break;
      offset += pageSize;
    }
    return s9ids;
  }

  // Run all fetches in parallel
  const [departures, arrivals, depS9ids, arrS9ids] = await Promise.all([
    countRows(['ORIGIN', 'DEPARTURE'], originCountry),
    countRows(['DESTINATION', 'ARRIVAL'], destCountry),
    fetchS9ids(['ORIGIN', 'DEPARTURE'], originCountry),
    fetchS9ids(['DESTINATION', 'ARRIVAL'], destCountry),
  ]);

  // End-to-end = s9ids present in BOTH sets
  let endToEnd = 0;
  for (const s9id of depS9ids) {
    if (arrS9ids.has(s9id)) endToEnd++;
  }

  return { departures, arrivals, endToEnd };
}
