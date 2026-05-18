import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api , internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";

// Photos CRUD basis. Cascade-rows P1, P2 (reactive) staan in update.test.ts,
// P3-P5, P7 in delete.test.ts, P6 (photoCount increment) in create.test.ts.

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

describe("photos.create basic", () => {
  it("weigert zonder auth", async () => {
    const t = convexTest(schema);
    const storageId = await uploadStorage(t);
    await expect(
      t.mutation(api.photos.create, { storageId }),
    ).rejects.toThrow();
  });

  it("weigert wanneer geen user record", async () => {
    const t = convexTest(schema);
    const storageId = await uploadStorage(t);
    await expect(
      withUser(t, "user_ghost").mutation(api.photos.create, { storageId }),
    ).rejects.toThrow();
  });

  it("maakt photo met ownerId = caller en defaults", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const storageId = await uploadStorage(t);

    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId, locationLabel: "Amsterdam" },
    );

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.ownerId).toBe(aliceId);
    expect(photo?.storageId).toBe(storageId);
    expect(photo?.locationLabel).toBe("Amsterdam");
    expect(photo?.ratingCount).toBe(0);
    expect(typeof photo?.createdAt).toBe("number");
  });
});

describe("photos.getById / listByOwner", () => {
  it("getById geeft photo terug", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );
    const got = await t.query(api.photos.getById, { photoId });
    expect(got?._id).toBe(photoId);
  });

  it("listByOwner geeft alleen eigen foto's", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const s1 = await uploadStorage(t);
    const s2 = await uploadStorage(t);
    const s3 = await uploadStorage(t);
    await withUser(t, "user_alice").mutation(api.photos.create, {
      storageId: s1,
    });
    await withUser(t, "user_alice").mutation(api.photos.create, {
      storageId: s2,
    });
    await withUser(t, "user_bob").mutation(api.photos.create, {
      storageId: s3,
    });

    const alicePhotos = await t.query(api.photos.listByOwner, {
      ownerId: aliceId,
    });
    expect(alicePhotos).toHaveLength(2);
    const bobPhotos = await t.query(api.photos.listByOwner, {
      ownerId: bobId,
    });
    expect(bobPhotos).toHaveLength(1);
  });
});

describe("photos.update", () => {
  it("eigenaar kan locationLabel wijzigen", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId, locationLabel: "Oud" },
    );

    await withUser(t, "user_alice").mutation(api.photos.update, {
      photoId,
      locationLabel: "Nieuw",
    });

    const got = await t.run((ctx) => ctx.db.get(photoId));
    expect(got?.locationLabel).toBe("Nieuw");
  });

  it("niet-eigenaar wordt geweigerd", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );

    await expect(
      withUser(t, "user_bob").mutation(api.photos.update, {
        photoId,
        locationLabel: "Hijack",
      }),
    ).rejects.toThrow();
  });
});

describe("photos.remove auth", () => {
  it("eigenaar kan eigen foto deleten", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );

    await withUser(t, "user_alice").mutation(api.photos.remove, { photoId });
    expect(await t.run((ctx) => ctx.db.get(photoId))).toBeNull();
  });

  it("niet-eigenaar wordt geweigerd", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );

    await expect(
      withUser(t, "user_bob").mutation(api.photos.remove, { photoId }),
    ).rejects.toThrow();
  });
});
