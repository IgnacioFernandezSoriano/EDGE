import { describe, it, expect, vi } from "vitest";
import { triggerReprocess, fetchReprocessStatus, reprocessReason } from "@/lib/reprocess";

const okResp = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

describe("triggerReprocess", () => {
  it("posts scope=reader with lpi", async () => {
    const fetchFn = vi.fn((_url: string, _init?: RequestInit) => okResp({ ok: true, status: "success", movements_upserted: 3, reprocess_run_id: "r1" }));
    const res = await triggerReprocess("reader", "LPI-1", { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess" });
    expect(res.movements_upserted).toBe(3);
    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ scope: "reader", lpi: "LPI-1" });
  });

  it("posts scope=site with centre_code", async () => {
    const fetchFn = vi.fn((_url: string, _init?: RequestInit) => okResp({ ok: true, status: "success", movements_upserted: 0 }));
    await triggerReprocess("site", "centre-abc", { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess" });
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)).toEqual({ scope: "site", centre_code: "centre-abc" });
  });

  it("posts scope=global with no value", async () => {
    const fetchFn = vi.fn((_url: string, _init?: RequestInit) => okResp({ ok: true, status: "success", movements_upserted: 10 }));
    await triggerReprocess("global", null, { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess" });
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)).toEqual({ scope: "global" });
  });

  it("includes the correlation token in the body when given", async () => {
    const fetchFn = vi.fn((_url: string, _init?: RequestInit) => okResp({ ok: true, status: "success", movements_upserted: 1 }));
    await triggerReprocess("global", null, { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess", reprocessToken: "tok-9" });
    expect(JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)).toEqual({ scope: "global", token: "tok-9" });
  });

  it("returns an error result on non-ok HTTP", async () => {
    const fetchFn = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) } as Response));
    const res = await triggerReprocess("global", null, { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://fn/rfid-reprocess" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("boom");
  });
});

describe("reprocessReason", () => {
  it("embeds scope and token", () => {
    expect(reprocessReason("global", "abc")).toBe("settings_reprocess_global:abc");
  });
});

describe("fetchReprocessStatus", () => {
  it("queries the status view by reason and returns the first row", async () => {
    const row = { reprocess_run_id: "r1", status: "success", reads_selected: 10, movements_upserted: 5, incidents_created: 0, error_message: null, reason: "settings_reprocess_global:abc" };
    const fetchFn = vi.fn((_url: string) => Promise.resolve({ ok: true, json: () => Promise.resolve([row]) } as Response));
    const out = await fetchReprocessStatus("settings_reprocess_global:abc", { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://x/rest/v1/vw_reprocess_status" });
    expect(out).toEqual(row);
    expect(fetchFn.mock.calls[0][0]).toContain("reason=eq.settings_reprocess_global%3Aabc");
  });

  it("returns null when no row yet", async () => {
    const fetchFn = vi.fn((_url: string) => Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response));
    const out = await fetchReprocessStatus("r", { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "http://x/rest/v1/vw_reprocess_status" });
    expect(out).toBeNull();
  });
});
