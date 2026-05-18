import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api , internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { assertReactive } from "../_helpers/reactive";

// Cascade matrix rows P1, P2: cat-1 (eliminated) + cat-4 (reactive coverage).
// Verifieert dat join-on-read queries fresh photo-data returneren na een
// photos.update mutation. Vervangt `photoChangeToPub` (P1) en
// `photoChangeToCover` (P2).

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
  it("albums.listPhotos toont nieuwe locationLabel direct na update", async () => {
    const t = convexTest(schema);
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
      api.photos.create,
      { storageId, locationLabel: "Oud" },
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
          locationLabel: "Nieuw",
        }),
    );

    expect(before[0]?.photo?.locationLabel).toBe("Oud");
    expect(after[0]?.photo?.locationLabel).toBe("Nieuw");
  });
});

describe("P2: cover query joint photo-data fresh", () => {
  it("groups.getWithCover toont nieuwe locationLabel direct na update", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_admin", "admin@x.com");
    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "Groep" },
    );

    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_admin").mutation(
      api.photos.create,
      { storageId, locationLabel: "Oud" },
    );
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
          locationLabel: "Nieuw",
        }),
    );

    expect(before?.cover?.locationLabel).toBe("Oud");
    expect(after?.cover?.locationLabel).toBe("Nieuw");
  });

  it("albums.getWithCover toont nieuwe locationLabel direct na update", async () => {
    const t = convexTest(schema);
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
      api.photos.create,
      { storageId, locationLabel: "Oud" },
    );
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
          locationLabel: "Nieuw",
        }),
    );

    expect(before?.cover?.locationLabel).toBe("Oud");
    expect(after?.cover?.locationLabel).toBe("Nieuw");
  });
});
