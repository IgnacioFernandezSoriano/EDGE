import { describe, it, expect } from "vitest";
import {
  buildEventPairMatrixBody,
  buildEventPairDetailUrl,
  buildExclusionDeleteUrl,
} from "@/lib/supabase";

describe("buildEventPairMatrixBody", () => {
  it("maps params to RPC arg names", () => {
    expect(
      buildEventPairMatrixBody({ from: "2026-01-01", to: "2026-03-31", product: "A", granularity: "country" })
    ).toEqual({ p_from: "2026-01-01", p_to: "2026-03-31", p_product: "A", p_granularity: "country" });
  });
});

describe("buildEventPairDetailUrl", () => {
  const base = "https://x.supabase.co/rest/v1/vw_event_pair_gaps_s9";
  it("filters by 6-char office columns when granularity=centre", () => {
    const u = buildEventPairDetailUrl(base, {
      origin: "INBOMB", destination: "JPTYOA", comparisonKey: "ho_rescon",
      product: "all", from: "2026-01-01", to: "2026-03-31", granularity: "centre",
      offset: 0, limit: 1000,
    });
    expect(u).toContain("origin_office=eq.INBOMB");
    expect(u).toContain("dest_office=eq.JPTYOA");
    expect(u).toContain("comparison_key=eq.ho_rescon");
    expect(u).not.toContain("product="); // 'all' -> no product filter
  });
  it("requests the new detail gate/site columns", () => {
    const u = buildEventPairDetailUrl(base, {
      origin: "INBOMB", destination: "JPTYOA", comparisonKey: "ho_rescon",
      product: "all", from: "2026-01-01", to: "2026-03-31", granularity: "centre",
      offset: 0, limit: 1000,
    });
    const select = decodeURIComponent(u);
    expect(select).toContain("origin_gate");
    expect(select).toContain("dest_site");
  });
  it("filters by 2-char country columns when granularity=country", () => {
    const u = buildEventPairDetailUrl(base, {
      origin: "IN", destination: "JP", comparisonKey: "ho_rescon",
      product: "__none__", from: "2026-01-01", to: "2026-03-31", granularity: "country",
      offset: 0, limit: 1000,
    });
    expect(u).toContain("origin_country=eq.IN");
    expect(u).toContain("dest_country=eq.JP");
    expect(u).toContain("product=is.null"); // __none__ -> null products
  });
  it("filters by explicit product and by rfid_utc range", () => {
    const u = buildEventPairDetailUrl(base, {
      origin: "IN", destination: "JP", comparisonKey: "ho_rescon",
      product: "A", from: "2026-01-01", to: "2026-03-31", granularity: "country",
      offset: 0, limit: 1000,
    });
    expect(u).toContain("product=eq.A");
    expect(decodeURIComponent(u)).toContain("rfid_utc=gte.2026-01-01T00:00:00");
    expect(decodeURIComponent(u)).toContain("rfid_utc=lte.2026-03-31T23:59:59");
  });
});

describe("buildExclusionDeleteUrl", () => {
  it("builds a filtered DELETE url", () => {
    const u = buildExclusionDeleteUrl(
      "https://x.supabase.co/rest/v1/event_pair_exclusion", "S9X", "ho_rescon"
    );
    expect(u).toContain("s9code=eq.S9X");
    expect(u).toContain("comparison_key=eq.ho_rescon");
  });
});
