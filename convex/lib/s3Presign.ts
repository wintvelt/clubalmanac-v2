// WP21: een ondertekende S3-GET-link (SigV4 in de query), zonder AWS-SDK.
//
// Standaard S3-presign: `UNSIGNED-PAYLOAD`, alleen `host` ondertekend, het pad
// per segment RFC 3986-gecodeerd, virtual-hosted host
// (`<bucket>.s3.<regio>.amazonaws.com`). De handtekening dekt methode, pad en
// query: een link opent precies dit bestand, alleen met GET, tot hij verloopt
// (A-invariant 13). Het geheim staat nooit in de link, alleen de access key
// ID in `X-Amz-Credential` (zo werkt S3; invariant 3 gaat over het geheim).
//
// Draait in de standaard Convex-runtime (Web Crypto), geen "use node".

export type S3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
};

export type PresignedLink = { url: string; expiresAt: number };

const ALGORITHM = "AWS4-HMAC-SHA256";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

/** RFC 3986: encodeURIComponent laat !'()* staan; S3 wil ze gecodeerd. */
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}

/** `20261115T120000Z` */
function amzDate(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Teken een GET-link op `key` die `expiresInSeconds` geldig is vanaf `nowMs`
 * (afgerond op de seconde, zoals `X-Amz-Date`). `expiresAt` is dat moment
 * plus de geldigheid.
 */
export async function presignS3Get(
  creds: S3Credentials,
  key: string,
  expiresInSeconds: number,
  nowMs: number,
): Promise<PresignedLink> {
  const signedAtMs = Math.floor(nowMs / 1000) * 1000;
  const date = amzDate(signedAtMs);
  const day = date.slice(0, 8);
  const scope = `${day}/${creds.region}/s3/aws4_request`;
  const host = `${creds.bucket}.s3.${creds.region}.amazonaws.com`;
  const path = `/${key.split("/").map(rfc3986).join("/")}`;

  const params: Record<string, string> = {
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Content-Sha256": UNSIGNED_PAYLOAD,
    "X-Amz-Credential": `${creds.accessKeyId}/${scope}`,
    "X-Amz-Date": date,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const query = Object.entries(params)
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = ["GET", path, query, `host:${host}\n`, "host", UNSIGNED_PAYLOAD].join("\n");
  const stringToSign = [ALGORITHM, date, scope, await sha256Hex(canonicalRequest)].join("\n");

  let signingKey = await hmac(new TextEncoder().encode(`AWS4${creds.secretAccessKey}`), day);
  for (const part of [creds.region, "s3", "aws4_request"]) signingKey = await hmac(signingKey, part);
  const signature = hex(await hmac(signingKey, stringToSign));

  return {
    url: `https://${host}${path}?${query}&X-Amz-Signature=${signature}`,
    expiresAt: signedAtMs + expiresInSeconds * 1000,
  };
}
