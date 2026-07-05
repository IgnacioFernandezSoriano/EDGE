export type EdiDirection = "outbound" | "inbound";

const OUTBOUND = new Set(["PREDES", "PRECON", "CARDIT", "2000", "2300", "2320"]);
const INBOUND = new Set(["RESDES", "RESCON", "POD", "2400", "2410", "2420"]);

/**
 * Direction of an event code, used to dedup repeated EDI messages
 * (outbound -> keep latest, inbound -> keep earliest) and to tag rows.
 * Unknown/null codes default to "inbound" (keep-earliest) by convention.
 */
export function directionForCode(code: string | null): EdiDirection {
  if (!code) return "inbound";
  if (OUTBOUND.has(code)) return "outbound";
  if (INBOUND.has(code)) return "inbound";
  if (code.startsWith("RESDIT")) return "inbound";
  return "inbound";
}
