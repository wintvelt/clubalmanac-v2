import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { MONITORED_FKS } from "../../convex/monitoring";
import { as, del, newT, postOk, request, seedWorld, useFinanceEnv, withTotals, type R, type T } from "./_settlements";

// WP41 §A9 en WP10 (MON1): `settlements.groupId` is een verplichte FK in de
// integriteitscheck. Twee kanten:
//   - een gewone levensloop (sturen, vervangen, weghalen, de groep verwijderen)
//     laat geen losse verwijzing achter: de check blijft schoon;
//   - een afrekening waarvan de groep buiten de wis-paden om weg is, meldt hij.
// De lijst zelf staat ook in tests/migration/fkOracle.ts.

useFinanceEnv();

const report = (t: T) => t.query(internal.migration.integrityReport, {});

describe("MON1: settlements.groupId", () => {
  it("staat als verplichte FK in MONITORED_FKS", () => {
    expect(MONITORED_FKS).toContainEqual({ table: "settlements", field: "groupId", required: true });
  });

  it("een gewone levensloop blijft schoon", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, request("lustrum"));
    await postOk(t, request("weekend"));
    const next = request("lustrum");
    next.rows = (next.rows as R[]).slice(0, 4);
    await postOk(t, withTotals(next));
    await del(t, "9");
    expect(await report(t)).toEqual([]);
    await as.bob(t).mutation(api.groups.remove, { groupId: w.groups.club });
    expect(await report(t)).toEqual([]);
  });

  it("een afrekening waarvan de groep weg is, wordt gemeld", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, request("lustrum"));
    await t.run(async (ctx) => {
      await ctx.db.delete(w.groups.club);
    });
    const lines = await report(t);
    expect(lines.some((l) => l.includes("settlements") && l.includes("groupId")), JSON.stringify(lines)).toBe(true);
  });
});
