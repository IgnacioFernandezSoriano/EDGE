import type { RfidMovement, ReaderMaster } from "@/lib/supabase";
import type { TimeMode } from "@/lib/time";
import { strings } from "@/i18n/strings";
import { EventDetailsTable } from "@/components/EventDetailsTable";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export function EventDetailsDialog({
  open,
  onOpenChange,
  s9,
  movements,
  timeMode,
  readerMap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  s9: string | null;
  movements: RfidMovement[];
  timeMode: TimeMode;
  readerMap: Map<string, ReaderMaster>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {strings.states.eventDetails}
            {s9 ? ` — ${s9}` : ""}
          </DialogTitle>
        </DialogHeader>
        <EventDetailsTable movements={movements} timeMode={timeMode} readerMap={readerMap} />
      </DialogContent>
    </Dialog>
  );
}
