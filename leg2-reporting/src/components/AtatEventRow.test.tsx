import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AtatEventRow } from "@/components/AtatEventRow";
import type { AtatEvent } from "@/lib/atat";

const resolved: AtatEvent = {
  source: "EDI", code: "RESDES", label: "Dispatch arrival at IOE",
  location: "JPKWSA", direction: "inbound", fields: [{ label: "Transport", value: "SQ0612" }],
  eventDatetimeUtc: "2026-05-01T23:30:00+00:00", eventDatetimeLocal: "2026-05-02T08:30:00",
  localZone: "Asia/Tokyo", tzResolved: true, rawDate: "Fri,02-05-2026 08:30",
  sortKey: Date.parse("2026-05-01T23:30:00+00:00"),
};

describe("AtatEventRow", () => {
  it("shows the UTC time and a UTC badge in utc mode", () => {
    render(<AtatEventRow event={resolved} mode="utc" />);
    expect(screen.getByText("01 May 2026 (Fri), 23:30:00")).toBeInTheDocument();
    expect(screen.getByText("UTC", { selector: "[data-role='zone']" })).toBeInTheDocument();
  });

  it("shows the local time and the zone badge in local mode", () => {
    render(<AtatEventRow event={resolved} mode="local" />);
    expect(screen.getByText("02 May 2026 (Sat), 08:30:00")).toBeInTheDocument();
    expect(screen.getByText("Asia/Tokyo", { selector: "[data-role='zone']" })).toBeInTheDocument();
  });

  it("flags unresolved EDI as 'no TZ' and never fabricates a UTC", () => {
    const unresolved: AtatEvent = {
      ...resolved, eventDatetimeUtc: null, localZone: null, tzResolved: false,
    };
    render(<AtatEventRow event={unresolved} mode="utc" />);
    // falls back to the local wall time, flagged no TZ
    expect(screen.getByText("02 May 2026 (Sat), 08:30:00")).toBeInTheDocument();
    expect(screen.getByText("no TZ", { selector: "[data-role='zone']" })).toBeInTheDocument();
  });

  it("does not render a UTC-time inline field", () => {
    render(<AtatEventRow event={resolved} mode="utc" />);
    expect(screen.queryByText(/UTC time/)).not.toBeInTheDocument();
  });
});
