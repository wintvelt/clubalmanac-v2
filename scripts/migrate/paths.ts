// WP12 — werkdata-map + guard.
//
// Invariant (WP12 §Invarianten): "Werkdata verlaat de repo niet. Alles wat het
// script wegschrijft landt onder `scripts/.data/`, dat in `.gitignore` staat.
// Het script weigert te schrijven naar een pad buiten die map."
//
// Daar staat productie-PII in: namen, adressen, foto's, Cognito-subs in
// S3-sleutels. De opruimstap staat in docs/runbooks/wp12-data-migratie.md.

import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(HERE, "..", ".data");

export const EXTRACT_FILE = "dynamo-extract.json";
export const RECORDS_FILE = "convex-records.json";
export const STORAGE_MAP_FILE = "storage-map.json";
export const MISSING_FILES_FILE = "missing-files.json";

/** Pad binnen `scripts/.data/`. Weigert alles wat daarbuiten zou landen. */
export function dataPath(name: string): string {
  const full = resolve(DATA_DIR, name);
  if (!full.startsWith(DATA_DIR + "/")) {
    throw new Error(`[migrate] weigert te lezen/schrijven buiten scripts/.data/: ${name}`);
  }
  return full;
}

export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

export function dataFileExists(name: string): boolean {
  return existsSync(dataPath(name));
}

export function readData<T>(name: string): T {
  const full = dataPath(name);
  if (!existsSync(full)) {
    throw new Error(
      `[migrate] ${name} bestaat niet in scripts/.data/. Draai eerst de stap die 'm maakt ` +
        `(zie docs/runbooks/wp12-data-migratie.md).`,
    );
  }
  return JSON.parse(readFileSync(full, "utf8")) as T;
}

export function writeData(name: string, value: unknown): string {
  ensureDataDir();
  const full = dataPath(name);
  writeFileSync(full, JSON.stringify(value, null, 1) + "\n", "utf8");
  return full;
}

/** Hernoemt een bestand zodat het niet per ongeluk hergebruikt wordt. */
export function invalidateData(name: string): string | null {
  const full = dataPath(name);
  if (!existsSync(full)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = dataPath(`${name}.ongeldig-${stamp}`);
  renameSync(full, target);
  return target;
}
