/**
 * TagTrackPage — Standalone tag tracking page.
 *
 * Opened in a new browser tab by the "Track" button in RouteDetailPage's outlier table.
 * Reads { tag_id, s9id } from localStorage key "tag_track_payload",
 * then fetches RFID readings for that specific tag from Supabase and renders
 * the same journey milestones as the SearchID component.
 *
 * Does NOT require authentication — uses the anon key directly.
 */

import { useEffect, useState, useMemo } from 'react';
import {
  Package, Plane, Globe, ArrowRight, Building2, Timer,
  LogOut, LogIn, Radio, CheckCircle2, ChevronDown, ChevronUp, AlertCircle,
} from 'lucide-react';

/* ─── Supabase config ────────────────────────────────────────────────────── */
const SUPABASE_URL      = 'https://ewyhmmixqcubqokphebh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3eWhtbWl4cWN1YnFva3BoZWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTc3MjMsImV4cCI6MjA4ODU3MzcyM30.xMtcrn12c9r0Q_Q0e46Ptsci7Y31YnB5V9MSBHgj20k';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface RfidRow {
  tag_id: string | null;
  s9id: string | null;
  event_type: string | null;
  location: string | null;
  impc_code: string | null;
  event_time_local: string | null;
  record_time: string | null;
  country: string | null;
  center_name: string | null;
  read_point_id: string | null;
  status: string | null;
}

interface ReaderMaster {
  read_point_id: string;
  impc_code: string | null;
  country: string | null;
  center_name: string | null;
  td_reader: boolean | null;
}

type Segment = 'ORIGIN_COUNTRY' | 'DEST_COUNTRY';
type Milestone = 'OE_ORIGIN' | 'AMU_OUTBOUND' | 'AMU_INBOUND' | 'OE_DEST';

interface TrackEvent {
  id: string;
  milestone: Milestone;
  segment: Segment;
  centre: string | null;
  impc: string | null;
  country: string | null;
  timestamp: string | null;
  order_key: number;
}

interface JourneyResult {
  tag_id: string | null;
  s9id: string | null;
  origin_country: string | null;
  dest_country: string | null;
  is_international: boolean;
  total_readings: number;
  events: TrackEvent[];
  milestones: { oe_origin: TrackEvent | null; amu_outbound: TrackEvent | null; amu_inbound: TrackEvent | null; oe_dest: TrackEvent | null };
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function fmtTs(ts: string | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-GB', {
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

/* ─── Fetch helpers ──────────────────────────────────────────────────────── */
async function fetchTagReadings(tagId: string, s9id: string | null): Promise<RfidRow[]> {
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };

  const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent('RFID')}`);
  url.searchParams.set('select', 'tag_id,s9id,event_type,location,impc_code,event_time_local,record_time,country,center_name,read_point_id,status');
  url.searchParams.set('order', 'event_time_local.asc');

  // Build OR filter: tag_id = X or s9id = X
  const orParts = [`tag_id.eq.${tagId}`];
  if (s9id && s9id !== tagId) orParts.push(`s9id.eq.${s9id}`);
  url.searchParams.set('or', `(${orParts.join(',')})`);

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json();
}

async function fetchReadersMaster(): Promise<Map<string, ReaderMaster>> {
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
  const url = new URL(`${SUPABASE_URL}/rest/v1/rfid_readers_master`);
  url.searchParams.set('select', 'read_point_id,impc_code,country,center_name,td_reader');
  url.searchParams.set('limit', '5000');
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) return new Map();
  const rows: ReaderMaster[] = await res.json();
  const map = new Map<string, ReaderMaster>();
  for (const r of rows) map.set(r.read_point_id, r);
  return map;
}

/* ─── Journey builder (mirrors SearchID logic) ───────────────────────────── */
function buildJourney(rows: RfidRow[], readerMap: Map<string, ReaderMaster>): JourneyResult {
  const result: JourneyResult = {
    tag_id: null, s9id: null,
    origin_country: null, dest_country: null,
    is_international: false, total_readings: rows.length,
    events: [],
    milestones: { oe_origin: null, amu_outbound: null, amu_inbound: null, oe_dest: null },
  };

  if (!rows.length) return result;

  result.tag_id = rows.find(r => r.tag_id)?.tag_id ?? null;
  result.s9id   = rows.find(r => r.s9id && r.s9id !== result.tag_id)?.s9id ?? null;

  const sorted = [...rows].sort((a, b) => {
    const ta = a.record_time || a.event_time_local || '';
    const tb = b.record_time || b.event_time_local || '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  function getInfo(r: RfidRow) {
    if (r.read_point_id && readerMap.has(r.read_point_id)) {
      const m = readerMap.get(r.read_point_id)!;
      return { country: m.country ?? r.country ?? '', centre: m.center_name ?? r.center_name ?? '', impc: m.impc_code ?? r.impc_code ?? '', td_reader: m.td_reader ?? false };
    }
    return { country: r.country ?? '', centre: r.center_name ?? '', impc: r.impc_code ?? '', td_reader: false };
  }

  const originCountry = getInfo(sorted[0]).country;
  if (!originCountry) return result;

  let firstDestIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    const c = getInfo(sorted[i]).country;
    if (c && c !== originCountry) { firstDestIdx = i; break; }
  }

  const originBlock = firstDestIdx === -1 ? sorted : sorted.slice(0, firstDestIdx);
  const destBlock   = firstDestIdx === -1 ? []     : sorted.slice(firstDestIdx);
  const destCountry = destBlock.length > 0 ? getInfo(destBlock[0]).country : null;

  result.origin_country = originCountry || null;
  result.dest_country   = destCountry   || null;
  result.is_international = !!originCountry && !!destCountry && originCountry !== destCountry;

  // Last per centre in origin block
  const originLastByCentre = new Map<string, RfidRow>();
  for (const r of originBlock) {
    const key = r.read_point_id || r.center_name || '';
    if (key) originLastByCentre.set(key, r);
  }
  // First per centre in dest block
  const destFirstByCentre = new Map<string, RfidRow>();
  for (const r of destBlock) {
    const key = r.read_point_id || r.center_name || '';
    if (key && !destFirstByCentre.has(key)) destFirstByCentre.set(key, r);
  }

  const originOE:  { r: RfidRow; info: ReturnType<typeof getInfo> }[] = [];
  const originAMU: { r: RfidRow; info: ReturnType<typeof getInfo> }[] = [];
  for (const r of originLastByCentre.values()) {
    const info = getInfo(r);
    if (info.td_reader) originAMU.push({ r, info });
    else originOE.push({ r, info });
  }
  const destAMU: { r: RfidRow; info: ReturnType<typeof getInfo> }[] = [];
  const destOE:  { r: RfidRow; info: ReturnType<typeof getInfo> }[] = [];
  for (const r of destFirstByCentre.values()) {
    const info = getInfo(r);
    if (info.td_reader) destAMU.push({ r, info });
    else destOE.push({ r, info });
  }

  const byTime = (a: { r: RfidRow }, b: { r: RfidRow }) =>
    (a.r.record_time ?? '') < (b.r.record_time ?? '') ? -1 : 1;

  function makeEv(entry: { r: RfidRow; info: ReturnType<typeof getInfo> } | null, milestone: Milestone, segment: Segment, orderKey: number): TrackEvent | null {
    if (!entry) return null;
    const { r, info } = entry;
    return {
      id: `${milestone}-${r.record_time}-${info.centre}`,
      milestone, segment, order_key: orderKey,
      centre: info.centre || r.center_name || null,
      impc:   info.impc   || r.impc_code   || null,
      country: info.country || r.country   || null,
      timestamp: r.record_time ?? r.event_time_local ?? null,
    };
  }

  const oeOriginEv    = makeEv(originOE.length  > 0 ? [...originOE].sort(byTime).at(-1)!  : null, 'OE_ORIGIN',    'ORIGIN_COUNTRY', 10);
  const amuOutboundEv = makeEv(originAMU.length > 0 ? [...originAMU].sort(byTime).at(-1)! : null, 'AMU_OUTBOUND', 'ORIGIN_COUNTRY', 30);
  const amuInboundEv  = makeEv(destAMU.length   > 0 ? [...destAMU].sort(byTime)[0]        : null, 'AMU_INBOUND',  'DEST_COUNTRY',   50);
  const oeDestEv      = makeEv(destOE.length    > 0 ? [...destOE].sort(byTime)[0]         : null, 'OE_DEST',      'DEST_COUNTRY',   90);

  result.milestones = { oe_origin: oeOriginEv, amu_outbound: amuOutboundEv, amu_inbound: amuInboundEv, oe_dest: oeDestEv };

  for (const ev of [oeOriginEv, amuOutboundEv, amuInboundEv, oeDestEv]) {
    if (ev) result.events.push(ev);
  }
  result.events.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta !== tb ? ta - tb : a.order_key - b.order_key;
  });

  return result;
}

/* ─── UI sub-components ──────────────────────────────────────────────────── */

const SEG_STYLE = {
  ORIGIN_COUNTRY: { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700', title: 'text-blue-700', headerBg: 'bg-blue-50' },
  DEST_COUNTRY:   { bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', title: 'text-emerald-700', headerBg: 'bg-emerald-50' },
} as const;

const MILESTONE_STYLE: Record<Milestone, { badge: string; Icon: any }> = {
  OE_ORIGIN:    { badge: 'bg-blue-100 text-blue-700 border-blue-200',       Icon: Radio },
  AMU_OUTBOUND: { badge: 'bg-orange-100 text-orange-700 border-orange-200', Icon: LogOut },
  AMU_INBOUND:  { badge: 'bg-teal-100 text-teal-700 border-teal-200',       Icon: LogIn },
  OE_DEST:      { badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
};

const MILESTONE_LABEL: Record<Milestone, string> = {
  OE_ORIGIN: 'OE Origin', AMU_OUTBOUND: 'AMU Outbound', AMU_INBOUND: 'AMU Inbound', OE_DEST: 'OE Destination',
};

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

function EventCard({ ev }: { ev: TrackEvent }) {
  const s = SEG_STYLE[ev.segment];
  const ms = MILESTONE_STYLE[ev.milestone];
  const Icon = ms.Icon;
  return (
    <div className={`flex gap-3 px-4 py-3 rounded-xl border ${s.border} ${s.bg} hover:shadow-sm transition-all`}>
      <div className="flex-shrink-0 flex flex-col items-center gap-1.5 pt-0.5">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${ms.badge}`}>RFID</span>
        <div className={`w-2 h-2 rounded-full ${s.dot}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Icon className={`w-3.5 h-3.5 ${s.title}`} />
            <span className={`text-xs font-semibold ${s.title}`}>{MILESTONE_LABEL[ev.milestone]}</span>
          </div>
          <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">{fmtTs(ev.timestamp)}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
          {ev.centre  && <span className="text-xs text-slate-700 flex items-center gap-1"><Building2 className="w-3 h-3 text-slate-400" />{ev.centre}</span>}
          {ev.impc    && <span className="text-xs font-mono text-slate-500 flex items-center gap-1"><Globe className="w-3 h-3 text-slate-400" />{ev.impc}</span>}
          {ev.country && <span className="text-xs text-slate-400">{ev.country}</span>}
        </div>
      </div>
    </div>
  );
}

function SegmentBlock({ segment, events, label, subtitle }: { segment: Segment; events: TrackEvent[]; label: string; subtitle?: string }) {
  const [expanded, setExpanded] = useState(true);
  const s = SEG_STYLE[segment];
  if (!events.length) return null;
  const dur = events.length >= 2 ? diffLabel(events[0].timestamp, events[events.length - 1].timestamp) : null;
  return (
    <div className={`rounded-2xl border-2 ${s.border} overflow-hidden`}>
      <button onClick={() => setExpanded(e => !e)} className={`w-full flex items-center justify-between px-5 py-3 ${s.headerBg} hover:brightness-95 transition-all`}>
        <div className="flex items-center gap-2 flex-wrap">
          <Building2 className={`w-4 h-4 ${s.title}`} />
          <span className={`font-bold text-sm ${s.title}`}>{label}</span>
          {subtitle && <span className="text-xs text-slate-500 font-normal">{subtitle}</span>}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>{events.length} milestone{events.length !== 1 ? 's' : ''}</span>
          {dur && <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200"><Timer className="w-3 h-3" /> {dur}</span>}
        </div>
        {expanded ? <ChevronUp className={`w-4 h-4 ${s.title}`} /> : <ChevronDown className={`w-4 h-4 ${s.title}`} />}
      </button>
      {expanded && (
        <div className="px-4 py-3 bg-white/60 space-y-0">
          {events.map((ev, idx) => (
            <div key={ev.id}>
              {idx > 0 && <TransitPill from={events[idx - 1].timestamp} to={ev.timestamp} />}
              <EventCard ev={ev} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MilestoneSummary({ milestones }: { milestones: JourneyResult['milestones'] }) {
  function MCard({ ev, label, cls }: { ev: TrackEvent | null; label: string; cls: string }) {
    return (
      <div className={`rounded-lg border p-2.5 flex-1 min-w-0 ${cls}`}>
        <div className="text-[10px] font-bold uppercase tracking-wide opacity-70 mb-1">{label}</div>
        {ev ? (
          <>
            <div className="text-xs font-semibold truncate">{ev.centre ?? '—'}</div>
            <div className="text-[11px] font-mono opacity-70 mt-0.5">{fmtTs(ev.timestamp)}</div>
          </>
        ) : <div className="text-xs opacity-50 italic">Not detected</div>}
      </div>
    );
  }
  return (
    <div className="flex items-stretch gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 flex-wrap sm:flex-nowrap">
      <MCard ev={milestones.oe_origin}    label="OE Origin"      cls="bg-blue-50 border-blue-200 text-blue-700" />
      <MCard ev={milestones.amu_outbound} label="AMU Outbound"   cls="bg-orange-50 border-orange-200 text-orange-700" />
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

/* ─── Main component ─────────────────────────────────────────────────────── */
export default function TagTrackPage() {
  const [tagId, setTagId] = useState<string | null>(null);
  const [s9id, setS9id]   = useState<string | null>(null);
  const [rows, setRows]   = useState<RfidRow[]>([]);
  const [readerMap, setReaderMap] = useState<Map<string, ReaderMaster>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('tag_track_payload');
      if (!raw) { setError('No tag data found. Open this page from the outlier table.'); setLoading(false); return; }
      const { tag_id, s9id: sid } = JSON.parse(raw) as { tag_id: string; s9id: string | null };
      setTagId(tag_id);
      setS9id(sid);
      document.title = `Tag Track: ${tag_id}`;

      Promise.all([
        fetchTagReadings(tag_id, sid),
        fetchReadersMaster(),
      ]).then(([readings, rmap]) => {
        setRows(readings);
        setReaderMap(rmap);
        setLoading(false);
      }).catch(e => {
        setError(`Failed to load data: ${e.message}`);
        setLoading(false);
      });
    } catch {
      setError('Failed to parse tag data.');
      setLoading(false);
    }
  }, []);

  const journey = useMemo(() => {
    if (!rows.length) return null;
    return buildJourney(rows, readerMap);
  }, [rows, readerMap]);

  const originEvents = journey?.events.filter(e => e.segment === 'ORIGIN_COUNTRY') ?? [];
  const destEvents   = journey?.events.filter(e => e.segment === 'DEST_COUNTRY')   ?? [];
  const lastOriginTs = originEvents.at(-1)?.timestamp ?? null;
  const firstDestTs  = destEvents.at(0)?.timestamp    ?? null;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
        <svg className="animate-spin w-8 h-8 text-indigo-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-slate-500">Loading tag data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white rounded-xl border border-red-200 p-8 max-w-md text-center shadow">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <p className="text-red-600 font-semibold mb-2">Unable to load tag data</p>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-8 py-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-0.5">RFID Tag Tracking</p>
          <h1 className="text-xl font-bold text-slate-900 font-mono">{tagId}</h1>
          {s9id && s9id !== tagId && (
            <p className="text-xs text-slate-500 mt-0.5">Receptacle: <span className="font-mono font-medium">{s9id}</span></p>
          )}
          <p className="text-xs text-slate-400 mt-0.5">{rows.length} RFID readings</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-8 py-8 space-y-4">
        {journey && journey.total_readings > 0 ? (
          <>
            {/* Identity card */}
            <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <Package className="w-5 h-5 text-indigo-500 flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-0.5">
                {journey.tag_id && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Tag ID</span>
                    <span className="font-mono text-sm font-semibold text-slate-800">{journey.tag_id}</span>
                  </div>
                )}
                {journey.s9id && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Receptacle</span>
                    <span className="font-mono text-sm text-slate-600">{journey.s9id}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {journey.origin_country && (
                  <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                    <Globe className="w-3 h-3" />{journey.origin_country}
                  </span>
                )}
                {journey.origin_country && journey.dest_country && <ArrowRight className="w-3.5 h-3.5 text-slate-400" />}
                {journey.dest_country && (
                  <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                    <Globe className="w-3 h-3" />{journey.dest_country}
                  </span>
                )}
                {journey.is_international && (
                  <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                    <Plane className="w-3 h-3" /> International
                  </span>
                )}
                {!journey.is_international && journey.origin_country && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">Domestic</span>
                )}
                <span className="text-xs text-slate-400">{journey.total_readings} readings</span>
              </div>
            </div>

            {/* Milestone summary */}
            <MilestoneSummary milestones={journey.milestones} />

            {/* Origin segment */}
            <SegmentBlock
              segment="ORIGIN_COUNTRY"
              events={originEvents}
              label={journey.origin_country ? `Origin — ${journey.origin_country}` : 'Origin Country'}
              subtitle="OE Origin · AMU Outbound"
            />

            {/* LEG2 connector */}
            {journey.is_international && originEvents.length > 0 && destEvents.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2">
                <div className="h-px flex-1 bg-violet-200" />
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold bg-violet-50 text-violet-700 border-violet-200">
                  <Plane className="w-3.5 h-3.5" />
                  LEG2 — International Flight
                  {diffLabel(lastOriginTs, firstDestTs) && (
                    <span className="flex items-center gap-1 ml-1 text-[11px]">
                      <Timer className="w-3 h-3" /> {diffLabel(lastOriginTs, firstDestTs)}
                    </span>
                  )}
                </div>
                <div className="h-px flex-1 bg-violet-200" />
              </div>
            )}

            {/* Destination segment */}
            <SegmentBlock
              segment="DEST_COUNTRY"
              events={destEvents}
              label={journey.dest_country ? `Destination — ${journey.dest_country}` : 'Destination Country'}
              subtitle="AMU Inbound · OE Destination"
            />
          </>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-700 text-center">
            No RFID readings found for tag <span className="font-mono font-semibold">{tagId}</span>.
          </div>
        )}

        <p className="text-center text-xs text-slate-400 pb-4">
          EDGE · Tag tracking · {new Date().toLocaleString('en-GB')}
        </p>
      </main>
    </div>
  );
}
