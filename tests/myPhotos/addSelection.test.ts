import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { selectionPlan } from "../../app/src/lib/photoActions";
import { as, newT, seedWorld, type T } from "./_world";

// WP17c invariant 3 en A-invariant 11: toevoegen aan een album, per foto.
// Het plan van de app (selectionPlan met "addToAlbum") is nooit ruimer dan
// `albums.addPhoto`, en voor een foto die de app laat gaan, is de weigering
// "staat er al in" de enige die geen fout is. Het orakel is de backend zelf.
//
// De app leest de code met zijn eigen ConvexError (app/node_modules); dat
// pint app/tests/myPhotos.test.ts (addOutcome). Hier de codes van de backend.
// Spec: docs/work-packages/WP17c-mijn-fotos.md.

async function codeOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    expect(e, `verwacht een ConvexError, kreeg: ${String(e)}`).toBeInstanceOf(ConvexError);
    return (e as ConvexError<{ code: string }>).data.code;
  }
}

async function rowsIn(t: T, albumId: Id<"albums">, photoId: Id<"photos">): Promise<number> {
  return await t.run(async (ctx) =>
    (
      await ctx.db
        .query("albumPhotos")
        .withIndex("by_album", (q) => q.eq("albumId", albumId))
        .collect()
    ).filter((r) => r.photoId === photoId).length,
  );
}

describe("A-invariant 11: het plan klopt met addPhoto", () => {
  for (const role of ["admin", "member"] as const) {
    it(`als ${role}: eigen foto's mogen, andermans foto niet, en de backend zegt hetzelfde`, async () => {
      const t = newT();
      const w = await seedWorld(t);
      const key = role === "admin" ? "alice" : "bob";
      const me = w.users[key];
      const items = [
        { photoId: w.photos.pa3, ownerId: w.users.alice, addedBy: "" },
        { photoId: w.photos.pb2, ownerId: w.users.bob, addedBy: "" },
        { photoId: w.photos.pb1, ownerId: w.users.bob, addedBy: w.users.bob },
        { photoId: w.photos.pa1, ownerId: w.users.alice, addedBy: w.users.alice },
      ];
      const plan = selectionPlan("addToAlbum", items, { me, role });

      for (const photoId of plan.notAllowed) {
        expect(await codeOf(() => as(t, key).mutation(api.albums.addPhoto, { albumId: w.albums.A1b, photoId }))).toBe(
          "NOT_PHOTO_OWNER",
        );
      }
      for (const photoId of plan.allowed) {
        expect(await codeOf(() => as(t, key).mutation(api.albums.addPhoto, { albumId: w.albums.A1b, photoId }))).toBeNull();
      }
      const own = items.filter((i) => i.ownerId === me).map((i) => i.photoId);
      expect([...plan.allowed].sort()).toEqual([...own].sort());
    });
  }
});

describe("invariant 3: een foto die er al in staat, wordt overgeslagen en niet dubbel", () => {
  it("ALREADY_IN_ALBUM, en het album houdt één rij", async () => {
    const t = newT();
    const w = await seedWorld(t);
    expect(
      await codeOf(() => as(t, "alice").mutation(api.albums.addPhoto, { albumId: w.albums.A1, photoId: w.photos.pa1 })),
    ).toBe("ALREADY_IN_ALBUM");
    expect(await rowsIn(t, w.albums.A1, w.photos.pa1)).toBe(1);
  });

  it("een selectie met een foto die er al in staat: de rest komt erin, niets dubbel", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const selection = [w.photos.pa1, w.photos.pa2, w.photos.pa3, w.photos.pa4];
    const codes: Array<string | null> = [];
    for (const photoId of selection) {
      codes.push(await codeOf(() => as(t, "alice").mutation(api.albums.addPhoto, { albumId: w.albums.A1, photoId })));
    }
    expect(codes).toEqual(["ALREADY_IN_ALBUM", "ALREADY_IN_ALBUM", null, null]);
    for (const photoId of selection) expect(await rowsIn(t, w.albums.A1, photoId)).toBe(1);
  });
});

describe("edge cases: wat de app als mislukt telt", () => {
  it("album weg tijdens de keuze: NOT_MEMBER voor elke foto", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) => ctx.db.delete(w.albums.A1b));
    for (const photoId of [w.photos.pa1, w.photos.pa3]) {
      expect(await codeOf(() => as(t, "alice").mutation(api.albums.addPhoto, { albumId: w.albums.A1b, photoId }))).toBe(
        "NOT_MEMBER",
      );
    }
  });

  it("foto gewist tijdens het toevoegen: een weigering, en geen rij", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await as(t, "alice").mutation(api.photos.remove, { photoId: w.photos.pa3 });
    const code = await codeOf(() =>
      as(t, "alice").mutation(api.albums.addPhoto, { albumId: w.albums.A1b, photoId: w.photos.pa3 }),
    );
    expect(code).not.toBeNull();
    expect(code).not.toBe("ALREADY_IN_ALBUM");
    expect(await rowsIn(t, w.albums.A1b, w.photos.pa3)).toBe(0);
  });
});
