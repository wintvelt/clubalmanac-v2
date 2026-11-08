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
