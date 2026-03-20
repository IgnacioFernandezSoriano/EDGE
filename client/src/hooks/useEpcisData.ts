/**
 * useEpcisData — builds RFID journey data from the RFID table.
 *
 * Source: RFID table (populated by the ETL pipeline process_rfid_etl.py)
 * Fields used:
 *   s9id, tag_id, event_type, event_time_local,
 *   impc_code_corrected, country_corrected, center_name_corrected
 *
 * Each row in RFID is a single reading. This hook groups readings by s9id
 * and builds RfidJourney objects (origin + destination pairs) in the browser.
 */

import { useState, useEffect, useMemo } from 'react';
import { fetchRfidReadings, fetchRfidReadingsWithProgress, fetchRfidEventCounts } from '@/lib/supabase';
import type { RfidReading } from '@/lib/supabase';

// ── Re-exported types (kept for backward compatibility with EpcisDataTable) ──

export interface EpcisReading {
  id: string;
  s9id: string;
  tag_id: string;
  record_time: string;
  location: string;
  read_point_id: string;
  impc_code: string;
}

export interface PostalReader {
  read_point_id: string;
  impc_code: string;
  country: string;
  city: string;
  center_name: string;
  gate: string;
}

export interface ReaderInfo {
  center_name: string;
  country: string;
  impc_code: string;
}

export interface RfidJourney {
  s9id: string;
  tag_id: string;
  // Full journey (ORIGIN → DESTINATION)
  origin_country: string;
  origin_centre: string;
  origin_impc: string;
  origin_time: string;
  origin_readings: number;
  dest_country: string | null;
  dest_centre: string | null;
  dest_impc: string | null;
  dest_time: string | null;
  dest_readings: number;
  // International transit (DEPARTURE → ARRIVAL)
  departure_country: string | null;
  departure_centre: string | null;
  departure_impc: string | null;
  departure_time: string | null;
  arrival_country: string | null;
  arrival_centre: string | null;
  arrival_impc: string | null;
  arrival_time: string | null;
  // Times
  transit_hours: number | null;           // ORIGIN → DESTINATION (total, for table column)
  international_transit_hours: number | null; // DEPARTURE → ARRIVAL only (for KPI)
  full_journey_hours: number | null;      // ORIGIN → DESTINATION (full)
  has_origin: boolean;                   // has real ORIGIN event (not fallback)
  has_destination: boolean;
  has_international: boolean;             // has DEPARTURE + ARRIVAL pair
  is_complete: boolean;                   // all events in this journey have status=COMPLETE (for Leg2 and Transit)
  is_both_rfid: boolean;
  centres_visited: string[];
}

export interface EpcisStats {
  totalReadings: number;
  uniqueReceptacles: number;
  withOriginReading: number;
  withDestReading: number;
  uniqueOrigins: number;
  uniqueDestinations: number;
  endToEndPairs: number;
  endToEndPct: number;
  avgTransitHours: number | null;
  meanTransitHours: number | null;
  p25TransitHours: number | null;
  p75TransitHours: number | null;
  minTransitHours: number | null;
  maxTransitHours: number | null;
  byOriginCountry: { country: string; count: number; endToEnd: number; pct: number }[];
  byDestCountry:   { country: string; count: number }[];
  byOriginCentre:  { centre: string; country: string; count: number; endToEnd: number }[];
  byDestCentre:    { centre: string; country: string; count: number }[];
  departureByCentre: { centre: string; country: string; n: number; avgH: number; p50H: number; p25H: number; p75H: number }[];
  arrivalByCentre:   { centre: string; country: string; n: number; avgH: number; p50H: number; p25H: number; p75H: number }[];
  byRoute:           { route: string; origin: string; dest: string; count: number; avgH: number | null; p50H: number | null; p25H: number | null; p75H: number | null }[];
  transitCdf:        { x: number; pct: number }[];
  dateRange: { min: string; max: string } | null;
}

/* ─── Math helpers ─── */
function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function mean(arr: number[]): number | null {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function percentile(arr: number[], p: number): number | null {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function buildCDF(values: number[], steps = 60): { x: number; pct: number }[] {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === max) return [{ x: Math.round(min * 10) / 10, pct: 100 }];
  const stepSize = (max - min) / steps;
  const result: { x: number; pct: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = Math.round((min + i * stepSize) * 10) / 10;
    const count = sorted.filter(v => v <= x).length;
    result.push({ x, pct: Math.round((count / sorted.length) * 1000) / 10 });
  }
  return result;
}

/* ─── Group RFID readings → RfidJourney ─── */
/* ─── Helper: parse country and centre from location field ─── */
// location format: "Country | City | Centre Name | Gate"
function parseLocation(location: string | null): { country: string; centre: string } {
  if (!location) return { country: '', centre: '' };
  const parts = location.split('|').map(p => p.trim());
  return {
    country: parts[0] ?? '',
    centre:  parts[2] ?? parts[1] ?? '',
  };
}

/**
 * Groups individual RFID readings by tag_id and builds journey objects.
 * ETL v3: each tag has ORIGIN, DESTINATION, and optionally DEPARTURE/ARRIVAL
 * for international transits. Country and centre come from the `country` and
 * `center_name` fields (set by the ETL from rfid_readers_master), with
 * fallback to parsing the `location` field.
 */
function readingsToJourneys(readings: RfidReading[]): RfidJourney[] {
  // Group by tag_id
  const byTag = new Map<string, RfidReading[]>();
  for (const r of readings) {
    const key = r.tag_id || r.s9id;
    if (!key) continue;
    if (!byTag.has(key)) byTag.set(key, []);
    byTag.get(key)!.push(r);
  }

  const journeys: RfidJourney[] = [];

  for (const [tagKey, rows] of Array.from(byTag.entries())) {
    // Sort by event_time_local ascending
    const sorted = [...rows].sort((a, b) => {
      const ta = a.event_time_local || a.record_time || '';
      const tb = b.event_time_local || b.record_time || '';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    const originRow  = sorted.find(r => r.event_type === 'ORIGIN') ?? null;
    const destRow    = sorted.slice().reverse().find(r => r.event_type === 'DESTINATION') ?? null;
    // DEPARTURE = last reading before crossing border (may be same as ORIGIN if only 1 reading in origin country)
    const depRow     = sorted.slice().reverse().find(r => r.event_type === 'DEPARTURE') ?? null;
    // ARRIVAL = first reading after crossing border
    const arrRow     = sorted.find(r => r.event_type === 'ARRIVAL') ?? null;

    // Need at least one known event to build a journey
    // A tag without ORIGIN but with DEPARTURE/ARRIVAL/DESTINATION is still a valid partial journey
    const anchorRow = originRow ?? depRow ?? arrRow ?? destRow;
    if (!anchorRow) continue;

    // Helper: extract country and centre from a reading
    function getCentre(r: RfidReading): { country: string; centre: string; impc: string } {
      const country = r.country || parseLocation(r.location).country;
      const centre  = r.center_name || parseLocation(r.location).centre || r.impc_code || '';
      const impc    = r.impc_code || '';
      return { country, centre, impc };
    }

    // Use originRow if available; fall back to anchorRow for partial journeys
    const originInfo = getCentre(originRow ?? anchorRow);
    const originTime = (originRow ?? anchorRow).event_time_local || (originRow ?? anchorRow).record_time || '';

    // hasDest is true when a DESTINATION row exists AND it is at a DIFFERENT
    // centre than ORIGIN.  We compare impc_code when both are non-empty;
    // when either is empty we fall back to centre name comparison.
    // This avoids the bug where null !== null evaluates to false and hides
    // a real DESTINATION (which was the root cause of the blank-destination issue).
    const destRowRaw  = destRow;
    const destInfoRaw = destRowRaw ? getCentre(destRowRaw) : null;
    const isSameCentre = (() => {
      if (!destInfoRaw) return true; // no destination row → treat as same
      const oImpc = originInfo.impc || '';
      const dImpc = destInfoRaw.impc || '';
      if (oImpc && dImpc) return oImpc === dImpc;   // both non-empty: compare IMPC
      // Fallback: compare centre names (non-empty strings only)
      const oCentre = originInfo.centre || '';
      const dCentre = destInfoRaw.centre || '';
      return oCentre !== '' && oCentre === dCentre;
    })();
    const hasDest  = destRowRaw !== null && destInfoRaw !== null && !isSameCentre;
    const destInfo = hasDest ? destInfoRaw : null;
    const destTime = hasDest ? (destRowRaw!.event_time_local || destRowRaw!.record_time || null) : null;

    const hasIntl = depRow !== null && arrRow !== null;
    const depInfo  = depRow  ? getCentre(depRow)  : null;
    const arrInfo  = arrRow  ? getCentre(arrRow)  : null;
    const depTime  = depRow  ? (depRow.event_time_local  || depRow.record_time  || null) : null;
    const arrTime  = arrRow  ? (arrRow.event_time_local  || arrRow.record_time  || null) : null;

    // s9id: use real s9id only if it differs from tag_id
    // Use anchorRow as fallback when originRow is null (partial journey without ORIGIN)
    const refRow = originRow ?? anchorRow;
    const tag_id = refRow.tag_id || tagKey;
    const s9id   = (refRow.s9id && refRow.s9id !== tag_id) ? refRow.s9id : tag_id;

    // transit_hours: ORIGIN → DESTINATION total time (shown in table column)
    let transitHours: number | null = null;
    if (hasDest && originTime && destTime) {
      const diffMs = new Date(destTime).getTime() - new Date(originTime).getTime();
      if (diffMs > 0) transitHours = Math.round((diffMs / 3600000) * 10) / 10;
    }

    // international_transit_hours: DEPARTURE → ARRIVAL only (used for KPI)
    let intlTransitHours: number | null = null;
    if (hasIntl && depTime && arrTime) {
      const diffMs = new Date(arrTime).getTime() - new Date(depTime).getTime();
      if (diffMs > 0) intlTransitHours = Math.round((diffMs / 3600000) * 10) / 10;
    }

    // Full journey time: ORIGIN → DESTINATION
    let fullJourneyHours: number | null = null;
    if (hasDest && originTime && destTime) {
      const diffMs = new Date(destTime).getTime() - new Date(originTime).getTime();
      if (diffMs > 0) fullJourneyHours = Math.round((diffMs / 3600000) * 10) / 10;
    }

    // Build centres visited list (all unique impc_codes in order)
    const centresVisited: string[] = [];
    for (const r of sorted) {
      const c = r.center_name || parseLocation(r.location).centre || r.impc_code || '';
      if (c && !centresVisited.includes(c)) centresVisited.push(c);
    }

    journeys.push({
      s9id,
      tag_id,
      // Full journey
      origin_country:   originInfo.country,
      origin_centre:    originInfo.centre,
      origin_impc:      originInfo.impc,
      origin_time:      originTime,
      origin_readings:  1,
      dest_country:     destInfo?.country ?? null,
      dest_centre:      destInfo?.centre ?? null,
      dest_impc:        destInfo?.impc ?? null,
      dest_time:        destTime,
      dest_readings:    hasDest ? 1 : 0,
      // International transit
      departure_country: depInfo?.country ?? null,
      departure_centre:  depInfo?.centre ?? null,
      departure_impc:    depInfo?.impc ?? null,
      departure_time:    depTime,
      arrival_country:   arrInfo?.country ?? null,
      arrival_centre:    arrInfo?.centre ?? null,
      arrival_impc:      arrInfo?.impc ?? null,
      arrival_time:      arrTime,
      // Times
      transit_hours:               transitHours,
      international_transit_hours: intlTransitHours,
      full_journey_hours:          fullJourneyHours,
      has_origin:         originRow !== null,
      has_destination:    hasDest,
      has_international:  hasIntl,
      // is_complete: all rows for this tag_id have status=COMPLETE (required for Leg2 and Transit KPIs)
      is_complete:        sorted.every(r => r.status === 'COMPLETE'),
      // is_both_rfid: tag has both ORIGIN (or DEPARTURE) and DESTINATION (or ARRIVAL)
      is_both_rfid:       (originRow !== null || depRow !== null) && (destRow !== null || arrRow !== null),
      centres_visited:    centresVisited,
    });
  }

  return journeys;
}

/* ─── Compute stats from journeys ─── */
function computeEpcisStats(journeys: RfidJourney[]): EpcisStats {
  // endToEnd: journeys with DEPARTURE + ARRIVAL (international transit measured)
  // Transit analysis requires status=COMPLETE to ensure the journey is fully classified
  const endToEnd = journeys.filter(j => j.has_international && j.is_complete);
  const bothRfid  = journeys.filter(j => j.is_both_rfid);
  // KPI transit values: use DEPARTURE→ARRIVAL (international_transit_hours) only
  const transitValues = endToEnd
    .map(j => j.international_transit_hours!)
    .filter(h => h !== null && h > 0) as number[];

  const times = journeys.map(j => j.origin_time).filter(Boolean).sort();
  const destTimes = endToEnd.map(j => j.dest_time!).filter(Boolean).sort();
  const allTimes = [...times, ...destTimes].sort();
  const dateRange = allTimes.length > 0 ? { min: allTimes[0], max: allTimes[allTimes.length - 1] } : null;

  // By origin country — journeys with an ORIGIN event (origin_readings > 0).
  // Note: impc_code is null for most RFID tags (only G.1UPU tags have it),
  // so we must NOT filter by origin_impc — that would exclude all J5GJ tags.
  const journeysWithOrigin = journeys.filter(j => j.origin_readings > 0 || j.origin_country);
  const originCountryMap = new Map<string, { count: number; endToEnd: number }>();
  for (const j of journeysWithOrigin) {
    const c = j.origin_country || 'Unknown';
    if (!originCountryMap.has(c)) originCountryMap.set(c, { count: 0, endToEnd: 0 });
    const v = originCountryMap.get(c)!;
    v.count++;
    if (j.has_destination) v.endToEnd++;
  }
  const byOriginCountry = Array.from(originCountryMap.entries())
    .map(([country, v]) => ({ country, count: v.count, endToEnd: v.endToEnd, pct: Math.round(v.endToEnd / v.count * 100) }))
    .sort((a, b) => b.count - a.count);

  // By dest country — use arrival_country for international journeys
  const destCountryMap = new Map<string, number>();
  for (const j of endToEnd) {
    const c = j.arrival_country || j.dest_country || 'Unknown';
    destCountryMap.set(c, (destCountryMap.get(c) || 0) + 1);
  }
  const byDestCountry = Array.from(destCountryMap.entries())
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count);

  // By origin centre
  const originCentreMap = new Map<string, { country: string; count: number; endToEnd: number }>();
  for (const j of journeysWithOrigin) {
    const key = j.origin_centre || 'Unknown';
    if (!originCentreMap.has(key)) originCentreMap.set(key, { country: j.origin_country, count: 0, endToEnd: 0 });
    const v = originCentreMap.get(key)!;
    v.count++;
    if (j.has_destination) v.endToEnd++;
  }
  const byOriginCentre = Array.from(originCentreMap.entries())
    .map(([centre, v]) => ({ centre, country: v.country, count: v.count, endToEnd: v.endToEnd }))
    .sort((a, b) => b.count - a.count);

  // By dest centre — use arrival_centre for international journeys
  const destCentreMap = new Map<string, { country: string; count: number }>();
  for (const j of endToEnd) {
    const key = j.arrival_centre || j.dest_centre || 'Unknown';
    const country = j.arrival_country || j.dest_country || '';
    if (!destCentreMap.has(key)) destCentreMap.set(key, { country, count: 0 });
    destCentreMap.get(key)!.count++;
  }
  const byDestCentre = Array.from(destCentreMap.entries())
    .map(([centre, v]) => ({ centre, country: v.country, count: v.count }))
    .sort((a, b) => b.count - a.count);

  // Departure by centre — use departure_centre (last centre before border crossing)
  const depCentreMap = new Map<string, { country: string; hours: number[] }>();
  for (const j of endToEnd) {
    if (j.international_transit_hours === null || j.international_transit_hours < 0) continue;
    const key = j.departure_centre || j.origin_centre || 'Unknown';
    const country = j.departure_country || j.origin_country;
    if (!depCentreMap.has(key)) depCentreMap.set(key, { country, hours: [] });
    depCentreMap.get(key)!.hours.push(j.international_transit_hours);
  }
  const departureByCentre = Array.from(depCentreMap.entries())
    .map(([centre, v]) => ({
      centre,
      country: v.country,
      n: v.hours.length,
      avgH:  Math.round((mean(v.hours)              ?? 0) * 10) / 10,
      p50H:  Math.round((median(v.hours)            ?? 0) * 10) / 10,
      p25H:  Math.round((percentile(v.hours, 25)    ?? 0) * 10) / 10,
      p75H:  Math.round((percentile(v.hours, 75)    ?? 0) * 10) / 10,
    }))
    .sort((a, b) => b.n - a.n);

  // Arrival by centre — use arrival_centre (first centre after border crossing)
  const arrCentreMap = new Map<string, { country: string; hours: number[] }>();
  for (const j of endToEnd) {
    if (j.international_transit_hours === null || j.international_transit_hours < 0) continue;
    const key = j.arrival_centre || j.dest_centre || 'Unknown';
    const country = j.arrival_country || j.dest_country || '';
    if (!arrCentreMap.has(key)) arrCentreMap.set(key, { country, hours: [] });
    arrCentreMap.get(key)!.hours.push(j.international_transit_hours);
  }
  const arrivalByCentre = Array.from(arrCentreMap.entries())
    .map(([centre, v]) => ({
      centre,
      country: v.country,
      n: v.hours.length,
      avgH:  Math.round((mean(v.hours)              ?? 0) * 10) / 10,
      p50H:  Math.round((median(v.hours)            ?? 0) * 10) / 10,
      p25H:  Math.round((percentile(v.hours, 25)    ?? 0) * 10) / 10,
      p75H:  Math.round((percentile(v.hours, 75)    ?? 0) * 10) / 10,
    }))
    .sort((a, b) => b.n - a.n);

  // By route — use departure/arrival countries for international transit
  const routeMap = new Map<string, { origin: string; dest: string; count: number; hours: number[] }>();
  for (const j of endToEnd) {
    const originC = j.departure_country || j.origin_country;
    const destC   = j.arrival_country   || j.dest_country || '';
    const key = `${originC} → ${destC}`;
    if (!routeMap.has(key)) routeMap.set(key, { origin: originC, dest: destC, count: 0, hours: [] });
    const v = routeMap.get(key)!;
    v.count++;
    if (j.international_transit_hours !== null && j.international_transit_hours > 0) v.hours.push(j.international_transit_hours);
  }
  const byRoute = Array.from(routeMap.entries())
    .map(([route, v]) => ({
      route,
      origin: v.origin,
      dest: v.dest,
      count: v.count,
      avgH:  v.hours.length > 0 ? Math.round((mean(v.hours)              ?? 0) * 10) / 10 : null,
      p50H:  v.hours.length > 0 ? Math.round((median(v.hours)            ?? 0) * 10) / 10 : null,
      p25H:  v.hours.length > 0 ? Math.round((percentile(v.hours, 25)    ?? 0) * 10) / 10 : null,
      p75H:  v.hours.length > 0 ? Math.round((percentile(v.hours, 75)    ?? 0) * 10) / 10 : null,
    }))
    .sort((a, b) => b.count - a.count);

  const transitCdf = buildCDF(transitValues);

  const totalReadings = journeys.reduce((sum, j) => sum + j.origin_readings + j.dest_readings, 0);
  // RFID Departures: tags with ORIGIN or DEPARTURE (known at origin, complete or partial journey)
  const withOriginReading = journeys.filter(j => j.origin_time !== '' && j.origin_time !== null).length;
  // RFID Arrivals: tags with DESTINATION or ARRIVAL (known at destination, complete or partial journey)
  const withDestReading = journeys.filter(j => j.dest_time !== null || j.arrival_time !== null).length;

  // Overview KPI counts — unique tag_ids per event_type
  // NOTE: Total/Origin/Outbound/Inbound/Destination count ALL records (no status filter)
  //       Leg2 (Tags Leg2) counts only status=COMPLETE journeys with DEPARTURE+ARRIVAL
  const kpiTotalTags      = new Set(journeys.map(j => j.tag_id)).size;
  const kpiRfidDepartures = new Set(journeys.filter(j => j.has_origin).map(j => j.tag_id)).size;                                               // ORIGIN (all statuses)
  const kpiRfPredes       = new Set(journeys.filter(j => j.departure_time !== null).map(j => j.tag_id)).size;                                  // DEPARTURE (all statuses)
  const kpiRfResdes       = new Set(journeys.filter(j => j.arrival_time !== null).map(j => j.tag_id)).size;                                    // ARRIVAL (all statuses)
  const kpiRfidArrivals   = new Set(journeys.filter(j => j.dest_time !== null).map(j => j.tag_id)).size;                                       // DESTINATION (all statuses)
  const kpiRfE2e          = new Set(journeys.filter(j => j.has_international && j.is_complete).map(j => j.tag_id)).size;                       // Leg2: DEPARTURE+ARRIVAL, status=COMPLETE only

  return {
    totalReadings,
    uniqueReceptacles: journeys.length,
    withOriginReading,
    withDestReading,
    uniqueOrigins: originCountryMap.size,
    uniqueDestinations: destCountryMap.size,
    endToEndPairs: bothRfid.length,
    endToEndPct: journeys.length > 0 ? Math.round(bothRfid.length / journeys.length * 100) : 0,
    // Overview KPI block (filter-aware)
    kpiTotalTags,
    kpiRfidDepartures,
    kpiRfPredes,
    kpiRfResdes,
    kpiRfidArrivals,
    kpiRfE2e,
    avgTransitHours: transitValues.length > 0 ? Math.round((mean(transitValues) ?? 0) * 10) / 10 : null,
    meanTransitHours: transitValues.length > 0 ? Math.round((mean(transitValues) ?? 0) * 10) / 10 : null,
    p25TransitHours: transitValues.length > 0 ? Math.round((percentile(transitValues, 25) ?? 0) * 10) / 10 : null,
    p75TransitHours: transitValues.length > 0 ? Math.round((percentile(transitValues, 75) ?? 0) * 10) / 10 : null,
    minTransitHours: transitValues.length > 0 ? Math.round(Math.min(...transitValues) * 10) / 10 : null,
    maxTransitHours: transitValues.length > 0 ? Math.round(Math.max(...transitValues) * 10) / 10 : null,
    byOriginCountry,
    byDestCountry,
    byOriginCentre,
    byDestCentre,
    departureByCentre,
    arrivalByCentre,
    byRoute,
    transitCdf,
    dateRange,
  };
}

/* ─── Filter interface ─── */
export interface EpcisFilters {
  dateFrom?: string;
  dateTo?: string;
  originCountry?: string;
  destCountry?: string;
  /** @deprecated No longer used — data now comes from the RFID table directly */
  allEvents?: unknown[];
  loading?: boolean;
  error?: string | null;
}

/* ─── Main hook ─── */
/**
 * Fetches RFID readings from the RFID table and builds journey statistics.
 * The `allEvents` filter parameter is kept for backward compatibility but ignored.
 * Date filters are applied server-side via the Supabase query.
 */
export function useEpcisData(filters: EpcisFilters = {}) {
  const [allReadings, setAllReadings] = useState<RfidReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [backgroundProgress, setBackgroundProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rfidCounts, setRfidCounts] = useState<{ totalTags: number; rfidDepartures: number; rfPredes: number; rfResdes: number; rfidArrivals: number; rfE2e: number } | null>(null);
  const [rfidCountsLoading, setRfidCountsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBackgroundLoading(false);
    setError(null);
    setAllReadings([]);

    // If explicit date filters are set, just fetch that range directly
    if (filters.dateFrom || filters.dateTo) {
      fetchRfidReadings(filters.dateFrom, filters.dateTo)
        .then(data => {
          if (!cancelled) {
            setAllReadings(data);
            setLoading(false);
          }
        })
        .catch(err => {
          if (!cancelled) {
            setError(err.message ?? 'Error al cargar datos RFID');
            setLoading(false);
          }
        });
      return () => { cancelled = true; };
    }

    // If a country filter is active, load the complete dataset at once so that
    // dropdowns and KPIs are always accurate (older data like G.1UPU India→Japan
    // would be missed in a 30-day window).
    const hasCountryFilter = (filters.originCountry && filters.originCountry !== 'ALL') ||
                             (filters.destCountry   && filters.destCountry   !== 'ALL');

    if (hasCountryFilter) {
      setBackgroundProgress(null);
      fetchRfidReadingsWithProgress(
        undefined,
        undefined,
        (loaded, total) => {
          if (!cancelled) setBackgroundProgress({ loaded, total });
        }
      )
        .then(data => {
          if (!cancelled) {
            setAllReadings(data);
            setLoading(false);
            setBackgroundLoading(false);
            setBackgroundProgress(null);
          }
        })
        .catch(err => {
          if (!cancelled) {
            setError(err.message ?? 'Error al cargar datos RFID');
            setLoading(false);
          }
        });
      return () => { cancelled = true; };
    }

    // No country filter: progressive loading strategy.
    // Step 1 — fetch last 30 days immediately so the UI is usable fast.
    // Step 2 — load the full history in background using batches of 10 pages.
    //           A progress indicator shows how many pages have been loaded.
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const recentFrom = thirtyDaysAgo.toISOString().split('T')[0];

    setBackgroundProgress(null);

    fetchRfidReadings(recentFrom, undefined)
      .then(recentData => {
        if (cancelled) return;
        setAllReadings(recentData);
        setLoading(false); // UI is now usable with recent data

        // Step 2: load older data in background using batched parallel fetches
        const dayBefore = new Date(thirtyDaysAgo);
        dayBefore.setDate(dayBefore.getDate() - 1);
        const olderTo = dayBefore.toISOString().split('T')[0];

        setBackgroundLoading(true);

        fetchRfidReadingsWithProgress(
          '2024-01-01',  // anchor start date — avoids full-table scan timeout
          olderTo,
          (loaded, total) => {
            if (!cancelled) setBackgroundProgress({ loaded, total });
          }
        )
          .then(olderData => {
            if (!cancelled) {
              setAllReadings(prev => [...olderData, ...prev]);
              setBackgroundLoading(false);
              setBackgroundProgress(null);
            }
          })
          .catch(() => {
            if (!cancelled) {
              setBackgroundLoading(false);
              setBackgroundProgress(null);
            }
          });
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message ?? 'Error al cargar datos RFID');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
    // Re-fetch when date or country filters change
  }, [filters.dateFrom, filters.dateTo, filters.originCountry, filters.destCountry]);

  // Fetch direct RFID event counts with progressive loading:
  // Step 1 — show last 30 days immediately
  // Step 2 — update with full historical range in background (when no explicit date filter)
  useEffect(() => {
    let cancelled = false;
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const originArg = filters.originCountry !== 'ALL' ? filters.originCountry : undefined;
    const destArg   = filters.destCountry   !== 'ALL' ? filters.destCountry   : undefined;

    // If explicit date filters are set, just fetch that range directly (no progressive loading)
    if (filters.dateFrom || filters.dateTo) {
      setRfidCountsLoading(false);
      fetchRfidEventCounts(filters.dateFrom, filters.dateTo, originArg, destArg)
        .then(counts => { if (!cancelled) setRfidCounts(counts); })
        .catch(() => {});
      return () => { cancelled = true; };
    }

    // No explicit date filter — progressive: 30 days first, then full history
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const recentFrom = thirtyDaysAgo.toISOString().split('T')[0];

    // Step 1: last 30 days immediately
    fetchRfidEventCounts(recentFrom, todayStr, originArg, destArg)
      .then(recentCounts => {
        if (cancelled) return;
        setRfidCounts(recentCounts);
        // Step 2: full history in background
        setRfidCountsLoading(true);
        // Use a wide range covering all data (from 2024-01-01 to avoid full-table scan timeout)
        fetchRfidEventCounts('2024-01-01', todayStr, originArg, destArg)
          .then(fullCounts => {
            if (!cancelled) {
              setRfidCounts(fullCounts);
              setRfidCountsLoading(false);
            }
          })
          .catch(() => { if (!cancelled) setRfidCountsLoading(false); });
      })
      .catch(() => { if (!cancelled) setRfidCountsLoading(false); });

    return () => { cancelled = true; };
  }, [filters.dateFrom, filters.dateTo, filters.originCountry, filters.destCountry]);

  // Build journeys from all readings
  const allJourneys = useMemo(() => {
    const journeys = readingsToJourneys(allReadings);
    console.log(`[EDGE] allReadings: ${allReadings.length} events → ${journeys.length} journeys`);
    return journeys;
  }, [allReadings]);

  // Helper: effective destination country for a journey.
  // Priority: DESTINATION event country > ARRIVAL event country.
  // This ensures journeys that only have ARRIVAL (no DESTINATION) still appear in dest filters.
  function effectiveDestCountry(j: RfidJourney): string | null {
    if (j.dest_country) return j.dest_country;
    if (j.arrival_country && j.arrival_country !== j.origin_country) return j.arrival_country;
    return null;
  }

  // Helper: effective origin country for a journey.
  // Priority: ORIGIN event country > DEPARTURE event country.
  function effectiveOriginCountry(j: RfidJourney): string | null {
    if (j.origin_country) return j.origin_country;
    if (j.departure_country) return j.departure_country;
    return null;
  }

  // Available origin countries — narrowed by active destCountry filter
  const allOriginCountries = useMemo(() => {
    const pool = (filters.destCountry && filters.destCountry !== 'ALL')
      ? allJourneys.filter(j => effectiveDestCountry(j) === filters.destCountry)
      : allJourneys;
    return Array.from(new Set(pool.map(j => effectiveOriginCountry(j)).filter(Boolean) as string[])).sort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJourneys, filters.destCountry]);

  // Available destination countries — narrowed by active originCountry filter
  const allDestCountries = useMemo(() => {
    const pool = (filters.originCountry && filters.originCountry !== 'ALL')
      ? allJourneys.filter(j => effectiveOriginCountry(j) === filters.originCountry)
      : allJourneys;
    return Array.from(new Set(
      pool.map(j => effectiveDestCountry(j)).filter(Boolean) as string[]
    )).sort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJourneys, filters.originCountry]);

  // Apply country filters in the browser
  const filteredJourneys = useMemo(() => {
    let j = allJourneys;
    if (filters.originCountry && filters.originCountry !== 'ALL') {
      j = j.filter(x => effectiveOriginCountry(x) === filters.originCountry);
    }
    if (filters.destCountry && filters.destCountry !== 'ALL') {
      j = j.filter(x => effectiveDestCountry(x) === filters.destCountry);
    }
    return j;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJourneys, filters.originCountry, filters.destCountry]);

  const stats = useMemo(
    () => computeEpcisStats(filteredJourneys),
    [filteredJourneys]
  );

  return {
    loading,
    backgroundLoading,
    backgroundProgress,
    rfidCountsLoading,
    error,
    stats,
    rfidCounts,
    journeys: filteredJourneys,
    allOriginCountries,
    allDestCountries,
  };
}
