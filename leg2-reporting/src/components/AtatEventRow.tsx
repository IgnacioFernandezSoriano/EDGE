import type { AtatEvent } from "@/lib/atat";
import { strings } from "@/i18n/strings";
import { cn } from "@/lib/utils";

export function AtatEventRow({ event }: { event: AtatEvent }) {
  const isRfid = event.source === "RFID";
  const sourceLabel = isRfid ? strings.atat.sourceRfid : strings.atat.sourceEdi;
  return (
    <div className="relative flex gap-4 pb-6">
      {/* time column */}
      <div className="w-36 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {event.displayTime || event.rawDate}
      </div>
      {/* axis dot */}
      <div className="relative flex justify-center">
        <span className="mt-1 h-3 w-3 rounded-full border-2 border-background bg-foreground/70" />
        <span className="absolute top-1 h-full w-px bg-border" />
      </div>
      {/* content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded px-2 py-0.5 text-xs font-semibold",
              isRfid ? "bg-sky-100 text-sky-900" : "bg-rose-100 text-rose-900"
            )}
          >
            {event.code || "—"}
          </span>
          <span className="text-sm font-medium">{event.label}</span>
          <span className="ml-auto flex items-center gap-2">
            {event.location && (
              <span data-role="location" className="font-mono text-xs text-muted-foreground">
                {event.location}
              </span>
            )}
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {sourceLabel}
            </span>
          </span>
        </div>
        {event.fields.length > 0 && (
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
            {event.fields.map((f) => (
              <div key={f.label} className="flex gap-1 text-xs">
                <dt className="text-muted-foreground">{f.label}:</dt>
                <dd className="min-w-0 truncate">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
