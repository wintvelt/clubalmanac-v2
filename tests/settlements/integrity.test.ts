import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { MONITORED_FKS } from "../../convex/monitoring";
import { SCHOON, SCHOON_B } from "../_helpers/jpeg";
import {
  as,
  del,
  newT,
  postOk,
  request,
  rows,
  seedWorld,
  storageIds,
  useFinanceEnv,
  withImage,
  withTotals,
  type R,
  type T,
} from "./_settlements";

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

// --- WP41c: de foto is verwezen storage (spec §WP41c C1.1, C3) ------------------
//
// MON1 (`integrityReport`), `verify` en `prune-storage` (via
// `storageInventory`) delen één definitie van verwezen storage. Een foto van
// een afrekening hoort daarin: anders meldt MON1 hem elke nacht als wees en
// wist `prune-storage` hem. Een reset (`clearTable`) neemt de foto mee, zoals
// een foto-rij zijn formaten.

describe("WP41c: MON1 en de migratie-tooling kennen de foto", () => {
  it("een afrekening met foto: geen wees in MON1 en niet in storageInventory", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, withImage(request("lustrum"), SCHOON));
    expect(await storageIds(t)).toHaveLength(1);
    expect(await report(t)).toEqual([]);
    const inventory = await t.query(internal.migration.storageInventory, { sampleSize: 1000 });
    expect(inventory.orphanCount).toBe(0);
    expect(inventory.orphanSample).toEqual([]);
    expect(inventory.referencedByRecords).toBe(1);
    expect(inventory.danglingCount).toBe(0);
  });

  it("een levensloop met foto's (vervangen, zonder foto, weghalen, groep weg) blijft schoon", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await postOk(t, withImage(request("lustrum"), SCHOON));
    await postOk(t, withImage(request("weekend"), SCHOON));
    await postOk(t, withImage(request("lustrum"), SCHOON_B));
    expect(await report(t)).toEqual([]);
    await postOk(t, request("lustrum"));
    expect(await report(t)).toEqual([]);
    await del(t, "9");
    expect(await report(t)).toEqual([]);
    await postOk(t, withImage(request("weekend"), SCHOON));
    await as.bob(t).mutation(api.groups.remove, { groupId: w.groups.club });
    expect(await report(t)).toEqual([]);
    expect(await storageIds(t)).toEqual([]);
  });

  it("een foto die buiten de wis-paden om uit storage verdween, telt als dangling", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, withImage(request("lustrum"), SCHOON));
    const [id] = await storageIds(t);
    await t.run(async (ctx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ctx.storage.delete(id as any);
    });
    const inventory = await t.query(internal.migration.storageInventory, {});
    expect(inventory.danglingCount).toBe(1);
  });

  it("reset: clearTable('settlements') neemt de foto's mee", async () => {
    const t = newT();
    await seedWorld(t);
    await postOk(t, withImage(request("lustrum"), SCHOON));
    await postOk(t, withImage(request("weekend"), SCHOON_B));
    let remaining = true;
    while (remaining) {
      ({ remaining } = await t.mutation(internal.migration.clearTable, { table: "settlements", limit: 1 }));
    }
    expect(await rows(t)).toEqual([]);
    expect(await storageIds(t)).toEqual([]);
  });
});
