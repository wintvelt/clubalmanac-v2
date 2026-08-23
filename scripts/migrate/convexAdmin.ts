// WP12 — Convex-verbinding voor de migratie-tooling.
//
// De migratie-functies in convex/migration.ts zijn internal (spec-afspraak:
// "niet aanroepbaar zonder deploy key"). Een gewone ConvexHttpClient kan die
// niet aanroepen; met een admin-/deploy-key wél. `setAdminAuth` is in de
// convex-package als @internal gemarkeerd en staat daarom niet in de .d.ts —
// vandaar de cast, op één plek, met deze uitleg erbij.
//
// Twee veiligheidslagen tegen "verkeerde deployment", het duurste ongeluk in
// dit werkpakket:
//   1. URL-check: een dev-run weigert een prod-deployment (dezelfde
//      blocklist als tests/integration/_helpers/safety.ts) en een prod-run
//      weigert een URL die geen prod-deployment is.
//   2. Schrijf-gate: elk commando dat naar prod schrijft eist
//      MIGRATE_ALLOW_PROD=yes in de omgeving.

import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { config as loadDotenv } from "dotenv";
// Eén bron voor de prod-deployment-naam; hij staat al in de integration-test-
// guard en mag niet op twee plekken uit elkaar lopen.
import { PROD_DEPLOYMENT_NAMES } from "../../tests/integration/_helpers/safety.ts";
import type { Target } from "./config.ts";

loadDotenv({ path: ".env.migrate", quiet: true });

export type AdminClient = {
  target: Target;
  url: string;
  client: ConvexHttpClient;
};

function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`[migrate] ${name} ontbreekt. ${hint}`);
  }
  return value.trim();
}

function looksLikeProd(url: string): boolean {
  return PROD_DEPLOYMENT_NAMES.some((name) => url.includes(name));
}

/**
 * @param write  true voor commando's die naar de deployment schrijven
 *               (load-files, load-records, reset). Alleen die eisen de
 *               MIGRATE_ALLOW_PROD-gate.
 */
export function makeAdminClient(target: Target, write: boolean): AdminClient {
  const suffix = target.toUpperCase();
  const url = requireEnv(
    `MIGRATE_CONVEX_URL_${suffix}`,
    `Zet 'm in .env.migrate (bv. https://<deployment>.convex.cloud).`,
  );
  const adminKey = requireEnv(
    `MIGRATE_CONVEX_ADMIN_KEY_${suffix}`,
    `Deployment-scoped deploy key uit het Convex-dashboard (Settings → Deploy Keys).`,
  );

  if (target === "dev" && looksLikeProd(url)) {
    throw new Error(
      `[migrate] dev-run wijst naar een productie-deployment: ${url}. Geweigerd.`,
    );
  }
  if (target === "prod" && !looksLikeProd(url)) {
    throw new Error(
      `[migrate] prod-run wijst niet naar een bekende productie-deployment: ${url}. ` +
        `Geweigerd — controleer MIGRATE_CONVEX_URL_PROD (en de blocklist in ` +
        `tests/integration/_helpers/safety.ts als de deployment-naam gewijzigd is).`,
    );
  }
  if (target === "prod" && write && process.env.MIGRATE_ALLOW_PROD !== "yes") {
    throw new Error(
      `[migrate] schrijven naar prod vereist MIGRATE_ALLOW_PROD=yes in de omgeving. ` +
        `Dit is de tweede laag naast de URL-check; zet 'm alleen voor de run zelf.`,
    );
  }

  const client = new ConvexHttpClient(url);
  (client as unknown as { setAdminAuth(token: string): void }).setAdminAuth(adminKey);
  return { target, url, client };
}

// ── typed wrappers ────────────────────────────────────────────────────
//
// ConvexHttpClient.query/mutation accepteren alleen public function-references.
// Deze twee wrappers houden args + returntype getypeerd voor internal refs.

export async function runQuery<
  Q extends FunctionReference<"query", "internal", any, any>,
>(admin: AdminClient, ref: Q, args: Q["_args"]): Promise<Q["_returnType"]> {
  try {
    return await (admin.client as unknown as {
      query(ref: Q, args: Q["_args"]): Promise<Q["_returnType"]>;
    }).query(ref, args);
  } catch (error) {
    throw explain(error, admin);
  }
}

export async function runMutation<
  M extends FunctionReference<"mutation", "internal", any, any>,
>(admin: AdminClient, ref: M, args: M["_args"]): Promise<M["_returnType"]> {
  try {
    return await (admin.client as unknown as {
      mutation(ref: M, args: M["_args"]): Promise<M["_returnType"]>;
    }).mutation(ref, args);
  } catch (error) {
    throw explain(error, admin);
  }
}

/**
 * Een afgewezen admin-key ziet er als losse HTTP-fout uit terwijl de oorzaak
 * bijna altijd hetzelfde is: geen of een verkeerd soort sleutel. Dat expliciet
 * maken scheelt zoeken midden in een cutover.
 */
function explain(error: unknown, admin: AdminClient): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|Unauthorized|admin|authenticat/i.test(message)) {
    return new Error(
      `[migrate] ${admin.url} wees de admin-key af.\n${message}\n` +
        `MIGRATE_CONVEX_ADMIN_KEY_${admin.target.toUpperCase()} moet een deployment-scoped ` +
        `deploy key zijn (Convex-dashboard → Settings → Deploy Keys), niet een project-key ` +
        `en niet de CONVEX_URL. De migratie-functies zijn internal en zijn zonder zo'n key ` +
        `niet aanroepbaar.`,
    );
  }
  return error instanceof Error ? error : new Error(message);
}
