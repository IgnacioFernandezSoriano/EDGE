import type { RfidEventsReport } from "@/lib/pivot";
import { formatTimestamp, type TimeMode } from "@/lib/time";
import { strings } from "@/i18n/strings";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export function RfidEventsPivot({
  report,
  timeMode,
  selectedS9,
  onSelectS9,
}: {
  report: RfidEventsReport;
  timeMode: TimeMode;
  selectedS9: string | null;
  onSelectS9: (s9: string) => void;
}) {
  if (report.rows.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">{strings.states.noRows}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{strings.columns.s9}</TableHead>
          <TableHead>{strings.columns.origImpc}</TableHead>
          <TableHead>{strings.columns.destImpc}</TableHead>
          <TableHead>{strings.columns.rfidTag}</TableHead>
          {report.columns.map((c) => (
            <TableHead key={c.code}>{c.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.rows.map((row) => (
          <TableRow
            key={row.s9_id}
            onClick={() => onSelectS9(row.s9_id)}
            className={cn(
              "cursor-pointer",
              selectedS9 === row.s9_id && "bg-muted"
            )}
          >
            <TableCell className="font-mono text-xs">{row.s9_id}</TableCell>
            <TableCell>{row.origPoCode}</TableCell>
            <TableCell>{row.destPoCode}</TableCell>
            <TableCell className="font-mono text-xs">{row.rte ?? "—"}</TableCell>
            {report.columns.map((c) => {
              const m = row.cells[c.code];
              return (
                <TableCell key={c.code} className="font-mono text-xs">
                  {m ? formatTimestamp(m, timeMode) : ""}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
