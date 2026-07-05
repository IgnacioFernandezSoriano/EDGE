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

  it("saves only the Operation fields via applyReaderEdit and reports applied", async () => {
    const onApplied = vi.fn();
    render(<ReaderEditorDialog open onOpenChange={() => {}} reader={reader} onApplied={onApplied} />);
    fireEvent.click(screen.getByText("Save & apply"));
    await waitFor(() => expect(applyReaderEdit).toHaveBeenCalledTimes(1));
    const call = (applyReaderEdit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const lpi = call[0] as string;
    const operation = call[1] as Record<string, unknown>;
    expect(lpi).toBe("J11DJ0002100000037");
    expect(Object.keys(operation).sort()).toEqual([
      "edi_equivalent_inbound", "edi_equivalent_outbound", "gate_purpose",
      "handover_point", "operations_scope", "reading_direction",
    ]);
    await waitFor(() => expect(screen.getByText(/Applied/)).toBeInTheDocument());
    expect(onApplied).toHaveBeenCalled();
  });
});
