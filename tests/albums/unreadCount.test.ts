import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";

// Cascade matrix rows AP1 (eliminated, vervangen door live count) en
// AP2 (eliminated, count corrigeert vanzelf bij delete).
//
// Mechanisme: per-album unread count = aantal albumPhotos waar
//   addedAt > effectiveLastSeen
//   && photo.ownerId != currentUser
// effectiveLastSeen = albumLastSeen?.lastSeenAt ?? max(album.createdAt, membership.joinedAt)

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";

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
  return await withUser(t, subject).mutation(api.users.register, { email });
}

type Setup = {
  adminId: Id<"users">;
  bobId: Id<"users">;
  groupId: Id<"groups">;
  albumId: Id<"albums">;
};

async function setup(t: ReturnType<typeof convexTest>): Promise<Setup> {
  const adminId = await registerUser(t, "user_admin", "admin@x.com");
  const bobId = await registerUser(t, "user_bob", "bob@x.com");
  const groupId = await withUser(t, "user_admin").mutation(api.groups.create, {
    name: "G",
  });
  await withUser(t, "user_admin").mutation(api.groups.addMember, {
    groupId,
    userId: bobId,
  });
  const albumId = await withUser(t, "user_admin").mutation(api.albums.create, {
    groupId,
    name: "A",
  });
  return { adminId, bobId, groupId, albumId };
}

async function uploadAndPublish(
  t: ReturnType<typeof convexTest>,
  uploaderSubject: string,
  albumId: Id<"albums">,
) {
  const storageId = await t.run(
    async (ctx) => await ctx.storage.store(new Blob(["x"])),
  );
  const photoId = await withUser(t, uploaderSubject).mutation(
    api.photos.create,
    { storageId },
  );
  await withUser(t, uploaderSubject).mutation(api.albums.addPhoto, {
    albumId,
    photoId,
  });
  return photoId;
}

describe("albums.listByGroupWithUnread fallback", () => {
  it("zonder lastSeen record: foto's geüpload na membership tellen mee", async () => {
    const t = convexTest(schema);
    const { groupId, albumId } = await setup(t);

    // Bob (member) heeft nog niks geopend. Admin upload 2 foto's.
    await uploadAndPublish(t, "user_admin", albumId);
    await uploadAndPublish(t, "user_admin", albumId);

    const list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list).toHaveLength(1);
    expect(list[0]?._id).toBe(albumId);
    expect(list[0]?.unreadCount).toBe(2);
  });

  it("eigen uploads tellen niet mee als unread", async () => {
    const t = convexTest(schema);
    const { groupId, albumId } = await setup(t);

    await uploadAndPublish(t, "user_admin", albumId); // door admin
    await uploadAndPublish(t, "user_bob", albumId); // door bob

    const bobList = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(bobList[0]?.unreadCount).toBe(1); // alleen admin's foto

    const adminList = await withUser(t, "user_admin").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(adminList[0]?.unreadCount).toBe(1); // alleen bob's foto
  });
});

describe("albums.markSeen + count", () => {
  it("count daalt naar 0 na markSeen", async () => {
    const t = convexTest(schema);
    const { groupId, albumId } = await setup(t);

    await uploadAndPublish(t, "user_admin", albumId);
    await uploadAndPublish(t, "user_admin", albumId);

    let list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(2);

    await withUser(t, "user_bob").mutation(api.albums.markSeen, { albumId });

    list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(0);
  });

  it("nieuwe foto's na markSeen tellen weer als unread", async () => {
    const t = convexTest(schema);
    const { groupId, albumId } = await setup(t);

    await uploadAndPublish(t, "user_admin", albumId);
    await withUser(t, "user_bob").mutation(api.albums.markSeen, { albumId });

    let list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(0);

    // Een paar ms later komt er een nieuwe foto
    await new Promise((r) => setTimeout(r, 5));
    await uploadAndPublish(t, "user_admin", albumId);

    list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(1);
  });

  it("AP2: count daalt vanzelf wanneer photo uit album wordt verwijderd", async () => {
    const t = convexTest(schema);
    const { groupId, albumId } = await setup(t);

    const p1 = await uploadAndPublish(t, "user_admin", albumId);
    await uploadAndPublish(t, "user_admin", albumId);

    let list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(2);

    await withUser(t, "user_admin").mutation(api.albums.removePhoto, {
      albumId,
      photoId: p1,
    });

    list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(1);
  });

  it("markSeen weigert voor niet-leden van de groep", async () => {
    const t = convexTest(schema);
    const { albumId } = await setup(t);
    await registerUser(t, "user_outsider", "out@x.com");

    await expect(
      withUser(t, "user_outsider").mutation(api.albums.markSeen, { albumId }),
    ).rejects.toThrow();
  });
});

describe("groups.markAllAlbumsSeen", () => {
  it("zet alle albums in groep op seen voor caller", async () => {
    const t = convexTest(schema);
    const { adminId, groupId, albumId } = await setup(t);
    void adminId;
    const album2 = await withUser(t, "user_admin").mutation(api.albums.create, {
      groupId,
      name: "B",
    });

    await uploadAndPublish(t, "user_admin", albumId);
    await uploadAndPublish(t, "user_admin", album2);

    let list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list.find((a) => a._id === albumId)?.unreadCount).toBe(1);
    expect(list.find((a) => a._id === album2)?.unreadCount).toBe(1);

    await withUser(t, "user_bob").mutation(api.groups.markAllAlbumsSeen, {
      groupId,
    });

    list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    for (const a of list) expect(a.unreadCount).toBe(0);
  });
});
