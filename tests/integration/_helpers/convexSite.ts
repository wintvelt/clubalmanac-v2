import { assertNotProd } from "./safety";

// Gedeelde helpers voor integration-tests die de Convex httpAction-host
// nodig hebben. Eerder gedupliceerd in jwtRoundtrip.test.ts +
// uploadRoundtrip.test.ts; WP11 zou het een derde keer kopiëren — daarom
// hier gecentraliseerd (A's spec-criticus-cleanup-note, WP11).

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(
      `${name} ontbreekt. Zet 'm in .env.integration (zie .env.integration.example).`,
    );
  }
  return v;
}

/**
 * Convex queries/mutations/actions leven op
 * `<deployment>.<region>.convex.cloud`, httpActions (zoals `/clerk-webhook`,
 * `/upload`, `/_test/whoami`) op `<deployment>.<region>.convex.site`.
 * `CONVEX_URL` wijst naar `.cloud` — we swappen alleen het `.cloud` → `.site`
 * suffix; de region-suffix blijft staan (verplicht voor EU-deployments, zie
 * WP5-correctie 2026-05-18 + WP5-audit S-3 region-suffix-URL-bug).
 */
export function getConvexSiteBase(): string {
  const cloudUrl = requireEnv("CONVEX_URL");
  assertNotProd(cloudUrl);
  if (!cloudUrl.includes(".convex.cloud")) {
    throw new Error(
      `CONVEX_URL ("${cloudUrl}") heeft geen ".convex.cloud" suffix; ` +
        `kan httpAction-host niet afleiden. Verwacht een dev-deployment URL.`,
    );
  }
  return cloudUrl.replace(".convex.cloud", ".convex.site");
}
