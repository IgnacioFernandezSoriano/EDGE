import type { RfidEventsReport } from "@/lib/pivot";
import { formatTimestamp, type TimeMode } from "@/lib/time";
import { strings } from "@/i18n/strings";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

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
    <TooltipProvider delayDuration={200}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-20 bg-background border-r">
              {strings.columns.s9}
            </TableHead>
            {report.columns.map((c) => (
              <TableHead key={c.code}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span title={c.label} aria-label={c.label}>{c.code}</span>
                  </TooltipTrigger>
                  <TooltipContent>{c.label}</TooltipContent>
                </Tooltip>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.rows.map((row) => {
            const isSelected = selectedS9 === row.s9_id;
            return (
              <TableRow
                key={row.s9_id}
                onClick={() => onSelectS9(row.s9_id)}
                className={cn("cursor-pointer", isSelected && "bg-muted")}
              >
                <TableCell
                  className={cn(
                    "sticky left-0 z-10 border-r",
                    isSelected ? "bg-muted" : "bg-background"
                  )}
                >
                  <div className="font-mono text-sm">{row.s9_id}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.origPoCode} → {row.destPoCode}
                  </div>
                  <div className="font-mono text-xs">{row.rte ?? "—"}</div>
                </TableCell>
                {report.columns.map((c) => {
                  const m = row.cells[c.code];
                  return (
                    <TableCell key={c.code} className="font-mono text-xs">
                      {m ? formatTimestamp(m, timeMode) : ""}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}
