import { useEffect, useMemo, useState } from "react";
import {
  fetchEdiEvents, fetchEdiDetails, fetchMovementsByS9, supabase,
  type EdiEvent, type EdiDetail, type RfidMovement,
} from "@/lib/supabase";
import { buildAtatTimeline } from "@/lib/atat";
import { receptacleHash } from "@/lib/hashRoute";
import { ReceptacleHeader } from "@/components/ReceptacleHeader";
import { AtatTimeline } from "@/components/AtatTimeline";
import { strings } from "@/i18n/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Injectable dependencies for testing without hitting Supabase. */
export interface AtatPageDeps {
  fetchMovements: (s9: string, token?: string) => Promise<RfidMovement[]>;
  fetchEvents: (s9: string, token?: string) => Promise<EdiEvent[]>;
  fetchDetails: (s9: string, token?: string) => Promise<EdiDetail | null>;
  getToken: () => Promise<string | undefined>;
}

const defaultDeps: AtatPageDeps = {
  fetchMovements: (s9, token) => fetchMovementsByS9(s9, token ? { token } : {}),
  fetchEvents: (s9, token) => fetchEdiEvents(s9, token ? { token } : {}),
  fetchDetails: (s9, token) => fetchEdiDetails(s9, token ? { token } : {}),
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
};

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

export default function AtatPage({ s9, deps = defaultDeps }: { s9: string | null; deps?: AtatPageDeps }) {
  const [movements, setMovements] = useState<RfidMovement[]>([]);
  const [events, setEvents] = useState<EdiEvent[]>([]);
  const [detail, setDetail] = useState<EdiDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = !!s9 && s9.length > 0;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await deps.getToken();
        const [mv, ev, dt] = await Promise.all([
          deps.fetchMovements(s9!, token),
          deps.fetchEvents(s9!, token),
          deps.fetchDetails(s9!, token),
        ]);
        if (cancelled) return;
        setMovements(mv);
        setEvents(ev);
        setDetail(dt);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [active, s9, deps]);

  const timeline = useMemo(() => buildAtatTimeline(movements, events), [movements, events]);

  if (!active) return <SearchBox />;

  return (
    <div className="mx-auto max-w-4xl p-4">
      {loading && <p className="text-sm text-muted-foreground">{strings.states.loading}</p>}
      {error && <p className="text-sm text-red-600">{strings.states.errorPrefix}{error}</p>}
      {!loading && !error && (
        <>
          <ReceptacleHeader s9={s9!} detail={detail} />
          {timeline.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">{strings.atat.noEvents}</p>
          ) : (
            <AtatTimeline events={timeline} />
          )}
        </>
      )}
    </div>
  );
}
