import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP17a invariant 11 en vraag 7 (spec §Spec-criticus aanvullingen).
//
// `albums.listPhotos` geeft per foto ook:
//   - `owner`: het publieke profiel van de eigenaar (het detail toont naam en
//     avatar), of null als de foto-rij of de users-rij ontbreekt;
//   - `isNew`: of de foto nieuw is voor de caller. Eén definitie met de teller
//     van `albums.listByGroupWithUnread` (migratie-plan §Unread-count): van een
//     ander, en `addedAt > effectiveLastSeen` (strict), met
//     effectiveLastSeen = albumLastSeen ?? max(album.createdAt, joinedAt).
//     Het aantal isNew is dus altijd gelijk aan de teller van dat album.
//
// Tijden worden expliciet gezet (direct insert), zoals in
// tests/albums/unreadCount.test.ts: mutations gebruiken Date.now().

type T = ReturnType<typeof convexTest>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Item = Record<string, any>;

const HOUR = 3_600_000;

async function setup(t: T) {
  const adminId = await registerUser(t, "user_admin", "admin@x.com", "Admin");
  const bobId = await registerUser(t, "user_bob", "bob@x.com", "Bob");
  const groupId = await withUser(t, "user_admin").mutation(api.groups.create, { name: "G" });
  await withUser(t, "user_admin").mutation(api.groups.addMember, { groupId, userId: bobId });
  const albumId = await withUser(t, "user_admin").mutation(api.albums.create, {
    groupId,
    name: "A",
  });
  // Album en lidmaatschap ruim in het verleden, zodat de terugval vóór alle
  // foto's hieronder ligt.
  const base = Date.now() - 100 * HOUR;
  await t.run(async (ctx) => {
    await ctx.db.patch(albumId, { createdAt: base });
    const ms = await ctx.db.query("memberships").collect();
    for (const m of ms) await ctx.db.patch(m._id, { joinedAt: base });
  });
  return { adminId, bobId, groupId, albumId, base };
}

async function publish(
  t: T,
  args: { ownerId: Id<"users">; albumId: Id<"albums">; groupId: Id<"groups">; addedAt: number },
): Promise<Id<"photos">> {
  return await t.run(async (ctx) => {
    const photoId = await ctx.db.insert("photos", {
      ownerId: args.ownerId,
      storageId: await ctx.storage.store(new Blob(["x"])),
      ratingCount: 0,
      createdAt: args.addedAt,
    });
    await ctx.db.insert("albumPhotos", {
      albumId: args.albumId,
      photoId,
      groupId: args.groupId,
      addedAt: args.addedAt,
      addedBy: args.ownerId,
    });
    return photoId;
  });
}

async function setLastSeen(t: T, userId: Id<"users">, albumId: Id<"albums">, lastSeenAt: number) {
  await t.run((ctx) => ctx.db.insert("albumLastSeen", { userId, albumId, lastSeenAt }));
}

async function list(t: T, subject: string, albumId: Id<"albums">): Promise<Item[]> {
  return (await withUser(t, subject).query(api.albums.listPhotos, { albumId })) as Item[];
}

function newIds(items: Item[]): string[] {
  return items.filter((i) => i.isNew === true).map((i) => i.albumPhoto.photoId).sort();
}

async function unreadOf(t: T, subject: string, groupId: Id<"groups">, albumId: Id<"albums">) {
  const albums = await withUser(t, subject).query(api.albums.listByGroupWithUnread, { groupId });
  return albums.find((a) => a._id === albumId)!.unreadCount;
}

describe("albums.listPhotos — owner", () => {
  it("per foto het publieke profiel van de eigenaar", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await publish(t, { ...s, ownerId: s.adminId, addedAt: s.base + HOUR });
    const items = await list(t, "user_bob", s.albumId);
    const item = items.find((i) => i.albumPhoto.photoId === p)!;
    expect(item.owner._id).toBe(s.adminId);
    expect(item.owner.name).toBe("Admin");
  });

  it("de naam van de eigenaar volgt live een wijziging (join, geen kopie)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const p = await publish(t, { ...s, ownerId: s.adminId, addedAt: s.base + HOUR });
    await withUser(t, "user_admin").mutation(api.users.updateProfile, { name: "Admin 2" });
    const item = (await list(t, "user_bob", s.albumId)).find((i) => i.albumPhoto.photoId === p)!;
    expect(item.owner.name).toBe("Admin 2");
  });
});

describe("albums.listPhotos — isNew (invariant 11)", () => {
  it("zonder bezoek: foto's van een ander na de terugval zijn nieuw, eigen foto's nooit", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const pAdmin = await publish(t, { ...s, ownerId: s.adminId, addedAt: s.base + HOUR });
    await publish(t, { ...s, ownerId: s.bobId, addedAt: s.base + 2 * HOUR });
    expect(newIds(await list(t, "user_bob", s.albumId))).toEqual([pAdmin]);
  });

  it("met bezoek: alleen wat na het bezoek kwam; precies op het bezoek telt niet (strict)", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const seenAt = s.base + 10 * HOUR;
    await publish(t, { ...s, ownerId: s.adminId, addedAt: seenAt - HOUR });
    await publish(t, { ...s, ownerId: s.adminId, addedAt: seenAt });
    const later = await publish(t, { ...s, ownerId: s.adminId, addedAt: seenAt + 1 });
    await setLastSeen(t, s.bobId, s.albumId, seenAt);
    expect(newIds(await list(t, "user_bob", s.albumId))).toEqual([later]);
  });

  it("per user: wat voor Bob nieuw is, is dat niet voor de eigenaar", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await publish(t, { ...s, ownerId: s.adminId, addedAt: s.base + HOUR });
    expect(newIds(await list(t, "user_admin", s.albumId))).toEqual([]);
    expect(newIds(await list(t, "user_bob", s.albumId))).toHaveLength(1);
  });

  it("na markSeen: niets meer nieuw, en de teller is 0", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await publish(t, { ...s, ownerId: s.adminId, addedAt: s.base + HOUR });
    await publish(t, { ...s, ownerId: s.adminId, addedAt: s.base + 2 * HOUR });
    expect(newIds(await list(t, "user_bob", s.albumId))).toHaveLength(2);
    await withUser(t, "user_bob").mutation(api.albums.markSeen, { albumId: s.albumId });
    expect(newIds(await list(t, "user_bob", s.albumId))).toEqual([]);
    expect(await unreadOf(t, "user_bob", s.groupId, s.albumId)).toBe(0);
  });

  it("het aantal isNew is gelijk aan de teller van het album, in elke stand", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    const check = async () => {
      const items = await list(t, "user_bob", s.albumId);
      expect(items.filter((i) => i.isNew).length).toBe(
        await unreadOf(t, "user_bob", s.groupId, s.albumId),
      );
    };
    await check();
    await publish(t, { ...s, ownerId: s.adminId, addedAt: s.base + HOUR });
    await publish(t, { ...s, ownerId: s.bobId, addedAt: s.base + 2 * HOUR });
    await check();
    await setLastSeen(t, s.bobId, s.albumId, s.base + 90 * HOUR);
    await publish(t, { ...s, ownerId: s.adminId, addedAt: s.base + 91 * HOUR });
    await check();
  });

  it("isNew is altijd een boolean, ook voor een eigen foto", async () => {
    const t = convexTest(schema, modules);
    const s = await setup(t);
    await publish(t, { ...s, ownerId: s.bobId, addedAt: s.base + HOUR });
    const [item] = await list(t, "user_bob", s.albumId);
    expect(item!.isNew).toBe(false);
  });
});
