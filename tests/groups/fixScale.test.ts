import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { modules } from "../_helpers/modules";
import { as, seedGroup, type T } from "./_beheer";

// WP28 fix-cyclus 2, A-invariant 14 (red-team F1): verwijderen, vertrekken
// en het account verwijderen lukken voor een lid dat elke foto heeft gerated
// die hij kan zien, ook in een groep van PUBLICATIONS publicaties. A-invariant
// 7 blijft gelden: de juiste ratings gaan weg, het gemiddelde en het aantal
// kloppen.
//
// convex-test dwingt hier de echte Convex-limieten af (`transactionLimits`),
// onder meer 4096 db-aanroepen per mutation. Zonder die optie valt een te
// dure opruiming in de tests niet op.
//
// Schaal: de grootste groep op prod heeft 18 leden en 1459 publicaties;
// 3000 is ruim het dubbele (spec §Fix-cyclus 2, A-keuze 1).
//
// Wereld: oprichter Olga, admin Anna en admin Rex in groep G. Olga heeft
// PUBLICATIONS foto's in G; Anna (4) en Rex (2) gaven ze allemaal een
// rating. Rex heeft OWN eigen foto's in G, die hij en Anna ook ratten. Rex en
// Olga zitten ook in groep H, waar SHARED van Olga's foto's ook staan: daar
// houdt Rex zijn rating.

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
  const anna = w.users.anna!;
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
          ratingCount: 2,
          ratingAverage: 3,
          createdAt: now,
        });
        await ctx.db.insert("albumPhotos", { albumId: ids.albumG, photoId, groupId: w.groupId, addedAt: now, addedBy: olga });
        if (i < SHARED) {
          await ctx.db.insert("albumPhotos", { albumId: ids.albumH, photoId, groupId: ids.H, addedAt: now, addedBy: olga });
        }
        await ctx.db.insert("ratings", { photoId, userId: anna, value: 4, createdAt: now, updatedAt: now });
        await ctx.db.insert("ratings", { photoId, userId: rex, value: 2, createdAt: now, updatedAt: now });
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
        ratingCount: 2,
        ratingAverage: 4.5,
        createdAt: now,
      });
      await ctx.db.insert("albumPhotos", { albumId: ids.albumG, photoId, groupId: w.groupId, addedAt: now, addedBy: rex });
      await ctx.db.insert("ratings", { photoId, userId: anna, value: 4, createdAt: now, updatedAt: now });
      await ctx.db.insert("ratings", { photoId, userId: rex, value: 5, createdAt: now, updatedAt: now });
      out.push(photoId);
    }
    await ctx.db.patch(rex, { photoCount: OWN });
    return out;
  });

  return { ...w, ...ids, olgaPhotos, rexPhotos };
}

/** Alle ratings en foto's in twee reads, zodat de check zelf binnen de limiet blijft. */
async function state(t: T) {
  const { ratings, photos } = await t.run(async (ctx) => ({
    ratings: await ctx.db.query("ratings").collect(),
    photos: await ctx.db.query("photos").collect(),
  }));
  return { ratings, photos: new Map(photos.map((p) => [p._id, p])) };
}

/** A-invariant 7: aantal en gemiddelde op elke foto volgen uit zijn ratings. */
function expectAggregatesMatch(s: Awaited<ReturnType<typeof state>>) {
  const byPhoto = new Map<Id<"photos">, number[]>();
  for (const r of s.ratings) byPhoto.set(r.photoId, [...(byPhoto.get(r.photoId) ?? []), r.value]);
  let wrong = 0;
  for (const [id, p] of s.photos) {
    const values = byPhoto.get(id) ?? [];
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
    const okCount = (p.ratingCount ?? 0) === values.length;
    const okAvg = avg === undefined ? p.ratingAverage === undefined : Math.abs((p.ratingAverage ?? NaN) - avg) < 1e-9;
    if (!okCount || !okAvg) wrong++;
  }
  expect(wrong, "foto's met een aggregaat dat niet bij de ratings past").toBe(0);
}

function ratingsOf(s: Awaited<ReturnType<typeof state>>, userId: Id<"users">) {
  return s.ratings.filter((r) => r.userId === userId);
}

/** Na verwijderen of vertrekken: Rex houdt alleen de ratings op wat hij nog ziet. */
async function expectLeftG(t: T, w: Big) {
  const s = await state(t);
  const rex = w.users.rex!;
  const anna = w.users.anna!;

  const kept = new Set(ratingsOf(s, rex).map((r) => r.photoId));
  const expected = new Set([...w.olgaPhotos.slice(0, SHARED), ...w.rexPhotos]);
  expect(kept.size, "ratings die Rex houdt").toBe(expected.size);
  for (const id of expected) expect(kept.has(id)).toBe(true);

  // Anna ziet Rex' eigen foto's niet meer (M1, AP3); Olga's foto's wel.
  const annaOn = new Set(ratingsOf(s, anna).map((r) => r.photoId));
  expect(annaOn.size).toBe(PUBLICATIONS);
  for (const id of w.rexPhotos) expect(annaOn.has(id)).toBe(false);

  expectAggregatesMatch(s);
  const sample = s.photos.get(w.olgaPhotos[PUBLICATIONS - 1]!);
  expect(sample?.ratingCount).toBe(1);
  expect(sample?.ratingAverage).toBeCloseTo(4, 9);
  const shared = s.photos.get(w.olgaPhotos[0]!);
  expect(shared?.ratingCount).toBe(2);
  expect(shared?.ratingAverage).toBeCloseTo(3, 9);
}

async function membershipOf(t: T, groupId: Id<"groups">, userId: Id<"users">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_user_and_group", (q) => q.eq("userId", userId).eq("groupId", groupId))
      .unique(),
  );
}

describe(`A-invariant 14 — een lid met ${PUBLICATIONS} ratings`, () => {
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
    await as(t, "user_rex").mutation(api.users.deleteSelf, {});

    const s = await state(t);
    expect(ratingsOf(s, w.users.rex!)).toHaveLength(0);
    for (const id of w.rexPhotos) expect(s.photos.has(id)).toBe(false);
    expectAggregatesMatch(s);
    const sample = s.photos.get(w.olgaPhotos[0]!);
    expect(sample?.ratingCount).toBe(1);
    expect(sample?.ratingAverage).toBeCloseTo(4, 9);
  });
});
