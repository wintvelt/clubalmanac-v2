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

// Besluit 8: openbaar, ook uitgelogd; geen token nodig. Met `version`
// (`profileVersion` uit de user-vorm, al openbaar) is een nieuwe profielfoto
// een nieuwe URL: een browser hergebruikt anders het beeld dat hij voor
// dezelfde URL al in zijn geheugen heeft, ook ondanks `no-cache`. Het
// profielpad leest alleen `formaat` en negeert `versie` (convex/http.ts).
export function profileImageUrl(
  siteUrl: string,
  userId: string,
  format: ImageFormat,
  version?: string,
): string {
  const base = `${siteUrl}/beeld/profiel/${encodeURIComponent(userId)}?formaat=${format}`;
  return version === undefined ? base : `${base}&versie=${encodeURIComponent(version)}`;
}

// WP19b A-invariant 15: de cover van de groep bij een ontvangen uitnodiging,
// op invite-id. Met het Clerk-token, zoals een foto; nooit een origineel.
export function inviteCoverUrl(siteUrl: string, inviteId: string, format: ImageFormat): string {
  return `${siteUrl}/beeld/uitnodiging/${encodeURIComponent(inviteId)}?formaat=${format}`;
}

// WP41c (C6): de foto van een afrekening, op afrekening-id, met het
// Clerk-token zoals een foto. De versie (`imageVersion` uit de reads) maakt
// van een nieuwe foto een nieuwe URL: een nieuwe sleutel in de beeldcache
// (iOS) en in het geheugen van de webapp. Het pad leest de versie niet.
export function settlementImageUrl(siteUrl: string, settlementId: string, version: string): string {
  return `${siteUrl}/beeld/afrekening/${encodeURIComponent(settlementId)}?versie=${encodeURIComponent(version)}`;
}
