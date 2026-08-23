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

  test("elke tabel die de telling noemt is ook leeg te maken", async () => {
    // De twee lijsten mogen niet uit elkaar lopen: wat je kunt tellen moet je
    // kunnen resetten, anders is een schone start niet met de tool te bereiken.
    const t = convexTest(schema);
    const counts = await t.query(internal.migration.tableCounts, {});
    for (const table of Object.keys(counts.tables)) {
      await expect(
        t.mutation(internal.migration.clearTable, { table, limit: 1 }),
        `${table} wordt geteld maar niet gereset`,
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
