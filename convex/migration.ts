import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { collectDriftLines } from "./monitoring";

// WP12 — migratie-only Convex-functies (data-import vanuit AWS).
//
// Zie docs/work-packages/WP12-data-migratie-tooling.md §Migratiecode in convex/.
// Aangeroepen door scripts/migrate/* met een admin-key; nooit door een client.
//
// Afspraken (Wouter, 2026-08-23):
//   - Alles in dit ene bestand. Niets verspreid over de domein-modules.
//   - Uitsluitend internalMutation / internalQuery: zonder deploy key niet
//     aanroepbaar, dus geen auth-check-omweg die een user kan bereiken.
//   - **Weg na T+30**, samen met de rest van de cutover-opruiming. Staat als
//     stap in het fase 5-stappenplan in docs/migratie-status.md.
//
// Deze functies omzeilen bewust de normale auth-checks (requireWebmaster e.d.)
// én de aggregate-onderhoudende mutations: de aggregates (`users.photoCount`,
// `photos.rating*`, `features.upvoteCount`) worden door de transform berekend
// en hier één-op-één weggeschreven. Zou de import via de gewone mutations
// lopen, dan zou elke insert de tellers opnieuw bijwerken en zouden ze twee
// keer geteld worden.

/** De tabellen die de import zelf vult, in laad-volgorde. */
const LOAD_TABLES = [
  "users",
  "groups",
  "memberships",
  "albums",
  "photos",
  "albumPhotos",
  "ratings",
  "invites",
  "features",
  "featureUpvotes",
  "albumLastSeen",
] as const;

/**
 * De volledige set die de tooling telt en leegmaakt: de laad-tabellen plus élke
 * andere tabel waarop WP10's `integrityCheck` een controle doet (WP12
 * fix-cyclus 1, B-2).
 *
 * `uploadIdempotency` staat er daarom bij. WP10 controleert er twee FK's op
 * (`ownerId` verplicht, `photoId` optioneel). Zat de tabel hier niet in, dan
 * zou de preconditie "alle doel-tabellen leeg" een uitspraak over een
 * deelverzameling zijn en zou `reset` de rijen niet weg kunnen halen — waarna
 * hun `ownerId`'s na een seed naar verwijderde users wijzen en de dagelijkse
 * scan dangling FK's meldt. De dev-deployment heeft zulke rijen aantoonbaar:
 * tests/integration/uploads/uploadRoundtrip.test.ts schrijft ze.
 *
 * De import vult de tabel nooit: hij hoort bij de upload-flow, niet bij de
 * brondata. Tellen en leegmaken wél, invoegen niet — vandaar twee lijsten met
 * één insluiting, niet twee lijsten die uit elkaar kunnen lopen.
 */
const MIGRATION_TABLES = [...LOAD_TABLES, "uploadIdempotency"] as const;

type LoadTable = (typeof LOAD_TABLES)[number];
type MigrationTable = (typeof MIGRATION_TABLES)[number];

function assertMigrationTable(table: string): MigrationTable {
  if (!(MIGRATION_TABLES as readonly string[]).includes(table)) {
    throw new Error(
      `[migration] '${table}' is geen migratie-tabel. Toegestaan: ${MIGRATION_TABLES.join(", ")}`,
    );
  }
  return table as MigrationTable;
}

function assertLoadTable(table: string): LoadTable {
  if (!(LOAD_TABLES as readonly string[]).includes(table)) {
    throw new Error(
      `[migration] '${table}' wordt niet door de import gevuld. Toegestaan: ${LOAD_TABLES.join(", ")}`,
    );
  }
  return table as LoadTable;
}

// ── load-records ──────────────────────────────────────────────────────

/**
 * Batch-insert. De rijen komen kant-en-klaar binnen: FK's zijn al vervangen
 * door echte Convex-`_id`s en storage-sleutels door `_storage`-ids (dat doet
 * het script met zijn ID-map). Retourneert per rij het gemunte `_id`, zodat de
 * ID-map van de volgende laadstap gevuld kan worden.
 */
export const insertRows = internalMutation({
  args: {
    table: v.string(),
    rows: v.array(v.object({ sourceKey: v.string(), doc: v.any() })),
  },
  returns: v.array(v.object({ sourceKey: v.string(), id: v.string() })),
  handler: async (ctx, { table, rows }) => {
    const name = assertLoadTable(table);
    const out: Array<{ sourceKey: string; id: string }> = [];
    for (const row of rows) {
      const id = await ctx.db.insert(name, row.doc as Doc<LoadTable>);
      out.push({ sourceKey: row.sourceKey, id });
    }
    return out;
  },
});

/**
 * Tweede pass voor vooruit-verwijzingen (`groups.coverPhotoId`,
 * `albums.coverPhotoId`). Die kunnen niet in de eerste pass mee: groups en
 * albums verwijzen vooruit naar photos, terwijl photos via `ownerId` terug naar
 * users verwijst. Die cirkel is niet in één pass te schrijven.
 */
export const patchRefs = internalMutation({
  args: {
    table: v.string(),
    patches: v.array(v.object({ id: v.string(), field: v.string(), value: v.string() })),
  },
  returns: v.number(),
  handler: async (ctx, { table, patches }) => {
    const name = assertLoadTable(table);
    for (const patch of patches) {
      const doc = await ctx.db.get(patch.id as Id<LoadTable>);
      if (doc === null) {
        throw new Error(`[migration] patchRefs: ${name}/${patch.id} bestaat niet`);
      }
      await ctx.db.patch(patch.id as Id<LoadTable>, {
        [patch.field]: patch.value,
      } as Partial<Doc<LoadTable>>);
    }
    return patches.length;
  },
});

// ── preconditie + verify ──────────────────────────────────────────────

/**
 * Rij-aantallen per migratie-tabel plus het aantal storage-objecten.
 * `load-records` gebruikt dit als preconditie ("alle doel-tabellen leeg",
 * vóór de eerste schrijf gecontroleerd), `verify` als telling achteraf.
 */
export const tableCounts = internalQuery({
  args: {},
  returns: v.object({
    tables: v.record(v.string(), v.number()),
    storageObjects: v.number(),
  }),
  handler: async (ctx) => {
    const tables: Record<string, number> = {};
    for (const name of MIGRATION_TABLES) {
      tables[name] = (await ctx.db.query(name).collect()).length;
    }
    const storage = await ctx.db.system.query("_storage").collect();
    return { tables, storageObjects: storage.length };
  },
});

/**
 * Reconciliatie van storage, twee kanten op (WP12 §Toegevoegde invarianten):
 * elke `storageId` in een record moet bestaan, én elk object in `_storage` moet
 * aan minstens één record gekoppeld zijn. Dat laatste is exact de check die
 * WP10 dagelijks draait — beter 'm op T-0 al zien dan de volgende ochtend per
 * mail.
 */
export const storageInventory = internalQuery({
  args: { sampleSize: v.optional(v.number()) },
  returns: v.object({
    storageObjects: v.number(),
    referencedByRecords: v.number(),
    orphanCount: v.number(),
    orphanSample: v.array(v.string()),
    danglingCount: v.number(),
    danglingSample: v.array(v.string()),
    totalBytes: v.number(),
  }),
  handler: async (ctx, { sampleSize }) => {
    const sample = sampleSize ?? 10;
    const photos = await ctx.db.query("photos").collect();
    const users = await ctx.db.query("users").collect();

    const referenced = new Set<string>();
    for (const p of photos) referenced.add(p.storageId);
    for (const u of users) {
      if (u.profilePhotoStorageId) referenced.add(u.profilePhotoStorageId);
    }

    const storageDocs = await ctx.db.system.query("_storage").collect();
    const present = new Set(storageDocs.map((s) => s._id as string));
    const orphans = storageDocs.filter((s) => !referenced.has(s._id)).map((s) => s._id as string);
    const dangling = [...referenced].filter((id) => !present.has(id));

    return {
      storageObjects: storageDocs.length,
      referencedByRecords: referenced.size,
      orphanCount: orphans.length,
      orphanSample: orphans.slice(0, sample),
      danglingCount: dangling.length,
      danglingSample: dangling.slice(0, sample),
      totalBytes: storageDocs.reduce((sum, s) => sum + s.size, 0),
    };
  },
});

/**
 * Read-only variant van WP10's `internal.monitoring.integrityCheck`: dezelfde
 * scan, maar zonder monitoringRuns-rij en zonder drift-mail. `verify` draait
 * hem op T-0 zodat de uitkomst meteen in de terminal staat.
 */
export const integrityReport = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => collectDriftLines(ctx),
});

// ── load-files ────────────────────────────────────────────────────────

/**
 * Batch upload-URL's. Eén call per bestand zou over 1650+ objecten een
 * onnodige round-trip-berg opleveren; te grote batches lopen tegen de
 * geldigheidsduur van een URL aan, wat over een lijn van <20 Mbit/s meetelt.
 * Het script kiest de batchgrootte.
 */
export const generateUploadUrls = internalMutation({
  args: { count: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, { count }) => {
    if (count < 1 || count > 50) {
      throw new Error(`[migration] generateUploadUrls: count moet 1..50 zijn, kreeg ${count}`);
    }
    const urls: string[] = [];
    for (let i = 0; i < count; i++) {
      urls.push(await ctx.storage.generateUploadUrl());
    }
    return urls;
  },
});

// ── reset ─────────────────────────────────────────────────────────────

/**
 * Leegt één tabel in batches van maximaal `limit` rijen. Het script blijft
 * aanroepen tot `remaining` false is — één mutation die alles wist zou bij
 * prod-volume tegen de transactielimiet lopen.
 */
export const clearTable = internalMutation({
  args: { table: v.string(), limit: v.number() },
  returns: v.object({ deleted: v.number(), remaining: v.boolean() }),
  handler: async (ctx, { table, limit }) => {
    const name = assertMigrationTable(table);
    const docs = await ctx.db.query(name).take(limit);
    for (const doc of docs) {
      await ctx.db.delete(doc._id as Id<TableNames>);
    }
    const next = await ctx.db.query(name).take(1);
    return { deleted: docs.length, remaining: next.length > 0 };
  },
});

/**
 * Leegt de file-storage in batches. Alleen voor `reset --all`. Het script maakt
 * `storage-map.json` in dezelfde beweging ongeldig: blijft die staan, dan
 * verwijst een volgende `load-records` naar storage-ID's die niet meer bestaan
 * — een stille corruptie-route.
 */
export const clearStorage = internalMutation({
  args: { limit: v.number() },
  returns: v.object({ deleted: v.number(), remaining: v.boolean() }),
  handler: async (ctx, { limit }) => {
    const docs = await ctx.db.system.query("_storage").take(limit);
    for (const doc of docs) {
      await ctx.storage.delete(doc._id);
    }
    const next = await ctx.db.system.query("_storage").take(1);
    return { deleted: docs.length, remaining: next.length > 0 };
  },
});
