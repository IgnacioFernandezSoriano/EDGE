// Supabase client for EDGE RFID-EDI Dashboard
// Connects to tracking_events table and supporting tables

const SUPABASE_URL = 'https://ewyhmmixqcubqokphebh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eWhtbWl4cWN1YnFva3BoZWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTc3MjMsImV4cCI6MjA4ODU3MzcyM30.xMtcrn12c9r0Q_Q0e46Ptsci7Y31YnB5V9MSBHgj20k';

const headers = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

async function fetchAll(table: string, params: Record<string, string> = {}): Promise<any[]> {
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
  // Filter by origin IMPC: s9id starts with one of the origin codes (positions 0-6)
  if (originImpcCodes && originImpcCodes.length > 0) {
    // Use 'or' filter: s9id.like.INBOMA*,s9id.like.INBOMB*
    const orFilter = originImpcCodes.map(c => `s9id.like.${c}*`).join(',');
    url.searchParams.set('or', `(${orFilter})`);
  }
  // Filter by dest IMPC: s9id has dest code at positions 6-12
  // We can't do substring filter directly, so we filter client-side below for dest
}

export async function fetchMatchedTagsCount(
  dateFrom?: string,
  dateTo?: string,
  originImpcCodes?: string[],
  destImpcCodes?: string[]
): Promise<{ count: number; minDate: string | null; maxDate: string | null }> {
  const baseUrl = `${SUPABASE_URL}/rest/v1/${encodeURIComponent('ID Relation')}`;
  const hasDestFilter = destImpcCodes && destImpcCodes.length > 0;
  const hasOriginFilter = originImpcCodes && originImpcCodes.length > 0;

  // If we have a dest filter (or both), we need to fetch all matching s9ids and filter client-side
  // because PostgREST doesn't support substring match at offset 6
  if (hasDestFilter) {
    // Fetch all s9ids with date + optional origin filter, then filter dest client-side
    const fetchUrl = new URL(baseUrl);
    fetchUrl.searchParams.set('select', 's9id,timestamp');
    if (dateFrom) fetchUrl.searchParams.append('timestamp', `gte.${dateFrom}T00:00:00`);
    if (dateTo)   fetchUrl.searchParams.append('timestamp', `lte.${dateTo}T23:59:59`);
    if (hasOriginFilter) {
      const orFilter = originImpcCodes!.map(c => `s9id.like.${c}*`).join(',');
      fetchUrl.searchParams.set('or', `(${orFilter})`);
    }
    // Fetch up to 10000 records (ID Relation has 6323 total)
    fetchUrl.searchParams.set('limit', '10000');
    const res = await fetch(fetchUrl.toString(), { headers });
    if (!res.ok) return { count: 0, minDate: null, maxDate: null };
    const rows: { s9id: string; timestamp: string }[] = await res.json();
    // Filter by dest IMPC at positions 6-12 of s9id
    const filtered = rows.filter(r => destImpcCodes!.some(c => r.s9id.slice(6, 12).toUpperCase() === c.toUpperCase()));
    const count = filtered.length;
    if (count === 0) return { count: 0, minDate: null, maxDate: null };
    const timestamps = filtered.map(r => r.timestamp).sort();
    return { count, minDate: timestamps[0].slice(0, 10), maxDate: timestamps[timestamps.length - 1].slice(0, 10) };
  }

  // No dest filter — use server-side count
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
  // Min date
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
  // Max date
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
