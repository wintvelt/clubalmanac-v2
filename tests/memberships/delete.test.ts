import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Cascade matrix rows M1, M2, M3: cascades + admin/founder-successie
// vanuit groups.removeMember (UM delete trigger).
//
// M1 — albumPhotos van vertrekkende user in déze group worden verwijderd.
//      Oude AWS-handler (memberDelToAlbumPhoto.js) filtert op photo-OWNER
//      via userPhotoKeys.includes(albumPhoto.SK). Convex filtert op
//      addedBy — divergentie wordt afgedekt door de cross-owner test.
// M2 — admin/founder successie, mapt 1-op-1 op memberDelToGroup.js:
//   memberDelToGroup.js:17  hasOtherAdmin = members.find(role === 'admin')
//   memberDelToGroup.js:18  noFounderleft = !members.find(isFounder)
//   memberDelToGroup.js:19-32  !hasOtherAdmin → allen admin, eerste founder
//   memberDelToGroup.js:33-37  noFounderleft && hasOtherAdmin → die founder
//   memberDelToGroup.js:39-43  members.length===0 → group delete
// M3 — albumLastSeen voor (user × albums in déze group) opgeruimd.

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

describe("M1: removeMember cascade albumPhotos in déze group", () => {
  it("verwijdert albumPhotos die vertrekkende user toevoegde", async () => {
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });
    const albumId = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );

    const storageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["x"])),
    );
    const bobPhoto = await withUser(t, "user_bob").mutation(
      api.photos.create,
      { storageId },
    );
    await withUser(t, "user_bob").mutation(api.albums.addPhoto, {
      albumId,
      photoId: bobPhoto,
    });

    await withUser(t, "user_alice").mutation(api.groups.removeMember, {
      groupId,
      userId: bobId,
    });

    const aps = await t.run((ctx) =>
      ctx.db
        .query("albumPhotos")
        .withIndex("by_album", (q) => q.eq("albumId", albumId))
        .collect(),
    );
    expect(aps).toHaveLength(0);

    // photo zelf blijft (eigendom bob, andere groups kunnen 'm hergebruiken)
    const photo = await t.run((ctx) => ctx.db.get(bobPhoto));
    expect(photo).not.toBeNull();
    void aliceId;
  });

  it("laat albumPhotos in andere groups intact", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    const g1 = await withUser(t, "user_alice").mutation(api.groups.create, {
      name: "G1",
    });
    const g2 = await withUser(t, "user_alice").mutation(api.groups.create, {
      name: "G2",
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId: g1,
      userId: bobId,
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId: g2,
      userId: bobId,
    });

    const albumG1 = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId: g1, name: "AG1" },
    );
    const albumG2 = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId: g2, name: "AG2" },
    );

    const storageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["x"])),
    );
    const bobPhoto = await withUser(t, "user_bob").mutation(
      api.photos.create,
      { storageId },
    );
    await withUser(t, "user_bob").mutation(api.albums.addPhoto, {
      albumId: albumG1,
      photoId: bobPhoto,
    });
    await withUser(t, "user_bob").mutation(api.albums.addPhoto, {
      albumId: albumG2,
      photoId: bobPhoto,
    });

    // Bob verlaat alleen g1
    await withUser(t, "user_alice").mutation(api.groups.removeMember, {
      groupId: g1,
      userId: bobId,
    });

    const apsG1 = await t.run((ctx) =>
      ctx.db
        .query("albumPhotos")
        .withIndex("by_album", (q) => q.eq("albumId", albumG1))
        .collect(),
    );
    expect(apsG1).toHaveLength(0);

    // g2 blijft intact
    const apsG2 = await t.run((ctx) =>
      ctx.db
        .query("albumPhotos")
        .withIndex("by_album", (q) => q.eq("albumId", albumG2))
        .collect(),
    );
    expect(apsG2).toHaveLength(1);
  });

  it("cross-owner: Carol voegt Bob's foto toe, Bob vertrekt → publicatie weg", async () => {
    // memberDelToAlbumPhoto.js:51 filtert op photo-OWNER, niet op addedBy.
    // Convex (groups.ts:255) filtert nu op addedBy → divergentie.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: carolId,
    });

    const albumId = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );

    const storageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["x"])),
    );
    const bobPhoto = await withUser(t, "user_bob").mutation(
      api.photos.create,
      { storageId },
    );

    // Carol publiceert Bob's foto (addedBy=Carol, ownerId=Bob)
    await withUser(t, "user_carol").mutation(api.albums.addPhoto, {
      albumId,
      photoId: bobPhoto,
    });

    await withUser(t, "user_alice").mutation(api.groups.removeMember, {
      groupId,
      userId: bobId,
    });

    const aps = await t.run((ctx) =>
      ctx.db
        .query("albumPhotos")
        .withIndex("by_album", (q) => q.eq("albumId", albumId))
        .collect(),
    );
    expect(aps).toHaveLength(0);
  });
});

describe("M2 (a): member vertrekt, geen succession", () => {
  it("admin en founder blijven onveranderd; vertrekkend lid is weg", async () => {
    // memberDelToGroup.js:17-18 — hasOtherAdmin=truthy, noFounderleft=false
    //   → noch :19-32 noch :33-37 raakt; geen role-/founder-changes.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });

    await withUser(t, "user_alice").mutation(api.groups.removeMember, {
      groupId,
      userId: bobId,
    });

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.createdBy).toBe(aliceId);

    const aliceMem = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", aliceId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(aliceMem?.role).toBe("admin");

    const bobMem = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(bobMem).toBeNull();
  });
});

describe("M2 (b): admin vertrekt met andere admin aanwezig", () => {
  it("geen role-changes onder de overgeblevenen; vertrekkend admin is weg", async () => {
    // memberDelToGroup.js:17-18 — hasOtherAdmin=truthy (Alice), noFounderleft=false
    //   → :19-32 niet, :33-37 niet; rollen + founder ongewijzigd.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    // Bob als admin, Carol als gewone member
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
      role: "admin",
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: carolId,
    });

    // Bob (admin, niet founder) vertrekt
    await withUser(t, "user_bob").mutation(api.groups.removeMember, {
      groupId,
      userId: bobId,
    });

    const aliceMem = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", aliceId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(aliceMem?.role).toBe("admin");

    const carolMem = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", carolId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(carolMem?.role).toBe("member");

    const bobMem = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(bobMem).toBeNull();

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.createdBy).toBe(aliceId);
  });
});

describe("M2 (c): laatste admin vertrekt met members nog over", () => {
  it("alle resterende members worden admin; oudste joinedAt wordt founder", async () => {
    // memberDelToGroup.js:19-32 — !hasOtherAdmin pad. Alle members → admin
    //   (regel 29). Eerste in iteratie-volgorde wordt founder (regel 22-27).
    //   In Convex sorteren we expliciet op joinedAt asc → Bob (eerst toegevoegd)
    //   wint deterministisch.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: carolId,
    });

    // Alice (enige admin én founder) vertrekt
    await withUser(t, "user_alice").mutation(api.groups.removeMember, {
      groupId,
      userId: aliceId,
    });

    const remaining = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect(),
    );
    expect(remaining).toHaveLength(2);
    for (const m of remaining) {
      expect(m.role).toBe("admin");
    }

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.createdBy).not.toBe(aliceId);
    expect(group?.createdBy).toBe(bobId);
  });
});

describe("M2 (c-extended): 3+ overgebleven members, willekeurige joinedAt-volgorde", () => {
  it("kiest deterministisch member met laagste joinedAt als founder", async () => {
    // memberDelToGroup.js:22-27 — patcht joinedAt zodat insertie-volgorde !=
    //   sortering. Convex moet expliciet op joinedAt asc sorteren.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");
    const daveId = await registerUser(t, "user_dave", "d@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: carolId,
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: daveId,
    });

    // Patch joinedAt: Carol oudste, Dave middel, Bob jongste — niet
    // overeenkomstig insertie-volgorde.
    await t.run(async (ctx) => {
      const all = await ctx.db
        .query("memberships")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect();
      for (const m of all) {
        if (m.userId === carolId) await ctx.db.patch(m._id, { joinedAt: 100 });
        else if (m.userId === daveId)
          await ctx.db.patch(m._id, { joinedAt: 200 });
        else if (m.userId === bobId)
          await ctx.db.patch(m._id, { joinedAt: 300 });
      }
    });

    await withUser(t, "user_alice").mutation(api.groups.removeMember, {
      groupId,
      userId: aliceId,
    });

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.createdBy).toBe(carolId);
  });
});

describe("M2 (d): founder vertrekt met andere admin aanwezig", () => {
  it("eerste resterende admin wordt nieuwe founder; rollen blijven", async () => {
    // memberDelToGroup.js:33-37 — hasOtherAdmin=truthy (Bob), noFounderleft=true
    //   → die admin krijgt isFounder=true. Carol (member) blijft member,
    //   Bob blijft admin (mag niet gedemoteerd worden).
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
      role: "admin",
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: carolId,
    });

    // Alice (founder, admin) vertrekt; Bob is ook admin
    await withUser(t, "user_alice").mutation(api.groups.removeMember, {
      groupId,
      userId: aliceId,
    });

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.createdBy).toBe(bobId);

    const bobMem = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(bobMem?.role).toBe("admin");

    const carolMem = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", carolId).eq("groupId", groupId),
        )
        .unique(),
    );
    // Carol blijft member want er was nog een admin (Bob)
    expect(carolMem?.role).toBe("member");
  });
});

describe("M2 (d-extended): founder vertrekt met meerdere admins, oudste wint", () => {
  it("admin met laagste joinedAt wordt founder", async () => {
    // memberDelToGroup.js:33-37 — bij meerdere admins kiest oude handler de
    //   eerst-gevonden via members.find() (insertie-volgorde). Convex moet
    //   deterministisch op joinedAt asc selecteren.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
      role: "admin",
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: carolId,
      role: "admin",
    });

    // Patch: Carol heeft oudere joinedAt dan Bob, ondanks latere insertie.
    await t.run(async (ctx) => {
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect();
      for (const m of memberships) {
        if (m.userId === bobId) await ctx.db.patch(m._id, { joinedAt: 500 });
        if (m.userId === carolId) await ctx.db.patch(m._id, { joinedAt: 100 });
      }
    });

    await withUser(t, "user_alice").mutation(api.groups.removeMember, {
      groupId,
      userId: aliceId,
    });

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.createdBy).toBe(carolId);
  });
});

describe("M3: removeMember cascade albumLastSeen voor déze group", () => {
  it("verwijdert albumLastSeen voor (user × albums in déze group), laat andere groups intact", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    const g1 = await withUser(t, "user_alice").mutation(api.groups.create, {
      name: "G1",
    });
    const g2 = await withUser(t, "user_alice").mutation(api.groups.create, {
      name: "G2",
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId: g1,
      userId: bobId,
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId: g2,
      userId: bobId,
    });

    const a1 = await withUser(t, "user_alice").mutation(api.albums.create, {
      groupId: g1,
      name: "A1",
    });
    const a2 = await withUser(t, "user_alice").mutation(api.albums.create, {
      groupId: g2,
      name: "A2",
    });

    await withUser(t, "user_bob").mutation(api.albums.markSeen, {
      albumId: a1,
    });
    await withUser(t, "user_bob").mutation(api.albums.markSeen, {
      albumId: a2,
    });

    // Bob verlaat g1
    await withUser(t, "user_alice").mutation(api.groups.removeMember, {
      groupId: g1,
      userId: bobId,
    });

    const bobLastSeenForA1 = await t.run((ctx) =>
      ctx.db
        .query("albumLastSeen")
        .withIndex("by_user_album", (q) =>
          q.eq("userId", bobId).eq("albumId", a1),
        )
        .unique(),
    );
    expect(bobLastSeenForA1).toBeNull();

    const bobLastSeenForA2 = await t.run((ctx) =>
      ctx.db
        .query("albumLastSeen")
        .withIndex("by_user_album", (q) =>
          q.eq("userId", bobId).eq("albumId", a2),
        )
        .unique(),
    );
    expect(bobLastSeenForA2).not.toBeNull();
  });
});

describe("M2 (e): laatste lid vertrekt → group + albums + albumPhotos cascade", () => {
  it("solo founder vertrekt → group volledig opgeruimd", async () => {
    // memberDelToGroup.js:39-43 — geen members meer → dynamoDb.delete(groupKey).
    //   Convex breidt dit uit met albums + albumPhotos in dezelfde transactie.
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const albumId = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );

    const storageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["x"])),
    );
    const photoId = await withUser(t, "user_alice").mutation(
      api.photos.create,
      { storageId },
    );
    await withUser(t, "user_alice").mutation(api.albums.addPhoto, {
      albumId,
      photoId,
    });

    await withUser(t, "user_alice").mutation(api.groups.removeMember, {
      groupId,
      userId: aliceId,
    });

    expect(await t.run((ctx) => ctx.db.get(groupId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(albumId))).toBeNull();

    const aps = await t.run((ctx) =>
      ctx.db
        .query("albumPhotos")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect(),
    );
    expect(aps).toHaveLength(0);

    // photo zelf blijft (eigendom alice, niet group)
    expect(await t.run((ctx) => ctx.db.get(photoId))).not.toBeNull();
  });
});

describe("M2 (e-dangling): geen residu albumLastSeen na laatste vertrek", () => {
  it("A markSeen, A vertrekt, B vertrekt last → albumLastSeen volledig leeg", async () => {
    // memberDelToGroup.js:39-43 — group delete in oude code raakt alleen GBbase.
    //   Convex moet bij (e) ook eerder achtergebleven albumLastSeen records
    //   van álbum-deletions opruimen, niet alleen de eigen records van de
    //   vertrekkende user (die via M3 al weggaan).
    const t = convexTest(schema);
    const aliceId = await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });
    const albumId = await withUser(t, "user_alice").mutation(
      api.albums.create,
      { groupId, name: "A" },
    );

    // Beide users markeren album als gezien.
    await withUser(t, "user_alice").mutation(api.albums.markSeen, {
      albumId,
    });
    await withUser(t, "user_bob").mutation(api.albums.markSeen, {
      albumId,
    });

    // Alice vertrekt: M3 ruimt alice's lastSeen voor deze group.
    await withUser(t, "user_alice").mutation(api.groups.removeMember, {
      groupId,
      userId: aliceId,
    });

    // Bob is solo over — vertrekt → (e) cascade.
    await withUser(t, "user_bob").mutation(api.groups.removeMember, {
      groupId,
      userId: bobId,
    });

    // Geen enkel albumLastSeen record mag blijven hangen.
    const allLastSeen = await t.run((ctx) =>
      ctx.db.query("albumLastSeen").collect(),
    );
    expect(allLastSeen).toHaveLength(0);
  });
});

describe("removeMember rejection paths", () => {
  it("non-admin die ander lid probeert te verwijderen → throws", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: carolId,
    });

    // Bob is gewone member, probeert Carol te verwijderen
    await expect(
      withUser(t, "user_bob").mutation(api.groups.removeMember, {
        groupId,
        userId: carolId,
      }),
    ).rejects.toThrow();
  });

  it("removeMember van niet-bestaand lid → throws", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const bobId = await registerUser(t, "user_bob", "b@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    // Bob is geregistreerd maar niet toegevoegd aan group
    await expect(
      withUser(t, "user_alice").mutation(api.groups.removeMember, {
        groupId,
        userId: bobId,
      }),
    ).rejects.toThrow();
  });

  it("caller is geen lid van de groep → throws", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    const carolId = await registerUser(t, "user_carol", "c@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    await withUser(t, "user_alice").mutation(api.groups.addMember, {
      groupId,
      userId: carolId,
    });

    // Bob staat nergens in de groep maar probeert Carol te verwijderen
    await expect(
      withUser(t, "user_bob").mutation(api.groups.removeMember, {
        groupId,
        userId: carolId,
      }),
    ).rejects.toThrow();
  });
});
