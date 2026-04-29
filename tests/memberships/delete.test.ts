import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Cascade matrix rows M1, M2: cascades + admin/founder-successie
// vanuit groups.removeMember (UM delete trigger).
//
// M1: cat-3 selectief — albumPhotos van vertrekkende user in déze group
//     worden verwijderd (photos zelf blijven, andere groups intact).
// M2: 5 scenarios:
//   (a) member vertrekt, geen succession
//   (b) admin vertrekt met andere admin aanwezig, geen role-changes
//   (c) laatste admin vertrekt met members nog over → allen admin
//   (d) founder vertrekt met andere admin → die admin wordt founder
//   (e) laatste lid vertrekt → group + albums + albumPhotos cascade

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
});

describe("M2 (a): member vertrekt, geen succession", () => {
  it("admin en founder blijven onveranderd", async () => {
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
  });
});

describe("M2 (b): admin vertrekt met andere admin aanwezig", () => {
  it("geen role-changes onder de overgeblevenen", async () => {
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

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.createdBy).toBe(aliceId);
  });
});

describe("M2 (c): laatste admin vertrekt met members nog over", () => {
  it("alle resterende members worden admin", async () => {
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

    // Founder rolt door naar eerstgebleven admin (joinedAt sortering)
    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.createdBy).not.toBe(aliceId);
    expect([bobId, carolId]).toContain(group?.createdBy);
  });
});

describe("M2 (d): founder vertrekt met andere admin aanwezig", () => {
  it("eerste resterende admin wordt nieuwe founder; rollen blijven", async () => {
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

describe("M2 (e): laatste lid vertrekt → group + albums + albumPhotos cascade", () => {
  it("solo founder vertrekt → group volledig opgeruimd", async () => {
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
