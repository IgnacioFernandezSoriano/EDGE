/**
 * useBenchmarkData — RFID vs EDI Benchmark
 *
 * Data pipeline:
 *   1. Load "ID Relation" table once in full (6 323 rows, tagid ↔ s9id) — module-level cache
 *   2. Load "benchmark_rfid_edi" table once in full by pagination (no .in() → no timeout) — module-level cache
 *   3. Receive RfidJourney[] already computed by useEpcisData (Regla de Selección)
 *      - journeys start with last-30-days, then grow as background loading completes
 *   4. For each journey, look up s9id via ID Relation (tagid = journey.tag_id)
 *   5. Join with EDI map by s9id → one BenchmarkRow per matched journey
 */
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import type { RfidJourney } from '@/hooks/useEpcisData';

export interface BenchmarkFilters {
  dateFrom?:      string;
  dateTo?:        string;
  originCountry?: string;
  destCountry?:   string;
}

interface IdRelationRow { tagid: string; s9id: string; }

/* Raw row from 'datos EDI' table */
interface DatosEdiRow {
  ean:            string;        // = s9id in ID Relation
  origin:         string | null; // 6-char IMPC e.g. "INBOMB"
  destination:    string | null; // 6-char IMPC e.g. "JPTYOA"
  predes_time:    string | null;
  cardit_time:    string | null;
  resdit74_time:  string | null;
  resdit74_impc:  string | null;
  resdit21_time:  string | null;
  resdit21_impc:  string | null;
  redes_time:     string | null; // RESDES time (note: column is 'redes_time')
}

/* Normalised EDI row keyed by s9id (= ean) */
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

export interface BenchmarkRow {
  tag_id: string; s9id: string;
  rf_origin_country: string | null; rf_origin_centre: string | null; rf_origin_impc: string | null; rf_origin_time: string | null;
  rf_departure_country: string | null; rf_departure_centre: string | null; rf_departure_impc: string | null; rf_departure_time: string | null;
  rf_arrival_country: string | null; rf_arrival_centre: string | null; rf_arrival_impc: string | null; rf_arrival_time: string | null;
  rf_dest_country: string | null; rf_dest_centre: string | null; rf_dest_impc: string | null; rf_dest_time: string | null;
  rf_transit_hours: number | null; has_rf_departure: boolean; has_rf_arrival: boolean; has_rf_transit: boolean;
  edi_origin_impc: string | null; edi_dest_impc: string | null;
  edi_predes_time: string | null; edi_cardit_time: string | null;
  edi_resdit74_time: string | null; edi_resdit74_impc: string | null;
  edi_resdit21_time: string | null; edi_resdit21_impc: string | null;
  edi_resdes_time: string | null; edi_transit_hours: number | null;
  missing_cardit: boolean; missing_resdit74: boolean; missing_resdit21: boolean; missing_resdes: boolean;
  has_edi_transit: boolean;
  delta_predes_hours: number | null; delta_resdes_hours: number | null;
}

export interface CentreStats { centre: string; impc: string; country: string; n: number; mean: number | null; median: number | null; }
export interface RouteStats {
  route: string; origin: string; dest: string;
  count: number; depCount: number; arrCount: number; transitCount: number;
  avgRfH: number | null; avgEdiH: number | null;
  missingCarditPct: number; missingResdit74Pct: number; missingResdit21Pct: number; missingResdesPct: number;
  avgDeltaPredesH: number | null; avgDeltaResdesH: number | null; avgDeltaTransitH: number | null;
}
export interface BenchmarkStats {
  totalPairs: number; departurePairs: number; arrivalPairs: number; transitPairs: number;
  hasEdiPredes: number; hasEdiCardit: number; hasEdiResdit74: number; hasEdiResdit21: number; hasEdiResdes: number;
  hasRfPredes: number; hasRfResdes: number;
  avgRfTransitH: number | null; avgEdiTransitH: number | null; medRfTransitH: number | null; medEdiTransitH: number | null;
  missingCardit: number; missingResdit74: number; missingResdit21: number; missingResdes: number;
  avgDeltaPredesH: number | null; avgDeltaResdesH: number | null;
  byRoute: RouteStats[]; byOriginCentre: CentreStats[]; byDestCentre: CentreStats[];
  rfTransitCdf: { x: number; pct: number }[]; ediTransitCdf: { x: number; pct: number }[];
}

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
  return Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 3_600_000) * 10) / 10;
}

/* ── Module-level cache: ID Relation ────────────────────────────────────────── */
let idRelationCache: Map<string, string> | null = null;
let idRelationLoading = false;
let idRelationCallbacks: Array<(m: Map<string, string>) => void> = [];

async function getIdRelationMap(): Promise<Map<string, string>> {
  if (idRelationCache) return idRelationCache;
  if (idRelationLoading) return new Promise(resolve => { idRelationCallbacks.push(resolve); });
  idRelationLoading = true;
  const all: IdRelationRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('ID Relation').select('tagid,s9id').range(from, from + 999);
    if (error || !data || !data.length) break;
    all.push(...(data as IdRelationRow[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  const map = new Map<string, string>();
  for (const row of all) { if (row.tagid && row.s9id) map.set(row.tagid, row.s9id); }
  idRelationCache = map;
  idRelationLoading = false;
  idRelationCallbacks.forEach(cb => cb(map));
  idRelationCallbacks = [];
  return map;
}

/* ── Module-level cache: full EDI table from 'datos EDI' (pagination) ──────── */
let ediCache: Map<string, EdiRow> | null = null;
let ediCacheLoading = false;
let ediCacheCallbacks: Array<(m: Map<string, EdiRow>) => void> = [];

const DATOS_EDI_COLS = 'ean,origin,destination,predes_time,cardit_time,resdit74_time,resdit74_impc,resdit21_time,resdit21_impc,redes_time';

function normaliseDatosEdiRow(raw: DatosEdiRow): EdiRow {
  const predes  = raw.predes_time  ?? null;
  const cardit  = raw.cardit_time  ?? null;
  const res74   = raw.resdit74_time ?? null;
  const res21   = raw.resdit21_time ?? null;
  const resdes  = raw.redes_time   ?? null;
  // transit = RESDES time minus PREDES time in hours
  const transit = diffHours(predes, resdes);
  return {
    s9id:              raw.ean,
    edi_origin_impc:   raw.origin   ? raw.origin.slice(0, 6)      : null,
    edi_dest_impc:     raw.destination ? raw.destination.slice(0, 6) : null,
    edi_predes_time:   predes,
    edi_cardit_time:   cardit,
    edi_resdit74_time: res74,
    edi_resdit74_impc: raw.resdit74_impc ?? null,
    edi_resdit21_time: res21,
    edi_resdit21_impc: raw.resdit21_impc ?? null,
    edi_resdes_time:   resdes,
    edi_transit_hours: transit,
    missing_cardit:    !cardit,
    missing_resdit74:  !res74,
    missing_resdit21:  !res21,
    missing_resdes:    !resdes,
  };
}

async function getEdiMap(onProgress?: (loaded: number, total: number) => void): Promise<Map<string, EdiRow>> {
  if (ediCache) return ediCache;
  if (ediCacheLoading) return new Promise(resolve => { ediCacheCallbacks.push(resolve); });
  ediCacheLoading = true;
  let total = 0;
  try {
    const { count } = await supabase.from('datos EDI').select('ean', { count: 'exact', head: true });
    total = count ?? 0;
  } catch { /* ignore */ }
  const all: DatosEdiRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('datos EDI').select(DATOS_EDI_COLS).range(from, from + 499);
    if (error || !data || !data.length) break;
    all.push(...(data as DatosEdiRow[]));
    if (onProgress) onProgress(all.length, total || all.length);
    if (data.length < 500) break;
    from += 500;
  }
  const map = new Map<string, EdiRow>();
  for (const raw of all) { if (raw.ean) map.set(raw.ean, normaliseDatosEdiRow(raw)); }
  ediCache = map;
  ediCacheLoading = false;
  ediCacheCallbacks.forEach(cb => cb(map));
  ediCacheCallbacks = [];
  return map;
}

/* ── Build rows ─────────────────────────────────────────────────────────────── */
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
    const rfDep = j.departure_time ?? null;
    const rfArr = j.arrival_time   ?? null;
    const rfTransit = j.international_transit_hours ?? null;
    const edi = ediMap.get(s9id) ?? null;
    const originCountry = j.origin_country ?? j.departure_country ?? null;
    const destCountry   = j.dest_country   ?? j.arrival_country   ?? null;
    if (originCountry && destCountry && originCountry === destCountry) continue;
    const refTime = rfDep ?? j.origin_time ?? null;
    if (filters.dateFrom && refTime && refTime < filters.dateFrom) continue;
    if (filters.dateTo   && refTime && refTime > filters.dateTo + 'T23:59:59Z') continue;
    if (filters.originCountry && originCountry !== filters.originCountry) continue;
    if (filters.destCountry   && destCountry   !== filters.destCountry)   continue;
    rows.push({
      tag_id: j.tag_id, s9id,
      rf_origin_country: j.origin_country ?? null, rf_origin_centre: j.origin_centre ?? null, rf_origin_impc: j.origin_impc ?? null, rf_origin_time: j.origin_time ?? null,
      rf_departure_country: j.departure_country ?? null, rf_departure_centre: j.departure_centre ?? null, rf_departure_impc: j.departure_impc ?? null, rf_departure_time: rfDep,
      rf_arrival_country: j.arrival_country ?? null, rf_arrival_centre: j.arrival_centre ?? null, rf_arrival_impc: j.arrival_impc ?? null, rf_arrival_time: rfArr,
      rf_dest_country: j.dest_country ?? null, rf_dest_centre: j.dest_centre ?? null, rf_dest_impc: j.dest_impc ?? null, rf_dest_time: j.dest_time ?? null,
      rf_transit_hours: rfTransit, has_rf_departure: !!rfDep, has_rf_arrival: !!rfArr, has_rf_transit: rfTransit !== null,
      edi_origin_impc: edi?.edi_origin_impc ?? null, edi_dest_impc: edi?.edi_dest_impc ?? null,
      edi_predes_time: edi?.edi_predes_time ?? null, edi_cardit_time: edi?.edi_cardit_time ?? null,
      edi_resdit74_time: edi?.edi_resdit74_time ?? null, edi_resdit74_impc: edi?.edi_resdit74_impc ?? null,
      edi_resdit21_time: edi?.edi_resdit21_time ?? null, edi_resdit21_impc: edi?.edi_resdit21_impc ?? null,
      edi_resdes_time: edi?.edi_resdes_time ?? null, edi_transit_hours: edi?.edi_transit_hours ?? null,
      missing_cardit: edi?.missing_cardit ?? true, missing_resdit74: edi?.missing_resdit74 ?? true,
      missing_resdit21: edi?.missing_resdit21 ?? true, missing_resdes: edi?.missing_resdes ?? true,
      has_edi_transit: !!(edi?.edi_predes_time && edi?.edi_resdes_time),
      delta_predes_hours: diffHours(edi?.edi_predes_time ?? null, rfDep),
      delta_resdes_hours: diffHours(edi?.edi_resdes_time ?? null, rfArr),
    });
  }
  return rows;
}

function buildCentreStats(rows: BenchmarkRow[], centreKey: keyof BenchmarkRow, impcKey: keyof BenchmarkRow, countryKey: keyof BenchmarkRow, deltaKey: keyof BenchmarkRow): CentreStats[] {
  const map = new Map<string, { impc: string; country: string; vals: number[] }>();
  for (const r of rows) {
    const c = r[centreKey] as string | null;
    const d = r[deltaKey]  as number | null;
    if (!c || d === null) continue;
    if (!map.has(c)) map.set(c, { impc: (r[impcKey] as string) ?? '', country: (r[countryKey] as string) ?? '', vals: [] });
    map.get(c)!.vals.push(d);
  }
  return [...map.entries()].map(([centre, v]) => ({ centre, impc: v.impc, country: v.country, n: v.vals.length, mean: mean(v.vals), median: median(v.vals) })).sort((a, b) => b.n - a.n);
}

function computeStats(rows: BenchmarkRow[]): BenchmarkStats {
  const rfTransitVals   = rows.filter(r => r.rf_transit_hours  !== null).map(r => r.rf_transit_hours!);
  const ediTransitVals  = rows.filter(r => r.edi_transit_hours !== null).map(r => r.edi_transit_hours!);
  const deltaPredesVals = rows.filter(r => r.delta_predes_hours !== null).map(r => r.delta_predes_hours!);
  const deltaResdesVals = rows.filter(r => r.delta_resdes_hours !== null).map(r => r.delta_resdes_hours!);
  const routeMap = new Map<string, { origin: string; dest: string; count: number; depCount: number; arrCount: number; transitCount: number; rfH: number[]; ediH: number[]; rows: BenchmarkRow[] }>();
  for (const r of rows) {
    const origin = r.rf_origin_country ?? r.rf_departure_country ?? r.edi_origin_impc ?? '?';
    const dest   = r.rf_dest_country   ?? r.rf_arrival_country   ?? r.edi_dest_impc   ?? '?';
    const route  = `${origin} → ${dest}`;
    if (!routeMap.has(route)) routeMap.set(route, { origin, dest, count: 0, depCount: 0, arrCount: 0, transitCount: 0, rfH: [], ediH: [], rows: [] });
    const v = routeMap.get(route)!;
    v.count++; v.rows.push(r);
    if (r.has_rf_departure) v.depCount++;
    if (r.has_rf_arrival)   v.arrCount++;
    if (r.has_rf_transit && r.has_edi_transit) {
      v.transitCount++;
      if (r.rf_transit_hours  !== null) v.rfH.push(r.rf_transit_hours);
      if (r.edi_transit_hours !== null) v.ediH.push(r.edi_transit_hours);
    }
  }
  const byRoute: RouteStats[] = [...routeMap.entries()].map(([route, v]) => ({
    route, origin: v.origin, dest: v.dest,
    count: v.count, depCount: v.depCount, arrCount: v.arrCount, transitCount: v.transitCount,
    avgRfH: mean(v.rfH), avgEdiH: mean(v.ediH),
    missingCarditPct:   v.count ? Math.round(v.rows.filter(r => r.missing_cardit).length   / v.count * 100) : 0,
    missingResdit74Pct: v.count ? Math.round(v.rows.filter(r => r.missing_resdit74).length / v.count * 100) : 0,
    missingResdit21Pct: v.count ? Math.round(v.rows.filter(r => r.missing_resdit21).length / v.count * 100) : 0,
    missingResdesPct:   v.count ? Math.round(v.rows.filter(r => r.missing_resdes).length   / v.count * 100) : 0,
    avgDeltaPredesH:  mean(v.rows.filter(r => r.delta_predes_hours !== null).map(r => r.delta_predes_hours!)),
    avgDeltaResdesH:  mean(v.rows.filter(r => r.delta_resdes_hours !== null).map(r => r.delta_resdes_hours!)),
    avgDeltaTransitH: mean(v.rows.filter(r => r.rf_transit_hours !== null && r.edi_transit_hours !== null).map(r => r.rf_transit_hours! - r.edi_transit_hours!)),
  })).sort((a, b) => b.count - a.count);
  return {
    totalPairs: rows.length, departurePairs: rows.filter(r => r.has_rf_departure).length,
    arrivalPairs: rows.filter(r => r.has_rf_arrival).length, transitPairs: rows.filter(r => r.has_rf_transit && r.has_edi_transit).length,
    hasEdiPredes: rows.filter(r => r.edi_predes_time).length, hasEdiCardit: rows.filter(r => r.edi_cardit_time).length,
    hasEdiResdit74: rows.filter(r => r.edi_resdit74_time).length, hasEdiResdit21: rows.filter(r => r.edi_resdit21_time).length,
    hasEdiResdes: rows.filter(r => r.edi_resdes_time).length,
    hasRfPredes: rows.filter(r => r.has_rf_departure).length, hasRfResdes: rows.filter(r => r.has_rf_arrival).length,
    avgRfTransitH: mean(rfTransitVals), avgEdiTransitH: mean(ediTransitVals),
    medRfTransitH: median(rfTransitVals), medEdiTransitH: median(ediTransitVals),
    missingCardit: rows.filter(r => r.missing_cardit).length, missingResdit74: rows.filter(r => r.missing_resdit74).length,
    missingResdit21: rows.filter(r => r.missing_resdit21).length, missingResdes: rows.filter(r => r.missing_resdes).length,
    avgDeltaPredesH: mean(deltaPredesVals), avgDeltaResdesH: mean(deltaResdesVals),
    byRoute,
    byOriginCentre: buildCentreStats(rows, 'rf_origin_centre',  'rf_origin_impc',  'rf_origin_country',  'delta_predes_hours'),
    byDestCentre:   buildCentreStats(rows, 'rf_arrival_centre', 'rf_arrival_impc', 'rf_arrival_country', 'delta_resdes_hours'),
    rfTransitCdf: buildCDF(rfTransitVals), ediTransitCdf: buildCDF(ediTransitVals),
  };
}

/* ── Hook ───────────────────────────────────────────────────────────────────── */
export function useBenchmarkData(
  journeys: RfidJourney[],
  filters: BenchmarkFilters = {},
  rfidBackgroundLoading = false,
  rfidBackgroundProgress: { loaded: number; total: number } | null = null,
) {
  const [idMap,        setIdMap]        = useState<Map<string, string> | null>(null);
  const [ediMap,       setEdiMap]       = useState<Map<string, EdiRow> | null>(null);
  const [ediLoading,   setEdiLoading]   = useState(true);
  const [ediProgress,  setEdiProgress]  = useState<{ loaded: number; total: number } | null>(null);
  const [error,        setError]        = useState<string | null>(null);

  useEffect(() => {
    getIdRelationMap().then(m => setIdMap(m)).catch(e => setError(e.message ?? 'Error loading ID Relation'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEdiLoading(true); setError(null);
    getEdiMap((loaded, total) => { if (!cancelled) setEdiProgress({ loaded, total }); })
      .then(m => { if (!cancelled) { setEdiMap(m); setEdiLoading(false); setEdiProgress(null); } })
      .catch(e => { if (!cancelled) { setError(`benchmark_rfid_edi: ${e.message ?? 'Error'}`); setEdiLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo<BenchmarkRow[]>(() => {
    if (!idMap || !ediMap || !journeys.length) return [];
    return buildBenchmarkRows(journeys, idMap, ediMap, filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idMap, ediMap, journeys, JSON.stringify(filters)]);

  const stats = useMemo(() => rows.length ? computeStats(rows) : null, [rows]);

  const allOriginCountries = useMemo(() => {
    if (!idMap || !ediMap) return [];
    return [...new Set(buildBenchmarkRows(journeys, idMap, ediMap, {}).map(r => r.rf_origin_country ?? r.rf_departure_country).filter((c): c is string => !!c))].sort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idMap, ediMap, journeys.length]);

  const allDestCountries = useMemo(() => {
    if (!idMap || !ediMap) return [];
    const base = filters.originCountry
      ? buildBenchmarkRows(journeys, idMap, ediMap, { originCountry: filters.originCountry })
      : buildBenchmarkRows(journeys, idMap, ediMap, {});
    return [...new Set(base.map(r => r.rf_dest_country ?? r.rf_arrival_country).filter((c): c is string => !!c))].sort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idMap, ediMap, journeys.length, filters.originCountry]);

  return {
    rows, stats,
    loading: ediLoading || !idMap,
    error, ediProgress,
    backgroundLoading: rfidBackgroundLoading,
    backgroundProgress: rfidBackgroundProgress,
    idRelationSize: idMap?.size ?? 0,
    ediSize: ediMap?.size ?? 0,
    allOriginCountries, allDestCountries,
  };
}
