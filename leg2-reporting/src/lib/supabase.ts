import { createClient } from "@supabase/supabase-js";
import {
  PRODUCT_ALL, PRODUCT_NONE,
  type Granularity, type EventComparison, type EventPairMatrixRow, type MailCategory,
  type EventVocabItem,
} from "@/lib/eventGaps";

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
  // checkpoint_role (Leg2-side) drives edi_equivalent; the legacy edi codes remain
  // read-only for the transition fallback while a reader is unclassified.
  checkpoint_role?: string | null;
  edi_equivalent_inbound?: string | null;
  edi_equivalent_outbound?: string | null;
}

const READER_MASTER_VIEW = "vw_reader_master";
export const READER_MASTER_SELECT_COLS = [
  "lpi", "gate_id", "gate_name", "gate_purpose", "reading_direction",
  "facility_name", "facility_type", "site_id", "reader_country_code",
  "country_name", "city", "facility_latitude", "facility_longitude",
  "operator", "priority", "inactive", "operations_scope", "handover_point",
  "checkpoint_role", "edi_equivalent_inbound", "edi_equivalent_outbound",
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

// A "site" in the picker is a CENTRE (keyed by centre_code): most centres have no
// site_impc_code, but every reading carries a centre. See sql/vw_reprocess_pickers.sql.
export interface SiteOption {
  centre_code: string;
  site_name: string | null;
  country_code: string | null;
}

// Pickers are sourced from the RFID READINGS (rfid_edge_input_reads), not the
// master snapshot: only centres/readers that actually have readings in the
// solution can be reprocessed. See sql/vw_reprocess_pickers.sql.
const SITES_VIEW = "vw_reprocess_sites";
export const SITES_SELECT_COLS = ["centre_code", "site_name", "country_code"].join(",");

export function buildSitesUrl(baseUrl: string, opts: { offset: number; limit: number }): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", SITES_SELECT_COLS);
  url.searchParams.set("order", "site_name");
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

export interface ReaderOption {
  reader_id: string;
  facility_name: string | null;
  site_impc_code: string | null;
}

const READERS_VIEW = "vw_reprocess_readers";
export const READER_OPTIONS_SELECT_COLS = ["reader_id", "facility_name", "site_impc_code"].join(",");

export function buildReaderOptionsUrl(baseUrl: string, opts: { offset: number; limit: number }): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", READER_OPTIONS_SELECT_COLS);
  url.searchParams.set("order", "reader_id");
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("limit", String(opts.limit));
  return url.toString();
}

export async function fetchReaderOptions(deps: FetchDeps = {}): Promise<ReaderOption[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${READERS_VIEW}`;
  return fetchAllPages<ReaderOption>(
    (offset, limit) => buildReaderOptionsUrl(baseUrl, { offset, limit }),
    fetchFn,
    headers,
    "Leg2 reader options fetch"
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

// ── Event-pair gaps ────────────────────────────────────────────────────────

export interface EventPairDetailRow {
  s9code: string;
  comparison_key: string;
  origin_office: string;
  dest_office: string;
  origin_country: string;
  dest_country: string;
  product: string | null;
  a_utc: string;
  b_utc: string;
  gap_days: number;
  excluded: boolean;
  origin_gate: string | null;
  origin_site: string | null;
  dest_gate: string | null;
  dest_site: string | null;
}

export interface EventPairMatrixParams {
  from: string;
  to: string;
  product: string;     // PRODUCT_ALL | PRODUCT_NONE | a mail_category
  granularity: Granularity;
}

export interface EventPairDetailParams {
  origin: string;
  destination: string;
  comparisonKey: string;
  product: string;
  from: string;
  to: string;
  granularity: Granularity;
}

export interface EventPairProductsParams {
  from: string;
  to: string;
  originCountry: string;  // "" = no constraint
  destCountry: string;    // "" = no constraint
}

export interface AvailableProduct {
  code: string | null;    // null = null-product records exist
  name: string | null;
}

const REF_COMPARISON_VIEW = "ref_event_comparison";
const EVENT_PAIR_MATRIX_RPC = "event_pair_matrix";
const EVENT_PAIR_PRODUCTS_RPC = "event_pair_products";
const EVENT_PAIR_GAPS_VIEW = "vw_event_pair_gaps_s9";
const EVENT_PAIR_DETAIL_VIEW = "vw_event_pair_detail_s9";
const EVENT_PAIR_EXCLUSION_TABLE = "event_pair_exclusion";
const COMPARISON_TABLE = "ref_event_comparison";
const COMPARISON_EVENTS_VIEW = "vw_comparison_events";

const EVENT_PAIR_DETAIL_SELECT_COLS = [
  "s9code", "comparison_key", "origin_office", "dest_office",
  "origin_country", "dest_country", "product", "a_utc", "b_utc",
  "gap_days", "excluded",
  "origin_gate", "origin_site", "dest_gate", "dest_site",
].join(",");

export function buildEventPairMatrixBody(p: EventPairMatrixParams): Record<string, unknown> {
  return { p_from: p.from, p_to: p.to, p_product: p.product, p_granularity: p.granularity };
}

export function buildEventPairProductsBody(p: EventPairProductsParams): Record<string, unknown> {
  return {
    p_from: p.from,
    p_to: p.to,
    p_origin_country: p.originCountry === "" ? null : p.originCountry,
    p_dest_country: p.destCountry === "" ? null : p.destCountry,
  };
}

export function buildEventPairDetailUrl(
  baseUrl: string,
  opts: EventPairDetailParams & { offset: number; limit: number }
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("select", EVENT_PAIR_DETAIL_SELECT_COLS);
  url.searchParams.set("comparison_key", `eq.${opts.comparisonKey}`);
  const originCol = opts.granularity === "country" ? "origin_country" : "origin_office";
  const destCol = opts.granularity === "country" ? "dest_country" : "dest_office";
  url.searchParams.set(originCol, `eq.${opts.origin}`);
  url.searchParams.set(destCol, `eq.${opts.destination}`);
  if (opts.product === PRODUCT_NONE) {
    url.searchParams.set("product", "is.null");
  } else if (opts.product !== PRODUCT_ALL) {
    url.searchParams.set("product", `eq.${opts.product}`);
  }
  url.searchParams.append("a_utc", `gte.${opts.from}T00:00:00`);
  url.searchParams.append("a_utc", `lte.${opts.to}T23:59:59`);
  url.searchParams.set("order", "gap_days.desc");
  url.searchParams.set("offset", String(opts.offset));
  url.searchParams.set("limit", String(opts.limit));
  return url.toString();
}

export function buildExclusionDeleteUrl(baseUrl: string, s9code: string, comparisonKey: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("s9code", `eq.${s9code}`);
  url.searchParams.set("comparison_key", `eq.${comparisonKey}`);
  return url.toString();
}

export async function fetchEventComparisons(deps: FetchDeps = {}): Promise<EventComparison[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${REF_COMPARISON_VIEW}`;
  const url = new URL(baseUrl);
  url.searchParams.set("select", "comparison_key,name,priority,a_source,a_code,b_source,b_code");
  url.searchParams.set("order", "priority");
  const res = await fetchFn(url.toString(), { headers });
  if (!res.ok) throw new Error(`Leg2 comparisons fetch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as EventComparison[];
}

export function buildComparisonUpsertBody(c: EventComparison): Record<string, unknown> {
  return {
    comparison_key: c.comparison_key, name: c.name,
    a_source: c.a_source, a_code: c.a_code,
    b_source: c.b_source, b_code: c.b_code, priority: c.priority,
  };
}

export function buildComparisonDeleteUrl(baseUrl: string, comparisonKey: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("comparison_key", `eq.${comparisonKey}`);
  return url.toString();
}

export async function fetchComparisonEvents(deps: FetchDeps = {}): Promise<EventVocabItem[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${COMPARISON_EVENTS_VIEW}`;
  const url = new URL(baseUrl);
  url.searchParams.set("select", "source,code,n");
  url.searchParams.set("order", "source,code");
  const res = await fetchFn(url.toString(), { headers });
  if (!res.ok) throw new Error(`Leg2 comparison events fetch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as EventVocabItem[];
}

export async function createComparison(c: EventComparison, deps: FetchDeps = {}): Promise<void> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${COMPARISON_TABLE}`;
  const res = await fetchFn(baseUrl, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(buildComparisonUpsertBody(c)),
  });
  if (!res.ok) throw new Error(`Leg2 comparison insert failed: ${res.status} ${await res.text()}`);
}

export async function updateComparison(key: string, c: EventComparison, deps: FetchDeps = {}): Promise<void> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${COMPARISON_TABLE}`;
  const url = buildComparisonDeleteUrl(baseUrl, key); // same key filter
  const res = await fetchFn(url, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(buildComparisonUpsertBody(c)),
  });
  if (!res.ok) throw new Error(`Leg2 comparison update failed: ${res.status} ${await res.text()}`);
}

export async function deleteComparison(key: string, deps: FetchDeps = {}): Promise<void> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${COMPARISON_TABLE}`;
  const res = await fetchFn(buildComparisonDeleteUrl(baseUrl, key), { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Leg2 comparison delete failed: ${res.status} ${await res.text()}`);
}

export async function fetchEventPairMatrix(
  params: EventPairMatrixParams, deps: FetchDeps = {}
): Promise<EventPairMatrixRow[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/rpc/${EVENT_PAIR_MATRIX_RPC}`;
  const res = await fetchFn(baseUrl, {
    method: "POST", headers, body: JSON.stringify(buildEventPairMatrixBody(params)),
  });
  if (!res.ok) throw new Error(`Leg2 event_pair_matrix failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as EventPairMatrixRow[];
}

export async function fetchEventPairProducts(
  params: EventPairProductsParams, deps: FetchDeps = {}
): Promise<AvailableProduct[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/rpc/${EVENT_PAIR_PRODUCTS_RPC}`;
  const res = await fetchFn(baseUrl, {
    method: "POST", headers, body: JSON.stringify(buildEventPairProductsBody(params)),
  });
  if (!res.ok) throw new Error(`Leg2 event_pair_products failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as AvailableProduct[];
}

export async function fetchEventPairDetail(
  params: EventPairDetailParams, deps: FetchDeps = {}
): Promise<EventPairDetailRow[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${EVENT_PAIR_DETAIL_VIEW}`;
  return fetchAllPages<EventPairDetailRow>(
    (offset, limit) => buildEventPairDetailUrl(baseUrl, { ...params, offset, limit }),
    fetchFn, headers, "Leg2 event_pair detail fetch"
  );
}

export async function fetchMailCategories(deps: FetchDeps = {}): Promise<MailCategory[]> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/ref_mail_category`;
  const url = new URL(baseUrl);
  url.searchParams.set("select", "code,name");
  url.searchParams.set("order", "code");
  const res = await fetchFn(url.toString(), { headers });
  if (!res.ok) throw new Error(`Leg2 mail categories fetch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as MailCategory[];
}

export async function setEventPairExclusion(
  args: { s9code: string; comparisonKey: string; excluded: boolean; excludedBy: string },
  deps: FetchDeps = {}
): Promise<void> {
  const { fetchFn, headers } = resolveAuth(deps);
  const baseUrl = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${EVENT_PAIR_EXCLUSION_TABLE}`;
  if (args.excluded) {
    const res = await fetchFn(baseUrl, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        s9code: args.s9code, comparison_key: args.comparisonKey, excluded_by: args.excludedBy,
      }),
    });
    if (!res.ok) throw new Error(`Leg2 exclusion insert failed: ${res.status} ${await res.text()}`);
  } else {
    const url = buildExclusionDeleteUrl(baseUrl, args.s9code, args.comparisonKey);
    const res = await fetchFn(url, { method: "DELETE", headers });
    if (!res.ok) throw new Error(`Leg2 exclusion delete failed: ${res.status} ${await res.text()}`);
  }
}
