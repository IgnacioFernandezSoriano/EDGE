import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sha256Hex, buildS3PutRequest } from "./sigv4.ts";

const enc = new TextEncoder();

Deno.test("sha256Hex: known empty-string digest", async () => {
  assertEquals(
    await sha256Hex(enc.encode("")),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

const fixed = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secretExampleKey",
  region: "eu-central-1",
  bucket: "upu-rfid-reporting",
  objectKey: "quicksight/rfid/current/rfid_movements.csv",
  body: enc.encode("source_edge_id\nabc\n"),
  contentType: "text/csv",
  now: new Date("2026-06-04T12:34:56.000Z"),
};

Deno.test("buildS3PutRequest: url, amz-date, signed headers, no ACL", async () => {
  const { url, headers } = await buildS3PutRequest(fixed);
  assertEquals(url, "https://upu-rfid-reporting.s3.eu-central-1.amazonaws.com/quicksight/rfid/current/rfid_movements.csv");
  assertEquals(headers["x-amz-date"], "20260604T123456Z");
  assertEquals(headers["Content-Type"], "text/csv");
  assert(headers["Authorization"].startsWith("AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260604/eu-central-1/s3/aws4_request"));
  assert(headers["Authorization"].includes("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date"));
  assert(/Signature=[0-9a-f]{64}$/.test(headers["Authorization"]));
  assertEquals(headers["x-amz-content-sha256"], await sha256Hex(fixed.body));
  assert(!("x-amz-acl" in headers));
});

Deno.test("buildS3PutRequest: deterministic for fixed clock", async () => {
  const a = await buildS3PutRequest(fixed);
  const b = await buildS3PutRequest(fixed);
  assertEquals(a.headers["Authorization"], b.headers["Authorization"]);
});
