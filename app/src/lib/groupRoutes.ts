// WP16 §Routes. Groep en Album staan in de stack van de Home-tab, met Mijn
// groepen als wortel op `/`. De groepstabs hebben geen eigen route.

export function groupPath(groupId: string): string {
  return `/groep/${encodeURIComponent(groupId)}`;
}

export function albumPath(groupId: string, albumId: string): string {
  return `${groupPath(groupId)}/album/${encodeURIComponent(albumId)}`;
}
