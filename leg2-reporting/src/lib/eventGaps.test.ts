import { describe, it, expect } from "vitest";
import { pivotMatrix, formatGapDays, type EventPairMatrixRow } from "@/lib/eventGaps";

const rows: EventPairMatrixRow[] = [
  { origin: "IN", destination: "JP", comparison_key: "ho_rescon", mean_days: 3.2, n: 10 },
  { origin: "IN", destination: "JP", comparison_key: "ho_resdes", mean_days: 4.1, n: 8 },
  { origin: "IN", destination: "GB", comparison_key: "ho_rescon", mean_days: 2.1, n: 5 },
];

describe("pivotMatrix", () => {
  it("groups rows into one corridor row per origin/destination with per-comparison cells", () => {
    const out = pivotMatrix(rows);
    expect(out).toHaveLength(2);
    const injp = out.find((r) => r.origin === "IN" && r.destination === "JP")!;
    expect(injp.cells.ho_rescon).toEqual({ mean_days: 3.2, n: 10 });
    expect(injp.cells.ho_resdes).toEqual({ mean_days: 4.1, n: 8 });
    expect(injp.cells.ho_predes).toBeUndefined();
  });
  it("sorts corridors alphabetically by origin then destination", () => {
    const out = pivotMatrix(rows);
    expect(out.map((r) => `${r.origin}-${r.destination}`)).toEqual(["IN-GB", "IN-JP"]);
  });
});

describe("formatGapDays", () => {
  it("formats to 1 decimal", () => {
    expect(formatGapDays(3.25)).toBe("3.3");
    expect(formatGapDays(-0.5)).toBe("-0.5");
  });
  it("returns em-dash for null/undefined/NaN", () => {
    expect(formatGapDays(null)).toBe("—");
    expect(formatGapDays(undefined)).toBe("—");
    expect(formatGapDays(NaN)).toBe("—");
  });
});
