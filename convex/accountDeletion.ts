import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalRemovePhoto } from "./photos";
import { deleteGroupCascade, internalRemoveMember } from "./groups";
import { normalizeEmail } from "./lib/email";
import { getWebmasterEmails } from "./lib/auth";
import { INFO_SENDER, sendMailjetMessage } from "./lib/mailjet";
import { accountDeletionClerkFailedTemplate } from "./lib/emailTemplates";
import { clerkSubjectHash } from "./lib/accountState";

// WP29 — account verwijderen. Spec: docs/work-packages/WP29-account-verwijderen.md
// §Advies open vraag 2 en §A-invarianten.
//
// 1. Afsluiten: `users.deleteSelf` zet `users.deletion` in één kleine
//    transactie (`startAccountDeletion`). Vanaf dan is het lid voor elke
//    publieke functie niet meer ingelogd (lib/accountState.ts).
// 2. Convex opruimen: `step` doet per aanroep één begrensd stuk werk, in een
//    vaste volgorde van fases, en plant zichzelf opnieuw tot er niets meer van
//    het lid is. Elke stap begint weer bij de eerste fase, zodat wat tussendoor
//    binnenkwam (een upload die net klaar was) ook meegaat (A-invariant 5).
// 3. Clerk: `deleteClerkUser` direct na stap 1, los van stap 2. 404 telt als
//    gelukt; anders opnieuw volgens CLERK_RETRY_DELAYS_MS (samen ruim een uur).
//    Na de laatste poging, of zonder passende sleutel: één mail aan de
//    webmaster. Er loopt hooguit één reeks pogingen (`deletion.clerkRun`).
// 4. De users-rij gaat als laatste weg, als 2 én 3 klaar zijn. Wie als tweede
//    klaar is, ruimt hem op: `step` als Clerk al klaar was, anders
//    `clerkDeleted` via een laatste `step` (die ook nog een keer alles nakijkt).
//
// Fase-volgorde (de reden staat bij elke fase): eigen foto's vóór de
// lidmaatschappen, zodat de lidmaatschap-cascade (M1, M2-e) bij een groot
// account niets meer te lezen heeft; de opvolging (M2-c/d)
// vóór de albums, zodat een album de nieuwe oprichter als maker krijgt.

// Per stap. Ruim binnen de limieten van één transactie (4096 db-aanroepen,
// 32.000 gelezen documenten, 1000 geplande functies), ook met de full-scans in
// internalRemovePhoto (groepen, albums, users per foto).
const PHOTOS_PER_STEP = 50;
const ROWS_PER_STEP = 500;
const FEATURES_PER_STEP = 50;
const GROUPS_PER_STEP = 5;

/** Wachttijd vóór poging 2, 3, …: samen 111 minuten, zes pogingen. */
export const CLERK_RETRY_DELAYS_MS = [1, 5, 15, 30, 60].map((m) => m * 60_000);

const CLERK_API = "https://api.clerk.com/v1/users/";

/** Fix 5: een Clerk-aanroep die langer duurt, telt als mislukte poging. */
export const CLERK_TIMEOUT_MS = 30_000;

/**
 * Stap 1: het account afsluiten. Een tweede keer doet niets.
 *
 * Fix 1b: een hash van de Clerk-subject blijft bewaard, zodat deze Clerk-user
 * nooit meer een rij krijgt. Fix 8: het adres wordt genormaliseerd, zodat
 * `invites.create` het vindt (een gemigreerde rij kan hoofdletters hebben).
 */
export async function startAccountDeletion(
  ctx: MutationCtx,
  user: Doc<"users">,
): Promise<void> {
  if (user.deletion) return;
  const now = Date.now();
  const subjectHash = await clerkSubjectHash(user.subject);
  const marker = await ctx.db
    .query("deletedClerkSubjects")
    .withIndex("by_subjectHash", (q) => q.eq("subjectHash", subjectHash))
    .first();
  if (!marker) await ctx.db.insert("deletedClerkSubjects", { subjectHash, deletedAt: now });

  await ctx.scheduler.runAfter(0, internal.accountDeletion.step, { userId: user._id });
  const clerk = await scheduleClerkRun(ctx, user._id, user.subject, 1);
  await ctx.db.patch(user._id, {
    email: normalizeEmail(user.email),
    deletion: { startedAt: now, ...clerk },
  });
}

/** Plant poging 1 van Clerk-reeks `run`; geeft de velden voor `deletion`. */
async function scheduleClerkRun(
  ctx: MutationCtx,
  userId: Id<"users">,
  subject: string,
  run: number,
): Promise<{ clerkRun: number; clerkJobId: Id<"_scheduled_functions"> }> {
  const clerkJobId = await ctx.scheduler.runAfter(0, internal.accountDeletion.deleteClerkUser, {
    userId,
    subject,
    attempt: 0,
    run,
  });
  return { clerkRun: run, clerkJobId };
}

/**
 * Loopt er nog een reeks Clerk-pogingen? Ja als de laatst geplande poging nog
 * gepland staat of bezig is, en de reeks niet al heeft opgegeven. Een reeks
 * die gecrasht is, loopt niet meer.
 */
async function clerkRunActive(
  ctx: MutationCtx,
  deletion: NonNullable<Doc<"users">["deletion"]>,
): Promise<boolean> {
  if (deletion.clerkFailedAt !== undefined || deletion.clerkJobId === undefined) return false;
  const job = await ctx.db.system.get(deletion.clerkJobId);
  return job?.state.kind === "pending" || job?.state.kind === "inProgress";
}

/**
 * A-invariant 7: opnieuw starten (webmaster). Clerk opnieuw als die nog niet
 * gelukt is en er geen reeks pogingen meer loopt (fix 3: hooguit één reeks,
 * dus ook hooguit één mail), en een opruimstap die alles nakijkt en de rij
 * weghaalt als alles klaar is. Een account dat niet wordt verwijderd: niets.
 */
export async function restartAccountDeletion(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  const user = await ctx.db.get(userId);
  if (!user?.deletion) return;
  const deletion = user.deletion;
  if (deletion.clerkDoneAt === undefined && !(await clerkRunActive(ctx, deletion))) {
    const { clerkFailedAt: _failed, ...rest } = deletion;
    const clerk = await scheduleClerkRun(ctx, userId, user.subject, (deletion.clerkRun ?? 1) + 1);
    await ctx.db.patch(userId, { deletion: { ...rest, ...clerk } });
  }
  await ctx.scheduler.runAfter(0, internal.accountDeletion.step, { userId });
}

// ── Stap 2: Convex opruimen ──────────────────────────────────────────

type Phase = (ctx: MutationCtx, user: Doc<"users">) => Promise<boolean>;

export const step = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user?.deletion) return null;

    for (const phase of PHASES) {
      if (await phase(ctx, user)) {
        await ctx.scheduler.runAfter(0, internal.accountDeletion.step, { userId });
        return null;
      }
    }

    // Niets meer van hem, behalve de rij.
    if (user.deletion.clerkDoneAt !== undefined) {
      await ctx.db.delete(userId);
      return null;
    }
    if (user.deletion.convexDoneAt === undefined) {
      await ctx.db.patch(userId, {
        photoCount: 0,
        deletion: { ...user.deletion, convexDoneAt: Date.now() },
      });
    }
    return null;
  },
});

/**
 * Een losse profielfoto (gemigreerd: geen foto-rij) gaat uit storage. Is het
 * beeld van een foto, dan blijft het: een eigen foto neemt zijn beeld zelf mee,
 * dat van een ander blijft van de ander.
 */
const profilePhase: Phase = async (ctx, user) => {
  const storageId = user.profilePhotoStorageId;
  if (storageId === undefined) return false;
  await ctx.db.patch(user._id, { profilePhotoStorageId: undefined });
  const ofPhoto = await ctx.db
    .query("photos")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  const otherUsers = (await ctx.db.query("users").collect()).filter(
    (u) => u._id !== user._id && u.profilePhotoStorageId === storageId,
  );
  if (!ofPhoto && otherUsers.length === 0) {
    await ctx.scheduler.runAfter(0, internal.photos.cleanupStorage, { storageIds: [storageId] });
  }
  return true;
};

/**
 * U7: zijn foto's, met P3, P5 en P7 en hun beelden (internalRemovePhoto). Vóór
 * de lidmaatschappen: de M1-cascade en M2-e hebben dan geen publicaties van
 * hem meer te lezen.
 */
const photosPhase: Phase = async (ctx, user) => {
  const photos = await ctx.db
    .query("photos")
    .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
    .take(PHOTOS_PER_STEP);
  for (const p of photos) await internalRemovePhoto(ctx, p._id);
  return photos.length > 0;
};

/** WP18 A-invariant 22: zijn upload-reserveringen, ook "nog bezig". */
const reservationsPhase: Phase = async (ctx, user) => {
  const rows = await ctx.db
    .query("uploadIdempotency")
    .withIndex("by_owner_and_clientUploadId", (q) => q.eq("ownerId", user._id))
    .take(ROWS_PER_STEP);
  for (const r of rows) await ctx.db.delete(r._id);
  return rows.length > 0;
};

/** U8: één lidmaatschap per stap, met de M1/M2/M3-cascade (internalRemoveMember). */
const membershipsPhase: Phase = async (ctx, user) => {
  const m = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .first();
  if (!m) return false;
  await internalRemoveMember(ctx, { userId: user._id, groupId: m.groupId });
  return true;
};

/**
 * Een groep die nog op zijn naam staat zonder dat hij lid is (alleen bij
 * kapotte data; normaal regelt M2-d dat): de vroegste admin wordt oprichter,
 * anders het vroegste lid (dat ook admin wordt). Zonder leden gaat de groep
 * weg (M2-e).
 */
const foundedGroupsPhase: Phase = async (ctx, user) => {
  const groups = await ctx.db
    .query("groups")
    .withIndex("by_createdBy", (q) => q.eq("createdBy", user._id))
    .take(GROUPS_PER_STEP);
  for (const g of groups) {
    const members = (
      await ctx.db
        .query("memberships")
        .withIndex("by_group", (q) => q.eq("groupId", g._id))
        .collect()
    ).sort((a, b) => a.joinedAt - b.joinedAt);
    const next = members.find((m) => m.role === "admin") ?? members[0];
    if (!next) {
      await deleteGroupCascade(ctx, g._id);
      continue;
    }
    if (next.role !== "admin") await ctx.db.patch(next._id, { role: "admin" });
    await ctx.db.patch(g._id, { createdBy: next.userId });
  }
  return groups.length > 0;
};

/**
 * A-invariant 4: een album dat hij maakte in een groep die blijft, krijgt de
 * oprichter van de groep (na de opvolging) als maker. Een album zonder groep
 * (kapotte data) gaat weg.
 */
const albumsPhase: Phase = async (ctx, user) => {
  const albums = await ctx.db
    .query("albums")
    .withIndex("by_createdBy", (q) => q.eq("createdBy", user._id))
    .take(ROWS_PER_STEP);
  for (const a of albums) {
    // foundedGroupsPhase staat eerder: geen groep heeft hem nog als oprichter.
    const group = await ctx.db.get(a.groupId);
    if (group) await ctx.db.patch(a._id, { createdBy: group.createdBy });
    else await deleteAlbumRows(ctx, a._id);
  }
  return albums.length > 0;
};

async function deleteAlbumRows(ctx: MutationCtx, albumId: Id<"albums">): Promise<void> {
  const pubs = await ctx.db
    .query("albumPhotos")
    .withIndex("by_album", (q) => q.eq("albumId", albumId))
    .collect();
  for (const p of pubs) await ctx.db.delete(p._id);
  const seen = await ctx.db
    .query("albumLastSeen")
    .withIndex("by_album", (q) => q.eq("albumId", albumId))
    .collect();
  for (const s of seen) await ctx.db.delete(s._id);
  await ctx.db.delete(albumId);
}

/**
 * A-invariant 4: een publicatie van andermans foto die hij toevoegde
 * (gemigreerd) blijft, toegevoegd door de eigenaar van de foto. Zijn eigen
 * foto's zijn dan al weg (photosPhase staat eerder).
 */
const addedByPhase: Phase = async (ctx, user) => {
  const pubs = await ctx.db
    .query("albumPhotos")
    .withIndex("by_addedBy", (q) => q.eq("addedBy", user._id))
    .take(ROWS_PER_STEP);
  for (const ap of pubs) {
    const photo = await ctx.db.get(ap.photoId);
    if (photo && photo.ownerId !== user._id) {
      await ctx.db.patch(ap._id, { addedBy: photo.ownerId });
    } else if (!photo) {
      await ctx.db.delete(ap._id);
    }
  }
  return pubs.length > 0;
};

/** U10: `flaggedBy` weg, de melding blijft. Alleen gemelde foto's (by_flagged). */
const flaggedPhase: Phase = async (ctx, user) => {
  const flagged = (
    await ctx.db
      .query("photos")
      .withIndex("by_flagged", (q) => q.gte("flaggedAt", 0))
      .collect()
  ).filter((p) => p.flaggedBy === user._id);
  for (const p of flagged) await ctx.db.patch(p._id, { flaggedBy: undefined });
  return flagged.length > 0;
};

/** A-keuze 2: alle uitnodigingen die hij verstuurde, welke status ook. */
const sentInvitesPhase: Phase = async (ctx, user) => {
  const rows = await ctx.db
    .query("invites")
    .withIndex("by_invitedBy", (q) => q.eq("invitedBy", user._id))
    .take(ROWS_PER_STEP);
  for (const i of rows) await ctx.db.delete(i._id);
  return rows.length > 0;
};

/**
 * A-keuze 2: alle uitnodigingen aan zijn adres, welke status ook. Op het
 * genormaliseerde adres (uitnodigingen zijn genormaliseerd; een gemigreerd adres
 * in de users-rij niet altijd), en voor de zekerheid ook op het adres zoals
 * het in de rij staat.
 */
const receivedInvitesPhase: Phase = async (ctx, user) => {
  const emails = new Set([normalizeEmail(user.email), user.email]);
  let found = false;
  for (const email of emails) {
    const rows = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(ROWS_PER_STEP);
    for (const i of rows) await ctx.db.delete(i._id);
    found ||= rows.length > 0;
  }
  return found;
};

/** A-keuze 1: zijn features en problemen, met de upvotes erop. */
const featuresPhase: Phase = async (ctx, user) => {
  const features = await ctx.db
    .query("features")
    .withIndex("by_submittedBy", (q) => q.eq("submittedBy", user._id))
    .take(FEATURES_PER_STEP);
  for (const f of features) {
    const upvotes = await ctx.db
      .query("featureUpvotes")
      .withIndex("by_feature", (q) => q.eq("featureId", f._id))
      .collect();
    for (const u of upvotes) await ctx.db.delete(u._id);
    await ctx.db.delete(f._id);
  }
  return features.length > 0;
};

/** Zijn upvotes op features van anderen; de teller wordt herteld. */
const upvotesPhase: Phase = async (ctx, user) => {
  const upvotes = await ctx.db
    .query("featureUpvotes")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .take(ROWS_PER_STEP);
  for (const u of upvotes) await ctx.db.delete(u._id);
  for (const featureId of new Set(upvotes.map((u) => u.featureId))) {
    if (!(await ctx.db.get(featureId))) continue;
    const left = await ctx.db
      .query("featureUpvotes")
      .withIndex("by_feature", (q) => q.eq("featureId", featureId))
      .collect();
    await ctx.db.patch(featureId, { upvoteCount: left.length });
  }
  return upvotes.length > 0;
};

/** U9/M3: wat M3 per groep niet ving (bv. een album zonder lidmaatschap). */
const lastSeenPhase: Phase = async (ctx, user) => {
  const rows = await ctx.db
    .query("albumLastSeen")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .take(ROWS_PER_STEP);
  for (const r of rows) await ctx.db.delete(r._id);
  return rows.length > 0;
};

/** U11: zijn bezoek. */
const visitsPhase: Phase = async (ctx, user) => {
  const rows = await ctx.db
    .query("userVisits")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .take(ROWS_PER_STEP);
  for (const r of rows) await ctx.db.delete(r._id);
  return rows.length > 0;
};

const PHASES: Phase[] = [
  profilePhase,
  photosPhase,
  reservationsPhase,
  membershipsPhase,
  foundedGroupsPhase,
  albumsPhase,
  addedByPhase,
  flaggedPhase,
  sentInvitesPhase,
  receivedInvitesPhase,
  featuresPhase,
  upvotesPhase,
  lastSeenPhase,
  visitsPhase,
];

// ── Stap 3: de Clerk-user ────────────────────────────────────────────

/** Fix 1a en fix-cyclus 2: de bekende omgevingen, exact zo geschreven. */
const CLERK_KEY_PREFIX_BY_STAGE: Record<string, string> = {
  prod: "sk_live_",
  dev: "sk_test_",
};

/**
 * Fix 1a: de sleutel moet bij de omgeving passen. Prod vraagt `sk_live_`, dev
 * `sk_test_`. Een sleutel van de verkeerde Clerk-omgeving geeft 404, en dat
 * telt als gelukt. Fix-cyclus 2: een ontbrekende of onbekende stage is ook
 * een sleutelprobleem. Geeft de reden voor de mail (zonder de sleutel), of
 * null als de sleutel bruikbaar is.
 */
function clerkKeyProblem(key: string | undefined, stage: string | undefined): string | null {
  const prefix = stage === undefined ? undefined : CLERK_KEY_PREFIX_BY_STAGE[stage];
  if (prefix === undefined) {
    return `CLUBALMANAC_STAGE ontbreekt of is onbekend (${stage === undefined ? "niet gezet" : JSON.stringify(stage)}; verwacht prod of dev)`;
  }
  if (!key) return "CLERK_SECRET_KEY ontbreekt";
  if (!key.startsWith(prefix)) {
    return `CLERK_SECRET_KEY past niet bij de ${stage} omgeving (verwacht ${prefix}…)`;
  }
  return null;
}

/**
 * A-invariant 6: `DELETE /v1/users/{subject}` op de Clerk Backend API. 2xx en
 * 404 (bestaat al niet) tellen als gelukt. Elke andere uitkomst, ook een
 * netwerkfout of een timeout (fix 5), wordt herhaald tot de pogingen op zijn;
 * dan, of meteen zonder passende sleutel, één mail aan de webmaster
 * (A-invariant 7). Een poging van een oude reeks, of nadat Clerk al gelukt
 * is, doet niets (fix 3).
 */
export const deleteClerkUser = internalAction({
  args: {
    userId: v.id("users"),
    subject: v.string(),
    attempt: v.number(),
    run: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { userId, subject, attempt, run = 1 }) => {
    const current = await ctx.runQuery(internal.accountDeletion.clerkRunIsCurrent, { userId, run });
    if (!current) return null;

    const stage = process.env.CLUBALMANAC_STAGE;
    const key = process.env.CLERK_SECRET_KEY;
    const keyProblem = clerkKeyProblem(key, stage);
    if (keyProblem !== null || key === undefined) {
      await giveUp(ctx, userId, subject, run, keyProblem ?? "CLERK_SECRET_KEY ontbreekt");
      return null;
    }

    let reason: string;
    // Fix 5: op setTimeout, niet AbortSignal.timeout (dat loopt in vitest op
    // de echte klok).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Clerk timeout")), CLERK_TIMEOUT_MS);
    try {
      const res = await fetch(`${CLERK_API}${encodeURIComponent(subject)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      if (res.ok || res.status === 404) {
        await ctx.runMutation(internal.accountDeletion.clerkDeleted, { userId });
        return null;
      }
      reason = `Clerk status ${res.status}`;
    } catch {
      reason = controller.signal.aborted
        ? `Clerk gaf na ${CLERK_TIMEOUT_MS / 1000} s geen antwoord`
        : "Clerk niet bereikbaar";
    } finally {
      clearTimeout(timer);
    }

    const delay = CLERK_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      console.log(`[accountDeletion] ${reason}, poging ${attempt + 1}; opnieuw over ${delay / 60_000} min`);
      await ctx.runMutation(internal.accountDeletion.clerkRetryLater, {
        userId,
        subject,
        run,
        attempt: attempt + 1,
        delayMs: delay,
      });
      return null;
    }
    await giveUp(ctx, userId, subject, run, `${reason} na ${attempt + 1} pogingen`);
    return null;
  },
});

/** Hoort een poging van reeks `run` nog te lopen? */
export const clerkRunIsCurrent = internalQuery({
  args: { userId: v.id("users"), run: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { userId, run }) => {
    const user = await ctx.db.get(userId);
    const deletion = user?.deletion;
    if (!deletion || deletion.clerkDoneAt !== undefined) return false;
    return (deletion.clerkRun ?? 1) === run;
  },
});

/** Plant de volgende poging van reeks `run` en onthoudt hem (fix 3). */
export const clerkRetryLater = internalMutation({
  args: {
    userId: v.id("users"),
    subject: v.string(),
    run: v.number(),
    attempt: v.number(),
    delayMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, subject, run, attempt, delayMs }) => {
    const user = await ctx.db.get(userId);
    const deletion = user?.deletion;
    if (!deletion || deletion.clerkDoneAt !== undefined) return null;
    if ((deletion.clerkRun ?? 1) !== run) return null;
    const clerkJobId = await ctx.scheduler.runAfter(delayMs, internal.accountDeletion.deleteClerkUser, {
      userId,
      subject,
      attempt,
      run,
    });
    await ctx.db.patch(userId, { deletion: { ...deletion, clerkJobId } });
    return null;
  },
});

async function giveUp(
  ctx: ActionCtx,
  userId: Id<"users">,
  subject: string,
  run: number,
  reason: string,
): Promise<void> {
  console.log(`[accountDeletion] Clerk-user niet verwijderd: ${reason}`);
  const state = await ctx.runMutation(internal.accountDeletion.clerkFailed, { userId, run });
  // Een andere reeks heeft het intussen overgenomen, of Clerk is al gelukt.
  if (state === null) return;

  const webmasters = getWebmasterEmails();
  if (webmasters.length === 0) {
    console.log(`[accountDeletion] geen WEBMASTER_EMAILS geconfigureerd, geen mail`);
    return;
  }
  const tpl = accountDeletionClerkFailedTemplate({
    subject,
    userId,
    reason,
    convexDone: state.convexDone,
    // Geen fail-loud op de stage-label hier: de mail is het signaal.
    stage: process.env.CLUBALMANAC_STAGE || "onbekende",
    timestamp: new Date().toISOString(),
  });
  try {
    await sendMailjetMessage({
      from: { email: INFO_SENDER },
      to: webmasters.map((email) => ({ email })),
      subject: tpl.subject,
      htmlPart: tpl.htmlPart,
      textPart: tpl.textPart,
    });
  } catch (e) {
    // De integriteitscheck meldt de rij na een uur toch (A-invariant 7).
    console.log(`[accountDeletion] mail aan webmaster mislukt: ${String(e)}`);
  }
}

/** Clerk gelukt. Is Convex al klaar, dan haalt een laatste stap de rij weg. */
export const clerkDeleted = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user?.deletion || user.deletion.clerkDoneAt !== undefined) return null;
    const { clerkFailedAt: _failed, ...rest } = user.deletion;
    await ctx.db.patch(userId, { deletion: { ...rest, clerkDoneAt: Date.now() } });
    // Loopt de opruimketen nog, dan haalt die de rij weg; een tweede keten
    // starten zou alleen dubbel werk geven.
    if (user.deletion.convexDoneAt !== undefined) {
      await ctx.scheduler.runAfter(0, internal.accountDeletion.step, { userId });
    }
    return null;
  },
});

/**
 * Reeks `run` geeft op. Geeft voor de mail of de Convex-data nu weg is
 * (fix 6), of null als deze reeks niet meer de lopende is.
 */
export const clerkFailed = internalMutation({
  args: { userId: v.id("users"), run: v.number() },
  returns: v.union(v.object({ convexDone: v.boolean() }), v.null()),
  handler: async (ctx, { userId, run }) => {
    const user = await ctx.db.get(userId);
    const deletion = user?.deletion;
    if (!deletion || deletion.clerkDoneAt !== undefined) return null;
    if ((deletion.clerkRun ?? 1) !== run) return null;
    await ctx.db.patch(userId, { deletion: { ...deletion, clerkFailedAt: Date.now() } });
    return { convexDone: deletion.convexDoneAt !== undefined };
  },
});
