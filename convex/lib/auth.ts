import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

// Webmaster RBAC. Env-var `WEBMASTER_EMAILS` (comma-separated) per Convex
// deployment; helper matcht `ctx.auth.getUserIdentity().email` case-insensitive
// tegen die lijst. Zie docs/migratie-plan-convex.md sectie "Webmaster-rol".
//
// Audit-7 §2: matching is case-insensitive aan beide kanten — admin tikt
// mixed-case in dashboard, Clerk normaliseert vaak naar lowercase. Geen
// stille lockout van de webmaster bij case-mismatch.
//
// Audit-7 §3: na fix doet requireWebmaster intern óók requireCurrentUser
// (zie convex/users.ts). Beide gates samen — een Clerk-identity met
// webmaster-email zonder Convex users-record kan niet bypassen.
//
// PRODUCTIE-BLIND-SPOT (audit-7): vitest simuleert de email-claim via
// `t.withIdentity({ email })`, dat zegt NIETS over de Clerk JWT-template
// in productie. Pas in Phase 4A2 met een smoke-test (HTTP-endpoint dat
// `ctx.auth.getUserIdentity()` reflecteert/log, eenmalig) is verifieerbaar
// of de claim daadwerkelijk doorkomt. Zie plan §"Webmaster-rol (RBAC)".
export function getWebmasterEmails(): string[] {
  return (process.env.WEBMASTER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export async function requireWebmaster(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Niet ingelogd");

  const email = identity.email?.toLowerCase();
  const allowed = getWebmasterEmails();
  if (!email || !allowed.includes(email)) {
    throw new Error("Webmaster only");
  }

  // Audit-7 §3: óók requireCurrentUser-equivalent. Inline ipv import
  // (users.ts → photos.ts → lib/auth.ts zou circular zijn).
  const user = await ctx.db
    .query("users")
    .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
    .unique();
  if (!user) throw new Error("User record bestaat niet");
  return user;
}
