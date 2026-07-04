import type { RfidMovement } from "@/lib/supabase";
import { classifyTab, type Tab } from "@/lib/s9";

export interface ReportFilterState {
  tab: Tab;
  originCountry: string | null;
  destCountry: string | null;
  s9Query: string;
  rteQuery: string;
}

export function filterMovements(
  movs: RfidMovement[],
  f: ReportFilterState
): RfidMovement[] {
  const s9q = f.s9Query.trim().toLowerCase();
  const rteq = f.rteQuery.trim().toLowerCase();
  return movs.filter((m) => {
    if (classifyTab(m.movement_type) !== f.tab) return false;
    if (f.originCountry && m.origin_country_code !== f.originCountry) return false;
    if (f.destCountry && m.destination_country_code !== f.destCountry) return false;
    if (s9q && !m.s9_id.toLowerCase().includes(s9q)) return false;
    if (rteq && !(m.tag_id ?? "").toLowerCase().includes(rteq)) return false;
    return true;
  });
}

export function distinctCountries(
  movs: RfidMovement[],
  field: "origin_country_code" | "destination_country_code"
): string[] {
  const set = new Set<string>();
  for (const m of movs) {
    const v = m[field];
    if (v) set.add(v);
  }
  return [...set].sort();
}
