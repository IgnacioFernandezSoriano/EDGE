import { describe, it, expect } from "vitest";
import {
  pivotMatrix,
  formatGapDays,
  formatGap,
  eventShortCode,
  eventFullLabel,
  comparisonCodeLabel,
  HANDOVER_CODE,
  type EventPairMatrixRow,
} from "@/lib/eventGaps";

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

describe("formatGap", () => {
  it("formats days with one decimal", () => {
    expect(formatGap(3.2, "days")).toBe("3.2");
  });
  it("converts to hours (x24) with one decimal", () => {
    expect(formatGap(2, "hours")).toBe("48.0");
    expect(formatGap(3.08, "hours")).toBe("73.9");
  });
  it("renders an em dash for null / NaN", () => {
    expect(formatGap(null, "days")).toBe("—");
    expect(formatGap(undefined, "hours")).toBe("—");
    expect(formatGap(NaN, "hours")).toBe("—");
  });
});

describe("event label helpers", () => {
  it("eventShortCode maps handover to HO, else the code", () => {
    expect(eventShortCode("RFID", HANDOVER_CODE)).toBe("HO");
    expect(eventShortCode("RFID", "2320")).toBe("2320");
    expect(eventShortCode("EDI", "RESCON")).toBe("RESCON");
  });
  it("eventFullLabel names handover and annotates known RFID codes", () => {
    expect(eventFullLabel("RFID", HANDOVER_CODE)).toBe("Handover (any gate)");
    expect(eventFullLabel("RFID", "2320")).toBe("2320 · Exit Outbound AMU");
    expect(eventFullLabel("EDI", "RESCON")).toBe("RESCON");
  });
  it("comparisonCodeLabel joins A and B with an arrow", () => {
    expect(
      comparisonCodeLabel({
        a_source: "RFID",
        a_code: HANDOVER_CODE,
        b_source: "EDI",
        b_code: "RESCON",
      })
    ).toBe("HO → RESCON");
  });
});
