import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import { internalRemovePhoto } from "../../convex/photos";
import schema from "../../convex/schema";
import { deleteSelf } from "../../convex/users";
import { ISSUER } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP18 fix-cyclus 3 (hercheck red-team, besluit 7): A-invariant 26.
//
// Een foto wissen leest alleen de reservering(en) die bij die ene foto horen,
// niet alle reserveringen van de eigenaar. Anders groeit `users.deleteSelf`
// met foto's × uploads van de laatste 7 dagen en gaat hij over de leesgrens
// van Convex (32.000 gescande documenten per transactie): "Server Error", en
// het account blijft bestaan.
//
// convex-test handhaaft die grens niet. Daarom meet deze file wat een stap
// leest: een recorder om `ctx.db` noteert per query op `uploadIdempotency` het
// index-bereik, en telt de documenten in dat bereik zoals Convex ze leest. Een
// `.filter` erna maakt het bereik niet kleiner; zonder index is het bereik de
// hele tabel. `.first()`, `.unique()` en `.take(n)` zonder filter lezen er
// hooguit 1, 2 of n. De echte `internalRemovePhoto` en de echte handler van
// `deleteSelf` lopen met die recorder.
//
// Spec: docs/work-packages/WP18-foto-upload.md §Fix-cyclus 3.

type T = ReturnType<typeof convexTest>;
type Reservation = Doc<"uploadIdempotency">;
const MINUTE = 60_000;
const TABLE = "uploadIdempotency";

// Nep-klok: de geplande opruiming van storage loopt niet tussendoor (zie
// uploadAlbum.test.ts over convex-test 0.0.50).
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// ── De recorder ───────────────────────────────────────────────────────────

type Eq = { field: string; value: unknown };
type Scan = { index: string | null; eqs: Eq[]; filtered: boolean; limit: number | null; read: number };

const TERMINAL: Record<string, (args: unknown[]) => number | null> = {
  collect: () => null,
  paginate: () => null,
  first: () => 1,
  unique: () => 2,
  take: (args) => (typeof args[0] === "number" ? args[0] : null),
};

/** Een range-builder die elke `eq` noteert en de echte doorgeeft. */
function recordRange(q: unknown, eqs: Eq[]): unknown {
  return new Proxy(q as object, {
    get(target, prop, receiver) {
      const real = Reflect.get(target, prop, receiver);
      if (typeof real !== "function") return real;
      return (...args: unknown[]) => {
        if (prop === "eq") eqs.push({ field: String(args[0]), value: args[1] });
        return recordRange((real as (...a: unknown[]) => unknown).apply(target, args), eqs);
      };
    },
  });
}

/**
 * `ctx.db`, met een notitie per uitgevoerde query op `uploadIdempotency`.
 * `read` is het aantal documenten in het index-bereik op het moment van lezen.
 */
function recordingDb(db: MutationCtx["db"], scans: Scan[]): MutationCtx["db"] {
  const wrapQuery = (builder: unknown, state: Omit<Scan, "read" | "limit">): unknown =>
    new Proxy(builder as object, {
      get(target, prop, receiver) {
        const real = Reflect.get(target, prop, receiver);
        if (prop === Symbol.asyncIterator) {
          return () => {
            const it = (real as () => AsyncIterator<unknown>).call(target);
            let counted = false;
            return {
              next: async () => {
                if (!counted) {
                  counted = true;
                  await note(state, null);
                }
                return it.next();
              },
            };
          };
        }
        if (typeof real !== "function") return real;
        return (...args: unknown[]) => {
          const key = String(prop);
          if (key === "withIndex") {
            const [name, range] = args as [string, ((q: unknown) => unknown) | undefined];
            const next = { ...state, index: name };
            const wrapped = range ? (q: unknown) => range(recordRange(q, next.eqs)) : undefined;
            return wrapQuery((real as (...a: unknown[]) => unknown).call(target, name, wrapped), next);
          }
          if (key === "filter") {
            return wrapQuery((real as (...a: unknown[]) => unknown).apply(target, args), { ...state, filtered: true });
          }
          if (key in TERMINAL) {
            const limit = TERMINAL[key]!(args);
            return note(state, limit).then(() => (real as (...a: unknown[]) => unknown).apply(target, args));
          }
          const out = (real as (...a: unknown[]) => unknown).apply(target, args);
          return out && typeof out === "object" && !(out instanceof Promise) ? wrapQuery(out, state) : out;
        };
      },
    });

  async function note(state: Omit<Scan, "read" | "limit">, limit: number | null) {
    const all = (await db.query(TABLE).collect()) as Reservation[];
    const inRange = all.filter((r) =>
      state.eqs.every((e) => (r as unknown as Record<string, unknown>)[e.field] === e.value),
    ).length;
    const read = limit !== null && !state.filtered ? Math.min(limit, inRange) : inRange;
    scans.push({ ...state, limit, read });
  }

  return new Proxy(db as object, {
    get(target, prop, receiver) {
      const real = Reflect.get(target, prop, receiver);
      if (prop === "query") {
        return (table: string) => {
          const builder = (real as (t: string) => unknown).call(target, table);
          return table === TABLE ? wrapQuery(builder, { index: null, eqs: [], filtered: false }) : builder;
        };
      }
      return typeof real === "function" ? (real as (...a: unknown[]) => unknown).bind(target) : real;
    },
  }) as MutationCtx["db"];
}

const totalRead = (scans: Scan[]) => scans.reduce((n, s) => n + s.read, 0);

// ── De wereld ─────────────────────────────────────────────────────────────

/**
 * alice: `photos` foto's, elk met zijn eigen (afgeronde) reservering, plus
 * `pending` reserveringen "nog bezig". bob: een paar eigen reserveringen.
 */
async function world(t: T, photos: number, pending: number) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const user = (key: string, photoCount: number) =>
      ctx.db.insert("users", {
        subject: `user_${key}`,
        email: `${key}@x.com`,
        name: key,
        photoCount,
        photoLimit: 1000,
        createdAt: now - MINUTE,
      });
    const alice = await user("alice", photos);
    const bob = await user("bob", 3);
    const photoIds: Id<"photos">[] = [];
    for (let n = 0; n < photos; n++) {
      const storageId = await ctx.storage.store(new Blob([`a${n}`]));
      const photoId = await ctx.db.insert("photos", { ownerId: alice, storageId, ratingCount: 0, createdAt: now });
      photoIds.push(photoId);
      await ctx.db.insert(TABLE, {
        ownerId: alice,
        clientUploadId: `a-${n}`,
        status: "completed",
        photoId,
        createdAt: now,
        completedAt: now,
      });
    }
    for (let n = 0; n < pending; n++) {
      await ctx.db.insert(TABLE, { ownerId: alice, clientUploadId: `p-${n}`, status: "in_progress", createdAt: now });
    }
    const bobPhotos: Id<"photos">[] = [];
    for (let n = 0; n < 3; n++) {
      const storageId = await ctx.storage.store(new Blob([`b${n}`]));
      const photoId = await ctx.db.insert("photos", { ownerId: bob, storageId, ratingCount: 0, createdAt: now });
      bobPhotos.push(photoId);
      await ctx.db.insert(TABLE, {
        ownerId: bob,
        clientUploadId: `b-${n}`,
        status: "completed",
        photoId,
        createdAt: now,
        completedAt: now,
      });
    }
    return { alice, bob, photoIds, bobPhotos };
  });
}

async function reservations(t: T): Promise<Reservation[]> {
  return await t.run(async (ctx) => ctx.db.query(TABLE).collect());
}

// ── Sanity: de recorder ziet een scan over de eigenaar ────────────────────

describe("sanity: de recorder", () => {
  it("telt een scan over de eigenaar met een filter erna als alle reserveringen van de eigenaar", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t, 5, 4);
    const scans: Scan[] = [];
    const found = await t.run(async (ctx) => {
      const db = recordingDb(ctx.db, scans);
      return await db
        .query(TABLE)
        .withIndex("by_owner_and_clientUploadId", (q) => q.eq("ownerId", w.alice))
        .filter((q) => q.eq(q.field("photoId"), w.photoIds[0]!))
        .collect();
    });
    expect(found).toHaveLength(1);
    expect(scans).toHaveLength(1);
    expect(scans[0]!.read).toBe(9);
  });

  it("telt zonder index de hele tabel, en .first() zonder filter als één", async () => {
    const t = convexTest(schema, modules);
    await world(t, 2, 1);
    const scans: Scan[] = [];
    await t.run(async (ctx) => {
      const db = recordingDb(ctx.db, scans);
      await db.query(TABLE).collect();
      await db.query(TABLE).first();
    });
    expect(scans.map((s) => s.read)).toEqual([6, 1]);
  });
});

// ── A-invariant 26 ────────────────────────────────────────────────────────

describe("A-invariant 26: een foto wissen leest alleen de reservering van die foto", () => {
  it("internalRemovePhoto leest hooguit de reservering die naar de foto wijst, niet die van de hele eigenaar", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t, 30, 20);
    const target = w.photoIds[7]!;
    const scans: Scan[] = [];

    await t.run(async (ctx) => {
      await internalRemovePhoto({ ...ctx, db: recordingDb(ctx.db, scans) } as MutationCtx, target);
    });

    expect(totalRead(scans), JSON.stringify(scans)).toBeLessThanOrEqual(1);
    // En hij doet nog steeds zijn werk (A-invariant 22): alleen die reservering weg.
    const left = await reservations(t);
    expect(left.filter((r) => r.photoId === target)).toEqual([]);
    expect(left).toHaveLength(30 + 20 + 3 - 1);
  });

  it("een foto zonder reservering (ouder dan 7 dagen): niets gelezen", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t, 10, 5);
    const old = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["oud"]));
      return await ctx.db.insert("photos", { ownerId: w.alice, storageId, ratingCount: 0, createdAt: Date.now() });
    });
    const scans: Scan[] = [];

    await t.run(async (ctx) => {
      await internalRemovePhoto({ ...ctx, db: recordingDb(ctx.db, scans) } as MutationCtx, old);
    });

    expect(totalRead(scans), JSON.stringify(scans)).toBe(0);
    expect(await reservations(t)).toHaveLength(10 + 5 + 3);
  });

  it("users.deleteSelf: de reserveringen die hij leest groeien niet met foto's × uploads", async () => {
    const photos = 40;
    const pending = 25;
    const t = convexTest(schema, modules);
    const w = await world(t, photos, pending);
    const scans: Scan[] = [];

    await t.run(async (ctx) => {
      const auth = {
        getUserIdentity: async () => ({
          subject: "user_alice",
          issuer: ISSUER,
          tokenIdentifier: `${ISSUER}|user_alice`,
        }),
      };
      const handler = (deleteSelf as unknown as { _handler: (c: MutationCtx, a: object) => Promise<unknown> })._handler;
      await handler({ ...ctx, auth, db: recordingDb(ctx.db, scans) } as unknown as MutationCtx, {});
    });

    // Eén keer de eigen reserveringen (65) plus per foto hooguit de eigen (40).
    // Per foto alle reserveringen van de eigenaar zou 40 × 65 zijn.
    const own = photos + pending;
    expect(totalRead(scans), `gelezen: ${totalRead(scans)} in ${scans.length} queries`).toBeLessThanOrEqual(own + photos);
    // En hij doet nog steeds zijn werk (A-invariant 22): alles van alice weg, bob blijft.
    const left = await reservations(t);
    expect(left.filter((r) => r.ownerId === w.alice)).toEqual([]);
    expect(left.filter((r) => r.ownerId === w.bob).map((r) => r.photoId).sort()).toEqual([...w.bobPhotos].sort());
  });
});
