/**
 * Extrae el offset ISO-8601 del final de un timestamp de EDGE.
 * Devuelve "+09:00" / "+05:30" / "Z", o null si el timestamp no lleva offset.
 * Normaliza el formato compacto "+0530" a "+05:30".
 */
export function extractOffset(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const m = timestamp.match(/(Z|[+-]\d{2}:?\d{2})$/);
  if (!m) return null;
  if (m[1] === "Z") return "Z";
  const off = m[1];
  return off.includes(":") ? off : `${off.slice(0, -2)}:${off.slice(-2)}`;
}
