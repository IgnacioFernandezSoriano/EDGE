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

export async function fetchTrackingEvents(): Promise<TrackingEvent[]> {
  return fetchAll('tracking_events', {
    select: '*',
    order: 'id.asc',
  });
}
