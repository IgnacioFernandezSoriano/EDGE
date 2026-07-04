import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RfidMovement } from "@/lib/supabase";

const fetchMovements = vi.fn();
const fetchReaderMaster = vi.fn().mockResolvedValue([
  { lpi: "R1", gate_id: "G1", gate_name: "MT", gate_purpose: "exit", reading_direction: "out", facility_name: "Facility A", site_id: "S1", reader_country_code: "IN", handover_point: true },
  { lpi: "R2", gate_id: "G2", gate_name: "MO", gate_purpose: "entry", reading_direction: "in", facility_name: "Facility B", site_id: "S2", reader_country_code: "JP", handover_point: false },
]);
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchRfidMovements: (...args: unknown[]) => fetchMovements(...args),
  fetchReaderMaster: (...args: unknown[]) => fetchReaderMaster(...args),
}));

import { useRfidEventsReport } from "@/hooks/useRfidEventsReport";

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

describe("useRfidEventsReport", () => {
  beforeEach(() => {
    fetchMovements.mockReset();
    fetchReaderMaster.mockClear();
  });

  it("loads and pivots all fetched movements (no tab split), fetching with a server-side date range", async () => {
    fetchMovements.mockResolvedValue([
      mov({ s9_id: "S1", movement_type: "OUTBOUND", edi_equivalent: "2320" }),
      mov({ s9_id: "S2", movement_type: "INBOUND", edi_equivalent: "2400" }),
    ]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.report.rows.map((r) => r.s9_id).sort()).toEqual(["S1", "S2"]);
    expect(result.current.report.columns.map((c) => c.code).sort()).toEqual(["2320", "2400"]);
    expect(fetchMovements).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        dateTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
      expect.anything()
    );
  });

  it("loads reader master data once into readerMap", async () => {
    fetchMovements.mockResolvedValue([
      mov({ s9_id: "S1", movement_type: "OUTBOUND", edi_equivalent: "2320" }),
    ]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.readerMap.size).toBe(2));
    expect(result.current.readerMap.get("R1")?.gate_name).toBe("MT");
    expect(result.current.readerMap.get("R1")?.handover_point).toBe(true);
  });

  it("changing the date range (setDateRange) triggers a re-fetch", async () => {
    fetchMovements.mockResolvedValue([
      mov({ s9_id: "S1", movement_type: "OUTBOUND", edi_equivalent: "2320" }),
    ]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMovements).toHaveBeenCalledTimes(1);

    act(() => result.current.setDateRange({ from: "2026-01-01", to: "2026-01-31" }));
    await waitFor(() => expect(fetchMovements).toHaveBeenCalledTimes(2));
    expect(fetchMovements).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateFrom: "2026-01-01", dateTo: "2026-01-31" }),
      expect.anything()
    );
  });

  it("applyPreset triggers a re-fetch with the preset's range", async () => {
    fetchMovements.mockResolvedValue([
      mov({ s9_id: "S1", movement_type: "OUTBOUND", edi_equivalent: "2320" }),
    ]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMovements).toHaveBeenCalledTimes(1);

    act(() => result.current.applyPreset("today"));
    await waitFor(() => expect(fetchMovements).toHaveBeenCalledTimes(2));
    const [args] = fetchMovements.mock.calls[1];
    expect(args.dateFrom).toBe(args.dateTo);
  });
});
