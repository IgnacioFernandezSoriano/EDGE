import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseReprocessRequest } from "./request.ts";

Deno.test("global needs no value", () => {
  assertEquals(parseReprocessRequest({ scope: "global" }), { ok: true, scope: "global" });
});

Deno.test("reader requires a non-empty lpi", () => {
  assertEquals(parseReprocessRequest({ scope: "reader", lpi: " ABC " }), { ok: true, scope: "reader", lpi: "ABC" });
  assertEquals(parseReprocessRequest({ scope: "reader", lpi: "  " }).ok, false);
  assertEquals(parseReprocessRequest({ scope: "reader" }).ok, false);
});

Deno.test("site requires a non-empty centre_code", () => {
  assertEquals(parseReprocessRequest({ scope: "site", centre_code: "abc-123" }), { ok: true, scope: "site", centre_code: "abc-123" });
  assertEquals(parseReprocessRequest({ scope: "site", centre_code: "" }).ok, false);
});

Deno.test("unknown or missing scope is rejected", () => {
  assertEquals(parseReprocessRequest({ scope: "everything" }).ok, false);
  assertEquals(parseReprocessRequest({}).ok, false);
  assertEquals(parseReprocessRequest(null).ok, false);
});
