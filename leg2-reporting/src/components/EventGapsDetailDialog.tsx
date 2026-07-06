import type { EventPairDetailRow } from "@/lib/supabase";
import { formatGapDays } from "@/lib/eventGaps";
import { strings } from "@/i18n/strings";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export interface EventGapsDetailDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  rows: EventPairDetailRow[];
  loading: boolean;
  onToggleExclude: (row: EventPairDetailRow, excluded: boolean) => void;
}

function utcMinute(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

export function EventGapsDetailDialog({
  open, onOpenChange, title, rows, loading, onToggleExclude,
}: EventGapsDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{strings.gaps.detailTitle} — {title}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">{strings.states.loading}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.gaps.noRows}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{strings.gaps.colS9}</TableHead>
                <TableHead>{strings.gaps.colProduct}</TableHead>
                <TableHead>{strings.gaps.colRfid}</TableHead>
                <TableHead>{strings.gaps.colEdi}</TableHead>
                <TableHead className="text-right">{strings.gaps.colGap}</TableHead>
                <TableHead className="text-center">{strings.gaps.exclude}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.s9code} className={cn(r.excluded && "line-through opacity-60")}>
                  <TableCell className="font-mono text-xs">{r.s9code}</TableCell>
                  <TableCell>{r.product ?? strings.gaps.noProduct}</TableCell>
                  <TableCell className="font-mono text-xs">{utcMinute(r.rfid_utc)}</TableCell>
                  <TableCell className="font-mono text-xs">{utcMinute(r.edi_utc)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatGapDays(r.gap_days)}</TableCell>
                  <TableCell className="text-center">
                    <input
                      type="checkbox"
                      aria-label={`${strings.gaps.exclude} ${r.s9code}`}
                      checked={r.excluded}
                      onChange={(e) => onToggleExclude(r, e.target.checked)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
