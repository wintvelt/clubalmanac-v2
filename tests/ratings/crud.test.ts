import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api , internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { shareInGroup } from "../_helpers/access";
import { modules } from "../_helpers/modules";

// Ratings basics: auth, photo bestaat, listForPhoto.
// Aggregate-rerekening (R1) staat in aggregate.test.ts.
// WP24: beoordelen vereist foto-toegang (gates: tests/writeGates/rating.test.ts);
// raters delen hier een groep met de foto via shareInGroup.

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
  return await withUser(t, ownerSubject).mutation(internal.photos.create, {
    storageId,
  });
}

describe("ratings.upsert auth", () => {
  it("weigert zonder auth", async () => {
    const t = convexTest(schema, modules);
    const photoId = await setupPhoto(t, "user_alice");
    await expect(
      t.mutation(api.ratings.upsert, { photoId, value: 4 }),
    ).rejects.toThrow();
  });

  it("weigert wanneer photo niet bestaat", async () => {
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
    const photoId = await setupPhoto(t, "user_alice");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");
    await shareInGroup(t, photoId, [bobId, carolId]);

    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 4,
    });
    await withUser(t, "user_carol").mutation(api.ratings.upsert, {
      photoId,
      value: 3,
    });

    await withUser(t, "user_bob").mutation(api.ratings.remove, { photoId });

    // Direct uit de tabel: listForPhoto geeft sinds WP23 alleen de eigen
    // rating van de caller.
    const list = await t.run((ctx) =>
      ctx.db
        .query("ratings")
        .withIndex("by_photo", (q) => q.eq("photoId", photoId))
        .collect(),
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.value).toBe(3);
  });

  it("idempotent — verwijderen wanneer geen rating bestaat doet niets", async () => {
    const t = convexTest(schema, modules);
    const photoId = await setupPhoto(t, "user_alice");
    await registerUser(t, "user_bob", "b@x.com");

    await expect(
      withUser(t, "user_bob").mutation(api.ratings.remove, { photoId }),
    ).resolves.not.toThrow();
  });
});

// WP23 (A-keuze 1): listForPhoto geeft alleen de eigen rating van de caller.
// Volledige auth- en vorm-matrix: tests/readWhitelist/ratings.test.ts.
describe("ratings.listForPhoto", () => {
  it("geeft alleen de eigen rating, niet die van anderen", async () => {
    const t = convexTest(schema, modules);
    const photoId = await setupPhoto(t, "user_alice");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    await shareInGroup(t, photoId, [bobId]);

    await withUser(t, "user_alice").mutation(api.ratings.upsert, {
      photoId,
      value: 3,
    });
    await withUser(t, "user_bob").mutation(api.ratings.upsert, {
      photoId,
      value: 4,
    });

    const list = await withUser(t, "user_alice").query(
      api.ratings.listForPhoto,
      { photoId },
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.value).toBe(3);
  });
});
