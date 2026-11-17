import { beforeEach, describe, expect, it, vi } from "vitest";

// WP32 invariant 3 en A-aanvullingen A5 en A6: de thuisgroep staat op het
// toestel, per user. Een ander account op hetzelfde toestel (het demo-account)
// ziet hem nooit en overschrijft hem ook niet. Account verwijderen wist alleen
// de waarde van die user.
//
// expo-secure-store is hier nep: een geheugen dat sleutels weigert zoals het
// toestel (alleen letters, cijfers, ".", "-" en "_"; niet leeg).
// Spec: docs/work-packages/WP32-thuisgroep-ui-fixes.md.

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
      device.items.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      check(key);
      device.items.delete(key);
    },
  };
});

import { clearLastGroup, forgetLastGroup, loadLastGroup, saveLastGroup } from "../src/data/lastGroup";

const A = "user_2pQx7AbCdEf";
const B = "user_2pQx7AbCdEg";

beforeEach(() => {
  device.items.clear();
  device.fail = false;
});

describe("per user (invariant 3)", () => {
  it("niets opgeslagen: niets", async () => {
    expect(await loadLastGroup(A)).toBeNull();
  });

  it("dezelfde user krijgt zijn groep terug", async () => {
    await saveLastGroup(A, "g1");
    expect(await loadLastGroup(A)).toBe("g1");
  });

  it("een andere user ziet de groep van A niet", async () => {
    await saveLastGroup(A, "g1");
    expect(await loadLastGroup(B)).toBeNull();
  });

  it("het bezoek van B overschrijft de groep van A niet (demo-account en terug)", async () => {
    await saveLastGroup(A, "g1");
    await saveLastGroup(B, "g2");
    expect(await loadLastGroup(A)).toBe("g1");
    expect(await loadLastGroup(B)).toBe("g2");
  });

  it("een nieuw bezoek van dezelfde user vervangt zijn vorige", async () => {
    await saveLastGroup(A, "g1");
    await saveLastGroup(A, "g2");
    expect(await loadLastGroup(A)).toBe("g2");
  });

  it.each([
    ["user/a", "user:a"],
    ["user a", "user+a"],
    ["user_a", "user.a"],
    ["ÿser", "üser"],
  ])("ids met tekens die geen sleutel mogen zijn (%s, %s): werkt, en valt niet samen", async (x, y) => {
    await saveLastGroup(x, "gx");
    await saveLastGroup(y, "gy");
    expect(await loadLastGroup(x)).toBe("gx");
    expect(await loadLastGroup(y)).toBe("gy");
  });

  it("de toestel-brede waarde van WP16 (van A) geeft B niets", async () => {
    device.items.set("clubalmanac.lastGroup", JSON.stringify({ userId: A, groupId: "oud" }));
    expect(await loadLastGroup(B)).toBeNull();
  });
});

describe("vergeten", () => {
  it("forgetLastGroup: alleen als het die groep is", async () => {
    await saveLastGroup(A, "g1");
    await forgetLastGroup(A, "g2");
    expect(await loadLastGroup(A)).toBe("g1");
    await forgetLastGroup(A, "g1");
    expect(await loadLastGroup(A)).toBeNull();
  });

  it("forgetLastGroup van A raakt B niet, ook niet bij dezelfde groep", async () => {
    await saveLastGroup(A, "g1");
    await saveLastGroup(B, "g1");
    await forgetLastGroup(A, "g1");
    expect(await loadLastGroup(A)).toBeNull();
    expect(await loadLastGroup(B)).toBe("g1");
  });

  it("clearLastGroup (account verwijderen, A6): de waarde van die user weg, die van een ander blijft", async () => {
    await saveLastGroup(A, "g1");
    await saveLastGroup(B, "g2");
    await clearLastGroup(A);
    expect(await loadLastGroup(A)).toBeNull();
    expect(await loadLastGroup(B)).toBe("g2");
  });

  it("clearLastGroup zonder opgeslagen waarde: geen fout", async () => {
    await expect(clearLastGroup(A)).resolves.toBeUndefined();
  });
});

describe("een fout van het toestel ziet de user niet (A5)", () => {
  it("lezen faalt: niets", async () => {
    await saveLastGroup(A, "g1");
    device.fail = true;
    expect(await loadLastGroup(A)).toBeNull();
  });

  it("schrijven, vergeten en wissen falen stil", async () => {
    device.fail = true;
    await expect(saveLastGroup(A, "g1")).resolves.toBeUndefined();
    await expect(forgetLastGroup(A, "g1")).resolves.toBeUndefined();
    await expect(clearLastGroup(A)).resolves.toBeUndefined();
  });
});
