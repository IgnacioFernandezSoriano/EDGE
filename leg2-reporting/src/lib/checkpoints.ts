export interface CheckpointColumn {
  code: string;
  label: string;
  count: number;
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
  const counts = new Map<string, number>();
  for (const m of movs) {
    if (m.edi_equivalent) {
      counts.set(m.edi_equivalent, (counts.get(m.edi_equivalent) ?? 0) + 1);
    }
  }
  return [...counts.keys()]
    .sort((a, b) => Number(a) - Number(b))
    .map((code) => ({
      code,
      label: checkpointLabel(code),
      count: counts.get(code)!,
    }));
}
