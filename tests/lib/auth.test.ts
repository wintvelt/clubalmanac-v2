import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Audit-7 §2 + §3 — requireWebmaster edge-case dekking.
// Helper-tests via een al-bestaande webmaster-gated query: photos.listAllFlagged
// (roept enkel `await requireWebmaster(ctx)` aan, geen andere args). Daardoor
// pinnen we het helper-gedrag zonder een extra wrapper-mutation te hoeven
// invoeren. Tests zijn RED tot B's fixes:
//   - case-insensitive match (toLowerCase aan beide kanten)
//   - requireWebmaster doet intern ook requireCurrentUser
// Andere tests zijn GREEN nu en pinnen huidig fail-closed gedrag.

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";

function withUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email?: string,
) {
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    ...(email !== undefined ? { email } : {}),
  });
}

async function registerUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email: string,
) {
  // Audit-7 §5: seed pending invite zodat register-gate passeert ook
  // wanneer WEBMASTER_EMAILS unset is (test #1, #2). Voor webmaster-bypass
  // paden (WEBMASTER_EMAILS = email) is een extra invite harmloos.
  const { inviteId, seederId } = await t.run(async (ctx) => {
    const seederId = await ctx.db.insert("users", {
      subject: `__invite_seeder_${crypto.randomUUID()}`,
      email: `seeder_${crypto.randomUUID()}@seed.test`,
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    });
    const inviteId = await ctx.db.insert("invites", {
      email: email.toLowerCase().trim(),
      invitedBy: seederId,
      token: crypto.randomUUID(),
      status: "pending",
      expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
    return { inviteId, seederId };
  });
  const userId = await withUser(t, subject, email).mutation(api.users.register, {
    email,
  });
  // Cleanup seed-artifacts zodat test-DB schoon blijft (geen extra
  // pending invites of seeder-users die latere queries vervuilen).
  await t.run(async (ctx) => {
    await ctx.db.delete(inviteId);
    await ctx.db.delete(seederId);
  });
  return userId;
}

describe("requireWebmaster — env-var presence", () => {
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  // GREEN nu en na fix: helper is fail-closed.
  it("throwt wanneer WEBMASTER_EMAILS unset is", async () => {
    delete process.env.WEBMASTER_EMAILS;
    const t = convexTest(schema);
    await registerUser(t, "user_wm", "wouter@me.com");
    await expect(
      withUser(t, "user_wm", "wouter@me.com").query(
        api.photos.listAllFlagged,
        {},
      ),
    ).rejects.toThrow();
  });

  // GREEN nu en na fix: lege string → lege lijst → fail-closed.
  it('throwt wanneer WEBMASTER_EMAILS leeg is ("")', async () => {
    process.env.WEBMASTER_EMAILS = "";
    const t = convexTest(schema);
    await registerUser(t, "user_wm", "wouter@me.com");
    await expect(
      withUser(t, "user_wm", "wouter@me.com").query(
        api.photos.listAllFlagged,
        {},
      ),
    ).rejects.toThrow();
  });
});

describe("requireWebmaster — identity-claim", () => {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = "wouter@me.com";
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  // GREEN nu en na fix: zonder email-claim faalt `!email` check.
  it("throwt wanneer identity geen email-claim heeft", async () => {
    const t = convexTest(schema);
    // Identity zonder email — registreer toch via t.run zodat users-record
    // bestaat (anders zou na fix óók requireCurrentUser falen, dat is een
    // andere check; we testen hier specifiek email-ontbreken).
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        subject: "user_noemail",
        email: "wouter@me.com",
        photoCount: 0,
        photoLimit: 1000,
        createdAt: Date.now(),
      });
    });
    await expect(
      withUser(t, "user_noemail").query(api.photos.listAllFlagged, {}),
    ).rejects.toThrow();
  });
});

describe("requireWebmaster — case-insensitive match (RED tot B's fix)", () => {
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  // Audit-7 §2: env-var en JWT-claim kunnen in productie verschillen in
  // case (admin tikt mixed-case in dashboard, Clerk normaliseert lowercase).
  // Helper moet aan beide kanten toLowerCase doen. RED tot B's fix.
  it("env mixed-case + identity lowercase → passeert", async () => {
    process.env.WEBMASTER_EMAILS = "Wouter@me.com";
    const t = convexTest(schema);
    await registerUser(t, "user_wm", "wouter@me.com");
    await expect(
      withUser(t, "user_wm", "wouter@me.com").query(
        api.photos.listAllFlagged,
        {},
      ),
    ).resolves.not.toThrow();
  });

  // Reverse: env lowercase, identity mixed-case (sommige IdP's leveren
  // claim ongenormaliseerd). RED tot B's fix.
  it("env lowercase + identity mixed-case → passeert", async () => {
    process.env.WEBMASTER_EMAILS = "wouter@me.com";
    const t = convexTest(schema);
    await registerUser(t, "user_wm", "Wouter@me.com");
    await expect(
      withUser(t, "user_wm", "Wouter@me.com").query(
        api.photos.listAllFlagged,
        {},
      ),
    ).resolves.not.toThrow();
  });
});

describe("requireWebmaster — multi-email comma-separated", () => {
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  // GREEN nu en na fix: comma-split + trim werkt al.
  it("tweede email in lijst passeert", async () => {
    process.env.WEBMASTER_EMAILS = "a@x.com, b@x.com";
    const t = convexTest(schema);
    await registerUser(t, "user_b", "b@x.com");
    await expect(
      withUser(t, "user_b", "b@x.com").query(api.photos.listAllFlagged, {}),
    ).resolves.not.toThrow();
  });
});

describe("requireWebmaster — interactie met requireCurrentUser (RED tot B's fix)", () => {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = "wouter@me.com";
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  // Audit-7 §3: plan zegt webmaster MOET ook een users-record hebben.
  // Helper-fix: requireWebmaster roept intern requireCurrentUser aan
  // zodat beide gates samen passeren. RED tot B's fix (huidig: helper
  // checkt enkel identity.email, geen users-record nodig).
  it("Clerk-identity met webmaster-email maar zonder users-record throwt", async () => {
    const t = convexTest(schema);
    // Bewust GEEN registerUser — alleen Clerk identity simuleren.
    await expect(
      withUser(t, "user_wm_noregister", "wouter@me.com").query(
        api.photos.listAllFlagged,
        {},
      ),
    ).rejects.toThrow();
  });
});
