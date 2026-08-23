// WP12 — stap 3: `transform` als commando. Dun laagje om de pure functie heen:
// bestanden in, bestanden uit. Alle semantiek zit in transform.ts, want alleen
// daar is hij te unit-testen.

import { describeExtract, type ExtractFile, type ExtractMeta } from "./extract.ts";
import { loadConfig, type Target } from "./config.ts";
import { EXTRACT_FILE, RECORDS_FILE, readData, writeData } from "./paths.ts";
import { transform } from "./transform.ts";
import { TABLE_ORDER, type Records } from "./types.ts";

export type RecordsFile = {
  meta: {
    transformedAt: string;
    target: Target;
    source: ExtractMeta;
    counts: Record<string, number>;
  };
  records: Records;
  warnings: string[];
};

export function runTransform(target: Target, now = Date.now()): RecordsFile {
  const extractFile = readData<ExtractFile>(EXTRACT_FILE);
  console.log(`[transform] ${describeExtract(extractFile.meta)}`);
  console.log(`[transform] doel: ${target}`);

  const config = loadConfig(target, extractFile.items, now);
  const { records, warnings } = transform(extractFile.items, config);

  const counts: Record<string, number> = {};
  for (const table of TABLE_ORDER) counts[table] = records[table].length;

  const file: RecordsFile = {
    meta: {
      transformedAt: new Date(now).toISOString(),
      target,
      source: extractFile.meta,
      counts,
    },
    records,
    warnings,
  };
  const path = writeData(RECORDS_FILE, file);

  console.log(`[transform] rijen per tabel:`);
  for (const table of TABLE_ORDER) {
    console.log(`  ${table.padEnd(16)} ${counts[table]}`);
  }
  console.log(`[transform] ${warnings.length} waarschuwing(en):`);
  for (const line of summarize(warnings)) console.log(`  - ${line}`);
  console.log(`[transform] → ${path}`);
  if (config.anonymize) {
    console.log(
      `[transform] anonimisatie AAN: namen en adressen (ook die in invite-sleutels ` +
        `en -tokens) hebben deze stap niet verlaten.`,
    );
  }
  return file;
}

/**
 * Waarschuwingen zijn per record; op prod-volume zijn dat er duizenden. Voor de
 * terminal groeperen we ze op hun vorm (ID's en getallen weggemaskeerd) en
 * tonen we per soort één concreet voorbeeld plus hoeveel soortgelijke er nog
 * zijn. De volledige lijst staat in convex-records.json.
 */
export function summarize(warnings: string[]): string[] {
  const groups = new Map<string, { count: number; example: string }>();
  for (const warning of warnings) {
    const key = warning.replace(/[A-Za-z0-9@._-]*\d[A-Za-z0-9@._-]*/g, "…").slice(0, 90);
    const hit = groups.get(key);
    if (hit) hit.count += 1;
    else groups.set(key, { count: 1, example: warning });
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .map(({ count, example }) =>
      count === 1 ? example : `${example}  [+${count - 1} soortgelijke]`,
    );
}
