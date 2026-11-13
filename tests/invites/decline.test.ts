// invites.decline — wat blijft na WP19b (afwijzen op id, A-invariant 7).
//
// Bron v1: blob-images-api-invites/handlersInvite/publicDeclineInvite.js
// (status, mail aan de afzender). De weigeringen staan in
// acceptDeclineById.test.ts; hier het gelukte pad en de bijwerkingen.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, membership, newT } from "../groups/_beheer";
import { inviteRow, scheduledCount, seedInvite, world } from "./_wp19b";

const decline = api.invites.decline;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("invites.decline", () => {
  it("status declined + respondedAt; geen lidmaatschap", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    const before = Date.now();
    await as(t, "user_bob").mutation(decline, { inviteId: id });
    const row = await inviteRow(t, id);
    expect(row?.status).toBe("declined");
    expect(row?.respondedAt).toBeGreaterThanOrEqual(before);
    expect(await membership(t, w.groupId, w.users.bob!)).toBeNull();
  });

  it("plant de mail aan de afzender", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    const before = await scheduledCount(t);
    await as(t, "user_bob").mutation(decline, { inviteId: id });
    expect(await scheduledCount(t)).toBe(before + 1);
  });

  it("nog eens afwijzen: geen tweede mail", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    await as(t, "user_bob").mutation(decline, { inviteId: id });
    const after = await scheduledCount(t);
    await as(t, "user_bob").mutation(decline, { inviteId: id });
    expect(await scheduledCount(t)).toBe(after);
  });

  it("anoniem: geweigerd, niets verandert", async () => {
    const t = newT();
    const w = await world(t);
    const id = await seedInvite(t, { email: "bob@x.test", invitedBy: w.users.olga!, groupId: w.groupId });
    await expect(t.mutation(decline, { inviteId: id })).rejects.toThrow();
    expect((await inviteRow(t, id))?.status).toBe("pending");
  });
});
