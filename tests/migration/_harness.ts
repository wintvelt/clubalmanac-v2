// WP12 — test-harnas voor de laad-, controle- en reset-stappen.
//
// INVARIANT (WP12 §Fix-cyclus 1 → Testbaarheid): geen enkele test raakt
// `scripts/.data/`. Daar staat productie-PII, en een test die daar schrijft kan
// de werkdata van een lopende migratie overschrijven. Dit harnas vervangt
// daarom twee randen: de bestandslaag (`paths`) en de Convex-verbinding
// (`convexAdmin`). Wat overblijft is exact de tooling-logica.
//
// De nep-deployment is bewust géén her-implementatie van convex/migration.ts:
// hij modelleert de *deployment* (rijen per tabel, objecten in storage) en
// beantwoordt de vragen die de tooling stelt. Of de echte migration.ts die
// vragen volledig beantwoordt, wordt apart gepind in migrationFunctions.test.ts.

import { getFunctionName } from "convex/server";
import { vi } from "vitest";
import type { StorageMapFile } from "../../scripts/migrate/loadFiles";
import type { RecordsFile } from "../../scripts/migrate/runTransform";
import { transform } from "../../scripts/migrate/transform";
import { TABLE_ORDER } from "../../scripts/migrate/types";
import {
  buildExtract,
  CHOSEN,
  DEV_SUBJECTS,
  EXPECTED_STORAGE_KEYS,
  PROD_SUBJECTS,
} from "./fixture";
import { MONITORED_TABLE_ORACLE } from "./fkOracle";

export const FAKE_DEV_URL = "https://fake-dev-deployment.convex.cloud";

/**
 * Elke tabel die `internal.monitoring.integrityCheck` aanraakt hoort onder de
 * leeg-preconditie van `load-records` én onder `reset` te vallen (WP12
 * fix-cyclus 1, B-2). `uploadIdempotency` staat er expliciet bij: WP10
 * controleert er twee FK's op, en de dev-deployment heeft er rijen in.
 *
 * De set komt uit de handmatige oracle en niet uit `TABLE_ORDER` (WP12
 * fix-cyclus 2, R2-3): de nep-deployment moet antwoord geven op wat er in de
 * echte deployment stáát, niet op wat de tooling toevallig opsomt. Anders
 * krimpt de vraag mee met het antwoord.
 */
export const DEPLOYMENT_TABLES = MONITORED_TABLE_ORACLE;

// ── terminal-output ───────────────────────────────────────────────────

type SpyLike = { mock: { calls: unknown[][] } };

const asText = (spy: SpyLike): string =>
  spy.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");

/**
 * Stilte op de terminal, plus een leesvenster op wat een commando er in DEZE
 * test neerzette. Eén plek, omdat de valkuil in de opzet zit en niet in het
 * gebruik.
 *
 * De `restoreAllMocks` vooraf is het hele punt. `vi.spyOn` op een al
 * bespioneerde `console.log` geeft dezelfde spy terug en laat `mock.calls`
 * staan, en `vitest.config.ts` zet geen `restoreMocks`. Zonder die regel leest
 * een test ook de regels van élke eerdere test in hetzelfde bestand: een
 * `not.toContain` slaagt dan nooit meer op eigen kracht, en een `toContain` kan
 * slagen op de output van een test die iets heel anders deed. Dat is dezelfde
 * fout die deze WP in de tooling bestrijdt — een controle die zijn antwoord
 * ergens anders vandaan haalt dan uit de stap die hij controleert — alleen dan
 * in het harnas, waar hij niemand meer waarschuwt.
 */
export function captureConsole() {
  vi.restoreAllMocks();
  const log = vi.spyOn(console, "log").mockImplementation(() => {}) as unknown as SpyLike;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {}) as unknown as SpyLike;
  const error = vi.spyOn(console, "error").mockImplementation(() => {}) as unknown as SpyLike;
  return {
    /** Alles wat deze test naar stdout schreef, als één blok tekst. */
    log: (): string => asText(log),
    /** Idem voor de waarschuwingen. */
    warn: (): string => asText(warn),
    /** Idem voor de foutmeldingen. */
    error: (): string => asText(error),
  };
}

export type ConsoleCapture = ReturnType<typeof captureConsole>;

// ── records-fixture ───────────────────────────────────────────────────

const NOW = Date.parse("2026-08-23T00:00:00.000Z");

export function buildRecordsFile(target: "dev" | "prod" = "prod"): RecordsFile {
  const { records, warnings } = transform(buildExtract(), {
    target,
    chosenUserIds: target === "dev" ? CHOSEN : null,
    anonymize: target === "dev",
    subjectByUserId: target === "dev" ? DEV_SUBJECTS : PROD_SUBJECTS,
    defaultPhotoLimit: 1000,
    now: NOW,
  });
  const counts: Record<string, number> = {};
  for (const table of TABLE_ORDER) counts[table] = records[table].length;
  return {
    meta: {
      transformedAt: new Date(NOW).toISOString(),
      target,
      source: {
        extractedAt: new Date(NOW).toISOString(),
        table: "blob-images-photos-synthetisch",
        region: "eu-central-1",
        account: "000000000000",
        itemCount: 0,
      },
      counts,
    },
    records,
    warnings,
  };
}

/**
 * Storage-map alsof `load-files` klaar is: de wereld zoals die stap hem
 * achterliet, niet wat de tooling denkt nodig te hebben (WP12 fix-cyclus 2,
 * R2-1). De sleutels komen daarom uit de handmatige oracle in `fixture.ts` en
 * niet uit `referencedStorageKeys` — die functie is hier onderwerp van
 * onderzoek, geen bron van waarheid.
 *
 * `omit` laat bestanden ontbreken (een afgebroken of onvolledige `load-files`),
 * `extra` voegt bestanden toe die wél geüpload zijn maar waar geen record meer
 * naar verwijst (een foto die tussen T-2 en T-0 verwijderd werd).
 */
export function buildStorageMap(
  file: RecordsFile,
  options: { omit?: string[]; extra?: string[] } = {},
): StorageMapFile {
  const omit = new Set(options.omit ?? []);
  const files: StorageMapFile["files"] = {};
  const keys = [...EXPECTED_STORAGE_KEYS[file.meta.target], ...(options.extra ?? [])];
  for (const key of keys) {
    if (omit.has(key)) continue;
    files[key] = {
      storageId: `kg_${key.replace(/[^a-z0-9]/gi, "")}`,
      bytes: 1024,
      contentType: "image/jpeg",
      uploadedAt: new Date(NOW).toISOString(),
    };
  }
  return {
    meta: { target: file.meta.target, convexUrl: FAKE_DEV_URL, updatedAt: new Date(NOW).toISOString() },
    files,
  };
}

/** De S3-sleutel van een foto uit de records-fixture. */
export function storageKeyOf(file: RecordsFile, table: "photos" | "users", sourceKey: string): string {
  const row = file.records[table].find((r) => r.sourceKey === sourceKey);
  if (row === undefined) throw new Error(`fixture: geen ${table}-rij ${sourceKey}`);
  const key = table === "photos" ? row.storageKey : row.profilePhotoStorageKey;
  if (typeof key !== "string") throw new Error(`fixture: ${table}/${sourceKey} heeft geen storageKey`);
  return key;
}

// ── nep-deployment ────────────────────────────────────────────────────

export type FakeDoc = Record<string, unknown> & { _id: string };

export function createFakeDeployment() {
  const tables = new Map<string, FakeDoc[]>();
  const storage = new Map<string, number>(); // storageId → bytes
  const insertCalls: Array<{ table: string; sourceKey: string; doc: Record<string, unknown> }> = [];
  const patchCalls: Array<{ table: string; id: string; field: string; value: string }> = [];
  let driftLines: string[] = [];
  let counter = 0;

  const rows = (table: string): FakeDoc[] => {
    const existing = tables.get(table);
    if (existing !== undefined) return existing;
    const fresh: FakeDoc[] = [];
    tables.set(table, fresh);
    return fresh;
  };

  const referencedStorageIds = (): Set<string> => {
    const referenced = new Set<string>();
    for (const photo of rows("photos")) {
      if (typeof photo.storageId === "string") referenced.add(photo.storageId);
    }
    for (const user of rows("users")) {
      if (typeof user.profilePhotoStorageId === "string") referenced.add(user.profilePhotoStorageId);
    }
    return referenced;
  };

  async function query(_admin: unknown, ref: any, args: any): Promise<any> {
    const name = getFunctionName(ref);
    if (name === "migration:tableCounts") {
      const counts: Record<string, number> = {};
      for (const table of DEPLOYMENT_TABLES) counts[table] = rows(table).length;
      return { tables: counts, storageObjects: storage.size };
    }
    if (name === "migration:storageInventory") {
      // `sampleSize` wordt gerespecteerd, net als in de echte query: wie de
      // volledige lijst wil (om hem te tonen of op te ruimen) kan erom vragen.
      const sample = (args?.sampleSize as number | undefined) ?? 10;
      const referenced = referencedStorageIds();
      const orphans = [...storage.keys()].filter((id) => !referenced.has(id));
      const dangling = [...referenced].filter((id) => !storage.has(id));
      return {
        storageObjects: storage.size,
        referencedByRecords: referenced.size,
        orphanCount: orphans.length,
        orphanSample: orphans.slice(0, sample),
        danglingCount: dangling.length,
        danglingSample: dangling.slice(0, sample),
        totalBytes: [...storage.values()].reduce((sum, n) => sum + n, 0),
      };
    }
    if (name === "migration:integrityReport") return driftLines;
    throw new Error(`[fake] onbekende query: ${name}`);
  }

  async function mutation(_admin: unknown, ref: any, args: any): Promise<any> {
    const name = getFunctionName(ref);
    if (name === "migration:insertRows") {
      const out: Array<{ sourceKey: string; id: string }> = [];
      for (const row of args.rows as Array<{ sourceKey: string; doc: Record<string, unknown> }>) {
        counter += 1;
        const id = `${args.table}_${counter}`;
        rows(args.table).push({ ...row.doc, _id: id });
        insertCalls.push({ table: args.table, sourceKey: row.sourceKey, doc: row.doc });
        out.push({ sourceKey: row.sourceKey, id });
      }
      return out;
    }
    if (name === "migration:patchRefs") {
      for (const patch of args.patches as Array<{ id: string; field: string; value: string }>) {
        const doc = rows(args.table).find((r) => r._id === patch.id);
        if (doc === undefined) throw new Error(`[fake] patchRefs: ${patch.id} bestaat niet`);
        doc[patch.field] = patch.value;
        patchCalls.push({ table: args.table, ...patch });
      }
      return args.patches.length;
    }
    if (name === "migration:clearTable") {
      const list = rows(args.table);
      const deleted = list.splice(0, args.limit).length;
      return { deleted, remaining: list.length > 0 };
    }
    if (name === "migration:deleteStorageObjects") {
      // Exact deze objecten, geen greep en geen "alles". De opruiming tussen
      // T-2 en T-0 mag de uren upload niet meenemen (WP12 fix-cyclus 2, R2-5).
      let deleted = 0;
      for (const id of args.ids as string[]) {
        if (storage.delete(id)) deleted += 1;
      }
      return { deleted };
    }
    if (name === "migration:clearStorage") {
      const ids = [...storage.keys()].slice(0, args.limit);
      for (const id of ids) storage.delete(id);
      return { deleted: ids.length, remaining: storage.size > 0 };
    }
    if (name === "migration:generateUploadUrls") {
      return Array.from({ length: args.count as number }, (_, i) => `https://fake-upload/${i}`);
    }
    throw new Error(`[fake] onbekende mutation: ${name}`);
  }

  return {
    query,
    mutation,
    insertCalls,
    patchCalls,
    /** Rijen in een tabel, zoals ze in de deployment staan. */
    docs: (table: string): FakeDoc[] => [...rows(table)],
    count: (table: string): number => rows(table).length,
    /** Zet een deployment-toestand neer zonder de tooling te gebruiken. */
    seed: (counts: Record<string, number>): void => {
      for (const [table, n] of Object.entries(counts)) {
        for (let i = 0; i < n; i++) {
          counter += 1;
          rows(table).push({ _id: `${table}_${counter}` });
        }
      }
    },
    putStorage: (storageId: string, bytes = 1024): void => {
      storage.set(storageId, bytes);
    },
    storageCount: (): number => storage.size,
    storageIds: (): string[] => [...storage.keys()],
    hasStorage: (storageId: string): boolean => storage.has(storageId),
    setDrift: (lines: string[]): void => {
      driftLines = lines;
    },
  };
}

export type FakeDeployment = ReturnType<typeof createFakeDeployment>;

/** Nep-bestandslaag: een map in het geheugen, nooit scripts/.data/. */
export function createFakeFiles(initial: Record<string, unknown> = {}) {
  const files = new Map<string, unknown>(Object.entries(initial));
  return {
    files,
    exists: (name: string): boolean => files.has(name),
    read: <T>(name: string): T => {
      if (!files.has(name)) {
        throw new Error(`[fake] ${name} bestaat niet in de werkmap. Draai eerst de stap die 'm maakt.`);
      }
      return files.get(name) as T;
    },
    write: (name: string, value: unknown): string => {
      files.set(name, value);
      return `/fake/.data/${name}`;
    },
    invalidate: (name: string): string | null => {
      if (!files.has(name)) return null;
      files.delete(name);
      return `/fake/.data/${name}.ongeldig`;
    },
  };
}
