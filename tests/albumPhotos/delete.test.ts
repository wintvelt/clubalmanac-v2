import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Cascade matrix rows AP3, AP4 — cat-3 selectief vanuit albums.removePhoto
// (= GP delete trigger). AP1 + AP2 (seenPics) zijn deferred, zie matrix
// "Open design decisions".

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

describe("AP3: removePhoto cascade ratings van group members", () => {
  it("verwijdert ratings van group members op deze photo", async () => {
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

    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 4,
    });

    await withUser(t, "user_alice").mutation(api.albums.removePhoto, {
      albumId,
      photoId,
    });

    const remaining = await t.run((ctx) =>
      ctx.db
        .query("ratings")
        .withIndex("by_photo", (q) => q.eq("photoId", photoId))
        .collect(),
    );
    expect(remaining).toHaveLength(0);
    void aliceId;
  });

  it("herrekent photo.rating aggregate na cascade", async () => {
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

    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 3,
    });
    expect((await t.run((ctx) => ctx.db.get(photoId)))?.ratingCount).toBe(1);

    await withUser(t, "user_alice").mutation(api.albums.removePhoto, {
      albumId,
      photoId,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.ratingCount).toBe(0);
    expect(photo?.ratingAverage).toBeUndefined();
    void aliceId;
  });

  it("rating blijft wanneer rater nog access heeft via andere group", async () => {
    // Alice owner. Photo gepubliceerd in album_g1 (group G1, members alice+bob)
    // en album_g2 (group G2, members alice+bob). Bob rate. Verwijder publicatie
    // uit G1 → Bob heeft nog access via G2, dus rating moet blijven.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    const g1 = await withUser(t, "user_alice").mutation(api.groups.create, {
      name: "G1",
    });
    const g2 = await withUser(t, "user_alice").mutation(api.groups.create, {
      name: "G2",
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId: g1,
      userId: bobId,
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId: g2,
      userId: bobId,
    });

    const album1 = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId: g1, name: "A1" },
    );
    const album2 = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId: g2, name: "A2" },
    );

    const storageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );
    await withUser(t, "user_alice").mutation(api.albums.addPhoto, {
      albumId: album1,
      photoId,
    });
    await withUser(t, "user_alice").mutation(api.albums.addPhoto, {
      albumId: album2,
      photoId,
    });

    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 4,
    });

    await withUser(t, "user_alice").mutation(api.albums.removePhoto, {
      albumId: album1,
      photoId,
    });

    const remaining = await t.run((ctx) =>
      ctx.db
        .query("ratings")
        .withIndex("by_photo", (q) => q.eq("photoId", photoId))
        .collect(),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.userId).toBe(bobId);

    // Aggregate ongewijzigd
    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.ratingCount).toBe(1);
    expect(photo?.ratingAverage).toBe(4);
  });

  it("owner's rating wordt nooit gedropt door cascade", async () => {
    // Edge case: theoretisch kan een owner zijn eigen photo raten. Even
    // als de laatste publicatie weggaat, owner houdt eigen rating —
    // hij heeft direct access als owner.
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

    // Alice rated haar eigen photo (rating-mutation laat dit toe).
    await withUser(t, "user_alice").mutation(api.ratings.upsert, {
      photoId,
      value: 5,
    });

    await withUser(t, "user_alice").mutation(api.albums.removePhoto, {
      albumId,
      photoId,
    });

    const remaining = await t.run((ctx) =>
      ctx.db
        .query("ratings")
        .withIndex("by_photo", (q) => q.eq("photoId", photoId))
        .collect(),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.userId).toBe(aliceId);
  });
});

describe("AP4: removePhoto clear album cover", () => {
  it("clear album.coverPhotoId wanneer deze publicatie cover was", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");

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
    await withUser(t, "user_alice").mutation(api.albums.update, {
      albumId,
      coverPhotoId: photoId,
    });

    await withUser(t, "user_alice").mutation(api.albums.removePhoto, {
      albumId,
      photoId,
    });

    const album = await t.run((ctx) => ctx.db.get(albumId));
    expect(album?.coverPhotoId).toBeUndefined();
  });

  it("laat cover ongemoeid wanneer een andere photo verwijderd wordt", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const albumId = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );

    const s1 = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["a"])),
    );
    const s2 = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["b"])),
    );
    const cover = await withUser(t, "user_alice").mutation(api.photos.create, {
      storageId: s1,
    });
    const other = await withUser(t, "user_alice").mutation(api.photos.create, {
      storageId: s2,
    });
    await withUser(t, "user_alice").mutation(api.albums.addPhoto, {
      albumId,
      photoId: cover,
    });
    await withUser(t, "user_alice").mutation(api.albums.addPhoto, {
      albumId,
      photoId: other,
    });
    await withUser(t, "user_alice").mutation(api.albums.update, {
      albumId,
      coverPhotoId: cover,
    });

    await withUser(t, "user_alice").mutation(api.albums.removePhoto, {
      albumId,
      photoId: other,
    });

    const album = await t.run((ctx) => ctx.db.get(albumId));
    expect(album?.coverPhotoId).toBe(cover);
  });
});
