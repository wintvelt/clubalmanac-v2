// TDD red phase voor publieke / lookup queries op invites:
//   api.invites.getByToken      — invite + inviter + group voor invite-pagina
//   api.invites.listPendingForEmail
//   api.invites.hasPendingForEmail
//   api.invites.listMine        — eigen verstuurde invites (sender view)
//
// Bron:
//   - blob-images-api-invites/handlersInvite/publicGetInvite.js
//     (regel 4-11: ophalen via inviteId path-param + getInvite-validatie)
//   - blob-images-api-invites/handlersInvite/inviteHelpers.js
//     (regel 14-16: access-check; regel 28: status-check; regel 31-32: expiry)
//   - blob-images-api/handlersCognito/preSignup.js
//     (regel 7-39: pre-signup haalt invite op om te checken of email mag
//     signuppen; equivalent in v2 via hasPendingForEmail)
//
// Belangrijke v2-keuze: getByToken is een PUBLIC query (geen auth nodig)
// zodat de invite-landingspagina werkt voor anonymous bezoeker, maar het
// retourneert alleen non-sensitive velden. Tests gemarkeerd [GAP] dekken
// edge cases die in oude code ontbraken.

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

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

describe("invites.getByToken — landingspagina lookup", () => {
  // Verwijst naar publicGetInvite.js: returnt invite + inviter + group.
  it("returnt invite + inviter + group voor geldige token (anonymous toegang)", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const groupId = await withUser(t, "user_alice").mutation(
      api.groups.create,
      { name: "Mijn Groep" },
    );
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com", groupId, role: "member" },
    );

    // Geen withUser → anonymous query
    const got = await t.query(api.invites.getByToken, { token });
    expect(got?.email).toBe("new@x.com");
    expect(got?.inviter?.email).toBe("a@x.com");
    expect(got?.group?.name).toBe("Mijn Groep");
    expect(got?.role).toBe("member");
  });

  it("general invite (geen groupId): group is null", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com" },
    );
    const got = await t.query(api.invites.getByToken, { token });
    expect(got?.email).toBe("new@x.com");
    expect(got?.group).toBeNull();
  });

  it("returnt null voor onbekende token (i.p.v. throw)", async () => {
    // [GAP] oude code throwde "invite not found" (inviteHelpers.js regel 25).
    // v2: query returnt null zodat frontend een nette 404-pagina kan tonen
    // i.p.v. error-boundary.
    const t = convexTest(schema);
    const got = await t.query(api.invites.getByToken, { token: "bogus" });
    expect(got).toBeNull();
  });

  it("returnt invite met status='accepted' (geen filter — frontend toont status)", async () => {
    // [GAP] oude code throwde "invite already accepted" (regel 28). v2:
    // landingspagina kan zelf bepalen wat te tonen ("Deze invite is al
    // gebruikt"). Filtering is een frontend-zorg, niet API-zorg.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token });
    const got = await t.query(api.invites.getByToken, { token });
    expect(got?.status).toBe("accepted");
  });

  it("returnt invite met status='expired' wanneer expiresAt < now", async () => {
    // Spiegelt oude regel 31-32 maar als data, niet als throw.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId, token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await t.run((ctx) =>
      ctx.db.patch(inviteId, { expiresAt: Date.now() - 1000 }),
    );
    const got = await t.query(api.invites.getByToken, { token });
    // Twee acceptabele designs:
    //   (a) status patch al gebeurd door cron → "expired"
    //   (b) computed isExpired flag op response
    // Voor TDD-red: kies (b) zodat we niet afhankelijk zijn van cron-timing.
    expect(got?.isExpired).toBe(true);
  });
});

describe("invites.listPendingForEmail / hasPendingForEmail — pre-signup check", () => {
  // Verwijst naar preSignup.js regel 14-39: checkt of email een open invite
  // heeft. v2-equivalent gaat via hasPendingForEmail (anonymous query, want
  // signup-flow heeft nog geen authed user).
  it("vindt pending invite voor email (anonymous query)", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "new@x.com",
    });

    const list = await t.query(api.invites.listPendingForEmail, {
      email: "new@x.com",
    });
    expect(list).toHaveLength(1);

    expect(
      await t.query(api.invites.hasPendingForEmail, { email: "new@x.com" }),
    ).toBe(true);
    expect(
      await t.query(api.invites.hasPendingForEmail, { email: "ander@x.com" }),
    ).toBe(false);
  });

  it("filtert verlopen invites uit", async () => {
    // [GAP] oude preSignup.js (regel 34-39) checkte enkel `Item` bestaan,
    // niet expiry — een verlopen invite zou nog steeds signup toestaan.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { inviteId } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com" },
    );
    await t.run((ctx) =>
      ctx.db.patch(inviteId, { expiresAt: Date.now() - 1000 }),
    );
    expect(
      await t.query(api.invites.hasPendingForEmail, { email: "new@x.com" }),
    ).toBe(false);
    expect(
      await t.query(api.invites.listPendingForEmail, { email: "new@x.com" }),
    ).toHaveLength(0);
  });

  it("filtert accepted en declined uit", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token: t1 } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    const { token: t2 } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "carol@x.com" },
    );
    await registerUser(t, "user_bob", "bob@x.com");
    await registerUser(t, "user_carol", "carol@x.com");
    await withUser(t, "user_bob").mutation(api.invites.accept, { token: t1 });
    await withUser(t, "user_carol").mutation(api.invites.decline, { token: t2 });

    expect(
      await t.query(api.invites.hasPendingForEmail, { email: "bob@x.com" }),
    ).toBe(false);
    expect(
      await t.query(api.invites.hasPendingForEmail, { email: "carol@x.com" }),
    ).toBe(false);
  });

  it("[GAP] case-insensitive email match", async () => {
    // Oude DynamoDB lookup matchte op exact PK ("UME"+email letterlijk).
    // v2: signup-emails kunnen casing-verschillen hebben (Clerk normaliseert
    // niet altijd). Borg dat invite voor "Bob@X.com" matcht "bob@x.com".
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "Bob@X.com",
    });
    expect(
      await t.query(api.invites.hasPendingForEmail, { email: "bob@x.com" }),
    ).toBe(true);
  });
});

describe("invites.listMine — sender view", () => {
  // [GAP] oude code had geen sender-view; alle zicht op pending invites was
  // via DynamoDB scan in admin tools. v2: eigen UI voor "verstuurde invites".
  it("returnt alleen invites die caller stuurde", async () => {
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    await registerUser(t, "user_bob", "b@x.com");
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "x@x.com",
    });
    await withUser(t, "user_bob").mutation(api.invites.create, {
      email: "y@x.com",
    });

    const aliceList = await withUser(t, "user_alice").query(
      api.invites.listMine,
      {},
    );
    expect(aliceList).toHaveLength(1);
    expect(aliceList[0]?.email).toBe("x@x.com");
  });

  it("returnt empty array zonder auth (geen throw)", async () => {
    const t = convexTest(schema);
    expect(await t.query(api.invites.listMine, {})).toEqual([]);
  });

  it("includeert alle statussen (pending + accepted + declined + expired)", async () => {
    // listMine is een audit/history view, niet een actie-lijst — toon alles.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "a@x.com");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "bob@x.com" },
    );
    await withUser(t, "user_alice").mutation(api.invites.create, {
      email: "carol@x.com",
    });
    await registerUser(t, "user_bob", "bob@x.com");
    await withUser(t, "user_bob").mutation(api.invites.decline, { token });

    const list = await withUser(t, "user_alice").query(
      api.invites.listMine,
      {},
    );
    expect(list).toHaveLength(2);
    const statuses = list.map((i) => i.status).sort();
    expect(statuses).toEqual(["declined", "pending"]);
  });
});
