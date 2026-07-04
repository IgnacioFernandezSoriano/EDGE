export type Tab = "inbound" | "outbound";

export function deriveOrigPoCode(s9Id: string): string {
  return s9Id.slice(0, 6);
}

export function deriveDestPoCode(s9Id: string): string {
  return s9Id.slice(6, 12);
}

export function classifyTab(movementType: string): Tab {
  return movementType === "OUTBOUND" || movementType === "TRANSIT_EXIT"
    ? "outbound"
    : "inbound";
}
