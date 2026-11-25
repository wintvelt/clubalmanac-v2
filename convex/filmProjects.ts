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
  MAX_OPEN_ORIGINALS_PER_MEMBER,
  MAX_ORIGINAL_CALLS_PER_DAY,
  MAX_PROJECT_ORIGINAL_BYTES,
  MAX_TOTAL_ORIGINAL_BYTES,
  MIN_ORIGINAL_BYTES,
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
  projectTitleOf,
  removeOriginalRows,
} from "./lib/filmOriginals";
import { validName } from "./lib/names";
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

// WP38a — filmproject en originelen voor de feature-film (backend). Spec:
// docs/work-packages/WP38-filmproject-originelen.md §Besluiten, §A-invarianten,
// §Testcontract.
//
// Een project per groep, door de oprichter open en dicht gezet, met een titel
// en een einddatum (besluit 27: geen filmalbum, geen albumregel). Elk nieuw
// filmpje komt in het album dat het lid kiest. Staat het in een album van een
// groep met een open project en is het gemaakt terwijl dat project open stond,
// dan mag de eigenaar het origineel insturen:
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
/**
 * Fix-cyclus 1 (red-team S3): de lifecycle-regel van R2 (365 dagen) kan een
 * origineel rond het einde van zijn jaar wissen voordat de dagelijkse ronde
 * het doet. Vanaf een dag vóór dat einde meldt de check een inzending zonder
 * bestand niet meer. Fix-cyclus 2 (red-team N3): het jaar telt vanaf het
 * moment waarop de laatste upload is gekoppeld (`uploadCreatedAt`), zonder
 * dat moment vanaf het aanmelden. R2 breekt een halve upload na 7 dagen af,
 * dus het verschil met het einde van de upload is hooguit een week.
 */
const MISSING_QUIET_BEFORE_YEAR_END_MS = DAY_MS;
/** Besluit 15, fix-cyclus 1: zo lang geldt een geplande herinnering als bezig. */
const REMINDER_CLAIM_MS = 6 * 60 * 60 * 1000;
/**
 * Fix-cyclus 2 (red-team Z2): de afrond-cron kijkt alleen inzendingen na
 * waarvoor `startOriginal` deel-links gaf die nog gelden (7 dagen), plus een
 * dag speling (regie), zodat een PUT vlak voor het verlopen van de link nog
 * afgerond wordt, ook als een ronde van de cron mislukt. Daarna kan er zonder
 * nieuwe aanmelding niets meer binnenkomen; de app rondt zelf af
 * (`finishOriginal`). Precies op de grens telt niet meer.
 */
const CRON_LINK_WINDOW_MS = ORIGINAL_PART_LINK_SECONDS * 1000 + DAY_MS;

export const ORIGINAL_NOT_FOUND = { code: "ORIGINAL_NOT_FOUND" } as const;

type RefuseReason = "uitgelogd" | "niet_toegestaan" | "te_groot" | "te_klein" | "te_vaak" | "bezig" | "vol" | "geen_video";

function refuseOriginal(reason: RefuseReason): never {
  throw new ConvexError({ code: "ORIGINAL_REFUSED", reason });
}

const REFUSE_REASON = v.union(
  v.literal("uitgelogd"),
  v.literal("niet_toegestaan"),
  v.literal("te_groot"),
  v.literal("te_klein"),
  v.literal("te_vaak"),
  v.literal("bezig"),
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
 * verzoek). Besluit 28: een groep zonder album krijgt een album met de titel.
 * Besluit 27: een titel (de regels van een albumnaam: getrimd, 1 tot
 * 50 tekens, geen onzichtbare tekens); het project hangt niet aan een album.
 * De einddatum ligt in de toekomst en hooguit een jaar
 * vooruit (besluit 13); hooguit één open project per groep. Het project sluit
 * vanzelf op de einddatum.
 */
export const open = mutation({
  args: { groupId: v.id("groups"), title: v.string(), endsAt: v.number() },
  returns: v.string(),
  handler: async (ctx, { groupId, title: rawTitle, endsAt }) => {
    const { user } = await requireFounder(ctx, groupId);
    const title = validName(rawTitle, "NAME_REQUIRED");
    const now = Date.now();
    if (!endsAtAllowed(endsAt, now)) refuseCode("DATE_INVALID");
    if (await openProjectOfGroup(ctx, groupId, now)) throw new ConvexError({ code: "PROJECT_ALREADY_OPEN" });
    // Besluit 28: een groep zonder album krijgt in dezelfde mutation, na alle
    // controles, een leeg album met de titel, zoals `albums.create` het maakt
    // (maker de oprichter). Het is een gewoon album; het project hangt er niet
    // aan (besluit 27).
    const anyAlbum = await ctx.db
      .query("albums")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .first();
    if (!anyAlbum) {
      await ctx.db.insert("albums", { groupId, name: title, createdBy: user._id, createdAt: now });
    }
    const projectId = await ctx.db.insert("filmProjects", {
      groupId,
      title,
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

/**
 * Besluit 27 (open vraag 1, Wouter: ja): de titel wijzigen. Alleen de
 * oprichter (op het moment van het verzoek), met de regels van `open`. Ook na
 * sluiten (A-keuze): de titel verandert niets aan insturen of opruimen. Alleen
 * de titel verandert.
 */
export const setTitle = mutation({
  args: { projectId: v.string(), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { projectId, title: rawTitle }) => {
    await requireCurrentUser(ctx);
    const project = await projectById(ctx, projectId);
    if (!project) refuseCode("NOT_MEMBER");
    await requireFounder(ctx, project.groupId);
    const title = validName(rawTitle, "NAME_REQUIRED");
    await ctx.db.patch(project._id, { title });
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
  // Besluit 27: de titel, geen album.
  title: v.string(),
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
    const rows: { projectId: string; title: string; endsAt: number; open: boolean; openedAt: number }[] = [];
    for (const p of projects) {
      const isOpen = projectIsOpen(p, now);
      if (!isOpen && !(await hasOriginals(ctx, p._id))) continue;
      rows.push({ projectId: p._id, title: projectTitleOf(p), endsAt: p.endsAt, open: isOpen, openedAt: p.openedAt });
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
      title: v.string(),
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
    const out: { groupId: Id<"groups">; projectId: string; title: string; endsAt: number }[] = [];
    for (const m of memberships) {
      const p = await openProjectOfGroup(ctx, m.groupId, now);
      if (!p) continue;
      out.push({ groupId: p.groupId, projectId: p._id, title: projectTitleOf(p), endsAt: p.endsAt });
    }
    return out;
  },
});

/**
 * WP38c (besluit 3 na A): wanneer een inzending uiterlijk weggaat, zoals de
 * opruimronde (`expireOriginals`) het doet. Binnen: een jaar na binnenkomst.
 * Onderweg: 14 dagen na het sluiten (of de einddatum, ook als die nog komt of
 * verschuift), maar nooit later dan een jaar na het aanmelden.
 */
function originalGoneAt(original: Doc<"filmOriginals">, project: Doc<"filmProjects">): number {
  if (original.status === "binnen" && original.completedAt !== undefined) return original.completedAt + ORIGINAL_KEEP_MS;
  return Math.min(projectClosedAt(project) + ORIGINAL_ARRIVAL_AFTER_CLOSE_MS, original.submittedAt + ORIGINAL_KEEP_MS);
}

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
      title: v.string(),
      endsAt: v.number(),
      open: v.boolean(),
      closedAt: v.union(v.number(), v.null()),
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
        bytes: v.number(),
        goneAt: v.number(),
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
    const now = Date.now();
    const open = projectIsOpen(project, now);
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
        bytes: r.bytes,
        goneAt: originalGoneAt(r, project),
      });
    }
    return {
      project: {
        projectId: project._id as string,
        groupId: project.groupId,
        title: projectTitleOf(project),
        endsAt: project.endsAt,
        open,
        closedAt: open ? null : projectClosedAt(project),
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
 * filmpje dat in een album staat van een groep met een open project waar hij
 * lid van is (besluit 27: elk album van de groep), en gemaakt is terwijl dat
 * project open stond. Staat het in albums van twee groepen met elk een open
 * project, dan telt het album waar het het eerst in kwam (A-keuze). Al het andere
 * is één weigering (`niet_toegestaan`). Fix-cyclus 2 (heraudit 1): een
 * filmpje waarvan het origineel is teruggetrokken of door de oprichter
 * verwijderd (`originalBlockedAt`), neemt geen inzending meer aan.
 */
async function startState(ctx: QueryCtx, subject: string, photoId: Id<"photos">, now: number): Promise<StartState> {
  const user = await getBySubject(ctx, subject);
  if (!user) return { kind: "refused", reason: "uitgelogd" };
  const photo = await ctx.db.get(photoId);
  if (!photo || photo.ownerId !== user._id || !photo.video) return { kind: "refused", reason: "niet_toegestaan" };
  // Fix-cyclus 2 (heraudit 1): teruggetrokken of verwijderd blijft weg.
  if (photo.originalBlockedAt !== undefined) return { kind: "refused", reason: "niet_toegestaan" };

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
  placements.sort((a, b) => a.addedAt - b.addedAt || a._creationTime - b._creationTime);
  for (const ap of placements) {
    const project = await openProjectOfGroup(ctx, ap.groupId, now);
    if (!project) continue;
    if (photo.createdAt < project.openedAt || photo.createdAt >= projectClosedAt(project)) continue;
    if (!(await getMembership(ctx, user._id, project.groupId))) continue;
    return { kind: "new", userId: user._id, project };
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

/** Fix-cyclus 2 (red-team Z2): hoeveel inzendingen van dit lid onderweg zijn, over alle projecten. */
async function openOriginalsOf(ctx: QueryCtx, ownerId: Id<"users">): Promise<number> {
  const rows = await ctx.db
    .query("filmOriginals")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  return rows.filter((r) => r.status === "onderweg").length;
}

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
 * is telt mee; fix-cyclus 2: hooguit 30 onderweg per lid, `bezig`; de
 * daggrens als laatste, zodat een weigering niet meetelt), en per filmpje
 * hooguit één inzending. Opnieuw aanmelden geeft dezelfde inzending, met
 * dezelfde upload in R2; hervatten valt niet onder de 30. `linksAt` legt vast
 * dat er links komen (de afrond-cron kijkt daarnaar).
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
      // Een andere grootte weigert; vervangen kan niet (fix-cyclus 2).
      if (state.original.bytes !== bytes) return { kind: "refused" as const, reason: "niet_toegestaan" as const };
      if (!(await takeOriginalCall(ctx, state.original.ownerId, now))) return { kind: "refused" as const, reason: "te_vaak" as const };
      await ctx.db.patch(state.original._id, { linksAt: now });
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
    if ((await openOriginalsOf(ctx, state.userId)) >= MAX_OPEN_ORIGINALS_PER_MEMBER) {
      return { kind: "refused" as const, reason: "bezig" as const };
    }
    if (!(await takeOriginalCall(ctx, state.userId, now))) return { kind: "refused" as const, reason: "te_vaak" as const };
    const originalId = await ctx.db.insert("filmOriginals", {
      projectId: state.project._id,
      groupId: state.project.groupId,
      ownerId: state.userId,
      photoId,
      key: newKey,
      bytes,
      status: "onderweg",
      submittedAt: now,
      linksAt: now,
    });
    return { kind: "upload" as const, originalId, key: newKey, uploadId: null, bytes };
  },
});

/**
 * De upload-id van R2 bij een inzending, als er nog geen (of `previous`) is.
 * Heeft een gelijktijdige aanmelding er al een gezet, dan die. `done`: de
 * inzending is intussen binnen (fix-cyclus 1, red-team S2); `gone`: hij is weg.
 * Fix-cyclus 2 (red-team N3): het moment van koppelen is `uploadCreatedAt`,
 * het begin van het jaar voor MON3.
 */
export const attachUpload = internalMutation({
  args: { originalId: v.id("filmOriginals"), uploadId: v.string(), previous: v.union(v.string(), v.null()) },
  returns: v.union(
    v.object({ kind: v.literal("gone") }),
    v.object({ kind: v.literal("done") }),
    v.object({ kind: v.literal("use"), uploadId: v.string() }),
  ),
  handler: async (ctx, { originalId, uploadId, previous }) => {
    const row = await ctx.db.get(originalId);
    if (!row) return { kind: "gone" as const };
    if (row.status === "binnen") return { kind: "done" as const };
    if (row.uploadId !== undefined && row.uploadId !== previous) return { kind: "use" as const, uploadId: row.uploadId };
    await ctx.db.patch(originalId, { uploadId, uploadCreatedAt: Date.now() });
    return { kind: "use" as const, uploadId };
  },
});

type StartOriginalResult =
  | { kind: "upload"; originalId: string; partSize: number; parts: { partNumber: number; url: string }[]; expiresAt: number }
  | { kind: "done"; originalId: string };

/**
 * Een upload die R2 niet meer kent (afgebroken of afgerond) vervangen door een
 * nieuwe. Is de inzending intussen binnen, dan `done` en gaat de nieuwe upload
 * weer weg; is hij weg, dan `niet_toegestaan`.
 */
async function freshUpload(
  ctx: ActionCtx,
  cfg: R2Config,
  originalId: Id<"filmOriginals">,
  key: string,
  previous: string | null,
): Promise<{ kind: "done" } | { kind: "upload"; uploadId: string; parts: R2Part[] }> {
  const created = await createMultipartUpload(cfg, key);
  const kept = await ctx.runMutation(internal.filmProjects.attachUpload, { originalId, uploadId: created, previous });
  if (kept.kind === "gone") {
    await abortQuietly(cfg, key, created);
    refuseOriginal("niet_toegestaan");
  }
  if (kept.kind === "done") {
    await abortQuietly(cfg, key, created);
    return { kind: "done" };
  }
  if (kept.uploadId === created) return { kind: "upload", uploadId: created, parts: [] };
  await abortQuietly(cfg, key, created);
  return { kind: "upload", uploadId: kept.uploadId, parts: (await listParts(cfg, key, kept.uploadId)) ?? [] };
}

/**
 * Fix-cyclus 1 (kosten): de daggrens van `startOriginal` en `finishOriginal`
 * samen, per lid, glijdend over 24 uur (zoals WP37 A-invariant 36). Telt deze
 * aanroep mee en geeft `true`, of `false` boven de grens (dan telt hij niet).
 * Alleen voor een aanroep die doorgaat naar R2; de cron telt niet mee.
 */
async function takeOriginalCall(ctx: MutationCtx, ownerId: Id<"users">, now: number): Promise<boolean> {
  const dayAgo = now - DAY_MS;
  const recent = await ctx.db
    .query("originalRequests")
    .withIndex("by_owner_and_at", (q) => q.eq("ownerId", ownerId).gt("at", dayAgo))
    .take(MAX_ORIGINAL_CALLS_PER_DAY);
  if (recent.length >= MAX_ORIGINAL_CALLS_PER_DAY) return false;
  const stale = await ctx.db
    .query("originalRequests")
    .withIndex("by_owner_and_at", (q) => q.eq("ownerId", ownerId).lte("at", dayAgo))
    .take(50);
  for (const r of stale) await ctx.db.delete(r._id);
  await ctx.db.insert("originalRequests", { ownerId, at: now });
  return true;
}

/** De daggrens voor `finishOriginal` (na de toegang, vóór R2). */
export const countFinishCall = internalMutation({
  args: { subject: v.string() },
  returns: v.union(v.literal("ok"), v.literal("te_vaak"), v.literal("uitgelogd")),
  handler: async (ctx, { subject }) => {
    const user = await getBySubject(ctx, subject);
    if (!user) return "uitgelogd" as const;
    return (await takeOriginalCall(ctx, user._id, Date.now())) ? ("ok" as const) : ("te_vaak" as const);
  },
});

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
 * Al binnen: `{ kind: "done" }`, ook als R2 de upload net afrondde (het object
 * is er heel). Weigering: `ORIGINAL_REFUSED` met een reden; ook `te_klein`
 * (onder 1 MiB), `te_vaak` (de daggrens) en `bezig` (30 onderweg), alle drie
 * zonder R2.
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
    // Kosten (fix-cyclus 1 en 2): een origineel is minstens 1 MiB.
    if (bytes < MIN_ORIGINAL_BYTES) refuseOriginal("te_klein");

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
      if (uploadId !== null) {
        // Fix-cyclus 1 (red-team S2): R2 kent de upload niet meer. Misschien
        // rondde een ander hem net af; staat het object er heel, dan afronden
        // zoals `finishOriginal`, zonder nieuwe upload.
        const received = await receiveObject(ctx, cfg, reserved);
        if (received.kind === "done") return { kind: "done", originalId: reserved.originalId };
        if (received.kind === "refused") refuseOriginal(received.reason);
      }
      const fresh = await freshUpload(ctx, cfg, reserved.originalId, reserved.key, uploadId);
      if (fresh.kind === "done") return { kind: "done", originalId: reserved.originalId };
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

/**
 * Binnen: het object is heel, met dit merk. Fix-cyclus 1 (audit B1): drie
 * uitkomsten. `received`: nu binnen. `already`: een gelijktijdige afronding
 * was eerder (het object hoort erbij en blijft). `gone`: de inzending is weg
 * (teruggetrokken of verwijderd); alleen dan hoort het object nergens bij.
 */
export const markReceived = internalMutation({
  args: { originalId: v.id("filmOriginals"), container: v.union(v.literal("mov"), v.literal("mp4")) },
  returns: v.union(v.literal("received"), v.literal("already"), v.literal("gone")),
  handler: async (ctx, { originalId, container }) => {
    const row = await ctx.db.get(originalId);
    if (!row) return "gone" as const;
    if (row.status === "binnen") return "already" as const;
    await ctx.db.patch(originalId, { status: "binnen", completedAt: Date.now(), container, uploadId: undefined });
    return "received" as const;
  },
});

/**
 * Opnieuw beginnen (de upload is weg zonder heel object, of het object heeft
 * een andere grootte): de upload loskoppelen, maar alleen als de inzending nog
 * de upload `expected` heeft (fix-cyclus 1, red-team S1: vergelijk-en-wissel).
 * Een nieuwere upload van een gelijktijdig hervatten blijft staan.
 */
export const resetUpload = internalMutation({
  args: { originalId: v.id("filmOriginals"), expected: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { originalId, expected }) => {
    const row = await ctx.db.get(originalId);
    if (row && row.status === "onderweg" && row.uploadId !== undefined && row.uploadId === expected) {
      await ctx.db.patch(originalId, { uploadId: undefined });
    }
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

type Refused = { kind: "refused"; reason: "geen_video" | "niet_toegestaan" };
type CompleteResult = { kind: "done" } | { kind: "missing"; parts: number[] } | Refused;
type ReceiveResult = { kind: "done" } | { kind: "absent" } | { kind: "wrongSize" } | Refused;

/**
 * Het object in R2 nakijken en de inzending binnen zetten (A-invariant 5):
 * precies de aangemelde grootte, en een `ftyp` van QuickTime of mp4. Geen
 * filmpje: object en inzending weg. Fix-cyclus 1 (audit B1): het object gaat
 * alleen weg als de inzending weg is; was een gelijktijdige afronding eerder,
 * dan is het ook `done`. `absent` en `wrongSize` beslist de aanroeper.
 */
async function receiveObject(
  ctx: ActionCtx,
  cfg: R2Config,
  original: { originalId: Id<"filmOriginals">; key: string; bytes: number },
): Promise<ReceiveResult> {
  const head = await headObject(cfg, original.key);
  if (!head) return { kind: "absent" };
  if (head.size !== original.bytes) return { kind: "wrongSize" };
  const { bytes: first } = await readRange(cfg, original.key, 0, 11);
  const container = originalContainer(first);
  if (container === null) {
    await deleteObject(cfg, original.key);
    await ctx.runMutation(internal.filmProjects.dropOriginal, { originalId: original.originalId });
    return { kind: "refused", reason: "geen_video" };
  }
  const marked = await ctx.runMutation(internal.filmProjects.markReceived, { originalId: original.originalId, container });
  if (marked === "gone") {
    // Teruggetrokken of verwijderd tijdens het afronden: het object hoort nergens bij.
    await deleteQuietly(cfg, original.key);
    return { kind: "refused", reason: "niet_toegestaan" };
  }
  return { kind: "done" };
}

/**
 * Afronden (A-invariant 5): pas als R2 elk deel met de geplande grootte
 * heeft. Dan afronden met de lijst van R2 en het object nakijken
 * (`receiveObject`). De bytes blijven zoals de app ze stuurde (A-invariant 6):
 * geen kopie, geen herschrijving.
 */
async function completeOriginal(ctx: ActionCtx, cfg: R2Config, original: OpenOriginal): Promise<CompleteResult> {
  const result = await tryComplete(ctx, cfg, original);
  // Fix-cyclus 2 (heraudit 1): is de inzending weg (teruggetrokken of
  // verwijderd terwijl afronden liep), dan nooit `missing`: de app zou delen
  // gaan nasturen.
  if (result.kind === "missing" && !(await ctx.runQuery(internal.filmProjects.originalExists, { originalId: original.originalId }))) {
    return { kind: "refused", reason: "niet_toegestaan" };
  }
  return result;
}

/** Bestaat de inzending nog (onderweg of binnen)? */
export const originalExists = internalQuery({
  args: { originalId: v.id("filmOriginals") },
  returns: v.boolean(),
  handler: async (ctx, { originalId }) => (await ctx.db.get(originalId)) !== null,
});

async function tryComplete(ctx: ActionCtx, cfg: R2Config, original: OpenOriginal): Promise<CompleteResult> {
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
  // een nieuwe upload), maar alleen als de inzending nog deze upload heeft.
  const received = await receiveObject(ctx, cfg, original);
  if (received.kind === "absent") {
    if (present === null && original.uploadId !== null) {
      await ctx.runMutation(internal.filmProjects.resetUpload, { originalId: original.originalId, expected: original.uploadId });
    }
    return { kind: "missing", parts: all };
  }
  if (received.kind === "wrongSize") {
    await deleteQuietly(cfg, original.key);
    await ctx.runMutation(internal.filmProjects.resetUpload, { originalId: original.originalId, expected: original.uploadId });
    return { kind: "missing", parts: all };
  }
  return received;
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
 * (niet de inzender, het project neemt hem niet meer aan, of de inzending is
 * weg, ook als dat gebeurt terwijl afronden loopt), `te_vaak` (de daggrens,
 * vóór R2) of `geen_video`.
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
    const counted = await ctx.runMutation(internal.filmProjects.countFinishCall, { subject: identity.subject });
    if (counted !== "ok") refuseOriginal(counted);
    const result = await completeOriginal(ctx, cfg, gate.original);
    if (result.kind === "refused") refuseOriginal(result.reason);
    return result;
  },
});

/**
 * De inzendingen die onderweg zijn met een upload, van projecten die ze nog
 * aannemen, met deel-links die nog gelden (fix-cyclus 2, `CRON_LINK_WINDOW_MS`).
 */
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
      if (now - (r.linksAt ?? r.submittedAt) >= CRON_LINK_WINDOW_MS) continue;
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
    await blockOriginalsOf(ctx, [row]);
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
    await blockOriginalsOf(ctx, [row]);
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
    await blockOriginalsOf(ctx, rows);
    await removeOriginalRows(ctx, rows);
    return null;
  },
});

/**
 * Fix-cyclus 2 (heraudit 1): na terugtrekken of verwijderen door de oprichter
 * neemt het filmpje geen inzending meer aan (`startState`). Weg om een andere
 * reden (geen filmpje, 14 dagen na sluiten, een jaar, vertrek) markeert niet.
 */
async function blockOriginalsOf(ctx: MutationCtx, rows: Doc<"filmOriginals">[]): Promise<void> {
  const now = Date.now();
  for (const r of rows) {
    const photo = await ctx.db.get(r.photoId);
    if (photo && photo.originalBlockedAt === undefined) await ctx.db.patch(r.photoId, { originalBlockedAt: now });
  }
}

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
    // Fix-cyclus 1 (audit N4): afbreken en wissen los van elkaar; mislukt het
    // een (storing), dan gebeurt het ander toch.
    for (const item of items) {
      if (item.uploadId !== undefined) {
        try {
          await abortMultipartUpload(cfg, item.key, item.uploadId);
        } catch (e) {
          console.warn(`[filmProjects.deleteOriginalObjects] afbreken in R2 mislukt (${e instanceof Error ? e.message : "fout"})`);
        }
      }
      try {
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
 *     originelen van een project weggaan. Fix-cyclus 1 (red-team N7): pas
 *     verstuurd als de mail weg is (`reminderSentAt`); een ronde die hem
 *     plant, zet `reminderClaimedAt`, zodat een tweede ronde vlak erna niet
 *     nog een mail plant. Mislukt de mail, dan probeert de volgende dagelijkse
 *     ronde het opnieuw.
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
      if (project.reminderClaimedAt !== undefined && now - project.reminderClaimedAt < REMINDER_CLAIM_MS) continue;
      const received = rows.filter((r) => r.status === "binnen" && r.completedAt !== undefined);
      if (received.length === 0) continue;
      const goneAt = received.map((r) => r.completedAt! + ORIGINAL_KEEP_MS);
      const firstGoneAt = Math.min(...goneAt);
      if (firstGoneAt - now > ORIGINAL_REMINDER_BEFORE_MS) continue;
      await ctx.db.patch(project._id, { reminderClaimedAt: now });
      await ctx.scheduler.runAfter(0, internal.filmProjects.sendReminder, {
        projectId: project._id,
        claimedAt: now,
        count: received.length,
        firstGoneAt,
        lastGoneAt: Math.max(...goneAt),
      });
    }
    return null;
  },
});

/** De gegevens voor de herinnering: de oprichter van nu, de groep, de titel (besluit 27). */
export const reminderData = internalQuery({
  args: { projectId: v.id("filmProjects") },
  returns: v.union(
    v.object({ email: v.string(), founderName: v.string(), groupName: v.string(), title: v.string() }),
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
      title: projectTitleOf(project),
    };
  },
});

/**
 * Fix-cyclus 1 (red-team N7): de mail is weg. Bij een mislukte mail: de claim
 * los, zodat de volgende ronde het opnieuw probeert.
 */
export const settleReminder = internalMutation({
  args: { projectId: v.id("filmProjects"), claimedAt: v.number(), sent: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { projectId, claimedAt, sent }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    if (sent) {
      await ctx.db.patch(projectId, { reminderSentAt: Date.now(), reminderClaimedAt: undefined });
    } else if (project.reminderClaimedAt === claimedAt) {
      await ctx.db.patch(projectId, { reminderClaimedAt: undefined });
    }
    return null;
  },
});

/** Besluit 15: de mail aan de oprichter. Geen link en geen namen van inzenders. */
export const sendReminder = internalAction({
  args: {
    projectId: v.id("filmProjects"),
    claimedAt: v.number(),
    count: v.number(),
    firstGoneAt: v.number(),
    lastGoneAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { projectId, claimedAt, count, firstGoneAt, lastGoneAt }) => {
    const data = await ctx.runQuery(internal.filmProjects.reminderData, { projectId });
    if (data === null) {
      // Geen oprichter om te mailen (nu): de volgende ronde kijkt opnieuw.
      await ctx.runMutation(internal.filmProjects.settleReminder, { projectId, claimedAt, sent: false });
      return null;
    }
    const tpl = filmOriginalsReminderTemplate({
      founderName: data.founderName,
      groupName: data.groupName,
      title: data.title,
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
      await ctx.runMutation(internal.filmProjects.settleReminder, { projectId, claimedAt, sent: false });
      return null;
    }
    await ctx.runMutation(internal.filmProjects.settleReminder, { projectId, claimedAt, sent: true });
    return null;
  },
});

// --- bewaken ----------------------------------------------------------------------

/** Welke objecten en uploads horen er in de originelen-bucket te zijn. */
export const storageInventory = internalQuery({
  args: {},
  returns: v.object({
    received: v.array(v.object({ originalId: v.string(), key: v.string(), bytes: v.number(), yearFrom: v.number() })),
    pendingKeys: v.array(v.string()),
    pendingUploads: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const received: { originalId: string; key: string; bytes: number; yearFrom: number }[] = [];
    const pendingKeys: string[] = [];
    const pendingUploads: string[] = [];
    for (const r of await ctx.db.query("filmOriginals").collect()) {
      // Fix-cyclus 2 (red-team N3): het jaar telt vanaf de laatste upload; zonder dat moment het aanmelden.
      if (r.status === "binnen") {
        received.push({ originalId: r._id, key: r.key, bytes: r.bytes, yearFrom: r.uploadCreatedAt ?? r.submittedAt });
      } else {
        pendingKeys.push(r.key);
        if (r.uploadId !== undefined) pendingUploads.push(r.uploadId);
      }
    }
    return { received, pendingKeys, pendingUploads };
  },
});

type OriginalsInventory = {
  received: { originalId: string; key: string; bytes: number; yearFrom: number }[];
  pendingKeys: string[];
  pendingUploads: string[];
};

/**
 * De dagelijkse R2-check van de originelen (A-invariant 14, cron `film
 * originals check`), naast die van WP37. Een object zonder inzending (ouder
 * dan een dag), een inzending die binnen is zonder object (tot een dag vóór
 * een jaar na de laatste upload) of met een andere grootte, en een halve upload zonder inzending (ouder dan 8 dagen) geven één
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
      // Rond het einde van het jaar kan de lifecycle-regel het object al
      // gewist hebben: dan niet melden (fix-cyclus 1, red-team S3).
      const missing = inventory.received
        .filter((r) => !sizes.has(r.key) && now < r.yearFrom + ORIGINAL_KEEP_MS - MISSING_QUIET_BEFORE_YEAR_END_MS)
        .map((r) => r.originalId);
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
