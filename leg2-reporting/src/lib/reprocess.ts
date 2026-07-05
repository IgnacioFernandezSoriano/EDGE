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

type Deps = { fetchFn?: typeof fetch; token?: string; anonKey?: string; baseUrl?: string };

export async function triggerReprocess(
  scope: ReprocessScope,
  value: string | null,
  deps: Deps = {}
): Promise<ReprocessResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const anonKey = deps.anonKey ?? SUPABASE_ANON_KEY;
  let token = deps.token;
  if (!token) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? anonKey;
  }
  const url = deps.baseUrl ?? `${SUPABASE_URL}/functions/v1/rfid-reprocess`;

  const body =
    scope === "reader" ? { scope, lpi: value ?? "" }
    : scope === "site" ? { scope, site_impc_code: value ?? "" }
    : { scope: "global" as const };

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
