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
