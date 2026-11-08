import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  albumRow,
  as,
  groupRow,
  newT,
  publish,
  seedAlbum,
  seedGroup,
  seedPhoto,
  seedRating,
  type T,
} from "./_beheer";

// WP28 — A-invariant 3 en invariant 5: een publicatie die verdwijnt, neemt
// cover en ratings mee, langs elke weg, zoals `albums.removePhoto` (AP3, AP4).
// In v1 liep elke weggehaalde publicatie via de stream door
// groupPhotoDelToCover en groupPhotoDelToRating, ook bij album weg en lid weg
// (spec kernvondst 3).
//
// Wereld: oprichter Olga, admin Anna, lid Lex; albums A en B in de groep.
// Album verwijderen doet de oprichter (los van W5).

async function world(t: T) {
  const w = await seedGroup(t, { founder: "olga", members: { anna: "admin", lex: "member" } });
  const A = await seedAlbum(t, w.groupId, w.users.olga!, "A");
  const B = await seedAlbum(t, w.groupId, w.users.olga!, "B");
  return { ...w, A, B };
}

async function ratingsOn(t: T, photoId: Id<"photos">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("ratings")
      .withIndex("by_photo", (q) => q.eq("photoId", photoId))
      .collect(),
  );
}

async function photoRow(t: T, photoId: Id<"photos">) {
  return await t.run(async (ctx) => ctx.db.get(photoId));
}

describe("invariant 5 — album verwijderen wist de groepscover als die foto nergens meer in de groep staat", () => {
  it("cover alleen in het gewiste album: de groep heeft daarna geen cover", async () => {
    const t = newT();
    const w = await world(t);
    const P = await seedPhoto(t, w.users.anna!);
    await publish(t, w.A, P);
    await t.run(async (ctx) => ctx.db.patch(w.groupId, { coverPhotoId: P }));

    await as(t, "user_olga").mutation(api.albums.remove, { albumId: w.A });

    expect((await groupRow(t, w.groupId))?.coverPhotoId).toBeUndefined();
  });

  it("cover staat ook in een ander album van de groep: de cover blijft", async () => {
    const t = newT();
    const w = await world(t);
    const P = await seedPhoto(t, w.users.anna!);
    await publish(t, w.A, P);
    await publish(t, w.B, P);
    await t.run(async (ctx) => ctx.db.patch(w.groupId, { coverPhotoId: P }));

    await as(t, "user_olga").mutation(api.albums.remove, { albumId: w.A });

    expect((await groupRow(t, w.groupId))?.coverPhotoId).toBe(P);
  });

  it("een cover uit een ander album blijft staan", async () => {
    const t = newT();
    const w = await world(t);
    const P = await seedPhoto(t, w.users.anna!);
    const Q = await seedPhoto(t, w.users.anna!);
    await publish(t, w.A, P);
    await publish(t, w.B, Q);
    await t.run(async (ctx) => ctx.db.patch(w.groupId, { coverPhotoId: Q }));

    await as(t, "user_olga").mutation(api.albums.remove, { albumId: w.A });

    expect((await groupRow(t, w.groupId))?.coverPhotoId).toBe(Q);
  });
});

describe("A-invariant 3 — album verwijderen haalt ratings weg van wie de foto niet meer mag zien", () => {
  it("de rating van een lid gaat weg, die van de eigenaar blijft, het gemiddelde klopt", async () => {
    const t = newT();
    const w = await world(t);
    const P = await seedPhoto(t, w.users.anna!);
    await publish(t, w.A, P);
    await seedRating(t, P, w.users.anna!, 4);
    await seedRating(t, P, w.users.lex!, 2);

    await as(t, "user_olga").mutation(api.albums.remove, { albumId: w.A });

    const left = await ratingsOn(t, P);
    expect(left.map((r) => r.userId)).toEqual([w.users.anna]);
    const p = await photoRow(t, P);
    expect(p?.ratingCount).toBe(1);
    expect(p?.ratingAverage).toBe(4);
  });

  it("staat de foto nog in een ander album van de groep, dan blijft de rating", async () => {
    const t = newT();
    const w = await world(t);
    const P = await seedPhoto(t, w.users.anna!);
    await publish(t, w.A, P);
    await publish(t, w.B, P);
    await seedRating(t, P, w.users.lex!, 2);

    await as(t, "user_olga").mutation(api.albums.remove, { albumId: w.A });

    expect((await ratingsOn(t, P)).map((r) => r.userId)).toEqual([w.users.lex]);
  });
});

// Lid weg: door een admin verwijderd, of zelf vertrokken. Zijn foto's gaan uit
// de albums van de groep (M1); covers en ratings volgen (AP4, AP3).
const DEPARTURES = [
  ["verwijderd door een admin", "user_anna"],
  ["zelf vertrokken", "user_lex"],
] as const;

describe.each(DEPARTURES)("lid weg (%s): covers en ratings volgen zijn foto's", (_label, actor) => {
  async function leave(t: T, w: Awaited<ReturnType<typeof world>>) {
    await as(t, actor).mutation(api.groups.removeMember, {
      groupId: w.groupId,
      userId: w.users.lex!,
    });
  }

  it("zijn foto was groepscover en albumcover: beide covers zijn weg", async () => {
    const t = newT();
    const w = await world(t);
    const P = await seedPhoto(t, w.users.lex!);
    await publish(t, w.A, P);
    await t.run(async (ctx) => {
      await ctx.db.patch(w.groupId, { coverPhotoId: P });
      await ctx.db.patch(w.A, { coverPhotoId: P });
    });

    await leave(t, w);

    expect((await groupRow(t, w.groupId))?.coverPhotoId).toBeUndefined();
    expect((await albumRow(t, w.A))?.coverPhotoId).toBeUndefined();
  });

  it("covers met een foto van een ander blijven staan", async () => {
    const t = newT();
    const w = await world(t);
    const mine = await seedPhoto(t, w.users.lex!);
    const annas = await seedPhoto(t, w.users.anna!);
    await publish(t, w.A, mine);
    await publish(t, w.A, annas);
    await t.run(async (ctx) => {
      await ctx.db.patch(w.groupId, { coverPhotoId: annas });
      await ctx.db.patch(w.A, { coverPhotoId: annas });
    });

    await leave(t, w);

    expect((await groupRow(t, w.groupId))?.coverPhotoId).toBe(annas);
    expect((await albumRow(t, w.A))?.coverPhotoId).toBe(annas);
  });

  it("ratings van achterblijvers op zijn foto gaan weg; zijn eigen rating blijft; het gemiddelde klopt", async () => {
    const t = newT();
    const w = await world(t);
    const P = await seedPhoto(t, w.users.lex!);
    await publish(t, w.A, P);
    await seedRating(t, P, w.users.anna!, 5);
    await seedRating(t, P, w.users.lex!, 3);

    await leave(t, w);

    expect((await ratingsOn(t, P)).map((r) => r.userId)).toEqual([w.users.lex]);
    const p = await photoRow(t, P);
    expect(p?.ratingCount).toBe(1);
    expect(p?.ratingAverage).toBe(3);
  });

  it("wie de foto via een andere groep nog ziet, houdt zijn rating", async () => {
    const t = newT();
    const w = await world(t);
    const P = await seedPhoto(t, w.users.lex!);
    await publish(t, w.A, P);
    // Tweede groep met Lex en Anna, waar de foto ook staat.
    const other = await t.run(async (ctx) => {
      const now = Date.now();
      const gid = await ctx.db.insert("groups", { name: "Ander", createdBy: w.users.lex!, createdAt: now });
      await ctx.db.insert("memberships", { userId: w.users.lex!, groupId: gid, role: "admin", joinedAt: now });
      await ctx.db.insert("memberships", { userId: w.users.anna!, groupId: gid, role: "member", joinedAt: now });
      return gid;
    });
    const C = await seedAlbum(t, other, w.users.lex!, "C");
    await publish(t, C, P);
    await seedRating(t, P, w.users.anna!, 5);

    await leave(t, w);

    expect((await ratingsOn(t, P)).map((r) => r.userId)).toEqual([w.users.anna]);
  });
});
