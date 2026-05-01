import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Visit tracking: client roept users.recordVisit() bij AppState=active.
// Server doet GEEN throttling — dat is client-side (max 1x/min). Server
// accepteert dus elke call. Zie docs/migratie-plan-convex.md sectie
// "User visit tracking".

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";

function withUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
  });
}

// Audit-7 §5: seed pending invite zodat users.register-gate passeert.
async function seedInvite(t: ReturnType<typeof convexTest>, email: string) {
  await t.run(async (ctx) => {
    const inviterId = await ctx.db.insert("users", {
      subject: `__invite_seeder_${crypto.randomUUID()}`,
      email: `seeder_${crypto.randomUUID()}@seed.test`,
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    });
    await ctx.db.insert("invites", {
      email: email.toLowerCase().trim(),
      invitedBy: inviterId,
      token: crypto.randomUUID(),
      status: "pending",
      expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
  });
}

describe("users.recordVisit", () => {
  it("patcht lastVisitAt naar Date.now() voor authenticated user", async () => {
    const t = convexTest(schema);
    const as = withUser(t, "user_alice");
    await seedInvite(t, "alice@x.com");
    const id = await as.mutation(api.users.register, {
      email: "alice@x.com",
    });

    const before = Date.now();
    await as.mutation(api.users.recordVisit, {});
    const after = Date.now();

    const got = await t.run((ctx) => ctx.db.get(id));
    expect(got?.lastVisitAt).toBeGreaterThanOrEqual(before);
    expect(got?.lastVisitAt).toBeLessThanOrEqual(after);
  });

  it("weigert zonder auth", async () => {
    const t = convexTest(schema);
    await expect(t.mutation(api.users.recordVisit, {})).rejects.toThrow();
  });

  it("accepteert elke call — server throttled niet", async () => {
    // Throttling is client-side verantwoordelijkheid. Server moet elke call
    // accepteren en lastVisitAt overschrijven, ook als ze snel na elkaar komen.
    const t = convexTest(schema);
    const as = withUser(t, "user_alice");
    await seedInvite(t, "alice@x.com");
    const id = await as.mutation(api.users.register, {
      email: "alice@x.com",
    });

    await as.mutation(api.users.recordVisit, {});
    const first = await t.run((ctx) => ctx.db.get(id));

    await as.mutation(api.users.recordVisit, {});
    const second = await t.run((ctx) => ctx.db.get(id));

    expect(first?.lastVisitAt).toBeDefined();
    expect(second?.lastVisitAt).toBeDefined();
    expect(second!.lastVisitAt!).toBeGreaterThanOrEqual(first!.lastVisitAt!);
  });
});
