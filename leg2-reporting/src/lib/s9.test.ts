import { describe, it, expect } from "vitest";
import { deriveOrigPoCode, deriveDestPoCode, classifyTab } from "@/lib/s9";

describe("s9 derivations", () => {
  const s9 = "INBOMBJPTYOAAEM60760004100101";

  it("origin Po code = first 6 chars", () => {
    expect(deriveOrigPoCode(s9)).toBe("INBOMB");
  });

  it("dest Po code = chars 7..12", () => {
    expect(deriveDestPoCode(s9)).toBe("JPTYOA");
  });

  it("classifies outbound movement types", () => {
    expect(classifyTab("OUTBOUND")).toBe("outbound");
    expect(classifyTab("TRANSIT_EXIT")).toBe("outbound");
  });

  it("classifies inbound movement types", () => {
    expect(classifyTab("INBOUND")).toBe("inbound");
    expect(classifyTab("TRANSIT_ENTRY")).toBe("inbound");
  });
});
