/** Escapa un campo CSV según reglas de QuickSight (delimitador ',', cualificador '"'). */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Une una fila de valores ya en orden de columnas. */
export function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(",");
}
