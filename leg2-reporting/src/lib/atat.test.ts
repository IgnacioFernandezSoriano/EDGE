import { describe, it, expect } from "vitest";
import { buildAtatTimeline } from "@/lib/atat";
import type { RfidMovement } from "@/lib/supabase";

function mov(p: Partial<RfidMovement>): RfidMovement {
  return {
    movement_id: "m", s9_id: "S", tag_id: "T", reader_id: "R", movement_type: "INBOUND",
    route_country_role: null, edi_equivalent: "2400", origin_country_code: null,
    destination_country_code: null, movement_country_code: null, country_sequence_number: null,
    event_datetime_utc: "2026-05-02T00:00:00.000+00:00", event_datetime_local: "2026-05-02T09:00:00.000",
    reader_timezone: "Asia/Tokyo", site_impc_code: "JPKWSA", centre_code: "JPKWSA",
    site_name: "Kawasaki", city: "Kawasaki", country_code: "JP", handover_point: false,
    handover_quality_status: null, ...p,
  };
}
function edi(p: Record<string, unknown>) {
  return {
    message: null, event: null, date: null, location: null, transport: null,
    transport_date: null, reference: null, event_datetime_local: null,
    event_datetime_utc: null, resolved_zone: null, tz_resolved: false, ...p,
  };
}

describe("buildAtatTimeline", () => {
  it("orders by canonical UTC across sources", () => {
    // RFID at UTC 00:00; EDI resolved at UTC 01:00 -> EDI after RFID by true UTC
    const events = buildAtatTimeline(
      [mov({ code: undefined, event_datetime_utc: "2026-05-02T00:00:00+00:00" } as never)],
      [edi({ message: "RESDES", event: "Arrival", event_datetime_utc: "2026-05-02T01:00:00+00:00",
             event_datetime_local: "2026-05-02T10:00:00", resolved_zone: "Asia/Tokyo", tz_resolved: true })]
    );
    expect(events.map((e) => e.source)).toEqual(["RFID", "EDI"]);
    expect(events[1].tzResolved).toBe(true);
    expect(events[1].localZone).toBe("Asia/Tokyo");
  });

  it("dedups an outbound EDI code to its latest UTC occurrence", () => {
    const events = buildAtatTimeline([], [
      edi({ message: "CARDIT", event_datetime_utc: "2026-05-01T10:00:00+00:00", tz_resolved: true, resolved_zone: "UTC", event_datetime_local: "2026-05-01T10:00:00" }),
      edi({ message: "CARDIT", event_datetime_utc: "2026-05-01T20:00:00+00:00", tz_resolved: true, resolved_zone: "UTC", event_datetime_local: "2026-05-01T20:00:00" }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].eventDatetimeUtc).toBe("2026-05-01T20:00:00+00:00");
  });

  it("falls back to naive local ordering when UTC is unresolved, sorts nulls last", () => {
    const events = buildAtatTimeline([], [
      edi({ message: "RESDES", event_datetime_local: "2026-05-01T09:00:00", tz_resolved: false }),
      edi({ message: "RESCON", date: "bad", event_datetime_local: null, tz_resolved: false }),
    ]);
    expect(events.map((e) => e.code)).toEqual(["RESDES", "RESCON"]);
    expect(events[0].tzResolved).toBe(false);
  });

  it("marks unresolved EDI and never invents a UTC", () => {
    const [e] = buildAtatTimeline([], [
      edi({ message: "RESDES", event_datetime_local: "2026-05-01T09:00:00", resolved_zone: null, tz_resolved: false }),
    ]);
    expect(e.eventDatetimeUtc).toBeNull();
    expect(e.tzResolved).toBe(false);
  });

  it("carries inline reader fields for RFID but not a UTC-time field", () => {
    const [e] = buildAtatTimeline([mov({ reader_id: "R9", tag_id: "TAG1" })], []);
    const labels = e.fields.map((f) => f.label);
    expect(labels).toContain("Reader");
    expect(labels).not.toContain("UTC time");
  });
});
