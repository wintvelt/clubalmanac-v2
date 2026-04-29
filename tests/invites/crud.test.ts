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

describe("invites.create", () => {
  it("weigert zonder auth", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(api.invites.create, { email: "new@x.com" }),
    ).rejects.toThrow();
  });

  it("general invite (geen groupId): elke authed user kan sturen", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");

    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com" },
    );

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.email).toBe("new@x.com");
    expect(invite?.invitedBy).toBe(aliceId);
    expect(invite?.status).toBe("pending");
    expect(invite?.groupId).toBeUndefined();
    expect(invite?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("group-scoped invite: alleen members van die groep kunnen sturen", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_outsider", "out@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );

    // Alice (member) mag
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com", groupId, role: "member" },
    );
    const invite = await t.run((ctx) => ctx.db.get(inviteId));
    expect(invite?.groupId).toBe(groupId);
    expect(invite?.role).toBe("member");

    // Outsider niet
    await expect(
      withUser(t, "user_outsider").mutation(api.invites.create, {
        email: "new2@x.com",
        groupId,
      }),
    ).rejects.toThrow();
  });
});

describe("invites.getByToken", () => {
  it("returnt invite + inviter + group voor geldige token", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "Mijn Groep" },
    );
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com", groupId },
    );

    const got = await t.query(api.invites.getByToken, { token });
    expect(got?.email).toBe("new@x.com");
    expect(got?.inviter?.email).toBe("a@x.com");
    expect(got?.group?.name).toBe("Mijn Groep");
  });

  it("returnt null voor onbekende token", async () => {
    const t = convexTest(schema);
    const got = await t.query(api.invites.getByToken, { token: "bogus" });
    expect(got).toBeNull();
  });
});

describe("invites.listPendingForEmail / hasPendingForEmail", () => {
  it("vindt pending invites op email", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "new@x.com",
    });

    const list = await t.query(api.invites.listPendingForEmail, {
      email: "new@x.com",
    });
    expect(list).toHaveLength(1);

    const has = await t.query(api.invites.hasPendingForEmail, {
      email: "new@x.com",
    });
    expect(has).toBe(true);

    const noMatch = await t.query(api.invites.hasPendingForEmail, {
      email: "ander@x.com",
    });
    expect(noMatch).toBe(false);
  });

  it("filtert verlopen en non-pending invites uit", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com" },
    );

    // Forceer expired
    await t.run((ctx) =>
      ctx.db.patch(inviteId, { expiresAt: Date.now() - 1000 }),
    );

    expect(
      await t.query(api.invites.hasPendingForEmail, { email: "new@x.com" }),
    ).toBe(false);
  });
});

describe("invites.listMine", () => {
  it("returnt invites die caller stuurde", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");

    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "x@x.com",
    });
    await withUser(t, "user_bob").mutation(api.invites.create, {
      email: "y@x.com",
    });

    const aliceList = await withUser(t, "user_alice").query(
      api.invites.listMine,
      {},
    );
    expect(aliceList).toHaveLength(1);
    expect(aliceList[0]?.email).toBe("x@x.com");

    const noAuth = await t.query(api.invites.listMine, {});
    expect(noAuth).toEqual([]);
  });
});

describe("invites.remove", () => {
  it("sender kan invite intrekken", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com" },
    );

    await withUser(t, "user_alice").mutation(api.invites.remove, { inviteId });
    expect(await t.run((ctx) => ctx.db.get(inviteId))).toBeNull();
  });

  it("andere user kan niet intrekken", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com" },
    );

    await expect(
      withUser(t, "user_bob").mutation(api.invites.remove, { inviteId }),
    ).rejects.toThrow();
  });
});
