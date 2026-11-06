import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { DEFAULT_PHOTO_LIMIT } from "../../convex/users";
import { modules } from "../_helpers/modules";

// Fase 2 — Users domein. Tests-first volgens migratieplan.
// Authenticatie via Clerk wordt geïmpersoneerd met t.withIdentity.
//
// WP6: onboarding via `internal.users.registerFromSession` (aangeroepen door
// `/clerk-webhook`). De publieke `api.users.register` mutation is verwijderd;
// gedrag-pinning van registerFromSession zelf staat in
// `tests/users/registerFromSession.test.ts`. Tests hieronder gebruiken
// registerFromSession alleen als seed-stap voor de andere users-API.

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";

function withUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
  });
}

async function seedUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email: string,
  name?: string,
) {
  return await t.mutation(internal.users.registerFromSession, {
    subject,
    email,
    ...(name !== undefined ? { name } : {}),
  });
}

describe("users.current", () => {
  it("geeft null zonder auth", async () => {
    const t = convexTest(schema, modules);
    const got = await t.query(api.users.current, {});
    expect(got).toBeNull();
  });

  it("geeft null wanneer auth zonder record", async () => {
    const t = convexTest(schema, modules);
    const got = await withUser(t, "user_ghost").query(api.users.current, {});
    expect(got).toBeNull();
  });

  it("geeft eigen profiel wanneer auth + record bestaat (WP23: zonder Clerk-subject)", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, "user_alice", "alice@x.com", "Alice");
    const got = await withUser(t, "user_alice").query(api.users.current, {});
    expect(got?.email).toBe("alice@x.com");
    expect((got as Record<string, unknown> | null)?.subject).toBeUndefined();
  });
});

// WP23: getById vereist inloggen + gedeelde groep (of zichzelf). Volledige
// auth- en vorm-matrix: tests/readWhitelist/users.test.ts.
describe("users.getById", () => {
  it("geeft eigen user op id", async () => {
    const t = convexTest(schema, modules);
    const id = await seedUser(t, "user_alice", "alice@x.com");
    const got = await withUser(t, "user_alice").query(api.users.getById, {
      userId: id,
    });
    expect(got?._id).toBe(id);
  });

  it("geeft geen data voor niet-bestaande id", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, "user_alice", "alice@x.com");
    const id = await seedUser(t, "user_bob", "bob@x.com");
    await t.run((ctx) => ctx.db.delete(id));
    const got = await withUser(t, "user_alice")
      .query(api.users.getById, { userId: id })
      .catch(() => null);
    expect(got).toBeNull();
  });
});

describe("users.updateProfile", () => {
  it("update naam en profielfoto", async () => {
    const t = convexTest(schema, modules);
    const id = await seedUser(t, "user_alice", "alice@x.com");
    const as = withUser(t, "user_alice");

    // WP24 invariant 8 / WP17a invariant 16: een profielfoto is het beeld van
    // een eigen foto, geen los beeld en niet de foto van een ander.
    const storageId = await t.run(async (ctx) => {
      const s = await ctx.storage.store(new Blob(["x"]));
      await ctx.db.insert("photos", {
        ownerId: id,
        storageId: s,
        ratingCount: 0,
        createdAt: Date.now(),
      });
      return s;
    });

    await as.mutation(api.users.updateProfile, {
      name: "Alice 2",
      profilePhotoStorageId: storageId,
    });

    const got = await t.run((ctx) => ctx.db.get(id));
    expect(got?.name).toBe("Alice 2");
    expect(got?.profilePhotoStorageId).toBe(storageId);
  });

  it("weigert zonder auth", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.users.updateProfile, { name: "X" }),
    ).rejects.toThrow();
  });

  it("weigert wanneer geen user record bestaat", async () => {
    const t = convexTest(schema, modules);
    await expect(
      withUser(t, "user_ghost").mutation(api.users.updateProfile, {
        name: "X",
      }),
    ).rejects.toThrow();
  });
});

describe("users.deleteSelf", () => {
  it("verwijdert eigen record", async () => {
    const t = convexTest(schema, modules);
    const id = await seedUser(t, "user_alice", "alice@x.com");
    await withUser(t, "user_alice").mutation(api.users.deleteSelf, {});
    const got = await t.run((ctx) => ctx.db.get(id));
    expect(got).toBeNull();
  });

  it("weigert zonder auth", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.users.deleteSelf, {})).rejects.toThrow();
  });
});

describe("users photo count limiet", () => {
  it("incrementPhotoCount verhoogt teller", async () => {
    const t = convexTest(schema, modules);
    const id = await seedUser(t, "user_alice", "alice@x.com");

    await t.mutation(internal.users.incrementPhotoCount, { userId: id });
    await t.mutation(internal.users.incrementPhotoCount, { userId: id });

    const got = await t.run((ctx) => ctx.db.get(id));
    expect(got?.photoCount).toBe(2);
  });

  it("incrementPhotoCount gooit error op limiet", async () => {
    const t = convexTest(schema, modules);
    const id = await seedUser(t, "user_alice", "alice@x.com");

    await t.run(async (ctx) => {
      const u = await ctx.db.get(id);
      await ctx.db.patch(id, { photoCount: u!.photoLimit });
    });

    await expect(
      t.mutation(internal.users.incrementPhotoCount, { userId: id }),
    ).rejects.toThrow(/PHOTO_LIMIT_REACHED/);
  });

  it("decrementPhotoCount verlaagt teller", async () => {
    const t = convexTest(schema, modules);
    const id = await seedUser(t, "user_alice", "alice@x.com");

    await t.mutation(internal.users.incrementPhotoCount, { userId: id });
    await t.mutation(internal.users.decrementPhotoCount, { userId: id });

    const got = await t.run((ctx) => ctx.db.get(id));
    expect(got?.photoCount).toBe(0);
  });

  it("decrementPhotoCount blijft op 0", async () => {
    const t = convexTest(schema, modules);
    const id = await seedUser(t, "user_alice", "alice@x.com");

    await t.mutation(internal.users.decrementPhotoCount, { userId: id });

    const got = await t.run((ctx) => ctx.db.get(id));
    expect(got?.photoCount).toBe(0);
  });

  it("incrementPhotoCount op niet-bestaande user gooit error", async () => {
    const t = convexTest(schema, modules);
    const id = await seedUser(t, "user_alice", "alice@x.com");
    await t.run((ctx) => ctx.db.delete(id));

    await expect(
      t.mutation(internal.users.incrementPhotoCount, { userId: id }),
    ).rejects.toThrow();
  });
});
