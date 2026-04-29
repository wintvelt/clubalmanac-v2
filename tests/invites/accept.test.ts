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
  return await withUser(t, subject).mutation(api.users.register, { email });
}

describe("invites.accept", () => {
  it("group-scoped invite: status accepted + membership aangemaakt", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com", groupId, role: "admin" },
    );

    const bobId = await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });

    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("accepted");
    expect(invite?.respondedAt).toBeGreaterThan(0);

    const m = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(m?.role).toBe("admin");
  });

  it("general invite (geen groupId): geen membership aangemaakt", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );

    const bobId = await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });

    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", bobId))
        .collect(),
    );
    expect(memberships).toHaveLength(0);
  });

  it("weigert wanneer email niet matcht caller", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );

    await registerUser(t, "user_carol", "carol@x.com");
    await expect(
      withUser(t, "user_carol").mutation(api.invites.accept, { token }),
    ).rejects.toThrow();
  });

  it("weigert verlopen invite", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await t.run((ctx) =>
      ctx.db.patch(inviteId, { expiresAt: Date.now() - 1000 }),
    );

    await registerUser(t, "user_bob", "bob@x.com");
    await expect(
      withUser(t, "user_bob").mutation(api.invites.accept, { token }),
    ).rejects.toThrow(/verlopen/i);

    // Status blijft "pending" (atomic mutation rollback bij throw).
    // Periodieke cron zal expired records markeren — TODO scheduled fn.
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("pending");
  });

  it("weigert al-geaccepteerde invite", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });

    await expect(
      withUser(t, "user_bob").mutation(api.invites.accept, { token }),
    ).rejects.toThrow();
  });

  it("weigert onbekende token", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_bob", "bob@x.com");
    await expect(
      withUser(t, "user_bob").mutation(api.invites.accept, { token: "bogus" }),
    ).rejects.toThrow();
  });
});

describe("invites.decline", () => {
  it("markeert status declined en zet respondedAt", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );

    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });

    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.status).toBe("declined");
    expect(invite?.respondedAt).toBeGreaterThan(0);
  });

  it("idempotent: tweede decline doet niets", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );

    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });
    await expect(
      withUser(t, "user_bob").mutation(api.invites.decline, { token }),
    ).resolves.not.toThrow();
  });

  it("weigert wanneer email niet matcht", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );

    await registerUser(t, "user_carol", "carol@x.com");
    await expect(
      withUser(t, "user_carol").mutation(api.invites.decline, { token }),
    ).rejects.toThrow();
  });
});
