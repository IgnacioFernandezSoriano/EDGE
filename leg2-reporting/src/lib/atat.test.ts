import { describe, it, expect } from "vitest";
import { parseEdiDate, buildAtatTimeline, type AtatEvent } from "@/lib/atat";
import type { RfidMovement } from "@/lib/supabase";

describe("parseEdiDate", () => {
  it("parses the day-prefixed DD-MM-YYYY HH:MM format", () => {
    const { date, display } = parseEdiDate("Fri,01-05-2026 18:26");
    expect(display).toBe("Fri,01-05-2026 18:26");
    expect(date).not.toBeNull();
    // 2026-05-01 18:26 as a UTC-built instant
    expect(date!.getTime()).toBe(Date.UTC(2026, 4, 1, 18, 26));
  });

  it("parses ISO date-only with midnight time", () => {
    const { date } = parseEdiDate("2026-07-01");
    expect(date!.getTime()).toBe(Date.UTC(2026, 6, 1, 0, 0));
  });

  it("returns null date for unparseable input, keeping the raw display", () => {
    const { date, display } = parseEdiDate("not a date");
    expect(date).toBeNull();
    expect(display).toBe("not a date");
  });

  it("handles null and empty input", () => {
    expect(parseEdiDate(null)).toEqual({ date: null, display: "" });
    expect(parseEdiDate("   ")).toEqual({ date: null, display: "" });
  });
});

function mov(partial: Partial<RfidMovement>): RfidMovement {
  return {
    movement_id: "m", s9_id: "S", tag_id: "T", reader_id: "R",
    movement_type: "INBOUND", route_country_role: null, edi_equivalent: "2400",
    origin_country_code: null, destination_country_code: null,
    movement_country_code: null, country_sequence_number: null,
    event_datetime_utc: "2026-05-02T00:00:00.000",
    event_datetime_local: "2026-05-02T09:00:00.000",
    reader_timezone: "Asia/Tokyo", site_impc_code: "JPKWSA", centre_code: "JPKWSA",
    site_name: "Kawasaki", city: "Kawasaki", country_code: "JP",
    handover_point: false, handover_quality_status: null, ...partial,
  };
}
function edi(partial: Record<string, string | null>) {
  return {
    message: null, event: null, date: null, location: null,
    transport: null, transport_date: null, reference: null, ...partial,
  };
}

describe("buildAtatTimeline", () => {
  it("merges RFID + EDI and sorts ascending by naive wall-clock", () => {
    const events = buildAtatTimeline(
      [mov({ edi_equivalent: "2400", event_datetime_local: "2026-05-02T09:00:00.000" })],
      [edi({ message: "PREDES", event: "Dispatch close", date: "Fri,01-05-2026 18:26" })]
    );
    expect(events.map((e) => e.code)).toEqual(["PREDES", "2400"]);
    expect(events[0].source).toBe("EDI");
    expect(events[1].source).toBe("RFID");
  });

  it("dedups an outbound EDI code to its latest occurrence", () => {
    const events = buildAtatTimeline([], [
      edi({ message: "CARDIT", date: "Fri,01-05-2026 10:00" }),
      edi({ message: "CARDIT", date: "Fri,01-05-2026 20:00" }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].rawDate).toBe("Fri,01-05-2026 20:00");
  });

  it("dedups an inbound EDI code to its earliest occurrence", () => {
    const events = buildAtatTimeline([], [
      edi({ message: "RESDIT6", date: "Fri,01-05-2026 20:00" }),
      edi({ message: "RESDIT6", date: "Fri,01-05-2026 10:00" }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].rawDate).toBe("Fri,01-05-2026 10:00");
  });

  it("puts events with unparseable dates last, stably", () => {
    const events = buildAtatTimeline([], [
      edi({ message: "RESDES", date: "bad" }),
      edi({ message: "RESCON", date: "2026-05-01" }),
    ]);
    expect(events.map((e) => e.code)).toEqual(["RESCON", "RESDES"]);
  });

  it("includes only non-empty fields, labeled, per source", () => {
    const [e] = buildAtatTimeline([], [
      edi({ message: "RESDES", event: "Arrival", date: "2026-05-01", location: "KRSELB", reference: "X", transport: null }),
    ]);
    const labels = e.fields.map((f) => f.label);
    expect(labels).toContain("Location");
    expect(labels).toContain("Reference");
    expect(labels).not.toContain("Transport"); // null -> omitted
  });

  it("labels RFID rows with the checkpoint name and carries inline reader fields", () => {
    const [e] = buildAtatTimeline([mov({ edi_equivalent: "2400", reader_id: "R9", tag_id: "TAG1" })], []);
    expect(e.label).toBe("Entry Inbound AMU");
    const kv = Object.fromEntries(e.fields.map((f) => [f.label, f.value]));
    expect(kv["Reader"]).toBe("R9");
    expect(kv["RFID Tag"]).toBe("TAG1");
  });
});
