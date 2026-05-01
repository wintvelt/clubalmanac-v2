import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { DEFAULT_PHOTO_LIMIT } from "../../convex/users";

// Fase 2 — Users domein. Tests-first volgens migratieplan.
// Authenticatie via Clerk wordt geïmpersoneerd met t.withIdentity.

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";

function withUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
  });
}

// Audit-7 §5: register heeft een server-side invite-gate. Tests die
// een succesvolle register willen, seeden eerst een pending invite.
async function seedInvite(t: ReturnType<typeof convexTest>, email: string) {
  await t.run(async (ctx) => {
    const inviterId = await ctx.db.insert("users", {
      subject: `__invite_seeder_${crypto.randomUUID()}`,
      email: `seeder_${crypto.randomUUID()}@seed.test`,
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    });
    await ctx.db.insert("invites", {
      email: email.toLowerCase().trim(),
      invitedBy: inviterId,
      token: crypto.randomUUID(),
      status: "pending",
      expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
  });
}

describe("users.register", () => {
  it("weigert wanneer niet ingelogd", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(api.users.register, { email: "a@b.c" }),
    ).rejects.toThrow();
  });

  it("maakt user met defaults", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "alice@x.com");
    const id = await withUser(t, "user_alice").mutation(api.users.register, {
      email: "alice@x.com",
      name: "Alice",
    });

    const user = await t.run((ctx) => ctx.db.get(id));
    expect(user).not.toBeNull();
    expect(user?.subject).toBe("user_alice");
    expect(user?.email).toBe("alice@x.com");
    expect(user?.name).toBe("Alice");
    expect(user?.photoCount).toBe(0);
    expect(user?.photoLimit).toBe(DEFAULT_PHOTO_LIMIT);
    expect(typeof user?.createdAt).toBe("number");
  });

  it("is idempotent: zelfde subject = zelfde id", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "alice@x.com");
    const as = withUser(t, "user_alice");
    const id1 = await as.mutation(api.users.register, {
      email: "alice@x.com",
    });
    const id2 = await as.mutation(api.users.register, {
      email: "alice@x.com",
    });
    expect(id1).toBe(id2);
  });

  it("weigert dubbel email vanuit andere subject", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "shared@x.com");
    await withUser(t, "user_a").mutation(api.users.register, {
      email: "shared@x.com",
    });
    await expect(
      withUser(t, "user_b").mutation(api.users.register, {
        email: "shared@x.com",
      }),
    ).rejects.toThrow();
  });
});

describe("users.current", () => {
  it("geeft null zonder auth", async () => {
    const t = convexTest(schema);
    const got = await t.query(api.users.current, {});
    expect(got).toBeNull();
  });

  it("geeft null wanneer auth zonder record", async () => {
    const t = convexTest(schema);
    const got = await withUser(t, "user_ghost").query(api.users.current, {});
    expect(got).toBeNull();
  });

  it("geeft user wanneer auth + record bestaat", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "alice@x.com");
    const as = withUser(t, "user_alice");
    await as.mutation(api.users.register, {
      email: "alice@x.com",
      name: "Alice",
    });
    const got = await as.query(api.users.current, {});
    expect(got?.email).toBe("alice@x.com");
    expect(got?.subject).toBe("user_alice");
  });
});

describe("users.getById", () => {
  it("geeft user op id", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "alice@x.com");
    const id = await withUser(t, "user_alice").mutation(api.users.register, {
      email: "alice@x.com",
    });
    const got = await t.query(api.users.getById, { userId: id });
    expect(got?._id).toBe(id);
  });

  it("geeft null voor niet-bestaande id", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "alice@x.com");
    // Maak en delete om een geldige-but-stale id te krijgen.
    const id = await withUser(t, "user_alice").mutation(api.users.register, {
      email: "alice@x.com",
    });
    await t.run((ctx) => ctx.db.delete(id));
    const got = await t.query(api.users.getById, { userId: id });
    expect(got).toBeNull();
  });
});

describe("users.updateProfile", () => {
  it("update naam en profielfoto", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "alice@x.com");
    const as = withUser(t, "user_alice");
    const id = await as.mutation(api.users.register, {
      email: "alice@x.com",
    });

    const storageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["x"])),
    );

    await as.mutation(api.users.updateProfile, {
      name: "Alice 2",
      profilePhotoStorageId: storageId,
    });

    const got = await t.run((ctx) => ctx.db.get(id));
    expect(got?.name).toBe("Alice 2");
    expect(got?.profilePhotoStorageId).toBe(storageId);
  });

  it("weigert zonder auth", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(api.users.updateProfile, { name: "X" }),
    ).rejects.toThrow();
  });

  it("weigert wanneer geen user record bestaat", async () => {
    const t = convexTest(schema);
    await expect(
      withUser(t, "user_ghost").mutation(api.users.updateProfile, {
        name: "X",
      }),
    ).rejects.toThrow();
  });
});

describe("users.deleteSelf", () => {
  it("verwijdert eigen record", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "alice@x.com");
    const as = withUser(t, "user_alice");
    const id = await as.mutation(api.users.register, {
      email: "alice@x.com",
    });
    await as.mutation(api.users.deleteSelf, {});
    const got = await t.run((ctx) => ctx.db.get(id));
    expect(got).toBeNull();
  });

  it("weigert zonder auth", async () => {
    const t = convexTest(schema);
    await expect(t.mutation(api.users.deleteSelf, {})).rejects.toThrow();
  });
});

describe("users photo count limiet", () => {
  it("incrementPhotoCount verhoogt teller", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "alice@x.com");
    const id = await withUser(t, "user_alice").mutation(api.users.register, {
      email: "alice@x.com",
    });

    await t.mutation(internal.users.incrementPhotoCount, { userId: id });
    await t.mutation(internal.users.incrementPhotoCount, { userId: id });

    const got = await t.run((ctx) => ctx.db.get(id));
    expect(got?.photoCount).toBe(2);
  });

  it("incrementPhotoCount gooit error op limiet", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "alice@x.com");
    const id = await withUser(t, "user_alice").mutation(api.users.register, {
      email: "alice@x.com",
    });

    // Forceer photoCount op limiet om de check te raken.
    await t.run(async (ctx) => {
      const u = await ctx.db.get(id);
      await ctx.db.patch(id, { photoCount: u!.photoLimit });
    });

    await expect(
      t.mutation(internal.users.incrementPhotoCount, { userId: id }),
    ).rejects.toThrow(/PHOTO_LIMIT_REACHED/);
  });

  it("decrementPhotoCount verlaagt teller", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "alice@x.com");
    const id = await withUser(t, "user_alice").mutation(api.users.register, {
      email: "alice@x.com",
    });

    await t.mutation(internal.users.incrementPhotoCount, { userId: id });
    await t.mutation(internal.users.decrementPhotoCount, { userId: id });

    const got = await t.run((ctx) => ctx.db.get(id));
    expect(got?.photoCount).toBe(0);
  });

  it("decrementPhotoCount blijft op 0", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "alice@x.com");
    const id = await withUser(t, "user_alice").mutation(api.users.register, {
      email: "alice@x.com",
    });

    await t.mutation(internal.users.decrementPhotoCount, { userId: id });

    const got = await t.run((ctx) => ctx.db.get(id));
    expect(got?.photoCount).toBe(0);
  });

  it("incrementPhotoCount op niet-bestaande user gooit error", async () => {
    const t = convexTest(schema);
    await seedInvite(t, "alice@x.com");
    const id = await withUser(t, "user_alice").mutation(api.users.register, {
      email: "alice@x.com",
    });
    await t.run((ctx) => ctx.db.delete(id));

    await expect(
      t.mutation(internal.users.incrementPhotoCount, { userId: id }),
    ).rejects.toThrow();
  });
});
