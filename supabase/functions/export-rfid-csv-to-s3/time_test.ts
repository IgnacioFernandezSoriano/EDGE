import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { toUtcIso, offsetForZone, toLocalIsoWithOffset } from "./time.ts";

Deno.test("toUtcIso keeps Z, drops millis", () => {
  assertEquals(toUtcIso("2026-05-27T02:48:19.000Z"), "2026-05-27T02:48:19Z");
  assertEquals(toUtcIso("2026-05-27T02:48:19Z"), "2026-05-27T02:48:19Z");
});

Deno.test("toUtcIso returns null for empty/invalid", () => {
  assertEquals(toUtcIso(null), null);
  assertEquals(toUtcIso(""), null);
  assertEquals(toUtcIso("not-a-date"), null);
});

Deno.test("offsetForZone resolves IANA zones incl. DST", () => {
  assertEquals(offsetForZone(new Date("2026-05-27T02:48:19Z"), "Asia/Tokyo"), "+09:00");
  assertEquals(offsetForZone(new Date("2026-07-01T12:00:00Z"), "America/New_York"), "-04:00");
  assertEquals(offsetForZone(new Date("2026-01-01T12:00:00Z"), "America/New_York"), "-05:00");
  assertEquals(offsetForZone(new Date("2026-05-27T02:48:19Z"), "UTC"), "Z");
  assertEquals(offsetForZone(new Date("2026-01-01T12:00:00Z"), "Asia/Kolkata"), "+05:30");
});

Deno.test("toLocalIsoWithOffset derives local wall time + offset", () => {
  // Tokyo +09:00: 02:48:19Z -> 11:48:19+09:00 (matches spec example)
  assertEquals(
    toLocalIsoWithOffset("2026-05-27T02:48:19Z", "Asia/Tokyo"),
    "2026-05-27T11:48:19+09:00",
  );
  // No zone -> UTC with Z
  assertEquals(toLocalIsoWithOffset("2026-05-27T02:48:19Z", null), "2026-05-27T02:48:19Z");
  // Null instant -> null
  assertEquals(toLocalIsoWithOffset(null, "Asia/Tokyo"), null);
  assertEquals(
    toLocalIsoWithOffset("2026-01-01T12:00:00Z", "America/New_York"),
    "2026-01-01T07:00:00-05:00",
  );
});
