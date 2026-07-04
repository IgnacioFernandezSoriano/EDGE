import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseReprocessRequest } from "./request.ts";

Deno.test("accepts a valid site_impc_code", () => {
  assertEquals(parseReprocessRequest({ site_impc_code: "INMUBA" }), {
    ok: true,
    site_impc_code: "INMUBA",
  });
});

Deno.test("trims surrounding whitespace", () => {
  assertEquals(parseReprocessRequest({ site_impc_code: "  INMUBA  " }), {
    ok: true,
    site_impc_code: "INMUBA",
  });
});

Deno.test("rejects a missing site_impc_code", () => {
  assertEquals(parseReprocessRequest({}).ok, false);
});

Deno.test("rejects a blank site_impc_code", () => {
  assertEquals(parseReprocessRequest({ site_impc_code: "  " }).ok, false);
});

Deno.test("rejects a non-string site_impc_code", () => {
  assertEquals(parseReprocessRequest({ site_impc_code: 123 }).ok, false);
});
