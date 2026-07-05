import { describe, it, expect } from "vitest";
import { formatTimestamp, formatTimestampParts, durationHours, formatIso } from "@/lib/time";

describe("time", () => {
  const mov = {
    event_datetime_utc: "2026-07-03T10:00:00+00:00",
    event_datetime_local: "2026-07-03T19:00:00",
  };

  it("shows UTC or local based on mode, formatted compact and human-readable", () => {
    expect(formatTimestamp(mov, "utc")).toBe("03 Jul 2026 (Fri), 10:00:00");
    expect(formatTimestamp(mov, "local")).toBe("03 Jul 2026 (Fri), 19:00:00");
  });

  it("splits date and time parts without shifting local values via Date parsing", () => {
    expect(formatTimestampParts(mov, "utc")).toEqual({
      date: "03 Jul 2026",
      time: "10:00:00",
      weekday: "Fri",
    });
    expect(formatTimestampParts(mov, "local")).toEqual({
      date: "03 Jul 2026",
      time: "19:00:00",
      weekday: "Fri",
    });
  });

  it("duration ALWAYS uses UTC, ignoring local", () => {
    const a = {
      event_datetime_utc: "2026-07-03T10:00:00+00:00",
      event_datetime_local: "2026-07-03T19:00:00",
    };
    const b = {
      event_datetime_utc: "2026-07-03T12:00:00+00:00",
      event_datetime_local: "2026-07-03T13:00:00", // misleading local delta = 1h
    };
    expect(durationHours(a, b)).toBe(2); // 2h from UTC, not 1h from local
  });
});

describe("formatIso", () => {
  it("formats a UTC ISO string by its wall-clock components", () => {
    expect(formatIso("2026-07-03T15:14:22.934+00:00")).toBe("03 Jul 2026 (Fri), 15:14:22");
  });
  it("formats a naive local ISO string", () => {
    expect(formatIso("2026-02-16T08:30:00")).toBe("16 Feb 2026 (Mon), 08:30:00");
  });
  it("returns empty string for null and echoes unparseable input", () => {
    expect(formatIso(null)).toBe("");
    expect(formatIso("nope")).toBe("nope");
  });
});
