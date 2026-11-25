import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { albumsByYear } from "../src/lib/groups";
import { groupDefaultAlbum, newestAlbum, type AlbumRow } from "../src/lib/lastAlbum";
import { plusParams } from "../src/lib/upload";

// Besluit 29 (Wouter, 2026-11-25, build 93): het standaard-album in het
// toevoegscherm volgt de groep.
//   1. Na het starten van een project wordt een album van die groep het
//      laatst gekozen album (WP39 F2): het album dat besluit 28 net maakte, of
//      anders het nieuwste album van die groep. In een groep zonder album is
//      het album van besluit 28 het enige, dus ook het nieuwste: `open` hoeft
//      geen album-id terug te geven.
//   2. De + in de tabbalk: vanuit een album (of een foto erin) dat album, zoals
//      nu. Op de groepspagina, de projectpagina en elk ander scherm onder de
//      groep gaat de groep mee; het toevoegscherm kiest dan het laatst gekozen
//      album als dat in die groep ligt, anders het nieuwste album van die
//      groep. Elders niets: het laatst gekozen album, zoals nu.
// A-keuze: "het nieuwste album" is het album bovenaan de groepspagina (de
// volgorde van `albumsByYear`: de datum van het album, dan de naam).
// Spec: docs/work-packages/WP38-filmproject-originelen.md §Besluit 29 (A).

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 25, 12, 0);

const album = (id: string, groupId: string, extra: Partial<AlbumRow> = {}): AlbumRow => ({
  _id: id,
  groupId,
  name: `Album ${id}`,
  createdAt: T0,
  ...extra,
});

describe("plusParams: wat de + meegeeft (besluit 29.2)", () => {
  it("vanuit een album of een foto erin: dat album (zoals nu)", () => {
    expect(plusParams("/groep/g1/album/a1")).toEqual({ albumId: "a1" });
    expect(plusParams("/groep/g1/album/a1/foto/p1")).toEqual({ albumId: "a1" });
    expect(plusParams("/groep/g1/album/a1/kaart")).toEqual({ albumId: "a1" });
  });

  it("de groepspagina: de groep", () => {
    expect(plusParams("/groep/g1")).toEqual({ groupId: "g1" });
    expect(plusParams("/groep/g1/")).toEqual({ groupId: "g1" });
  });

  it("de projectpagina en andere schermen onder de groep: de groep", () => {
    expect(plusParams("/groep/g1/filmproject/p1")).toEqual({ groupId: "g1" });
    expect(plusParams("/groep/g1/film/f1")).toEqual({ groupId: "g1" });
    expect(plusParams("/groep/g1/nieuw-filmproject")).toEqual({ groupId: "g1" });
    expect(plusParams("/groep/g1/bewerken")).toEqual({ groupId: "g1" });
  });

  it("een id met tekens die gecodeerd zijn", () => {
    expect(plusParams("/groep/g%201")).toEqual({ groupId: "g 1" });
    expect(plusParams("/groep/g%201/album/a%2F1")).toEqual({ albumId: "a/1" });
  });

  it("elders niets: het laatst gekozen album, zoals nu", () => {
    for (const p of ["/", "/mijn-fotos", "/mijn-fotos/foto/p1", "/profiel", "/instellingen", "/toevoegen"]) {
      expect(plusParams(p), p).toEqual({});
    }
  });

  it("een pad dat niet te lezen is: niets", () => {
    expect(plusParams("/groep/%E0%A4%A")).toEqual({});
  });
});

describe("newestAlbum: het album bovenaan de groepspagina (A-keuze)", () => {
  it("geen albums: null", () => {
    expect(newestAlbum([])).toBeNull();
  });

  it("de datum van het album telt (eigen datum, anders wanneer gemaakt)", () => {
    const albums = [
      album("oud", "g", { createdAt: T0 - 10 * DAY }),
      album("nieuw", "g", { createdAt: T0 }),
      album("met-datum", "g", { createdAt: T0 - 20 * DAY, sortDate: T0 - 30 * DAY }),
    ];
    expect(newestAlbum(albums)).toEqual({ albumId: "nieuw", groupId: "g" });
    const dated = [album("a", "g", { createdAt: T0 - 5 * DAY, sortDate: T0 + DAY }), album("b", "g", { createdAt: T0 })];
    expect(newestAlbum(dated)).toEqual({ albumId: "a", groupId: "g" });
  });

  it("gelijk aan het eerste album dat de groepspagina toont, ook bij dezelfde datum", () => {
    const albums = [
      album("z", "g", { name: "Zondag", createdAt: T0 }),
      album("a", "g", { name: "Avond", createdAt: T0 }),
      album("o", "g", { name: "Ochtend", createdAt: T0 - DAY }),
    ];
    const top = albumsByYear(albums)[0]!.albums[0]!;
    expect(newestAlbum(albums)).toEqual({ albumId: top._id, groupId: "g" });
  });

  it("na het starten in een groep zonder album (besluit 28): het nieuwe album, het enige", () => {
    expect(newestAlbum([album("nieuw", "g")])).toEqual({ albumId: "nieuw", groupId: "g" });
  });
});

describe("groupDefaultAlbum: het album als de + een groep meegeeft (besluit 29.2)", () => {
  const albums = [album("y", "g", { createdAt: T0 - DAY }), album("x", "g", { createdAt: T0 })];

  it("het laatst gekozen album ligt in die groep: dat album", () => {
    expect(groupDefaultAlbum({ groupId: "g", stored: { albumId: "y", groupId: "g" }, albums })).toEqual({ albumId: "y", groupId: "g" });
  });

  it("het laatst gekozen album ligt in een andere groep: het nieuwste van deze groep", () => {
    expect(groupDefaultAlbum({ groupId: "g", stored: { albumId: "elders", groupId: "h" }, albums })).toEqual({ albumId: "x", groupId: "g" });
  });

  it("niets onthouden: het nieuwste van deze groep", () => {
    expect(groupDefaultAlbum({ groupId: "g", stored: null, albums })).toEqual({ albumId: "x", groupId: "g" });
  });

  it("het onthouden album van deze groep is weg: het nieuwste", () => {
    expect(groupDefaultAlbum({ groupId: "g", stored: { albumId: "weg", groupId: "g" }, albums })).toEqual({ albumId: "x", groupId: "g" });
  });

  it("alleen albums van deze groep tellen", () => {
    const mixed = [...albums, album("h-nieuwst", "h", { createdAt: T0 + DAY })];
    expect(groupDefaultAlbum({ groupId: "g", stored: null, albums: mixed })).toEqual({ albumId: "x", groupId: "g" });
  });

  it("de albums laden nog: nog niets (undefined); geen albums: null (Kies een album)", () => {
    expect(groupDefaultAlbum({ groupId: "g", stored: null, albums: undefined })).toBeUndefined();
    expect(groupDefaultAlbum({ groupId: "g", stored: { albumId: "y", groupId: "g" }, albums: [] })).toBeNull();
  });
});

describe("de aansluiting (bronscan)", () => {
  const SRC = fileURLToPath(new URL("../src/", import.meta.url));
  const read = (rel: string) => (existsSync(SRC + rel) ? readFileSync(SRC + rel, "utf8") : "");

  it("de + in de tabbalk gebruikt plusParams, niet meer alleen albumIdFromPath", () => {
    const src = read("navigation/TabBar.tsx");
    expect(src.length, "sanity: TabBar.tsx").toBeGreaterThan(0);
    expect(src).toContain("plusParams(");
    expect(src).not.toMatch(/\balbumIdFromPath\(/);
  });

  it("de route toevoegen geeft ook een groupId door aan het toevoegscherm", () => {
    const src = read("app/toevoegen.tsx");
    expect(src).toMatch(/groupId/);
  });

  it("het toevoegscherm kiest met groupDefaultAlbum als er een groep meekomt", () => {
    expect(read("screens/AddPhotosScreen.tsx")).toContain("groupDefaultAlbum(");
  });

  it("na het starten van een project: saveLastAlbum met newestAlbum van die groep", () => {
    const src = read("screens/FilmProjectScreens.tsx");
    expect(src).toContain("saveLastAlbum(");
    expect(src).toContain("newestAlbum(");
  });
});
