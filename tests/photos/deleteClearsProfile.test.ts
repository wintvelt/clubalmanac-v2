/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, newT, type T } from "../readWhitelist/_world";
import { deleteAccount } from "../_helpers/deleteAccount";

// WP17b A-keuze 1 (kernvondst 2): een foto wissen wist ook elke profielfoto
// die het beeld van die foto is, in dezelfde transactie. v1 deed dat via
// photoDelToCover (ook op UBbase). Zonder dit wijst de profielfoto na het
// wissen naar een gewist beeld (U7 wist het). Andere profielfoto's blijven.
// Geldt voor elk pad dat een foto wist: photos.remove, users.deleteSelf (U7)
// en de FL1-cron. Sluit de [GAP] in cascade-matrix P5.
//
// Spec: docs/work-packages/WP17b-foto-acties.md §A-keuzes ter bevestiging.

/**
 * Wereld:
 *   pAlice — van alice. Haar eigen profielfoto is dit beeld.
 *   bob    — profielfoto is óók het beeld van pAlice (gemigreerd uit v1:
 *            WP17a besluit 13, de foto van een ander als profielfoto).
 *   carol  — een los profielbeeld, nergens aan gekoppeld.
 *   dave   — profielfoto is het beeld van zijn eigen foto pDave.
 */
async function world(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const blob = (s: string) => ctx.storage.store(new Blob([s]));
    const user = (key: string, profilePhotoStorageId?: Id<"_storage">) =>
      ctx.db.insert("users", {
        subject: `user_${key}`,
        email: `${key}@x.com`,
        name: key,
        ...(profilePhotoStorageId ? { profilePhotoStorageId } : {}),
        photoCount: 1,
        photoLimit: 1000,
        createdAt: now,
      });
    const aliceImage = await blob("alice");
    const daveImage = await blob("dave");
    const alice = await user("alice", aliceImage);
    const bob = await user("bob", aliceImage);
    const carol = await user("carol", await blob("carol-los"));
    const dave = await user("dave", daveImage);
    const pAlice = await ctx.db.insert("photos", {
      ownerId: alice,
      storageId: aliceImage,
      createdAt: now,
    });
    const pDave = await ctx.db.insert("photos", {
      ownerId: dave,
      storageId: daveImage,
      createdAt: now,
    });
    return { alice, bob, carol, dave, pAlice, pDave };
  });
}

type W = Awaited<ReturnType<typeof world>>;

async function profiles(t: T, w: W) {
  return await t.run(async (ctx) => {
    const get = async (id: Id<"users">) => (await ctx.db.get(id))?.profilePhotoStorageId;
    return { alice: await get(w.alice), bob: await get(w.bob), carol: await get(w.carol), dave: await get(w.dave) };
  });
}

describe("A-keuze 1: een foto wissen wist de profielfoto die dat beeld is", () => {
  it("photos.remove: de eigenaar en een ander met dat beeld als profielfoto verliezen hem; de rest blijft", async () => {
    const t = newT();
    const w = await world(t);
    const before = await profiles(t, w);
    await as(t, "user_alice", "alice@x.com").mutation(api.photos.remove, { photoId: w.pAlice });
    const after = await profiles(t, w);
    expect(after.alice).toBeUndefined();
    expect(after.bob).toBeUndefined();
    expect(after.carol).toBe(before.carol);
    expect(after.dave).toBe(before.dave);
  });

  it("photos.remove: daarna geeft het profielpad geen beeld meer, ook niet voor de ander", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_alice", "alice@x.com").mutation(api.photos.remove, { photoId: w.pAlice });
    expect(await t.query(internal.images.profileImage, { userId: w.alice })).toBeNull();
    expect(await t.query(internal.images.profileImage, { userId: w.bob })).toBeNull();
    // De avatar-velden vallen terug op "geen profielfoto" (WP17a invariant 14).
    const me = await as(t, "user_alice", "alice@x.com").query(api.users.profile, {});
    expect(me!.profileHasFormats).toBe(false);
    expect(me!.profileOrientation).toBeUndefined();
  });

  it("users.deleteSelf (U7): wie de foto van de vertrekker als profielfoto had, verliest hem", async () => {
    const t = newT();
    const w = await world(t);
    const before = await profiles(t, w);
    await deleteAccount(t, as(t, "user_alice", "alice@x.com"));
    const after = await profiles(t, w);
    expect(after.bob).toBeUndefined();
    expect(after.carol).toBe(before.carol);
    expect(after.dave).toBe(before.dave);
  });

  it("FL1-cron: een gemelde foto die na de termijn verdwijnt, neemt de profielfoto mee", async () => {
    const t = newT();
    const w = await world(t);
    const before = await profiles(t, w);
    await t.run(async (ctx) => {
      await ctx.db.patch(w.pDave, {
        flaggedAt: Date.now() - 20 * 86_400_000,
        flaggedBy: w.alice,
        flaggedDeleteDate: Date.now() - 1000,
      });
    });
    await t.mutation(internal.photos.cleanupFlaggedPhotos, {});
    const after = await profiles(t, w);
    expect(after.dave).toBeUndefined();
    expect(after.alice).toBe(before.alice);
    expect(after.bob).toBe(before.bob);
    expect(after.carol).toBe(before.carol);
  });
});
