import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api , internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Cascade matrix row A2: albums.remove cascadet albumLastSeen records
// voor dat album. Test leeft bij de trigger (album delete).

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

describe("A2: albums.remove cascade albumLastSeen", () => {
  it("verwijdert albumLastSeen records voor dit album", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
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

    await withUser(t, "user_alice").mutation(api.albums.markSeen, { albumId });
    await withUser(t, "user_bob").mutation(api.albums.markSeen, { albumId });

    expect(
      await t.run((ctx) =>
        ctx.db
          .query("albumLastSeen")
          .withIndex("by_album", (q) => q.eq("albumId", albumId))
          .collect(),
      ),
    ).toHaveLength(2);

    await withUser(t, "user_alice").mutation(api.albums.remove, { albumId });

    const remaining = await t.run((ctx) =>
      ctx.db
        .query("albumLastSeen")
        .withIndex("by_album", (q) => q.eq("albumId", albumId))
        .collect(),
    );
    expect(remaining).toHaveLength(0);
  });

  it("laat albumLastSeen voor andere albums intact", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");

    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "G" },
    );
    const a1 = await withUser(t, "user_alice").mutation(api.albums.create, {
      groupId,
      name: "A1",
    });
    const a2 = await withUser(t, "user_alice").mutation(api.albums.create, {
      groupId,
      name: "A2",
    });

    await withUser(t, "user_alice").mutation(api.albums.markSeen, {
      albumId: a1,
    });
    await withUser(t, "user_alice").mutation(api.albums.markSeen, {
      albumId: a2,
    });

    await withUser(t, "user_alice").mutation(api.albums.remove, {
      albumId: a1,
    });

    const a2Records = await t.run((ctx) =>
      ctx.db
        .query("albumLastSeen")
        .withIndex("by_album", (q) => q.eq("albumId", a2))
        .collect(),
    );
    expect(a2Records).toHaveLength(1);
  });
});
