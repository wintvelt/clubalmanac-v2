// api.invites.listMine — eigen verstuurde uitnodigingen (afzender).
//
// WP19b: `getByToken` (de anonieme landing) bestaat niet meer (A-invariant 5,
// tests/invites/inventory.test.ts); de genodigde ziet zijn uitnodigingen via
// listReceived (tests/invites/listReceived.test.ts). De vorm van listMine
// staat in tests/readWhitelist/invites.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, newT } from "../groups/_beheer";
import { seedInvite, world } from "./_wp19b";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("invites.listMine — afzender", () => {
  it("alleen de uitnodigingen die de caller stuurde", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_olga").mutation(api.invites.create, { name: "X", email: "x@x.test", groupId: w.groupId });
    await as(t, "user_anna").mutation(api.invites.create, { name: "Y", email: "y@x.test", groupId: w.groupId });
    const list = await as(t, "user_olga").query(api.invites.listMine, {});
    expect(list.map((i) => i.email)).toEqual(["x@x.test"]);
  });

  it("zonder auth: lege lijst (geen throw)", async () => {
    const t = newT();
    expect(await t.query(api.invites.listMine, {})).toEqual([]);
  });

  it("alle statussen (een geschiedenis, geen actielijst)", async () => {
    const t = newT();
    const w = await world(t);
    for (const status of ["pending", "accepted", "declined", "expired"] as const) {
      await seedInvite(t, { email: `${status}@x.test`, invitedBy: w.users.olga!, groupId: w.groupId, status });
    }
    const list = await as(t, "user_olga").query(api.invites.listMine, {});
    expect(list.map((i) => i.status).sort()).toEqual(["accepted", "declined", "expired", "pending"]);
  });
});
