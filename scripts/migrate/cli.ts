// WP12 — CLI. Negen losse commando's, geen enkele knop (WP25: `formaten`).
//
//   node scripts/migrate/cli.ts <commando> --target dev|prod [opties]
//   npm run migrate -- <commando> --target dev
//
// `extract` is traag en de uitkomst is herbruikbaar; bij het itereren op
// `transform` mag DynamoDB niet opnieuw geraakt worden. Vandaar de splitsing.
// De splitsing tussen `load-files` en `load-records` is geen netheid maar
// noodzaak — zie §Gefaseerde prod-run in de WP-spec.
//
// Runbook: docs/runbooks/wp12-data-migratie.md.

import { extract } from "./extract.ts";
import { formaten } from "./formaten.ts";
import type { Id } from "../../convex/_generated/dataModel.js";
import { inspect } from "./inspect.ts";
import { loadFiles } from "./loadFiles.ts";
import { loadRecords } from "./loadRecords.ts";
import { pruneStorage } from "./pruneStorage.ts";
import { reset } from "./reset.ts";
import { runTransform } from "./runTransform.ts";
import { verify } from "./verify.ts";
import type { Target } from "./config.ts";

const USAGE = `
migratie-tooling (WP12) — DynamoDB + S3 → Convex

  node scripts/migrate/cli.ts <commando> --target dev|prod [opties]

commando's
  extract         DynamoDB volledig scannen → scripts/.data/dynamo-extract.json
  inspect         overzicht per user uit het extract (om de 3 chosen te kiezen)
  transform       extract + config → scripts/.data/convex-records.json
  load-files      foto's uit S3 → Convex-storage (hervatbaar)
  load-records    de records → de Convex-tabellen (niet hervatbaar; reset + opnieuw)
  formaten        backfill van de formaten klein/groot (WP25; na load-records, vóór verify)
  verify          tellingen, storage twee kanten op, WP10-integriteitsscan
  prune-storage   wist exact de storage-objecten waar niets meer naar verwijst
  reset           tabellen leegmaken; met --all ook de storage

opties
  --target dev|prod          verplicht, behalve bij inspect/extract
  --yes                      bevestiging voor reset en prune-storage
  --all                      reset wist ook de storage (en de storage-map)
  --accept-missing-files     load-records mag doorgaan met ontbrekende S3-objecten
  --accept-expired-flags     transform mag doorgaan met gemelde foto's waarvan de
                             verwijderdatum verstreken is (FL1 wist ze na het laden)
  --batch-size N             formaten: foto's per action (1..50, standaard 20)
  --accept-no-formats ID,…   formaten: teken deze foto's af als "mag zonder formaten"
                             (blijvend in de DB; alleen wat in deze run mislukte)
  --unaccept ID,…            formaten: draai de aftekening terug; de run probeert ze weer

omgeving (.env.migrate, gitignored)
  MIGRATE_CONVEX_URL_DEV / _PROD, MIGRATE_CONVEX_ADMIN_KEY_DEV / _PROD
  MIGRATE_ALLOW_PROD=yes     verplicht voor élke schrijf-actie op prod
  MIGRATE_AWS_REGION / MIGRATE_DYNAMO_TABLE / MIGRATE_S3_BUCKET (optioneel)
  AWS-credentials via de gebruikelijke AWS_*-vars of AWS_PROFILE (read-only)
`;

function parseTarget(argv: string[]): Target {
  const index = argv.indexOf("--target");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value !== "dev" && value !== "prod") {
    throw new Error(`[migrate] --target dev|prod is verplicht voor dit commando.`);
  }
  return value;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const has = (flag: string) => argv.includes(flag);

  switch (command) {
    case "extract":
      await extract();
      return 0;
    case "inspect":
      inspect();
      return 0;
    case "transform":
      runTransform(parseTarget(argv), Date.now(), {
        acceptExpiredFlags: has("--accept-expired-flags"),
      });
      return 0;
    case "load-files":
      return await loadFiles(parseTarget(argv));
    case "load-records":
      return await loadRecords(parseTarget(argv), has("--accept-missing-files"));
    case "formaten": {
      const index = argv.indexOf("--batch-size");
      const idList = (flag: string): Id<"photos">[] => {
        const at = argv.indexOf(flag);
        if (at < 0) return [];
        const value = argv[at + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new Error(`[migrate] ${flag} verwacht foto-id's: <id>[,<id>…]`);
        }
        return value.split(",").map((x) => x.trim()).filter(Boolean) as Id<"photos">[];
      };
      return await formaten(
        parseTarget(argv),
        index >= 0 ? Number(argv[index + 1]) : undefined,
        idList("--accept-no-formats"),
        idList("--unaccept"),
      );
    }
    case "verify":
      return await verify(parseTarget(argv));
    case "prune-storage":
      return await pruneStorage(parseTarget(argv), has("--yes"));
    case "reset":
      return await reset(parseTarget(argv), has("--all"), has("--yes"));
    default:
      console.log(USAGE);
      return command === undefined || command === "--help" || command === "help" ? 0 : 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
