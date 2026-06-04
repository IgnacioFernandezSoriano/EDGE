/** ISO-8601 en UTC, sin milisegundos. null si la entrada es vacía/ inválida. */
export function toUtcIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Offset "+09:00" / "-05:00" para un instante en una zona IANA (respeta DST). "Z" si es UTC. */
export function offsetForZone(instant: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
  const name = dtf.formatToParts(instant).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-]\d{1,2}:?\d{2})?/);
  if (!m || !m[1]) return "Z";
  let off = m[1];
  if (!off.includes(":")) off = `${off.slice(0, -2)}:${off.slice(-2)}`; // "+0900" -> "+09:00"
  const [sign, rest] = [off[0], off.slice(1)];
  const [h, mm] = rest.split(":");
  return `${sign}${h.padStart(2, "0")}:${mm}`;
}

/** event_datetime_local en ISO-8601 con offset, derivado del instante UTC + zona IANA. */
export function toLocalIsoWithOffset(utcValue: string | null, timeZone: string | null): string | null {
  if (!utcValue) return null;
  const instant = new Date(utcValue);
  if (isNaN(instant.getTime())) return null;
  if (!timeZone) return toUtcIso(utcValue);
  const offset = offsetForZone(instant, timeZone);
  if (offset === "Z") return toUtcIso(utcValue);
  const sign = offset.startsWith("-") ? -1 : 1;
  const [oh, om] = offset.slice(1).split(":").map(Number);
  const localMs = instant.getTime() + sign * (oh * 60 + om) * 60000;
  const iso = new Date(localMs).toISOString().replace(/\.\d{3}Z$/, "");
  return `${iso}${offset}`;
}
