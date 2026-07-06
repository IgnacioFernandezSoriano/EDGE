// Pure helpers for the Event-pair gaps screen. No I/O.

import { CHECKPOINT_LABELS } from "@/lib/checkpoints";

export type Granularity = "centre" | "country";

// Product filter sentinels. PRODUCT_ALL = every product; PRODUCT_NONE = rows
// whose edi_details.mail_category is NULL. Any other value is a real category.
export const PRODUCT_ALL = "all";
export const PRODUCT_NONE = "__none__";

// A comparison column, sourced from ref_event_comparison (never hardcoded).
export interface EventComparison {
  comparison_key: string;
  name: string;
  a_source: string;
  a_code: string;
  b_source: string;
  b_code: string;
  priority: number;
}

// One aggregated row returned by the event_pair_matrix RPC.
export interface EventPairMatrixRow {
  origin: string;
  destination: string;
  comparison_key: string;
  mean_days: number;
  n: number;
}

// A corridor pivoted across comparisons: cells keyed by comparison_key.
export interface CorridorRow {
  origin: string;
  destination: string;
  cells: Record<string, { mean_days: number; n: number } | undefined>;
}

export function pivotMatrix(rows: EventPairMatrixRow[]): CorridorRow[] {
  const byCorridor = new Map<string, CorridorRow>();
  for (const r of rows) {
    const key = `${r.origin} ${r.destination}`;
    let row = byCorridor.get(key);
    if (!row) {
      row = { origin: r.origin, destination: r.destination, cells: {} };
      byCorridor.set(key, row);
    }
    row.cells[r.comparison_key] = { mean_days: r.mean_days, n: r.n };
  }
  return [...byCorridor.values()].sort((a, b) =>
    a.origin === b.origin
      ? a.destination.localeCompare(b.destination)
      : a.origin.localeCompare(b.origin)
  );
}

export function formatGapDays(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(1);
}

export interface MailCategory {
  code: string;
  name: string;
}

// 2-char country of a corridor endpoint at the given granularity.
export function endpointCountry(endpoint: string, g: Granularity): string {
  return g === "country" ? endpoint : endpoint.slice(0, 2);
}

export interface EventVocabItem {
  source: string;
  code: string;
  n: number;
}

export const HANDOVER_CODE = "__HO__";

export function eventShortCode(_source: string, code: string): string {
  return code === HANDOVER_CODE ? "HO" : code;
}

export function eventFullLabel(source: string, code: string): string {
  if (code === HANDOVER_CODE) return "Handover (any gate)";
  if (source === "RFID") {
    const l = CHECKPOINT_LABELS[code];
    return l ? `${code} · ${l}` : code;
  }
  return code;
}

export function comparisonCodeLabel(c: {
  a_source: string;
  a_code: string;
  b_source: string;
  b_code: string;
}): string {
  return `${eventShortCode(c.a_source, c.a_code)} → ${eventShortCode(c.b_source, c.b_code)}`;
}
