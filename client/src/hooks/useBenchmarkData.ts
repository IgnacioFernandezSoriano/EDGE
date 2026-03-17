/**
 * useBenchmarkData — Benchmark RFID vs EDI
 *
 * Reads from the materialized view `benchmark_rfid_edi`.
 * Supports global filters: dateFrom, dateTo, originCountry, destCountry.
 *
 * EDI event chain (logical order):
 *   PREDES → CARDIT → RESDIT74 → RESDIT21 → RESDES
 *
 * RFID equivalences:
 *   RFID Outbound = RFID DEPARTURE event (last reading before international border ≈ PREDES)
 *   RFID Inbound  = RFID ARRIVAL event   (first reading after international border ≈ RESDES)
 *   RFID transit = DEPARTURE → ARRIVAL
 *   EDI  transit = PREDES    → RESDES
 */
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';

/* ── Filter params ──────────────────────────────────────────────────────────── */
export interface BenchmarkFilters {
  dateFrom?:      string;
  dateTo?:        string;
  originCountry?: string;
  destCountry?:   string;
}

/* ── Types ─────────────────────────────────────────────────────────────────── */
export interface BenchmarkRow {
  s9id: string;
  tag_id: string;
  // EDI
  edi_origin_impc:   string | null;
  edi_dest_impc:     string | null;
  edi_predes_time:   string | null;
  edi_cardit_time:   string | null;
  edi_resdit74_time: string | null;
  edi_resdit74_impc: string | null;
  edi_resdit21_time: string | null;
  edi_resdit21_impc: string | null;
  edi_resdes_time:   string | null;
  // RFID
  rf_origin_country:  string | null;
  rf_origin_centre:   string | null;
  rf_origin_impc:     string | null;
  rf_predes_time:     string | null;
  rf_departure_time:  string | null;
  rf_arrival_time:    string | null;
  rf_dest_country:    string | null;
  rf_dest_centre:     string | null;
  rf_dest_impc:       string | null;
  rf_resdes_time:     string | null;
  // Computed (pre-calculated in view)
  rf_transit_hours:   number | null;
  edi_transit_hours:  number | null;
  delta_predes_hours: number | null;
  delta_resdes_hours: number | null;
  // Gap flags
  missing_cardit:    boolean;
  missing_resdit74:  boolean;
  missing_resdit21:  boolean;
  missing_resdes:    boolean;
  // Scope flags
  has_rf_departure:  boolean;
  has_rf_arrival:    boolean;
  has_rf_transit:    boolean;
  has_edi_transit:   boolean;
}

export interface CentreStats {
  centre:     string;
  impc:       string;
  country:    string;
  n:          number;
  mean:       number | null;
  median:     number | null;
}

export interface RouteStats {
  route:   string;
  origin:  string;
  dest:    string;
  count:   number;
  depCount: number;
  arrCount: number;
  transitCount: number;
  avgRfH:  number | null;
  avgEdiH: number | null;
  missingCarditPct:   number;
  missingResdit74Pct: number;
  missingResdit21Pct: number;
  missingResdesPct:   number;
}

export interface BenchmarkStats {
  totalPairs:      number;
  departurePairs:  number;
  arrivalPairs:    number;
  transitPairs:    number;
  hasEdiPredes:    number;
  hasEdiCardit:    number;
  hasEdiResdit74:  number;
  hasEdiResdit21:  number;
  hasEdiResdes:    number;
  hasRfPredes:     number;
  hasRfResdes:     number;
  avgRfTransitH:   number | null;
  avgEdiTransitH:  number | null;
  medRfTransitH:   number | null;
  medEdiTransitH:  number | null;
  missingCardit:   number;
  missingResdit74: number;
  missingResdit21: number;
  missingResdes:   number;
  avgDeltaPredesH: number | null;
  avgDeltaResdesH: number | null;
  byRoute:         RouteStats[];
  byOriginCentre:  CentreStats[];   // Δ PREDES by origin centre
  byDestCentre:    CentreStats[];   // Δ RESDES by destination centre
  rfTransitCdf:    { x: number; pct: number }[];
  ediTransitCdf:   { x: number; pct: number }[];
}

/* ── Math helpers ───────────────────────────────────────────────────────────── */
function mean(arr: number[]): number | null {
  if (!arr.length) return null;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
}
function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}
function mode(arr: number[]): number | null {
  if (!arr.length) return null;
  // Round to nearest hour for grouping
  const rounded = arr.map(v => Math.round(v));
  const freq: Record<number, number> = {};
  for (const v of rounded) freq[v] = (freq[v] ?? 0) + 1;
  let maxCount = 0, modeVal = rounded[0];
  for (const [k, c] of Object.entries(freq)) {
    if (c > maxCount) { maxCount = c; modeVal = Number(k); }
  }
  return modeVal;
}
function buildCDF(values: number[], steps = 50): { x: number; pct: number }[] {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0], max = sorted[sorted.length - 1];
  if (min === max) return [{ x: min, pct: 100 }];
  const step = (max - min) / steps;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const x = Math.round((min + i * step) * 10) / 10;
    const pct = Math.round((sorted.filter(v => v <= x).length / sorted.length) * 1000) / 10;
    return { x, pct };
  });
}

/* ── Fetch from materialized view with filters ──────────────────────────────── */
async function fetchBenchmarkRows(filters: BenchmarkFilters): Promise<BenchmarkRow[]> {
  const PAGE = 1000;
  const allRows: BenchmarkRow[] = [];
  let from = 0;

  while (true) {
    let q = supabase
      .from('benchmark_rfid_edi')
      .select('*')
      .range(from, from + PAGE - 1);

    // Date filter: apply on edi_predes_time (departure side)
    if (filters.dateFrom) q = q.gte('edi_predes_time', filters.dateFrom);
    if (filters.dateTo)   q = q.lte('edi_predes_time', filters.dateTo + 'T23:59:59Z');

    // Country filter: match against rf_origin_country / rf_dest_country
    // Fall back to edi_origin_impc prefix match when rf country is null
    if (filters.originCountry) q = q.eq('rf_origin_country', filters.originCountry);
    if (filters.destCountry)   q = q.eq('rf_dest_country',   filters.destCountry);

    const { data, error } = await q;
    if (error) throw new Error(`benchmark_rfid_edi: ${error.message}`);
    if (!data || data.length === 0) break;

    allRows.push(...(data as BenchmarkRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // Keep only international movements (origin country ≠ destination country)
  const international = allRows.filter(r =>
    r.rf_origin_country && r.rf_dest_country &&
    r.rf_origin_country !== r.rf_dest_country
  );

  // Recalculate rf_transit_hours as RFID Outbound → RFID Inbound
  // (rf_predes_time → rf_resdes_time) for each row, overriding the
  // pre-computed value from the view which uses DEPARTURE→ARRIVAL events
  // and can include cross-journey readings producing inflated values.
  for (const r of international) {
    if (r.rf_predes_time && r.rf_resdes_time) {
      const dep = new Date(r.rf_predes_time).getTime();
      const arr = new Date(r.rf_resdes_time).getTime();
      const diffH = (arr - dep) / 3_600_000;
      // Only accept positive, plausible transit times (0–720h = 30 days)
      r.rf_transit_hours = diffH > 0 && diffH <= 720 ? Math.round(diffH * 10) / 10 : null;
    } else {
      r.rf_transit_hours = null;
    }
    // Recalculate has_rf_transit: need both RFID Outbound and Inbound
    r.has_rf_transit = r.rf_transit_hours !== null;
  }

  return international;
}

/* ── Centre-level delta stats ───────────────────────────────────────────────── */
function buildCentreStats(
  rows: BenchmarkRow[],
  getCentre: (r: BenchmarkRow) => string | null,
  getImpc:   (r: BenchmarkRow) => string | null,
  getCountry:(r: BenchmarkRow) => string | null,
  getDelta:  (r: BenchmarkRow) => number | null,
  hasData:   (r: BenchmarkRow) => boolean,
): CentreStats[] {
  const map = new Map<string, { impc: string; country: string; deltas: number[] }>();

  for (const r of rows) {
    if (!hasData(r)) continue;
    const delta = getDelta(r);
    if (delta === null) continue;
    const centre  = getCentre(r)  || getImpc(r) || '?';
    const impc    = getImpc(r)    || '?';
    const country = getCountry(r) || '?';
    if (!map.has(centre)) map.set(centre, { impc, country, deltas: [] });
    map.get(centre)!.deltas.push(Number(delta));
  }

  return Array.from(map.entries())
    .map(([centre, v]) => ({
      centre,
      impc:    v.impc,
      country: v.country,
      n:       v.deltas.length,
      mean:    mean(v.deltas),
      median:  median(v.deltas),
    }))
    .sort((a, b) => {
      const cmp = a.country.localeCompare(b.country);
      return cmp !== 0 ? cmp : a.centre.localeCompare(b.centre);
    });
}

/* ── Stats ──────────────────────────────────────────────────────────────────── */
function computeStats(rows: BenchmarkRow[]): BenchmarkStats {
  const depRows     = rows.filter(r => r.has_rf_departure);
  const arrRows     = rows.filter(r => r.has_rf_arrival);
  const transitRows = rows.filter(r => r.has_rf_transit && r.has_edi_transit);

  const rfTransitVals   = transitRows.map(r => Number(r.rf_transit_hours)).filter(v => v > 0);
  const ediTransitVals  = transitRows.map(r => Number(r.edi_transit_hours)).filter(v => v > 0);
  const deltaPredesVals = rows.filter(r => r.delta_predes_hours !== null).map(r => Number(r.delta_predes_hours));
  const deltaResdesVals = rows.filter(r => r.delta_resdes_hours !== null).map(r => Number(r.delta_resdes_hours));

  // By route
  const routeMap = new Map<string, {
    origin: string; dest: string; count: number;
    depCount: number; arrCount: number; transitCount: number;
    rfH: number[]; ediH: number[];
    mc: number; mr74: number; mr21: number; mrd: number;
  }>();

  for (const r of rows) {
    const origin = r.edi_origin_impc || r.rf_origin_impc || '?';
    const dest   = r.edi_dest_impc   || r.rf_dest_impc   || '?';
    const key    = `${origin}→${dest}`;
    if (!routeMap.has(key)) {
      routeMap.set(key, { origin, dest, count: 0, depCount: 0, arrCount: 0, transitCount: 0, rfH: [], ediH: [], mc: 0, mr74: 0, mr21: 0, mrd: 0 });
    }
    const v = routeMap.get(key)!;
    v.count++;
    if (r.has_rf_departure) v.depCount++;
    if (r.has_rf_arrival)   v.arrCount++;
    if (r.has_rf_transit && r.has_edi_transit) {
      v.transitCount++;
      const rfH  = Number(r.rf_transit_hours);
      const ediH = Number(r.edi_transit_hours);
      if (!isNaN(rfH)  && rfH  > 0) v.rfH.push(rfH);
      if (!isNaN(ediH) && ediH > 0) v.ediH.push(ediH);
    }
    if (r.missing_cardit)   v.mc++;
    if (r.missing_resdit74) v.mr74++;
    if (r.missing_resdit21) v.mr21++;
    if (r.missing_resdes)   v.mrd++;
  }

  const byRoute: RouteStats[] = Array.from(routeMap.entries())
    .map(([route, v]) => ({
      route,
      origin: v.origin,
      dest:   v.dest,
      count:  v.count,
      depCount: v.depCount,
      arrCount: v.arrCount,
      transitCount: v.transitCount,
      avgRfH:  mean(v.rfH),
      avgEdiH: mean(v.ediH),
      missingCarditPct:   Math.round((v.mc   / v.count) * 100),
      missingResdit74Pct: Math.round((v.mr74 / v.count) * 100),
      missingResdit21Pct: Math.round((v.mr21 / v.count) * 100),
      missingResdesPct:   Math.round((v.mrd  / v.count) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  // By origin centre — Δ PREDES (RFID Outbound minus EDI PREDES)
  const byOriginCentre = buildCentreStats(
    rows,
    r => r.rf_origin_centre,
    r => r.rf_origin_impc || r.edi_origin_impc,
    r => r.rf_origin_country,
    r => r.delta_predes_hours,
    r => r.delta_predes_hours !== null,
  );

  // By destination centre — Δ RESDES (RFID Inbound minus EDI RESDES)
  const byDestCentre = buildCentreStats(
    rows,
    r => r.rf_dest_centre,
    r => r.rf_dest_impc || r.edi_dest_impc,
    r => r.rf_dest_country,
    r => r.delta_resdes_hours,
    r => r.delta_resdes_hours !== null,
  );

  return {
    totalPairs:      rows.length,
    departurePairs:  depRows.length,
    arrivalPairs:    arrRows.length,
    transitPairs:    transitRows.length,
    hasEdiPredes:    rows.filter(r => r.edi_predes_time).length,
    hasEdiCardit:    rows.filter(r => r.edi_cardit_time).length,
    hasEdiResdit74:  rows.filter(r => r.edi_resdit74_time).length,
    hasEdiResdit21:  rows.filter(r => r.edi_resdit21_time).length,
    hasEdiResdes:    rows.filter(r => r.edi_resdes_time).length,
    hasRfPredes:     rows.filter(r => r.rf_predes_time).length,
    hasRfResdes:     rows.filter(r => r.rf_resdes_time).length,
    avgRfTransitH:   mean(rfTransitVals),
    avgEdiTransitH:  mean(ediTransitVals),
    medRfTransitH:   median(rfTransitVals),
    medEdiTransitH:  median(ediTransitVals),
    missingCardit:   rows.filter(r => r.missing_cardit).length,
    missingResdit74: rows.filter(r => r.missing_resdit74).length,
    missingResdit21: rows.filter(r => r.missing_resdit21).length,
    missingResdes:   rows.filter(r => r.missing_resdes).length,
    avgDeltaPredesH: mean(deltaPredesVals),
    avgDeltaResdesH: mean(deltaResdesVals),
    byRoute,
    byOriginCentre,
    byDestCentre,
    rfTransitCdf:    buildCDF(rfTransitVals),
    ediTransitCdf:   buildCDF(ediTransitVals),
  };
}

/* ── Fetch all unique countries from benchmark_rfid_edi (no filters) ────────── */
async function fetchBenchmarkCountries(): Promise<{ origins: string[]; dests: string[] }> {
  const { data, error } = await supabase
    .from('benchmark_rfid_edi')
    .select('rf_origin_country,rf_dest_country');
  if (error || !data) return { origins: [], dests: [] };
  // Only international rows
  const intl = data.filter((r: BenchmarkRow) =>
    r.rf_origin_country && r.rf_dest_country && r.rf_origin_country !== r.rf_dest_country
  );
  const origins = [...new Set(intl.map((r: BenchmarkRow) => r.rf_origin_country as string))].sort();
  const dests   = [...new Set(intl.map((r: BenchmarkRow) => r.rf_dest_country   as string))].sort();
  return { origins, dests };
}

/* ── Hook ───────────────────────────────────────────────────────────────────── */
export function useBenchmarkData(filters: BenchmarkFilters = {}) {
  const [rows, setRows]       = useState<BenchmarkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [allOrigins, setAllOrigins] = useState<string[]>([]);
  const [allDests,   setAllDests]   = useState<string[]>([]);

  // Load all available countries once on mount
  useEffect(() => {
    fetchBenchmarkCountries().then(({ origins, dests }) => {
      setAllOrigins(origins);
      setAllDests(dests);
    });
  }, []);

  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBenchmarkRows(filters)
      .then(data => { if (!cancelled) { setRows(data); setLoading(false); } })
      .catch(err  => { if (!cancelled) { setError(err.message ?? 'Error loading benchmark data'); setLoading(false); } });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // Dynamic dest list: when origin is selected, show only dests reachable from that origin
  const availableOrigins = useMemo(() => {
    if (!filters.destCountry) return allOrigins;
    return allOrigins.filter(o =>
      rows.some(r => r.rf_origin_country === o) ||
      allOrigins.includes(o) // always show all origins; dest restricts origins via rows
    );
  }, [allOrigins, filters.destCountry, rows]);

  const availableDests = useMemo(() => {
    if (!filters.originCountry) return allDests;
    // When origin is selected, only show dests that have rows for that origin
    // We need to fetch without dest filter — use allDests filtered by current rows
    // Since rows are already filtered by origin, collect unique dests from them
    const destsFromRows = [...new Set(rows
      .filter(r => r.rf_dest_country && r.rf_origin_country !== r.rf_dest_country)
      .map(r => r.rf_dest_country as string)
    )].sort();
    return destsFromRows.length > 0 ? destsFromRows : allDests;
  }, [allDests, filters.originCountry, rows]);

  const stats = useMemo(() => rows.length ? computeStats(rows) : null, [rows]);
  return { rows, stats, loading, error, allOriginCountries: availableOrigins, allDestCountries: availableDests };
}
