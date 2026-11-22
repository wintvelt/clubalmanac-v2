import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { modules } from "../_helpers/modules";
import { registerUser, withUser } from "../_helpers/auth";
import { seedMember } from "../_helpers/membership";
import { SCHOON } from "../_helpers/jpeg";

// WP37 — gedeelde opzet voor de video-tests.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §Spec-criticus
// aanvullingen, §A-invarianten, §Testcontract.
//
// R2 is hier een nep-bucket in het geheugen achter een gestubde `fetch`. Hij
// spreekt het S3-pad (`<endpoint>/<bucket>/<sleutel>`, of de bucket als
// subdomein) met HEAD, GET (ook met Range), PUT, DELETE en het lijsten van de
// bucket (ListObjectsV2 en de oude vorm). Of R2 de handtekening van een
// server-verzoek aanneemt, toetst de gate; hier alleen dát elk verzoek
// ondertekend is. De links naar de app (PUT, GET) worden wél herberekend met
// het test-geheim, onafhankelijk van de code (regio `auto`).

export type T = ReturnType<typeof convexTest>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type R = Record<string, any>;

export const FIXED_NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** A-keuze: 120 MiB. Hier los uitgeschreven (oracle), niet uit de code. */
export const MAX_VIDEO_BYTES_ORACLE = 120 * 1024 * 1024;

export const ENV = {
  R2_ENDPOINT: "https://testaccount0000000000000000000000.eu.r2.cloudflarestorage.com",
  R2_ACCESS_KEY_ID: "r2testaccesskey00000000000000000",
  R2_SECRET_ACCESS_KEY: "r2-testgeheim/NIET-ECHT+0123456789abcdef0123456789",
  R2_BUCKET: "test-videos-bucket",
} as const;
export type EnvName = keyof typeof ENV;
export const ENV_NAMES = Object.keys(ENV) as EnvName[];
export const R2_HOST = new URL(ENV.R2_ENDPOINT).host;
export const WEBMASTER = "wm@x.com";

// --- fixtures ----------------------------------------------------------------

/** Testfilmpjes uit tests/fixtures/wp37 (zie de README daar). */
export function fixture(name: string): Uint8Array<ArrayBuffer> {
  const raw = readFileSync(fileURLToPath(new URL(`../fixtures/wp37/${name}`, import.meta.url)));
  const out = new Uint8Array(new ArrayBuffer(raw.byteLength));
  out.set(raw);
  return out;
}

export const PLAIN = fixture("plain.mp4");
export const POSTER = SCHOON;

// --- forward-declared refs (convex/videos.ts bestaat nog niet) --------------

type StartArgs = { uploadId: string; albumId: Id<"albums">; durationMs: number; bytes: number };
type StartResult = { kind: "upload"; url: string; expiresAt: number } | { kind: "done"; photoId: Id<"photos"> };
type LinkResult = { url: string; expiresAt: number };

export const videosApi = (
  api as unknown as {
    videos: {
      startUpload: FunctionReference<"action", "public", StartArgs, StartResult>;
      playUrl: FunctionReference<"action", "public", { photoId: Id<"photos"> }, LinkResult>;
    };
  }
).videos;

export const videosInternal = (
  internal as unknown as {
    videos: {
      checkStorage: FunctionReference<"action", "internal", Record<string, never>, unknown>;
    };
  }
).videos;

// --- omgeving ----------------------------------------------------------------

export function newT(): T {
  return convexTest(schema, modules);
}

/** Vaste klok, R2- en mail-env-vars, en een schone nep-R2 per test. */
export function useVideosEnv(): { r2: FakeR2 } {
  const holder = { r2: new FakeR2() };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    for (const name of ENV_NAMES) process.env[name] = ENV[name];
    process.env.WEBMASTER_EMAILS = WEBMASTER;
    process.env.MAILJET_VERIFIED_SENDERS = "info@clubalmanac.com";
    process.env.MAILJET_API_KEY = "k";
    process.env.MAILJET_API_SECRET = "s";
    process.env.CLUBALMANAC_STAGE = "dev";
    holder.r2.reset();
    holder.r2.install();
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const name of ENV_NAMES) delete process.env[name];
    for (const name of ["WEBMASTER_EMAILS", "MAILJET_VERIFIED_SENDERS", "MAILJET_API_KEY", "MAILJET_API_SECRET", "CLUBALMANAC_STAGE"]) {
      delete process.env[name];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  return holder;
}

// --- nep-R2 ------------------------------------------------------------------

/** A-invariant 11: de app PUT onder dit prefix; het filmpje in het album staat onder FINAL_PREFIX. */
export const TMP_PREFIX = "uploads/";
export const FINAL_PREFIX = "videos/";

export type R2Call = {
  method: string;
  bucket: string;
  key: string | null;
  url: string;
  signed: boolean;
  range: string | null;
  /** Bij een CopyObject: de bron (`bucket/sleutel`) en de if-match. */
  copySource?: string;
  copyIfMatch?: string | null;
  /** Alle headers van het verzoek, met kleine letters. */
  headers: Record<string, string>;
};

type StoredObject = { bytes: Uint8Array; lastModified: number; etag: string; contentType: string | null };

/**
 * Hoe een CopyObject antwoordt. `normal`: 200 met `CopyObjectResult`. `lost`:
 * R2 kopieert, maar het antwoord komt niet aan (netwerkfout). `noResult`: R2
 * kopieert en geeft 200 zonder `CopyObjectResult`.
 */
export type CopyMode = "normal" | "lost" | "noResult";

export class FakeR2 {
  objects = new Map<string, StoredObject>();
  calls: R2Call[] = [];
  mails: Array<Record<string, unknown>> = [];
  /** Zet op true om elk R2-verzoek met een netwerkfout te laten falen. */
  down = false;
  /** Een grootte die HEAD en de lijst melden, zonder 120 MiB in het geheugen. */
  sizes = new Map<string, number>();
  /** Na elke beantwoorde GET op een object (bv. om het object daarna te wisselen). */
  onGet: ((key: string, range: string | null) => void | Promise<void>) | null = null;
  /** Vóór elk verzoek naar R2 (na het noteren), bv. om de database te bekijken. */
  beforeRequest: ((call: R2Call) => void | Promise<void>) | null = null;
  copyMode: CopyMode = "normal";
  /** HEAD zonder ETag-header. */
  headWithoutEtag = false;
  private version = 0;

  reset(): void {
    this.objects.clear();
    this.calls = [];
    this.mails = [];
    this.down = false;
    this.sizes.clear();
    this.onGet = null;
    this.beforeRequest = null;
    this.copyMode = "normal";
    this.headWithoutEtag = false;
    this.version = 0;
  }

  /** Een object direct neerzetten (zoals een PUT); elke versie een eigen ETag. */
  put(key: string, bytes: Uint8Array, lastModified = Date.now(), contentType: string | null = null): void {
    this.version += 1;
    this.objects.set(key, { bytes, lastModified, etag: `"v${this.version}"`, contentType });
  }

  contentTypeOf(key: string): string | null | undefined {
    return this.objects.get(key)?.contentType;
  }

  bytesOf(key: string): Uint8Array | undefined {
    return this.objects.get(key)?.bytes;
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }

  deletes(): string[] {
    return this.calls.filter((c) => c.method === "DELETE" && c.key !== null).map((c) => c.key!);
  }

  copies(): R2Call[] {
    return this.calls.filter((c) => c.copySource !== undefined);
  }

  /** De bytes die de backend in totaal met GET las (som van de ranges). */
  bytesRead(key: string): number {
    let total = 0;
    for (const c of this.calls) {
      if (c.method !== "GET" || c.key !== key) continue;
      const m = c.range?.match(/^bytes=(\d+)-(\d+)$/);
      const size = this.sizes.get(key) ?? this.objects.get(key)?.bytes.byteLength ?? 0;
      total += m ? Math.min(Number(m[2]), size - 1) - Number(m[1]) + 1 : size;
    }
    return total;
  }

  /**
   * Wat R2 doet met een PUT op een ondertekende link van de app (iemand die de
   * link heeft, ook na afronden of weigeren): de handtekening moet kloppen voor
   * PUT met precies deze grootte, en de link mag niet verlopen zijn. Anders 403
   * en niets opgeslagen.
   */
  async putViaLink(url: string, bytes: Uint8Array): Promise<number> {
    const link = parseR2Link(url);
    const problem = await r2SignatureProblem(link, "PUT", bytes.byteLength);
    if (problem !== null || Date.now() > link.dateMs + link.expiresS * 1000 || link.bucket !== ENV.R2_BUCKET) return 403;
    this.put(link.key, bytes);
    return 200;
  }

  install(): void {
    const previous = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : null;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers ?? req?.headers ?? {});
      const u = new URL(url);
      if (u.host === R2_HOST || u.host.endsWith(`.${R2_HOST}`)) {
        return this.handle(u, method, headers, init?.body ?? null);
      }
      if (/mailjet/.test(u.host)) {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
          Messages?: Array<Record<string, unknown>>;
        };
        for (const m of body.Messages ?? []) this.mails.push(m);
        return new Response(JSON.stringify({ Messages: [{ Status: "success" }] }), { status: 200 });
      }
      if (u.host === "api.clerk.com") {
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      }
      return previous(input, init);
    });
  }

  private async handle(u: URL, method: string, headers: Headers, body: BodyInit | null): Promise<Response> {
    let bucket: string;
    let rawKey: string;
    if (u.host === R2_HOST) {
      const [first, ...rest] = u.pathname.slice(1).split("/");
      bucket = decodeURIComponent(first ?? "");
      rawKey = rest.join("/");
    } else {
      bucket = u.host.slice(0, -(R2_HOST.length + 1));
      rawKey = u.pathname.slice(1);
    }
    const key = rawKey === "" ? null : rawKey.split("/").map(decodeURIComponent).join("/");
    const authorization = headers.get("authorization") ?? "";
    const signed = authorization.startsWith("AWS4-HMAC-SHA256") || u.searchParams.has("X-Amz-Signature");
    const range = headers.get("range");
    const copySource = headers.get("x-amz-copy-source");
    const lowered: Record<string, string> = {};
    for (const [name, value] of headers) lowered[name] = value;
    const call: R2Call = { method, bucket, key, url: u.href, signed, range, headers: lowered };
    if (copySource !== null) {
      call.copySource = copySource;
      call.copyIfMatch = headers.get("x-amz-copy-source-if-match");
    }
    this.calls.push(call);
    await this.beforeRequest?.(call);
    if (this.down) throw new TypeError("fetch failed");
    if (bucket !== ENV.R2_BUCKET) return new Response("<Error><Code>NoSuchBucket</Code></Error>", { status: 404 });
    if (!signed) return new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });
    // Zoals S3: een x-amz-*-header die niet mee ondertekend is, wordt geweigerd
    // ("There were headers present in the request which were not signed").
    const signedHeaders = (
      u.searchParams.get("X-Amz-SignedHeaders") ?? /SignedHeaders=([^,\s]+)/.exec(authorization)?.[1] ?? ""
    )
      .toLowerCase()
      .split(";");
    for (const [name] of headers) {
      if (name.startsWith("x-amz-") && !signedHeaders.includes(name)) {
        return new Response("<Error><Code>AccessDenied</Code><Message>HeadersNotSigned</Message></Error>", { status: 403 });
      }
    }

    if (key === null) {
      if (method !== "GET") return new Response(null, { status: 405 });
      const prefix = u.searchParams.get("prefix") ?? "";
      const contents = [...this.objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(
          ([k, o]) =>
            `<Contents><Key>${escapeXml(k)}</Key><LastModified>${new Date(o.lastModified).toISOString()}</LastModified><Size>${this.sizes.get(k) ?? o.bytes.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
        )
        .join("");
      const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${ENV.R2_BUCKET}</Name><Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${this.objects.size}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
      return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
    }

    const obj = this.objects.get(key);
    if (method === "DELETE") {
      this.objects.delete(key);
      this.sizes.delete(key);
      return new Response(null, { status: 204 });
    }
    if (method === "PUT" && copySource !== null) {
      // CopyObject: bron `/<bucket>/<sleutel>` (of zonder de eerste schuine streep), url-gecodeerd.
      const decoded = decodeURIComponent(copySource.replace(/^\//, ""));
      const slash = decoded.indexOf("/");
      const srcBucket = slash < 0 ? decoded : decoded.slice(0, slash);
      const srcKey = slash < 0 ? "" : decoded.slice(slash + 1);
      const src = srcBucket === ENV.R2_BUCKET ? this.objects.get(srcKey) : undefined;
      if (!src) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
      const ifMatch = headers.get("x-amz-copy-source-if-match");
      const strip = (s: string) => s.trim().replace(/^"|"$/g, "");
      if (ifMatch !== null && strip(ifMatch) !== strip(src.etag)) {
        return new Response("<Error><Code>PreconditionFailed</Code></Error>", { status: 412 });
      }
      const replace = (headers.get("x-amz-metadata-directive") ?? "COPY").toUpperCase() === "REPLACE";
      this.put(key, src.bytes.slice(), Date.now(), replace ? headers.get("content-type") : src.contentType);
      const copied = this.objects.get(key)!;
      if (this.sizes.has(srcKey)) this.sizes.set(key, this.sizes.get(srcKey)!);
      if (this.copyMode === "lost") throw new TypeError("fetch failed");
      if (this.copyMode === "noResult") return new Response("", { status: 200 });
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>${escapeXml(copied.etag)}</ETag><LastModified>${new Date(copied.lastModified).toISOString()}</LastModified></CopyObjectResult>`,
        { status: 200, headers: { "Content-Type": "application/xml" } },
      );
    }
    if (method === "PUT") {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      this.put(key, bytes, Date.now(), headers.get("content-type"));
      return new Response(null, { status: 200 });
    }
    if (!obj) return new Response(method === "HEAD" ? null : "<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
    const size = obj.bytes.byteLength;
    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Length": String(this.sizes.get(key) ?? size),
          "Content-Type": obj.contentType ?? "application/octet-stream",
          ...(this.headWithoutEtag ? {} : { ETag: obj.etag }),
        },
      });
    }
    if (method === "GET") {
      const m = range?.match(/^bytes=(\d+)-(\d*)$/);
      let res: Response;
      if (m) {
        const start = Number(m[1]);
        const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
        if (start >= size) return new Response(null, { status: 416 });
        const part = obj.bytes.slice(start, end + 1);
        res = new Response(part, {
          status: 206,
          headers: {
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(part.byteLength),
            ETag: obj.etag,
          },
        });
      } else {
        res = new Response(obj.bytes.slice(), { status: 200, headers: { "Content-Length": String(size), ETag: obj.etag } });
      }
      await this.onGet?.(key, range);
      return res;
    }
    return new Response(null, { status: 405 });
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- ondertekende links naar de app ----------------------------------------

export type ParsedLink = {
  url: URL;
  bucket: string;
  key: string;
  params: Record<string, string>;
  expiresS: number;
  dateMs: number;
};

export function parseR2Link(raw: string): ParsedLink {
  const url = new URL(raw);
  expect(url.protocol).toBe("https:");
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  let bucket: string;
  let rawPath: string;
  if (url.host === R2_HOST) {
    const [first, ...rest] = url.pathname.slice(1).split("/");
    bucket = decodeURIComponent(first ?? "");
    rawPath = rest.join("/");
  } else {
    expect(url.host.endsWith(`.${R2_HOST}`), `link gaat niet naar R2_ENDPOINT: ${url.host}`).toBe(true);
    bucket = url.host.slice(0, -(R2_HOST.length + 1));
    rawPath = url.pathname.slice(1);
  }
  const key = rawPath.split("/").map(decodeURIComponent).join("/");
  const amzDate = params["X-Amz-Date"] ?? "";
  const m = amzDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  expect(m, `X-Amz-Date ontbreekt of is ongeldig: ${amzDate}`).toBeTruthy();
  const dateMs = Date.UTC(+m![1]!, +m![2]! - 1, +m![3]!, +m![4]!, +m![5]!, +m![6]!);
  return { url, bucket, key, params, expiresS: Number(params["X-Amz-Expires"]), dateMs };
}

function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}

/**
 * Herbereken de SigV4-handtekening (query, regio `auto`) met het test-geheim.
 * GET: alleen `host` ondertekend. PUT (A-invariant 11): `content-length;host`,
 * met `contentLength` als waarde; een andere grootte of geen grootte klopt
 * niet. Klopt hij, dan opent R2 met deze link precies dit pad, met precies
 * deze methode (en bij PUT precies deze grootte), en niets anders. `null` als
 * hij klopt, anders wat er mis is.
 */
export async function r2SignatureProblem(link: ParsedLink, method: "GET" | "PUT", contentLength?: number): Promise<string | null> {
  const p = link.params;
  if (p["X-Amz-Algorithm"] !== "AWS4-HMAC-SHA256") return "X-Amz-Algorithm";
  const wantSigned = method === "PUT" ? "content-length;host" : "host";
  if (p["X-Amz-SignedHeaders"] !== wantSigned) return `X-Amz-SignedHeaders is ${p["X-Amz-SignedHeaders"]}, verwacht ${wantSigned}`;
  if (method === "PUT" && (contentLength === undefined || !Number.isInteger(contentLength))) return "PUT zonder grootte";
  const day = (p["X-Amz-Date"] ?? "").slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  if (p["X-Amz-Credential"] !== `${ENV.R2_ACCESS_KEY_ID}/${scope}`) return "X-Amz-Credential";
  const signature = p["X-Amz-Signature"] ?? "";
  if (!/^[0-9a-f]{64}$/.test(signature)) return "X-Amz-Signature ontbreekt";
  const canonicalQuery = Object.entries(p)
    .filter(([k]) => k !== "X-Amz-Signature")
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalHeaders =
    method === "PUT" ? `content-length:${contentLength}\nhost:${link.url.host}\n` : `host:${link.url.host}\n`;
  const canonicalRequest = [method, link.url.pathname, canonicalQuery, canonicalHeaders, wantSigned, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", p["X-Amz-Date"], scope, await sha256Hex(canonicalRequest)].join("\n");
  let key: ArrayBuffer = await hmac(new TextEncoder().encode(`AWS4${ENV.R2_SECRET_ACCESS_KEY}`), day);
  for (const part of ["auto", "s3", "aws4_request"]) key = await hmac(key, part);
  const expected = Array.from(new Uint8Array(await hmac(key, stringToSign)), (b) => b.toString(16).padStart(2, "0")).join("");
  return signature === expected ? null : `handtekening klopt niet voor ${method} op dit pad${method === "PUT" ? ` met grootte ${contentLength}` : ""}`;
}

export async function expectValidR2Signature(link: ParsedLink, method: "GET" | "PUT", contentLength?: number): Promise<void> {
  expect(await r2SignatureProblem(link, method, contentLength)).toBeNull();
}

// --- wereld ------------------------------------------------------------------

export const as = {
  alice: (t: T) => withUser(t, "user_alice"),
  bob: (t: T) => withUser(t, "user_bob"),
  carol: (t: T) => withUser(t, "user_carol"),
  dave: (t: T) => withUser(t, "user_dave"),
  wm: (t: T) => withUser(t, "user_wm", WEBMASTER),
};

export type World = Awaited<ReturnType<typeof seedWorld>>;

/**
 * Groep "Reis" (alice admin, bob lid) met album "Georgië". Groep "Ander" (dave
 * admin) met album "Elders". carol is nergens lid; wm is webmaster en nergens
 * lid.
 */
export async function seedWorld(t: T) {
  const alice = await registerUser(t, "user_alice", "alice@x.com", "Alice");
  const bob = await registerUser(t, "user_bob", "bob@x.com", "Bob");
  const carol = await registerUser(t, "user_carol", "carol@x.com", "Carol");
  const dave = await registerUser(t, "user_dave", "dave@x.com", "Dave");
  const wm = await registerUser(t, "user_wm", WEBMASTER, "Webmaster");
  const { reis, ander, georgie, elders } = await t.run(async (ctx) => {
    const reis = await ctx.db.insert("groups", { name: "Reis", createdBy: alice, createdAt: FIXED_NOW });
    const ander = await ctx.db.insert("groups", { name: "Ander", createdBy: dave, createdAt: FIXED_NOW });
    const georgie = await ctx.db.insert("albums", { groupId: reis, name: "Georgië", createdBy: alice, createdAt: FIXED_NOW });
    const elders = await ctx.db.insert("albums", { groupId: ander, name: "Elders", createdBy: dave, createdAt: FIXED_NOW });
    return { reis, ander, georgie, elders };
  });
  await seedMember(t, { groupId: reis, userId: alice, role: "admin" });
  await seedMember(t, { groupId: reis, userId: bob, role: "member" });
  await seedMember(t, { groupId: ander, userId: dave, role: "admin" });
  return { users: { alice, bob, carol, dave, wm }, groups: { reis, ander }, albums: { georgie, elders } };
}

/**
 * Een filmpje-rij direct in de database, met de poster in storage en (als
 * gegeven) in een album. Het object in R2 wordt ook neergezet, tenzij
 * `inR2: false`.
 */
export async function seedVideo(
  t: T,
  r2: FakeR2,
  opts: {
    ownerId: Id<"users">;
    albumId?: Id<"albums">;
    key?: string;
    durationMs?: number;
    bytes?: Uint8Array;
    takenAt?: number;
    latitude?: number;
    longitude?: number;
    flagged?: boolean;
    inR2?: boolean;
    poster?: Uint8Array;
  },
): Promise<{ photoId: Id<"photos">; key: string; posterId: Id<"_storage"> }> {
  const key = opts.key ?? `videos/test-${Math.random().toString(36).slice(2)}.mp4`;
  const bytes = opts.bytes ?? PLAIN;
  if (opts.inR2 !== false) r2.put(key, bytes);
  const res = await t.run(async (ctx) => {
    const posterId = await ctx.storage.store(new Blob([(opts.poster ?? POSTER) as BlobPart], { type: "image/jpeg" }));
    const owner = await ctx.db.get(opts.ownerId);
    const photoId = await ctx.db.insert("photos", {
      ownerId: opts.ownerId,
      storageId: posterId,
      mimeType: "image/jpeg",
      width: 1080,
      height: 1920,
      ...(opts.takenAt !== undefined ? { takenAt: opts.takenAt } : {}),
      ...(opts.latitude !== undefined ? { latitude: opts.latitude, longitude: opts.longitude } : {}),
      ...(opts.flagged ? { flaggedAt: Date.now(), flaggedDeleteDate: Date.now() + 14 * DAY_MS, flagReason: "test" } : {}),
      video: { key, durationMs: opts.durationMs ?? 2000, bytes: bytes.byteLength },
      createdAt: Date.now(),
    } as never);
    if (owner) await ctx.db.patch(opts.ownerId, { photoCount: owner.photoCount + 1 });
    if (opts.albumId) {
      const album = await ctx.db.get(opts.albumId);
      await ctx.db.insert("albumPhotos", {
        albumId: opts.albumId,
        photoId,
        groupId: album!.groupId,
        addedAt: Date.now(),
        addedBy: opts.ownerId,
      });
    }
    return { photoId, posterId };
  });
  return { ...res, key };
}

/** Een gewone foto-rij, voor vergelijking. */
export async function seedPhoto(t: T, ownerId: Id<"users">, albumId?: Id<"albums">): Promise<Id<"photos">> {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([POSTER], { type: "image/jpeg" }));
    const photoId = await ctx.db.insert("photos", { ownerId, storageId, mimeType: "image/jpeg", createdAt: Date.now() });
    if (albumId) {
      const album = await ctx.db.get(albumId);
      await ctx.db.insert("albumPhotos", { albumId, photoId, groupId: album!.groupId, addedAt: Date.now(), addedBy: ownerId });
    }
    return photoId;
  });
}

// --- uitkomsten --------------------------------------------------------------

export type Outcome = { ok: unknown } | { err: { data: unknown; message: string } };

export async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: await run() };
  } catch (e) {
    const data = (e as { data?: unknown }).data;
    return { err: { data, message: e instanceof Error ? e.message : String(e) } };
  }
}

export function expectUploadRefusal(o: Outcome, reason: string): void {
  expect("err" in o, `verwacht een weigering (${reason}), kreeg ${JSON.stringify(o)}`).toBe(true);
  if ("err" in o) expect(o.err.data).toEqual({ code: "VIDEO_UPLOAD_REFUSED", reason });
}

export const PLAY_REFUSAL = { code: "VIDEO_NOT_FOUND" };

export function expectPlayRefusal(o: Outcome): void {
  expect("err" in o, `verwacht een weigering, kreeg ${JSON.stringify(o)}`).toBe(true);
  if ("err" in o) expect(o.err.data).toEqual(PLAY_REFUSAL);
}

// --- de upload zoals de app hem doet ---------------------------------------

type Client = ReturnType<typeof withUser>;

export async function start(
  client: Client,
  args: { uploadId: string; albumId: Id<"albums">; durationMs?: number; bytes?: number },
): Promise<StartResult> {
  return await client.action(videosApi.startUpload, {
    uploadId: args.uploadId,
    albumId: args.albumId,
    durationMs: args.durationMs ?? 2000,
    bytes: args.bytes ?? PLAIN.byteLength,
  });
}

/**
 * De app PUT het bestand naar de ondertekende link (controleert de link
 * eerst, met de grootte van het bestand, zoals R2). Geeft de tijdelijke sleutel.
 */
export async function putAsApp(r2: FakeR2, url: string, bytes: Uint8Array): Promise<string> {
  const link = parseR2Link(url);
  expect(link.bucket).toBe(ENV.R2_BUCKET);
  await expectValidR2Signature(link, "PUT", bytes.byteLength);
  r2.put(link.key, bytes);
  return link.key;
}

/** De sleutel in de rij van een filmpje (de eindsleutel). */
export async function videoKeyOf(t: T, photoId: string): Promise<string> {
  const row = (await t.run(async (ctx) => ctx.db.get(photoId as Id<"photos">))) as R | null;
  expect(row?.video?.key, "de rij heeft geen video.key").toBeTruthy();
  return row!.video.key as string;
}

export function finish(
  client: Client,
  opts: { uploadId: string; poster?: Uint8Array; headers?: Record<string, string> },
): Promise<Response> {
  return client.fetch("/upload/video", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg", "X-Upload-Id": opts.uploadId, ...(opts.headers ?? {}) },
    body: (opts.poster ?? POSTER) as BodyInit,
  });
}

/** Aanvragen, PUT en afronden. */
export async function fullUpload(
  client: Client,
  r2: FakeR2,
  opts: { uploadId: string; albumId: Id<"albums">; file?: Uint8Array; durationMs?: number; headers?: Record<string, string> },
): Promise<{ res: Response; key: string }> {
  const file = opts.file ?? PLAIN;
  const s = await start(client, { uploadId: opts.uploadId, albumId: opts.albumId, durationMs: opts.durationMs, bytes: file.byteLength });
  expect(s.kind).toBe("upload");
  const key = await putAsApp(r2, (s as { url: string }).url, file);
  const res = await finish(client, { uploadId: opts.uploadId, headers: opts.headers });
  return { res, key };
}

/** Alles wat een upload kan achterlaten. */
export async function leftovers(t: T, r2: FakeR2, ownerId: Id<"users">) {
  return await t.run(async (ctx) => ({
    photos: (await ctx.db.query("photos").filter((q) => q.eq(q.field("ownerId"), ownerId)).collect()).length,
    reservations: (await ctx.db.query("uploadIdempotency").collect()).length,
    storage: (await ctx.db.system.query("_storage").collect()).length,
    albumPhotos: (await ctx.db.query("albumPhotos").collect()).length,
    photoCount: (await ctx.db.get(ownerId))!.photoCount,
    r2: r2.objects.size,
  }));
}
