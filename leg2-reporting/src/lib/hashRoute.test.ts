import { describe, it, expect } from "vitest";
import { parseHash, receptacleHash, gapsHash, receptacleUrl } from "@/lib/hashRoute";

describe("parseHash", () => {
  it("defaults to the report", () => {
    expect(parseHash("")).toEqual({ name: "report" });
    expect(parseHash("#/")).toEqual({ name: "report" });
    expect(parseHash("#/something-else")).toEqual({ name: "report" });
  });

  it("routes to a receptacle with a decoded, trimmed s9", () => {
    expect(parseHash("#/receptacle/INBOMAJPKWSAAUY60597001100039"))
      .toEqual({ name: "receptacle", s9: "INBOMAJPKWSAAUY60597001100039" });
    expect(parseHash("#/receptacle/AB%20CD")).toEqual({ name: "receptacle", s9: "AB CD" });
  });

  it("routes to receptacle with empty s9 (search box) when no code given", () => {
    expect(parseHash("#/receptacle")).toEqual({ name: "receptacle", s9: "" });
    expect(parseHash("#/receptacle/")).toEqual({ name: "receptacle", s9: "" });
  });
});

describe("receptacleHash", () => {
  it("builds an encoded hash and round-trips", () => {
    const h = receptacleHash("  ABC 1  ");
    expect(h).toBe("#/receptacle/ABC%201");
    expect(parseHash(h)).toEqual({ name: "receptacle", s9: "ABC 1" });
  });
});

describe("gaps route", () => {
  it("parses #/gaps to the gaps route", () => {
    expect(parseHash("#/gaps")).toEqual({ name: "gaps" });
  });
  it("gapsHash builds the hash", () => {
    expect(gapsHash()).toBe("#/gaps");
  });
  it("keeps #/receptacle working", () => {
    expect(parseHash("#/receptacle/ABC")).toEqual({ name: "receptacle", s9: "ABC" });
  });
});

describe("parseHash settings", () => {
  it("parses #/settings", () => {
    expect(parseHash("#/settings")).toEqual({ name: "settings" });
  });
  it("still parses receptacle and defaults to report", () => {
    expect(parseHash("#/receptacle/ABC")).toEqual({ name: "receptacle", s9: "ABC" });
    expect(parseHash("#/")).toEqual({ name: "report" });
  });
});

describe("receptacleUrl", () => {
  it("builds pathname + search + receptacle hash", () => {
    // jsdom default location is http://localhost/
    expect(receptacleUrl("S9A")).toBe("/#/receptacle/S9A");
  });
  it("url-encodes the s9", () => {
    expect(receptacleUrl("A B")).toBe("/#/receptacle/A%20B");
  });
});
