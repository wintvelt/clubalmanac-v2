"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { makeFormatImages } from "./lib/photoFormats";
import { selfTestHeic, selfTestJpeg } from "./lib/selfTestImages";

// WP25 — de formaat-stap (besluit 1: optie A).
//
// `makeFormats` maakt *klein* en *groot* voor één foto. `createFromUploadInternal`
// plant hem na elke upload in; de backfill (`backfill`, CLI `formaten`) doet
// dezelfde stap voor bestaande foto's, in batches, één foto tegelijk (spike:
// 512 MB per Node-action, ~1 core).
//
// Het vastleggen gebeurt in `internal.photos.attachFormats`: formaten, stand
// en afmetingen in één schrijfactie (A-invariant 12), en de eerste set blijft
// (A-invariant 17). Deze file draait in Node (sharp, heic-decode); mutations
// en queries staan in photos.ts.

type Outcome = "created" | "alreadyDone" | "gone" | "failed";

type BatchResult = {
  cursor: string | null;
  created: number;
  alreadyDone: number;
  gone: number;
  failed: Id<"photos">[];
};

const outcome = v.union(
  v.literal("created"),
  v.literal("alreadyDone"),
  v.literal("gone"),
  v.literal("failed"),
);

async function storeJpeg(ctx: ActionCtx, bytes: Uint8Array): Promise<Id<"_storage">> {
  return await ctx.storage.store(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }));
}

async function makeFormatsFor(ctx: ActionCtx, photoId: Id<"photos">): Promise<Outcome> {
  const photo: { storageId: Id<"_storage">; hasFormats: boolean } | null = await ctx.runQuery(
    internal.photos.formatInfo,
    { photoId },
  );
  if (!photo) return "gone";
  // Een set met een ontbrekend object telt als geen set (A-invariant 22).
  if (photo.hasFormats) return "alreadyDone";

  const blob = await ctx.storage.get(photo.storageId);
  if (!blob) {
    console.error(`[photoFormats] mislukt photoId=${photoId}: origineel ontbreekt in storage`);
    return "failed";
  }

  let images;
  try {
    // Geen `Blob.slice` in Convex (convex-runtimes.md): de hele buffer.
    images = await makeFormatImages(new Uint8Array(await blob.arrayBuffer()));
  } catch (e) {
    // Bv. "te groot (24.5 MP, grens 16 MP)" (A-invariant 20) of geen beeld.
    console.error(`[photoFormats] mislukt photoId=${photoId}: ${e instanceof Error ? e.message : String(e)}`);
    return "failed";
  }

  // Opslaan, dan vastleggen. Mislukt het vastleggen, dan gaan de nieuwe
  // objecten weer weg. Een crash precies tussen die twee laat wezen achter;
  // WP10 meldt die (A-invariant 17).
  const stored: Id<"_storage">[] = [];
  try {
    const klein = await storeJpeg(ctx, images.klein);
    stored.push(klein);
    const groot = await storeJpeg(ctx, images.groot);
    stored.push(groot);
    const result = await ctx.runMutation(internal.photos.attachFormats, {
      photoId,
      klein,
      groot,
      width: images.width,
      height: images.height,
      exifOrientation: images.exifOrientation,
    });
    return result === "attached" ? "created" : result;
  } catch (e) {
    for (const id of stored) {
      try {
        await ctx.storage.delete(id);
      } catch {
        // Best-effort; WP10 ziet een achtergebleven object als wees.
      }
    }
    console.error(`[photoFormats] mislukt photoId=${photoId}: opslaan of vastleggen`, e);
    return "failed";
  }
}

/** De stap voor één foto. Ingepland na de upload. */
export const makeFormats = internalAction({
  args: { photoId: v.id("photos") },
  returns: outcome,
  handler: async (ctx, { photoId }): Promise<Outcome> => await makeFormatsFor(ctx, photoId),
});

/**
 * A-invariant 24: laadt en draait de beeldbibliotheek op een ingebouwde JPEG en
 * HEIC. Schrijft niets. `formaten` roept hem aan vóór de eerste batch, zodat
 * ook een run op een lege deployment (de key-controle op T-2) sharp en
 * heic-decode test. Gooit als de bibliotheek niet laadt of niet decodeert.
 */
export const selfTest = internalAction({
  args: {},
  returns: v.object({
    jpeg: v.object({ width: v.number(), height: v.number() }),
    heic: v.object({ width: v.number(), height: v.number() }),
  }),
  handler: async () => {
    const jpeg = await makeFormatImages(selfTestJpeg());
    const heic = await makeFormatImages(selfTestHeic());
    return {
      jpeg: { width: jpeg.width, height: jpeg.height },
      heic: { width: heic.width, height: heic.height },
    };
  },
});

/**
 * Eén batch van de backfill, in vaste volgorde. `cursor: null` in de uitkomst
 * betekent dat de doorloop klaar is. Een tweede doorloop verandert niets: een
 * foto met formaten telt als `alreadyDone` (invariant 11). Een foto die mislukt
 * blokkeert de rest niet en staat met zijn id in `failed`.
 */
export const backfill = internalAction({
  args: { cursor: v.union(v.string(), v.null()), batchSize: v.number() },
  returns: v.object({
    cursor: v.union(v.string(), v.null()),
    created: v.number(),
    alreadyDone: v.number(),
    gone: v.number(),
    failed: v.array(v.id("photos")),
  }),
  handler: async (ctx, { cursor, batchSize }): Promise<BatchResult> => {
    const started = Date.now();
    const batch: { photos: { photoId: Id<"photos">; hasFormats: boolean }[]; cursor: string | null } =
      await ctx.runQuery(internal.photos.formatBatch, { cursor, batchSize });
    const result: BatchResult = { cursor: batch.cursor, created: 0, alreadyDone: 0, gone: 0, failed: [] };
    let peakRss = process.memoryUsage().rss;
    for (const { photoId, hasFormats } of batch.photos) {
      const r: Outcome = hasFormats ? "alreadyDone" : await makeFormatsFor(ctx, photoId);
      if (r === "failed") result.failed.push(photoId);
      else result[r] += 1;
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    // De meting voor het runbook (pre-flight 5): tijd en piek-RSS per batch.
    console.log(
      `[photoFormats] batch photos=${batch.photos.length} created=${result.created} ` +
        `alreadyDone=${result.alreadyDone} gone=${result.gone} failed=${result.failed.length} ` +
        `ms=${Date.now() - started} peakRssMB=${Math.round(peakRss / 1_048_576)}`,
    );
    return result;
  },
});
