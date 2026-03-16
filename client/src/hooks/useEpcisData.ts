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
import { fetchRfidReadings } from '@/lib/supabase';
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
  departureByCentre: { centre: string; country: string; n: number; avgH: number }[];
  arrivalByCentre:   { centre: string; country: string; n: number; avgH: number }[];
  byRoute:           { route: string; origin: string; dest: string; count: number; avgH: number | null }[];
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
 * The RFID table stores one ORIGIN row and one DESTINATION row per tag_id.
 * Country and centre are extracted from the `location` field.
 * When s9id equals tag_id (no real S9ID mapping), tag_id is shown as identity.
 */
function readingsToJourneys(readings: RfidReading[]): RfidJourney[] {
  // Group by tag_id (each tag has exactly one ORIGIN and one DESTINATION row)
  const byTag = new Map<string, RfidReading[]>();
  for (const r of readings) {
    const key = r.tag_id || r.s9id;
    if (!key) continue;
    if (!byTag.has(key)) byTag.set(key, []);
    byTag.get(key)!.push(r);
  }

  const journeys: RfidJourney[] = [];

  for (const [tagKey, rows] of Array.from(byTag.entries())) {
    const originRow = rows.find(r => r.event_type === 'ORIGIN') ?? null;
    const destRow   = rows.find(r => r.event_type === 'DESTINATION') ?? null;
    const interRows = rows.filter(r => r.event_type === 'INTERMEDIATE');

    // Need at least an ORIGIN row
    if (!originRow) continue;

    // Extract country and centre from location field
    const originLoc = parseLocation(originRow.location);
    const originImpc    = originRow.impc_code || '';
    const originCountry = originLoc.country;
    const originCentre  = originLoc.centre || originImpc;
    const originTime    = originRow.event_time_local || originRow.record_time || '';
    const originReadings = 1;

    const hasDest = destRow !== null;
    const destLoc     = hasDest ? parseLocation(destRow!.location) : null;
    const destImpc    = hasDest ? (destRow!.impc_code || null) : null;
    const destCountry = hasDest ? (destLoc!.country || null) : null;
    const destCentre  = hasDest ? (destLoc!.centre || destImpc) : null;
    const destTime    = hasDest ? (destRow!.event_time_local || destRow!.record_time || null) : null;
    const destReadings = hasDest ? 1 : 0;

    // s9id: use real s9id only if it differs from tag_id (i.e. a real S9ID exists)
    const tag_id = originRow.tag_id || tagKey;
    const s9id   = (originRow.s9id && originRow.s9id !== tag_id) ? originRow.s9id : tag_id;

    // Calculate transit hours
    let transitHours: number | null = null;
    if (hasDest && originTime && destTime) {
      const diffMs = new Date(destTime).getTime() - new Date(originTime).getTime();
      if (diffMs > 0) {
        transitHours = Math.round((diffMs / 3600000) * 10) / 10;
      }
    }

    // Build centres visited list
    const centresVisited: string[] = [];
    if (originCentre) centresVisited.push(originCentre);
    for (const ir of interRows) {
      const loc = parseLocation(ir.location);
      const c = loc.centre || ir.impc_code || '';
      if (c && !centresVisited.includes(c)) centresVisited.push(c);
    }
    if (hasDest && destCentre && !centresVisited.includes(destCentre as string)) {
      centresVisited.push(destCentre as string);
    }

    journeys.push({
      s9id,
      tag_id,
      origin_country: originCountry,
      origin_centre:  originCentre,
      origin_impc:    originImpc,
      origin_time:    originTime,
      origin_readings: originReadings,
      dest_country:   destCountry,
      dest_centre:    destCentre,
      dest_impc:      destImpc,
      dest_time:      destTime,
      dest_readings:  destReadings,
      transit_hours:  transitHours,
      has_destination: hasDest,
      is_both_rfid:   originRow !== null && destRow !== null,
      centres_visited: centresVisited,
    });
  }

  return journeys;
}

/* ─── Compute stats from journeys ─── */
function computeEpcisStats(journeys: RfidJourney[]): EpcisStats {
  const endToEnd = journeys.filter(j => j.has_destination);
  const bothRfid  = journeys.filter(j => j.is_both_rfid);
  const transitValues = endToEnd
    .map(j => j.transit_hours!)
    .filter(h => h !== null && h > 0) as number[];

  const times = journeys.map(j => j.origin_time).filter(Boolean).sort();
  const destTimes = endToEnd.map(j => j.dest_time!).filter(Boolean).sort();
  const allTimes = [...times, ...destTimes].sort();
  const dateRange = allTimes.length > 0 ? { min: allTimes[0], max: allTimes[allTimes.length - 1] } : null;

  // By origin country — only journeys with actual RFID reading at origin
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

  // Departure by origin centre
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
      avgH: Math.round((mean(v.hours) ?? 0) * 10) / 10,
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
      avgH: Math.round((mean(v.hours) ?? 0) * 10) / 10,
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
      avgH: v.hours.length > 0 ? Math.round((mean(v.hours) ?? 0) * 10) / 10 : null,
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
    endToEndPairs: bothRfid.length,
    endToEndPct: journeys.length > 0 ? Math.round(bothRfid.length / journeys.length * 100) : 0,
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
  const [error, setError] = useState<string | null>(null);

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

    // Progressive loading: fetch last 30 days first, then load the rest in background
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const recentFrom = thirtyDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD

    // Step 1: Load last 30 days immediately
    fetchRfidReadings(recentFrom, undefined)
      .then(recentData => {
        if (cancelled) return;
        setAllReadings(recentData);
        setLoading(false); // UI is now usable with recent data

        // Step 2: Load older data in background
        const dayBefore = new Date(thirtyDaysAgo);
        dayBefore.setDate(dayBefore.getDate() - 1);
        const olderTo = dayBefore.toISOString().split('T')[0];

        setBackgroundLoading(true);
        fetchRfidReadings(undefined, olderTo)
          .then(olderData => {
            if (!cancelled) {
              setAllReadings(prev => [...olderData, ...prev]); // prepend older data
              setBackgroundLoading(false);
            }
          })
          .catch(() => {
            if (!cancelled) setBackgroundLoading(false);
          });
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message ?? 'Error al cargar datos RFID');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
    // Re-fetch when date filters change
  }, [filters.dateFrom, filters.dateTo]);

  // Build journeys from all readings
  const allJourneys = useMemo(() => readingsToJourneys(allReadings), [allReadings]);

  // Available countries (from all journeys)
  const allOriginCountries = useMemo(() =>
    Array.from(new Set(allJourneys.map(j => j.origin_country).filter(Boolean))).sort(),
    [allJourneys]
  );
  const allDestCountries = useMemo(() =>
    Array.from(new Set(allJourneys.filter(j => j.has_destination).map(j => j.dest_country!).filter(Boolean))).sort(),
    [allJourneys]
  );

  // Apply country filters in the browser
  const filteredJourneys = useMemo(() => {
    let j = allJourneys;
    if (filters.originCountry && filters.originCountry !== 'ALL') {
      j = j.filter(x => x.origin_country === filters.originCountry);
    }
    if (filters.destCountry && filters.destCountry !== 'ALL') {
      j = j.filter(x => x.dest_country === filters.destCountry);
    }
    return j;
  }, [allJourneys, filters.originCountry, filters.destCountry]);

  const stats = useMemo(
    () => computeEpcisStats(filteredJourneys),
    [filteredJourneys]
  );

  return {
    loading,
    backgroundLoading,
    error,
    stats,
    journeys: filteredJourneys,
    allOriginCountries,
    allDestCountries,
  };
}
