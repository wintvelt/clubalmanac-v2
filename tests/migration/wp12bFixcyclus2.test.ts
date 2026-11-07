// WP12b fix-cyclus 2 (G2) — RED tests: de acceptatievlag komt aan.
//
// De heraudit liet zien dat geen test omviel als de vlag in `runTransform.ts`
// of `cli.ts` hard op "aan" stond. Dan stopt de transform nooit, en wist de
// FL1-cron de gemelde foto's na T0 zonder dat iemand dat koos. Deze tests lezen
// de keten af waar de operator hem gebruikt: het commando en zijn argumenten.
//
// Geen test raakt scripts/.data/: de bestandslaag is vervangen, zoals in de
// andere migratie-suites.

import { beforeAll, describe, expect, test, vi } from "vitest";
import { buildExtractFile, createFakeFiles } from "./_harness";
import { ALICE, BOB, buildExtractWithCovers, CAROL, DAVE, PROD_SUBJECTS, type SourceItem } from "./fixture";

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

// `cli.ts` importeert alle commando's; geen enkele mag hier een deployment raken.
vi.mock("../../scripts/migrate/convexAdmin.ts", () => ({
  makeAdminClient: () => {
    throw new Error("[test] geen deployment in deze suite");
  },
  runQuery: () => {
    throw new Error("[test] geen deployment in deze suite");
  },
  runMutation: () => {
    throw new Error("[test] geen deployment in deze suite");
  },
}));

const { runTransform } = await import("../../scripts/migrate/runTransform.ts");

const NOW = Date.parse("2026-08-23T00:00:00.000Z");
const RECORDS = "convex-records.json";

type RunOptions = Parameters<typeof runTransform>[2];

/** De fixture met een gemelde foto, verwijderdatum in de toekomst (G1). */
function extractWithFlag(): SourceItem[] {
  return buildExtractWithCovers().map((item) =>
    item.PK === "POP-bob-1"
      ? { ...item, flaggedDate: "2026-08-20", flaggedBy: "U-carol", flagged: "flagged", flaggedDeleteDate: "2026-09-03" }
      : item,
  );
}

/** De werkmap zoals op T0: extract plus prod-config (email → Clerk-ID). */
function putWorkdir(items: SourceItem[]): void {
  const email = (user: { email: string }) => user.email.toLowerCase();
  h.files = createFakeFiles({
    "dynamo-extract.json": buildExtractFile(items),
    "prod-config.json": {
      clerkIdByEmail: {
        [email(ALICE)]: PROD_SUBJECTS["U-alice"],
        [email(BOB)]: PROD_SUBJECTS["U-bob"],
        [email(CAROL)]: PROD_SUBJECTS["U-carol"],
        [email(DAVE)]: PROD_SUBJECTS["U-dave"],
      },
    },
  });
}

describe("WP12b G2: runTransform geeft de vlag door", () => {
  test("premisse: zonder gemelde foto schrijft runTransform gewoon zijn records", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    putWorkdir(buildExtractWithCovers());
    runTransform("prod", NOW);
    expect(h.files.exists(RECORDS)).toBe(true);
  });

  test("zonder de optie: stop, en geen convex-records.json", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    putWorkdir(extractWithFlag());
    expect(() => runTransform("prod", NOW)).toThrow(/P-bob-1/);
    expect(h.files.exists(RECORDS), "records geschreven ondanks de stop").toBe(false);
  });

  test("met acceptFlaggedDeletion: door, records geschreven, waarschuwing voor de foto", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    putWorkdir(extractWithFlag());
    const file = runTransform("prod", NOW, { acceptFlaggedDeletion: true } as unknown as RunOptions);
    expect(h.files.exists(RECORDS)).toBe(true);
    expect(file.warnings.some((w) => w.includes("P-bob-1") && /flaggedDeleteDate|verwijder/i.test(w))).toBe(
      true,
    );
  });

  test("de oude optienaam zet niets aan", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    putWorkdir(extractWithFlag());
    expect(() =>
      runTransform("prod", NOW, { acceptExpiredFlags: true } as unknown as RunOptions),
    ).toThrow(/P-bob-1/);
  });
});

// ── CLI: van argument naar optie ──────────────────────────────────────

type TransformOptions = (argv: string[]) => { acceptFlaggedDeletion?: boolean };

let transformOptions: TransformOptions | undefined;
let printedOnImport = "";

beforeAll(async () => {
  // Vangnet zolang `main()` nog bij elke import draait: met `--help` doet hij
  // niets anders dan de uitleg printen. Precies die uitvoer is de aflezing.
  const saved = process.argv;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  process.argv = [saved[0] ?? "node", "/fake/cli.ts", "--help"];
  try {
    const cli = (await import("../../scripts/migrate/cli.ts")) as Record<string, unknown>;
    transformOptions = cli.transformOptions as TransformOptions | undefined;
  } finally {
    process.argv = saved;
    printedOnImport = log.mock.calls.flat().map(String).join("\n");
    log.mockRestore();
  }
});

describe("WP12b G2: cli.ts vertaalt de argumenten van transform", () => {
  test("een import van cli.ts start geen commando", () => {
    expect(printedOnImport, "main() draaide bij de import").toBe("");
  });

  test("cli.ts exporteert transformOptions", () => {
    expect(typeof transformOptions).toBe("function");
  });

  test("--accept-flagged-deletion zet de vlag aan", () => {
    const options = transformOptions?.(["transform", "--target", "prod", "--accept-flagged-deletion"]);
    expect(options?.acceptFlaggedDeletion).toBe(true);
  });

  test("zonder de vlag, of met de oude vlag, staat hij uit", () => {
    expect(transformOptions?.(["transform", "--target", "prod"])?.acceptFlaggedDeletion).toBe(false);
    expect(
      transformOptions?.(["transform", "--target", "prod", "--accept-expired-flags"])?.acceptFlaggedDeletion,
    ).toBe(false);
  });
});
