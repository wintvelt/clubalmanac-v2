import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Cascade matrix IB1: Mailjet bounce-webhook → internal.invites.handleBounce.
// Voltooit IB1 cascade per docs/cascade-matrix.md (bounce → status=expired
// + bouncedAt + notify-inviter + dedup op providerEventId).
//
// Mailjet webhook setup: configureer in Mailjet dashboard een "Event API"
// callback naar https://<convex-deployment>.convex.site/email-event voor
// events `bounce` en `blocked`. Zie docs/migratie-plan-convex.md "Email-
// normalisatie invariant" + "Bounce handling".
//
// TODO (email-werkpakket): authenticatie van het webhook-request via een
// shared secret header (bv. `Authorization: Bearer <MAILJET_WEBHOOK_SECRET>`)
// zodra Mailjet HMAC-signing is geconfigureerd. Tot dan accepteert dit
// endpoint elk POST request — niet uitrollen naar prod-deployment zonder
// secret-check.
//
// TODO (email-werkpakket): payload-shape verifieren tegen Mailjet docs.
// Huidige aannames over event-velden (event/email/MessageID/error_related_to)
// zijn op basis van Mailjet Event API v1; aanpassen als blijkt dat de
// daadwerkelijke shape afwijkt.

type MailjetEvent = {
  event?: string;
  email?: string;
  MessageID?: string | number;
  event_id?: string;
  error_related_to?: string;
  reason?: string;
};

const http = httpRouter();

http.route({
  path: "/email-event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json()) as MailjetEvent | MailjetEvent[];
    const events = Array.isArray(body) ? body : [body];
    for (const event of events) {
      if (event.event !== "bounce" && event.event !== "blocked") continue;
      if (!event.email) continue;
      const providerEventId = String(
        event.MessageID ?? event.event_id ?? "",
      );
      if (!providerEventId) continue;
      await ctx.runMutation(internal.invites.handleBounce, {
        email: event.email,
        providerEventId,
      });
    }
    return new Response(null, { status: 200 });
  }),
});

// File upload werkpakket — Cyclus 1, gehard in audit-cyclus-1.
//
// Backend-mediated 1-step upload met reservation pattern als idempotency
// state machine. Server-flow:
//   1. auth check (identity + users-record)
//   2. trim + valideer X-Upload-Id (whitespace-only → 400)
//   3. photoLimit-gate vóór reservation (audit-cyclus-1 §1: voorkomt
//      phantom in_progress + orphan storage bij quota-fail)
//   4. internal.uploads.reserve({ownerId, clientUploadId}) — atomair:
//        completed-hit → 200 met bestaande photoId
//        in_progress   → 409 Conflict (race-loser)
//        miss          → insert in_progress, ga door
//   5. storage.store(blob)
//   6. internal.photos.createFromUploadInternal({reservationId, ...}) —
//      atomair: insert photo + patch user.photoCount + patch reservation
//      naar completed + schedule extractMetadata in één transactie. Throw't
//      typed sentinel "PHOTO_LIMIT_REACHED" bij gate-fail.
//
// Foutpaden:
//   401 geen identity / geen users-record (geen reservation, geen photo)
//   400 ontbrekende/lege/whitespace-only X-Upload-Id (na server-side trim)
//   403 photo-limit bereikt (typed sentinel, was 413)
//   409 race-loser tegen lopende reservation
//
// Bij failure tussen reserve en createFromUploadInternal ruimen we de
// reservation + storage best-effort op zodat een retry niet 409't tot
// stale-cleanup-cron na 5 min.
http.route({
  path: "/upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await ctx.runQuery(internal.users.getBySubjectInternal, {
      subject: identity.subject,
    });
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Server-side trim: defensie tegen client-bugs / proxy-rewrites die een
    // UUID met leading/trailing whitespace doorsturen. "   " mag niet als
    // legitieme idempotency-key tellen.
    const rawId = request.headers.get("X-Upload-Id");
    const clientUploadId = rawId?.trim() ?? "";
    if (clientUploadId.length === 0) {
      return Response.json(
        { error: "Missing X-Upload-Id" },
        { status: 400 },
      );
    }

    // Photo-limit gate vóór reservation + storage.store. Audit-cyclus-1 §1:
    // bij quota-fail mag er geen reservation zijn (anders phantom in_progress
    // tot stale-cleanup) en geen orphan storage. Race tussen deze check en
    // createFromUploadInternal wordt door OCC binnen die mutation gevangen
    // en valt terug op het PHOTO_LIMIT_REACHED-pad onderaan.
    if (user.photoCount >= user.photoLimit) {
      return Response.json(
        { error: "Photo limiet bereikt" },
        { status: 403 },
      );
    }

    const reservation = await ctx.runMutation(internal.uploads.reserve, {
      ownerId: user._id,
      clientUploadId,
    });

    if (reservation.kind === "hit") {
      return Response.json({ photoId: reservation.photoId }, { status: 200 });
    }
    if (reservation.kind === "conflict") {
      return Response.json(
        { error: "Upload in progress" },
        { status: 409 },
      );
    }

    const reservationId = reservation.reservationId;

    const blob = await request.blob();
    const mimeType =
      request.headers.get("Content-Type") ?? blob.type ?? undefined;
    const filename = request.headers.get("X-Filename") ?? undefined;

    let storageId;
    try {
      storageId = await ctx.storage.store(blob);
    } catch (e) {
      await ctx.runMutation(internal.uploads.deleteReservation, {
        reservationId,
      });
      throw e;
    }

    let photoId;
    try {
      photoId = await ctx.runMutation(
        internal.photos.createFromUploadInternal,
        {
          storageId,
          ownerId: user._id,
          reservationId,
          filename,
          mimeType,
        },
      );
    } catch (e) {
      try {
        await ctx.storage.delete(storageId);
      } catch {
        // best-effort
      }
      await ctx.runMutation(internal.uploads.deleteReservation, {
        reservationId,
      });
      const message = e instanceof Error ? e.message : "";
      if (message === "PHOTO_LIMIT_REACHED") {
        return Response.json(
          { error: "Photo limiet bereikt" },
          { status: 403 },
        );
      }
      throw e;
    }

    return Response.json({ photoId }, { status: 200 });
  }),
});

export default http;
