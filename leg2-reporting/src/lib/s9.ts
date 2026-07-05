export function deriveOrigPoCode(s9Id: string): string {
  return s9Id.length >= 12 ? s9Id.slice(0, 6) : "—";
}

export function deriveDestPoCode(s9Id: string): string {
  return s9Id.length >= 12 ? s9Id.slice(6, 12) : "—";
}
