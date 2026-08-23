// WP12 — stap 8: `prune-storage`. De wezen tussen T-2 en T-0 opruimen.
//
// Het gefaseerde ontwerp zet de bestanden twee weken vóór de cutover in
// Convex-storage. Wordt in die twee weken een foto in de oude app verwijderd,
// dan staat het bestand op T-0 in de storage zonder record: `verify` meldt het,
// het runbook eist "geen storage-orphans", en er was geen knop die alleen die
// objecten weghaalt (WP12 fix-cyclus 2, R2-5). `clearStorage` wist álles, en
// `reset --all` maakt de storage-map bovendien ongeldig — daarmee verdwijnen
// precies de uren upload die het gefaseerde ontwerp moest sparen.
//
// "Niemand nodig" heeft twee voorwaarden, en de tweede is de veiligheidsklep:
//
//   1. Geen enkel geladen record verwijst ernaar (de storage-inventaris van de
//      deployment).
//   2. De huidige `convex-records.json` verwijst er niet naar (via de sleutels
//      in `storage-map.json`).
//
// Zonder die tweede zou dit commando tussen T-2 en T-0 — deployment leeg,
// bestanden er al — precies alles wissen. Dat is de duurste denkbare fout in dit
// werkpakket, en daarom weigert het commando ook zonder `convex-records.json`:
// zonder die lijst is elke opruiming een gok.
//
// Daar bovenop de knop-discipline van `reset`: expliciete `--yes`, en tegen prod
// de MIGRATE_ALLOW_PROD-gate uit convexAdmin.ts.

import { internal } from "../../convex/_generated/api.js";
import type { Target } from "./config.ts";
import { makeAdminClient, runMutation, runQuery } from "./convexAdmin.ts";
import { readStorageMap, referencedStorageKeys } from "./loadFiles.ts";
import { RECORDS_FILE, STORAGE_MAP_FILE, readData, writeData } from "./paths.ts";
import type { RecordsFile } from "./runTransform.ts";

/** Zie verify.ts: de volledige lijst opvragen, geen sample. */
const FULL_LIST = 1_000_000;
const DELETE_BATCH = 200;

export async function pruneStorage(target: Target, confirmed: boolean): Promise<number> {
  const admin = makeAdminClient(target, true);
  if (!confirmed) {
    throw new Error(
      `[prune-storage] weigert zonder --yes. Dit wist storage-objecten op ${admin.url}; ` +
        `bekijk eerst de lijst die 'verify' afdrukt.`,
    );
  }

  // Allebei verplicht. De records zeggen wélke bestanden nog nodig zijn, de map
  // zegt welk object bij welke bron-sleutel hoort; zonder één van beide is niet
  // vast te stellen wat beschermd moet blijven.
  const recordsFile = readData<RecordsFile>(RECORDS_FILE);
  if (recordsFile.meta.target !== target) {
    throw new Error(
      `[prune-storage] convex-records.json is voor '${recordsFile.meta.target}', niet '${target}'.`,
    );
  }
  const storageMap = readStorageMap(target, admin.url, { allowMissing: false });

  console.log(`[prune-storage] doel: ${target} (${admin.url})`);

  // ── veiligheidsklep: staat de deployment die de records beschrijven er? ──
  // Tussen T-2 en T-0 is de deployment leeg terwijl élk bestand nog nodig is.
  // Een opruiming die dan draait, ziet alles als wees. De verwachting komt uit
  // `meta.counts` — de eerdere, onafhankelijke laag, net als bij `verify`.
  const counts = await runQuery(admin, internal.migration.tableCounts, {});
  const mismatches = Object.entries(counts.tables).filter(
    ([table, actual]) => (recordsFile.meta.counts[table] ?? 0) !== actual,
  );
  if (mismatches.length > 0) {
    console.log(
      `[prune-storage] de deployment komt niet overeen met convex-records.json: ` +
        mismatches
          .map(([table, actual]) => `${table}=${actual} (verwacht ${recordsFile.meta.counts[table] ?? 0})`)
          .join(", "),
    );
    console.log(
      `[prune-storage] er wordt niets gewist. Zolang de records niet (volledig) geladen zijn, ` +
        `is elk bestand nog nodig — dat is precies de situatie tussen T-2 en T-0. ` +
        `Draai eerst 'load-records' en daarna 'verify'.`,
    );
    return 0;
  }

  // ── voorwaarde 1: hangt er een geladen record aan? ──────────────────
  const inventory = await runQuery(admin, internal.migration.storageInventory, {
    sampleSize: FULL_LIST,
  });

  // ── voorwaarde 2: verwijst convex-records.json ernaar? ──────────────
  const needed = new Set<string>();
  for (const key of referencedStorageKeys(recordsFile)) {
    const entry = storageMap.files[key];
    if (entry !== undefined) needed.add(entry.storageId);
  }

  const doomed = inventory.orphanSample.filter((id) => !needed.has(id));
  const spared = inventory.orphanCount - doomed.length;
  console.log(
    `[prune-storage] ${inventory.storageObjects} object(en) in storage, ` +
      `${inventory.orphanCount} zonder record` +
      (spared > 0 ? `, waarvan ${spared} beschermd door convex-records.json` : ``),
  );
  if (doomed.length === 0) {
    console.log(`[prune-storage] niets op te ruimen.`);
    return 0;
  }

  for (const id of doomed) console.log(`[prune-storage]   wist ${id}`);
  let deleted = 0;
  for (let i = 0; i < doomed.length; i += DELETE_BATCH) {
    const result = await runMutation(admin, internal.migration.deleteStorageObjects, {
      ids: doomed.slice(i, i + DELETE_BATCH),
    });
    deleted += result.deleted;
  }

  // ── de map klopt na afloop weer met de werkelijkheid ────────────────
  // Blijft er een entry naar een gewist object wijzen, dan is dit dezelfde
  // stille corruptie-route als `reset --all` met een blijvende map: een volgende
  // `load-records` zou naar een bestand verwijzen dat niet meer bestaat.
  const gone = new Set(doomed);
  const staleKeys = Object.entries(storageMap.files)
    .filter(([, entry]) => gone.has(entry.storageId))
    .map(([key]) => key);
  if (staleKeys.length > 0) {
    for (const key of staleKeys) delete storageMap.files[key];
    storageMap.meta.updatedAt = new Date().toISOString();
    writeData(STORAGE_MAP_FILE, storageMap);
  }

  console.log(
    `[prune-storage] klaar: ${deleted} object(en) gewist, ${staleKeys.length} entry(s) uit ` +
      `${STORAGE_MAP_FILE} gehaald. Draai nu 'verify'.`,
  );
  return 0;
}
