import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseReaderEditRequest } from "./request.ts";

Deno.test("accepts a valid lpi + whitelisted operation fields", () => {
  const r = parseReaderEditRequest({
    lpi: "J11D1",
    operation: { edi_equivalent_outbound: "2320", handover_point: true },
  });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.lpi, "J11D1");
    assertEquals(r.operation, { edi_equivalent_outbound: "2320", handover_point: true });
  }
});

Deno.test("rejects a missing lpi", () => {
  assertEquals(parseReaderEditRequest({ operation: { gate_purpose: "x" } }).ok, false);
});

Deno.test("rejects an unknown operation key", () => {
  const r = parseReaderEditRequest({ lpi: "J11D1", operation: { product: ["leg2"] } });
  assertEquals(r.ok, false);
});

Deno.test("rejects an empty operation", () => {
  assertEquals(parseReaderEditRequest({ lpi: "J11D1", operation: {} }).ok, false);
});
