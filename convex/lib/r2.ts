// WP37: Cloudflare R2 voor de filmpjes van leden. R2 spreekt S3 (regio
// `auto`); de backend tekent zelf (lib/s3Presign), zonder SDK. Pad-stijl:
// `<R2_ENDPOINT>/<R2_BUCKET>/<sleutel>`. Draait in de standaard
// Convex-runtime (Web Crypto, fetch).
//
// - Config fail-loud (A-invariant 24): ontbreekt een env-var, dan een fout die
//   begint met `R2_CONFIG_MISSING:` met alleen de namen. De aanroeper toetst
//   eerst de toegang, dan pas de config.
// - Het geheim en een ondertekende link komen nooit in een log of fout. Deze
//   module logt niets; een mislukt verzoek geeft alleen de methode en de
//   HTTP-status.
// - Verzoeken van de server zelf (HEAD, een stuk lezen, wissen, de lijst) zijn
//   ook ondertekend in de query, kort geldig.

import { encodeKey, presignRequest, type PresignedLink } from "./s3Presign";

export type R2Config = {
  host: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export const R2_ENV_NAMES = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;

const REGION = "auto";
/** Een verzoek van de server zelf gebruikt zijn handtekening meteen. */
const SERVER_LINK_SECONDS = 60;

/** De R2-config uit de env; ontbreekt er één (of is hij leeg), dan `R2_CONFIG_MISSING:` met de namen. */
export function r2Config(): R2Config {
  const missing: string[] = [];
  const read = (name: (typeof R2_ENV_NAMES)[number]): string => {
    const value = process.env[name]?.trim() ?? "";
    if (value === "") missing.push(name);
    return value;
  };
  const endpoint = read("R2_ENDPOINT");
  const accessKeyId = read("R2_ACCESS_KEY_ID");
  const secretAccessKey = read("R2_SECRET_ACCESS_KEY");
  const bucket = read("R2_BUCKET");
  if (missing.length > 0) throw new Error(`R2_CONFIG_MISSING: ${missing.join(", ")} niet gezet`);
  let host: string;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") throw new Error("geen https");
    host = url.host;
  } catch {
    throw new Error("R2_CONFIG_MISSING: R2_ENDPOINT is geen https-adres");
  }
  return { host, bucket, accessKeyId, secretAccessKey };
}

function objectPath(cfg: R2Config, key: string): string {
  return `/${encodeKey(cfg.bucket)}/${encodeKey(key)}`;
}

/**
 * Een ondertekende link op precies deze sleutel, met precies deze methode.
 * `extra.query` (bv. `response-content-type`) en `extra.headers` (bv.
 * `content-length`, `x-amz-copy-source`) zijn mee ondertekend.
 */
export async function presignR2(
  cfg: R2Config,
  method: "GET" | "PUT" | "HEAD" | "DELETE",
  key: string,
  expiresInSeconds: number,
  nowMs: number,
  extra: { query?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<PresignedLink> {
  return await presignRequest({
    method,
    host: cfg.host,
    path: objectPath(cfg, key),
    region: REGION,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    expiresInSeconds,
    nowMs,
    ...extra,
  });
}

/** Een fout van R2 zonder link of geheim: alleen de methode en de status. */
export class R2Error extends Error {
  constructor(
    readonly method: string,
    readonly status: number | null,
  ) {
    super(status === null ? `R2 ${method}: netwerkfout` : `R2 ${method}: HTTP ${status}`);
  }
}

async function serverFetch(
  cfg: R2Config,
  method: "GET" | "HEAD" | "DELETE",
  key: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const { url } = await presignR2(cfg, method, key, SERVER_LINK_SECONDS, Date.now());
  try {
    return await fetch(url, { method, headers });
  } catch {
    throw new R2Error(method, null);
  }
}

/** De grootte en de ETag van een object, of `null` als het er niet staat. */
export async function headObject(cfg: R2Config, key: string): Promise<{ size: number; etag: string | null } | null> {
  const res = await serverFetch(cfg, "HEAD", key);
  await res.body?.cancel();
  if (res.status === 404) return null;
  if (!res.ok) throw new R2Error("HEAD", res.status);
  const size = Number(res.headers.get("Content-Length") ?? "");
  if (!Number.isFinite(size) || size < 0) throw new R2Error("HEAD", res.status);
  return { size, etag: res.headers.get("ETag") };
}

/**
 * Bytes `start` tot en met `end` van een object (een begrensd range-verzoek),
 * met de ETag van wat R2 stuurde.
 */
export async function readRange(
  cfg: R2Config,
  key: string,
  start: number,
  end: number,
): Promise<{ bytes: Uint8Array; etag: string | null }> {
  const res = await serverFetch(cfg, "GET", key, { Range: `bytes=${start}-${Math.max(start, end)}` });
  if (res.status === 416) {
    await res.body?.cancel();
    return { bytes: new Uint8Array(), etag: null };
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new R2Error("GET", res.status);
  }
  const etag = res.headers.get("ETag");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const length = end - start + 1;
  // Een server die de Range negeert, stuurt alles; meer dan gevraagd telt niet.
  if (res.status === 200 && start > 0) return { bytes: bytes.subarray(start, start + length), etag };
  return { bytes: bytes.byteLength > length ? bytes.subarray(0, length) : bytes, etag };
}

/** De eerste `length` bytes van een object. */
export async function readHead(cfg: R2Config, key: string, length: number): Promise<Uint8Array> {
  return (await readRange(cfg, key, 0, Math.max(0, length - 1))).bytes;
}

/**
 * CopyObject binnen de bucket, alleen als de bron nog de ETag `ifMatch` heeft
 * (A-invariant 12), met `content-type: video/mp4` en REPLACE. `false`: de bron
 * is intussen anders (412) of weg (404); er is dan niets gekopieerd. Elke
 * andere uitkomst (geen antwoord, geen `CopyObjectResult`) gooit `R2Error`:
 * de kopie kan dan toch gelukt zijn. De headers zijn mee ondertekend.
 */
export async function copyObject(cfg: R2Config, from: string, to: string, ifMatch: string): Promise<boolean> {
  // A-invariant 12: het type opnieuw zetten (REPLACE), zodat R2 het als
  // video/mp4 bewaart, wat de app bij de PUT ook meestuurde.
  const headers = {
    "content-type": "video/mp4",
    "x-amz-copy-source": `/${encodeKey(cfg.bucket)}/${encodeKey(from)}`,
    "x-amz-copy-source-if-match": ifMatch,
    "x-amz-metadata-directive": "REPLACE",
  };
  const { url } = await presignR2(cfg, "PUT", to, SERVER_LINK_SECONDS, Date.now(), { headers });
  let res: Response;
  try {
    res = await fetch(url, { method: "PUT", headers });
  } catch {
    throw new R2Error("COPY", null);
  }
  const text = await res.text();
  if (res.status === 412 || res.status === 404) return false;
  // S3 kan een fout ook met 200 geven, met de fout in de body.
  if (!res.ok || !text.includes("CopyObjectResult")) throw new R2Error("COPY", res.status);
  return true;
}

/** Wis een object. Een object dat er niet staat, is ook weg. */
export async function deleteObject(cfg: R2Config, key: string): Promise<void> {
  const res = await serverFetch(cfg, "DELETE", key);
  await res.body?.cancel();
  if (!res.ok && res.status !== 404) throw new R2Error("DELETE", res.status);
}

export type R2Object = { key: string; lastModified: number; size: number };

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? unescapeXml(m[1]!) : null;
}

/** Alle objecten in de bucket (ListObjectsV2, per 1000). */
export async function listObjects(cfg: R2Config): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let token: string | null = null;
  for (let page = 0; page < 1000; page++) {
    const query: Record<string, string> = { "list-type": "2", "max-keys": "1000" };
    if (token !== null) query["continuation-token"] = token;
    const { url } = await presignRequest({
      method: "GET",
      host: cfg.host,
      path: `/${encodeKey(cfg.bucket)}`,
      region: REGION,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      expiresInSeconds: SERVER_LINK_SECONDS,
      nowMs: Date.now(),
      query,
    });
    let res: Response;
    try {
      res = await fetch(url, { method: "GET" });
    } catch {
      throw new R2Error("LIST", null);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new R2Error("LIST", res.status);
    }
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = m[1]!;
      const key = tag(block, "Key");
      if (key === null) continue;
      const lastModified = Date.parse(tag(block, "LastModified") ?? "");
      out.push({ key, lastModified: Number.isFinite(lastModified) ? lastModified : 0, size: Number(tag(block, "Size") ?? 0) });
    }
    if (tag(xml, "IsTruncated") !== "true") return out;
    token = tag(xml, "NextContinuationToken");
    if (token === null) return out;
  }
  return out;
}
