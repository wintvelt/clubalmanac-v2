// WP12 — stap 5: `load-records`. De getransformeerde rijen → de Convex-tabellen.
//
// Mechanisme = API-import: het script roept internal mutations aan, Convex munt
// `_id` en `_storage`, en het script houdt per tabel een eigen ID-map bij
// (`sourceKey` → `_id`) om de foreign keys op te lossen. Acht gescheiden
// namespaces, geen gedeelde platte map: een photoId die per ongeluk als groupId
// resolvet is een klasse fouten die met gescheiden maps niet bestaat.
//
// Niet hervatbaar, met opzet: dit is een run van minuten. Breekt hij af, dan is
// het antwoord `reset` en opnieuw — hervatting zou een tweede foutbron zijn.
// Daarom ook de preconditie: alle doel-tabellen leeg, vóór de eerste schrijf
// gecontroleerd en niet halverwege ontdekt.
//
// Twee gates vóór de eerste schrijf, allebei omdat een half geslaagde run hier
// erger is dan een geweigerde:
//   1. **Storage-dekking.** Elke sleutel waar een record naar verwijst moet een
//      bestand in `storage-map.json` hebben. Een ontbrekende, lege of
//      onvolledige map is een harde fout — nooit "nul bestanden bekend, dus nul
//      foto's te laden" (WP12 fix-cyclus 1, B-1).
//   2. **Leeg.** Elke tabel die `tableCounts` telt is leeg, inclusief de
//      tabellen die de import zelf niet vult maar WP10 wél bewaakt.
// `--accept-missing-files` opent gate 1, en dan alleen luidruchtig: het verlies
// wordt geteld, per bron-sleutel benoemd, en `verify` meldt het naderhand als
// bevinding. De vlag is een bevestiging van geaccepteerd verlies, geen
// voorwaarde om te kunnen draaien.

import { internal } from "../../convex/_generated/api.js";
import type { Target } from "./config.ts";
import { makeAdminClient, runMutation, runQuery } from "./convexAdmin.ts";
import { readStorageMap, referencedStorageKeys, type StorageMapFile } from "./loadFiles.ts";
import {
  MISSING_FILES_FILE,
  RECORDS_FILE,
  dataFileExists,
  readData,
} from "./paths.ts";
import type { RecordsFile } from "./runTransform.ts";
import {
  DEFERRED_FKS,
  FKS,
  INTERNAL_FIELDS,
  STORAGE_FIELDS,
  TABLE_ORDER,
  type Records,
  type Row,
  type TableName,
} from "./types.ts";

const INSERT_BATCH = 100;

type IdMaps = Record<TableName, Map<string, string>>;

export async function loadRecords(target: Target, acceptMissingFiles: boolean): Promise<number> {
  const recordsFile = readData<RecordsFile>(RECORDS_FILE);
  if (recordsFile.meta.target !== target) {
    throw new Error(
      `[load-records] convex-records.json is voor '${recordsFile.meta.target}', niet '${target}'.`,
    );
  }
  const admin = makeAdminClient(target, true);
  // Een ontbrekende map is hier een harde fout: voor `load-files` is hij het
  // normale begin, voor `load-records` het bewijs dat die stap niet
  // (af)gedraaid is (WP12 fix-cyclus 1, B-1).
  const storageMap = readStorageMap(target, admin.url, { allowMissing: false });

  console.log(`[load-records] doel: ${target} (${admin.url})`);
  console.log(
    `[load-records] bron: extract van ${recordsFile.meta.source.extractedAt}, ` +
      `transform van ${recordsFile.meta.transformedAt}`,
  );

  // ── gate: dekt de storage-map élke verwezen sleutel? ─────────────────
  // Vóór de eerste schrijf, en op de records zelf — niet op missing-files.json.
  // Dat bestand valt pas aan het eind van `load-files`, dus juist in het
  // scenario waarin de gate moet werken (een run die halverwege afbrak) bestaat
  // het niet. Zonder deze check kon een lege of onvolledige map een complete
  // dataset zonder foto's opleveren, met een groene `verify` erachteraan.
  const referenced = referencedStorageKeys(recordsFile);
  const uncovered = referenced.filter((key) => storageMap.files[key] === undefined);
  if (uncovered.length > 0 && !acceptMissingFiles) {
    throw new Error(
      `[load-records] ${uncovered.length} van de ${referenced.length} ` +
        `verwezen bestand(en) staan niet in scripts/.data/storage-map.json:\n` +
        uncovered
          .slice(0, 20)
          .map((key) => `  - ${key}`)
          .join("\n") +
        (uncovered.length > 20 ? `\n  … en nog ${uncovered.length - 20}` : "") +
        `\nZonder bestand kan de foto niet geladen worden (photos.storageId is verplicht) en ` +
        `zou alles wat ernaar verwijst stilletjes wegvallen. Draai 'load-files' (opnieuw) af; ` +
        `staan de bestanden aantoonbaar niet in S3 (zie ${MISSING_FILES_FILE}), draai dan ` +
        `opnieuw met --accept-missing-files om dat verlies expliciet te accepteren.`,
    );
  }

  // ── voorbewerking: records zonder bestand ───────────────────────────
  const { records, dropped } = applyStorageMap(recordsFile.records, storageMap);
  if (dropped.photos.length > 0 || dropped.profilePhotos > 0) {
    const provenMissing = knownMissingKeys();
    console.warn(
      `[load-records] --accept-missing-files: ${dropped.photos.length} foto('s) overgeslagen ` +
        `wegens ontbrekend bestand, ${dropped.profilePhotos} profielfoto('s) zonder bestand ` +
        `gewist, ${dropped.albumPhotos} albumfoto('s) en ${dropped.ratings} like(s) meegevallen, ` +
        `${dropped.coverPhotos} cover-verwijzing(en) gewist. Aggregates zijn herteld.`,
    );
    for (const key of uncovered) {
      console.warn(
        `[load-records]   ontbreekt: ${key}` +
          (provenMissing.has(key) ? ` (bevestigd afwezig in S3)` : ` (niet geüpload)`),
      );
    }
    console.warn(
      `[load-records] verlies per foto: ${dropped.photos.join(", ")}. ` +
        `Dit komt terug in het verify-rapport.`,
    );
  }

  // ── preconditie: alles leeg ─────────────────────────────────────────
  const before = await runQuery(admin, internal.migration.tableCounts, {});
  const nonEmpty = Object.entries(before.tables).filter(([, count]) => count > 0);
  if (nonEmpty.length > 0) {
    throw new Error(
      `[load-records] de doel-deployment is niet leeg: ` +
        nonEmpty.map(([table, count]) => `${table}=${count}`).join(", ") +
        `. Twee keer laden zonder reset verdubbelt de data. Draai eerst 'reset'.`,
    );
  }

  // ── laden in afhankelijkheids-volgorde ──────────────────────────────
  const idMaps = emptyIdMaps();
  let total = 0;
  for (const table of TABLE_ORDER) {
    const rows = records[table];
    if (rows.length === 0) continue;
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH).map((row) => ({
        sourceKey: row.sourceKey,
        doc: toDoc(table, row, idMaps, storageMap),
      }));
      const inserted = await runMutation(admin, internal.migration.insertRows, {
        table,
        rows: batch,
      });
      for (const { sourceKey, id } of inserted) idMaps[table].set(sourceKey, id);
      total += inserted.length;
    }
    console.log(`[load-records] ${table.padEnd(16)} ${rows.length}`);
  }

  // ── tweede pass: vooruit-verwijzingen ───────────────────────────────
  let patched = 0;
  for (const [table, fields] of Object.entries(DEFERRED_FKS) as Array<[TableName, string[]]>) {
    const patches: Array<{ id: string; field: string; value: string }> = [];
    for (const row of records[table]) {
      for (const field of fields) {
        const value = row[field];
        if (typeof value !== "string") continue;
        const spec = FKS[table].find((fk) => fk.field === field)!;
        const targetId = idMaps[spec.target].get(value);
        if (targetId === undefined) {
          throw new Error(
            `[load-records] ${table}.${field}=${value} op ${row.sourceKey} resolvet niet in ` +
              `${spec.target}. Draai 'reset' en begin opnieuw.`,
          );
        }
        const ownId = idMaps[table].get(row.sourceKey)!;
        patches.push({ id: ownId, field, value: targetId });
      }
    }
    for (let i = 0; i < patches.length; i += INSERT_BATCH) {
      patched += await runMutation(admin, internal.migration.patchRefs, {
        table,
        patches: patches.slice(i, i + INSERT_BATCH),
      });
    }
  }

  console.log(`[load-records] klaar: ${total} rijen, ${patched} cover-verwijzing(en) nagevuld.`);
  console.log(`[load-records] draai nu 'verify'.`);
  return 0;
}

/**
 * De sleutels die `load-files` aantoonbaar niet in S3 vond. Puur om het verlies
 * te duiden — nooit als gate: `missing-files.json` wordt pas aan het eind van
 * `load-files` geschreven en ontbreekt dus juist bij een afgebroken run.
 */
function knownMissingKeys(): Set<string> {
  if (!dataFileExists(MISSING_FILES_FILE)) return new Set();
  return new Set(readData<{ keys: string[] }>(MISSING_FILES_FILE).keys);
}

function emptyIdMaps(): IdMaps {
  const maps = {} as IdMaps;
  for (const table of TABLE_ORDER) maps[table] = new Map();
  return maps;
}

/**
 * Vertaalt één rij naar het document dat Convex krijgt: interne velden eruit,
 * FK-sourceKeys naar `_id`, S3-sleutels naar `_storage`-id, uitgestelde velden
 * overgeslagen, en `undefined` weggelaten (Convex kent geen undefined-veld).
 */
function toDoc(
  table: TableName,
  row: Row,
  idMaps: IdMaps,
  storageMap: StorageMapFile,
): Record<string, unknown> {
  const deferred = new Set(DEFERRED_FKS[table] ?? []);
  const fkByField = new Map(FKS[table].map((fk) => [fk.field, fk]));
  const doc: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(row)) {
    if (INTERNAL_FIELDS.has(field) || deferred.has(field)) continue;
    if (value === undefined || value === null) continue;
    const fk = fkByField.get(field);
    if (fk !== undefined) {
      const id = idMaps[fk.target].get(String(value));
      if (id === undefined) {
        throw new Error(
          `[load-records] ${table}.${field}=${String(value)} op ${row.sourceKey} resolvet niet ` +
            `in ${fk.target}. De deployment staat nu half gevuld: draai 'reset' en begin opnieuw.`,
        );
      }
      doc[field] = id;
      continue;
    }
    doc[field] = value;
  }

  for (const spec of STORAGE_FIELDS[table] ?? []) {
    const key = row[spec.from];
    if (typeof key !== "string" || key.length === 0) continue;
    const entry = storageMap.files[key];
    if (entry === undefined) {
      throw new Error(
        `[load-records] ${table}.${spec.from}='${key}' op ${row.sourceKey} staat niet in ` +
          `storage-map.json. Draai eerst 'load-files'.`,
      );
    }
    doc[spec.to] = entry.storageId;
    // Content-type kwam gratis mee uit S3; de bron kent geen mimeType-veld.
    if (table === "photos" && doc.mimeType === undefined && entry.contentType !== undefined) {
      doc.mimeType = entry.contentType;
    }
  }

  return doc;
}

export type DropReport = {
  photos: string[];
  albumPhotos: number;
  ratings: number;
  coverPhotos: number;
  profilePhotos: number;
};

/**
 * Foto's zonder bestand in de storage-map kunnen niet geladen worden
 * (`photos.storageId` is verplicht). Rapporteren en overslaan — één ontbrekend
 * bestand mag een cutover van 1650 foto's niet blokkeren, maar het moet
 * zichtbaar zijn. Alles wat naar zo'n foto verwees gaat mee, en de aggregates
 * worden herteld: anders meldt WP10 vanaf dag één drift.
 *
 * Bereikbaar is dit pad alleen ná `--accept-missing-files`: zonder die vlag is
 * de gate in `loadRecords` er al op afgeketst. Wat hier wegvalt is dus altijd
 * geaccepteerd verlies, nooit een stille aftrekpost — en `verify` leidt zijn
 * verwachting bewust niet met deze functie af, anders zou de controle de fout
 * van de laadstap structureel niet kunnen zien (WP12 fix-cyclus 1, B-1c).
 */
export function applyStorageMap(
  input: Records,
  storageMap: StorageMapFile,
): { records: Records; dropped: DropReport } {
  const records: Records = { ...input };
  const dropped: DropReport = {
    photos: [],
    albumPhotos: 0,
    ratings: 0,
    coverPhotos: 0,
    profilePhotos: 0,
  };

  const keptPhotos: Row[] = [];
  for (const photo of input.photos) {
    const key = photo.storageKey;
    if (typeof key === "string" && storageMap.files[key] !== undefined) keptPhotos.push(photo);
    else dropped.photos.push(photo.sourceKey);
  }
  const gone = new Set(dropped.photos);
  records.photos = keptPhotos;

  records.albumPhotos = input.albumPhotos.filter((row) => {
    const keep = !gone.has(row.photoId as string);
    if (!keep) dropped.albumPhotos += 1;
    return keep;
  });
  records.ratings = input.ratings.filter((row) => {
    const keep = !gone.has(row.photoId as string);
    if (!keep) dropped.ratings += 1;
    return keep;
  });

  const wipeCover = (rows: Row[]): Row[] =>
    rows.map((row) => {
      if (typeof row.coverPhotoId === "string" && gone.has(row.coverPhotoId)) {
        dropped.coverPhotos += 1;
        return { ...row, coverPhotoId: undefined };
      }
      return row;
    });
  records.groups = wipeCover(input.groups);
  records.albums = wipeCover(input.albums);

  records.users = input.users.map((user) => {
    const key = user.profilePhotoStorageKey;
    if (typeof key === "string" && storageMap.files[key] === undefined) {
      dropped.profilePhotos += 1;
      return { ...user, profilePhotoStorageKey: undefined };
    }
    return user;
  });

  recomputeAggregates(records);
  return { records, dropped };
}

/**
 * `users.photoCount`, `photos.ratingCount` en `photos.ratingAverage` opnieuw uit
 * de rijen die daadwerkelijk geladen worden. Exact de drie aggregates die
 * `internal.monitoring.integrityCheck` herrekent.
 */
export function recomputeAggregates(records: Records): void {
  const photosByOwner = new Map<string, number>();
  for (const photo of records.photos) {
    const owner = photo.ownerId as string;
    photosByOwner.set(owner, (photosByOwner.get(owner) ?? 0) + 1);
  }
  records.users = records.users.map((user) => ({
    ...user,
    photoCount: photosByOwner.get(user.sourceKey) ?? 0,
  }));

  const likesByPhoto = new Map<string, number>();
  for (const rating of records.ratings) {
    const photoId = rating.photoId as string;
    likesByPhoto.set(photoId, (likesByPhoto.get(photoId) ?? 0) + 1);
  }
  records.photos = records.photos.map((photo) => {
    const count = likesByPhoto.get(photo.sourceKey) ?? 0;
    return { ...photo, ratingCount: count, ratingAverage: count > 0 ? 1 : undefined };
  });
}
