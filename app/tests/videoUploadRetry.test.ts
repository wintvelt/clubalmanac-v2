import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime } from "./support/hookRuntime";

// WP37 fixronde 1, A-invariant 33: opnieuw proberen met een filmpje.
//   - Het verkleinde bestand blijft bewaard zolang opnieuw proberen kan: na een
//     uitkomst waarbij opnieuw proberen zin heeft, wist de app het niet, en een
//     herhaling met dezelfde upload-id comprimeert niet opnieuw. Het gaat pas
//     weg als het filmpje binnen is of een vaste reden kreeg.
//   - `uitgelogd` is opnieuw te proberen; met `freshToken` haalt de herhaling
//     het token niet uit de cache (zoals bij foto's).
//   - Een verlopen reservering (404 `verlopen`) is opnieuw te proberen.
// Hier draait de echte `useVideoUploader` (src/data/videoUpload.ts) in de
// kleine hook-runtime, met een nagebootste Clerk, Convex-action, module voor
// filmpjes, achtergrond-upload en `fetch`.
//   - Gate op de iPhone (A-invariant 37): valt de verbinding weg terwijl
//     `startUpload` loopt (een gewone Error, geen ConvexError), dan één
//     automatische nieuwe poging; lukt ook die niet, dan `netwerk`, niet `server`.
// Spec: docs/work-packages/WP37-filmpjes-in-albums.md §A-invarianten 32, 33, 37.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

const COMPRESSED = "file:///tmp/klein.mp4";
const POSTER_URI = "file:///tmp/poster.jpg";
const SITE = "https://demo-123.eu-west-1.convex.site";

const fake = vi.hoisted(() => ({
  tokens: [] as Array<{ skipCache: boolean }>,
  compress: 0,
  removed: [] as string[],
  starts: 0,
  putStatus: 200,
  finish: [] as Array<{ status: number; body: unknown } | "netwerk">,
  posterFails: 0,
  compressedMs: 2000,
  /** Fouten voor de volgende aanroepen van startUpload, op volgorde. */
  startErrors: [] as unknown[],
}));

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({
    isSignedIn: true,
    sessionClaims: { aud: "convex" },
    getToken: async (opts: { skipCache?: boolean } = {}) => {
      fake.tokens.push({ skipCache: opts.skipCache === true });
      return opts.skipCache ? "vers-token" : "cache-token";
    },
  }),
}));

vi.mock("expo-image", () => ({ Image: { clearMemoryCache: async () => true, clearDiskCache: async () => true } }));

vi.mock("convex/react", () => ({
  useAction: () => async () => {
    fake.starts += 1;
    const err = fake.startErrors.shift();
    if (err !== undefined) throw err;
    return { kind: "upload", url: "https://r2.invalid/uploads/x.mp4?X-Amz-Signature=abc", expiresAt: Date.now() + 3_600_000 };
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  FileSystemSessionType: { BACKGROUND: 0, FOREGROUND: 1 },
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  createUploadTask: () => ({ uploadAsync: async () => ({ status: fake.putStatus, body: "", headers: {} }) }),
}));

vi.mock("../modules/clubalmanac-video", () => ({
  videoModuleAvailable: true,
  readMetadata: async () => ({ creationDate: null, location: null, durationMs: 2000 }),
  compress: async () => {
    fake.compress += 1;
    return { uri: COMPRESSED, bytes: 1000, durationMs: fake.compressedMs, width: 1080, height: 1920 };
  },
  makePoster: async () => ({ uri: POSTER_URI, width: 1080, height: 1920 }),
  removeFile: async (uri: string) => {
    fake.removed.push(uri);
  },
  cancel: async () => {},
}));

type Outcome = { ok: true; photoId: string } | { ok: false; reason: string };
type Upload = (req: { asset: unknown; uploadId: string; albumId: string; freshToken?: boolean }) => Promise<Outcome>;

const ASSET = { uri: "file:///tmp/origineel.mov", type: "video", duration: 2000, width: 1080, height: 1920, assetId: "a1" };

function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === POSTER_URI) {
    if (fake.posterFails > 0) {
      fake.posterFails -= 1;
      return Promise.reject(new TypeError("bestand niet te lezen"));
    }
    return Promise.resolve(new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])])));
  }
  if (url === `${SITE}/upload/video`) {
    void init;
    const next = fake.finish.shift() ?? { status: 200, body: { photoId: "p1" } };
    if (next === "netwerk") return Promise.reject(new TypeError("Network request failed"));
    return Promise.resolve(Response.json(next.body, { status: next.status }));
  }
  return Promise.reject(new TypeError(`onverwacht verzoek: ${url}`));
}

// De uploader onthoudt het verkleinde bestand per upload-id voor deze app-sessie: elke test een eigen id.
let uploadId = "";
let counter = 0;

beforeEach(() => {
  counter += 1;
  uploadId = `film-${counter}`;
  fake.tokens = [];
  fake.compress = 0;
  fake.removed = [];
  fake.starts = 0;
  fake.putStatus = 200;
  fake.finish = [];
  fake.posterFails = 0;
  fake.compressedMs = 2000;
  fake.startErrors = [];
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(): Promise<Upload> {
  const { useVideoUploader } = await import("../src/data/videoUpload");
  const h = rt.runtime;
  expect(h.contexts.length, "sanity: de site-context").toBeGreaterThanOrEqual(1);
  h.provide(h.contexts[0]!, SITE);
  return h.render(() => useVideoUploader() as Upload);
}

const run = (upload: Upload, extra: { freshToken?: boolean } = {}) =>
  upload({ asset: ASSET, uploadId, albumId: "album-1", ...extra });

describe("het verkleinde bestand blijft zolang opnieuw proberen kan (A-invariant 33)", () => {
  it.each<[string, () => void, string]>([
    ["finish 401 (uitgelogd)", () => fake.finish.push({ status: 401, body: { error: "Unauthorized" } }), "uitgelogd"],
    ["finish 404 verlopen", () => fake.finish.push({ status: 404, body: { error: "x", reason: "verlopen" } }), "verlopen"],
    ["finish 409 niet_binnen", () => fake.finish.push({ status: 409, body: { reason: "niet_binnen" } }), "niet_binnen"],
    ["geen netwerk bij afronden", () => fake.finish.push("netwerk"), "netwerk"],
    ["R2 weigert de PUT (verlopen link)", () => (fake.putStatus = 403), "server"],
    ["de poster is even niet te lezen", () => (fake.posterFails = 1), ""],
  ])("%s: niet gewist, en de herhaling comprimeert niet opnieuw", async (_naam, arrange, reason) => {
    const upload = await mount();
    arrange();
    const first = await run(upload);
    expect(first.ok).toBe(false);
    if (reason !== "") expect(first).toEqual({ ok: false, reason });
    expect(fake.removed, "het verkleinde bestand is gewist terwijl opnieuw proberen kan").not.toContain(COMPRESSED);

    fake.putStatus = 200;
    const second = await run(upload, { freshToken: reason === "uitgelogd" });
    expect(second).toEqual({ ok: true, photoId: "p1" });
    expect(fake.compress, "opnieuw verkleind").toBe(1);
    // Binnen: nu mag (en moet) het weg.
    expect(fake.removed).toContain(COMPRESSED);
  });

  it.each([
    ["422 locatie", { status: 422, body: { reason: "locatie" } }, "locatie"],
    ["404 geen_album", { status: 404, body: { error: "x", reason: "geen_album" } }, "geen_album"],
  ])("%s (vaste reden): het verkleinde bestand gaat weg", async (_naam, response, reason) => {
    const upload = await mount();
    fake.finish.push(response);
    expect(await run(upload)).toEqual({ ok: false, reason });
    expect(fake.removed).toContain(COMPRESSED);
  });
});

describe("uitgelogd: opnieuw proberen met een vers token (A-invariant 33)", () => {
  it("de herhaling met freshToken haalt het token niet uit de cache", async () => {
    const upload = await mount();
    fake.finish.push({ status: 401, body: { error: "Unauthorized" } });
    expect(await run(upload)).toEqual({ ok: false, reason: "uitgelogd" });
    expect(fake.tokens.at(-1)).toEqual({ skipCache: false });
    expect(await run(upload, { freshToken: true })).toEqual({ ok: true, photoId: "p1" });
    expect(fake.tokens.at(-1)).toEqual({ skipCache: true });
  });
});

describe("verlopen reservering: opnieuw proberen vraagt een nieuwe upload aan (A-invariant 32)", () => {
  it("na 404 verlopen vraagt de herhaling opnieuw startUpload, zonder opnieuw te verkleinen", async () => {
    const upload = await mount();
    fake.finish.push({ status: 404, body: { error: "x", reason: "verlopen" } });
    expect(await run(upload)).toEqual({ ok: false, reason: "verlopen" });
    expect(fake.starts).toBe(1);
    expect(await run(upload)).toEqual({ ok: true, photoId: "p1" });
    expect(fake.starts).toBe(2);
    expect(fake.compress).toBe(1);
  });
});

describe("vóór het versturen al weigeren boven 180,4 s (fixronde 3)", () => {
  it("de kiezer meet 180,45 s: te_lang, zonder verkleinen en zonder aanvraag", async () => {
    const upload = await mount();
    const out = await upload({ asset: { ...ASSET, duration: 180_450 }, uploadId, albumId: "album-1" });
    expect(out).toEqual({ ok: false, reason: "te_lang" });
    expect(fake.compress).toBe(0);
    expect(fake.starts).toBe(0);
  });

  it("het verkleinde bestand duurt 180,45 s: te_lang, zonder aanvraag, en het bestand gaat weg", async () => {
    const upload = await mount();
    fake.compressedMs = 180_450;
    const out = await upload({ asset: { ...ASSET, duration: 179_000 }, uploadId, albumId: "album-1" });
    expect(out).toEqual({ ok: false, reason: "te_lang" });
    expect(fake.starts).toBe(0);
    expect(fake.removed).toContain(COMPRESSED);
  });

  it("180,4 s gaat gewoon door", async () => {
    const upload = await mount();
    fake.compressedMs = 180_400;
    const out = await upload({ asset: { ...ASSET, duration: 180_400 }, uploadId, albumId: "album-1" });
    expect(out).toEqual({ ok: true, photoId: "p1" });
  });
});

describe("startUpload valt weg: één automatische nieuwe poging (A-invariant 37)", () => {
  const LOST = "Connection lost while action was in flight";

  it("eerste aanroep weg, tweede lukt: het filmpje komt binnen, zonder opnieuw te verkleinen", async () => {
    const upload = await mount();
    fake.startErrors.push(new Error(LOST));
    expect(await run(upload)).toEqual({ ok: true, photoId: "p1" });
    expect(fake.starts).toBe(2);
    expect(fake.compress).toBe(1);
  });

  it("twee keer weg: reden netwerk (niet server), het verkleinde bestand blijft, en opnieuw proberen lukt", async () => {
    const upload = await mount();
    fake.startErrors.push(new Error(LOST), new Error(LOST));
    expect(await run(upload)).toEqual({ ok: false, reason: "netwerk" });
    expect(fake.starts, "meer dan één automatische nieuwe poging").toBe(2);
    expect(fake.removed).not.toContain(COMPRESSED);
    expect(await run(upload)).toEqual({ ok: true, photoId: "p1" });
    expect(fake.compress).toBe(1);
  });

  it("een weigering van de backend (ConvexError) wordt niet herhaald", async () => {
    const upload = await mount();
    fake.startErrors.push(new ConvexError({ code: "VIDEO_UPLOAD_REFUSED", reason: "te_vaak" }));
    expect(await run(upload)).toEqual({ ok: false, reason: "te_vaak" });
    expect(fake.starts).toBe(1);
  });

  it("een ConvexError zonder bekende code blijft server, zonder nieuwe poging", async () => {
    const upload = await mount();
    fake.startErrors.push(new ConvexError({ code: "IETS_ANDERS" }));
    expect(await run(upload)).toEqual({ ok: false, reason: "server" });
    expect(fake.starts).toBe(1);
  });
});
