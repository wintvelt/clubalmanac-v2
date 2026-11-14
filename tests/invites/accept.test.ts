// invites.accept — wat blijft na WP19b (accepteren op id, A-invariant 7).
//
// Bron v1: blob-images-api-invites/handlersInvite/acceptInvite.js
//   - membership create/upsert; hasBetterRoleForMember (guest → admin)
//   - mail naar de afzender na accepteren
// In v2 is "guest" → "member"; een upgrade gaat van member naar admin, nooit
// terug. De weigeringen (ander adres, onbekend, verlopen, beantwoord, groep
// weg, uitnodiger geen admin, zonder groep) staan in acceptDeclineById.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, membership, newT } from "../groups/_beheer";
import { inviteRow, scheduledCount, secondGroup, seedInvite, world } from "./_wp19b";

const accept = api.invites.accept;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("invites.accept — lidmaatschap", () => {
  it("status accepted, respondedAt op het moment van accepteren, lid met de rol", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId, role: "member" });
    const before = Date.now();
    await as(t, "user_bob").mutation(accept, { inviteId: id });
    const row = await inviteRow(t, id);
    expect(row?.status).toBe("accepted");
    expect(row?.respondedAt).toBeGreaterThanOrEqual(before);
    expect((await membership(t, w.groupId, w.users.bob!))?.role).toBe("member");
  });

  it("upgrade: een bestaand lid wordt admin bij een admin-uitnodiging", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "lex@x.test", invitedBy: w.users.olga!, groupId: w.groupId, role: "admin" });
    await as(t, "user_lex").mutation(accept, { inviteId: id });
    expect((await membership(t, w.groupId, w.users.lex!))?.role).toBe("admin");
  });

  it("geen downgrade: een admin blijft admin bij een lid-uitnodiging", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "anna@x.test", invitedBy: w.users.olga!, groupId: w.groupId, role: "member" });
    await as(t, "user_anna").mutation(accept, { inviteId: id });
    expect((await membership(t, w.groupId, w.users.anna!))?.role).toBe("admin");
  });
});

describe("invites.accept — meer groepen (audit-8)", () => {
  it("uitnodigingen voor twee groepen: beide te accepteren", async () => {
    const t = newT();
    const w = await world(t);
    const g2 = await secondGroup(t, w);
    const a = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    const b = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: g2 });
    expect(await as(t, "user_bob").mutation(accept, { inviteId: a })).toEqual({ groupId: w.groupId });
    expect(await as(t, "user_bob").mutation(accept, { inviteId: b })).toEqual({ groupId: g2 });
    expect(await membership(t, w.groupId, w.users.bob!)).not.toBeNull();
    expect(await membership(t, g2, w.users.bob!)).not.toBeNull();
  });

  it("accepteren voor de ene groep laat de uitnodiging voor de andere ongemoeid", async () => {
    const t = newT();
    const w = await world(t);
    const g2 = await secondGroup(t, w);
    const a = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    const b = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: g2 });
    const bBefore = await inviteRow(t, b);
    await as(t, "user_bob").mutation(accept, { inviteId: a });
    expect(await inviteRow(t, b)).toEqual(bBefore);
    expect(await membership(t, g2, w.users.bob!)).toBeNull();
  });
});

describe("invites.accept — bijwerkingen", () => {
  it("plant de mail aan de afzender (best-effort, los van de mutation)", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    const before = await scheduledCount(t);
    await as(t, "user_bob").mutation(accept, { inviteId: id });
    expect(await scheduledCount(t)).toBe(before + 1);
    expect((await inviteRow(t, id))?.status).toBe("accepted");
  });
});
