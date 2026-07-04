import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CorrectionDialog } from "@/components/CorrectionDialog";
import type { ReaderMaster, RfidMovement } from "@/lib/supabase";

vi.mock("@/lib/reprocess", () => ({
  reprocessSite: vi.fn().mockResolvedValue({ ok: true, status: "success", movements_upserted: 2 }),
}));
import { reprocessSite } from "@/lib/reprocess";

const movements = [
  {
    reader_id: "J11DJ0002100000037",
    site_impc_code: "INMUBA",
    country_code: "IN",
    movement_type: "OUTBOUND",
    edi_equivalent: null,
    event_datetime_utc: "2026-07-02T08:00:00+00:00",
    event_datetime_local: "2026-07-02T13:30:00",
  } as RfidMovement,
];
const readerMap = new Map<string, ReaderMaster>([
  [
    "J11DJ0002100000037",
    {
      lpi: "J11DJ0002100000037",
      gate_id: "G1",
      gate_name: "Office",
      gate_purpose: "in/out",
      reading_direction: "Entry/Exit",
      facility_name: "F",
      site_id: "S",
      reader_country_code: "IN",
      handover_point: true,
    },
  ],
]);

describe("CorrectionDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows site, gate, LPI and a deep-link to the GMS reader master", () => {
    render(
      <CorrectionDialog open onOpenChange={() => {}} movements={movements} readerMap={readerMap} />
    );
    expect(screen.getByText(/INMUBA/)).toBeInTheDocument();
    expect(screen.getByText(/Office/)).toBeInTheDocument();
    expect(screen.getByText("J11DJ0002100000037")).toBeInTheDocument();
    const link = screen.getByText("Open in reader master (GMS)").closest("a")!;
    expect(link.getAttribute("href")).toBe(
      "https://monitoring.edgeavs.net/catalog/J11DJ0002100000037"
    );
  });

  it("does NOT show the product field", () => {
    render(
      <CorrectionDialog open onOpenChange={() => {}} movements={movements} readerMap={readerMap} />
    );
    expect(screen.queryByText(/product/i)).not.toBeInTheDocument();
  });

  it("calls reprocessSite for the site and shows success", async () => {
    render(
      <CorrectionDialog open onOpenChange={() => {}} movements={movements} readerMap={readerMap} />
    );
    fireEvent.click(screen.getByText("Reprocess"));
    await waitFor(() => expect(reprocessSite).toHaveBeenCalledWith("INMUBA"));
    await waitFor(() => expect(screen.getByText(/Reprocess complete/)).toBeInTheDocument());
  });
});
