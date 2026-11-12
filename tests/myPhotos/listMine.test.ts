import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, asGhost, idsOf, loadAll, newT, seedWorld, type R } from "./_world";

// WP17c — `photos.listMine`, de read achter Mijn foto's.
// Spec: docs/work-packages/WP17c-mijn-fotos.md, invariant 1, 5 en A-invariant
// 7, 8; A-keuze 1 (nieuwste upload eerst) en A-keuze 2 (schakelaar "Niet in
// een album").

const FIRST = { numItems: 50, cursor: null };

describe("invariant 1 en A-invariant 7: alleen je eigen foto's", () => {
  it("niet ingelogd en een identity zonder users-rij: weigering", async () => {
    const t = newT();
    await seedWorld(t);
    await expect(t.query(api.photos.listMine, { paginationOpts: FIRST })).rejects.toThrow();
    await expect(asGhost(t).query(api.photos.listMine, { paginationOpts: FIRST })).rejects.toThrow();
  });

  it("al je foto's: in een album, in geen album, gemeld, en in een album van een groep zonder lidmaatschap", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { items } = await loadAll(t, "alice", 50);
    const p = w.photos;
    expect(idsOf(items).sort()).toEqual([p.pa1, p.pa2, p.pa3, p.pa4, p.pa5].sort());
  });

  it("nooit de foto van een ander, ook niet uit een gedeeld album", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { items } = await loadAll(t, "bob", 50);
    expect(idsOf(items).sort()).toEqual([w.photos.pb1, w.photos.pb2].sort());
    for (const item of items) expect(item.ownerId).toBe(w.users.bob);
  });

  it("de read neemt geen user-id aan", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(
      as(t, "alice").query(api.photos.listMine, {
        paginationOpts: FIRST,
        ownerId: w.users.bob,
      } as never),
    ).rejects.toThrow();
  });

  it("een gewiste foto staat er niet meer in", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await as(t, "alice").mutation(api.photos.remove, { photoId: w.photos.pa3 });
    const { items } = await loadAll(t, "alice", 50);
    expect(idsOf(items)).not.toContain(w.photos.pa3);
  });

  it("een user zonder foto's krijgt een lege, afgeronde pagina", async () => {
    const t = newT();
    await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        subject: "user_dora",
        email: "dora@x.test",
        name: "dora",
        photoCount: 0,
        photoLimit: 1000,
        createdAt: Date.now(),
      });
    });
    const res = (await as(t, "dora").query(api.photos.listMine, { paginationOpts: FIRST })) as R;
    expect(res.page).toEqual([]);
    expect(res.isDone).toBe(true);
  });
});

describe("invariant 5: de foto-vorm, geen storageId", () => {
  it("elke foto heeft precies dezelfde velden als photos.getById", async () => {
    const t = newT();
    await seedWorld(t);
    const { items } = await loadAll(t, "alice", 50);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const single = (await as(t, "alice").query(api.photos.getById, { photoId: item._id })) as R;
      expect(item).toEqual(single);
      for (const secret of ["storageId", "formats", "filename", "mimeType", "latitude", "longitude", "flaggedBy", "flagReason"]) {
        expect(item, `${secret} in Mijn foto's`).not.toHaveProperty(secret);
      }
    }
  });
});

describe("A-invariant 8: bladeren is volledig", () => {
  it("pagina's van 2: elke eigen foto precies één keer, geen pagina groter dan gevraagd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { items, pages } = await loadAll(t, "alice", 2);
    expect(pages).toBeGreaterThanOrEqual(3);
    const ids = idsOf(items);
    expect(new Set(ids).size).toBe(ids.length);
    const p = w.photos;
    expect([...ids].sort()).toEqual([p.pa1, p.pa2, p.pa3, p.pa4, p.pa5].sort());
  });
});

describe("A-keuze 1: nieuwste upload eerst, één lijst", () => {
  it("de volgorde is op uploaddatum, nieuwste eerst, over de pagina's heen", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { items } = await loadAll(t, "alice", 2);
    const p = w.photos;
    expect(idsOf(items)).toEqual([p.pa5, p.pa4, p.pa3, p.pa2, p.pa1]);
  });

  it("de uploaddatum telt, niet het moment waarop de rij is gemaakt (migratie)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // pa1 is als eerste rij gemaakt, maar heeft de nieuwste uploaddatum.
    await t.run(async (ctx) => ctx.db.patch(w.photos.pa1, { createdAt: Date.UTC(2030, 0, 1) }));
    const { items } = await loadAll(t, "alice", 2);
    const p = w.photos;
    expect(idsOf(items)).toEqual([p.pa1, p.pa5, p.pa4, p.pa3, p.pa2]);
  });

  it("de opnamedatum telt niet mee", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // pa1 is de oudste upload, maar krijgt de nieuwste opnamedatum.
    await t.run(async (ctx) => ctx.db.patch(w.photos.pa1, { takenAt: Date.UTC(2030, 0, 1) }));
    const { items } = await loadAll(t, "alice", 50);
    expect(idsOf(items).at(-1)).toBe(w.photos.pa1);
  });

  it("een foto in twee albums staat er één keer in", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { items } = await loadAll(t, "alice", 50);
    expect(idsOf(items).filter((id) => id === w.photos.pa2)).toHaveLength(1);
  });

  it("dezelfde uploaddatum: elke foto één keer, in een vaste volgorde", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) => {
      for (const id of Object.values(w.photos)) await ctx.db.patch(id, { createdAt: Date.UTC(2024, 5, 1) });
    });
    const first = idsOf((await loadAll(t, "alice", 2)).items);
    const second = idsOf((await loadAll(t, "alice", 3)).items);
    expect(new Set(first).size).toBe(5);
    expect(second).toEqual(first);
  });
});

describe("A-keuze 2: schakelaar \"Niet in een album\"", () => {
  it("alleen je foto's die in geen enkel album staan", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { items } = await loadAll(t, "alice", 50, { withoutAlbum: true });
    expect(idsOf(items)).toEqual([w.photos.pa4, w.photos.pa3]);
  });

  it("bladerend, met pagina's van 1: dezelfde foto's, elk één keer", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { items } = await loadAll(t, "alice", 1, { withoutAlbum: true });
    expect(idsOf(items)).toEqual([w.photos.pa4, w.photos.pa3]);
  });

  it("uit: alle foto's", async () => {
    const t = newT();
    await seedWorld(t);
    const { items } = await loadAll(t, "alice", 50, { withoutAlbum: false });
    expect(items).toHaveLength(5);
  });

  it("na toevoegen aan een album valt de foto uit de schakelaar; na uit album halen komt hij terug", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await as(t, "alice").mutation(api.albums.addPhoto, { albumId: w.albums.A1, photoId: w.photos.pa3 });
    expect(idsOf((await loadAll(t, "alice", 50, { withoutAlbum: true })).items)).toEqual([w.photos.pa4]);
    await as(t, "alice").mutation(api.albums.removePhoto, { albumId: w.albums.A1, photoId: w.photos.pa3 });
    expect(idsOf((await loadAll(t, "alice", 50, { withoutAlbum: true })).items)).toEqual([
      w.photos.pa4,
      w.photos.pa3,
    ]);
  });

  it("nooit de foto van een ander", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const { items } = await loadAll(t, "bob", 50, { withoutAlbum: true });
    expect(idsOf(items)).toEqual([w.photos.pb2]);
  });
});
