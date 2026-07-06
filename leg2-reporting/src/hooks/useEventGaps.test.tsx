import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { comparisons, matrix, mailCategories } = vi.hoisted(() => ({
  comparisons: [{ comparison_key: "ho_rescon", priority: 1, label: "HO vs RESCON" }],
  matrix: [
    { origin: "IN", destination: "JP", comparison_key: "ho_rescon", mean_days: 3.2, n: 4 },
    { origin: "BR", destination: "PT", comparison_key: "ho_rescon", mean_days: 2.1, n: 2 },
  ],
  mailCategories: [{ code: "A", name: "Aéreo" }],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchEventComparisons: vi.fn().mockResolvedValue(comparisons),
  fetchEventPairMatrix: vi.fn().mockResolvedValue(matrix),
  fetchMailCategories: vi.fn().mockResolvedValue(mailCategories),
}));

import { useEventGaps } from "@/hooks/useEventGaps";
import { fetchEventPairMatrix } from "@/lib/supabase";

describe("useEventGaps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads comparisons and the pivoted matrix", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.comparisons).toHaveLength(1);
    const inRow = result.current.rows.find((r) => r.origin === "IN");
    expect(inRow).toMatchObject({ origin: "IN", destination: "JP" });
    expect(inRow?.cells.ho_rescon).toEqual({ mean_days: 3.2, n: 4 });
  });

  it("loads product options and computes country options", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.productOptions).toEqual(mailCategories);
    expect(result.current.countryOptions).toEqual(["BR", "IN", "JP", "PT"]);
  });

  it("filters rows by originCountry", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(2);

    act(() => result.current.setOriginCountry("IN"));

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0]).toMatchObject({ origin: "IN", destination: "JP" });
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
