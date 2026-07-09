import { describe, it, expect, vi } from "vitest";
import {
  buildEventPairProductsBody,
  fetchEventPairProducts,
  type AvailableProduct,
} from "@/lib/supabase";

describe("buildEventPairProductsBody", () => {
  it("maps params to RPC args and empty country -> null", () => {
    expect(
      buildEventPairProductsBody({ from: "2026-01-01", to: "2026-03-31", originCountry: "", destCountry: "" })
    ).toEqual({ p_from: "2026-01-01", p_to: "2026-03-31", p_origin_country: null, p_dest_country: null });
  });

  it("passes through non-empty countries", () => {
    expect(
      buildEventPairProductsBody({ from: "2026-01-01", to: "2026-03-31", originCountry: "IN", destCountry: "JP" })
    ).toEqual({ p_from: "2026-01-01", p_to: "2026-03-31", p_origin_country: "IN", p_dest_country: "JP" });
  });
});

describe("fetchEventPairProducts", () => {
  it("POSTs to the RPC and returns the rows", async () => {
    const rows: AvailableProduct[] = [
      { code: "A", name: "Airmail / Priority" },
      { code: null, name: null },
    ];
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
    const out = await fetchEventPairProducts(
      { from: "2026-01-01", to: "2026-03-31", originCountry: "", destCountry: "" },
      { fetchFn, baseUrl: "http://x/rpc/event_pair_products" }
    );
    expect(out).toEqual(rows);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("http://x/rpc/event_pair_products");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      p_from: "2026-01-01", p_to: "2026-03-31", p_origin_country: null, p_dest_country: null,
    });
  });

  it("throws on a non-ok response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    await expect(
      fetchEventPairProducts(
        { from: "a", to: "b", originCountry: "", destCountry: "" },
        { fetchFn, baseUrl: "http://x/rpc/event_pair_products" }
      )
    ).rejects.toThrow(/event_pair_products failed: 500/);
  });
});
