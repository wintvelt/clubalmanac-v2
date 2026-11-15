import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { modules } from "../_helpers/modules";
import { registerUser, withUser } from "../_helpers/auth";
import { seedMember } from "../_helpers/membership";

// WP21 — gedeelde opzet voor de film-tests.
// Spec: docs/work-packages/WP21-videos.md §Spec-criticus aanvullingen,
// §Besluiten Wouter, §Testcontract.
//
// Invariant 9: alle sleutels hier zijn verzonnen. Nooit een echte
// bestandsnaam uit blob-videos in een test.

export type T = ReturnType<typeof convexTest>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type R = Record<string, any>;

export const FIXED_NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
export const THREE_HOURS_S = 3 * 60 * 60;

export const ENV = {
  FILMS_S3_ACCESS_KEY_ID: "AKIATESTFILMS0000001",
  FILMS_S3_SECRET_ACCESS_KEY: "testgeheim/films+NIET-ECHT/0123456789abcdef",
  FILMS_S3_REGION: "eu-central-1",
  FILMS_S3_BUCKET: "test-films-bucket",
} as const;
export type EnvName = keyof typeof ENV;
export const ENV_NAMES = Object.keys(ENV) as EnvName[];

// Verzonnen sleutels, met een spatie, een hoofdletter-extensie en een map,
// zoals de echte (zonder hun namen).
export const KEYS = {
  trailerVideo: "Proef trailer A.MP4",
  trailerCover: "covers/proef trailer A.png",
  filmVideo: "Proef film B 2020.mp4",
  filmCover: "covers/2020 Proef B.png",
  bareVideo: "Proef film C zonder cover.m4v",
  otherVideo: "Andere groep film D.mp4",
  otherCover: "covers/andere groep D.png",
} as const;

// --- forward-declared refs (convex/films.ts bestaat nog niet) ---------------

type FilmItem = {
  groupId: Id<"groups">;
  kind: "trailer" | "film";
  title: string;
  year: number;
  videoKey: string;
  coverKey?: string;
};
type FilmId = string;
type LinkResult = { url: string; expiresAt: number };

export const filmsApi = (
  api as unknown as {
    films: {
      list: FunctionReference<"query", "public", Record<string, never>, R[]>;
      videoUrl: FunctionReference<"action", "public", { filmId: FilmId }, LinkResult>;
      coverUrl: FunctionReference<"action", "public", { filmId: FilmId }, LinkResult>;
    };
  }
).films;

export const filmsInternal = (
  internal as unknown as {
    films: {
      replaceAll: FunctionReference<"mutation", "internal", { items: FilmItem[] }, unknown>;
      checkLinks: FunctionReference<"action", "internal", Record<string, never>, unknown>;
    };
  }
).films;

// --- omgeving ----------------------------------------------------------------

export function newT(): T {
  return convexTest(schema, modules);
}

/** Vaste klok en de S3-env-vars voor elke test in het bestand. */
export function useFilmsEnv(): void {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    for (const name of ENV_NAMES) process.env[name] = ENV[name];
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const name of ENV_NAMES) delete process.env[name];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}

// --- wereld ------------------------------------------------------------------

export type World = Awaited<ReturnType<typeof seedFilmsWorld>>;

/**
 * Groep "Blob bibliotheek" (alice lid, bob admin) met een trailer, een film
 * en een film zonder cover. Groep "Ander" (dave lid) met één film. carol is
 * nergens lid; wm is webmaster en nergens lid.
 */
export async function seedFilmsWorld(t: T) {
  const alice = await registerUser(t, "user_alice", "alice@x.com", "Alice");
  const bob = await registerUser(t, "user_bob", "bob@x.com", "Bob");
  const carol = await registerUser(t, "user_carol", "carol@x.com", "Carol");
  const dave = await registerUser(t, "user_dave", "dave@x.com", "Dave");
  const wm = await registerUser(t, "user_wm", "wm@x.com", "Webmaster");
  const [blob, other] = await t.run(async (ctx) => [
    await ctx.db.insert("groups", { name: "Blob bibliotheek", createdBy: bob, createdAt: FIXED_NOW }),
    await ctx.db.insert("groups", { name: "Ander", createdBy: dave, createdAt: FIXED_NOW }),
  ]);
  await seedMember(t, { groupId: blob, userId: alice, role: "member" });
  await seedMember(t, { groupId: blob, userId: bob, role: "admin" });
  await seedMember(t, { groupId: other, userId: dave, role: "admin" });

  const items: FilmItem[] = [
    { groupId: blob, kind: "trailer", title: "Proef trailer A", year: 2022, videoKey: KEYS.trailerVideo, coverKey: KEYS.trailerCover },
    { groupId: blob, kind: "film", title: "Proef film B", year: 2020, videoKey: KEYS.filmVideo, coverKey: KEYS.filmCover },
    { groupId: blob, kind: "film", title: "Proef film C", year: 1999, videoKey: KEYS.bareVideo },
    { groupId: other, kind: "film", title: "Andere film D", year: 2010, videoKey: KEYS.otherVideo, coverKey: KEYS.otherCover },
  ];
  await t.mutation(filmsInternal.replaceAll, { items });

  const ids = await filmIdsByTitle(t);
  return {
    users: { alice, bob, carol, dave, wm },
    groups: { blob, other },
    items,
    films: {
      trailerA: ids["Proef trailer A"]!,
      filmB: ids["Proef film B"]!,
      filmC: ids["Proef film C"]!,
      filmD: ids["Andere film D"]!,
    },
  };
}

/** Film-id's uit de tabel, op titel. De tests lezen de tabel alleen hiervoor. */
async function filmIdsByTitle(t: T): Promise<Record<string, string>> {
  return await t.run(async (ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (ctx.db as any).query("films").collect()) as R[];
    return Object.fromEntries(rows.map((r) => [r.title as string, r._id as string]));
  });
}

export function asSubject(t: T, subject: string) {
  return withUser(t, subject);
}

export const as = {
  alice: (t: T) => withUser(t, "user_alice"),
  bob: (t: T) => withUser(t, "user_bob"),
  carol: (t: T) => withUser(t, "user_carol"),
  dave: (t: T) => withUser(t, "user_dave"),
  wm: (t: T) => withUser(t, "user_wm", "wm@x.com"),
};

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

export const REFUSAL = { code: "FILM_NOT_FOUND" };

/** Een weigering is precies ConvexError({ code: "FILM_NOT_FOUND" }). */
export function expectRefusal(o: Outcome): void {
  expect("err" in o, `verwacht een weigering, kreeg ${JSON.stringify(o)}`).toBe(true);
  if ("err" in o) expect(o.err.data).toEqual(REFUSAL);
}

// --- SigV4 (query) controleren, zonder AWS ----------------------------------

export type ParsedLink = {
  url: URL;
  bucket: string;
  key: string;
  params: Record<string, string>;
  expiresS: number;
  dateMs: number;
};

/** Haal bucket, sleutel en de X-Amz-parameters uit een ondertekende S3-link. */
export function parseS3Link(raw: string): ParsedLink {
  const url = new URL(raw);
  expect(url.protocol).toBe("https:");
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  const region = ENV.FILMS_S3_REGION;
  let bucket: string;
  let rawPath: string;
  const virtual = url.host.match(/^(.+)\.s3[.-](?:[a-z0-9-]+\.)?amazonaws\.com$/);
  if (virtual) {
    bucket = virtual[1]!;
    rawPath = url.pathname.slice(1);
  } else {
    expect(url.host, "onbekende S3-host").toMatch(new RegExp(`^s3[.-](${region}\\.)?amazonaws\\.com$`));
    const [first, ...rest] = url.pathname.slice(1).split("/");
    bucket = decodeURIComponent(first!);
    rawPath = rest.join("/");
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
 * Herbereken de SigV4-handtekening van een ondertekende GET-link met het
 * test-geheim. Klopt hij, dan opent S3 met deze link precies dit pad, en
 * niets anders (de handtekening dekt het pad).
 */
export async function expectValidSignature(link: ParsedLink, method = "GET"): Promise<void> {
  const p = link.params;
  expect(p["X-Amz-Algorithm"]).toBe("AWS4-HMAC-SHA256");
  expect(p["X-Amz-SignedHeaders"], "alleen host ondertekend").toBe("host");
  const day = (p["X-Amz-Date"] ?? "").slice(0, 8);
  const scope = `${day}/${ENV.FILMS_S3_REGION}/s3/aws4_request`;
  expect(p["X-Amz-Credential"]).toBe(`${ENV.FILMS_S3_ACCESS_KEY_ID}/${scope}`);
  const signature = p["X-Amz-Signature"];
  expect(signature, "X-Amz-Signature ontbreekt").toMatch(/^[0-9a-f]{64}$/);

  const canonicalQuery = Object.entries(p)
    .filter(([k]) => k !== "X-Amz-Signature")
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    method,
    link.url.pathname,
    canonicalQuery,
    `host:${link.url.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", p["X-Amz-Date"], scope, await sha256Hex(canonicalRequest)].join("\n");
  let key: ArrayBuffer = await hmac(new TextEncoder().encode(`AWS4${ENV.FILMS_S3_SECRET_ACCESS_KEY}`), day);
  for (const part of [ENV.FILMS_S3_REGION, "s3", "aws4_request"]) key = await hmac(key, part);
  const expected = Array.from(new Uint8Array(await hmac(key, stringToSign)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  expect(signature, "handtekening klopt niet met het geheim en dit pad").toBe(expected);
}
