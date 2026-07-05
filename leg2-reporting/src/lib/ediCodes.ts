import { CHECKPOINT_LABELS } from "@/lib/checkpoints";

export interface EdiCodeOption {
  value: string;
  label: string;
}

// NOTE: seeded from the known IPC checkpoint codes. The GMS master may carry a
// broader catalog; the current value is always appended so nothing is lost.
export function ediCodeOptions(current: string | null): EdiCodeOption[] {
  const codes = Object.keys(CHECKPOINT_LABELS).sort((a, b) => Number(a) - Number(b));
  const options: EdiCodeOption[] = [{ value: "", label: "—" }];
  for (const code of codes) {
    options.push({ value: code, label: `${code} — ${CHECKPOINT_LABELS[code]}` });
  }
  if (current && !codes.includes(current)) {
    options.push({ value: current, label: current });
  }
  return options;
}
