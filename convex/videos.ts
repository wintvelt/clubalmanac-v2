import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getMembership } from "./groups";
import { canSeePhotoImage } from "./images";
import { getBySubject } from "./users";
import { placeInAlbum } from "./uploads";
import { FORMATS_RETRY_DELAY_MS } from "./photos";
import { getWebmasterEmails } from "./lib/auth";
import {
  MAX_OPEN_VIDEO_UPLOADS,
  MAX_VIDEO_REQUESTS_PER_DAY,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_UPLOAD_OPEN_MS,
  videoTooLong,
} from "./lib/constants";
import { videoStorageCheckTemplate } from "./lib/emailTemplates";
import { stripJpegMetadata } from "./lib/jpegMeta";
import { INFO_SENDER, sendMailjetMessage } from "./lib/mailjet";
import { afterIndexHeader, inspectMp4, mp4IndexEnd, videoProblem, type Mp4Info, type VideoProblem } from "./lib/mp4";
import {
  deleteObject,
  copyObject,
  headObject,
  listObjects,
  presignR2,
  R2Error,
  r2Config,
  readRange,
  type R2Config,
} from "./lib/r2";
import { parseLocation, parseTakenAt, uploadImageType } from "./lib/upload";
import { openProjectOfGroup } from "./lib/filmOriginals";

// WP37 — filmpjes in albums. Het bestand staat in Cloudflare R2, de rij in
// `photos` (met `video`; `storageId` is de poster). Spec:
// docs/work-packages/WP37-filmpjes-in-albums.md §A-invarianten, §Testcontract.
//
// Toevoegen in drie stappen (A-antwoord 5):
//   1. `startUpload` (action): toegang tot het album, de grenzen, een
//      reservering per upload-id met een tijdelijke sleutel (`uploads/…`) die
//      de backend kiest, en een ondertekende PUT voor alleen die sleutel, met
//      de grootte in de handtekening (A-invariant 11, 20).
//   2. De app PUT het bestand naar R2.
//   3. `POST /upload/video` (httpAction, `videoUploadRoute`): de poster en
//      datum en plaats. De backend bekijkt het tijdelijke object (grootte,
//      index, sporen, duur, codec, locatie, wat na de index staat), kopieert
//      het naar een eindsleutel (`videos/…`, nooit een PUT-link) als het nog
//      hetzelfde object is, wist het tijdelijke, en maakt pas dan de rij
//      (A-invariant 12, 13, 25, 28–31). Geweigerd: object en reservering weg.
// Afspelen: `playUrl` (action), een ondertekende GET van 1 uur voor wie het
// beeld van de rij mag zien (A-invariant 17, 18).
// Wissen: elk wis-pad van de rij plant `deleteObjects` (A-invariant 21).
// Bewaken: `checkStorage`, dagelijks (A-invariant 22).
//
// Toegang vóór config (A-invariant 24): wie niet mag, krijgt de gewone
// weigering, ook als een R2-env-var ontbreekt. Geen link, sleutel of geheim in
// een log of fout.

/** Besluit B5: een afspeellink geldt 1 uur. */
export const VIDEO_LINK_SECONDS = 3600;
/**
 * A-invariant 11: een upload-link geldt 15 minuten. R2 toetst de geldigheid
 * bij de start van het verzoek, dus een lange upload loopt door.
 */
export const VIDEO_PUT_SECONDS = 900;
/** Het eerste stuk dat de backend leest; de index van 3 minuten past ruim. */
const INDEX_READ_BYTES = 512 * 1024;
/** Een index die groter is, leest de backend niet (en weigert het filmpje). */
const MAX_INDEX_BYTES = 8 * 1024 * 1024;
/** A-invariant 31: zoveel koppen mogen na de index staan. */
const MAX_BOXES_AFTER_INDEX = 32;

export const VIDEO_NOT_FOUND = { code: "VIDEO_NOT_FOUND" } as const;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A-invariant 22: een object onder uploads/ zonder reservering is pas na 2 dagen een melding. */
const UPLOADS_STALE_MS = 2 * DAY_MS;

type RefuseReason = "uitgelogd" | "geen_album" | "limiet" | "te_lang" | "te_groot" | "bezig" | "te_vaak";
type Gate = { kind: "ok"; userId: Id<"users"> } | { kind: "refused"; reason: RefuseReason };
type Reserved =
  | { kind: "upload"; key: string }
  | { kind: "done"; photoId: Id<"photos"> }
  | { kind: "refused"; reason: RefuseReason };
type StartResult = { kind: "upload"; url: string; expiresAt: number } | { kind: "done"; photoId: Id<"photos"> };
type FinishState =
  | { kind: "none" }
  | { kind: "done"; photoId: Id<"photos"> }
  | { kind: "open"; reservationId: Id<"uploadIdempotency">; key: string; albumOk: boolean; atLimit: boolean };
type Inventory = { videos: { photoId: Id<"photos">; key: string; bytes: number }[]; open: string[] };

function refuse(reason: RefuseReason): never {
  throw new ConvexError({ code: "VIDEO_UPLOAD_REFUSED", reason });
}

const REFUSE_REASON = v.union(
  v.literal("uitgelogd"),
  v.literal("geen_album"),
  v.literal("limiet"),
  v.literal("te_lang"),
  v.literal("te_groot"),
  v.literal("bezig"),
  v.literal("te_vaak"),
);

/** A-invariant 11: de app PUT onder dit prefix; een R2-lifecycle-regel wist het na 1 dag. */
export const TMP_PREFIX = "uploads/";
/** A-invariant 11: het filmpje in het album; hiervoor wordt nooit een PUT getekend. */
export const FINAL_PREFIX = "videos/";

function randomHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A-invariant 11: willekeurige sleutels, nooit afgeleid van iets uit het verzoek. */
function newUploadKey(): string {
  return `${TMP_PREFIX}${randomHex()}.mp4`;
}

function newFinalKey(): string {
  return `${FINAL_PREFIX}${randomHex()}.mp4`;
}

// --- aanvragen -----------------------------------------------------------------

/** Mag deze Clerk-user in dit album een filmpje zetten (lid van de groep, account actief)? */
export const uploadGate = internalQuery({
  args: { subject: v.string(), albumId: v.id("albums") },
  returns: v.union(
    v.object({ kind: v.literal("ok"), userId: v.id("users") }),
    v.object({ kind: v.literal("refused"), reason: REFUSE_REASON }),
  ),
  handler: async (ctx, { subject, albumId }) => {
    const user = await getBySubject(ctx, subject);
    if (!user) return { kind: "refused" as const, reason: "uitgelogd" as const };
    const album = await ctx.db.get(albumId);
    if (!album || !(await getMembership(ctx, user._id, album.groupId))) {
      return { kind: "refused" as const, reason: "geen_album" as const };
    }
    return { kind: "ok" as const, userId: user._id };
  },
});

/**
 * De reservering per upload-id (A-invariant 20), in één transactie:
 *   - afgerond en het filmpje bestaat: dat filmpje, weer in het album;
 *   - nog open (korter dan een dag): dezelfde sleutel;
 *   - anders: de limiet (een filmpje telt als één), hooguit 3 open video-
 *     uploads, en een nieuwe reservering met `newKey`.
 * Een reservering van een foto-upload (zonder sleutel) met deze id: `bezig`.
 */
export const reserveVideo = internalMutation({
  args: {
    ownerId: v.id("users"),
    clientUploadId: v.string(),
    albumId: v.id("albums"),
    newKey: v.string(),
  },
  returns: v.union(
    v.object({ kind: v.literal("upload"), key: v.string() }),
    v.object({ kind: v.literal("done"), photoId: v.id("photos") }),
    v.object({ kind: v.literal("refused"), reason: REFUSE_REASON }),
  ),
  handler: async (ctx, { ownerId, clientUploadId, albumId: requestedAlbumId, newKey }) => {
    const owner = await ctx.db.get(ownerId);
    if (!owner || owner.deletion) return { kind: "refused" as const, reason: "uitgelogd" as const };
    const requested = await ctx.db.get(requestedAlbumId);
    if (!requested || !(await getMembership(ctx, ownerId, requested.groupId))) {
      return { kind: "refused" as const, reason: "geen_album" as const };
    }
    const now = Date.now();
    // WP38 A-invariant 2 (besluit 2, 19): staat er in de groep een open
    // filmproject, dan komt het filmpje in het filmalbum, welk album van die
    // groep ook gevraagd werd (ook door een oude app: omleiden, niet
    // weigeren). Hier beslist, in de reservering: wat het project daarna doet,
    // verandert deze upload niet. Het antwoord van startUpload blijft gelijk.
    const project = await openProjectOfGroup(ctx, requested.groupId, now);
    const filmAlbum = project ? await ctx.db.get(project.albumId) : null;
    const albumId = filmAlbum && filmAlbum.groupId === requested.groupId ? filmAlbum._id : requestedAlbumId;

    const existing = await ctx.db
      .query("uploadIdempotency")
      .withIndex("by_owner_and_clientUploadId", (q) => q.eq("ownerId", ownerId).eq("clientUploadId", clientUploadId))
      .first();
    // Een afgeronde upload-id: het bestaande filmpje, weer in het gevraagde
    // album (zoals WP18 A-invariant 24), zonder daggrens en zonder mee te
    // tellen: het filmpje is er al (A-invariant 36).
    if (existing && existing.videoKey !== undefined && existing.status === "completed") {
      const photo = existing.photoId ? await ctx.db.get(existing.photoId) : null;
      if (photo) {
        if (!(await placeInAlbum(ctx, ownerId, albumId, photo._id))) {
          return { kind: "refused" as const, reason: "geen_album" as const };
        }
        return { kind: "done" as const, photoId: photo._id };
      }
    }

    // A-invariant 36: hooguit 30 geslaagde aanvragen in 24 uur, ook herhalingen.
    const dayAgo = now - DAY_MS;
    const recent = await ctx.db
      .query("videoUploadRequests")
      .withIndex("by_owner_and_at", (q) => q.eq("ownerId", ownerId).gt("at", dayAgo))
      .take(MAX_VIDEO_REQUESTS_PER_DAY);
    if (recent.length >= MAX_VIDEO_REQUESTS_PER_DAY) return { kind: "refused" as const, reason: "te_vaak" as const };
    const stale = await ctx.db
      .query("videoUploadRequests")
      .withIndex("by_owner_and_at", (q) => q.eq("ownerId", ownerId).lte("at", dayAgo))
      .take(50);
    for (const r of stale) await ctx.db.delete(r._id);
    const counted = async <T>(result: T): Promise<T> => {
      await ctx.db.insert("videoUploadRequests", { ownerId, at: now });
      return result;
    };

    if (existing) {
      if (existing.videoKey === undefined) return { kind: "refused" as const, reason: "bezig" as const };
      if (existing.status === "completed") {
        // Het filmpje is weg (zie hierboven): deze upload-id begint opnieuw.
        await ctx.db.delete(existing._id);
      } else if (now - existing.createdAt < VIDEO_UPLOAD_OPEN_MS) {
        if (existing.albumId !== albumId) await ctx.db.patch(existing._id, { albumId });
        return await counted({ kind: "upload" as const, key: existing.videoKey });
      } else {
        // Verlopen maar nog niet opgeruimd: weg, met zijn object.
        await ctx.db.delete(existing._id);
        await ctx.scheduler.runAfter(0, internal.videos.deleteObjects, { keys: [existing.videoKey] });
      }
    }

    if (owner.photoCount >= owner.photoLimit) return { kind: "refused" as const, reason: "limiet" as const };

    const mine = await ctx.db
      .query("uploadIdempotency")
      .withIndex("by_owner_and_clientUploadId", (q) => q.eq("ownerId", ownerId))
      .collect();
    const open = mine.filter(
      (r) => r.videoKey !== undefined && r.status === "in_progress" && now - r.createdAt < VIDEO_UPLOAD_OPEN_MS,
    );
    if (open.length >= MAX_OPEN_VIDEO_UPLOADS) return { kind: "refused" as const, reason: "bezig" as const };

    await ctx.db.insert("uploadIdempotency", {
      ownerId,
      clientUploadId,
      status: "in_progress",
      createdAt: now,
      videoKey: newKey,
      albumId,
    });
    return await counted({ kind: "upload" as const, key: newKey });
  },
});

/**
 * Een filmpje toevoegen, stap 1: een ondertekende PUT voor een nieuwe sleutel
 * (of dezelfde sleutel bij een herhaling), of het filmpje dat al binnen is.
 * `durationMs` en `bytes` zijn wat de app opgeeft; de backend toetst ze hier
 * en daarna opnieuw aan het bestand zelf (invariant 7).
 */
export const startUpload = action({
  args: {
    uploadId: v.string(),
    albumId: v.id("albums"),
    durationMs: v.number(),
    bytes: v.number(),
  },
  returns: v.union(
    v.object({ kind: v.literal("upload"), url: v.string(), expiresAt: v.number() }),
    v.object({ kind: v.literal("done"), photoId: v.id("photos") }),
  ),
  handler: async (ctx, { uploadId, albumId, durationMs, bytes }): Promise<StartResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) refuse("uitgelogd");
    const gate: Gate = await ctx.runQuery(internal.videos.uploadGate, { subject: identity.subject, albumId });
    if (gate.kind === "refused") refuse(gate.reason);
    // Een duur of grootte die geen getal boven nul is, telt als buiten de grens.
    if (!(Number.isFinite(durationMs) && durationMs > 0) || videoTooLong(durationMs)) refuse("te_lang");
    if (!(Number.isInteger(bytes) && bytes > 0) || bytes > MAX_VIDEO_BYTES) refuse("te_groot");
    const clientUploadId = uploadId.trim();
    if (clientUploadId === "") throw new ConvexError({ code: "VIDEO_UPLOAD_ID_MISSING" });

    const cfg = r2Config();
    const reserved: Reserved = await ctx.runMutation(internal.videos.reserveVideo, {
      ownerId: gate.userId,
      clientUploadId,
      albumId,
      newKey: newUploadKey(),
    });
    if (reserved.kind === "refused") refuse(reserved.reason);
    if (reserved.kind === "done") return { kind: "done" as const, photoId: reserved.photoId };
    // A-invariant 11: de handtekening legt de grootte vast; een ander aantal
    // bytes (of een veel groter bestand) weigert R2.
    const link = await presignR2(cfg, "PUT", reserved.key, VIDEO_PUT_SECONDS, Date.now(), {
      headers: { "content-length": String(bytes) },
    });
    return { kind: "upload" as const, url: link.url, expiresAt: link.expiresAt };
  },
});

// --- afronden ------------------------------------------------------------------

/** Waar een video-upload staat, voor `POST /upload/video`. */
export const finishState = internalQuery({
  args: { ownerId: v.id("users"), clientUploadId: v.string() },
  returns: v.union(
    v.object({ kind: v.literal("none") }),
    v.object({ kind: v.literal("done"), photoId: v.id("photos") }),
    v.object({
      kind: v.literal("open"),
      reservationId: v.id("uploadIdempotency"),
      key: v.string(),
      albumOk: v.boolean(),
      atLimit: v.boolean(),
    }),
  ),
  handler: async (ctx, { ownerId, clientUploadId }) => {
    const r = await ctx.db
      .query("uploadIdempotency")
      .withIndex("by_owner_and_clientUploadId", (q) => q.eq("ownerId", ownerId).eq("clientUploadId", clientUploadId))
      .first();
    if (!r || r.videoKey === undefined) return { kind: "none" as const };
    if (r.status === "completed") {
      const photo = r.photoId ? await ctx.db.get(r.photoId) : null;
      return photo ? { kind: "done" as const, photoId: photo._id } : { kind: "none" as const };
    }
    if (Date.now() - r.createdAt >= VIDEO_UPLOAD_OPEN_MS) return { kind: "none" as const };
    const album = r.albumId ? await ctx.db.get(r.albumId) : null;
    const albumOk = album !== null && (await getMembership(ctx, ownerId, album.groupId)) !== null;
    const owner = await ctx.db.get(ownerId);
    const atLimit = !owner || owner.photoCount >= owner.photoLimit;
    return { kind: "open" as const, reservationId: r._id, key: r.videoKey, albumOk, atLimit };
  },
});

/** Een geweigerde of verlaten video-upload: de reservering weg (het object wist de aanroeper). */
export const abandonUpload = internalMutation({
  args: { reservationId: v.id("uploadIdempotency") },
  returns: v.null(),
  handler: async (ctx, { reservationId }) => {
    const r = await ctx.db.get(reservationId);
    if (r && r.status === "in_progress") await ctx.db.delete(reservationId);
    return null;
  },
});

export const VIDEO_RESERVATION_GONE = "VIDEO_RESERVATION_GONE";
export const VIDEO_NO_ALBUM_ACCESS = "VIDEO_NO_ALBUM_ACCESS";
export const VIDEO_LIMIT_REACHED = "PHOTO_LIMIT_REACHED";

/**
 * De rij van een bekeken filmpje (A-invariant 12), in één transactie: foto-rij
 * met `video`, de plek in het album, de teller, de reservering op afgerond.
 * Daarna de formaten van de poster, zoals bij een foto, en de plaatsnaam.
 * Sentinels: `VIDEO_RESERVATION_GONE`, `PHOTO_LIMIT_REACHED`,
 * `VIDEO_NO_ALBUM_ACCESS`; de aanroeper ruimt de poster op.
 */
export const createFromUpload = internalMutation({
  args: {
    reservationId: v.id("uploadIdempotency"),
    ownerId: v.id("users"),
    storageId: v.id("_storage"),
    /** De tijdelijke sleutel van de reservering. */
    uploadKey: v.string(),
    /** De eindsleutel, die in de rij komt. */
    key: v.string(),
    durationMs: v.number(),
    bytes: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    takenAt: v.optional(v.number()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
  },
  returns: v.id("photos"),
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (
      !reservation ||
      reservation.ownerId !== args.ownerId ||
      reservation.status !== "in_progress" ||
      reservation.videoKey !== args.uploadKey
    ) {
      throw new Error(VIDEO_RESERVATION_GONE);
    }
    const user = await ctx.db.get(args.ownerId);
    if (!user || user.deletion) throw new Error(VIDEO_RESERVATION_GONE);
    if (user.photoCount >= user.photoLimit) throw new Error(VIDEO_LIMIT_REACHED);
    const album = reservation.albumId ? await ctx.db.get(reservation.albumId) : null;
    if (!album || !(await getMembership(ctx, args.ownerId, album.groupId))) {
      throw new Error(VIDEO_NO_ALBUM_ACCESS);
    }

    const now = Date.now();
    const photoId = await ctx.db.insert("photos", {
      ownerId: args.ownerId,
      storageId: args.storageId,
      mimeType: "image/jpeg",
      width: args.width,
      height: args.height,
      takenAt: args.takenAt,
      latitude: args.latitude,
      longitude: args.longitude,
      video: { key: args.key, durationMs: args.durationMs, bytes: args.bytes },
      createdAt: now,
    });
    await ctx.db.patch(args.ownerId, { photoCount: user.photoCount + 1 });
    await ctx.db.insert("albumPhotos", {
      albumId: album._id,
      photoId,
      groupId: album.groupId,
      addedAt: now,
      addedBy: args.ownerId,
    });
    await ctx.db.patch(args.reservationId, { status: "completed", photoId, completedAt: now });

    // A-invariant 15: de poster krijgt *klein* en *groot*, zoals een foto.
    await ctx.scheduler.runAfter(0, internal.photoFormats.makeFormats, { photoId });
    await ctx.scheduler.runAfter(FORMATS_RETRY_DELAY_MS, internal.photos.retryFormatsIfMissing, { photoId });
    // Invariant 3 en besluit 5: de plaatsnaam, zoals bij een foto.
    if (args.latitude !== undefined && args.longitude !== undefined) {
      await ctx.scheduler.runAfter(0, internal.photos.labelLocation, {
        photoId,
        latitude: args.latitude,
        longitude: args.longitude,
      });
    }
    return photoId;
  },
});

const json = (body: Record<string, unknown>, status: number) => Response.json(body, { status });

/** Object weg in R2, dan de reservering. Mislukt R2, dan blijft de reservering (de opruimronde haalt beide weg). */
async function discard(ctx: ActionCtx, cfg: R2Config, reservationId: Id<"uploadIdempotency">, key: string) {
  try {
    await deleteObject(cfg, key);
  } catch (e) {
    console.warn(`[videos] een geweigerd filmpje wissen in R2 lukt niet (${e instanceof Error ? e.message : "fout"})`);
    return;
  }
  await ctx.runMutation(internal.videos.abandonUpload, { reservationId });
}

/**
 * `POST /upload/video` (convex/http.ts): een filmpje afronden. Geen CORS: de
 * webapp uploadt geen filmpjes (besluit 4).
 *
 *   400 zonder X-Upload-Id, of een poster die niet binnenkwam of te groot is
 *   401 niet ingelogd (ook: account in verwijdering)
 *   404 geen open video-upload van deze user met deze id; of het album is
 *       niet meer toegankelijk (dan zijn object en reservering weg)
 *   415 de poster is geen JPEG
 *   403 op de limiet (reservering en object blijven, voor een latere poging)
 *   409 `{ reason: "niet_binnen" }`: het object staat (nog) niet in R2
 *   413 het object is groter dan 120 MiB (object en reservering weg)
 *   422 `{ reason }` uit `videoProblem` (object en reservering weg)
 *   502 R2 onbereikbaar (niets gewist); 500 R2-config ontbreekt
 *   200 `{ photoId }`, ook bij een herhaling
 */
export async function videoUploadRoute(ctx: ActionCtx, request: Request): Promise<Response> {
  let identity;
  try {
    identity = await ctx.auth.getUserIdentity();
  } catch {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!identity) return json({ error: "Unauthorized" }, 401);
  const user = await ctx.runQuery(internal.users.getBySubjectInternal, { subject: identity.subject });
  if (!user) return json({ error: "Unauthorized" }, 401);

  const clientUploadId = request.headers.get("X-Upload-Id")?.trim() ?? "";
  if (clientUploadId === "") return json({ error: "Missing X-Upload-Id" }, 400);

  const state: FinishState = await ctx.runQuery(internal.videos.finishState, { ownerId: user._id, clientUploadId });
  // A-invariant 32: onbekend, van een ander of verlopen is `verlopen`.
  if (state.kind === "none") return json({ error: "Geen open video-upload", reason: "verlopen" }, 404);
  if (state.kind === "done") return json({ photoId: state.photoId }, 200);

  // De poster, vóór alles wat iets in R2 aanraakt.
  const declared = Number(request.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return json({ error: "Poster te groot" }, 400);
  let posterBytes: Uint8Array;
  try {
    posterBytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return json({ error: "Upload afgebroken" }, 400);
  }
  if (posterBytes.byteLength > MAX_UPLOAD_BYTES) return json({ error: "Poster te groot" }, 400);
  // A-invariant 15: zonder metadata opgeslagen (geen GPS in storage).
  const poster =
    uploadImageType(posterBytes) === "image/jpeg" ? stripJpegMetadata(posterBytes, { keepOrientation: false }) : null;
  if (!poster) return json({ error: "De poster moet een JPEG zijn" }, 415);

  if (state.atLimit) return json({ error: "Photo limiet bereikt" }, 403);

  let cfg: R2Config;
  try {
    cfg = r2Config();
  } catch (e) {
    const message = e instanceof Error ? e.message : "R2_CONFIG_MISSING";
    console.error(`[videos] ${message}`);
    return json({ error: message }, 500);
  }

  if (!state.albumOk) {
    await discard(ctx, cfg, state.reservationId, state.key);
    return json({ error: "Album niet gevonden", reason: "geen_album" }, 404);
  }

  // A-invariant 12: het tijdelijke object in R2 bekijken (grootte, het begin,
  // wat na de index staat). Een exception tijdens het bekijken is een
  // weigering (A-invariant 28); alleen R2 onbereikbaar is een serverfout.
  const examined = await examine(cfg, state.key);
  if (examined.kind === "r2") return json({ error: "Opslag niet bereikbaar" }, 502);
  if (examined.kind === "missing") return json({ error: "Het filmpje is nog niet binnen", reason: "niet_binnen" }, 409);
  if (examined.kind === "changed") {
    // Het object veranderde tijdens het bekijken: opnieuw afronden bekijkt het opnieuw.
    return json({ error: "Het filmpje is nog niet helemaal binnen", reason: "niet_binnen" }, 409);
  }
  if (examined.kind === "too_big") {
    await discard(ctx, cfg, state.reservationId, state.key);
    return json({ error: "Bestand te groot" }, 413);
  }
  if (examined.kind === "refused") {
    await discard(ctx, cfg, state.reservationId, state.key);
    return json({ error: "Dit filmpje kan er niet in", reason: examined.reason }, 422);
  }
  const { size, etag, info } = examined;

  // A-invariant 11, 12: naar een eindsleutel waarvoor nooit een PUT is
  // getekend, alleen als het object nog is wat de backend bekeek, met het type
  // video/mp4. Gaat er na het versturen iets mis, dan gaat de eindsleutel
  // best-effort weer weg.
  const finalKey = newFinalKey();
  const dropFinal = async () => {
    try {
      await deleteObject(cfg, finalKey);
    } catch {
      // De R2-check meldt het wees-object.
    }
  };
  let copied: boolean;
  try {
    copied = await copyObject(cfg, state.key, finalKey, etag);
  } catch (e) {
    console.warn(`[videos] ${e instanceof Error ? e.message : "kopie mislukt"}`);
    await dropFinal();
    return json({ error: "Opslag niet bereikbaar" }, 502);
  }
  if (!copied) return json({ error: "Het filmpje is nog niet helemaal binnen", reason: "niet_binnen" }, 409);

  // A-invariant 14: de kloktijd van de opname (zoals bij foto's); zonder
  // datum geen takenAt. Plaats alleen in de rij, niet in het bestand.
  const takenAt = parseTakenAt(request.headers.get("X-Taken-At"));
  const location = parseLocation(request.headers.get("X-Latitude"), request.headers.get("X-Longitude"));

  let storageId: Id<"_storage"> | null = null;
  try {
    storageId = await ctx.storage.store(new Blob([poster as BlobPart], { type: "image/jpeg" }));
    const photoId: Id<"photos"> = await ctx.runMutation(internal.videos.createFromUpload, {
      reservationId: state.reservationId,
      ownerId: user._id,
      storageId,
      uploadKey: state.key,
      key: finalKey,
      durationMs: info.durationMs,
      bytes: size,
      ...(info.video && info.video.width > 0 && info.video.height > 0
        ? { width: info.video.width, height: info.video.height }
        : {}),
      takenAt,
      latitude: location?.latitude,
      longitude: location?.longitude,
    });
    // Eerst de rij, dan pas de tijdelijke sleutel weg (A-invariant 12).
    try {
      await deleteObject(cfg, state.key);
    } catch {
      // De lifecycle-regel op uploads/ haalt hem later weg.
    }
    return json({ photoId }, 200);
  } catch (e) {
    // De rij kwam er niet: de poster en de eindsleutel weer weg (A-invariant 12).
    if (storageId !== null) {
      try {
        await ctx.storage.delete(storageId);
      } catch {
        // best-effort
      }
    }
    await dropFinal();
    const message = e instanceof Error ? e.message : "";
    if (message === VIDEO_RESERVATION_GONE) {
      // Een gelijktijdige poging kan het al afgerond hebben.
      const again: FinishState = await ctx.runQuery(internal.videos.finishState, { ownerId: user._id, clientUploadId });
      if (again.kind === "done") return json({ photoId: again.photoId }, 200);
      return json({ error: "Geen open video-upload", reason: "verlopen" }, 404);
    }
    // Deze upload is klaar: het tijdelijke object en de reservering weg.
    await discard(ctx, cfg, state.reservationId, state.key);
    if (message === VIDEO_LIMIT_REACHED) return json({ error: "Photo limiet bereikt" }, 403);
    if (message === VIDEO_NO_ALBUM_ACCESS) return json({ error: "Album niet gevonden", reason: "geen_album" }, 404);
    throw e;
  }
}

type Examined =
  | { kind: "ok"; size: number; etag: string; info: Mp4Info }
  | { kind: "missing" }
  | { kind: "changed" }
  | { kind: "too_big" }
  | { kind: "refused"; reason: VideoProblem }
  | { kind: "r2" };

/**
 * Het tijdelijke object bekijken (A-invariant 12, 28, 31): HEAD (grootte,
 * ETag), het eerste stuk (512 KiB; een grotere index helemaal, tot 8 MiB),
 * `inspectMp4`, en dan de koppen na de index, elk met een klein range-verzoek.
 * Elke GET is begrensd; het hele bestand wordt nooit gelezen. Wisselt de ETag
 * tijdens het lezen: `changed`.
 */
async function examine(cfg: R2Config, key: string): Promise<Examined> {
  try {
    const found = await headObject(cfg, key);
    if (!found) return { kind: "missing" };
    const { size, etag } = found;
    if (size > MAX_VIDEO_BYTES) return { kind: "too_big" };
    if (size === 0 || !etag) return { kind: "refused", reason: "geen_mp4" };
    // Een antwoord zonder ETag laat niets door (A-invariant 12).
    const same = (e: string | null) => e === etag;

    let first = await readRange(cfg, key, 0, Math.min(size, INDEX_READ_BYTES) - 1);
    if (!same(first.etag)) return { kind: "changed" };
    let head = first.bytes;
    const indexEnd = mp4IndexEnd(head);
    if (indexEnd !== null && indexEnd > head.byteLength && indexEnd <= size && indexEnd <= MAX_INDEX_BYTES) {
      first = await readRange(cfg, key, 0, indexEnd - 1);
      if (!same(first.etag)) return { kind: "changed" };
      head = first.bytes;
    }
    const inspection = inspectMp4(head);
    const problem = videoProblem(inspection, size);
    if (problem !== null || !inspection.ok) return { kind: "refused", reason: problem ?? "geen_mp4" };

    // A-invariant 31: na de index alleen beelddata, tot precies het einde.
    let offset = mp4IndexEnd(head);
    if (offset === null) return { kind: "refused", reason: "geen_mp4" };
    let count = 0;
    while (offset < size) {
      count += 1;
      if (count > MAX_BOXES_AFTER_INDEX) return { kind: "refused", reason: "geen_mp4" };
      const part = await readRange(cfg, key, offset, Math.min(size, offset + 16) - 1);
      if (!same(part.etag)) return { kind: "changed" };
      const next = afterIndexHeader(part.bytes, offset, size);
      if (next === null || next <= offset) return { kind: "refused", reason: "geen_mp4" };
      offset = next;
    }
    return { kind: "ok", size, etag, info: inspection.info };
  } catch (e) {
    if (e instanceof R2Error) {
      console.warn(`[videos] ${e.message}`);
      return { kind: "r2" };
    }
    console.warn(`[videos] een filmpje bekijken gaf een fout; geweigerd als geen_mp4`);
    return { kind: "refused", reason: "geen_mp4" };
  }
}

// --- afspelen ------------------------------------------------------------------

/**
 * De sleutel van een filmpje, alleen als de caller het beeld van die rij mag
 * zien (`canSeePhotoImage`: eigenaar, lid van een groep met het filmpje in een
 * album, de webmaster bij een gemeld filmpje). Anders `null`.
 */
export const keyForViewer = internalQuery({
  args: { photoId: v.id("photos") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { photoId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await getBySubject(ctx, identity.subject);
    if (!user) return null;
    const photo = await ctx.db.get(photoId);
    if (!photo?.video) return null;
    if (!(await canSeePhotoImage(ctx, user._id, photo))) return null;
    return photo.video.key;
  },
});

/** Een afspeellink van 1 uur (B5); elke aanroep een verse. Eén weigering: `VIDEO_NOT_FOUND`. */
export const playUrl = action({
  args: { photoId: v.id("photos") },
  returns: v.object({ url: v.string(), expiresAt: v.number() }),
  handler: async (ctx, { photoId }): Promise<{ url: string; expiresAt: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError(VIDEO_NOT_FOUND);
    const key: string | null = await ctx.runQuery(internal.videos.keyForViewer, { photoId });
    if (key === null) throw new ConvexError(VIDEO_NOT_FOUND);
    const cfg = r2Config();
    // A-invariant 17: R2 stuurt het als video/mp4, ook als het object een ander type heeft.
    return await presignR2(cfg, "GET", key, VIDEO_LINK_SECONDS, Date.now(), {
      query: { "response-content-type": "video/mp4" },
    });
  },
});

// --- wissen --------------------------------------------------------------------

/**
 * Objecten in R2 wissen (A-invariant 21), best-effort: de rij is al weg.
 * Mislukt het, dan ziet de dagelijkse R2-check het wees-object.
 */
export const deleteObjects = internalAction({
  args: { keys: v.array(v.string()) },
  returns: v.null(),
  handler: async (_ctx, { keys }) => {
    let cfg: R2Config;
    try {
      cfg = r2Config();
    } catch (e) {
      console.warn(`[videos.deleteObjects] ${e instanceof Error ? e.message : "R2_CONFIG_MISSING"}`);
      return null;
    }
    for (const key of keys) {
      try {
        await deleteObject(cfg, key);
      } catch (e) {
        console.warn(`[videos.deleteObjects] wissen in R2 mislukt (${e instanceof Error ? e.message : "fout"})`);
      }
    }
    return null;
  },
});

// --- bewaken -------------------------------------------------------------------

/** Welke objecten horen er te zijn: de filmpjes, en de open video-uploads. */
export const storageInventory = internalQuery({
  args: {},
  returns: v.object({
    videos: v.array(v.object({ photoId: v.id("photos"), key: v.string(), bytes: v.number() })),
    open: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const videos: { photoId: Id<"photos">; key: string; bytes: number }[] = [];
    for (const p of await ctx.db.query("photos").collect()) {
      if (p.video) videos.push({ photoId: p._id, key: p.video.key, bytes: p.video.bytes });
    }
    const open = (
      await ctx.db
        .query("uploadIdempotency")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", "in_progress"))
        .collect()
    )
      .map((r) => r.videoKey)
      .filter((k): k is string => k !== undefined);
    return { videos, open };
  },
});

/**
 * De dagelijkse R2-check (A-invariant 22). Een object zonder rij en zonder
 * open upload, ouder dan een dag, is een wees; een rij zonder object een
 * ontbrekend bestand. Eén mail aan de webmaster als er iets is, of als de
 * check niet kon draaien. De check wist niets (WP10: melden, niet herstellen).
 */
export const checkStorage = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    let report: Parameters<typeof videoStorageCheckTemplate>[0] | null = null;
    const base = { stage: process.env.CLUBALMANAC_STAGE?.trim() || "onbekende", timestamp: new Date(now).toISOString() };
    try {
      const cfg = r2Config();
      const objects = await listObjects(cfg);
      const inventory: Inventory = await ctx.runQuery(internal.videos.storageInventory, {});
      const known = new Set([...inventory.videos.map((v) => v.key), ...inventory.open]);
      const present = new Set(objects.map((o) => o.key));
      // A-invariant 22: onder uploads/ ruimt de lifecycle-regel van R2 op (1
      // dag); staat er na 2 dagen nog iets zonder reservering, dan werkt die
      // regel niet: een eigen signaal. Elders: een wees na een dag.
      const unknown = objects.filter((o) => !known.has(o.key));
      const orphans = unknown
        .filter((o) => !o.key.startsWith(TMP_PREFIX) && now - o.lastModified > VIDEO_UPLOAD_OPEN_MS)
        .map((o) => ({ key: o.key, lastModified: o.lastModified }));
      const staleUploads = unknown
        .filter((o) => o.key.startsWith(TMP_PREFIX) && now - o.lastModified > UPLOADS_STALE_MS)
        .map((o) => ({ key: o.key, lastModified: o.lastModified }));
      const missing = inventory.videos.filter((v) => !present.has(v.key)).map((v) => v.photoId);
      // A-invariant 22: een grootte die afwijkt van wat de backend bekeek, en
      // elk object boven de grens (ook onder uploads/).
      const sizes = new Map(objects.map((o) => [o.key, o.size]));
      const wrongSize = inventory.videos
        .filter((v) => sizes.has(v.key) && sizes.get(v.key) !== v.bytes)
        .map((v) => v.photoId);
      const tooBig = objects.filter((o) => o.size > MAX_VIDEO_BYTES).map((o) => o.key);
      if (orphans.length > 0 || missing.length > 0 || wrongSize.length > 0 || tooBig.length > 0 || staleUploads.length > 0) {
        report = { ...base, orphans, missing, wrongSize, tooBig, staleUploads };
      }
    } catch (e) {
      const failure = e instanceof Error ? e.message : "onbekende fout";
      report = { ...base, failure, orphans: [], missing: [], wrongSize: [], tooBig: [] };
    }
    if (report === null) return null;

    console.warn(
      `[videos.checkStorage] ${report.failure ?? `${report.orphans.length} wees, ${report.missing.length} ontbrekend, ${report.wrongSize?.length ?? 0} andere grootte, ${report.tooBig?.length ?? 0} te groot`}`,
    );
    const webmasters = getWebmasterEmails();
    if (webmasters.length === 0) {
      console.log("[videos.checkStorage] geen WEBMASTER_EMAILS geconfigureerd, geen mail");
      return null;
    }
    const tpl = videoStorageCheckTemplate(report);
    await sendMailjetMessage({
      from: { email: INFO_SENDER },
      to: webmasters.map((email) => ({ email })),
      subject: tpl.subject,
      htmlPart: tpl.htmlPart,
      textPart: tpl.textPart,
    });
    return null;
  },
});
