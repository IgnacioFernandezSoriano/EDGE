import { describe, it, expect, vi } from "vitest";
import { applyReaderEdit } from "@/lib/readerEdit";

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}
function errResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as Response;
}

describe("applyReaderEdit", () => {
  it("POSTs { lpi, operation } with the bearer token and returns the result", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(okResponse({ ok: true, status: "success", movements_upserted: 1 }));
    const res = await applyReaderEdit(
      "J11D1",
      { role: "AMU", handover_point: true },
      { fetchFn, token: "tok", anonKey: "anon", baseUrl: "https://x/functions/v1/apply-reader-edit" }
    );
    expect(res).toEqual({ ok: true, status: "success", movements_upserted: 1 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://x/functions/v1/apply-reader-edit");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({
      lpi: "J11D1",
      operation: { role: "AMU", handover_point: true },
    });
  });

  it("returns ok:false with an error on a non-2xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(errResponse(502, { error: "gms down" }));
    const res = await applyReaderEdit("J11D1", { gate_purpose: "x" }, {
      fetchFn, token: "tok", anonKey: "anon", baseUrl: "https://x/functions/v1/apply-reader-edit",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("gms down");
  });
});
