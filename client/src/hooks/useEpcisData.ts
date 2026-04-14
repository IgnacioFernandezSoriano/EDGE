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

import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchRfidReadings, fetchRfidReadingsWithProgress, fetchRfidReadersMaster, fetchEdiTagMap, fetchIdRelationTagSet } from '@/lib/supabase';
import type { RfidReading, RfidReaderMaster, EdiTagInfo } from '@/lib/supabase';

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
  is_complete: boolean;                   // all events in this journey have status=COMPLETE (informational only)
  is_both_rfid: boolean;
  centres_visited: string[];
  // All OE/AMU centres visited in origin and destination blocks (for KPI and chart alignment)
  origin_oe_centres:  string[];   // td_reader=false in origin block
  origin_amu_centres: string[];   // td_reader=true  in origin block
  dest_oe_centres:    string[];   // td_reader=false in dest block
  dest_amu_centres:   string[];   // td_reader=true  in dest block
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
  // Overview KPI counts
  kpiTotalTags: number;
  kpiRfidDepartures: number;
  kpiRfPredes: number;
  kpiRfResdes: number;
  kpiRfidArrivals: number;
  kpiRfE2e: number;
  avgTransitHours: number | null;
  meanTransitHours: number | null;
  p25TransitHours: number | null;
  p75TransitHours: number | null;
  minTransitHours: number | null;
  maxTransitHours: number | null;
  byOriginCountry: { country: string; count: number; endToEnd: number; pct: number }[];
  byDestCountry:   { country: string; count: number }[];
  byOriginCentre:  { centre: string; country: string; count: number; endToEnd: number }[];
  departureVolumeByAMU: { centre: string; country: string; count: number; hasAMU: boolean }[];
  arrivalVolumeByAMU:   { centre: string; country: string; count: number; hasAMU: boolean }[];
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
 * REGLA DE SELECCIÓN DE EVENTOS DEL TRAYECTO
 *
 * Groups individual RFID readings by tag_id and builds journey objects
 * applying the "Regla de Selección de Eventos del Trayecto":
 *
 * 1. Sort readings by record_time ASC
 * 2. Identify country change → defines ORIGIN block (first country) and DESTINATION block (first different country)
 * 3. Within each block, group by read_point_id (centre):
 *    - ORIGIN block: select LAST reading per centre
 *    - DESTINATION block: select FIRST reading per centre
 * 4. Classify by td_reader (from rfid_readers_master) for OE hitos only:
 *    - ORIGIN + td_reader=false → OE Origin (last of all last-per-centre)
 *    - DEST   + td_reader=false → OE Destination (first of all first-per-centre)
 * 5. DEPARTURE = last reading of the entire origin block (any reader type)
 *    ARRIVAL   = first reading of the entire destination block (any reader type)
 * 6. Leg2 = tags with readings in two different countries
 * 7. transit_hours = record_time(ARRIVAL) - record_time(DEPARTURE)
 */
function readingsToJourneys(
  readings: RfidReading[],
  readerMap: Map<string, RfidReaderMaster>,
  ediTagMap?: Map<string, EdiTagInfo>
): RfidJourney[] {
  const safeEdiMap = ediTagMap ?? new Map<string, EdiTagInfo>();
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
    // Step 1: Sort by record_time ASC
    const sorted = [...rows].sort((a, b) => {
      const ta = a.record_time || a.event_time_local || '';
      const tb = b.record_time || b.event_time_local || '';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    // Helper: get country and centre for a reading (prefer rfid_readers_master data)
    function getReaderInfo(r: RfidReading): { country: string; centre: string; impc: string; td_reader: boolean } {
      const master = r.read_point_id ? readerMap.get(r.read_point_id) : undefined;
      const country = master?.country || r.country || parseLocation(r.location).country || '';
      const centre  = master?.center_name || r.center_name || parseLocation(r.location).centre || r.impc_code || '';
      const impc    = master?.impc_code || r.impc_code || '';
      const td_reader = master?.td_reader ?? false;
      return { country, centre, impc, td_reader };
    }

    // Step 2: Identify origin country (first record's country)
    const firstInfo = getReaderInfo(sorted[0]);
    const originCountry = firstInfo.country;
    if (!originCountry) continue; // skip tags with no known country

    // Split into ORIGIN block and DESTINATION block
    // ORIGIN block: consecutive records from the start with the origin country
    // DESTINATION block: all records from the first record with a different country
    let firstDestIdx = -1;
    for (let i = 0; i < sorted.length; i++) {
      const info = getReaderInfo(sorted[i]);
      if (info.country && info.country !== originCountry) {
        firstDestIdx = i;
        break;
      }
    }

    const originBlock = firstDestIdx === -1 ? sorted : sorted.slice(0, firstDestIdx);
    const destBlock   = firstDestIdx === -1 ? []     : sorted.slice(firstDestIdx);

    // Step 3 + 4: ORIGIN block — last reading per centre
    const originLastByCentre = new Map<string, { reading: RfidReading; info: ReturnType<typeof getReaderInfo> }>();
    for (const r of originBlock) {
      const centreKey = r.read_point_id || r.center_name || '';
      if (!centreKey) continue;
      const info = getReaderInfo(r);
      // Always overwrite → last one wins (sorted ASC so last = latest)
      originLastByCentre.set(centreKey, { reading: r, info });
    }

    // Step 3 + 4: DESTINATION block — first reading per centre
    const destFirstByCentre = new Map<string, { reading: RfidReading; info: ReturnType<typeof getReaderInfo> }>();
    for (const r of destBlock) {
      const centreKey = r.read_point_id || r.center_name || '';
      if (!centreKey) continue;
      if (!destFirstByCentre.has(centreKey)) {
        const info = getReaderInfo(r);
        destFirstByCentre.set(centreKey, { reading: r, info });
      }
    }

    // Classify origin centres
    const originOE:  Array<{ reading: RfidReading; info: ReturnType<typeof getReaderInfo> }> = [];
    const originAMU: Array<{ reading: RfidReading; info: ReturnType<typeof getReaderInfo> }> = [];
    for (const v of originLastByCentre.values()) {
      if (v.info.td_reader) originAMU.push(v);
      else originOE.push(v);
    }

    // Classify destination centres
    const destAMU: Array<{ reading: RfidReading; info: ReturnType<typeof getReaderInfo> }> = [];
    const destOE:  Array<{ reading: RfidReading; info: ReturnType<typeof getReaderInfo> }> = [];
    for (const v of destFirstByCentre.values()) {
      if (v.info.td_reader) destAMU.push(v);
      else destOE.push(v);
    }

    // Step 5: DEPARTURE = last reading of the entire origin block (any reader type)
    // CONDICIÓN CLAVE: solo existe evento de salida si el tag tiene lecturas en
    // al menos dos países distintos (destBlock.length > 0).
    // EXCEPCIÓN EDI: si el tag tiene solo lecturas en un país pero tiene datos EDI
    // que indican que ese país es el origen, se clasifica como Departure.
    const allOriginEntries = [...originLastByCentre.values()];
    // Use the raw origin block (all readings) to find the absolute last reading
    const originBlockSorted = [...originBlock].sort((a, b) =>
      (a.record_time || a.event_time_local || '') < (b.record_time || b.event_time_local || '') ? -1 : 1
    );
    const lastOriginReading = originBlockSorted.length > 0 ? originBlockSorted[originBlockSorted.length - 1] : null;
    let departureEntry: { reading: RfidReading; info: ReturnType<typeof getReaderInfo> } | null =
      (lastOriginReading && destBlock.length > 0)
        ? { reading: lastOriginReading, info: getReaderInfo(lastOriginReading) }
        : null;

    // ARRIVAL = first reading of the entire destination block (any reader type)
    const firstDestReading = destBlock.length > 0 ? destBlock[0] : null; // destBlock already sorted ASC
    let amuInboundEntry: { reading: RfidReading; info: ReturnType<typeof getReaderInfo> } | null =
      firstDestReading ? { reading: firstDestReading, info: getReaderInfo(firstDestReading) } : null;

    // EDI FALLBACK: para tags con lecturas en un único país (destBlock.length === 0),
    // consultar datos EDI para determinar si es Departure o Arrival.
    if (destBlock.length === 0 && allOriginEntries.length > 0) {
      const ediInfo = safeEdiMap.get(tagKey);
      if (ediInfo) {
        const readerImpc = firstInfo.impc.toUpperCase();
        const originImpc = (ediInfo.origin_impc || '').toUpperCase();
        const destImpc   = (ediInfo.destination_impc || '').toUpperCase();
        if (originImpc && readerImpc === originImpc) {
          // Tag is a Departure: last reading in origin block
          departureEntry = lastOriginReading
            ? { reading: lastOriginReading, info: getReaderInfo(lastOriginReading) }
            : null;
        } else if (destImpc && readerImpc === destImpc) {
          // Tag is an Arrival: first reading in the block (already the only block)
          const firstReading = originBlockSorted[0] ?? null;
          if (firstReading) amuInboundEntry = { reading: firstReading, info: getReaderInfo(firstReading) };
        }
      }
    }

    // Para compatibilidad con campos legacy (origin_centre, dest_centre, etc.)
    // OE Origin: last of all last-per-centre with td_reader=false in origin block
    const oeOriginEntry = originOE.length > 0
      ? originOE.sort((a, b) => (a.reading.record_time || '') < (b.reading.record_time || '') ? -1 : 1).at(-1)!
      : null;
    // OE Destination: first of all first-per-centre with td_reader=false in dest block
    const oeDestEntry = destOE.length > 0
      ? destOE.sort((a, b) => (a.reading.record_time || '') < (b.reading.record_time || '') ? -1 : 1)[0]
      : null;
    // AMU Outbound (kept for legacy compatibility)
    const amuOutboundEntry = originAMU.length > 0
      ? originAMU.sort((a, b) => (a.reading.record_time || '') < (b.reading.record_time || '') ? -1 : 1).at(-1)!
      : null;

    // Step 5: Leg2 = has DEPARTURE + ARRIVAL
    const hasIntl = departureEntry !== null && amuInboundEntry !== null;

    // Step 6: transit_hours = ARRIVAL record_time - DEPARTURE record_time
    let intlTransitHours: number | null = null;
    if (hasIntl) {
      const depTime = departureEntry!.reading.record_time || departureEntry!.reading.event_time_local || null;
      const arrTime = amuInboundEntry!.reading.record_time  || amuInboundEntry!.reading.event_time_local  || null;
      if (depTime && arrTime) {
        const diffMs = new Date(arrTime).getTime() - new Date(depTime).getTime();
        if (diffMs > 0) intlTransitHours = Math.round((diffMs / 3600000) * 10) / 10;
      }
    }

    // Full journey time: OE Origin → OE Destination
    let transitHours: number | null = null;
    let fullJourneyHours: number | null = null;
    if (oeOriginEntry && oeDestEntry) {
      const t1 = oeOriginEntry.reading.record_time || oeOriginEntry.reading.event_time_local || null;
      const t2 = oeDestEntry.reading.record_time   || oeDestEntry.reading.event_time_local   || null;
      if (t1 && t2) {
        const diffMs = new Date(t2).getTime() - new Date(t1).getTime();
        if (diffMs > 0) {
          transitHours = Math.round((diffMs / 3600000) * 10) / 10;
          fullJourneyHours = transitHours;
        }
      }
    }

    // Build centres visited list
    const centresVisited: string[] = [];
    for (const r of sorted) {
      const c = getReaderInfo(r).centre;
      if (c && !centresVisited.includes(c)) centresVisited.push(c);
    }

    // Derive fields for backward compatibility
    const originInfo  = oeOriginEntry?.info    ?? firstInfo;
    const originTime  = oeOriginEntry?.reading.record_time || oeOriginEntry?.reading.event_time_local || sorted[0].record_time || sorted[0].event_time_local || '';
    const destInfo    = oeDestEntry?.info      ?? null;
    const destTime    = oeDestEntry?.reading.record_time   || oeDestEntry?.reading.event_time_local   || null;
    // departure_* = último lector en bloque origen (nuevo criterio)
    const depInfo     = departureEntry?.info ?? null;
    const depTime     = departureEntry?.reading.record_time || departureEntry?.reading.event_time_local || null;
    const arrInfo     = amuInboundEntry?.info  ?? null;
    const arrTime     = amuInboundEntry?.reading.record_time  || amuInboundEntry?.reading.event_time_local  || null;

    const refRow = sorted[0];
    const tag_id = refRow.tag_id || tagKey;
    // s9id is null when the receptacle has no linked barcode — do NOT fall back to tag_id
    const s9id = (refRow.s9id && refRow.s9id !== tag_id) ? refRow.s9id : null;

    journeys.push({
      s9id,
      tag_id,
      // Full journey (OE Origin → OE Destination)
      origin_country:   originInfo.country,
      origin_centre:    originInfo.centre,
      origin_impc:      originInfo.impc,
      origin_time:      originTime,
      origin_readings:  oeOriginEntry ? 1 : 0,
      dest_country:     destInfo?.country ?? null,
      dest_centre:      destInfo?.centre  ?? null,
      dest_impc:        destInfo?.impc    ?? null,
      dest_time:        destTime,
      dest_readings:    oeDestEntry ? 1 : 0,
      // International transit (AMU Outbound → AMU Inbound)
      departure_country: depInfo?.country ?? null,
      departure_centre:  depInfo?.centre  ?? null,
      departure_impc:    depInfo?.impc    ?? null,
      departure_time:    depTime,
      arrival_country:   arrInfo?.country ?? null,
      arrival_centre:    arrInfo?.centre  ?? null,
      arrival_impc:      arrInfo?.impc    ?? null,
      arrival_time:      arrTime,
      // Times
      transit_hours:               transitHours,
      international_transit_hours: intlTransitHours,
      full_journey_hours:          fullJourneyHours,
      has_origin:         oeOriginEntry !== null,
      has_destination:    oeDestEntry   !== null,
      has_international:  hasIntl,
      is_complete:        sorted.every(r => r.status === 'COMPLETE'),
      is_both_rfid:       oeOriginEntry !== null && oeDestEntry !== null,
      centres_visited:    centresVisited,
      // All OE/AMU centres visited per block (unique, for KPI/chart alignment)
      origin_oe_centres:  [...new Set(originOE.map(v => v.info.centre))],
      origin_amu_centres: [...new Set(originAMU.map(v => v.info.centre))],
      dest_oe_centres:    [...new Set(destOE.map(v => v.info.centre))],
      dest_amu_centres:   [...new Set(destAMU.map(v => v.info.centre))],
    });
  }

  return journeys;
}

/* ─── Compute stats from journeys ─── */
function computeEpcisStats(journeys: RfidJourney[]): EpcisStats {
  // endToEnd: journeys with DEPARTURE + ARRIVAL (international transit measured)
  // Transit analysis: all journeys with both DEPARTURE and ARRIVAL events
  const endToEnd = journeys.filter(j => j.has_international);
  const bothRfid  = journeys.filter(j => j.is_both_rfid);
  // KPI transit values: use DEPARTURE→ARRIVAL (international_transit_hours) only
  const transitValues = endToEnd
    .map(j => j.international_transit_hours!)
    .filter(h => h !== null && h > 0) as number[];

  const times = journeys.map(j => j.origin_time).filter(Boolean).sort();
  const destTimes = endToEnd.map(j => j.dest_time!).filter(Boolean).sort();
  const allTimes = [...times, ...destTimes].sort();
  const dateRange = allTimes.length > 0 ? { min: allTimes[0], max: allTimes[allTimes.length - 1] } : null;

  // By origin country — journeys with DEPARTURE event (último lector en bloque origen, sin filtro AMU/OE).
  // Criterion: departure_centre != null (matches Tags Departure KPI).
  const journeysWithDeparture = journeys.filter(j => j.departure_centre !== null);
  // Keep journeysWithOrigin for backward compat (byOriginCentre still uses it)
  const journeysWithOrigin = journeys.filter(j => j.origin_readings > 0 || j.origin_country);
  const originCountryMap = new Map<string, { count: number; endToEnd: number }>();
  for (const j of journeysWithDeparture) {
    const c = j.origin_country || 'Unknown';
    if (!originCountryMap.has(c)) originCountryMap.set(c, { count: 0, endToEnd: 0 });
    const v = originCountryMap.get(c)!;
    v.count++;
    if (j.has_destination) v.endToEnd++;
  }
  const byOriginCountry = Array.from(originCountryMap.entries())
    .map(([country, v]) => ({ country, count: v.count, endToEnd: v.endToEnd, pct: Math.round(v.endToEnd / v.count * 100) }))
    .sort((a, b) => b.count - a.count);

  // By dest country — journeys with ARRIVAL event (primer lector TD en bloque destino).
  // Criterion: arrival_centre != null (matches Tags Arrival KPI).
  const journeysWithArrival = journeys.filter(j => j.arrival_centre !== null);
  const destCountryMap = new Map<string, number>();
  for (const j of journeysWithArrival) {
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

  // Departure Volume by Centre:
  // Cada tag contribuye UNA VEZ con su departure_centre (último lector en bloque origen).
  // La suma de todos los centros = kpiRfPredes (Tags Departure).
  // hasAMU indica si ese lector es TD (true=azul) o no-TD (false=ámbar), solo para colorear.
  const depCentreVolumeMap = new Map<string, { country: string; count: number; isTD: boolean }>();
  for (const j of journeysWithDeparture) {
    const centre = j.departure_centre!;
    const isTD = j.origin_amu_centres.includes(centre); // TD si ese centro está en origin_amu
    if (!depCentreVolumeMap.has(centre)) depCentreVolumeMap.set(centre, { country: j.departure_country || j.origin_country, count: 0, isTD });
    depCentreVolumeMap.get(centre)!.count++;
  }
  const departureVolumeByAMU = Array.from(depCentreVolumeMap.entries())
    .map(([centre, v]) => ({ centre, country: v.country, count: v.count, hasAMU: v.isTD }))
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

  // Arrival Volume by Centre:
  // Cada tag contribuye UNA VEZ con su arrival_centre (primer lector TD en bloque destino).
  // La suma de todos los centros = kpiRfResdes (Tags Arrival).
  // hasAMU = true siempre (todos son TD por definición del criterio de arrival).
  const arrCentreVolumeMap = new Map<string, { country: string; count: number }>();
  for (const j of journeysWithArrival) {
    const centre = j.arrival_centre!;
    const country = j.arrival_country || j.dest_country || '';
    if (!arrCentreVolumeMap.has(centre)) arrCentreVolumeMap.set(centre, { country, count: 0 });
    arrCentreVolumeMap.get(centre)!.count++;
  }
  const arrivalVolumeByAMU = Array.from(arrCentreVolumeMap.entries())
    .map(([centre, v]) => ({ centre, country: v.country, count: v.count, hasAMU: true as const }))
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
  // NOTE: All KPIs count ALL records regardless of status
  const kpiTotalTags = new Set(journeys.map(j => j.tag_id)).size;
  // Tags Departure: tags con departure_centre != null (último lector en bloque origen, sin filtro AMU/OE)
  const kpiRfPredes  = new Set(journeysWithDeparture.map(j => j.tag_id)).size;
  // Tags Arrival:   tags con arrival_centre != null (primer lector TD en bloque destino)
  const kpiRfResdes  = new Set(journeysWithArrival.map(j => j.tag_id)).size;
  // Tags Transit (Leg2): tags con ambos eventos (Departure + Arrival)
  const kpiRfE2e     = new Set(journeys.filter(j => j.has_international).map(j => j.tag_id)).size;
  // Kept for backward compatibility (unused in UI)
  const kpiRfidDepartures = kpiRfPredes;
  const kpiRfidArrivals   = kpiRfResdes;

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
    departureVolumeByAMU,
    arrivalVolumeByAMU,
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
  /** When true, only journeys whose tag_id appears in the ID Relation table are included */
  onlyIdRelation?: boolean;
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
  const [readerMap, setReaderMap] = useState<Map<string, RfidReaderMaster>>(new Map());
  const [ediTagMap, setEdiTagMap] = useState<Map<string, EdiTagInfo>>(new Map());
  const [idRelationTagSet, setIdRelationTagSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [backgroundProgress, setBackgroundProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether the user has explicitly requested the full historical dataset
  const [fullHistoryLoaded, setFullHistoryLoaded] = useState(false);

  // Load rfid_readers_master once on mount
  useEffect(() => {
    fetchRfidReadersMaster().then(masters => {
      const map = new Map<string, RfidReaderMaster>();
      for (const m of masters) map.set(m.read_point_id, m);
      setReaderMap(map);
    }).catch(() => { /* non-critical — fallback to RFID table fields */ });
  }, []);

  // Load EDI tag map once on mount (used to classify single-country tags)
  useEffect(() => {
    fetchEdiTagMap().then(map => {
      setEdiTagMap(map);
    }).catch(() => { /* non-critical — single-country tags will remain unclassified */ });
  }, []);

  // Load ID Relation tag set once on mount (used for the 'Matched Tags' checkbox filter)
  useEffect(() => {
    fetchIdRelationTagSet().then(set => {
      setIdRelationTagSet(set);
    }).catch(() => { /* non-critical — filter will be skipped if load fails */ });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBackgroundLoading(false);
    setError(null);
    setAllReadings([]);

    // Date and country filters are applied in-memory on allJourneys — no reload needed.
    // Progressive loading strategy:
    // Step 1 — fetch last 30 days immediately so the UI is usable fast.
    // Step 2 — load the full history in background using batches of 10 pages.
    //           A progress indicator shows how many pages have been loaded.
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const recentFrom = thirtyDaysAgo.toISOString().split('T')[0];

    setBackgroundProgress(null);

    // EGRESS OPTIMIZATION: Only load the last 30 days automatically.
    // The full historical dataset is loaded only when the user explicitly requests it
    // via the loadFullHistory() function exposed by this hook.
    fetchRfidReadings(recentFrom, undefined)
      .then(recentData => {
        if (cancelled) return;
        setAllReadings(recentData);
        setLoading(false); // UI is now usable with recent data
        // NOTE: Historical data is NOT loaded automatically anymore.
        // The user must click "Cargar historial completo" to trigger loadFullHistory().
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message ?? 'Error al cargar datos RFID');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
    // Load once on mount — date and country filters applied in-memory via useMemo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // no dependencies — load full dataset once

  // Explicit function to load the full historical dataset on user request
  const loadFullHistory = useCallback(() => {
    if (backgroundLoading || fullHistoryLoaded) return;

    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const dayBefore = new Date(thirtyDaysAgo);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const olderTo = dayBefore.toISOString().split('T')[0];

    setBackgroundLoading(true);
    setBackgroundProgress(null);

    fetchRfidReadingsWithProgress(
      '2025-04-01',  // data starts ~Apr 2025
      olderTo,
      (loaded, total) => {
        setBackgroundProgress({ loaded, total });
      }
    )
      .then(olderData => {
        setAllReadings(prev => [...olderData, ...prev]);
        setBackgroundLoading(false);
        setBackgroundProgress(null);
        setFullHistoryLoaded(true);
      })
      .catch(() => {
        setBackgroundLoading(false);
        setBackgroundProgress(null);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundLoading, fullHistoryLoaded]);

  // Build journeys from all readings using the Regla de Selección de Eventos del Trayecto
  const allJourneys = useMemo(() => {
    const journeys = readingsToJourneys(allReadings, readerMap, ediTagMap);
    console.log(`[EDGE] allReadings: ${allReadings.length} events → ${journeys.length} journeys (readerMap: ${readerMap.size}, ediTagMap: ${ediTagMap.size} entries)`);
    return journeys;
  }, [allReadings, readerMap, ediTagMap]);

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

  // Apply country, date and ID Relation filters in the browser (no Supabase reload)
  const filteredJourneys = useMemo(() => {
    let j = allJourneys;
    if (filters.originCountry && filters.originCountry !== 'ALL') {
      j = j.filter(x => effectiveOriginCountry(x) === filters.originCountry);
    }
    if (filters.destCountry && filters.destCountry !== 'ALL') {
      j = j.filter(x => effectiveDestCountry(x) === filters.destCountry);
    }
    if (filters.dateFrom) {
      const from = filters.dateFrom;
      j = j.filter(x => (x.origin_time || x.departure_time || '') >= from);
    }
    if (filters.dateTo) {
      const to = filters.dateTo + 'T23:59:59';
      j = j.filter(x => (x.origin_time || x.departure_time || '') <= to);
    }
    // Matched Tags filter: only journeys whose tag_id appears in ID Relation
    if (filters.onlyIdRelation && idRelationTagSet.size > 0) {
      j = j.filter(x => idRelationTagSet.has(x.tag_id));
    }
    return j;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJourneys, filters.originCountry, filters.destCountry, filters.dateFrom, filters.dateTo, filters.onlyIdRelation, idRelationTagSet]);

  const stats = useMemo(
    () => computeEpcisStats(filteredJourneys),
    [filteredJourneys]
  );

  return {
    loading,
    backgroundLoading,
    backgroundProgress,
    error,
    stats,
    journeys: filteredJourneys,
    allJourneys,
    allOriginCountries,
    allDestCountries,
    // Raw data for in-memory search (SearchID)
    allReadings,
    readerMap,
    // Whether only the last 30 days are loaded (true = partial dataset)
    isPartialData: !fullHistoryLoaded,
    // Function to explicitly load the full historical dataset
    loadFullHistory,
  };
}
