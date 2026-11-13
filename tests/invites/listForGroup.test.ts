import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  as,
  expectRefused,
  expectRejectedNoChange,
  goneGroupId,
  newT,
} from "../groups/_beheer";
import { DAY_MS, inviteRow, scheduledCount, secondGroup, seedInvite, world } from "./_wp19b";

// WP19b A-invariant 12 (besluit 2, V3): open uitnodigingen staan in Leden onder
// "Uitgenodigd". Alleen een admin ziet ze (id, naam, e-mail, rol, geldig tot;
// nieuwste eerst) en kan er een intrekken. Een lid: NOT_ALLOWED; geen lid of
// onbekende groep: NOT_MEMBER. Intrekken stuurt geen mail. Een ingetrokken
// uitnodiging staat niet meer in `listReceived` en is niet te accepteren.

const listForGroup = api.invites.listForGroup;
const KEYS = ["_id", "name", "email", "role", "expiresAt"];
type R = Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("A-invariant 12 — open uitnodigingen van een groep", () => {
  it("een admin ziet de open, niet verlopen uitnodigingen van zijn groep, nieuwste eerst", async () => {
    const t = newT();
    const w = await world(t);
    const g2 = await secondGroup(t, w);
    const now = Date.now();
    const older = await seedInvite(t, { email: "a@x.test", invitedBy: w.users.olga!, groupId: w.groupId, name: "A", createdAt: now - 2 * DAY_MS });
    const newer = await seedInvite(t, { email: "b@x.test", invitedBy: w.users.anna!, groupId: w.groupId, name: "B", createdAt: now - DAY_MS });
    await seedInvite(t, { email: "c@x.test", invitedBy: w.users.olga!, groupId: w.groupId, expiresAt: now });
    await seedInvite(t, { email: "d@x.test", invitedBy: w.users.olga!, groupId: w.groupId, status: "declined" });
    await seedInvite(t, { email: "e@x.test", invitedBy: w.users.olga!, groupId: w.groupId, status: "accepted" });
    await seedInvite(t, { email: "f@x.test", invitedBy: w.users.olga!, groupId: g2 });
    const got = (await as(t, "user_anna").query(listForGroup, { groupId: w.groupId })) as R[];
    expect(got.map((i) => i._id)).toEqual([newer, older]);
  });

  it("de vorm: alleen id, naam, e-mail, rol en geldig tot", async () => {
    const t = newT();
    const w = await world(t);
    const expiresAt = Date.now() + DAY_MS;
    const id = await seedInvite(t, {
      email: "nina@x.test",
      invitedBy: w.users.olga!,
      groupId: w.groupId,
      role: "admin",
      name: "Nina",
      message: "geheim bericht",
      expiresAt,
    });
    const token = (await inviteRow(t, id))!.token;
    const got = (await as(t, "user_olga").query(listForGroup, { groupId: w.groupId })) as R[];
    for (const k of Object.keys(got[0]!)) expect(KEYS).toContain(k);
    expect(got[0]).toEqual({ _id: id, name: "Nina", email: "nina@x.test", role: "admin", expiresAt });
    expect(JSON.stringify(got)).not.toContain(token);
  });

  it("een lid zonder admin-rol: NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () => as(t, "user_lex").query(listForGroup, { groupId: w.groupId }));
  });

  it("geen lid of een onbekende groep: NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_MEMBER", () => as(t, "user_eve").query(listForGroup, { groupId: w.groupId }));
    const gone = await goneGroupId(t);
    await expectRefused(t, "NOT_MEMBER", () => as(t, "user_olga").query(listForGroup, { groupId: gone }));
  });

  it("anoniem: geweigerd", async () => {
    const t = newT();
    const w = await world(t);
    await expect(t.query(listForGroup, { groupId: w.groupId })).rejects.toThrow();
  });
});

describe("A-invariant 12 — intrekken", () => {
  it("een admin trekt een uitnodiging van een andere admin in; geen mail", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    const before = await scheduledCount(t);
    await as(t, "user_anna").mutation(api.invites.remove, { inviteId: id });
    expect(await inviteRow(t, id)).toBeNull();
    expect(await scheduledCount(t)).toBe(before);
  });

  it("daarna: niet meer in listReceived, en accepteren geeft INVITE_INVALID", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    await as(t, "user_olga").mutation(api.invites.remove, { inviteId: id });
    expect(await as(t, "user_bob").query(api.invites.listReceived, {})).toEqual([]);
    await expectRefused(t, "INVITE_INVALID", () => as(t, "user_bob").mutation(api.invites.accept, { inviteId: id }));
  });

  it("een gewoon lid: NOT_ALLOWED, ook als hij de afzender was", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.lex!, groupId: w.groupId });
    await expectRefused(t, "NOT_ALLOWED", () => as(t, "user_lex").mutation(api.invites.remove, { inviteId: id }));
  });

  it("geen lid: NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    await expectRefused(t, "NOT_MEMBER", () => as(t, "user_eve").mutation(api.invites.remove, { inviteId: id }));
  });

  it("de genodigde zelf kan niet intrekken (hij wijst af)", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    await expectRejectedNoChange(t, () => as(t, "user_bob").mutation(api.invites.remove, { inviteId: id }));
  });

  it("een onbekend id: geweigerd, niets verandert", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    await t.run(async (ctx) => ctx.db.delete(id));
    await expectRejectedNoChange(t, () => as(t, "user_olga").mutation(api.invites.remove, { inviteId: id }));
  });
});
