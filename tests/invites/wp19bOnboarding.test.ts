import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { goneGroupId, membership, newT, snapshot, type T } from "../groups/_beheer";
import { sessionCreatedPayload, signSvixHeaders, TEST_WEBHOOK_SECRET } from "../_helpers/svix";
import { allInvites, DAY_MS, inviteRow, seedInvite, usersByEmail, world } from "./_wp19b";

// WP19b A-invariant 1, 2, 11 en 16 (invariant 4 van de draft): geen account
// zonder open uitnodiging, aan de serverkant. `registerFromSession` (de
// onboarding achter `/clerk-webhook`) maakt alleen een users-rij als er voor
// het geverifieerde adres een uitnodiging is die nu accepteerbaar is: open,
// niet verlopen, met een groep die bestaat, van een uitnodiger die daar nog
// admin is. Anders: `null`, geen rij, en niets verandert. Geen uitzondering
// voor de webmaster (A-keuze 2). De naam van het nieuwe lid komt uit de
// nieuwste geaccepteerde uitnodiging (besluit 2, V2).

const register = internal.users.registerFromSession;
const NEW = "nieuw@x.test";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.WEBMASTER_EMAILS;
  delete process.env.CLERK_WEBHOOK_SECRET;
});

async function signUp(t: T, email = NEW, name?: string) {
  return await t.mutation(register, {
    subject: "user_nieuw",
    email,
    ...(name !== undefined ? { name } : {}),
  });
}

describe("A-invariant 1 — geen rij zonder accepteerbare uitnodiging", () => {
  it("geen enkele uitnodiging: null, geen rij, en niets in de database verandert", async () => {
    const t = newT();
    await world(t);
    const before = await snapshot(t);
    expect(await signUp(t)).toBeNull();
    expect(await usersByEmail(t, NEW)).toHaveLength(0);
    expect(await snapshot(t)).toEqual(before);
  });

  const notAcceptable: Array<[string, (t: T, w: Awaited<ReturnType<typeof world>>) => Promise<unknown>]> = [
    ["verlopen (expiresAt in het verleden)", (t, w) =>
      seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId, expiresAt: Date.now() - 1 })],
    ["verlopen op de grens (expiresAt === nu)", (t, w) =>
      seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId, expiresAt: Date.now() })],
    ["status expired", (t, w) =>
      seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId, status: "expired" })],
    ["status declined", (t, w) =>
      seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId, status: "declined" })],
    ["status accepted", (t, w) =>
      seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId, status: "accepted" })],
    ["groep bestaat niet meer", async (t, w) =>
      seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: await goneGroupId(t) })],
    ["uitnodiger is geen admin meer (gewoon lid)", (t, w) =>
      seedInvite(t, { email: NEW, invitedBy: w.users.lex!, groupId: w.groupId })],
    ["uitnodiger is geen lid", (t, w) =>
      seedInvite(t, { email: NEW, invitedBy: w.users.eve!, groupId: w.groupId })],
    ["uitnodiging zonder groep (A-invariant 16)", (t, w) =>
      seedInvite(t, { email: NEW, invitedBy: w.users.olga! })],
    ["uitnodiging aan een ander adres", (t, w) =>
      seedInvite(t, { email: "ander@x.test", invitedBy: w.users.olga!, groupId: w.groupId })],
  ];

  for (const [label, seed] of notAcceptable) {
    it(`alleen een uitnodiging die niet accepteerbaar is (${label}): null, geen rij, niets verandert`, async () => {
      const t = newT();
      const w = await world(t);
      await seed(t, w);
      const before = await snapshot(t);
      expect(await signUp(t)).toBeNull();
      expect(await usersByEmail(t, NEW)).toHaveLength(0);
      expect(await snapshot(t)).toEqual(before);
    });
  }

  it("A-keuze 2: ook de webmaster krijgt geen rij zonder uitnodiging", async () => {
    const t = newT();
    await world(t);
    process.env.WEBMASTER_EMAILS = NEW;
    expect(await signUp(t)).toBeNull();
    expect(await usersByEmail(t, NEW)).toHaveLength(0);
  });

  it("met één accepteerbare uitnodiging: rij, lidmaatschap met de rol, uitnodiging geaccepteerd", async () => {
    const t = newT();
    const w = await world(t);
    const inviteId = await seedInvite(t, {
      email: NEW,
      invitedBy: w.users.anna!,
      groupId: w.groupId,
      role: "admin",
      name: "Nina",
    });
    const userId = await signUp(t, "Nieuw@X.test");
    expect(userId).not.toBeNull();
    const rows = await usersByEmail(t, NEW);
    expect(rows).toHaveLength(1);
    expect((await membership(t, w.groupId, userId as Id<"users">))?.role).toBe("admin");
    expect((await inviteRow(t, inviteId))?.status).toBe("accepted");
  });

  it("een accepteerbare en een niet-accepteerbare: rij; de niet-accepteerbare blijft zoals hij was", async () => {
    const t = newT();
    const w = await world(t);
    const good = await seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId, name: "Nina" });
    const bad = await seedInvite(t, { email: NEW, invitedBy: w.users.lex!, groupId: w.groupId, name: "Nina" });
    const badBefore = await inviteRow(t, bad);
    expect(await signUp(t)).not.toBeNull();
    expect((await inviteRow(t, good))?.status).toBe("accepted");
    expect(await inviteRow(t, bad)).toEqual(badBefore);
  });

  it("opnieuw inloggen met een bestaande rij blijft een no-op, ook zonder uitnodiging", async () => {
    const t = newT();
    const w = await world(t);
    const before = await snapshot(t);
    expect(
      await t.mutation(register, { subject: "user_bob", email: "bob@x.test", name: "Andere Naam" }),
    ).toBe(w.users.bob);
    expect(await snapshot(t)).toEqual(before);
  });
});

describe("A-invariant 2 — alsnog uitgenodigd: de volgende sessie maakt het account", () => {
  it("eerst geweigerd, dan uitgenodigd, dan een nieuwe sessie: rij en lidmaatschap", async () => {
    const t = newT();
    const w = await world(t);
    expect(await signUp(t)).toBeNull();
    await seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId, name: "Nina" });
    const userId = await signUp(t);
    expect(userId).not.toBeNull();
    expect(await membership(t, w.groupId, userId as Id<"users">)).not.toBeNull();
  });
});

describe("A-invariant 11 (V2) — de naam van een nieuw lid komt uit de uitnodiging", () => {
  it("de naam van de nieuwste geaccepteerde uitnodiging, ook als Clerk een naam meegeeft", async () => {
    const t = newT();
    const w = await world(t);
    const g2 = await t.run(async (ctx) => {
      const gid = await ctx.db.insert("groups", { name: "Twee", createdBy: w.users.olga!, createdAt: Date.now() });
      await ctx.db.insert("memberships", { userId: w.users.olga!, groupId: gid, role: "admin", joinedAt: Date.now() });
      return gid;
    });
    const now = Date.now();
    await seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId, name: "Nina Oud", createdAt: now - 2 * DAY_MS });
    await seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: g2, name: "  Nina Nieuw  ", createdAt: now - DAY_MS });
    await signUp(t, NEW, "Clerk Naam");
    expect((await usersByEmail(t, NEW))[0]?.name).toBe("Nina Nieuw");
  });

  it("een nieuwere uitnodiging die niet accepteerbaar is, levert geen naam", async () => {
    const t = newT();
    const w = await world(t);
    const now = Date.now();
    await seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId, name: "Goed", createdAt: now - 2 * DAY_MS });
    await seedInvite(t, { email: NEW, invitedBy: w.users.lex!, groupId: w.groupId, name: "Fout", createdAt: now - DAY_MS });
    await signUp(t);
    expect((await usersByEmail(t, NEW))[0]?.name).toBe("Goed");
  });

  it("geaccepteerde uitnodiging zonder naam (gemigreerd): de naam uit Clerk", async () => {
    const t = newT();
    const w = await world(t);
    await seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId });
    await signUp(t, NEW, "Clerk Naam");
    expect((await usersByEmail(t, NEW))[0]?.name).toBe("Clerk Naam");
  });

  it("geen naam in de uitnodiging en niet in Clerk: geen naam", async () => {
    const t = newT();
    const w = await world(t);
    await seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId });
    await signUp(t);
    expect((await usersByEmail(t, NEW))[0]?.name).toBeUndefined();
  });
});

describe("A-invariant 1 — via /clerk-webhook", () => {
  async function post(t: T, email: string) {
    const body = sessionCreatedPayload({ subject: "user_nieuw", email });
    return await t.fetch("/clerk-webhook", { method: "POST", headers: signSvixHeaders({ body }), body });
  }

  it("een sessie zonder uitnodiging: 200 (geen herhaling door Svix), geen rij", async () => {
    const t = newT();
    await world(t);
    process.env.CLERK_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    const invitesBefore = await allInvites(t);
    const res = await post(t, NEW);
    expect(res.status).toBe(200);
    expect(await usersByEmail(t, NEW)).toHaveLength(0);
    expect(await allInvites(t)).toEqual(invitesBefore);
  });

  it("een sessie met een accepteerbare uitnodiging: 200 en een rij", async () => {
    const t = newT();
    const w = await world(t);
    process.env.CLERK_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    await seedInvite(t, { email: NEW, invitedBy: w.users.olga!, groupId: w.groupId, name: "Nina" });
    const res = await post(t, NEW);
    expect(res.status).toBe(200);
    expect(await usersByEmail(t, NEW)).toHaveLength(1);
  });
});
