import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerUser, withUser } from "../_helpers/auth";
import { modules } from "../_helpers/modules";

// WP16 invariant 10 en open vraag 4 (teller per groep op Mijn groepen).
// `groups.listMine` geeft per groep `unreadCount`: de som van de tellers die
// `albums.listByGroupWithUnread` voor die groep geeft. Eén definitie van
// "nieuw" (migratie-plan §Unread-count), de app telt niet zelf op.
//
// Vervalt als Wouter bij open vraag 4 "nee" kiest.

type T = ReturnType<typeof convexTest>;

// Foto + koppeling met een vaste addedAt, na het lidmaatschap. Mutations
// gebruiken Date.now() en geven geen grip op de tijd.
async function publish(
  t: T,
  args: { ownerId: Id<"users">; albumId: Id<"albums">; groupId: Id<"groups">; addedAt: number },
) {
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["x"]));
    const photoId = await ctx.db.insert("photos", {
      ownerId: args.ownerId,
      storageId,
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
  });
}

async function setup(t: T) {
  const aliceId = await registerUser(t, "user_alice", "alice@x.com", "Alice");
  const bobId = await registerUser(t, "user_bob", "bob@x.com", "Bob");
  const g1 = await withUser(t, "user_alice").mutation(api.groups.create, { name: "Met albums" });
  const g2 = await withUser(t, "user_alice").mutation(api.groups.create, { name: "Leeg" });
  await withUser(t, "user_alice").mutation(api.groups.addMember, { groupId: g1, userId: bobId });
  const a1 = await withUser(t, "user_alice").mutation(api.albums.create, { groupId: g1, name: "A1" });
  const a2 = await withUser(t, "user_alice").mutation(api.albums.create, { groupId: g1, name: "A2" });
  const later = Date.now() + 60_000;
  return { aliceId, bobId, g1, g2, a1, a2, later };
}

async function mine(t: T, subject: string) {
  const rows = await withUser(t, subject).query(api.groups.listMine, {});
  return new Map(rows.map((g) => [g._id, g as typeof g & { unreadCount?: number }]));
}

async function sumOfAlbums(t: T, subject: string, groupId: Id<"groups">) {
  const albums = await withUser(t, subject).query(api.albums.listByGroupWithUnread, { groupId });
  return albums.reduce((n, a) => n + a.unreadCount, 0);
}

describe("groups.listMine: unreadCount per groep", () => {
  it("is de som van de albumtellers van die groep", async () => {
    const t = convexTest(schema, modules);
    const { aliceId, bobId, g1, a1, a2, later } = await setup(t);
    await publish(t, { ownerId: bobId, albumId: a1, groupId: g1, addedAt: later });
    await publish(t, { ownerId: bobId, albumId: a1, groupId: g1, addedAt: later + 1 });
    await publish(t, { ownerId: bobId, albumId: a2, groupId: g1, addedAt: later + 2 });
    await publish(t, { ownerId: aliceId, albumId: a2, groupId: g1, addedAt: later + 3 });

    const g = (await mine(t, "user_alice")).get(g1);
    expect(g?.unreadCount).toBe(3);
    expect(g?.unreadCount).toBe(await sumOfAlbums(t, "user_alice", g1));
  });

  it("een groep zonder albums, of zonder nieuwe foto's: 0", async () => {
    const t = convexTest(schema, modules);
    const { g1, g2 } = await setup(t);
    const rows = await mine(t, "user_alice");
    expect(rows.get(g1)?.unreadCount).toBe(0);
    expect(rows.get(g2)?.unreadCount).toBe(0);
  });

  it("eigen foto's tellen niet; elke user ziet zijn eigen getal", async () => {
    const t = convexTest(schema, modules);
    const { aliceId, bobId, g1, a1, later } = await setup(t);
    await publish(t, { ownerId: aliceId, albumId: a1, groupId: g1, addedAt: later });
    await publish(t, { ownerId: aliceId, albumId: a1, groupId: g1, addedAt: later + 1 });
    await publish(t, { ownerId: bobId, albumId: a1, groupId: g1, addedAt: later + 2 });

    expect((await mine(t, "user_alice")).get(g1)?.unreadCount).toBe(1);
    expect((await mine(t, "user_bob")).get(g1)?.unreadCount).toBe(2);
    expect((await mine(t, "user_bob")).get(g1)?.unreadCount).toBe(await sumOfAlbums(t, "user_bob", g1));
  });

  it("een album gezien: de groep telt alleen de rest", async () => {
    const t = convexTest(schema, modules);
    const { bobId, g1, a1, a2, later } = await setup(t);
    await publish(t, { ownerId: bobId, albumId: a1, groupId: g1, addedAt: later });
    await publish(t, { ownerId: bobId, albumId: a2, groupId: g1, addedAt: later + 1 });
    // markSeen zet lastSeenAt op Date.now(); de foto's staan in de toekomst.
    // Zet de rij daarom direct, na de foto in A1.
    await t.run(async (ctx) => {
      await ctx.db.insert("albumLastSeen", {
        userId: (await ctx.db
          .query("users")
          .withIndex("by_subject", (q) => q.eq("subject", "user_alice"))
          .unique())!._id,
        albumId: a1,
        lastSeenAt: later + 10,
      });
    });

    const g = (await mine(t, "user_alice")).get(g1);
    expect(g?.unreadCount).toBe(1);
    expect(g?.unreadCount).toBe(await sumOfAlbums(t, "user_alice", g1));
  });

  it("een nieuwe foto van een ander verhoogt het getal", async () => {
    const t = convexTest(schema, modules);
    const { bobId, g1, a1, later } = await setup(t);
    expect((await mine(t, "user_alice")).get(g1)?.unreadCount).toBe(0);
    await publish(t, { ownerId: bobId, albumId: a1, groupId: g1, addedAt: later });
    expect((await mine(t, "user_alice")).get(g1)?.unreadCount).toBe(1);
  });

  it("een groep van een ander telt niet mee in jouw groepen", async () => {
    const t = convexTest(schema, modules);
    const { later } = await setup(t);
    const other = await withUser(t, "user_bob").mutation(api.groups.create, { name: "Van Bob" });
    const album = await withUser(t, "user_bob").mutation(api.albums.create, { groupId: other, name: "X" });
    const carolId = await registerUser(t, "user_carol", "carol@x.com", "Carol");
    await withUser(t, "user_bob").mutation(api.groups.addMember, { groupId: other, userId: carolId });
    await publish(t, { ownerId: carolId, albumId: album, groupId: other, addedAt: later });

    const rows = await mine(t, "user_alice");
    expect(rows.has(other)).toBe(false);
    expect((await mine(t, "user_bob")).get(other)?.unreadCount).toBe(1);
  });
});
