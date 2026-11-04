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

// WP23 — groups-reads. Spec §Vormen (groep, membership, foto, publiek
// profiel), invarianten 3-5, edge case "webmaster zonder lidmaatschap".

useWebmasterEnv();

describe("groups.getById", () => {
  it("niet-ingelogd en identity zonder users-rij: throwt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(
      t.query(api.groups.getById, { groupId: w.groups.G1 }),
    ).rejects.toThrow();
    await expect(
      asGhost(t).query(api.groups.getById, { groupId: w.groups.G1 }),
    ).rejects.toThrow();
  });

  it("lid: precies de groep-velden", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const g = (await asUser(t, w, "bob").query(api.groups.getById, {
      groupId: w.groups.G1,
    })) as R;
    expectShape(g, SHAPE.group);
    expect(g._id).toBe(w.groups.G1);
    expect(g.name).toBe("Club");
  });

  it("niet-lid: geen data, niet te onderscheiden van een onbekende groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await staleId(t, w, "groups");
    await expectNoOracle(
      () => asUser(t, w, "carol").query(api.groups.getById, { groupId: gone }),
      () =>
        asUser(t, w, "carol").query(api.groups.getById, {
          groupId: w.groups.G1,
        }),
    );
  });

  it("webmaster zonder lidmaatschap: geen bypass", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await staleId(t, w, "groups");
    await expectNoOracle(
      () => asUser(t, w, "wm").query(api.groups.getById, { groupId: gone }),
      () =>
        asUser(t, w, "wm").query(api.groups.getById, { groupId: w.groups.G1 }),
    );
  });
});

describe("groups.getWithCover", () => {
  it("niet-ingelogd: throwt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(
      t.query(api.groups.getWithCover, { groupId: w.groups.G1 }),
    ).rejects.toThrow();
  });

  it("lid: groep-velden + cover als foto-vorm (gemelde cover: geen flag-velden, geen GPS, geen filename)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const g = (await asUser(t, w, "bob").query(api.groups.getWithCover, {
      groupId: w.groups.G1,
    })) as R;
    expectShape(g, [...SHAPE.group, "cover"]);
    expectShape(g.cover, SHAPE.photo);
    expect(g.cover._id).toBe(w.photos.pBob);
    expectNoUserSecrets(g, w);
  });

  it("niet-lid: geen data, niet te onderscheiden van een onbekende groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await staleId(t, w, "groups");
    await expectNoOracle(
      () =>
        asUser(t, w, "carol").query(api.groups.getWithCover, { groupId: gone }),
      () =>
        asUser(t, w, "carol").query(api.groups.getWithCover, {
          groupId: w.groups.G1,
        }),
    );
  });
});

describe("groups.listMine", () => {
  it("[] zonder identity en [] bij identity zonder users-rij (ongewijzigd)", async () => {
    const t = newT();
    await seedWorld(t);
    expect(await t.query(api.groups.listMine, {})).toEqual([]);
    expect(await asGhost(t).query(api.groups.listMine, {})).toEqual([]);
  });

  // WP16 (open vraag 4, A paste aan): ook de teller per groep.
  it("per groep precies de groep-velden + eigen rol + unreadCount", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const mine = (await asUser(t, w, "alice").query(
      api.groups.listMine,
      {},
    )) as R[];
    expect(mine.map((g) => g._id).sort()).toEqual(
      [w.groups.G1, w.groups.G3].sort(),
    );
    for (const g of mine) {
      expectShape(g, [...SHAPE.group, "role", "unreadCount"]);
      expect(g.role).toBe("admin");
    }
  });
});

describe("groups.listMembers — bron voor de WP16-ledenlijst", () => {
  it("niet-ingelogd: throwt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await expect(
      t.query(api.groups.listMembers, { groupId: w.groups.G1 }),
    ).rejects.toThrow();
  });

  it("lid: per item membership-velden + user als publiek profiel; geen email of subject van wie dan ook", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const members = (await asUser(t, w, "bob").query(api.groups.listMembers, {
      groupId: w.groups.G1,
    })) as R[];
    expect(members).toHaveLength(2);
    for (const m of members) {
      expectShape(m, ["membership", "user"]);
      expectShape(m.membership, SHAPE.membership);
      expectShape(m.user, SHAPE.publicProfile);
      expect(m.user._id).toBe(m.membership.userId);
    }
    expect(members.map((m) => m.user.name).sort()).toEqual(["Alice", "Bob"]);
    expectNoUserSecrets(members, w);
  });

  it("niet-lid: geen data, niet te onderscheiden van een onbekende groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await staleId(t, w, "groups");
    await expectNoOracle(
      () =>
        asUser(t, w, "carol").query(api.groups.listMembers, { groupId: gone }),
      () =>
        asUser(t, w, "carol").query(api.groups.listMembers, {
          groupId: w.groups.G1,
        }),
    );
  });
});

describe("groups.listMembers — webmaster en null-tak (audit-ronde 1)", () => {
  it("webmaster zonder lidmaatschap: geen bypass, niet te onderscheiden van een onbekende groep", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const gone = await staleId(t, w, "groups");
    await expectNoOracle(
      () => asUser(t, w, "wm").query(api.groups.listMembers, { groupId: gone }),
      () =>
        asUser(t, w, "wm").query(api.groups.listMembers, {
          groupId: w.groups.G1,
        }),
    );
  });

  it("users-rij ontbreekt maar membership staat er nog: user is null, membership blijft in de vorm", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run((ctx) => ctx.db.delete(w.users.bob.id));
    const members = (await asUser(t, w, "alice").query(
      api.groups.listMembers,
      { groupId: w.groups.G1 },
    )) as R[];
    expect(members).toHaveLength(2);
    const orphan = members.find((m) => m.membership.userId === w.users.bob.id);
    expect(orphan, "membership van de verdwenen user ontbreekt").toBeDefined();
    expectShape(orphan, ["membership", "user"]);
    expectShape(orphan!.membership, SHAPE.membership);
    expect(orphan!.user).toBeNull();
    expectNoUserSecrets(members, w);
  });
});
