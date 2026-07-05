import { supabase } from "@/lib/supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface ReaderOperation {
  gate_purpose?: string | null;
  edi_equivalent_inbound?: string | null;
  edi_equivalent_outbound?: string | null;
  handover_point?: boolean;
  reading_direction?: string | null;
  operations_scope?: string | null;
}

export interface ApplyResult {
  ok: boolean;
  status: string;
  movements_upserted: number;
  reprocess_run_id?: string;
  error?: string;
}

type Deps = { fetchFn?: typeof fetch; token?: string; anonKey?: string; baseUrl?: string };

export async function applyReaderEdit(
  lpi: string,
  operation: ReaderOperation,
  deps: Deps = {}
): Promise<ApplyResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const anonKey = deps.anonKey ?? SUPABASE_ANON_KEY;
  let token = deps.token;
  if (!token) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? anonKey;
  }
  const url = deps.baseUrl ?? `${SUPABASE_URL}/functions/v1/apply-reader-edit`;

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ lpi, operation }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ApplyResult>;
  if (!res.ok) {
    return {
      ok: false,
      status: data.status ?? `http_${res.status}`,
      movements_upserted: 0,
      error: data.error ?? `HTTP ${res.status}`,
    };
  }
  return {
    ok: data.ok ?? false,
    status: data.status ?? "unknown",
    movements_upserted: data.movements_upserted ?? 0,
    reprocess_run_id: data.reprocess_run_id,
    error: data.error,
  };
}
