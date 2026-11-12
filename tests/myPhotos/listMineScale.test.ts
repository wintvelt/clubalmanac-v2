import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP17c invariant 2 / A-invariant 14: Mijn foto's laadt en bladert voor het
// grootste account, met marge, binnen de Convex-limieten. convex-test dwingt
// de limieten alleen af met `transactionLimits` (les WP28).
//
// Prod (export 2026-11-06): de grootste eigenaar heeft 456 foto's, 5 in geen
// album; 6 groepen met samen 17 albums. Hier PHOTOS foto's (ruim 3×), elk in
// een album, verspreid over 17 albums in 6 groepen, plus LOOSE foto's in geen
// album. Spec: docs/work-packages/WP17c-mijn-fotos.md.

const PHOTOS = 1500;
const LOOSE = 5;
const CHUNK = 500;
const PAGE = 100;

const newLimitedT = () => convexTest({ schema, modules, transactionLimits: true });
type T = ReturnType<typeof newLimitedT>;

async function bigWorld(t: T) {
  const base = await t.run(async (ctx) => {
    const now = Date.now();
    const olga = await ctx.db.insert("users", {
      subject: "user_olga",
      email: "olga@x.test",
      name: "Olga",
      photoCount: 0,
      photoLimit: 5000,
      createdAt: now,
    });
    const albums: Array<{ albumId: Id<"albums">; groupId: Id<"groups"> }> = [];
    for (let g = 0; g < 6; g++) {
      const groupId = await ctx.db.insert("groups", { name: `Groep ${g}`, createdBy: olga, createdAt: now });
      await ctx.db.insert("memberships", { userId: olga, groupId, role: "admin", joinedAt: now });
      const count = g === 0 ? 7 : 2; // 7 + 5 × 2 = 17 albums
      for (let a = 0; a < count; a++) {
        const albumId = await ctx.db.insert("albums", { groupId, name: `Album ${g}.${a}`, createdBy: olga, createdAt: now });
        albums.push({ albumId, groupId });
      }
    }
    const storageId = await ctx.storage.store(new Blob(["beeld"], { type: "image/jpeg" }));
    return { olga, albums, storageId };
  });

  const loose: Array<Id<"photos">> = [];
  for (let start = 0; start < PHOTOS + LOOSE; start += CHUNK) {
    const ids = await t.run(async (ctx) => {
      const out: Array<Id<"photos">> = [];
      const end = Math.min(start + CHUNK, PHOTOS + LOOSE);
      for (let i = start; i < end; i++) {
        const photoId = await ctx.db.insert("photos", {
          ownerId: base.olga,
          storageId: base.storageId,
          width: 4000,
          height: 3000,
          takenAt: Date.UTC(2020, 0, 1) + i * 60_000,
          locationLabel: "Ergens",
          exifOrientation: 1,
          ratingCount: 0,
          createdAt: Date.UTC(2021, 0, 1) + i * 3_600_000,
        });
        if (i < PHOTOS) {
          const { albumId, groupId } = base.albums[i % base.albums.length]!;
          await ctx.db.insert("albumPhotos", {
            albumId,
            photoId,
            groupId,
            addedAt: Date.now(),
            addedBy: base.olga,
          });
        } else out.push(photoId);
      }
      return out;
    });
    loose.push(...ids);
  }
  return { ...base, loose };
}

type Page = { page: Array<{ _id: string }>; isDone: boolean; continueCursor: string };

async function loadAll(t: T, extra: Record<string, unknown> = {}): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 1000; guard++) {
    const res = (await withUser(t, "user_olga").query(api.photos.listMine, {
      paginationOpts: { numItems: PAGE, cursor },
      ...extra,
    })) as Page;
    expect(res.page.length).toBeLessThanOrEqual(PAGE);
    ids.push(...res.page.map((p) => p._id));
    if (res.isDone) return ids;
    cursor = res.continueCursor;
  }
  throw new Error("bladeren stopt niet");
}

describe("invariant 2: het grootste account, met marge, binnen de limieten", () => {
  it(`${PHOTOS + LOOSE} eigen foto's: elke pagina binnen de limieten, elke foto één keer`, async () => {
    const t = newLimitedT();
    await bigWorld(t);
    const ids = await loadAll(t);
    expect(ids).toHaveLength(PHOTOS + LOOSE);
    expect(new Set(ids).size).toBe(PHOTOS + LOOSE);
  }, 300_000);

  it(`A-keuze 2: de schakelaar vindt de ${LOOSE} foto's in geen album, binnen de limieten`, async () => {
    const t = newLimitedT();
    const w = await bigWorld(t);
    const ids = await loadAll(t, { withoutAlbum: true });
    expect([...ids].sort()).toEqual([...w.loose].sort());
  }, 300_000);

  it("\"in welke albums\" voor een foto van het grootste account, binnen de limieten", async () => {
    const t = newLimitedT();
    await bigWorld(t);
    const first = (await withUser(t, "user_olga").query(api.photos.listMine, {
      paginationOpts: { numItems: 1, cursor: null },
    })) as Page;
    const res = (await withUser(t, "user_olga").query(api.albums.listForPhoto, {
      photoId: first.page[0]!._id as Id<"photos">,
    })) as unknown[];
    expect(Array.isArray(res)).toBe(true);
  }, 300_000);
});
