import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";

function withUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
  });
}

async function registerUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email: string,
) {
  // Audit-7 §5: seed pending invite om users.register-gate te passeren.
  const { inviteId, seederId } = await t.run(async (ctx) => {
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
      expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
    return { inviteId, seederId };
  });
  const userId = await withUser(t, subject).mutation(api.users.register, { email });
  // Cleanup seed-artifacts zodat test-DB schoon blijft (geen extra
  // pending invites of seeder-users die latere queries vervuilen).
  await t.run(async (ctx) => {
    await ctx.db.delete(inviteId);
    await ctx.db.delete(seederId);
  });
  return userId;
}

async function setupFeature(t: ReturnType<typeof convexTest>) {
  await registerUser(t, "user_alice", "a@x.com");
  return await withUser(t, "user_alice").mutation(api.features.create, {
    type: "feature",
    title: "F",
    description: "d",
  });
}

describe("features.upvote", () => {
  it("verhoogt upvoteCount en maakt upvote-record", async () => {
    const t = convexTest(schema);
    const id = await setupFeature(t);
    await registerUser(t, "user_bob", "b@x.com");

    await withUser(t, "user_bob").mutation(api.features.upvote, {
      featureId: id,
    });

    const f = await t.run((ctx) => ctx.db.get(id));
    expect(f?.upvoteCount).toBe(1);

    const upvotes = await t.run((ctx) =>
      ctx.db
        .query("featureUpvotes")
        .withIndex("by_feature", (q) => q.eq("featureId", id))
        .collect(),
    );
    expect(upvotes).toHaveLength(1);
  });

  it("is idempotent: dubbel upvoten verandert niets", async () => {
    const t = convexTest(schema);
    const id = await setupFeature(t);
    await registerUser(t, "user_bob", "b@x.com");

    await withUser(t, "user_bob").mutation(api.features.upvote, {
      featureId: id,
    });
    await withUser(t, "user_bob").mutation(api.features.upvote, {
      featureId: id,
    });

    const f = await t.run((ctx) => ctx.db.get(id));
    expect(f?.upvoteCount).toBe(1);
  });

  it("meerdere users dragen elk 1 upvote bij", async () => {
    const t = convexTest(schema);
    const id = await setupFeature(t);
    await registerUser(t, "user_bob", "b@x.com");
    await registerUser(t, "user_carol", "c@x.com");

    await withUser(t, "user_bob").mutation(api.features.upvote, {
      featureId: id,
    });
    await withUser(t, "user_carol").mutation(api.features.upvote, {
      featureId: id,
    });

    const f = await t.run((ctx) => ctx.db.get(id));
    expect(f?.upvoteCount).toBe(2);
  });

  it("weigert zonder auth", async () => {
    const t = convexTest(schema);
    const id = await setupFeature(t);
    await expect(
      t.mutation(api.features.upvote, { featureId: id }),
    ).rejects.toThrow();
  });

  it("weigert wanneer feature niet bestaat", async () => {
    const t = convexTest(schema);
    const id = await setupFeature(t);
    await registerUser(t, "user_bob", "b@x.com");
    await t.run((ctx) => ctx.db.delete(id));

    await expect(
      withUser(t, "user_bob").mutation(api.features.upvote, { featureId: id }),
    ).rejects.toThrow();
  });
});

describe("features.removeUpvote", () => {
  it("verlaagt upvoteCount en verwijdert upvote-record", async () => {
    const t = convexTest(schema);
    const id = await setupFeature(t);
    await registerUser(t, "user_bob", "b@x.com");

    await withUser(t, "user_bob").mutation(api.features.upvote, {
      featureId: id,
    });
    await withUser(t, "user_bob").mutation(api.features.removeUpvote, {
      featureId: id,
    });

    const f = await t.run((ctx) => ctx.db.get(id));
    expect(f?.upvoteCount).toBe(0);

    const upvotes = await t.run((ctx) =>
      ctx.db
        .query("featureUpvotes")
        .withIndex("by_feature", (q) => q.eq("featureId", id))
        .collect(),
    );
    expect(upvotes).toHaveLength(0);
  });

  it("idempotent: removeUpvote zonder eerdere upvote doet niets", async () => {
    const t = convexTest(schema);
    const id = await setupFeature(t);
    await registerUser(t, "user_bob", "b@x.com");

    await expect(
      withUser(t, "user_bob").mutation(api.features.removeUpvote, {
        featureId: id,
      }),
    ).resolves.not.toThrow();

    const f = await t.run((ctx) => ctx.db.get(id));
    expect(f?.upvoteCount).toBe(0);
  });
});
