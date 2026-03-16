/**
 * useBenchmarkData — Benchmark RFID vs EDI
 *
 * Join key: RFID.tag_id = ID_Relation.tagid → ID_Relation.s9id = datos_EDI.ean
 *
 * EDI event chain (logical order at origin → in transit → at destination):
 *   PREDES → CARDIT → RESDIT74 → RESDIT21 → RESDES
 *
 * RFID equivalences:
 *   RF-PREDES  = RFID ORIGIN     (first reading, ≈ departure preparation)
 *   RF-RESDES  = RFID DESTINATION (last reading, ≈ delivery confirmation)
 *   RFID transit time = DEPARTURE → ARRIVAL (international boundary)
 *   EDI  transit time = PREDES   → RESDES
 *
 * Scope per section:
 *   Departure analysis : receptacles with RFID DEPARTURE  + EDI record (any)
 *   Arrival  analysis  : receptacles with RFID ARRIVAL    + EDI record (any)
 *   Transit  analysis  : receptacles with RFID DEP+ARR    + EDI PREDES+RESDES
 *   All pairs          : any receptacle in ID_Relation that has an EDI record
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
  rf_predes_time:     string | null;   // RF-PREDES = ORIGIN time
  rf_departure_time:  string | null;
  rf_arrival_time:    string | null;
  rf_dest_country:    string | null;
  rf_dest_centre:     string | null;
  rf_dest_impc:       string | null;
  rf_resdes_time:     string | null;   // RF-RESDES = DESTINATION time
  // Computed times
  rf_transit_hours:   number | null;   // DEPARTURE → ARRIVAL
  edi_transit_hours:  number | null;   // PREDES → RESDES
  delta_predes_hours: number | null;   // RF-PREDES minus EDI PREDES (+ = RFID later)
  delta_resdes_hours: number | null;   // RF-RESDES minus EDI RESDES (+ = RFID later)
  // Gap flags (missing EDI events)
  missing_cardit:    boolean;
  missing_resdit74:  boolean;
  missing_resdit21:  boolean;
  missing_resdes:    boolean;
  // Scope flags
  has_rf_departure:  boolean;
  has_rf_arrival:    boolean;
  has_rf_transit:    boolean;          // DEP + ARR both present
  has_edi_transit:   boolean;          // PREDES + RESDES both present
}

export interface BenchmarkStats {
  // Counts
  totalPairs:      number;   // all receptacles with ID_Relation + EDI record
  departurePairs:  number;   // RFID DEPARTURE + EDI record
  arrivalPairs:    number;   // RFID ARRIVAL   + EDI record
  transitPairs:    number;   // RFID DEP+ARR   + EDI PREDES+RESDES
  // EDI completeness (over totalPairs)
  hasEdiPredes:    number;
  hasEdiCardit:    number;
  hasEdiResdit74:  number;
  hasEdiResdit21:  number;
  hasEdiResdes:    number;
  // RFID coverage
  hasRfPredes:     number;
  hasRfResdes:     number;
  // Transit time stats (over transitPairs)
  avgRfTransitH:   number | null;
  avgEdiTransitH:  number | null;
  medRfTransitH:   number | null;
  medEdiTransitH:  number | null;
  // Gap analysis (over totalPairs)
  missingCardit:   number;
  missingResdit74: number;
  missingResdit21: number;
  missingResdes:   number;
  // Delta PREDES (RF-PREDES vs EDI PREDES) — over departure pairs
  avgDeltaPredesH: number | null;
  // Delta RESDES (RF-RESDES vs EDI RESDES) — over arrival pairs
  avgDeltaResdesH: number | null;
  // By route (sorted by count desc)
  byRoute: RouteStats[];
  // CDF for transit comparison
  rfTransitCdf:  { x: number; pct: number }[];
  ediTransitCdf: { x: number; pct: number }[];
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

/* ── Math helpers ───────────────────────────────────────────────────────────── */
function diffHours(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return isNaN(ms) ? null : Math.round((ms / 3600000) * 10) / 10;
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

/* ── Fetch ──────────────────────────────────────────────────────────────────── */

async function fetchBenchmarkRows(): Promise<BenchmarkRow[]> {
  // 1. datos EDI (small table ~3k rows)
  const { data: ediRows, error: ediErr } = await supabase
    .from('datos EDI')
    .select('ean,origin,destination,predes_time,cardit_time,resdit74_time,resdit74_impc,resdit21_time,resdit21_impc,redes_time');
  if (ediErr) throw new Error(`datos EDI: ${ediErr.message}`);

  // 2. ID Relation — deduplicate: one tagid per s9id (first by id)
  const { data: idRelRows, error: idErr } = await supabase
    .from('ID Relation')
    .select('s9id,tagid')
    .order('id', { ascending: true });
  if (idErr) throw new Error(`ID Relation: ${idErr.message}`);

  const s9idToTag = new Map<string, string>();
  for (const row of (idRelRows ?? [])) {
    if (row.s9id && row.tagid && !s9idToTag.has(row.s9id)) {
      s9idToTag.set(row.s9id, row.tagid);
    }
  }

  const ediMap = new Map<string, typeof ediRows[0]>();
  for (const row of (ediRows ?? [])) {
    if (row.ean) ediMap.set(row.ean, row);
  }

  // Paired s9ids: have both an EDI record AND a tagid in ID Relation
  const pairedS9ids = Array.from(s9idToTag.keys()).filter(s => ediMap.has(s));
  const pairedTagIds = pairedS9ids.map(s => s9idToTag.get(s)!);
  if (!pairedTagIds.length) return [];

  // 3. RFID — fetch only key event types for paired tags (batches of 200)
  type RfidEntry = {
    origin_time: string | null; origin_country: string | null;
    origin_centre: string | null; origin_impc: string | null;
    dest_time: string | null; dest_country: string | null;
    dest_centre: string | null; dest_impc: string | null;
    dep_time: string | null; arr_time: string | null;
  };
  const rfidByTag = new Map<string, RfidEntry>();

  const BATCH = 200;
  for (let i = 0; i < pairedTagIds.length; i += BATCH) {
    const batch = pairedTagIds.slice(i, i + BATCH);
    const { data: rfidRows, error: rfErr } = await supabase
      .from('RFID')
      .select('tag_id,event_type,event_time_local,country,center_name,impc_code')
      .in('tag_id', batch)
      .in('event_type', ['ORIGIN', 'DESTINATION', 'DEPARTURE', 'ARRIVAL']);
    if (rfErr) throw new Error(`RFID: ${rfErr.message}`);

    for (const r of (rfidRows ?? [])) {
      if (!rfidByTag.has(r.tag_id)) {
        rfidByTag.set(r.tag_id, {
          origin_time: null, origin_country: null, origin_centre: null, origin_impc: null,
          dest_time: null, dest_country: null, dest_centre: null, dest_impc: null,
          dep_time: null, arr_time: null,
        });
      }
      const e = rfidByTag.get(r.tag_id)!;
      const t = r.event_time_local as string;
      if (r.event_type === 'ORIGIN') {
        if (!e.origin_time || t < e.origin_time) {
          e.origin_time = t; e.origin_country = r.country;
          e.origin_centre = r.center_name; e.origin_impc = r.impc_code;
        }
      } else if (r.event_type === 'DESTINATION') {
        if (!e.dest_time || t > e.dest_time) {
          e.dest_time = t; e.dest_country = r.country;
          e.dest_centre = r.center_name; e.dest_impc = r.impc_code;
        }
      } else if (r.event_type === 'DEPARTURE') {
        // Last DEPARTURE (latest time)
        if (!e.dep_time || t > e.dep_time) e.dep_time = t;
      } else if (r.event_type === 'ARRIVAL') {
        // First ARRIVAL (earliest time)
        if (!e.arr_time || t < e.arr_time) e.arr_time = t;
      }
    }
  }

  // 4. Build rows
  return pairedS9ids.map(s9id => {
    const tagId = s9idToTag.get(s9id)!;
    const edi   = ediMap.get(s9id)!;
    const rf    = rfidByTag.get(tagId);

    const rfPredesTime = rf?.origin_time ?? null;
    const rfResdesTime = rf?.dest_time   ?? null;
    const rfDepTime    = rf?.dep_time    ?? null;
    const rfArrTime    = rf?.arr_time    ?? null;

    return {
      s9id,
      tag_id: tagId,
      edi_origin_impc:   edi.origin      ?? null,
      edi_dest_impc:     edi.destination ?? null,
      edi_predes_time:   edi.predes_time   ?? null,
      edi_cardit_time:   edi.cardit_time   ?? null,
      edi_resdit74_time: edi.resdit74_time ?? null,
      edi_resdit74_impc: edi.resdit74_impc ?? null,
      edi_resdit21_time: edi.resdit21_time ?? null,
      edi_resdit21_impc: edi.resdit21_impc ?? null,
      edi_resdes_time:   edi.redes_time    ?? null,
      rf_origin_country: rf?.origin_country ?? null,
      rf_origin_centre:  rf?.origin_centre  ?? null,
      rf_origin_impc:    rf?.origin_impc    ?? null,
      rf_predes_time:    rfPredesTime,
      rf_departure_time: rfDepTime,
      rf_arrival_time:   rfArrTime,
      rf_dest_country:   rf?.dest_country ?? null,
      rf_dest_centre:    rf?.dest_centre  ?? null,
      rf_dest_impc:      rf?.dest_impc    ?? null,
      rf_resdes_time:    rfResdesTime,
      rf_transit_hours:   diffHours(rfDepTime, rfArrTime),
      edi_transit_hours:  diffHours(edi.predes_time ?? null, edi.redes_time ?? null),
      delta_predes_hours: diffHours(edi.predes_time ?? null, rfPredesTime),
      delta_resdes_hours: diffHours(edi.redes_time  ?? null, rfResdesTime),
      missing_cardit:    !edi.cardit_time,
      missing_resdit74:  !edi.resdit74_time,
      missing_resdit21:  !edi.resdit21_time,
      missing_resdes:    !edi.redes_time,
      has_rf_departure:  !!rfDepTime,
      has_rf_arrival:    !!rfArrTime,
      has_rf_transit:    !!(rfDepTime && rfArrTime),
      has_edi_transit:   !!(edi.predes_time && edi.redes_time),
    };
  });
}

/* ── Stats ──────────────────────────────────────────────────────────────────── */

function computeStats(rows: BenchmarkRow[]): BenchmarkStats {
  const n = rows.length;

  // Subsets
  const depRows     = rows.filter(r => r.has_rf_departure);
  const arrRows     = rows.filter(r => r.has_rf_arrival);
  const transitRows = rows.filter(r => r.has_rf_transit && r.has_edi_transit);

  const rfTransitVals  = transitRows.map(r => r.rf_transit_hours!).filter(v => v > 0);
  const ediTransitVals = transitRows.map(r => r.edi_transit_hours!).filter(v => v > 0);

  const deltaPredesVals = depRows
    .map(r => r.delta_predes_hours)
    .filter((v): v is number => v !== null);
  const deltaResdesVals = arrRows
    .map(r => r.delta_resdes_hours)
    .filter((v): v is number => v !== null);

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
      if (r.rf_transit_hours  !== null && r.rf_transit_hours  > 0) v.rfH.push(r.rf_transit_hours);
      if (r.edi_transit_hours !== null && r.edi_transit_hours > 0) v.ediH.push(r.edi_transit_hours);
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
    totalPairs:      n,
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
      .catch(err  => { if (!cancelled) { setError(err.message ?? 'Error'); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => rows.length ? computeStats(rows) : null, [rows]);

  return { rows, stats, loading, error };
}
