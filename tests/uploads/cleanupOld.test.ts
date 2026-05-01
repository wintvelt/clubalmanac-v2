import { convexTest } from "convex-test";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// File upload werkpakket — Cyclus 1 (audit-cyclus-1 hardening), cleanup-cron RED-phase spec.
//
// Cascade matrix UI1: dagelijkse cron `cleanupOldUploadIdempotency` ruimt
// `uploadIdempotency` records op met TWEE verschillende thresholds, samenhangend
// met de reservation-pattern state machine (zie tests/http/upload.test.ts):
//
//   1. status="in_progress"  → cleanup na 5 minuten (stale-reservation horizon)
//   2. status="completed"    → cleanup na 7 dagen   (retry-safety horizon)
//
// Waarom twee thresholds:
//   - in_progress = race-loser, gecrashte handler tussen reserve en markCompleted,
//     of orphan-reservation door een uitzondering. Houden we niet langer dan
//     nodig vast: 5 min is genoeg voor een legitieme upload (typische JPEG/HEIC
//     in seconden, edge-case slow-network laatste paar 10-tallen seconden).
//     Sluit aan bij een toekomstige storage-orphan-cleanup: stale reservation
//     impliceert dat de bijbehorende storage-blob (indien geschreven vóór de
//     crash) ook orphan is; B kan dat in cyclus 2+ koppelen via reservation.storageId
//     (out-of-scope hier).
//   - completed = idempotency-key voor client-retries. Te kort (<1d) breekt
//     legitieme background-upload retry's; te lang (>14d) groeit de tabel
//     onnodig. 7d is "een week" — herkenbare retry-horizon, consistent met
//     FL1 / invites accept boundary.
//
// Boundary-semantiek: <= cutoff (consistent met FL1 `flaggedDeleteDate <= now`
// en invites accept `expiresAt <= now`). Audit-cyclus-1 §4: deze test pint
// de boundary echt via vi.useFakeTimers() + vi.setSystemTime(), niet via
// `now - 7d` slop tussen Date.now()-aanroepen.
//
// Functie-shape (B implementeert):
//   internal.uploads.cleanupOld({}): void
//     - Scant uploadIdempotency.by_status_and_createdAt waar status="in_progress"
//       en createdAt <= now - 5min → ctx.db.delete(record._id)
//     - Scant uploadIdempotency.by_status_and_createdAt waar status="completed"
//       en createdAt <= now - 7d   → ctx.db.delete(record._id)
//
// Cron registratie in convex/crons.ts (ongewijzigd t.o.v. cyclus 1):
//   crons.daily(
//     "cleanup old upload idempotency",
//     { hourUTC: 3, minuteUTC: 30 },
//     internal.uploads.cleanupOld,
//     {},
//   );

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_IN_PROGRESS_MS = 5 * MINUTE_MS;
const RETENTION_COMPLETED_MS = 7 * DAY_MS;

// Pinned clock voor boundary-tests: alle Date.now() calls (zowel test-seed als
// de cleanupOld-implementatie) zien dezelfde tijd, dus we kunnen exact pinnen
// dat record createdAt === FIXED_NOW - 7d wordt opgeruimd (<=, niet <).
const FIXED_NOW = new Date("2026-05-01T12:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("internal.uploads.cleanupOld — completed-status retention (7d)", () => {
  it("verwijdert completed records met createdAt > 7 dagen oud", async () => {
    const t = convexTest(schema);

    const oldId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "u_subject",
        email: "u@x.com",
        photoCount: 1,
        photoLimit: 1000,
        createdAt: FIXED_NOW - 30 * DAY_MS,
      });
      const storageId = await ctx.storage.store(new Blob(["x"]));
      const photoId = await ctx.db.insert("photos", {
        ownerId: userId,
        storageId,
        ratingCount: 0,
        createdAt: FIXED_NOW - 30 * DAY_MS,
      });
      return await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "old-uuid",
        status: "completed",
        photoId,
        createdAt: FIXED_NOW - 8 * DAY_MS,
        completedAt: FIXED_NOW - 8 * DAY_MS,
      });
    });

    await t.mutation(internal.uploads.cleanupOld, {});

    const remaining = await t.run((ctx) => ctx.db.get(oldId));
    expect(remaining).toBeNull();
  });

  it("laat completed records jonger dan 7 dagen ongemoeid", async () => {
    const t = convexTest(schema);

    const youngId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "u_subject",
        email: "u@x.com",
        photoCount: 1,
        photoLimit: 1000,
        createdAt: FIXED_NOW,
      });
      const storageId = await ctx.storage.store(new Blob(["x"]));
      const photoId = await ctx.db.insert("photos", {
        ownerId: userId,
        storageId,
        ratingCount: 0,
        createdAt: FIXED_NOW,
      });
      return await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "young-uuid",
        status: "completed",
        photoId,
        createdAt: FIXED_NOW - 1 * DAY_MS,
        completedAt: FIXED_NOW - 1 * DAY_MS,
      });
    });

    await t.mutation(internal.uploads.cleanupOld, {});

    const remaining = await t.run((ctx) => ctx.db.get(youngId));
    expect(remaining).not.toBeNull();
  });

  it("boundary echt pinnable: createdAt === now - 7d wordt opgeruimd (<=), createdAt === now - 7d + 1 blijft staan", async () => {
    // Audit-cyclus-1 §4: vroege versie van deze test gebruikte
    // `now = Date.now()` in zowel seed als impl, met theoretische slop
    // tussen aanroepen. Door vi.setSystemTime is Date.now() in beide
    // gefixeerd op FIXED_NOW — boundary-assertion is exact.
    const t = convexTest(schema);

    const { onBoundaryId, justInsideId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "u_subject",
        email: "u@x.com",
        photoCount: 0,
        photoLimit: 1000,
        createdAt: FIXED_NOW - 30 * DAY_MS,
      });
      const seedPhoto = async () => {
        const storageId = await ctx.storage.store(new Blob(["x"]));
        return await ctx.db.insert("photos", {
          ownerId: userId,
          storageId,
          ratingCount: 0,
          createdAt: FIXED_NOW - 30 * DAY_MS,
        });
      };
      const onBoundaryId = await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "on-boundary",
        status: "completed",
        photoId: await seedPhoto(),
        createdAt: FIXED_NOW - RETENTION_COMPLETED_MS, // exact <=
        completedAt: FIXED_NOW - RETENTION_COMPLETED_MS,
      });
      const justInsideId = await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "just-inside",
        status: "completed",
        photoId: await seedPhoto(),
        createdAt: FIXED_NOW - RETENTION_COMPLETED_MS + 1, // 1ms aan de "blijft"-kant
        completedAt: FIXED_NOW - RETENTION_COMPLETED_MS + 1,
      });
      return { onBoundaryId, justInsideId };
    });

    await t.mutation(internal.uploads.cleanupOld, {});

    expect(await t.run((ctx) => ctx.db.get(onBoundaryId))).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get(justInsideId)),
    ).not.toBeNull();
  });
});

describe("internal.uploads.cleanupOld — in_progress retention (5min, audit-cyclus-1)", () => {
  it("verwijdert in_progress records ouder dan 5 minuten (stale reservation = gecrashte handler)", async () => {
    // Audit-cyclus-1: reservation pattern kan stale records achterlaten als
    // de handler crasht tussen `reserve` en `markCompleted`. Stale-cleanup
    // ruimt die op zodat een retry met dezelfde clientUploadId niet
    // geblokkeerd blijft door een phantom in_progress die nooit completed.
    const t = convexTest(schema);

    const staleId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "u_subject",
        email: "u@x.com",
        photoCount: 0,
        photoLimit: 1000,
        createdAt: FIXED_NOW - DAY_MS,
      });
      return await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "stale-uuid",
        status: "in_progress",
        // photoId blijft undefined — de crash-marker
        createdAt: FIXED_NOW - 6 * MINUTE_MS,
      });
    });

    await t.mutation(internal.uploads.cleanupOld, {});

    expect(await t.run((ctx) => ctx.db.get(staleId))).toBeNull();
  });

  it("laat in_progress records jonger dan 5 minuten ongemoeid (lopende upload)", async () => {
    // 30s oud is plausibel een lopende HEIC-upload op flaky netwerk; mag
    // niet door de cron worden weggetrokken onder een actieve handler.
    const t = convexTest(schema);

    const liveId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "u_subject",
        email: "u@x.com",
        photoCount: 0,
        photoLimit: 1000,
        createdAt: FIXED_NOW - DAY_MS,
      });
      return await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "live-uuid",
        status: "in_progress",
        createdAt: FIXED_NOW - 30 * 1000, // 30s oud
      });
    });

    await t.mutation(internal.uploads.cleanupOld, {});

    expect(await t.run((ctx) => ctx.db.get(liveId))).not.toBeNull();
  });

  it("boundary in_progress: createdAt === now - 5min wordt opgeruimd (<=), now - 5min + 1 blijft", async () => {
    const t = convexTest(schema);

    const { onBoundaryId, justInsideId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "u_subject",
        email: "u@x.com",
        photoCount: 0,
        photoLimit: 1000,
        createdAt: FIXED_NOW - DAY_MS,
      });
      const onBoundaryId = await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "boundary-inprog",
        status: "in_progress",
        createdAt: FIXED_NOW - STALE_IN_PROGRESS_MS,
      });
      const justInsideId = await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "just-inside-inprog",
        status: "in_progress",
        createdAt: FIXED_NOW - STALE_IN_PROGRESS_MS + 1,
      });
      return { onBoundaryId, justInsideId };
    });

    await t.mutation(internal.uploads.cleanupOld, {});

    expect(await t.run((ctx) => ctx.db.get(onBoundaryId))).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get(justInsideId)),
    ).not.toBeNull();
  });
});

describe("internal.uploads.cleanupOld — mixed status + edge cases", () => {
  it("twee thresholds tegelijk: ruimt stale in_progress + oude completed, behoudt jonge varianten", async () => {
    // Audit-cyclus-1 §5: deze test bewijst dat de cleanupOld-implementatie
    // beide threshold-paden in één run draait (geen tweeDaily-cron-truc).
    const t = convexTest(schema);

    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "u_subject",
        email: "u@x.com",
        photoCount: 2,
        photoLimit: 1000,
        createdAt: FIXED_NOW - 30 * DAY_MS,
      });
      const seedPhoto = async () => {
        const storageId = await ctx.storage.store(new Blob(["x"]));
        return await ctx.db.insert("photos", {
          ownerId: userId,
          storageId,
          ratingCount: 0,
          createdAt: FIXED_NOW - DAY_MS,
        });
      };

      const oldCompleted = await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "old-completed",
        status: "completed",
        photoId: await seedPhoto(),
        createdAt: FIXED_NOW - 30 * DAY_MS,
        completedAt: FIXED_NOW - 30 * DAY_MS,
      });
      const youngCompleted = await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "young-completed",
        status: "completed",
        photoId: await seedPhoto(),
        createdAt: FIXED_NOW - DAY_MS,
        completedAt: FIXED_NOW - DAY_MS,
      });
      const staleInProgress = await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "stale-inprog",
        status: "in_progress",
        createdAt: FIXED_NOW - 10 * MINUTE_MS,
      });
      const liveInProgress = await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "live-inprog",
        status: "in_progress",
        createdAt: FIXED_NOW - 1 * MINUTE_MS,
      });

      return { oldCompleted, youngCompleted, staleInProgress, liveInProgress };
    });

    await t.mutation(internal.uploads.cleanupOld, {});

    expect(
      await t.run((ctx) => ctx.db.get(ids.oldCompleted)),
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get(ids.staleInProgress)),
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get(ids.youngCompleted)),
    ).not.toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get(ids.liveInProgress)),
    ).not.toBeNull();
  });

  it("threshold-isolatie: jonge completed (<7d, >5min) wordt NIET door de in_progress-pad opgeruimd", async () => {
    // Defensieve regression: een naïeve implementatie die `createdAt <= now - 5min`
    // zonder status-filter doet, zou completed records van >5min ten onrechte
    // verwijderen. Status-filtering is essentieel.
    const t = convexTest(schema);

    const sixHourCompletedId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "u_subject",
        email: "u@x.com",
        photoCount: 1,
        photoLimit: 1000,
        createdAt: FIXED_NOW - DAY_MS,
      });
      const storageId = await ctx.storage.store(new Blob(["x"]));
      const photoId = await ctx.db.insert("photos", {
        ownerId: userId,
        storageId,
        ratingCount: 0,
        createdAt: FIXED_NOW - 6 * 60 * MINUTE_MS,
      });
      return await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "six-hour-completed",
        status: "completed",
        photoId,
        createdAt: FIXED_NOW - 6 * 60 * MINUTE_MS, // 6h oud — voorbij 5min, ruim binnen 7d
        completedAt: FIXED_NOW - 6 * 60 * MINUTE_MS,
      });
    });

    await t.mutation(internal.uploads.cleanupOld, {});

    expect(
      await t.run((ctx) => ctx.db.get(sixHourCompletedId)),
    ).not.toBeNull();
  });

  it("geen records: no-op (geen throw)", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(internal.uploads.cleanupOld, {}),
    ).resolves.not.toThrow();

    const all = await t.run((ctx) =>
      ctx.db.query("uploadIdempotency").collect(),
    );
    expect(all).toHaveLength(0);
  });

  it("cleanup raakt photo records niet aan (alleen idempotency-table)", async () => {
    // Belangrijke regression-guard: de cron is een onschuldige opruimer
    // van idempotency-mappings. Photos zelf hebben hun eigen lifecycle
    // (FL1, photos.remove, users.deleteSelf cascade). Een idempotency
    // record ouder dan 7d betekent NIET dat de bijbehorende photo weg moet.
    const t = convexTest(schema);

    const photoId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        subject: "u_subject",
        email: "u@x.com",
        photoCount: 1,
        photoLimit: 1000,
        createdAt: FIXED_NOW - 30 * DAY_MS,
      });
      const storageId = await ctx.storage.store(new Blob(["x"]));
      const pid = await ctx.db.insert("photos", {
        ownerId: userId,
        storageId,
        ratingCount: 0,
        createdAt: FIXED_NOW - 30 * DAY_MS,
      });
      await ctx.db.insert("uploadIdempotency", {
        ownerId: userId,
        clientUploadId: "old",
        status: "completed",
        photoId: pid,
        createdAt: FIXED_NOW - 30 * DAY_MS,
        completedAt: FIXED_NOW - 30 * DAY_MS,
      });
      return pid;
    });

    await t.mutation(internal.uploads.cleanupOld, {});

    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo).not.toBeNull();
  });
});
