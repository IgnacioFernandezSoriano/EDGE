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
  country_code: string | null;
  handover_point: boolean;
  handover_quality_status: string | null;
}

const SELECT_COLS = [
  "movement_id", "s9_id", "tag_id", "reader_id", "movement_type",
  "route_country_role", "edi_equivalent", "origin_country_code",
  "destination_country_code", "movement_country_code", "country_sequence_number",
  "event_datetime_utc", "event_datetime_local", "reader_timezone",
  "site_impc_code", "centre_code", "site_name", "city", "country_code",
  "handover_point", "handover_quality_status",
].join(",");

const VIEW = "vw_quicksight_rfid_report_movements";
const PAGE_SIZE = 1000;

export interface ReaderMaster {
  lpi: string;
  gate_id: string | number | null;
  gate_name: string | null;
  gate_purpose: string | null;
  reading_direction: string | null;
  facility_name: string | null;
  site_id: string | null;
  reader_country_code: string | null;
  handover_point: boolean;
}

const READER_MASTER_VIEW = "vw_reader_master";
const READER_MASTER_SELECT_COLS = [
  "lpi", "gate_id", "gate_name", "gate_purpose", "reading_direction",
  "facility_name", "site_id", "reader_country_code", "handover_point",
].join(",");

type FetchDeps = {
  fetchFn?: typeof fetch;
  token?: string;
  anonKey?: string;
  baseUrl?: string;
};

function resolveAuth(deps: FetchDeps) {
  const fetchFn = deps.fetchFn ?? fetch;
  const anonKey = deps.anonKey ?? SUPABASE_ANON_KEY;
  const token = deps.token ?? anonKey;
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  return { fetchFn, headers };
}

async function fetchAllPages<T>(
  buildUrl: (offset: number, limit: number) => string,
  fetchFn: typeof fetch,
  headers: Record<string, string>,
  errorPrefix: string
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const url = buildUrl(offset, PAGE_SIZE);
    const res = await fetchFn(url, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${errorPrefix} failed: ${res.status} ${body}`);
    }
    const page = (await res.json()) as T[];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

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
  deps: FetchDeps = {}
): Promise<RfidMovement[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${VIEW}`;

  return fetchAllPages<RfidMovement>(
    (offset, limit) =>
      buildMovementsUrl(baseUrl, {
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        offset,
        limit,
      }),
    fetchFn,
    headers,
    "Leg2 movements fetch"
  );
}

export function buildReaderMasterUrl(
  baseUrl: string,
  opts: { offset: number; limit: number }
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", READER_MASTER_SELECT_COLS);
  url.searchParams.set("order", "lpi");
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("limit", String(opts.limit));
  return url.toString();
}

export async function fetchReaderMaster(
  deps: FetchDeps = {}
): Promise<ReaderMaster[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${READER_MASTER_VIEW}`;

  return fetchAllPages<ReaderMaster>(
    (offset, limit) => buildReaderMasterUrl(baseUrl, { offset, limit }),
    fetchFn,
    headers,
    "Leg2 reader master fetch"
  );
}
