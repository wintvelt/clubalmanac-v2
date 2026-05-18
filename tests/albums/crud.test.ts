import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api , internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";

// Fase 2 — Albums domein: CRUD + album-photo relaties.

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

/**
 * Setup: admin maakt groep aan, voegt bob (member) en carol (member) toe.
 * Albums worden door members aangemaakt → creator-rol is niet altijd admin.
 */
async function setupGroupWithMembers(t: ReturnType<typeof convexTest>) {
  const adminId = await registerUser(t, "user_admin", "admin@x.com");
  const bobId = await registerUser(t, "user_bob", "bob@x.com");
  const carolId = await registerUser(t, "user_carol", "carol@x.com");

  const groupId = await withUser(t, "user_admin").mutation(api.groups.create, {
    name: "Groep",
  });
  await withUser(t, "user_admin").mutation(api.groups.addMember, {
    groupId,
    userId: bobId,
  });
  await withUser(t, "user_admin").mutation(api.groups.addMember, {
    groupId,
    userId: carolId,
  });

  return { adminId, bobId, carolId, groupId };
}

async function insertPhoto(
  t: ReturnType<typeof convexTest>,
  ownerId: Id<"users">,
) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["x"]));
    return await ctx.db.insert("photos", {
      ownerId,
      storageId,
      ratingCount: 0,
      createdAt: Date.now(),
    });
  });
}

describe("albums.create", () => {
  it("weigert zonder auth", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroupWithMembers(t);
    await expect(
      t.mutation(api.albums.create, { groupId, name: "X" }),
    ).rejects.toThrow();
  });

  it("weigert wanneer caller geen lid van groep is", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroupWithMembers(t);
    await registerUser(t, "user_outsider", "out@x.com");
    await expect(
      withUser(t, "user_outsider").mutation(api.albums.create, {
        groupId,
        name: "X",
      }),
    ).rejects.toThrow();
  });

  it("lid kan album maken; createdBy = caller", async () => {
    const t = convexTest(schema);
    const { bobId, groupId } = await setupGroupWithMembers(t);

    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "Vakantie",
      description: "zomer",
    });

    const album = await t.run((ctx) => ctx.db.get(albumId));
    expect(album?.name).toBe("Vakantie");
    expect(album?.description).toBe("zomer");
    expect(album?.createdBy).toBe(bobId);
    expect(album?.groupId).toBe(groupId);
    expect(typeof album?.createdAt).toBe("number");
  });
});

describe("albums.getById", () => {
  it("lid kan album opvragen", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    const got = await withUser(t, "user_carol").query(api.albums.getById, {
      albumId,
    });
    expect(got?._id).toBe(albumId);
  });

  it("niet-lid wordt geweigerd", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    await registerUser(t, "user_outsider", "out@x.com");
    await expect(
      withUser(t, "user_outsider").query(api.albums.getById, { albumId }),
    ).rejects.toThrow();
  });
});

describe("albums.listByGroup", () => {
  it("lid ziet alle albums in groep", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroupWithMembers(t);
    await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A1",
    });
    await withUser(t, "user_carol").mutation(api.albums.create, {
      groupId,
      name: "A2",
    });

    const list = await withUser(t, "user_admin").query(
      api.albums.listByGroup,
      { groupId },
    );
    expect(list).toHaveLength(2);
    expect(list.map((a) => a.name).sort()).toEqual(["A1", "A2"]);
  });

  it("niet-lid wordt geweigerd", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroupWithMembers(t);
    await registerUser(t, "user_outsider", "out@x.com");
    await expect(
      withUser(t, "user_outsider").query(api.albums.listByGroup, { groupId }),
    ).rejects.toThrow();
  });
});

describe("albums.update", () => {
  it("creator (member) kan zijn album updaten", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });

    await withUser(t, "user_bob").mutation(api.albums.update, {
      albumId,
      name: "B",
      description: "beschrijving",
    });

    const got = await t.run((ctx) => ctx.db.get(albumId));
    expect(got?.name).toBe("B");
    expect(got?.description).toBe("beschrijving");
  });

  it("groep-admin kan album updaten ook al is hij niet creator", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });

    await withUser(t, "user_admin").mutation(api.albums.update, {
      albumId,
      name: "Door admin",
    });

    const got = await t.run((ctx) => ctx.db.get(albumId));
    expect(got?.name).toBe("Door admin");
  });

  it("ander member (niet creator, niet admin) kan niet updaten", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });

    await expect(
      withUser(t, "user_carol").mutation(api.albums.update, {
        albumId,
        name: "X",
      }),
    ).rejects.toThrow();
  });

  it("coverPhotoId kan gezet worden", async () => {
    const t = convexTest(schema);
    const { bobId, groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    const photoId = await insertPhoto(t, bobId);

    await withUser(t, "user_bob").mutation(api.albums.update, {
      albumId,
      coverPhotoId: photoId,
    });

    const got = await t.run((ctx) => ctx.db.get(albumId));
    expect(got?.coverPhotoId).toBe(photoId);
  });
});

describe("albums.remove", () => {
  it("creator kan album deleten", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });

    await withUser(t, "user_bob").mutation(api.albums.remove, { albumId });

    const got = await t.run((ctx) => ctx.db.get(albumId));
    expect(got).toBeNull();
  });

  it("group-admin kan elk album in zijn groep deleten", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });

    await withUser(t, "user_admin").mutation(api.albums.remove, { albumId });

    const got = await t.run((ctx) => ctx.db.get(albumId));
    expect(got).toBeNull();
  });

  it("ander member kan niet deleten", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });

    await expect(
      withUser(t, "user_carol").mutation(api.albums.remove, { albumId }),
    ).rejects.toThrow();
  });

  it("cascade albumPhotos", async () => {
    const t = convexTest(schema);
    const { bobId, groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    const photoId = await insertPhoto(t, bobId);
    await withUser(t, "user_bob").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });

    await withUser(t, "user_bob").mutation(api.albums.remove, { albumId });

    const remaining = await t.run((ctx) =>
      ctx.db
        .query("albumPhotos")
        .withIndex("by_album", (q) => q.eq("albumId", albumId))
        .collect(),
    );
    expect(remaining).toHaveLength(0);

    // photo zelf blijft
    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo).not.toBeNull();
  });
});

describe("albums.addPhoto", () => {
  it("lid kan photo aan album toevoegen", async () => {
    const t = convexTest(schema);
    const { bobId, groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    const photoId = await insertPhoto(t, bobId);

    await withUser(t, "user_bob").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });

    const ap = await t.run((ctx) =>
      ctx.db
        .query("albumPhotos")
        .withIndex("by_album", (q) => q.eq("albumId", albumId))
        .unique(),
    );
    expect(ap?.photoId).toBe(photoId);
    expect(ap?.addedBy).toBe(bobId);
    expect(ap?.groupId).toBe(groupId);
    expect(typeof ap?.addedAt).toBe("number");
  });

  it("niet-lid wordt geweigerd", async () => {
    const t = convexTest(schema);
    const { bobId, groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    const photoId = await insertPhoto(t, bobId);

    await registerUser(t, "user_outsider", "out@x.com");
    await expect(
      withUser(t, "user_outsider").mutation(api.albums.addPhoto, {
        albumId,
        photoId,
      }),
    ).rejects.toThrow();
  });

  it("weigert dubbel toevoegen (zelfde photo)", async () => {
    const t = convexTest(schema);
    const { bobId, groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    const photoId = await insertPhoto(t, bobId);

    await withUser(t, "user_bob").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });
    await expect(
      withUser(t, "user_bob").mutation(api.albums.addPhoto, {
        albumId,
        photoId,
      }),
    ).rejects.toThrow();
  });

  it("weigert photo dat niet bestaat", async () => {
    const t = convexTest(schema);
    const { bobId, groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    // maak en delete photo om geldige stale id te krijgen
    const photoId = await insertPhoto(t, bobId);
    await t.run((ctx) => ctx.db.delete(photoId));

    await expect(
      withUser(t, "user_bob").mutation(api.albums.addPhoto, {
        albumId,
        photoId,
      }),
    ).rejects.toThrow();
  });
});

describe("albums.removePhoto", () => {
  it("addedBy kan zijn eigen toevoeging verwijderen", async () => {
    const t = convexTest(schema);
    const { bobId, groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    const photoId = await insertPhoto(t, bobId);
    await withUser(t, "user_bob").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });

    await withUser(t, "user_bob").mutation(api.albums.removePhoto, {
      albumId,
      photoId,
    });

    const ap = await t.run((ctx) =>
      ctx.db
        .query("albumPhotos")
        .withIndex("by_album", (q) => q.eq("albumId", albumId))
        .collect(),
    );
    expect(ap).toHaveLength(0);
  });

  it("group-admin kan elke albumPhoto verwijderen", async () => {
    const t = convexTest(schema);
    const { bobId, groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    const photoId = await insertPhoto(t, bobId);
    await withUser(t, "user_bob").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });

    await withUser(t, "user_admin").mutation(api.albums.removePhoto, {
      albumId,
      photoId,
    });

    const ap = await t.run((ctx) =>
      ctx.db
        .query("albumPhotos")
        .withIndex("by_album", (q) => q.eq("albumId", albumId))
        .collect(),
    );
    expect(ap).toHaveLength(0);
  });

  it("ander member (niet addedBy, niet admin) kan niet verwijderen", async () => {
    const t = convexTest(schema);
    const { bobId, groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    const photoId = await insertPhoto(t, bobId);
    await withUser(t, "user_bob").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });

    await expect(
      withUser(t, "user_carol").mutation(api.albums.removePhoto, {
        albumId,
        photoId,
      }),
    ).rejects.toThrow();
  });
});

describe("albums.listPhotos", () => {
  it("lid ziet album photos met photo data", async () => {
    const t = convexTest(schema);
    const { bobId, groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    const photoId = await insertPhoto(t, bobId);
    await withUser(t, "user_bob").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });

    const list = await withUser(t, "user_carol").query(api.albums.listPhotos, {
      albumId,
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.photo?._id).toBe(photoId);
    expect(list[0]?.albumPhoto.albumId).toBe(albumId);
  });

  it("niet-lid wordt geweigerd", async () => {
    const t = convexTest(schema);
    const { bobId, groupId } = await setupGroupWithMembers(t);
    const albumId = await withUser(t, "user_bob").mutation(api.albums.create, {
      groupId,
      name: "A",
    });
    const photoId = await insertPhoto(t, bobId);
    await withUser(t, "user_bob").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });

    await registerUser(t, "user_outsider", "out@x.com");
    await expect(
      withUser(t, "user_outsider").query(api.albums.listPhotos, { albumId }),
    ).rejects.toThrow();
  });
});
