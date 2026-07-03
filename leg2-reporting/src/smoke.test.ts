import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("scaffold", () => {
  it("cn merges classes", () => {
    expect(cn("a", "b", false && "c")).toBe("a b");
  });
});
