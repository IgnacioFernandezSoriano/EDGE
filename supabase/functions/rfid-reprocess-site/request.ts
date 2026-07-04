export type ParsedReprocessRequest =
  | { ok: true; site_impc_code: string }
  | { ok: false; error: string };

export function parseReprocessRequest(body: unknown): ParsedReprocessRequest {
  const raw = (body as { site_impc_code?: unknown })?.site_impc_code;
  const site = typeof raw === "string" ? raw.trim() : "";
  if (!site) return { ok: false, error: "site_impc_code is required" };
  return { ok: true, site_impc_code: site };
}
