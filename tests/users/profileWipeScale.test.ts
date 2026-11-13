import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP27 fix-cyclus 1, A-invariant 16: de koppeling wissen (besluit 7) lukt
// binnen de Convex-limieten, ook in de grootste groep. convex-test dwingt de
// limieten alleen af met `transactionLimits` (les WP28).
//
// Schaal: de grootste groep op prod heeft 18 leden en 1459 publicaties. Hier
// 18 leden en PUBLICATIONS publicaties (ruim het dubbele), elk met een eigen
// beeld. Elk lid behalve Olga heeft een foto van Olga als profielfoto, twee
// users buiten de groep een standaard-knor. Op prod zijn er 20 users.
//
// Drie manieren waarop iedereen tegelijk de toegang verliest: het album weg,
// de groep weg, en Olga die vertrekt (M1).

const PUBLICATIONS = 3000;
const MEMBERS = 17;
const CHUNK = 500;

const newLimitedT = () => convexTest({ schema, modules, transactionLimits: true });
type T = ReturnType<typeof newLimitedT>;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function bigWorld(t: T) {
  const base = await t.run(async (ctx) => {
    const now = Date.now();
    const user = (subject: string, name: string) =>
      ctx.db.insert("users", {
        subject,
        email: `${subject}@x.com`,
        name,
        photoCount: 0,
        photoLimit: 5000,
        createdAt: now,
      });
    const olga = await user("user_olga", "Olga");
    const members: Array<Id<"users">> = [];
    for (let i = 0; i < MEMBERS; i++) members.push(await user(`user_m${i}`, `Lid ${i}`));
    const knorren: Array<Id<"users">> = [];
    for (let i = 0; i < 2; i++) {
      const id = await user(`user_k${i}`, `Knor ${i}`);
      const knor = await ctx.storage.store(new Blob(["knor"], { type: "image/jpeg" }));
      await ctx.db.patch(id, { profilePhotoStorageId: knor });
      knorren.push(id);
    }
    const G = await ctx.db.insert("groups", { name: "Groot", createdBy: olga, createdAt: now });
    await ctx.db.insert("memberships", { userId: olga, groupId: G, role: "admin", joinedAt: now });
    for (let i = 0; i < MEMBERS; i++) {
      await ctx.db.insert("memberships", {
        userId: members[i]!,
        groupId: G,
        role: i === 0 ? "admin" : "member",
        joinedAt: now + 1 + i,
      });
    }
    const album = await ctx.db.insert("albums", { groupId: G, name: "Alles", createdBy: olga, createdAt: now });
    return { olga, members, knorren, G, album };
  });

  const photos: Array<{ photoId: Id<"photos">; storageId: Id<"_storage"> }> = [];
  for (let start = 0; start < PUBLICATIONS; start += CHUNK) {
    const chunk = await t.run(async (ctx) => {
      const now = Date.now();
      const out: Array<{ photoId: Id<"photos">; storageId: Id<"_storage"> }> = [];
      for (let i = start; i < Math.min(start + CHUNK, PUBLICATIONS); i++) {
        const storageId = await ctx.storage.store(new Blob([`foto ${i}`], { type: "image/jpeg" }));
        const photoId = await ctx.db.insert("photos", {
          ownerId: base.olga,
          storageId,
          createdAt: now,
        });
        await ctx.db.insert("albumPhotos", {
          albumId: base.album,
          photoId,
          groupId: base.G,
          addedAt: now,
          addedBy: base.olga,
        });
        out.push({ photoId, storageId });
      }
      return out;
    });
    photos.push(...chunk);
  }
  await t.run((ctx) => ctx.db.patch(base.olga, { photoCount: PUBLICATIONS }));

  // Elk lid kiest een andere foto van Olga, verspreid over het album.
  for (let i = 0; i < MEMBERS; i++) {
    const p = photos[Math.floor((i * PUBLICATIONS) / MEMBERS)]!;
    await withUser(t, `user_m${i}`).mutation(api.users.setProfilePhoto, { photoId: p.photoId });
  }
  return { ...base, photos };
}

async function links(t: T, ids: Array<Id<"users">>) {
  return await t.run(async (ctx) =>
    Promise.all(ids.map(async (id) => (await ctx.db.get(id))?.profilePhotoStorageId ?? null)),
  );
}

async function expectWiped(t: T, w: Awaited<ReturnType<typeof bigWorld>>) {
  expect(await links(t, w.members), "leden").toEqual(w.members.map(() => null));
  const knor = await links(t, w.knorren);
  expect(knor.every((k) => k !== null), "knorren blijven").toBe(true);
}

describe("A-invariant 16: de koppeling wissen binnen de Convex-limieten", () => {
  it(`het album met ${PUBLICATIONS} foto's weg: elk lid de letter`, { timeout: 120_000 }, async () => {
    const t = newLimitedT();
    const w = await bigWorld(t);
    await withUser(t, "user_olga").mutation(api.albums.remove, { albumId: w.album });
    await expectWiped(t, w);
  });

  it(`de groep met ${PUBLICATIONS} publicaties weg: elk lid de letter`, { timeout: 120_000 }, async () => {
    const t = newLimitedT();
    const w = await bigWorld(t);
    await withUser(t, "user_olga").mutation(api.groups.remove, { groupId: w.G });
    await expectWiped(t, w);
  });

  it(`Olga vertrekt na overdracht (M1, ${PUBLICATIONS} foto's uit het album): elk lid de letter`, { timeout: 120_000 }, async () => {
    const t = newLimitedT();
    const w = await bigWorld(t);
    await withUser(t, "user_olga").mutation(api.groups.transferFounder, {
      groupId: w.G,
      userId: w.members[0]!,
    });
    await withUser(t, "user_olga").mutation(api.groups.removeMember, { groupId: w.G, userId: w.olga });
    await expectWiped(t, w);
  });
});
