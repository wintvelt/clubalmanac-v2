import type { MutationCtx, QueryCtx } from "../_generated/server";

// Webmaster RBAC. Env-var `WEBMASTER_EMAILS` (comma-separated) per Convex
// deployment; helper matcht `ctx.auth.getUserIdentity().email`. Zie
// docs/migratie-plan-convex.md sectie "Webmaster-rol".
function getWebmasterEmails(): string[] {
  return (process.env.WEBMASTER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

export async function requireWebmaster(
  ctx: QueryCtx | MutationCtx,
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Niet ingelogd");
  const email = identity.email;
  const allowed = getWebmasterEmails();
  if (!email || !allowed.includes(email)) {
    throw new Error("Webmaster only");
  }
}
