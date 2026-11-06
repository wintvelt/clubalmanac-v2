import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  SHAPE,
  asGhost,
  asUser,
  expectNoOracle,
  expectNoUserSecrets,
  expectShape,
  newT,
  seedWorld,
  staleId,
  useWebmasterEnv,
  type R,
} from "./_world";

// WP23 — users-reads. Spec §Vormen (publiek/eigen profiel), invarianten 1-5,
// A-keuzes 9 (getById ook voor zichzelf publiek) en 10 (geen photoLimit).

useWebmasterEnv();

describe("users.current — eigen profiel", () => {
  it("null zonder identity en null bij identity zonder users-rij (ongewijzigd)", async () => {
    const t = newT();
    await seedWorld(t);
    expect(await t.query(api.users.current, {})).toBeNull();
    expect(await asGhost(t).query(api.users.current, {})).toBeNull();
  });

  it("geeft precies de eigen-profiel-velden: email wel, subject en photoLimit niet", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const me = (await asUser(t, w, "alice").query(api.users.current, {})) as R;
    expectShape(me, SHAPE.ownProfile);
    expect(me._id).toBe(w.users.alice.id);
    expect(me.email).toBe("alice@x.com");
    expect(me.name).toBe("Alice");
    expectNoUserSecrets(me, w, { allowEmail: "alice@x.com" });
  });
});

describe("users.getById — publiek profiel", () => {
  it("niet-ingelogd: throwt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(
      t.query(api.users.getById, { userId: w.users.bob.id }),
    ).rejects.toThrow();
  });

  it("identity zonder users-rij: throwt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(
      asGhost(t).query(api.users.getById, { userId: w.users.bob.id }),
    ).rejects.toThrow();
  });

  it("medelid: precies id en naam (WP17a: geen beeld-id) — geen email, subject, tellers of tijden", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const bob = (await asUser(t, w, "alice").query(api.users.getById, {
      userId: w.users.bob.id,
    })) as R;
    expectShape(bob, SHAPE.publicProfile);
    expect(bob._id).toBe(w.users.bob.id);
    expect(bob.name).toBe("Bob");
    expectNoUserSecrets(bob, w);
  });

  it("[A-keuze 9] zichzelf: ook het publiek profiel (eigen profiel via users.current)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const self = await asUser(t, w, "alice").query(api.users.getById, {
      userId: w.users.alice.id,
    });
    expectShape(self, SHAPE.publicProfile);
    expectNoUserSecrets(self, w);
  });

  it("gedeelde groep is genoeg, ook als het een andere groep is dan die van de rest (dave ↔ alice via G3)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const alice = await asUser(t, w, "dave").query(api.users.getById, {
      userId: w.users.alice.id,
    });
    expectShape(alice, SHAPE.publicProfile);
  });

  it("geen gedeelde groep: geen data, en niet te onderscheiden van een onbekend id", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await staleId(t, w, "users");
    await expectNoOracle(
      () => asUser(t, w, "carol").query(api.users.getById, { userId: gone }),
      () =>
        asUser(t, w, "carol").query(api.users.getById, {
          userId: w.users.bob.id,
        }),
    );
    // dave deelt G3 met alice, maar niets met bob.
    await expectNoOracle(
      () => asUser(t, w, "dave").query(api.users.getById, { userId: gone }),
      () =>
        asUser(t, w, "dave").query(api.users.getById, {
          userId: w.users.bob.id,
        }),
    );
  });

  it("webmaster zonder gedeelde groep: geen bypass", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await staleId(t, w, "users");
    await expectNoOracle(
      () => asUser(t, w, "wm").query(api.users.getById, { userId: gone }),
      () =>
        asUser(t, w, "wm").query(api.users.getById, { userId: w.users.bob.id }),
    );
  });
});
