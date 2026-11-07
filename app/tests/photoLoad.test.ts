import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRuntime, deferred, type Deferred } from "./support/hookRuntime";

// WP17a invariant 18 (fix-cyclus 3, heraudit op 1af3f61): de aansluiting van
// `usePhotoLoad` (src/data/images.tsx) op de toestand uit src/lib/imageRetry.ts.
// app/tests/imageRetry.test.ts pint de toestand zelf; hier draait de echte hook,
// met een nagebootste Clerk (`useAuth`) en een kleine hook-runtime in plaats
// van React (tests/support/hookRuntime.ts).
//
// Wat vastligt:
// - het eerste token komt uit de cache; na een fout vraagt de hook een vers
//   token (`skipCache: true`), ook via de JWT-template "convex";
// - na een fout gaat er geen bron meer uit met het oude token, in geen enkele
//   render: de hook wacht (`source` is undefined) tot het verse token er is;
// - de tweede poging is een andere `attempt` (de key van het beeld);
// - na de tweede fout valt het beeld terug (`source` null) en volgt geen
//   nieuw token;
// - een laat token van een eerdere poging komt nooit in een bron;
// - `retry` ("Opnieuw") begint opnieuw, met een vers token.

const rt = vi.hoisted(() => ({ runtime: null as unknown as ReturnType<typeof createHookRuntime> }));
const auth = vi.hoisted(() => ({
  isSignedIn: true as boolean,
  sessionClaims: { aud: "convex" } as { aud?: string } | undefined,
  calls: [] as Record<string, unknown>[],
  tokens: [] as Deferred<string | null>[],
}));

vi.mock("react", async () => {
  const { createHookRuntime } = await import("./support/hookRuntime");
  rt.runtime = createHookRuntime();
  return rt.runtime.module;
});

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({
    isSignedIn: auth.isSignedIn,
    sessionClaims: auth.sessionClaims,
    // Niet gememoïseerd, net als bij Clerk.
    getToken: (opts: Record<string, unknown> = {}) => {
      auth.calls.push(opts);
      const d = deferred<string | null>();
      auth.tokens.push(d);
      return d.promise;
    },
  }),
}));

vi.mock("expo-image", () => ({ Image: { clearMemoryCache: async () => true, clearDiskCache: async () => true } }));

const SITE = "https://demo-123.eu-west-1.convex.site";

type Load = {
  source: { uri: string; headers?: Record<string, string> } | null | undefined;
  attempt: number;
  onError: () => void;
  retry: () => void;
};

async function mount(): Promise<Load> {
  const { usePhotoLoad } = await import("../src/data/images");
  const h = rt.runtime;
  // images.tsx maakt één context: de site-URL.
  expect(h.contexts.length, "sanity: de site-context").toBeGreaterThanOrEqual(1);
  h.provide(h.contexts[0]!, SITE);
  return h.render(() => usePhotoLoad("foto1", "klein") as Load);
}

const settle = () => rt.runtime.settle<Load>();
const bearer = (l: Load) => l.source?.headers?.Authorization;
const sentTokens = (from = 0) =>
  (rt.runtime.outputs.slice(from) as Load[]).map(bearer).filter((b): b is string => b !== undefined);

beforeEach(() => {
  auth.isSignedIn = true;
  auth.sessionClaims = { aud: "convex" };
  auth.calls.length = 0;
  auth.tokens.length = 0;
});

describe.each([
  ["sessie voor Convex", { aud: "convex" }, undefined],
  ["JWT-template convex", undefined, "convex"],
] as const)("usePhotoLoad — %s", (_name, claims, template) => {
  beforeEach(() => {
    auth.sessionClaims = claims;
  });

  it("eerste token uit de cache; laadt met dat token", async () => {
    let l = await mount();
    expect(l.source, "wacht op het token: geen bron").toBeUndefined();
    expect(auth.calls).toHaveLength(1);
    expect(auth.calls[0]!.skipCache ?? false).toBe(false);
    expect(auth.calls[0]!.template).toBe(template);
    auth.tokens[0]!.resolve("oud");
    l = await settle();
    expect(bearer(l)).toBe("Bearer oud");
    expect(l.source!.uri).toContain("/beeld/foto/foto1");
  });

  it("na een fout: geen bron met het oude token, wel een vers token met skipCache", async () => {
    await mount();
    auth.tokens[0]!.resolve("oud");
    let l = await settle();
    const firstAttempt = l.attempt;
    const mark = rt.runtime.outputs.length;

    l.onError();
    l = await settle();
    expect(l.source, "wacht op het verse token").toBeUndefined();
    expect(sentTokens(mark), "geen render met het oude token na de fout").toEqual([]);
    expect(auth.calls).toHaveLength(2);
    expect(auth.calls[1]!.skipCache).toBe(true);
    expect(auth.calls[1]!.template).toBe(template);

    auth.tokens[1]!.resolve("vers");
    l = await settle();
    expect(bearer(l)).toBe("Bearer vers");
    expect(l.attempt, "een nieuwe poging: een andere key").not.toBe(firstAttempt);
    expect(sentTokens(mark).every((b) => b === "Bearer vers")).toBe(true);
  });

  it("na de tweede fout: terugvallen, en geen token meer", async () => {
    await mount();
    auth.tokens[0]!.resolve("oud");
    let l = await settle();
    l.onError();
    l = await settle();
    auth.tokens[1]!.resolve("vers");
    l = await settle();
    l.onError();
    l = await settle();
    expect(l.source).toBeNull();
    l = await settle();
    expect(auth.calls).toHaveLength(2);
  });

  it("geen vers token: terugvallen, zonder bron met het oude", async () => {
    await mount();
    auth.tokens[0]!.resolve("oud");
    let l = await settle();
    const mark = rt.runtime.outputs.length;
    l.onError();
    l = await settle();
    auth.tokens[1]!.resolve(null);
    l = await settle();
    expect(l.source).toBeNull();
    expect(sentTokens(mark)).toEqual([]);
  });

  it("een laat token van een eerdere poging komt nooit in een bron", async () => {
    await mount();
    auth.tokens[0]!.resolve("oud");
    let l = await settle();
    l.onError();
    l = await settle(); // poging 2 wacht op token #2
    l.retry(); // een nieuwe reeks, token #3, terwijl #2 nog onderweg is
    l = await settle();
    expect(auth.calls).toHaveLength(3);
    expect(auth.calls[2]!.skipCache).toBe(true);
    const mark = rt.runtime.outputs.length;

    auth.tokens[1]!.resolve("laat");
    l = await settle();
    expect(l.source, "het late token telt niet").toBeUndefined();

    auth.tokens[2]!.resolve("nieuw");
    l = await settle();
    expect(bearer(l)).toBe("Bearer nieuw");
    expect(sentTokens(mark)).not.toContain("Bearer laat");
  });

  it("Opnieuw na terugvallen: een vers token en een nieuwe poging", async () => {
    await mount();
    auth.tokens[0]!.resolve("t1");
    let l = await settle();
    l.onError();
    l = await settle();
    auth.tokens[1]!.resolve("t2");
    l = await settle();
    const lastAttempt = l.attempt;
    l.onError();
    l = await settle();
    expect(l.source).toBeNull();

    l.retry();
    l = await settle();
    expect(l.source).toBeUndefined();
    expect(auth.calls).toHaveLength(3);
    expect(auth.calls[2]!.skipCache).toBe(true);
    auth.tokens[2]!.resolve("t3");
    l = await settle();
    expect(bearer(l)).toBe("Bearer t3");
    expect(l.attempt).not.toBe(lastAttempt);
  });
});

describe("usePhotoLoad — uitgelogd", () => {
  it("geen token, geen bron: terugvallen", async () => {
    auth.isSignedIn = false;
    await mount();
    const l = await settle();
    expect(l.source).toBeNull();
    expect(auth.calls).toHaveLength(0);
  });
});

// WP25 fix-cyclus 2 (A-invariant 26, red-team N1): expo-image kijkt niet naar
// `no-store`. Zonder formaten geeft het beeldpad het origineel onder dezelfde
// URL als het formaat; met formaten de ruwe pixels. De sleutel in de cache
// hangt daarom af van `hasFormats`, zodat een bewaard origineel nooit als
// formaat terugkomt. De URL zelf blijft gelijk (het beeldpad kiest).
describe("usePhotoLoad — de cache-sleutel hangt af van hasFormats", () => {
  async function sourceWith(hasFormats: boolean | undefined) {
    const { usePhotoLoad } = await import("../src/data/images");
    const h = rt.runtime;
    h.provide(h.contexts[0]!, SITE);
    const hook = usePhotoLoad as unknown as (id: string, f: string, has?: boolean) => Load;
    h.render(() => hook("foto1", "klein", hasFormats));
    auth.tokens.at(-1)!.resolve("tok");
    const l = await settle();
    return l.source as { uri: string; cacheKey?: string };
  }

  it("met en zonder formaten: dezelfde URL, een andere cacheKey", async () => {
    const met = await sourceWith(true);
    const zonder = await sourceWith(false);
    expect(met.uri).toBe(zonder.uri);
    expect(met.cacheKey, "met formaten").toBeDefined();
    expect(zonder.cacheKey, "zonder formaten").toBeDefined();
    expect(met.cacheKey).not.toBe(zonder.cacheKey);
  });

  // Fix-cyclus 3 (kernvondst 16, audit S1): builds van vóór WP25 bewaarden het
  // origineel op schijf onder de kale URL. Die sleutel mag niet meer raken.
  it("geen van beide sleutels is de kale URL (een oude schijfcache raakt niet)", async () => {
    const met = await sourceWith(true);
    const zonder = await sourceWith(false);
    expect(met.cacheKey, "met formaten").not.toBe(met.uri);
    expect(zonder.cacheKey, "zonder formaten").not.toBe(zonder.uri);
  });

  it("hasFormats ontbreekt: dezelfde sleutel als zonder formaten", async () => {
    const onbekend = await sourceWith(undefined);
    const zonder = await sourceWith(false);
    expect(onbekend.cacheKey).toBe(zonder.cacheKey);
  });
});
