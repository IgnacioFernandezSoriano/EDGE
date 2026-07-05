import { describe, it, expect } from "vitest";
import { optionsWithCurrent, READING_DIRECTIONS, OPERATIONS_SCOPES } from "@/lib/selectOptions";

describe("optionsWithCurrent", () => {
  it("prepends an empty option and lists the known values", () => {
    const opts = optionsWithCurrent(READING_DIRECTIONS, null);
    expect(opts[0]).toEqual({ value: "", label: "—" });
    expect(opts.map((o) => o.value)).toEqual(["", "Entry", "Exit", "Entry/Exit"]);
  });
  it("appends the current value when it is not known", () => {
    const opts = optionsWithCurrent(OPERATIONS_SCOPES, "Regional");
    expect(opts.some((o) => o.value === "Regional")).toBe(true);
  });
  it("does not duplicate a known current value", () => {
    const opts = optionsWithCurrent(OPERATIONS_SCOPES, "International");
    expect(opts.filter((o) => o.value === "International")).toHaveLength(1);
  });
});
