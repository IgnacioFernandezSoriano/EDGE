import { useState, useEffect, useMemo } from 'react';
import { fetchTrackingEvents, TrackingEvent } from '@/lib/supabase';

export interface DateRange {
  from: string | null; // ISO date string YYYY-MM-DD
  to: string | null;
}

export interface DashboardStats {
  totalReceptacles: number;
  fullCoverage: number;
  rfidOnly: number;
  ediOnly: number;
  rfidPredes: number;
  rfidResdes: number;
  coverageRate: number;
  // Departure stats (RFID vs PREDES)
  departurePairs: number;
  departureMedianHours: number;
  departureMeanHours: number;
  departureP25: number;
  departureP75: number;
  departureRfidBefore: number;
  departureRfidBeforePct: number;
  // Arrival stats (RFID vs RESDES)
  arrivalPairs: number;
  arrivalMedianHours: number;
  arrivalMeanHours: number;
  arrivalRfidBefore: number;
  arrivalRfidBeforePct: number;
  // Transit stats
  transitPairs: number;
  rfidTransitMedian: number;
  ediTransitMedian: number;
  transitDiffMedian: number;
  // By origin country
  byOriginCountry: { country: string; count: number; medianDepartureLag: number }[];
  // By destination country
  byDestCountry: { country: string; count: number; medianArrivalLead: number }[];
  // Coverage breakdown
  coverageBreakdown: { type: string; count: number; pct: number }[];
  // Transit routes
  transitRoutes: { route: string; n: number; rfidMedian: number; ediMedian: number; diff: number }[];
  // Departure by origin centre
  departureByCentre: { centre: string; country: string; n: number; median: number; rfidBeforePct: number }[];
  // Arrival by dest centre
  arrivalByCentre: { centre: string; country: string; n: number; median: number; rfidBeforePct: number }[];
  // Date range of the filtered data
  minDate: string | null;
  maxDate: string | null;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

/** Get the "reference date" for a tracking event — the earliest non-null timestamp */
function getEventDate(e: TrackingEvent): Date | null {
  const candidates = [e.rfid_origin_time, e.predes_time, e.redes_time, e.rfid_dest_time]
    .filter(Boolean)
    .map(t => new Date(t!));
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a < b ? a : b));
}

export function computeStats(events: TrackingEvent[]): DashboardStats {
  const total = events.length;
  const full = events.filter(e => e.coverage_type === 'FULL').length;
  const rfidOnly = events.filter(e => e.coverage_type === 'RFID_ONLY').length;
  const ediOnly = events.filter(e => e.coverage_type === 'EDI_ONLY').length;
  const rfidPredes = events.filter(e => e.coverage_type === 'RFID_PREDES').length;
  const rfidResdes = events.filter(e => e.coverage_type === 'RFID_RESDES').length;

  // Departure pairs: has RFID + PREDES
  const departurePairsData = events.filter(
    e => e.departure_lag_hours !== null && e.has_rfid && e.has_predes
  );
  const departureLags = departurePairsData.map(e => e.departure_lag_hours!);
  const departureRfidBefore = departureLags.filter(h => h < 0).length;

  // Arrival pairs: has RFID + RESDES
  const arrivalPairsData = events.filter(
    e => e.arrival_lead_hours !== null && e.has_rfid && e.has_resdes
  );
  const arrivalLeads = arrivalPairsData.map(e => e.arrival_lead_hours!);
  const arrivalRfidBefore = arrivalLeads.filter(h => h < 0).length;

  // Transit pairs: full route validated
  const transitData = events.filter(
    e => e.full_route_validated && e.rfid_transit_hours !== null && e.edi_transit_hours !== null
  );
  const rfidTransits = transitData.map(e => e.rfid_transit_hours!);
  const ediTransits = transitData.map(e => e.edi_transit_hours!);
  const transitDiffs = transitData.map(e => e.transit_diff_hours!).filter(v => v !== null);

  // By origin country (departure)
  const byOriginGroups = groupBy(departurePairsData.filter(e => e.rfid_origin_country), e => e.rfid_origin_country!);
  const byOriginCountry = Object.entries(byOriginGroups)
    .map(([country, items]) => ({
      country,
      count: items.length,
      medianDepartureLag: median(items.map(e => e.departure_lag_hours!)),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // By destination country (arrival)
  const byDestGroups = groupBy(arrivalPairsData.filter(e => e.redes_dest_country), e => e.redes_dest_country!);
  const byDestCountry = Object.entries(byDestGroups)
    .map(([country, items]) => ({
      country,
      count: items.length,
      medianArrivalLead: median(items.map(e => e.arrival_lead_hours!)),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Coverage breakdown
  const coverageBreakdown = [
    { type: 'FULL', count: full, pct: total > 0 ? Math.round((full / total) * 100) : 0 },
    { type: 'RFID_PREDES', count: rfidPredes, pct: total > 0 ? Math.round((rfidPredes / total) * 100) : 0 },
    { type: 'RFID_RESDES', count: rfidResdes, pct: total > 0 ? Math.round((rfidResdes / total) * 100) : 0 },
    { type: 'RFID_ONLY', count: rfidOnly, pct: total > 0 ? Math.round((rfidOnly / total) * 100) : 0 },
    { type: 'EDI_ONLY', count: ediOnly, pct: total > 0 ? Math.round((ediOnly / total) * 100) : 0 },
  ];

  // Transit routes
  const routeGroups = groupBy(
    transitData.filter(e => e.rfid_origin_impc && e.rfid_dest_impc),
    e => `${e.rfid_origin_country || e.rfid_origin_impc} → ${e.rfid_dest_country || e.rfid_dest_impc}`
  );
  const transitRoutes = Object.entries(routeGroups)
    .map(([route, items]) => ({
      route,
      n: items.length,
      rfidMedian: median(items.map(e => e.rfid_transit_hours!)),
      ediMedian: median(items.map(e => e.edi_transit_hours!)),
      diff: median(items.map(e => e.transit_diff_hours!).filter(v => v !== null)),
    }))
    .sort((a, b) => b.n - a.n);

  // Departure by origin centre
  const depCentreGroups = groupBy(
    departurePairsData.filter(e => e.rfid_origin_centre),
    e => e.rfid_origin_centre!
  );
  const departureByCentre = Object.entries(depCentreGroups)
    .map(([centre, items]) => ({
      centre,
      country: items[0].rfid_origin_country || '',
      n: items.length,
      median: median(items.map(e => e.departure_lag_hours!)),
      rfidBeforePct: Math.round((items.filter(e => e.departure_lag_hours! < 0).length / items.length) * 100),
    }))
    .sort((a, b) => b.n - a.n);

  // Arrival by dest centre
  const arrCentreGroups = groupBy(
    arrivalPairsData.filter(e => e.redes_dest_centre),
    e => e.redes_dest_centre!
  );
  const arrivalByCentre = Object.entries(arrCentreGroups)
    .map(([centre, items]) => ({
      centre,
      country: items[0].redes_dest_country || '',
      n: items.length,
      median: median(items.map(e => e.arrival_lead_hours!)),
      rfidBeforePct: Math.round((items.filter(e => e.arrival_lead_hours! < 0).length / items.length) * 100),
    }))
    .sort((a, b) => b.n - a.n);

  // Date range of filtered events
  const allDates = events
    .map(e => getEventDate(e))
    .filter(Boolean) as Date[];
  const minDate = allDates.length > 0
    ? allDates.reduce((a, b) => (a < b ? a : b)).toISOString().slice(0, 10)
    : null;
  const maxDate = allDates.length > 0
    ? allDates.reduce((a, b) => (a > b ? a : b)).toISOString().slice(0, 10)
    : null;

  return {
    totalReceptacles: total,
    fullCoverage: full,
    rfidOnly,
    ediOnly,
    rfidPredes,
    rfidResdes,
    coverageRate: total > 0 ? Math.round(((total - ediOnly) / total) * 100) : 0,
    departurePairs: departurePairsData.length,
    departureMedianHours: Math.round(median(departureLags) * 10) / 10,
    departureMeanHours: Math.round(mean(departureLags) * 10) / 10,
    departureP25: Math.round(percentile(departureLags, 25) * 10) / 10,
    departureP75: Math.round(percentile(departureLags, 75) * 10) / 10,
    departureRfidBefore,
    departureRfidBeforePct: departureLags.length > 0 ? Math.round((departureRfidBefore / departureLags.length) * 100) : 0,
    arrivalPairs: arrivalPairsData.length,
    arrivalMedianHours: Math.round(median(arrivalLeads) * 10) / 10,
    arrivalMeanHours: Math.round(mean(arrivalLeads) * 10) / 10,
    arrivalRfidBefore,
    arrivalRfidBeforePct: arrivalLeads.length > 0 ? Math.round((arrivalRfidBefore / arrivalLeads.length) * 100) : 0,
    transitPairs: transitData.length,
    rfidTransitMedian: Math.round(median(rfidTransits) * 10) / 10,
    ediTransitMedian: Math.round(median(ediTransits) * 10) / 10,
    transitDiffMedian: Math.round(median(transitDiffs) * 10) / 10,
    byOriginCountry,
    byDestCountry,
    coverageBreakdown,
    transitRoutes,
    departureByCentre,
    arrivalByCentre,
    minDate,
    maxDate,
  };
}

/** Apply date range filter to events using the earliest timestamp of each event */
export function filterEventsByDate(events: TrackingEvent[], dateRange: DateRange): TrackingEvent[] {
  if (!dateRange.from && !dateRange.to) return events;
  return events.filter(e => {
    const d = getEventDate(e);
    if (!d) return true;
    const dateStr = d.toISOString().slice(0, 10);
    if (dateRange.from && dateStr < dateRange.from) return false;
    if (dateRange.to && dateStr > dateRange.to) return false;
    return true;
  });
}

/** Normalize country names to English to handle mixed Spanish/English values in the DB */
const COUNTRY_NORM: Record<string, string> = {
  // Spanish → English
  'Turquía': 'Turkey',
  'Brasil': 'Brazil',
  'Catar': 'Qatar',
  'Corea del Sur': 'South Korea',
  'Estados Unidos': 'United States',
  'Japón': 'Japan',
  'Reino Unido': 'United Kingdom',
  'Rumanía': 'Romania',
  'Singapur': 'Singapore',
  'Suiza': 'Switzerland',
  'Tailandia': 'Thailand',
  'Bosnia y Herzegovina': 'Bosnia and Herzegovina',
  'Alemania': 'Germany',
  'Montenegro': 'Montenegro',
  'Rusia': 'Russia',
  // Variant spellings → canonical English
  'Hong-Kong': 'Hong Kong',
  'Hong Kong': 'Hong Kong',
  'Portugal': 'Portugal',
};

export function normalizeCountry(c: string | null | undefined): string | null {
  if (!c) return null;
  return COUNTRY_NORM[c] ?? c;
}

/** Apply origin/destination country filters */
export function filterEventsByCountry(
  events: TrackingEvent[],
  originCountry: string | null,
  destCountry: string | null
): TrackingEvent[] {
  let result = events;
  if (originCountry) {
    result = result.filter(e =>
      normalizeCountry(e.rfid_origin_country || e.predes_origin_country) === originCountry
    );
  }
  if (destCountry) {
    result = result.filter(e =>
      normalizeCountry(e.redes_dest_country || e.rfid_dest_country) === destCountry
    );
  }
  return result;
}

export function useTrackingData() {
  const [allEvents, setAllEvents] = useState<TrackingEvent[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null });
  const [originCountry, setOriginCountry] = useState<string | null>(null);
  const [destCountry, setDestCountry] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTrackingEvents()
      .then(data => {
        setAllEvents(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Step 1: date filter
  const dateFiltered = useMemo(
    () => filterEventsByDate(allEvents, dateRange),
    [allEvents, dateRange]
  );

  // Step 2: country filters
  const events = useMemo(
    () => filterEventsByCountry(dateFiltered, originCountry, destCountry),
    [dateFiltered, originCountry, destCountry]
  );

  const stats = useMemo(
    () => (events.length > 0 ? computeStats(events) : null),
    [events]
  );

  // Available origin countries — derived from date-filtered data so options reflect current date range
  // When an origin is selected, dest options come from events filtered by that origin (and vice versa)
  const allOriginCountries = useMemo(() => {
    // Base pool: date-filtered, optionally narrowed by current destCountry selection
    const pool = destCountry
      ? filterEventsByCountry(dateFiltered, null, destCountry)
      : dateFiltered;
    const set = new Set<string>();
    pool.forEach(e => {
      const c = normalizeCountry(e.rfid_origin_country || e.predes_origin_country);
      if (c) set.add(c);
    });
    return Array.from(set).sort();
  }, [dateFiltered, destCountry]);

  // Available destination countries — derived from date-filtered data, optionally narrowed by originCountry
  const allDestCountries = useMemo(() => {
    const pool = originCountry
      ? filterEventsByCountry(dateFiltered, originCountry, null)
      : dateFiltered;
    const set = new Set<string>();
    pool.forEach(e => {
      const c = normalizeCountry(e.redes_dest_country || e.rfid_dest_country);
      if (c) set.add(c);
    });
    return Array.from(set).sort();
  }, [dateFiltered, originCountry]);

  // Overall date bounds from all data (for the date picker range)
  const allDataBounds = useMemo(() => {
    if (allEvents.length === 0) return { min: null, max: null };
    const dates = allEvents
      .map(e => getEventDate(e))
      .filter(Boolean) as Date[];
    if (dates.length === 0) return { min: null, max: null };
    return {
      min: dates.reduce((a, b) => (a < b ? a : b)).toISOString().slice(0, 10),
      max: dates.reduce((a, b) => (a > b ? a : b)).toISOString().slice(0, 10),
    };
  }, [allEvents]);

  return {
    events,
    allEvents,
    stats,
    loading,
    error,
    dateRange,
    setDateRange,
    allDataBounds,
    originCountry,
    setOriginCountry,
    destCountry,
    setDestCountry,
    allOriginCountries,
    allDestCountries,
  };
}
