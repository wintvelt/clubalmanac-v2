// WP17a besluit 1 (vorm B): de app haalt een beeld op via het beeldpad van de
// backend, met een foto-id of een user-id. Nooit met een storage-id of een
// storage-URL (invariant 10). Het beeldpad staat op de HTTP-actions-host
// (`.convex.site`), naast de client-URL (`.convex.cloud`).

export type ImageFormat = "klein" | "groot";

// https://<deployment>[.<regio>].convex.cloud → https://<deployment>[.<regio>].convex.site
export function siteUrlOf(convexUrl: string): string {
  return convexUrl.replace(/\/+$/, "").replace(/\.convex\.cloud$/i, ".convex.site");
}

// Besluit 2: het formaat gaat mee; tot WP25 de verkleinde versies maakt,
// geeft de backend het origineel.
export function photoImageUrl(siteUrl: string, photoId: string, format: ImageFormat): string {
  return `${siteUrl}/beeld/foto/${encodeURIComponent(photoId)}?formaat=${format}`;
}

// Besluit 8: openbaar, ook uitgelogd; geen token nodig.
export function profileImageUrl(siteUrl: string, userId: string, format: ImageFormat): string {
  return `${siteUrl}/beeld/profiel/${encodeURIComponent(userId)}?formaat=${format}`;
}
