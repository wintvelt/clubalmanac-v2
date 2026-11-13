// WP25 — gedeelde opbouw voor de formaat-tests.
//
// De functies van WP25 bestaan nog niet als B begint. De referenties lopen
// daarom via `I` (internal, zonder type): pre-impl zijn ze undefined en faalt
// de aanroep (RED om de goede reden), na de impl typecheckt alles gewoon.
//
// Schema (spec §Signaturen): `photos.formats` is een optioneel object
// `{ klein, groot }` met twee `_storage`-ids, beide of geen.

import type { convexTest } from "convex-test";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type T = ReturnType<typeof convexTest>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const I = internal as any;

export type SeededPhoto = {
  photoId: Id<"photos">;
  storageId: Id<"_storage">;
  klein?: Id<"_storage">;
  groot?: Id<"_storage">;
};

/**
 * Eén foto-rij met een origineel in storage, en desgewenst al een set formaten.
 * De inhoud van het origineel is tekst: de gemockte beeldbibliotheek leest hem
 * terug (backfill.test.ts). De formaten zijn tekst ("klein van <original>").
 *
 * WP17d besluit 4: een beeldpad stuurt een origineel nooit meer ongewijzigd
 * door; tekst is geen JPEG en gaat dus niet mee. Een test die het origineel
 * over een beeldpad haalt, geeft `originalBytes` (een echte JPEG, zie
 * tests/_helpers/jpeg.ts); `original` blijft dan het label van de formaten.
 */
export async function seedPhoto(
  t: T,
  ownerId: Id<"users">,
  opts: {
    original?: string;
    originalBytes?: Uint8Array<ArrayBuffer>;
    withFormats?: boolean;
    createdAt?: number;
    exifOrientation?: number;
    width?: number;
    height?: number;
  } = {},
): Promise<SeededPhoto> {
  return await t.run(async (ctx) => {
    const original = opts.original ?? "origineel";
    const storageId = await ctx.storage.store(new Blob([opts.originalBytes ?? original], { type: "image/jpeg" }));
    let formats: { klein: Id<"_storage">; groot: Id<"_storage"> } | undefined;
    if (opts.withFormats) {
      formats = {
        klein: await ctx.storage.store(new Blob([`klein van ${original}`], { type: "image/jpeg" })),
        groot: await ctx.storage.store(new Blob([`groot van ${original}`], { type: "image/jpeg" })),
      };
    }
    const doc = {
      ownerId,
      storageId,
      createdAt: opts.createdAt ?? Date.now(),
      ...(opts.exifOrientation !== undefined ? { exifOrientation: opts.exifOrientation } : {}),
      ...(opts.width !== undefined ? { width: opts.width } : {}),
      ...(opts.height !== undefined ? { height: opts.height } : {}),
      ...(formats ? { formats } : {}),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const photoId = await ctx.db.insert("photos", doc as any);
    return { photoId, storageId, ...(formats ?? {}) };
  });
}

/** Het `formats`-veld van een foto, of undefined. */
export async function formatsOf(
  t: T,
  photoId: Id<"photos">,
): Promise<{ klein: Id<"_storage">; groot: Id<"_storage"> } | undefined> {
  const photo = await t.run((ctx) => ctx.db.get(photoId));
  return (photo as { formats?: { klein: Id<"_storage">; groot: Id<"_storage"> } } | null)?.formats;
}

/** Bestaat dit object nog in storage? */
export async function exists(t: T, id: Id<"_storage">): Promise<boolean> {
  return (await t.run((ctx) => ctx.db.system.get(id))) !== null;
}

/** De tekst van een object in storage, of null. */
export async function textOf(t: T, id: Id<"_storage">): Promise<string | null> {
  return await t.run(async (ctx) => {
    const blob = await ctx.storage.get(id);
    return blob ? await blob.text() : null;
  });
}

/** Het aantal objecten in storage. */
export async function storageCount(t: T): Promise<number> {
  return (await t.run((ctx) => ctx.db.system.query("_storage").collect())).length;
}
