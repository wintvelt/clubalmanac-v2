import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id, TableNames } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getWebmasterEmails } from "./lib/auth";
import { INFO_SENDER, sendMailjetMessage } from "./lib/mailjet";
import {
  monitorDriftAlertTemplate,
  monitorHeartbeatTemplate,
} from "./lib/emailTemplates";

// WP10 — integrity-check / monitoring.
//
// Eén daily `internal.monitoring.integrityCheck` internalMutation (04:30 UTC,
// gespreid na IB2 04:00) scant de volledige DB-staat op stille datakorruptie in
// vier categorieën — storage-orphans, aggregate-drift, FK-integriteit, en
// geen-self-healing — en queue't bij drift één samenvattende alert-email naar
// WEBMASTER_EMAILS. Zie docs/work-packages/WP10-integrity-monitoring.md.
//
// Architectuur-rationale:
//   - Eén Convex-mutation = één transactie = één consistente snapshot van álle
//     tabellen ⇒ invariant 11 (race-resistentie) structureel cadeau: er is geen
//     tussen-read waarin een gelijktijdige user-mutation een vals-positief kan
//     injecteren. De hele scan draait daarom in deze ene mutation; opsplitsen
//     over meerdere mutations/actions zou de invariant breken.
//   - Read-only-discipline (invariant 10 + 2d): de mutation schrijft uitsluitend
//     naar `monitoringRuns` en queue't de alert-action. Géén writes naar
//     bron-tabellen — detect-only, nooit self-healing.
//   - De Mailjet-send gebeurt in een aparte internalAction (sendProblemReport-
//     patroon): mutation queue't via ctx.scheduler.runAfter(0, …), action doet
//     de externe call. `emailSent` = "gequeue'd", niet "afgeleverd".

const HEARTBEAT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const RATING_AVERAGE_EPSILON = 1e-9;

// Verplichte FKs (altijd resolven). Géén storage-refs hier — die vallen onder
// de storage-orphan-categorie (2a), niet onder FK-integriteit (2c).
const REQUIRED_FKS: Array<{ table: TableNames; field: string }> = [
  { table: "groups", field: "createdBy" },
  { table: "memberships", field: "userId" },
  { table: "memberships", field: "groupId" },
  { table: "albums", field: "groupId" },
  { table: "albums", field: "createdBy" },
  { table: "albumPhotos", field: "albumId" },
  { table: "albumPhotos", field: "photoId" },
  { table: "albumPhotos", field: "groupId" },
  { table: "albumPhotos", field: "addedBy" },
  { table: "photos", field: "ownerId" },
  { table: "uploadIdempotency", field: "ownerId" },
  { table: "ratings", field: "photoId" },
  { table: "ratings", field: "userId" },
  { table: "invites", field: "invitedBy" },
  { table: "features", field: "submittedBy" },
  { table: "featureUpvotes", field: "featureId" },
  { table: "featureUpvotes", field: "userId" },
  { table: "albumLastSeen", field: "userId" },
  { table: "albumLastSeen", field: "albumId" },
];

// Optionele FKs (v.optional(v.id(...))): alleen drift wanneer gezet én niet-
// resolvend. Een ongezette optionele FK is géén dangling FK.
const OPTIONAL_FKS: Array<{ table: TableNames; field: string }> = [
  { table: "groups", field: "coverPhotoId" },
  { table: "albums", field: "coverPhotoId" },
  { table: "photos", field: "flaggedBy" },
  { table: "uploadIdempotency", field: "photoId" },
  { table: "invites", field: "groupId" },
];

type DriftRow = { table: string; id: string; detail: string };

// Stabiele, korte signature (djb2) over de gesorteerde drift-regels. Twee runs
// met identieke drift ⇒ identieke signature ⇒ dedup. Eén drift erbij/eraf ⇒
// andere signature ⇒ nieuwe alert.
function hashSignature(lines: string[]): string {
  const joined = lines.join("\n");
  let h = 5381;
  for (let i = 0; i < joined.length; i++) {
    h = ((h << 5) + h + joined.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

export const integrityCheck = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const driftRows: DriftRow[] = [];

    // Snapshot van alle bron-tabellen die de scan nodig heeft. Eén consistente
    // read binnen deze transactie (invariant 11).
    const allUsers = await ctx.db.query("users").collect();
    const allPhotos = await ctx.db.query("photos").collect();
    const allRatings = await ctx.db.query("ratings").collect();
    const allFeatures = await ctx.db.query("features").collect();
    const allUpvotes = await ctx.db.query("featureUpvotes").collect();

    // ── (2a) Storage-orphans ──────────────────────────────────────────
    // Referentie-set = photos.storageId ∪ users.profilePhotoStorageId. Een
    // blob die in géén van beide voorkomt is orphan. profilePhotoStorageId
    // meenemen is kritisch: anders is élke profielfoto een vals-positief.
    const referencedStorage = new Set<string>();
    for (const p of allPhotos) referencedStorage.add(p.storageId);
    for (const u of allUsers) {
      if (u.profilePhotoStorageId) referencedStorage.add(u.profilePhotoStorageId);
    }
    const storageDocs = await ctx.db.system.query("_storage").collect();
    for (const s of storageDocs) {
      if (!referencedStorage.has(s._id)) {
        driftRows.push({ table: "_storage", id: s._id, detail: "orphan blob" });
      }
    }

    // ── (2b) Aggregate-drift: users.photoCount ────────────────────────
    const photoCountByOwner = new Map<string, number>();
    for (const p of allPhotos) {
      photoCountByOwner.set(p.ownerId, (photoCountByOwner.get(p.ownerId) ?? 0) + 1);
    }
    for (const u of allUsers) {
      const actual = photoCountByOwner.get(u._id) ?? 0;
      if (u.photoCount !== actual) {
        driftRows.push({
          table: "users",
          id: u._id,
          detail: `photoCount stored=${u.photoCount} recompute=${actual}`,
        });
      }
    }

    // ── (2b) Aggregate-drift: photos.ratingAverage + ratingCount ───────
    const ratingsByPhoto = new Map<string, number[]>();
    for (const r of allRatings) {
      const arr = ratingsByPhoto.get(r.photoId) ?? [];
      arr.push(r.value);
      ratingsByPhoto.set(r.photoId, arr);
    }
    for (const p of allPhotos) {
      const values = ratingsByPhoto.get(p._id) ?? [];
      const count = values.length;
      if (p.ratingCount !== count) {
        driftRows.push({
          table: "photos",
          id: p._id,
          detail: `ratingCount stored=${p.ratingCount} recompute=${count}`,
        });
      }
      // ratingAverage is float: exacte epsilon-mismatch, NIET ≥1-drempel.
      // undefined-semantiek: count 0 ⇔ stored undefined = match; één van beide
      // gezet en de ander niet = drift.
      const recomputed =
        count > 0 ? values.reduce((a, b) => a + b, 0) / count : undefined;
      const stored = p.ratingAverage;
      const averageDrift =
        (stored === undefined) !== (recomputed === undefined) ||
        (stored !== undefined &&
          recomputed !== undefined &&
          Math.abs(stored - recomputed) > RATING_AVERAGE_EPSILON);
      if (averageDrift) {
        driftRows.push({
          table: "photos",
          id: p._id,
          detail: `ratingAverage stored=${stored} recompute=${recomputed}`,
        });
      }
    }

    // ── (2b) Aggregate-drift: features.upvoteCount ─────────────────────
    const upvotesByFeature = new Map<string, number>();
    for (const fu of allUpvotes) {
      upvotesByFeature.set(
        fu.featureId,
        (upvotesByFeature.get(fu.featureId) ?? 0) + 1,
      );
    }
    for (const f of allFeatures) {
      const actual = upvotesByFeature.get(f._id) ?? 0;
      if (f.upvoteCount !== actual) {
        driftRows.push({
          table: "features",
          id: f._id,
          detail: `upvoteCount stored=${f.upvoteCount} recompute=${actual}`,
        });
      }
    }

    // ── (2c) FK-integriteit ────────────────────────────────────────────
    for (const { table, field } of REQUIRED_FKS) {
      const docs = await ctx.db.query(table).collect();
      for (const doc of docs) {
        const ref = (doc as Record<string, unknown>)[field];
        if (ref === undefined || ref === null) {
          driftRows.push({ table, id: doc._id, detail: `${field} ontbreekt` });
          continue;
        }
        const target = await ctx.db.get(ref as Id<TableNames>);
        if (target === null) {
          driftRows.push({ table, id: doc._id, detail: `${field} dangling` });
        }
      }
    }
    for (const { table, field } of OPTIONAL_FKS) {
      const docs = await ctx.db.query(table).collect();
      for (const doc of docs) {
        const ref = (doc as Record<string, unknown>)[field];
        if (ref === undefined || ref === null) continue; // ongezet = geen drift
        const target = await ctx.db.get(ref as Id<TableNames>);
        if (target === null) {
          driftRows.push({ table, id: doc._id, detail: `${field} dangling` });
        }
      }
    }

    // ── Drift-samenvatting + signature ─────────────────────────────────
    const lines = driftRows
      .map((r) => `${r.table}/${r.id}: ${r.detail}`)
      .sort();
    const driftFound = lines.length > 0;
    const signature = driftFound ? hashSignature(lines) : "";

    // ── Dedup-state + heartbeat-klok uit de direct voorgaande run ──────
    const lastRun = await ctx.db
      .query("monitoringRuns")
      .withIndex("by_runAt")
      .order("desc")
      .first();

    // Drift-mail alleen wanneer de drift-signature verschilt van die van de
    // DIRECT voorgaande run (strict-consecutive dedup, invariant 4 / audit
    // S-1). Een schone tussenrun zet de vorige signature op "" ⇒ terugkerende
    // identieke drift ná een clean is conceptueel een nieuw event en re-
    // alarmeert. Persistente identieke drift over opeenvolgende runs houdt
    // dezelfde signature en blijft dus één mail (storm-onderdrukking intact).
    const previousSignature = lastRun?.driftSignature ?? null;
    const driftEmail = driftFound && signature !== previousSignature;

    // Heartbeat (invariant 6, A's inline-keuze): als deze run géén drift-mail
    // queue'de én ≥30d sinds de laatste monitor-mail. Op de allereerste run is
    // er nog geen klok — initialiseer op `now` zodat hij niet meteen vuurt.
    const prevHeartbeatAt = lastRun?.lastHeartbeatAt ?? now;
    const heartbeatEmail =
      !driftEmail && now - prevHeartbeatAt >= HEARTBEAT_INTERVAL_MS;

    const emailSent = driftEmail || heartbeatEmail;
    // lastHeartbeatAt reset bij élke monitor-mail (drift óf heartbeat); anders
    // dragen we de vorige klok mee.
    const lastHeartbeatAt = emailSent ? now : prevHeartbeatAt;

    // ── Dashboard-log altijd autoritatief (invariant 5) ────────────────
    console.log(
      `[integrityCheck] runAt=${now} driftFound=${driftFound} driftRows=${lines.length} driftEmail=${driftEmail} heartbeat=${heartbeatEmail}`,
    );
    for (const line of lines) {
      console.log(`[integrityCheck] drift: ${line}`);
    }

    // ── State-write (enige write naar eigen tabel) ─────────────────────
    await ctx.db.insert("monitoringRuns", {
      runAt: now,
      driftFound,
      driftSignature: signature,
      emailSent,
      lastHeartbeatAt,
    });

    // ── Eén samenvattende mail per run (invariant 8) ───────────────────
    if (driftEmail) {
      await ctx.scheduler.runAfter(0, internal.monitoring.sendMonitoringAlert, {
        kind: "drift",
        lines,
        runAt: now,
        driftPresent: true,
      });
    } else if (heartbeatEmail) {
      // driftPresent geeft de heartbeat-tekst een waarschuwings-tak: een
      // heartbeat die op een gededupte-drift-run vuurt mag niet "geen drift"
      // suggereren — er ís openstaande drift (invariant 6 / audit N-1).
      await ctx.scheduler.runAfter(0, internal.monitoring.sendMonitoringAlert, {
        kind: "heartbeat",
        lines: [],
        runAt: now,
        driftPresent: driftFound,
      });
    }

    return null;
  },
});

// Mailjet-action voor drift-alert + heartbeat. Best-effort: lege/ontbrekende
// WEBMASTER_EMAILS → no-op zonder throw (mag scheduler niet stuk maken), gelijk
// aan sendProblemReport. Verstuurt vanaf INFO_SENDER (consistent met problem-
// report), één Mailjet-call met alle webmasters als TO's.
export const sendMonitoringAlert = internalAction({
  args: {
    kind: v.union(v.literal("drift"), v.literal("heartbeat")),
    lines: v.array(v.string()),
    runAt: v.number(),
    driftPresent: v.boolean(),
  },
  handler: async (_ctx, { kind, lines, runAt, driftPresent }) => {
    const webmasters = getWebmasterEmails();
    if (webmasters.length === 0) {
      console.log(`[sendMonitoringAlert] geen WEBMASTER_EMAILS geconfigureerd, skipping`);
      return;
    }

    const timestamp = new Date(runAt).toISOString();
    const tpl =
      kind === "drift"
        ? monitorDriftAlertTemplate({ lines, timestamp })
        : monitorHeartbeatTemplate({ timestamp, driftPresent });

    await sendMailjetMessage({
      from: { email: INFO_SENDER },
      to: webmasters.map((email) => ({ email })),
      subject: tpl.subject,
      htmlPart: tpl.htmlPart,
      textPart: tpl.textPart,
    });
  },
});
