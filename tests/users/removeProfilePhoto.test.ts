/// <reference types="vite/client" />
import type { FunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, newT, outcome, type T } from "../readWhitelist/_world";

// WP18 invariant 10, A-invariant 16 (kernvondst 1): de app kan de profielfoto
// weghalen. `users.updateProfile` kan het beeld niet leegmaken (een ontbrekend
// veld slaat hij over), dus een eigen mutation zonder argumenten.
//
// Vraag 1 volgt het advies: de profielfoto is een gewone eigen foto, en
// weghalen haalt alleen de koppeling weg (v1-pariteit, `updateUser` met
// `photoId: null`). Kiest Wouter "het beeld wissen", dan past A de describe
// "vraag 1" aan.
//
// Spec: docs/work-packages/WP18-foto-upload.md §Spec-criticus aanvullingen.

const removeProfilePhoto = (
  api as unknown as {
    users: { removeProfilePhoto: FunctionReference<"mutation", "public", Record<string, never>> };
  }
).users.removeProfilePhoto;

const MISSING_FUNCTION =
  /could not find|no such export|exported from module|no function named|not a function|not registered/i;

/** alice met een eigen foto als profielfoto, bob met een los profielbeeld. */
async function world(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      subject: "user_alice",
      email: "alice@x.com",
      name: "alice",
      photoCount: 1,
      photoLimit: 1000,
      createdAt: now,
    });
    const storageId = await ctx.storage.store(new Blob(["profiel-alice"]));
    const pAlice = await ctx.db.insert("photos", {
      ownerId: alice,
      storageId,
      ratingCount: 0,
      createdAt: now,
    });
    await ctx.db.patch(alice, { profilePhotoStorageId: storageId });
    const bob = await ctx.db.insert("users", {
      subject: "user_bob",
      email: "bob@x.com",
      name: "bob",
      profilePhotoStorageId: await ctx.storage.store(new Blob(["profiel-bob"])),
      photoCount: 0,
      photoLimit: 1000,
      createdAt: now,
    });
    return { alice, bob, pAlice, storageId };
  });
}

const asAlice = (t: T) => as(t, "user_alice", "alice@x.com");

async function userRow(t: T, id: Id<"users">) {
  return await t.run(async (ctx) => ctx.db.get(id));
}

describe("users.removeProfilePhoto (A-invariant 16)", () => {
  it("haalt de profielfoto weg: geen beeld meer op het profielpad, versie 0", async () => {
    const t = newT();
    const w = await world(t);
    expect(await t.query(internal.images.profileImage, { userId: w.alice })).toBe(w.storageId);

    await asAlice(t).mutation(removeProfilePhoto, {});

    expect((await userRow(t, w.alice))!.profilePhotoStorageId).toBeUndefined();
    expect(await t.query(internal.images.profileImage, { userId: w.alice })).toBeNull();
    const profile = await asAlice(t).query(api.users.profile, {});
    expect(profile!.profileVersion).toBe("0");
    expect(profile!.profileHasFormats).toBe(false);
    expect(profile!.profileOrientation).toBeUndefined();
  });

  it("raakt de naam, de telling en andere users niet", async () => {
    const t = newT();
    const w = await world(t);
    const before = await t.run(async (ctx) => ctx.db.query("users").collect());

    await asAlice(t).mutation(removeProfilePhoto, {});

    const after = await t.run(async (ctx) => ctx.db.query("users").collect());
    for (const row of after) {
      const old = before.find((u) => u._id === row._id)!;
      if (row._id === w.alice) {
        const { profilePhotoStorageId: _gone, ...rest } = old;
        expect(row).toEqual(rest);
      } else {
        expect(row).toEqual(old);
      }
    }
  });

  it("zonder profielfoto: niets, en geen fout", async () => {
    const t = newT();
    const w = await world(t);
    await asAlice(t).mutation(removeProfilePhoto, {});
    const once = await userRow(t, w.alice);
    await asAlice(t).mutation(removeProfilePhoto, {});
    expect(await userRow(t, w.alice)).toEqual(once);
  });

  it("uitgelogd: geweigerd, niets veranderd", async () => {
    const t = newT();
    await world(t);
    const before = await t.run(async (ctx) => ctx.db.query("users").collect());
    const o = await outcome(() => t.mutation(removeProfilePhoto, {}));
    expect("err" in o).toBe(true);
    if ("err" in o) expect(o.err).not.toMatch(MISSING_FUNCTION);
    expect(await t.run(async (ctx) => ctx.db.query("users").collect())).toEqual(before);
  });

  it("daarna kan een eigen foto weer de profielfoto worden", async () => {
    const t = newT();
    const w = await world(t);
    await asAlice(t).mutation(removeProfilePhoto, {});
    await asAlice(t).mutation(api.users.setProfilePhoto, { photoId: w.pAlice });
    expect(await t.query(internal.images.profileImage, { userId: w.alice })).toBe(w.storageId);
  });
});

describe("users.removeProfilePhoto — vraag 1 (advies: alleen de koppeling)", () => {
  it("de foto, zijn beeld en de telling blijven", async () => {
    const t = newT();
    const w = await world(t);
    await asAlice(t).mutation(removeProfilePhoto, {});

    const photo = await t.run(async (ctx) => ctx.db.get(w.pAlice));
    expect(photo).not.toBeNull();
    // t.run kan geen Blob teruggeven (geen Convex-waarde): alleen of het beeld er nog is.
    expect(await t.run(async (ctx) => (await ctx.storage.get(w.storageId)) !== null)).toBe(true);
    expect((await userRow(t, w.alice))!.photoCount).toBe(1);
    // De eigenaar ziet zijn foto nog.
    expect(await asAlice(t).query(internal.images.photoImage, { photoId: w.pAlice })).toBe(
      w.storageId,
    );
  });
});
