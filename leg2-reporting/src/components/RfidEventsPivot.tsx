import type { RfidEventsReport } from "@/lib/pivot";
import type { ReaderMaster, RfidMovement } from "@/lib/supabase";
import { formatTimestampParts, type TimeMode } from "@/lib/time";
import { strings } from "@/i18n/strings";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

function NoEventCodeCell({
  movements, timeMode, readerMap, onSelectReader,
}: {
  movements: RfidMovement[];
  timeMode: TimeMode;
  readerMap: Map<string, ReaderMaster>;
  onSelectReader: (lpi: string) => void;
}) {
  if (movements.length === 0) {
    return <TableCell className="bg-amber-50/40" />;
  }
  const m = movements[0];
  const reader = readerMap.get(m.reader_id);
  const parts = formatTimestampParts(m, timeMode);
  return (
    <TableCell className="font-mono text-xs bg-amber-50/40">
      <div className="font-semibold">{parts.date} ({parts.weekday})</div>
      <div className="font-semibold">{parts.time}</div>
      <button
        type="button"
        className="text-blue-700 underline"
        onClick={(e) => { e.stopPropagation(); onSelectReader(m.reader_id); }}
      >
        {m.reader_id}
      </button>
      <div className="text-muted-foreground">
        {strings.columns.gate}: {reader?.gate_name ?? "—"}
      </div>
      {m.site_name && (
        <div className="text-muted-foreground">{m.site_name}</div>
      )}
      {movements.length > 1 && (
        <div className="text-[10px] text-amber-800">+{movements.length - 1}</div>
      )}
    </TableCell>
  );
}

export function RfidEventsPivot({
  report,
  timeMode,
  selectedS9,
  onSelectS9,
  onSelectReader,
  readerMap,
}: {
  report: RfidEventsReport;
  timeMode: TimeMode;
  selectedS9: string | null;
  onSelectS9: (s9: string) => void;
  onSelectReader: (lpi: string) => void;
  readerMap: Map<string, ReaderMaster>;
}) {
  if (report.rows.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">{strings.states.noRows}</p>;
  }
  return (
    <TooltipProvider delayDuration={200}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky top-0 left-0 z-40 bg-background border-r">
              {strings.columns.s9}
            </TableHead>
            {report.hasNoEventCodeOutbound && (
              <TableHead className="sticky top-0 z-30 bg-amber-100/70 border-r">
                {strings.columns.noEventCode}
              </TableHead>
            )}
            {report.columns.map((c) => (
              <TableHead key={c.code} className="sticky top-0 z-30 bg-background">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span title={c.label} aria-label={c.label}>{c.code}</span>
                  </TooltipTrigger>
                  <TooltipContent>{c.label}</TooltipContent>
                </Tooltip>
                <div className="text-[10px] text-muted-foreground">
                  {c.count.toLocaleString("en-US")}
                </div>
              </TableHead>
            ))}
            {report.hasNoEventCodeInbound && (
              <TableHead className="sticky top-0 z-30 bg-amber-100/70 border-l">
                {strings.columns.noEventCode}
              </TableHead>
            )}
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
                {report.hasNoEventCodeOutbound && (
                  <NoEventCodeCell
                    movements={row.noEventCodeOutbound}
                    timeMode={timeMode}
                    readerMap={readerMap}
                    onSelectReader={onSelectReader}
                  />
                )}
                {report.columns.map((c) => {
                  const m = row.cells[c.code];
                  if (!m) {
                    return <TableCell key={c.code} className="font-mono text-xs" />;
                  }
                  const reader = readerMap.get(m.reader_id);
                  const parts = formatTimestampParts(m, timeMode);
                  return (
                    <TableCell key={c.code} className="font-mono text-xs">
                      <div className="font-semibold">{parts.date} ({parts.weekday})</div>
                      <div className="font-semibold">{parts.time}</div>
                      <div className="text-muted-foreground">{m.reader_id}</div>
                      <div className="text-muted-foreground">
                        {strings.columns.gate}: {reader?.gate_name ?? "—"}
                        {reader?.handover_point === true && (
                          <span
                            className="ml-1 inline-block rounded bg-amber-200 px-1 text-[10px] font-semibold text-amber-900"
                            title={strings.columns.handover}
                          >
                            {strings.columns.handoverBadge}
                          </span>
                        )}
                      </div>
                      {m.site_name && (
                        <div className="text-muted-foreground">{m.site_name}</div>
                      )}
                    </TableCell>
                  );
                })}
                {report.hasNoEventCodeInbound && (
                  <NoEventCodeCell
                    movements={row.noEventCodeInbound}
                    timeMode={timeMode}
                    readerMap={readerMap}
                    onSelectReader={onSelectReader}
                  />
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}
