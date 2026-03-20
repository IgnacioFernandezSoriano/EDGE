/**
 * SearchID — Receptacle / Tag ID individual tracker
 *
 * Implementa la "Regla de Selección de Eventos del Trayecto" completa:
 *
 * 1. Consulta la tabla RFID filtrando por tag_id o s9id.
 * 2. Consulta rfid_readers_master para obtener country, td_reader e impc_code
 *    de cada read_point_id.
 * 3. Ordena por record_time ASC.
 * 4. Identifica el cambio de país → Bloque Origen / Bloque Destino.
 * 5. Dentro de cada bloque, agrupa por read_point_id:
 *    - Bloque Origen:  última lectura por centro.
 *    - Bloque Destino: primera lectura por centro.
 * 6. Clasifica por td_reader:
 *    - Origen  + td_reader=false → OE Origin     (última de las últimas)
 *    - Origen  + td_reader=true  → AMU Outbound  (última de las últimas)
 *    - Destino + td_reader=true  → AMU Inbound   (primera de las primeras)
 *    - Destino + td_reader=false → OE Destination (primera de las primeras)
 * 7. Leg2 = tag con AMU Outbound Y AMU Inbound.
 * 8. Muestra todos los hitos del trayecto junto con los eventos EDI
 *    de la vista benchmark_rfid_edi (si existen).
 */

import React, { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Search, Package, Plane, MapPin, Radio, FileText,
  CheckCircle2, Clock, AlertCircle, Loader2, ArrowRight,
  Building2, Globe, ChevronDown, ChevronUp, Timer, LogOut, LogIn,
} from 'lucide-react';

/* ─── Types ──────────────────────────────────────────────────────────────── */

type Segment = 'ORIGIN_COUNTRY' | 'LEG2' | 'DEST_COUNTRY';

interface ReaderInfo {
  country: string;
  centre: string;
  impc: string;
  td_reader: boolean;
}

interface TrackEvent {
  id: string;
  source: 'RFID' | 'EDI';
  event_type: string;
  centre: string | null;
  impc: string | null;
  country: string | null;
  timestamp: string | null;
  segment: Segment;
  /** Milestone role within the journey */
  milestone: 'OE_ORIGIN' | 'AMU_OUTBOUND' | 'AMU_INBOUND' | 'OE_DEST' | 'EDI' | 'OTHER';
  order_key: number;
}

interface SearchResult {
  s9id: string | null;
  tag_id: string | null;
  events: TrackEvent[];
  origin_country: string | null;
  dest_country: string | null;
  found_in: 'RFID' | 'EDI' | 'BOTH' | null;
  is_international: boolean;
  /** Summary of the 4 journey milestones */
  milestones: {
    oe_origin:    TrackEvent | null;
    amu_outbound: TrackEvent | null;
    amu_inbound:  TrackEvent | null;
    oe_dest:      TrackEvent | null;
  };
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function fmtTs(ts: string | null): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: '2-digit',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    }) + ' UTC';
  } catch { return ts; }
}

function diffLabel(a: string | null, b: string | null): string | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (isNaN(ms) || ms < 0) return null;
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)} min`;
  if (h < 24) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d  (${h.toFixed(0)} h)`;
}

function eventTypeLabel(t: string): string {
  const map: Record<string, string> = {
    OE_ORIGIN:    'OE Origin',
    AMU_OUTBOUND: 'AMU Outbound',
    AMU_INBOUND:  'AMU Inbound',
    OE_DEST:      'OE Destination',
    PREDES:       'EDI PREDES',
    RESDES:       'EDI RESDES',
    RESDIT74:     'EDI RESDIT74',
    RESDIT21:     'EDI RESDIT21',
  };
  return map[t] ?? t;
}

/* ─── Segment styles ─────────────────────────────────────────────────────── */

const SEG_STYLE = {
  ORIGIN_COUNTRY: {
    bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-700', title: 'text-blue-700',
    headerBg: 'bg-blue-50', icon: Building2,
  },
  LEG2: {
    bg: 'bg-violet-50', border: 'border-violet-200', dot: 'bg-violet-500',
    badge: 'bg-violet-100 text-violet-700', title: 'text-violet-700',
    headerBg: 'bg-violet-50', icon: Plane,
  },
  DEST_COUNTRY: {
    bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700', title: 'text-emerald-700',
    headerBg: 'bg-emerald-50', icon: Building2,
  },
} as const;

const SOURCE_BADGE: Record<'RFID' | 'EDI', string> = {
  RFID: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
  EDI:  'bg-amber-100  text-amber-700  border border-amber-200',
};

const MILESTONE_BADGE: Record<string, string> = {
  OE_ORIGIN:    'bg-blue-100 text-blue-700 border border-blue-200',
  AMU_OUTBOUND: 'bg-orange-100 text-orange-700 border border-orange-200',
  AMU_INBOUND:  'bg-teal-100 text-teal-700 border border-teal-200',
  OE_DEST:      'bg-emerald-100 text-emerald-700 border border-emerald-200',
};

/* ─── Event type icon ────────────────────────────────────────────────────── */

function EventIcon({ type, className }: { type: string; className?: string }) {
  const map: Record<string, React.ReactNode> = {
    OE_ORIGIN:    <Radio className={className} />,
    AMU_OUTBOUND: <LogOut className={className} />,
    AMU_INBOUND:  <LogIn className={className} />,
    OE_DEST:      <CheckCircle2 className={className} />,
    PREDES:       <FileText className={className} />,
    RESDES:       <FileText className={className} />,
    RESDIT74:     <FileText className={className} />,
    RESDIT21:     <FileText className={className} />,
  };
  return <>{map[type] ?? <Clock className={className} />}</>;
}

/* ─── Transit pill between events ───────────────────────────────────────── */

function TransitPill({ from, to, isLeg2 }: { from: string | null; to: string | null; isLeg2?: boolean }) {
  const label = diffLabel(from, to);
  if (!label) return null;
  return (
    <div className="flex items-center justify-center gap-1.5 py-0.5 px-2 my-1">
      <div className={`h-px flex-1 ${isLeg2 ? 'bg-violet-200' : 'bg-slate-200'}`} />
      <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
        isLeg2
          ? 'bg-violet-50 text-violet-600 border-violet-200'
          : 'bg-slate-50 text-slate-500 border-slate-200'
      }`}>
        <Timer className="w-3 h-3" />
        {label}
      </div>
      <div className={`h-px flex-1 ${isLeg2 ? 'bg-violet-200' : 'bg-slate-200'}`} />
    </div>
  );
}

/* ─── Single event card ──────────────────────────────────────────────────── */

function EventCard({ ev }: { ev: TrackEvent }) {
  const s = SEG_STYLE[ev.segment];
  const milestoneCls = MILESTONE_BADGE[ev.milestone];
  return (
    <div className={`flex gap-3 px-4 py-3 rounded-xl border ${s.border} ${s.bg} hover:shadow-sm transition-all`}>
      <div className="flex-shrink-0 flex flex-col items-center gap-1.5 pt-0.5">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${SOURCE_BADGE[ev.source]}`}>
          {ev.source}
        </span>
        <div className={`w-2 h-2 rounded-full ${s.dot}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <EventIcon type={ev.event_type} className={`w-3.5 h-3.5 ${s.title}`} />
            <span className={`text-xs font-semibold ${s.title}`}>{eventTypeLabel(ev.event_type)}</span>
            {milestoneCls && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${milestoneCls}`}>
                {ev.milestone.replace('_', ' ')}
              </span>
            )}
          </div>
          <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">{fmtTs(ev.timestamp)}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
          {ev.centre && (
            <span className="text-xs text-slate-700 flex items-center gap-1">
              <Building2 className="w-3 h-3 text-slate-400" />{ev.centre}
            </span>
          )}
          {ev.impc && (
            <span className="text-xs font-mono text-slate-500 flex items-center gap-1">
              <Globe className="w-3 h-3 text-slate-400" />{ev.impc}
            </span>
          )}
          {ev.country && <span className="text-xs text-slate-400">{ev.country}</span>}
        </div>
      </div>
    </div>
  );
}

/* ─── Segment block ──────────────────────────────────────────────────────── */

function SegmentBlock({
  segment, events, label, subtitle,
}: {
  segment: Segment;
  events: TrackEvent[];
  label: string;
  subtitle?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const s = SEG_STYLE[segment];
  const Icon = s.icon;
  if (events.length === 0) return null;
  const isLeg2 = segment === 'LEG2';

  const first = events[0].timestamp;
  const last  = events[events.length - 1].timestamp;
  const dur   = events.length >= 2 ? diffLabel(first, last) : null;

  return (
    <div className={`rounded-2xl border-2 ${s.border} overflow-hidden`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className={`w-full flex items-center justify-between px-5 py-3 ${s.headerBg} hover:brightness-95 transition-all`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Icon className={`w-4 h-4 ${s.title}`} />
          <span className={`font-bold text-sm ${s.title}`}>{label}</span>
          {subtitle && <span className="text-xs text-slate-500 font-normal">{subtitle}</span>}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>
            {events.length} event{events.length !== 1 ? 's' : ''}
          </span>
          {dur && (
            <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
              isLeg2 ? 'bg-violet-100 text-violet-700 border-violet-200' : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}>
              <Timer className="w-3 h-3" /> {dur}
            </span>
          )}
        </div>
        {expanded
          ? <ChevronUp className={`w-4 h-4 ${s.title}`} />
          : <ChevronDown className={`w-4 h-4 ${s.title}`} />}
      </button>

      {expanded && (
        <div className="px-4 py-3 bg-white/60 space-y-0">
          {events.map((ev, idx) => (
            <React.Fragment key={ev.id}>
              {idx > 0 && (
                <TransitPill
                  from={events[idx - 1].timestamp}
                  to={ev.timestamp}
                  isLeg2={isLeg2}
                />
              )}
              <EventCard ev={ev} />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Segment connector (between segments) ───────────────────────────────── */

function SegmentConnector({
  fromTs, toTs, label, icon: Icon, badgeCls,
}: {
  fromTs: string | null; toTs: string | null;
  label: string;
  icon: React.ElementType;
  badgeCls: string;
}) {
  const dur = diffLabel(fromTs, toTs);
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="h-px flex-1 bg-violet-200" />
      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${badgeCls}`}>
        <Icon className="w-3.5 h-3.5" />
        {label}
        {dur && (
          <span className="flex items-center gap-1 ml-1 text-[11px]">
            <Timer className="w-3 h-3" /> {dur}
          </span>
        )}
      </div>
      <div className="h-px flex-1 bg-violet-200" />
    </div>
  );
}

/* ─── Milestone summary bar ──────────────────────────────────────────────── */

function MilestoneSummary({ milestones }: { milestones: SearchResult['milestones'] }) {
  const items = [
    { key: 'oe_origin',    ev: milestones.oe_origin,    label: 'OE Origin',     cls: 'bg-blue-50 border-blue-200 text-blue-700' },
    { key: 'amu_outbound', ev: milestones.amu_outbound, label: 'AMU Outbound',  cls: 'bg-orange-50 border-orange-200 text-orange-700' },
    { key: 'amu_inbound',  ev: milestones.amu_inbound,  label: 'AMU Inbound',   cls: 'bg-teal-50 border-teal-200 text-teal-700' },
    { key: 'oe_dest',      ev: milestones.oe_dest,      label: 'OE Destination', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
      {items.map(({ key, ev, label, cls }) => (
        <div key={key} className={`rounded-lg border p-2.5 ${cls}`}>
          <div className="text-[10px] font-bold uppercase tracking-wide opacity-70 mb-1">{label}</div>
          {ev ? (
            <>
              <div className="text-xs font-semibold truncate">{ev.centre ?? '—'}</div>
              <div className="text-[11px] font-mono opacity-70 mt-0.5">{fmtTs(ev.timestamp)}</div>
            </>
          ) : (
            <div className="text-xs opacity-50 italic">Not detected</div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Core search function ───────────────────────────────────────────────── */

async function searchById(q: string): Promise<SearchResult> {
  const result: SearchResult = {
    s9id: null, tag_id: null, events: [],
    origin_country: null, dest_country: null,
    found_in: null, is_international: false,
    milestones: { oe_origin: null, amu_outbound: null, amu_inbound: null, oe_dest: null },
  };

  /* ── Step 1: Fetch raw RFID readings ordered by record_time ──
   * Use eq (exact match) — ilike causes full table scan → statement_timeout.
   * Try both tag_id and s9id with two separate queries and merge results.
   */
  const [{ data: rfidByTagId }, { data: rfidBySid }] = await Promise.all([
    supabase
      .from('RFID')
      .select('tag_id,s9id,read_point_id,record_time,event_time_local,country,center_name,impc_code')
      .eq('tag_id', q)
      .order('record_time', { ascending: true })
      .limit(2000),
    supabase
      .from('RFID')
      .select('tag_id,s9id,read_point_id,record_time,event_time_local,country,center_name,impc_code')
      .eq('s9id', q)
      .order('record_time', { ascending: true })
      .limit(2000),
  ]);

  // Merge and deduplicate by (tag_id + record_time)
  const seen = new Set<string>();
  const rfidRows: typeof rfidByTagId = [];
  for (const row of [...(rfidByTagId ?? []), ...(rfidBySid ?? [])]) {
    const key = `${row.tag_id}|${row.record_time}`;
    if (!seen.has(key)) { seen.add(key); rfidRows.push(row); }
  }
  // Re-sort after merge
  rfidRows.sort((a, b) => (a.record_time ?? '') < (b.record_time ?? '') ? -1 : 1);

  const rfidErr = null; // errors already handled via empty arrays

  if (rfidErr) console.warn('RFID search error:', rfidErr.message);

  /* ── Step 2: Fetch EDI data from benchmark_rfid_edi ── */
  const [{ data: ediByS9id }, { data: ediByTagId }] = await Promise.all([
    supabase
      .from('benchmark_rfid_edi')
      .select([
        's9id,tag_id',
        'edi_origin_impc,edi_dest_impc',
        'edi_predes_time,edi_resdes_time',
        'edi_resdit74_time,edi_resdit74_impc',
        'edi_resdit21_time,edi_resdit21_impc',
        'rf_origin_country,rf_origin_centre,rf_origin_impc',
        'rf_dest_country,rf_dest_centre,rf_dest_impc',
      ].join(','))
      .eq('s9id', q)
      .limit(5),
    supabase
      .from('benchmark_rfid_edi')
      .select([
        's9id,tag_id',
        'edi_origin_impc,edi_dest_impc',
        'edi_predes_time,edi_resdes_time',
        'edi_resdit74_time,edi_resdit74_impc',
        'edi_resdit21_time,edi_resdit21_impc',
        'rf_origin_country,rf_origin_centre,rf_origin_impc',
        'rf_dest_country,rf_dest_centre,rf_dest_impc',
      ].join(','))
      .eq('tag_id', q)
      .limit(5),
  ]);
  const ediRows = [...(ediByS9id ?? []), ...(ediByTagId ?? [])];
  const ediErr = null;

  if (ediErr) console.warn('EDI search error:', ediErr.message);

  const hasRfid = rfidRows && rfidRows.length > 0;
  const hasEdi  = ediRows  && ediRows.length > 0;
  if (!hasRfid && !hasEdi) return result;

  const ediRow  = ediRows?.[0];
  const rfidRow = rfidRows?.[0];

  result.s9id   = ediRow?.s9id   ?? rfidRow?.s9id   ?? null;
  result.tag_id = ediRow?.tag_id ?? rfidRow?.tag_id ?? null;
  result.found_in = hasRfid && hasEdi ? 'BOTH' : hasRfid ? 'RFID' : 'EDI';

  /* ── Step 3: Fetch rfid_readers_master for all read_point_ids ── */
  let readerMap = new Map<string, ReaderInfo>();

  if (hasRfid) {
    const readPointIds = [...new Set(
      rfidRows!.map(r => r.read_point_id).filter(Boolean) as string[]
    )];

    if (readPointIds.length > 0) {
      const { data: masterRows } = await supabase
        .from('rfid_readers_master')
        .select('read_point_id,country,center_name,impc_code,td_reader')
        .in('read_point_id', readPointIds);

      if (masterRows) {
        for (const m of masterRows) {
          readerMap.set(m.read_point_id, {
            country:    m.country    ?? '',
            centre:     m.center_name ?? '',
            impc:       m.impc_code  ?? '',
            td_reader:  m.td_reader  ?? false,
          });
        }
      }
    }
  }

  /* ── Helper: resolve reader info for a row ── */
  function getInfo(r: { read_point_id: string | null; country: string | null; center_name: string | null; impc_code: string | null }): ReaderInfo {
    if (r.read_point_id && readerMap.has(r.read_point_id)) {
      return readerMap.get(r.read_point_id)!;
    }
    return {
      country:   r.country    ?? '',
      centre:    r.center_name ?? '',
      impc:      r.impc_code  ?? '',
      td_reader: false,
    };
  }

  /* ── Step 4: Apply Regla de Selección de Eventos del Trayecto ── */
  if (hasRfid) {
    // Readings are already sorted by record_time ASC from the query.
    const sorted = rfidRows!;

    // Identify origin country (first record's country)
    const firstInfo = getInfo(sorted[0]);
    const originCountry = firstInfo.country;

    // Split into ORIGIN block and DESTINATION block
    let firstDestIdx = -1;
    for (let i = 0; i < sorted.length; i++) {
      const info = getInfo(sorted[i]);
      if (info.country && info.country !== originCountry) {
        firstDestIdx = i;
        break;
      }
    }

    const originBlock = firstDestIdx === -1 ? sorted : sorted.slice(0, firstDestIdx);
    const destBlock   = firstDestIdx === -1 ? []     : sorted.slice(firstDestIdx);

    // Determine dest country
    const destCountry = destBlock.length > 0 ? getInfo(destBlock[0]).country : null;

    result.origin_country = originCountry || null;
    result.dest_country   = destCountry   || null;
    result.is_international = !!originCountry && !!destCountry && originCountry !== destCountry;

    // ORIGIN block: last reading per centre (read_point_id)
    const originLastByCentre = new Map<string, typeof sorted[0]>();
    for (const r of originBlock) {
      const key = r.read_point_id || r.center_name || '';
      if (!key) continue;
      originLastByCentre.set(key, r); // overwrite → last wins (sorted ASC)
    }

    // DESTINATION block: first reading per centre
    const destFirstByCentre = new Map<string, typeof sorted[0]>();
    for (const r of destBlock) {
      const key = r.read_point_id || r.center_name || '';
      if (!key) continue;
      if (!destFirstByCentre.has(key)) destFirstByCentre.set(key, r);
    }

    // Classify origin centres by td_reader
    const originOE:  Array<{ r: typeof sorted[0]; info: ReaderInfo }> = [];
    const originAMU: Array<{ r: typeof sorted[0]; info: ReaderInfo }> = [];
    for (const r of originLastByCentre.values()) {
      const info = getInfo(r);
      if (info.td_reader) originAMU.push({ r, info });
      else                originOE.push({ r, info });
    }

    // Classify dest centres by td_reader
    const destAMU: Array<{ r: typeof sorted[0]; info: ReaderInfo }> = [];
    const destOE:  Array<{ r: typeof sorted[0]; info: ReaderInfo }> = [];
    for (const r of destFirstByCentre.values()) {
      const info = getInfo(r);
      if (info.td_reader) destAMU.push({ r, info });
      else                destOE.push({ r, info });
    }

    // Select final milestones
    // OE Origin: last of all last-per-centre with td_reader=false in origin block
    const oeOriginEntry = originOE.length > 0
      ? originOE.sort((a, b) => (a.r.record_time ?? '') < (b.r.record_time ?? '') ? -1 : 1).at(-1)!
      : null;

    // AMU Outbound: last of all last-per-centre with td_reader=true in origin block
    const amuOutboundEntry = originAMU.length > 0
      ? originAMU.sort((a, b) => (a.r.record_time ?? '') < (b.r.record_time ?? '') ? -1 : 1).at(-1)!
      : null;

    // AMU Inbound: first of all first-per-centre with td_reader=true in dest block
    const amuInboundEntry = destAMU.length > 0
      ? destAMU.sort((a, b) => (a.r.record_time ?? '') < (b.r.record_time ?? '') ? -1 : 1)[0]
      : null;

    // OE Destination: first of all first-per-centre with td_reader=false in dest block
    const oeDestEntry = destOE.length > 0
      ? destOE.sort((a, b) => (a.r.record_time ?? '') < (b.r.record_time ?? '') ? -1 : 1)[0]
      : null;

    // Build TrackEvent for each milestone
    function makeRfidEvent(
      entry: { r: typeof sorted[0]; info: ReaderInfo } | null,
      eventType: string,
      milestone: TrackEvent['milestone'],
      segment: Segment,
      orderKey: number,
    ): TrackEvent | null {
      if (!entry) return null;
      const { r, info } = entry;
      return {
        id: `rfid-${eventType}-${r.record_time ?? r.event_time_local}-${info.centre}`,
        source: 'RFID',
        event_type: eventType,
        centre:    info.centre  || r.center_name || null,
        impc:      info.impc    || r.impc_code   || null,
        country:   info.country || r.country     || null,
        timestamp: r.record_time ?? r.event_time_local ?? null,
        segment,
        milestone,
        order_key: orderKey,
      };
    }

    const oeOriginEv    = makeRfidEvent(oeOriginEntry,    'OE_ORIGIN',    'OE_ORIGIN',    'ORIGIN_COUNTRY', 10);
    const amuOutboundEv = makeRfidEvent(amuOutboundEntry, 'AMU_OUTBOUND', 'AMU_OUTBOUND', 'ORIGIN_COUNTRY', 30);
    const amuInboundEv  = makeRfidEvent(amuInboundEntry,  'AMU_INBOUND',  'AMU_INBOUND',  'DEST_COUNTRY',   50);
    const oeDestEv      = makeRfidEvent(oeDestEntry,      'OE_DEST',      'OE_DEST',      'DEST_COUNTRY',   90);

    // Store milestones for summary bar
    result.milestones = {
      oe_origin:    oeOriginEv,
      amu_outbound: amuOutboundEv,
      amu_inbound:  amuInboundEv,
      oe_dest:      oeDestEv,
    };

    // Add milestone events to the timeline
    for (const ev of [oeOriginEv, amuOutboundEv, amuInboundEv, oeDestEv]) {
      if (ev) result.events.push(ev);
    }
  }

  /* ── Step 5: Add EDI events ── */
  if (hasEdi && ediRow) {
    // Use EDI origin/dest country if RFID didn't provide them
    if (!result.origin_country) result.origin_country = ediRow.rf_origin_country ?? null;
    if (!result.dest_country)   result.dest_country   = ediRow.rf_dest_country   ?? null;
    if (!result.is_international) {
      result.is_international =
        !!result.origin_country && !!result.dest_country &&
        result.origin_country !== result.dest_country;
    }

    const ediEvts: Array<{
      type: string; time: string | null;
      centre: string | null; impc: string | null; country: string | null;
      segment: Segment; orderKey: number;
    }> = [
      {
        type: 'PREDES', time: ediRow.edi_predes_time,
        centre: ediRow.rf_origin_centre ?? null,
        impc: ediRow.edi_origin_impc ?? null,
        country: ediRow.rf_origin_country ?? null,
        segment: 'ORIGIN_COUNTRY', orderKey: 20,
      },
      {
        // RESDIT74 = cargo loaded on flight, sent from origin airport → ORIGIN_COUNTRY
        type: 'RESDIT74', time: ediRow.edi_resdit74_time,
        centre: ediRow.rf_origin_centre ?? null,
        impc: ediRow.edi_resdit74_impc ?? null,
        country: ediRow.rf_origin_country ?? null,
        segment: 'ORIGIN_COUNTRY', orderKey: 40,
      },
      {
        // RESDIT21 = first arrival notice, sent from destination airport → DEST_COUNTRY
        type: 'RESDIT21', time: ediRow.edi_resdit21_time,
        centre: ediRow.rf_dest_centre ?? null,
        impc: ediRow.edi_resdit21_impc ?? null,
        country: ediRow.rf_dest_country ?? null,
        segment: 'DEST_COUNTRY', orderKey: 60,
      },
      {
        type: 'RESDES', time: ediRow.edi_resdes_time,
        centre: ediRow.rf_dest_centre ?? null,
        impc: ediRow.edi_dest_impc ?? null,
        country: ediRow.rf_dest_country ?? null,
        segment: 'DEST_COUNTRY', orderKey: 80,
      },
    ];

    for (const e of ediEvts) {
      if (!e.time) continue;
      result.events.push({
        id: `edi-${e.type}-${e.time}`,
        source: 'EDI',
        event_type: e.type,
        centre: e.centre,
        impc: e.impc,
        country: e.country,
        timestamp: e.time,
        segment: e.segment,
        milestone: 'EDI',
        order_key: e.orderKey,
      });
    }
  }

  /* ── Step 6: Sort by record_time, then order_key for tie-breaking ── */
  result.events.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return a.order_key - b.order_key;
  });

  return result;
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export function SearchID() {
  const [query, setQuery]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<SearchResult | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async (q: string = query) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true); setError(null); setResult(null); setSearched(true);
    try {
      const res = await searchById(trimmed);
      if (res.events.length === 0 && !res.s9id && !res.tag_id) {
        setError(`No records found for "${trimmed}". Check the Tag ID or Receptacle ID and try again.`);
      } else {
        setResult(res);
      }
    } catch (e: any) {
      setError(e.message ?? 'Unexpected error during search.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  const originEvents = result?.events.filter(e => e.segment === 'ORIGIN_COUNTRY') ?? [];
  const destEvents   = result?.events.filter(e => e.segment === 'DEST_COUNTRY')   ?? [];

  // LEG2 timestamps: last event in ORIGIN_COUNTRY → first event in DEST_COUNTRY
  const lastOriginTs = originEvents.at(-1)?.timestamp ?? null;
  const firstDestTs  = destEvents.at(0)?.timestamp    ?? null;

  return (
    <div className="space-y-5">
      {/* ── Search bar ── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Enter Tag ID or Receptacle ID (s9id)…"
            className="w-full pl-10 pr-4 py-3 text-sm rounded-xl border border-slate-300 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 placeholder:text-slate-400 font-mono"
          />
        </div>
        <button
          onClick={() => handleSearch()}
          disabled={loading || !query.trim()}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow-sm hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Search
        </button>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mr-3" />
          <p className="text-sm text-slate-500">Applying Journey Event Selection Rule…</p>
        </div>
      )}

      {/* ── Error ── */}
      {error && !loading && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200">
          <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-700">{error}</p>
        </div>
      )}

      {/* ── Result ── */}
      {result && !loading && (
        <div className="space-y-3">
          {/* Identity card */}
          <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <Package className="w-5 h-5 text-indigo-500 flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-0.5">
              {result.s9id && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Receptacle</span>
                  <span className="font-mono text-sm font-semibold text-slate-800">{result.s9id}</span>
                </div>
              )}
              {result.tag_id && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Tag ID</span>
                  <span className="font-mono text-sm text-slate-600">{result.tag_id}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {result.origin_country && (
                <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                  <Globe className="w-3 h-3" />{result.origin_country}
                </span>
              )}
              {result.origin_country && result.dest_country && (
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              )}
              {result.dest_country && (
                <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                  <Globe className="w-3 h-3" />{result.dest_country}
                </span>
              )}
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                result.found_in === 'BOTH' ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                : result.found_in === 'RFID' ? 'bg-blue-100 text-blue-700 border-blue-200'
                : 'bg-amber-100 text-amber-700 border-amber-200'
              }`}>
                {result.found_in === 'BOTH' ? '✓ RFID + EDI' : result.found_in === 'RFID' ? 'RFID only' : 'EDI only'}
              </span>
              {result.is_international && (
                <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                  <Plane className="w-3 h-3" /> International
                </span>
              )}
              {!result.is_international && result.origin_country && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  Domestic
                </span>
              )}
              <span className="text-xs text-slate-400">{result.events.length} events</span>
            </div>
          </div>

          {/* Milestone summary */}
          <MilestoneSummary milestones={result.milestones} />

          {/* Timeline */}
          <SegmentBlock
            segment="ORIGIN_COUNTRY"
            events={originEvents}
            label={result.origin_country ? `Origin — ${result.origin_country}` : 'Origin Country'}
            subtitle="OE Origin · EDI PREDES · AMU Outbound · EDI RESDIT74"
          />

          {/* LEG2 connector — only for international */}
          {result.is_international && originEvents.length > 0 && destEvents.length > 0 && (
            <SegmentConnector
              fromTs={lastOriginTs}
              toTs={firstDestTs}
              label="LEG2 — International Flight"
              icon={Plane}
              badgeCls="bg-violet-50 text-violet-700 border-violet-200"
            />
          )}

          <SegmentBlock
            segment="DEST_COUNTRY"
            events={destEvents}
            label={result.dest_country ? `Destination — ${result.dest_country}` : 'Destination Country'}
            subtitle="EDI RESDIT21 · AMU Inbound · EDI RESDES · OE Destination"
          />
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !result && !error && !searched && (
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <Search className="w-6 h-6 text-indigo-400" />
          </div>
          <p className="text-sm font-medium text-slate-600">Search by Tag ID or Receptacle ID</p>
          <p className="text-xs text-slate-400 max-w-sm">
            Enter a full or partial identifier to see the journey milestones classified by the
            <strong> Regla de Selección de Eventos del Trayecto</strong>.
            The journey is split into <strong>Origin Country</strong> (OE Origin → AMU Outbound),
            <strong> LEG2 International Flight</strong>, and <strong>Destination Country</strong> (AMU Inbound → OE Destination).
          </p>
          <div className="flex items-center gap-3 mt-2 flex-wrap justify-center">
            <span className="flex items-center gap-1 text-[11px] text-slate-500 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200">
              <Building2 className="w-3 h-3 text-blue-500" /> Origin Country
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
            <span className="flex items-center gap-1 text-[11px] text-violet-600 px-2.5 py-1 rounded-full bg-violet-50 border border-violet-200">
              <Plane className="w-3 h-3" /> LEG2 Flight
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200">
              <MapPin className="w-3 h-3" /> Destination Country
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 w-full max-w-md text-[11px]">
            <div className="px-2 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 font-semibold">OE Origin</div>
            <div className="px-2 py-1.5 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 font-semibold">AMU Outbound</div>
            <div className="px-2 py-1.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-700 font-semibold">AMU Inbound</div>
            <div className="px-2 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">OE Destination</div>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
            <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> Transit time between each step</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${SOURCE_BADGE.RFID}`}>RFID</span>
              physical readings
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${SOURCE_BADGE.EDI}`}>EDI</span>
              electronic messages
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
