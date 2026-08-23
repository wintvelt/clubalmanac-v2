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

/**
 * "Geef de hele lijst" voor `storageInventory`. Bewust een groot getal en geen
 * aparte query-vorm: de bovengrens is het aantal storage-objecten (prod: ~1600).
 */
const FULL_LIST = 1_000_000;

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
  // Élke tabel die de deployment telt, niet alleen de tabellen die de import
  // vult (WP12 fix-cyclus 2, R2-3). "Verwacht 0" is ook een verwachting:
  // `uploadIdempotency` zit wél in de leeg-preconditie van `load-records` en was
  // erna ongecontroleerd, terwijl juist dán zijn `ownerId`'s naar verwijderde
  // users kunnen wijzen — precies wat WP10 de ochtend erna meldt. De set komt
  // uit `tableCounts`, die hem op zijn beurt uit WP10's `MONITORED_TABLES`
  // afleidt; de verwachting blijft uit `meta.counts` komen en dus uit de
  // eerdere, onafhankelijke laag (B-1c).
  const countedTables = [
    ...TABLE_ORDER,
    ...Object.keys(counts.tables).filter(
      (table) => !(TABLE_ORDER as readonly string[]).includes(table),
    ),
  ];
  // Apart bijgehouden, want er hangt een handelingsadvies aan (WP12 fix-cyclus
  // 3, R3-4): een advies gaat over de toestand die `verify` zélf heeft
  // vastgesteld, en volgt nooit uit één deel-bevinding terwijl een ander deel
  // rood is.
  let countProblems = 0;
  for (const table of countedTables) {
    const expected = recordsFile.meta.counts[table] ?? 0;
    const actual = counts.tables[table] ?? 0;
    const ok = expected === actual;
    if (!ok) {
      problems += 1;
      countProblems += 1;
    }
    console.log(
      `  ${ok ? "ok " : "FOUT"} ${table.padEnd(16)} verwacht ${expected}, gevonden ${actual}` +
        (ok ? "" : explain),
    );
  }

  // ── 2. storage, twee kanten op ──────────────────────────────────────
  // De volledige lijst, geen greep van tien (WP12 fix-cyclus 2, R2-5). Wie
  // `prune-storage` gaat draaien moet vooraf kunnen zien wát er precies weggaat;
  // een sample is genoeg om te alarmeren en te weinig om op te beslissen.
  const inventory = await runQuery(admin, internal.migration.storageInventory, {
    sampleSize: FULL_LIST,
  });
  console.log(
    `\n[verify] storage: ${inventory.storageObjects} objecten ` +
      `(${(inventory.totalBytes / 1_000_000).toFixed(1)} MB), ` +
      `${inventory.referencedByRecords} door records gebruikt`,
  );
  if (inventory.danglingCount > 0) {
    problems += 1;
    console.log(
      `  FOUT ${inventory.danglingCount} record(s) verwijzen naar een niet-bestaand bestand:`,
    );
    for (const id of inventory.danglingSample) console.log(`    - ${id}`);
  }
  if (inventory.orphanCount > 0) {
    problems += 1;
    console.log(
      `  FOUT ${inventory.orphanCount} storage-object(en) hangen aan geen enkel record ` +
        `— dit is precies wat WP10 dagelijks zou melden:`,
    );
    for (const id of inventory.orphanSample) console.log(`    - ${id}`);
    // Het advies volgt alleen uit een controle die klopt. Tussen T-2 en T-0 is
    // "storage-objecten zonder record" de normale toestand — de bestanden staan
    // er, de records nog niet — en wie dán gaat opruimen gooit de complete
    // upload weg. Dat is de route naar de blocker uit fix-cyclus 3 (R3-1).
    if (countProblems === 0) {
      console.log(
        `  Ruim ze op met 'prune-storage --target ${target} --yes'; dat wist exact deze objecten ` +
          `en laat de bestanden staan waar convex-records.json nog naar verwijst.`,
      );
    } else {
      console.log(
        `  Nog niet opruimen: de rij-aantallen kloppen niet, dus elk bestand is nog nodig — ` +
          `dat is de normale toestand tussen T-2 en T-0. Draai eerst 'load-records' en ` +
          `daarna opnieuw 'verify'.`,
      );
    }
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
