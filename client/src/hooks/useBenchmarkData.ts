/**
 * useBenchmarkData — Benchmark RFID vs EDI
 *
 * Reads from the materialized view `benchmark_rfid_edi` which pre-computes
 * the join: RFID ↔ ID Relation ↔ datos EDI
 *
 * EDI event chain (logical order):
 *   PREDES → CARDIT → RESDIT74 → RESDIT21 → RESDES
 *
 * RFID equivalences:
 *   RF-PREDES  = RFID ORIGIN      (first reading ≈ departure preparation)
 *   RF-RESDES  = RFID DESTINATION (last reading  ≈ delivery confirmation)
 *   RFID transit = DEPARTURE → ARRIVAL
 *   EDI  transit = PREDES    → RESDES
 */
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';

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
  byRoute: RouteStats[];
  rfTransitCdf:  { x: number; pct: number }[];
  ediTransitCdf: { x: number; pct: number }[];
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

/* ── Fetch from materialized view ───────────────────────────────────────────── */
async function fetchBenchmarkRows(): Promise<BenchmarkRow[]> {
  const PAGE = 1000;
  const allRows: BenchmarkRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('benchmark_rfid_edi')
      .select('*')
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`benchmark_rfid_edi: ${error.message}`);
    if (!data || data.length === 0) break;

    allRows.push(...(data as BenchmarkRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return allRows;
}

/* ── Stats ──────────────────────────────────────────────────────────────────── */
function computeStats(rows: BenchmarkRow[]): BenchmarkStats {
  const depRows     = rows.filter(r => r.has_rf_departure);
  const arrRows     = rows.filter(r => r.has_rf_arrival);
  const transitRows = rows.filter(r => r.has_rf_transit && r.has_edi_transit);

  const rfTransitVals  = transitRows.map(r => Number(r.rf_transit_hours)).filter(v => v > 0);
  const ediTransitVals = transitRows.map(r => Number(r.edi_transit_hours)).filter(v => v > 0);
  const deltaPredesVals = depRows.map(r => Number(r.delta_predes_hours)).filter(v => !isNaN(v));
  const deltaResdesVals = arrRows.map(r => Number(r.delta_resdes_hours)).filter(v => !isNaN(v));

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
    rfTransitCdf:    buildCDF(rfTransitVals),
    ediTransitCdf:   buildCDF(ediTransitVals),
  };
}

/* ── Hook ───────────────────────────────────────────────────────────────────── */
export function useBenchmarkData() {
  const [rows, setRows]       = useState<BenchmarkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBenchmarkRows()
      .then(data => { if (!cancelled) { setRows(data); setLoading(false); } })
      .catch(err  => { if (!cancelled) { setError(err.message ?? 'Error loading benchmark data'); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => rows.length ? computeStats(rows) : null, [rows]);
  return { rows, stats, loading, error };
}
