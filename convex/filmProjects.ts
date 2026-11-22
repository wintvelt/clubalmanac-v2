import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getMembership, refuse as refuseCode, requireFounder, requireMemberForRead } from "./groups";
import { getBySubject, requireCurrentUser } from "./users";
import { getWebmasterEmails } from "./lib/auth";
import {
  FILM_PROJECT_MAX_AHEAD_MS,
  MAX_ORIGINAL_BYTES,
  MAX_PROJECT_ORIGINAL_BYTES,
  MAX_TOTAL_ORIGINAL_BYTES,
  ORIGINAL_ARRIVAL_AFTER_CLOSE_MS,
  ORIGINAL_DOWNLOAD_SECONDS,
  ORIGINAL_KEEP_MS,
  ORIGINAL_PART_BYTES,
  ORIGINAL_PART_LINK_SECONDS,
  ORIGINAL_REMINDER_BEFORE_MS,
} from "./lib/constants";
import { filmOriginalsCheckTemplate, filmOriginalsReminderTemplate } from "./lib/emailTemplates";
import {
  amsterdamWallClock,
  attachmentDisposition,
  canSeeOriginal,
  openProjectOfGroup,
  originalContainer,
  originalFilename,
  planParts,
  projectAcceptsArrivals,
  projectClosedAt,
  projectIsOpen,
  removeOriginalRows,
} from "./lib/filmOriginals";
import { INFO_SENDER, sendMailjetMessage } from "./lib/mailjet";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  deleteObject,
  headObject,
  listMultipartUploads,
  listObjects,
  listParts,
  presignR2,
  presignUploadPart,
  r2OriginalsConfig,
  readRange,
  R2Error,
  type R2Config,
  type R2Part,
} from "./lib/r2";

// WP38a — filmproject en originelen voor de clubfilm (backend). Spec:
// docs/work-packages/WP38-filmproject-originelen.md §Besluiten, §A-invarianten,
// §Testcontract.
//
// Een project per groep, door de oprichter open en dicht gezet, met een
// filmalbum X en een einddatum. Zolang het open staat, komt elk nieuw filmpje
// in die groep in X (de albumregel staat in `videos.reserveVideo`). Bij zo'n
// nieuw filmpje mag de eigenaar het origineel insturen:
//   1. `startOriginal` (action): toegang, grenzen, één inzending per filmpje
//      met een sleutel van de backend in de originelen-bucket, een
//      multipart-upload in R2, en links voor alleen de delen die R2 nog niet
//      heeft (A-invariant 3, 4, 15).
//   2. De app PUT de delen.
//   3. `finishOriginal` (action), of elk uur de backend zelf
//      (`completeUploaded`): alle delen met de goede grootte, afronden, het
//      object precies de aangemelde grootte, en een `ftyp` van QuickTime of
//      mp4; pas dan binnen (A-invariant 5, 9).
// Lezen: `listForGroup`, `listOpenForMe`, `get` (leden), de poster via
// `/beeld/inzending/<id>` (convex/images.ts, http.ts). Downloaden: alleen de
// oprichter (`downloadUrl`). Wissen: `withdraw` (inzender), `removeOriginal`
// en `removeAll` (oprichter), een jaar na binnenkomst, en de cascades in
// lib/filmOriginals.ts. Bewaken: `checkStorage`, dagelijks.
//
// Toegang vóór config (A-invariant 13): wie niet mag, krijgt de gewone
// weigering, ook zonder R2-env-vars. Geen sleutel, upload-id of link los in
// een antwoord, fout of log.

const ORIGINALS_PREFIX = "originals/";
const DAY_MS = 24 * 60 * 60 * 1000;
/** A-invariant 14: een object zonder inzending is pas na een dag een wees. */
const ORPHAN_AFTER_MS = DAY_MS;
/** A-invariant 14: een halve upload zonder inzending na 8 dagen: de lifecycle-regel (7 dagen) werkt niet. */
const STALE_UPLOAD_AFTER_MS = 8 * DAY_MS;

export const ORIGINAL_NOT_FOUND = { code: "ORIGINAL_NOT_FOUND" } as const;

type RefuseReason = "uitgelogd" | "niet_toegestaan" | "te_groot" | "vol" | "geen_video";

function refuseOriginal(reason: RefuseReason): never {
  throw new ConvexError({ code: "ORIGINAL_REFUSED", reason });
}

const REFUSE_REASON = v.union(
  v.literal("uitgelogd"),
  v.literal("niet_toegestaan"),
  v.literal("te_groot"),
  v.literal("vol"),
  v.literal("geen_video"),
);

function randomHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A-invariant 4: een willekeurige sleutel, niets uit het verzoek. */
function newOriginalKey(): string {
  return `${ORIGINALS_PREFIX}${randomHex()}`;
}

async function projectById(ctx: QueryCtx, projectId: string): Promise<Doc<"filmProjects"> | null> {
  const id = ctx.db.normalizeId("filmProjects", projectId);
  return id ? await ctx.db.get(id) : null;
}

async function originalById(ctx: QueryCtx, originalId: string): Promise<Doc<"filmOriginals"> | null> {
  const id = ctx.db.normalizeId("filmOriginals", originalId);
  return id ? await ctx.db.get(id) : null;
}

/** De naam van het filmalbum: zoals hij nu is, of de naam bij het openen als het album weg is. */
async function albumNameOf(ctx: QueryCtx, project: Doc<"filmProjects">): Promise<string> {
  const album = project.albumId ? await ctx.db.get(project.albumId) : null;
  return album?.name ?? project.albumName;
}

async function hasOriginals(ctx: QueryCtx, projectId: Id<"filmProjects">): Promise<boolean> {
  return (
    (await ctx.db
      .query("filmOriginals")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first()) !== null
  );
}

// --- projecten ----------------------------------------------------------------

/** Besluit 13: de einddatum ligt in de toekomst en hooguit een jaar vooruit. */
function endsAtAllowed(endsAt: number, now: number): boolean {
  return Number.isFinite(endsAt) && endsAt > now && endsAt <= now + FILM_PROJECT_MAX_AHEAD_MS;
}

/**
 * Besluit 1, A-invariant 1: alleen de oprichter (op het moment van het
 * verzoek). Het filmalbum hoort bij de groep; de einddatum ligt in de
 * toekomst en hooguit een jaar vooruit (besluit 13); hooguit één open project
 * per groep. Het project sluit vanzelf op de einddatum.
 */
export const open = mutation({
  args: { groupId: v.id("groups"), albumId: v.id("albums"), endsAt: v.number() },
  returns: v.string(),
  handler: async (ctx, { groupId, albumId, endsAt }) => {
    await requireFounder(ctx, groupId);
    const album = await ctx.db.get(albumId);
    if (!album || album.groupId !== groupId) refuseCode("NOT_MEMBER");
    const now = Date.now();
    if (!endsAtAllowed(endsAt, now)) refuseCode("DATE_INVALID");
    if (await openProjectOfGroup(ctx, groupId, now)) throw new ConvexError({ code: "PROJECT_ALREADY_OPEN" });
    const projectId = await ctx.db.insert("filmProjects", {
      groupId,
      albumId,
      albumName: album.name,
      endsAt,
      openedAt: now,
    });
    await ctx.scheduler.runAt(endsAt, internal.filmProjects.closeIfDue, { projectId });
    return projectId as string;
  },
});

/** Alleen de oprichter; een gesloten project nog eens sluiten verandert niets. */
export const close = mutation({
  args: { projectId: v.string() },
  returns: v.null(),
  handler: async (ctx, { projectId }) => {
    await requireCurrentUser(ctx);
    const project = await projectById(ctx, projectId);
    if (!project) refuseCode("NOT_MEMBER");
    await requireFounder(ctx, project.groupId);
    if (projectIsOpen(project, Date.now())) await ctx.db.patch(project._id, { closedAt: Date.now() });
    return null;
  },
});

/**
 * Besluit 13, A-invariant 1: de einddatum verschuiven, eerder of later. Alleen
 * de oprichter (op het moment van het verzoek), alleen een open project
 * (anders PROJECT_CLOSED), met de grenzen van openen. De sluiting gaat mee:
 * een nieuwe geplande stap op de nieuwe einddatum; de oude doet niets meer,
 * want `closeIfDue` kijkt naar de einddatum van nu.
 */
export const setEndsAt = mutation({
  args: { projectId: v.string(), endsAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { projectId, endsAt }) => {
    await requireCurrentUser(ctx);
    const project = await projectById(ctx, projectId);
    if (!project) refuseCode("NOT_MEMBER");
    await requireFounder(ctx, project.groupId);
    const now = Date.now();
    if (!projectIsOpen(project, now)) throw new ConvexError({ code: "PROJECT_CLOSED" });
    if (!endsAtAllowed(endsAt, now)) refuseCode("DATE_INVALID");
    await ctx.db.patch(project._id, { endsAt });
    await ctx.scheduler.runAt(endsAt, internal.filmProjects.closeIfDue, { projectId: project._id });
    return null;
  },
});

/** Besluit 13: op de einddatum gaat het project vanzelf dicht. */
export const closeIfDue = internalMutation({
  args: { projectId: v.id("filmProjects") },
  returns: v.null(),
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (project && project.closedAt === undefined && Date.now() >= project.endsAt) {
      await ctx.db.patch(projectId, { closedAt: project.endsAt });
    }
    return null;
  },
});

const projectRow = v.object({
  projectId: v.string(),
  // `null` als het filmalbum na sluiten verwijderd is (besluit 17).
  albumId: v.union(v.id("albums"), v.null()),
  albumName: v.string(),
  endsAt: v.number(),
  open: v.boolean(),
});

/**
 * Leden: het open project, en gesloten projecten zolang er originelen zijn
 * (UI: na sluiten blijft de projectpagina tot de originelen weg zijn).
 */
export const listForGroup = query({
  args: { groupId: v.id("groups") },
  returns: v.array(projectRow),
  handler: async (ctx, { groupId }) => {
    await requireMemberForRead(ctx, groupId);
    const now = Date.now();
    const projects = await ctx.db
      .query("filmProjects")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    const rows: { projectId: string; albumId: Id<"albums"> | null; albumName: string; endsAt: number; open: boolean; openedAt: number }[] = [];
    for (const p of projects) {
      const isOpen = projectIsOpen(p, now);
      if (!isOpen && !(await hasOriginals(ctx, p._id))) continue;
      rows.push({ projectId: p._id, albumId: p.albumId ?? null, albumName: await albumNameOf(ctx, p), endsAt: p.endsAt, open: isOpen, openedAt: p.openedAt });
    }
    rows.sort((a, b) => (a.open === b.open ? b.openedAt - a.openedAt : a.open ? -1 : 1));
    return rows.map(({ openedAt: _openedAt, ...row }) => row);
  },
});

/** De open projecten in de groepen van de caller (banner, toevoegscherm). Uitgelogd: leeg. */
export const listOpenForMe = query({
  args: {},
  returns: v.array(
    v.object({
      groupId: v.id("groups"),
      projectId: v.string(),
      albumId: v.id("albums"),
      albumName: v.string(),
      endsAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await getBySubject(ctx, identity.subject);
    if (!user) return [];
    const now = Date.now();
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const out: { groupId: Id<"groups">; projectId: string; albumId: Id<"albums">; albumName: string; endsAt: number }[] = [];
    for (const m of memberships) {
      const p = await openProjectOfGroup(ctx, m.groupId, now);
      // Een open project heeft altijd zijn filmalbum (besluit 17).
      if (!p || p.albumId === undefined) continue;
      out.push({ groupId: p.groupId, projectId: p._id, albumId: p.albumId, albumName: await albumNameOf(ctx, p), endsAt: p.endsAt });
    }
    return out;
  },
});

/**
 * De projectpagina (leden; anders NOT_MEMBER). Van anderen alleen wat binnen
 * is; eigen inzendingen altijd, met de stand; de oprichter ziet alles
 * (A-invariant 7). Geen sleutel, upload-id of link.
 */
export const get = query({
  args: { projectId: v.string() },
  returns: v.object({
    project: v.object({
      projectId: v.string(),
      groupId: v.id("groups"),
      albumId: v.union(v.id("albums"), v.null()),
      albumName: v.string(),
      endsAt: v.number(),
      open: v.boolean(),
    }),
    isFounder: v.boolean(),
    originals: v.array(
      v.object({
        originalId: v.string(),
        ownerName: v.string(),
        mine: v.boolean(),
        status: v.union(v.literal("onderweg"), v.literal("binnen")),
        durationMs: v.number(),
        submittedAt: v.number(),
        takenAt: v.union(v.number(), v.null()),
      }),
    ),
  }),
  handler: async (ctx, { projectId }) => {
    const user = await requireCurrentUser(ctx);
    const project = await projectById(ctx, projectId);
    if (!project || !(await getMembership(ctx, user._id, project.groupId))) throw new ConvexError({ code: "NOT_MEMBER" });
    const group = await ctx.db.get(project.groupId);
    const isFounder = group?.createdBy === user._id;
    const rows = await ctx.db
      .query("filmOriginals")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const originals = [];
    for (const r of rows.sort((a, b) => a.submittedAt - b.submittedAt)) {
      if (!canSeeOriginal(r, user._id, isFounder)) continue;
      const owner = await ctx.db.get(r.ownerId);
      const photo = await ctx.db.get(r.photoId);
      originals.push({
        originalId: r._id as string,
        ownerName: owner?.name ?? "Lid",
        mine: r.ownerId === user._id,
        status: r.status,
        durationMs: photo?.video?.durationMs ?? 0,
        submittedAt: r.submittedAt,
        takenAt: photo?.takenAt ?? null,
      });
    }
    return {
      project: {
        projectId: project._id as string,
        groupId: project.groupId,
        albumId: project.albumId ?? null,
        albumName: await albumNameOf(ctx, project),
        endsAt: project.endsAt,
        open: projectIsOpen(project, Date.now()),
      },
      isFounder,
      originals,
    };
  },
});

// --- insturen -------------------------------------------------------------------

type StartState =
  | { kind: "refused"; reason: RefuseReason }
  | { kind: "done"; originalId: Id<"filmOriginals"> }
  | { kind: "existing"; original: Doc<"filmOriginals"> }
  | { kind: "new"; userId: Id<"users">; project: Doc<"filmProjects"> };

/**
 * A-invariant 3: mag deze user bij dit filmpje een origineel insturen? Een
 * bestaande inzending van dit filmpje (van hem) gaat verder, zolang het
 * project hem nog aanneemt (besluit 18). Een nieuwe kan alleen bij een eigen
 * filmpje dat in het filmalbum staat van een open project in een groep waar
 * hij lid van is, en gemaakt is terwijl dat project open stond. Al het andere
 * is één weigering (`niet_toegestaan`).
 */
async function startState(ctx: QueryCtx, subject: string, photoId: Id<"photos">, now: number): Promise<StartState> {
  const user = await getBySubject(ctx, subject);
  if (!user) return { kind: "refused", reason: "uitgelogd" };
  const photo = await ctx.db.get(photoId);
  if (!photo || photo.ownerId !== user._id || !photo.video) return { kind: "refused", reason: "niet_toegestaan" };

  const existing = await ctx.db
    .query("filmOriginals")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .first();
  if (existing) {
    const project = await ctx.db.get(existing.projectId);
    if (
      existing.ownerId !== user._id ||
      !project ||
      !(await getMembership(ctx, user._id, project.groupId))
    ) {
      return { kind: "refused", reason: "niet_toegestaan" };
    }
    if (existing.status === "binnen") return { kind: "done", originalId: existing._id };
    if (!projectAcceptsArrivals(project, now)) return { kind: "refused", reason: "niet_toegestaan" };
    return { kind: "existing", original: existing };
  }

  const placements = await ctx.db
    .query("albumPhotos")
    .withIndex("by_photo", (q) => q.eq("photoId", photoId))
    .collect();
  for (const ap of placements) {
    const projects = await ctx.db
      .query("filmProjects")
      .withIndex("by_album", (q) => q.eq("albumId", ap.albumId))
      .collect();
    for (const project of projects) {
      if (project.groupId !== ap.groupId || !projectIsOpen(project, now)) continue;
      if (photo.createdAt < project.openedAt || photo.createdAt >= projectClosedAt(project)) continue;
      if (!(await getMembership(ctx, user._id, project.groupId))) continue;
      return { kind: "new", userId: user._id, project };
    }
  }
  return { kind: "refused", reason: "niet_toegestaan" };
}

const startGateResult = v.union(
  v.object({ kind: v.literal("refused"), reason: REFUSE_REASON }),
  v.object({ kind: v.literal("done"), originalId: v.id("filmOriginals") }),
  v.object({ kind: v.literal("go") }),
);

/** De toegang vóór de config (A-invariant 13), zonder iets te schrijven. */
export const startGate = internalQuery({
  args: { subject: v.string(), photoId: v.id("photos") },
  returns: startGateResult,
  handler: async (ctx, { subject, photoId }) => {
    const state = await startState(ctx, subject, photoId, Date.now());
    if (state.kind === "refused") return { kind: "refused" as const, reason: state.reason };
    if (state.kind === "done") return { kind: "done" as const, originalId: state.originalId };
    return { kind: "go" as const };
  },
});

async function reservedBytes(ctx: QueryCtx, projectId?: Id<"filmProjects">): Promise<number> {
  const rows = projectId
    ? await ctx.db
        .query("filmOriginals")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect()
    : await ctx.db.query("filmOriginals").collect();
  return rows.reduce((sum, r) => sum + r.bytes, 0);
}

/**
 * De inzending, in één transactie: dezelfde regels als `startGate`, de
 * grenzen (besluit 11: per bestand, per project, alles samen; wat onderweg
 * is telt mee), en per filmpje hooguit één inzending. Opnieuw aanmelden geeft
 * dezelfde inzending, met dezelfde upload in R2.
 */
export const reserveOriginal = internalMutation({
  args: { subject: v.string(), photoId: v.id("photos"), bytes: v.number(), newKey: v.string() },
  returns: v.union(
    v.object({ kind: v.literal("refused"), reason: REFUSE_REASON }),
    v.object({ kind: v.literal("done"), originalId: v.id("filmOriginals") }),
    v.object({
      kind: v.literal("upload"),
      originalId: v.id("filmOriginals"),
      key: v.string(),
      uploadId: v.union(v.string(), v.null()),
      bytes: v.number(),
    }),
  ),
  handler: async (ctx, { subject, photoId, bytes, newKey }) => {
    const now = Date.now();
    const state = await startState(ctx, subject, photoId, now);
    if (state.kind === "refused") return { kind: "refused" as const, reason: state.reason };
    if (state.kind === "done") return { kind: "done" as const, originalId: state.originalId };
    if (state.kind === "existing") {
      // Een andere grootte is een ander bestand: de app trekt eerst terug.
      if (state.original.bytes !== bytes) return { kind: "refused" as const, reason: "niet_toegestaan" as const };
      return {
        kind: "upload" as const,
        originalId: state.original._id,
        key: state.original.key,
        uploadId: state.original.uploadId ?? null,
        bytes: state.original.bytes,
      };
    }
    if (bytes > MAX_ORIGINAL_BYTES) return { kind: "refused" as const, reason: "te_groot" as const };
    if ((await reservedBytes(ctx, state.project._id)) + bytes > MAX_PROJECT_ORIGINAL_BYTES) {
      return { kind: "refused" as const, reason: "vol" as const };
    }
    if ((await reservedBytes(ctx)) + bytes > MAX_TOTAL_ORIGINAL_BYTES) {
      return { kind: "refused" as const, reason: "vol" as const };
    }
    const originalId = await ctx.db.insert("filmOriginals", {
      projectId: state.project._id,
      groupId: state.project.groupId,
      ownerId: state.userId,
      photoId,
      key: newKey,
      bytes,
      status: "onderweg",
      submittedAt: now,
    });
    return { kind: "upload" as const, originalId, key: newKey, uploadId: null, bytes };
  },
});

/**
 * De upload-id van R2 bij een inzending, als er nog geen (of `previous`) is.
 * Heeft een gelijktijdige aanmelding er al een gezet, dan die. `gone`: de
 * inzending is weg of al binnen.
 */
export const attachUpload = internalMutation({
  args: { originalId: v.id("filmOriginals"), uploadId: v.string(), previous: v.union(v.string(), v.null()) },
  returns: v.union(v.object({ kind: v.literal("gone") }), v.object({ kind: v.literal("use"), uploadId: v.string() })),
  handler: async (ctx, { originalId, uploadId, previous }) => {
    const row = await ctx.db.get(originalId);
    if (!row || row.status !== "onderweg") return { kind: "gone" as const };
    if (row.uploadId !== undefined && row.uploadId !== previous) return { kind: "use" as const, uploadId: row.uploadId };
    await ctx.db.patch(originalId, { uploadId });
    return { kind: "use" as const, uploadId };
  },
});

type StartOriginalResult =
  | { kind: "upload"; originalId: string; partSize: number; parts: { partNumber: number; url: string }[]; expiresAt: number }
  | { kind: "done"; originalId: string };

/** Een upload die R2 niet meer kent (afgebroken of afgerond) vervangen door een nieuwe. */
async function freshUpload(
  ctx: ActionCtx,
  cfg: R2Config,
  originalId: Id<"filmOriginals">,
  key: string,
  previous: string | null,
): Promise<{ uploadId: string; parts: R2Part[] }> {
  const created = await createMultipartUpload(cfg, key);
  const kept = await ctx.runMutation(internal.filmProjects.attachUpload, { originalId, uploadId: created, previous });
  if (kept.kind === "gone") {
    await abortQuietly(cfg, key, created);
    refuseOriginal("niet_toegestaan");
  }
  if (kept.uploadId === created) return { uploadId: created, parts: [] };
  await abortQuietly(cfg, key, created);
  return { uploadId: kept.uploadId, parts: (await listParts(cfg, key, kept.uploadId)) ?? [] };
}

async function abortQuietly(cfg: R2Config, key: string, uploadId: string): Promise<void> {
  try {
    await abortMultipartUpload(cfg, key, uploadId);
  } catch {
    // De lifecycle-regel breekt een halve upload na 7 dagen af; de check meldt het daarna.
  }
}

/** Een deel telt als binnen met precies de geplande grootte. */
function missingParts(bytes: number, present: R2Part[]): number[] {
  const have = new Map(present.map((p) => [p.partNumber, p.size]));
  return planParts(bytes)
    .filter((p) => have.get(p.partNumber) !== p.size)
    .map((p) => p.partNumber);
}

/**
 * Een origineel aanmelden of verder gaan (A-invariant 3, 4): links voor alleen
 * de delen die R2 nog niet heeft, elk een PUT op precies de sleutel, met het
 * deelnummer, de upload-id en de grootte in de handtekening, 7 dagen geldig.
 * Al binnen: `{ kind: "done" }`. Weigering: `ORIGINAL_REFUSED` met een reden.
 */
export const startOriginal = action({
  args: { photoId: v.id("photos"), bytes: v.number() },
  returns: v.union(
    v.object({
      kind: v.literal("upload"),
      originalId: v.string(),
      partSize: v.number(),
      parts: v.array(v.object({ partNumber: v.number(), url: v.string() })),
      expiresAt: v.number(),
    }),
    v.object({ kind: v.literal("done"), originalId: v.string() }),
  ),
  handler: async (ctx, { photoId, bytes }): Promise<StartOriginalResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) refuseOriginal("uitgelogd");
    const gate = await ctx.runQuery(internal.filmProjects.startGate, { subject: identity.subject, photoId });
    if (gate.kind === "refused") refuseOriginal(gate.reason);
    if (gate.kind === "done") return { kind: "done", originalId: gate.originalId };
    if (!(Number.isInteger(bytes) && bytes > 0)) refuseOriginal("te_groot");

    const cfg = r2OriginalsConfig();
    const reserved = await ctx.runMutation(internal.filmProjects.reserveOriginal, {
      subject: identity.subject,
      photoId,
      bytes,
      newKey: newOriginalKey(),
    });
    if (reserved.kind === "refused") refuseOriginal(reserved.reason);
    if (reserved.kind === "done") return { kind: "done", originalId: reserved.originalId };

    // R2 is de bron van wat er al is (antwoord 1): de lijst van delen.
    let uploadId = reserved.uploadId;
    let present: R2Part[] | null = uploadId === null ? null : await listParts(cfg, reserved.key, uploadId);
    if (uploadId === null || present === null) {
      const fresh = await freshUpload(ctx, cfg, reserved.originalId, reserved.key, uploadId);
      uploadId = fresh.uploadId;
      present = fresh.parts;
    }
    const missing = new Set(missingParts(reserved.bytes, present));
    const now = Date.now();
    const parts: { partNumber: number; url: string }[] = [];
    let expiresAt = now + ORIGINAL_PART_LINK_SECONDS * 1000;
    for (const p of planParts(reserved.bytes)) {
      if (!missing.has(p.partNumber)) continue;
      const link = await presignUploadPart(cfg, reserved.key, uploadId, p.partNumber, p.size, ORIGINAL_PART_LINK_SECONDS, now);
      expiresAt = link.expiresAt;
      parts.push({ partNumber: p.partNumber, url: link.url });
    }
    return { kind: "upload", originalId: reserved.originalId, partSize: ORIGINAL_PART_BYTES, parts, expiresAt };
  },
});

// --- afronden ---------------------------------------------------------------------

const openOriginal = v.object({
  originalId: v.id("filmOriginals"),
  key: v.string(),
  uploadId: v.union(v.string(), v.null()),
  bytes: v.number(),
});
type OpenOriginal = { originalId: Id<"filmOriginals">; key: string; uploadId: string | null; bytes: number };

/** Mag deze user deze inzending afronden (alleen de inzender, zolang het project hem aanneemt)? */
export const finishGate = internalQuery({
  args: { subject: v.string(), originalId: v.string() },
  returns: v.union(
    v.object({ kind: v.literal("refused") }),
    v.object({ kind: v.literal("done") }),
    v.object({ kind: v.literal("open"), original: openOriginal }),
  ),
  handler: async (ctx, { subject, originalId }) => {
    const user = await getBySubject(ctx, subject);
    const row = user ? await originalById(ctx, originalId) : null;
    if (!user || !row || row.ownerId !== user._id) return { kind: "refused" as const };
    if (row.status === "binnen") return { kind: "done" as const };
    const project = await ctx.db.get(row.projectId);
    if (!project || !projectAcceptsArrivals(project, Date.now())) return { kind: "refused" as const };
    return {
      kind: "open" as const,
      original: { originalId: row._id, key: row.key, uploadId: row.uploadId ?? null, bytes: row.bytes },
    };
  },
});

/** Binnen: het object is heel, met dit merk. `false`: de inzending is intussen weg of al binnen. */
export const markReceived = internalMutation({
  args: { originalId: v.id("filmOriginals"), container: v.union(v.literal("mov"), v.literal("mp4")) },
  returns: v.boolean(),
  handler: async (ctx, { originalId, container }) => {
    const row = await ctx.db.get(originalId);
    if (!row || row.status !== "onderweg") return false;
    await ctx.db.patch(originalId, { status: "binnen", completedAt: Date.now(), container, uploadId: undefined });
    return true;
  },
});

/** Het object klopt niet (andere grootte): opnieuw beginnen met een nieuwe upload. */
export const resetUpload = internalMutation({
  args: { originalId: v.id("filmOriginals") },
  returns: v.null(),
  handler: async (ctx, { originalId }) => {
    const row = await ctx.db.get(originalId);
    if (row && row.status === "onderweg") await ctx.db.patch(originalId, { uploadId: undefined });
    return null;
  },
});

/** Geen filmpje (A-invariant 5): de inzending weg; het object wist de aanroeper. */
export const dropOriginal = internalMutation({
  args: { originalId: v.id("filmOriginals") },
  returns: v.null(),
  handler: async (ctx, { originalId }) => {
    const row = await ctx.db.get(originalId);
    if (row && row.status === "onderweg") await ctx.db.delete(originalId);
    return null;
  },
});

type CompleteResult = { kind: "done" } | { kind: "missing"; parts: number[] } | { kind: "refused"; reason: "geen_video" | "niet_toegestaan" };

/**
 * Afronden (A-invariant 5): pas als R2 elk deel met de geplande grootte
 * heeft. Dan afronden met de lijst van R2, nakijken dat het object precies de
 * aangemelde grootte heeft en met een `ftyp` van QuickTime of mp4 begint. Geen
 * filmpje: object en inzending weg. De bytes blijven zoals de app ze stuurde
 * (A-invariant 6): geen kopie, geen herschrijving.
 */
async function completeOriginal(ctx: ActionCtx, cfg: R2Config, original: OpenOriginal): Promise<CompleteResult> {
  const all = planParts(original.bytes).map((p) => p.partNumber);
  let present: R2Part[] | null = original.uploadId === null ? null : await listParts(cfg, original.key, original.uploadId);
  if (present !== null && original.uploadId !== null) {
    const missing = missingParts(original.bytes, present);
    if (missing.length > 0) return { kind: "missing", parts: missing };
    const byNumber = new Map(present.map((p) => [p.partNumber, p.etag]));
    const completed = await completeMultipartUpload(
      cfg,
      original.key,
      original.uploadId,
      all.map((n) => ({ partNumber: n, etag: byNumber.get(n)! })),
    );
    if (!completed) present = null;
  }
  // De upload is er niet (meer): misschien rondde een gelijktijdige poging
  // hem af. Zonder heel object: alles opnieuw (de volgende aanmelding maakt
  // een nieuwe upload).
  const head = await headObject(cfg, original.key);
  if (!head) {
    if (present === null && original.uploadId !== null) {
      await ctx.runMutation(internal.filmProjects.resetUpload, { originalId: original.originalId });
    }
    return { kind: "missing", parts: all };
  }
  if (head.size !== original.bytes) {
    await deleteQuietly(cfg, original.key);
    await ctx.runMutation(internal.filmProjects.resetUpload, { originalId: original.originalId });
    return { kind: "missing", parts: all };
  }
  const { bytes: first } = await readRange(cfg, original.key, 0, 11);
  const container = originalContainer(first);
  if (container === null) {
    await deleteObject(cfg, original.key);
    await ctx.runMutation(internal.filmProjects.dropOriginal, { originalId: original.originalId });
    return { kind: "refused", reason: "geen_video" };
  }
  if (!(await ctx.runMutation(internal.filmProjects.markReceived, { originalId: original.originalId, container }))) {
    // Teruggetrokken tijdens het afronden: het object hoort nergens bij.
    await deleteQuietly(cfg, original.key);
    return { kind: "refused", reason: "niet_toegestaan" };
  }
  return { kind: "done" };
}

async function deleteQuietly(cfg: R2Config, key: string): Promise<void> {
  try {
    await deleteObject(cfg, key);
  } catch {
    // De R2-check van de originelen meldt het wees-object.
  }
}

/**
 * Afronden door de app. `{ kind: "missing", parts }`: deze delen ontbreken
 * nog (er verandert niets). Weigering `ORIGINAL_REFUSED` met `niet_toegestaan`
 * (niet de inzender, of het project neemt hem niet meer aan) of `geen_video`.
 */
export const finishOriginal = action({
  args: { originalId: v.string() },
  returns: v.union(
    v.object({ kind: v.literal("done") }),
    v.object({ kind: v.literal("missing"), parts: v.array(v.number()) }),
  ),
  handler: async (ctx, { originalId }): Promise<{ kind: "done" } | { kind: "missing"; parts: number[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) refuseOriginal("uitgelogd");
    const gate = await ctx.runQuery(internal.filmProjects.finishGate, { subject: identity.subject, originalId });
    if (gate.kind === "refused") refuseOriginal("niet_toegestaan");
    if (gate.kind === "done") return { kind: "done" };
    const cfg = r2OriginalsConfig();
    const result = await completeOriginal(ctx, cfg, gate.original);
    if (result.kind === "refused") refuseOriginal(result.reason);
    return result;
  },
});

/** De inzendingen die onderweg zijn met een upload, van projecten die ze nog aannemen. */
export const pendingUploads = internalQuery({
  args: {},
  returns: v.array(openOriginal),
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("filmOriginals")
      .withIndex("by_status_and_completedAt", (q) => q.eq("status", "onderweg"))
      .collect();
    const out: OpenOriginal[] = [];
    for (const r of rows) {
      if (r.uploadId === undefined) continue;
      const project = await ctx.db.get(r.projectId);
      if (!project || !projectAcceptsArrivals(project, now)) continue;
      out.push({ originalId: r._id, key: r.key, uploadId: r.uploadId, bytes: r.bytes });
    }
    return out;
  },
});

/**
 * A-invariant 9 (cron `film originals complete`, elk uur): rond af wat
 * helemaal binnen is, ook als de app niet meer langskomt. Een inzending
 * waarvan nog iets ontbreekt, blijft staan.
 */
export const completeUploaded = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    let cfg: R2Config;
    try {
      cfg = r2OriginalsConfig();
    } catch (e) {
      // De dagelijkse check mailt over de config.
      console.warn(`[filmProjects.completeUploaded] ${e instanceof Error ? e.message : "R2_CONFIG_MISSING"}`);
      return null;
    }
    const pending: OpenOriginal[] = await ctx.runQuery(internal.filmProjects.pendingUploads, {});
    for (const original of pending) {
      try {
        await completeOriginal(ctx, cfg, original);
      } catch (e) {
        console.warn(`[filmProjects.completeUploaded] afronden mislukt (${e instanceof R2Error ? e.message : "fout"})`);
      }
    }
    return null;
  },
});

// --- downloaden -------------------------------------------------------------------

/**
 * Besluit 8, A-invariant 8: alleen de oprichter van de groep van het project
 * (nu), alleen een origineel dat binnen is. Anders `null`.
 */
export const downloadTarget = internalQuery({
  args: { subject: v.string(), originalId: v.string() },
  returns: v.union(v.object({ key: v.string(), filename: v.string() }), v.null()),
  handler: async (ctx, { subject, originalId }) => {
    const user = await getBySubject(ctx, subject);
    if (!user) return null;
    const row = await originalById(ctx, originalId);
    if (!row || row.status !== "binnen") return null;
    const group = await ctx.db.get(row.groupId);
    if (!group || group.createdBy !== user._id) return null;
    if (!(await getMembership(ctx, user._id, row.groupId))) return null;
    const owner = await ctx.db.get(row.ownerId);
    const photo = await ctx.db.get(row.photoId);
    return {
      key: row.key,
      filename: originalFilename({
        takenAt: photo?.takenAt,
        submittedAt: row.submittedAt,
        ownerName: owner?.name ?? "",
        container: row.container ?? "mov",
      }),
    };
  },
});

/**
 * Een downloadlink van 1 uur: een GET op precies het origineel, als bijlage
 * met datum en inzender (zonder plaats). Eén weigering: `ORIGINAL_NOT_FOUND`.
 */
export const downloadUrl = action({
  args: { originalId: v.string() },
  returns: v.object({ url: v.string(), expiresAt: v.number() }),
  handler: async (ctx, { originalId }): Promise<{ url: string; expiresAt: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError(ORIGINAL_NOT_FOUND);
    const target = await ctx.runQuery(internal.filmProjects.downloadTarget, { subject: identity.subject, originalId });
    if (target === null) throw new ConvexError(ORIGINAL_NOT_FOUND);
    const cfg = r2OriginalsConfig();
    return await presignR2(cfg, "GET", target.key, ORIGINAL_DOWNLOAD_SECONDS, Date.now(), {
      query: { "response-content-disposition": attachmentDisposition(target.filename) },
    });
  },
});

// --- terugtrekken en verwijderen ---------------------------------------------------

/** Besluit 5: de inzender trekt een eigen inzending terug (onderweg of binnen); het filmpje blijft. */
export const withdraw = mutation({
  args: { originalId: v.string() },
  returns: v.null(),
  handler: async (ctx, { originalId }) => {
    const user = await requireOrNotFound(ctx);
    const row = await originalById(ctx, originalId);
    if (!row || row.ownerId !== user._id) throw new ConvexError(ORIGINAL_NOT_FOUND);
    await removeOriginalRows(ctx, [row]);
    return null;
  },
});

/** Besluit 9: de oprichter verwijdert één inzending. Iedereen anders: `ORIGINAL_NOT_FOUND`. */
export const removeOriginal = mutation({
  args: { originalId: v.string() },
  returns: v.null(),
  handler: async (ctx, { originalId }) => {
    const user = await requireOrNotFound(ctx);
    const row = await originalById(ctx, originalId);
    const group = row ? await ctx.db.get(row.groupId) : null;
    if (!row || !group || group.createdBy !== user._id || !(await getMembership(ctx, user._id, row.groupId))) {
      throw new ConvexError(ORIGINAL_NOT_FOUND);
    }
    await removeOriginalRows(ctx, [row]);
    return null;
  },
});

/** Besluit 9: de oprichter verwijdert alles van een project (binnen en onderweg). */
export const removeAll = mutation({
  args: { projectId: v.string() },
  returns: v.null(),
  handler: async (ctx, { projectId }) => {
    await requireCurrentUser(ctx);
    const project = await projectById(ctx, projectId);
    if (!project) refuseCode("NOT_MEMBER");
    await requireFounder(ctx, project.groupId);
    const rows = await ctx.db
      .query("filmOriginals")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    await removeOriginalRows(ctx, rows);
    return null;
  },
});

async function requireOrNotFound(ctx: MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  const user = identity ? await getBySubject(ctx, identity.subject) : null;
  if (!user) throw new ConvexError(ORIGINAL_NOT_FOUND);
  return user;
}

/**
 * Objecten en open uploads in de originelen-bucket wissen, best-effort: de
 * rijen zijn al weg. Mislukt het, dan meldt de R2-check het wees-object; een
 * halve upload breekt de lifecycle-regel na 7 dagen af.
 */
export const deleteOriginalObjects = internalAction({
  args: { items: v.array(v.object({ key: v.string(), uploadId: v.optional(v.string()) })) },
  returns: v.null(),
  handler: async (_ctx, { items }) => {
    let cfg: R2Config;
    try {
      cfg = r2OriginalsConfig();
    } catch (e) {
      console.warn(`[filmProjects.deleteOriginalObjects] ${e instanceof Error ? e.message : "R2_CONFIG_MISSING"}`);
      return null;
    }
    for (const item of items) {
      try {
        if (item.uploadId !== undefined) await abortMultipartUpload(cfg, item.key, item.uploadId);
        await deleteObject(cfg, item.key);
      } catch (e) {
        console.warn(`[filmProjects.deleteOriginalObjects] wissen in R2 mislukt (${e instanceof Error ? e.message : "fout"})`);
      }
    }
    return null;
  },
});

// --- een jaar, opruimen en de herinnering -------------------------------------------

/**
 * Dagelijks (cron `film originals expiry`):
 *   - een origineel dat een jaar binnen is: rij en object weg (A-invariant 11);
 *   - een inzending die onderweg is bij een project dat hem niet meer aanneemt
 *     (14 dagen na sluiten, besluit 18), of een jaar na aanmelden: rij en
 *     halve upload weg;
 *   - een project waarvan de einddatum voorbij is, gaat dicht (vangnet voor
 *     `closeIfDue`); een gesloten project zonder originelen staat al niet
 *     meer in de groep, de rij gaat weg als er een jaar en 14 dagen niets
 *     meer bij kan komen;
 *   - besluit 15: één mail aan de oprichter, 30 dagen voordat de eerste
 *     originelen van een project weggaan.
 */
export const expireOriginals = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("filmOriginals")
      .withIndex("by_status_and_completedAt", (q) => q.eq("status", "binnen").lte("completedAt", now - ORIGINAL_KEEP_MS))
      .collect();
    await removeOriginalRows(ctx, expired);

    const pending = await ctx.db
      .query("filmOriginals")
      .withIndex("by_status_and_completedAt", (q) => q.eq("status", "onderweg"))
      .collect();
    const stale: Doc<"filmOriginals">[] = [];
    for (const r of pending) {
      const project = await ctx.db.get(r.projectId);
      if (!project || !projectAcceptsArrivals(project, now) || now - r.submittedAt >= ORIGINAL_KEEP_MS) stale.push(r);
    }
    await removeOriginalRows(ctx, stale);

    for (const project of await ctx.db.query("filmProjects").collect()) {
      if (project.closedAt === undefined && now >= project.endsAt) {
        await ctx.db.patch(project._id, { closedAt: project.endsAt });
      }
      const rows = await ctx.db
        .query("filmOriginals")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      if (rows.length === 0) {
        // Uit de groep is hij al (listForGroup); de rij gaat pas weg als er
        // zeker niets meer bij kan horen, zodat een link naar de pagina nog
        // een tijd werkt.
        if (!projectIsOpen(project, now) && now - projectClosedAt(project) > ORIGINAL_KEEP_MS + ORIGINAL_ARRIVAL_AFTER_CLOSE_MS) {
          await ctx.db.delete(project._id);
        }
        continue;
      }
      if (project.reminderSentAt !== undefined) continue;
      const received = rows.filter((r) => r.status === "binnen" && r.completedAt !== undefined);
      if (received.length === 0) continue;
      const goneAt = received.map((r) => r.completedAt! + ORIGINAL_KEEP_MS);
      const firstGoneAt = Math.min(...goneAt);
      if (firstGoneAt - now > ORIGINAL_REMINDER_BEFORE_MS) continue;
      await ctx.db.patch(project._id, { reminderSentAt: now });
      await ctx.scheduler.runAfter(0, internal.filmProjects.sendReminder, {
        projectId: project._id,
        count: received.length,
        firstGoneAt,
        lastGoneAt: Math.max(...goneAt),
      });
    }
    return null;
  },
});

/** De gegevens voor de herinnering: de oprichter van nu, de groep, het album. */
export const reminderData = internalQuery({
  args: { projectId: v.id("filmProjects") },
  returns: v.union(
    v.object({ email: v.string(), founderName: v.string(), groupName: v.string(), albumName: v.string() }),
    v.null(),
  ),
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    const group = project ? await ctx.db.get(project.groupId) : null;
    const founder = group ? await ctx.db.get(group.createdBy) : null;
    if (!project || !group || !founder || founder.deletion) return null;
    return {
      email: founder.email,
      founderName: founder.name ?? founder.email,
      groupName: group.name,
      albumName: await albumNameOf(ctx, project),
    };
  },
});

/** Besluit 15: de mail aan de oprichter. Geen link en geen namen van inzenders. */
export const sendReminder = internalAction({
  args: { projectId: v.id("filmProjects"), count: v.number(), firstGoneAt: v.number(), lastGoneAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { projectId, count, firstGoneAt, lastGoneAt }) => {
    const data = await ctx.runQuery(internal.filmProjects.reminderData, { projectId });
    if (data === null) return null;
    const tpl = filmOriginalsReminderTemplate({
      founderName: data.founderName,
      groupName: data.groupName,
      albumName: data.albumName,
      count,
      firstGoneAt: amsterdamWallClock(firstGoneAt),
      lastGoneAt: amsterdamWallClock(lastGoneAt),
    });
    try {
      await sendMailjetMessage({
        from: { email: INFO_SENDER },
        to: [{ email: data.email }],
        subject: tpl.subject,
        htmlPart: tpl.htmlPart,
        textPart: tpl.textPart,
      });
    } catch (e) {
      console.warn(`[filmProjects.sendReminder] mail mislukt (${e instanceof Error ? e.message.split(":")[0] : "fout"})`);
    }
    return null;
  },
});

// --- bewaken ----------------------------------------------------------------------

/** Welke objecten en uploads horen er in de originelen-bucket te zijn. */
export const storageInventory = internalQuery({
  args: {},
  returns: v.object({
    received: v.array(v.object({ originalId: v.string(), key: v.string(), bytes: v.number() })),
    pendingKeys: v.array(v.string()),
    pendingUploads: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const received: { originalId: string; key: string; bytes: number }[] = [];
    const pendingKeys: string[] = [];
    const pendingUploads: string[] = [];
    for (const r of await ctx.db.query("filmOriginals").collect()) {
      if (r.status === "binnen") received.push({ originalId: r._id, key: r.key, bytes: r.bytes });
      else {
        pendingKeys.push(r.key);
        if (r.uploadId !== undefined) pendingUploads.push(r.uploadId);
      }
    }
    return { received, pendingKeys, pendingUploads };
  },
});

type OriginalsInventory = {
  received: { originalId: string; key: string; bytes: number }[];
  pendingKeys: string[];
  pendingUploads: string[];
};

/**
 * De dagelijkse R2-check van de originelen (A-invariant 14, cron `film
 * originals check`), naast die van WP37. Een object zonder inzending (ouder
 * dan een dag), een inzending die binnen is zonder object of met een andere
 * grootte, en een halve upload zonder inzending (ouder dan 8 dagen) geven één
 * mail aan de webmaster, net als een check die niet kon draaien. Wist niets.
 */
export const checkStorage = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const base = { stage: process.env.CLUBALMANAC_STAGE?.trim() || "onbekende", timestamp: new Date(now).toISOString() };
    let report: Parameters<typeof filmOriginalsCheckTemplate>[0] | null = null;
    try {
      const cfg = r2OriginalsConfig();
      const objects = await listObjects(cfg);
      const uploads = await listMultipartUploads(cfg);
      const inventory: OriginalsInventory = await ctx.runQuery(internal.filmProjects.storageInventory, {});
      const known = new Set([...inventory.received.map((r) => r.key), ...inventory.pendingKeys]);
      const sizes = new Map(objects.map((o) => [o.key, o.size]));
      const orphans = objects
        .filter((o) => !known.has(o.key) && now - o.lastModified > ORPHAN_AFTER_MS)
        .map((o) => ({ key: o.key, lastModified: o.lastModified }));
      const missing = inventory.received.filter((r) => !sizes.has(r.key)).map((r) => r.originalId);
      const wrongSize = inventory.received.filter((r) => sizes.has(r.key) && sizes.get(r.key) !== r.bytes).map((r) => r.originalId);
      const pendingUploads = new Set(inventory.pendingUploads);
      const staleUploads = uploads
        .filter((u) => !pendingUploads.has(u.uploadId) && now - u.initiated > STALE_UPLOAD_AFTER_MS)
        .map((u) => ({ key: u.key, initiated: u.initiated }));
      if (orphans.length > 0 || missing.length > 0 || wrongSize.length > 0 || staleUploads.length > 0) {
        report = { ...base, orphans, missing, wrongSize, staleUploads };
      }
    } catch (e) {
      const failure = e instanceof Error ? e.message : "onbekende fout";
      report = { ...base, failure, orphans: [], missing: [], wrongSize: [], staleUploads: [] };
    }
    if (report === null) return null;

    console.warn(
      `[filmProjects.checkStorage] ${report.failure ?? `${report.orphans.length} wees, ${report.missing.length} ontbrekend, ${report.wrongSize.length} andere grootte, ${report.staleUploads.length} halve uploads`}`,
    );
    const webmasters = getWebmasterEmails();
    if (webmasters.length === 0) {
      console.log("[filmProjects.checkStorage] geen WEBMASTER_EMAILS geconfigureerd, geen mail");
      return null;
    }
    const tpl = filmOriginalsCheckTemplate(report);
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
