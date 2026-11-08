import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, newT, seedGroup, type T } from "../groups/_beheer";

// WP28 fix-cyclus 1, A-invariant 9 (red-team R2): de landing (anoniem, op
// token) toont de groep alleen bij een open, niet verlopen uitnodiging. Bij
// geaccepteerd, afgewezen of verlopen is `group` null; status, adres en
// uitnodiger blijven. Zo volgt een ex-lid de groep niet met zijn oude token.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const DAY = 24 * 60 * 60 * 1000;

async function seedInvite(
  t: T,
  args: { groupId: Id<"groups">; invitedBy: Id<"users">; status: "pending" | "accepted" | "declined" | "expired"; expiresAt?: number },
): Promise<string> {
  const token = crypto.randomUUID();
  await t.run(async (ctx) =>
    ctx.db.insert("invites", {
      email: "gast@x.test",
      invitedBy: args.invitedBy,
      groupId: args.groupId,
      role: "member",
      token,
      status: args.status,
      expiresAt: args.expiresAt ?? Date.now() + 14 * DAY,
      createdAt: Date.now(),
    }),
  );
  return token;
}

const landing = (t: T, token: string) => t.query(api.invites.getByToken, { token });

describe("A-invariant 9 — de groep alleen bij een open uitnodiging", () => {
  it("open en geldig: de groep staat erin (controle)", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga" });
    const token = await seedInvite(t, { groupId: w.groupId, invitedBy: w.users.olga!, status: "pending" });
    expect((await landing(t, token))?.group?.name).toBe("Club");
  });

  it.each(["accepted", "declined", "expired"] as const)("status %s: group is null, de status blijft", async (status) => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga" });
    const token = await seedInvite(t, { groupId: w.groupId, invitedBy: w.users.olga!, status });
    const got = await landing(t, token);
    expect(got?.status).toBe(status);
    expect(got?.group).toBeNull();
    expect(got?.inviter?._id).toBe(w.users.olga);
  });

  it("open maar over de vervaldatum: group is null", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga" });
    const token = await seedInvite(t, {
      groupId: w.groupId,
      invitedBy: w.users.olga!,
      status: "pending",
      expiresAt: Date.now() - 1000,
    });
    const got = await landing(t, token);
    expect(got?.isExpired).toBe(true);
    expect(got?.group).toBeNull();
  });

  it("het red-team-scenario: een ex-lid ziet met zijn oude token de nieuwe naam niet", async () => {
    const t = newT();
    const w = await seedGroup(t, { founder: "olga" });
    const { token } = await as(t, "user_olga").mutation(api.invites.create, {
      email: "rex@x.test",
      groupId: w.groupId,
    });
    const rex = await t.mutation(internal.users.registerFromSession, { subject: "user_rex", email: "rex@x.test" });
    await as(t, "user_olga").mutation(api.groups.removeMember, { groupId: w.groupId, userId: rex });
    await as(t, "user_olga").mutation(api.groups.update, {
      groupId: w.groupId,
      name: "Nieuwe naam",
      description: "Na zijn vertrek",
    });

    const got = await landing(t, token);
    expect(got?.group).toBeNull();
    expect(JSON.stringify(got)).not.toContain("Nieuwe naam");
    expect(JSON.stringify(got)).not.toContain("Na zijn vertrek");
  });
});
