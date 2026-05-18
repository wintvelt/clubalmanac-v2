import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api , internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { assertReactive } from "../_helpers/reactive";

// Cascade matrix rows G1, G2: cat-1 (eliminated) + cat-4 (reactive coverage).
// Verifieert dat join-on-read queries fresh group-data returneren na een
// groups.update mutation. Vervangt de oude DynamoDB stream-handlers
// `groupChangeToMembership` (G1) en `groupChangeToAlbum` (G2).

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

describe("G1: membership query joint group-data fresh", () => {
  it("groups.listMine toont nieuwe naam direct na groups.update", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_admin", "admin@x.com");

    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "Oud", description: "oude beschrijving" },
    );

    const { before, after } = await assertReactive(
      () => withUser(t, "user_admin").query(api.groups.listMine, {}),
      () =>
        withUser(t, "user_admin").mutation(api.groups.update, {
          groupId,
          name: "Nieuw",
          description: "nieuwe beschrijving",
        }),
    );

    expect(before[0]?.name).toBe("Oud");
    expect(after[0]?.name).toBe("Nieuw");
    expect(after[0]?.description).toBe("nieuwe beschrijving");
    // Role van admin blijft hetzelfde
    expect(after[0]?.role).toBe("admin");
  });
});

describe("G2: album query joint group-data fresh", () => {
  it("albums.getWithGroup toont nieuwe group-naam direct na update", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_admin", "admin@x.com");

    const groupId = await withUser(t, "user_admin").mutation(
      api.groups.create,
      { name: "Oud" },
    );
    const albumId = await withUser(t, "user_admin").mutation(
      api.albums.create,
      { groupId, name: "Album" },
    );

    const { before, after } = await assertReactive(
      () =>
        withUser(t, "user_admin").query(api.albums.getWithGroup, { albumId }),
      () =>
        withUser(t, "user_admin").mutation(api.groups.update, {
          groupId,
          name: "Nieuw",
        }),
    );

    expect(before?.group?.name).toBe("Oud");
    expect(after?.group?.name).toBe("Nieuw");
    // Album zelf is niet gewijzigd
    expect(after?._id).toBe(before?._id);
    expect(after?.name).toBe("Album");
  });
});
