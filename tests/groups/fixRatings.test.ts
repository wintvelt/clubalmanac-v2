import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  as,
  newT,
  publish,
  seedAlbum,
  seedGroup,
  seedPhoto,
  seedRating,
  type T,
} from "./_beheer";

// WP28 fix-cyclus 1, A-invariant 7 (red-team R1) en S2 (audit): wie de
// toegang tot een foto verliest, verliest zijn rating erop, langs elke weg
// waarop hij uit een groep verdwijnt. Het gemiddelde en het aantal kloppen
// daarna. Een rating op een foto die hij nog ziet, blijft.
//
// Wereld: oprichter Olga, admin Anna, lid Rex en lid Mia. Foto P van Olga
// staat in album A van de groep. Rex en Mia gaven P een rating.

async function world(t: T) {
  const w = await seedGroup(t, {
    founder: "olga",
    members: { anna: "admin", rex: "member", mia: "member" },
    outsiders: ["eve", "kees"],
  });
  const A = await seedAlbum(t, w.groupId, w.users.olga!, "A");
  const P = await seedPhoto(t, w.users.olga!);
  await publish(t, A, P);
  await seedRating(t, P, w.users.rex!, 1);
  await seedRating(t, P, w.users.mia!, 5);
  return { ...w, A, P };
}

async function ratingState(t: T, photoId: Id<"photos">) {
  return await t.run(async (ctx) => {
    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_photo", (q) => q.eq("photoId", photoId))
      .collect();
    const photo = await ctx.db.get(photoId);
    return {
      raters: ratings.map((r) => r.userId).sort(),
      count: photo?.ratingCount,
      average: photo?.ratingAverage,
    };
  });
}

/** Een tweede groep met Olga en Rex, waarin P ook staat. */
async function alsoInOtherGroup(t: T, w: Awaited<ReturnType<typeof world>>) {
  const other = await t.run(async (ctx) => {
    const now = Date.now();
    const gid = await ctx.db.insert("groups", { name: "Ander", createdBy: w.users.olga!, createdAt: now });
    await ctx.db.insert("memberships", { userId: w.users.olga!, groupId: gid, role: "admin", joinedAt: now });
    await ctx.db.insert("memberships", { userId: w.users.rex!, groupId: gid, role: "member", joinedAt: now });
    return gid;
  });
  const B = await seedAlbum(t, other, w.users.olga!, "B");
  await publish(t, B, w.P);
}

const DEPARTURES = [
  ["verwijderd door een admin", "user_anna"],
  ["zelf vertrokken", "user_rex"],
] as const;

describe.each(DEPARTURES)("A-invariant 7 (R1): Rex %s", (_label, actor) => {
  async function leave(t: T, w: Awaited<ReturnType<typeof world>>) {
    await as(t, actor).mutation(api.groups.removeMember, { groupId: w.groupId, userId: w.users.rex! });
  }

  it("zijn rating op een foto die hij niet meer ziet, is weg; het gemiddelde telt hem niet meer", async () => {
    const t = newT();
    const w = await world(t);
    await leave(t, w);
    expect(await ratingState(t, w.P)).toEqual({ raters: [w.users.mia], count: 1, average: 5 });
  });

  it("ziet hij de foto nog via een andere groep, dan blijft zijn rating", async () => {
    const t = newT();
    const w = await world(t);
    await alsoInOtherGroup(t, w);
    await leave(t, w);
    expect((await ratingState(t, w.P)).raters).toEqual([w.users.mia, w.users.rex].sort());
  });

  it("zijn rating op een eigen foto blijft (de eigenaar ziet zijn foto altijd)", async () => {
    const t = newT();
    const w = await world(t);
    const own = await seedPhoto(t, w.users.rex!);
    await seedRating(t, own, w.users.rex!, 4);
    await leave(t, w);
    expect(await ratingState(t, own)).toEqual({ raters: [w.users.rex], count: 1, average: 4 });
  });
});

describe("A-invariant 7 (R1): Rex verwijdert zijn account", () => {
  it("zijn ratings zijn weg; het gemiddelde klopt", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_rex").mutation(api.users.deleteSelf, {});
    expect(await ratingState(t, w.P)).toEqual({ raters: [w.users.mia], count: 1, average: 5 });
  });
});

describe("S2: groep verwijderen haalt ratings weg van wie de foto daarna niet meer ziet", () => {
  it("de ratings van Rex en Mia op de foto van Olga zijn weg; die van Olga zelf blijft", async () => {
    const t = newT();
    const w = await world(t);
    await seedRating(t, w.P, w.users.olga!, 3);
    await as(t, "user_olga").mutation(api.groups.remove, { groupId: w.groupId });
    expect(await ratingState(t, w.P)).toEqual({ raters: [w.users.olga], count: 1, average: 3 });
  });

  it("wie de foto via een andere groep nog ziet, houdt zijn rating", async () => {
    const t = newT();
    const w = await world(t);
    await alsoInOtherGroup(t, w);
    await as(t, "user_olga").mutation(api.groups.remove, { groupId: w.groupId });
    expect(await ratingState(t, w.P)).toEqual({ raters: [w.users.rex], count: 1, average: 1 });
  });
});

describe("S2: het laatste lid gaat weg (M2-e), met een rating van vóór WP28", () => {
  // Na R1 kan er bij het laatste lid alleen nog een rating van een ex-lid van
  // vóór WP28 over zijn (migratie-erfenis): Eve was ooit lid en gaf een
  // rating op een foto van Kees, die er ook niet meer in zit maar wiens foto
  // in het album bleef. De groep-cascade ruimt die op.
  it("de achtergebleven rating van Eve is weg; die van Kees op zijn eigen foto blijft", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga", outsiders: ["eve", "kees"] });
    const A = await seedAlbum(t, w.groupId, w.users.olga!, "A");
    const Q = await seedPhoto(t, w.users.kees!);
    await publish(t, A, Q);
    await seedRating(t, Q, w.users.eve!, 2);
    await seedRating(t, Q, w.users.kees!, 4);

    await as(t, "user_olga").mutation(api.users.deleteSelf, {});

    expect(await ratingState(t, Q)).toEqual({ raters: [w.users.kees], count: 1, average: 4 });
  });
});
