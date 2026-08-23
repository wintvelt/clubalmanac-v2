// WP12 — stap 4: `load-files`. S3 → Convex-storage.
//
// Twee invarianten sturen dit bestand:
//
//   - **Record-gedreven, nooit bucket-gedreven.** De te uploaden set is exact
//     `photos.storageKey ∪ users.profilePhotoStorageKey` uit de getransformeerde
//     records. Nooit een ListObjectsV2 over de bucket: die bevat aantoonbaar
//     objecten zonder record (wezen van de rotatie-fix, kopieën met
//     Metadata.iscopy, mail-assets onder public/img/) en die zouden vanaf dag
//     één WP10-drift produceren.
//   - **Hervatbaar.** De prod-run duurt uren over een lijn van <20 Mbit/s en
//     breekt af. `storage-map.json` (S3-sleutel → _storage-id) overleeft de run
//     en wordt na élk bestand weggeschreven; een tweede run slaat over wat er al
//     in staat.
//
// Twee bestanden met dezelfde S3-sleutel worden één storage-object: de
// standaard-profielfoto's zijn gedeeld. De map op S3-sleutel geeft die dedup
// gratis — het is dus géén 1:1-relatie tussen records en storage-objecten.
//
// Een 404 op een sleutel waar wél een record naar wijst is een FOUT, geen
// "overslaan": anders verdwijnt een foto zonder dat iemand het merkt. Ze komen
// in `.data/missing-files.json` en `load-records` weigert te draaien tot je ze
// expliciet accepteert.

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { internal } from "../../convex/_generated/api.js";
import { awsSource, type Target } from "./config.ts";
import { makeAdminClient, runMutation } from "./convexAdmin.ts";
import {
  MISSING_FILES_FILE,
  RECORDS_FILE,
  STORAGE_MAP_FILE,
  dataFileExists,
  readData,
  writeData,
} from "./paths.ts";
import type { RecordsFile } from "./runTransform.ts";

export type StorageMapEntry = {
  storageId: string;
  bytes: number;
  contentType?: string;
  uploadedAt: string;
};

export type StorageMapFile = {
  meta: { target: Target; convexUrl: string; updatedAt: string };
  files: Record<string, StorageMapEntry>;
};

const URL_BATCH = 10;

/**
 * Het te verwachten prod-volume, gemeten op 2026-08-23 met
 * `aws s3 ls s3://blob-images/ --recursive --summarize`: 1601 objecten,
 * 5.605.457.261 bytes. De 8,3 GB uit het oorspronkelijke plan was inclusief de
 * video's, en die gaan niet mee (WP12 §Video's — buiten scope). Eén getal, één
 * plek: hier.
 */
const PROD_VOLUME_BYTES = 5_605_457_261;
const PROD_VOLUME_LABEL = "5,6 GB";

/**
 * Leest `storage-map.json`.
 *
 * `allowMissing` is geen gemak maar het verschil tussen twee stappen (WP12
 * fix-cyclus 1, B-1): voor `load-files` is een ontbrekende map het normale
 * begin van de eerste run, voor `load-records` is hij het bewijs dat de vorige
 * stap niet (af)gedraaid is. Alleen `load-files` mag hem dus verzinnen.
 */
export function readStorageMap(
  target: Target,
  convexUrl: string,
  { allowMissing }: { allowMissing: boolean },
): StorageMapFile {
  if (!dataFileExists(STORAGE_MAP_FILE)) {
    if (!allowMissing) {
      throw new Error(
        `[migrate] scripts/.data/${STORAGE_MAP_FILE} bestaat niet. Zonder die map is niet vast ` +
          `te stellen welke bestanden geladen zijn — "nul bestanden bekend, dus nul foto's te ` +
          `laden" is nooit een geldige conclusie. Draai eerst 'load-files'.`,
      );
    }
    return { meta: { target, convexUrl, updatedAt: new Date().toISOString() }, files: {} };
  }
  const map = readData<StorageMapFile>(STORAGE_MAP_FILE);
  if (map.meta.target !== target) {
    throw new Error(
      `[load-files] storage-map.json is van target '${map.meta.target}', niet '${target}'. ` +
        `Storage-ID's zijn per deployment; hergebruik zou naar niet-bestaande bestanden wijzen.`,
    );
  }
  if (map.meta.convexUrl !== convexUrl) {
    throw new Error(
      `[load-files] storage-map.json hoort bij ${map.meta.convexUrl}, niet bij ${convexUrl}.`,
    );
  }
  return map;
}

/** De te uploaden sleutels, in stabiele volgorde. Record-gedreven. */
export function referencedStorageKeys(file: RecordsFile): string[] {
  const keys = new Set<string>();
  for (const photo of file.records.photos) {
    const key = photo.storageKey;
    if (typeof key === "string" && key.length > 0) keys.add(key);
  }
  for (const user of file.records.users) {
    const key = user.profilePhotoStorageKey;
    if (typeof key === "string" && key.length > 0) keys.add(key);
  }
  return [...keys].sort();
}

export async function loadFiles(target: Target): Promise<number> {
  const recordsFile = readData<RecordsFile>(RECORDS_FILE);
  if (recordsFile.meta.target !== target) {
    throw new Error(
      `[load-files] convex-records.json is getransformeerd voor '${recordsFile.meta.target}', ` +
        `niet voor '${target}'. Draai transform opnieuw.`,
    );
  }

  const admin = makeAdminClient(target, true);
  const source = awsSource();
  const s3 = new S3Client({ region: source.region });

  const map = readStorageMap(target, admin.url, { allowMissing: true });
  const keys = referencedStorageKeys(recordsFile);
  const todo = keys.filter((key) => map.files[key] === undefined);

  console.log(`[load-files] doel: ${target} (${admin.url})`);
  console.log(`[load-files] bron: s3://${source.bucket} @ ${source.region} (read-only)`);
  console.log(
    `[load-files] ${keys.length} bestanden waarnaar records verwijzen; ` +
      `${keys.length - todo.length} al geüpload, ${todo.length} te gaan`,
  );

  const missing: string[] = [];
  let uploaded = 0;
  let bytesTotal = 0;
  const startedAt = Date.now();

  for (let i = 0; i < todo.length; i += URL_BATCH) {
    const batch = todo.slice(i, i + URL_BATCH);
    const urls = await runMutation(admin, internal.migration.generateUploadUrls, {
      count: batch.length,
    });
    for (let j = 0; j < batch.length; j++) {
      const key = batch[j]!;
      const uploadUrl = urls[j]!;
      const object = await fetchFromS3(s3, source.bucket, key);
      if (object === null) {
        missing.push(key);
        console.error(`[load-files] FOUT: s3://${source.bucket}/${key} bestaat niet`);
        continue;
      }
      const storageId = await uploadToConvex(uploadUrl, object.body, object.contentType);
      map.files[key] = {
        storageId,
        bytes: object.body.byteLength,
        contentType: object.contentType,
        uploadedAt: new Date().toISOString(),
      };
      map.meta.updatedAt = new Date().toISOString();
      // Na élk bestand wegschrijven: een run van uren mag bij een afbreking
      // niet opnieuw beginnen.
      writeData(STORAGE_MAP_FILE, map);
      uploaded += 1;
      bytesTotal += object.body.byteLength;
      if (uploaded % 25 === 0) {
        console.log(`[load-files] ${uploaded}/${todo.length} — ${throughput(bytesTotal, startedAt)}`);
      }
    }
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  console.log(
    `[load-files] klaar: ${uploaded} bestanden, ${(bytesTotal / 1_000_000).toFixed(1)} MB in ` +
      `${elapsed.toFixed(0)}s — ${throughput(bytesTotal, startedAt)}`,
  );
  console.log(
    `[load-files] meting voor de prod-planning: bij dit tempo duurt ${PROD_VOLUME_LABEL} ` +
      `${estimateHours(bytesTotal, elapsed)}.`,
  );

  if (missing.length > 0) {
    writeData(MISSING_FILES_FILE, {
      meta: { target, checkedAt: new Date().toISOString(), bucket: source.bucket },
      keys: missing,
    });
    console.error(
      `\n[load-files] FOUT: ${missing.length} bestand(en) waar wél een record naar verwijst ` +
        `staan niet in de bucket. Ze staan in scripts/.data/${MISSING_FILES_FILE}.\n` +
        `Dit is geen "overslaan": zonder ingrijpen verdwijnen die foto's. Bekijk de lijst en ` +
        `draai daarna load-records met --accept-missing-files als je het verlies accepteert.`,
    );
    return 1;
  }
  return 0;
}

async function fetchFromS3(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<{ body: Uint8Array; contentType?: string } | null> {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (result.Body === undefined) return null;
    // Bufferen in plaats van streamen: de Convex-upload-URL wil een Content-
    // Length. De grootste bestanden zijn foto's van enkele MB's — de video's
    // gaan niet mee naar Convex (WP12 §Video's — buiten scope), dus dit blijft
    // ruim binnen het geheugen.
    const body = await result.Body.transformToByteArray();
    return { body, contentType: result.ContentType };
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw error;
  }
}

async function uploadToConvex(
  uploadUrl: string,
  body: Uint8Array,
  contentType: string | undefined,
): Promise<string> {
  // Als Blob, zodat fetch de Content-Length zet en het content-type uit S3
  // meekomt naar Convex-storage.
  const blob = new Blob([body as BlobPart], contentType !== undefined ? { type: contentType } : {});
  const response = await fetch(uploadUrl, { method: "POST", body: blob });
  if (!response.ok) {
    throw new Error(`[load-files] upload mislukt (${response.status}): ${await response.text()}`);
  }
  const payload = (await response.json()) as { storageId?: string };
  if (typeof payload.storageId !== "string") {
    throw new Error(`[load-files] upload gaf geen storageId terug: ${JSON.stringify(payload)}`);
  }
  return payload.storageId;
}

function throughput(bytes: number, startedAt: number): string {
  const seconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  return `${(bytes / 1_000_000 / seconds).toFixed(2)} MB/s`;
}

function estimateHours(bytes: number, seconds: number): string {
  if (bytes === 0) return "onbekend (niets geüpload)";
  const perByte = seconds / bytes;
  const hours = (PROD_VOLUME_BYTES * perByte) / 3600;
  return `ongeveer ${hours.toFixed(1)} uur`;
}
