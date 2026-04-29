import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
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
  return await withUser(t, subject).mutation(api.users.register, { email });
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

    const aps = await t.run((ctx) =>
      ctx.db
        .query("albumPhotos")
        .withIndex("by_photo", (q) => q.eq("photoId", photoId))
        .collect(),
    );
    expect(aps).toHaveLength(0);
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
