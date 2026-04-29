import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Features (feature requests + problem reports) + upvoting.
// Niet in cascade-matrix (geen denormalization naar andere tables);
// pure CRUD met featureUpvotes als sub-resource.

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

describe("features.update", () => {
  it("submitter kan title/description aanpassen", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const id = await withUser(t, "user_alice").mutation(api.features.create, {
      type: "feature",
      title: "Oud",
      description: "oud",
    });

    await withUser(t, "user_alice").mutation(api.features.update, {
      featureId: id,
      title: "Nieuw",
      description: "nieuw",
    });

    const f = await t.run((ctx) => ctx.db.get(id));
    expect(f?.title).toBe("Nieuw");
    expect(f?.description).toBe("nieuw");
  });

  it("niet-submitter wordt geweigerd", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const id = await withUser(t, "user_alice").mutation(api.features.create, {
      type: "feature",
      title: "X",
      description: "Y",
    });

    await expect(
      withUser(t, "user_bob").mutation(api.features.update, {
        featureId: id,
        title: "Hijack",
      }),
    ).rejects.toThrow();
  });
});

describe("features.remove", () => {
  it("submitter kan eigen feature deleten", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const id = await withUser(t, "user_alice").mutation(api.features.create, {
      type: "feature",
      title: "X",
      description: "Y",
    });

    await withUser(t, "user_alice").mutation(api.features.remove, {
      featureId: id,
    });
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });

  it("cascade featureUpvotes", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const id = await withUser(t, "user_alice").mutation(api.features.create, {
      type: "feature",
      title: "X",
      description: "Y",
    });
    await withUser(t, "user_bob").mutation(api.features.upvote, {
      featureId: id,
    });

    await withUser(t, "user_alice").mutation(api.features.remove, {
      featureId: id,
    });

    const upvotes = await t.run((ctx) =>
      ctx.db
        .query("featureUpvotes")
        .withIndex("by_feature", (q) => q.eq("featureId", id))
        .collect(),
    );
    expect(upvotes).toHaveLength(0);
  });

  it("niet-submitter wordt geweigerd", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const id = await withUser(t, "user_alice").mutation(api.features.create, {
      type: "feature",
      title: "X",
      description: "Y",
    });

    await expect(
      withUser(t, "user_bob").mutation(api.features.remove, { featureId: id }),
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
