import { describe, it, expect } from "vitest";
import { formatTimestamp, durationHours } from "@/lib/time";

describe("time", () => {
  const mov = {
    event_datetime_utc: "2026-07-03T10:00:00+00:00",
    event_datetime_local: "2026-07-03T19:00:00",
  };

  it("shows UTC or local based on mode", () => {
    expect(formatTimestamp(mov, "utc")).toBe("2026-07-03T10:00:00+00:00");
    expect(formatTimestamp(mov, "local")).toBe("2026-07-03T19:00:00");
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
