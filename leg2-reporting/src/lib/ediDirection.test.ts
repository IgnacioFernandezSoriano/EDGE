import { describe, it, expect } from "vitest";
import { directionForCode } from "@/lib/ediDirection";

describe("directionForCode", () => {
  it("classifies origin-side codes as outbound", () => {
    for (const c of ["PREDES", "PRECON", "CARDIT", "2000", "2300", "2320"]) {
      expect(directionForCode(c)).toBe("outbound");
    }
  });

  it("classifies destination-side codes as inbound", () => {
    for (const c of ["RESDES", "RESCON", "POD", "2400", "2410", "2420"]) {
      expect(directionForCode(c)).toBe("inbound");
    }
  });

  it("treats every RESDIT sub-code as inbound", () => {
    for (const c of ["RESDIT6", "RESDIT14", "RESDIT21", "RESDIT74"]) {
      expect(directionForCode(c)).toBe("inbound");
    }
  });

  it("defaults unknown and null codes to inbound", () => {
    expect(directionForCode("EMC")).toBe("inbound");
    expect(directionForCode(null)).toBe("inbound");
    expect(directionForCode("")).toBe("inbound");
  });
});
