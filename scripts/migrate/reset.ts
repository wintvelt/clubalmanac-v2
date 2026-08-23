// WP12 — stap 7: `reset`. De doel-deployment leegmaken.
//
// Standaard alleen de tabellen. Dat is bewust: in het gefaseerde prod-scenario
// staan de bestanden al sinds T-2 in storage, en een reset vlak vóór T-0 mag
// die uren upload niet weggooien.
//
// `--all` leegt óók de storage. Dan wordt storage-map.json in dezelfde beweging
// ongeldig gemaakt (hernoemd): blijft hij staan, dan verwijst een volgende
// `load-records` naar storage-ID's die niet meer bestaan — een stille
// corruptie-route.
//
// Dit is de duurste knop in dit werkpakket. Vandaar: expliciete --yes, en tegen
// prod bovendien MIGRATE_ALLOW_PROD=yes (zie convexAdmin.ts).

import { internal } from "../../convex/_generated/api.js";
import type { Target } from "./config.ts";
import { makeAdminClient, runMutation, runQuery } from "./convexAdmin.ts";
import { STORAGE_MAP_FILE, invalidateData } from "./paths.ts";
import { TABLE_ORDER } from "./types.ts";

const BATCH = 200;

export async function reset(target: Target, all: boolean, confirmed: boolean): Promise<number> {
  const admin = makeAdminClient(target, true);
  if (!confirmed) {
    throw new Error(
      `[reset] weigert zonder --yes. Dit leegt ${all ? "alle tabellen én de storage" : "alle tabellen"} ` +
        `op ${admin.url}.`,
    );
  }
  console.log(`[reset] doel: ${target} (${admin.url})`);

  // De te legen set is letterlijk de set die `tableCounts` telt — dus ook de
  // tabellen die de import zelf niet vult maar WP10 wél bewaakt
  // (`uploadIdempotency`). Twee lijsten die uit elkaar kunnen lopen zijn een
  // ontwerpfout (WP12 fix-cyclus 1, B-2): blijft er één tabel achter, dan
  // weigert de volgende `load-records` — of, erger, hij slaagt en de dagelijkse
  // scan meldt de ochtend erna dangling FK's naar verwijderde users.
  const before = await runQuery(admin, internal.migration.tableCounts, {});
  const counted = Object.keys(before.tables);
  const ordered = [
    ...counted.filter((table) => !(TABLE_ORDER as readonly string[]).includes(table)),
    ...[...TABLE_ORDER].reverse().filter((table) => counted.includes(table)),
  ];
  for (const table of ordered) {
    let deleted = 0;
    for (;;) {
      const result = await runMutation(admin, internal.migration.clearTable, { table, limit: BATCH });
      deleted += result.deleted;
      if (!result.remaining) break;
    }
    if (deleted > 0) console.log(`[reset] ${table.padEnd(16)} ${deleted} rijen verwijderd`);
  }

  if (all) {
    let deleted = 0;
    for (;;) {
      const result = await runMutation(admin, internal.migration.clearStorage, { limit: BATCH });
      deleted += result.deleted;
      if (!result.remaining) break;
    }
    console.log(`[reset] storage: ${deleted} object(en) verwijderd (van ${before.storageObjects})`);
    const moved = invalidateData(STORAGE_MAP_FILE);
    console.log(
      moved === null
        ? `[reset] geen storage-map.json om ongeldig te maken`
        : `[reset] storage-map.json ongeldig gemaakt → ${moved}`,
    );
  } else {
    console.log(
      `[reset] storage onaangeroerd (${before.storageObjects} objecten). ` +
        `storage-map.json blijft geldig; gebruik --all om ook de bestanden te wissen.`,
    );
  }
  return 0;
}
