import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";

// Test-only Convex functions voor de integration-suite (WP2 e.v.).
//
// Doel: roundtrip-pin op `ctx.storage` (`store` → `getUrl` → fetch → `delete`)
// auth-vrij ontkoppeld van de productie-`/upload` httpAction (Clerk-coupled).
// Aangeroepen vanuit `tests/integration/convex/storage.test.ts` via
// `ConvexHttpClient`. Zie docs/migratie-plan-convex.md "WP2 — Convex storage
// roundtrip" en docs/conventions/integration-tests.md.
//
// Dubbele safety: elke functie throwt als `INTEGRATION_TEST_ENABLED !== "true"`.
// Wouter zet die env-var alleen op de dev-deployment (Convex dashboard →
// Settings → Environment Variables); prod krijgt 'm nooit. Eerste laag is de
// prod-URL-blocklist in `tests/integration/_helpers/safety.ts`.

function assertIntegrationEnabled(): void {
  if (process.env.INTEGRATION_TEST_ENABLED !== "true") {
    throw new Error(
      "INTEGRATION_TEST_ENABLED is not set to \"true\" on this deployment. " +
        "Test-only function refused. Zet de env-var alleen op de dev-deployment.",
    );
  }
}

export const storageUpload = action({
  args: { bytes: v.bytes() },
  returns: v.object({ storageId: v.id("_storage") }),
  handler: async (ctx, { bytes }) => {
    assertIntegrationEnabled();
    const blob = new Blob([bytes]);
    const storageId = await ctx.storage.store(blob);
    return { storageId };
  },
});

export const storageDownloadUrl = query({
  args: { storageId: v.id("_storage") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { storageId }) => {
    assertIntegrationEnabled();
    return await ctx.storage.getUrl(storageId);
  },
});

export const storageDelete = mutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { storageId }) => {
    assertIntegrationEnabled();
    await ctx.storage.delete(storageId);
    return null;
  },
});
