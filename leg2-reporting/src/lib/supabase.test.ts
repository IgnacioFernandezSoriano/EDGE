import { describe, it, expect, vi } from "vitest";
import { buildMovementsUrl, fetchRfidMovements, buildReaderMasterUrl, fetchReaderMaster, READER_MASTER_SELECT_COLS } from "@/lib/supabase";
import {
  buildEdiEventsUrl, fetchEdiEvents, fetchEdiDetails, fetchMovementsByS9,
  EDI_EVENTS_SELECT_COLS,
} from "@/lib/supabase";

describe("reader master select columns", () => {
  it("requests the curated Operation + Identification fields, never product/nms", () => {
    for (const c of [
      "edi_equivalent_inbound", "edi_equivalent_outbound", "operations_scope",
      "facility_type", "city", "operator",
    ]) {
      expect(READER_MASTER_SELECT_COLS).toContain(c);
    }
    expect(READER_MASTER_SELECT_COLS).not.toContain("product");
    expect(READER_MASTER_SELECT_COLS).not.toContain("nms_reader_url");
  });
});

const BASE = "https://x.supabase.co/rest/v1/vw_quicksight_rfid_report_movements";
const READER_BASE = "https://x.supabase.co/rest/v1/vw_reader_master";

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

describe("buildReaderMasterUrl", () => {
  it("selects from vw_reader_master, orders by lpi, and paginates", () => {
    const url = buildReaderMasterUrl(READER_BASE, { offset: 0, limit: 1000 });
    expect(url).toContain("/vw_reader_master");
    expect(url).toContain("order=lpi");
    expect(url).toContain("offset=0");
    expect(url).toContain("limit=1000");
    expect(url).toContain("select=lpi%2Cgate_id%2Cgate_name");
  });
});

describe("fetchReaderMaster", () => {
  it("concatenates pages until a short page ends pagination", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ lpi: `R${i}` }));
    const page2 = [{ lpi: "Rlast" }];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, json: async () => page2 });

    const rows = await fetchReaderMaster({
      fetchFn: fetchFn as unknown as typeof fetch,
      token: "t",
      anonKey: "k",
      baseUrl: READER_BASE,
    });

    expect(rows).toHaveLength(1001);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws on non-ok response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, text: async () => "no grant" });
    await expect(
      fetchReaderMaster({
        fetchFn: fetchFn as unknown as typeof fetch,
        token: "t",
        anonKey: "k",
        baseUrl: READER_BASE,
      })
    ).rejects.toThrow(/403/);
  });
});

const EDI_BASE = "https://x.supabase.co/rest/v1/edi_events";
const DETAIL_BASE = "https://x.supabase.co/rest/v1/edi_details";
const MOV_BASE = "https://x.supabase.co/rest/v1/vw_quicksight_rfid_report_movements";

describe("buildEdiEventsUrl", () => {
  it("filters by s9code and selects the event columns", () => {
    const url = buildEdiEventsUrl(EDI_BASE, { s9: "ABC", offset: 0, limit: 1000 });
    expect(url).toContain("s9code=eq.ABC");
    expect(url).toContain("select=");
    expect(EDI_EVENTS_SELECT_COLS).toContain("transport_date");
  });

  it("selects the canonical-UTC columns from the tz view", () => {
    const url = buildEdiEventsUrl("https://x.supabase.co/rest/v1/vw_edi_events_tz", { s9: "ABC", offset: 0, limit: 1000 });
    expect(EDI_EVENTS_SELECT_COLS).toContain("event_datetime_utc");
    expect(EDI_EVENTS_SELECT_COLS).toContain("resolved_zone");
    expect(EDI_EVENTS_SELECT_COLS).toContain("tz_resolved");
    expect(url).toContain("s9code=eq.ABC");
  });
});

describe("fetchEdiEvents", () => {
  it("returns the rows for the s9", async () => {
    const rows = [{ message: "RESDES" }];
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
    const out = await fetchEdiEvents("ABC", {
      fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: EDI_BASE,
    });
    expect(out).toEqual(rows);
    expect(fetchFn.mock.calls[0][0]).toContain("s9code=eq.ABC");
  });

  it("throws on non-ok response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "no grant" });
    await expect(fetchEdiEvents("ABC", {
      fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: EDI_BASE,
    })).rejects.toThrow(/403/);
  });
});

describe("fetchEdiDetails", () => {
  it("returns the single row or null", async () => {
    const withRow = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ s9code: "ABC", items: "12" }] });
    expect(await fetchEdiDetails("ABC", {
      fetchFn: withRow as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: DETAIL_BASE,
    })).toEqual({ s9code: "ABC", items: "12" });

    const empty = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    expect(await fetchEdiDetails("ABC", {
      fetchFn: empty as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: DETAIL_BASE,
    })).toBeNull();
  });
});

describe("fetchMovementsByS9", () => {
  it("filters the movements view by s9_id", async () => {
    const rows = [{ movement_id: "m1" }];
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
    const out = await fetchMovementsByS9("ABC", {
      fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "k", baseUrl: MOV_BASE,
    });
    expect(out).toEqual(rows);
    expect(fetchFn.mock.calls[0][0]).toContain("s9_id=eq.ABC");
  });
});

import {
  buildSitesUrl, fetchSites, SITES_SELECT_COLS,
  buildReaderOptionsUrl, fetchReaderOptions, READER_OPTIONS_SELECT_COLS,
} from "@/lib/supabase";

describe("buildSitesUrl", () => {
  it("selects from the sites (centre) picker view ordered by name", () => {
    const url = buildSitesUrl("https://x.supabase.co/rest/v1/vw_reprocess_sites", { offset: 0, limit: 1000 });
    expect(url).toContain("/vw_reprocess_sites");
    expect(url).toContain(`select=${encodeURIComponent(SITES_SELECT_COLS)}`);
    expect(url).toContain("order=site_name");
  });
});

describe("fetchSites", () => {
  it("returns rows from a single page", async () => {
    const rows = [{ centre_code: "centre-abc", site_name: "TECA Guarulhos", country_code: "BR" }];
    const fetchFn = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve(rows) } as Response));
    const out = await fetchSites({ fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "https://x.supabase.co/rest/v1/vw_reprocess_sites" });
    expect(out).toEqual(rows);
  });
});

describe("buildReaderOptionsUrl", () => {
  it("selects from the readers picker view ordered by reader_id", () => {
    const url = buildReaderOptionsUrl("https://x.supabase.co/rest/v1/vw_reprocess_readers", { offset: 0, limit: 1000 });
    expect(url).toContain("/vw_reprocess_readers");
    expect(url).toContain(`select=${encodeURIComponent(READER_OPTIONS_SELECT_COLS)}`);
    expect(url).toContain("order=reader_id");
  });
});

describe("fetchReaderOptions", () => {
  it("returns rows from a single page", async () => {
    const rows = [{ reader_id: "LPI-1", facility_name: "Mumbai", site_impc_code: "INMUBA" }];
    const fetchFn = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve(rows) } as Response));
    const out = await fetchReaderOptions({ fetchFn: fetchFn as unknown as typeof fetch, token: "t", anonKey: "a", baseUrl: "https://x.supabase.co/rest/v1/vw_reprocess_readers" });
    expect(out).toEqual(rows);
  });
});
