// WP12 — stap 6: `verify`. Klopt wat er in de deployment staat met wat we
// bedoelden te laden?
//
// Drie controles, en de derde is de reden dat dit commando bestaat:
//   1. Rij-aantallen per tabel = de tellingen die `transform` in
//      convex-records.json heeft vastgelegd.
//   2. Storage twee kanten op: elke `storageId` in een record bestaat, én elk
//      object in `_storage` hangt aan minstens één record. Dat tweede is exact
//      wat WP10 dagelijks meldt — beter hier op T-0 zien dan de volgende
//      ochtend per mail.
//   3. De volledige WP10-integriteitsscan, read-only (geen monitoringRuns-rij,
//      geen drift-mail): aggregates, FK's, orphans.
//
// De verwachting komt uit `meta.counts` — de eerdere, onafhankelijke laag — en
// nooit uit een herberekening die dezelfde weg aflegt als `load-records` (WP12
// fix-cyclus 1, B-1c). Dat was precies het gat: `verify` paste dezelfde
// `applyStorageMap` toe op zijn eigen verwachting, dus bij een lege storage-map
// verwachtte hij 0 foto's, vond er 0, en meldde "ok".
//
// Gevolg, en dat is bedoeld: draai je met `--accept-missing-files`, dan is
// `verify` niet groen. Verklaarbaar verlies is geen goedgekeurd verlies; de
// operator moet het zien en accepteren, en dit is de laatste plek waar dat nog
// kan vóór T-0 doorgaat.

import { internal } from "../../convex/_generated/api.js";
import type { Target } from "./config.ts";
import { makeAdminClient, runQuery } from "./convexAdmin.ts";
import { readStorageMap, referencedStorageKeys } from "./loadFiles.ts";
import { RECORDS_FILE, readData } from "./paths.ts";
import { summarize } from "./runTransform.ts";
import type { RecordsFile } from "./runTransform.ts";
import { TABLE_ORDER } from "./types.ts";

export async function verify(target: Target): Promise<number> {
  const recordsFile = readData<RecordsFile>(RECORDS_FILE);
  const admin = makeAdminClient(target, false);
  // Verify mag niet omvallen op een ontbrekende map: hij rapporteert, hij
  // blokkeert niet. De map dient hier alleen om een verschil te duiden.
  const storageMap = readStorageMap(target, admin.url, { allowMissing: true });
  const uncovered = referencedStorageKeys(recordsFile).filter(
    (key) => storageMap.files[key] === undefined,
  );

  console.log(`[verify] doel: ${target} (${admin.url})`);
  console.log(
    `[verify] bron: extract ${recordsFile.meta.source.extractedAt} (${recordsFile.meta.source.table} ` +
      `@ ${recordsFile.meta.source.region}), transform ${recordsFile.meta.transformedAt}`,
  );

  let problems = 0;

  // ── 1. rij-aantallen ────────────────────────────────────────────────
  const counts = await runQuery(admin, internal.migration.tableCounts, {});
  const explain =
    uncovered.length > 0
      ? ` — mogelijk verklaard door ${uncovered.length} ontbrekend(e) bestand(en), maar` +
        ` verklaarbaar is niet goedgekeurd`
      : "";
  console.log(`\n[verify] rij-aantallen (verwacht = de transform-telling):`);
  for (const table of TABLE_ORDER) {
    const expected = recordsFile.meta.counts[table] ?? 0;
    const actual = counts.tables[table] ?? 0;
    const ok = expected === actual;
    if (!ok) problems += 1;
    console.log(
      `  ${ok ? "ok " : "FOUT"} ${table.padEnd(16)} verwacht ${expected}, gevonden ${actual}` +
        (ok ? "" : explain),
    );
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
  // Geen aftrekpost, maar een bevinding met naam en toenaam: welke bestanden
  // ontbraken en welke foto's daaraan hingen. De tellingen hierboven zijn er al
  // op afgeketst; dit is de duiding die de operator nodig heeft om te beslissen.
  if (uncovered.length > 0) {
    // Ook als de rij-aantallen toevallig kloppen. Een ontbrekende *profielfoto*
    // verandert geen enkele telling en zou hier anders alsnog stil wegvallen.
    problems += 1;
    const uncoveredSet = new Set(uncovered);
    const affected = recordsFile.records.photos
      .filter((photo) => uncoveredSet.has(photo.storageKey as string))
      .map((photo) => photo.sourceKey);
    console.log(
      `\n[verify] BEVINDING: ${uncovered.length} verwezen bestand(en) staan niet in ` +
        `storage-map.json. Alles wat eraan hing is niet geladen.`,
    );
    for (const key of uncovered.slice(0, 10)) console.log(`  - ${key}`);
    if (uncovered.length > 10) console.log(`  … en nog ${uncovered.length - 10}`);
    if (affected.length > 0) {
      console.log(
        `  geraakte foto's: ${affected.slice(0, 10).join(", ")}` +
          `${affected.length > 10 ? " …" : ""}`,
      );
    }
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
