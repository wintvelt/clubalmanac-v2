// WP12 fix-cyclus 1 — RED tests op convex/migration.ts.
//
// De migratie-functies waren tot nu toe ongedekt (audit B-3), en juist daar zat
// B-2: de tabellenset waarop de tooling werkt liep uit elkaar met de set die
// WP10's integriteitsscan bewaakt. Gevolg: de preconditie "alle doeltabellen
// leeg" ziet achtergebleven rijen niet, en `reset` kan ze niet weghalen. Na een
// reset plus seed wijzen die rijen naar verwijderde users en meldt de dagelijkse
// integriteitscheck dangling FK's — precies de "geen drift"-eis uit §Acceptance
// die dan niet haalbaar is zonder handwerk buiten de tool om.
//
// De dev-deployment heeft die rijen aantoonbaar: tests/integration/uploads/
// uploadRoundtrip.test.ts schrijft ze.

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { MONITORED_TABLE_ORACLE } from "./fkOracle";

const NOW = Date.parse("2026-08-23T00:00:00.000Z");

/** Eén user met één foto en één achtergebleven upload-reservering. */
async function seedUploadLeftovers(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["x"], { type: "image/jpeg" }));
    const userId = await ctx.db.insert("users", {
      subject: "user_seed",
      email: "seed@clubalmanac.test",
      name: "Seed",
      photoCount: 1,
      photoLimit: 1000,
      createdAt: NOW,
    });
    const photoId = await ctx.db.insert("photos", {
      ownerId: userId,
      storageId,
      ratingCount: 0,
      createdAt: NOW,
    });
    await ctx.db.insert("uploadIdempotency", {
      ownerId: userId,
      clientUploadId: "upload-1",
      status: "completed",
      photoId,
      createdAt: NOW,
      completedAt: NOW,
    });
    return { userId, photoId, storageId };
  });
}

describe("migratie-tabellen = de tabellen die WP10 bewaakt", () => {
  test("de leeg-telling ziet achtergebleven uploadIdempotency-rijen", async () => {
    const t = convexTest(schema);
    await seedUploadLeftovers(t);

    const counts = await t.query(internal.migration.tableCounts, {});
    // Zonder deze telling kan `load-records` zijn preconditie niet waarmaken:
    // "alle doeltabellen leeg" is dan een uitspraak over een deelverzameling.
    expect(counts.tables.uploadIdempotency).toBe(1);
  });

  test("reset kan uploadIdempotency leegmaken", async () => {
    const t = convexTest(schema);
    await seedUploadLeftovers(t);

    const result = await t.mutation(internal.migration.clearTable, {
      table: "uploadIdempotency",
      limit: 100,
    });
    expect(result.deleted).toBe(1);
    expect(result.remaining).toBe(false);
    const counts = await t.query(internal.migration.tableCounts, {});
    expect(counts.tables.uploadIdempotency).toBe(0);
  });

  test("elke tabel die WP10 bewaakt wordt geteld", async () => {
    // Fix-cyclus 2, R2-3. Deze lus liep eerst over `Object.keys(counts.tables)`
    // — en die sleutels kómen uit de lijst die de test moest controleren.
    // Verdween daar een tabel, dan kromp de vraag mee met het antwoord. De
    // verwachting komt nu uit de handmatige oracle.
    const t = convexTest(schema);
    const counts = await t.query(internal.migration.tableCounts, {});
    for (const table of MONITORED_TABLE_ORACLE) {
      expect(counts.tables[table], `${table} wordt bewaakt maar niet geteld`).toBeDefined();
    }
  });

  test("elke tabel die WP10 bewaakt is ook leeg te maken", async () => {
    // Wat je kunt tellen moet je kunnen resetten, anders is een schone start
    // niet met de tool te bereiken.
    const t = convexTest(schema);
    for (const table of MONITORED_TABLE_ORACLE) {
      await expect(
        t.mutation(internal.migration.clearTable, { table, limit: 1 }),
        `${table} wordt bewaakt maar niet gereset`,
      ).resolves.toBeDefined();
    }
  });

  test("een tabel buiten de migratie-set wordt geweigerd", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(internal.migration.clearTable, { table: "monitoringRuns", limit: 1 }),
    ).rejects.toThrow();
  });
});

describe("de bouwstenen van load-records", () => {
  test("insertRows schrijft de rij en geeft het gemunte _id terug", async () => {
    const t = convexTest(schema);
    const inserted = await t.mutation(internal.migration.insertRows, {
      table: "users",
      rows: [
        {
          sourceKey: "U-1",
          doc: {
            subject: "user_1",
            email: "een@clubalmanac.test",
            name: "Een",
            photoCount: 0,
            photoLimit: 1000,
            createdAt: NOW,
          },
        },
      ],
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.sourceKey).toBe("U-1");

    const doc = await t.run(async (ctx) => ctx.db.get(inserted[0]!.id as Id<"users">));
    expect(doc?.email).toBe("een@clubalmanac.test");
  });

  test("patchRefs vult een vooruit-verwijzing in", async () => {
    // groups.coverPhotoId wijst vooruit naar photos, terwijl photos via ownerId
    // terugwijst naar users. Die cirkel is niet in één pass te schrijven.
    const t = convexTest(schema);
    const { userId, photoId } = await seedUploadLeftovers(t);
    const groupId = await t.run(async (ctx) =>
      ctx.db.insert("groups", { name: "Groep", createdBy: userId, createdAt: NOW }),
    );

    const patched = await t.mutation(internal.migration.patchRefs, {
      table: "groups",
      patches: [{ id: groupId, field: "coverPhotoId", value: photoId }],
    });
    expect(patched).toBe(1);
    const group = await t.run(async (ctx) => ctx.db.get(groupId));
    expect(group?.coverPhotoId).toBe(photoId);
  });

  test("storageInventory ziet een object dat aan geen enkel record hangt", async () => {
    const t = convexTest(schema);
    await seedUploadLeftovers(t);
    await t.run(async (ctx) => {
      await ctx.storage.store(new Blob(["wees"], { type: "image/jpeg" }));
    });

    const inventory = await t.query(internal.migration.storageInventory, {});
    expect(inventory.storageObjects).toBe(2);
    expect(inventory.referencedByRecords).toBe(1);
    expect(inventory.orphanCount).toBe(1);
    expect(inventory.danglingCount).toBe(0);
  });

  test("een opgegeven storage-object gaat weg, de rest blijft staan", async () => {
    // Fix-cyclus 2, R2-5. De bouwsteen onder `prune-storage`: exact deze
    // objecten, geen "alles". Zonder deze knop is de enige route naar "geen
    // storage-orphans" een reset van de complete storage — en dat kost op T-0
    // de uren upload die het gefaseerde ontwerp juist moest sparen.
    const t = convexTest(schema);
    const { storageId } = await seedUploadLeftovers(t);
    const wees = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["wees"], { type: "image/jpeg" })),
    );

    const result = await t.mutation(internal.migration.deleteStorageObjects, { ids: [wees] });
    expect(result.deleted).toBe(1);

    const inventory = await t.query(internal.migration.storageInventory, {});
    expect(inventory.storageObjects).toBe(1);
    expect(inventory.orphanCount).toBe(0);
    expect(inventory.danglingCount, "het bestand van een foto is meegegaan").toBe(0);
    const stillThere = await t.run(async (ctx) => ctx.storage.getUrl(storageId));
    expect(stillThere).not.toBeNull();
  });

  test("storageInventory kan de volledige orphan-lijst geven, niet alleen een greep", async () => {
    // De operator moet vóór het opruimen kunnen zien wat er weggaat.
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      for (let i = 0; i < 12; i++) {
        await ctx.storage.store(new Blob([`wees-${i}`], { type: "image/jpeg" }));
      }
    });
    const inventory = await t.query(internal.migration.storageInventory, { sampleSize: 1000 });
    expect(inventory.orphanCount).toBe(12);
    expect(inventory.orphanSample).toHaveLength(12);
  });

  test("integrityReport meldt dezelfde drift die WP10 zou mailen", async () => {
    const t = convexTest(schema);
    const { userId } = await seedUploadLeftovers(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { photoCount: 7 });
    });

    const lines = await t.query(internal.migration.integrityReport, {});
    expect(lines.some((line) => /photoCount/i.test(line))).toBe(true);
  });
});
