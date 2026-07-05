export type TimeMode = "utc" | "local";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Extract date/time components directly from an ISO-ish string without
 * constructing a Date object. This is intentional: event_datetime_local is a
 * naive local timestamp with no offset, and parsing it via `new Date()` /
 * `Date.parse()` would apply the runtime's local timezone, shifting the
 * displayed value. Component-based parsing keeps display tz-safe.
 */
export function formatTimestampParts(
  mov: { event_datetime_utc: string; event_datetime_local: string },
  mode: TimeMode
): { date: string; time: string; weekday: string } {
  const raw = mode === "utc" ? mov.event_datetime_utc : mov.event_datetime_local;
  const match = TS_RE.exec(raw);
  if (!match) {
    return { date: raw, time: "", weekday: "" };
  }
  const [, year, month, day, hour, minute, second] = match;
  const monthAbbrev = MONTHS[Number(month) - 1] ?? month;
  const weekday = WD[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
  return {
    date: `${day} ${monthAbbrev} ${year}`,
    time: `${hour}:${minute}:${second}`,
    weekday,
  };
}

export function formatTimestamp(
  mov: { event_datetime_utc: string; event_datetime_local: string },
  mode: TimeMode
): string {
  const parts = formatTimestampParts(mov, mode);
  const dateStr = parts.weekday ? `${parts.date} (${parts.weekday})` : parts.date;
  return parts.time ? `${dateStr}, ${parts.time}` : dateStr;
}

/**
 * Format an ISO-ish timestamp string as "DD Mon YYYY (Wd), HH:MM:SS", reading
 * the wall-clock components directly (tz-safe — never constructs a local Date).
 * For a UTC string ("…+00:00") the components ARE UTC; for a naive local string
 * they are the local wall time.
 */
export function formatIso(iso: string | null): string {
  if (!iso) return "";
  const match = TS_RE.exec(iso);
  if (!match) return iso;
  const [, year, month, day, hour, minute, second] = match;
  const monthAbbrev = MONTHS[Number(month) - 1] ?? month;
  const weekday = WD[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
  return `${day} ${monthAbbrev} ${year} (${weekday}), ${hour}:${minute}:${second}`;
}

/**
 * Hours between two events. HARD RULE: always computed from event_datetime_utc,
 * never from local (DST/timezone changes would introduce artificial hours).
 */
export function durationHours(
  a: { event_datetime_utc: string },
  b: { event_datetime_utc: string }
): number {
  return (
    (Date.parse(b.event_datetime_utc) - Date.parse(a.event_datetime_utc)) /
    3_600_000
  );
}
