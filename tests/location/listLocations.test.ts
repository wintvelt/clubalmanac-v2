import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import {
  A,
  FAR_SPOT,
  MIA_SPOT,
  OWEN_SPOT,
  refusal,
  round2,
  schema,
  world,
} from "./_world";

// WP17d A-invariant 1 en 5: de kaart-read `albums.listLocations({ albumId })`.
// Spec: docs/work-packages/WP17d-kaart-locatie-delen.md §Spec-criticus
// aanvullingen. Geeft per foto precies { photoId, latitude, longitude }.

type Spot = { photoId: string; latitude: number; longitude: number };

const byId = (rows: Spot[]) => new Map(rows.map((r) => [r.photoId, r]));

describe("albums.listLocations — wie mag de kaart zien (A-invariant 1)", () => {
  it("geen lid, onbekend en gewist album: exact dezelfde NOT_MEMBER", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const xena = withUser(t, "user_xena");
    const noMember = await refusal(xena.query(A.albums.listLocations, { albumId: w.A1 }));
    const deleted = await t.run(async (ctx) => {
      const id = await ctx.db.insert("albums", {
        groupId: w.H,
        name: "weg",
        createdBy: w.xena,
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    const unknown = await refusal(xena.query(A.albums.listLocations, { albumId: deleted }));
    expect(noMember).toEqual({ code: "NOT_MEMBER" });
    expect(unknown).toEqual(noMember);
  });

  it("uitgelogd: weigering, geen coördinaten", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await expect(t.query(A.albums.listLocations, { albumId: w.A1 })).rejects.toThrow();
  });

  it("na vertrek uit de groep: NOT_MEMBER", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const mia = withUser(t, "user_mia");
    expect(await mia.query(A.albums.listLocations, { albumId: w.A1 })).toHaveLength(2);
    await t.run(async (ctx) => {
      const m = await ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) => q.eq("userId", w.mia).eq("groupId", w.G))
        .unique();
      await ctx.db.delete(m!._id);
    });
    expect(await refusal(mia.query(A.albums.listLocations, { albumId: w.A1 }))).toEqual({
      code: "NOT_MEMBER",
    });
  });
});

describe("albums.listLocations — welke foto's (A-invariant 1)", () => {
  it("alleen foto's van dít album met beide coördinaten; elke foto één keer", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const rows = (await withUser(t, "user_owen").query(A.albums.listLocations, {
      albumId: w.A1,
    })) as Spot[];
    expect(rows.map((r) => r.photoId).sort()).toEqual([w.owenSpot, w.miaSpot].sort());
    // Niet: zonder plek, alleen een breedte, de gewiste foto, Owen-ver (A2), Xena (B1).
  });

  it("per foto precies photoId, latitude en longitude (whitelist, A-invariant 5)", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const rows = (await withUser(t, "user_mia").query(A.albums.listLocations, {
      albumId: w.A1,
    })) as Spot[];
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["latitude", "longitude", "photoId"]);
    }
  });

  it("een album zonder plekken: een lege lijst", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const empty = await withUser(t, "user_owen").mutation(A.albums.create, {
      groupId: w.G,
      name: "Leeg",
    });
    expect(await withUser(t, "user_owen").query(A.albums.listLocations, { albumId: empty })).toEqual([]);
  });

  it("de eigenaar ziet zijn eigen foto's exact", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const owen = withUser(t, "user_owen");
    const a1 = byId((await owen.query(A.albums.listLocations, { albumId: w.A1 })) as Spot[]);
    expect(a1.get(w.owenSpot)).toEqual({ photoId: w.owenSpot, ...OWEN_SPOT });
    const a2 = byId((await owen.query(A.albums.listLocations, { albumId: w.A2 })) as Spot[]);
    expect(a2.get(w.owenFar)).toEqual({ photoId: w.owenFar, ...FAR_SPOT });
  });

  it("na weghalen verdwijnt de foto van de kaart", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await withUser(t, "user_owen").mutation(A.photos.setLocation, {
      photoId: w.owenSpot,
      location: null,
    });
    const rows = (await withUser(t, "user_mia").query(A.albums.listLocations, {
      albumId: w.A1,
    })) as Spot[];
    expect(rows.map((r) => r.photoId)).toEqual([w.miaSpot]);
  });
});

describe("A-keuze 1: andere leden zien de plek afgerond op 2 decimalen", () => {
  it("Mia ziet Owens foto afgerond, haar eigen foto exact", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const rows = byId(
      (await withUser(t, "user_mia").query(A.albums.listLocations, { albumId: w.A1 })) as Spot[],
    );
    expect(rows.get(w.owenSpot)).toEqual({
      photoId: w.owenSpot,
      latitude: round2(OWEN_SPOT.latitude),
      longitude: round2(OWEN_SPOT.longitude),
    });
    expect(rows.get(w.miaSpot)).toEqual({ photoId: w.miaSpot, ...MIA_SPOT });
  });

  it("Owen ziet Mia's foto afgerond", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const rows = byId(
      (await withUser(t, "user_owen").query(A.albums.listLocations, { albumId: w.A1 })) as Spot[],
    );
    expect(rows.get(w.miaSpot)).toEqual({
      photoId: w.miaSpot,
      latitude: round2(MIA_SPOT.latitude),
      longitude: round2(MIA_SPOT.longitude),
    });
  });

  it("twee plekken binnen hetzelfde vak geven een ander lid exact dezelfde coördinaten", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    // Ca. 50 m van Owens plek, in hetzelfde vak van 0,01°.
    const near = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["x"]));
      const id = await ctx.db.insert("photos", {
        ownerId: w.owen,
        storageId,
        ratingCount: 0,
        createdAt: Date.now(),
        latitude: OWEN_SPOT.latitude + 0.0004,
        longitude: OWEN_SPOT.longitude - 0.0004,
      });
      await ctx.db.insert("albumPhotos", {
        albumId: w.A1,
        photoId: id,
        groupId: w.G,
        addedAt: Date.now(),
        addedBy: w.owen,
      });
      return id;
    });
    const rows = byId(
      (await withUser(t, "user_mia").query(A.albums.listLocations, { albumId: w.A1 })) as Spot[],
    );
    const a = rows.get(w.owenSpot)!;
    const b = rows.get(near)!;
    expect([b.latitude, b.longitude]).toEqual([a.latitude, a.longitude]);
  });

  it("negatieve coördinaten worden ook afgerond", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await t.run((ctx) => ctx.db.patch(w.owenSpot, { latitude: -33.868812, longitude: -151.209345 }));
    const rows = byId(
      (await withUser(t, "user_mia").query(A.albums.listLocations, { albumId: w.A1 })) as Spot[],
    );
    expect(rows.get(w.owenSpot)).toEqual({ photoId: w.owenSpot, latitude: -33.87, longitude: -151.21 });
  });
});
