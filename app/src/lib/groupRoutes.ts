// WP16 §Routes. Groep en Album staan in de stack van de Home-tab, met Mijn
// groepen als wortel op `/`. De groepstabs hebben geen eigen route.

export function groupPath(groupId: string): string {
  return `/groep/${encodeURIComponent(groupId)}`;
}

export function albumPath(groupId: string, albumId: string): string {
  return `${groupPath(groupId)}/album/${encodeURIComponent(albumId)}`;
}

// WP17a: het foto-detail staat onder het album, in dezelfde stack.
export function photoPath(groupId: string, albumId: string, photoId: string): string {
  return `${albumPath(groupId, albumId)}/foto/${encodeURIComponent(photoId)}`;
}

// WP17b: het draaischerm van een foto, in dezelfde stack als het detail.
export function rotatePath(groupId: string, albumId: string, photoId: string): string {
  return `${albumPath(groupId, albumId)}/draaien/${encodeURIComponent(photoId)}`;
}

// WP28b: beheer. Nieuwe groep en Nieuw album zijn modaal in de Home-stack;
// Bewerk groep en Bewerk album liggen boven hun scherm.
export function newGroupPath(): string {
  return "/nieuwe-groep";
}

export function newAlbumPath(groupId: string): string {
  return `${groupPath(groupId)}/nieuw-album`;
}

export function editGroupPath(groupId: string): string {
  return `${groupPath(groupId)}/bewerken`;
}

export function editAlbumPath(groupId: string, albumId: string): string {
  return `${albumPath(groupId, albumId)}/bewerken`;
}

// WP17c: Mijn foto's heeft een eigen stack in zijn tab, met het detail (swipen
// door je eigen foto's) en het draaischerm. Het detail kent de stand van de
// lijst: de schakelaar en hoeveel er geladen is.
export function myPhotoPath(photoId: string, opts: { withoutAlbum: boolean; loaded: number }): string {
  const q = `n=${opts.loaded}${opts.withoutAlbum ? "&los=1" : ""}`;
  return `/mijn-fotos/foto/${encodeURIComponent(photoId)}?${q}`;
}

export function myRotatePath(photoId: string): string {
  return `/mijn-fotos/draaien/${encodeURIComponent(photoId)}`;
}
