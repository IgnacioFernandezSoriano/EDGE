import { describe, it, expect } from "vitest";
import { presetRange, activePreset, PRESET_ORDER, type DatePreset } from "./datePresets";

describe("datePresets", () => {
  const fixedNow = new Date(2026, 6, 4, 12, 0, 0); // local 2026-07-04 (Saturday)

  it("PRESET_ORDER has the expected order", () => {
    expect(PRESET_ORDER).toEqual([
      "today",
      "thisWeek",
      "lastWeek",
      "thisMonth",
      "last90Days",
    ] satisfies DatePreset[]);
  });

  it("today", () => {
    expect(presetRange("today", fixedNow)).toEqual({
      from: "2026-07-04",
      to: "2026-07-04",
    });
  });

  it("thisWeek (Monday start)", () => {
    expect(presetRange("thisWeek", fixedNow)).toEqual({
      from: "2026-06-29",
      to: "2026-07-05",
    });
  });

  it("lastWeek", () => {
    expect(presetRange("lastWeek", fixedNow)).toEqual({
      from: "2026-06-22",
      to: "2026-06-28",
    });
  });

  it("thisMonth", () => {
    expect(presetRange("thisMonth", fixedNow)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("last90Days (90 calendar days inclusive)", () => {
    expect(presetRange("last90Days", fixedNow)).toEqual({
      from: "2026-04-06",
      to: "2026-07-04",
    });
  });

  it("month boundary: thisWeek spans Jan/Feb", () => {
    const jan31 = new Date(2026, 0, 31, 12, 0, 0); // Saturday
    expect(presetRange("thisWeek", jan31)).toEqual({
      from: "2026-01-26",
      to: "2026-02-01",
    });
  });

  it("month boundary: thisMonth in January", () => {
    const jan31 = new Date(2026, 0, 31, 12, 0, 0);
    expect(presetRange("thisMonth", jan31)).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });

  it("activePreset returns the preset whose range matches", () => {
    for (const p of PRESET_ORDER) {
      expect(activePreset(presetRange(p, fixedNow), fixedNow)).toBe(p);
    }
  });

  it("activePreset returns null for a manually-edited range", () => {
    expect(activePreset({ from: "2026-01-01", to: "2026-03-15" }, fixedNow)).toBeNull();
  });
});
