import type { RfidEventsReport } from "@/lib/pivot";
import type { ReaderMaster } from "@/lib/supabase";
import { formatTimestampParts, type TimeMode } from "@/lib/time";
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
  readerMap,
}: {
  report: RfidEventsReport;
  timeMode: TimeMode;
  selectedS9: string | null;
  onSelectS9: (s9: string) => void;
  readerMap: Map<string, ReaderMaster>;
}) {
  if (report.rows.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">{strings.states.noRows}</p>;
  }
  return (
    <TooltipProvider delayDuration={200}>
      <Table>
        <TableHeader className="sticky top-0 z-30 bg-background">
          <TableRow>
            <TableHead className="sticky left-0 top-0 z-40 bg-background border-r">
              {strings.columns.s9}
            </TableHead>
            {report.columns.map((c) => (
              <TableHead key={c.code} className="sticky top-0 z-30 bg-background">
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
                  if (!m) {
                    return <TableCell key={c.code} className="font-mono text-xs" />;
                  }
                  const reader = readerMap.get(m.reader_id);
                  const parts = formatTimestampParts(m, timeMode);
                  return (
                    <TableCell key={c.code} className="font-mono text-xs">
                      <div>{parts.time}</div>
                      <div className="text-[10px] text-muted-foreground">{parts.date}</div>
                      <div className="text-muted-foreground">{m.reader_id}</div>
                      <div className="text-muted-foreground">
                        {strings.columns.gate}: {reader?.gate_name ?? "—"}
                        {reader?.handover_point === true && (
                          <span
                            className="ml-1 inline-block rounded bg-amber-200 px-1 text-[10px] font-semibold text-amber-900"
                            title={strings.columns.handover}
                          >
                            HO
                          </span>
                        )}
                      </div>
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
