import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { collectDriftLines } from "../../convex/monitoring";
import schema from "../../convex/schema";
import { withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";
import { upload } from "./_upload";
import { deleteAccount } from "../_helpers/deleteAccount";

// WP18 fix-cyclus 2 (red-team M1 en Z1): de upload-reservering.
//
// A-invariant 22 (M1): een gewiste foto neemt zijn reservering mee, langs elk
// pad dat een foto wist (zelf, de cron voor gemelde foto's, het account). Geen
// vals alarm in de integriteitscheck, en een herhaling geeft nooit een photoId
// dat niet bestaat. Het account neemt al zijn reserveringen mee.
//
// A-invariant 23 (Z1): een "nog bezig"-reservering van 30 minuten of ouder telt
// bij een herhaling als geen reservering. Jonger: 409. Een late stap van de
// oude poging maakt geen tweede foto.
//
// Spec: docs/work-packages/WP18-foto-upload.md §Fix-cyclus 2.

type T = ReturnType<typeof convexTest>;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Nep-klok, zoals in uploadAlbum.test.ts: de geplande stappen na een upload
// (metadata, formaten, opruimen van storage) lopen niet tussendoor. In
// convex-test 0.0.50 rollen ze anders de schrijfacties van de volgende stap
// terug. Deze file pint de reservering, niet die stappen.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** G — alice (member), bob (admin), album A. Alles van een minuut geleden. */
async function world(t: T) {
  return await t.run(async (ctx) => {
    const then = Date.now() - MINUTE;
    const user = (key: string) =>
      ctx.db.insert("users", {
        subject: `user_${key}`,
        email: `${key}@x.com`,
        name: key,
        photoCount: 0,
        photoLimit: 1000,
        createdAt: then,
      });
    const alice = await user("alice");
    const bob = await user("bob");
    const g = await ctx.db.insert("groups", { name: "G", createdBy: bob, createdAt: then });
    await ctx.db.insert("memberships", { userId: alice, groupId: g, role: "member", joinedAt: then });
    await ctx.db.insert("memberships", { userId: bob, groupId: g, role: "admin", joinedAt: then });
    const albumA = await ctx.db.insert("albums", { groupId: g, name: "A", createdBy: bob, createdAt: then });
    return { alice, bob, g, albumA };
  });
}

const toAlbum = (albumId: string) => ({ "X-Album-Id": albumId });

async function photoIdOf(res: Response): Promise<Id<"photos">> {
  expect(res.status).toBe(200);
  const body = (await res.json()) as { photoId?: Id<"photos"> };
  expect(typeof body.photoId).toBe("string");
  return body.photoId!;
}

/** De regels van de integriteitscheck over reserveringen. */
async function reservationDrift(t: T): Promise<string[]> {
  const lines = await t.run(async (ctx) => await collectDriftLines(ctx));
  return lines.filter((l) => l.startsWith("uploadIdempotency/"));
}

async function reservations(t: T) {
  return await t.run(async (ctx) => ctx.db.query("uploadIdempotency").collect());
}

async function reservationsFor(t: T, ownerId: Id<"users">, clientUploadId: string) {
  return (await reservations(t)).filter((r) => r.ownerId === ownerId && r.clientUploadId === clientUploadId);
}

async function photosOf(t: T, ownerId: Id<"users">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("photos")
      .filter((q) => q.eq(q.field("ownerId"), ownerId))
      .collect(),
  );
}

async function inAlbum(t: T, albumId: Id<"albums">, photoId: Id<"photos">): Promise<number> {
  return await t.run(async (ctx) =>
    (
      await ctx.db
        .query("albumPhotos")
        .filter((q) => q.and(q.eq(q.field("albumId"), albumId), q.eq(q.field("photoId"), photoId)))
        .collect()
    ).length,
  );
}

async function photoCount(t: T, userId: Id<"users">): Promise<number> {
  return await t.run(async (ctx) => (await ctx.db.get(userId))!.photoCount);
}

describe("A-invariant 22: een gewiste foto neemt zijn reservering mee", () => {
  it("photos.remove: geen reservering meer naar de foto, geen regel in de integriteitscheck", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const p1 = await photoIdOf(await upload(t, "user_alice", { uploadId: "u1", headers: toAlbum(w.albumA) }));

    await withUser(t, "user_alice").mutation(api.photos.remove, { photoId: p1 });

    expect((await reservations(t)).filter((r) => r.photoId === p1)).toEqual([]);
    expect(await reservationDrift(t)).toEqual([]);
  });

  it("de herhaling na het wissen is een nieuwe foto, in het album, nooit het gewiste photoId", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const p1 = await photoIdOf(await upload(t, "user_alice", { uploadId: "u1", headers: toAlbum(w.albumA) }));
    await withUser(t, "user_alice").mutation(api.photos.remove, { photoId: p1 });

    const p2 = await photoIdOf(await upload(t, "user_alice", { uploadId: "u1", headers: toAlbum(w.albumA) }));

    expect(p2).not.toBe(p1);
    expect(await t.run(async (ctx) => (await ctx.db.get(p2)) !== null)).toBe(true);
    expect(await inAlbum(t, w.albumA, p2)).toBe(1);
    expect(await photoCount(t, w.alice)).toBe(1);
    const rows = await reservationsFor(t, w.alice, "u1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.photoId).toBe(p2);
    expect(await reservationDrift(t)).toEqual([]);
  });

  it("de cron voor gemelde foto's: de reservering gaat mee", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const p = await photoIdOf(await upload(t, "user_alice", { uploadId: "u2", headers: toAlbum(w.albumA) }));
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.patch(p, { flaggedAt: now - 15 * 24 * HOUR, flaggedBy: w.bob, flaggedDeleteDate: now - 1 });
    });

    await t.mutation(internal.photos.cleanupFlaggedPhotos, {});

    expect(await t.run(async (ctx) => ctx.db.get(p))).toBeNull();
    expect((await reservations(t)).filter((r) => r.photoId === p)).toEqual([]);
    expect(await reservationDrift(t)).toEqual([]);
  });

  it("users.deleteSelf: alle reserveringen van de user weg, ook nog bezig; die van een ander blijven", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await photoIdOf(await upload(t, "user_alice", { uploadId: "a1", headers: toAlbum(w.albumA) }));
    await photoIdOf(await upload(t, "user_alice", { uploadId: "a2" }));
    const bobs = await photoIdOf(await upload(t, "user_bob", { uploadId: "b1", headers: toAlbum(w.albumA) }));
    const pending = await t.mutation(internal.uploads.reserve, { ownerId: w.alice, clientUploadId: "a3" });
    expect(pending.kind).toBe("reserved");

    await deleteAccount(t, withUser(t, "user_alice"));

    const left = await reservations(t);
    expect(left.filter((r) => r.ownerId === w.alice)).toEqual([]);
    expect(left.filter((r) => r.ownerId === w.bob).map((r) => r.photoId)).toEqual([bobs]);
    expect(await reservationDrift(t)).toEqual([]);
  });

  it("een reservering die al naar een gewiste foto wees (van vóór de fix): nooit dat photoId", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const dead = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["weg"]));
      const id = await ctx.db.insert("photos", { ownerId: w.alice, storageId, createdAt: Date.now() });
      await ctx.db.delete(id);
      await ctx.storage.delete(storageId);
      const day = Date.now() - 24 * HOUR;
      await ctx.db.insert("uploadIdempotency", {
        ownerId: w.alice,
        clientUploadId: "oud",
        status: "completed",
        photoId: id,
        createdAt: day,
        completedAt: day,
      });
      return id;
    });

    const res = await upload(t, "user_alice", { uploadId: "oud", headers: toAlbum(w.albumA) });
    const p = await photoIdOf(res);

    expect(p).not.toBe(dead);
    expect(await t.run(async (ctx) => (await ctx.db.get(p)) !== null)).toBe(true);
    expect(await inAlbum(t, w.albumA, p)).toBe(1);
    expect(await photoCount(t, w.alice)).toBe(1);
    const rows = await reservationsFor(t, w.alice, "oud");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.photoId).toBe(p);
    expect(await reservationDrift(t)).toEqual([]);
  });
});

describe("A-invariant 23: een reservering die blijft hangen, verloopt na 30 minuten", () => {
  /** De server stopte na het reserveren: een "nog bezig"-reservering zonder foto. */
  async function stranded(t: T, ownerId: Id<"users">, clientUploadId: string) {
    const r = await t.mutation(internal.uploads.reserve, { ownerId, clientUploadId });
    expect(r.kind).toBe("reserved");
    return (r as { reservationId: Id<"uploadIdempotency"> }).reservationId;
  }

  it.each<[string, number]>([
    ["31 minuten", 31 * MINUTE],
    ["21 uur", 21 * HOUR],
  ])("na %s uploadt de herhaling: één foto, één reservering", async (_label, wait) => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await stranded(t, w.alice, "s1");
    vi.advanceTimersByTime(wait);

    const p = await photoIdOf(await upload(t, "user_alice", { uploadId: "s1", headers: toAlbum(w.albumA) }));

    expect((await photosOf(t, w.alice)).map((x) => x._id)).toEqual([p]);
    expect(await inAlbum(t, w.albumA, p)).toBe(1);
    expect(await photoCount(t, w.alice)).toBe(1);
    const rows = await reservationsFor(t, w.alice, "s1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "completed", photoId: p });
  });

  it("na 29 minuten nog 409: het eerste verzoek kan nog lopen", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await stranded(t, w.alice, "s1");
    vi.advanceTimersByTime(29 * MINUTE);

    const res = await upload(t, "user_alice", { uploadId: "s1", headers: toAlbum(w.albumA) });

    expect(res.status).toBe(409);
    expect(await photosOf(t, w.alice)).toEqual([]);
    expect(await photoCount(t, w.alice)).toBe(0);
  });

  it("een late stap van de oude poging maakt geen tweede foto", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const old = await stranded(t, w.alice, "s1");
    vi.advanceTimersByTime(31 * MINUTE);
    const p = await photoIdOf(await upload(t, "user_alice", { uploadId: "s1", headers: toAlbum(w.albumA) }));

    // De oude poging komt alsnog bij het maken van de foto, met haar eigen reservering.
    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(["laat"])));
    try {
      await t.mutation(internal.photos.createFromUploadInternal, {
        storageId,
        ownerId: w.alice,
        reservationId: old,
        albumId: w.albumA,
      });
    } catch {
      // Weigeren mag; het gaat om wat er staat.
    }

    expect((await photosOf(t, w.alice)).map((x) => x._id)).toEqual([p]);
    expect(await photoCount(t, w.alice)).toBe(1);
    const rows = await reservationsFor(t, w.alice, "s1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.photoId).toBe(p);
  });

  it("de herhaling krijgt een verse reservering: een tweede herhaling vlak erna krijgt 409, geen tweede foto", async () => {
    // Twee herhalingen tegelijk. convex-test draait geen twee uploads echt
    // parallel (storage buiten de transactie), dus in volgorde: de eerste
    // herhaling heeft net gereserveerd en is bezig, dan komt de tweede.
    const t = convexTest(schema, modules);
    const w = await world(t);
    await stranded(t, w.alice, "s1");
    vi.advanceTimersByTime(31 * MINUTE);

    const firstRetry = await t.mutation(internal.uploads.reserve, { ownerId: w.alice, clientUploadId: "s1" });
    expect(firstRetry.kind).toBe("reserved");
    vi.advanceTimersByTime(MINUTE);

    const second = await upload(t, "user_alice", { uploadId: "s1", headers: toAlbum(w.albumA) });
    expect(second.status).toBe(409);
    expect(await photosOf(t, w.alice)).toEqual([]);
    expect(await reservationsFor(t, w.alice, "s1")).toHaveLength(1);
  });
});
