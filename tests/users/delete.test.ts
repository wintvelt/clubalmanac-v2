import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";

// Cascade matrix rows U6, U7, U8: cat-3 cascade deletes vanuit users.deleteSelf.
// U6 = ratings, U7 = photos + queued storage cleanup action, U8 = memberships.

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

async function insertPhoto(
  t: ReturnType<typeof convexTest>,
  ownerId: Id<"users">,
) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["x"]));
    const photoId = await ctx.db.insert("photos", {
      ownerId,
      storageId,
      ratingCount: 0,
      createdAt: Date.now(),
    });
    return { photoId, storageId };
  });
}

describe("U6: deleteSelf cascade ratings", () => {
  it("verwijdert alle ratings van de user", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    const { photoId } = await insertPhoto(t, bobId);
    await t.run(async (ctx) => {
      await ctx.db.insert("ratings", {
        photoId,
        userId: aliceId,
        value: 4,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

    const remaining = await t.run((ctx) =>
      ctx.db
        .query("ratings")
        .withIndex("by_user", (q) => q.eq("userId", aliceId))
        .collect(),
    );
    expect(remaining).toHaveLength(0);
  });

  it("ratings van andere users blijven", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");

    const { photoId } = await insertPhoto(t, bobId);
    await t.run(async (ctx) => {
      await ctx.db.insert("ratings", {
        photoId,
        userId: aliceId,
        value: 4,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("ratings", {
        photoId,
        userId: carolId,
        value: 5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

    const carolRatings = await t.run((ctx) =>
      ctx.db
        .query("ratings")
        .withIndex("by_user", (q) => q.eq("userId", carolId))
        .collect(),
    );
    expect(carolRatings).toHaveLength(1);
  });
});

describe("U7: deleteSelf cascade photos + queued storage cleanup", () => {
  it("verwijdert photo records én cleant storage via scheduled action", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const { photoId, storageId } = await insertPhoto(t, aliceId);

      await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

      // Photo record meteen weg (transactioneel)
      const photo = await t.run((ctx) => ctx.db.get(photoId));
      expect(photo).toBeNull();

      // Run scheduled actions → cleanupStorage draait
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const urlAfter = await t.run((ctx) => ctx.storage.getUrl(storageId));
      expect(urlAfter).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("queue scheduled action per photo met juiste storage IDs", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const { storageId: s1 } = await insertPhoto(t, aliceId);
      const { storageId: s2 } = await insertPhoto(t, aliceId);

      await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

      // internalRemovePhoto schedulet één action per photo (i.p.v. batch).
      const scheduled = await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      expect(scheduled).toHaveLength(2);
      for (const entry of scheduled) {
        expect(entry.name).toContain("photos");
        expect(entry.name).toContain("cleanupStorage");
      }
      const allStorageIds = scheduled.flatMap(
        (entry) =>
          (entry.args as { storageIds: string[] }[])[0]?.storageIds ?? [],
      );
      expect(new Set(allStorageIds)).toEqual(new Set([s1, s2]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("photos van andere users blijven", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const { photoId: alicePhoto } = await insertPhoto(t, aliceId);
    const { photoId: bobPhoto } = await insertPhoto(t, bobId);

    await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

    expect(await t.run((ctx) => ctx.db.get(alicePhoto))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(bobPhoto))).not.toBeNull();
  });

  it("geen scheduled action wanneer user geen photos heeft", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");

    await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled).toHaveLength(0);
  });
});

describe("U9: deleteSelf cascade albumLastSeen", () => {
  it("verwijdert albumLastSeen records van de user", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: (await withUser(t, "user_bob").query(api.users.current, {}))!._id,
    });
    const albumId = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );

    await withUser(t, "user_alice").mutation(api.albums.markSeen, { albumId });
    await withUser(t, "user_bob").mutation(api.albums.markSeen, { albumId });

    const aliceUserId = (await withUser(t, "user_alice").query(
      api.users.current,
      {},
    ))!._id;

    await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

    const aliceRecords = await t.run((ctx) =>
      ctx.db
        .query("albumLastSeen")
        .withIndex("by_user", (q) => q.eq("userId", aliceUserId))
        .collect(),
    );
    expect(aliceRecords).toHaveLength(0);

    // Bob's record blijft (album is nog niet weg — alice was niet de
    // enige admin? In dit setup wel, dus M2 case (c) maakt bob admin).
    // We controleren puur dat bob's albumLastSeen record bestaat.
    const bobUserId = (await withUser(t, "user_bob").query(
      api.users.current,
      {},
    ))!._id;
    const bobRecords = await t.run((ctx) =>
      ctx.db
        .query("albumLastSeen")
        .withIndex("by_user", (q) => q.eq("userId", bobUserId))
        .collect(),
    );
    expect(bobRecords).toHaveLength(1);
  });
});

describe("U8: deleteSelf cascade memberships", () => {
  it("verwijdert alle memberships van de user", async () => {
    const t = convexTest(schema);
    const adminId = await registerUser(t, "user_admin", "admin@x.com");
    const aliceId = await registerUser(t, "user_alice", "a@x.com");

    // Admin maakt 2 groepen, voegt alice toe aan beide
    const g1 = await withUser(t, "user_admin").mutation(api.groups.create, {
      name: "G1",
    });
    const g2 = await withUser(t, "user_admin").mutation(api.groups.create, {
      name: "G2",
    });
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId: g1,
      userId: aliceId,
    });
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId: g2,
      userId: aliceId,
    });

    await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

    const remaining = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", aliceId))
        .collect(),
    );
    expect(remaining).toHaveLength(0);

    // Admin's memberships blijven
    const adminMemberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", adminId))
        .collect(),
    );
    expect(adminMemberships).toHaveLength(2);
  });
});
