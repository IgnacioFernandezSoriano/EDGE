export interface SelectOption {
  value: string;
  label: string;
}

// Known values observed in the GMS reader master. The current value is always
// included so an unexpected value is never silently dropped.
export const READING_DIRECTIONS = ["Entry", "Exit", "Entry/Exit"];
export const OPERATIONS_SCOPES = ["International", "Domestic"];

// Checkpoint role drives edi_equivalent in the ETL (role × leg × entry/exit).
// AMU: 2310/2320 (outbound) + 2400/2410 (inbound); OE: 2300 (outbound exit) + 2420
// (inbound entry); NONE: emits no checkpoint. Transit always resolves to NULL.
export const CHECKPOINT_ROLES = ["AMU", "OE", "NONE"];

export function optionsWithCurrent(known: string[], current: string | null): SelectOption[] {
  const options: SelectOption[] = [{ value: "", label: "—" }];
  for (const k of known) options.push({ value: k, label: k });
  if (current && !known.includes(current)) options.push({ value: current, label: current });
  return options;
}
