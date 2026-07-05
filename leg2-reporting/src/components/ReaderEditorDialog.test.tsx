import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReaderEditorDialog } from "@/components/ReaderEditorDialog";
import type { ReaderMaster } from "@/lib/supabase";

vi.mock("@/lib/readerEdit", () => ({
  applyReaderEdit: vi.fn().mockResolvedValue({ ok: true, status: "success", movements_upserted: 1 }),
}));
import { applyReaderEdit } from "@/lib/readerEdit";

const reader: ReaderMaster = {
  lpi: "J11DJ0002100000037", gate_id: "G1", gate_name: "Office", gate_purpose: "Office entrance and exit",
  reading_direction: "Entry/Exit", facility_name: "Kawasaki", facility_type: "AMU", site_id: "S",
  reader_country_code: "JP", country_name: "Japan", city: "Yokohama", facility_latitude: "35.5",
  facility_longitude: "139.7", operator: "JP Post", priority: "1", inactive: false,
  operations_scope: "International", handover_point: true,
  edi_equivalent_inbound: "2320", edi_equivalent_outbound: null,
};

describe("ReaderEditorDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows read-only Identification and does not show product/nms", () => {
    render(<ReaderEditorDialog open onOpenChange={() => {}} reader={reader} onApplied={() => {}} />);
    expect(screen.getByText("J11DJ0002100000037")).toBeInTheDocument();
    expect(screen.getByText(/Kawasaki/)).toBeInTheDocument();
    expect(screen.queryByText(/product/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nms_reader_url/i)).not.toBeInTheDocument();
  });

  it("sends only the changed Operation field and reports applied", async () => {
    const onApplied = vi.fn();
    render(<ReaderEditorDialog open onOpenChange={() => {}} reader={reader} onApplied={onApplied} />);
    fireEvent.change(screen.getByDisplayValue("Office entrance and exit"), {
      target: { value: "Main gate" },
    });
    fireEvent.click(screen.getByText("Save & apply"));
    await waitFor(() => expect(applyReaderEdit).toHaveBeenCalledTimes(1));
    const call = (applyReaderEdit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe("J11DJ0002100000037");
    expect(call[1]).toEqual({ gate_purpose: "Main gate" }); // only the changed field
    await waitFor(() => expect(screen.getByText(/Applied/)).toBeInTheDocument());
    expect(onApplied).toHaveBeenCalled();
  });

  it("does not call the endpoint when nothing changed", async () => {
    render(<ReaderEditorDialog open onOpenChange={() => {}} reader={reader} onApplied={() => {}} />);
    fireEvent.click(screen.getByText("Save & apply"));
    await waitFor(() => expect(screen.getByText(/No changes to apply/)).toBeInTheDocument());
    expect(applyReaderEdit).not.toHaveBeenCalled();
  });
});
