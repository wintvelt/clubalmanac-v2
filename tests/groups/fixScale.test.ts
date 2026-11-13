import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { modules } from "../_helpers/modules";
import { as, seedGroup, type T } from "./_beheer";
import { deleteAccount } from "../_helpers/deleteAccount";

// WP28 fix-cyclus 2, A-invariant 14 (red-team F1): verwijderen, vertrekken
// en het account verwijderen lukken voor een lid van een groep met
// PUBLICATIONS publicaties. WP19a: de ratings zijn geschrapt; wat blijft is de
// cascade zelf (M1: zijn foto's uit de albums van de groep, die van anderen
// blijven).
//
// convex-test dwingt hier de echte Convex-limieten af (`transactionLimits`),
// onder meer 4096 db-aanroepen per mutation. Zonder die optie valt een te
// dure opruiming in de tests niet op.
//
// Schaal: de grootste groep op prod heeft 18 leden en 1459 publicaties;
// 3000 is ruim het dubbele (spec §Fix-cyclus 2, A-keuze 1).
//
// Wereld: oprichter Olga, admin Anna en admin Rex in groep G. Olga heeft
// PUBLICATIONS foto's in G. Rex heeft OWN eigen foto's in G. Rex en Olga
// zitten ook in groep H, waar SHARED van Olga's foto's ook staan.

const PUBLICATIONS = 3000;
const OWN = 5;
const SHARED = 10;
const CHUNK = 500;

const newLimitedT = () => convexTest({ schema, modules, transactionLimits: true });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Big = Awaited<ReturnType<typeof bigWorld>>;

async function bigWorld(t: T) {
  const w = await seedGroup(t, { founder: "olga", members: { anna: "admin", rex: "admin" } });
  const olga = w.users.olga!;
  const rex = w.users.rex!;

  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const H = await ctx.db.insert("groups", { name: "Ander", createdBy: olga, createdAt: now });
    await ctx.db.insert("memberships", { userId: olga, groupId: H, role: "admin", joinedAt: now });
    await ctx.db.insert("memberships", { userId: rex, groupId: H, role: "member", joinedAt: now + 1 });
    const albumG = await ctx.db.insert("albums", { groupId: w.groupId, name: "G", createdBy: olga, createdAt: now });
    const albumH = await ctx.db.insert("albums", { groupId: H, name: "H", createdBy: olga, createdAt: now });
    const storageId = await ctx.storage.store(new Blob(["beeld"], { type: "image/jpeg" }));
    return { H, albumG, albumH, storageId };
  });

  const olgaPhotos: Array<Id<"photos">> = [];
  for (let start = 0; start < PUBLICATIONS; start += CHUNK) {
    const chunk = await t.run(async (ctx) => {
      const now = Date.now();
      const out: Array<Id<"photos">> = [];
      for (let i = start; i < Math.min(start + CHUNK, PUBLICATIONS); i++) {
        const photoId = await ctx.db.insert("photos", {
          ownerId: olga,
          storageId: ids.storageId,
          createdAt: now,
        });
        await ctx.db.insert("albumPhotos", { albumId: ids.albumG, photoId, groupId: w.groupId, addedAt: now, addedBy: olga });
        if (i < SHARED) {
          await ctx.db.insert("albumPhotos", { albumId: ids.albumH, photoId, groupId: ids.H, addedAt: now, addedBy: olga });
        }
        out.push(photoId);
      }
      return out;
    });
    olgaPhotos.push(...chunk);
  }

  const rexPhotos = await t.run(async (ctx) => {
    const now = Date.now();
    const out: Array<Id<"photos">> = [];
    for (let i = 0; i < OWN; i++) {
      const storageId = await ctx.storage.store(new Blob(["eigen"], { type: "image/jpeg" }));
      const photoId = await ctx.db.insert("photos", {
        ownerId: rex,
        storageId,
        createdAt: now,
      });
      await ctx.db.insert("albumPhotos", { albumId: ids.albumG, photoId, groupId: w.groupId, addedAt: now, addedBy: rex });
      out.push(photoId);
    }
    await ctx.db.patch(rex, { photoCount: OWN });
    return out;
  });

  return { ...w, ...ids, olgaPhotos, rexPhotos };
}

/** Foto's en publicaties in twee reads, zodat de check zelf binnen de limiet blijft. */
async function state(t: T) {
  const { pubs, photos } = await t.run(async (ctx) => ({
    pubs: await ctx.db.query("albumPhotos").collect(),
    photos: await ctx.db.query("photos").collect(),
  }));
  return { pubs, photos: new Map(photos.map((p) => [p._id, p])) };
}

/** Na verwijderen of vertrekken: zijn foto's zijn uit G, die van Olga staan er nog (M1). */
async function expectLeftG(t: T, w: Big) {
  const s = await state(t);
  const inG = s.pubs.filter((p) => p.albumId === w.albumG).map((p) => p.photoId);
  const inGSet = new Set(inG);
  for (const id of w.rexPhotos) expect(inGSet.has(id)).toBe(false);
  expect(inG.length, "Olga's publicaties in G").toBe(PUBLICATIONS);
  for (const id of w.rexPhotos) expect(s.photos.has(id), "zijn foto's zelf blijven").toBe(true);
  const inH = s.pubs.filter((p) => p.albumId === w.albumH);
  expect(inH).toHaveLength(SHARED);
}

async function membershipOf(t: T, groupId: Id<"groups">, userId: Id<"users">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_user_and_group", (q) => q.eq("userId", userId).eq("groupId", groupId))
      .unique(),
  );
}

describe(`A-invariant 14 — een lid van een groep met ${PUBLICATIONS} publicaties`, () => {
  it("de oprichter verwijdert hem uit de groep", { timeout: 120_000 }, async () => {
    const t = newLimitedT();
    const w = await bigWorld(t);
    await as(t, "user_olga").mutation(api.groups.removeMember, { groupId: w.groupId, userId: w.users.rex! });
    expect(await membershipOf(t, w.groupId, w.users.rex!)).toBeNull();
    await expectLeftG(t, w);
  });

  it("hij vertrekt zelf", { timeout: 120_000 }, async () => {
    const t = newLimitedT();
    const w = await bigWorld(t);
    await as(t, "user_rex").mutation(api.groups.removeMember, { groupId: w.groupId, userId: w.users.rex! });
    expect(await membershipOf(t, w.groupId, w.users.rex!)).toBeNull();
    await expectLeftG(t, w);
  });

  it("hij verwijdert zijn account", { timeout: 120_000 }, async () => {
    const t = newLimitedT();
    const w = await bigWorld(t);
    await deleteAccount(t, as(t, "user_rex"));

    const s = await state(t);
    for (const id of w.rexPhotos) expect(s.photos.has(id)).toBe(false);
    for (const id of w.olgaPhotos) expect(s.photos.has(id)).toBe(true);
  });
});
