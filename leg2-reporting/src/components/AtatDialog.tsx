import { useReceptacleTimeline, defaultTimelineDeps, type ReceptacleTimelineDeps } from "@/hooks/useReceptacleTimeline";
import { AtatView } from "@/components/AtatView";
import { strings } from "@/i18n/strings";
import type { TimeMode } from "@/lib/time";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function AtatDialog({
  s9, open, onOpenChange, initialMode = "utc", deps = defaultTimelineDeps,
}: {
  s9: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialMode?: TimeMode;
  deps?: ReceptacleTimelineDeps;
}) {
  // Only fetch while open with an s9.
  const { loading, error, detail, events } = useReceptacleTimeline(open ? s9 : null, deps);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{strings.atat.title}</DialogTitle>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">{strings.states.loading}</p>}
        {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}
        {!loading && !error && s9 && (
          <AtatView s9={s9} detail={detail} events={events} initialMode={initialMode} />
        )}
      </DialogContent>
    </Dialog>
  );
}
