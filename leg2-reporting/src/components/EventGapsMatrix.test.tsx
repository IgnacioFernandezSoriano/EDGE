import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventGapsMatrix } from "@/components/EventGapsMatrix";
import type { CorridorRow, EventComparison } from "@/lib/eventGaps";

const comparisons: EventComparison[] = [
  { comparison_key: "ho_rescon", name: "Handover → RESCON", priority: 1,
    a_source: "RFID", a_code: "__HO__", b_source: "EDI", b_code: "RESCON" },
  { comparison_key: "ho_resdes", name: "Handover → RESDES", priority: 2,
    a_source: "RFID", a_code: "__HO__", b_source: "EDI", b_code: "RESDES" },
];
const rows: CorridorRow[] = [
  { origin: "IN", destination: "JP", cells: { ho_rescon: { mean_days: 3.25, n: 10 } } },
];

describe("EventGapsMatrix", () => {
  it("renders a column per comparison and the corridor rows", () => {
    render(<EventGapsMatrix comparisons={comparisons} rows={rows} onSelectCell={() => {}} />);
    expect(screen.getByText("Handover → RESCON")).toBeInTheDocument();
    expect(screen.getByText("HO → RESCON")).toBeInTheDocument(); // code label subtext
    expect(screen.getByText("IN → JP")).toBeInTheDocument();
    expect(screen.getByText("3.3")).toBeInTheDocument(); // mean_days 1-dp
  });
  it("shows an em-dash for a missing cell", () => {
    render(<EventGapsMatrix comparisons={comparisons} rows={rows} onSelectCell={() => {}} />);
    expect(screen.getByText("—")).toBeInTheDocument(); // ho_resdes empty for IN→JP
  });
  it("fires onSelectCell with corridor + comparison when a populated cell is clicked", () => {
    const onSel = vi.fn();
    render(<EventGapsMatrix comparisons={comparisons} rows={rows} onSelectCell={onSel} />);
    fireEvent.click(screen.getByText("3.3"));
    expect(onSel).toHaveBeenCalledWith({ origin: "IN", destination: "JP" }, "ho_rescon");
  });
  it("renders cell values in hours when unit=hours", () => {
    render(
      <EventGapsMatrix comparisons={comparisons} rows={rows} unit="hours" onSelectCell={() => {}} />
    );
    expect(screen.getByText("78.0")).toBeInTheDocument();
  });
});
