import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RfidEventsPivot } from "@/components/RfidEventsPivot";
import type { RfidEventsReport } from "@/lib/pivot";
import type { ReaderMaster } from "@/lib/supabase";

const report: RfidEventsReport = {
  columns: [
    { code: "2320", label: "Exit Outbound AMU", count: 1234 },
    { code: "2410", label: "Exit Inbound AMU", count: 5 },
  ],
  rows: [
    {
      s9_id: "INBOMBJPTYOAAEM60760004100101",
      origPoCode: "INBOMB",
      destPoCode: "JPTYOA",
      rte: "G.1UPU.X",
      cells: {
        "2320": {
          reader_id: "R1",
          site_name: "Kawasaki Higashi OE",
          event_datetime_utc: "2026-07-03T10:00:00+00:00",
          event_datetime_local: "2026-07-03T19:00:00",
        } as any,
      },
      noEventCodeOutbound: [],
      noEventCodeInbound: [],
      transits: [],
      all: [],
    },
  ],
  hasNoEventCodeOutbound: false,
  hasNoEventCodeInbound: false,
};

const readerMap = new Map<string, ReaderMaster>([
  [
    "R1",
    {
      lpi: "R1",
      gate_id: "G1",
      gate_name: "MT",
      gate_purpose: "exit",
      reading_direction: "out",
      facility_name: "Facility A",
      site_id: "S1",
      reader_country_code: "IN",
      handover_point: true,
    },
  ],
]);

describe("RfidEventsPivot", () => {
  it("renders code-only checkpoint headers with description via title/aria-label", () => {
    render(
      <RfidEventsPivot
        report={report}
        timeMode="utc"
        selectedS9={null}
        onSelectS9={() => {}}
        onSelectReader={() => {}}
        readerMap={readerMap}
      />
    );
    expect(screen.getByText("2320")).toBeInTheDocument();
    expect(screen.getByText("2410")).toBeInTheDocument(); // dynamic col
    expect(screen.getByText("1,234")).toBeInTheDocument(); // count under code
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.queryByText("Exit Outbound AMU")).not.toBeInTheDocument();
    expect(
      document.querySelector('[title="Exit Outbound AMU"]')
    ).toBeInTheDocument();
    expect(
      document.querySelector('[aria-label="Exit Outbound AMU"]')
    ).toBeInTheDocument();
    expect(screen.getByText("10:00:00")).toBeInTheDocument();
    expect(screen.getByText("03 Jul 2026 (Fri)")).toBeInTheDocument();
  });

  it("renders the consolidated first column with s9_id, orig->dest, and rte", () => {
    render(
      <RfidEventsPivot
        report={report}
        timeMode="utc"
        selectedS9={null}
        onSelectS9={() => {}}
        onSelectReader={() => {}}
        readerMap={readerMap}
      />
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
      <RfidEventsPivot
        report={report}
        timeMode="utc"
        selectedS9={null}
        onSelectS9={onSelect}
        onSelectReader={() => {}}
        readerMap={readerMap}
      />
    );
    fireEvent.click(screen.getByText("INBOMBJPTYOAAEM60760004100101"));
    expect(onSelect).toHaveBeenCalledWith("INBOMBJPTYOAAEM60760004100101");
  });

  it("shows the reader LPI, gate name, and handover badge in the timestamp cell", () => {
    render(
      <RfidEventsPivot
        report={report}
        timeMode="utc"
        selectedS9={null}
        onSelectS9={() => {}}
        onSelectReader={() => {}}
        readerMap={readerMap}
      />
    );
    expect(screen.getByText("R1")).toBeInTheDocument();
    expect(screen.getByText(/MT/)).toBeInTheDocument();
    expect(screen.getByText("HO")).toBeInTheDocument();
    expect(screen.getByText("Kawasaki Higashi OE")).toBeInTheDocument();
  });

  const reportWithGap: RfidEventsReport = {
    ...report,
    rows: [
      {
        ...report.rows[0],
        noEventCodeOutbound: [
          {
            reader_id: "R2",
            site_impc_code: "INMUBA",
            country_code: "IN",
            movement_type: "OUTBOUND",
            edi_equivalent: null,
            event_datetime_utc: "2026-07-02T08:00:00+00:00",
            event_datetime_local: "2026-07-02T13:30:00",
          } as any,
        ],
      },
    ],
    hasNoEventCodeOutbound: true,
  };

  it("renders a left 'No Event Code' column when outbound gaps exist", () => {
    render(
      <RfidEventsPivot
        report={reportWithGap}
        timeMode="utc"
        selectedS9={null}
        onSelectS9={() => {}}
        onSelectReader={() => {}}
        readerMap={readerMap}
      />
    );
    expect(screen.getByText("No RFID event code")).toBeInTheDocument();
  });

  it("fires onSelectReader with the LPI when the reader code is clicked", () => {
    const onReader = vi.fn();
    render(
      <RfidEventsPivot
        report={reportWithGap}
        timeMode="utc"
        selectedS9={null}
        onSelectS9={() => {}}
        onSelectReader={onReader}
        readerMap={readerMap}
      />
    );
    fireEvent.click(screen.getByText("R2"));
    expect(onReader).toHaveBeenCalledWith("R2");
  });
});
