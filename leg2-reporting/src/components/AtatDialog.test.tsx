import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AtatDialog } from "@/components/AtatDialog";

const deps = {
  fetchMovements: vi.fn().mockResolvedValue([]),
  fetchEvents: vi.fn().mockResolvedValue([
    { message: "RESDES", event: "Arrival", date: "Fri,02-05-2026 08:30", location: "JPKWSA",
      transport: null, transport_date: null, reference: null,
      event_datetime_local: "2026-05-02T08:30:00", event_datetime_utc: "2026-05-01T23:30:00+00:00",
      resolved_zone: "Asia/Tokyo", tz_resolved: true },
  ]),
  fetchDetails: vi.fn().mockResolvedValue(null),
  getToken: vi.fn().mockResolvedValue("tok"),
};

describe("AtatDialog", () => {
  it("loads and renders the timeline when open", async () => {
    render(<AtatDialog s9="ABC" open onOpenChange={() => {}} deps={deps} />);
    await waitFor(() => expect(screen.getByText("RESDES")).toBeInTheDocument());
    expect(screen.getByText("ABC")).toBeInTheDocument();
  });

  it("renders nothing visible when closed", () => {
    render(<AtatDialog s9="ABC" open={false} onOpenChange={() => {}} deps={deps} />);
    expect(screen.queryByText("RESDES")).not.toBeInTheDocument();
  });
});
