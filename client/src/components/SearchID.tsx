/**
 * SearchID — Receptacle / Tag ID individual tracker
 *
 * Lógica de segmentación (corregida v3.11):
 *
 *  ORIGIN COUNTRY (país de origen)
 *    1. RFID ORIGIN  — última lectura en el centro de origen (event_type = ORIGIN)
 *    2. EDI PREDES   — declaración de salida del país (si existe)
 *    3. RFID OUTBOUND (DEPARTURE) — lectura física en frontera de salida
 *    4. EDI RESDIT74 — confirmación de carga en vuelo (aeropuerto origen)
 *                      ← ÚLTIMO evento antes de LEG2
 *
 *  LEG2 — International Flight
 *    • Empieza después de RESDIT74 (o DEPARTURE si no hay RESDIT74)
 *    • Termina en el primer evento de destino
 *
 *  DESTINATION COUNTRY (país de destino)
 *    5. EDI RESDIT21  — primer aviso de llegada (aeropuerto destino)
 *    6. RFID INBOUND (ARRIVAL) — lectura física en frontera de entrada
 *    7. EDI RESDES    — declaración de recepción (si existe)
 *    8. RFID DESTINATION — primera lectura en el centro de destino
 *
 * Criterio de país: se usa el campo `country` de la tabla RFID.
 * El país de origen = país del evento ORIGIN (o DEPARTURE si no hay ORIGIN).
 * El país de destino = país del evento DESTINATION (o ARRIVAL si no hay DESTINATION).
 * Movimientos internacionales: origen_country ≠ dest_country.
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

interface TrackEvent {
  id: string;
  source: 'RFID' | 'EDI';
  event_type: string;
  centre: string | null;
  impc: string | null;
  country: string | null;
  timestamp: string | null;
  segment: Segment;
  is_boundary: boolean;
  order_key: number; // for deterministic sort within same timestamp
}

interface SearchResult {
  s9id: string | null;
  tag_id: string | null;
  events: TrackEvent[];
  origin_country: string | null;
  dest_country: string | null;
  found_in: 'RFID' | 'EDI' | 'BOTH' | null;
  is_international: boolean;
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
    ORIGIN:      'Origin — first read',
    DESTINATION: 'Destination — last read',
    DEPARTURE:   'RFID Outbound',
    ARRIVAL:     'RFID Inbound',
    PREDES:      'EDI PREDES',
    RESDES:      'EDI RESDES',
    RESDIT74:    'EDI RESDIT74',
    RESDIT21:    'EDI RESDIT21',
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

/* ─── Event type icon ────────────────────────────────────────────────────── */
function EventIcon({ type, className }: { type: string; className?: string }) {
  const map: Record<string, React.ReactNode> = {
    ORIGIN:      <Radio className={className} />,
    DESTINATION: <CheckCircle2 className={className} />,
    DEPARTURE:   <LogOut className={className} />,
    ARRIVAL:     <LogIn className={className} />,
    PREDES:      <FileText className={className} />,
    RESDES:      <FileText className={className} />,
    RESDIT74:    <FileText className={className} />,
    RESDIT21:    <FileText className={className} />,
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
            {ev.is_boundary && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700 border border-violet-200">
                ✈ Border
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
  label: string; icon: React.FC<{ className?: string }>;
  badgeCls: string;
}) {
  const lbl = diffLabel(fromTs, toTs);
  return (
    <div className="flex items-center justify-center gap-2 py-1">
      <div className="h-px flex-1 bg-gradient-to-r from-slate-200 to-slate-200" />
      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${badgeCls}`}>
        <Icon className="w-3.5 h-3.5" />
        <span className="text-xs font-semibold">{label}</span>
        {lbl && (
          <>
            <span className="text-[10px] opacity-60 mx-0.5">·</span>
            <Timer className="w-3 h-3 opacity-70" />
            <span className="text-xs font-bold">{lbl}</span>
          </>
        )}
      </div>
      <div className="h-px flex-1 bg-gradient-to-r from-slate-200 to-slate-200" />
    </div>
  );
}

/* ─── Data fetching & classification ─────────────────────────────────────── */
async function searchById(query: string): Promise<SearchResult> {
  const q = query.trim();
  const result: SearchResult = {
    s9id: null, tag_id: null, events: [], origin_country: null,
    dest_country: null, found_in: null, is_international: false,
  };

  /* Fetch RFID rows and EDI row in parallel */
  const [{ data: rfidRows, error: rfidErr }, { data: ediRows, error: ediErr }] = await Promise.all([
    supabase
      .from('RFID')
      .select('tag_id,s9id,event_type,center_name,impc_code,country,event_time_local,is_international_boundary')
      .or(`tag_id.ilike.%${q}%,s9id.ilike.%${q}%`)
      .order('event_time_local', { ascending: true })
      .limit(500),
    supabase
      .from('benchmark_rfid_edi')
      .select('s9id,tag_id,edi_origin_impc,edi_dest_impc,edi_predes_time,edi_resdes_time,edi_resdit74_time,edi_resdit74_impc,edi_resdit21_time,edi_resdit21_impc,rf_origin_country,rf_origin_centre,rf_origin_impc,rf_dest_country,rf_dest_centre,rf_dest_impc')
      .or(`s9id.ilike.%${q}%,tag_id.ilike.%${q}%`)
      .limit(10),
  ]);

  if (rfidErr) console.warn('RFID search error:', rfidErr.message);
  if (ediErr)  console.warn('EDI search error:',  ediErr.message);

  const hasRfid = rfidRows && rfidRows.length > 0;
  const hasEdi  = ediRows  && ediRows.length > 0;
  if (!hasRfid && !hasEdi) return result;

  const ediRow  = ediRows?.[0];
  const rfidRow = rfidRows?.[0];

  result.s9id     = ediRow?.s9id     ?? rfidRow?.s9id   ?? null;
  result.tag_id   = ediRow?.tag_id   ?? rfidRow?.tag_id ?? null;
  result.found_in = hasRfid && hasEdi ? 'BOTH' : hasRfid ? 'RFID' : 'EDI';

  /* ── Determine origin / destination country ────────────────────────────
   * Priority: EDI row > RFID event_type ORIGIN country > RFID DEPARTURE country
   * Destination: EDI row > RFID DESTINATION country > RFID ARRIVAL country
   */
  const rfidOriginRow      = rfidRows?.find(r => r.event_type === 'ORIGIN');
  const rfidDepartureRow   = rfidRows?.find(r => r.event_type === 'DEPARTURE');
  const rfidArrivalRow     = rfidRows?.find(r => r.event_type === 'ARRIVAL');
  const rfidDestinationRow = rfidRows?.find(r => r.event_type === 'DESTINATION');

  result.origin_country =
    ediRow?.rf_origin_country ??
    rfidOriginRow?.country ??
    rfidDepartureRow?.country ??
    null;

  result.dest_country =
    ediRow?.rf_dest_country ??
    rfidDestinationRow?.country ??
    rfidArrivalRow?.country ??
    null;

  result.is_international =
    !!result.origin_country &&
    !!result.dest_country &&
    result.origin_country !== result.dest_country;

  /* ── Classify RFID events ──────────────────────────────────────────────
   *
   * ORIGIN_COUNTRY segment:
   *   • event_type = ORIGIN  → always ORIGIN_COUNTRY
   *   • event_type = DEPARTURE → ORIGIN_COUNTRY (it's the outbound border read)
   *
   * LEG2 segment: no RFID events live here directly;
   *   the LEG2 block is purely EDI (PREDES is pre-departure, so it goes in ORIGIN_COUNTRY)
   *
   * DEST_COUNTRY segment:
   *   • event_type = ARRIVAL     → DEST_COUNTRY (inbound border read)
   *   • event_type = DESTINATION → DEST_COUNTRY
   *
   * For non-international (same country): all events go to ORIGIN_COUNTRY.
   */
  if (hasRfid) {
    for (const r of rfidRows!) {
      const et = r.event_type ?? 'UNKNOWN';
      let segment: Segment = 'ORIGIN_COUNTRY';
      let orderKey = 0;

      if (result.is_international) {
        if (et === 'ORIGIN') {
          segment = 'ORIGIN_COUNTRY'; orderKey = 10;
        } else if (et === 'DEPARTURE') {
          // DEPARTURE = RFID Outbound, occurs at origin airport before RESDIT74
          segment = 'ORIGIN_COUNTRY'; orderKey = 30; // after PREDES (20), before RESDIT74 (40)
        } else if (et === 'ARRIVAL') {
          // ARRIVAL = RFID Inbound, first physical read at destination
          segment = 'DEST_COUNTRY'; orderKey = 50; // before RESDIT21 (60)
        } else if (et === 'DESTINATION') {
          // DESTINATION = last read at destination centre
          segment = 'DEST_COUNTRY'; orderKey = 90;
        } else if (et === 'INTERMEDIATE') {
          // INTERMEDIATE = intermediate read, classify by country
          const evCountry = r.country ?? null;
          if (evCountry && evCountry === result.dest_country) {
            segment = 'DEST_COUNTRY'; orderKey = 70;
          } else {
            segment = 'ORIGIN_COUNTRY'; orderKey = 35;
          }
        }
      }

      result.events.push({
        id: `rfid-${et}-${r.event_time_local}-${r.center_name}`,
        source: 'RFID',
        event_type: et,
        centre: r.center_name ?? null,
        impc: r.impc_code ?? null,
        country: r.country ?? null,
        timestamp: r.event_time_local ?? null,
        segment,
        is_boundary: r.is_international_boundary ?? false,
        order_key: orderKey,
      });
    }
  }

  /* ── Classify EDI events ───────────────────────────────────────────────
   *
   * Correct order within the journey (v3.11):
   *   ORIGIN_COUNTRY:  PREDES (20), RESDIT74 (40)  ← RESDIT74 is at origin airport
   *   DEST_COUNTRY:    RESDIT21 (60), RESDES (80)
   *
   * RESDIT74 = confirmation that cargo is loaded on the flight (sent from origin airport).
   * It is the LAST event before LEG2, NOT the first event at destination.
   *
   * LEG2 is the gap between last ORIGIN_COUNTRY event and first DEST_COUNTRY event.
   * No EDI event is classified as LEG2 — LEG2 is a visual connector only.
   */
  if (hasEdi && ediRow) {
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
        is_boundary: false,
        order_key: e.orderKey,
      });
    }
  }

  /* ── Sort: strictly by timestamp (Date), then by order_key for same-ms tie-breaking ── */
  result.events.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    if (ta !== tb) return ta - tb;          // primary: chronological order
    return a.order_key - b.order_key;       // secondary: logical event order within same ms
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

  // Events are already sorted chronologically from searchById();
  // filter preserves that order.
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
          <p className="text-sm text-slate-500">Searching RFID and EDI records…</p>
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

          {/* Timeline */}
          <SegmentBlock
            segment="ORIGIN_COUNTRY"
            events={originEvents}
            label={result.origin_country ? `Origin — ${result.origin_country}` : 'Origin Country'}
            subtitle="RFID Origin · EDI PREDES · RFID Outbound · EDI RESDIT74"
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
            subtitle="EDI RESDIT21 · RFID Inbound · EDI RESDES · RFID Destination"
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
            Enter a full or partial identifier to see all RFID readings and EDI messages, ordered by timestamp.
            The journey is split into <strong>Origin Country</strong> (RFID Origin → PREDES → RFID Outbound → RESDIT74),
            <strong> LEG2 International Flight</strong>, and <strong>Destination Country</strong> (RESDIT21 → RFID Inbound → RESDES → RFID Destination).
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
