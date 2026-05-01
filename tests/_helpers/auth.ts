import type { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Shared test helpers voor auth + invite-gate (audit-7 §5).
// Vanaf B's invite-gate fix moet `users.register` voor non-webmasters
// een pending, niet-verlopen invite vinden. Tests die "normale" users
// registreren gebruiken `registerUserWithInvite`; tests die expliciet
// webmaster-bootstrap (zonder invite) testen blijven `registerUser` of
// een rauwe `t.mutation(api.users.register, ...)` aanroepen.

export const ISSUER = "https://picked-quail-97.clerk.accounts.dev";
const DAY_MS = 24 * 60 * 60 * 1000;

export function withUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email?: string,
) {
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    ...(email !== undefined ? { email } : {}),
  });
}

// Seed een pending invite direct via t.run (geen sender-check, geen
// scheduler.runAfter). `invitedBy` heeft een geldige users-id nodig —
// daarvoor maken we een unieke "seeder"-user per call zodat parallelle
// seeds niet botsen op de email-uniqueness check.
export async function seedPendingInvite(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<{ inviteId: Id<"invites">; seederId: Id<"users"> }> {
  return await t.run(async (ctx) => {
    const seederId = await ctx.db.insert("users", {
      subject: `__invite_seeder_${crypto.randomUUID()}`,
      email: `seeder_${crypto.randomUUID()}@seed.test`,
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    });
    const inviteId = await ctx.db.insert("invites", {
      email: email.toLowerCase().trim(),
      invitedBy: seederId,
      token: crypto.randomUUID(),
      status: "pending",
      expiresAt: Date.now() + 14 * DAY_MS,
      createdAt: Date.now(),
    });
    return { inviteId, seederId };
  });
}

// Rauwe register — gebruikt door tests die webmaster-bypass paden of
// fail-modes van register zelf testen. Roept géén invite-seed aan.
export async function registerUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email: string,
  name?: string,
): Promise<Id<"users">> {
  return await withUser(t, subject, email).mutation(api.users.register, {
    email,
    ...(name !== undefined ? { name } : {}),
  });
}

// Standaard pad voor "normale" users in tests: seed pending invite,
// register, dan cleanup van seed-artefacten zodat invite-/user-queries
// in test-assertions niet vervuild raken. Vervangt de oude lokale
// `registerUser`-helpers die in elke test-file leefden.
export async function registerUserWithInvite(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email: string,
  name?: string,
): Promise<Id<"users">> {
  const { inviteId, seederId } = await seedPendingInvite(t, email);
  const userId = await registerUser(t, subject, email, name);
  await t.run(async (ctx) => {
    await ctx.db.delete(inviteId);
    await ctx.db.delete(seederId);
  });
  return userId;
}
