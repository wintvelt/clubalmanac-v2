import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, asGhost, gonePhotoId, newT, outcome, seedWorld, type R, type T, type World } from "./_world";

// WP17c — `albums.listForPhoto`, "in welke albums" in het foto-detail.
// Spec: docs/work-packages/WP17c-mijn-fotos.md, invariant 4 en 5, A-invariant
// 9 en 10, open vraag 3 (voor elke foto, ook van een ander).

const KEYS = ["albumId", "albumName", "groupId", "groupName"];

function sorted(list: R[]): R[] {
  return [...list].sort((a, b) => (a.albumId < b.albumId ? -1 : a.albumId > b.albumId ? 1 : 0));
}

async function list(t: T, key: string, photoId: Id<"photos">): Promise<R[]> {
  return sorted((await as(t, key).query(api.albums.listForPhoto, { photoId })) as R[]);
}

function entry(w: World, album: keyof World["albums"]): R {
  const names: Record<keyof World["albums"], [string, keyof World["groups"], string]> = {
    A1: ["Zomer", "G1", "Club"],
    A1b: ["Winter", "G1", "Club"],
    A2: ["Ver", "G2", "Ander"],
    A3: ["Feest", "G3", "Derde"],
  };
  const [albumName, g, groupName] = names[album];
  return { albumId: w.albums[album], albumName, groupId: w.groups[g], groupName };
}

describe("toegang", () => {
  it("niet ingelogd en een identity zonder users-rij: weigering", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(t.query(api.albums.listForPhoto, { photoId: w.photos.pa1 })).rejects.toThrow();
    await expect(asGhost(t).query(api.albums.listForPhoto, { photoId: w.photos.pa1 })).rejects.toThrow();
  });

  it("geen foto-toegang, een gewiste foto: dezelfde NOT_MEMBER (geen orakel)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await gonePhotoId(t, w.users.alice);
    const noAccess = await outcome(() => as(t, "carol").query(api.albums.listForPhoto, { photoId: w.photos.pa1 }));
    const missing = await outcome(() => as(t, "carol").query(api.albums.listForPhoto, { photoId: gone }));
    expect(noAccess).toEqual({ code: "NOT_MEMBER" });
    expect(missing).toEqual(noAccess);
  });

  it("de eigen foto van een ander buiten een album: NOT_MEMBER", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expect(await outcome(() => as(t, "alice").query(api.albums.listForPhoto, { photoId: w.photos.pb2 }))).toEqual({
      code: "NOT_MEMBER",
    });
  });
});

describe("A-invariant 9: alleen albums uit je eigen groepen, precies deze velden", () => {
  it("eigen foto in twee groepen van de eigenaar: beide albums, met naam en groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const res = await list(t, "alice", w.photos.pa2);
    expect(res).toEqual(sorted([entry(w, "A1"), entry(w, "A3")]));
    for (const r of res) expect(Object.keys(r).sort()).toEqual(KEYS);
  });

  it("andermans foto (open vraag 3): alleen het album uit de groep van de kijker", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expect(await list(t, "bob", w.photos.pa2)).toEqual([entry(w, "A1")]);
    expect(await list(t, "carol", w.photos.pa2)).toEqual([entry(w, "A3")]);
    expect(await list(t, "alice", w.photos.pc1)).toEqual([entry(w, "A3")]);
  });

  it("het antwoord is gelijk, ongeacht hoeveel albums van andere groepen de foto heeft", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const before = await list(t, "bob", w.photos.pa2);
    // pa2 komt erbij in A2 (G2, geen lid: bob, alice) en in twee nieuwe albums
    // van G3 (bob geen lid). Rechtstreeks: het gaat om wat de read toont.
    await t.run(async (ctx) => {
      const now = Date.now();
      const extra = [
        w.albums.A2,
        await ctx.db.insert("albums", { groupId: w.groups.G3, name: "Geheim", createdBy: w.users.alice, createdAt: now }),
        await ctx.db.insert("albums", { groupId: w.groups.G3, name: "Nog een", createdBy: w.users.alice, createdAt: now }),
      ];
      for (const albumId of extra) {
        const a = await ctx.db.get(albumId);
        await ctx.db.insert("albumPhotos", {
          albumId,
          photoId: w.photos.pa2,
          groupId: a!.groupId,
          addedAt: now,
          addedBy: w.users.alice,
        });
      }
    });
    expect(await list(t, "bob", w.photos.pa2)).toEqual(before);
  });

  it("eigen foto in geen album: een lege lijst", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expect(await list(t, "alice", w.photos.pa3)).toEqual([]);
  });

  it("eigen foto in een album van een groep zonder lidmaatschap: een lege lijst", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expect(await list(t, "alice", w.photos.pa5)).toEqual([]);
  });

  it("een publicatie waarvan het album weg is, telt niet", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) => ctx.db.delete(w.albums.A3));
    expect(await list(t, "alice", w.photos.pa2)).toEqual([entry(w, "A1")]);
  });

  it("twee publicatie-rijen in hetzelfde album: het album één keer", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) =>
      ctx.db.insert("albumPhotos", {
        albumId: w.albums.A1,
        photoId: w.photos.pa1,
        groupId: w.groups.G1,
        addedAt: Date.now(),
        addedBy: w.users.alice,
      }),
    );
    expect(await list(t, "alice", w.photos.pa1)).toEqual([entry(w, "A1")]);
  });

  it("na toevoegen aan een album staat dat album erbij", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await as(t, "alice").mutation(api.albums.addPhoto, { albumId: w.albums.A1b, photoId: w.photos.pa1 });
    expect(await list(t, "alice", w.photos.pa1)).toEqual(sorted([entry(w, "A1"), entry(w, "A1b")]));
  });
});

describe("A-invariant 10: na vertrek staat het album van die groep er niet meer in", () => {
  it("andermans foto: daarna NOT_MEMBER; eigen foto: daarna een lege lijst", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expect(await list(t, "bob", w.photos.pa1)).toEqual([entry(w, "A1")]);
    expect(await list(t, "bob", w.photos.pb1)).toEqual([entry(w, "A1")]);
    // Alleen het lidmaatschap weg: de read moet zelf op het lidmaatschap letten,
    // niet op de cascade van vertrek.
    await t.run(async (ctx) => {
      const m = await ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) => q.eq("userId", w.users.bob).eq("groupId", w.groups.G1))
        .unique();
      await ctx.db.delete(m!._id);
    });
    expect(await outcome(() => as(t, "bob").query(api.albums.listForPhoto, { photoId: w.photos.pa1 }))).toEqual({
      code: "NOT_MEMBER",
    });
    expect(await list(t, "bob", w.photos.pb1)).toEqual([]);
  });
});
