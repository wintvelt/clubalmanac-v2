import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api , internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";

// Cascade matrix rows AP1 (eliminated, vervangen door live count) en
// AP2 (eliminated, count corrigeert vanzelf bij delete).
//
// Mechanisme: per-album unread count = aantal albumPhotos waar
//   addedAt > effectiveLastSeen
//   && photo.ownerId != currentUser
// effectiveLastSeen = albumLastSeen?.lastSeenAt ?? max(album.createdAt, membership.joinedAt)
//
// Strict > geldt voor beide paden (lastSeen én fallback). Foto met
// addedAt === effectiveLastSeen is niet unread. Zie design-doc sectie
// "Unread-count per album per user (albumLastSeen)".

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
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      subject,
      email: email.toLowerCase().trim(),
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    }),
  );
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

// Direct insert van photo + albumPhoto met expliciete addedAt. Nodig voor
// boundary-tests (strict > semantiek) en voor timing-precisie zonder
// sleeps: mutations gebruiken intern Date.now() en bieden geen handvat om
// addedAt op een specifieke ms te pinnen.
async function insertPhotoAndPublish(
  t: ReturnType<typeof convexTest>,
  args: {
    ownerId: Id<"users">;
    albumId: Id<"albums">;
    groupId: Id<"groups">;
    addedBy: Id<"users">;
    addedAt: number;
  },
): Promise<Id<"photos">> {
  return await t.run(async (ctx) => {
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
      addedBy: args.addedBy,
    });
    return photoId;
  });
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
    const { adminId, bobId, groupId, albumId } = await setup(t);

    // addedAt expliciet > album.createdAt om ms-collision met setup() te
    // vermijden — strict > semantiek.
    const album = await t.run(async (ctx) => await ctx.db.get(albumId));
    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: album!.createdAt + 1,
    });
    await insertPhotoAndPublish(t, {
      ownerId: bobId,
      albumId,
      groupId,
      addedBy: bobId,
      addedAt: album!.createdAt + 2,
    });

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

  // Audit-6 P4-bias fix: bestaande uploadAndPublish helper laat dezelfde
  // user zowel photos.create als albums.addPhoto doen, dus photo.ownerId
  // === albumPhoto.addedBy in al die tests. Onderstaande test splitst die
  // rollen expliciet uit en pinnen het filter op photo.ownerId vast (zoals
  // design-doc voorschrijft) — niet per ongeluk op albumPhoto.addedBy.
  it("AP1 filter discrimineert tussen photo-owner en albumPhoto.addedBy", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_admin", "alice@x.com");
    const bobId = await registerUser(t, "user_bob", "bob@x.com");
    const carolId = await registerUser(t, "user_carol", "carol@x.com");

    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: carolId,
    });
    const albumId = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );

    // photo.ownerId === alice, albumPhoto.addedBy === bob (split rollen).
    // addedAt expliciet > album.createdAt om ms-collision met setup() te
    // vermijden — strict > semantiek.
    const album = await t.run(async (ctx) => await ctx.db.get(albumId));
    await insertPhotoAndPublish(t, {
      ownerId: aliceId,
      albumId,
      groupId,
      addedBy: bobId,
      addedAt: album!.createdAt + 1,
    });

    const aliceList = await withUser(t, "user_admin").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    const bobList = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    const carolList = await withUser(t, "user_carol").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );

    // Correcte filter (op photo.ownerId): Alice 0, Bob 1, Carol 1.
    // Een foute filter op albumPhoto.addedBy zou opleveren: Alice 1
    // (addedBy=bob != alice), Bob 0 (addedBy=bob == bob), Carol 1.
    // Verschil op zowel Alice (0 vs 1) als Bob (1 vs 0) discrimineert
    // tussen de twee filterkeuzes — uploadAndPublish helper kan dit niet.
    expect(aliceList[0]?.unreadCount).toBe(0);
    expect(bobList[0]?.unreadCount).toBe(1);
    expect(carolList[0]?.unreadCount).toBe(1);
  });

  // Fallback joinedAt-tak van max(album.createdAt, membership.joinedAt):
  // member joined ná album-create. Bestaande tests gebruikten een setup
  // waarin bob.joinedAt < album.createdAt, dus alleen de album.createdAt-
  // tak werd geraakt. Deze drie tests pinnen de joinedAt-tak vast.
  // Direct insert van membership om joinedAt op een gekozen ms te pinnen
  // (addMember mutation gebruikt Date.now()).
  it("fallback joinedAt-tak: foto's van vóór join tellen niet als unread", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_admin", "admin@x.com");
    const bobId = await registerUser(t, "user_bob", "bob@x.com");

    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "G" },
    );
    const albumId = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );
    // 3 foto's vóór bob's join.
    await uploadAndPublish(t, "user_admin", albumId);
    await uploadAndPublish(t, "user_admin", albumId);
    await uploadAndPublish(t, "user_admin", albumId);

    // Bob joins ná de uploads — joinedAt > alle photo.addedAt.
    const lastAdded = await t.run(async (ctx) => {
      const aps = await ctx.db
        .query("albumPhotos")
        .withIndex("by_album", (q) => q.eq("albumId", albumId))
        .collect();
      return Math.max(...aps.map((ap) => ap.addedAt));
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", {
        userId: bobId,
        groupId,
        role: "member",
        joinedAt: lastAdded + 100,
      });
    });

    // bob.effective = max(album.createdAt, bob.joinedAt) = bob.joinedAt.
    // Alle foto's hebben addedAt < bob.joinedAt → niets unread.
    const list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(0);
  });

  it("fallback joinedAt-tak: alleen foto's na join tellen als unread", async () => {
    const t = convexTest(schema);
    const adminId = await registerUser(t, "user_admin", "admin@x.com");
    const bobId = await registerUser(t, "user_bob", "bob@x.com");

    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "G" },
    );
    const albumId = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );
    const album = await t.run(async (ctx) => await ctx.db.get(albumId));

    // T1 < T2 < T3, alle ná album.createdAt.
    const T1 = album!.createdAt + 10;
    const T2 = T1 + 100;
    const T3 = T2 + 100;

    // Foto T1: vóór bob's join.
    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: T1,
    });
    // Bob joins op T2.
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", {
        userId: bobId,
        groupId,
        role: "member",
        joinedAt: T2,
      });
    });
    // Foto T3: ná bob's join.
    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: T3,
    });

    // bob.effective = max(album.createdAt, T2) = T2.
    // T1 < T2 (niet unread), T3 > T2 (unread).
    const list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(1);
  });

  it("fallback joinedAt-tak: foto na join met leeg album telt als unread", async () => {
    const t = convexTest(schema);
    const adminId = await registerUser(t, "user_admin", "admin@x.com");
    const bobId = await registerUser(t, "user_bob", "bob@x.com");

    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "G" },
    );
    const albumId = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );
    const album = await t.run(async (ctx) => await ctx.db.get(albumId));

    // Bob joins ná album-create, album is nog leeg.
    const T2 = album!.createdAt + 100;
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", {
        userId: bobId,
        groupId,
        role: "member",
        joinedAt: T2,
      });
    });

    // Foto na bob's join. effective = max(album.createdAt, T2) = T2.
    const T3 = T2 + 100;
    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: T3,
    });

    const list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(1);
  });
});

describe("albums.listByGroupWithUnread strict > boundary", () => {
  // Strict > geldt voor beide paden van effectiveLastSeen. Een foto met
  // addedAt === effectiveLastSeen is NIET unread. Tests gebruiken directe
  // ctx.db.insert om addedAt op de exacte boundary te pinnen — mutations
  // bieden geen handvat voor ms-precisie en sleeps zijn flakey.
  // Zie design-doc sectie "Unread-count per album per user (albumLastSeen)".

  it("lastSeen-pad: foto met addedAt === lastSeenAt is niet unread", async () => {
    const t = convexTest(schema);
    const { adminId, bobId, groupId, albumId } = await setup(t);

    // Eerst markSeen om een lastSeen record te krijgen.
    await uploadAndPublish(t, "user_admin", albumId);
    await withUser(t, "user_bob").mutation(api.albums.markSeen, { albumId });

    const lastSeenAt = await t.run(async (ctx) => {
      const rec = await ctx.db
        .query("albumLastSeen")
        .withIndex("by_user_album", (q) =>
          q.eq("userId", bobId).eq("albumId", albumId),
        )
        .unique();
      return rec?.lastSeenAt;
    });
    expect(lastSeenAt).toBeDefined();

    // Nieuwe foto met addedAt === lastSeenAt. Strict > → telt niet.
    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: lastSeenAt as number,
    });

    const list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(0);
  });

  // TDD red phase: verwacht ROOD totdat de -1ms fallback-hack uit
  // convex/albums.ts:107-112 is verwijderd. Met de huidige hack is
  // effective = album.createdAt - 1, waardoor addedAt === album.createdAt
  // onder gt(addedAt, effective) wél als unread telt (foute count = 1).
  // Strict > eist dat dezelfde boundary in fallback-pad óók niet als
  // unread telt (count = 0).
  it("fallback-pad (album.createdAt-tak): addedAt === album.createdAt is niet unread", async () => {
    const t = convexTest(schema);
    const { adminId, groupId, albumId } = await setup(t);

    const album = await t.run(async (ctx) => await ctx.db.get(albumId));
    expect(album).not.toBeNull();

    // Bob heeft nog niks geopend → fallback. setup() zorgt dat
    // bob.joinedAt < album.createdAt, dus effective = album.createdAt.
    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: album!.createdAt,
    });

    const list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(0);
  });

  // TDD red phase: idem als hierboven, maar exerciseert de joinedAt-tak
  // van max(). Met -1ms hack zou addedAt === membership.joinedAt nog
  // tellen (foute count = 1). Strict > → count = 0.
  it("fallback-pad (joinedAt-tak): addedAt === membership.joinedAt is niet unread", async () => {
    const t = convexTest(schema);
    const adminId = await registerUser(t, "user_admin", "admin@x.com");
    const bobId = await registerUser(t, "user_bob", "bob@x.com");

    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "G" },
    );
    const albumId = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );
    const album = await t.run(async (ctx) => await ctx.db.get(albumId));

    // Bob joins ná album-create, dus effective = bob.joinedAt.
    const joinedAt = album!.createdAt + 1000;
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", {
        userId: bobId,
        groupId,
        role: "member",
        joinedAt,
      });
    });

    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: joinedAt,
    });

    const list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(0);
  });
});

describe("albums.markSeen + count", () => {
  it("count daalt naar 0 na markSeen", async () => {
    const t = convexTest(schema);
    const { adminId, bobId, groupId, albumId } = await setup(t);

    // addedAt expliciet > album.createdAt om ms-collision met setup() te
    // vermijden — strict > semantiek.
    const album = await t.run(async (ctx) => await ctx.db.get(albumId));
    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: album!.createdAt + 1,
    });
    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: album!.createdAt + 2,
    });

    let list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(2);

    await withUser(t, "user_bob").mutation(api.albums.markSeen, { albumId });
    // markSeen gebruikt Date.now() — in convex-test loopt de wall-clock
    // niet altijd op tussen mutations binnen één test, dus lastSeenAt kan
    // === album.createdAt zijn en photos.addedAt (= album.createdAt + 1/2)
    // niet voorbij. Bump lastSeenAt expliciet voorbij beide photos om
    // strict > deterministisch te toetsen.
    await t.run(async (ctx) => {
      const rec = await ctx.db
        .query("albumLastSeen")
        .withIndex("by_user_album", (q) =>
          q.eq("userId", bobId).eq("albumId", albumId),
        )
        .unique();
      await ctx.db.patch(rec!._id, { lastSeenAt: album!.createdAt + 10 });
    });

    list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(0);
  });

  it("nieuwe foto's na markSeen tellen weer als unread", async () => {
    const t = convexTest(schema);
    const { adminId, bobId, groupId, albumId } = await setup(t);

    await uploadAndPublish(t, "user_admin", albumId);
    await withUser(t, "user_bob").mutation(api.albums.markSeen, { albumId });

    let list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(0);

    // Geen sleep nodig: directe insert met addedAt = lastSeenAt + 1
    // garandeert deterministisch dat de foto strict ná de markSeen valt.
    // De oude setTimeout(5)-hack was kwetsbaar voor ms-collisions tussen
    // markSeen's Date.now() en uploadAndPublish's Date.now().
    const lastSeenAt = await t.run(async (ctx) => {
      const rec = await ctx.db
        .query("albumLastSeen")
        .withIndex("by_user_album", (q) =>
          q.eq("userId", bobId).eq("albumId", albumId),
        )
        .unique();
      return rec!.lastSeenAt;
    });
    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: lastSeenAt + 1,
    });

    list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list[0]?.unreadCount).toBe(1);
  });

  it("AP2: count daalt vanzelf wanneer photo uit album wordt verwijderd", async () => {
    const t = convexTest(schema);
    const { adminId, groupId, albumId } = await setup(t);

    // addedAt expliciet > album.createdAt om ms-collision met setup() te
    // vermijden — strict > semantiek.
    const album = await t.run(async (ctx) => await ctx.db.get(albumId));
    const p1 = await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: album!.createdAt + 1,
    });
    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: album!.createdAt + 2,
    });

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
    const { adminId, bobId, groupId, albumId } = await setup(t);
    const album2 = await withUser(t, "user_admin").mutation(api.albums.create, {
      groupId,
      name: "B",
    });

    // addedAt expliciet > album.createdAt om ms-collision met setup() te
    // vermijden — strict > semantiek.
    const albumA = await t.run(async (ctx) => await ctx.db.get(albumId));
    const albumB = await t.run(async (ctx) => await ctx.db.get(album2));
    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId,
      groupId,
      addedBy: adminId,
      addedAt: albumA!.createdAt + 1,
    });
    await insertPhotoAndPublish(t, {
      ownerId: adminId,
      albumId: album2,
      groupId,
      addedBy: adminId,
      addedAt: albumB!.createdAt + 1,
    });

    let list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    expect(list.find((a) => a._id === albumId)?.unreadCount).toBe(1);
    expect(list.find((a) => a._id === album2)?.unreadCount).toBe(1);

    await withUser(t, "user_bob").mutation(api.groups.markAllAlbumsSeen, {
      groupId,
    });
    // markAllAlbumsSeen gebruikt Date.now() — in convex-test loopt de
    // wall-clock niet altijd op tussen mutations, dus lastSeenAt kan ===
    // album.createdAt zijn en photos.addedAt (= album.createdAt + 1) niet
    // voorbij. Bump beide lastSeenAt records expliciet voorbij de photos.
    await t.run(async (ctx) => {
      const recs = await ctx.db
        .query("albumLastSeen")
        .withIndex("by_user", (q) => q.eq("userId", bobId))
        .collect();
      for (const r of recs) {
        await ctx.db.patch(r._id, {
          lastSeenAt: Math.max(albumA!.createdAt, albumB!.createdAt) + 10,
        });
      }
    });

    list = await withUser(t, "user_bob").query(
      api.albums.listByGroupWithUnread,
      { groupId },
    );
    for (const a of list) expect(a.unreadCount).toBe(0);
  });
});
