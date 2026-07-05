import { describe, it, expect } from "vitest";
import { ediCodeOptions } from "@/lib/ediCodes";

describe("ediCodeOptions", () => {
  it("starts with an empty option and includes known codes with labels", () => {
    const opts = ediCodeOptions(null);
    expect(opts[0]).toEqual({ value: "", label: "—" });
    const codes = opts.map((o) => o.value);
    expect(codes).toContain("2320");
    expect(opts.find((o) => o.value === "2320")?.label).toMatch(/2320/);
  });
  it("appends the current value when it is not a known code", () => {
    const opts = ediCodeOptions("9999");
    expect(opts.some((o) => o.value === "9999")).toBe(true);
  });
  it("does not duplicate a current value that is already known", () => {
    const opts = ediCodeOptions("2320");
    expect(opts.filter((o) => o.value === "2320")).toHaveLength(1);
  });
});
