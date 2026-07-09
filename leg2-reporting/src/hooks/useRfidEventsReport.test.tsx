import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { RfidMovement } from "@/lib/supabase";
import { presetRange } from "@/lib/datePresets";

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

  it("fetches all movements once (no date params), and date range selects which S9s show but keeps all their events", async () => {
    // A has one event inside the window and one outside; B is only outside.
    fetchMovements.mockResolvedValue([
      mov({ s9_id: "A", movement_type: "OUTBOUND", edi_equivalent: "2320", event_datetime_utc: "2026-07-03T10:00:00+00:00" }),
      mov({ s9_id: "A", movement_type: "INBOUND", edi_equivalent: "2400", event_datetime_utc: "2026-01-01T10:00:00+00:00" }),
      mov({ s9_id: "B", movement_type: "OUTBOUND", edi_equivalent: "2320", event_datetime_utc: "2026-01-05T10:00:00+00:00" }),
    ]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Fetch has no date filter at all.
    expect(fetchMovements).toHaveBeenCalledWith({}, expect.anything());
    expect(fetchMovements).toHaveBeenCalledTimes(1);

    // Select a window covering only A's in-window event.
    act(() => result.current.setDateRange({ from: "2026-07-01", to: "2026-07-31" }));

    // Selecting a date range must not trigger a re-fetch...
    expect(fetchMovements).toHaveBeenCalledTimes(1);

    // ...but must change which S9 rows are shown.
    await waitFor(() => {
      expect(result.current.report.rows.map((r) => r.s9_id)).toEqual(["A"]);
    });
    // A's row must reflect BOTH its in-window and out-of-window events (full journey),
    // i.e. both checkpoint columns (2320 and 2400) are present.
    expect(result.current.report.columns.map((c) => c.code).sort()).toEqual(["2320", "2400"]);
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

  it("changing the date range (setDateRange) does not re-fetch but changes selected rows", async () => {
    fetchMovements.mockResolvedValue([
      mov({ s9_id: "S1", movement_type: "OUTBOUND", edi_equivalent: "2320", event_datetime_utc: "2026-07-03T10:00:00+00:00" }),
    ]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMovements).toHaveBeenCalledTimes(1);

    act(() => result.current.setDateRange({ from: "2026-01-01", to: "2026-01-31" }));
    expect(fetchMovements).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.report.rows).toHaveLength(0));
  });

  it("applyPreset changes dateRange without re-fetching", async () => {
    fetchMovements.mockResolvedValue([
      mov({ s9_id: "S1", movement_type: "OUTBOUND", edi_equivalent: "2320", event_datetime_utc: "2026-07-03T10:00:00+00:00" }),
    ]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMovements).toHaveBeenCalledTimes(1);

    act(() => result.current.applyPreset("today"));
    expect(fetchMovements).toHaveBeenCalledTimes(1);
    expect(result.current.dateRange.from).toBe(result.current.dateRange.to);
  });

  it("isDirty is false at defaults and true after a filter change", async () => {
    fetchMovements.mockResolvedValue([mov({ s9_id: "S1" })]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setFilter((f) => ({ ...f, s9Query: "abc" })));
    await waitFor(() => expect(result.current.isDirty).toBe(true));
  });

  it("isDirty is true when the date range leaves the default preset", async () => {
    fetchMovements.mockResolvedValue([mov({ s9_id: "S1" })]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setDateRange({ from: "2026-01-01", to: "2026-01-31" }));
    await waitFor(() => expect(result.current.isDirty).toBe(true));
  });

  it("resetFilters returns filter and dateRange to defaults", async () => {
    fetchMovements.mockResolvedValue([mov({ s9_id: "S1" })]);
    const { result } = renderHook(() => useRfidEventsReport());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setFilter((f) => ({ ...f, s9Query: "abc", originCountry: "IN" }));
      result.current.setDateRange({ from: "2026-01-01", to: "2026-01-31" });
    });
    await waitFor(() => expect(result.current.isDirty).toBe(true));

    act(() => result.current.resetFilters());
    await waitFor(() => expect(result.current.isDirty).toBe(false));
    expect(result.current.filter).toEqual({
      originCountry: null, destCountry: null, s9Query: "", rteQuery: "", onlyNoEventCode: false,
    });
    expect(result.current.dateRange).toEqual(presetRange("last90Days"));
  });
});
