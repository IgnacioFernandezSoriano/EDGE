import { useState } from "react";
import { useReceptacleTimeline, defaultTimelineDeps, type ReceptacleTimelineDeps } from "@/hooks/useReceptacleTimeline";
import { AtatView } from "@/components/AtatView";
import { receptacleHash } from "@/lib/hashRoute";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SearchBox() {
  const [value, setValue] = useState("");
  const submit = () => {
    const s9 = value.trim();
    if (s9) window.location.hash = receptacleHash(s9);
  };
  return (
    <div className="mx-auto mt-16 max-w-md">
      <Label htmlFor="atat-s9">{strings.atat.searchLabel}</Label>
      <div className="mt-2 flex gap-2">
        <Input
          id="atat-s9"
          value={value}
          placeholder={strings.atat.searchPlaceholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <Button onClick={submit}>{strings.atat.open}</Button>
      </div>
    </div>
  );
}

export default function AtatPage({
  s9, deps = defaultTimelineDeps,
}: {
  s9: string | null;
  deps?: ReceptacleTimelineDeps;
}) {
  const active = !!s9 && s9.length > 0;
  const { loading, error, detail, events } = useReceptacleTimeline(active ? s9 : null, deps);

  if (!active) return <SearchBox />;

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h2 className="mb-3 text-lg font-semibold">{strings.atat.title}</h2>
      {loading && <p className="text-sm text-muted-foreground">{strings.states.loading}</p>}
      {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}
      {!loading && !error && <AtatView s9={s9!} detail={detail} events={events} />}
    </div>
  );
}
