// Productie-deployment guard voor integration-tests.
//
// Integration-tests roepen echte Convex deployments aan en kunnen
// (test-only) data schrijven. Per ongeluk runnen tegen prod = data-pollutie.
// Het test-only function-bestand op de Convex deployment heeft een
// env-var-gate (`INTEGRATION_TEST_ENABLED`) als tweede laag, maar deze
// helper is de eerste laag: weiger zelfs een verbinding richting prod.
//
// Hergebruikbaar voor WP2-4 (Convex), WP3 (Clerk), WP4 (Mailjet) — overal
// waar een deployment-URL via env-var binnenkomt.

const PROD_DEPLOYMENT_NAMES = ["deafening-shark-296"] as const;

/**
 * Throwt als de gegeven URL naar een productie-Convex-deployment wijst.
 *
 * Match op deployment-naam (subdomain) — dekt zowel `.convex.cloud` als
 * `.convex.site`, en is robuust tegen toekomstige region-suffix-varianten
 * (bv. `.eu-west-1.convex.cloud`).
 */
export function assertNotProd(url: string): void {
  for (const name of PROD_DEPLOYMENT_NAMES) {
    if (url.includes(name)) {
      throw new Error(
        `Integration-tests mogen niet tegen productie draaien. URL bevat productie-deployment-naam "${name}": ${url}`,
      );
    }
  }
}

export { PROD_DEPLOYMENT_NAMES };
