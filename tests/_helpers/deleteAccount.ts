import type { convexTest } from "convex-test";
import { vi } from "vitest";
import { api } from "../../convex/_generated/api";

// WP29 A-keuze 5: account verwijderen loopt in stappen via de scheduler, en
// verwijdert ook de Clerk-user. Tests die alleen het eindresultaat van
// `users.deleteSelf` pinnen, roepen deze helper aan: `deleteSelf`, daarna alle
// geplande stappen, met de Clerk Backend API gestubd (200). Andere fetches
// (bv. een Mailjet-stub van de test zelf) gaan door naar de fetch die er al
// stond. Zonder `CLUBALMANAC_STAGE` zet hij `dev` (fix-cyclus 2).
//
// Spec: docs/work-packages/WP29-account-verwijderen.md §A-invarianten.

type T = ReturnType<typeof convexTest>;
type Client = Pick<ReturnType<T["withIdentity"]>, "mutation">;

const CLERK_API = "https://api.clerk.com/";

export async function deleteAccount(t: T, client: Client): Promise<void> {
  const wasFake = vi.isFakeTimers();
  if (!wasFake) vi.useFakeTimers();
  const hadKey = process.env.CLERK_SECRET_KEY;
  if (hadKey === undefined) process.env.CLERK_SECRET_KEY = "sk_test_helper";
  // Fix-cyclus 2: zonder bekende omgeving wordt de Clerk-user niet verwijderd.
  const hadStage = process.env.CLUBALMANAC_STAGE;
  if (hadStage === undefined) process.env.CLUBALMANAC_STAGE = "dev";
  const previous = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(CLERK_API)) {
      return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    }
    return previous(input, init);
  });
  try {
    await client.mutation(api.users.deleteSelf, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.stubGlobal("fetch", previous);
    if (hadKey === undefined) delete process.env.CLERK_SECRET_KEY;
    if (hadStage === undefined) delete process.env.CLUBALMANAC_STAGE;
    if (!wasFake) vi.useRealTimers();
  }
}
