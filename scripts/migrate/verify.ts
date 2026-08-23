// WP12 — stap 6: `verify`. Klopt wat er in de deployment staat met wat we
// bedoelden te laden?
//
// Drie controles, en de derde is de reden dat dit commando bestaat:
//   1. Rij-aantallen per tabel = de rijen uit convex-records.json (na aftrek van
//      wat wegens een ontbrekend bestand is overgeslagen).
//   2. Storage twee kanten op: elke `storageId` in een record bestaat, én elk
//      object in `_storage` hangt aan minstens één record. Dat tweede is exact
//      wat WP10 dagelijks meldt — beter hier op T-0 zien dan de volgende
//      ochtend per mail.
//   3. De volledige WP10-integriteitsscan, read-only (geen monitoringRuns-rij,
//      geen drift-mail): aggregates, FK's, orphans.

import { internal } from "../../convex/_generated/api.js";
import type { Target } from "./config.ts";
import { makeAdminClient, runQuery } from "./convexAdmin.ts";
import { readStorageMap } from "./loadFiles.ts";
import { applyStorageMap } from "./loadRecords.ts";
import { RECORDS_FILE, readData } from "./paths.ts";
import { summarize } from "./runTransform.ts";
import type { RecordsFile } from "./runTransform.ts";
import { TABLE_ORDER } from "./types.ts";

export async function verify(target: Target): Promise<number> {
  const recordsFile = readData<RecordsFile>(RECORDS_FILE);
  const admin = makeAdminClient(target, false);
  const storageMap = readStorageMap(target, admin.url);
  const { records, dropped } = applyStorageMap(recordsFile.records, storageMap);

  console.log(`[verify] doel: ${target} (${admin.url})`);
  console.log(
    `[verify] bron: extract ${recordsFile.meta.source.extractedAt} (${recordsFile.meta.source.table} ` +
      `@ ${recordsFile.meta.source.region}), transform ${recordsFile.meta.transformedAt}`,
  );

  let problems = 0;

  // ── 1. rij-aantallen ────────────────────────────────────────────────
  const counts = await runQuery(admin, internal.migration.tableCounts, {});
  console.log(`\n[verify] rij-aantallen:`);
  for (const table of TABLE_ORDER) {
    const expected = records[table].length;
    const actual = counts.tables[table] ?? 0;
    const ok = expected === actual;
    if (!ok) problems += 1;
    console.log(`  ${ok ? "ok " : "FOUT"} ${table.padEnd(16)} verwacht ${expected}, gevonden ${actual}`);
  }

  // ── 2. storage, twee kanten op ──────────────────────────────────────
  const inventory = await runQuery(admin, internal.migration.storageInventory, {});
  console.log(
    `\n[verify] storage: ${inventory.storageObjects} objecten ` +
      `(${(inventory.totalBytes / 1_000_000).toFixed(1)} MB), ` +
      `${inventory.referencedByRecords} door records gebruikt`,
  );
  if (inventory.danglingCount > 0) {
    problems += 1;
    console.log(
      `  FOUT ${inventory.danglingCount} record(s) verwijzen naar een niet-bestaand bestand: ` +
        inventory.danglingSample.join(", "),
    );
  }
  if (inventory.orphanCount > 0) {
    problems += 1;
    console.log(
      `  FOUT ${inventory.orphanCount} storage-object(en) hangen aan geen enkel record: ` +
        `${inventory.orphanSample.join(", ")} — dit is precies wat WP10 dagelijks zou melden`,
    );
  }

  // ── 3. WP10-integriteitsscan ────────────────────────────────────────
  const drift = await runQuery(admin, internal.migration.integrityReport, {});
  console.log(`\n[verify] integriteitsscan (WP10): ${drift.length} bevinding(en)`);
  for (const line of drift.slice(0, 40)) console.log(`  ${line}`);
  if (drift.length > 40) console.log(`  … en nog ${drift.length - 40}`);
  if (drift.length > 0) problems += 1;

  // ── rapport ─────────────────────────────────────────────────────────
  if (dropped.photos.length > 0) {
    console.log(
      `\n[verify] ${dropped.photos.length} foto('s) zijn niet geladen omdat hun bestand niet in ` +
        `S3 stond: ${dropped.photos.slice(0, 10).join(", ")}${dropped.photos.length > 10 ? " …" : ""}`,
    );
  }
  console.log(`\n[verify] waarschuwingen uit de transform:`);
  for (const line of summarize(recordsFile.warnings)) console.log(`  - ${line}`);

  if (problems > 0) {
    console.error(`\n[verify] NIET GROEN: ${problems} categorie(ën) met bevindingen.`);
    return 1;
  }
  console.log(`\n[verify] groen.`);
  return 0;
}
