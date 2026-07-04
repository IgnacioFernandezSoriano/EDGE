import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RfidMovement } from "@/lib/supabase";

const fetchMovements = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchRfidMovements: (...args: unknown[]) => fetchMovements(...args),
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
    city: "Mumbai", handover_point: true, handover_quality_status: "handover_ok",
    ...p,
  };
}

describe("useRfidEventsReport", () => {
  beforeEach(() => fetchMovements.mockReset());

  it("loads, defaults to outbound tab, and pivots filtered data", async () => {
    fetchMovements.mockResolvedValue([
      mov({ s9_id: "S1", movement_type: "OUTBOUND", edi_equivalent: "2320" }),
      mov({ s9_id: "S2", movement_type: "INBOUND", edi_equivalent: "2400" }),
    ]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // default tab outbound → only S1
    expect(result.current.report.rows.map((r) => r.s9_id)).toEqual(["S1"]);
    expect(result.current.report.columns.map((c) => c.code)).toEqual(["2320"]);
    // bounds the fetch to a default rolling date window (no unbounded full-table load)
    expect(fetchMovements).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
      expect.anything()
    );
  });

  it("switching tab to inbound re-pivots", async () => {
    fetchMovements.mockResolvedValue([
      mov({ s9_id: "S1", movement_type: "OUTBOUND", edi_equivalent: "2320" }),
      mov({ s9_id: "S2", movement_type: "INBOUND", edi_equivalent: "2400" }),
    ]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setFilter((f) => ({ ...f, tab: "inbound" })));
    expect(result.current.report.rows.map((r) => r.s9_id)).toEqual(["S2"]);
    expect(result.current.report.columns.map((c) => c.code)).toEqual(["2400"]);
  });
});
