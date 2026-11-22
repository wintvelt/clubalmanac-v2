import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// WP39 fixronde gate 1, besluit 1 (F1): het laatst gekozen album staat op het
// toestel, per user, zoals de thuisgroep (WP32, src/data/lastGroup.ts). Een
// ander account op hetzelfde toestel ziet en overschrijft het niet. Een fout
// bij lezen of schrijven ziet de user niet: dan "niets onthouden". Account
// verwijderen wist het, uitloggen niet.
//
// expo-secure-store is hier nep: een geheugen dat sleutels weigert zoals het
// toestel (alleen letters, cijfers, ".", "-" en "_"; niet leeg).
// Spec: docs/work-packages/WP39-toevoegscherm.md §Fixronde gate 1.

const device = vi.hoisted(() => ({
  items: new Map<string, string>(),
  fail: false,
}));

vi.mock("expo-secure-store", () => {
  const check = (key: string) => {
    if (device.fail) throw new Error("keychain niet beschikbaar");
    if (typeof key !== "string" || !/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`Invalid key provided to SecureStore: ${key}`);
  };
  return {
    getItemAsync: async (key: string) => {
      check(key);
      return device.items.get(key) ?? null;
    },
    setItemAsync: async (key: string, value: string) => {
      check(key);
      if (typeof value !== "string") throw new Error("SecureStore bewaart alleen tekst");
      device.items.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      check(key);
      device.items.delete(key);
    },
  };
});

type Store = typeof import("../src/data/lastAlbum");
let loadLastAlbum: Store["loadLastAlbum"];
let saveLastAlbum: Store["saveLastAlbum"];
let forgetLastAlbum: Store["forgetLastAlbum"];
let clearLastAlbum: Store["clearLastAlbum"];

// Elke test is een verse app-start; het nep-toestel houdt wat erin staat.
async function startApp() {
  vi.resetModules();
  ({ loadLastAlbum, saveLastAlbum, forgetLastAlbum, clearLastAlbum } = await import("../src/data/lastAlbum"));
}

const A = "user_2pQx7AbCdEf";
const B = "user_2pQx7AbCdEg";
const ZOMER = { albumId: "a1", groupId: "g1" };
const ARDENNEN = { albumId: "b1", groupId: "g2" };

beforeEach(async () => {
  device.items.clear();
  device.fail = false;
  await startApp();
});

describe("per user op het toestel (F1)", () => {
  it("niets onthouden: null", async () => {
    expect(await loadLastAlbum(A)).toBeNull();
  });

  it("na een herstart van de app: hetzelfde album en dezelfde groep", async () => {
    await saveLastAlbum(A, ZOMER);
    await startApp();
    expect(await loadLastAlbum(A)).toEqual(ZOMER);
  });

  it("een ander account ziet het niet en overschrijft het niet", async () => {
    await saveLastAlbum(A, ZOMER);
    expect(await loadLastAlbum(B)).toBeNull();
    await saveLastAlbum(B, ARDENNEN);
    await startApp();
    expect(await loadLastAlbum(A)).toEqual(ZOMER);
    expect(await loadLastAlbum(B)).toEqual(ARDENNEN);
  });

  it("een nieuw album vervangt het vorige", async () => {
    await saveLastAlbum(A, ZOMER);
    await saveLastAlbum(A, ARDENNEN);
    await startApp();
    expect(await loadLastAlbum(A)).toEqual(ARDENNEN);
  });

  it("eigen sleutel: niet die van de thuisgroep", async () => {
    await saveLastAlbum(A, ZOMER);
    const keys = [...device.items.keys()];
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.startsWith("clubalmanac.homeGroup.")).toBe(false);
  });

  it.each([
    ["user/a", "user:a"],
    ["user_a", "user.a"],
  ])("ids met tekens die geen sleutel mogen zijn (%s, %s): werkt, en valt niet samen", async (x, y) => {
    await saveLastAlbum(x, ZOMER);
    await saveLastAlbum(y, ARDENNEN);
    await startApp();
    expect(await loadLastAlbum(x)).toEqual(ZOMER);
    expect(await loadLastAlbum(y)).toEqual(ARDENNEN);
  });
});

describe("fouten ziet de user niet (F1)", () => {
  it("een kapotte waarde op het toestel: null", async () => {
    await saveLastAlbum(A, ZOMER);
    for (const k of device.items.keys()) device.items.set(k, "geen json {");
    await startApp();
    expect(await loadLastAlbum(A)).toBeNull();
  });

  it("een waarde in een andere vorm: null", async () => {
    await saveLastAlbum(A, ZOMER);
    for (const k of device.items.keys()) device.items.set(k, JSON.stringify({ albumId: 3 }));
    await startApp();
    expect(await loadLastAlbum(A)).toBeNull();
  });

  it("de keychain doet het niet: lezen geeft null, schrijven gooit niet", async () => {
    device.fail = true;
    await expect(saveLastAlbum(A, ZOMER)).resolves.toBeUndefined();
    await startApp();
    expect(await loadLastAlbum(A)).toBeNull();
  });
});

describe("vergeten en wissen", () => {
  it("forgetLastAlbum: alleen als het dat album is", async () => {
    await saveLastAlbum(A, ZOMER);
    await forgetLastAlbum(A, "ander");
    expect(await loadLastAlbum(A)).toEqual(ZOMER);
    await forgetLastAlbum(A, "a1");
    await startApp();
    expect(await loadLastAlbum(A)).toBeNull();
  });

  it("forgetLastAlbum van A raakt B niet", async () => {
    await saveLastAlbum(A, ZOMER);
    await saveLastAlbum(B, ZOMER);
    await forgetLastAlbum(A, "a1");
    await startApp();
    expect(await loadLastAlbum(B)).toEqual(ZOMER);
  });

  it("clearLastAlbum (account verwijderen): die van A weg, die van B blijft", async () => {
    await saveLastAlbum(A, ZOMER);
    await saveLastAlbum(B, ARDENNEN);
    await clearLastAlbum(A);
    await startApp();
    expect(await loadLastAlbum(A)).toBeNull();
    expect(await loadLastAlbum(B)).toEqual(ARDENNEN);
  });

  it("clearLastAlbum zonder waarde: geen fout", async () => {
    await expect(clearLastAlbum(A)).resolves.toBeUndefined();
  });
});

describe("account verwijderen wist het, uitloggen niet (bronscan)", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/auth/signOutAndWipe.ts", import.meta.url)), "utf8");

  it("signOutAndWipe roept clearLastAlbum(deletedUserId) aan, zoals clearLastGroup", () => {
    expect(src).toMatch(/import\s*\{[^}]*\bclearLastAlbum\b[^}]*\}\s*from\s*["']\.\.\/data\/lastAlbum["']/);
    expect(src).toMatch(/\bclearLastAlbum\(\s*deletedUserId\s*\)/);
  });

  it("alleen onder de voorwaarde van deletedUserId, net als de thuisgroep", () => {
    const at = src.indexOf("clearLastAlbum(deletedUserId");
    const guard = src.lastIndexOf("if (deletedUserId)", at);
    expect(guard, "clearLastAlbum staat niet onder if (deletedUserId)").toBeGreaterThanOrEqual(0);
    // Geen andere functie of return tussen de voorwaarde en de aanroep.
    expect(src.slice(guard, at)).not.toMatch(/\breturn\b|\bfunction\b/);
  });

  it("de webapp heeft een eigen variant zonder keychain", () => {
    const web = readFileSync(fileURLToPath(new URL("../src/data/lastAlbum.web.ts", import.meta.url)), "utf8");
    expect(web).not.toMatch(/expo-secure-store/);
    for (const name of ["loadLastAlbum", "saveLastAlbum", "forgetLastAlbum", "clearLastAlbum"]) {
      expect(web).toMatch(new RegExp(`export (async )?function ${name}\\b`));
    }
  });
});
