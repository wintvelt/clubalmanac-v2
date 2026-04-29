import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

// Fase 2 — Groups domein: create, update, remove, list, members.

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

async function setupGroup(
  t: ReturnType<typeof convexTest>,
  adminSubject = "user_admin",
  email = "admin@x.com",
) {
  const adminId = await registerUser(t, adminSubject, email);
  const groupId = await withUser(t, adminSubject).mutation(api.groups.create, {
    name: "Test groep",
    description: "demo",
  });
  return { adminId, groupId, adminSubject };
}

describe("groups.create", () => {
  it("weigert zonder auth", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(api.groups.create, { name: "X" }),
    ).rejects.toThrow();
  });

  it("weigert wanneer geen user record", async () => {
    const t = convexTest(schema);
    await expect(
      withUser(t, "user_ghost").mutation(api.groups.create, { name: "X" }),
    ).rejects.toThrow();
  });

  it("maakt group + admin membership voor caller", async () => {
    const t = convexTest(schema);
    const adminId = await registerUser(t, "user_a", "a@x.com");
    const groupId = await withUser(t, "user_a").mutation(api.groups.create, {
      name: "Mijn groep",
      description: "hoi",
    });

    const group = await t.run((ctx) => ctx.db.get(groupId));
    expect(group?.name).toBe("Mijn groep");
    expect(group?.description).toBe("hoi");
    expect(group?.createdBy).toBe(adminId);
    expect(typeof group?.createdAt).toBe("number");

    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect(),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.userId).toBe(adminId);
    expect(memberships[0]?.role).toBe("admin");
  });
});

describe("groups.getById", () => {
  it("geeft group terug", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const got = await t.query(api.groups.getById, { groupId });
    expect(got?._id).toBe(groupId);
  });

  it("geeft null voor onbekende id", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    await t.run(async (ctx) => {
      // cascade: maak een geldige stale id
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect();
      for (const m of memberships) await ctx.db.delete(m._id);
      await ctx.db.delete(groupId);
    });
    const got = await t.query(api.groups.getById, { groupId });
    expect(got).toBeNull();
  });
});

describe("groups.listMine", () => {
  it("toont groepen waar caller lid is, met role", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);

    // tweede groep, caller is daar geen lid
    await registerUser(t, "user_b", "b@x.com");
    await withUser(t, "user_b").mutation(api.groups.create, {
      name: "Niet van mij",
    });

    const mine = await withUser(t, "user_admin").query(
      api.groups.listMine,
      {},
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?._id).toBe(groupId);
    expect(mine[0]?.role).toBe("admin");
  });

  it("geeft lege lijst zonder auth", async () => {
    const t = convexTest(schema);
    await setupGroup(t);
    const mine = await t.query(api.groups.listMine, {});
    expect(mine).toEqual([]);
  });
});

describe("groups.listMembers", () => {
  it("member kan members opvragen", async () => {
    const t = convexTest(schema);
    const { adminId, groupId } = await setupGroup(t);

    // voeg tweede member toe
    const bobId = await registerUser(t, "user_b", "b@x.com");
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });

    const members = await withUser(t, "user_admin").query(
      api.groups.listMembers,
      { groupId },
    );
    expect(members).toHaveLength(2);
    const ids = members.map((m) => m.user?._id);
    expect(ids).toContain(adminId);
    expect(ids).toContain(bobId);
  });

  it("niet-lid wordt geweigerd", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    await registerUser(t, "user_outsider", "out@x.com");
    await expect(
      withUser(t, "user_outsider").query(api.groups.listMembers, { groupId }),
    ).rejects.toThrow();
  });
});

describe("groups.addMember", () => {
  it("admin kan member toevoegen, default role 'member'", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const bobId = await registerUser(t, "user_b", "b@x.com");

    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });

    const m = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(m?.role).toBe("member");
    expect(typeof m?.joinedAt).toBe("number");
  });

  it("admin kan met role 'admin' toevoegen", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const bobId = await registerUser(t, "user_b", "b@x.com");

    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
      role: "admin",
    });

    const m = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(m?.role).toBe("admin");
  });

  it("niet-admin (member) wordt geweigerd", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const bobId = await registerUser(t, "user_b", "b@x.com");
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });

    const carolId = await registerUser(t, "user_c", "c@x.com");
    await expect(
      withUser(t, "user_b").mutation(api.groups.addMember, {
        groupId,
        userId: carolId,
      }),
    ).rejects.toThrow();
  });

  it("weigert dubbel lidmaatschap", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const bobId = await registerUser(t, "user_b", "b@x.com");
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });
    await expect(
      withUser(t, "user_admin").mutation(api.groups.addMember, {
        groupId,
        userId: bobId,
      }),
    ).rejects.toThrow();
  });
});

describe("groups.removeMember", () => {
  it("admin kan ander member verwijderen", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const bobId = await registerUser(t, "user_b", "b@x.com");
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });

    await withUser(t, "user_admin").mutation(api.groups.removeMember, {
      groupId,
      userId: bobId,
    });

    const m = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(m).toBeNull();
  });

  it("self-remove werkt (leave)", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const bobId = await registerUser(t, "user_b", "b@x.com");
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });

    await withUser(t, "user_b").mutation(api.groups.removeMember, {
      groupId,
      userId: bobId,
    });

    const remaining = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect(),
    );
    expect(remaining).toHaveLength(1);
  });

  it("member kan ander niet verwijderen", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const bobId = await registerUser(t, "user_b", "b@x.com");
    const carolId = await registerUser(t, "user_c", "c@x.com");
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: carolId,
    });

    await expect(
      withUser(t, "user_b").mutation(api.groups.removeMember, {
        groupId,
        userId: carolId,
      }),
    ).rejects.toThrow();
  });

  it("laatste admin kan niet weg", async () => {
    const t = convexTest(schema);
    const { adminId, groupId } = await setupGroup(t);
    await expect(
      withUser(t, "user_admin").mutation(api.groups.removeMember, {
        groupId,
        userId: adminId,
      }),
    ).rejects.toThrow(/admin/i);
  });
});

describe("groups.updateMemberRole", () => {
  it("admin kan member promoten naar admin", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const bobId = await registerUser(t, "user_b", "b@x.com");
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });

    await withUser(t, "user_admin").mutation(api.groups.updateMemberRole, {
      groupId,
      userId: bobId,
      role: "admin",
    });

    const m = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) =>
          q.eq("userId", bobId).eq("groupId", groupId),
        )
        .unique(),
    );
    expect(m?.role).toBe("admin");
  });

  it("niet-admin kan niet rollen wijzigen", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const bobId = await registerUser(t, "user_b", "b@x.com");
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });

    await expect(
      withUser(t, "user_b").mutation(api.groups.updateMemberRole, {
        groupId,
        userId: bobId,
        role: "admin",
      }),
    ).rejects.toThrow();
  });

  it("laatste admin kan niet gedemoted worden", async () => {
    const t = convexTest(schema);
    const { adminId, groupId } = await setupGroup(t);
    await expect(
      withUser(t, "user_admin").mutation(api.groups.updateMemberRole, {
        groupId,
        userId: adminId,
        role: "member",
      }),
    ).rejects.toThrow(/admin/i);
  });
});

describe("groups.update", () => {
  it("admin kan name/description aanpassen", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);

    await withUser(t, "user_admin").mutation(api.groups.update, {
      groupId,
      name: "Nieuwe naam",
      description: "nieuw",
    });

    const got = await t.run((ctx) => ctx.db.get(groupId));
    expect(got?.name).toBe("Nieuwe naam");
    expect(got?.description).toBe("nieuw");
  });

  it("admin kan coverPhotoId zetten", async () => {
    const t = convexTest(schema);
    const { adminId, groupId } = await setupGroup(t);

    const photoId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["x"]));
      return await ctx.db.insert("photos", {
        ownerId: adminId,
        storageId,
        ratingCount: 0,
        createdAt: Date.now(),
      });
    });

    await withUser(t, "user_admin").mutation(api.groups.update, {
      groupId,
      coverPhotoId: photoId,
    });

    const got = await t.run((ctx) => ctx.db.get(groupId));
    expect(got?.coverPhotoId).toBe(photoId);
  });

  it("niet-admin kan niet updaten", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const bobId = await registerUser(t, "user_b", "b@x.com");
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });

    await expect(
      withUser(t, "user_b").mutation(api.groups.update, {
        groupId,
        name: "X",
      }),
    ).rejects.toThrow();
  });
});

describe("groups.remove", () => {
  it("admin kan group deleten + cascade memberships", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const bobId = await registerUser(t, "user_b", "b@x.com");
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });

    await withUser(t, "user_admin").mutation(api.groups.remove, { groupId });

    const got = await t.run((ctx) => ctx.db.get(groupId));
    expect(got).toBeNull();

    const memberships = await t.run((ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect(),
    );
    expect(memberships).toHaveLength(0);
  });

  it("cascade albums + albumPhotos", async () => {
    const t = convexTest(schema);
    const { adminId, groupId } = await setupGroup(t);

    const { albumId, photoId } = await t.run(async (ctx) => {
      const albumId = await ctx.db.insert("albums", {
        groupId,
        name: "Album",
        createdBy: adminId,
        createdAt: Date.now(),
      });
      const storageId = await ctx.storage.store(new Blob(["x"]));
      const photoId = await ctx.db.insert("photos", {
        ownerId: adminId,
        storageId,
        ratingCount: 0,
        createdAt: Date.now(),
      });
      await ctx.db.insert("albumPhotos", {
        albumId,
        photoId,
        groupId,
        addedAt: Date.now(),
        addedBy: adminId,
      });
      return { albumId, photoId };
    });

    await withUser(t, "user_admin").mutation(api.groups.remove, { groupId });

    const albums = await t.run((ctx) =>
      ctx.db
        .query("albums")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect(),
    );
    expect(albums).toHaveLength(0);

    const albumPhotos = await t.run((ctx) =>
      ctx.db
        .query("albumPhotos")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect(),
    );
    expect(albumPhotos).toHaveLength(0);

    // photos zelf blijven (eigendom van user, niet group)
    const photo = await t.run((ctx) => ctx.db.get(photoId));
    expect(photo).not.toBeNull();

    // album record zelf is weg
    const album = await t.run((ctx) => ctx.db.get(albumId));
    expect(album).toBeNull();
  });

  it("niet-admin kan niet deleten", async () => {
    const t = convexTest(schema);
    const { groupId } = await setupGroup(t);
    const bobId = await registerUser(t, "user_b", "b@x.com");
    await withUser(t, "user_admin").mutation(api.groups.addMember, {
      groupId,
      userId: bobId,
    });

    await expect(
      withUser(t, "user_b").mutation(api.groups.remove, { groupId }),
    ).rejects.toThrow();
  });
});
