import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { csvEscape, csvRow } from "./csv.ts";

Deno.test("csvEscape: plain text unchanged", () => {
  assertEquals(csvEscape("abc"), "abc");
});
Deno.test("csvEscape: null/undefined -> empty field", () => {
  assertEquals(csvEscape(null), "");
  assertEquals(csvEscape(undefined), "");
});
Deno.test("csvEscape: quotes comma/quote/newline, doubles inner quotes", () => {
  assertEquals(csvEscape("a,b"), '"a,b"');
  assertEquals(csvEscape('she said "hi"'), '"she said ""hi"""');
  assertEquals(csvEscape("line\nbreak"), '"line\nbreak"');
  assertEquals(csvEscape("carriage\rreturn"), '"carriage\rreturn"');
});
Deno.test("csvEscape: booleans and numbers", () => {
  assertEquals(csvEscape(true), "true");
  assertEquals(csvEscape(false), "false");
  assertEquals(csvEscape(0), "0");
  assertEquals(csvEscape(23), "23");
});
Deno.test("csvRow joins escaped fields with comma", () => {
  assertEquals(csvRow(["a", "b,c", null, true]), 'a,"b,c",,true');
});
