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

describe("U9 (eliminated) — albumLastSeen cleanup gedekt door M3 via U8", () => {
  // U9 is geen aparte cascade meer (cat-1 eliminated, zoals U1/U2/U5). Na de
  // U8-refactor cleant M3 albumLastSeen transitief: U8 deletet per membership
  // van de gedeleted user via internalRemoveMember, en M3 binnen die helper
  // ruimt (userId × albums in déze group) op. Daarmee dekt M3 alle
  // albumLastSeen records van de gedeleted user — er is geen restpad meer
  // dat een aparte deleteAlbumLastSeenByUser-helper nodig zou maken.
  //
  // Deze test is een belt-and-suspenders integration-check, geen
  // U9-specifieke unit-test. M3-zelf wordt geünit-test in
  // tests/memberships/delete.test.ts (describe "M3").
  it("geen albumLastSeen records meer voor gedeleted user (transitief via M3)", async () => {
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

    // Bob's albumLastSeen record blijft staan: M3 ruimt alleen records van
    // de vertrekkende user op (alice), niet die van andere group-leden.
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

describe("U10: deleteSelf clear flaggedBy refs", () => {
  // Cascade-matrix row U10 (nieuw, niet uit AWS). Default keuze: flag-state
  // blijft op photo, alleen flaggedBy wordt undefined zodat we geen orphan
  // ref hebben. Owner van photo en deletion countdown ongewijzigd.
  it("clear flaggedBy op photos die deze user heeft geflagd, laat flag-state intact", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    // Bob's photo, geflagged door alice (direct ingevoegd, omdat dit
    // testbestand niet afhangt van photos.flag mutation).
    const flaggedPhoto = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["x"]));
      const flaggedAt = Date.now();
      return await ctx.db.insert("photos", {
        ownerId: bobId,
        storageId,
        ratingCount: 0,
        createdAt: flaggedAt,
        flaggedAt,
        flaggedBy: aliceId,
        flaggedDeleteDate: flaggedAt + 14 * 24 * 60 * 60 * 1000,
      });
    });

    const before = await t.run((ctx) => ctx.db.get(flaggedPhoto));
    const originalFlaggedAt = before?.flaggedAt;
    const originalDeleteDate = before?.flaggedDeleteDate;

    await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

    const after = await t.run((ctx) => ctx.db.get(flaggedPhoto));
    expect(after).not.toBeNull();
    expect(after?.ownerId).toBe(bobId);
    expect(after?.flaggedAt).toBe(originalFlaggedAt);
    expect(after?.flaggedDeleteDate).toBe(originalDeleteDate);
    expect(after?.flaggedBy).toBeUndefined();
  });

  it("photos die alice niet heeft geflagged blijven onaangeroerd", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");

    // photo van bob geflagged door carol (niet alice)
    const carolFlagged = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["x"]));
      const t0 = Date.now();
      return await ctx.db.insert("photos", {
        ownerId: bobId,
        storageId,
        ratingCount: 0,
        createdAt: t0,
        flaggedAt: t0,
        flaggedBy: carolId,
        flaggedDeleteDate: t0 + 14 * 24 * 60 * 60 * 1000,
      });
    });

    await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

    const after = await t.run((ctx) => ctx.db.get(carolFlagged));
    expect(after?.flaggedBy).toBe(carolId);
    void aliceId;
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

describe("U8 — M2 cascade (transitief vanuit deleteSelf)", () => {
  // cascade-matrix.md U8 row (audit-bevinding 2026-04-30): elk membership
  // delete moet de M2-keten draaien, niet alleen de UM record verwijderen.
  // Oude AWS dispatchte dit transitief: userDelToMemberships.js verwijderde
  // memberships, en mainStream.js:155 (UM REMOVE) triggerde cleanGroupMembers
  // (= memberDelToGroup) per delete. Convex moet dezelfde keten inline draaien.

  it("M2-c: enige admin deletet zichzelf met members nog over → resterende members worden admin", async () => {
    // cascade-matrix.md M2 (c) — !hasOtherAdmin pad.
    // memberDelToGroup.js:19-32 → alle members krijgen role admin.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });

    await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

    const aliceMem = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", aliceId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(aliceMem).toBeNull();

    const bobMem = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(bobMem).not.toBeNull();
    expect(bobMem?.role).toBe("admin");
  });

  it("M2-d: founder deletet zichzelf met andere admins → oudste admin wordt nieuwe founder, geen orphan createdBy", async () => {
    // cascade-matrix.md M2 (d) — hasOtherAdmin && noFounderleft pad.
    // memberDelToGroup.js:33-37 → die admin krijgt isFounder. Convex sorteert
    // op joinedAt asc voor determinisme.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const charlieId = await registerUser(t, "user_charlie", "c@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
      role: "admin",
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: charlieId,
      role: "admin",
    });

    // Patch joinedAt expliciet: bob ouder dan charlie, los van insertie-tijd.
    await t.run(async (ctx) => {
      const all = await ctx.db
        .query("memberships")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect();
      for (const m of all) {
        if (m.userId === bobId) await ctx.db.patch(m._id, { joinedAt: 200 });
        if (m.userId === charlieId)
          await ctx.db.patch(m._id, { joinedAt: 300 });
      }
    });

    await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

    const aliceMem = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", aliceId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(aliceMem).toBeNull();

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group).not.toBeNull();
    expect(group?.createdBy).not.toBe(aliceId);
    expect(group?.createdBy).toBe(bobId);
  });

  it("M2-e: enige lid deletet zichzelf → group + albums + albumPhotos cascade volledig", async () => {
    // cascade-matrix.md M2 (e) — laatste lid weg.
    // memberDelToGroup.js:39-43 → groupKey delete. Convex breidt uit met
    // albums + albumPhotos in dezelfde transactie (zie groups.removeMember).
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const albumId = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );

    const storageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );
    await withUser(t, "user_alice").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });

    await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});

    const aliceMem = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", aliceId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(aliceMem).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(groupId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(albumId))).toBeNull();

    const aps = await t.run((ctx) =>
      ctx.db
        .query("albumPhotos")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect(),
    );
    expect(aps).toHaveLength(0);
  });
});
