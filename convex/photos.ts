import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireCurrentUser } from "./users";
import { requireWebmaster } from "./lib/auth";

const DAY_MS = 24 * 60 * 60 * 1000;
const FLAG_DELETE_DAYS = 14;
const DENY_DELETE_DAYS = 7;

// Cat-1 join-on-read: photo + owner data, vervangt denormalized
// user-velden op photos uit DynamoDB. Cascade matrix row U3.
export const getWithOwner = query({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const photo = await ctx.db.get(photoId);
    if (!photo) return null;
    const owner = await ctx.db.get(photo.ownerId);
    return { ...photo, owner };
  },
});

export const getById = query({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    return await ctx.db.get(photoId);
  },
});

export const listByOwner = query({
  args: { ownerId: v.id("users") },
  handler: async (ctx, { ownerId }) => {
    return await ctx.db
      .query("photos")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
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
 */
// P6: photo create increments user.photoCount (cat-2 transactional aggregate).
export const create = mutation({
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
export const createFromUploadInternal = internalMutation({
  args: {
    storageId: v.id("_storage"),
    ownerId: v.id("users"),
    reservationId: v.id("uploadIdempotency"),
    filename: v.optional(v.string()),
    mimeType: v.optional(v.string()),
  },
  returns: v.id("photos"),
  handler: async (
    ctx,
    { storageId, ownerId, reservationId, filename, mimeType },
  ) => {
    const user = await ctx.db.get(ownerId);
    if (!user) throw new Error("User bestaat niet");
    if (user.photoCount >= user.photoLimit) {
      // Audit-cyclus-1: typed sentinel string i.p.v. Nederlandstalige
      // "limiet"-substring match in de http handler.
      throw new Error("PHOTO_LIMIT_REACHED");
    }

    const photoId = await ctx.db.insert("photos", {
      ownerId,
      storageId,
      filename,
      mimeType,
      ratingCount: 0,
      createdAt: Date.now(),
    });

    await ctx.db.patch(ownerId, { photoCount: user.photoCount + 1 });

    await ctx.db.patch(reservationId, {
      status: "completed",
      photoId,
      completedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.photos.extractMetadata, {
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
  // [GAP] users-cover-clearing vervalt: nieuw schema heeft profilePhotoStorageId,
  // geen coverPhotoId op users. Bewuste schema-versmalling t.o.v. AWS.
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

  // P7: decrement owner.photoCount (eigenaar kan al gedeleted zijn als
  // we vanuit users.deleteSelf komen — dan slaan we 'm gewoon over).
  const owner = await ctx.db.get(photo.ownerId);
  if (owner) {
    await ctx.db.patch(photo.ownerId, {
      photoCount: Math.max(0, owner.photoCount - 1),
    });
  }

  // U7-style storage cleanup (best-effort async).
  await ctx.scheduler.runAfter(0, internal.photos.cleanupStorage, {
    storageIds: [photo.storageId],
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
// photo intussen verwijderd is (cleanup-race).
export const patchMetadata = internalMutation({
  args: {
    photoId: v.id("photos"),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    takenAt: v.optional(v.number()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    locationLabel: v.optional(v.string()),
    exifOrientation: v.optional(v.number()),
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
      "exifOrientation",
    ] as const) {
      if (rest[k] !== undefined) (patch[k] as unknown) = rest[k];
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(photoId, patch);
    }
  },
});

// HEIC detection via ISO-BMFF magic bytes. iPhone uploads landen vaak als
// HEIC; exif-parser kan ze niet decoderen. Audit-10 §5: graceful no-op met
// expliciete log ipv stille parse-fail. Brand-codes: heic/heix/heim/heis +
// mif1/msf1 (HEIF-variants die exif-parser ook niet aankan).
function isHeicLike(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  // bytes 4..8 = "ftyp"
  if (
    bytes[4] !== 0x66 ||
    bytes[5] !== 0x74 ||
    bytes[6] !== 0x79 ||
    bytes[7] !== 0x70
  ) {
    return false;
  }
  const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  return (
    brand === "heic" ||
    brand === "heix" ||
    brand === "heim" ||
    brand === "heis" ||
    brand === "hevc" ||
    brand === "hevx" ||
    brand === "mif1" ||
    brand === "msf1"
  );
}

// Server-side EXIF + geocoding voor een net geüploade photo. Async gequeued
// door createFromUploadInternal. Bron-mapping (oude AWS lib-geodata.js):
//   DateTimeOriginal ?? CreateDate → takenAt (audit-10 §1: iOS prominent op
//                                   DateTimeOriginal, Android op CreateDate)
//   GPSLatitude / GPSLongitude    → latitude / longitude
//   tags.Orientation              → exifOrientation (audit-9)
//   imageSize.width/height        → width / height
//
// Graceful degradation (audit-10 §3 — granulaire try/catch met logging):
//   - photo verwijderd / storage weg → silent no-op (cleanup-race)
//   - HEIC bytes                     → log "unsupported" + skip EXIF
//   - exif-parser import-fail        → log + skip EXIF (lib niet beschikbaar)
//   - exif-parser create/parse fail  → log + skip EXIF (corrupt bytes)
//   - reverseGeocode fail            → label undefined, lat/lon behouden
export const extractMetadata = internalAction({
  args: { photoId: v.id("photos") },
  handler: async (ctx, { photoId }) => {
    const photo: Doc<"photos"> | null = await ctx.runQuery(
      internal.photos.getByIdInternal,
      { photoId },
    );
    if (!photo) return;

    const blob = await ctx.storage.get(photo.storageId);
    if (!blob) return;

    // Sniff eerste 12 bytes voor HEIC-magic. Goedkoper dan hele blob laden,
    // en bij HEIC slaan we exif-parser geheel over.
    const headerBytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (isHeicLike(headerBytes)) {
      console.log(
        `[extractMetadata] unsupported format (HEIC) photoId=${photoId}, skipping EXIF`,
      );
      return;
    }

    let width: number | undefined;
    let height: number | undefined;
    let takenAt: number | undefined;
    let latitude: number | undefined;
    let longitude: number | undefined;
    let exifOrientation: number | undefined;

    try {
      // Lazy import: graceful failure als pakket niet laadt (rare maar
      // expliciet gelogd ipv stille fail).
      const { default: ExifParser } = await import("exif-parser");
      try {
        const buf = Buffer.from(await blob.arrayBuffer());
        const result = ExifParser.create(buf).parse();

        const tags = (result.tags ?? {}) as Record<string, unknown>;

        // takenAt: DateTimeOriginal wint, fallback op CreateDate. Beide in
        // Unix-seconds → *1000 voor ms.
        const dto = tags.DateTimeOriginal;
        const cd = tags.CreateDate;
        if (typeof dto === "number") {
          takenAt = dto * 1000;
        } else if (typeof cd === "number") {
          takenAt = cd * 1000;
        }

        const lat = tags.GPSLatitude;
        const lon = tags.GPSLongitude;
        if (typeof lat === "number") latitude = lat;
        if (typeof lon === "number") longitude = lon;

        const orient = tags.Orientation;
        if (typeof orient === "number" && orient >= 1 && orient <= 8) {
          exifOrientation = orient;
        }

        const size = result.imageSize as
          | { width?: number; height?: number }
          | undefined;
        if (size) {
          if (typeof size.width === "number") width = size.width;
          if (typeof size.height === "number") height = size.height;
        }
      } catch (e) {
        console.error(
          `[extractMetadata] EXIF parse failed photoId=${photoId}`,
          e,
        );
      }
    } catch (e) {
      // Audit-13 §3: bewust niet automated getest. vi.mock("exif-parser")
      // simuleert geen import-failure → dit pad is in unit-tests onbereikbaar
      // (dead branch onder mock). Real-world failure zou een Convex deploy-
      // issue zijn (ontbrekende dependency in bundle). Smoke-test pad in
      // fase 4A2 / integration tests tegen echte deployment dekt dit af.
      // Catch blijft staan als pure defensieve laag: liever een log-regel
      // dan een silent crash van de hele extract-pipeline.
      console.error(`[extractMetadata] exif-parser import failed`, e);
    }

    // Als EXIF geen GPS opleverde maar het record had handmatig gepatchte
    // coords (bv. uit test-setup of eerder backfill-pad), gebruik die voor
    // geocoding.
    const finalLat = latitude ?? photo.latitude;
    const finalLon = longitude ?? photo.longitude;

    let locationLabel: string | null = null;
    if (typeof finalLat === "number" && typeof finalLon === "number") {
      try {
        locationLabel = await ctx.runAction(internal.photos.reverseGeocode, {
          latitude: finalLat,
          longitude: finalLon,
        });
      } catch (e) {
        // reverseGeocode swallowt zelf alle errors → null. Deze catch is
        // defensief voor onverwachte transport-fouten via runAction.
        console.error(
          `[extractMetadata] geocoding runAction failed photoId=${photoId}`,
          e,
        );
      }
    }

    await ctx.runMutation(internal.photos.patchMetadata, {
      photoId,
      width,
      height,
      takenAt,
      latitude,
      longitude,
      // Lege string niet als label opslaan: empty results → undefined.
      locationLabel:
        typeof locationLabel === "string" && locationLabel.length > 0
          ? locationLabel
          : undefined,
      exifOrientation,
    });
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
    const user = await requireCurrentUser(ctx);
    const photo = await ctx.db.get(photoId);
    if (!photo) throw new Error("Foto bestaat niet");
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
export const listMyFlagged = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const owned = await ctx.db
      .query("photos")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    return owned.filter((p) => p.flaggedAt !== undefined);
  },
});

// Webmaster queue: alle photos waar flaggedAt gezet is
// (InappropriateAdmin.jsx).
export const listAllFlagged = query({
  args: {},
  handler: async (ctx) => {
    await requireWebmaster(ctx);
    const all = await ctx.db.query("photos").withIndex("by_flagged").collect();
    return all.filter((p) => p.flaggedAt !== undefined);
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
