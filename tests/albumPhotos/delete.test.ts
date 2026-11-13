import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api , internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { modules } from "../_helpers/modules";
import { seedMember } from "../_helpers/membership";

// Cascade matrix row AP4 — cat-3 selectief vanuit albums.removePhoto
// (AP3, de ratings, viel weg met WP19a)
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
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      subject,
      email: email.toLowerCase().trim(),
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    }),
  );
}

describe("AP4: removePhoto clear album cover", () => {
  it("clear album.coverPhotoId wanneer deze publicatie cover was", async () => {
    const t = convexTest(schema, modules);
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
      internal.photos.create,
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
    const t = convexTest(schema, modules);
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
    const cover = await withUser(t, "user_alice").mutation(internal.photos.create, {
      storageId: s1,
    });
    const other = await withUser(t, "user_alice").mutation(internal.photos.create, {
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

describe("AP4 group-cover cleanup", () => {
  // Spec voor uitbreiding: AWS groupPhotoDelToCover.js regel 20-31 cleart
  // óók de group cover als de photo na unpublication geen publicaties meer
  // heeft in déze group. Cascade-matrix row AP4 moet uitgebreid worden om
  // dit gedrag te coveren. Tests zijn rood tot implementatie volgt.
  it("a: laatste publicatie weg → group.coverPhotoId cleared + album.coverPhotoId cleared", async () => {
    const t = convexTest(schema, modules);
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
      internal.photos.create,
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
    const t = convexTest(schema, modules);
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
      internal.photos.create,
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
    const t = convexTest(schema, modules);
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
      internal.photos.create,
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
