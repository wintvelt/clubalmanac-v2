import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  asGhost,
  asUser,
  expectNoMutationOracle,
  expectRejectedNoChange,
  newT,
  seedWorld,
  staleId,
  useWebmasterEnv,
} from "./_helpers";

// WP24 invariant 2: photos.flag vereist foto-toegang, bovenop "ingelogd" en
// "eigen foto niet" (invariant 7). A-keuze 4: zonder toegang lekt ook de
// meld-status niet (al gemeld = zelfde uitkomst als onbekend id).

useWebmasterEnv();

describe("photos.flag — write-gate", () => {
  it("niet ingelogd en identity zonder users-rij: geweigerd, state ongewijzigd", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const args = { photoId: w.photos.pAlice, reason: "x" };
    await expectRejectedNoChange(t, () => t.mutation(api.photos.flag, args), "anoniem");
    await expectRejectedNoChange(t, () => asGhost(t).mutation(api.photos.flag, args), "ghost");
  });

  it("ingelogd zonder foto-toegang: geweigerd, geen flag-velden", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const carol = asUser(t, w, "carol");
    for (const photoId of [w.photos.pAlice, w.photos.pBobPrivate]) {
      await expectRejectedNoChange(
        t,
        () => carol.mutation(api.photos.flag, { photoId, reason: "x" }),
        `flag ${photoId}`,
      );
    }
  });

  it("webmaster zonder lidmaatschap: geen bypass", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "wm").mutation(api.photos.flag, { photoId: w.photos.pAlice }),
    );
  });

  it("lid vertrekt: daarna geen melding meer op foto's van die groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bob = asUser(t, w, "bob");
    await bob.mutation(api.groups.removeMember, {
      groupId: w.groups.G1,
      userId: w.users.bob.id,
    });
    await expectRejectedNoChange(t, () =>
      bob.mutation(api.photos.flag, { photoId: w.photos.pAlice }),
    );
  });

  it("lid met foto-toegang meldt (bestaand gedrag)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await asUser(t, w, "bob").mutation(api.photos.flag, {
      photoId: w.photos.pAlice,
      reason: "x",
    });
    const p = await t.run(async (ctx) => ctx.db.get(w.photos.pAlice));
    expect(p?.flaggedBy).toBe(w.users.bob.id);
    expect(p?.flaggedAt).toBeTypeOf("number");
  });

  it("toegang via één van twee groepen volstaat", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // dave zit alleen in G3; pAlice staat in A1 (G1) én A3 (G3).
    await asUser(t, w, "dave").mutation(api.photos.flag, { photoId: w.photos.pAlice });
    const p = await t.run(async (ctx) => ctx.db.get(w.photos.pAlice));
    expect(p?.flaggedBy).toBe(w.users.dave.id);
  });

  it("eigen foto melden blijft geweigerd (invariant 7)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expectRejectedNoChange(t, () =>
      asUser(t, w, "alice").mutation(api.photos.flag, { photoId: w.photos.pAlice }),
    );
  });
});

describe("photos.flag — geen bestaans-orakel (invariant 3)", () => {
  it("onbekend id tegenover bestaand id zonder toegang", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "photos");
    const carol = asUser(t, w, "carol");
    for (const photoId of [w.photos.pAlice, w.photos.pBobPrivate]) {
      await expectNoMutationOracle(
        t,
        () => carol.mutation(api.photos.flag, { photoId: missing }),
        () => carol.mutation(api.photos.flag, { photoId }),
      );
    }
  });

  it("A-keuze 4 — onbekend id tegenover een al gemelde foto zonder toegang", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const missing = await staleId(t, w, "photos");
    const carol = asUser(t, w, "carol");
    // pBob is al gemeld (door alice); carol heeft geen toegang.
    await expectNoMutationOracle(
      t,
      () => carol.mutation(api.photos.flag, { photoId: missing }),
      () => carol.mutation(api.photos.flag, { photoId: w.photos.pBob }),
    );
  });
});
