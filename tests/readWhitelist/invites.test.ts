import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  SHAPE,
  asGhost,
  asUser,
  expectNoUserSecrets,
  expectShape,
  newT,
  seedWorld,
  useWebmasterEnv,
  type R,
  type World,
} from "./_world";

// WP23 — invites-reads. A-keuze 8 (listMine zonder token/respondedAt/
// bouncedAt). WP19b: de anonieme landing (getByToken) is weg; daarvoor in de
// plaats listReceived (A-invariant 6, 14, 15) en listForGroup (A-invariant
// 12). Niet-publiek-zijn van listPendingForEmail/hasPendingForEmail en van
// getByToken staat in inventory.test.ts en tests/invites/inventory.test.ts.

useWebmasterEnv();

function expectNoInviteSecrets(value: unknown, w: World) {
  const json = JSON.stringify(value);
  for (const tok of Object.values(w.tokens)) {
    expect(json, "token-echo").not.toContain(tok);
  }
}

describe("invites.listReceived — de genodigde (WP19b)", () => {
  it("precies id, rol, geldig tot, groep (id, naam, hasCover, coverOrientation) en uitnodiger (openbaar profiel)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // Carol (geen lid van G1) wordt door Alice (admin) uitgenodigd.
    const id = await t.run(async (ctx) =>
      ctx.db.insert("invites", {
        email: "carol@x.com",
        invitedBy: w.users.alice.id,
        groupId: w.groups.G1,
        role: "member",
        token: "tok-carol-g1-secret",
        status: "pending",
        expiresAt: Date.now() + 86_400_000,
        createdAt: Date.now(),
      }),
    );
    const list = (await asUser(t, w, "carol").query(api.invites.listReceived, {})) as R[];
    expect(list).toHaveLength(1);
    const got = list[0]!;
    expectShape(got, SHAPE.inviteReceived);
    expectShape(got.group, SHAPE.receivedGroup);
    expectShape(got.inviter, SHAPE.receivedInviter);
    expect(got._id).toBe(id);
    expect(got.group._id).toBe(w.groups.G1);
    expect(got.group.name).toBe("Club");
    // G1 heeft pBob als cover, en pBob staat in A1 van G1.
    expect(got.group.hasCover).toBe(true);
    // WP19c A-invariant 12: de stand van de cover, geen foto-id.
    expect(got.group.coverOrientation).toBe(6);
    expect(got.inviter._id).toBe(w.users.alice.id);
    expect(got.inviter.name).toBe("Alice");
    const json = JSON.stringify(got);
    expect(json).not.toContain("tok-carol-g1-secret");
    expect(json).not.toContain(w.photos.pBob);
    expect(json).not.toContain("profilePhotoStorageId");
    expectNoInviteSecrets(got, w);
    expectNoUserSecrets(got, w);
  });

  it("[] zonder identity en [] bij identity zonder users-rij", async () => {
    const t = newT();
    await seedWorld(t);
    expect(await t.query(api.invites.listReceived, {})).toEqual([]);
    expect(await asGhost(t).query(api.invites.listReceived, {})).toEqual([]);
  });
});

describe("invites.listForGroup — admin (WP19b)", () => {
  it("alleen open, niet verlopen; vorm id, e-mail, rol, geldig tot (geen naam op deze rij)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const list = (await asUser(t, w, "alice").query(api.invites.listForGroup, {
      groupId: w.groups.G1,
    })) as R[];
    expect(list.map((i) => i._id)).toEqual([w.invites.invG1]);
    expectShape(list[0], SHAPE.inviteForAdmin);
    expectNoInviteSecrets(list, w);
    expectNoUserSecrets(list, w);
  });
});

describe("invites.listMine — afzender", () => {
  it("[] zonder identity en [] bij identity zonder users-rij (ongewijzigd)", async () => {
    const t = newT();
    await seedWorld(t);
    expect(await t.query(api.invites.listMine, {})).toEqual([]);
    expect(await asGhost(t).query(api.invites.listMine, {})).toEqual([]);
  });

  it("[A-keuze 8] alleen eigen invites, in de invite-vorm: geen token, invitedBy, respondedAt of bouncedAt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const list = (await asUser(t, w, "alice").query(
      api.invites.listMine,
      {},
    )) as R[];
    const byId = new Map(list.map((i) => [i._id, i]));
    expect([...byId.keys()].sort()).toEqual(
      [w.invites.invG1, w.invites.invBounced, w.invites.invGeneral].sort(),
    );

    expectShape(byId.get(w.invites.invG1), SHAPE.inviteSender);
    // bounced: respondedAt + bouncedAt staan in de rij, niet in de vorm.
    expectShape(byId.get(w.invites.invBounced), SHAPE.inviteSender);
    // algemene invite: groupId en rol ontbreken in de rij.
    expectShape(
      byId.get(w.invites.invGeneral),
      SHAPE.inviteSender.filter((k) => k !== "groupId" && k !== "role"),
    );

    expectNoInviteSecrets(list, w);
    expectNoUserSecrets(list, w);
  });
});
