import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

// Fase 1 smoke tests: bewijzen dat de toolchain werkt.
// Geen feature tests — die komen in fase 2.

describe("convex-test harness", () => {
  it("schema is valid", () => {
    // defineSchema gooit bij ongeldig schema. Als import slaagt en
    // convexTest het accepteert, is de schema basaal correct.
    const t = convexTest(schema);
    expect(t).toBeDefined();
  });

  it("write → read → delete via ctx.db", async () => {
    const t = convexTest(schema);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        subject: "user_smoketest",
        email: "smoke@test.local",
        name: "Smoke Test",
        photoCount: 0,
        photoLimit: 1000,
        createdAt: Date.now(),
      });
    });

    const fetched = await t.run(async (ctx) => await ctx.db.get(userId));
    expect(fetched).not.toBeNull();
    expect(fetched?.email).toBe("smoke@test.local");

    await t.run(async (ctx) => await ctx.db.delete(userId));
    const afterDelete = await t.run(async (ctx) => await ctx.db.get(userId));
    expect(afterDelete).toBeNull();
  });

  it("by_subject index lookup werkt", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        subject: "user_indexed",
        email: "idx@test.local",
        photoCount: 0,
        photoLimit: 1000,
        createdAt: Date.now(),
      });
    });

    const found = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_subject", (q) => q.eq("subject", "user_indexed"))
        .unique(),
    );
    expect(found?.email).toBe("idx@test.local");
  });
});

describe("type-flow end-to-end", () => {
  it("smoke.ping query returns typed result", async () => {
    const t = convexTest(schema);
    const result = await t.query(api.smoke.ping, {});

    // Compile-time: TS weet dat result.ok === true en message: string.
    // Runtime: validatie dat het ook echt zo is.
    expect(result.ok).toBe(true);
    expect(result.message).toBe("pong");

    // Bewijs van type-flow: deze regel zou TS-fouten geven als de
    // generated types niet kloppen. (Uncommenteer om te testen:)
    // const fail: number = result.message;
  });
});

describe("Clerk auth wiring", () => {
  it("ctx.auth.getUserIdentity is null without token", async () => {
    const t = convexTest(schema);
    const identity = await t.run(async (ctx) => ctx.auth.getUserIdentity());
    expect(identity).toBeNull();
  });

  it("ctx.auth.getUserIdentity returns identity when impersonating", async () => {
    const t = convexTest(schema);
    const asUser = t.withIdentity({
      subject: "user_test",
      issuer: "https://picked-quail-97.clerk.accounts.dev",
      tokenIdentifier:
        "https://picked-quail-97.clerk.accounts.dev|user_test",
    });
    const identity = await asUser.run(async (ctx) =>
      ctx.auth.getUserIdentity(),
    );
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe("user_test");
  });
});
