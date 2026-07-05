import type { AtatEvent } from "@/lib/atat";
import type { TimeMode } from "@/lib/time";
import { AtatEventRow } from "@/components/AtatEventRow";

export function AtatTimeline({ events, mode }: { events: AtatEvent[]; mode: TimeMode }) {
  return (
    <div className="mt-4">
      {events.map((e, i) => (
        <AtatEventRow key={`${e.source}-${e.code}-${e.rawDate}-${i}`} event={e} mode={mode} />
      ))}
    </div>
  );
}
