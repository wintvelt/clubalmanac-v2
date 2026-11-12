import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP17c: gedeelde wereld voor Mijn foto's en "in welke albums".
// Spec: docs/work-packages/WP17c-mijn-fotos.md §Spec-criticus aanvullingen.

export const newT = () => convexTest(schema, modules);
export type T = ReturnType<typeof newT>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type R = Record<string, any>;

export const as = (t: T, key: string) => withUser(t, `user_${key}`);
/** Een identity zonder users-rij. */
export const asGhost = (t: T) => withUser(t, "user_ghost");

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2024, 0, 1);

/**
 * Wereld:
 *   G1 "Club"  — alice (admin), bob (member). Albums A1 "Zomer", A1b "Winter".
 *   G2 "Ander" — carol (admin). Album A2 "Ver".
 *   G3 "Derde" — alice (admin), carol (member). Album A3 "Feest".
 *
 *   pa1  alice, in A1
 *   pa2  alice, in A1 en A3
 *   pa3  alice, in geen album
 *   pa4  alice, in geen album, gemeld
 *   pa5  alice, in A2 (G2, waar alice geen lid van is: oude data)
 *   pb1  bob, in A1
 *   pb2  bob, in geen album
 *   pc1  carol, in A2 en A3
 *
 * `createdAt` (de uploaddatum) loopt op: pa1 oudst, pa5 nieuwst. Elke foto
 * heeft alle optionele velden gevuld, ook die buiten de foto-vorm vallen.
 */
export async function seedWorld(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const user = (key: string) =>
      ctx.db.insert("users", {
        subject: `user_${key}`,
        email: `${key}@x.test`,
        name: key,
        photoCount: 0,
        photoLimit: 5000,
        createdAt: now,
      });
    const users = { alice: await user("alice"), bob: await user("bob"), carol: await user("carol") };

    const group = (name: string, createdBy: Id<"users">) =>
      ctx.db.insert("groups", { name, createdBy, createdAt: now });
    const G1 = await group("Club", users.alice);
    const G2 = await group("Ander", users.carol);
    const G3 = await group("Derde", users.alice);

    const member = (userId: Id<"users">, groupId: Id<"groups">, role: "admin" | "member") =>
      ctx.db.insert("memberships", { userId, groupId, role, joinedAt: now });
    await member(users.alice, G1, "admin");
    await member(users.bob, G1, "member");
    await member(users.carol, G2, "admin");
    await member(users.alice, G3, "admin");
    await member(users.carol, G3, "member");

    const album = (groupId: Id<"groups">, name: string, createdBy: Id<"users">) =>
      ctx.db.insert("albums", { groupId, name, createdBy, createdAt: now });
    const A1 = await album(G1, "Zomer", users.alice);
    const A1b = await album(G1, "Winter", users.alice);
    const A2 = await album(G2, "Ver", users.carol);
    const A3 = await album(G3, "Feest", users.alice);

    const storageId = await ctx.storage.store(new Blob(["beeld"], { type: "image/jpeg" }));
    let n = 0;
    const photo = (ownerId: Id<"users">, extra: R = {}) =>
      ctx.db.insert("photos", {
        ownerId,
        storageId,
        filename: "IMG.jpg",
        mimeType: "image/jpeg",
        width: 4000,
        height: 3000,
        takenAt: BASE - DAY,
        latitude: 52.37,
        longitude: 4.89,
        locationLabel: "Amsterdam",
        exifOrientation: 1,
        ratingAverage: 1,
        ratingCount: 1,
        createdAt: BASE + ++n * DAY,
        ...extra,
      });
    const pa1 = await photo(users.alice);
    const pa2 = await photo(users.alice);
    const pa3 = await photo(users.alice);
    const pa4 = await photo(users.alice, {
      flaggedAt: now,
      flaggedBy: users.bob,
      flagReason: "ongepast",
      flaggedDeleteDate: now + 14 * DAY,
    });
    const pa5 = await photo(users.alice);
    const pb1 = await photo(users.bob);
    const pb2 = await photo(users.bob);
    const pc1 = await photo(users.carol);

    const publish = async (albumId: Id<"albums">, photoId: Id<"photos">) => {
      const a = await ctx.db.get(albumId);
      const p = await ctx.db.get(photoId);
      return await ctx.db.insert("albumPhotos", {
        albumId,
        photoId,
        groupId: a!.groupId,
        addedAt: now,
        addedBy: p!.ownerId,
      });
    };
    await publish(A1, pa1);
    await publish(A1, pa2);
    await publish(A3, pa2);
    await publish(A2, pa5);
    await publish(A1, pb1);
    await publish(A2, pc1);
    await publish(A3, pc1);

    return {
      users,
      groups: { G1, G2, G3 },
      albums: { A1, A1b, A2, A3 },
      photos: { pa1, pa2, pa3, pa4, pa5, pb1, pb2, pc1 },
    };
  });
}

export type World = Awaited<ReturnType<typeof seedWorld>>;

type Page = { page: R[]; isDone: boolean; continueCursor: string };

/**
 * Laadt alle pagina's van `photos.listMine` voor `key`, met `numItems` per
 * pagina. Controleert dat geen pagina groter is dan gevraagd.
 */
export async function loadAll(
  t: T,
  key: string,
  numItems: number,
  extra: R = {},
): Promise<{ items: R[]; pages: number }> {
  const items: R[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (let guard = 0; guard < 10_000; guard++) {
    const res = (await as(t, key).query(api.photos.listMine, {
      paginationOpts: { numItems, cursor },
      ...extra,
    })) as Page;
    pages++;
    expect(res.page.length, "pagina groter dan gevraagd").toBeLessThanOrEqual(numItems);
    items.push(...res.page);
    if (res.isDone) return { items, pages };
    cursor = res.continueCursor;
  }
  throw new Error("bladeren stopt niet");
}

export function idsOf(items: R[]): string[] {
  return items.map((i) => i._id as string);
}

/** De uitkomst van een call: de waarde, of de code van een ConvexError, of de tekst. */
export async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return { ok: await run() };
  } catch (e) {
    if (e instanceof ConvexError) return { code: (e.data as { code?: unknown })?.code };
    return { err: e instanceof Error ? e.message : String(e) };
  }
}

/** Een geldig foto-id van een gewiste foto. */
export async function gonePhotoId(t: T, ownerId: Id<"users">): Promise<Id<"photos">> {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["x"], { type: "image/jpeg" }));
    const id = await ctx.db.insert("photos", { ownerId, storageId, ratingCount: 0, createdAt: Date.now() });
    await ctx.db.delete(id);
    return id;
  });
}
