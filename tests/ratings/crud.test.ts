import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api , internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Ratings basics: auth, photo bestaat, listForPhoto.
// Aggregate-rerekening (R1) staat in aggregate.test.ts.

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

async function setupPhoto(
  t: ReturnType<typeof convexTest>,
  ownerSubject: string,
) {
  await registerUser(t, ownerSubject, `${ownerSubject}@x.com`);
  const storageId = await t.run(
    async (ctx) => await ctx.storage.store(new Blob(["x"])),
  );
  return await withUser(t, ownerSubject).mutation(api.photos.create, {
    storageId,
  });
}

describe("ratings.upsert auth", () => {
  it("weigert zonder auth", async () => {
    const t = convexTest(schema);
    const photoId = await setupPhoto(t, "user_alice");
    await expect(
      t.mutation(api.ratings.upsert, { photoId, value: 4 }),
    ).rejects.toThrow();
  });

  it("weigert wanneer photo niet bestaat", async () => {
    const t = convexTest(schema);
    const photoId = await setupPhoto(t, "user_alice");
    await registerUser(t, "user_bob", "b@x.com");
    await t.run((ctx) => ctx.db.delete(photoId));

    await expect(
      withUser(t, "user_bob").mutation(api.ratings.upsert, {
        photoId,
        value: 4,
      }),
    ).rejects.toThrow();
  });
});

describe("ratings.remove", () => {
  it("verwijdert eigen rating, andere blijven", async () => {
    const t = convexTest(schema);
    const photoId = await setupPhoto(t, "user_alice");
    await registerUser(t, "user_bob", "b@x.com");
    await registerUser(t, "user_carol", "c@x.com");

    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 4,
    });
    await withUser(t, "user_carol").mutation(api.ratings.upsert, {
      photoId,
      value: 3,
    });

    await withUser(t, "user_bob").mutation(api.ratings.remove, { photoId });

    const list = await t.query(api.ratings.listForPhoto, { photoId });
    expect(list).toHaveLength(1);
    expect(list[0]?.value).toBe(3);
  });

  it("idempotent — verwijderen wanneer geen rating bestaat doet niets", async () => {
    const t = convexTest(schema);
    const photoId = await setupPhoto(t, "user_alice");
    await registerUser(t, "user_bob", "b@x.com");

    await expect(
      withUser(t, "user_bob").mutation(api.ratings.remove, { photoId }),
    ).resolves.not.toThrow();
  });
});

describe("ratings.listForPhoto", () => {
  it("geeft alle ratings van die photo", async () => {
    const t = convexTest(schema);
    const photoId = await setupPhoto(t, "user_alice");
    await registerUser(t, "user_bob", "b@x.com");
    await registerUser(t, "user_carol", "c@x.com");

    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 4,
    });
    await withUser(t, "user_carol").mutation(api.ratings.upsert, {
      photoId,
      value: 5,
    });

    const list = await t.query(api.ratings.listForPhoto, { photoId });
    expect(list).toHaveLength(2);
  });
});
