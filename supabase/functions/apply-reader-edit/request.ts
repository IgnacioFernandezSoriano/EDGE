const ALLOWED = [
  "gate_purpose",
  "edi_equivalent_inbound",
  "edi_equivalent_outbound",
  "handover_point",
  "reading_direction",
  "operations_scope",
] as const;

export type ParsedReaderEdit =
  | { ok: true; lpi: string; operation: Record<string, unknown> }
  | { ok: false; error: string };

export function parseReaderEditRequest(body: unknown): ParsedReaderEdit {
  const b = (body ?? {}) as { lpi?: unknown; operation?: unknown };
  const lpi = typeof b.lpi === "string" ? b.lpi.trim() : "";
  if (!lpi) return { ok: false, error: "lpi is required" };
  const opIn = (b.operation ?? {}) as Record<string, unknown>;
  if (typeof opIn !== "object" || opIn === null || Array.isArray(opIn)) {
    return { ok: false, error: "operation must be an object" };
  }
  const operation: Record<string, unknown> = {};
  for (const key of Object.keys(opIn)) {
    if (!(ALLOWED as readonly string[]).includes(key)) {
      return { ok: false, error: `field not allowed: ${key}` };
    }
    operation[key] = opIn[key];
  }
  if (Object.keys(operation).length === 0) {
    return { ok: false, error: "operation has no editable fields" };
  }
  return { ok: true, lpi, operation };
}
