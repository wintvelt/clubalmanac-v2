import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { assertReactive } from "../_helpers/reactive";

// Cascade matrix rows U3, U4: cat-1 (eliminated) + cat-4 (reactive coverage).
// Verifieert dat join-on-read queries fresh user-data returneren na een
// updateProfile mutation. Vervangt de oude DynamoDB stream-handler
// `userBaseChangeToPhoto` (U3) en `userChangeToMembership` (U4).

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
  name?: string,
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
  const userId = await withUser(t, subject).mutation(api.users.register, { email, name });
  // Cleanup seed-artifacts zodat test-DB schoon blijft (geen extra
  // pending invites of seeder-users die latere queries vervuilen).
  await t.run(async (ctx) => {
    await ctx.db.delete(inviteId);
    await ctx.db.delete(seederId);
  });
  return userId;
}

describe("U3: photo query joint owner-data fresh", () => {
  it("getWithOwner toont nieuwe naam direct na updateProfile", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com", "Alice");
    const photoId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["x"]));
      return await ctx.db.insert("photos", {
        ownerId: aliceId,
        storageId,
        ratingCount: 0,
        createdAt: Date.now(),
      });
    });

    const { before, after } = await assertReactive(
      () => t.query(api.photos.getWithOwner, { photoId }),
      () =>
        withUser(t, "user_alice").mutation(api.users.updateProfile, {
          name: "Alice 2",
        }),
    );

    expect(before?.owner?.name).toBe("Alice");
    expect(after?.owner?.name).toBe("Alice 2");
    // Photo zelf is niet gewijzigd — owner-data komt via join.
    expect(after?._id).toBe(before?._id);
  });
});

describe("U4: membership query joint user-data fresh", () => {
  it("groups.listMembers toont nieuwe naam direct na updateProfile", async () => {
    const t = convexTest(schema);
    const adminId = await registerUser(t, "user_admin", "admin@x.com", "Admin");
    const aliceId = await registerUser(t, "user_alice", "a@x.com", "Alice");

    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "Groep" },
    );
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: aliceId,
    });

    const { before, after } = await assertReactive(
      () =>
        withUser(t, "user_admin").query(api.groups.listMembers, { groupId }),
      () =>
        withUser(t, "user_alice").mutation(api.users.updateProfile, {
          name: "Alice 2",
        }),
    );

    const beforeAlice = before.find((m) => m.user?._id === aliceId);
    const afterAlice = after.find((m) => m.user?._id === aliceId);
    expect(beforeAlice?.user?.name).toBe("Alice");
    expect(afterAlice?.user?.name).toBe("Alice 2");

    // Admin's user data is niet gewijzigd
    const afterAdmin = after.find((m) => m.user?._id === adminId);
    expect(afterAdmin?.user?.name).toBe("Admin");
  });
});
