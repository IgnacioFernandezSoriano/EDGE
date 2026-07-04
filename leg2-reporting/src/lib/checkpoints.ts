export interface CheckpointColumn {
  code: string;
  label: string;
}

/** IPC checkpoint code → human label. Extend as new codes get names. */
export const CHECKPOINT_LABELS: Record<string, string> = {
  "2300": "Exit From Outbound OE",
  "2310": "Entry Outbound AMU",
  "2320": "Exit Outbound AMU",
  "2400": "Entry Inbound AMU",
  "2410": "Exit Inbound AMU",
  "2420": "Entry Inbound OE",
  "2440": "Incorrect Inbound",
  "2450": "Backup",
};

export function checkpointLabel(code: string): string {
  return CHECKPOINT_LABELS[code] ?? code;
}

/**
 * Dynamic columns: the DISTINCT edi_equivalent values present in the data,
 * ordered ascending by numeric code. New checkpoints surface automatically.
 * Null edi_equivalent produces no column.
 */
export function checkpointColumnsFromData(
  movs: { edi_equivalent: string | null }[]
): CheckpointColumn[] {
  const codes = new Set<string>();
  for (const m of movs) {
    if (m.edi_equivalent) codes.add(m.edi_equivalent);
  }
  return [...codes]
    .sort((a, b) => Number(a) - Number(b))
    .map((code) => ({ code, label: checkpointLabel(code) }));
}
