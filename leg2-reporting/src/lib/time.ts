export type TimeMode = "utc" | "local";

export function formatTimestamp(
  mov: { event_datetime_utc: string; event_datetime_local: string },
  mode: TimeMode
): string {
  return mode === "utc" ? mov.event_datetime_utc : mov.event_datetime_local;
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
