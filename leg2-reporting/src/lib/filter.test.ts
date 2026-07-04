import { describe, it, expect } from "vitest";
import { filterMovements, distinctCountries, type ReportFilterState } from "@/lib/filter";
import type { RfidMovement } from "@/lib/supabase";

function mov(p: Partial<RfidMovement>): RfidMovement {
  return {
    movement_id: "m", s9_id: "S1", tag_id: "G.1UPU.X", reader_id: "R1",
    movement_type: "OUTBOUND", route_country_role: "ORIGIN", edi_equivalent: "2320",
    origin_country_code: "IN", destination_country_code: "JP",
    movement_country_code: "IN", country_sequence_number: 1,
    event_datetime_utc: "2026-07-03T10:00:00+00:00",
    event_datetime_local: "2026-07-03T19:00:00", reader_timezone: "Asia/Kolkata",
    site_impc_code: "INMUBA", centre_code: "INMUBA", site_name: "Mumbai",
    city: "Mumbai", handover_point: true, handover_quality_status: "handover_ok",
    ...p,
  };
}

const base: ReportFilterState = {
  tab: "outbound", originCountry: null, destCountry: null, s9Query: "", rteQuery: "",
};

describe("filterMovements", () => {
  it("outbound tab keeps OUTBOUND and TRANSIT_EXIT", () => {
    const movs = [
      mov({ movement_type: "OUTBOUND" }),
      mov({ movement_type: "TRANSIT_EXIT" }),
      mov({ movement_type: "INBOUND" }),
    ];
    expect(filterMovements(movs, base)).toHaveLength(2);
  });

  it("filters by origin/dest country and S9/Rte substring", () => {
    const movs = [
      mov({ s9_id: "AAA111", tag_id: "G.1UPU.KEEP", origin_country_code: "IN" }),
      mov({ s9_id: "BBB222", tag_id: "G.1UPU.SKIP", origin_country_code: "BR" }),
    ];
    expect(filterMovements(movs, { ...base, originCountry: "IN" })).toHaveLength(1);
    expect(filterMovements(movs, { ...base, s9Query: "aaa" })).toHaveLength(1);
    expect(filterMovements(movs, { ...base, rteQuery: "keep" })).toHaveLength(1);
  });
});

describe("distinctCountries", () => {
  it("returns sorted distinct non-null codes", () => {
    const movs = [
      mov({ origin_country_code: "JP" }),
      mov({ origin_country_code: "IN" }),
      mov({ origin_country_code: "IN" }),
      mov({ origin_country_code: null }),
    ];
    expect(distinctCountries(movs, "origin_country_code")).toEqual(["IN", "JP"]);
  });
});
