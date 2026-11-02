// Publieke / lookup queries op invites:
//   api.invites.getByToken      — landingspagina (anoniem, token = toegangsbewijs)
//   api.invites.listMine        — eigen verstuurde invites (sender view)
//
// Bron:
//   - blob-images-api-invites/handlersInvite/publicGetInvite.js
//     (regel 4-11: ophalen via inviteId path-param + getInvite-validatie)
//   - blob-images-api-invites/handlersInvite/inviteHelpers.js
//     (regel 14-16: access-check; regel 28: status-check; regel 31-32: expiry)
//
// Belangrijke v2-keuze: getByToken is een PUBLIC query (geen auth nodig)
// zodat de invite-landingspagina werkt voor anonymous bezoeker, maar het
// retourneert alleen non-sensitive velden. Tests gemarkeerd [GAP] dekken
// edge cases die in oude code ontbraken.
//
// WP23: de landing-vorm bevat geen invitee-email meer (A-keuze 6); de exacte
// vorm staat in tests/readWhitelist/invites.test.ts. listPendingForEmail en
// hasPendingForEmail zijn geen publieke query meer (A-keuze 7, gepind in
// tests/readWhitelist/inventory.test.ts). Hun semantiek (alleen pending,
// niet verlopen, case-insensitive) leeft voort in de onboarding:
// tests/users/registerFromSession.test.ts.

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
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
  name?: string,
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      subject,
      email: email.toLowerCase().trim(),
      ...(name !== undefined ? { name } : {}),
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    }),
  );
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
    expect(got?.status).toBe("pending");
    // Audit-8: inviter is gesluisd tot {name, profilePhotoStorageId}; check
    // alleen op aanwezigheid hier. Field-shape wordt gepind in de [audit-8]
    // sluis-test verderop.
    expect(got?.inviter).not.toBeNull();
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
    expect(got?.status).toBe("pending");
    expect(got?.group).toBeNull();
  });

  it("[audit-8] returnt alleen geslucht inviter-object — geen email/subject/photoCount/lastVisitAt op publieke endpoint", async () => {
    // getByToken is anonymous-toegankelijk (invite-landing). De huidige
    // implementatie returnde het volledige inviter-document via ctx.db.get,
    // wat een info-leak is: email + Clerk subject + activity-data zijn niet
    // nodig voor de invite-pagina. Sluis tot {name, profilePhotoStorageId}.
    // RED tot B's fix in convex/invites.ts getByToken.
    const t = convexTest(schema);
    await registerUser(t, "user_alice", "alice@x.com", "Alice");
    const { token } = await withUser(t, "user_alice").mutation(
      api.invites.create,
      { email: "new@x.com" },
    );
    const got = await t.query(api.invites.getByToken, { token });
    expect(got?.inviter).not.toBeNull();
    const inviter = got!.inviter as Record<string, unknown>;
    expect(inviter.name).toBe("Alice");
    // Sluis: alleen non-sensitive velden mogen lekken naar de publieke
    // landingspagina. Sensitive (email, Clerk subject, activity-data,
    // aggregates) en interne Convex-velden moeten weg zijn.
    expect(inviter.email).toBeUndefined();
    expect(inviter.subject).toBeUndefined();
    expect(inviter.photoCount).toBeUndefined();
    expect(inviter.photoLimit).toBeUndefined();
    expect(inviter.lastVisitAt).toBeUndefined();
    expect(inviter.createdAt).toBeUndefined();
    expect(inviter._id).toBeUndefined();
    expect(inviter._creationTime).toBeUndefined();
    // Allow-list: enkel name + profilePhotoStorageId.
    const allowed = new Set(["name", "profilePhotoStorageId"]);
    for (const k of Object.keys(inviter)) {
      expect(allowed.has(k)).toBe(true);
    }
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
