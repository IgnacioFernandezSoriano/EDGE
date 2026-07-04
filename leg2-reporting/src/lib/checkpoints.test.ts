import { describe, it, expect } from "vitest";
import { checkpointLabel, checkpointColumnsFromData } from "@/lib/checkpoints";

describe("checkpoint columns (dynamic)", () => {
  it("labels known codes, falls back to raw code", () => {
    expect(checkpointLabel("2320")).toBe("Exit Outbound AMU");
    expect(checkpointLabel("9999")).toBe("9999");
  });

  it("derives distinct columns ordered by numeric code", () => {
    const cols = checkpointColumnsFromData([
      { edi_equivalent: "2400" },
      { edi_equivalent: "2320" },
      { edi_equivalent: "2400" },
      { edi_equivalent: null },
    ]);
    expect(cols.map((c) => c.code)).toEqual(["2320", "2400"]);
  });

  it("computes the raw event count per code", () => {
    const cols = checkpointColumnsFromData([
      { edi_equivalent: "2400" },
      { edi_equivalent: "2320" },
      { edi_equivalent: "2400" },
      { edi_equivalent: null },
    ]);
    expect(cols).toEqual([
      { code: "2320", label: "Exit Outbound AMU", count: 1 },
      { code: "2400", label: "Entry Inbound AMU", count: 2 },
    ]);
  });

  it("a brand-new checkpoint appears automatically as a column", () => {
    const cols = checkpointColumnsFromData([
      { edi_equivalent: "2400" },
      { edi_equivalent: "2320" },
      { edi_equivalent: "2410" },
    ]);
    expect(cols.map((c) => c.code)).toEqual(["2320", "2400", "2410"]);
  });

  it("unknown code uses its raw code as label", () => {
    const cols = checkpointColumnsFromData([{ edi_equivalent: "9999" }]);
    expect(cols[0]).toEqual({ code: "9999", label: "9999", count: 1 });
  });
});
