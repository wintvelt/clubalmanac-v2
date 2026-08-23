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

import { internal } from "../../convex/_generated/api.js";
import type { Target } from "./config.ts";
import { makeAdminClient, runMutation, runQuery } from "./convexAdmin.ts";
import { readStorageMap, type StorageMapFile } from "./loadFiles.ts";
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
  const storageMap = readStorageMap(target, admin.url);

  console.log(`[load-records] doel: ${target} (${admin.url})`);
  console.log(
    `[load-records] bron: extract van ${recordsFile.meta.source.extractedAt}, ` +
      `transform van ${recordsFile.meta.transformedAt}`,
  );

  if (dataFileExists(MISSING_FILES_FILE)) {
    const missing = readData<{ keys: string[] }>(MISSING_FILES_FILE);
    if (missing.keys.length > 0 && !acceptMissingFiles) {
      throw new Error(
        `[load-records] ${missing.keys.length} bestand(en) uit scripts/.data/${MISSING_FILES_FILE} ` +
          `ontbreken in S3. Die foto's kunnen niet geladen worden (photos.storageId is verplicht). ` +
          `Bekijk de lijst; draai daarna opnieuw met --accept-missing-files om het verlies te ` +
          `accepteren, of los het in de bron op.`,
      );
    }
  }

  // ── voorbewerking: records zonder bestand ───────────────────────────
  const { records, dropped } = applyStorageMap(recordsFile.records, storageMap);
  if (dropped.photos.length > 0 || dropped.profilePhotos > 0) {
    console.warn(
      `[load-records] ${dropped.photos.length} foto('s) overgeslagen wegens ontbrekend bestand, ` +
        `${dropped.profilePhotos} profielfoto('s) zonder bestand gewist, ` +
        `${dropped.albumPhotos} albumfoto('s) en ${dropped.ratings} like(s) meegevallen, ` +
        `${dropped.coverPhotos} cover-verwijzing(en) gewist. Aggregates zijn hertelt.`,
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
 * (`photos.storageId` is verplicht). A-besluit: rapporteren en overslaan — één
 * ontbrekend bestand mag een cutover van 1650 foto's niet blokkeren, maar het
 * moet zichtbaar zijn. Alles wat naar zo'n foto verwees gaat mee, en de
 * aggregates worden herteld: anders meldt WP10 vanaf dag één drift.
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
