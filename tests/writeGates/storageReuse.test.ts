/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  asUser,
  expectNoMutationOracle,
  expectRejectedNoChange,
  newAccount,
  newT,
  seedWorld,
  useWebmasterEnv,
  type T,
  type World,
} from "./_helpers";

// WP24 invariant 8 (vervangt A-keuze 5, fix-cyclus na audit-ronde 1 S1):
// een publieke mutation koppelt een beeld (storageId) alleen aan de caller
// als dat beeld al van de caller is of door de caller gezien mag worden:
// het beeld van een eigen foto, van een foto met foto-toegang, of de eigen
// huidige profielfoto. Elk ander beeld wordt geweigerd: dat van een foto
// zonder toegang, andermans profielbeeld, en een los beeld dat nergens aan
// hangt. Onbekend en verboden beeld geven dezelfde uitkomst.
//
// Profielbeelden staan in het publiek profiel (groups.listMembers,
// users.getById, invite-landing). In de seed-wereld heeft elke user een los
// profielbeeld zonder foto-rij, zoals een gemigreerde v1-profielfoto.
//
// photos.create is geen publieke mutation meer; de inventaris hieronder pint
// dat via de set publieke paden die een beeld-id aannemen.

useWebmasterEnv();

async function storageOf(t: T, photoId: Id<"photos">) {
  return await t.run(async (ctx) => (await ctx.db.get(photoId))!.storageId);
}

async function profileStorageOf(t: T, userId: Id<"users">) {
  return await t.run(async (ctx) => (await ctx.db.get(userId))!.profilePhotoStorageId!);
}

async function profileOf(t: T, userId: Id<"users">) {
  return await t.run(async (ctx) => ctx.db.get(userId));
}

/** Een beeld-id dat niet (meer) bestaat: store + delete. */
async function staleStorage(t: T): Promise<Id<"_storage">> {
  return await t.run(async (ctx) => {
    const id = await ctx.storage.store(new Blob(["weg"]));
    await ctx.storage.delete(id);
    return id;
  });
}

/** Een los beeld: geüpload, maar aan geen foto en geen profiel gekoppeld. */
async function looseStorage(t: T): Promise<Id<"_storage">> {
  return await t.run(async (ctx) => ctx.storage.store(new Blob(["los"])));
}

/** Een tweede foto-rij op hetzelfde beeld, van een andere eigenaar, in geen album. */
async function sharePixels(
  t: T,
  ownerId: Id<"users">,
  storageId: Id<"_storage">,
): Promise<Id<"photos">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("photos", { ownerId, storageId, ratingCount: 0, createdAt: Date.now() }),
  );
}

const setProfile = (client: ReturnType<typeof asUser>, storageId: Id<"_storage">) =>
  client.mutation(api.users.updateProfile, { profilePhotoStorageId: storageId });

// --- inventaris -----------------------------------------------------------

type Registered = {
  isMutation?: boolean;
  isAction?: boolean;
  isPublic?: boolean;
  exportArgs?: () => string;
};

const convexModules = import.meta.glob<Record<string, unknown>>(
  ["../../convex/**/*.ts", "!../../convex/_generated/**", "!../../convex/**/*.d.ts"],
  { eager: true },
);

// convex/_test.ts: gegated op INTEGRATION_TEST_ENABLED, buiten scope (WP23).
const OUT_OF_SCOPE_MODULES = new Set(["_test"]);

const EXPECTED_PUBLIC_STORAGE_PATHS = ["users:updateProfile"];

function publicPathsTakingStorageId(): string[] {
  const found: string[] = [];
  for (const [path, mod] of Object.entries(convexModules)) {
    const name = path.replace(/^\.\.\/\.\.\/convex\//, "").replace(/\.ts$/, "");
    if (OUT_OF_SCOPE_MODULES.has(name)) continue;
    for (const [exportName, value] of Object.entries(mod)) {
      const fn = value as Registered | null;
      if (!fn || fn.isPublic !== true) continue;
      if (fn.isMutation !== true && fn.isAction !== true) continue;
      const args = fn.exportArgs?.() ?? "";
      if (/"tableName":"_storage"/.test(args)) found.push(`${name}:${exportName}`);
    }
  }
  return found.sort();
}

describe("invariant 8 — inventaris publieke paden met een beeld-id", () => {
  it("modules zijn gevonden (sanity: de glob werkt)", () => {
    expect(Object.keys(convexModules).length).toBeGreaterThan(5);
  });

  it("alleen users.updateProfile neemt als publieke mutation of action een beeld-id aan (photos.create is intern)", () => {
    expect(publicPathsTakingStorageId()).toEqual(EXPECTED_PUBLIC_STORAGE_PATHS);
  });
});

// --- geweigerd ------------------------------------------------------------

describe("invariant 8 — users.updateProfile weigert een beeld dat niet van de caller is", () => {
  it("vers account met het beeld van een foto van een ander: geweigerd, state ongewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { client } = await newAccount(t, "mallory");
    for (const photoId of [w.photos.pAlice, w.photos.pBobPrivate]) {
      await expectRejectedNoChange(
        t,
        async () => setProfile(client, await storageOf(t, photoId)),
        `beeld van foto ${photoId}`,
      );
    }
  });

  it("vers account met andermans profielbeeld (los, zonder foto-rij): geweigerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { client } = await newAccount(t, "mallory");
    const aliceProfile = await profileStorageOf(t, w.users.alice.id);
    await expectRejectedNoChange(t, () => setProfile(client, aliceProfile));
  });

  it("groepsgenoot die het profielbeeld in de ledenlijst ziet, neemt het niet over", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bob = asUser(t, w, "bob");
    const members = await bob.query(api.groups.listMembers, { groupId: w.groups.G1 });
    const alice = members.find((m) => m.user?._id === w.users.alice.id);
    const seen = alice!.user!.profilePhotoStorageId!;
    expect(seen).toBe(await profileStorageOf(t, w.users.alice.id));
    await expectRejectedNoChange(t, () => setProfile(bob, seen));
  });

  it("ex-lid met een profielbeeld dat hij ooit zag: geweigerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const dave = asUser(t, w, "dave");
    const members = await dave.query(api.groups.listMembers, { groupId: w.groups.G3 });
    const seen = members.find((m) => m.user?._id === w.users.alice.id)!.user!
      .profilePhotoStorageId!;
    await dave.mutation(api.groups.removeMember, {
      groupId: w.groups.G3,
      userId: w.users.dave.id,
    });
    await expectRejectedNoChange(t, () => setProfile(dave, seen));
  });

  it("webmaster met andermans profielbeeld: geweigerd (geen bypass)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const aliceProfile = await profileStorageOf(t, w.users.alice.id);
    await expectRejectedNoChange(t, () => setProfile(asUser(t, w, "wm"), aliceProfile));
  });

  it("een los beeld dat nergens aan hangt: geweigerd (vers beeld kan pas via een upload-pad met herkomst, WP18)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { client } = await newAccount(t, "mallory");
    const loose = await looseStorage(t);
    await expectRejectedNoChange(t, () => setProfile(client, loose), "vers account");
    await expectRejectedNoChange(t, () => setProfile(asUser(t, w, "alice"), loose), "alice");
  });

  it("geweigerd beeld samen met een geldige nieuwe naam: ook de naam blijft oud", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bob = asUser(t, w, "bob");
    const carolProfile = await profileStorageOf(t, w.users.carol.id);
    await expectRejectedNoChange(t, () =>
      bob.mutation(api.users.updateProfile, {
        name: "Nieuwe Bob",
        profilePhotoStorageId: carolProfile,
      }),
    );
  });
});

// --- toegestaan -----------------------------------------------------------

describe("invariant 8 — users.updateProfile accepteert een beeld van de caller", () => {
  it("het beeld van een eigen foto", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const storageId = await storageOf(t, w.photos.pAlice);
    await setProfile(asUser(t, w, "alice"), storageId);
    expect((await profileOf(t, w.users.alice.id))?.profilePhotoStorageId).toBe(storageId);
  });

  it("het beeld van een eigen foto in geen album", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const storageId = await storageOf(t, w.photos.pBobPrivate);
    await setProfile(asUser(t, w, "bob"), storageId);
    expect((await profileOf(t, w.users.bob.id))?.profilePhotoStorageId).toBe(storageId);
  });

  it("het beeld van een foto van een ander waar de caller foto-toegang toe heeft (v1-pariteit)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // bob ziet pAlice via G1/A1.
    const storageId = await storageOf(t, w.photos.pAlice);
    await setProfile(asUser(t, w, "bob"), storageId);
    expect((await profileOf(t, w.users.bob.id))?.profilePhotoStorageId).toBe(storageId);
  });

  it("de eigen huidige profielfoto opnieuw, ook als die een los beeld is (gemigreerd uit v1)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const own = await profileStorageOf(t, w.users.alice.id);
    await setProfile(asUser(t, w, "alice"), own);
    expect((await profileOf(t, w.users.alice.id))?.profilePhotoStorageId).toBe(own);
  });

  it("de eigen huidige profielfoto samen met een nieuwe naam: beide gezet", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const own = await profileStorageOf(t, w.users.alice.id);
    await asUser(t, w, "alice").mutation(api.users.updateProfile, {
      name: "Alice Nieuw",
      profilePhotoStorageId: own,
    });
    const u = await profileOf(t, w.users.alice.id);
    expect(u?.name).toBe("Alice Nieuw");
    expect(u?.profilePhotoStorageId).toBe(own);
  });

  it("alleen een nieuwe naam: profielfoto ongemoeid", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const own = await profileStorageOf(t, w.users.alice.id);
    await asUser(t, w, "alice").mutation(api.users.updateProfile, { name: "Alleen Naam" });
    const u = await profileOf(t, w.users.alice.id);
    expect(u?.name).toBe("Alleen Naam");
    expect(u?.profilePhotoStorageId).toBe(own);
  });
});

// --- beeld aan foto's van twee eigenaren (audit N1) -----------------------

describe("invariant 8 — beeld aan foto's van twee eigenaren (N1)", () => {
  async function twoOwnerPixels(t: T, w: World) {
    // Hetzelfde beeld als pAlice, ook aan een foto van carol in geen album.
    const storageId = await storageOf(t, w.photos.pAlice);
    const carolCopy = await sharePixels(t, w.users.carol.id, storageId);
    return { storageId, carolCopy };
  }

  it("toegang tot één van de twee foto's is genoeg: de caller ziet het beeld al", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { storageId } = await twoOwnerPixels(t, w);
    // bob: toegang tot pAlice (G1), niet tot carols foto.
    await setProfile(asUser(t, w, "bob"), storageId);
    expect((await profileOf(t, w.users.bob.id))?.profilePhotoStorageId).toBe(storageId);
  });

  it("eigenaar van één van de twee foto's mag zijn eigen beeld gebruiken", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { storageId } = await twoOwnerPixels(t, w);
    await setProfile(asUser(t, w, "alice"), storageId);
    expect((await profileOf(t, w.users.alice.id))?.profilePhotoStorageId).toBe(storageId);
  });

  it("toegang tot geen van beide: geweigerd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { storageId } = await twoOwnerPixels(t, w);
    const { client } = await newAccount(t, "mallory");
    await expectRejectedNoChange(t, () => setProfile(client, storageId));
  });
});

// --- orakel ---------------------------------------------------------------

describe("invariant 8 — onbekend en verboden beeld geven dezelfde uitkomst (N3)", () => {
  it("onbekend beeld tegenover andermans profielbeeld", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { client } = await newAccount(t, "mallory");
    const stale = await staleStorage(t);
    const aliceProfile = await profileStorageOf(t, w.users.alice.id);
    await expectNoMutationOracle(
      t,
      () => setProfile(client, stale),
      () => setProfile(client, aliceProfile),
    );
  });

  it("onbekend beeld tegenover het beeld van een foto zonder toegang", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { client } = await newAccount(t, "mallory");
    const stale = await staleStorage(t);
    const forbidden = await storageOf(t, w.photos.pBobPrivate);
    await expectNoMutationOracle(
      t,
      () => setProfile(client, stale),
      () => setProfile(client, forbidden),
    );
  });

  it("onbekend beeld tegenover een los beeld", async () => {
    const t = newT();
    await seedWorld(t);
    const { client } = await newAccount(t, "mallory");
    const stale = await staleStorage(t);
    const loose = await looseStorage(t);
    await expectNoMutationOracle(
      t,
      () => setProfile(client, stale),
      () => setProfile(client, loose),
    );
  });
});
