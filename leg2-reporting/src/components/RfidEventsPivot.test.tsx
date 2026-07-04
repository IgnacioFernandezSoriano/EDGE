import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RfidEventsPivot } from "@/components/RfidEventsPivot";
import type { RfidEventsReport } from "@/lib/pivot";

const report: RfidEventsReport = {
  columns: [
    { code: "2320", label: "Exit Outbound AMU" },
    { code: "2410", label: "Exit Inbound AMU" },
  ],
  rows: [
    {
      s9_id: "INBOMBJPTYOAAEM60760004100101",
      origPoCode: "INBOMB",
      destPoCode: "JPTYOA",
      rte: "G.1UPU.X",
      cells: {
        "2320": {
          event_datetime_utc: "2026-07-03T10:00:00+00:00",
          event_datetime_local: "2026-07-03T19:00:00",
        } as any,
      },
      transits: [],
      all: [],
    },
  ],
};

describe("RfidEventsPivot", () => {
  it("renders a dynamic column per checkpoint present (incl. new ones)", () => {
    render(
      <RfidEventsPivot report={report} timeMode="utc" selectedS9={null} onSelectS9={() => {}} />
    );
    expect(screen.getByText("Exit Outbound AMU")).toBeInTheDocument();
    expect(screen.getByText("Exit Inbound AMU")).toBeInTheDocument(); // dynamic col
    expect(screen.getByText("2026-07-03T10:00:00+00:00")).toBeInTheDocument();
  });

  it("fires onSelectS9 when a row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <RfidEventsPivot report={report} timeMode="utc" selectedS9={null} onSelectS9={onSelect} />
    );
    fireEvent.click(screen.getByText("INBOMBJPTYOAAEM60760004100101"));
    expect(onSelect).toHaveBeenCalledWith("INBOMBJPTYOAAEM60760004100101");
  });
});
