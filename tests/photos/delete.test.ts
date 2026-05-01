import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Cascade matrix rows P3, P4, P5, P7 — cat-3 cascade deletes (en
// selectief patches) vanuit photos.remove. Plus storage cleanup via
// scheduled cleanupStorage action.

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

async function uploadStorage(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.storage.store(new Blob(["x"])));
}

describe("P3: photos.remove cascade albumPhotos", () => {
  it("verwijdert albumPhotos die naar deze photo verwijzen", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_admin", "admin@x.com");
    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "G" },
    );
    const albumId = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );

    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_admin").mutation(
      api.photos.create,
      { storageId },
    );
    await withUser(t, "user_admin").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });

    await withUser(t, "user_admin").mutation(api.photos.remove, { photoId });

    // Verifieer via volle scan + filter, niet via by_photo index — anders
    // zou een productie-bug in index-gebruik door een test met zelfde
    // index niet ontdekt worden.
    const aps = await t.run((ctx) =>
      ctx.db.query("albumPhotos").collect(),
    );
    expect(aps.filter((p) => p.photoId === photoId)).toHaveLength(0);
  });

  it("cascadet over meerdere albums in meerdere groepen", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_admin", "admin@x.com");
    const groupA = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "GA" },
    );
    const groupB = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "GB" },
    );
    const albumA1 = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId: groupA, name: "A1" },
    );
    const albumA2 = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId: groupA, name: "A2" },
    );
    const albumB1 = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId: groupB, name: "B1" },
    );

    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_admin").mutation(
      api.photos.create,
      { storageId },
    );

    await withUser(t, "user_admin").mutation(api.albums.addPhoto, {
      albumId: albumA1,
      photoId,
    });
    await withUser(t, "user_admin").mutation(api.albums.addPhoto, {
      albumId: albumA2,
      photoId,
    });
    await withUser(t, "user_admin").mutation(api.albums.addPhoto, {
      albumId: albumB1,
      photoId,
    });

    // Sanity: 3 publicaties bestaan vóór de delete (volle scan + filter).
    const before = await t.run((ctx) =>
      ctx.db.query("albumPhotos").collect(),
    );
    expect(before.filter((p) => p.photoId === photoId)).toHaveLength(3);

    // Andere photo in dezelfde groepen om te bewijzen dat we niet te veel cascadet.
    const otherStorage = await uploadStorage(t);
    const otherPhoto = await withUser(t, "user_admin").mutation(
      api.photos.create,
      { storageId: otherStorage },
    );
    await withUser(t, "user_admin").mutation(api.albums.addPhoto, {
      albumId: albumA1,
      photoId: otherPhoto,
    });

    await withUser(t, "user_admin").mutation(api.photos.remove, { photoId });

    // Verifieer via volle scan + filter — vermijd shared bias met productie
    // by_photo index.
    const after = await t.run((ctx) =>
      ctx.db.query("albumPhotos").collect(),
    );
    expect(after.filter((p) => p.photoId === photoId)).toHaveLength(0);
    // Andere photo blijft gepubliceerd.
    expect(after.filter((p) => p.photoId === otherPhoto)).toHaveLength(1);
  });
});

describe("P4: photos.remove cascade ratings", () => {
  it("verwijdert ratings op deze photo", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );

    await t.run(async (ctx) => {
      await ctx.db.insert("ratings", {
        photoId,
        userId: bobId,
        value: 4,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await withUser(t, "user_alice").mutation(api.photos.remove, { photoId });

    const ratings = await t.run((ctx) =>
      ctx.db
        .query("ratings")
        .withIndex("by_photo", (q) => q.eq("photoId", photoId))
        .collect(),
    );
    expect(ratings).toHaveLength(0);

    // Ratings van bob op andere foto's blijven (sanity)
    const bobRatings = await t.run((ctx) =>
      ctx.db
        .query("ratings")
        .withIndex("by_user", (q) => q.eq("userId", bobId))
        .collect(),
    );
    expect(bobRatings).toHaveLength(0); // bob had alleen deze rating
    void aliceId;
  });
});

describe("P5: photos.remove clear cover-refs", () => {
  it("clear groups.coverPhotoId wanneer deze photo cover was", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_admin", "admin@x.com");
    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "G" },
    );

    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_admin").mutation(
      api.photos.create,
      { storageId },
    );
    await withUser(t, "user_admin").mutation(api.groups.update, {
      groupId,
      coverPhotoId: photoId,
    });

    await withUser(t, "user_admin").mutation(api.photos.remove, { photoId });

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.coverPhotoId).toBeUndefined();
  });

  it("clear albums.coverPhotoId wanneer deze photo cover was", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_admin", "admin@x.com");
    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "G" },
    );
    const albumId = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );

    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_admin").mutation(
      api.photos.create,
      { storageId },
    );
    await withUser(t, "user_admin").mutation(api.albums.update, {
      albumId,
      coverPhotoId: photoId,
    });

    await withUser(t, "user_admin").mutation(api.photos.remove, { photoId });

    const album = await t.run((ctx) => ctx.db.get(albumId));
    expect(album?.coverPhotoId).toBeUndefined();
  });

  it("laat covers van andere photos ongemoeid", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_admin", "admin@x.com");
    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "G" },
    );

    const s1 = await uploadStorage(t);
    const s2 = await uploadStorage(t);
    const cover1 = await withUser(t, "user_admin").mutation(
      api.photos.create,
      { storageId: s1 },
    );
    const cover2 = await withUser(t, "user_admin").mutation(
      api.photos.create,
      { storageId: s2 },
    );

    await withUser(t, "user_admin").mutation(api.groups.update, {
      groupId,
      coverPhotoId: cover2,
    });

    // delete cover1 — cover van groep moet cover2 blijven
    await withUser(t, "user_admin").mutation(api.photos.remove, {
      photoId: cover1,
    });

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.coverPhotoId).toBe(cover2);
  });

  it("clear covers van 2 groepen + 1 album tegelijk", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_admin", "admin@x.com");
    const groupA = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "GA" },
    );
    const groupB = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "GB" },
    );
    const albumA = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId: groupA, name: "A" },
    );

    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_admin").mutation(
      api.photos.create,
      { storageId },
    );

    await withUser(t, "user_admin").mutation(api.groups.update, {
      groupId: groupA,
      coverPhotoId: photoId,
    });
    await withUser(t, "user_admin").mutation(api.groups.update, {
      groupId: groupB,
      coverPhotoId: photoId,
    });
    await withUser(t, "user_admin").mutation(api.albums.update, {
      albumId: albumA,
      coverPhotoId: photoId,
    });

    await withUser(t, "user_admin").mutation(api.photos.remove, { photoId });

    // Volle scan + filter — vermijd shared bias met (eventuele toekomstige)
    // by_cover index die in productie-code gebruikt zou worden.
    const groupsAfter = await t.run((ctx) => ctx.db.query("groups").collect());
    expect(
      groupsAfter.filter((g) => g.coverPhotoId === photoId),
    ).toHaveLength(0);

    const albumsAfter = await t.run((ctx) => ctx.db.query("albums").collect());
    expect(
      albumsAfter.filter((a) => a.coverPhotoId === photoId),
    ).toHaveLength(0);
  });

  it("album-asymmetrie: alleen matching album cover cleared", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_admin", "admin@x.com");
    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "G" },
    );
    const albumX = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "X" },
    );
    const albumY = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "Y" },
    );

    const sA = await uploadStorage(t);
    const sB = await uploadStorage(t);
    const photoA = await withUser(t, "user_admin").mutation(
      api.photos.create,
      { storageId: sA },
    );
    const photoB = await withUser(t, "user_admin").mutation(
      api.photos.create,
      { storageId: sB },
    );

    await withUser(t, "user_admin").mutation(api.albums.update, {
      albumId: albumX,
      coverPhotoId: photoA,
    });
    await withUser(t, "user_admin").mutation(api.albums.update, {
      albumId: albumY,
      coverPhotoId: photoB,
    });

    await withUser(t, "user_admin").mutation(api.photos.remove, {
      photoId: photoA,
    });

    // Volle scan + filter — parallel met group-asymmetrie test.
    const albumsAfter = await t.run((ctx) => ctx.db.query("albums").collect());
    const x = albumsAfter.find((a) => a._id === albumX);
    const y = albumsAfter.find((a) => a._id === albumY);
    expect(x?.coverPhotoId).toBeUndefined();
    expect(y?.coverPhotoId).toBe(photoB);
  });
});

describe("P7: photos.remove decrement user.photoCount", () => {
  it("verlaagt photoCount na elke delete", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");

    const s1 = await uploadStorage(t);
    const s2 = await uploadStorage(t);
    const p1 = await withUser(t, "user_alice").mutation(api.photos.create, {
      storageId: s1,
    });
    await withUser(t, "user_alice").mutation(api.photos.create, {
      storageId: s2,
    });

    expect((await t.run((ctx) => ctx.db.get(aliceId)))?.photoCount).toBe(2);

    await withUser(t, "user_alice").mutation(api.photos.remove, {
      photoId: p1,
    });
    expect((await t.run((ctx) => ctx.db.get(aliceId)))?.photoCount).toBe(1);
  });
});

describe("photos.remove op geflagde photo (audit-9 §8.4)", () => {
  // Audit-9 design-keuze: owner heeft altijd recht eigen content te
  // verwijderen, ook als die geflagd is. Flag-doel = content removal,
  // owner doet 't dan zelf. Cascade ruimt flag-state automatisch op
  // (flag-velden zitten op de photo zelf — geen aparte flag-records),
  // FL1-cron vindt na deletion vanzelf niets meer (photo + index-entries
  // weg). Acceptable bypass; geen aparte gate nodig.
  it("owner kan eigen geflagde photo verwijderen, cascade + flag-state vervallen", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      await registerUser(t, "user_bob", "b@x.com");

      const storageId = await uploadStorage(t);
      const photoId = await withUser(t, "user_alice").mutation(
        api.photos.create,
        { storageId },
      );

      // Bob flagt alice's photo — flag-state op photo gezet.
      await withUser(t, "user_bob").mutation(api.photos.flag, { photoId });
      const flagged = await t.run((ctx) => ctx.db.get(photoId));
      expect(typeof flagged?.flaggedAt).toBe("number");
      expect(typeof flagged?.flaggedDeleteDate).toBe("number");

      const beforeCount = (await t.run((ctx) => ctx.db.get(aliceId)))!
        .photoCount;

      // Alice verwijdert eigen photo, ondanks de flag.
      await withUser(t, "user_alice").mutation(api.photos.remove, { photoId });

      // Photo record weg.
      expect(await t.run((ctx) => ctx.db.get(photoId))).toBeNull();
      // P7: photoCount gedecrement.
      const afterCount = (await t.run((ctx) => ctx.db.get(aliceId)))!
        .photoCount;
      expect(afterCount).toBe(beforeCount - 1);

      // Flag-state vervalt automatisch — geen orphan records elders. Volle
      // scan: er bestaat geen aparte flag-tabel, flag-velden zitten op
      // photo zelf. Index-entries van by_flagged en by_flagged_delete
      // verdwijnen mee met de photo.
      const allPhotos = await t.run((ctx) => ctx.db.query("photos").collect());
      expect(allPhotos.find((p) => p._id === photoId)).toBeUndefined();

      // FL1-cron na deletion is no-op: de photo zit niet meer in de index.
      await expect(
        t.mutation(internal.photos.cleanupFlaggedPhotos, {}),
      ).resolves.not.toThrow();

      // Storage opgeruimd door queued action.
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const url = await t.run((ctx) => ctx.storage.getUrl(storageId));
      expect(url).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("photos.remove + storage cleanup", () => {
  it("storage wordt opgeruimd via scheduled cleanupStorage action", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      await registerUser(t, "user_alice", "a@x.com");
      const storageId = await uploadStorage(t);
      const photoId = await withUser(t, "user_alice").mutation(
        api.photos.create,
        { storageId },
      );

      await withUser(t, "user_alice").mutation(api.photos.remove, { photoId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const url = await t.run((ctx) => ctx.storage.getUrl(storageId));
      expect(url).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
