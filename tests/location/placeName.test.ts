import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { schema, world } from "./_world";

// WP17d A-keuze 2: de plaatsnaam in de foto-vorm noemt geen straat en geen
// huisnummer. Bij drie of meer delen (gescheiden door " - ", ", " of " · ")
// alleen de laatste twee (plaats, land); met één of twee delen zoals hij is.
// Voor iedereen gelijk, ook de eigenaar. De data blijft gelijk (bij het lezen).
//
// Prod (kernvondst 1): 89 foto's hebben nu een plaatsnaam met huisnummer.

const CASES: [string, string][] = [
  ["8 Dorpsstraat - Ergens - Nederland", "Ergens - Nederland"],
  ["4A Torenstraat - Stad - Nederland", "Stad - Nederland"],
  ["Damrak, Amsterdam, Nederland", "Amsterdam, Nederland"],
  ["Brug van Vrede · Tbilisi · Tbilisi · Georgië", "Tbilisi · Georgië"],
  ["Ergens - Nederland", "Ergens - Nederland"],
  ["Amsterdam, Nederland", "Amsterdam, Nederland"],
  ["Georgië", "Georgië"],
];

describe("A-keuze 2: de plaatsnaam zonder straat en huisnummer", () => {
  it.each(CASES)("%s → %s, voor een lid en voor de eigenaar (photos.getById)", async (stored, shown) => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await t.run((ctx) => ctx.db.patch(w.owenSpot, { locationLabel: stored }));
    for (const who of ["user_mia", "user_owen"]) {
      const p = await withUser(t, who).query(api.photos.getById, { photoId: w.owenSpot });
      expect(p.locationLabel, who).toBe(shown);
    }
    // De data zelf blijft gelijk.
    expect((await t.run((ctx) => ctx.db.get(w.owenSpot)))?.locationLabel).toBe(stored);
  });

  it("ook in het album, het detail met eigenaar, Mijn foto's en de cover", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const mia = withUser(t, "user_mia");
    const owen = withUser(t, "user_owen");

    const album = await mia.query(api.albums.listPhotos, { albumId: w.A1 });
    const inAlbum = album.find((e) => e.albumPhoto.photoId === w.owenSpot);
    expect(inAlbum?.photo?.locationLabel).toBe("Ergens - Nederland");

    const detail = await mia.query(api.photos.getWithOwner, { photoId: w.owenSpot });
    expect(detail.locationLabel).toBe("Ergens - Nederland");

    const mine = await owen.query(api.photos.listMine, { paginationOpts: { numItems: 50, cursor: null } });
    expect(mine.page.find((p) => p._id === w.owenSpot)?.locationLabel).toBe("Ergens - Nederland");

    await owen.mutation(api.albums.update, { albumId: w.A1, coverPhotoId: w.owenSpot });
    const cover = await mia.query(api.albums.getWithCover, { albumId: w.A1 });
    expect(cover?.cover?.locationLabel).toBe("Ergens - Nederland");
  });

  it("zonder plaatsnaam: geen plaatsnaam", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const p = await withUser(t, "user_owen").query(api.photos.getById, { photoId: w.owenNoSpot });
    expect(p.locationLabel).toBeUndefined();
  });
});
