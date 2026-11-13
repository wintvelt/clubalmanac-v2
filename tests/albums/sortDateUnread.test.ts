import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP16 besluit 3: `sortDate` bepaalt alleen jaar en volgorde in de app. Hij
// telt niet mee in "nieuw". De terugval van de teller blijft
// max(album.createdAt, membership.joinedAt) (migratie-plan §Unread-count),
// ook als een admin een datum ver in het verleden of de toekomst koos.
// De vorm (sortDate in elke groep- en album-read) pint
// tests/readWhitelist/_world.ts.

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;

type T = ReturnType<typeof convexTest>;

async function setup(t: T, sortDateOffset: number) {
  const adminId = await registerUser(t, "user_admin", "admin@x.com", "Admin");
  const bobId = await registerUser(t, "user_bob", "bob@x.com", "Bob");
  const t0 = Date.now();
  const ids = await t.run(async (ctx) => {
    const groupId = await ctx.db.insert("groups", { name: "G", createdBy: adminId, createdAt: t0 - 20 * YEAR });
    await ctx.db.insert("memberships", { userId: adminId, groupId, role: "admin", joinedAt: t0 - 20 * YEAR });
    await ctx.db.insert("memberships", { userId: bobId, groupId, role: "member", joinedAt: t0 - 20 * YEAR });
    const albumId = await ctx.db.insert("albums", {
      groupId,
      name: "A",
      sortDate: t0 + sortDateOffset,
      createdBy: adminId,
      createdAt: t0,
    });
    return { groupId, albumId };
  });
  return { adminId, bobId, t0, ...ids };
}

async function publish(t: T, ownerId: Id<"users">, albumId: Id<"albums">, groupId: Id<"groups">, addedAt: number) {
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["x"]));
    const photoId = await ctx.db.insert("photos", { ownerId, storageId, createdAt: addedAt });
    await ctx.db.insert("albumPhotos", { albumId, photoId, groupId, addedAt, addedBy: ownerId });
  });
}

async function unread(t: T, groupId: Id<"groups">) {
  const [album] = await withUser(t, "user_bob").query(api.albums.listByGroupWithUnread, { groupId });
  return album!.unreadCount;
}

describe("sortDate telt niet mee in de teller", () => {
  it("een datum in de toekomst houdt een nieuwe foto niet verborgen", async () => {
    const t = convexTest(schema, modules);
    const { adminId, t0, groupId, albumId } = await setup(t, YEAR);
    await publish(t, adminId, albumId, groupId, t0 + DAY);
    expect(await unread(t, groupId)).toBe(1);
  });

  it("een datum in het verleden maakt een foto van vóór het album niet nieuw", async () => {
    const t = convexTest(schema, modules);
    const { adminId, t0, groupId, albumId } = await setup(t, -10 * YEAR);
    await publish(t, adminId, albumId, groupId, t0 - YEAR);
    await publish(t, adminId, albumId, groupId, t0 + DAY);
    expect(await unread(t, groupId)).toBe(1);
  });

  it("en ook niet in de teller per groep", async () => {
    const t = convexTest(schema, modules);
    const { adminId, t0, groupId, albumId } = await setup(t, YEAR);
    await publish(t, adminId, albumId, groupId, t0 + DAY);
    const mine = await withUser(t, "user_bob").query(api.groups.listMine, {});
    const g = mine.find((x) => x._id === groupId) as { unreadCount?: number } | undefined;
    expect(g?.unreadCount).toBe(1);
  });
});
