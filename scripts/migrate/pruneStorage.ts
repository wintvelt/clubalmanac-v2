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
// "Niemand nodig" heeft twee voorwaarden:
//
//   1. Geen enkel geladen record verwijst ernaar (de storage-inventaris van de
//      deployment).
//   2. De huidige `convex-records.json` verwijst er niet naar (via de sleutels
//      in `storage-map.json`) — de per-object-bescherming.
//
// Daar staan twee andere mechanismen náást, en het zijn er dus drie, niet één
// (WP12 fix-cyclus 3, R3-2 — de tekst beloofde één ding en de code beschermde
// via een ander):
//
//   * de **toestandscontrole**: beschrijft `convex-records.json` de deployment
//     die er nú staat? Kloppen de rij-aantallen niet, dan zijn de records niet
//     (volledig) geladen en is elk bestand nog nodig. Dat is geen voorwaarde
//     per object maar een uitspraak over het hele commando.
//   * de **vloer** (R3-1): `prune-storage` wist nooit alles. De toestand-
//     controle is namelijk triviaal waar zodra beide kanten nul zijn — een
//     `extract` tegen de verkeerde DynamoDB-tabel (het is een env-var, en er
//     bestaat een tweede AWS-omgeving die we bewust negeren) levert nul items,
//     en op nul items slagen `transform`, `load-records` én `verify`. De vloer
//     is het laatste dat dan nog tussen de operator en 5,6 GB staat, dus hangt
//     hij niet van diezelfde vergelijking af. Alles wissen heet `reset --all`:
//     een ander commando, een andere bedoeling.
//
// De per-object-bescherming heeft daarmee zijn eigen, aflezende betekenis: de
// huidige `convex-records.json` blijft na een opruiming laadbaar. `reset`
// (zonder `--all`) plus `load-records` moet erna nog kunnen slagen zonder
// `--accept-missing-files`. Die tak is bereikbaar zodra de app draait: een
// rotatie (WP8) schrijft een nieuw object en laat het oude achter, dus het oude
// hangt aan geen record meer terwijl de rij-aantallen ongewijzigd blijven.
//
// Het commando weigert ook zonder `convex-records.json`: zonder die lijst is
// elke opruiming een gok. Elke weigering eindigt met een niet-nul exitcode
// (R3-5) — op cutover-dag lopen deze commando's in een keten en leest de
// operator de uitkomst uit de exitcode, niet uit twintig regels terminal.
// "Niets te doen" is wél succes.
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

  // ── de per-object-bescherming: wat heeft convex-records.json nog nodig? ──
  // Puur uit de twee bestanden, zonder de deployment: dit is de lijst die de
  // terugvalroute van de operator (`reset` + `load-records`) overeind houdt.
  const mapSize = Object.keys(storageMap.files).length;
  const needed = new Set<string>();
  for (const key of referencedStorageKeys(recordsFile)) {
    const entry = storageMap.files[key];
    if (entry !== undefined) needed.add(entry.storageId);
  }

  // ── vloer, deel 1 + 2: de twee toestanden die je uit de bestanden ziet ──
  // Bewust vóór de toestandscontrole: in precies deze toestanden is die
  // vergelijking triviaal waar, dus mag de bescherming er niet achter zitten.
  const plannedRows = Object.values(recordsFile.meta.counts).reduce((sum, n) => sum + n, 0);
  if (plannedRows === 0) {
    console.log(
      `[prune-storage] VLOER: convex-records.json beschrijft nul rijen in totaal. Dat is geen ` +
        `opruimopdracht maar een leeg transform-resultaat — vrijwel altijd een 'extract' tegen ` +
        `de verkeerde tabel of omgeving. Er wordt niets gewist en ${STORAGE_MAP_FILE} blijft ` +
        `zoals hij is. Controleer MIGRATE_DYNAMO_TABLE en draai 'extract' + 'transform' opnieuw.`,
    );
    return 1;
  }
  if (needed.size === 0 && mapSize > 0) {
    console.log(
      `[prune-storage] VLOER: ${mapSize} bestand(en) in ${STORAGE_MAP_FILE}, en convex-records.json ` +
        `heeft er geen enkele van nodig. Dat is een tegenspraak, geen opruimopdracht, en die los ` +
        `je niet op door de complete upload weg te gooien. Er wordt niets gewist.`,
    );
    return 1;
  }

  // ── toestandscontrole: staat de deployment die de records beschrijven er? ──
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
    return 1;
  }

  // ── voorwaarde 1: hangt er een geladen record aan? ──────────────────
  const inventory = await runQuery(admin, internal.migration.storageInventory, {
    sampleSize: FULL_LIST,
  });

  // Voorwaarde 2 is `needed` hierboven. Wat daardoor blijft staan wordt geteld
  // en gemeld: een bescherming die nooit iets meldt is niet te onderscheiden
  // van een bescherming die er niet is — precies hoe R3-2 ontstond.
  const doomed = inventory.orphanSample.filter((id) => !needed.has(id));
  const spared = inventory.orphanSample.length - doomed.length;
  console.log(
    `[prune-storage] ${inventory.storageObjects} object(en) in storage, ` +
      `${inventory.orphanCount} zonder record` +
      (spared > 0
        ? `, waarvan ${spared} beschermd door convex-records.json (die blijven staan, zodat ` +
          `'reset' + 'load-records' erna nog slaagt)`
        : ``),
  );
  if (doomed.length === 0) {
    console.log(`[prune-storage] niets op te ruimen.`);
    return 0;
  }

  // ── vloer, deel 3: dit is geen opruiming meer maar een leegmaak-actie ──
  if (doomed.length === inventory.storageObjects) {
    console.log(
      `[prune-storage] VLOER: alle ${inventory.storageObjects} object(en) in storage zouden weg ` +
        `gaan. Wat er ook misging — dit is geen selectieve opruiming meer. Alles wissen is ` +
        `'reset --all': een ander commando, een andere bedoeling, een andere bevestiging. ` +
        `Er wordt niets gewist en ${STORAGE_MAP_FILE} blijft zoals hij is.`,
    );
    return 1;
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
