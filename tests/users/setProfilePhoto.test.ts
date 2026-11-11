/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, newT, outcome, type T } from "../readWhitelist/_world";

// WP27 invariant 1 en A-invariant 8 (draait WP17b invariant 12 terug, besluit
// 2): "als profielfoto instellen" loopt via het foto-id (de app kent geen
// storageId, WP17a invariant 10) en neemt elke foto waar de caller
// foto-toegang toe heeft: een eigen foto, of de foto van een ander in een
// album van een groep waar hij lid van is. Geweigerd: één uitkomst voor een
// foto zonder toegang, een foto van een ander in geen album, een onbekend en
// een gewist id, en niets verandert. Wat er daarna op het profielpad gebeurt
// als de toegang wegvalt: tests/users/profileAccess.test.ts.
//
// Spec: docs/work-packages/WP27-profiel.md §Spec-criticus aanvullingen.

const MISSING_FUNCTION =
  /could not find|no such export|exported from module|no function named|not a function|not registered/i;

/**
 * Wereld:
 *   G — alice (member), bob (admin). Album A met pAlice en pBob.
 *   pAlicePrivate — van alice, in geen album.
 *   pBobPrivate — van bob, in geen album.
 *   pCarol — van carol, geen groep met alice.
 *   Elke user heeft een los profielbeeld (zoals een gemigreerde v1-profielfoto).
 */
async function world(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const blob = (s: string) => ctx.storage.store(new Blob([s]));
    const user = async (key: string) =>
      ctx.db.insert("users", {
        subject: `user_${key}`,
        email: `${key}@x.com`,
        name: key,
        profilePhotoStorageId: await blob(`profiel-${key}`),
        photoCount: 0,
        photoLimit: 1000,
        createdAt: now,
      });
    const alice = await user("alice");
    const bob = await user("bob");
    const carol = await user("carol");
    const photo = async (ownerId: Id<"users">, exifOrientation: number) =>
      ctx.db.insert("photos", {
        ownerId,
        storageId: await blob(`foto-${ownerId}-${exifOrientation}`),
        exifOrientation,
        ratingCount: 0,
        createdAt: now,
      });
    const pAlice = await photo(alice, 6);
    const pAlicePrivate = await photo(alice, 3);
    const pBob = await photo(bob, 8);
    const pBobPrivate = await photo(bob, 2);
    const pCarol = await photo(carol, 1);
    const groupId = await ctx.db.insert("groups", { name: "G", createdBy: bob, createdAt: now });
    await ctx.db.insert("memberships", { userId: alice, groupId, role: "member", joinedAt: now });
    await ctx.db.insert("memberships", { userId: bob, groupId, role: "admin", joinedAt: now });
    const albumId = await ctx.db.insert("albums", { groupId, name: "A", createdBy: bob, createdAt: now });
    for (const [photoId, addedBy] of [
      [pAlice, alice],
      [pBob, bob],
    ] as const) {
      await ctx.db.insert("albumPhotos", { albumId, photoId, groupId, addedAt: now, addedBy });
    }
    return { alice, bob, carol, pAlice, pAlicePrivate, pBob, pBobPrivate, pCarol };
  });
}

type W = Awaited<ReturnType<typeof world>>;

const asAlice = (t: T) => as(t, "user_alice", "alice@x.com");
const setProfilePhoto = (t: T, photoId: Id<"photos">) =>
  asAlice(t).mutation(api.users.setProfilePhoto, { photoId });

async function userRow(t: T, id: Id<"users">) {
  return await t.run(async (ctx) => ctx.db.get(id));
}

async function storageOf(t: T, photoId: Id<"photos">) {
  return await t.run(async (ctx) => (await ctx.db.get(photoId))!.storageId);
}

async function usersSnapshot(t: T) {
  return await t.run(async (ctx) => ctx.db.query("users").collect());
}

/** Een foto-id dat niet meer bestaat. */
async function goneId(t: T, w: W): Promise<Id<"photos">> {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("photos", {
      ownerId: w.alice,
      storageId: await ctx.storage.store(new Blob(["weg"])),
      ratingCount: 0,
      createdAt: Date.now(),
    });
    await ctx.db.delete(id);
    return id;
  });
}

async function expectRefusedNoChange(t: T, run: () => Promise<unknown>, label: string) {
  const before = await usersSnapshot(t);
  const o = await outcome(run);
  expect("err" in o, `${label}: had moeten falen`).toBe(true);
  if ("err" in o) expect(o.err, `${label}: geen echte weigering`).not.toMatch(MISSING_FUNCTION);
  expect(await usersSnapshot(t), `${label}: users gewijzigd`).toEqual(before);
  return o;
}

describe("users.setProfilePhoto: een eigen foto", () => {
  it("een eigen foto in een album wordt de profielfoto", async () => {
    const t = newT();
    const w = await world(t);
    await setProfilePhoto(t, w.pAlice);
    expect((await userRow(t, w.alice))!.profilePhotoStorageId).toBe(await storageOf(t, w.pAlice));
    // Het openbare profielpad geeft nu dat beeld.
    expect(await t.query(internal.images.profileImage, { userId: w.alice })).toBe(
      await storageOf(t, w.pAlice),
    );
  });

  it("een eigen foto in geen album mag ook", async () => {
    const t = newT();
    const w = await world(t);
    await setProfilePhoto(t, w.pAlicePrivate);
    expect((await userRow(t, w.alice))!.profilePhotoStorageId).toBe(
      await storageOf(t, w.pAlicePrivate),
    );
  });

  it("raakt de naam en andere users niet", async () => {
    const t = newT();
    const w = await world(t);
    const before = await usersSnapshot(t);
    await setProfilePhoto(t, w.pAlice);
    const after = await usersSnapshot(t);
    for (const row of after) {
      const old = before.find((u) => u._id === row._id)!;
      if (row._id === w.alice) {
        expect({ ...row, profilePhotoStorageId: old.profilePhotoStorageId }).toEqual(old);
      } else {
        expect(row).toEqual(old);
      }
    }
  });

  it("de avatar volgt de stand van die foto, ook na draaien", async () => {
    const t = newT();
    const w = await world(t);
    await setProfilePhoto(t, w.pAlice);
    const before = await asAlice(t).query(api.users.profile, {});
    expect(before!.profileOrientation).toBe(6);
    await asAlice(t).mutation(api.photos.rotate, { photoId: w.pAlice, rotation: 90, flipY: false });
    const rotated = await t.run(async (ctx) => (await ctx.db.get(w.pAlice))!.exifOrientation);
    expect(rotated).not.toBe(6);
    const after = await asAlice(t).query(api.users.profile, {});
    expect(after!.profileOrientation).toBe(rotated);
  });
});

describe("users.setProfilePhoto: de foto van een ander met foto-toegang (besluit 2)", () => {
  it("de foto van een groepsgenoot in een gedeeld album wordt de profielfoto", async () => {
    const t = newT();
    const w = await world(t);
    await setProfilePhoto(t, w.pBob);
    expect((await userRow(t, w.alice))!.profilePhotoStorageId).toBe(await storageOf(t, w.pBob));
    expect(await t.query(internal.images.profileImage, { userId: w.alice })).toBe(
      await storageOf(t, w.pBob),
    );
  });

  it("de avatar volgt de stand van die foto", async () => {
    const t = newT();
    const w = await world(t);
    await setProfilePhoto(t, w.pBob);
    const me = await asAlice(t).query(api.users.profile, {});
    expect(me!.profileOrientation).toBe(8);
  });

  it("ook een admin: de foto van een ander lid", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_bob", "bob@x.com").mutation(api.users.setProfilePhoto, { photoId: w.pAlice });
    expect((await userRow(t, w.bob))!.profilePhotoStorageId).toBe(await storageOf(t, w.pAlice));
  });

  it("raakt de foto, de eigenaar en zijn telling niet (besluit 5: de eigenaar hoort het niet)", async () => {
    const t = newT();
    const w = await world(t);
    const before = await t.run(async (ctx) => ({
      bob: await ctx.db.get(w.bob),
      photo: await ctx.db.get(w.pBob),
    }));
    await setProfilePhoto(t, w.pBob);
    const after = await t.run(async (ctx) => ({
      bob: await ctx.db.get(w.bob),
      photo: await ctx.db.get(w.pBob),
    }));
    expect(after).toEqual(before);
    // Geen mail of andere geplande actie.
    const scheduled = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toEqual([]);
  });
});

describe("users.setProfilePhoto: geweigerd, één uitkomst, niets veranderd (A-invariant 8)", () => {
  it("de foto van een ander buiten elke gedeelde groep", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefusedNoChange(t, () => setProfilePhoto(t, w.pCarol), "pCarol");
  });

  it("de foto van een groepsgenoot die in geen album staat", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefusedNoChange(t, () => setProfilePhoto(t, w.pBobPrivate), "pBobPrivate");
  });

  it("geen orakel: zonder toegang, buiten album, onbekend en gewist geven dezelfde uitkomst", async () => {
    const t = newT();
    const w = await world(t);
    const noAccess = await expectRefusedNoChange(t, () => setProfilePhoto(t, w.pCarol), "zonder toegang");
    const notInAlbum = await expectRefusedNoChange(t, () => setProfilePhoto(t, w.pBobPrivate), "buiten album");
    const gone = await goneId(t, w);
    const unknown = await expectRefusedNoChange(t, () => setProfilePhoto(t, gone), "gewist");
    expect(notInAlbum).toEqual(noAccess);
    expect(unknown).toEqual(noAccess);
  });

  it("na vertrek uit de groep: de foto van een ex-groepsgenoot", async () => {
    const t = newT();
    const w = await world(t);
    const groupId = await t.run(async (ctx) => (await ctx.db.query("groups").first())!._id);
    await asAlice(t).mutation(api.groups.removeMember, { groupId, userId: w.alice });
    await expectRefusedNoChange(t, () => setProfilePhoto(t, w.pBob), "ex-lid");
  });

  it("uitgelogd", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefusedNoChange(
      t,
      () => t.mutation(api.users.setProfilePhoto, { photoId: w.pAlice }),
      "uitgelogd",
    );
  });

  it("na een weigering geeft het profielpad nog het oude beeld", async () => {
    const t = newT();
    const w = await world(t);
    const old = (await userRow(t, w.alice))!.profilePhotoStorageId;
    await outcome(() => setProfilePhoto(t, w.pCarol));
    expect(await t.query(internal.images.profileImage, { userId: w.alice })).toBe(old);
  });
});

// WP27 fix-cyclus 1, audit-nit 1 (A-invariant 20): het commentaar bij
// canUseStorage beschrijft de regel van nu. updateProfile neemt alleen een
// eigen beeld; de foto van een ander gaat via setProfilePhoto op foto-id, met
// foto-toegang (besluit 2). De oude zin ("foto-toegang is niet genoeg") is weg.
describe("bronscan: het commentaar bij canUseStorage", () => {
  const src = readFileSync(join(__dirname, "../../convex/lib/photoAccess.ts"), "utf8");
  const start = src.lastIndexOf("\n\n", src.indexOf("export async function canUseStorage"));
  const comment = src.slice(start, src.indexOf("export async function canUseStorage"));

  it("zegt niet meer dat foto-toegang tot de foto van een ander niet genoeg is", () => {
    expect(comment).not.toMatch(/niet genoeg/);
  });

  it("verwijst voor de foto van een ander naar setProfilePhoto", () => {
    expect(comment).toMatch(/setProfilePhoto/);
  });
});
