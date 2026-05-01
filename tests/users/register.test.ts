import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

// Audit-7 §5 — invite-only signup gate als defense-in-depth in
// users.register. Plan regel 513 zegt dat de Clerk pre-signup webhook
// `invites.hasPendingForEmail` gebruikt om signup te enforcen. Hier
// pinnen we een server-side check direct in de register-mutation,
// zodat een directe API-call (frontend met geforceerde Clerk-identity)
// óók niet door de gate breekt.
//
// Tests RED tot B's code-fix in convex/users.ts register-block.

const ISSUER = "https://picked-quail-97.clerk.accounts.dev";
const WEBMASTER_EMAIL = "webmaster@x.com";
const DAY_MS = 24 * 60 * 60 * 1000;

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

async function insertInvite(
  t: ReturnType<typeof convexTest>,
  args: {
    email: string;
    status: "pending" | "accepted" | "declined" | "expired";
    expiresAt?: number;
  },
) {
  return await t.run(async (ctx) => {
    // invitedBy moet een geldige user-id zijn — maak een dummy inviter.
    const inviterId = await ctx.db.insert("users", {
      subject: "user_inviter",
      email: "inviter@x.com",
      photoCount: 0,
      photoLimit: 1000,
      createdAt: Date.now(),
    });
    return await ctx.db.insert("invites", {
      email: args.email.toLowerCase(),
      invitedBy: inviterId,
      token: crypto.randomUUID(),
      status: args.status,
      expiresAt: args.expiresAt ?? Date.now() + 14 * DAY_MS,
      createdAt: Date.now(),
    });
  });
}

describe("users.register — invite gate (audit-7 §5)", () => {
  it("weigert email zonder pending invite", async () => {
    const t = convexTest(schema);
    await expect(
      withUser(t, "user_alice", "alice@x.com").mutation(api.users.register, {
        email: "alice@x.com",
      }),
    ).rejects.toThrow();
  });

  it("slaagt met pending invite", async () => {
    const t = convexTest(schema);
    await insertInvite(t, { email: "alice@x.com", status: "pending" });
    const id = await withUser(t, "user_alice", "alice@x.com").mutation(
      api.users.register,
      { email: "alice@x.com" },
    );
    const user = await t.run((ctx) => ctx.db.get(id));
    expect(user?.email).toBe("alice@x.com");
  });

  it("weigert email met expired invite", async () => {
    const t = convexTest(schema);
    await insertInvite(t, {
      email: "alice@x.com",
      status: "expired",
      expiresAt: Date.now() - DAY_MS,
    });
    await expect(
      withUser(t, "user_alice", "alice@x.com").mutation(api.users.register, {
        email: "alice@x.com",
      }),
    ).rejects.toThrow();
  });

  // Pending invite waarvan expiresAt in het verleden ligt — wordt door
  // hasPendingForEmail eruit gefilterd. Hetzelfde rejection-pad als de
  // expliciete "expired" status.
  it("weigert email met pending-maar-verlopen invite", async () => {
    const t = convexTest(schema);
    await insertInvite(t, {
      email: "alice@x.com",
      status: "pending",
      expiresAt: Date.now() - DAY_MS,
    });
    await expect(
      withUser(t, "user_alice", "alice@x.com").mutation(api.users.register, {
        email: "alice@x.com",
      }),
    ).rejects.toThrow();
  });

  it("weigert email met accepted invite (al gebruikt)", async () => {
    const t = convexTest(schema);
    await insertInvite(t, { email: "alice@x.com", status: "accepted" });
    await expect(
      withUser(t, "user_alice", "alice@x.com").mutation(api.users.register, {
        email: "alice@x.com",
      }),
    ).rejects.toThrow();
  });
});

describe("users.register — email normalisatie (audit-8 bevinding 2)", () => {
  // Audit-8: het hele systeem rekent met genormaliseerde (lowercase + trim)
  // emails — invites.email wordt zo opgeslagen, hasPendingForEmail
  // normaliseert input, accept/decline vergelijken via normalizeEmail. Maar
  // users.register stopte met normaliseren bij de invite-gate-lookup en
  // gebruikte daarna `email` (raw) voor de duplicate-check + insert. Daardoor:
  //   - Een register met "Alice@x.com" landt in users.email als "Alice@x.com"
  //   - Een tweede register met "alice@x.com" vindt geen match in by_email
  //     (case-sensitive) en kan een dubbele user aanmaken
  //   - invites.create's "al lid"-check (existingUser via by_email lowercased)
  //     mist de mixed-case user en laat een onnodige invite door
  //
  // Fix: `normalizedEmail` gebruiken in zowel by_email-lookup als insert.
  // Tests RED tot B's fix in convex/users.ts.
  it("slaagt met mixed-case identity-email + lowercase invite (en stored email is genormaliseerd)", async () => {
    const t = convexTest(schema);
    await insertInvite(t, { email: "bob@x.com", status: "pending" });
    const id = await withUser(t, "user_bob", "Bob@x.com").mutation(
      api.users.register,
      { email: "Bob@x.com" },
    );
    const user = await t.run((ctx) => ctx.db.get(id));
    // Email-invariant: alle emails worden lowercased opgeslagen zodat
    // case-insensitive lookups via by_email werken zonder per-call normalisatie.
    expect(user?.email).toBe("bob@x.com");
  });

  it("weigert duplicate user bij case-mismatch (Alice@x.com → alice@x.com)", async () => {
    const t = convexTest(schema);
    await insertInvite(t, { email: "alice@x.com", status: "pending" });
    await withUser(t, "user_alice", "Alice@x.com").mutation(
      api.users.register,
      { email: "Alice@x.com" },
    );
    // Tweede invite zodat de gate-check niet de eerste throw is.
    await insertInvite(t, { email: "alice@x.com", status: "pending" });
    await expect(
      withUser(t, "user_alice2", "alice@x.com").mutation(api.users.register, {
        email: "alice@x.com",
      }),
    ).rejects.toThrow();
  });
});

describe("users.register — webmaster bootstrap-bypass", () => {
  beforeEach(() => {
    process.env.WEBMASTER_EMAILS = WEBMASTER_EMAIL;
  });
  afterEach(() => {
    delete process.env.WEBMASTER_EMAILS;
  });

  // OPEN VRAAG (Wouter beslist): oude AWS preSignup.js liet de webmaster
  // óók zonder invite registreren (cold-start bootstrap). Plan zegt
  // "bootstrap via Clerk dashboard pre-cutover" — dus geen bypass nodig.
  // Twee tests hieronder pinnen één van de twee keuzes; als Wouter kiest
  // voor "geen bypass" → tweede test laten staan, eerste skip/verwijder.
  // Default-keus geïmplementeerd als bypass=ja (aansluitend bij oude AWS,
  // veiliger pad voor accidental wipeouts van de webmaster). Aanpasbaar
  // door B.
  it("accepteert WEBMASTER_EMAILS-email zonder invite (bootstrap-bypass)", async () => {
    const t = convexTest(schema);
    const id = await withUser(t, "user_wm", WEBMASTER_EMAIL).mutation(
      api.users.register,
      { email: WEBMASTER_EMAIL },
    );
    const user = await t.run((ctx) => ctx.db.get(id));
    expect(user?.email).toBe(WEBMASTER_EMAIL);
  });
});
