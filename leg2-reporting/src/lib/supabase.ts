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
  // Curated fields for the reader editor. Optional so existing partial reader
  // fixtures keep type-checking; the vw_reader_master view always provides them.
  facility_type?: string | null;
  country_name?: string | null;
  city?: string | null;
  facility_latitude?: string | null;
  facility_longitude?: string | null;
  operator?: string | null;
  priority?: string | null;
  inactive?: boolean | null;
  operations_scope?: string | null;
  edi_equivalent_inbound?: string | null;
  edi_equivalent_outbound?: string | null;
}

const READER_MASTER_VIEW = "vw_reader_master";
export const READER_MASTER_SELECT_COLS = [
  "lpi", "gate_id", "gate_name", "gate_purpose", "reading_direction",
  "facility_name", "facility_type", "site_id", "reader_country_code",
  "country_name", "city", "facility_latitude", "facility_longitude",
  "operator", "priority", "inactive", "operations_scope", "handover_point",
  "edi_equivalent_inbound", "edi_equivalent_outbound",
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

export interface SiteOption {
  site_impc_code: string;
  site_name: string | null;
  country_name: string | null;
}

const SITES_VIEW = "vw_sites";
export const SITES_SELECT_COLS = ["site_impc_code", "site_name", "country_name"].join(",");

export function buildSitesUrl(baseUrl: string, opts: { offset: number; limit: number }): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", SITES_SELECT_COLS);
  url.searchParams.set("order", "site_impc_code");
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("limit", String(opts.limit));
  return url.toString();
}

export async function fetchSites(deps: FetchDeps = {}): Promise<SiteOption[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${SITES_VIEW}`;
  return fetchAllPages<SiteOption>(
    (offset, limit) => buildSitesUrl(baseUrl, { offset, limit }),
    fetchFn,
    headers,
    "Leg2 sites fetch"
  );
}

export interface EdiEvent {
  message: string | null;
  event: string | null;
  date: string | null;
  location: string | null;
  transport: string | null;
  transport_date: string | null;
  reference: string | null;
  event_datetime_local: string | null;
  event_datetime_utc: string | null;
  resolved_zone: string | null;
  tz_resolved: boolean;
}

export interface EdiDetail {
  s9code: string;
  origin_office: string | null;
  destination_office: string | null;
  mail_category: string | null;
  mail_subclass: string | null;
  rec_no: string | null;
  gross_weight: string | null;
  items: string | null;
}

const EDI_EVENTS_VIEW = "vw_edi_events_tz";
const EDI_DETAILS_VIEW = "edi_details";
export const EDI_EVENTS_SELECT_COLS = [
  "message", "event", "date", "location", "transport", "transport_date", "reference",
  "event_datetime_local", "event_datetime_utc", "resolved_zone", "tz_resolved",
].join(",");
export const EDI_DETAILS_SELECT_COLS = [
  "s9code", "origin_office", "destination_office", "mail_category",
  "mail_subclass", "rec_no", "gross_weight", "items",
].join(",");

export function buildEdiEventsUrl(
  baseUrl: string,
  opts: { s9: string; offset: number; limit: number }
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", EDI_EVENTS_SELECT_COLS);
  url.searchParams.set("s9code", `eq.${opts.s9}`);
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("limit", String(opts.limit));
  return url.toString();
}

export async function fetchEdiEvents(s9: string, deps: FetchDeps = {}): Promise<EdiEvent[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${EDI_EVENTS_VIEW}`;
  return fetchAllPages<EdiEvent>(
    (offset, limit) => buildEdiEventsUrl(baseUrl, { s9, offset, limit }),
    fetchFn,
    headers,
    "Leg2 edi_events fetch"
  );
}

export async function fetchEdiDetails(s9: string, deps: FetchDeps = {}): Promise<EdiDetail | null> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${EDI_DETAILS_VIEW}`;
  const url = new URL(baseUrl);
  url.searchParams.set("select", EDI_DETAILS_SELECT_COLS);
  url.searchParams.set("s9code", `eq.${s9}`);
  url.searchParams.set("limit", "1");
  const res = await fetchFn(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`Leg2 edi_details fetch failed: ${res.status} ${await res.text()}`);
  }
  const rows = (await res.json()) as EdiDetail[];
  return rows[0] ?? null;
}

export function buildMovementsByS9Url(
  baseUrl: string,
  opts: { s9: string; offset: number; limit: number }
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", SELECT_COLS);
  url.searchParams.set("s9_id", `eq.${opts.s9}`);
  url.searchParams.set("order", "event_datetime_utc.asc");
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("limit", String(opts.limit));
  return url.toString();
}

export async function fetchMovementsByS9(s9: string, deps: FetchDeps = {}): Promise<RfidMovement[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${VIEW}`;
  return fetchAllPages<RfidMovement>(
    (offset, limit) => buildMovementsByS9Url(baseUrl, { s9, offset, limit }),
    fetchFn,
    headers,
    "Leg2 movements-by-s9 fetch"
  );
}
