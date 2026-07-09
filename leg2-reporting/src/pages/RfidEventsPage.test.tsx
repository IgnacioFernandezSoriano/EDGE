import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { RfidMovement } from "@/lib/supabase";
import { strings } from "@/i18n/strings";

const fetchMovements = vi.fn();
const fetchReaderMaster = vi.fn().mockResolvedValue([
  { lpi: "R1", gate_id: "G1", gate_name: "MT", gate_purpose: "exit", reading_direction: "out", facility_name: "Facility A", site_id: "S1", reader_country_code: "IN", handover_point: true },
]);
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchRfidMovements: (...a: unknown[]) => fetchMovements(...a),
  fetchReaderMaster: (...a: unknown[]) => fetchReaderMaster(...a),
}));

import RfidEventsPage from "@/pages/RfidEventsPage";

function mov(p: Partial<RfidMovement>): RfidMovement {
  return {
    movement_id: "m", s9_id: "S1", tag_id: "G.1UPU.X", reader_id: "R1",
    movement_type: "OUTBOUND", route_country_role: "ORIGIN", edi_equivalent: "2320",
    origin_country_code: "IN", destination_country_code: "JP",
    movement_country_code: "IN", country_sequence_number: 1,
    event_datetime_utc: "2026-07-03T10:00:00+00:00",
    event_datetime_local: "2026-07-03T19:00:00", reader_timezone: "Asia/Kolkata",
    site_impc_code: "INMUBA", centre_code: "INMUBA", site_name: "Mumbai",
    city: "Mumbai", country_code: "IN", handover_point: true, handover_quality_status: "handover_ok",
    ...p,
  };
}

describe("RfidEventsPage new-tab S9", () => {
  beforeEach(() => { fetchMovements.mockReset(); fetchReaderMaster.mockClear(); });

  it("opens receptacle detail in a new tab when an S9 cell is clicked", async () => {
    fetchMovements.mockResolvedValue([mov({ s9_id: "S1" })]);
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(<RfidEventsPage />);
    const s9El = await screen.findByText("S1");
    fireEvent.click(s9El);
    expect(openSpy).toHaveBeenCalledWith("/#/receptacle/S1", "_blank", "noopener");
    openSpy.mockRestore();
  });

  it("Clear filters resets timeMode and disables itself", async () => {
    fetchMovements.mockResolvedValue([mov({ s9_id: "S1" })]);
    render(<RfidEventsPage />);

    const clearBtn = await screen.findByRole("button", { name: strings.filters.clearFilters });
    expect(clearBtn).toBeDisabled();

    // Only timeMode changes (UTC -> Local); the "UTC" label targets the tz switch.
    fireEvent.click(screen.getByLabelText(strings.timeMode.utc));
    expect(clearBtn).toBeEnabled();

    fireEvent.click(clearBtn);
    expect(clearBtn).toBeDisabled();
  });
});
