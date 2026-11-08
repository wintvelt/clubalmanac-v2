import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireCurrentUser } from "./users";
import { getMembership, NOT_MEMBER } from "./groups";
import { requireWebmaster } from "./lib/auth";
import { canAccessPhoto } from "./lib/photoAccess";
import {
  allFlagFields,
  hasFormatsField,
  ownFlagFields,
  photo as photoShape,
  photoFields,
  pick,
  publicProfile,
  publicProfileFields,
} from "./lib/shapes";
import { avatarFieldsOf } from "./lib/profilePhoto";
import { hasCompleteFormats, photoView } from "./lib/formatSet";
import {
  applyOrientation,
  rotationSwapsDimensions,
} from "./lib/exifOrientation";

const DAY_MS = 24 * 60 * 60 * 1000;
const FLAG_DELETE_DAYS = 14;
const DENY_DELETE_DAYS = 7;

// WP23: foto-toegang (definitie in lib/photoAccess). Eén error voor "foto
// bestaat niet" en "geen toegang" (invariant 4).
const NO_PHOTO_ACCESS = "Geen toegang tot deze foto";

export async function requirePhotoAccess(
  ctx: QueryCtx,
  photoId: Id<"photos">,
): Promise<{ user: Doc<"users">; photo: Doc<"photos"> }> {
  const user = await requireCurrentUser(ctx);
  const photo = await ctx.db.get(photoId);
  if (!photo || !(await canAccessPhoto(ctx, user._id, photo))) {
    throw new Error(NO_PHOTO_ACCESS);
  }
  return { user, photo };
}

// WP17a invariant 7: de foto-reads achter het detail geven bij geen toegang
// en bij een onbekende of gewiste foto dezelfde ConvexError met code
// NOT_MEMBER (zoals de album- en groep-reads). Mutations en ratings houden
// requirePhotoAccess.
async function requirePhotoAccessForRead(
  ctx: QueryCtx,
  photoId: Id<"photos">,
): Promise<{ user: Doc<"users">; photo: Doc<"photos"> }> {
  const user = await requireCurrentUser(ctx);
  const photo = await ctx.db.get(photoId);
  if (!photo || !(await canAccessPhoto(ctx, user._id, photo))) {
    throw new ConvexError(NOT_MEMBER);
  }
  return { user, photo };
}

// Cat-1 join-on-read: photo + owner data, vervangt denormalized
// user-velden op photos uit DynamoDB. Cascade matrix row U3.
// WP23: owner als publiek profiel (geen email/subject).
export const getWithOwner = query({
  args: { photoId: v.id("photos") },
  returns: v.object({ ...photoFields, ...hasFormatsField, owner: v.union(publicProfile, v.null()) }),
  handler: async (ctx, { photoId }) => {
    const { photo } = await requirePhotoAccessForRead(ctx, photoId);
    const owner = await ctx.db.get(photo.ownerId);
    return {
      ...(await photoView(ctx, photo)),
      owner: owner
        ? { ...pick(owner, publicProfileFields), ...(await avatarFieldsOf(ctx, owner)) }
        : null,
    };
  },
});

export const getById = query({
  args: { photoId: v.id("photos") },
  returns: photoShape,
  handler: async (ctx, { photoId }) => {
    const { photo } = await requirePhotoAccessForRead(ctx, photoId);
    return await photoView(ctx, photo);
  },
});

// WP23: alleen eigen foto's. Een andere ownerId geeft een lege lijst; geen
// scherm toont foto's van een ander per eigenaar.
export const listByOwner = query({
  args: { ownerId: v.id("users") },
  returns: v.array(photoShape),
  handler: async (ctx, { ownerId }) => {
    const user = await requireCurrentUser(ctx);
    if (ownerId !== user._id) return [];
    const rows = await ctx.db
      .query("photos")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    return await Promise.all(rows.map((p) => photoView(ctx, p)));
  },
});

/**
 * Test fixture helper voor photo creation met client-parsed EXIF args.
 * Productie-flow gaat via POST /upload (httpAction in convex/http.ts) met
 * server-mediated EXIF extractie en geocoding. Deze mutation wordt momenteel
 * door tests gebruikt als fixture om photo records te creëren zonder de hele
 * upload-pipeline te doorlopen.
 *
 * NB: Photo-limit gate gebruikt typed sentinel "PHOTO_LIMIT_REACHED" voor
 * consistency met createFromUploadInternal. Match exact ===, niet substring.
 *
 * WP24 invariant 8: intern, want een publieke variant maakte de caller
 * eigenaar van elk beeld-id dat hij kende. Eigenaar blijft de ingelogde
 * caller (fixtures roepen hem via withUser aan). Geen beeld-gate hier: er
 * komt geen user-input binnen.
 */
// P6: photo create increments user.photoCount (cat-2 transactional aggregate).
export const create = internalMutation({
  args: {
    storageId: v.id("_storage"),
    filename: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    takenAt: v.optional(v.number()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    locationLabel: v.optional(v.string()),
  },
  returns: v.id("photos"),
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    if (user.photoCount >= user.photoLimit) {
      throw new Error("PHOTO_LIMIT_REACHED");
    }

    const photoId = await ctx.db.insert("photos", {
      ownerId: user._id,
      storageId: args.storageId,
      filename: args.filename,
      mimeType: args.mimeType,
      width: args.width,
      height: args.height,
      takenAt: args.takenAt,
      latitude: args.latitude,
      longitude: args.longitude,
      locationLabel: args.locationLabel,
      ratingCount: 0,
      createdAt: Date.now(),
    });

    await ctx.db.patch(user._id, { photoCount: user.photoCount + 1 });

    return photoId;
  },
});

// Internal mutation aangeroepen door POST /upload (convex/http.ts) na
// ctx.storage.store(blob). Maakt een minimal photo record en queue't
// extractMetadata voor server-side EXIF-parsing + geocoding.
//
// Audit-cyclus-1: deze mutation patcht óók de reservation naar status=
// "completed" in dezelfde transactie als de photo-insert. Atomair: een
// commit-failure laat geen window open waarin photo bestaat maar
// reservation nog in_progress is. De httpAction passeert de reservationId.
//
// Geen idempotency-check hier: die zit in de httpAction (reserve mutation
// pre-flight). Auth + ownerId-resolutie ook in de httpAction.
//
// P6: increment user.photoCount + photoLimit-gate. Typed sentinel
// "PHOTO_LIMIT_REACHED" laat de httpAction storage-blob + reservation
// opruimen.
//
// WP18 A-keuze 1: met `albumId` komen de foto en zijn plek in het album in
// deze ene transactie, of geen van beide. Het lidmaatschap wordt hier
// opnieuw getoetst (de httpAction toetste vóór reservering en opslag); is het
// weg, dan de sentinel "NO_ALBUM_ACCESS" en ruimt de httpAction op. De
// uploader is de toevoeger; `addedAt` laat de teller bij de andere leden
// oplopen (AP1).
// WP18 A-keuze 2 en vraag 2: `takenAt`, `latitude` en `longitude` uit de
// headers. `extractMetadata` overschrijft ze alleen met waarden uit het
// bestand zelf (`patchMetadata` slaat ontbrekende velden over).
export const UPLOAD_NO_ALBUM_ACCESS = "NO_ALBUM_ACCESS";

export const createFromUploadInternal = internalMutation({
  args: {
    storageId: v.id("_storage"),
    ownerId: v.id("users"),
    reservationId: v.id("uploadIdempotency"),
    filename: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    albumId: v.optional(v.id("albums")),
    takenAt: v.optional(v.number()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
  },
  returns: v.id("photos"),
  handler: async (
    ctx,
    {
      storageId,
      ownerId,
      reservationId,
      filename,
      mimeType,
      albumId,
      takenAt,
      latitude,
      longitude,
    },
  ) => {
    const user = await ctx.db.get(ownerId);
    if (!user) throw new Error("User bestaat niet");
    if (user.photoCount >= user.photoLimit) {
      // Audit-cyclus-1: typed sentinel string i.p.v. Nederlandstalige
      // "limiet"-substring match in de http handler.
      throw new Error("PHOTO_LIMIT_REACHED");
    }

    let album: Doc<"albums"> | null = null;
    if (albumId) {
      album = await ctx.db.get(albumId);
      const membership = album
        ? await getMembership(ctx, ownerId, album.groupId)
        : null;
      if (!album || !membership) throw new Error(UPLOAD_NO_ALBUM_ACCESS);
    }

    const now = Date.now();
    const photoId = await ctx.db.insert("photos", {
      ownerId,
      storageId,
      filename,
      mimeType,
      takenAt,
      latitude,
      longitude,
      ratingCount: 0,
      createdAt: now,
    });

    await ctx.db.patch(ownerId, { photoCount: user.photoCount + 1 });

    if (album) {
      await ctx.db.insert("albumPhotos", {
        albumId: album._id,
        photoId,
        groupId: album.groupId,
        addedAt: now,
        addedBy: ownerId,
      });
    }

    await ctx.db.patch(reservationId, {
      status: "completed",
      photoId,
      completedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.photoMetadata.extractMetadata, {
      photoId,
    });
    // WP25 invariant 2: de formaten (en de stand uit het bestand, A-inv. 12)
    // komen kort na de upload, ongeacht wie uploadt.
    await ctx.scheduler.runAfter(0, internal.photoFormats.makeFormats, {
      photoId,
    });

    return photoId;
  },
});

// Owner-only update — gebruikt voor manuele EXIF/locatie correctie of
// async geocoding-action. Strict subset van velden, owner check binnen.
export const update = mutation({
  args: {
    photoId: v.id("photos"),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    takenAt: v.optional(v.number()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    locationLabel: v.optional(v.string()),
  },
  handler: async (ctx, { photoId, ...rest }) => {
    const user = await requireCurrentUser(ctx);
    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");
    if (photo.ownerId !== user._id) {
      throw new Error("Alleen eigenaar kan foto wijzigen");
    }

    const patch: Partial<Doc<"photos">> = {};
    for (const k of [
      "width",
      "height",
      "takenAt",
      "latitude",
      "longitude",
      "locationLabel",
    ] as const) {
      if (rest[k] !== undefined) (patch[k] as unknown) = rest[k];
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(photoId, patch);
  },
});

// Internal helper: doet de volle cascade voor één photo. Aangeroepen
// door photos.remove (na auth check) en door users.deleteSelf voor
// transitieve cascade door alle photos van de user heen.
//
// Cascade matrix rows P3, P4, P5, P7 + storage cleanup queue (U7).
export async function internalRemovePhoto(
  ctx: MutationCtx,
  photoId: Id<"photos">,
): Promise<void> {
  const photo = await ctx.db.get(photoId);
  if (!photo) return;

  // P3: cascade albumPhotos die naar deze photo verwijzen
  const aps = await ctx.db
    .query("albumPhotos")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .collect();
  for (const ap of aps) await ctx.db.delete(ap._id);

  // P4: cascade ratings op deze photo
  const ratings = await ctx.db
    .query("ratings")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .collect();
  for (const r of ratings) await ctx.db.delete(r._id);

  // P5: cover-ref cleanup. Oude AWS handler gebruikte coverIndex GSI (zie
  // /blob-images-api/handlersDBstreams/photoDelToCover.js + dynamodb-lib-photo.js
  // listPhotoCovers). Bewust gedowngrade naar full-scan bij huidige schaal
  // (~16 users, tientallen groups/albums). TODO: by_cover index bij groei.
  const groups = await ctx.db.query("groups").collect();
  for (const g of groups) {
    if (g.coverPhotoId === photoId) {
      await ctx.db.patch(g._id, { coverPhotoId: undefined });
    }
  }
  const albums = await ctx.db.query("albums").collect();
  for (const a of albums) {
    if (a.coverPhotoId === photoId) {
      await ctx.db.patch(a._id, { coverPhotoId: undefined });
    }
  }
  // WP17b A-keuze 1: ook elke profielfoto die het beeld van deze foto is, van
  // elke user (v1 deed dat ook). Het beeld gaat hieronder uit storage, dus de
  // profielfoto zou anders naar niets wijzen. Full-scan zoals hierboven.
  const users = await ctx.db.query("users").collect();
  for (const u of users) {
    if (u.profilePhotoStorageId === photo.storageId) {
      await ctx.db.patch(u._id, { profilePhotoStorageId: undefined });
    }
  }

  // P7: decrement owner.photoCount (eigenaar kan al gedeleted zijn als
  // we vanuit users.deleteSelf komen — dan slaan we 'm gewoon over).
  const owner = await ctx.db.get(photo.ownerId);
  if (owner) {
    await ctx.db.patch(photo.ownerId, {
      photoCount: Math.max(0, owner.photoCount - 1),
    });
  }

  // U7-style storage cleanup (best-effort async). WP25 invariant 8: de
  // formaten gaan mee; het origineel en de formaten zijn van deze foto alleen.
  await ctx.scheduler.runAfter(0, internal.photos.cleanupStorage, {
    storageIds: [photo.storageId, ...formatStorageIds(photo)],
  });

  await ctx.db.delete(photoId);
}

export const remove = mutation({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const user = await requireCurrentUser(ctx);
    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");
    if (photo.ownerId !== user._id) {
      throw new Error("Alleen eigenaar kan foto verwijderen");
    }
    await internalRemovePhoto(ctx, photoId);
  },
});

// WP8 (EXIF-only): roteer/spiegel een foto door `exifOrientation` te
// herberekenen via de canonieke 8-staat-arithmetiek (convex/lib/exifOrientation).
// Geen pixel-manipulatie: het bestand (`storageId`) en alle nevenstaat blijven
// onaangeroerd. Een 90°/270°-rotatie wisselt `width`/`height` in dezelfde
// transactie zodat de DB-row consistent blijft.
//
// Delta-semantiek: elke call past de transformatie één keer toe bovenop de
// bestaande oriëntatie (rotate(90)×2 = 180°; rotate(90)→rotate(270) = terug).
// Géén idempotency.
//
// Auth (A3-verstrakking t.o.v. v1): owner OF group-admin van een group waarin de
// foto via albumPhotos gepubliceerd staat. Geen webmaster-bypass, geen
// member-zonder-admin. Owner-check eerst; group-walk alleen als de caller niet
// de owner is.
export const rotate = mutation({
  args: {
    photoId: v.id("photos"),
    rotation: v.union(
      v.literal(0),
      v.literal(90),
      v.literal(180),
      v.literal(270),
    ),
    flipY: v.boolean(),
  },
  handler: async (ctx, { photoId, rotation, flipY }) => {
    const user = await requireCurrentUser(ctx);
    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");

    if (photo.ownerId !== user._id) {
      // A9: group-admin-pad. albumPhotos draagt groupId direct (gedupliceerd),
      // dus geen album-hop nodig. Admin in één publicatie-group volstaat.
      const aps = await ctx.db
        .query("albumPhotos")
        .withIndex("by_photo", (q) => q.eq("photoId", photoId))
        .collect();
      const groupIds = [...new Set(aps.map((ap) => ap.groupId))];
      let isAdmin = false;
      for (const groupId of groupIds) {
        const membership = await ctx.db
          .query("memberships")
          .withIndex("by_user_and_group", (q) =>
            q.eq("userId", user._id).eq("groupId", groupId),
          )
          .unique();
        if (membership?.role === "admin") {
          isAdmin = true;
          break;
        }
      }
      if (!isAdmin) {
        throw new Error("Alleen eigenaar of group-admin kan foto roteren");
      }
    }

    const patch: Partial<Doc<"photos">> = {
      exifOrientation: applyOrientation(photo.exifOrientation, rotation, flipY),
    };
    if (rotationSwapsDimensions(rotation)) {
      patch.width = photo.height;
      patch.height = photo.width;
    }
    await ctx.db.patch(photoId, patch);
  },
});

// U7: best-effort storage cleanup voor photos die door cascade
// (users.deleteSelf, photos.remove) verwijderd zijn. Mutation is
// transactioneel; deze action draait erna en kan idempotent gefaald
// worden. Orphans in storage worden door integrity check opgemerkt.
export const cleanupStorage = internalAction({
  args: { storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, { storageIds }) => {
    for (const id of storageIds) {
      try {
        await ctx.storage.delete(id);
      } catch {
        // Best-effort. Volgende integrity-check ruimt deze op.
      }
    }
  },
});

// Internal patch-helper voor extractMetadata. Action kan niet direct
// ctx.db.patch doen, dus delegate via een internal mutation. No-op als
// photo intussen verwijderd is (cleanup-race). Geen `exifOrientation`: die
// zet alleen `attachFormats`, samen met de formaten (WP25 A-invariant 12).
export const patchMetadata = internalMutation({
  args: {
    photoId: v.id("photos"),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    takenAt: v.optional(v.number()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    locationLabel: v.optional(v.string()),
  },
  handler: async (ctx, { photoId, ...rest }) => {
    const photo = await ctx.db.get(photoId);
    if (!photo) return;
    const patch: Partial<Doc<"photos">> = {};
    for (const k of [
      "width",
      "height",
      "takenAt",
      "latitude",
      "longitude",
      "locationLabel",
    ] as const) {
      if (rest[k] !== undefined) (patch[k] as unknown) = rest[k];
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(photoId, patch);
    }
  },
});

// `extractMetadata` internalAction is verhuisd naar `convex/photoMetadata.ts`
// met `"use node";` directive (WP7-gate fix 2026-05-18 — exif-parser vereist
// Node's Buffer-global die ontbreekt in Convex isolate-runtime). Scheduler-
// call in `createFromUploadInternal` r.153 wijst nu naar
// `internal.photoMetadata.extractMetadata`. `isHeicLike` helper is mee-
// verhuisd; `patchMetadata`, `getByIdInternal` en `reverseGeocode` blijven
// hier (mutations + isolate-actions).

// ── WP25: formaten ───────────────────────────────────────────────────

/** De storage-objecten van de formaten van een foto (leeg zonder formaten). */
export function formatStorageIds(photo: Doc<"photos">): Id<"_storage">[] {
  return photo.formats ? [photo.formats.klein, photo.formats.groot] : [];
}

function validOrientation(o: number | undefined): number | undefined {
  return o !== undefined && Number.isInteger(o) && o >= 1 && o <= 8 ? o : undefined;
}

/**
 * Legt een set formaten vast (A-invariant 12 en 17). Eén schrijfactie: de
 * formaten, plus de stand uit het bestand en de afmetingen als die nog leeg
 * zijn. Een stand die er al staat (draaien, WP8) blijft staan.
 *
 * De eerste set blijft. Heeft de foto al formaten, of is hij weg, dan wordt de
 * nieuwe set niet vastgelegd en verdwijnen zijn objecten uit storage: er
 * blijft geen wees achter van een stap die te laat kwam.
 */
export const attachFormats = internalMutation({
  args: {
    photoId: v.id("photos"),
    klein: v.id("_storage"),
    groot: v.id("_storage"),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    exifOrientation: v.optional(v.number()),
  },
  returns: v.union(v.literal("attached"), v.literal("alreadyDone"), v.literal("gone")),
  handler: async (ctx, { photoId, klein, groot, width, height, exifOrientation }) => {
    // A-invariant 22: nooit een id vastleggen van een object dat er niet is
    // (bv. `prune-storage` terwijl de action liep). Gooien = niets geschreven;
    // de stap ruimt zijn eigen objecten op en meldt `failed`.
    for (const id of [klein, groot]) {
      if ((await ctx.db.system.get(id)) === null) {
        throw new Error(`attachFormats: nieuw object ${id} bestaat niet`);
      }
    }
    const photo = await ctx.db.get(photoId);
    if (!photo || (await hasCompleteFormats(ctx, photo))) {
      await ctx.storage.delete(klein);
      await ctx.storage.delete(groot);
      return photo ? "alreadyDone" : "gone";
    }
    // Een set met een ontbrekend object wordt vervangen; wat er van over is, gaat weg.
    for (const id of formatStorageIds(photo)) {
      if ((await ctx.db.system.get(id)) !== null) await ctx.storage.delete(id);
    }
    // Met formaten is een aftekening voorbij (A-invariant 25).
    const patch: Partial<Doc<"photos">> = { formats: { klein, groot }, noFormatsAcceptedAt: undefined };
    const orientation = validOrientation(exifOrientation);
    if (photo.exifOrientation === undefined && orientation !== undefined) {
      patch.exifOrientation = orientation;
    }
    if (photo.width === undefined && width !== undefined) patch.width = width;
    if (photo.height === undefined && height !== undefined) patch.height = height;
    await ctx.db.patch(photoId, patch);
    return "attached";
  },
});

/** Wat de formaat-stap van een foto moet weten. `null`: de foto is weg. */
export const formatInfo = internalQuery({
  args: { photoId: v.id("photos") },
  returns: v.union(v.object({ storageId: v.id("_storage"), hasFormats: v.boolean() }), v.null()),
  handler: async (ctx, { photoId }) => {
    const photo = await ctx.db.get(photoId);
    if (!photo) return null;
    return { storageId: photo.storageId, hasFormats: await hasCompleteFormats(ctx, photo) };
  },
});

/**
 * Afgetekend (A-invariant 25): het veld gezet én geen `formats`-veld. Een rij
 * met het veld en een (dangling) set telt als niet afgetekend; de backfill
 * herstelt die set, en `attachFormats` wist dan het veld.
 */
function isAccepted(photo: Doc<"photos">): boolean {
  return photo.noFormatsAcceptedAt !== undefined && photo.formats === undefined;
}

/**
 * De telling voor de backfill en de pre-flight (invariant 2). `withoutFormats`
 * is elke foto zonder volledige set, ook de afgetekende; die staan daarnaast
 * apart in `acceptedWithoutFormats` (A-invariant 25).
 */
export const formatStatus = internalQuery({
  args: {},
  returns: v.object({
    photos: v.number(),
    withFormats: v.number(),
    withoutFormats: v.number(),
    withExifOrientation: v.number(),
    acceptedWithoutFormats: v.number(),
  }),
  handler: async (ctx) => {
    const all = await ctx.db.query("photos").collect();
    // Een set met een ontbrekend object telt niet mee (A-invariant 22).
    let withFormats = 0;
    let acceptedWithoutFormats = 0;
    for (const p of all) {
      if (await hasCompleteFormats(ctx, p)) withFormats += 1;
      else if (isAccepted(p)) acceptedWithoutFormats += 1;
    }
    return {
      photos: all.length,
      withFormats,
      withoutFormats: all.length - withFormats,
      withExifOrientation: all.filter((p) => p.exifOrientation !== undefined).length,
      acceptedWithoutFormats,
    };
  },
});

/** De id's van de afgetekende foto's zonder volledige set; `formaten` drukt ze af. */
export const acceptedWithoutFormats = internalQuery({
  args: {},
  returns: v.array(v.id("photos")),
  handler: async (ctx) => {
    const ids: Id<"photos">[] = [];
    for (const p of await ctx.db.query("photos").collect()) {
      if (isAccepted(p)) ids.push(p._id);
    }
    return ids;
  },
});

/**
 * A-invariant 25: legt per foto vast dat hij zonder formaten mag (de tijd in
 * `noFormatsAcceptedAt`). Alles of niets: is één id geen foto, of heeft hij een
 * `formats`-veld (volledig of dangling), dan gooit hij met dat id en schrijft
 * niets. Een dangling set herstelt een gewone run eerst (invariant 22).
 */
export const acceptNoFormats = internalMutation({
  args: { photoIds: v.array(v.id("photos")) },
  returns: v.number(),
  handler: async (ctx, { photoIds }) => {
    const unique = [...new Set(photoIds)];
    for (const id of unique) {
      const photo = await ctx.db.get(id);
      // ConvexError: de tekst (met het id) komt ook op prod bij de CLI aan.
      if (!photo) throw new ConvexError(`acceptNoFormats: ${id} is geen foto; niets afgetekend`);
      if (photo.formats !== undefined) {
        throw new ConvexError(
          `acceptNoFormats: ${id} heeft al een formaat-veld; niets afgetekend. ` +
            `Draai eerst \`formaten\` zonder de vlag.`,
        );
      }
    }
    const now = Date.now();
    for (const id of unique) await ctx.db.patch(id, { noFormatsAcceptedAt: now });
    return unique.length;
  },
});

/**
 * A-invariant 25: draait de aftekening terug (`formaten --unaccept`); de
 * volgende batch probeert de foto weer. Alles of niets: is één id geen foto,
 * of niet afgetekend, dan gooit hij met dat id en schrijft niets.
 */
export const unacceptNoFormats = internalMutation({
  args: { photoIds: v.array(v.id("photos")) },
  returns: v.number(),
  handler: async (ctx, { photoIds }) => {
    const unique = [...new Set(photoIds)];
    for (const id of unique) {
      const photo = await ctx.db.get(id);
      if (!photo) throw new ConvexError(`unacceptNoFormats: ${id} is geen foto; niets teruggedraaid`);
      if (!isAccepted(photo)) {
        throw new ConvexError(`unacceptNoFormats: ${id} is niet afgetekend; niets teruggedraaid`);
      }
    }
    for (const id of unique) await ctx.db.patch(id, { noFormatsAcceptedAt: undefined });
    return unique.length;
  },
});

/**
 * Eén pagina foto's voor de backfill, in vaste volgorde (`_creationTime`).
 * Alleen het id, of er al een volledige set is, en of hij is afgetekend; de
 * action haalt de rest per foto.
 */
export const formatBatch = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), batchSize: v.number() },
  returns: v.object({
    photos: v.array(
      v.object({ photoId: v.id("photos"), hasFormats: v.boolean(), noFormatsAccepted: v.boolean() }),
    ),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { cursor, batchSize }) => {
    const page = await ctx.db
      .query("photos")
      .paginate({ cursor, numItems: Math.max(1, Math.floor(batchSize)) });
    const photos = [];
    for (const p of page.page) {
      photos.push({
        photoId: p._id,
        hasFormats: await hasCompleteFormats(ctx, p),
        noFormatsAccepted: isAccepted(p),
      });
    }
    return {
      photos,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

// Internal query helper — actions kunnen niet direct ctx.db.get gebruiken.
export const getByIdInternal = internalQuery({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    return await ctx.db.get(photoId);
  },
});

// Photon (Komoot) reverse-geocoding helper. Hergebruikt door extractMetadata
// en (potentieel) backfill-jobs. Cyclus 2 audit-10: vervangt MapQuest om
// secret-coupling weg te halen (geen API key nodig, EU data-residency,
// OSM-source). Fair-use vereist een UA-header (Clubalmanac/2.0).
//
// Graceful degradation: timeout / 4xx / 5xx / network-fail / empty results
// → null. Nooit throw — locationLabel is secundair en mag de extract-pipeline
// niet laten falen. lang=en levert Latijns schrift voor non-ASCII regio's
// (Georgië, Nepal, etc.) waar native script onleesbaar zou zijn voor de UI.
//
// Label-format: `${street || name}, ${city}, ${country}`, lege fields
// gefilterd. `name` als fallback voor POIs (museum/kerk) waar OSM geen
// `street` heeft (of lege string levert). 2s timeout houdt pipeline snappy.
export const reverseGeocode = internalAction({
  args: { latitude: v.number(), longitude: v.number() },
  returns: v.union(v.string(), v.null()),
  handler: async (_ctx, { latitude, longitude }) => {
    const url = `https://photon.komoot.io/reverse?lat=${latitude}&lon=${longitude}&lang=en`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Clubalmanac/2.0" },
        signal: controller.signal,
      });

      if (!response.ok) return null;

      const body = (await response.json()) as {
        features?: Array<{
          properties?: {
            street?: string;
            name?: string;
            city?: string;
            country?: string;
          };
        }>;
      };

      const props = body?.features?.[0]?.properties;
      if (!props) return null;

      // street → name fallback: POIs zonder street (Rijksmuseum etc.) krijgen
      // alsnog een herkenbaar label. Nullish-coalescing valt niet door op lege
      // string, dus expliciete length-check (audit-13 §1).
      const streetLabel =
        typeof props.street === "string" && props.street.length > 0
          ? props.street
          : props.name;
      const parts = [streetLabel, props.city, props.country].filter(
        (p): p is string => typeof p === "string" && p.length > 0,
      );
      if (parts.length === 0) return null;
      return parts.join(", ");
    } catch (e) {
      // network error, AbortError (timeout), of JSON-parse fail.
      console.error(
        `[reverseGeocode] Photon request failed lat=${latitude} lon=${longitude}`,
        e,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
});

// FL2: non-owner kan andermans photo flaggen. Idempotent — tweede flag
// op al-geflagde photo is no-op (eerste flagger en timestamps blijven).
// Sets countdown van 14 dagen. Bron: oude AWS handler flagPhoto.js.
export const flag = mutation({
  args: {
    photoId: v.id("photos"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { photoId, reason }) => {
    // WP24 invariant 2: foto-toegang. Onbekend id en geen toegang geven
    // dezelfde error (invariant 3); het stille "al gemeld" komt pas daarna,
    // zodat de meld-status niet lekt (A-keuze 4).
    const { user, photo } = await requirePhotoAccess(ctx, photoId);
    if (photo.ownerId === user._id) {
      throw new Error("Eigen foto kan niet geflagd worden");
    }
    if (photo.flaggedAt !== undefined) return;

    const now = Date.now();
    await ctx.db.patch(photoId, {
      flaggedAt: now,
      flaggedBy: user._id,
      flagReason: reason,
      flaggedDeleteDate: now + FLAG_DELETE_DAYS * DAY_MS,
    });
  },
});

// FL2: owner gaat in beroep tegen een flag. Pauzeert countdown door
// flaggedDeleteDate te clearen. Niet meer mogelijk na een denied
// appeal (anders kan owner countdown oneindig pauzeren).
// Bron: oude AWS handler flagPhotoAppeal.js.
export const appeal = mutation({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const user = await requireCurrentUser(ctx);
    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");
    if (photo.ownerId !== user._id) {
      throw new Error("Alleen eigenaar kan in beroep gaan");
    }
    if (photo.flaggedAt === undefined) {
      throw new Error("Foto is niet geflagd");
    }
    if (photo.flaggedAppealDenyDate !== undefined) {
      throw new Error("Beroep is al afgewezen");
    }
    if (photo.flaggedAppealDate !== undefined) return;

    await ctx.db.patch(photoId, {
      flaggedAppealDate: Date.now(),
      flaggedDeleteDate: undefined,
    });
  },
});

// FL2: webmaster beslist over een appeal.
//   approve = clear alle flag-velden (volledige clean state)
//   deny    = set flaggedAppealDenyDate, restart 7d countdown,
//             queue email-action naar owner
// Bron: oude AWS handler flagPhotoDecide.js. Afwijking van oude code:
// alleen email bij deny (cascade-matrix FL2).
export const decideFlag = mutation({
  args: {
    photoId: v.id("photos"),
    approve: v.boolean(),
  },
  handler: async (ctx, { photoId, approve }) => {
    await requireWebmaster(ctx);

    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");
    if (photo.flaggedAt === undefined) {
      throw new Error("Foto is niet geflagd");
    }
    if (photo.flaggedAppealDate === undefined) {
      throw new Error("Geen appeal om over te beslissen");
    }

    // Audit-9 §2: approve-pad komt vóór de deny-idempotent guard zodat
    // webmaster eigen deny kan overrulen door alsnog approve te beslissen.
    if (approve) {
      await ctx.db.patch(photoId, {
        flaggedAt: undefined,
        flaggedBy: undefined,
        flagReason: undefined,
        flaggedDeleteDate: undefined,
        flaggedAppealDate: undefined,
        flaggedAppealDenyDate: undefined,
      });
      return;
    }

    // Audit-9 §2: deny-na-deny is idempotent. Voorkomt dat een dubbel-click
    // owner een tweede mail bezorgt en de 7d countdown effectief verlengt.
    if (photo.flaggedAppealDenyDate !== undefined) {
      return;
    }

    const now = Date.now();
    await ctx.db.patch(photoId, {
      flaggedAppealDenyDate: now,
      flaggedDeleteDate: now + DENY_DELETE_DAYS * DAY_MS,
    });
    await ctx.scheduler.runAfter(0, internal.photos.sendFlagDecisionEmail, {
      photoId,
      approve: false,
    });
  },
});

// Eigen photos die door anderen geflagd zijn (Inappropriate.jsx).
// WP23: foto-vorm + flag-datums voor het bezwaar; geen melder of reden.
const MY_FLAGGED_FIELDS = { ...photoFields, ...ownFlagFields };
export const listMyFlagged = query({
  args: {},
  returns: v.array(v.object({ ...MY_FLAGGED_FIELDS, ...hasFormatsField })),
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const owned = await ctx.db
      .query("photos")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    return await Promise.all(
      owned
        .filter((p) => p.flaggedAt !== undefined)
        .map(async (p) => ({ ...pick(p, MY_FLAGGED_FIELDS), hasFormats: await hasCompleteFormats(ctx, p) })),
    );
  },
});

// Webmaster queue: alle photos waar flaggedAt gezet is
// (InappropriateAdmin.jsx).
// WP23: foto-vorm + alle flag-velden, incl. melder en reden (invariant 9:
// melder-identiteit alleen voor de webmaster).
const ALL_FLAGGED_FIELDS = { ...photoFields, ...allFlagFields };
export const listAllFlagged = query({
  args: {},
  returns: v.array(v.object({ ...ALL_FLAGGED_FIELDS, ...hasFormatsField })),
  handler: async (ctx) => {
    await requireWebmaster(ctx);
    const all = await ctx.db.query("photos").withIndex("by_flagged").collect();
    return await Promise.all(
      all
        .filter((p) => p.flaggedAt !== undefined)
        .map(async (p) => ({ ...pick(p, ALL_FLAGGED_FIELDS), hasFormats: await hasCompleteFormats(ctx, p) })),
    );
  },
});

// FL1: dagelijkse cron. Verwijdert photos waar flaggedDeleteDate <= now:
// photo wordt verwijderd op of na deletion-deadline. Boundary inclusief
// deadline-tijdstip zelf, consistent met Invites expiresAt <= now is
// verlopen. Photos onder appeal hebben flaggedDeleteDate undefined (door
// appeal gewist) en zijn dus niet zichtbaar in de sparse
// `by_flagged_delete` index — geen aparte filter nodig.
// internalRemovePhoto verzorgt de transitieve cascade (P3-P5+P7) +
// storage cleanup.
export const cleanupFlaggedPhotos = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const ripe = await ctx.db
      .query("photos")
      .withIndex("by_flagged_delete", (q) => q.lte("flaggedDeleteDate", now))
      .collect();
    for (const photo of ripe) {
      if (photo.flaggedDeleteDate === undefined) continue;
      await internalRemovePhoto(ctx, photo._id);
    }
  },
});

// FL2: photo-owner krijgt mail bij deny-decision (cascade-matrix FL2).
// Approve-pad stuurt geen mail (bewuste afwijking van oude AWS).
//
// FK-walk via internalQuery (action heeft geen ctx.db). Graceful skip
// als photo of owner inmiddels weg is (cascade-race).

export const getPhotoOwnerForEmail = internalQuery({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const photo = await ctx.db.get(photoId);
    if (!photo) return null;
    const owner = await ctx.db.get(photo.ownerId);
    if (!owner) return null;
    return {
      ownerName: owner.name ?? owner.email,
      ownerEmail: owner.email,
    };
  },
});

export const sendFlagDecisionEmail = internalAction({
  args: {
    photoId: v.id("photos"),
    approve: v.boolean(),
  },
  handler: async (ctx, { photoId, approve }) => {
    // Approve: cascade-matrix FL2 — geen mail. Bewuste afwijking van oude AWS.
    if (approve) return;

    const data = await ctx.runQuery(internal.photos.getPhotoOwnerForEmail, {
      photoId,
    });
    if (!data) {
      console.log(
        `[sendFlagDecisionEmail] photo/owner niet meer gevonden photoId=${photoId}, skipping`,
      );
      return;
    }

    // Lazy-import om module-load-order te ontkoppelen.
    const { INFO_SENDER, sendMailjetMessage } = await import("./lib/mailjet");
    const { flagDecisionDenyTemplate } = await import("./lib/emailTemplates");

    const tpl = flagDecisionDenyTemplate({ ownerName: data.ownerName });
    await sendMailjetMessage({
      from: { email: INFO_SENDER },
      to: [{ email: data.ownerEmail }],
      subject: tpl.subject,
      htmlPart: tpl.htmlPart,
      textPart: tpl.textPart,
    });
  },
});
