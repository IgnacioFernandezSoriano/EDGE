import { describe, it, expect } from "vitest";
import { parseEdiDate } from "@/lib/atat";

describe("parseEdiDate", () => {
  it("parses the day-prefixed DD-MM-YYYY HH:MM format", () => {
    const { date, display } = parseEdiDate("Fri,01-05-2026 18:26");
    expect(display).toBe("Fri,01-05-2026 18:26");
    expect(date).not.toBeNull();
    // 2026-05-01 18:26 as a UTC-built instant
    expect(date!.getTime()).toBe(Date.UTC(2026, 4, 1, 18, 26));
  });

  it("parses ISO date-only with midnight time", () => {
    const { date } = parseEdiDate("2026-07-01");
    expect(date!.getTime()).toBe(Date.UTC(2026, 6, 1, 0, 0));
  });

  it("returns null date for unparseable input, keeping the raw display", () => {
    const { date, display } = parseEdiDate("not a date");
    expect(date).toBeNull();
    expect(display).toBe("not a date");
  });

  it("handles null and empty input", () => {
    expect(parseEdiDate(null)).toEqual({ date: null, display: "" });
    expect(parseEdiDate("   ")).toEqual({ date: null, display: "" });
  });
});
