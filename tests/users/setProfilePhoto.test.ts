/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, newT, outcome, type T } from "../readWhitelist/_world";

// WP17b invariant 12 (kernvondst 1, vraag 4): de app kent geen storageId meer
// (WP17a invariant 10), dus "als profielfoto instellen" loopt via het foto-id.
// Dezelfde regel als WP17a invariant 16: alleen een eigen foto. Een profielfoto
// is openbaar (WP17a besluit 8), dus foto-toegang tot de foto van een ander is
// niet genoeg. Geweigerd: één uitkomst voor een foto van een ander (met of
// zonder toegang), een onbekend en een gewist id, en niets verandert.
//
// Spec: docs/work-packages/WP17b-foto-acties.md §Spec-criticus aanvullingen.

const MISSING_FUNCTION =
  /could not find|no such export|exported from module|no function named|not a function|not registered/i;

/**
 * Wereld:
 *   G — alice (member), bob (admin). Album A met pAlice en pBob.
 *   pAlicePrivate — van alice, in geen album.
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
    return { alice, bob, carol, pAlice, pAlicePrivate, pBob, pCarol };
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

describe("users.setProfilePhoto: geweigerd, één uitkomst, niets veranderd", () => {
  it("de foto van een groepsgenoot (met foto-toegang)", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefusedNoChange(t, () => setProfilePhoto(t, w.pBob), "pBob");
  });

  it("ook als admin: de foto van een ander lid", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefusedNoChange(
      t,
      () => as(t, "user_bob", "bob@x.com").mutation(api.users.setProfilePhoto, { photoId: w.pAlice }),
      "bob op pAlice",
    );
  });

  it("geen orakel: andermans foto met toegang, zonder toegang, onbekend en gewist geven dezelfde uitkomst", async () => {
    const t = newT();
    const w = await world(t);
    const withAccess = await expectRefusedNoChange(t, () => setProfilePhoto(t, w.pBob), "met toegang");
    const noAccess = await expectRefusedNoChange(t, () => setProfilePhoto(t, w.pCarol), "zonder toegang");
    const gone = await goneId(t, w);
    const unknown = await expectRefusedNoChange(t, () => setProfilePhoto(t, gone), "gewist");
    expect(noAccess).toEqual(withAccess);
    expect(unknown).toEqual(withAccess);
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
    await outcome(() => setProfilePhoto(t, w.pBob));
    expect(await t.query(internal.images.profileImage, { userId: w.alice })).toBe(old);
  });
});
