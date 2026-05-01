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

describe("AP3 ruimt ook orphan rating op van ex-member (Convex strikter dan AWS)", () => {
  // Verifieert het [GAP]-gedrag dat in convex/albums.ts boven de AP3-cascade
  // is gedocumenteerd: AWS groupPhotoDelToRating itereerde over current
  // group-members, dus een rating van een ex-member bleef hangen. Convex
  // itereert via by_photo en pakt orphan-rating wel mee. Cascade-matrix
  // row AP3 [GAP].
  it("verwijdert orphan rating + recompute aggregate", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
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

    // Bob verlaat de groep — rating-row blijft staan (M1/M2/M3 cascade
    // raakt ratings niet). Dit creëert de orphan situatie.
    await withUser(t, "user_alice").mutation(api.groups.removeMember, {
      groupId,
      userId: bobId,
    });

    await withUser(t, "user_alice").mutation(api.albums.removePhoto, {
      albumId,
      photoId,
    });

    const allRatings = await t.run((ctx) =>
      ctx.db.query("ratings").collect(),
    );
    const bobsRating = allRatings.filter((r) => r.userId === bobId);
    expect(bobsRating).toHaveLength(0);

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.ratingCount).toBe(0);
    expect(photo?.ratingAverage).toBeUndefined();
  });
});

describe("AP4 group-cover cleanup", () => {
  // Spec voor uitbreiding: AWS groupPhotoDelToCover.js regel 20-31 cleart
  // óók de group cover als de photo na unpublication geen publicaties meer
  // heeft in déze group. Cascade-matrix row AP4 moet uitgebreid worden om
  // dit gedrag te coveren. Tests zijn rood tot implementatie volgt.
  it("a: laatste publicatie weg → group.coverPhotoId cleared + album.coverPhotoId cleared", async () => {
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
    await withUser(t, "user_alice").mutation(api.groups.update, {
      groupId,
      coverPhotoId: photoId,
    });

    await withUser(t, "user_alice").mutation(api.albums.removePhoto, {
      albumId,
      photoId,
    });

    const album = await t.run((ctx) => ctx.db.get(albumId));
    expect(album?.coverPhotoId).toBeUndefined();

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.coverPhotoId).toBeUndefined();
  });

  it("b: photo nog in ander album in dezelfde groep → group.coverPhotoId ongewijzigd", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const album1 = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId, name: "A1" },
    );
    const album2 = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId, name: "A2" },
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
    await withUser(t, "user_alice").mutation(api.groups.update, {
      groupId,
      coverPhotoId: photoId,
    });

    await withUser(t, "user_alice").mutation(api.albums.removePhoto, {
      albumId: album1,
      photoId,
    });

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.coverPhotoId).toBe(photoId);
  });

  it("c: multi-group — clear in de groep waar laatste publicatie weg is, andere groep ongemoeid", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");

    const gG = await withUser(t, "user_alice").mutation(api.groups.create, {
      name: "G",
    });
    const gH = await withUser(t, "user_alice").mutation(api.groups.create, {
      name: "H",
    });
    const albumG = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId: gG, name: "AG" },
    );
    const albumH = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId: gH, name: "AH" },
    );

    const storageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );
    await withUser(t, "user_alice").mutation(api.albums.addPhoto, {
      albumId: albumG,
      photoId,
    });
    await withUser(t, "user_alice").mutation(api.albums.addPhoto, {
      albumId: albumH,
      photoId,
    });
    await withUser(t, "user_alice").mutation(api.groups.update, {
      groupId: gG,
      coverPhotoId: photoId,
    });
    await withUser(t, "user_alice").mutation(api.groups.update, {
      groupId: gH,
      coverPhotoId: photoId,
    });

    await withUser(t, "user_alice").mutation(api.albums.removePhoto, {
      albumId: albumG,
      photoId,
    });

    const groupG = await t.run((ctx) => ctx.db.get(gG));
    expect(groupG?.coverPhotoId).toBeUndefined();

    const groupH = await t.run((ctx) => ctx.db.get(gH));
    expect(groupH?.coverPhotoId).toBe(photoId);
  });
});
