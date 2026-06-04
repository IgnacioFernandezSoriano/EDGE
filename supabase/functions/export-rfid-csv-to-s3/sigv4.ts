const enc = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  return hex(new Uint8Array(h));
}

async function hmac(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const keyBuf = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer;
  const k = await crypto.subtle.importKey("raw", keyBuf, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const msgBytes = enc.encode(msg);
  const msgBuf = msgBytes.buffer.slice(msgBytes.byteOffset, msgBytes.byteOffset + msgBytes.byteLength) as ArrayBuffer;
  const sig = await crypto.subtle.sign("HMAC", k, msgBuf);
  return new Uint8Array(sig);
}

// RFC 3986 encoding por segmento (no encodea '/').
function encodeSegment(seg: string): string {
  return encodeURIComponent(seg).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export interface S3PutParams {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  objectKey: string; // p.ej. "quicksight/rfid/current/rfid_movements.csv"
  body: Uint8Array;
  contentType: string;
  now: Date;
}

export async function buildS3PutRequest(
  p: S3PutParams,
): Promise<{ url: string; headers: Record<string, string> }> {
  const host = `${p.bucket}.s3.${p.region}.amazonaws.com`;
  const canonicalUri = "/" + p.objectKey.split("/").map(encodeSegment).join("/");
  const amzDate = p.now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(p.body);

  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders =
    `content-type:${p.contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "", // canonical query string (none)
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${p.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(enc.encode(canonicalRequest)),
  ].join("\n");

  const kDate = await hmac(enc.encode("AWS4" + p.secretAccessKey), dateStamp);
  const kRegion = await hmac(kDate, p.region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      "Content-Type": p.contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "Authorization": authorization,
    },
  };
}
