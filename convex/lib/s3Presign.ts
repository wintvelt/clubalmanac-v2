// WP21: een ondertekende S3-GET-link (SigV4 in de query), zonder AWS-SDK.
// WP37: dezelfde signer voor R2 (`presignRequest`: elke methode, eigen host).
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
  return await presignRequest({
    method: "GET",
    host: `${creds.bucket}.s3.${creds.region}.amazonaws.com`,
    path: `/${encodeKey(key)}`,
    region: creds.region,
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    expiresInSeconds,
    nowMs,
  });
}

/** Een sleutel als pad: per segment RFC 3986-gecodeerd. */
export function encodeKey(key: string): string {
  return key.split("/").map(rfc3986).join("/");
}

/**
 * WP37: een ondertekend verzoek in de query (SigV4, `UNSIGNED-PAYLOAD`, alleen
 * `host` ondertekend) voor elke methode en elke host, ook R2 (regio `auto`,
 * pad-stijl). `path` is al gecodeerd; `query` zijn extra parameters (bv. voor
 * een lijst), die de handtekening mee dekt. `headers` worden mee ondertekend
 * (namen in kleine letters, bv. `content-length` of `x-amz-copy-source`); de
 * aanroeper stuurt ze met precies die waarde mee. De handtekening dekt
 * methode, pad, query en die headers.
 */
export async function presignRequest(opts: {
  method: "GET" | "PUT" | "HEAD" | "DELETE" | "POST";
  host: string;
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresInSeconds: number;
  nowMs: number;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}): Promise<PresignedLink> {
  const signedAtMs = Math.floor(opts.nowMs / 1000) * 1000;
  const date = amzDate(signedAtMs);
  const day = date.slice(0, 8);
  const scope = `${day}/${opts.region}/s3/aws4_request`;

  const signed: [string, string][] = [
    ["host", opts.host] as [string, string],
    ...Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()] as [string, string]),
  ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = signed.map(([k]) => k).join(";");
  const canonicalHeaders = signed.map(([k, v]) => `${k}:${v}\n`).join("");

  const params: Record<string, string> = {
    ...(opts.query ?? {}),
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Content-Sha256": UNSIGNED_PAYLOAD,
    "X-Amz-Credential": `${opts.accessKeyId}/${scope}`,
    "X-Amz-Date": date,
    "X-Amz-Expires": String(opts.expiresInSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const query = Object.entries(params)
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [opts.method, opts.path, query, canonicalHeaders, signedHeaders, UNSIGNED_PAYLOAD].join("\n");
  const stringToSign = [ALGORITHM, date, scope, await sha256Hex(canonicalRequest)].join("\n");

  let signingKey = await hmac(new TextEncoder().encode(`AWS4${opts.secretAccessKey}`), day);
  for (const part of [opts.region, "s3", "aws4_request"]) signingKey = await hmac(signingKey, part);
  const signature = hex(await hmac(signingKey, stringToSign));

  return {
    url: `https://${opts.host}${opts.path}?${query}&X-Amz-Signature=${signature}`,
    expiresAt: signedAtMs + opts.expiresInSeconds * 1000,
  };
}
