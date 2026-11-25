// WP39 fixronde gate 1, besluit 1 (F3, F4): is het laatst gekozen album nog
// te gebruiken? Pure logica, zonder React of keychain.
//
// Lidmaatschap gaat voor, zoals bij de thuisgroep (WP32): de groep moet in Mijn
// groepen staan en het album in de albums van die groep. Anders "Kies een
// album", zonder melding, en de onthouden waarde wordt vergeten. Zolang iets
// laadt: nog niets kiezen. De naam komt uit de huidige namen.

import { albumsByYear } from "./groups";

export type StoredAlbum = { albumId: string; groupId: string };

export type LastAlbumChoice =
  | { kind: "album"; album: { albumId: string; groupId: string; label: string } }
  | { kind: "none"; forget: boolean }
  | { kind: "unknown" };

export function lastAlbumChoice(input: {
  /** undefined: nog niet gelezen; null: niets onthouden. */
  stored: StoredAlbum | null | undefined;
  myGroups: readonly { _id: string; name: string }[] | undefined;
  /** De albums van die groep, of undefined zolang ze laden. */
  albumsOf: (groupId: string) => readonly { _id: string; groupId: string; name: string }[] | undefined;
}): LastAlbumChoice {
  const { stored, myGroups } = input;
  if (stored === undefined) return { kind: "unknown" };
  if (stored === null) return { kind: "none", forget: false };
  if (myGroups === undefined) return { kind: "unknown" };
  const group = myGroups.find((g) => g._id === stored.groupId);
  if (!group) return { kind: "none", forget: true };
  const albums = input.albumsOf(stored.groupId);
  if (albums === undefined) return { kind: "unknown" };
  const album = albums.find((a) => a._id === stored.albumId && a.groupId === stored.groupId);
  if (!album) return { kind: "none", forget: true };
  return {
    kind: "album",
    album: { albumId: album._id, groupId: group._id, label: `${group.name} · ${album.name}` },
  };
}

// --- WP38 besluit 29: het standaard-album volgt de groep ------------------------------

export type AlbumRow = { _id: string; groupId: string; name: string; createdAt: number; sortDate?: number };

/**
 * Het nieuwste album: het album bovenaan de groepspagina (`albumsByYear`: de
 * datum van het album, dan de naam). Geen albums: null.
 */
export function newestAlbum(albums: readonly AlbumRow[]): StoredAlbum | null {
  const top = albumsByYear(albums)[0]?.albums[0];
  return top ? { albumId: top._id, groupId: top.groupId } : null;
}

/**
 * Besluit 29.2: de + gaf een groep mee. Het laatst gekozen album als het in
 * die groep ligt en nog bestaat, anders het nieuwste album van die groep.
 * Zolang de albums laden: undefined; een groep zonder albums: null.
 */
export function groupDefaultAlbum(input: {
  groupId: string;
  stored: StoredAlbum | null;
  albums: readonly AlbumRow[] | undefined;
}): StoredAlbum | null | undefined {
  if (input.albums === undefined) return undefined;
  const inGroup = input.albums.filter((a) => a.groupId === input.groupId);
  const stored = input.stored;
  if (stored && stored.groupId === input.groupId && inGroup.some((a) => a._id === stored.albumId)) {
    return { albumId: stored.albumId, groupId: stored.groupId };
  }
  return newestAlbum(inGroup);
}
