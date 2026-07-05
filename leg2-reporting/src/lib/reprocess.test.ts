import { describe, it, expect, vi } from "vitest";
import { triggerReprocess } from "@/lib/reprocess";

const okResp = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

describe("triggerReprocess", () => {
  it("posts scope=reader with lpi", async () => {
    const fetchFn = vi.fn(() => okResp({ ok: true, status: "success", movements_upserted: 3, reprocess_run_id: "r1" }));
    const res = await triggerReprocess("reader", "LPI-1", { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess" });
    expect(res.movements_upserted).toBe(3);
    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ scope: "reader", lpi: "LPI-1" });
  });

  it("posts scope=site with site_impc_code", async () => {
    const fetchFn = vi.fn(() => okResp({ ok: true, status: "success", movements_upserted: 0 }));
    await triggerReprocess("site", "INMUBA", { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess" });
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)).toEqual({ scope: "site", site_impc_code: "INMUBA" });
  });

  it("posts scope=global with no value", async () => {
    const fetchFn = vi.fn(() => okResp({ ok: true, status: "success", movements_upserted: 10 }));
    await triggerReprocess("global", null, { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess" });
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)).toEqual({ scope: "global" });
  });

  it("returns an error result on non-ok HTTP", async () => {
    const fetchFn = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) } as Response));
    const res = await triggerReprocess("global", null, { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("boom");
  });
});
