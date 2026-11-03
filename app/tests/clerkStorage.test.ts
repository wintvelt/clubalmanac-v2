import { describe, expect, it } from "vitest";
import { createClerkStorage, type SecureBackend } from "../src/auth/clerkStorage";

// WP15a F13 (R4-1): uitloggen werkt altijd, ook offline, en wist alles wat
// Clerk op het toestel bewaart: de resource-cache (sessie, user, JWT) en het
// client-token. De opslag van @clerk/expo/resource-cache kan dat niet: geen
// wis-functie, een wachtrij die schrijft nadat set() al terugkwam, en twee
// slots waarvan "verwijderen" er één leeg zet. Daarom één eigen opslag.
//
// De nep-backend heeft de grenzen van expo-secure-store: sleutels alleen uit
// [A-Za-z0-9._-], waarden hooguit 2048 bytes. Elke call wacht een tik, zodat
// calls door elkaar lopen zoals in de app.

const PK = "pk_test_Y2x1YmFsbWFuYWMuY2xlcmsuYWNjb3VudHMuZGV2JA==";
const PK_KEY = PK.split("=").join("");
const ENV = `__clerk_cache_environment_${PK_KEY}`;
const CLIENT = `__clerk_cache_client_${PK_KEY}`;
const JWT = `__clerk_cache_session_jwt_${PK_KEY}`;
const CLIENT_JWT_KEY = "__clerk_client_jwt";

const VALID_KEY = /^[\w.-]+$/;
const MAX_BYTES = 2048;

function fakeBackend() {
  const data = new Map<string, string>();
  const state = { failDeletes: false };
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const check = (key: string) => {
    if (!VALID_KEY.test(key)) throw new Error(`ongeldige sleutel: ${key}`);
  };
  const backend: SecureBackend = {
    async getItem(key) {
      check(key);
      await tick();
      return data.get(key) ?? null;
    },
    async setItem(key, value) {
      check(key);
      if (Buffer.byteLength(value, "utf8") > MAX_BYTES) throw new Error(`waarde te groot: ${key}`);
      await tick();
      data.set(key, value);
    },
    async deleteItem(key) {
      check(key);
      await tick();
      if (state.failDeletes) throw new Error("verwijderen mislukt");
      data.delete(key);
    },
  };
  return { data, state, backend };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Een snapshot zoals Clerk hem opslaat: lang, en met tekens buiten ASCII.
function snapshot(tag: string, length = 10_000): string {
  const unit = `{"user":"${tag}","naam":"Zoë Ærø 🙂","sessie":"sess_${tag}"},`;
  return `[${unit.repeat(Math.ceil(length / unit.length))}]`.slice(0, length);
}

const SECRETS = {
  env: snapshot("omgeving", 3_000),
  client: snapshot("client-met-sessie"),
  jwt: "eyJhbGciOiJSUzI1NiJ9.sessie-jwt-geheim.handtekening",
  clientJwt: "eyJhbGciOiJSUzI1NiJ9.client-jwt-geheim.handtekening",
};

// Wat er na een wis in de backend mag staan: hooguit 2 sleutels, met
// waarden van samen hooguit 64 tekens, en niets van wat er was opgeslagen.
function expectClean(data: Map<string, string>, secrets: string[]) {
  expect(data.size).toBeLessThanOrEqual(2);
  const total = [...data.values()].reduce((n, v) => n + v.length, 0);
  expect(total).toBeLessThanOrEqual(64);
  const stored = [...data.entries()].flat().join("\n");
  for (const secret of secrets) {
    expect(stored).not.toContain(secret.slice(0, 16));
  }
  for (const key of data.keys()) expect(key.startsWith("__clerk_")).toBe(false);
}

async function fill(storage: ReturnType<typeof createClerkStorage>) {
  const rc = storage.resourceCache();
  await rc.set(ENV, SECRETS.env);
  await rc.set(CLIENT, SECRETS.client);
  await rc.set(JWT, SECRETS.jwt);
  await storage.tokenCache.saveToken(CLIENT_JWT_KEY, SECRETS.clientJwt);
}

const ALL_SECRETS = Object.values(SECRETS);

describe("clerkStorage — opslaan en lezen", () => {
  it("een lange waarde met é en emoji komt heel terug", async () => {
    const { backend } = fakeBackend();
    const rc = createClerkStorage(backend, PK).resourceCache();
    await rc.set(CLIENT, SECRETS.client);
    expect(await rc.get(CLIENT)).toBe(SECRETS.client);
  });

  it("geen waarde in de backend is groter dan 2048 bytes, elke sleutel is geldig", async () => {
    const { backend, data } = fakeBackend();
    await fill(createClerkStorage(backend, PK));
    expect(data.size).toBeGreaterThan(0);
    for (const [key, value] of data) {
      expect(key).toMatch(VALID_KEY);
      expect(Buffer.byteLength(value, "utf8")).toBeLessThanOrEqual(MAX_BYTES);
    }
  });

  it("de waarden overleven een koude start (nieuwe instantie op dezelfde backend)", async () => {
    const { backend } = fakeBackend();
    await fill(createClerkStorage(backend, PK));
    const next = createClerkStorage(backend, PK);
    const rc = next.resourceCache();
    expect(await rc.get(ENV)).toBe(SECRETS.env);
    expect(await rc.get(CLIENT)).toBe(SECRETS.client);
    expect(await rc.get(JWT)).toBe(SECRETS.jwt);
    expect(await next.tokenCache.getToken(CLIENT_JWT_KEY)).toBe(SECRETS.clientJwt);
  });

  it("de fabriek geeft steeds dezelfde opslag (Clerk roept hem per cache aan)", async () => {
    const { backend } = fakeBackend();
    const storage = createClerkStorage(backend, PK);
    await storage.resourceCache().set(CLIENT, SECRETS.client);
    expect(await storage.resourceCache().get(CLIENT)).toBe(SECRETS.client);
  });

  it("een kortere waarde overschrijft een lange", async () => {
    const { backend } = fakeBackend();
    const rc = createClerkStorage(backend, PK).resourceCache();
    await rc.set(CLIENT, SECRETS.client);
    await rc.set(CLIENT, "kort");
    expect(await rc.get(CLIENT)).toBe("kort");
  });

  it("een lege waarde (Clerk's 'verwijderen') leest als leeg", async () => {
    const { backend } = fakeBackend();
    const rc = createClerkStorage(backend, PK).resourceCache();
    await rc.set(CLIENT, SECRETS.client);
    await rc.set(CLIENT, "");
    expect(await rc.get(CLIENT)).toBeFalsy();
  });

  it("een onbekende sleutel geeft null", async () => {
    const { backend } = fakeBackend();
    const storage = createClerkStorage(backend, PK);
    expect(await storage.resourceCache().get(CLIENT)).toBeNull();
    expect(await storage.tokenCache.getToken(CLIENT_JWT_KEY)).toBeFalsy();
  });

  it("clearToken wist het client-token", async () => {
    const { backend } = fakeBackend();
    const storage = createClerkStorage(backend, PK);
    await storage.tokenCache.saveToken(CLIENT_JWT_KEY, SECRETS.clientJwt);
    await storage.tokenCache.clearToken(CLIENT_JWT_KEY);
    expect(await storage.tokenCache.getToken(CLIENT_JWT_KEY)).toBeFalsy();
  });
});

describe("clerkStorage — wipe() laat niets achter", () => {
  it("na een wis staan sessie, user, JWT en client-token niet meer in de backend", async () => {
    const { backend, data } = fakeBackend();
    const storage = createClerkStorage(backend, PK);
    await fill(storage);
    expect(await storage.wipe()).toBe(true);
    expectClean(data, ALL_SECRETS);
  });

  it("ook wat een eerdere instantie schreef (een eerdere start van de app)", async () => {
    const { backend, data } = fakeBackend();
    await fill(createClerkStorage(backend, PK));
    expect(await createClerkStorage(backend, PK).wipe()).toBe(true);
    expectClean(data, ALL_SECRETS);
  });

  it("ook de sleutels die build 42 schreef (opslag van @clerk/expo en de tokenCache)", async () => {
    const { backend, data } = fakeBackend();
    // De indeling van @clerk/expo/resource-cache 4.14.1, met twee slots.
    const legacy: string[] = [];
    for (const item of [ENV, CLIENT, JWT]) {
      data.set(`${item}-latest`, "B");
      for (const slot of ["A", "B"]) {
        data.set(`${item}-${slot}-complete`, "true");
        data.set(`${item}-${slot}-metadata`, JSON.stringify({ totalChunks: 3 }));
        for (let i = 0; i < 3; i++) {
          const chunk = `OUD-${item}-${slot}-${i}-${"p".repeat(40)}`;
          data.set(`${item}-${slot}-chunk-${i}`, chunk);
          legacy.push(chunk);
        }
      }
    }
    data.set(CLIENT_JWT_KEY, SECRETS.clientJwt);
    expect(await createClerkStorage(backend, PK).wipe()).toBe(true);
    expectClean(data, [...legacy, SECRETS.clientJwt]);
  });

  it("een wis zonder opgeslagen data lukt ook", async () => {
    const { backend, data } = fakeBackend();
    expect(await createClerkStorage(backend, PK).wipe()).toBe(true);
    expectClean(data, []);
  });

  it.each([0, 1, 2, 5, 10])(
    "een set die %i tikken vóór de wis begon, laat niets achter",
    async (ticks) => {
      const { backend, data } = fakeBackend();
      const storage = createClerkStorage(backend, PK);
      const writing = storage.resourceCache().set(CLIENT, SECRETS.client).catch(() => {});
      for (let i = 0; i < ticks; i++) await tick();
      const wiped = await storage.wipe();
      await writing;
      for (let i = 0; i < 20; i++) await tick();
      expect(wiped).toBe(true);
      expectClean(data, [SECRETS.client]);
    },
  );
});

describe("clerkStorage — na een wis schrijft en leest niets, tot resume()", () => {
  it("set en saveToken schrijven niets, get en getToken geven niets", async () => {
    const { backend, data } = fakeBackend();
    const storage = createClerkStorage(backend, PK);
    await fill(storage);
    await storage.wipe();
    // Zo schrijft de listener van Clerk tijdens signOut nog een snapshot.
    await fill(storage);
    expectClean(data, ALL_SECRETS);
    expect(await storage.resourceCache().get(CLIENT)).toBeNull();
    expect(await storage.tokenCache.getToken(CLIENT_JWT_KEY)).toBeFalsy();
  });

  it("dat blijft zo na een koude start", async () => {
    const { backend, data } = fakeBackend();
    const first = createClerkStorage(backend, PK);
    await fill(first);
    await first.wipe();
    const next = createClerkStorage(backend, PK);
    await fill(next);
    expectClean(data, ALL_SECRETS);
    expect(await next.resourceCache().get(CLIENT)).toBeNull();
    expect(await next.tokenCache.getToken(CLIENT_JWT_KEY)).toBeFalsy();
  });

  it("na resume() werkt alles weer, ook na een koude start", async () => {
    const { backend } = fakeBackend();
    const first = createClerkStorage(backend, PK);
    await fill(first);
    await first.wipe();
    await first.resume();
    await fill(first);
    expect(await first.resourceCache().get(CLIENT)).toBe(SECRETS.client);
    expect(await first.tokenCache.getToken(CLIENT_JWT_KEY)).toBe(SECRETS.clientJwt);
    const next = createClerkStorage(backend, PK);
    expect(await next.resourceCache().get(CLIENT)).toBe(SECRETS.client);
    expect(await next.tokenCache.getToken(CLIENT_JWT_KEY)).toBe(SECRETS.clientJwt);
  });

  it("resume() in een nieuwe instantie heft de wis ook op", async () => {
    const { backend } = fakeBackend();
    const first = createClerkStorage(backend, PK);
    await first.wipe();
    const next = createClerkStorage(backend, PK);
    await next.resume();
    await fill(next);
    expect(await next.resourceCache().get(CLIENT)).toBe(SECRETS.client);
  });
});

describe("clerkStorage — verwijderen faalt", () => {
  it("wipe() geeft false, en een koude start leest toch niets", async () => {
    const { backend, state } = fakeBackend();
    const storage = createClerkStorage(backend, PK);
    await fill(storage);
    state.failDeletes = true;
    expect(await storage.wipe()).toBe(false);
    const next = createClerkStorage(backend, PK);
    expect(await next.resourceCache().get(ENV)).toBeNull();
    expect(await next.resourceCache().get(CLIENT)).toBeNull();
    expect(await next.resourceCache().get(JWT)).toBeNull();
    expect(await next.tokenCache.getToken(CLIENT_JWT_KEY)).toBeFalsy();
  });

  it("een tweede wis ruimt alsnog op", async () => {
    const { backend, data, state } = fakeBackend();
    const storage = createClerkStorage(backend, PK);
    await fill(storage);
    state.failDeletes = true;
    await storage.wipe();
    state.failDeletes = false;
    expect(await createClerkStorage(backend, PK).wipe()).toBe(true);
    expectClean(data, ALL_SECRETS);
  });
});

// F19 (R5-2): de eerste bewerking van een instantie leest eerst de vlag uit
// de backend. Begint wipe() terwijl die lees-actie nog loopt, dan mag de
// lees-actie de wis niet ongedaan maken.
describe("clerkStorage — een wis wint van een lees-actie die nog liep (F19)", () => {
  type Storage = ReturnType<typeof createClerkStorage>;
  // Laat de eerste bewerking beginnen: de lees-actie van de vlag staat dan
  // open in de backend (die antwoordt pas na een tik).
  const readStarted = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const FIRST: [string, (s: Storage) => Promise<unknown>][] = [
    ["get", (s) => s.resourceCache().get(CLIENT)],
    ["set", (s) => s.resourceCache().set(CLIENT, SECRETS.client)],
    ["getToken", (s) => s.tokenCache.getToken(CLIENT_JWT_KEY)],
    ["saveToken", (s) => s.tokenCache.saveToken(CLIENT_JWT_KEY, SECRETS.clientJwt)],
  ];

  it.each(FIRST)("wipe() tijdens de eerste lees-actie (%s): daarna schrijft en leest niets", async (_, first) => {
    const { backend, data } = fakeBackend();
    const storage = createClerkStorage(backend, PK);
    const running = first(storage).catch(() => {});
    await readStarted();
    const wiped = storage.wipe();
    await Promise.all([running, wiped]);
    await fill(storage);
    expectClean(data, ALL_SECRETS);
    expect(await storage.resourceCache().get(CLIENT)).toBeNull();
    expect(await storage.tokenCache.getToken(CLIENT_JWT_KEY)).toBeFalsy();
  });

  it.each(FIRST)("ook na een koude start met data van eerder (eerste bewerking %s)", async (_, first) => {
    const { backend, data } = fakeBackend();
    await fill(createClerkStorage(backend, PK));
    const storage = createClerkStorage(backend, PK);
    const running = first(storage).catch(() => {});
    await readStarted();
    const wiped = storage.wipe();
    await Promise.all([running, wiped]);
    await fill(storage);
    expectClean(data, ALL_SECRETS);
    expect(await createClerkStorage(backend, PK).resourceCache().get(CLIENT)).toBeNull();
  });
});
