import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventGapsDetailDialog } from "@/components/EventGapsDetailDialog";
import type { EventPairDetailRow } from "@/lib/supabase";

const rows: EventPairDetailRow[] = [
  {
    s9code: "INBOMBJPTYOAAEM60760004100101", comparison_key: "ho_rescon",
    origin_office: "INBOMB", dest_office: "JPTYOA", origin_country: "IN", dest_country: "JP",
    product: "A", rfid_utc: "2026-02-01T10:00:00+00:00", edi_utc: "2026-02-04T12:00:00+00:00",
    gap_days: 3.08, colocation_valid: true, excluded: false,
    origin_gate: null, origin_site: null, dest_gate: null, dest_site: null,
  },
  {
    s9code: "INBOMBJPTYOAAEM60760004100102", comparison_key: "ho_rescon",
    origin_office: "INBOMB", dest_office: "JPTYOA", origin_country: "IN", dest_country: "JP",
    product: "A", rfid_utc: "2026-02-02T10:00:00+00:00", edi_utc: "2026-02-20T12:00:00+00:00",
    gap_days: 18.08, colocation_valid: true, excluded: true,
    origin_gate: null, origin_site: null, dest_gate: null, dest_site: null,
  },
];

describe("EventGapsDetailDialog", () => {
  it("renders a row per pair with its gap", () => {
    render(<EventGapsDetailDialog open title="IN → JP" rows={rows} loading={false}
      onOpenChange={() => {}} onToggleExclude={() => {}} />);
    expect(screen.getByText("INBOMBJPTYOAAEM60760004100101")).toBeInTheDocument();
    expect(screen.getByText("3.1")).toBeInTheDocument();
  });
  it("checks the box for an already-excluded row", () => {
    render(<EventGapsDetailDialog open title="IN → JP" rows={rows} loading={false}
      onOpenChange={() => {}} onToggleExclude={() => {}} />);
    const boxes = screen.getAllByRole("checkbox");
    expect((boxes[0] as HTMLInputElement).checked).toBe(false);
    expect((boxes[1] as HTMLInputElement).checked).toBe(true);
  });
  it("calls onToggleExclude with the row and the new state", () => {
    const onToggle = vi.fn();
    render(<EventGapsDetailDialog open title="IN → JP" rows={rows} loading={false}
      onOpenChange={() => {}} onToggleExclude={onToggle} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith(rows[0], true);
  });
});
