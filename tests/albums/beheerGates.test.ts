import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  albumRow,
  as,
  expectRefused,
  goneAlbumId,
  goneGroupId,
  groupRow,
  newT,
  publish,
  seedAlbum,
  seedGroup,
  seedPhoto,
  type T,
} from "../groups/_beheer";

// WP28 — albums maken en wijzigen (besluit 2), de datum (invariant 6), een
// verplichte naam (A-invariant 5) en de weigeringen van A-invariant 2.
// Besluit 5 (W5): album verwijderen alleen door de oprichter; wijzigen blijft
// admin. A-keuze 4: de albumcover weghalen met `coverPhotoId: null`.
//
// Wereld: oprichter Olga (admin), admin Anna, lid Lex, buitenstaander Eve.
// Album A is gemaakt door Lex (bijvoorbeeld uit de tijd dat elk lid mocht);
// dat geeft hem geen rechten: wijzigen en verwijderen zijn admin-acties
// (tabel §Acties, zoals v1; A-keuze 2).

async function world(t: T) {
  const w = await seedGroup(t, {
    founder: "olga",
    members: { anna: "admin", lex: "member" },
    outsiders: ["eve"],
  });
  const albumId = await seedAlbum(t, w.groupId, w.users.lex!, "A");
  return { ...w, albumId };
}

async function albumCount(t: T) {
  return await t.run(async (ctx) => (await ctx.db.query("albums").collect()).length);
}

describe("besluit 2 — album maken: alleen een admin", () => {
  it("een admin maakt een album", async () => {
    const t = newT();
    const w = await world(t);
    const id = await as(t, "user_anna").mutation(api.albums.create, { groupId: w.groupId, name: "Nieuw" });
    expect((await albumRow(t, id))?.name).toBe("Nieuw");
  });

  it("een lid: NOT_ALLOWED, geen album erbij", async () => {
    const t = newT();
    const w = await world(t);
    const before = await albumCount(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.albums.create, { groupId: w.groupId, name: "Nieuw" }),
    );
    expect(await albumCount(t)).toBe(before);
  });

  it("geen lid en onbekende groep: dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const gone = await goneGroupId(t);
    const a = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.albums.create, { groupId: w.groupId, name: "X" }),
    );
    const b = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.albums.create, { groupId: gone, name: "X" }),
    );
    expect(a).toEqual(b);
  });
});

describe("album wijzigen: admin", () => {
  it("een admin wijzigt de naam", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_anna").mutation(api.albums.update, { albumId: w.albumId, name: "B" });
    expect((await albumRow(t, w.albumId))?.name).toBe("B");
  });

  it("een lid: NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.albums.update, { albumId: w.albumId, name: "B" }),
    );
  });

  it("geen lid en onbekend album: dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const gone = await goneAlbumId(t, w.groupId, w.users.olga!);
    const a = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.albums.update, { albumId: w.albumId, name: "X" }),
    );
    const b = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.albums.update, { albumId: gone, name: "X" }),
    );
    expect(a).toEqual(b);
  });
});

describe("besluit 5 — album verwijderen: alleen de oprichter", () => {
  it("een admin die geen oprichter is: NOT_ALLOWED, het album blijft", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_anna").mutation(api.albums.remove, { albumId: w.albumId }),
    );
    expect(await albumRow(t, w.albumId)).not.toBeNull();
  });

  it("een lid: NOT_ALLOWED, het album blijft", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.albums.remove, { albumId: w.albumId }),
    );
    expect(await albumRow(t, w.albumId)).not.toBeNull();
  });

  it("geen lid en onbekend album: dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const gone = await goneAlbumId(t, w.groupId, w.users.olga!);
    const a = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.albums.remove, { albumId: w.albumId }),
    );
    const b = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.albums.remove, { albumId: gone }),
    );
    expect(a).toEqual(b);
  });

  it("de oprichter verwijdert het album", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_olga").mutation(api.albums.remove, { albumId: w.albumId });
    expect(await albumRow(t, w.albumId)).toBeNull();
  });
});

describe("invariant 6 — de datum van een groep en een album", () => {
  // Een gekozen dag, als UTC-middernacht (A-keuze 5): 14 juni 2019.
  const DAY = Date.UTC(2019, 5, 14);

  it("een admin zet de datum van de groep; de groep-read geeft hem terug", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_anna").mutation(api.groups.update, { groupId: w.groupId, sortDate: DAY });
    expect((await groupRow(t, w.groupId))?.sortDate).toBe(DAY);
    const read = await as(t, "user_lex").query(api.groups.getById, { groupId: w.groupId });
    expect(read?.sortDate).toBe(DAY);
  });

  it("een admin zet de datum van een album; de albumlijst geeft hem terug", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_anna").mutation(api.albums.update, { albumId: w.albumId, sortDate: DAY });
    expect((await albumRow(t, w.albumId))?.sortDate).toBe(DAY);
    const list = await as(t, "user_lex").query(api.albums.listByGroup, { groupId: w.groupId });
    expect(list.find((a) => a._id === w.albumId)?.sortDate).toBe(DAY);
  });

  it("alleen de datum wijzigen laat naam en omschrijving staan", async () => {
    const t = newT();
    const w = await world(t);
    await t.run(async (ctx) => ctx.db.patch(w.groupId, { description: "Sinds lang" }));
    await as(t, "user_olga").mutation(api.groups.update, { groupId: w.groupId, sortDate: DAY });
    const g = await groupRow(t, w.groupId);
    expect(g?.name).toBe("Club");
    expect(g?.description).toBe("Sinds lang");
  });

  it("een lid zet geen datum: NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.groups.update, { groupId: w.groupId, sortDate: DAY }),
    );
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.albums.update, { albumId: w.albumId, sortDate: DAY }),
    );
  });
});

describe("A-invariant 5 — een naam is verplicht", () => {
  const EMPTY = ["", "   "];

  it.each(EMPTY)("groep maken met naam %j: NAME_REQUIRED, geen groep", async (name) => {
    const t = newT();
    await seedGroup(t, { founder: "olga" });
    await expectRefused(t, "NAME_REQUIRED", () => as(t, "user_olga").mutation(api.groups.create, { name }));
  });

  it.each(EMPTY)("groep hernoemen naar %j: NAME_REQUIRED", async (name) => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NAME_REQUIRED", () =>
      as(t, "user_olga").mutation(api.groups.update, { groupId: w.groupId, name }),
    );
  });

  it.each(EMPTY)("album maken met naam %j: NAME_REQUIRED", async (name) => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NAME_REQUIRED", () =>
      as(t, "user_olga").mutation(api.albums.create, { groupId: w.groupId, name }),
    );
  });

  it.each(EMPTY)("album hernoemen naar %j: NAME_REQUIRED", async (name) => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NAME_REQUIRED", () =>
      as(t, "user_olga").mutation(api.albums.update, { albumId: w.albumId, name }),
    );
  });
});

describe("A-keuze 4 — de albumcover weghalen", () => {
  async function withCover(t: T) {
    const w = await world(t);
    const P = await seedPhoto(t, w.users.lex!);
    await publish(t, w.albumId, P);
    await t.run(async (ctx) => ctx.db.patch(w.albumId, { coverPhotoId: P }));
    return w;
  }

  it("een admin haalt de cover weg met coverPhotoId: null; de naam blijft", async () => {
    const t = newT();
    const w = await withCover(t);
    await as(t, "user_anna").mutation(api.albums.update, { albumId: w.albumId, coverPhotoId: null });
    const a = await albumRow(t, w.albumId);
    expect(a?.coverPhotoId).toBeUndefined();
    expect(a?.name).toBe("A");
  });

  it("een lid haalt de cover niet weg: NOT_ALLOWED", async () => {
    const t = newT();
    const w = await withCover(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.albums.update, { albumId: w.albumId, coverPhotoId: null }),
    );
  });
});
