import { describe, it, expect } from "vitest";
import { pivotByS9 } from "@/lib/pivot";
import type { RfidMovement } from "@/lib/supabase";

function mov(p: Partial<RfidMovement>): RfidMovement {
  return {
    movement_id: "m", s9_id: "INBOMBJPTYOAAEM60760004100101", tag_id: "G.1UPU.X",
    reader_id: "R1", movement_type: "OUTBOUND", route_country_role: "ORIGIN",
    edi_equivalent: "2320", origin_country_code: "IN", destination_country_code: "JP",
    movement_country_code: "IN", country_sequence_number: 1,
    event_datetime_utc: "2026-07-03T10:00:00+00:00",
    event_datetime_local: "2026-07-03T19:00:00", reader_timezone: "Asia/Kolkata",
    site_impc_code: "INMUBA", centre_code: "INMUBA", site_name: "Mumbai",
    city: "Mumbai", handover_point: true, handover_quality_status: "handover_ok",
    ...p,
  };
}

describe("pivotByS9", () => {
  it("builds dynamic columns and one row per S9 with cells keyed by checkpoint", () => {
    const report = pivotByS9([
      mov({ s9_id: "S1", edi_equivalent: "2320", event_datetime_utc: "2026-07-03T10:00:00+00:00" }),
      mov({ s9_id: "S1", edi_equivalent: "2400", event_datetime_utc: "2026-07-05T10:00:00+00:00" }),
    ]);
    expect(report.columns.map((c) => c.code)).toEqual(["2320", "2400"]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].cells["2320"].event_datetime_utc).toBe("2026-07-03T10:00:00+00:00");
    expect(report.rows[0].cells["2400"].event_datetime_utc).toBe("2026-07-05T10:00:00+00:00");
  });

  it("keeps the earliest movement when a S9 hits the same checkpoint twice", () => {
    const report = pivotByS9([
      mov({ s9_id: "S1", edi_equivalent: "2320", event_datetime_utc: "2026-07-03T12:00:00+00:00" }),
      mov({ s9_id: "S1", edi_equivalent: "2320", event_datetime_utc: "2026-07-03T08:00:00+00:00" }),
    ]);
    expect(report.rows[0].cells["2320"].event_datetime_utc).toBe("2026-07-03T08:00:00+00:00");
  });

  it("derives Po codes and Rte, and collects transits", () => {
    const report = pivotByS9([
      mov({ s9_id: "INBOMBJPTYOAAEM60760004100101", edi_equivalent: "2400", movement_type: "TRANSIT_ENTRY" }),
    ]);
    const row = report.rows[0];
    expect(row.origPoCode).toBe("INBOMB");
    expect(row.destPoCode).toBe("JPTYOA");
    expect(row.rte).toBe("G.1UPU.X");
    expect(row.transits).toHaveLength(1);
  });
});
