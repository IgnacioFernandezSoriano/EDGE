import type { AtatEvent } from "@/lib/atat";
import { AtatEventRow } from "@/components/AtatEventRow";

export function AtatTimeline({ events }: { events: AtatEvent[] }) {
  return (
    <div className="mt-4">
      {events.map((e, i) => (
        <AtatEventRow key={`${e.source}-${e.code}-${e.rawDate}-${i}`} event={e} />
      ))}
    </div>
  );
}
