export type ParsedReprocessRequest =
  | { ok: true; scope: "reader"; lpi: string }
  | { ok: true; scope: "site"; centre_code: string }
  | { ok: true; scope: "global" }
  | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function parseReprocessRequest(body: unknown): ParsedReprocessRequest {
  const b = (body ?? {}) as { scope?: unknown; lpi?: unknown; centre_code?: unknown };
  if (b.scope === "global") return { ok: true, scope: "global" };
  if (b.scope === "reader") {
    const lpi = str(b.lpi);
    return lpi ? { ok: true, scope: "reader", lpi } : { ok: false, error: "lpi is required for scope=reader" };
  }
  if (b.scope === "site") {
    const centre = str(b.centre_code);
    return centre
      ? { ok: true, scope: "site", centre_code: centre }
      : { ok: false, error: "centre_code is required for scope=site" };
  }
  return { ok: false, error: "scope must be one of reader|site|global" };
}
