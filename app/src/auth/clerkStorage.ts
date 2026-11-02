// WP15a F13: één opslag voor alles wat Clerk op het toestel bewaart: de
// resource-cache (omgeving, client met sessie en user, sessie-JWT) en het
// client-token. Uitloggen wist het allemaal, ook offline (besluit R4-1).
//
// Puur: de veilige opslag (expo-secure-store) komt als argument binnen, met
// zijn grenzen: sleutels alleen uit [A-Za-z0-9._-], waarden hooguit 2048
// bytes. Een lange waarde staat daarom in stukken.
//
// Na een wis staat er alleen een vlag. Zolang die staat, leest en schrijft de
// opslag niets, ook in een nieuwe start van de app: de listener van Clerk
// schrijft na signOut nog snapshots. Pas resume() (de volgende login) heft de
// vlag op. Alle bewerkingen lopen na elkaar, zodat een schrijfactie die al
// liep niets achterlaat na een wis.

export type SecureBackend = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};

export type ClerkStorage = ReturnType<typeof createClerkStorage>;

const WIPED_KEY = "clubalmanac_clerk_wiped";
const CLIENT_JWT_KEY = "__clerk_client_jwt";
const CACHE_ITEMS = ["__clerk_cache_environment", "__clerk_cache_client", "__clerk_cache_session_jwt"];
// Hooguit 4 bytes per teken: 500 tekens blijven onder 2048 bytes.
const CHUNK_CHARS = 500;
// Vangrail voor het aftasten van stukken.
const MAX_CHUNKS = 1000;

export function createClerkStorage(backend: SecureBackend, publishableKey: string) {
  const pk = publishableKey.split("=").join("");
  const cacheKeys = new Set(CACHE_ITEMS.map((item) => `${item}_${pk}`));
  const tokenKeys = new Set([CLIENT_JWT_KEY]);

  // null = nog niet gelezen uit de backend.
  let wiped: boolean | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const next = queue.then(op, op);
    queue = next.catch(() => {});
    return next;
  };
  const isWiped = async () => {
    if (wiped === null) wiped = (await backend.getItem(WIPED_KEY)) !== null;
    return wiped;
  };

  const countKey = (key: string) => `${key}.n`;
  const chunkKey = (key: string, i: number) => `${key}.${i}`;

  async function write(key: string, value: string) {
    const chars = Array.from(value);
    const chunks: string[] = [];
    for (let i = 0; i < chars.length; i += CHUNK_CHARS) {
      chunks.push(chars.slice(i, i + CHUNK_CHARS).join(""));
    }
    const before = Number(await backend.getItem(countKey(key))) || 0;
    for (const [i, chunk] of chunks.entries()) await backend.setItem(chunkKey(key, i), chunk);
    await backend.setItem(countKey(key), String(chunks.length));
    for (let i = chunks.length; i < before; i++) await backend.deleteItem(chunkKey(key, i));
  }

  async function read(key: string): Promise<string | null> {
    const count = await backend.getItem(countKey(key));
    if (count === null) return null;
    const chunks: string[] = [];
    for (let i = 0; i < Number(count); i++) {
      const chunk = await backend.getItem(chunkKey(key, i));
      if (chunk === null) return null;
      chunks.push(chunk);
    }
    return chunks.join("");
  }

  const store = {
    get: (key: string) =>
      serial(async () => ((await isWiped()) ? null : read(key))),
    set: (key: string, value: string) =>
      serial(async () => {
        if (await isWiped()) return;
        cacheKeys.add(key);
        await write(key, value);
      }),
  };

  const tokenCache = {
    getToken: (key: string) =>
      serial(async () => {
        if (await isWiped()) return null;
        tokenKeys.add(key);
        return backend.getItem(key);
      }),
    saveToken: (key: string, token: string) =>
      serial(async () => {
        if (await isWiped()) return;
        tokenKeys.add(key);
        await backend.setItem(key, token);
      }),
    clearToken: (key: string) => serial(() => backend.deleteItem(key)),
  };

  // Wist alles wat Clerk bewaarde: in de indeling van deze opslag en in die
  // van @clerk/expo/resource-cache (build 42, twee slots). Geeft false als
  // iets niet weg kon; de vlag staat dan al, dus een nieuwe start leest niets.
  function wipe(): Promise<boolean> {
    wiped = true;
    return serial(async () => {
      let ok = true;
      const remove = async (key: string) => {
        try {
          await backend.deleteItem(key);
          return true;
        } catch {
          ok = false;
          return false;
        }
      };
      const removeChunks = async (chunk: (i: number) => string, known: number) => {
        for (let i = 0; i < MAX_CHUNKS; i++) {
          if (i >= known && (await backend.getItem(chunk(i))) === null) return;
          if (!(await remove(chunk(i)))) return;
        }
      };
      try {
        await backend.setItem(WIPED_KEY, "1");
      } catch {
        ok = false;
      }
      try {
        for (const key of cacheKeys) {
          await removeChunks((i) => chunkKey(key, i), Number(await backend.getItem(countKey(key))) || 0);
          await remove(countKey(key));
          await remove(`${key}-latest`);
          for (const slot of ["A", "B"]) {
            const meta = await backend.getItem(`${key}-${slot}-metadata`);
            const total = Number(meta ? JSON.parse(meta).totalChunks : 0) || 0;
            await removeChunks((i) => `${key}-${slot}-chunk-${i}`, total);
            await remove(`${key}-${slot}-metadata`);
            await remove(`${key}-${slot}-complete`);
          }
        }
        for (const key of tokenKeys) await remove(key);
      } catch {
        ok = false;
      }
      return ok;
    });
  }

  // Heft de wis op: vóór het eerste verzoek van een login.
  function resume(): Promise<void> {
    wiped = false;
    return serial(() => backend.deleteItem(WIPED_KEY));
  }

  return { resourceCache: () => store, tokenCache, wipe, resume };
}
