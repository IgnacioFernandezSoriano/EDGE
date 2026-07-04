import type { RfidMovement } from "@/lib/supabase";
import {
  checkpointColumnsFromData,
  type CheckpointColumn,
} from "@/lib/checkpoints";
import { deriveOrigPoCode, deriveDestPoCode } from "@/lib/s9";

export interface S9PivotRow {
  s9_id: string;
  origPoCode: string;
  destPoCode: string;
  rte: string | null;
  cells: Record<string, RfidMovement>;
  transits: RfidMovement[];
  all: RfidMovement[];
}

export interface RfidEventsReport {
  columns: CheckpointColumn[];
  rows: S9PivotRow[];
}

function latestUtc(movs: RfidMovement[]): string {
  return movs.reduce(
    (max, m) => (m.event_datetime_utc > max ? m.event_datetime_utc : max),
    ""
  );
}

export function pivotByS9(movs: RfidMovement[]): RfidEventsReport {
  const columns = checkpointColumnsFromData(movs);

  const byS9 = new Map<string, RfidMovement[]>();
  for (const m of movs) {
    const group = byS9.get(m.s9_id);
    if (group) group.push(m);
    else byS9.set(m.s9_id, [m]);
  }

  const rows: S9PivotRow[] = [];
  for (const [s9_id, group] of byS9) {
    const cells: Record<string, RfidMovement> = {};
    for (const m of group) {
      if (!m.edi_equivalent) continue;
      const existing = cells[m.edi_equivalent];
      if (!existing || m.event_datetime_utc < existing.event_datetime_utc) {
        cells[m.edi_equivalent] = m;
      }
    }
    const transits = group.filter(
      (m) => m.movement_type === "TRANSIT_ENTRY" || m.movement_type === "TRANSIT_EXIT"
    );
    const rte = group.find((m) => m.tag_id)?.tag_id ?? null;
    rows.push({
      s9_id,
      origPoCode: deriveOrigPoCode(s9_id),
      destPoCode: deriveDestPoCode(s9_id),
      rte,
      cells,
      transits,
      all: group,
    });
  }

  // Most recent activity first (ISO UTC strings compare lexicographically).
  rows.sort((a, b) => latestUtc(b.all).localeCompare(latestUtc(a.all)));
  return { columns, rows };
}
