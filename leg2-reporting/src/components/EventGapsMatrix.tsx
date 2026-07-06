import { formatGapDays, comparisonCodeLabel, type CorridorRow, type EventComparison } from "@/lib/eventGaps";
import { strings } from "@/i18n/strings";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export interface EventGapsMatrixProps {
  comparisons: EventComparison[];
  rows: CorridorRow[];
  onSelectCell: (corridor: { origin: string; destination: string }, comparisonKey: string) => void;
}

export function EventGapsMatrix({ comparisons, rows, onSelectCell }: EventGapsMatrixProps) {
  if (rows.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{strings.gaps.noRows}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 top-0 z-30 bg-background border-r">
            {strings.gaps.corridor}
          </TableHead>
          {comparisons.map((c) => (
            <TableHead key={c.comparison_key} className="sticky top-0 z-20 bg-background" title={comparisonCodeLabel(c)}>
              <div>{c.name}</div>
              <div className="text-[10px] font-normal text-muted-foreground">{comparisonCodeLabel(c)}</div>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.origin}-${row.destination}`}>
            <TableCell className="sticky left-0 z-10 bg-background border-r font-mono text-sm">
              {row.origin} → {row.destination}
            </TableCell>
            {comparisons.map((c) => {
              const cell = row.cells[c.comparison_key];
              if (!cell) {
                return <TableCell key={c.comparison_key} className="text-muted-foreground">—</TableCell>;
              }
              return (
                <TableCell key={c.comparison_key}>
                  <button
                    type="button"
                    className="text-blue-700 underline font-semibold"
                    onClick={() => onSelectCell({ origin: row.origin, destination: row.destination }, c.comparison_key)}
                  >
                    {formatGapDays(cell.mean_days)}
                  </button>
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {cell.n} {strings.gaps.pairs}
                  </span>
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
