// WP15b A-punt 4 en §Routes: de Info-pagina's. Ingelogd en uitgelogd precies
// hetzelfde scherm, op twee routes: `/instellingen/<slug>` (ingelogd) en
// `/info/<slug>` (publiek, alleen uitgelogd).

export const INFO_PAGES = [
  { slug: "over", title: "Over de app" },
  { slug: "privacy", title: "Privacy" },
  { slug: "voorwaarden", title: "Voorwaarden" },
] as const satisfies readonly { slug: string; title: string }[];

export type InfoSlug = (typeof INFO_PAGES)[number]["slug"];

export function infoPath(slug: string, signedIn: boolean): string {
  return signedIn ? `/instellingen/${slug}` : `/info/${slug}`;
}

// Contact: geen pagina, maar een e-mail. Geen user-gegevens in de link.
export const CONTACT_MAILTO = "mailto:wouter@clubalmanac.com?subject=Clubalmanac-app";

/**
 * WP42 B18, A37: de versieregel bij Info, met het buildnummer van de
 * geïnstalleerde build ("Versie 2.0.2 (7)"). Zonder buildnummer (web, Expo Go,
 * een oude build): alleen de versie, geen lege haakjes.
 */
export function versionText(version: string | null | undefined, build: string | number | null | undefined): string {
  const v = typeof version === "string" ? version.trim() : "";
  const b = build === null || build === undefined ? "" : String(build).trim();
  if (v === "") return "Versie onbekend";
  return b === "" ? `Versie ${v}` : `Versie ${v} (${b})`;
}
