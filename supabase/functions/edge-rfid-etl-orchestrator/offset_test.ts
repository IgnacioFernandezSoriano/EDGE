import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractOffset } from "./offset.ts";

Deno.test("offset with colon", () => {
  assertEquals(extractOffset("2026-07-03T19:50:40.907+09:00"), "+09:00");
});
Deno.test("half-hour offset", () => {
  assertEquals(extractOffset("2026-07-03T20:20:40.907+05:30"), "+05:30");
});
Deno.test("compact offset is normalized to include colon", () => {
  assertEquals(extractOffset("2026-07-03T20:20:40.907+0530"), "+05:30");
});
Deno.test("negative offset", () => {
  assertEquals(extractOffset("2026-07-03T07:50:40.907-03:00"), "-03:00");
});
Deno.test("Z means UTC", () => {
  assertEquals(extractOffset("2026-07-03T10:50:40.907Z"), "Z");
});
Deno.test("naive timestamp has no offset", () => {
  assertEquals(extractOffset("2026-07-03 10:50:40.907"), null);
});
Deno.test("empty and null", () => {
  assertEquals(extractOffset(""), null);
  assertEquals(extractOffset(null), null);
});
