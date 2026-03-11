/**
 * useEpcisData — fetches datos EPCIS + postal_readers from Supabase and computes
 * pure RFID metrics (no EDI dependency whatsoever).
 *
 * Logic (per user requirement):
 *   - Join each EPCIS reading to postal_readers via read_point_id
 *     → resolves the physical center_name (groups multiple IMPC readers at same centre)
 *   - Group readings by s9id → identify distinct physical centres visited in time order
 *   - rfid_origin_time  = LAST  reading at the FIRST  physical centre  (departure moment)
 *   - rfid_dest_time    = FIRST reading at the SECOND physical centre  (arrival moment)
 *   - rfid_transit_hours = dest_time − origin_time
 *
 * Filters applied: date range, origin country, destination country
 */

import { useState, useEffect, useMemo } from 'react';

const SUPABASE_URL = 'https://ewyhmmixqcubqokphebh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eWhtbWl4cWN1YnFva3BoZWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTc3MjMsImV4cCI6MjA4ODU3MzcyM30.xMtcrn12c9r0Q_Q0e46Ptsci7Y31YnB5V9MSBHgj20k';
const EPCIS_HEADERS = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
};

/* ─── Types ─── */
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

/* ─── Country normalization ─── */
const COUNTRY_NORM: Record<string, string> = {
  'Hong-Kong': 'Hong Kong',
  'Turqu\u00eda': 'Turkey',
  'Brasil': 'Brazil',
  'Catar': 'Qatar',
  'Corea del Sur': 'South Korea',
  'Jap\u00f3n': 'Japan',
  'Ruman\u00eda': 'Romania',
  'Singapur': 'Singapore',
  'Suiza': 'Switzerland',
  'Tailandia': 'Thailand',
  'Bosnia y Herzegovina': 'Bosnia and Herzegovina',
  'Alemania': 'Germany',
  'Rusia': 'Russia',
  'But\u00e1n': 'Bhutan',
};
function normalizeCountry(c: string): string {
  return COUNTRY_NORM[c] ?? c;
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

/* ─── Fetch helpers ─── */
async function fetchAllEpcis(): Promise<EpcisReading[]> {
  const PAGE = 1000;
  let all: EpcisReading[] = [];
  let from = 0;
  while (true) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent('datos EPCIS')}`);
    url.searchParams.set('select', 'id,s9id,tag_id,record_time,location,read_point_id,impc_code');
    url.searchParams.set('order', 'record_time.asc');
    url.searchParams.set('limit', String(PAGE));
    url.searchParams.set('offset', String(from));
    const res = await fetch(url.toString(), { headers: EPCIS_HEADERS });
    if (!res.ok) throw new Error(`EPCIS fetch error: ${res.status}`);
    const data: EpcisReading[] = await res.json();
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function fetchPostalReaders(): Promise<PostalReader[]> {
  const url = `${SUPABASE_URL}/rest/v1/postal_readers?select=read_point_id,impc_code,country,city,center_name,gate&limit=500`;
  const res = await fetch(url, { headers: EPCIS_HEADERS });
  if (!res.ok) throw new Error(`postal_readers fetch error: ${res.status}`);
  return res.json();
}

/* ─── Build reader lookup map ─── */
function buildReaderMap(readers: PostalReader[]): Map<string, ReaderInfo> {
  const map = new Map<string, ReaderInfo>();
  for (const r of readers) {
    map.set(r.read_point_id, {
      center_name: r.center_name,
      country: normalizeCountry(r.country),
      impc_code: r.impc_code,
    });
  }
  return map;
}

/* ─── Build journeys from raw readings + reader map ─── */
function buildJourneys(
  readings: EpcisReading[],
  readerMap: Map<string, ReaderInfo>,
): RfidJourney[] {
  const byS9: Map<string, EpcisReading[]> = new Map();
  for (const r of readings) {
    if (!r.s9id) continue;
    if (!byS9.has(r.s9id)) byS9.set(r.s9id, []);
    byS9.get(r.s9id)!.push(r);
  }

  const journeys: RfidJourney[] = [];

  for (const [s9id, recs] of Array.from(byS9.entries())) {
    recs.sort((a, b) => a.record_time.localeCompare(b.record_time));

    // Resolve each reading to physical centre via postal_readers
    const resolved = recs.map(r => {
      const info = readerMap.get(r.read_point_id);
      if (info) return { r, center_name: info.center_name, country: info.country, impc_code: info.impc_code };
      // Fallback: parse location field
      const parts = r.location.split('|').map((s: string) => s.trim());
      return {
        r,
        center_name: parts[2] || r.impc_code || 'Unknown',
        country: normalizeCountry(parts[0] || ''),
        impc_code: r.impc_code || '',
      };
    });

    // Identify sequence of distinct physical centres (by center_name)
    const centresSeq: { center_name: string; country: string; impc_code: string }[] = [];
    for (const item of resolved) {
      if (!centresSeq.length || centresSeq[centresSeq.length - 1].center_name !== item.center_name) {
        centresSeq.push({ center_name: item.center_name, country: item.country, impc_code: item.impc_code });
      }
    }

    const originCentre = centresSeq[0]?.center_name || '';
    const originCountry = centresSeq[0]?.country || '';
    const originImpc = centresSeq[0]?.impc_code || '';

    // Destination = second distinct physical centre
    const destCentre = centresSeq.length > 1 ? centresSeq[1].center_name : null;
    const destCountry = centresSeq.length > 1 ? centresSeq[1].country : null;
    const destImpc = centresSeq.length > 1 ? centresSeq[1].impc_code : null;

    // Origin readings = all at origin centre; LAST = departure moment
    const originRecs = resolved.filter(item => item.center_name === originCentre);
    const originTime = originRecs.reduce(
      (max, item) => item.r.record_time > max ? item.r.record_time : max,
      originRecs[0].r.record_time
    );

    // Destination readings; FIRST = arrival moment
    let destTime: string | null = null;
    let destReadings = 0;
    if (destCentre && destCentre !== originCentre) {
      const destRecs = resolved.filter(item => item.center_name === destCentre);
      destReadings = destRecs.length;
      if (destRecs.length > 0) {
        destTime = destRecs.reduce(
          (min, item) => item.r.record_time < min ? item.r.record_time : min,
          destRecs[0].r.record_time
        );
      }
    }

    let transitHours: number | null = null;
    if (originTime && destTime) {
      const diff = (new Date(destTime).getTime() - new Date(originTime).getTime()) / 3600000;
      if (diff >= 0) transitHours = Math.round(diff * 10) / 10;
    }

    journeys.push({
      s9id,
      tag_id: recs[0].tag_id,
      origin_country: originCountry,
      origin_centre: originCentre,
      origin_impc: originImpc,
      origin_time: originTime,
      origin_readings: originRecs.length,
      dest_country: destCountry,
      dest_centre: destCentre,
      dest_impc: destImpc,
      dest_time: destTime,
      dest_readings: destReadings,
      transit_hours: transitHours,
      has_destination: destCentre !== null && destCentre !== originCentre && destTime !== null,
      centres_visited: centresSeq.map(c => c.center_name),
    });
  }

  return journeys;
}

/* ─── Compute stats ─── */
function computeEpcisStats(
  journeys: RfidJourney[],
  allReadings: EpcisReading[],
): EpcisStats {
  const endToEnd = journeys.filter(j => j.has_destination);
  const transitValues = endToEnd
    .map(j => j.transit_hours!)
    .filter(h => h !== null && h > 0) as number[];

  const times = allReadings.map(r => r.record_time).filter(Boolean).sort();
  const dateRange = times.length > 0 ? { min: times[0], max: times[times.length - 1] } : null;

  // By origin country
  const originCountryMap = new Map<string, { count: number; endToEnd: number }>();
  for (const j of journeys) {
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
  for (const j of journeys) {
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

  // Departure by origin centre (only e2e pairs with valid transit)
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

  return {
    totalReadings: allReadings.length,
    uniqueReceptacles: journeys.length,
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
}

/* ─── Main hook ─── */
export function useEpcisData(filters: EpcisFilters = {}) {
  const [allReadings, setAllReadings] = useState<EpcisReading[]>([]);
  const [readerMap, setReaderMap] = useState<Map<string, ReaderInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAllEpcis(), fetchPostalReaders()])
      .then(([readings, readers]) => {
        setAllReadings(readings);
        setReaderMap(buildReaderMap(readers));
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  // Apply date filter to readings first, then rebuild journeys
  const dateFilteredReadings = useMemo(() => {
    let r = allReadings;
    if (filters.dateFrom) r = r.filter(x => x.record_time >= filters.dateFrom!);
    if (filters.dateTo) {
      const to = filters.dateTo + 'T23:59:59Z';
      r = r.filter(x => x.record_time <= to);
    }
    return r;
  }, [allReadings, filters.dateFrom, filters.dateTo]);

  const dateFilteredJourneys = useMemo(
    () => buildJourneys(dateFilteredReadings, readerMap),
    [dateFilteredReadings, readerMap]
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

  // Apply country filters to journeys
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

  // Filtered readings (for total count display)
  const filteredReadings = useMemo(() => {
    const s9ids = new Set(filteredJourneys.map(j => j.s9id));
    return dateFilteredReadings.filter(r => (s9ids as Set<string>).has(r.s9id));
  }, [dateFilteredReadings, filteredJourneys]);

  const stats = useMemo(
    () => computeEpcisStats(filteredJourneys, filteredReadings),
    [filteredJourneys, filteredReadings]
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
