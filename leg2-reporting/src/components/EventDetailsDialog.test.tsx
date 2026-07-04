import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventDetailsDialog } from "@/components/EventDetailsDialog";
import type { RfidMovement } from "@/lib/supabase";

const movements: RfidMovement[] = [
  {
    movement_id: "M1",
    s9_id: "INBOMBJPTYOAAEM60760004100101",
    tag_id: "TAG1",
    reader_id: "R1",
    movement_type: "OUTBOUND",
    route_country_role: "ORIGIN",
    edi_equivalent: "2320",
    origin_country_code: "IN",
    destination_country_code: "JP",
    movement_country_code: "IN",
    country_sequence_number: 1,
    event_datetime_utc: "2026-07-03T10:00:00+00:00",
    event_datetime_local: "2026-07-03T19:00:00",
    reader_timezone: "Asia/Tokyo",
    site_impc_code: "AAA",
    centre_code: "AAA",
    site_name: "Site A",
    city: "City A",
    handover_point: true,
    handover_quality_status: "OK",
  } as RfidMovement,
];

describe("EventDetailsDialog", () => {
  it("shows the S9 and event rows when open", () => {
    render(
      <EventDetailsDialog
        open={true}
        onOpenChange={vi.fn()}
        s9="INBOMBJPTYOAAEM60760004100101"
        movements={movements}
        timeMode="utc"
      />
    );
    expect(screen.getAllByText(/INBOMBJPTYOAAEM60760004100101/).length).toBeGreaterThan(0);
    expect(screen.getByText("2026-07-03T10:00:00+00:00")).toBeInTheDocument();
  });

  it("does not render content when closed", () => {
    render(
      <EventDetailsDialog
        open={false}
        onOpenChange={vi.fn()}
        s9={null}
        movements={[]}
        timeMode="utc"
      />
    );
    expect(screen.queryByText("2026-07-03T10:00:00+00:00")).not.toBeInTheDocument();
  });
});
