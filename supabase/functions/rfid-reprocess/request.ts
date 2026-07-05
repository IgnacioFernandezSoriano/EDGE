export type ParsedReprocessRequest =
  | { ok: true; scope: "reader"; lpi: string }
  | { ok: true; scope: "site"; site_impc_code: string }
  | { ok: true; scope: "global" }
  | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function parseReprocessRequest(body: unknown): ParsedReprocessRequest {
  const b = (body ?? {}) as { scope?: unknown; lpi?: unknown; site_impc_code?: unknown };
  if (b.scope === "global") return { ok: true, scope: "global" };
  if (b.scope === "reader") {
    const lpi = str(b.lpi);
    return lpi ? { ok: true, scope: "reader", lpi } : { ok: false, error: "lpi is required for scope=reader" };
  }
  if (b.scope === "site") {
    const site = str(b.site_impc_code);
    return site ? { ok: true, scope: "site", site_impc_code: site } : { ok: false, error: "site_impc_code is required for scope=site" };
  }
  return { ok: false, error: "scope must be one of reader|site|global" };
}
