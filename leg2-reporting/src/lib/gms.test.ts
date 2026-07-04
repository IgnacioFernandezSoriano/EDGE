import { describe, it, expect } from "vitest";
import { buildReaderMasterUrl } from "@/lib/gms";

describe("buildReaderMasterUrl", () => {
  it("appends the LPI to the base path", () => {
    expect(
      buildReaderMasterUrl("J11DJ0002100000037", "https://monitoring.edgeavs.net/catalog")
    ).toBe("https://monitoring.edgeavs.net/catalog/J11DJ0002100000037");
  });
  it("trims a trailing slash on the base", () => {
    expect(buildReaderMasterUrl("R1", "https://x.net/catalog/")).toBe(
      "https://x.net/catalog/R1"
    );
  });
  it("URL-encodes the LPI", () => {
    expect(buildReaderMasterUrl("A B", "https://x.net/c")).toBe("https://x.net/c/A%20B");
  });
});
