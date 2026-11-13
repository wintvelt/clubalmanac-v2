import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP17c invariant 2 / A-invariant 14, besluit 4 (audit S1): Mijn foto's laadt
// voor het grootste account, met marge, binnen de Convex-limieten. convex-test
// dwingt de limieten alleen af met `transactionLimits` (les WP28).
//
// Zo laadt de app (MyPhotosScreen): één live query die groeit, steeds vanaf
// het begin (`cursor: null`), tot alles er staat; met de schakelaar "Niet in
// een album" groeit hij door tot alles bekeken is. De test doet dus één
// aanroep die alles leest, in beide standen, met foto's die formaten hebben
// (twee leesacties per foto extra voor `hasFormats`).
//
// Prod (export 2026-11-06): de grootste eigenaar heeft 456 foto's, 5 in geen
// album; 6 groepen met samen 17 albums. Hier PHOTOS foto's (ruim 3×), elk in
// een album, verspreid over 17 albums in 6 groepen, plus LOOSE foto's in geen
// album. Rond 2000 foto's raakt één aanroep de grens (audit S1); echt bladeren
// staat in de backlog. Spec: docs/work-packages/WP17c-mijn-fotos.md.

const PHOTOS = 1500;
const LOOSE = 5;
const CHUNK = 500;
// De app groeit in stappen van 60 ("Alle") en 300 ("Niet in een album"),
// vanaf 60. Dit is de eerste stap die alle PHOTOS + LOOSE foto's dekt.
const ALL_STEP = 60;
const LOOSE_STEP = 300;
const firstCovering = (step: number) => Math.ceil((PHOTOS + LOOSE - ALL_STEP) / step) * step + ALL_STEP;

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
    // Eén setje formaten voor alle foto's: de leesacties per foto tellen
    // even zwaar als met eigen formaten.
    const formats = {
      klein: await ctx.storage.store(new Blob(["klein"], { type: "image/jpeg" })),
      groot: await ctx.storage.store(new Blob(["groot"], { type: "image/jpeg" })),
    };
    return { olga, albums, storageId, formats };
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
          formats: base.formats,
          width: 4000,
          height: 3000,
          takenAt: Date.UTC(2020, 0, 1) + i * 60_000,
          locationLabel: "Ergens",
          exifOrientation: 1,
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

type Page = { page: Array<{ _id: string; hasFormats: boolean }>; isDone: boolean; continueCursor: string };

/** Eén aanroep vanaf het begin, zoals de app: `numItems` foto's of minder. */
async function loadOnce(t: T, numItems: number, extra: Record<string, unknown> = {}): Promise<Page> {
  return (await withUser(t, "user_olga").query(api.photos.listMine, {
    paginationOpts: { numItems, cursor: null },
    ...extra,
  })) as Page;
}

describe("invariant 2, besluit 4: het grootste account, met marge, in één aanroep zoals de app", () => {
  it(`"Alle": ${PHOTOS + LOOSE} eigen foto's met formaten in één aanroep, binnen de limieten`, async () => {
    const t = newLimitedT();
    await bigWorld(t);
    const res = await loadOnce(t, firstCovering(ALL_STEP));
    expect(res.isDone).toBe(true);
    const ids = res.page.map((p) => p._id);
    expect(ids).toHaveLength(PHOTOS + LOOSE);
    expect(new Set(ids).size).toBe(PHOTOS + LOOSE);
    expect(res.page.every((p) => p.hasFormats)).toBe(true);
  }, 300_000);

  it(`"Niet in een album": alle ${PHOTOS + LOOSE} foto's bekeken in één aanroep, de ${LOOSE} losse gevonden`, async () => {
    const t = newLimitedT();
    const w = await bigWorld(t);
    const res = await loadOnce(t, firstCovering(LOOSE_STEP), { withoutAlbum: true });
    expect(res.isDone).toBe(true);
    expect(res.page.map((p) => p._id).sort()).toEqual([...w.loose].sort());
    expect(res.page.every((p) => p.hasFormats)).toBe(true);
  }, 300_000);

  it("\"in welke albums\" voor een foto van het grootste account, binnen de limieten", async () => {
    const t = newLimitedT();
    await bigWorld(t);
    const first = await loadOnce(t, 1);
    const res = (await withUser(t, "user_olga").query(api.albums.listForPhoto, {
      photoId: first.page[0]!._id as Id<"photos">,
    })) as unknown[];
    expect(Array.isArray(res)).toBe(true);
  }, 300_000);
});
