import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { newT, type T } from "../videos/_videos";
import {
  advance,
  asFilm,
  expectCode,
  filmApi,
  MINUTE_MS,
  newVideoInX,
  outcome,
  seedFilmWorld,
  sendOriginal,
  useFilmEnv,
  type FilmWorld,
} from "./_film";

// Besluit 28 (Wouter, 2026-11-25, build 93): start de oprichter een
// filmproject in een groep zonder album, dan maakt `filmProjects.open` in
// dezelfde mutation een leeg album met de titel van het project. Het album is
// een gewoon album, zoals `albums.create` het maakt: maker de oprichter, de
// (getrimde) titel als naam, geen omschrijving, cover of eigen datum, nu
// gemaakt. Leden zien het in de groep, zonder ongelezen foto's. Heeft de groep
// al een album, dan komt er niets bij. Weigert `open` (titel, datum, al een
// open project, niet de oprichter, geen lid), dan komt er ook geen album.
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Besluit 28 (A).

const env = useFilmEnv();
const DAY = 24 * 60 * 60 * 1000;

/** Een groep "Leeg" zonder albums: alice oprichter en admin, erik admin, bob lid. */
async function emptyGroup(t: T, w: FilmWorld): Promise<Id<"groups">> {
  return await t.run(async (ctx) => {
    const g = await ctx.db.insert("groups", { name: "Leeg", createdBy: w.users.alice, createdAt: Date.now() });
    await ctx.db.insert("memberships", { groupId: g, userId: w.users.alice, role: "admin", joinedAt: Date.now() });
    await ctx.db.insert("memberships", { groupId: g, userId: w.users.erik, role: "admin", joinedAt: Date.now() });
    await ctx.db.insert("memberships", { groupId: g, userId: w.users.bob, role: "member", joinedAt: Date.now() });
    return g;
  });
}

async function albumsIn(t: T, groupId: Id<"groups">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("albums")
      .filter((q) => q.eq(q.field("groupId"), groupId))
      .collect(),
  );
}

describe("een project in een groep zonder album (besluit 28)", () => {
  it("maakt een leeg album met de titel; maker de oprichter, nu gemaakt, verder niets", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const g = await emptyGroup(t, w);
    advance(MINUTE_MS);
    const now = Date.now();
    await asFilm.alice(t).mutation(filmApi.open, { groupId: g, title: "  Zomerreis  ", endsAt: now + 14 * DAY });
    const albums = await albumsIn(t, g);
    expect(albums).toHaveLength(1);
    const a = albums[0]!;
    expect(a).toMatchObject({ groupId: g, name: "Zomerreis", createdBy: w.users.alice, createdAt: now });
    expect(a.description).toBeUndefined();
    expect(a.coverPhotoId).toBeUndefined();
    expect(a.sortDate).toBeUndefined();
    // Er staat niets in.
    const placed = await t.run(async (ctx) =>
      ctx.db
        .query("albumPhotos")
        .filter((q) => q.eq(q.field("albumId"), a._id))
        .collect(),
    );
    expect(placed).toEqual([]);
  });

  it("leden zien het album in de groep, zonder ongelezen foto's", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const g = await emptyGroup(t, w);
    await asFilm.alice(t).mutation(filmApi.open, { groupId: g, title: "Zomerreis", endsAt: Date.now() + 14 * DAY });
    const seen = await asFilm.bob(t).query(api.albums.listByGroupWithUnread, { groupId: g });
    expect(seen.map((a) => [a.name, a.unreadCount])).toEqual([["Zomerreis", 0]]);
  });

  it("de oprichter kan het album daarna gewoon wijzigen; titel en album staan los van elkaar", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const g = await emptyGroup(t, w);
    const projectId = await asFilm.alice(t).mutation(filmApi.open, { groupId: g, title: "Zomerreis", endsAt: Date.now() + 14 * DAY });
    const [a] = await albumsIn(t, g);
    await asFilm.alice(t).mutation(api.albums.update, { albumId: a!._id, name: "Dag 1" });
    expect((await asFilm.bob(t).query(filmApi.get, { projectId })).project.title).toBe("Zomerreis");
    await asFilm.alice(t).mutation(filmApi.setTitle, { projectId, title: "Zomer" });
    expect((await albumsIn(t, g)).map((x) => x.name)).toEqual(["Dag 1"]);
  });

  it("een nieuw filmpje in dat album levert een origineel (besluit 27.2)", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const g = await emptyGroup(t, w);
    const projectId = await asFilm.alice(t).mutation(filmApi.open, { groupId: g, title: "Zomerreis", endsAt: Date.now() + 14 * DAY });
    const [a] = await albumsIn(t, g);
    const photoId = await newVideoInX(t, env.r2, w, w.users.bob, { albumId: a!._id });
    const originalId = await sendOriginal(asFilm.bob(t), env.orig, photoId);
    expect((await asFilm.alice(t).query(filmApi.get, { projectId })).originals.map((o) => o.originalId)).toEqual([originalId]);
  });
});

describe("geen album erbij (besluit 28)", () => {
  it("de groep heeft al een album: niets erbij", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const before = (await albumsIn(t, w.groups.reis)).map((a) => a._id).sort();
    await asFilm.alice(t).mutation(filmApi.open, { groupId: w.groups.reis, title: "Clubfilm Reis", endsAt: Date.now() + DAY });
    expect((await albumsIn(t, w.groups.reis)).map((a) => a._id).sort()).toEqual(before);
  });

  it("een tweede project na sluiten, in de groep die nu het album van het eerste heeft: niets erbij", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const g = await emptyGroup(t, w);
    const first = await asFilm.alice(t).mutation(filmApi.open, { groupId: g, title: "Eerste", endsAt: Date.now() + DAY });
    await asFilm.alice(t).mutation(filmApi.close, { projectId: first });
    await asFilm.alice(t).mutation(filmApi.open, { groupId: g, title: "Tweede", endsAt: Date.now() + DAY });
    expect((await albumsIn(t, g)).map((a) => a.name)).toEqual(["Eerste"]);
  });

  it.each([
    ["een titel die niet kan", "NAME_REQUIRED", { title: "   " }],
    ["een einddatum die niet kan", "DATE_INVALID", { endsAt: -1 }],
  ] as const)("%s: %s, geen project en geen album", async (_name, code, extra) => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const g = await emptyGroup(t, w);
    const args = { groupId: g, title: "Zomerreis", endsAt: Date.now() + DAY, ...extra };
    expectCode(await outcome(() => asFilm.alice(t).mutation(filmApi.open, args)), code);
    expect(await albumsIn(t, g)).toEqual([]);
    expect(await asFilm.alice(t).query(filmApi.listForGroup, { groupId: g })).toEqual([]);
  });

  it("al een open project (zonder album, bv. van vóór besluit 28): PROJECT_ALREADY_OPEN, geen album", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const g = await emptyGroup(t, w);
    await t.run(async (ctx) => {
      await ctx.db.insert("filmProjects", { groupId: g, title: "Oud", endsAt: Date.now() + DAY, openedAt: Date.now() } as never);
    });
    expectCode(await outcome(() => asFilm.alice(t).mutation(filmApi.open, { groupId: g, title: "Nieuw", endsAt: Date.now() + DAY })), "PROJECT_ALREADY_OPEN");
    expect(await albumsIn(t, g)).toEqual([]);
  });

  it("niet de oprichter (admin of lid): NOT_ALLOWED; wie geen lid is: NOT_MEMBER; nooit een album", async () => {
    const t = newT();
    const w = await seedFilmWorld(t);
    const g = await emptyGroup(t, w);
    const args = { groupId: g, title: "Zomerreis", endsAt: Date.now() + DAY };
    expectCode(await outcome(() => asFilm.erik(t).mutation(filmApi.open, args)), "NOT_ALLOWED");
    expectCode(await outcome(() => asFilm.bob(t).mutation(filmApi.open, args)), "NOT_ALLOWED");
    expectCode(await outcome(() => asFilm.dave(t).mutation(filmApi.open, args)), "NOT_MEMBER");
    expect(await albumsIn(t, g)).toEqual([]);
  });
});
