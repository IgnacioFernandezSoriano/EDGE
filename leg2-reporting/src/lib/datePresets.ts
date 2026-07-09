export type DatePreset =
  | "today"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "last90Days";

export interface DateRange {
  from: string;
  to: string;
}

export const PRESET_ORDER: DatePreset[] = [
  "today",
  "thisWeek",
  "lastWeek",
  "thisMonth",
  "last90Days",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The preset whose computed range equals `range`, or null when the range was
// hand-edited (or otherwise matches no preset). Lets the UI highlight the active
// preset button without tracking extra state — it self-clears on manual edits.
export function activePreset(range: DateRange, now: Date = new Date()): DatePreset | null {
  for (const p of PRESET_ORDER) {
    const r = presetRange(p, now);
    if (r.from === range.from && r.to === range.to) return p;
  }
  return null;
}

export function presetRange(preset: DatePreset, now: Date = new Date()): DateRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = now.getDate();

  switch (preset) {
    case "today": {
      const today = formatLocal(new Date(y, m, day));
      return { from: today, to: today };
    }
    case "thisWeek": {
      const daysFromMonday = (now.getDay() + 6) % 7;
      const monday = new Date(y, m, day - daysFromMonday);
      const sunday = new Date(y, m, day - daysFromMonday + 6);
      return { from: formatLocal(monday), to: formatLocal(sunday) };
    }
    case "lastWeek": {
      const daysFromMonday = (now.getDay() + 6) % 7;
      const lastMonday = new Date(y, m, day - daysFromMonday - 7);
      const lastSunday = new Date(y, m, day - daysFromMonday - 1);
      return { from: formatLocal(lastMonday), to: formatLocal(lastSunday) };
    }
    case "thisMonth": {
      const firstOfMonth = new Date(y, m, 1);
      const lastOfMonth = new Date(y, m + 1, 0);
      return { from: formatLocal(firstOfMonth), to: formatLocal(lastOfMonth) };
    }
    case "last90Days": {
      const start = new Date(y, m, day - 89);
      const today = new Date(y, m, day);
      return { from: formatLocal(start), to: formatLocal(today) };
    }
  }
}
