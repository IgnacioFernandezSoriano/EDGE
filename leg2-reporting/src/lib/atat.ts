import type { RfidMovement } from "@/lib/supabase";
import { directionForCode, type EdiDirection } from "@/lib/ediDirection";
import { checkpointLabel } from "@/lib/checkpoints";
import { formatTimestamp } from "@/lib/time";
import { strings } from "@/i18n/strings";

const EDI_DATE_RE = /^[A-Za-z]{3},(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse an edi_events.date string. Two formats occur in the data:
 *   "Fri,01-05-2026 18:26"  (Ddd,DD-MM-YYYY HH:MM)
 *   "2026-07-01"            (ISO date only -> midnight)
 * The returned Date is built with Date.UTC from the integer components so it
 * is a naive, timezone-independent instant used ONLY for ordering. `display`
 * is the original trimmed string. Unparseable -> date: null.
 */
export function parseEdiDate(raw: string | null): { date: Date | null; display: string } {
  const s = (raw ?? "").trim();
  if (!s) return { date: null, display: "" };
  const m1 = EDI_DATE_RE.exec(s);
  if (m1) {
    const [, dd, mm, yyyy, hh, mi] = m1;
    return { date: new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi)), display: s };
  }
  const m2 = ISO_DATE_RE.exec(s);
  if (m2) {
    const [, yyyy, mm, dd] = m2;
    return { date: new Date(Date.UTC(+yyyy, +mm - 1, +dd, 0, 0)), display: s };
  }
  return { date: null, display: s };
}

/** Structural shape of an edi_events row (matches EdiEvent from supabase.ts). */
export interface EdiEventInput {
  message: string | null;
  event: string | null;
  date: string | null;
  location: string | null;
  transport: string | null;
  transport_date: string | null;
  reference: string | null;
}

export interface AtatField {
  label: string;
  value: string;
}

export interface AtatEvent {
  source: "RFID" | "EDI";
  code: string;
  label: string;
  timestamp: Date | null;
  displayTime: string;
  rawDate: string;
  location: string | null;
  direction: EdiDirection;
  fields: AtatField[];
}

const RFID_TS_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/** Naive local timestamp -> tz-independent ordering instant (Date.UTC of components). */
function rfidTimestamp(raw: string | null): Date | null {
  const m = RFID_TS_RE.exec(raw ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
}

function nonEmpty(pairs: Array<[string, string | null | undefined]>): AtatField[] {
  return pairs
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([label, v]) => ({ label, value: String(v) }));
}

function normalizeRfid(m: RfidMovement): AtatEvent {
  const code = m.edi_equivalent ?? m.movement_type;
  const label = m.edi_equivalent ? checkpointLabel(m.edi_equivalent) : m.movement_type;
  return {
    source: "RFID",
    code,
    label,
    timestamp: rfidTimestamp(m.event_datetime_local),
    displayTime: formatTimestamp(m, "local"),
    rawDate: m.event_datetime_local,
    location: m.site_impc_code ?? m.centre_code ?? null,
    direction: directionForCode(code),
    fields: nonEmpty([
      [strings.atat.fieldMovementType, m.movement_type],
      [strings.atat.fieldReader, m.reader_id],
      [strings.atat.fieldFacility, m.site_name],
      [strings.atat.fieldCity, m.city],
      [strings.atat.fieldCountry, m.country_code],
      [strings.atat.fieldTag, m.tag_id],
      [strings.atat.fieldHandover, m.handover_point ? strings.common.yes : null],
      [strings.atat.fieldUtc, m.event_datetime_utc],
    ]),
  };
}

function normalizeEdi(e: EdiEventInput): AtatEvent {
  const { date, display } = parseEdiDate(e.date);
  const code = e.message ?? "";
  return {
    source: "EDI",
    code,
    label: e.event ?? code,
    timestamp: date,
    displayTime: display,
    rawDate: display,
    location: e.location,
    direction: directionForCode(e.message),
    fields: nonEmpty([
      [strings.atat.fieldLocation, e.location],
      [strings.atat.fieldTransport, e.transport],
      [strings.atat.fieldTransportDate, e.transport_date],
      [strings.atat.fieldReference, e.reference],
    ]),
  };
}

/** Collapse repeated EDI codes: outbound -> latest, inbound -> earliest. Stable. */
function dedupeEdi(events: AtatEvent[]): AtatEvent[] {
  const groups = new Map<string, AtatEvent[]>();
  const order: string[] = [];
  for (const e of events) {
    if (!groups.has(e.code)) {
      groups.set(e.code, []);
      order.push(e.code);
    }
    groups.get(e.code)!.push(e);
  }
  return order.map((code) => {
    const g = groups.get(code)!;
    if (g.length === 1) return g[0];
    const withTs = g.filter((x) => x.timestamp !== null);
    if (withTs.length === 0) return g[0];
    const dir = g[0].direction;
    return withTs.reduce((best, cur) => {
      const b = best.timestamp!.getTime();
      const c = cur.timestamp!.getTime();
      return dir === "outbound" ? (c > b ? cur : best) : (c < b ? cur : best);
    });
  });
}

/**
 * Merge RFID movements + EDI events into one chronological timeline.
 *
 * Ordering is by NAIVE wall-clock: RFID uses reader-local time, EDI uses the
 * reporting office's local time, both compared on one axis with no timezone
 * conversion (the EDI date string carries no zone). For a receptacle crossing
 * timezones the interleaving can therefore be off by the zone offset. This is
 * a documented product decision (see spec §5/§11) — revisit if the EDI zone is
 * ever confirmed.
 */
export function buildAtatTimeline(
  movements: RfidMovement[],
  edi: EdiEventInput[]
): AtatEvent[] {
  const rfid = movements.map(normalizeRfid);
  const ediEvents = dedupeEdi(edi.map(normalizeEdi));
  return [...rfid, ...ediEvents]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ta = a.e.timestamp;
      const tb = b.e.timestamp;
      if (ta && tb) {
        const d = ta.getTime() - tb.getTime();
        return d !== 0 ? d : a.i - b.i;
      }
      if (ta) return -1;
      if (tb) return 1;
      return a.i - b.i;
    })
    .map(({ e }) => e);
}
