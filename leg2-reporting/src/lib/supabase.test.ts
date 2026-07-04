import { describe, it, expect, vi } from "vitest";
import { buildMovementsUrl, fetchRfidMovements } from "@/lib/supabase";

const BASE = "https://x.supabase.co/rest/v1/vw_quicksight_rfid_report_movements";

describe("buildMovementsUrl", () => {
  it("orders by event_datetime_utc desc and paginates", () => {
    const url = buildMovementsUrl(BASE, { offset: 0, limit: 1000 });
    expect(url).toContain("order=event_datetime_utc.desc");
    expect(url).toContain("offset=0");
    expect(url).toContain("limit=1000");
    expect(url).toContain("select=");
  });

  it("adds date filters when present", () => {
    const url = buildMovementsUrl(BASE, {
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      offset: 0,
      limit: 1000,
    });
    expect(url).toContain("event_datetime_utc=gte.2026-01-01T00%3A00%3A00");
    expect(url).toContain("event_datetime_utc=lte.2026-01-31T23%3A59%3A59");
  });
});

describe("fetchRfidMovements", () => {
  it("concatenates pages until a short page ends pagination", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ movement_id: `a${i}` }));
    const page2 = [{ movement_id: "b0" }];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, json: async () => page2 });

    const rows = await fetchRfidMovements(
      {},
      { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: BASE }
    );

    expect(rows).toHaveLength(1001);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws on non-ok response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, text: async () => "no grant" });
    await expect(
      fetchRfidMovements(
        {},
        { fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: BASE }
      )
    ).rejects.toThrow(/403/);
  });
});
