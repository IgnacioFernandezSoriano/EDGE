import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { comparisons, matrix, products } = vi.hoisted(() => ({
  comparisons: [{ comparison_key: "ho_rescon", priority: 1, label: "HO vs RESCON" }],
  matrix: [
    { origin: "IN", destination: "JP", comparison_key: "ho_rescon", mean_days: 3.2, n: 4 },
    { origin: "BR", destination: "PT", comparison_key: "ho_rescon", mean_days: 2.1, n: 2 },
  ],
  products: [
    { code: "A", name: "Airmail / Priority" },
    { code: null, name: null },
  ],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  fetchEventComparisons: vi.fn().mockResolvedValue(comparisons),
  fetchEventPairMatrix: vi.fn().mockResolvedValue(matrix),
  fetchEventPairProducts: vi.fn().mockResolvedValue(products),
}));

import { useEventGaps } from "@/hooks/useEventGaps";
import { fetchEventPairMatrix, fetchEventPairProducts } from "@/lib/supabase";

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

  it("splits products into named options and a hasNoProduct flag", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.productOptions).toEqual([{ code: "A", name: "Airmail / Priority" }]);
    expect(result.current.hasNoProduct).toBe(true);
    expect(result.current.countryOptions).toEqual(["BR", "IN", "JP", "PT"]);
  });

  it("filters out empty-string product codes", async () => {
    (fetchEventPairProducts as any).mockResolvedValueOnce([
      { code: "A", name: "Airmail / Priority" },
      { code: "", name: "" },
    ]);
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.productOptions).toEqual([{ code: "A", name: "Airmail / Priority" }]);
    expect(result.current.hasNoProduct).toBe(false);
  });

  it("re-fetches product options when the date range changes", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    (fetchEventPairProducts as any).mockClear();
    act(() => result.current.setDateRange({ from: "2026-05-01", to: "2026-05-31" }));
    await waitFor(() =>
      expect(fetchEventPairProducts).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-05-01", to: "2026-05-31" }),
        expect.anything()
      )
    );
  });

  it("does NOT re-fetch product options when the product changes", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    (fetchEventPairProducts as any).mockClear();
    act(() => result.current.setProduct("A"));
    // give any stray effect a chance to fire
    await waitFor(() => expect(fetchEventPairMatrix).toHaveBeenCalled());
    expect(fetchEventPairProducts).not.toHaveBeenCalled();
  });

  it("resets a selected product that leaves the option set", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setProduct("A"));
    await waitFor(() => expect(result.current.product).toBe("A"));
    // next options fetch returns a set without "A"
    (fetchEventPairProducts as any).mockResolvedValueOnce([{ code: "B", name: "Non-priority" }]);
    act(() => result.current.setDateRange({ from: "2026-05-01", to: "2026-05-31" }));
    await waitFor(() => expect(result.current.product).toBe("all"));
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

  it("isDirty is false at defaults and true after a filter change", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setOriginCountry("IN"));
    await waitFor(() => expect(result.current.isDirty).toBe(true));
  });

  it("resetFilters returns product, countries, granularity, unit and dateRange to defaults", async () => {
    const { result } = renderHook(() => useEventGaps());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setProduct("A");
      result.current.setOriginCountry("IN");
      result.current.setDestCountry("JP");
      result.current.setGranularity("country");
      result.current.setUnit("hours");
      result.current.setDateRange({ from: "2026-01-01", to: "2026-01-31" });
    });
    await waitFor(() => expect(result.current.isDirty).toBe(true));

    act(() => result.current.resetFilters());
    await waitFor(() => expect(result.current.isDirty).toBe(false));
    expect(result.current.product).toBe("all");
    expect(result.current.originCountry).toBe("");
    expect(result.current.destCountry).toBe("");
    expect(result.current.granularity).toBe("centre");
    expect(result.current.unit).toBe("days");
  });
});
