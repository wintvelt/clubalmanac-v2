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

// WP23 — invites-reads. Spec §Vormen (invite-landing, invite afzender),
// A-keuzes 6 (landing mét invitee-email sinds herziening 47b65bc, wel
// group._id; geen token/invitedBy/bouncedAt/_id/tijden) en 8 (listMine
// zonder token/respondedAt/bouncedAt). Niet-publiek-zijn van
// listPendingForEmail/hasPendingForEmail staat in inventory.test.ts.

useWebmasterEnv();

function expectNoInviteSecrets(value: unknown, w: World) {
  const json = JSON.stringify(value);
  for (const tok of Object.values(w.tokens)) {
    expect(json, "token-echo").not.toContain(tok);
  }
}

describe("invites.getByToken — anonieme landingspagina", () => {
  it("precies status, isExpired, rol, email van de genodigde, groep (id, naam, omschrijving) en inviter (naam, profielfoto)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const got = (await t.query(api.invites.getByToken, {
      token: w.tokens.g1,
    })) as R;
    expectShape(got, SHAPE.inviteLanding);
    expectShape(got.group, SHAPE.landingGroup);
    expectShape(got.inviter, SHAPE.landingInviter);
    expect(got.status).toBe("pending");
    expect(got.isExpired).toBe(false);
    expect(got.role).toBe("member");
    expect(got.email).toBe("new@x.com");
    expect(got.group._id).toBe(w.groups.G1);
    expect(got.group.name).toBe("Club");
    expect(got.inviter.name).toBe("Alice");

    const json = JSON.stringify(got);
    expect(json, "invitedBy-id op de landing").not.toContain(
      w.users.alice.id,
    );
    expectNoInviteSecrets(got, w);
    expectNoUserSecrets(got, w);
  });

  it("gebouncede, verlopen invite: landing-vorm met status en email, zonder bouncedAt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const got = (await t.query(api.invites.getByToken, {
      token: w.tokens.bounced,
    })) as R;
    expectShape(got, SHAPE.inviteLanding);
    expect(got.status).toBe("expired");
    expect(got.isExpired).toBe(true);
    expect(got.email).toBe("bounce@x.com");
  });

  it("algemene invite zonder groep en zonder rol: group is null, rol ontbreekt", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const got = (await t.query(api.invites.getByToken, {
      token: w.tokens.general,
    })) as R;
    expectShape(
      got,
      SHAPE.inviteLanding.filter((k) => k !== "role"),
    );
    expect(got.group).toBeNull();
  });

  it("ingelogd (ook als iemand anders dan de genodigde): dezelfde landing-vorm, niet meer", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const got = await asUser(t, w, "bob").query(api.invites.getByToken, {
      token: w.tokens.g1,
    });
    expectShape(got, SHAPE.inviteLanding);
    expectNoInviteSecrets(got, w);
  });

  it("onbekend token: null (ongewijzigd)", async () => {
    const t = newT();
    await seedWorld(t);
    expect(
      await t.query(api.invites.getByToken, { token: "bestaat-niet" }),
    ).toBeNull();
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
