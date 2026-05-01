import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Features (feature requests + problem reports) + upvoting.
// Niet in cascade-matrix (geen denormalization naar andere tables);
// pure CRUD met featureUpvotes als sub-resource.
//
// Audit-7 §4: features.update + features.remove zijn webmaster-only
// (plan regel 504/511). Oude submitter-only was drift, niet bedoeld.
// Update/remove tests hieronder pinnen het webmaster-only gedrag —
// RED tot B's code-fix in convex/features.ts.

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";
const WEBMASTER_EMAIL = "webmaster@x.com";

function withUser(
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
  const userId = await withUser(t, subject, email).mutation(api.users.register, { email });
  // Cleanup seed-artifacts zodat test-DB schoon blijft (geen extra
  // pending invites of seeder-users die latere queries vervuilen).
  await t.run(async (ctx) => {
    await ctx.db.delete(inviteId);
    await ctx.db.delete(seederId);
  });
  return userId;
}

describe("features.create", () => {
  it("weigert zonder auth", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(api.features.create, {
        type: "feature",
        title: "X",
        description: "Y",
      }),
    ).rejects.toThrow();
  });

  it("weigert wanneer geen user record", async () => {
    const t = convexTest(schema);
    await expect(
      withUser(t, "user_ghost").mutation(api.features.create, {
        type: "feature",
        title: "X",
        description: "Y",
      }),
    ).rejects.toThrow();
  });

  it("maakt feature met defaults (status=open, upvoteCount=0)", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");

    const id = await withUser(t, "user_alice").mutation(api.features.create, {
      type: "feature",
      title: "Donkere modus",
      description: "Zou fijn zijn",
    });

    const f = await t.run((ctx) => ctx.db.get(id));
    expect(f?.type).toBe("feature");
    expect(f?.title).toBe("Donkere modus");
    expect(f?.submittedBy).toBe(aliceId);
    expect(f?.status).toBe("open");
    expect(f?.upvoteCount).toBe(0);
    expect(typeof f?.createdAt).toBe("number");
  });

  it("type 'problem' werkt ook", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");

    const id = await withUser(t, "user_alice").mutation(api.features.create, {
      type: "problem",
      title: "Crash bij upload",
      description: "Probeer .heic",
    });
    const f = await t.run((ctx) => ctx.db.get(id));
    expect(f?.type).toBe("problem");
  });
});

// Plan regel 504/511 — features.update is webmaster-only. Oude
// submitter-only tests waren shared bias met submitter-only code;
// allebei drift t.o.v. plan. RED tot B's code-fix.
describe("features.update — webmaster-only (audit-7 §4)", () => {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  it("webmaster kan andermans feature aanpassen", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);
    const id = await withUser(t, "user_alice", "a@x.com").mutation(
      api.features.create,
      {
        type: "feature",
        title: "Oud",
        description: "oud",
      },
    );

    await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
      api.features.update,
      {
        featureId: id,
        title: "Nieuw",
        description: "nieuw",
      },
    );

    const f = await t.run((ctx) => ctx.db.get(id));
    expect(f?.title).toBe("Nieuw");
    expect(f?.description).toBe("nieuw");
  });

  // Onder webmaster-only RBAC vervalt het submitter-recht. Een gewone
  // user — ook al is het de submitter — heeft géén edit-rechten meer.
  it("submitter (niet webmaster) kan eigen feature NIET aanpassen", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const id = await withUser(t, "user_alice", "a@x.com").mutation(
      api.features.create,
      {
        type: "feature",
        title: "X",
        description: "Y",
      },
    );

    await expect(
      withUser(t, "user_alice", "a@x.com").mutation(api.features.update, {
        featureId: id,
        title: "Mag niet",
      }),
    ).rejects.toThrow();
  });

  it("non-webmaster wordt geweigerd (zelfs submitter)", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const id = await withUser(t, "user_alice", "a@x.com").mutation(
      api.features.create,
      {
        type: "feature",
        title: "X",
        description: "Y",
      },
    );

    // Niet-submitter, niet-webmaster
    await expect(
      withUser(t, "user_bob", "b@x.com").mutation(api.features.update, {
        featureId: id,
        title: "Hijack",
      }),
    ).rejects.toThrow();

    // Submitter zelf, ook niet-webmaster (zie test hierboven, hier nog
    // expliciet binnen dezelfde describe voor symmetrie met remove).
    await expect(
      withUser(t, "user_alice", "a@x.com").mutation(api.features.update, {
        featureId: id,
        title: "Hijack",
      }),
    ).rejects.toThrow();
  });
});

// Plan regel 504/511 — features.remove is webmaster-only. RED tot B's fix.
describe("features.remove — webmaster-only (audit-7 §4)", () => {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  it("webmaster kan andermans feature deleten", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);
    const id = await withUser(t, "user_alice", "a@x.com").mutation(
      api.features.create,
      {
        type: "feature",
        title: "X",
        description: "Y",
      },
    );

    await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
      api.features.remove,
      { featureId: id },
    );
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });

  it("submitter (niet webmaster) kan eigen feature NIET deleten", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const id = await withUser(t, "user_alice", "a@x.com").mutation(
      api.features.create,
      {
        type: "feature",
        title: "X",
        description: "Y",
      },
    );

    await expect(
      withUser(t, "user_alice", "a@x.com").mutation(api.features.remove, {
        featureId: id,
      }),
    ).rejects.toThrow();
  });

  // Cascade-gedrag blijft hetzelfde, alleen caller is nu webmaster.
  it("cascade featureUpvotes (door webmaster getriggerd)", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    await registerUser(t, "user_wm", WEBMASTER_EMAIL);
    const id = await withUser(t, "user_alice", "a@x.com").mutation(
      api.features.create,
      {
        type: "feature",
        title: "X",
        description: "Y",
      },
    );
    await withUser(t, "user_bob", "b@x.com").mutation(api.features.upvote, {
      featureId: id,
    });

    await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
      api.features.remove,
      { featureId: id },
    );

    const upvotes = await t.run((ctx) =>
      ctx.db
        .query("featureUpvotes")
        .withIndex("by_feature", (q) => q.eq("featureId", id))
        .collect(),
    );
    expect(upvotes).toHaveLength(0);
  });

  it("non-webmaster wordt geweigerd (zelfs submitter)", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const id = await withUser(t, "user_alice", "a@x.com").mutation(
      api.features.create,
      {
        type: "feature",
        title: "X",
        description: "Y",
      },
    );

    // Random andere user
    await expect(
      withUser(t, "user_bob", "b@x.com").mutation(api.features.remove, {
        featureId: id,
      }),
    ).rejects.toThrow();

    // Submitter zelf
    await expect(
      withUser(t, "user_alice", "a@x.com").mutation(api.features.remove, {
        featureId: id,
      }),
    ).rejects.toThrow();
  });
});

describe("features.list", () => {
  it("default: alle features", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");

    await withUser(t, "user_alice").mutation(api.features.create, {
      type: "feature",
      title: "F1",
      description: "x",
    });
    await withUser(t, "user_alice").mutation(api.features.create, {
      type: "problem",
      title: "P1",
      description: "x",
    });

    const list = await t.query(api.features.list, {});
    expect(list).toHaveLength(2);
  });

  it("filter op type", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");

    await withUser(t, "user_alice").mutation(api.features.create, {
      type: "feature",
      title: "F1",
      description: "x",
    });
    await withUser(t, "user_alice").mutation(api.features.create, {
      type: "problem",
      title: "P1",
      description: "x",
    });

    const features = await t.query(api.features.list, { type: "feature" });
    expect(features).toHaveLength(1);
    expect(features[0]?.title).toBe("F1");

    const problems = await t.query(api.features.list, { type: "problem" });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.title).toBe("P1");
  });
});
