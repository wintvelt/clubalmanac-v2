import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  as,
  expectRefused,
  expectRejectedNoChange,
  goneGroupId,
  goneUserId,
  groupRow,
  membership,
  newT,
  seedGroup,
  type T,
} from "./_beheer";

// WP28 — rol-gates op de groep (besluit 1 en 3), oprichter overdragen, en de
// weigeringen van A-invariant 2:
//   - geen lid, of een onbekende groep of een onbekend doel-lid: ConvexError
//     NOT_MEMBER, overal dezelfde (geen bestaans-orakel);
//   - wel lid, maar het mag niet: NOT_ALLOWED (rol ontbreekt) of
//     FOUNDER_PROTECTED (actie op de oprichter).
// Een geweigerde actie verandert niets.
//
// Wereld: oprichter Olga (admin), admin Anna, lid Lex, buitenstaander Eve.
// Spec: docs/work-packages/WP28-groepsbeheer.md.

async function world(t: T) {
  return await seedGroup(t, {
    founder: "olga",
    members: { anna: "admin", lex: "member" },
    outsiders: ["eve"],
  });
}

describe("besluit 1 — groep verwijderen: alleen de oprichter", () => {
  it("de oprichter verwijdert de groep", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_olga").mutation(api.groups.remove, { groupId: w.groupId });
    expect(await groupRow(t, w.groupId)).toBeNull();
  });

  it("een admin die geen oprichter is: NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_anna").mutation(api.groups.remove, { groupId: w.groupId }),
    );
  });

  it("een lid: NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.groups.remove, { groupId: w.groupId }),
    );
  });

  it("geen lid en onbekende groep: dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const a = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.groups.remove, { groupId: w.groupId }),
    );
    const gone = await goneGroupId(t);
    const b = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.groups.remove, { groupId: gone }),
    );
    expect(a).toEqual(b);
  });
});

describe("besluit 3 — de oprichter is beschermd", () => {
  it("een admin degradeert de oprichter niet: FOUNDER_PROTECTED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "FOUNDER_PROTECTED", () =>
      as(t, "user_anna").mutation(api.groups.updateMemberRole, {
        groupId: w.groupId,
        userId: w.users.olga!,
        role: "member",
      }),
    );
  });

  it("een admin verwijdert de oprichter niet: FOUNDER_PROTECTED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "FOUNDER_PROTECTED", () =>
      as(t, "user_anna").mutation(api.groups.removeMember, {
        groupId: w.groupId,
        userId: w.users.olga!,
      }),
    );
  });

  it("ook als er meer admins zijn dan de oprichter, blijft hij admin en lid", async () => {
    const t = newT();
    const w = await seedGroup(t, {
      founder: "olga",
      members: { anna: "admin", bert: "admin", lex: "member" },
    });
    for (const subject of ["user_anna", "user_bert"]) {
      await expectRejectedNoChange(t, () =>
        as(t, subject).mutation(api.groups.updateMemberRole, {
          groupId: w.groupId,
          userId: w.users.olga!,
          role: "member",
        }),
      );
      await expectRejectedNoChange(t, () =>
        as(t, subject).mutation(api.groups.removeMember, {
          groupId: w.groupId,
          userId: w.users.olga!,
        }),
      );
    }
    expect((await membership(t, w.groupId, w.users.olga!))?.role).toBe("admin");
    expect((await groupRow(t, w.groupId))?.createdBy).toBe(w.users.olga);
  });
});

describe("rol wijzigen en lid verwijderen: admin, bij een ander dan de oprichter", () => {
  it("een admin maakt een lid admin en weer lid", async () => {
    const t = newT();
    const w = await world(t);
    const args = { groupId: w.groupId, userId: w.users.lex! };
    await as(t, "user_anna").mutation(api.groups.updateMemberRole, { ...args, role: "admin" });
    expect((await membership(t, w.groupId, w.users.lex!))?.role).toBe("admin");
    await as(t, "user_anna").mutation(api.groups.updateMemberRole, { ...args, role: "member" });
    expect((await membership(t, w.groupId, w.users.lex!))?.role).toBe("member");
  });

  it("een admin verwijdert een andere admin die geen oprichter is", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_olga").mutation(api.groups.removeMember, {
      groupId: w.groupId,
      userId: w.users.anna!,
    });
    expect(await membership(t, w.groupId, w.users.anna!)).toBeNull();
  });

  it("een lid wijzigt geen rol: NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.groups.updateMemberRole, {
        groupId: w.groupId,
        userId: w.users.anna!,
        role: "member",
      }),
    );
  });

  it("een lid verwijdert geen ander: NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.groups.removeMember, {
        groupId: w.groupId,
        userId: w.users.anna!,
      }),
    );
  });

  it("geen lid en onbekende groep: dezelfde NOT_MEMBER, bij rol wijzigen en verwijderen", async () => {
    const t = newT();
    const w = await world(t);
    const gone = await goneGroupId(t);
    const outcomes = [];
    for (const groupId of [w.groupId, gone]) {
      outcomes.push(
        await expectRefused(t, "NOT_MEMBER", () =>
          as(t, "user_eve").mutation(api.groups.updateMemberRole, {
            groupId,
            userId: w.users.lex!,
            role: "admin",
          }),
        ),
      );
      outcomes.push(
        await expectRefused(t, "NOT_MEMBER", () =>
          as(t, "user_eve").mutation(api.groups.removeMember, { groupId, userId: w.users.lex! }),
        ),
      );
    }
    expect(new Set(outcomes.map((o) => JSON.stringify(o))).size).toBe(1);
  });

  it("een doel dat geen lid is en een doel dat niet bestaat: dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const ghost = await goneUserId(t);
    const outcomes = [];
    for (const userId of [w.users.eve!, ghost]) {
      outcomes.push(
        await expectRefused(t, "NOT_MEMBER", () =>
          as(t, "user_olga").mutation(api.groups.updateMemberRole, {
            groupId: w.groupId,
            userId,
            role: "admin",
          }),
        ),
      );
      outcomes.push(
        await expectRefused(t, "NOT_MEMBER", () =>
          as(t, "user_olga").mutation(api.groups.removeMember, { groupId: w.groupId, userId }),
        ),
      );
    }
    expect(new Set(outcomes.map((o) => JSON.stringify(o))).size).toBe(1);
  });
});

describe("groep verlaten door wie geen oprichter is (besluit 4 voor de oprichter wacht op regie)", () => {
  it("een lid vertrekt; de oprichter blijft oprichter en admin", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_lex").mutation(api.groups.removeMember, {
      groupId: w.groupId,
      userId: w.users.lex!,
    });
    expect(await membership(t, w.groupId, w.users.lex!)).toBeNull();
    expect((await groupRow(t, w.groupId))?.createdBy).toBe(w.users.olga);
    expect((await membership(t, w.groupId, w.users.olga!))?.role).toBe("admin");
  });

  it("een admin die geen oprichter is vertrekt; niemand krijgt er een rol bij", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_anna").mutation(api.groups.removeMember, {
      groupId: w.groupId,
      userId: w.users.anna!,
    });
    expect(await membership(t, w.groupId, w.users.anna!)).toBeNull();
    expect((await membership(t, w.groupId, w.users.lex!))?.role).toBe("member");
    expect((await groupRow(t, w.groupId))?.createdBy).toBe(w.users.olga);
  });
});

describe("oprichter overdragen (A-invariant 1, zoals v1)", () => {
  it("de oprichter draagt over aan een lid: dat lid wordt admin en oprichter, de oude oprichter blijft admin", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_olga").mutation(api.groups.transferFounder, {
      groupId: w.groupId,
      userId: w.users.lex!,
    });
    expect((await groupRow(t, w.groupId))?.createdBy).toBe(w.users.lex);
    expect((await membership(t, w.groupId, w.users.lex!))?.role).toBe("admin");
    expect((await membership(t, w.groupId, w.users.olga!))?.role).toBe("admin");
  });

  it("daarna is de nieuwe oprichter beschermd en de oude niet meer", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_olga").mutation(api.groups.transferFounder, {
      groupId: w.groupId,
      userId: w.users.anna!,
    });
    await expectRefused(t, "FOUNDER_PROTECTED", () =>
      as(t, "user_olga").mutation(api.groups.removeMember, {
        groupId: w.groupId,
        userId: w.users.anna!,
      }),
    );
    await as(t, "user_anna").mutation(api.groups.updateMemberRole, {
      groupId: w.groupId,
      userId: w.users.olga!,
      role: "member",
    });
    expect((await membership(t, w.groupId, w.users.olga!))?.role).toBe("member");
  });

  it("een admin die geen oprichter is, draagt niet over: NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_anna").mutation(api.groups.transferFounder, {
        groupId: w.groupId,
        userId: w.users.lex!,
      }),
    );
  });

  it("een lid draagt niet over: NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.groups.transferFounder, {
        groupId: w.groupId,
        userId: w.users.lex!,
      }),
    );
  });

  it("geen lid en onbekende groep: dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const gone = await goneGroupId(t);
    const a = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.groups.transferFounder, {
        groupId: w.groupId,
        userId: w.users.eve!,
      }),
    );
    const b = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.groups.transferFounder, { groupId: gone, userId: w.users.eve! }),
    );
    expect(a).toEqual(b);
  });

  it("naar iemand die geen lid is, of niet bestaat: dezelfde NOT_MEMBER, oprichter blijft", async () => {
    const t = newT();
    const w = await world(t);
    const ghost = await goneUserId(t);
    const a = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_olga").mutation(api.groups.transferFounder, {
        groupId: w.groupId,
        userId: w.users.eve!,
      }),
    );
    const b = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_olga").mutation(api.groups.transferFounder, { groupId: w.groupId, userId: ghost }),
    );
    expect(a).toEqual(b);
    expect((await groupRow(t, w.groupId))?.createdBy).toBe(w.users.olga);
  });

  it("naar zichzelf: geweigerd, niets verandert", async () => {
    const t = newT();
    const w = await world(t);
    await expectRejectedNoChange(t, () =>
      as(t, "user_olga").mutation(api.groups.transferFounder, {
        groupId: w.groupId,
        userId: w.users.olga!,
      }),
    );
  });

  it("twee keer na elkaar door de oude oprichter: de tweede wordt geweigerd", async () => {
    const t = newT();
    const w = await world(t);
    await as(t, "user_olga").mutation(api.groups.transferFounder, {
      groupId: w.groupId,
      userId: w.users.anna!,
    });
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_olga").mutation(api.groups.transferFounder, {
        groupId: w.groupId,
        userId: w.users.lex!,
      }),
    );
    expect((await groupRow(t, w.groupId))?.createdBy).toBe(w.users.anna);
  });
});

describe("groep wijzigen: weigeringen met code (A-invariant 2)", () => {
  it("een lid wijzigt de groep niet: NOT_ALLOWED", async () => {
    const t = newT();
    const w = await world(t);
    await expectRefused(t, "NOT_ALLOWED", () =>
      as(t, "user_lex").mutation(api.groups.update, { groupId: w.groupId, name: "Nieuw" }),
    );
  });

  it("geen lid en onbekende groep: dezelfde NOT_MEMBER", async () => {
    const t = newT();
    const w = await world(t);
    const gone = await goneGroupId(t);
    const a = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.groups.update, { groupId: w.groupId, name: "X" }),
    );
    const b = await expectRefused(t, "NOT_MEMBER", () =>
      as(t, "user_eve").mutation(api.groups.update, { groupId: gone, name: "X" }),
    );
    expect(a).toEqual(b);
  });
});
