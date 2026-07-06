import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventGapsMatrix } from "@/components/EventGapsMatrix";
import type { CorridorRow, EventComparison } from "@/lib/eventGaps";

const comparisons: EventComparison[] = [
  { comparison_key: "ho_rescon", priority: 1, label: "HO vs RESCON" },
  { comparison_key: "ho_resdes", priority: 2, label: "HO vs RESDES" },
];
const rows: CorridorRow[] = [
  { origin: "IN", destination: "JP", cells: { ho_rescon: { mean_days: 3.25, n: 10 } } },
];

describe("EventGapsMatrix", () => {
  it("renders a column per comparison and the corridor rows", () => {
    render(<EventGapsMatrix comparisons={comparisons} rows={rows} onSelectCell={() => {}} />);
    expect(screen.getByText("HO vs RESCON")).toBeInTheDocument();
    expect(screen.getByText("HO vs RESDES")).toBeInTheDocument();
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
});
