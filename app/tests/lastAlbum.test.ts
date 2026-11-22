import { describe, expect, it } from "vitest";
import { lastAlbumChoice } from "../src/lib/lastAlbum";

// WP39 fixronde gate 1, besluit 1 (F3, F4): het laatst gekozen album, vooraf
// ingevuld als de + in de tabbalk het scherm opent buiten een album.
//   Lidmaatschap gaat voor, zoals bij de thuisgroep (WP32): de groep moet in
//   Mijn groepen staan en het album in de albums van die groep. Anders "Kies
//   een album", zonder melding, en de onthouden waarde wordt vergeten.
//   Zolang iets laadt: nog niets kiezen (geen flits van "Kies een album").
//   De naam komt uit de huidige namen ("Groep · Album").
// Spec: docs/work-packages/WP39-toevoegscherm.md §Fixronde gate 1.

type Group = { _id: string; name: string };
type Album = { _id: string; groupId: string; name: string };

const groups: Group[] = [
  { _id: "g1", name: "Zeilclub" },
  { _id: "g2", name: "Wandelclub" },
];
const albums: Record<string, Album[]> = {
  g1: [
    { _id: "a1", groupId: "g1", name: "Zomer 2026" },
    { _id: "a2", groupId: "g1", name: "Najaar" },
  ],
  g2: [{ _id: "b1", groupId: "g2", name: "Ardennen" }],
};
const albumsOf = (groupId: string) => albums[groupId];

describe("lastAlbumChoice", () => {
  it("nog niet gelezen van het toestel: onbekend", () => {
    expect(lastAlbumChoice({ stored: undefined, myGroups: groups, albumsOf })).toEqual({ kind: "unknown" });
  });

  it("niets onthouden: Kies een album, niets te vergeten", () => {
    expect(lastAlbumChoice({ stored: null, myGroups: groups, albumsOf })).toEqual({ kind: "none", forget: false });
  });

  it("Mijn groepen laadt nog: onbekend", () => {
    expect(lastAlbumChoice({ stored: { albumId: "a1", groupId: "g1" }, myGroups: undefined, albumsOf })).toEqual({
      kind: "unknown",
    });
  });

  it("de albums van die groep laden nog: onbekend", () => {
    expect(
      lastAlbumChoice({ stored: { albumId: "a1", groupId: "g1" }, myGroups: groups, albumsOf: () => undefined }),
    ).toEqual({ kind: "unknown" });
  });

  it("geldig: het album, met 'Groep · Album' uit de huidige namen", () => {
    expect(lastAlbumChoice({ stored: { albumId: "a2", groupId: "g1" }, myGroups: groups, albumsOf })).toEqual({
      kind: "album",
      album: { albumId: "a2", groupId: "g1", label: "Zeilclub · Najaar" },
    });
  });

  it("hernoemd album of groep: de nieuwe naam", () => {
    const renamed = [{ _id: "g1", name: "Zeilclub Noord" }];
    const result = lastAlbumChoice({
      stored: { albumId: "a1", groupId: "g1" },
      myGroups: renamed,
      albumsOf: () => [{ _id: "a1", groupId: "g1", name: "Zomer" }],
    });
    expect(result).toEqual({ kind: "album", album: { albumId: "a1", groupId: "g1", label: "Zeilclub Noord · Zomer" } });
  });

  it("geen lid meer van de groep: Kies een album, en vergeten", () => {
    expect(
      lastAlbumChoice({ stored: { albumId: "b1", groupId: "g2" }, myGroups: [groups[0]!], albumsOf }),
    ).toEqual({ kind: "none", forget: true });
  });

  it("geen lid meer: de albums van die groep worden niet eens gevraagd", () => {
    const asked: string[] = [];
    lastAlbumChoice({
      stored: { albumId: "b1", groupId: "g2" },
      myGroups: [groups[0]!],
      albumsOf: (id) => {
        asked.push(id);
        return albums[id];
      },
    });
    expect(asked).not.toContain("g2");
  });

  it("het album bestaat niet meer: Kies een album, en vergeten", () => {
    expect(lastAlbumChoice({ stored: { albumId: "weg", groupId: "g1" }, myGroups: groups, albumsOf })).toEqual({
      kind: "none",
      forget: true,
    });
  });

  it("een album-id uit een andere groep telt niet", () => {
    expect(lastAlbumChoice({ stored: { albumId: "b1", groupId: "g1" }, myGroups: groups, albumsOf })).toEqual({
      kind: "none",
      forget: true,
    });
  });

  it("geen groepen meer: Kies een album, en vergeten", () => {
    expect(lastAlbumChoice({ stored: { albumId: "a1", groupId: "g1" }, myGroups: [], albumsOf })).toEqual({
      kind: "none",
      forget: true,
    });
  });
});
