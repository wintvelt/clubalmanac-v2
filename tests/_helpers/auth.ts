import type { convexTest } from "convex-test";
import type { Id } from "../../convex/_generated/dataModel";

// Shared test helpers voor auth + onboarding-flow (WP6).
//
// Onboarding-discipline is gepin'd in `tests/users/registerFromSession.test.ts`
// + `tests/clerk/webhookAuth.test.ts` + `tests/clerk/webhookPayloadShape.test.ts`.
// Daar wordt `internal.users.registerFromSession` direct aangeroepen om het
// onboarding-gedrag te valideren (auto-accept pending invites + membership-
// insert binnen één transactie).
//
// Voor alle ANDERE tests (die alleen een users-row als seed-stap willen,
// zonder onboarding-bijwerkingen op pre-existente pending invites) seeden
// deze helpers de users-row direct via `t.run` + `ctx.db.insert`. Dat
// vermijdt dat een register-call stille invite-accepts triggert op invites
// die de test zelf orchestreert (bv. invite-accept-flows in
// `tests/invites/*.test.ts`).

export const ISSUER = "https://picked-quail-97.clerk.accounts.dev";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PHOTO_LIMIT = 1000;

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
      photoLimit: DEFAULT_PHOTO_LIMIT,
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

// Pure users-row seed. Bypassed registerFromSession op-zet zodat
// pre-existente pending invites voor `email` niet stille worden geaccepteerd.
// Tests die expliciet de onboarding-flow valideren roepen
// `internal.users.registerFromSession` rechtstreeks aan.
export async function registerUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email: string,
  name?: string,
): Promise<Id<"users">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      subject,
      email: email.toLowerCase().trim(),
      ...(name !== undefined ? { name } : {}),
      photoCount: 0,
      photoLimit: DEFAULT_PHOTO_LIMIT,
      createdAt: Date.now(),
    }),
  );
}

// Backwards-compatibele alias: de "with-invite" suffix verwijst naar het
// pre-WP6 register-gate-pretext-pattern (seed invite zodat register-gate
// passeert). Sinds WP6 is er geen gate; signature blijft hetzelfde zodat
// call-sites onveranderd kunnen blijven.
export async function registerUserWithInvite(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email: string,
  name?: string,
): Promise<Id<"users">> {
  return await registerUser(t, subject, email, name);
}
