import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// FL2 — photos.appeal mutation. Bron: oude AWS handler
// blob-images-api-photos/handlersPhoto/flagPhotoAppeal.js (regel 8-27):
//   - owner-only ("photo is not yours")
//   - alleen appealable als al geflagged ("photo not flagged")
//   - idempotent: als al flaggedAppealDate gezet, return zonder update
//   - sets flaggedAppealDate, clears flaggedDeleteDate (pause countdown)
//
// In v2 schema: flaggedAppealDate (nieuw, B implementeert), flaggedDeleteDate
// (nieuw). Pause = clear flaggedDeleteDate tot decideFlag.

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

async function uploadStorage(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.storage.store(new Blob(["x"])));
}

async function flaggedPhotoBy(
  t: ReturnType<typeof convexTest>,
  ownerSubject: string,
  flaggerSubject: string,
) {
  const storageId = await uploadStorage(t);
  const photoId = await withUser(t, ownerSubject).mutation(api.photos.create, {
    storageId,
  });
  await withUser(t, flaggerSubject).mutation(api.photos.flag, { photoId });
  return photoId;
}

describe("photos.appeal — owner only", () => {
  // flagPhotoAppeal.js regel 14: throw 'photo is not yours'
  it("non-owner kan niet appealen", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    await registerUser(t, "user_carol", "c@x.com");

    const photoId = await flaggedPhotoBy(t, "user_alice", "user_bob");

    await expect(
      withUser(t, "user_carol").mutation(api.photos.appeal, { photoId }),
    ).rejects.toThrow();
  });

  it("owner kan appealen, zet flaggedAppealDate en clear flaggedDeleteDate", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");

    const photoId = await flaggedPhotoBy(t, "user_alice", "user_bob");

    const before = Date.now();
    await withUser(t, "user_alice").mutation(api.photos.appeal, { photoId });
    const after = Date.now();

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(typeof photo?.flaggedAppealDate).toBe("number");
    expect(photo?.flaggedAppealDate).toBeGreaterThanOrEqual(before);
    expect(photo?.flaggedAppealDate).toBeLessThanOrEqual(after);
    // countdown gepauzeerd
    expect(photo?.flaggedDeleteDate).toBeUndefined();
    // flaggedAt en flaggedBy intact
    expect(typeof photo?.flaggedAt).toBe("number");
  });
});

describe("photos.appeal — guards", () => {
  // flagPhotoAppeal.js regel 15: throw 'photo not flagged'
  it("appeal op niet-geflagde foto gooit error", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const storageId = await uploadStorage(t);
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );

    await expect(
      withUser(t, "user_alice").mutation(api.photos.appeal, { photoId }),
    ).rejects.toThrow();
  });

  // [GAP] oude code geen expliciete check op "al gedecided" — daar was geen
  // appeal-deny date. v2: na deny mag je niet opnieuw appealen (anders kan
  // owner countdown oneindig pauzeren). Implementeer als guard op
  // flaggedAppealDenyDate.
  it("[GAP] appeal niet mogelijk als al gedecided (denied)", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const photoId = await flaggedPhotoBy(t, "user_alice", "user_bob");

    // simuleer al-gedecided state via direct patch
    await t.run(async (ctx) => {
      await ctx.db.patch(photoId, {
        flaggedAppealDate: Date.now() - 1000,
        flaggedAppealDenyDate: Date.now(),
        flaggedDeleteDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
    });

    await expect(
      withUser(t, "user_alice").mutation(api.photos.appeal, { photoId }),
    ).rejects.toThrow();
  });
});

describe("photos.appeal — idempotent", () => {
  // flagPhotoAppeal.js regel 18: if (photo.flaggedAppealDate) return cleanRecord(photo)
  it("tweede appeal-call wijzigt flaggedAppealDate niet", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");

    const photoId = await flaggedPhotoBy(t, "user_alice", "user_bob");
    await withUser(t, "user_alice").mutation(api.photos.appeal, { photoId });
    const after1 = await t.run((ctx) => ctx.db.get(photoId));
    const firstAppealDate = after1?.flaggedAppealDate;

    await withUser(t, "user_alice").mutation(api.photos.appeal, { photoId });
    const after2 = await t.run((ctx) => ctx.db.get(photoId));

    expect(after2?.flaggedAppealDate).toBe(firstAppealDate);
    expect(after2?.flaggedDeleteDate).toBeUndefined();
  });
});
