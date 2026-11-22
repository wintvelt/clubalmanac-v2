import { afterEach, beforeEach, expect, vi } from "vitest";
import type { DefaultFunctionArgs, FunctionReference } from "convex/server";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { registerUser, withUser } from "../_helpers/auth";
import { seedMember } from "../_helpers/membership";
import {
  fixture,
  parseR2Link,
  R2_HOST,
  r2SignatureProblem,
  seedVideo,
  seedWorld,
  useVideosEnv,
  WEBMASTER,
  type FakeR2,
  type T,
} from "../videos/_videos";

// WP38a — gedeelde opzet voor de tests van het filmproject (backend).
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Spec-criticus
// aanvullingen, §A-invarianten, §Testcontract.
//
// De originelen staan in een eigen bucket (A-keuze, `R2_ORIGINALS_BUCKET`),
// met het endpoint en de sleutels van WP37. Die bucket is hier een tweede
// nep-R2 (`OriginalsR2`) die multipart spreekt zoals S3: aanmaken
// (`POST ?uploads`), een deel (`PUT ?partNumber&uploadId`), de lijst van delen
// (`GET ?uploadId`), afronden (`POST ?uploadId`), afbreken
// (`DELETE ?uploadId`), en verder HEAD, GET (ook met Range), DELETE en de
// lijsten van de bucket. Zoals R2: alle delen even groot behalve het laatste,
// en elk deel behalve het laatste minstens 5 MiB. De bucket van de albums
// (WP37) blijft de `FakeR2` uit tests/videos/_videos.ts.
//
// De links naar de app (deel-PUT, download-GET) worden herberekend met het
// test-geheim, onafhankelijk van de code (`r2SignatureProblem`).

export const ORIGINALS_BUCKET = "test-originals-bucket";
export const MIB = 1024 * 1024;
/** A-keuze: delen van 32 MiB. Oracle, niet uit de code. */
export const PART_BYTES_ORACLE = 32 * MIB;
/** A-invariant 4: een deel-link geldt 7 dagen. */
export const PART_LINK_SECONDS_ORACLE = 7 * 24 * 60 * 60;
/** A-keuze: een downloadlink geldt 1 uur. */
export const DOWNLOAD_LINK_SECONDS_ORACLE = 3600;
export const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;

/** Fix-cyclus 1 (regie): een origineel is minstens 5 MiB (anders `te_klein`). */
export const MIN_ORIGINAL_BYTES_ORACLE = 5 * MIB;
/** Fix-cyclus 1 (A-keuze): hooguit 300 keer `startOriginal` en `finishOriginal` samen per lid in 24 uur. */
export const ORIGINAL_CALLS_PER_DAY_ORACLE = 300;

/**
 * Een iPhone-achtige QuickTime-opname (`qt  `) met `©xyz` en `location.ISO6709`
 * (WP37-fixture), aangevuld tot 6 MiB: boven de ondergrens van 5 MiB, in één
 * deel. De backend ontleedt het bestand niet, dus de nullen achteraan doen
 * niets af aan "een filmpje".
 */
export const ORIGINAL = padTo(fixture("iphone-like.mov"), 6 * MIB);

/** Precies dezelfde bytes (zonder de trage diff van `toEqual` op megabytes). */
export function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Bytes aangevuld met nullen tot `size`. */
export function padTo(bytes: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(Math.max(size, bytes.byteLength)));
  out.set(bytes);
  return out;
}

// --- forward-declared refs (convex/filmProjects.ts bestaat nog niet) -------

type Ref<K extends "query" | "mutation" | "action", A extends DefaultFunctionArgs, R> = FunctionReference<K, "public", A, R>;
/**
 * `albumId` is `null` als het filmalbum na sluiten verwijderd is (besluit 17);
 * `albumName` is dan de naam bij het openen. Een open project heeft altijd zijn
 * album (`albums.remove` weigert zolang het open staat).
 */
export type ProjectRow = {
  projectId: string;
  albumId: string | null;
  albumName: string;
  endsAt: number;
  open: boolean;
};
export type OpenRow = { groupId: string; projectId: string; albumId: string; albumName: string; endsAt: number };
export type OriginalRow = {
  originalId: string;
  ownerName: string;
  mine: boolean;
  status: "onderweg" | "binnen";
  durationMs: number;
  submittedAt: number;
  takenAt: number | null;
};
export type ProjectView = {
  project: { projectId: string; groupId: string; albumId: string | null; albumName: string; endsAt: number; open: boolean };
  isFounder: boolean;
  originals: OriginalRow[];
};
export type StartOriginalResult =
  | { kind: "upload"; originalId: string; partSize: number; parts: { partNumber: number; url: string }[]; expiresAt: number }
  | { kind: "done"; originalId: string };
export type FinishOriginalResult = { kind: "done" } | { kind: "missing"; parts: number[] };

export const filmApi = (
  api as unknown as {
    filmProjects: {
      open: Ref<"mutation", { groupId: Id<"groups">; albumId: Id<"albums">; endsAt: number }, string>;
      close: Ref<"mutation", { projectId: string }, null>;
      setEndsAt: Ref<"mutation", { projectId: string; endsAt: number }, null>;
      listForGroup: Ref<"query", { groupId: Id<"groups"> }, ProjectRow[]>;
      listOpenForMe: Ref<"query", Record<string, never>, OpenRow[]>;
      get: Ref<"query", { projectId: string }, ProjectView>;
      startOriginal: Ref<"action", { photoId: Id<"photos">; bytes: number }, StartOriginalResult>;
      finishOriginal: Ref<"action", { originalId: string }, FinishOriginalResult>;
      withdraw: Ref<"mutation", { originalId: string }, null>;
      downloadUrl: Ref<"action", { originalId: string }, { url: string; expiresAt: number }>;
      removeOriginal: Ref<"mutation", { originalId: string }, null>;
      removeAll: Ref<"mutation", { projectId: string }, null>;
    };
  }
).filmProjects;

export const filmInternal = (
  internal as unknown as {
    filmProjects: {
      completeUploaded: FunctionReference<"action", "internal", Record<string, never>, unknown>;
      expireOriginals: FunctionReference<"mutation", "internal", Record<string, never>, unknown>;
      checkStorage: FunctionReference<"action", "internal", Record<string, never>, unknown>;
    };
  }
).filmProjects;

// --- omgeving ----------------------------------------------------------------

/**
 * De omgeving van WP37 (vaste klok, R2- en mail-env, nep-R2 voor de albums)
 * plus `R2_ORIGINALS_BUCKET` en een nep-R2 voor de originelen.
 */
export function useFilmEnv(): { r2: FakeR2; orig: OriginalsR2 } {
  const videos = useVideosEnv();
  const holder = { r2: videos.r2, orig: new OriginalsR2() };
  beforeEach(() => {
    process.env.R2_ORIGINALS_BUCKET = ORIGINALS_BUCKET;
    holder.orig.reset();
    holder.orig.install();
  });
  afterEach(() => {
    delete process.env.R2_ORIGINALS_BUCKET;
  });
  return {
    get r2() {
      return holder.r2;
    },
    get orig() {
      return holder.orig;
    },
  };
}

// --- nep-R2 voor de originelen ---------------------------------------------

type Chunk = { offset: number; bytes: Uint8Array };
type StoredObject = { size: number; chunks: Chunk[]; etag: string; lastModified: number };
type Part = { size: number; bytes: Uint8Array; etag: string };
type Multipart = { key: string; uploadId: string; parts: Map<number, Part>; initiated: number };

export type OrigCall = {
  method: string;
  bucket: string;
  key: string | null;
  query: Record<string, string>;
  signed: boolean;
  headers: Record<string, string>;
};

const MIN_PART = 5 * MIB;

export class OriginalsR2 {
  objects = new Map<string, StoredObject>();
  uploads = new Map<string, Multipart>();
  calls: OrigCall[] = [];
  /**
   * Vóór elk verzoek van de backend (na het noteren). Geeft hij een antwoord,
   * dan krijgt de backend dat (bv. een storing); anders gaat het verzoek
   * gewoon door. Voor gelijktijdigheid: hier kan een test een tweede aanroep
   * helemaal laten lopen voordat dit verzoek wordt afgehandeld (`onceBefore`).
   */
  beforeRequest: ((call: OrigCall) => Response | void | Promise<Response | void>) | null = null;
  /** Zet op true om elke mail naar Mailjet te laten mislukken (500). */
  mailDown = false;
  private version = 0;

  reset(): void {
    this.objects.clear();
    this.uploads.clear();
    this.calls = [];
    this.beforeRequest = null;
    this.mailDown = false;
    this.version = 0;
  }

  private nextEtag(): string {
    this.version += 1;
    return `"o${this.version}"`;
  }

  /** Een object direct neerzetten (bv. een wees). */
  put(key: string, bytes: Uint8Array, lastModified = Date.now()): void {
    this.objects.set(key, { size: bytes.byteLength, chunks: [{ offset: 0, bytes }], etag: this.nextEtag(), lastModified });
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }

  /** De bytes van een object, voor zover echt aanwezig (de rest is nul). */
  bytesOf(key: string): Uint8Array | undefined {
    const o = this.objects.get(key);
    return o ? this.read(o, 0, o.size - 1) : undefined;
  }

  sizeOf(key: string): number | undefined {
    return this.objects.get(key)?.size;
  }

  creates(): OrigCall[] {
    return this.calls.filter((c) => c.method === "POST" && "uploads" in c.query);
  }

  /**
   * Wat R2 doet met een PUT op een deel-link van de app: de handtekening moet
   * kloppen voor PUT met precies deze grootte, de link mag niet verlopen zijn,
   * en de upload moet nog bestaan. `data` is de inhoud, of alleen een grootte
   * (een deel vol nullen, zonder het in het geheugen te zetten).
   */
  async putPart(url: string, data: Uint8Array | number): Promise<number> {
    const size = typeof data === "number" ? data : data.byteLength;
    const link = parseR2Link(url);
    const problem = await r2SignatureProblem(link, "PUT", size);
    if (problem !== null) return 403;
    if (Date.now() > link.dateMs + link.expiresS * 1000) return 403;
    if (link.bucket !== ORIGINALS_BUCKET) return 403;
    const partNumber = Number(link.params.partNumber);
    const uploadId = link.params.uploadId ?? "";
    const up = this.uploads.get(uploadId);
    if (!up || up.key !== link.key || !Number.isInteger(partNumber) || partNumber < 1) return 404;
    up.parts.set(partNumber, { size, bytes: typeof data === "number" ? new Uint8Array() : data, etag: this.nextEtag() });
    return 200;
  }

  private read(o: StoredObject, start: number, end: number): Uint8Array {
    const out = new Uint8Array(Math.max(0, end - start + 1));
    for (const c of o.chunks) {
      const from = Math.max(start, c.offset);
      const to = Math.min(end, c.offset + c.bytes.byteLength - 1);
      if (from > to) continue;
      out.set(c.bytes.subarray(from - c.offset, to - c.offset + 1), from - start);
    }
    return out;
  }

  install(): void {
    const previous = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : null;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(url);
      if (this.mailDown && /mailjet/.test(u.host)) {
        return new Response(JSON.stringify({ ErrorMessage: "storing" }), { status: 500 });
      }
      if (u.host === R2_HOST || u.host.endsWith(`.${R2_HOST}`)) {
        const bucket =
          u.host === R2_HOST ? decodeURIComponent(u.pathname.slice(1).split("/")[0] ?? "") : u.host.slice(0, -(R2_HOST.length + 1));
        if (bucket === ORIGINALS_BUCKET) {
          const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
          const headers = new Headers(init?.headers ?? req?.headers ?? {});
          const body = init?.body ?? (req ? await req.text() : null);
          return this.handle(u, method, headers, body);
        }
      }
      return previous(input, init);
    });
  }

  private async handle(u: URL, method: string, headers: Headers, body: BodyInit | null): Promise<Response> {
    let rawKey: string;
    if (u.host === R2_HOST) {
      const [, ...rest] = u.pathname.slice(1).split("/");
      rawKey = rest.join("/");
    } else {
      rawKey = u.pathname.slice(1);
    }
    const key = rawKey === "" ? null : rawKey.split("/").map(decodeURIComponent).join("/");
    const query: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    const authorization = headers.get("authorization") ?? "";
    const signed = authorization.startsWith("AWS4-HMAC-SHA256") || u.searchParams.has("X-Amz-Signature");
    const lowered: Record<string, string> = {};
    for (const [name, value] of headers) lowered[name] = value;
    const call: OrigCall = { method, bucket: ORIGINALS_BUCKET, key, query, signed, headers: lowered };
    this.calls.push(call);
    if (this.beforeRequest) {
      const override = await this.beforeRequest(call);
      if (override) return override;
    }
    if (!signed) return xml("<Error><Code>AccessDenied</Code></Error>", 403);
    const signedHeaders = (u.searchParams.get("X-Amz-SignedHeaders") ?? /SignedHeaders=([^,\s]+)/.exec(authorization)?.[1] ?? "")
      .toLowerCase()
      .split(";");
    for (const [name] of headers) {
      if (name.startsWith("x-amz-") && !signedHeaders.includes(name)) {
        return xml("<Error><Code>AccessDenied</Code><Message>HeadersNotSigned</Message></Error>", 403);
      }
    }

    // De bucket zelf: lijst van objecten of van halve uploads.
    if (key === null) {
      if (method !== "GET") return new Response(null, { status: 405 });
      if ("uploads" in query) {
        const items = [...this.uploads.values()]
          .map(
            (m) =>
              `<Upload><Key>${esc(m.key)}</Key><UploadId>${esc(m.uploadId)}</UploadId><Initiated>${new Date(m.initiated).toISOString()}</Initiated></Upload>`,
          )
          .join("");
        return xml(
          `<?xml version="1.0" encoding="UTF-8"?><ListMultipartUploadsResult><Bucket>${ORIGINALS_BUCKET}</Bucket><IsTruncated>false</IsTruncated>${items}</ListMultipartUploadsResult>`,
          200,
        );
      }
      const prefix = query.prefix ?? "";
      const contents = [...this.objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(
          ([k, o]) =>
            `<Contents><Key>${esc(k)}</Key><LastModified>${new Date(o.lastModified).toISOString()}</LastModified><Size>${o.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
        )
        .join("");
      return xml(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${ORIGINALS_BUCKET}</Name><Prefix>${esc(prefix)}</Prefix><KeyCount>${this.objects.size}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
        200,
      );
    }

    // Multipart.
    if (method === "POST" && "uploads" in query) {
      const uploadId = `mpu-${Math.random().toString(36).slice(2)}-${this.uploads.size + 1}`;
      this.uploads.set(uploadId, { key, uploadId, parts: new Map(), initiated: Date.now() });
      return xml(
        `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><Bucket>${ORIGINALS_BUCKET}</Bucket><Key>${esc(key)}</Key><UploadId>${esc(uploadId)}</UploadId></InitiateMultipartUploadResult>`,
        200,
      );
    }
    if (query.uploadId !== undefined) {
      const up = this.uploads.get(query.uploadId);
      if (!up || up.key !== key) return xml("<Error><Code>NoSuchUpload</Code></Error>", 404);
      if (method === "PUT") {
        // Een deel vanaf de server zelf (niet via een link van de app).
        const bytes = new Uint8Array(await new Response(body).arrayBuffer());
        const n = Number(query.partNumber);
        const etag = this.nextEtag();
        up.parts.set(n, { size: bytes.byteLength, bytes, etag });
        return new Response(null, { status: 200, headers: { ETag: etag } });
      }
      if (method === "GET") {
        const parts = [...up.parts.entries()]
          .sort(([a], [b]) => a - b)
          .map(([n, p]) => `<Part><PartNumber>${n}</PartNumber><ETag>${esc(p.etag)}</ETag><Size>${p.size}</Size><LastModified>${new Date().toISOString()}</LastModified></Part>`)
          .join("");
        return xml(
          `<?xml version="1.0" encoding="UTF-8"?><ListPartsResult><Bucket>${ORIGINALS_BUCKET}</Bucket><Key>${esc(key)}</Key><UploadId>${esc(up.uploadId)}</UploadId><IsTruncated>false</IsTruncated>${parts}</ListPartsResult>`,
          200,
        );
      }
      if (method === "DELETE") {
        this.uploads.delete(up.uploadId);
        return new Response(null, { status: 204 });
      }
      if (method === "POST") {
        const text = typeof body === "string" ? body : await new Response(body).text();
        const listed = [...text.matchAll(/<Part>\s*<PartNumber>(\d+)<\/PartNumber>\s*<ETag>([^<]*)<\/ETag>\s*<\/Part>/g)].map((m) => ({
          n: Number(m[1]),
          etag: unesc(m[2]!),
        }));
        if (listed.length === 0) return xml("<Error><Code>MalformedXML</Code></Error>", 400);
        const strip = (s: string) => s.trim().replace(/^"|"$/g, "");
        const chosen: Part[] = [];
        for (let i = 0; i < listed.length; i++) {
          const { n, etag } = listed[i]!;
          if (i > 0 && n <= listed[i - 1]!.n) return xml("<Error><Code>InvalidPartOrder</Code></Error>", 400);
          const p = up.parts.get(n);
          if (!p || strip(p.etag) !== strip(etag)) return xml("<Error><Code>InvalidPart</Code></Error>", 400);
          chosen.push(p);
        }
        // Zoals R2: alle delen behalve het laatste even groot, en minstens 5 MiB.
        for (let i = 0; i < chosen.length - 1; i++) {
          if (chosen[i]!.size < MIN_PART) return xml("<Error><Code>EntityTooSmall</Code></Error>", 400);
          if (chosen[i]!.size !== chosen[0]!.size) return xml("<Error><Code>InvalidPart</Code></Error>", 400);
        }
        const chunks: Chunk[] = [];
        let offset = 0;
        for (const p of chosen) {
          if (p.bytes.byteLength > 0) chunks.push({ offset, bytes: p.bytes });
          offset += p.size;
        }
        const etag = `"mp-${this.version + 1}-${chosen.length}"`;
        this.version += 1;
        this.objects.set(key, { size: offset, chunks, etag, lastModified: Date.now() });
        this.uploads.delete(up.uploadId);
        return xml(
          `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult><Bucket>${ORIGINALS_BUCKET}</Bucket><Key>${esc(key)}</Key><ETag>${esc(etag)}</ETag></CompleteMultipartUploadResult>`,
          200,
        );
      }
      return new Response(null, { status: 405 });
    }

    const obj = this.objects.get(key);
    if (method === "DELETE") {
      this.objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (method === "PUT") {
      // Een gewone PUT (of een CopyObject) hoort niet bij originelen; noteren en opslaan.
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      this.put(key, bytes);
      return new Response(null, { status: 200 });
    }
    if (!obj) return method === "HEAD" ? new Response(null, { status: 404 }) : xml("<Error><Code>NoSuchKey</Code></Error>", 404);
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "Content-Length": String(obj.size), ETag: obj.etag } });
    }
    if (method === "GET") {
      const m = headers.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
      if (m) {
        const start = Number(m[1]);
        const end = m[2] === "" ? obj.size - 1 : Math.min(Number(m[2]), obj.size - 1);
        if (start >= obj.size) return new Response(null, { status: 416 });
        const part = this.read(obj, start, end);
        return new Response(part as BodyInit, {
          status: 206,
          headers: { "Content-Range": `bytes ${start}-${end}/${obj.size}`, "Content-Length": String(part.byteLength), ETag: obj.etag },
        });
      }
      return new Response(this.read(obj, 0, obj.size - 1) as BodyInit, { status: 200, headers: { ETag: obj.etag } });
    }
    return new Response(null, { status: 405 });
  }
}

/**
 * Eén keer, bij het eerste verzoek dat aan `match` voldoet: eerst `run` helemaal
 * laten lopen (bv. een tweede afronding, terugtrekken), dan pas dat verzoek
 * afhandelen. Zo ligt een gelijktijdigheid vast, zonder op de planning van
 * `Promise.all` te rekenen. `fired()` zegt of het gebeurd is.
 */
export function onceBefore(
  orig: OriginalsR2,
  match: (call: OrigCall) => boolean,
  run: () => Promise<unknown>,
): { fired: () => boolean } {
  let done = false;
  orig.beforeRequest = async (call) => {
    if (done || !match(call)) return;
    done = true;
    orig.beforeRequest = null;
    await run();
  };
  return { fired: () => done };
}

/** Een storing van R2 (500) op elk verzoek dat aan `match` voldoet. */
export function failWhen(orig: OriginalsR2, match: (call: OrigCall) => boolean): void {
  orig.beforeRequest = (call) => (match(call) ? xml("<Error><Code>InternalError</Code></Error>", 500) : undefined);
}

function xml(s: string, status: number): Response {
  return new Response(s, { status, headers: { "Content-Type": "application/xml" } });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function unesc(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// --- wereld ------------------------------------------------------------------

export const asFilm = {
  alice: (t: T) => withUser(t, "user_alice"),
  bob: (t: T) => withUser(t, "user_bob"),
  carol: (t: T) => withUser(t, "user_carol"),
  dave: (t: T) => withUser(t, "user_dave"),
  erik: (t: T) => withUser(t, "user_erik"),
  wm: (t: T) => withUser(t, "user_wm", WEBMASTER),
};

export type FilmWorld = Awaited<ReturnType<typeof seedFilmWorld>>;

/**
 * De wereld van WP37 (groep "Reis": alice oprichter en admin, bob lid; album
 * "Georgië"; groep "Ander" van dave met album "Elders"; carol nergens lid; wm
 * webmaster) plus album "Tbilisi" in Reis (Y) en erik, admin van Reis maar
 * geen oprichter. Het filmalbum (X) is in de tests "Georgië".
 */
export async function seedFilmWorld(t: T) {
  const w = await seedWorld(t);
  const erik = await registerUser(t, "user_erik", "erik@x.com", "Erik");
  await seedMember(t, { groupId: w.groups.reis, userId: erik, role: "admin" });
  const tbilisi = await t.run(async (ctx) =>
    ctx.db.insert("albums", { groupId: w.groups.reis, name: "Tbilisi", createdBy: w.users.alice, createdAt: Date.now() }),
  );
  return { ...w, users: { ...w.users, erik }, albums: { ...w.albums, tbilisi } };
}

export function advance(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

/** Alice (oprichter) zet een project open op Georgië, 14 dagen. */
export async function openProject(t: T, w: FilmWorld, endsInMs = 14 * 24 * 60 * 60 * 1000): Promise<string> {
  return await asFilm.alice(t).mutation(filmApi.open, {
    groupId: w.groups.reis,
    albumId: w.albums.georgie,
    endsAt: Date.now() + endsInMs,
  });
}

/** Een nieuw filmpje in het filmalbum, een minuut na nu (dus na het openen). */
export async function newVideoInX(
  t: T,
  r2: FakeR2,
  w: FilmWorld,
  ownerId: Id<"users">,
  extra: { takenAt?: number; durationMs?: number } = {},
): Promise<Id<"photos">> {
  advance(MINUTE_MS);
  const v = await seedVideo(t, r2, { ownerId, albumId: w.albums.georgie, ...extra });
  return v.photoId;
}

type Client = ReturnType<typeof withUser>;

/** Aanmelden; geeft het antwoord (moet `upload` zijn). */
export async function announce(
  client: Client,
  photoId: Id<"photos">,
  bytes: number,
): Promise<Extract<StartOriginalResult, { kind: "upload" }>> {
  const s = await client.action(filmApi.startOriginal, { photoId, bytes });
  expect(s.kind, `verwacht kind "upload", kreeg ${JSON.stringify(s)}`).toBe("upload");
  return s as Extract<StartOriginalResult, { kind: "upload" }>;
}

/** Aanmelden, alle delen versturen (als de app) en afronden. Geeft de inzending-id. */
export async function sendOriginal(
  client: Client,
  orig: OriginalsR2,
  photoId: Id<"photos">,
  file: Uint8Array = ORIGINAL,
): Promise<string> {
  const s = await announce(client, photoId, file.byteLength);
  for (const p of s.parts) {
    const from = (p.partNumber - 1) * s.partSize;
    expect(await orig.putPart(p.url, file.subarray(from, Math.min(file.byteLength, from + s.partSize)))).toBe(200);
  }
  const f = await client.action(filmApi.finishOriginal, { originalId: s.originalId });
  expect(f).toEqual({ kind: "done" });
  return s.originalId;
}

// --- uitkomsten --------------------------------------------------------------

export type Outcome = { ok: unknown } | { err: { data: unknown; message: string } };

export async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: await run() };
  } catch (e) {
    return { err: { data: (e as { data?: unknown }).data, message: e instanceof Error ? e.message : String(e) } };
  }
}

export function expectCode(o: Outcome, code: string): void {
  expect("err" in o, `verwacht een weigering (${code}), kreeg ${JSON.stringify(o)}`).toBe(true);
  if ("err" in o) expect((o.err.data as { code?: string } | undefined)?.code).toBe(code);
}

export function expectOriginalRefusal(o: Outcome, reason?: string): void {
  expect("err" in o, `verwacht ORIGINAL_REFUSED, kreeg ${JSON.stringify(o)}`).toBe(true);
  if (!("err" in o)) return;
  const data = o.err.data as { code?: string; reason?: string } | undefined;
  expect(data?.code).toBe("ORIGINAL_REFUSED");
  if (reason !== undefined) expect(data?.reason).toBe(reason);
}

/**
 * Alle geplande stappen, tot de laatste. Let op: `runAllTimers` zet de klok
 * door tot de laatste geplande stap, en dat is ook de geplande sluiting van een
 * open project. Na `settle` kan een project dus dicht zijn.
 */
export async function settle(t: T): Promise<void> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

/**
 * Alleen wat nu klaarstaat (bv. `runAfter(0)`: een mail, R2 wissen), zonder de
 * klok naar de geplande sluiting te zetten. Een paar rondes, voor een stap die
 * zelf weer een stap plant.
 */
export async function flush(t: T): Promise<void> {
  for (let i = 0; i < 3; i++) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

/**
 * De klok `ms` vooruit en de geplande stappen die in die tijd vallen laten
 * lopen (zoals de geplande sluiting), in volgorde.
 */
export async function runUntil(t: T, ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
  await flush(t);
}

/** De mails die de nep-Mailjet kreeg, aan dit adres. */
export function mailsTo(r2: FakeR2, email: string): Array<Record<string, unknown>> {
  return r2.mails.filter((m) => JSON.stringify(m.To ?? m.to ?? "").includes(email));
}

/** In welke albums staat deze rij? */
export async function albumsOf(t: T, photoId: Id<"photos">): Promise<string[]> {
  return await t.run(async (ctx) =>
    (await ctx.db.query("albumPhotos").filter((q) => q.eq(q.field("photoId"), photoId)).collect()).map((ap) => ap.albumId as string),
  );
}
