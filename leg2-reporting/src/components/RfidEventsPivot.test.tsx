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
  it("renders code-only checkpoint headers with description via title/aria-label", () => {
    render(
      <RfidEventsPivot report={report} timeMode="utc" selectedS9={null} onSelectS9={() => {}} />
    );
    expect(screen.getByText("2320")).toBeInTheDocument();
    expect(screen.getByText("2410")).toBeInTheDocument(); // dynamic col
    expect(screen.queryByText("Exit Outbound AMU")).not.toBeInTheDocument();
    expect(
      document.querySelector('[title="Exit Outbound AMU"]')
    ).toBeInTheDocument();
    expect(
      document.querySelector('[aria-label="Exit Outbound AMU"]')
    ).toBeInTheDocument();
    expect(screen.getByText("2026-07-03T10:00:00+00:00")).toBeInTheDocument();
  });

  it("renders the consolidated first column with s9_id, orig->dest, and rte", () => {
    render(
      <RfidEventsPivot report={report} timeMode="utc" selectedS9={null} onSelectS9={() => {}} />
    );
    const cell = screen.getByText("INBOMBJPTYOAAEM60760004100101").closest("td");
    expect(cell).not.toBeNull();
    expect(cell).toHaveTextContent("INBOMBJPTYOAAEM60760004100101");
    expect(cell).toHaveTextContent("INBOMB → JPTYOA");
    expect(cell).toHaveTextContent("G.1UPU.X");
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
