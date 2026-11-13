import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  albumRow,
  as,
  groupRow,
  newT,
  publish,
  seedAlbum,
  seedGroup,
  seedPhoto,
  type T,
} from "./_beheer";

// WP28 — A-invariant 3 en invariant 5: een publicatie die verdwijnt, neemt
// de cover mee (de ratings vielen weg met WP19a), langs elke weg, zoals
// `albums.removePhoto` (AP4).
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

// Lid weg: door een admin verwijderd, of zelf vertrokken. Zijn foto's gaan uit
// de albums van de groep (M1); covers volgen (AP4).
const DEPARTURES = [
  ["verwijderd door een admin", "user_anna"],
  ["zelf vertrokken", "user_lex"],
] as const;

describe.each(DEPARTURES)("lid weg (%s): covers volgen zijn foto's", (_label, actor) => {
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
});
