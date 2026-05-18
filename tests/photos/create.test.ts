import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api , internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Cascade matrix row P6: photo create increments user.photoCount.
// Cat-2 transactional aggregate.

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

describe("P6: photo.create increments user.photoCount", () => {
  it("verhoogt photoCount na elke create", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");

    const before = await t.run((ctx) => ctx.db.get(aliceId));
    expect(before?.photoCount).toBe(0);

    const s1 = await uploadStorage(t);
    await withUser(t, "user_alice").mutation(api.photos.create, {
      storageId: s1,
    });
    const after1 = await t.run((ctx) => ctx.db.get(aliceId));
    expect(after1?.photoCount).toBe(1);

    const s2 = await uploadStorage(t);
    await withUser(t, "user_alice").mutation(api.photos.create, {
      storageId: s2,
    });
    const after2 = await t.run((ctx) => ctx.db.get(aliceId));
    expect(after2?.photoCount).toBe(2);
  });

  it("gooit error en verhoogt niet wanneer limiet bereikt", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");

    // Forceer photoCount op limiet
    await t.run(async (ctx) => {
      const u = await ctx.db.get(aliceId);
      await ctx.db.patch(aliceId, { photoCount: u!.photoLimit });
    });

    const storageId = await uploadStorage(t);
    await expect(
      withUser(t, "user_alice").mutation(api.photos.create, { storageId }),
    ).rejects.toThrow(/PHOTO_LIMIT_REACHED/);

    // Photo records leeg
    const photos = await t.run((ctx) =>
      ctx.db
        .query("photos")
        .withIndex("by_owner", (q) => q.eq("ownerId", aliceId))
        .collect(),
    );
    expect(photos).toHaveLength(0);
  });

  it("verhoogt alleen photoCount van caller, niet van andere users", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    const storageId = await uploadStorage(t);
    await withUser(t, "user_alice").mutation(api.photos.create, { storageId });

    expect((await t.run((ctx) => ctx.db.get(aliceId)))?.photoCount).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(bobId)))?.photoCount).toBe(0);
  });
});
