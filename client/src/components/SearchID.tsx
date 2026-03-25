/**
 * SearchID — Receptacle / Tag ID individual tracker
 *
 * Busca en los datos ya cargados en memoria por useEpcisData.
 * NO hace queries adicionales a Supabase.
 *
 * Lógica: aplica la "Regla de Selección de Eventos del Trayecto" sobre
 * las lecturas del tag_id buscado:
 *   1. Filtra allReadings por tag_id (campo principal) o s9id (complementario).
 *   2. Ordena por record_time ASC.
 *   3. Identifica cambio de país → Bloque Origen / Bloque Destino.
 *   4. Bloque Origen: última lectura por centro → OE Origin (td_reader=false) / AMU Outbound (td_reader=true).
 *   5. Bloque Destino: primera lectura por centro → AMU Inbound (td_reader=true) / OE Destination (td_reader=false).
 *   6. Leg2 = tiene AMU Outbound Y AMU Inbound.
 */

import React, { useState, useCallback } from 'react';
import type { RfidReading, RfidReaderMaster } from '@/lib/supabase';
import {
  Search, Package, Plane, MapPin,
  CheckCircle2, Clock, AlertCircle, Loader2, ArrowRight,
  Building2, Globe, ChevronDown, ChevronUp, Timer, LogOut, LogIn, Radio, FileText,
} from 'lucide-react';

/* ─── Types ──────────────────────────────────────────────────────────────── */

type Segment = 'ORIGIN_COUNTRY' | 'DEST_COUNTRY';

interface ReaderInfo {
  country: string;
  centre: string;
  impc: string;
  td_reader: boolean;
}

interface TrackEvent {
  id: string;
  event_type: string;
  centre: string | null;
  impc: string | null;
  country: string | null;
  timestamp: string | null;
  segment: Segment;
  milestone: 'OE_ORIGIN' | 'AMU_OUTBOUND' | 'AMU_INBOUND' | 'OE_DEST';
  order_key: number;
}

interface SearchResult {
  tag_id: string | null;
  s9id: string | null;
  events: TrackEvent[];
  origin_country: string | null;
  dest_country: string | null;
  is_international: boolean;
  total_readings: number;
  milestones: {
    oe_origin:    TrackEvent | null;
    amu_outbound: TrackEvent | null;
    amu_inbound:  TrackEvent | null;
    oe_dest:      TrackEvent | null;
  };
}

/* ─── Props ──────────────────────────────────────────────────────────────── */

interface SearchIDProps {
  allReadings: RfidReading[];
  readerMap: Map<string, RfidReaderMaster>;
  dataLoading?: boolean;
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

function milestoneLabel(m: TrackEvent['milestone']): string {
  const map: Record<TrackEvent['milestone'], string> = {
    OE_ORIGIN:    'OE Origin',
    AMU_OUTBOUND: 'AMU Outbound',
    AMU_INBOUND:  'AMU Inbound',
    OE_DEST:      'OE Destination',
  };
  return map[m];
}

/* ─── Segment styles ─────────────────────────────────────────────────────── */

const SEG_STYLE = {
  ORIGIN_COUNTRY: {
    bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-700', title: 'text-blue-700',
    headerBg: 'bg-blue-50', icon: Building2,
  },
  DEST_COUNTRY: {
    bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700', title: 'text-emerald-700',
    headerBg: 'bg-emerald-50', icon: Building2,
  },
} as const;

const MILESTONE_STYLE: Record<TrackEvent['milestone'], { badge: string; icon: React.ElementType }> = {
  OE_ORIGIN:    { badge: 'bg-blue-100 text-blue-700 border-blue-200',     icon: Radio },
  AMU_OUTBOUND: { badge: 'bg-orange-100 text-orange-700 border-orange-200', icon: LogOut },
  AMU_INBOUND:  { badge: 'bg-teal-100 text-teal-700 border-teal-200',     icon: LogIn },
  OE_DEST:      { badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
};

/* ─── Transit pill ───────────────────────────────────────────────────────── */

function TransitPill({ from, to }: { from: string | null; to: string | null }) {
  const label = diffLabel(from, to);
  if (!label) return null;
  return (
    <div className="flex items-center justify-center gap-1.5 py-0.5 px-2 my-1">
      <div className="h-px flex-1 bg-slate-200" />
      <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-slate-50 text-slate-500 border-slate-200">
        <Timer className="w-3 h-3" />{label}
      </div>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

/* ─── Single event card ──────────────────────────────────────────────────── */

function EventCard({ ev }: { ev: TrackEvent }) {
  const s = SEG_STYLE[ev.segment];
  const ms = MILESTONE_STYLE[ev.milestone];
  const Icon = ms.icon;
  return (
    <div className={`flex gap-3 px-4 py-3 rounded-xl border ${s.border} ${s.bg} hover:shadow-sm transition-all`}>
      <div className="flex-shrink-0 flex flex-col items-center gap-1.5 pt-0.5">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${ms.badge}`}>
          RFID
        </span>
        <div className={`w-2 h-2 rounded-full ${s.dot}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Icon className={`w-3.5 h-3.5 ${s.title}`} />
            <span className={`text-xs font-semibold ${s.title}`}>{milestoneLabel(ev.milestone)}</span>
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

function SegmentBlock({ segment, events, label, subtitle }: {
  segment: Segment; events: TrackEvent[]; label: string; subtitle?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const s = SEG_STYLE[segment];
  const Icon = s.icon;
  if (events.length === 0) return null;

  const dur = events.length >= 2 ? diffLabel(events[0].timestamp, events[events.length - 1].timestamp) : null;

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
            {events.length} milestone{events.length !== 1 ? 's' : ''}
          </span>
          {dur && (
            <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
              <Timer className="w-3 h-3" /> {dur}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className={`w-4 h-4 ${s.title}`} /> : <ChevronDown className={`w-4 h-4 ${s.title}`} />}
      </button>
      {expanded && (
        <div className="px-4 py-3 bg-white/60 space-y-0">
          {events.map((ev, idx) => (
            <React.Fragment key={ev.id}>
              {idx > 0 && <TransitPill from={events[idx - 1].timestamp} to={ev.timestamp} />}
              <EventCard ev={ev} />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Leg2 connector ─────────────────────────────────────────────────────── */

function Leg2Connector({ fromTs, toTs }: { fromTs: string | null; toTs: string | null }) {
  const dur = diffLabel(fromTs, toTs);
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="h-px flex-1 bg-violet-200" />
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold bg-violet-50 text-violet-700 border-violet-200">
        <Plane className="w-3.5 h-3.5" />
        LEG2 — International Flight
        {dur && <span className="flex items-center gap-1 ml-1 text-[11px]"><Timer className="w-3 h-3" /> {dur}</span>}
      </div>
      <div className="h-px flex-1 bg-violet-200" />
    </div>
  );
}

/* ─── Milestone summary bar ──────────────────────────────────────────────── */

function MilestoneSummary({ milestones }: { milestones: SearchResult['milestones'] }) {
  function MCard({ ev, label, cls }: { ev: TrackEvent | null; label: string; cls: string }) {
    return (
      <div className={`rounded-lg border p-2.5 flex-1 min-w-0 ${cls}`}>
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
    );
  }
  return (
    <div className="flex items-stretch gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 flex-wrap sm:flex-nowrap">
      <MCard ev={milestones.oe_origin}    label="OE Origin"      cls="bg-blue-50 border-blue-200 text-blue-700" />
      <MCard ev={milestones.amu_outbound} label="AMU Outbound"   cls="bg-orange-50 border-orange-200 text-orange-700" />
      {/* Plane icon between AMU Outbound and AMU Inbound */}
      <div className="flex flex-col items-center justify-center gap-0.5 flex-shrink-0 px-0.5">
        <div className="h-px w-5 bg-violet-300" />
        <Plane className="w-4 h-4 text-violet-500" />
        <div className="h-px w-5 bg-violet-300" />
      </div>
      <MCard ev={milestones.amu_inbound}  label="AMU Inbound"    cls="bg-teal-50 border-teal-200 text-teal-700" />
      <MCard ev={milestones.oe_dest}      label="OE Destination" cls="bg-emerald-50 border-emerald-200 text-emerald-700" />
    </div>
  );
}

/* ─── Core search function (in-memory) ──────────────────────────────────── */

function searchInMemory(
  q: string,
  allReadings: RfidReading[],
  readerMap: Map<string, RfidReaderMaster>,
): SearchResult {
  const result: SearchResult = {
    tag_id: null, s9id: null, events: [],
    origin_country: null, dest_country: null,
    is_international: false, total_readings: 0,
    milestones: { oe_origin: null, amu_outbound: null, amu_inbound: null, oe_dest: null },
  };

  // Filter readings: tag_id is primary, s9id is complementary
  const rows = allReadings.filter(r =>
    (r.tag_id && r.tag_id === q) ||
    (r.s9id   && r.s9id   === q)
  );

  if (rows.length === 0) return result;

  result.total_readings = rows.length;

  // Identify tag_id and s9id from the rows
  const firstRow = rows[0];
  result.tag_id = rows.find(r => r.tag_id)?.tag_id ?? null;
  result.s9id   = rows.find(r => r.s9id && r.s9id !== result.tag_id)?.s9id ?? null;

  // Sort by record_time ASC (fallback to event_time_local)
  const sorted = [...rows].sort((a, b) => {
    const ta = a.record_time || a.event_time_local || '';
    const tb = b.record_time || b.event_time_local || '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  // Helper: get reader info from master map or fallback to row fields
  function getInfo(r: RfidReading): ReaderInfo {
    if (r.read_point_id && readerMap.has(r.read_point_id)) {
      const m = readerMap.get(r.read_point_id)!;
      return {
        country:   m.country    ?? r.country    ?? '',
        centre:    m.center_name ?? r.center_name ?? '',
        impc:      m.impc_code  ?? r.impc_code   ?? '',
        td_reader: m.td_reader  ?? false,
      };
    }
    return {
      country:   r.country    ?? '',
      centre:    r.center_name ?? '',
      impc:      r.impc_code  ?? '',
      td_reader: false,
    };
  }

  // Identify origin country (first record's country)
  const originCountry = getInfo(sorted[0]).country;
  if (!originCountry) {
    // No country info — still show the tag with what we have
    result.tag_id = result.tag_id ?? firstRow.tag_id ?? q;
    return result;
  }

  // Split into ORIGIN block and DESTINATION block
  let firstDestIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    const c = getInfo(sorted[i]).country;
    if (c && c !== originCountry) { firstDestIdx = i; break; }
  }

  const originBlock = firstDestIdx === -1 ? sorted : sorted.slice(0, firstDestIdx);
  const destBlock   = firstDestIdx === -1 ? []     : sorted.slice(firstDestIdx);
  const destCountry = destBlock.length > 0 ? getInfo(destBlock[0]).country : null;

  result.origin_country  = originCountry || null;
  result.dest_country    = destCountry   || null;
  result.is_international = !!originCountry && !!destCountry && originCountry !== destCountry;

  // ORIGIN block: last reading per centre
  const originLastByCentre = new Map<string, RfidReading>();
  for (const r of originBlock) {
    const key = r.read_point_id || r.center_name || '';
    if (key) originLastByCentre.set(key, r);
  }

  // DESTINATION block: first reading per centre
  const destFirstByCentre = new Map<string, RfidReading>();
  for (const r of destBlock) {
    const key = r.read_point_id || r.center_name || '';
    if (key && !destFirstByCentre.has(key)) destFirstByCentre.set(key, r);
  }

  // Classify by td_reader
  const originOE:  Array<{ r: RfidReading; info: ReaderInfo }> = [];
  const originAMU: Array<{ r: RfidReading; info: ReaderInfo }> = [];
  for (const r of originLastByCentre.values()) {
    const info = getInfo(r);
    if (info.td_reader) originAMU.push({ r, info });
    else                originOE.push({ r, info });
  }

  const destAMU: Array<{ r: RfidReading; info: ReaderInfo }> = [];
  const destOE:  Array<{ r: RfidReading; info: ReaderInfo }> = [];
  for (const r of destFirstByCentre.values()) {
    const info = getInfo(r);
    if (info.td_reader) destAMU.push({ r, info });
    else                destOE.push({ r, info });
  }

  // Select final milestones
  const byTime = (a: { r: RfidReading }, b: { r: RfidReading }) =>
    (a.r.record_time ?? '') < (b.r.record_time ?? '') ? -1 : 1;

  const oeOriginEntry    = originOE.length  > 0 ? [...originOE].sort(byTime).at(-1)!  : null;
  const amuOutboundEntry = originAMU.length > 0 ? [...originAMU].sort(byTime).at(-1)! : null;
  const amuInboundEntry  = destAMU.length   > 0 ? [...destAMU].sort(byTime)[0]        : null;
  const oeDestEntry      = destOE.length    > 0 ? [...destOE].sort(byTime)[0]         : null;

  // Build TrackEvent for each milestone
  function makeEvent(
    entry: { r: RfidReading; info: ReaderInfo } | null,
    milestone: TrackEvent['milestone'],
    segment: Segment,
    orderKey: number,
  ): TrackEvent | null {
    if (!entry) return null;
    const { r, info } = entry;
    return {
      id: `${milestone}-${r.record_time ?? r.event_time_local}-${info.centre}`,
      event_type: milestone,
      centre:    info.centre  || r.center_name || null,
      impc:      info.impc    || r.impc_code   || null,
      country:   info.country || r.country     || null,
      timestamp: r.record_time ?? r.event_time_local ?? null,
      segment,
      milestone,
      order_key: orderKey,
    };
  }

  const oeOriginEv    = makeEvent(oeOriginEntry,    'OE_ORIGIN',    'ORIGIN_COUNTRY', 10);
  const amuOutboundEv = makeEvent(amuOutboundEntry, 'AMU_OUTBOUND', 'ORIGIN_COUNTRY', 30);
  const amuInboundEv  = makeEvent(amuInboundEntry,  'AMU_INBOUND',  'DEST_COUNTRY',   50);
  const oeDestEv      = makeEvent(oeDestEntry,      'OE_DEST',      'DEST_COUNTRY',   90);

  result.milestones = {
    oe_origin:    oeOriginEv,
    amu_outbound: amuOutboundEv,
    amu_inbound:  amuInboundEv,
    oe_dest:      oeDestEv,
  };

  for (const ev of [oeOriginEv, amuOutboundEv, amuInboundEv, oeDestEv]) {
    if (ev) result.events.push(ev);
  }

  // Sort by timestamp then order_key
  result.events.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta !== tb ? ta - tb : a.order_key - b.order_key;
  });

  return result;
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export function SearchID({ allReadings, readerMap, dataLoading }: SearchIDProps) {
  const [query, setQuery]       = useState('');
  const [result, setResult]     = useState<SearchResult | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback((q: string = query) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setError(null); setResult(null); setSearched(true);

    const res = searchInMemory(trimmed, allReadings, readerMap);

    if (res.total_readings === 0) {
      if (dataLoading) {
        setError(`Data is still loading. Try again in a moment or wait for the background load to complete.`);
      } else {
        setError(`No records found for "${trimmed}". Check the Tag ID and try again.`);
      }
    } else {
      setResult(res);
    }
  }, [query, allReadings, readerMap, dataLoading]);

  const originEvents = result?.events.filter(e => e.segment === 'ORIGIN_COUNTRY') ?? [];
  const destEvents   = result?.events.filter(e => e.segment === 'DEST_COUNTRY')   ?? [];
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
            placeholder="Enter Tag ID…"
            className="w-full pl-10 pr-4 py-3 text-sm rounded-xl border border-slate-300 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 placeholder:text-slate-400 font-mono"
          />
        </div>
        <button
          onClick={() => handleSearch()}
          disabled={!query.trim() || dataLoading}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow-sm hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Search className="w-4 h-4" />
          Search
        </button>
      </div>

      {/* ── Data loading notice ── */}
      {dataLoading && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
          Background data still loading — search covers data loaded so far.
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200">
          <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-700">{error}</p>
        </div>
      )}

      {/* ── Result ── */}
      {result && (
        <div className="space-y-3">
          {/* Identity card */}
          <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <Package className="w-5 h-5 text-indigo-500 flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-0.5">
              {result.tag_id && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Tag ID</span>
                  <span className="font-mono text-sm font-semibold text-slate-800">{result.tag_id}</span>
                </div>
              )}
              {result.s9id && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Receptacle</span>
                  <span className="font-mono text-sm text-slate-600">{result.s9id}</span>
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
              <span className="text-xs text-slate-400">{result.total_readings} readings</span>
            </div>
          </div>

          {/* Milestone summary */}
          <MilestoneSummary milestones={result.milestones} />

          {/* Timeline */}
          <SegmentBlock
            segment="ORIGIN_COUNTRY"
            events={originEvents}
            label={result.origin_country ? `Origin — ${result.origin_country}` : 'Origin Country'}
            subtitle="OE Origin · AMU Outbound"
          />

          {result.is_international && originEvents.length > 0 && destEvents.length > 0 && (
            <Leg2Connector fromTs={lastOriginTs} toTs={firstDestTs} />
          )}

          <SegmentBlock
            segment="DEST_COUNTRY"
            events={destEvents}
            label={result.dest_country ? `Destination — ${result.dest_country}` : 'Destination Country'}
            subtitle="AMU Inbound · OE Destination"
          />
        </div>
      )}

      {/* ── Empty state ── */}
      {!result && !error && !searched && (
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <Search className="w-6 h-6 text-indigo-400" />
          </div>
          <p className="text-sm font-medium text-slate-600">Search by Tag ID</p>
          <p className="text-xs text-slate-400 max-w-sm">
            Enter the exact Tag ID to see its journey milestones classified by the
            <strong> Regla de Selección de Eventos del Trayecto</strong>.
            Searches the data already loaded in memory — no additional download required.
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
        </div>
      )}
    </div>
  );
}
