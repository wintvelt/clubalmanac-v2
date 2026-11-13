// invites.create — wat blijft na WP19b. De nieuwe regels (naam, bericht,
// e-mail, ALREADY_MEMBER/ALREADY_INVITED, altijd een groep, alleen het id
// terug) staan in createWp19b.test.ts; de admin-gate in createGate.test.ts;
// intrekken (alleen een admin) in listForGroup.test.ts.
//
// Bron v1: blob-images-api-groups/handlersGroup/sendInvite.js (geldig tot:
// blob-common expireDate, 14 dagen).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, newT } from "../groups/_beheer";
import { DAY_MS, inviteRow, scheduledCount, world } from "./_wp19b";

const create = api.invites.create;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("invites.create", () => {
  it("zonder auth: geweigerd", async () => {
    const t = newT();
    const w = await world(t);
    await expect(t.mutation(create, { name: "Nina", email: "nina@x.test", groupId: w.groupId })).rejects.toThrow();
  });

  it("geldig tot: 14 dagen na nu; createdAt is nu; invitedBy is de caller", async () => {
    const t = newT();
    const w = await world(t);
    const now = Date.now();
    const { inviteId } = await as(t, "user_olga").mutation(create, { name: "Nina", email: "nina@x.test", groupId: w.groupId });
    const row = await inviteRow(t, inviteId);
    expect(row?.expiresAt).toBe(now + 14 * DAY_MS);
    expect(row?.createdAt).toBe(now);
    expect(row?.invitedBy).toBe(w.users.olga);
    expect(row?.status).toBe("pending");
  });

  it("plant de uitnodigingsmail", async () => {
    const t = newT();
    const w = await world(t);
    const before = await scheduledCount(t);
    await as(t, "user_olga").mutation(create, { name: "Nina", email: "nina@x.test", groupId: w.groupId });
    expect(await scheduledCount(t)).toBe(before + 1);
  });

  it("een niet-lid van de groep: geweigerd", async () => {
    const t = newT();
    const w = await world(t);
    await expect(
      as(t, "user_eve").mutation(create, { name: "Nina", email: "nina@x.test", groupId: w.groupId }),
    ).rejects.toThrow();
  });
});
