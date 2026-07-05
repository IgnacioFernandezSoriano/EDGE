import { useEffect, useMemo, useState } from "react";
import {
  fetchEdiEvents, fetchEdiDetails, fetchMovementsByS9, supabase,
  type EdiEvent, type EdiDetail, type RfidMovement,
} from "@/lib/supabase";
import { buildAtatTimeline, type AtatEvent } from "@/lib/atat";

/** Injectable dependencies for testing without hitting Supabase. */
export interface ReceptacleTimelineDeps {
  fetchMovements: (s9: string, token?: string) => Promise<RfidMovement[]>;
  fetchEvents: (s9: string, token?: string) => Promise<EdiEvent[]>;
  fetchDetails: (s9: string, token?: string) => Promise<EdiDetail | null>;
  getToken: () => Promise<string | undefined>;
}

export const defaultTimelineDeps: ReceptacleTimelineDeps = {
  fetchMovements: (s9, token) => fetchMovementsByS9(s9, token ? { token } : {}),
  fetchEvents: (s9, token) => fetchEdiEvents(s9, token ? { token } : {}),
  fetchDetails: (s9, token) => fetchEdiDetails(s9, token ? { token } : {}),
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
};

export function useReceptacleTimeline(
  s9: string | null,
  deps: ReceptacleTimelineDeps = defaultTimelineDeps
): { loading: boolean; error: string | null; detail: EdiDetail | null; events: AtatEvent[] } {
  const [movements, setMovements] = useState<RfidMovement[]>([]);
  const [ediEvents, setEdiEvents] = useState<EdiEvent[]>([]);
  const [detail, setDetail] = useState<EdiDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = !!s9 && s9.length > 0;

  useEffect(() => {
    if (!active) {
      setMovements([]); setEdiEvents([]); setDetail(null); setError(null);
      return;
    }
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
        setMovements(mv); setEdiEvents(ev); setDetail(dt);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [active, s9, deps]);

  const events = useMemo(() => buildAtatTimeline(movements, ediEvents), [movements, ediEvents]);
  return { loading, error, detail, events };
}
