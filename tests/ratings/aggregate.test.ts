import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Cascade matrix row R1: rating upsert/remove herrekent transactioneel
// photo.ratingAverage + photo.ratingCount. Cat-2 transactional aggregate.

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

async function setupPhotoOwnedBy(
  t: ReturnType<typeof convexTest>,
  ownerSubject: string,
) {
  await registerUser(t, ownerSubject, `${ownerSubject}@x.com`);
  const storageId = await t.run(
    async (ctx) => await ctx.storage.store(new Blob(["x"])),
  );
  const photoId = await withUser(t, ownerSubject).mutation(
    api.photos.create,
    { storageId },
  );
  return photoId;
}

describe("R1: ratings.upsert herrekent aggregate", () => {
  it("eerste rating zet ratingCount=1 en ratingAverage=value", async () => {
    const t = convexTest(schema);
    const photoId = await setupPhotoOwnedBy(t, "user_alice");
    await registerUser(t, "user_bob", "b@x.com");

    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 4,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.ratingCount).toBe(1);
    expect(photo?.ratingAverage).toBe(4);
  });

  it("meerdere ratings → gemiddelde correct", async () => {
    const t = convexTest(schema);
    const photoId = await setupPhotoOwnedBy(t, "user_alice");
    await registerUser(t, "user_bob", "b@x.com");
    await registerUser(t, "user_carol", "c@x.com");
    await registerUser(t, "user_dan", "d@x.com");

    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 4,
    });
    await withUser(t, "user_carol").mutation(api.ratings.upsert, {
      photoId,
      value: 5,
    });
    await withUser(t, "user_dan").mutation(api.ratings.upsert, {
      photoId,
      value: 3,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.ratingCount).toBe(3);
    expect(photo?.ratingAverage).toBe(4); // (4+5+3)/3
  });

  it("update bestaande rating herrekent gemiddelde", async () => {
    const t = convexTest(schema);
    const photoId = await setupPhotoOwnedBy(t, "user_alice");
    await registerUser(t, "user_bob", "b@x.com");

    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 2,
    });
    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 5,
    });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.ratingCount).toBe(1); // zelfde user, geen dubbele row
    expect(photo?.ratingAverage).toBe(5);
  });
});

describe("R1: ratings.remove herrekent aggregate", () => {
  it("verlaagt count en herrekent gemiddelde", async () => {
    const t = convexTest(schema);
    const photoId = await setupPhotoOwnedBy(t, "user_alice");
    await registerUser(t, "user_bob", "b@x.com");
    await registerUser(t, "user_carol", "c@x.com");

    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 4,
    });
    await withUser(t, "user_carol").mutation(api.ratings.upsert, {
      photoId,
      value: 2,
    });

    await withUser(t, "user_bob").mutation(api.ratings.remove, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.ratingCount).toBe(1);
    expect(photo?.ratingAverage).toBe(2);
  });

  it("laatste rating weg → ratingCount=0, ratingAverage=undefined", async () => {
    const t = convexTest(schema);
    const photoId = await setupPhotoOwnedBy(t, "user_alice");
    await registerUser(t, "user_bob", "b@x.com");

    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 4,
    });
    await withUser(t, "user_bob").mutation(api.ratings.remove, { photoId });

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo?.ratingCount).toBe(0);
    expect(photo?.ratingAverage).toBeUndefined();
  });
});
