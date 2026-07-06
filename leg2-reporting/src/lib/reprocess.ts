import { supabase } from "@/lib/supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type ReprocessScope = "reader" | "site" | "global";

export interface ReprocessResult {
  ok: boolean;
  status: string;
  movements_upserted: number;
  reprocess_run_id?: string;
  error?: string;
}

type Deps = { fetchFn?: typeof fetch; token?: string; anonKey?: string; baseUrl?: string; reprocessToken?: string };

/** A reprocess run is a long job. Its outcome is read from the audit view
 *  (vw_reprocess_status), correlated by a unique token embedded in the reason. */
export interface ReprocessStatus {
  reprocess_run_id: string;
  status: string;
  reads_selected: number | null;
  movements_upserted: number | null;
  incidents_created: number | null;
  error_message: string | null;
  reason: string | null;
}

/** Statuses at which a run is finished (success or otherwise). */
export const REPROCESS_TERMINAL = new Set(["success", "failed", "skipped_empty", "skipped_locked"]);

/** The audit `reason` the edge function writes for a given scope + token. Must
 *  match the server's format so the client can poll for the exact run. */
export function reprocessReason(scope: ReprocessScope, token: string): string {
  return `settings_reprocess_${scope}:${token}`;
}

async function authToken(deps: Deps): Promise<string> {
  if (deps.token) return deps.token;
  const anonKey = deps.anonKey ?? SUPABASE_ANON_KEY;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? anonKey;
}

export async function triggerReprocess(
  scope: ReprocessScope,
  value: string | null,
  deps: Deps = {}
): Promise<ReprocessResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const anonKey = deps.anonKey ?? SUPABASE_ANON_KEY;
  const token = await authToken(deps);
  const url = deps.baseUrl ?? `${SUPABASE_URL}/functions/v1/rfid-reprocess`;

  const base =
    scope === "reader" ? { scope, lpi: value ?? "" }
    : scope === "site" ? { scope, centre_code: value ?? "" }
    : { scope: "global" as const };
  const body = deps.reprocessToken ? { ...base, token: deps.reprocessToken } : base;

  const res = await fetchFn(url, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ReprocessResult>;
  if (!res.ok) {
    return { ok: false, status: data.status ?? `http_${res.status}`, movements_upserted: 0, error: data.error ?? `HTTP ${res.status}` };
  }
  return {
    ok: data.ok ?? false,
    status: data.status ?? "unknown",
    movements_upserted: data.movements_upserted ?? 0,
    reprocess_run_id: data.reprocess_run_id,
    error: data.error,
  };
}

const STATUS_VIEW = "vw_reprocess_status";

/** Fetch the latest audit row for a run reason, or null if it hasn't appeared yet. */
export async function fetchReprocessStatus(reason: string, deps: Deps = {}): Promise<ReprocessStatus | null> {
  const fetchFn = deps.fetchFn ?? fetch;
  const anonKey = deps.anonKey ?? SUPABASE_ANON_KEY;
  const token = await authToken(deps);
  const base = deps.baseUrl ?? `${SUPABASE_URL}/rest/v1/${STATUS_VIEW}`;
  const url = `${base}?reason=eq.${encodeURIComponent(reason)}&order=started_at_utc.desc&limit=1`;
  const res = await fetchFn(url, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const rows = (await res.json().catch(() => [])) as ReprocessStatus[];
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}
