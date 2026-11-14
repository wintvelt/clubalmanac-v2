import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, expectRefused, newT } from "../groups/_beheer";
import { allInvites, DAY_MS, inviteRow, secondGroup, seedInvite, world } from "./_wp19b";

// WP19b A-invariant 5, 8, 10 en 16 (besluit 2, V1): uitnodigen met naam,
// e-mail, groep, en optioneel rol en bericht.
// - `create` geeft alleen `{ inviteId }` terug, geen token (A-invariant 5).
// - Altijd een groep (A-keuze 1).
// - Naam: de regel van een groepsnaam; bericht: getrimd, leeg = geen, max
//   1000 tekens (`MESSAGE_TOO_LONG`); e-mail: `EMAIL_INVALID`.
// - `ALREADY_MEMBER` / `ALREADY_INVITED` dragen het genormaliseerde adres.
// - De volgorde van de gates: eerst admin (WP28), dan pas lid of dubbel.

const create = api.invites.create;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("A-invariant 5 en 10 — een uitnodiging maken", () => {
  it("geeft alleen het id; de rij heeft naam, bericht, genormaliseerd adres, groep en rol", async () => {
    const t = newT();
    const w = await world(t);
    const res = await as(t, "user_anna").mutation(create, {
      email: "  Nina@X.test ",
      name: "  Nina  ",
      groupId: w.groupId,
      role: "admin",
      message: "  Welkom!  ",
    });
    expect(Object.keys(res)).toEqual(["inviteId"]);
    const row = await inviteRow(t, (res as { inviteId: Id<"invites"> }).inviteId);
    expect(row).toMatchObject({
      email: "nina@x.test",
      name: "Nina",
      message: "Welkom!",
      groupId: w.groupId,
      role: "admin",
      status: "pending",
      invitedBy: w.users.anna,
    });
  });

  it("zonder rol: lid", async () => {
    const t = newT();
    const w = await world(t);
    const { inviteId } = await as(t, "user_olga").mutation(create, { email: "nina@x.test", name: "Nina", groupId: w.groupId });
    expect((await inviteRow(t, inviteId))?.role).toBe("member");
  });

  it("een leeg bericht (alleen spaties) telt als geen bericht", async () => {
    const t = newT();
    const w = await world(t);
    const { inviteId } = await as(t, "user_olga").mutation(create, {
      email: "nina@x.test",
      name: "Nina",
      groupId: w.groupId,
      message: "   ",
    });
    expect(await inviteRow(t, inviteId)).not.toHaveProperty("message");
  });

  it("een bericht van 1000 tekens mag; 1001 geeft MESSAGE_TOO_LONG", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_olga").mutation(create, { email: "a@x.test", name: "A", groupId: w.groupId, message: "x".repeat(1000) });
    await expectRefused(t, "MESSAGE_TOO_LONG", () =>
      as(t, "user_olga").mutation(create, { email: "b@x.test", name: "B", groupId: w.groupId, message: "x".repeat(1001) }),
    );
  });

  it("zonder groep: geweigerd, geen uitnodiging (A-keuze 1)", async () => {
    const t = newT();
    await world(t);
    const withoutGroup = { email: "nina@x.test", name: "Nina" } as unknown as {
      email: string;
      name: string;
      groupId: Id<"groups">;
    };
    await expect(as(t, "user_olga").mutation(create, withoutGroup)).rejects.toThrow();
    expect(await allInvites(t)).toHaveLength(0);
  });
});

describe("A-invariant 10 — naam", () => {
  for (const [label, name, code] of [
    ["leeg", "   ", "NAME_REQUIRED"],
    ["te lang", "n".repeat(200), "NAME_TOO_LONG"],
    ["onzichtbaar teken", "Ni​na", "NAME_INVALID"],
  ] as const) {
    it(`${label}: ${code}`, async () => {
      const t = newT();
      const w = await world(t);
      await expectRefused(t, code, () =>
        as(t, "user_olga").mutation(create, { email: "nina@x.test", name, groupId: w.groupId }),
      );
    });
  }
});

describe("A-invariant 10 — e-mailadres", () => {
  for (const email of ["", "   ", "geen-at", "a@", "@x.test", "a b@x.test", "a@@x.test"]) {
    it(`"${email}": EMAIL_INVALID`, async () => {
      const t = newT();
      const w = await world(t);
      await expectRefused(t, "EMAIL_INVALID", () =>
        as(t, "user_olga").mutation(create, { email, name: "Nina", groupId: w.groupId }),
      );
    });
  }
});

describe("A-invariant 8 en 10 — al lid of al uitgenodigd, met het adres", () => {
  it("een bestaand lid: ALREADY_MEMBER met het genormaliseerde adres", async () => {
    const t = newT();
    const w = await world(t);
    const data = await expectRefused(t, "ALREADY_MEMBER", () =>
      as(t, "user_olga").mutation(create, { email: " LEX@x.test ", name: "Lex", groupId: w.groupId }),
    );
    expect(data).toEqual({ code: "ALREADY_MEMBER", email: "lex@x.test" });
  });

  it("al een open uitnodiging voor die groep: ALREADY_INVITED met het adres", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_olga").mutation(create, { email: "nina@x.test", name: "Nina", groupId: w.groupId });
    const data = await expectRefused(t, "ALREADY_INVITED", () =>
      as(t, "user_anna").mutation(create, { email: "NINA@x.test", name: "Nina", groupId: w.groupId }),
    );
    expect(data).toEqual({ code: "ALREADY_INVITED", email: "nina@x.test" });
  });

  it("een verlopen uitnodiging blokkeert niet; een open voor een andere groep ook niet", async () => {
    const t = newT();
    const w = await world(t);
    const g2 = await secondGroup(t, w);
    await seedInvite(t, { email: "nina@x.test", invitedBy: w.users.olga!, groupId: w.groupId, expiresAt: Date.now() - DAY_MS });
    await seedInvite(t, { email: "nina@x.test", invitedBy: w.users.olga!, groupId: g2 });
    await as(t, "user_olga").mutation(create, { email: "nina@x.test", name: "Nina", groupId: w.groupId });
    expect(await allInvites(t)).toHaveLength(3);
  });

  it("een gewoon lid dat een bestaand lid uitnodigt: NOT_ALLOWED, niet ALREADY_MEMBER (geen orakel)", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(create, { email: "anna@x.test", name: "Anna", groupId: w.groupId }),
    );
  });
});
