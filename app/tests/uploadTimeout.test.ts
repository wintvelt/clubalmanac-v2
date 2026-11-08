import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime } from "./support/hookRuntime";

// WP18 fix-cyclus 1, invariant 20 (audit S1): een upload eindigt altijd.
//
// Komt het antwoord van /upload (versturen én het antwoord lezen) niet binnen
// een ruime termijn, dan stopt de app het verzoek en is de uitkomst "netwerk".
// Niet korter dan 60 s, niet langer dan 180 s (spec: 120 s). Een snel antwoord
// verandert niets. Opnieuw proberen stuurt dezelfde upload-id.
//
// Hier draait de echte `useUploader` (src/data/upload.ts) in de kleine
// hook-runtime, met een nagebootste Clerk, manipulator en `fetch`, en een
// nep-klok. Het nagebootste `fetch` gedraagt zich als het echte: een verzoek
// dat hangt, breekt pas af als zijn signal afbreekt, en dat geldt ook voor
// het lezen van het antwoord. `AbortSignal.timeout` loopt hier op de nep-klok,
// zodat het niet uitmaakt of B die gebruikt of een eigen timer.
//
// Spec: docs/work-packages/WP18-foto-upload.md §Fix-cyclus 1.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({
    isSignedIn: true,
    sessionClaims: { aud: "convex" },
    getToken: async () => "token-1",
  }),
}));

vi.mock("expo-image", () => ({ Image: { clearMemoryCache: async () => true, clearDiskCache: async () => true } }));

vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
  ImageManipulator: {
    manipulate: () => {
      const context = {
        resize: () => context,
        renderAsync: async () => ({
          saveAsync: async () => ({ uri: "file:///tmp/omgezet.jpg", width: 4032, height: 3024 }),
          release: () => {},
        }),
      };
      return context;
    },
  },
}));

const SITE = "https://demo-123.eu-west-1.convex.site";
const ASSET = {
  uri: "file:///tmp/gekozen.heic",
  width: 4032,
  height: 3024,
  exif: { DateTimeOriginal: "2024:06:15 14:30:00" },
};

type Outcome = { ok: true; photoId: string } | { ok: false; reason: string };
type Upload = (req: { asset: unknown; uploadId: string; albumId?: string }) => Promise<Outcome>;

/** Hoe het nagebootste /upload antwoordt. */
type Mode = "hang" | "hangBody" | "fast";
let mode: Mode = "fast";
type Post = { init: RequestInit; at: number };
let posts: Post[] = [];

function abortError(signal: AbortSignal | null | undefined): unknown {
  return signal?.reason ?? new DOMException("Aborted", "AbortError");
}

/** Een belofte die alleen afbreekt als het signal afbreekt, zoals het echte fetch. */
function untilAborted<T>(signal: AbortSignal | null | undefined): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) reject(abortError(signal));
    else signal.addEventListener("abort", () => reject(abortError(signal)), { once: true });
  });
}

function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("file:")) {
    return Promise.resolve(new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])])));
  }
  if (url !== `${SITE}/upload`) return Promise.reject(new TypeError(`onverwacht verzoek: ${url}`));
  posts.push({ init, at: Date.now() });
  const signal = init.signal;
  if (mode === "hang") return untilAborted<Response>(signal);
  if (mode === "hangBody") {
    // De status komt binnen, het antwoord zelf niet.
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      json: () => untilAborted<unknown>(signal),
      text: () => untilAborted<string>(signal),
    } as unknown as Response);
  }
  return Promise.resolve(Response.json({ photoId: "p1" }, { status: 200 }));
}

beforeEach(() => {
  vi.useFakeTimers();
  mode = "fast";
  posts = [];
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException("signal timed out", "TimeoutError")), ms);
    return c.signal;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(): Promise<Upload> {
  const { useUploader } = await import("../src/data/upload");
  const h = rt.runtime;
  // src/data/images.tsx maakt één context: de site-URL.
  expect(h.contexts.length, "sanity: de site-context").toBeGreaterThanOrEqual(1);
  h.provide(h.contexts[0]!, SITE);
  return h.render(() => useUploader() as Upload);
}

/** Start een upload en wacht tot het verzoek naar /upload de deur uit is. */
async function start(upload: Upload, uploadId = "u-1") {
  const before = posts.length;
  let result: Outcome | undefined;
  const done = upload({ asset: ASSET, uploadId, albumId: "album-1" }).then((r) => {
    result = r;
    return r;
  });
  for (let n = 0; n < 100 && posts.length === before; n++) await vi.advanceTimersByTimeAsync(0);
  expect(posts.length, "het verzoek naar /upload ging niet de deur uit").toBe(before + 1);
  return { done, post: posts[posts.length - 1]!, result: () => result };
}

const uploadIdOf = (p: Post) => new Headers(p.init.headers).get("X-Upload-Id");

describe("invariant 20: een upload eindigt altijd", () => {
  it.each<[string, Mode]>([
    ["geen antwoord", "hang"],
    ["de status wel, het antwoord niet", "hangBody"],
  ])("%s: niet vóór 60 s, wel binnen 180 s, met reden netwerk", async (_label, m) => {
    mode = m;
    const upload = await mount();
    const run = await start(upload);

    await vi.advanceTimersByTimeAsync(60_000 - 1);
    expect(run.result(), "te vroeg opgegeven").toBeUndefined();

    await vi.advanceTimersByTimeAsync(180_000 - 60_000 + 1);
    expect(run.result(), "na 180 s nog geen uitkomst").toEqual({ ok: false, reason: "netwerk" });
    await run.done;
  });

  it("het verzoek wordt gestopt (zijn signal breekt af)", async () => {
    mode = "hang";
    const upload = await mount();
    const run = await start(upload);
    const signal = run.post.init.signal;
    expect(signal, "het verzoek naar /upload heeft geen signal").toBeTruthy();
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(180_000);
    await run.done;
    expect(signal!.aborted).toBe(true);
  });

  it("een snel antwoord blijft gelijk, ook als de klok daarna doorloopt", async () => {
    mode = "fast";
    const upload = await mount();
    const run = await start(upload);
    await vi.advanceTimersByTimeAsync(0);
    expect(await run.done).toEqual({ ok: true, photoId: "p1" });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run.result()).toEqual({ ok: true, photoId: "p1" });
  });

  it("opnieuw proberen na de termijn stuurt dezelfde upload-id, met een eigen termijn", async () => {
    mode = "hang";
    const upload = await mount();
    const first = await start(upload, "u-7");
    await vi.advanceTimersByTimeAsync(180_000);
    expect(first.result()).toEqual({ ok: false, reason: "netwerk" });

    mode = "fast";
    const second = await start(upload, "u-7");
    await vi.advanceTimersByTimeAsync(0);
    expect(await second.done).toEqual({ ok: true, photoId: "p1" });
    expect(posts.map(uploadIdOf)).toEqual(["u-7", "u-7"]);
  });

  it("twee uploads tegelijk: elk zijn eigen termijn", async () => {
    mode = "hang";
    const upload = await mount();
    const a = await start(upload, "u-a");
    await vi.advanceTimersByTimeAsync(30_000);
    const b = await start(upload, "u-b");
    // b telt vanaf zijn eigen start: na 60 s min een tik loopt b nog.
    await vi.advanceTimersByTimeAsync(60_000 - 1);
    expect(b.result(), "b gaf op met de termijn van a").toBeUndefined();
    // 180 s na b zijn ze allebei klaar.
    await vi.advanceTimersByTimeAsync(180_000 - 60_000 + 1);
    expect(a.result()).toEqual({ ok: false, reason: "netwerk" });
    expect(b.result()).toEqual({ ok: false, reason: "netwerk" });
  });
});
