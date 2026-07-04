import { describe, it, expect, vi } from "vitest";
import { reprocessSite } from "@/lib/reprocess";

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}
function errResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as Response;
}

describe("reprocessSite", () => {
  it("POSTs the site_impc_code with the bearer token and returns the parsed result", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(okResponse({ ok: true, status: "success", movements_upserted: 3 }));
    const res = await reprocessSite("INMUBA", {
      fetchFn,
      token: "tok",
      anonKey: "anon",
      baseUrl: "https://x/functions/v1/rfid-reprocess-site",
    });
    expect(res).toEqual({ ok: true, status: "success", movements_upserted: 3 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://x/functions/v1/rfid-reprocess-site");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ site_impc_code: "INMUBA" });
  });

  it("returns ok:false with an error on a non-2xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(errResponse(500, { error: "boom" }));
    const res = await reprocessSite("INMUBA", {
      fetchFn,
      token: "tok",
      anonKey: "anon",
      baseUrl: "https://x/functions/v1/rfid-reprocess-site",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("boom");
  });
});
