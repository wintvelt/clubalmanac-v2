import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api , internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { assertReactive } from "../_helpers/reactive";
import { modules } from "../_helpers/modules";

// Cascade matrix rows P1, P2: cat-1 (eliminated) + cat-4 (reactive coverage).
// Verifieert dat join-on-read queries fresh photo-data returneren na een
// photos.update mutation. Vervangt `photoChangeToPub` (P1) en
// `photoChangeToCover` (P2). WP17d A-invariant 4: photos.update zet geen
// plaatsnaam meer, dus deze tests gebruiken takenAt.

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

async function uploadStorage(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.storage.store(new Blob(["x"])));
}

describe("P1: albumPhoto query joint photo-data fresh", () => {
  it("albums.listPhotos toont nieuwe takenAt direct na update", async () => {
    const t = convexTest(schema, modules);
    await registerUser(t, "user_admin", "admin@x.com");
    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "Groep" },
    );
    const albumId = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "Album" },
    );

    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_admin").mutation(
      internal.photos.create,
      { storageId, takenAt: 1_000 },
    );
    await withUser(t, "user_admin").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });

    const { before, after } = await assertReactive(
      () =>
        withUser(t, "user_admin").query(api.albums.listPhotos, { albumId }),
      () =>
        withUser(t, "user_admin").mutation(api.photos.update, {
          photoId,
          takenAt: 2_000,
        }),
    );

    expect(before[0]?.photo?.takenAt).toBe(1_000);
    expect(after[0]?.photo?.takenAt).toBe(2_000);
  });
});

describe("P2: cover query joint photo-data fresh", () => {
  it("groups.getWithCover toont nieuwe takenAt direct na update", async () => {
    const t = convexTest(schema, modules);
    await registerUser(t, "user_admin", "admin@x.com");
    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "Groep" },
    );

    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_admin").mutation(
      internal.photos.create,
      { storageId, takenAt: 1_000 },
    );
    // WP24 (A-keuze 2): een groep-cover staat in een album van die groep.
    const albumId = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "Album" },
    );
    await withUser(t, "user_admin").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });
    await withUser(t, "user_admin").mutation(api.groups.update, {
      groupId,
      coverPhotoId: photoId,
    });

    const { before, after } = await assertReactive(
      () =>
        withUser(t, "user_admin").query(api.groups.getWithCover, { groupId }),
      () =>
        withUser(t, "user_admin").mutation(api.photos.update, {
          photoId,
          takenAt: 2_000,
        }),
    );

    expect(before?.cover?.takenAt).toBe(1_000);
    expect(after?.cover?.takenAt).toBe(2_000);
  });

  it("albums.getWithCover toont nieuwe takenAt direct na update", async () => {
    const t = convexTest(schema, modules);
    await registerUser(t, "user_admin", "admin@x.com");
    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "Groep" },
    );
    const albumId = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "Album" },
    );

    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_admin").mutation(
      internal.photos.create,
      { storageId, takenAt: 1_000 },
    );
    // WP24 (A-keuze 2): een album-cover staat in dat album.
    await withUser(t, "user_admin").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });
    await withUser(t, "user_admin").mutation(api.albums.update, {
      albumId,
      coverPhotoId: photoId,
    });

    const { before, after } = await assertReactive(
      () =>
        withUser(t, "user_admin").query(api.albums.getWithCover, { albumId }),
      () =>
        withUser(t, "user_admin").mutation(api.photos.update, {
          photoId,
          takenAt: 2_000,
        }),
    );

    expect(before?.cover?.takenAt).toBe(1_000);
    expect(after?.cover?.takenAt).toBe(2_000);
  });
});
