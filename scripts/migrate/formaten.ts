// WP25 — `formaten`: de backfill van de formaten *klein* en *groot*.
//
// Op T0 na `load-records` en vóór `verify` (WP25 §De T0-keten). Leest alleen
// foto-rijen en originelen; schrijft per foto de formaten en, als die nog
// leeg is, de stand uit het bestand (A-invariant 12), in één schrijfactie.
//
// Eerst `selfTest` (A-invariant 24): laadt de beeldbibliotheek niet, dan stopt
// hij vóór de eerste batch. Daarna batches van `internal.photoFormats.backfill`,
// één foto tegelijk in de action (512 MB per Node-action). Gemeten op dev: ~50 s
// per batch van 20. Hooguit 50 per batch (A-invariant 23): de HTTP-aanroep
// heeft een time-out van 300 s.
//
// Valt een batch-action om (geheugen, time-out; A-invariant 21), dan doet de
// CLI die pagina nog eens, nu elke foto zonder formaten in een eigen action.
// Valt die ook om, dan telt die foto als mislukt en gaat de CLI door.
//
// Hervatbaar zonder eigen staat: een nieuwe run begint vooraan en slaat elke
// foto met formaten over (invariant 11). Breekt hij af, start hem opnieuw.
//
// Exitcode 0 alleen als na de run geen foto meer zonder formaten is en niets
// mislukte. Op T0 lopen deze commando's in een keten; de operator leest de
// exitcode.

import { internal } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { Target } from "./config.ts";
import { makeAdminClient, runAction, runQuery, type AdminClient } from "./convexAdmin.ts";

const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;

type Totals = { created: number; alreadyDone: number; gone: number; failed: Id<"photos">[] };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * De pagina van een afgebroken batch, foto voor foto. Geeft de cursor van de
 * volgende pagina terug.
 */
async function photoByPhoto(
  admin: AdminClient,
  cursor: string | null,
  batchSize: number,
  total: Totals,
): Promise<string | null> {
  const page = await runQuery(admin, internal.photos.formatBatch, { cursor, batchSize });
  for (const { photoId, hasFormats } of page.photos) {
    if (hasFormats) {
      total.alreadyDone += 1;
      continue;
    }
    try {
      const r = await runAction(admin, internal.photoFormats.makeFormats, { photoId });
      if (r === "failed") {
        total.failed.push(photoId);
        console.log(`[formaten]   ${photoId}: mislukt (reden in de Convex-log)`);
      } else {
        total[r] += 1;
      }
    } catch (error) {
      total.failed.push(photoId);
      console.log(`[formaten]   ${photoId}: action brak af — ${message(error)}`);
    }
  }
  return page.cursor;
}

export async function formaten(target: Target, batchSize = DEFAULT_BATCH): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH) {
    throw new Error(`[formaten] --batch-size moet 1..${MAX_BATCH} zijn, kreeg ${batchSize}`);
  }
  const admin = makeAdminClient(target, true);
  console.log(`[formaten] doel: ${target} (${admin.url}), batch ${batchSize}`);

  try {
    const self = await runAction(admin, internal.photoFormats.selfTest, {});
    console.log(
      `[formaten] beeldbibliotheek: ok (JPEG ${self.jpeg.width}×${self.jpeg.height}, ` +
        `HEIC ${self.heic.width}×${self.heic.height})`,
    );
  } catch (error) {
    console.error(
      `[formaten] beeldbibliotheek werkt niet op de deployment: ${message(error)}\n` +
        `[formaten] geen batch gedraaid. Controleer sharp en heic-decode (package.json, convex.json) en deploy opnieuw.`,
    );
    return 1;
  }

  const before = await runQuery(admin, internal.photos.formatStatus, {});
  console.log(
    `[formaten] vóór: ${before.photos} foto's, ${before.withFormats} met formaten, ` +
      `${before.withoutFormats} zonder, ${before.withExifOrientation} met exifOrientation`,
  );

  const total: Totals = { created: 0, alreadyDone: 0, gone: 0, failed: [] };
  const started = Date.now();
  let cursor: string | null = null;
  let batch = 0;
  do {
    batch += 1;
    const t0 = Date.now();
    let r;
    try {
      r = await runAction(admin, internal.photoFormats.backfill, { cursor, batchSize });
    } catch (error) {
      console.log(
        `[formaten] batch ${String(batch).padStart(3)}: action brak af (${message(error)}); ` +
          `deze batch nu foto voor foto`,
      );
      const failedBefore = total.failed.length;
      try {
        cursor = await photoByPhoto(admin, cursor, batchSize, total);
      } catch (inner) {
        console.error(
          `[formaten] batch ${batch} brak af: ${message(inner)}\n` +
            `[formaten] wat klaar is, blijft klaar. Start hetzelfde commando opnieuw; het slaat ` +
            `foto's met formaten over.`,
        );
        return 1;
      }
      console.log(
        `[formaten] batch ${String(batch).padStart(3)}: foto voor foto klaar, ` +
          `mislukt ${total.failed.length - failedBefore} — ${((Date.now() - t0) / 1000).toFixed(1)} s`,
      );
      continue;
    }
    total.created += r.created;
    total.alreadyDone += r.alreadyDone;
    total.gone += r.gone;
    total.failed.push(...r.failed);
    console.log(
      `[formaten] batch ${String(batch).padStart(3)}: gemaakt ${r.created}, al klaar ${r.alreadyDone}, ` +
        `weg ${r.gone}, mislukt ${r.failed.length}` +
        (r.failed.length > 0 ? ` (${r.failed.join(", ")})` : "") +
        ` — ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    );
    cursor = r.cursor;
  } while (cursor !== null);

  const after = await runQuery(admin, internal.photos.formatStatus, {});
  console.log(
    `\n[formaten] totaal: gemaakt ${total.created}, al klaar ${total.alreadyDone}, weg ${total.gone}, ` +
      `mislukt ${total.failed.length} — ${batch} batch(es), ${((Date.now() - started) / 60000).toFixed(1)} min`,
  );
  if (total.failed.length > 0) {
    console.log(`[formaten] mislukt (foto-id's; reden in de Convex-log, '[photoFormats] mislukt'):`);
    for (const id of total.failed) console.log(`  - ${id}`);
  }
  console.log(
    `[formaten] na: ${after.photos} foto's, ${after.withFormats} met formaten, ` +
      `${after.withoutFormats} zonder, ${after.withExifOrientation} met exifOrientation`,
  );

  if (after.withoutFormats > 0 || total.failed.length > 0) {
    console.error(
      `\n[formaten] NIET KLAAR: ${after.withoutFormats} foto('s) zonder formaten, ` +
        `${total.failed.length} mislukt. Een nieuwe upload tijdens de run krijgt zijn formaten zelf; ` +
        `draai het commando opnieuw en bekijk de mislukte foto's.`,
    );
    return 1;
  }
  console.log(`\n[formaten] klaar: elke foto heeft zijn formaten.`);
  return 0;
}
