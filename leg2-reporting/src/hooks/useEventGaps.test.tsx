import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { comparisons, matrix } = vi.hoisted(() => ({
  comparisons: [{ comparison_key: "ho_rescon", priority: 1, label: "HO vs RESCON" }],
  matrix: [{ origin: "IN", destination: "JP", comparison_key: "ho_rescon", mean_days: 3.2, n: 4 }],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchEventComparisons: vi.fn().mockResolvedValue(comparisons),
  fetchEventPairMatrix: vi.fn().mockResolvedValue(matrix),
}));

import { useEventGaps } from "@/hooks/useEventGaps";
import { fetchEventPairMatrix } from "@/lib/supabase";

describe("useEventGaps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads comparisons and the pivoted matrix", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.comparisons).toHaveLength(1);
    expect(result.current.rows[0]).toMatchObject({ origin: "IN", destination: "JP" });
    expect(result.current.rows[0].cells.ho_rescon).toEqual({ mean_days: 3.2, n: 4 });
  });

  it("refetches the matrix when granularity changes", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    (fetchEventPairMatrix as any).mockClear();
    act(() => result.current.setGranularity("country"));
    await waitFor(() =>
      expect(fetchEventPairMatrix).toHaveBeenCalledWith(
        expect.objectContaining({ granularity: "country" }),
        expect.anything()
      )
    );
  });
});
