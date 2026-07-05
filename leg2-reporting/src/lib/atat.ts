import type { RfidMovement } from "@/lib/supabase";
import { directionForCode, type EdiDirection } from "@/lib/ediDirection";
import { checkpointLabel } from "@/lib/checkpoints";
import { strings } from "@/i18n/strings";

/** Structural shape of a vw_edi_events_tz row (matches EdiEvent from supabase.ts). */
export interface EdiEventInput {
  message: string | null;
  event: string | null;
  date: string | null;
  location: string | null;
  transport: string | null;
  transport_date: string | null;
  reference: string | null;
  event_datetime_local: string | null;
  event_datetime_utc: string | null;
  resolved_zone: string | null;
  tz_resolved: boolean;
}

export interface AtatField {
  label: string;
  value: string;
}

export interface AtatEvent {
  source: "RFID" | "EDI";
  code: string;
  label: string;
  location: string | null;
  direction: EdiDirection;
  fields: AtatField[];
  eventDatetimeUtc: string | null;   // ISO with offset (canonical) or null
  eventDatetimeLocal: string | null; // ISO naive local or null
  localZone: string | null;          // reader_timezone / resolved_zone
  tzResolved: boolean;               // canonical UTC available
  rawDate: string;                   // fallback display text
  sortKey: number | null;            // ordering: UTC epoch if available, else naive-local epoch
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/** Naive ISO components -> epoch as if UTC (tz-independent ordering key). */
function naiveEpoch(iso: string | null): number | null {
  const m = ISO_RE.exec(iso ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi);
}

/** Ordering key: true UTC epoch when a canonical UTC exists, else naive local. */
function sortKeyOf(utc: string | null, local: string | null): number | null {
  if (utc) {
    const t = Date.parse(utc);
    if (!Number.isNaN(t)) return t;
  }
  return naiveEpoch(local);
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
    location: m.site_impc_code ?? m.centre_code ?? null,
    direction: directionForCode(code),
    eventDatetimeUtc: m.event_datetime_utc,
    eventDatetimeLocal: m.event_datetime_local,
    localZone: m.reader_timezone ?? null,
    tzResolved: !!m.event_datetime_utc,
    rawDate: m.event_datetime_local,
    sortKey: sortKeyOf(m.event_datetime_utc, m.event_datetime_local),
    fields: nonEmpty([
      [strings.atat.fieldMovementType, m.movement_type],
      [strings.atat.fieldReader, m.reader_id],
      [strings.atat.fieldFacility, m.site_name],
      [strings.atat.fieldCity, m.city],
      [strings.atat.fieldCountry, m.country_code],
      [strings.atat.fieldTag, m.tag_id],
      [strings.atat.fieldHandover, m.handover_point ? strings.common.yes : null],
    ]),
  };
}

function normalizeEdi(e: EdiEventInput): AtatEvent {
  const code = e.message ?? "";
  return {
    source: "EDI",
    code,
    label: e.event ?? code,
    location: e.location,
    direction: directionForCode(e.message),
    eventDatetimeUtc: e.event_datetime_utc,
    eventDatetimeLocal: e.event_datetime_local,
    localZone: e.resolved_zone,
    tzResolved: e.tz_resolved,
    rawDate: e.date ?? "",
    sortKey: sortKeyOf(e.event_datetime_utc, e.event_datetime_local),
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
    const withKey = g.filter((x) => x.sortKey !== null);
    if (withKey.length === 0) return g[0];
    const dir = g[0].direction;
    return withKey.reduce((best, cur) =>
      dir === "outbound"
        ? (cur.sortKey! > best.sortKey! ? cur : best)
        : (cur.sortKey! < best.sortKey! ? cur : best)
    );
  });
}

/**
 * Merge RFID movements + EDI events into one chronological timeline, ordered by
 * canonical UTC when available (RFID always; EDI when its location zone is
 * resolved), falling back to naive local wall-clock for unresolved rows.
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
      const ka = a.e.sortKey;
      const kb = b.e.sortKey;
      if (ka !== null && kb !== null) {
        return ka !== kb ? ka - kb : a.i - b.i;
      }
      if (ka !== null) return -1;
      if (kb !== null) return 1;
      return a.i - b.i;
    })
    .map(({ e }) => e);
}
