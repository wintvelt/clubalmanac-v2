import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { albumsByYear, sortMyGroups } from "../src/lib/groups";
import { addOutcome, albumChoices, myPhotoActions, photoAlbumLines } from "../src/lib/myPhotos";

// WP17c: pure logica achter Mijn foto's, de album-keuze en "in welke albums".
// Spec: docs/work-packages/WP17c-mijn-fotos.md §Spec-criticus aanvullingen
// (invariant 3, 6; A-invariant 11, 12, 13). De schermen zelf toetst de gate.

// --- Menu in Mijn foto's (invariant 6, A-invariant 13) ---------------------------------
//
// Een eigen foto, zonder album: wat de eigenaar met een eigen foto mag
// (WP17b), zonder wat een album nodig heeft (covers, uit album halen).

describe("myPhotoActions: het menu in Mijn foto's", () => {
  it("profielfoto, draaien en verwijderen; geen covers en geen uit album halen", () => {
    expect([...myPhotoActions()].sort()).toEqual(["delete", "profilePhoto", "rotate"]);
  });

  it("verwijderen staat onderaan (rood, WP17b)", () => {
    expect(myPhotoActions().at(-1)).toBe("delete");
  });
});

// --- Album-keuze (A-invariant 12) -------------------------------------------------------
//
// Orakel: de volgorde van Mijn groepen (sortMyGroups) en van het groepsscherm
// (albumsByYear), al getest in groups.test.ts.

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);

const groups = [
  { _id: "g1", name: "Club", createdAt: T0 },
  { _id: "g2", name: "Ander", createdAt: T0 + 5 * DAY },
  { _id: "g3", name: "Leeg", createdAt: T0 + 9 * DAY },
  { _id: "g4", name: "Alleen hier", createdAt: T0 + 2 * DAY },
];

const albums = [
  { _id: "a1", groupId: "g1", name: "Zomer", createdAt: T0 + 1 * DAY },
  { _id: "a2", groupId: "g1", name: "Winter", createdAt: T0 + 40 * DAY },
  { _id: "a3", groupId: "g1", name: "Oud", createdAt: T0 - 400 * DAY, sortDate: T0 - 400 * DAY },
  { _id: "a4", groupId: "g2", name: "Ver", createdAt: T0 + 3 * DAY },
  { _id: "a5", groupId: "g4", name: "Hier", createdAt: T0 + 3 * DAY },
  // Een album van een groep die niet (meer) in de lijst staat.
  { _id: "a6", groupId: "gX", name: "Elders", createdAt: T0 },
];

type Section = { group: { _id: string }; albums: Array<{ _id: string }> };

function shape(sections: readonly Section[]): Array<[string, string[]]> {
  return sections.map((s) => [s.group._id, s.albums.map((a) => a._id)]);
}

function expected(fromAlbumId?: string): Array<[string, string[]]> {
  const out: Array<[string, string[]]> = [];
  for (const g of sortMyGroups(groups)) {
    const own = albums.filter((a) => a.groupId === g._id && a._id !== fromAlbumId);
    const ordered = albumsByYear(own).flatMap((y) => y.albums.map((a) => a._id));
    if (ordered.length > 0) out.push([g._id, ordered]);
  }
  return out;
}

describe("albumChoices: per groep, alleen je eigen groepen", () => {
  it("volgorde van Mijn groepen, binnen een groep die van het groepsscherm; lege groepen weg", () => {
    const res = shape(albumChoices({ groups, albums }));
    expect(res).toEqual(expected());
    expect(res.map(([g]) => g)).not.toContain("g3");
  });

  it("een album van een groep die niet in de lijst staat, telt niet", () => {
    const all = shape(albumChoices({ groups, albums })).flatMap(([, a]) => a);
    expect(all).not.toContain("a6");
  });

  it("het album waar je vandaan komt, staat er niet in", () => {
    const res = shape(albumChoices({ groups, albums, fromAlbumId: "a1" }));
    expect(res).toEqual(expected("a1"));
    expect(res.flatMap(([, a]) => a)).not.toContain("a1");
  });

  it("was dat het enige album van de groep, dan valt de groep weg", () => {
    const res = shape(albumChoices({ groups, albums, fromAlbumId: "a5" }));
    expect(res.map(([g]) => g)).not.toContain("g4");
  });

  it("geen albums: een lege lijst", () => {
    expect(albumChoices({ groups, albums: [] })).toEqual([]);
  });
});

// --- Uitkomst per foto (invariant 3, A-invariant 11) ------------------------------------
//
// Alleen de code van een ConvexError telt, nooit de tekst (zoals
// groupErrorKind, WP16).

describe("addOutcome: al in het album is geen fout", () => {
  it("ALREADY_IN_ALBUM: al in het album", () => {
    expect(addOutcome(new ConvexError({ code: "ALREADY_IN_ALBUM" }))).toBe("alreadyIn");
  });

  for (const code of ["NOT_PHOTO_OWNER", "NOT_MEMBER", "NOT_ALLOWED"]) {
    it(`${code}: mislukt`, () => {
      expect(addOutcome(new ConvexError({ code }))).toBe("failed");
    });
  }

  it("een gewone Error, ook met die tekst: mislukt", () => {
    expect(addOutcome(new Error("ALREADY_IN_ALBUM"))).toBe("failed");
  });

  it("geen verbinding of iets onbekends: mislukt", () => {
    expect(addOutcome(undefined)).toBe("failed");
    expect(addOutcome("netwerk")).toBe("failed");
    expect(addOutcome(new ConvexError("ALREADY_IN_ALBUM"))).toBe("failed");
  });
});

// --- "In welke albums" (invariant 4, open vraag 3) --------------------------------------

describe("photoAlbumLines: per album één regel met album en groep", () => {
  const list = [
    { albumId: "a1", albumName: "Zomer", groupId: "g1", groupName: "club" },
    { albumId: "a2", albumName: "Feest", groupId: "g3", groupName: "Derde" },
    { albumId: "a3", albumName: "appel", groupId: "g1", groupName: "club" },
    { albumId: "a4", albumName: "Bier", groupId: "g1", groupName: "Club" },
  ];

  it("elke regel noemt eerst het album en dan de groep", () => {
    const lines = photoAlbumLines(list);
    expect(lines).toHaveLength(4);
    for (const l of lines) {
      const hit = list.find((e) => l.startsWith(e.albumName) && l.endsWith(e.groupName));
      expect(hit, l).toBeDefined();
    }
  });

  it("op groepsnaam en dan albumnaam, zonder op hoofdletters te letten", () => {
    const lines = photoAlbumLines(list);
    expect(lines.map((l) => list.find((e) => l.startsWith(e.albumName))!.albumId)).toEqual([
      "a3",
      "a4",
      "a1",
      "a2",
    ]);
  });

  it("geen albums: geen regels (het detail toont dan niets)", () => {
    expect(photoAlbumLines([])).toEqual([]);
  });
});
