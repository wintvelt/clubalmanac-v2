import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
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

describe("users.recordVisit", () => {
  it("patcht lastVisitAt naar Date.now() voor authenticated user", async () => {
    const t = convexTest(schema);
    const as = withUser(t, "user_alice");
    const id = await t.mutation(internal.users.registerFromSession, {
      subject: "user_alice",
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
    const id = await t.mutation(internal.users.registerFromSession, {
      subject: "user_alice",
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
