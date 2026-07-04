import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export interface RfidMovement {
  movement_id: string;
  s9_id: string;
  tag_id: string | null;
  reader_id: string;
  movement_type: "INBOUND" | "OUTBOUND" | "TRANSIT_ENTRY" | "TRANSIT_EXIT";
  route_country_role: "ORIGIN" | "DESTINATION" | "TRANSIT" | null;
  edi_equivalent: string | null;
  origin_country_code: string | null;
  destination_country_code: string | null;
  movement_country_code: string | null;
  country_sequence_number: number | null;
  event_datetime_utc: string;
  event_datetime_local: string;
  reader_timezone: string;
  site_impc_code: string | null;
  centre_code: string;
  site_name: string | null;
  city: string | null;
  handover_point: boolean;
  handover_quality_status: string | null;
}

const SELECT_COLS = [
  "movement_id", "s9_id", "tag_id", "reader_id", "movement_type",
  "route_country_role", "edi_equivalent", "origin_country_code",
  "destination_country_code", "movement_country_code", "country_sequence_number",
  "event_datetime_utc", "event_datetime_local", "reader_timezone",
  "site_impc_code", "centre_code", "site_name", "city",
  "handover_point", "handover_quality_status",
].join(",");

const VIEW = "vw_quicksight_rfid_report_movements";
const PAGE_SIZE = 1000;

export function buildMovementsUrl(
  baseUrl: string,
  opts: { dateFrom?: string; dateTo?: string; offset: number; limit: number }
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", SELECT_COLS);
  url.searchParams.set("order", "event_datetime_utc.desc");
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("limit", String(opts.limit));
  if (opts.dateFrom)
    url.searchParams.append("event_datetime_utc", `gte.${opts.dateFrom}T00:00:00`);
  if (opts.dateTo)
    url.searchParams.append("event_datetime_utc", `lte.${opts.dateTo}T23:59:59`);
  return url.toString();
}

export async function fetchRfidMovements(
  filters: { dateFrom?: string; dateTo?: string },
  deps: {
    fetchFn?: typeof fetch;
    token?: string;
    anonKey?: string;
    baseUrl?: string;
  } = {}
): Promise<RfidMovement[]> {
  const fetchFn = deps.fetchFn ?? fetch;
  const anonKey = deps.anonKey ?? SUPABASE_ANON_KEY;
  const token = deps.token ?? anonKey;
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${VIEW}`;
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const all: RfidMovement[] = [];
  let offset = 0;
  while (true) {
    const url = buildMovementsUrl(baseUrl, {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      offset,
      limit: PAGE_SIZE,
    });
    const res = await fetchFn(url, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Leg2 movements fetch failed: ${res.status} ${body}`);
    }
    const page = (await res.json()) as RfidMovement[];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}
