import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AtatView } from "@/components/AtatView";
import type { AtatEvent } from "@/lib/atat";

const ev: AtatEvent = {
  source: "EDI", code: "RESDES", label: "Arrival", location: "JPKWSA", direction: "inbound",
  fields: [], eventDatetimeUtc: "2026-05-01T23:30:00+00:00", eventDatetimeLocal: "2026-05-02T08:30:00",
  localZone: "Asia/Tokyo", tzResolved: true, rawDate: "Fri,02-05-2026 08:30",
  sortKey: Date.parse("2026-05-01T23:30:00+00:00"),
};

describe("AtatView", () => {
  it("defaults to UTC and toggles to Local", () => {
    render(<AtatView s9="ABC" detail={null} events={[ev]} />);
    expect(screen.getByText("01 May 2026 (Fri), 23:30:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("02 May 2026 (Sat), 08:30:00")).toBeInTheDocument();
  });

  it("honors initialMode", () => {
    render(<AtatView s9="ABC" detail={null} events={[ev]} initialMode="local" />);
    expect(screen.getByText("02 May 2026 (Sat), 08:30:00")).toBeInTheDocument();
  });

  it("shows the empty state with no events", () => {
    render(<AtatView s9="ABC" detail={null} events={[]} />);
    expect(screen.getByText(/No events found/i)).toBeInTheDocument();
  });
});
