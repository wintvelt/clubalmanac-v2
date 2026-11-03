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
