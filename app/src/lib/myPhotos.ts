// WP17c: pure logica achter Mijn foto's, de album-keuze en "in welke albums".
// Spec: docs/work-packages/WP17c-mijn-fotos.md §Spec-criticus aanvullingen
// (invariant 3, 4, 6; A-invariant 11, 12, 13). De schermen tonen het.

import { ConvexError } from "convex/values";
import { albumsByYear, sortMyGroups } from "./groups";
import type { PhotoAction } from "./photoActions";

// --- Menu in Mijn foto's (invariant 6, A-invariant 13) ---------------------------------
//
// Elke foto hier is van jou en hoort bij geen album: wat de eigenaar met een
// eigen foto mag (WP17b), zonder covers en zonder "uit album halen".
// Verwijderen (rood) onderaan.
const MY_PHOTO_ACTIONS: readonly PhotoAction[] = ["profilePhoto", "rotate", "delete"];

export function myPhotoActions(): PhotoAction[] {
  return [...MY_PHOTO_ACTIONS];
}

// --- Album-keuze (A-invariant 12) -------------------------------------------------------

type ChoiceGroup = { _id: string; name: string; createdAt: number; sortDate?: number };
type ChoiceAlbum = { _id: string; groupId: string; name: string; createdAt: number; sortDate?: number };

export type AlbumChoiceSection<G, A> = { group: G; albums: A[] };

// Per groep, in de volgorde van Mijn groepen; binnen een groep die van het
// groepsscherm. Alleen de meegegeven groepen (die van de user); een groep
// zonder album valt weg, en het album waar je vandaan komt, staat er niet in.
export function albumChoices<G extends ChoiceGroup, A extends ChoiceAlbum>(input: {
  groups: readonly G[];
  albums: readonly A[];
  fromAlbumId?: string;
}): AlbumChoiceSection<G, A>[] {
  const out: AlbumChoiceSection<G, A>[] = [];
  for (const group of sortMyGroups(input.groups)) {
    const own = input.albums.filter((a) => a.groupId === group._id && a._id !== input.fromAlbumId);
    const albums = albumsByYear(own).flatMap((y) => y.albums);
    if (albums.length > 0) out.push({ group, albums });
  }
  return out;
}

// --- Uitkomst per foto (invariant 3, A-invariant 11) ------------------------------------

export type AddOutcome = "alreadyIn" | "failed";

// De weigering van albums.addPhoto voor één foto. Alleen de code van een
// ConvexError telt, nooit de tekst: "stond er al in" is geen fout.
export function addOutcome(error: unknown): AddOutcome {
  if (!(error instanceof ConvexError)) return "failed";
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return "failed";
  return (data as { code?: unknown }).code === "ALREADY_IN_ALBUM" ? "alreadyIn" : "failed";
}

// --- "In welke albums" (invariant 4, open vraag 3) --------------------------------------

type PhotoAlbum = { albumId: string; albumName: string; groupId: string; groupName: string };

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "nl", { sensitivity: "base" });
}

// Eén regel per album: "Album · Groep". Op groepsnaam, dan albumnaam, zonder
// op hoofdletters te letten; daarna het id, voor een vaste volgorde.
export function photoAlbumLines(list: readonly PhotoAlbum[]): string[] {
  return [...list]
    .sort(
      (a, b) =>
        compareText(a.groupName, b.groupName) ||
        compareText(a.albumName, b.albumName) ||
        (a.albumId < b.albumId ? -1 : a.albumId > b.albumId ? 1 : 0),
    )
    .map((e) => `${e.albumName} · ${e.groupName}`);
}
