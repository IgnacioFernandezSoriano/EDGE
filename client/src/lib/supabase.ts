// Supabase client for EDGE RFID-EDI Dashboard
// Connects to tracking_events table and supporting tables

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

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
  status: string | null;  // 'COMPLETE' | 'PENDING' | null
  read_point_id: string | null;
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
  url.searchParams.set('select', 'tag_id,event_type,location,impc_code,s9id,event_time_local,record_time,country,center_name,is_international_boundary,status,read_point_id');
  // Fetch all event types relevant for journey reconstruction (no status filter — applied per-KPI in the hook)
  url.searchParams.set('event_type', 'in.(ORIGIN,DESTINATION,DEPARTURE,ARRIVAL,DEPARTURE_FROM_CENTRE,ARRIVAL_AT_CENTRE)');
  url.searchParams.set('order', 'event_time_local.asc');
  // Use two separate append() calls — PostgREST combines them as an implicit AND.
  // The 'and=' operator syntax does NOT work correctly with other query params.
  if (dateFrom) url.searchParams.append('event_time_local', `gte.${dateFrom}T00:00:00`);
  if (dateTo)   url.searchParams.append('event_time_local', `lte.${dateTo}T23:59:59`);

  // Supabase PostgREST enforces max-rows=1000 per request.
  // Strategy: fetch page 0 to get total count, then fetch remaining pages
  // in batches of CONCURRENCY to avoid HTTP/2 connection limits on Supabase.
  const PAGE_SIZE = 1000;
  const CONCURRENCY = 10; // parallel requests per batch

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
 * Fetches RFID readings using a MONTHLY DATE-CHUNK strategy to avoid Supabase statement_timeout.
 *
 * Root cause: Supabase anon role has a ~3s statement_timeout.
 *   - Large offset queries (>50k rows) timeout because PostgreSQL scans the full ordered result.
 *   - Even `Prefer: count=exact` on large date ranges (>50k rows) causes timeout.
 *
 * Solution:
 *   1. Split the date range into MONTHLY chunks (max ~20k rows each — always <1s).
 *   2. For each chunk, paginate WITHOUT count=exact: fetch pages until a page returns <PAGE_SIZE rows.
 *   3. Pages within a chunk are fetched with CONCURRENCY parallel requests.
 *   4. Report progress as chunks complete.
 */
export async function fetchRfidReadingsWithProgress(
  dateFrom?: string,
  dateTo?: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<RfidReading[]> {
  const baseHeaders = await getAuthHeaders();
  const SELECT = 'tag_id,event_type,location,impc_code,s9id,event_time_local,record_time,country,center_name,is_international_boundary,status,read_point_id';
  const EVENT_FILTER = 'in.(ORIGIN,DESTINATION,DEPARTURE,ARRIVAL,DEPARTURE_FROM_CENTRE,ARRIVAL_AT_CENTRE)';
  const PAGE_SIZE = 1000;
  const CONCURRENCY = 5; // conservative to avoid hitting connection limits per chunk

  // Build MONTHLY date chunks between dateFrom and dateTo
  const startDate = dateFrom ? new Date(dateFrom) : new Date('2025-05-01'); // data starts ~May 2025
  const endDate   = dateTo   ? new Date(dateTo)   : new Date();

  const chunks: { from: string; to: string }[] = [];
  let cursor = new Date(startDate);
  cursor.setDate(1); // always start at the 1st of the month
  while (cursor <= endDate) {
    const chunkStart = cursor.toISOString().split('T')[0];
    // Last day of this month
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const chunkEnd = (lastDay > endDate ? endDate : lastDay).toISOString().split('T')[0];
    chunks.push({ from: chunkStart, to: chunkEnd });
    // Advance to 1st of next month
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  // Helper: fetch all pages of a single monthly chunk WITHOUT count=exact
  // Paginate until a page returns fewer than PAGE_SIZE rows (signals end of data).
  async function fetchChunk(from: string, to: string): Promise<RfidReading[]> {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent('RFID')}`);
    url.searchParams.set('select', SELECT);
    url.searchParams.set('event_type', EVENT_FILTER);
    url.searchParams.set('order', 'event_time_local.asc');
    url.searchParams.append('event_time_local', `gte.${from}T00:00:00`);
    url.searchParams.append('event_time_local', `lte.${to}T23:59:59`);
    const urlStr = url.toString();

    const pages: RfidReading[][] = [];
    let offset = 0;

    // Fetch pages sequentially until we get a partial page (end of data)
    while (true) {
      const pageRows = await fetchPage(urlStr, baseHeaders, offset, offset + PAGE_SIZE - 1);
      if (pageRows.length === 0) break;
      pages.push(pageRows);
      if (pageRows.length < PAGE_SIZE) break; // last page
      offset += PAGE_SIZE;

      // If there are more pages, fetch the next batch in parallel
      // Peek ahead: try CONCURRENCY pages at once
      const batchOffsets: number[] = [];
      for (let k = 1; k < CONCURRENCY; k++) batchOffsets.push(offset + (k - 1) * PAGE_SIZE);
      if (batchOffsets.length > 0) {
        const batchResults = await Promise.all(
          batchOffsets.map(o => fetchPage(urlStr, baseHeaders, o, o + PAGE_SIZE - 1))
        );
        let done = false;
        for (const batch of batchResults) {
          if (batch.length === 0) { done = true; break; }
          pages.push(batch);
          if (batch.length < PAGE_SIZE) { done = true; break; }
        }
        offset += batchOffsets.length * PAGE_SIZE;
        if (done) break;
      }
    }

    return ([] as RfidReading[]).concat(...pages);
  }

  // Estimated total for progress bar: use a known approximate count
  // (169k total rows / 11 months ≈ 15k/month; we use chunks.length * 15000 as rough estimate)
  const estimatedTotal = chunks.length * 15000;

  // Process chunks sequentially (each chunk is internally parallel)
  const allReadings: RfidReading[] = [];
  let loaded = 0;

  for (const chunk of chunks) {
    const chunkData = await fetchChunk(chunk.from, chunk.to);
    allReadings.push(...chunkData);
    loaded += chunkData.length;
    onProgress?.(loaded, Math.max(estimatedTotal, loaded + 1));
  }

  onProgress?.(allReadings.length, allReadings.length);
  return allReadings;
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

// ── rfid_readers_master ────────────────────────────────────────────────────

export interface RfidReaderMaster {
  read_point_id: string;
  impc_code: string | null;
  country: string | null;
  center_name: string | null;
  td_reader: boolean | null;  // true = AMU/border reader, false = internal OE centre
}

/**
 * Fetches all rows from rfid_readers_master.
 * Used to enrich RFID readings with centre names, countries and IMPC codes
 * via the read_point_id foreign key.
 */
export async function fetchRfidReadersMaster(): Promise<RfidReaderMaster[]> {
  const headers = await getAuthHeaders();
  const url = new URL(`${SUPABASE_URL}/rest/v1/rfid_readers_master`);
  url.searchParams.set('select', 'read_point_id,impc_code,country,center_name,td_reader');
  url.searchParams.set('order', 'read_point_id.asc');

  let all: RfidReaderMaster[] = [];
  let offset = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const pageUrl = new URL(url.toString());
    pageUrl.searchParams.set('offset', String(offset));
    pageUrl.searchParams.set('limit', String(PAGE_SIZE));
    const res = await fetch(pageUrl.toString(), { headers });
    if (!res.ok) break;
    const data: RfidReaderMaster[] = await res.json();
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

/** EDI tag info: origin and destination IMPC codes from "datos EDI" via "ID Relation" */
export interface EdiTagInfo {
  origin_impc: string | null;
  destination_impc: string | null;
}

/**
 * Fetches a map of tagid → { origin_impc, destination_impc } by joining
 * "ID Relation" (tagid → s9id) with "datos EDI" (ean = s9id → origin, destination).
 * Used to classify single-country RFID tags as Departure or Arrival.
 */
export async function fetchEdiTagMap(): Promise<Map<string, EdiTagInfo>> {
  const headers = await getAuthHeaders();
  const PAGE_SIZE = 1000;
  const result = new Map<string, EdiTagInfo>();
  let offset = 0;

  while (true) {
    const idRelUrl = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent('ID Relation')}`);
    idRelUrl.searchParams.set('select', 'tagid,s9id');
    idRelUrl.searchParams.set('limit', String(PAGE_SIZE));
    idRelUrl.searchParams.set('offset', String(offset));
    const idRelRes = await fetch(idRelUrl.toString(), { headers });
    if (!idRelRes.ok) break;
    const idRelRows: { tagid: string; s9id: string }[] = await idRelRes.json();
    if (!idRelRows.length) break;

    const s9ids = idRelRows.map(r => r.s9id).filter(Boolean);
    if (s9ids.length > 0) {
      const ediUrl = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent('datos EDI')}`);
      ediUrl.searchParams.set('select', 'ean,origin,destination');
      ediUrl.searchParams.set('ean', `in.(${s9ids.map(s => `"${s}"`).join(',')})`);
      ediUrl.searchParams.set('limit', String(PAGE_SIZE));
      const ediRes = await fetch(ediUrl.toString(), { headers });
      if (ediRes.ok) {
        const ediRows: { ean: string; origin: string | null; destination: string | null }[] = await ediRes.json();
        const ediMap = new Map(ediRows.map(e => [e.ean, e]));
        for (const row of idRelRows) {
          const edi = ediMap.get(row.s9id);
          result.set(row.tagid, {
            origin_impc: edi?.origin ?? null,
            destination_impc: edi?.destination ?? null,
          });
        }
      }
    }

    if (idRelRows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return result;
}
