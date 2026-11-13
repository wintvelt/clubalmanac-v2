// WP19a invariant 4: `inspect` kent geen ratings meer. Het overzicht per user
// had een kolom met gegeven likes; die gaat weg, want likes migreren niet.
// Spec: docs/work-packages/WP19a-ratings-schrappen.md §Vraag 4.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { buildExtractFile, captureConsole, createFakeFiles } from "./_harness";

const h = vi.hoisted(() => ({ files: null as any }));

vi.mock("../../scripts/migrate/paths.ts", () => ({
  DATA_DIR: "/fake/.data",
  EXTRACT_FILE: "dynamo-extract.json",
  RECORDS_FILE: "convex-records.json",
  STORAGE_MAP_FILE: "storage-map.json",
  MISSING_FILES_FILE: "missing-files.json",
  dataPath: (name: string) => `/fake/.data/${name}`,
  ensureDataDir: () => {},
  dataFileExists: (name: string) => h.files.exists(name),
  readData: (name: string) => h.files.read(name),
  writeData: (name: string, value: unknown) => h.files.write(name, value),
  invalidateData: (name: string) => h.files.invalidate(name),
}));

const { inspect } = await import("../../scripts/migrate/inspect.ts");

beforeEach(() => {
  h.files = createFakeFiles({ "dynamo-extract.json": buildExtractFile() });
});

describe("WP19a: inspect zonder likes", () => {
  test("het overzicht draait op een extract met likes", () => {
    const out = captureConsole();
    expect(() => inspect()).not.toThrow();
    expect(out.log(), "sanity: de kolomkop staat er").toMatch(/userId/);
  });

  test("geen kolom en geen regel noemt likes of ratings", () => {
    const out = captureConsole();
    inspect();
    expect(out.log()).not.toMatch(/like|rating/i);
  });
});
