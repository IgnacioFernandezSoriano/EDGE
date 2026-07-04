import type { RfidMovement, ReaderMaster } from "@/lib/supabase";
import { formatTimestamp, type TimeMode } from "@/lib/time";
import { strings } from "@/i18n/strings";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

function formatSite(m: RfidMovement): string {
  const site = m.site_impc_code ?? m.centre_code;
  if (!site) return m.country_code ? `(${m.country_code})` : "—";
  return site + (m.country_code ? ` (${m.country_code})` : "");
}

export function EventDetailsTable({
  movements,
  timeMode,
  readerMap,
}: {
  movements: RfidMovement[];
  timeMode: TimeMode;
  readerMap: Map<string, ReaderMaster>;
}) {
  if (movements.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">{strings.states.selectS9}</p>;
  }
  const sorted = [...movements].sort((a, b) =>
    a.event_datetime_utc.localeCompare(b.event_datetime_utc)
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{strings.columns.s9}</TableHead>
          <TableHead>{strings.columns.rfidTag}</TableHead>
          <TableHead>{strings.columns.movementId}</TableHead>
          <TableHead>{strings.columns.time}</TableHead>
          <TableHead>{strings.columns.site}</TableHead>
          <TableHead>{strings.columns.rfidReader}</TableHead>
          <TableHead>{strings.columns.gate}</TableHead>
          <TableHead>{strings.columns.handoverStatus}</TableHead>
          <TableHead>{strings.columns.readerHandover}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((m) => {
          const reader = readerMap.get(m.reader_id);
          return (
            <TableRow key={m.movement_id}>
              <TableCell className="font-mono text-xs">{m.s9_id}</TableCell>
              <TableCell className="font-mono text-xs">{m.tag_id ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{m.movement_id}</TableCell>
              <TableCell className="font-mono text-xs">{formatTimestamp(m, timeMode)}</TableCell>
              <TableCell>{formatSite(m)}</TableCell>
              <TableCell className="font-mono text-xs">{m.reader_id}</TableCell>
              <TableCell>{reader?.gate_name ?? "—"}</TableCell>
              <TableCell>{m.handover_quality_status ?? "—"}</TableCell>
              <TableCell>
                {reader?.handover_point ? strings.common.yes : strings.common.no}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
