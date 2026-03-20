/**
 * useBenchmarkData — RFID vs EDI Benchmark (rebuilt)
 *
 * Data pipeline:
 *   1. Load "ID Relation" table once (tagid ↔ s9id, 6 323 rows) — cached in module scope
 *   2. Receive RfidJourney[] already computed by useEpcisData (Regla de Selección)
 *   3. For each journey, look up s9id via ID Relation (tagid = journey.tag_id)
 *   4. Fetch EDI data from benchmark_rfid_edi WHERE s9id IN (matched s9ids)
 *   5. Join: one BenchmarkRow per journey that has a matched s9id
 *
 * RFID fields come from RfidJourney (Regla de Selección):
 *   - Origin:       origin_country / origin_centre / origin_impc / origin_time
 *   - AMU Outbound: departure_country / departure_centre / departure_impc / departure_time
 *   - AMU Inbound:  arrival_country  / arrival_centre  / arrival_impc  / arrival_time
 *   - OE Dest:      dest_country / dest_centre / dest_impc / dest_time
 *   - Transit:      international_transit_hours (AMU Out → AMU In)
 *
 * EDI fields come from benchmark_rfid_edi (only EDI columns, keyed by s9id):
 *   - edi_predes_time, edi_cardit_time, edi_resdit74_time, edi_resdit21_time, edi_resdes_time
 *   - edi_origin_impc, edi_dest_impc, edi_transit_hours
 *   - missing_cardit, missing_resdit74, missing_resdit21, missing_resdes
 */
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import type { RfidJourney } from '@/hooks/useEpcisData';

/* ── Filter params ──────────────────────────────────────────────────────────── */
export interface BenchmarkFilters {
  dateFrom?:      string;
  dateTo?:        string;
  originCountry?: string;
  destCountry?:   string;
}

/* ── ID Relation row ────────────────────────────────────────────────────────── */
interface IdRelationRow {
  tagid: string;
  s9id:  string;
}

/* ── EDI-only row from benchmark_rfid_edi ───────────────────────────────────── */
interface EdiRow {
  s9id:              string;
  edi_origin_impc:   string | null;
  edi_dest_impc:     string | null;
  edi_predes_time:   string | null;
  edi_cardit_time:   string | null;
  edi_resdit74_time: string | null;
  edi_resdit74_impc: string | null;
  edi_resdit21_time: string | null;
  edi_resdit21_impc: string | null;
  edi_resdes_time:   string | null;
  edi_transit_hours: number | null;
  missing_cardit:    boolean;
  missing_resdit74:  boolean;
  missing_resdit21:  boolean;
  missing_resdes:    boolean;
}

/* ── BenchmarkRow: RFID (Regla de Selección) + EDI ─────────────────────────── */
export interface BenchmarkRow {
  tag_id: string;
  s9id:   string;
  // RFID — from RfidJourney (Regla de Selección)
  rf_origin_country:    string | null;
  rf_origin_centre:     string | null;
  rf_origin_impc:       string | null;
  rf_origin_time:       string | null;
  rf_departure_country: string | null;
  rf_departure_centre:  string | null;
  rf_departure_impc:    string | null;
  rf_departure_time:    string | null;
  rf_arrival_country:   string | null;
  rf_arrival_centre:    string | null;
  rf_arrival_impc:      string | null;
  rf_arrival_time:      string | null;
  rf_dest_country:      string | null;
  rf_dest_centre:       string | null;
  rf_dest_impc:         string | null;
  rf_dest_time:         string | null;
  rf_transit_hours:     number | null;
  has_rf_departure:     boolean;
  has_rf_arrival:       boolean;
  has_rf_transit:       boolean;
  // EDI — from benchmark_rfid_edi
  edi_origin_impc:      string | null;
  edi_dest_impc:        string | null;
  edi_predes_time:      string | null;
  edi_cardit_time:      string | null;
  edi_resdit74_time:    string | null;
  edi_resdit74_impc:    string | null;
  edi_resdit21_time:    string | null;
  edi_resdit21_impc:    string | null;
  edi_resdes_time:      string | null;
  edi_transit_hours:    number | null;
  missing_cardit:       boolean;
  missing_resdit74:     boolean;
  missing_resdit21:     boolean;
  missing_resdes:       boolean;
  has_edi_transit:      boolean;
  // Computed deltas
  delta_predes_hours:   number | null;
  delta_resdes_hours:   number | null;
}

/* ── Stats types ────────────────────────────────────────────────────────────── */
export interface CentreStats {
  centre:  string;
  impc:    string;
  country: string;
  n:       number;
  mean:    number | null;
  median:  number | null;
}

export interface RouteStats {
  route:              string;
  origin:             string;
  dest:               string;
  count:              number;
  depCount:           number;
  arrCount:           number;
  transitCount:       number;
  avgRfH:             number | null;
  avgEdiH:            number | null;
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
  byOriginCentre:  CentreStats[];
  byDestCentre:    CentreStats[];
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
function diffHours(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
  return Math.round(d * 10) / 10;
}

/* ── Module-level cache for ID Relation ─────────────────────────────────────── */
let idRelationCache: Map<string, string> | null = null;
let idRelationLoading = false;
let idRelationCallbacks: Array<(m: Map<string, string>) => void> = [];

async function getIdRelationMap(): Promise<Map<string, string>> {
  if (idRelationCache) return idRelationCache;
  if (idRelationLoading) {
    return new Promise(resolve => { idRelationCallbacks.push(resolve); });
  }
  idRelationLoading = true;
  const PAGE = 1000;
  const all: IdRelationRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('ID Relation')
      .select('tagid,s9id')
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...(data as IdRelationRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  const map = new Map<string, string>();
  for (const row of all) {
    if (row.tagid && row.s9id) map.set(row.tagid, row.s9id);
  }
  idRelationCache = map;
  idRelationLoading = false;
  idRelationCallbacks.forEach(cb => cb(map));
  idRelationCallbacks = [];
  return map;
}

/* ── Fetch EDI rows for a set of s9ids ─────────────────────────────────────── */
async function fetchEdiRows(s9ids: string[]): Promise<Map<string, EdiRow>> {
  const map = new Map<string, EdiRow>();
  if (!s9ids.length) return map;
  const CHUNK = 500;
  const EDI_COLS = [
    's9id','edi_origin_impc','edi_dest_impc',
    'edi_predes_time','edi_cardit_time',
    'edi_resdit74_time','edi_resdit74_impc',
    'edi_resdit21_time','edi_resdit21_impc',
    'edi_resdes_time','edi_transit_hours',
    'missing_cardit','missing_resdit74','missing_resdit21','missing_resdes',
  ].join(',');
  for (let i = 0; i < s9ids.length; i += CHUNK) {
    const chunk = s9ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('benchmark_rfid_edi')
      .select(EDI_COLS)
      .in('s9id', chunk);
    if (error || !data) continue;
    for (const row of data as EdiRow[]) {
      if (row.s9id) map.set(row.s9id, row);
    }
  }
  return map;
}

/* ── Build BenchmarkRow[] from journeys + ID Relation + EDI ─────────────────── */
function buildBenchmarkRows(
  journeys: RfidJourney[],
  idMap: Map<string, string>,
  ediMap: Map<string, EdiRow>,
  filters: BenchmarkFilters,
): BenchmarkRow[] {
  const rows: BenchmarkRow[] = [];
  for (const j of journeys) {
    if (!j.tag_id) continue;
    const s9id = idMap.get(j.tag_id);
    if (!s9id) continue;

    const rfDep     = j.departure_time ?? null;
    const rfArr     = j.arrival_time   ?? null;
    const rfTransit = j.international_transit_hours ?? null;
    const edi       = ediMap.get(s9id) ?? null;

    const deltaPredes = diffHours(edi?.edi_predes_time ?? null, rfDep);
    const deltaResdes = diffHours(edi?.edi_resdes_time ?? null, rfArr);

    const originCountry = j.origin_country     ?? j.departure_country ?? null;
    const destCountry   = j.dest_country       ?? j.arrival_country   ?? null;

    if (filters.dateFrom && rfDep && rfDep < filters.dateFrom) continue;
    if (filters.dateTo   && rfDep && rfDep > filters.dateTo + 'T23:59:59Z') continue;
    if (filters.originCountry && originCountry !== filters.originCountry) continue;
    if (filters.destCountry   && destCountry   !== filters.destCountry)   continue;
    if (originCountry && destCountry && originCountry === destCountry) continue;

    rows.push({
      tag_id: j.tag_id,
      s9id,
      rf_origin_country:    j.origin_country    ?? null,
      rf_origin_centre:     j.origin_centre     ?? null,
      rf_origin_impc:       j.origin_impc       ?? null,
      rf_origin_time:       j.origin_time       ?? null,
      rf_departure_country: j.departure_country ?? null,
      rf_departure_centre:  j.departure_centre  ?? null,
      rf_departure_impc:    j.departure_impc    ?? null,
      rf_departure_time:    rfDep,
      rf_arrival_country:   j.arrival_country   ?? null,
      rf_arrival_centre:    j.arrival_centre    ?? null,
      rf_arrival_impc:      j.arrival_impc      ?? null,
      rf_arrival_time:      rfArr,
      rf_dest_country:      j.dest_country      ?? null,
      rf_dest_centre:       j.dest_centre       ?? null,
      rf_dest_impc:         j.dest_impc         ?? null,
      rf_dest_time:         j.dest_time         ?? null,
      rf_transit_hours:     rfTransit,
      has_rf_departure:     !!rfDep,
      has_rf_arrival:       !!rfArr,
      has_rf_transit:       rfTransit !== null,
      edi_origin_impc:      edi?.edi_origin_impc   ?? null,
      edi_dest_impc:        edi?.edi_dest_impc     ?? null,
      edi_predes_time:      edi?.edi_predes_time   ?? null,
      edi_cardit_time:      edi?.edi_cardit_time   ?? null,
      edi_resdit74_time:    edi?.edi_resdit74_time ?? null,
      edi_resdit74_impc:    edi?.edi_resdit74_impc ?? null,
      edi_resdit21_time:    edi?.edi_resdit21_time ?? null,
      edi_resdit21_impc:    edi?.edi_resdit21_impc ?? null,
      edi_resdes_time:      edi?.edi_resdes_time   ?? null,
      edi_transit_hours:    edi?.edi_transit_hours ?? null,
      missing_cardit:       edi?.missing_cardit    ?? true,
      missing_resdit74:     edi?.missing_resdit74  ?? true,
      missing_resdit21:     edi?.missing_resdit21  ?? true,
      missing_resdes:       edi?.missing_resdes    ?? true,
      has_edi_transit:      !!(edi?.edi_predes_time && edi?.edi_resdes_time),
      delta_predes_hours:   deltaPredes,
      delta_resdes_hours:   deltaResdes,
    });
  }
  return rows;
}

/* ── computeStats ───────────────────────────────────────────────────────────── */
function buildCentreStatsLocal(
  rows: BenchmarkRow[],
  centreKey: keyof BenchmarkRow,
  impcKey:   keyof BenchmarkRow,
  countryKey:keyof BenchmarkRow,
  deltaKey:  keyof BenchmarkRow,
): CentreStats[] {
  const map = new Map<string, { impc: string; country: string; vals: number[] }>();
  for (const r of rows) {
    const c = r[centreKey] as string | null;
    const d = r[deltaKey]  as number | null;
    if (!c || d === null) continue;
    if (!map.has(c)) map.set(c, { impc: (r[impcKey] as string) ?? '', country: (r[countryKey] as string) ?? '', vals: [] });
    map.get(c)!.vals.push(d);
  }
  return [...map.entries()]
    .map(([centre, v]) => ({ centre, impc: v.impc, country: v.country, n: v.vals.length, mean: mean(v.vals), median: median(v.vals) }))
    .sort((a, b) => b.n - a.n);
}

function computeStats(rows: BenchmarkRow[]): BenchmarkStats {
  const depRows     = rows.filter(r => r.has_rf_departure);
  const arrRows     = rows.filter(r => r.has_rf_arrival);
  const transitRows = rows.filter(r => r.has_rf_transit && r.has_edi_transit);

  const rfTransitVals   = rows.filter(r => r.rf_transit_hours  !== null).map(r => r.rf_transit_hours!);
  const ediTransitVals  = rows.filter(r => r.edi_transit_hours !== null).map(r => r.edi_transit_hours!);
  const deltaPredesVals = rows.filter(r => r.delta_predes_hours !== null).map(r => r.delta_predes_hours!);
  const deltaResdesVals = rows.filter(r => r.delta_resdes_hours !== null).map(r => r.delta_resdes_hours!);

  const routeMap = new Map<string, RouteStats & { rfH: number[]; ediH: number[] }>();
  for (const r of rows) {
    const origin = r.rf_origin_country ?? r.edi_origin_impc ?? '?';
    const dest   = r.rf_dest_country   ?? r.rf_arrival_country ?? r.edi_dest_impc ?? '?';
    const route  = `${origin} → ${dest}`;
    if (!routeMap.has(route)) {
      routeMap.set(route, { route, origin, dest, count: 0, depCount: 0, arrCount: 0, transitCount: 0,
        avgRfH: null, avgEdiH: null, missingCarditPct: 0, missingResdit74Pct: 0, missingResdit21Pct: 0, missingResdesPct: 0,
        rfH: [], ediH: [] });
    }
    const v = routeMap.get(route)!;
    v.count++;
    if (r.has_rf_departure) v.depCount++;
    if (r.has_rf_arrival)   v.arrCount++;
    if (r.has_rf_transit && r.has_edi_transit) {
      v.transitCount++;
      if (r.rf_transit_hours  !== null) v.rfH.push(r.rf_transit_hours);
      if (r.edi_transit_hours !== null) v.ediH.push(r.edi_transit_hours);
    }
  }
  const byRoute: RouteStats[] = [...routeMap.values()].map(v => {
    const rr = rows.filter(r => {
      const o = r.rf_origin_country ?? r.edi_origin_impc ?? '?';
      const d = r.rf_dest_country   ?? r.rf_arrival_country ?? r.edi_dest_impc ?? '?';
      return `${o} → ${d}` === v.route;
    });
    return {
      route: v.route, origin: v.origin, dest: v.dest,
      count: v.count, depCount: v.depCount, arrCount: v.arrCount, transitCount: v.transitCount,
      avgRfH: mean(v.rfH), avgEdiH: mean(v.ediH),
      missingCarditPct:   v.count ? Math.round(rr.filter(r => r.missing_cardit).length   / v.count * 100) : 0,
      missingResdit74Pct: v.count ? Math.round(rr.filter(r => r.missing_resdit74).length / v.count * 100) : 0,
      missingResdit21Pct: v.count ? Math.round(rr.filter(r => r.missing_resdit21).length / v.count * 100) : 0,
      missingResdesPct:   v.count ? Math.round(rr.filter(r => r.missing_resdes).length   / v.count * 100) : 0,
    };
  }).sort((a, b) => b.count - a.count);

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
    hasRfPredes:     rows.filter(r => r.has_rf_departure).length,
    hasRfResdes:     rows.filter(r => r.has_rf_arrival).length,
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
    byOriginCentre:  buildCentreStatsLocal(rows, 'rf_origin_centre',  'rf_origin_impc',  'rf_origin_country',  'delta_predes_hours'),
    byDestCentre:    buildCentreStatsLocal(rows, 'rf_arrival_centre', 'rf_arrival_impc', 'rf_arrival_country', 'delta_resdes_hours'),
    rfTransitCdf:    buildCDF(rfTransitVals),
    ediTransitCdf:   buildCDF(ediTransitVals),
  };
}

/* ── Hook ───────────────────────────────────────────────────────────────────── */
export function useBenchmarkData(
  journeys: RfidJourney[],
  filters: BenchmarkFilters = {},
) {
  const [idMap,   setIdMap]   = useState<Map<string, string> | null>(null);
  const [ediMap,  setEdiMap]  = useState<Map<string, EdiRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    getIdRelationMap()
      .then(m => setIdMap(m))
      .catch(e => setError(e.message ?? 'Error loading ID Relation'));
  }, []);

  useEffect(() => {
    if (!idMap || !journeys.length) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const s9ids = [...new Set(
      journeys.map(j => j.tag_id ? idMap.get(j.tag_id) : undefined).filter((s): s is string => !!s)
    )];
    fetchEdiRows(s9ids)
      .then(m => { if (!cancelled) { setEdiMap(m); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e.message ?? 'Error loading EDI data'); setLoading(false); } });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idMap, journeys.length]);

  const rows = useMemo<BenchmarkRow[]>(() => {
    if (!idMap || !ediMap || !journeys.length) return [];
    return buildBenchmarkRows(journeys, idMap, ediMap, filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idMap, ediMap, journeys, JSON.stringify(filters)]);

  const stats = useMemo(() => rows.length ? computeStats(rows) : null, [rows]);

  const allOriginCountries = useMemo(() => {
    if (!idMap || !ediMap) return [];
    const base = buildBenchmarkRows(journeys, idMap, ediMap, {});
    return [...new Set(base.map(r => r.rf_origin_country).filter((c): c is string => !!c))].sort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idMap, ediMap, journeys.length]);

  const allDestCountries = useMemo(() => {
    if (!idMap || !ediMap) return [];
    const base = filters.originCountry
      ? buildBenchmarkRows(journeys, idMap, ediMap, { originCountry: filters.originCountry })
      : buildBenchmarkRows(journeys, idMap, ediMap, {});
    return [...new Set(
      base.map(r => r.rf_dest_country ?? r.rf_arrival_country).filter((c): c is string => !!c)
    )].sort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idMap, ediMap, journeys.length, filters.originCountry]);

  return { rows, stats, loading, error, idRelationSize: idMap?.size ?? 0, allOriginCountries, allDestCountries };
}
