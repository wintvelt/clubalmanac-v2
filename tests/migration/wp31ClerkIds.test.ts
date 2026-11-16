// WP31 fix-ronde audit (A, 2026-11-16) — de Clerk-ID-map voor prod.
//
// Inloggen op prod gaat alleen op de Clerk-ID; het adres wordt daarbij niet
// vergeleken. Een verwisselde ID in `clerkIdByEmail` laat lid B dus stil de
// groepen van lid A zien, en `verify` ziet dat niet (audit S2, invariant 3).
// Gedrag dat hier vastligt:
//   - `clerk-ids --write` zet de map uit Clerk prod zelf (op primair adres),
//     voor elk lid uit het extract, zonder de uitgesloten users (W5);
//   - een map die niet klopt met Clerk (verwisseld, onbekende ID) → exit 1, en
//     niets geschreven zonder `--write`;
//   - `--create` schrijft in Clerk prod en eist MIGRATE_ALLOW_PROD=yes; zonder
//     gaat er geen enkele schrijfactie naar Clerk;
//   - `--create` maakt alleen ontbrekende leden aan, nooit een uitgesloten user;
//   - alleen een prod-sleutel (invariant 7: prod-config hoort bij Clerk prod);
//   - `loadConfig` weigert een map met één Clerk-ID bij twee adressen.
//
// Geen test raakt `scripts/.data/` of Clerk: de bestandslaag, `dotenv` en
// `fetch` zijn vervangen.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { captureConsole, createFakeFiles } from "./_harness";
import type { SourceItem } from "./fixture";

const h = vi.hoisted(() => ({
  files: null as unknown as ReturnType<typeof import("./_harness").createFakeFiles>,
}));

vi.mock("dotenv", () => ({ config: () => ({ parsed: {} }), default: { config: () => ({ parsed: {} }) } }));

vi.mock("../../scripts/migrate/paths.ts", () => ({
  DATA_DIR: "/fake/.data",
  EXTRACT_FILE: "dynamo-extract.json",
  RECORDS_FILE: "convex-records.json",
  STORAGE_MAP_FILE: "storage-map.json",
  MISSING_FILES_FILE: "missing-files.json",
  dataPath: (name: string) => `/fake/.data/${name}`,
  ensureDataDir: () => {},
  dataFileExists: (name: string) => h.files.exists(name),
  readData: (name: string) => h.files.read(name),
  writeData: (name: string, value: unknown) => h.files.write(name, value),
  invalidateData: (name: string) => h.files.invalidate(name),
}));

const { clerkIds } = await import("../../scripts/migrate/clerkIds.ts");
const { loadConfig } = await import("../../scripts/migrate/config.ts");

const CONFIG = "prod-config.json";
const EXTRACT = "dynamo-extract.json";

// Drie leden en het reviewaccount. Bea staat met hoofdletters in het extract.
const MEMBERS: SourceItem[] = [
  { PK: "UBbase", SK: "U-ann", name: "Ann", email: "ann@example.test" },
  { PK: "UBbase", SK: "U-bea", name: "Bea", email: "Bea@Example.test" },
  { PK: "UBbase", SK: "U-cas", name: "Cas", email: "cas@example.test" },
  { PK: "UBbase", SK: "U-review", name: "John Appleseed", email: "review@example.test" },
];
const EXCLUDE = { excludeUserIds: ["U-review"] };

type FakeClerkUser = { id: string; email: string };

/** Clerk prod: GET /v1/users (pagina's) en POST /v1/users. Alles anders faalt hard. */
function fakeClerk(initial: FakeClerkUser[]) {
  const users = [...initial];
  const posts: unknown[] = [];
  let next = 100;
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== "https://api.clerk.com" || url.pathname !== "/v1/users") {
      throw new Error(`[test] onverwachte aanroep: ${init?.method ?? "GET"} ${url}`);
    }
    const method = init?.method ?? "GET";
    if (method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 10);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const page = users.slice(offset, offset + limit).map((u) => ({
        id: u.id,
        primary_email_address_id: `idn_${u.id}`,
        email_addresses: [{ id: `idn_${u.id}`, email_address: u.email }],
      }));
      return new Response(JSON.stringify(page), { status: 200 });
    }
    if (method === "POST") {
      const body = JSON.parse(String(init?.body)) as { email_address: string[] };
      posts.push(body);
      const user = { id: `user_new${next++}`, email: body.email_address[0]! };
      users.push(user);
      return new Response(JSON.stringify({ id: user.id }), { status: 200 });
    }
    throw new Error(`[test] onverwachte methode ${method}`);
  });
  return { users, posts, fetchMock };
}

const IN_CLERK: FakeClerkUser[] = [
  { id: "user_ann", email: "ann@example.test" },
  { id: "user_bea", email: "bea@example.test" },
  { id: "user_cas", email: "cas@example.test" },
];

let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  savedEnv = {
    MIGRATE_CLERK_SECRET_KEY_PROD: process.env.MIGRATE_CLERK_SECRET_KEY_PROD,
    MIGRATE_ALLOW_PROD: process.env.MIGRATE_ALLOW_PROD,
  };
  process.env.MIGRATE_CLERK_SECRET_KEY_PROD = "sk_live_test";
  delete process.env.MIGRATE_ALLOW_PROD;
});
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

function setup(config: Record<string, unknown>, clerkUsers: FakeClerkUser[] = IN_CLERK) {
  h.files = createFakeFiles({ [CONFIG]: config, [EXTRACT]: { items: MEMBERS } });
  const clerk = fakeClerk(clerkUsers);
  vi.stubGlobal("fetch", clerk.fetchMock);
  return clerk;
}

const mapInFile = () => (h.files.read<Record<string, unknown>>(CONFIG).clerkIdByEmail ?? {}) as Record<string, string>;

/** Exitcode, of 1 als het commando weigert met een fout. */
async function exitOf(run: () => Promise<number>): Promise<number> {
  try {
    return await run();
  } catch {
    return 1;
  }
}

describe("clerk-ids --write: de map komt uit Clerk prod", () => {
  test("elk lid krijgt de ID van zijn primaire adres in Clerk, het reviewaccount niet", async () => {
    setup({ ...EXCLUDE });
    captureConsole();

    expect(await clerkIds(false, true)).toBe(0);

    expect(mapInFile()).toEqual({
      "ann@example.test": "user_ann",
      "bea@example.test": "user_bea",
      "cas@example.test": "user_cas",
    });
    // De rest van de config blijft staan.
    expect(h.files.read<Record<string, unknown>>(CONFIG).excludeUserIds).toEqual(["U-review"]);
  });

  test("ontbreekt een lid in Clerk: exit 1 en geen map geschreven", async () => {
    setup({ ...EXCLUDE }, IN_CLERK.filter((u) => u.id !== "user_cas"));
    captureConsole();

    expect(await exitOf(() => clerkIds(false, true))).toBe(1);
    expect(mapInFile()).toEqual({});
  });

  test("Clerk heeft meer dan één pagina users: ook leden op een latere pagina komen in de map", async () => {
    const filler = Array.from({ length: 600 }, (_, i) => ({ id: `user_x${i}`, email: `x${i}@example.test` }));
    setup({ ...EXCLUDE }, [...filler, ...IN_CLERK]);
    captureConsole();

    expect(await clerkIds(false, true)).toBe(0);
    expect(mapInFile()["cas@example.test"]).toBe("user_cas");
  });
});

describe("clerk-ids (alleen lezen): een map die niet klopt met Clerk is een stop", () => {
  const correct = {
    "ann@example.test": "user_ann",
    "bea@example.test": "user_bea",
    "cas@example.test": "user_cas",
  };

  test("een map gelijk aan Clerk: exit 0", async () => {
    setup({ ...EXCLUDE, clerkIdByEmail: correct });
    captureConsole();
    expect(await clerkIds(false, false)).toBe(0);
  });

  test("twee ID's verwisseld: exit 1, en de map blijft zoals hij was", async () => {
    const swapped = { ...correct, "ann@example.test": "user_bea", "bea@example.test": "user_ann" };
    setup({ ...EXCLUDE, clerkIdByEmail: swapped });
    captureConsole();

    expect(await exitOf(() => clerkIds(false, false))).toBe(1);
    expect(mapInFile()).toEqual(swapped);
  });

  test("een ID die in Clerk niet bestaat: exit 1", async () => {
    setup({ ...EXCLUDE, clerkIdByEmail: { ...correct, "cas@example.test": "user_bestaatniet" } });
    captureConsole();
    expect(await exitOf(() => clerkIds(false, false))).toBe(1);
  });

  test("een lid ontbreekt in de map: exit 1", async () => {
    const { "cas@example.test": _cas, ...partial } = correct;
    setup({ ...EXCLUDE, clerkIdByEmail: partial });
    captureConsole();
    expect(await exitOf(() => clerkIds(false, false))).toBe(1);
  });

  test("het reviewaccount in de map: exit 1", async () => {
    setup({ ...EXCLUDE, clerkIdByEmail: { ...correct, "review@example.test": "user_review" } }, [
      ...IN_CLERK,
      { id: "user_review", email: "review@example.test" },
    ]);
    captureConsole();
    expect(await exitOf(() => clerkIds(false, false))).toBe(1);
  });
});

describe("clerk-ids --create schrijft in Clerk prod", () => {
  test("zonder MIGRATE_ALLOW_PROD=yes geweigerd: geen schrijfactie naar Clerk, geen map", async () => {
    const clerk = setup({ ...EXCLUDE }, []);
    captureConsole();

    expect(await exitOf(() => clerkIds(true, true))).toBe(1);

    expect(clerk.posts).toEqual([]);
    const methods = clerk.fetchMock.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? "GET");
    expect(methods.filter((m) => m !== "GET")).toEqual([]);
    expect(mapInFile()).toEqual({});
  });

  test("MIGRATE_ALLOW_PROD met een andere waarde dan yes telt niet", async () => {
    process.env.MIGRATE_ALLOW_PROD = "true";
    const clerk = setup({ ...EXCLUDE }, []);
    captureConsole();

    expect(await exitOf(() => clerkIds(true, false))).toBe(1);
    expect(clerk.posts).toEqual([]);
  });

  test("met MIGRATE_ALLOW_PROD=yes: alleen de ontbrekende leden, nooit het reviewaccount", async () => {
    process.env.MIGRATE_ALLOW_PROD = "yes";
    const clerk = setup({ ...EXCLUDE }, IN_CLERK.filter((u) => u.id === "user_ann"));
    captureConsole();

    expect(await clerkIds(true, true)).toBe(0);

    const created = clerk.posts.map((b) => (b as { email_address: string[] }).email_address[0]!.toLowerCase()).sort();
    expect(created).toEqual(["bea@example.test", "cas@example.test"]);
    const map = mapInFile();
    expect(Object.keys(map).sort()).toEqual(["ann@example.test", "bea@example.test", "cas@example.test"]);
    expect(map["ann@example.test"]).toBe("user_ann");
  });

  test("een tweede run maakt niemand opnieuw aan", async () => {
    process.env.MIGRATE_ALLOW_PROD = "yes";
    const clerk = setup({ ...EXCLUDE });
    captureConsole();

    expect(await clerkIds(true, false)).toBe(1); // de map is nog leeg
    expect(clerk.posts).toEqual([]);
  });
});

describe("clerk-ids praat alleen met Clerk prod", () => {
  test("een sk_test-sleutel: geweigerd, geen aanroep naar Clerk", async () => {
    process.env.MIGRATE_CLERK_SECRET_KEY_PROD = "sk_test_abc";
    const clerk = setup({ ...EXCLUDE });
    captureConsole();

    expect(await exitOf(() => clerkIds(false, true))).toBe(1);
    expect(clerk.fetchMock).not.toHaveBeenCalled();
  });

  test("zonder excludeUserIds geweigerd vóór Clerk: anders komt het reviewaccount erin", async () => {
    process.env.MIGRATE_ALLOW_PROD = "yes";
    const clerk = setup({});
    captureConsole();

    expect(await exitOf(() => clerkIds(true, true))).toBe(1);
    expect(clerk.posts).toEqual([]);
  });
});

describe("loadConfig (prod) weigert één Clerk-ID bij twee adressen", () => {
  test("dubbele ID: de config laadt niet, de melding noemt de ID", () => {
    h.files = createFakeFiles({
      [CONFIG]: {
        ...EXCLUDE,
        clerkIdByEmail: {
          "ann@example.test": "user_ann",
          "bea@example.test": "user_ann",
          "cas@example.test": "user_cas",
        },
      },
    });
    expect(() => loadConfig("prod", MEMBERS, 0)).toThrow(/user_ann/);
  });

  test("dubbel na normaliseren van het adres telt ook: twee schrijfwijzen, twee ID's", () => {
    // Twee keer hetzelfde adres met andere hoofdletters, met elk een eigen ID:
    // één van beide wint stil. Ook dat is geen eenduidige map.
    h.files = createFakeFiles({
      [CONFIG]: {
        ...EXCLUDE,
        clerkIdByEmail: { "bea@example.test": "user_bea", "Bea@Example.test": "user_bea2" },
      },
    });
    expect(() => loadConfig("prod", MEMBERS, 0)).toThrow(/bea@example\.test/i);
  });

  test("een eenduidige map laadt: elk lid zijn eigen ID", () => {
    h.files = createFakeFiles({
      [CONFIG]: {
        ...EXCLUDE,
        clerkIdByEmail: { "ann@example.test": "user_ann", "bea@example.test": "user_bea", "cas@example.test": "user_cas" },
      },
    });
    const config = loadConfig("prod", MEMBERS, 0);
    expect(config.subjectByUserId).toEqual({ "U-ann": "user_ann", "U-bea": "user_bea", "U-cas": "user_cas" });
  });
});
