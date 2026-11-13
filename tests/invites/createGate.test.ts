import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, expectRefused, goneGroupId, newT, seedGroup, type T } from "../groups/_beheer";

// WP28 besluit 6 (W6): alleen een admin nodigt uit voor een groep, zoals v1
// (sendInvite). Zonder deze gate nodigt een lid zijn tweede adres uit als
// admin en is daarna admin (spec kernvondst 5). Weigeringen volgen
// A-invariant 2: geen lid of onbekende groep = NOT_MEMBER, lid zonder
// admin-rol = NOT_ALLOWED. Een geweigerde uitnodiging bestaat niet.
// Een uitnodiging zonder groep valt buiten WP28 (WP19).

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function world(t: T) {
  return await seedGroup(t, {
    founder: "olga",
    members: { anna: "admin", lex: "member" },
    outsiders: ["eve"],
  });
}

async function inviteCount(t: T) {
  return await t.run(async (ctx) => (await ctx.db.query("invites").collect()).length);
}

describe("besluit 6 — alleen een admin nodigt uit voor een groep", () => {
  it("een admin nodigt uit, ook als admin", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_anna").mutation(api.invites.create, { name: "Genodigde",
      email: "nieuw@x.test",
      groupId: w.groupId,
      role: "admin",
    });
    expect(await inviteCount(t)).toBe(1);
  });

  it("een lid: NOT_ALLOWED, geen uitnodiging", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.invites.create, { name: "Genodigde", email: "nieuw@x.test", groupId: w.groupId }),
    );
    expect(await inviteCount(t)).toBe(0);
  });

  it("een lid nodigt ook geen admin uit (de escalatie): NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.invites.create, { name: "Genodigde",
        email: "lex-tweede@x.test",
        groupId: w.groupId,
        role: "admin",
      }),
    );
  });

  it("geen lid en onbekende groep: dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const gone = await goneGroupId(t);
    const a = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.invites.create, { name: "Genodigde", email: "nieuw@x.test", groupId: w.groupId }),
    );
    const b = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.invites.create, { name: "Genodigde", email: "nieuw@x.test", groupId: gone }),
    );
    expect(a).toEqual(b);
  });

  it("een admin die lid wordt gemaakt, verliest het recht: daarna NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_olga").mutation(api.groups.updateMemberRole, {
      groupId: w.groupId,
      userId: w.users.anna!,
      role: "member",
    });
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_anna").mutation(api.invites.create, { name: "Genodigde", email: "nieuw@x.test", groupId: w.groupId }),
    );
  });
});

describe("A-invariant 4 met besluit 6 — de uitnodiger moet bij accepteren nog admin zijn", () => {
  it("een admin nodigt uit en wordt daarna lid gemaakt: accepteren geeft geen lidmaatschap", async () => {
    const t = newT();
    const w = await world(t);
    const { inviteId } = await as(t, "user_anna").mutation(api.invites.create, { name: "Genodigde",
      email: "eve@x.test",
      groupId: w.groupId,
      role: "admin",
    });
    await as(t, "user_olga").mutation(api.groups.updateMemberRole, {
      groupId: w.groupId,
      userId: w.users.anna!,
      role: "member",
    });
    try {
      await as(t, "user_eve").mutation(api.invites.accept, { inviteId });
    } catch {
      // de fout zelf is vrij
    }
    const m = await t.run(async (ctx) =>
      ctx.db
        .query("memberships")
        .withIndex("by_user_and_group", (q) => q.eq("userId", w.users.eve!).eq("groupId", w.groupId))
        .unique(),
    );
    expect(m).toBeNull();
  });
});
