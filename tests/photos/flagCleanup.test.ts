import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";

// FL1 — daily cron cleanupFlaggedPhotos.
// Bron: niet uit oude AWS code (was handmatig). Cascade-matrix FL1:
//   "scan photos.by_flagged_delete, filter flaggedDeleteDate < now &&
//    !flaggedAppealDate || flaggedAppealDenyDate, roep internalRemovePhoto
//    per match aan (transitief P3-P5+P7)"
//
// Schema-aanname (B implementeert): index by_flagged_delete op
// flaggedDeleteDate (sparse — alleen photos waar veld gezet is komen erin).
//
// 14d voor flag-only, 7d voor deny — fake clock.

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";
const DAY_MS = 24 * 60 * 60 * 1000;

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

async function insertPhotoWithFlag(
  t: ReturnType<typeof convexTest>,
  ownerId: Id<"users">,
  flagPatch: Partial<{
    flaggedAt: number;
    flaggedBy: Id<"users">;
    flaggedDeleteDate: number;
    flaggedAppealDate: number;
    flaggedAppealDenyDate: number;
  }>,
) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["x"]));
    const photoId = await ctx.db.insert("photos", {
      ownerId,
      storageId,
      ratingCount: 0,
      createdAt: Date.now(),
      ...flagPatch,
    });
    return photoId;
  });
}

describe("FL1: cleanupFlaggedPhotos cron", () => {
  it("verwijdert photos waar flaggedDeleteDate in het verleden ligt", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-01-01T00:00:00Z").getTime();
      vi.setSystemTime(baseNow);

      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const bobId = await registerUser(t, "user_bob", "b@x.com");

      // photo geflagged 14 dagen geleden, geen appeal — moet weg
      const ripePhoto = await insertPhotoWithFlag(t, aliceId, {
        flaggedAt: baseNow - 15 * DAY_MS,
        flaggedBy: bobId,
        flaggedDeleteDate: baseNow - DAY_MS, // 1 dag geleden = ripe
      });

      // photo net geflagged — niet weg
      const freshPhoto = await insertPhotoWithFlag(t, aliceId, {
        flaggedAt: baseNow - DAY_MS,
        flaggedBy: bobId,
        flaggedDeleteDate: baseNow + 13 * DAY_MS,
      });

      await t.mutation(internal.photos.cleanupFlaggedPhotos, {});

      expect(await t.run((ctx) => ctx.db.get(ripePhoto))).toBeNull();
      expect(await t.run((ctx) => ctx.db.get(freshPhoto))).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("laat photos onder appeal staan (flaggedAppealDate gezet, geen deny)", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-01-01T00:00:00Z").getTime();
      vi.setSystemTime(baseNow);

      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const bobId = await registerUser(t, "user_bob", "b@x.com");

      // appeal pauzeert countdown — flaggedDeleteDate is undefined
      const appealedPhoto = await insertPhotoWithFlag(t, aliceId, {
        flaggedAt: baseNow - 20 * DAY_MS,
        flaggedBy: bobId,
        flaggedAppealDate: baseNow - 5 * DAY_MS,
        // flaggedDeleteDate is undefined — paused
      });

      await t.mutation(internal.photos.cleanupFlaggedPhotos, {});

      expect(await t.run((ctx) => ctx.db.get(appealedPhoto))).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("verwijdert photos na deny zodra 7d countdown afgelopen is", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-01-01T00:00:00Z").getTime();
      vi.setSystemTime(baseNow);

      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const bobId = await registerUser(t, "user_bob", "b@x.com");

      // appeal denied 8 dagen geleden, deleteDate dus 1 dag geleden
      const deniedRipe = await insertPhotoWithFlag(t, aliceId, {
        flaggedAt: baseNow - 30 * DAY_MS,
        flaggedBy: bobId,
        flaggedAppealDate: baseNow - 10 * DAY_MS,
        flaggedAppealDenyDate: baseNow - 8 * DAY_MS,
        flaggedDeleteDate: baseNow - DAY_MS,
      });

      // appeal denied gisteren, deleteDate over 6 dagen
      const deniedFresh = await insertPhotoWithFlag(t, aliceId, {
        flaggedAt: baseNow - 30 * DAY_MS,
        flaggedBy: bobId,
        flaggedAppealDate: baseNow - 5 * DAY_MS,
        flaggedAppealDenyDate: baseNow - DAY_MS,
        flaggedDeleteDate: baseNow + 6 * DAY_MS,
      });

      await t.mutation(internal.photos.cleanupFlaggedPhotos, {});

      expect(await t.run((ctx) => ctx.db.get(deniedRipe))).toBeNull();
      expect(await t.run((ctx) => ctx.db.get(deniedFresh))).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("triggert transitieve cascade (P3-P5+P7) via internalRemovePhoto", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-01-01T00:00:00Z").getTime();
      vi.setSystemTime(baseNow);

      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const bobId = await registerUser(t, "user_bob", "b@x.com");

      const photoId = await insertPhotoWithFlag(t, aliceId, {
        flaggedAt: baseNow - 15 * DAY_MS,
        flaggedBy: bobId,
        flaggedDeleteDate: baseNow - DAY_MS,
      });

      // P4: rating op deze photo
      await t.run(async (ctx) => {
        await ctx.db.insert("ratings", {
          photoId,
          userId: bobId,
          value: 3,
          createdAt: baseNow,
          updatedAt: baseNow,
        });
      });
      // P7: photoCount alvast verhogen
      await t.run(async (ctx) => {
        const u = await ctx.db.get(aliceId);
        await ctx.db.patch(aliceId, { photoCount: (u!.photoCount ?? 0) + 1 });
      });

      const beforeCount = (await t.run((ctx) => ctx.db.get(aliceId)))!
        .photoCount;

      await t.mutation(internal.photos.cleanupFlaggedPhotos, {});

      expect(await t.run((ctx) => ctx.db.get(photoId))).toBeNull();
      // P4: ratings weg
      const ratings = await t.run((ctx) =>
        ctx.db
          .query("ratings")
          .withIndex("by_photo", (q) => q.eq("photoId", photoId))
          .collect(),
      );
      expect(ratings).toHaveLength(0);
      // P7: photoCount gedecrement
      const after = await t.run((ctx) => ctx.db.get(aliceId));
      expect(after?.photoCount).toBe(beforeCount - 1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Audit-9 §3 boundary harmonisatie: cleanup-conditie is `flaggedDeleteDate
  // <= now` (consistent met Invites expiresAt <= now is verlopen). Zonder
  // deze keuze valt een photo waar de countdown precies aan grenst stilletjes
  // tussen wal en schip (cron vuurt op vaste klok, photo blijft 24h extra).
  // Vóór de harmonisatie gebruikten we strict `<` — deze twee tests pinnen
  // het nieuwe gedrag.
  it("verwijdert photo waar flaggedDeleteDate === now (boundary)", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-01-01T00:00:00Z").getTime();
      vi.setSystemTime(baseNow);

      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const bobId = await registerUser(t, "user_bob", "b@x.com");

      const boundaryPhoto = await insertPhotoWithFlag(t, aliceId, {
        flaggedAt: baseNow - 14 * DAY_MS,
        flaggedBy: bobId,
        flaggedDeleteDate: baseNow, // exact gelijk aan now
      });

      await t.mutation(internal.photos.cleanupFlaggedPhotos, {});

      expect(await t.run((ctx) => ctx.db.get(boundaryPhoto))).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("laat photo staan waar flaggedDeleteDate === now + 1 (boundary)", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-01-01T00:00:00Z").getTime();
      vi.setSystemTime(baseNow);

      const t = convexTest(schema);
      const aliceId = await registerUser(t, "user_alice", "a@x.com");
      const bobId = await registerUser(t, "user_bob", "b@x.com");

      const justFutureP = await insertPhotoWithFlag(t, aliceId, {
        flaggedAt: baseNow - 14 * DAY_MS,
        flaggedBy: bobId,
        flaggedDeleteDate: baseNow + 1, // 1ms in de toekomst — niet ripe
      });

      await t.mutation(internal.photos.cleanupFlaggedPhotos, {});

      expect(await t.run((ctx) => ctx.db.get(justFutureP))).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("doet niets als er geen photos met flaggedDeleteDate zijn", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    // ongewone photo zonder flag
    await insertPhotoWithFlag(t, aliceId, {});

    await expect(
      t.mutation(internal.photos.cleanupFlaggedPhotos, {}),
    ).resolves.not.toThrow();

    const all = await t.run((ctx) => ctx.db.query("photos").collect());
    expect(all).toHaveLength(1);
  });
});
