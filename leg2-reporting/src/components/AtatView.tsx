import { useState } from "react";
import type { AtatEvent } from "@/lib/atat";
import type { EdiDetail } from "@/lib/supabase";
import type { TimeMode } from "@/lib/time";
import { ReceptacleHeader } from "@/components/ReceptacleHeader";
import { AtatTimeline } from "@/components/AtatTimeline";
import { strings } from "@/i18n/strings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function AtatView({
  s9, detail, events, initialMode = "utc",
}: {
  s9: string;
  detail: EdiDetail | null;
  events: AtatEvent[];
  initialMode?: TimeMode;
}) {
  const [mode, setMode] = useState<TimeMode>(initialMode);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <ReceptacleHeader s9={s9} detail={detail} />
        <div className="ml-4 flex shrink-0 items-center gap-2">
          <Label htmlFor="atat-tz">{strings.timeMode.utc}</Label>
          <Switch
            id="atat-tz"
            checked={mode === "local"}
            onCheckedChange={(c) => setMode(c ? "local" : "utc")}
          />
          <Label htmlFor="atat-tz">{strings.timeMode.local}</Label>
        </div>
      </div>
      {events.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{strings.atat.noEvents}</p>
      ) : (
        <AtatTimeline events={events} mode={mode} />
      )}
    </div>
  );
}
