/**
 * useEpcisData — builds RFID journey data from tracking_events.
 *
 * Source: tracking_events (has_rfid = true)
 * Fields used:
 *   rfid_origin_impc, rfid_origin_country, rfid_origin_centre, rfid_origin_time, rfid_origin_readings
 *   rfid_dest_impc,   rfid_dest_country,   rfid_dest_centre,   rfid_dest_time,   rfid_dest_readings
 *   rfid_transit_hours, rfid_total_readings, rfid_intermediate_centres
 *   s9id, tag_id, coverage_type
 *
 * Replaces the previous implementation that queried "datos EPCIS" + postal_readers.
 */

import { useMemo } from 'react';
import type { TrackingEvent } from '@/lib/supabase';

// Keep these exported so EpcisDataTable and other consumers don't break
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
  transit_hours: number | null;
  has_destination: boolean;
  centres_visited: string[];
}

export interface EpcisStats {
  totalReadings: number;
  uniqueReceptacles: number;
  withOriginReading: number;  // has rfid_origin_impc (BOTH + ORIGIN_ONLY)
  withDestReading: number;    // has rfid_dest_impc (BOTH + DEST_ONLY)
  uniqueOrigins: number;
  uniqueDestinations: number;
  endToEndPairs: number;
  endToEndPct: number;
  medianTransitHours: number | null;
  meanTransitHours: number | null;
  p25TransitHours: number | null;
  p75TransitHours: number | null;
  minTransitHours: number | null;
  maxTransitHours: number | null;
  byOriginCountry: { country: string; count: number; endToEnd: number; pct: number }[];
  byDestCountry:   { country: string; count: number }[];
  byOriginCentre:  { centre: string; country: string; count: number; endToEnd: number }[];
  byDestCentre:    { centre: string; country: string; count: number }[];
  departureByCentre: { centre: string; country: string; n: number; medianH: number }[];
  arrivalByCentre:   { centre: string; country: string; n: number; medianH: number }[];
  byRoute:           { route: string; origin: string; dest: string; count: number; medianH: number | null }[];
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

/* ─── Convert tracking_events rows → RfidJourney ─── */
// Handles all rfid_case types:
//   BOTH:             rfid_origin_impc + rfid_dest_impc both set
//   DEST_ONLY:        only rfid_dest_impc set (no origin reader)
//   ORIGIN_ONLY:      only rfid_origin_impc set (no dest reader)
//   INTERMEDIATE_ONLY/NO_EDI: has_rfid=true but no impc fields (derive from s9id)
function eventsToJourneys(events: TrackingEvent[]): RfidJourney[] {
  return events
    .filter(e => e.has_rfid)
    .map(e => {
      const rfidCase = (e as any).rfid_case as string | null;

      // Derive origin/dest from s9id when RFID fields are missing
      const s9idOriginImpc = e.s9id && e.s9id.length >= 12 ? e.s9id.slice(0, 6) : null;
      const s9idDestImpc   = e.s9id && e.s9id.length >= 12 ? e.s9id.slice(6, 12) : null;

      // Determine effective origin
      const originImpc    = e.rfid_origin_impc || (rfidCase === 'DEST_ONLY' ? s9idOriginImpc : null) || '';
      const originCountry = e.rfid_origin_country || e.predes_origin_country || '';
      const originCentre  = e.rfid_origin_centre  || e.predes_origin_centre  || originImpc;
      const originTime    = e.rfid_origin_time    || e.rfid_dest_time        || '';
      const originReadings = e.rfid_origin_readings ?? 0;

      // Determine effective destination
      const hasDest = !!(e.rfid_dest_impc && e.rfid_dest_time);
      const destImpc    = e.rfid_dest_impc    || null;
      const destCountry = e.rfid_dest_country || e.redes_dest_country || null;
      const destCentre  = e.rfid_dest_centre  || e.redes_dest_centre  || destImpc;
      const destTime    = e.rfid_dest_time    || null;
      const destReadings = hasDest ? (e.rfid_dest_readings ?? 1) : 0;

      const centresVisited: string[] = [];
      if (originCentre) centresVisited.push(originCentre);
      if (e.rfid_intermediate_centres) {
        const intermediates = Array.isArray(e.rfid_intermediate_centres)
          ? e.rfid_intermediate_centres
          : (e.rfid_intermediate_centres as string).split(',').map((s: string) => s.trim());
        centresVisited.push(...intermediates.filter(Boolean));
      }
      if (hasDest && destCentre && destCentre !== originCentre) {
        centresVisited.push(destCentre as string);
      }

      return {
        s9id: e.s9id,
        tag_id: e.tag_id || '',
        origin_country: originCountry,
        origin_centre: originCentre,
        origin_impc: originImpc,
        origin_time: originTime,
        origin_readings: originReadings,
        dest_country: hasDest ? destCountry : null,
        dest_centre: hasDest ? destCentre : null,
        dest_impc: hasDest ? destImpc : null,
        dest_time: hasDest ? destTime : null,
        dest_readings: destReadings,
        transit_hours: hasDest && e.rfid_transit_hours != null && e.rfid_transit_hours > 0
          ? e.rfid_transit_hours
          : null,
        has_destination: hasDest,
        centres_visited: centresVisited,
      };
    });
}

/* ─── Compute stats from journeys ─── */
function computeEpcisStats(journeys: RfidJourney[]): EpcisStats {
  const endToEnd = journeys.filter(j => j.has_destination);
  const transitValues = endToEnd
    .map(j => j.transit_hours!)
    .filter(h => h !== null && h > 0) as number[];

  const times = journeys.map(j => j.origin_time).filter(Boolean).sort();
  const destTimes = endToEnd.map(j => j.dest_time!).filter(Boolean).sort();
  const allTimes = [...times, ...destTimes].sort();
  const dateRange = allTimes.length > 0 ? { min: allTimes[0], max: allTimes[allTimes.length - 1] } : null;

  // By origin country — only journeys with actual RFID reading at origin (origin_readings > 0)
  const journeysWithOrigin = journeys.filter(j => j.origin_readings > 0 && j.origin_impc);
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

  // By dest country
  const destCountryMap = new Map<string, number>();
  for (const j of endToEnd) {
    const c = j.dest_country || 'Unknown';
    destCountryMap.set(c, (destCountryMap.get(c) || 0) + 1);
  }
  const byDestCountry = Array.from(destCountryMap.entries())
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count);

  // By origin centre — only journeys with actual RFID reading at origin
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

  // By dest centre
  const destCentreMap = new Map<string, { country: string; count: number }>();
  for (const j of endToEnd) {
    const key = j.dest_centre || 'Unknown';
    if (!destCentreMap.has(key)) destCentreMap.set(key, { country: j.dest_country || '', count: 0 });
    destCentreMap.get(key)!.count++;
  }
  const byDestCentre = Array.from(destCentreMap.entries())
    .map(([centre, v]) => ({ centre, country: v.country, count: v.count }))
    .sort((a, b) => b.count - a.count);

  // Departure by origin centre (e2e pairs with valid transit)
  const depCentreMap = new Map<string, { country: string; hours: number[] }>();
  for (const j of endToEnd) {
    if (j.transit_hours === null || j.transit_hours < 0) continue;
    const key = j.origin_centre || 'Unknown';
    if (!depCentreMap.has(key)) depCentreMap.set(key, { country: j.origin_country, hours: [] });
    depCentreMap.get(key)!.hours.push(j.transit_hours);
  }
  const departureByCentre = Array.from(depCentreMap.entries())
    .map(([centre, v]) => ({
      centre,
      country: v.country,
      n: v.hours.length,
      medianH: Math.round((median(v.hours) ?? 0) * 10) / 10,
    }))
    .sort((a, b) => b.n - a.n);

  // Arrival by dest centre
  const arrCentreMap = new Map<string, { country: string; hours: number[] }>();
  for (const j of endToEnd) {
    if (j.transit_hours === null || j.transit_hours < 0) continue;
    const key = j.dest_centre || 'Unknown';
    if (!arrCentreMap.has(key)) arrCentreMap.set(key, { country: j.dest_country || '', hours: [] });
    arrCentreMap.get(key)!.hours.push(j.transit_hours);
  }
  const arrivalByCentre = Array.from(arrCentreMap.entries())
    .map(([centre, v]) => ({
      centre,
      country: v.country,
      n: v.hours.length,
      medianH: Math.round((median(v.hours) ?? 0) * 10) / 10,
    }))
    .sort((a, b) => b.n - a.n);

  // By route
  const routeMap = new Map<string, { origin: string; dest: string; count: number; hours: number[] }>();
  for (const j of endToEnd) {
    const key = `${j.origin_country} → ${j.dest_country}`;
    if (!routeMap.has(key)) routeMap.set(key, { origin: j.origin_country, dest: j.dest_country || '', count: 0, hours: [] });
    const v = routeMap.get(key)!;
    v.count++;
    if (j.transit_hours !== null && j.transit_hours > 0) v.hours.push(j.transit_hours);
  }
  const byRoute = Array.from(routeMap.entries())
    .map(([route, v]) => ({
      route,
      origin: v.origin,
      dest: v.dest,
      count: v.count,
      medianH: v.hours.length > 0 ? Math.round((median(v.hours) ?? 0) * 10) / 10 : null,
    }))
    .sort((a, b) => b.count - a.count);

  const transitCdf = buildCDF(transitValues);

  const totalReadings = journeys.reduce((sum, j) => sum + j.origin_readings + j.dest_readings, 0);
  const withOriginReading = journeys.filter(j => j.origin_impc && j.origin_readings > 0).length;
  const withDestReading = journeys.filter(j => j.has_destination).length;

  return {
    totalReadings,
    uniqueReceptacles: journeys.length,
    withOriginReading,
    withDestReading,
    uniqueOrigins: originCountryMap.size,
    uniqueDestinations: destCountryMap.size,
    endToEndPairs: endToEnd.length,
    endToEndPct: journeys.length > 0 ? Math.round(endToEnd.length / journeys.length * 100) : 0,
    medianTransitHours: transitValues.length > 0 ? Math.round((median(transitValues) ?? 0) * 10) / 10 : null,
    meanTransitHours: transitValues.length > 0 ? Math.round(transitValues.reduce((a, b) => a + b, 0) / transitValues.length * 10) / 10 : null,
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

/* ─── Filter helpers ─── */
export interface EpcisFilters {
  dateFrom?: string;
  dateTo?: string;
  originCountry?: string;
  destCountry?: string;
  /** Pass allEvents from useTrackingData to avoid double-fetching */
  allEvents?: TrackingEvent[];
  loading?: boolean;
  error?: string | null;
}

/* ─── Main hook ─── */
export function useEpcisData(filters: EpcisFilters = {}) {
  // Use events passed in from parent (useTrackingData) to avoid double-fetching
  const allEvents = filters.allEvents ?? [];
  const loading = filters.loading ?? false;
  const error = filters.error ?? null;

  // Filter events by date
  const dateFilteredEvents = useMemo(() => {
    let evts = allEvents.filter(e => e.has_rfid);
    if (filters.dateFrom) {
      evts = evts.filter(e => e.rfid_origin_time! >= filters.dateFrom!);
    }
    if (filters.dateTo) {
      const to = filters.dateTo + 'T23:59:59Z';
      evts = evts.filter(e => e.rfid_origin_time! <= to);
    }
    return evts;
  }, [allEvents, filters.dateFrom, filters.dateTo]);

  // Build journeys from date-filtered events
  const dateFilteredJourneys = useMemo(
    () => eventsToJourneys(dateFilteredEvents),
    [dateFilteredEvents]
  );

  // Available countries (from date-filtered journeys)
  const allOriginCountries = useMemo(() =>
    Array.from(new Set(dateFilteredJourneys.map(j => j.origin_country).filter(Boolean))).sort(),
    [dateFilteredJourneys]
  );
  const allDestCountries = useMemo(() =>
    Array.from(new Set(dateFilteredJourneys.filter(j => j.has_destination).map(j => j.dest_country!).filter(Boolean))).sort(),
    [dateFilteredJourneys]
  );

  // Apply country filters
  const filteredJourneys = useMemo(() => {
    let j = dateFilteredJourneys;
    if (filters.originCountry && filters.originCountry !== 'ALL') {
      j = j.filter(x => x.origin_country === filters.originCountry);
    }
    if (filters.destCountry && filters.destCountry !== 'ALL') {
      j = j.filter(x => x.dest_country === filters.destCountry);
    }
    return j;
  }, [dateFilteredJourneys, filters.originCountry, filters.destCountry]);

  const stats = useMemo(
    () => computeEpcisStats(filteredJourneys),
    [filteredJourneys]
  );

  return {
    loading,
    error,
    stats,
    journeys: filteredJourneys,
    allOriginCountries,
    allDestCountries,
  };
}
