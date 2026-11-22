// WP39 fixronde gate 1, besluit 1 (F3, F4): is het laatst gekozen album nog
// te gebruiken? Pure logica, zonder React of keychain.
//
// Lidmaatschap gaat voor, zoals bij de thuisgroep (WP32): de groep moet in Mijn
// groepen staan en het album in de albums van die groep. Anders "Kies een
// album", zonder melding, en de onthouden waarde wordt vergeten. Zolang iets
// laadt: nog niets kiezen. De naam komt uit de huidige namen.

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
