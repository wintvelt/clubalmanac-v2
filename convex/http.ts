import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Cascade matrix IB1: Mailjet bounce-webhook → internal.invites.handleBounce.
// Voltooit IB1 cascade per docs/cascade-matrix.md (bounce → status=expired
// + bouncedAt + notify-inviter + dedup op providerEventId).
//
// Mailjet webhook setup: configureer in Mailjet dashboard een "Event API"
// callback naar https://mailjet:<MAILJET_WEBHOOK_SECRET>@<convex-deployment>.convex.site/email-event
// voor events `bounce` en `blocked`. Mailjet ondersteunt geen custom
// headers per webhook; userinfo in URL travels niet — HTTP-client strip't
// het en stuurt `Authorization: Basic <base64("mailjet:"+secret)>`. Zie
// docs/work-packages/WP5-email.md §Webhook-auth correctie (2026-05-18).
//
// WP5 auth + payload-shape:
//   - MAILJET_WEBHOOK_SECRET ontbreekt op deployment → 503 fail-closed
//     (geen accidenteel open endpoint in prod). Mailjet retry't op 5xx,
//     wat hier ops-zichtbaar het probleem signaleert.
//   - Missing/mismatch Authorization header → 401, geen state-mutatie.
//   - Geldige Basic → 200; payload-events worden gefilterd:
//       event ∈ {bounce, blocked} → handleBounce
//       andere event-types        → skip met 200 (anders disablet Mailjet
//                                   de webhook bij blijvende non-2xx)
//   - Array (productie-batch) én single-event object (dashboard "Test
//     event"-knop) beide ondersteund.
//   - providerEventId valt terug van MessageID → event_id; mist beide of
//     mist email → skip dat event, ga door met de rest.

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
    const secret = process.env.MAILJET_WEBHOOK_SECRET;
    if (!secret) {
      // Fail-closed: geen secret = endpoint uit. Liever ops-zichtbare 503
      // dan een accidenteel open webhook.
      return new Response(null, { status: 503 });
    }
    const auth = request.headers.get("Authorization") ?? "";
    if (auth !== `Basic ${btoa(`mailjet:${secret}`)}`) {
      return new Response(null, { status: 401 });
    }

    let body: MailjetEvent | MailjetEvent[];
    try {
      body = (await request.json()) as MailjetEvent | MailjetEvent[];
    } catch {
      // Onparsebare payload — 200 met no-op om Mailjet-retry-loop te
      // voorkomen (kale dashboard-test-knop kan rare bodies sturen).
      return new Response(null, { status: 200 });
    }
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
    // Zelfde JWT-throw-handling als `/_test/whoami` (WP4 follow-up).
    // Convex throwt op invalid signature/issuer i.p.v. null te retourneren —
    // empirisch gepind in tests/integration/clerk/jwtRoundtrip.test.ts.
    // Try/catch geeft consistente 401 voor zowel "geen header" als "invalid
    // token", voorkomt 500-leak van auth-error-detail.
    let identity;
    try {
      identity = await ctx.auth.getUserIdentity();
    } catch {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
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

// WP4: `whoami` httpAction. Productie-blind-spot uit plan-doc r.251:
// vitest's `t.withIdentity({ email })` mockt de identity en zegt niets
// over of de Clerk JWT-template "convex" daadwerkelijk de email-claim
// doorlevert. Deze httpAction reflecteert subset van getUserIdentity()
// + webmaster-flag, zodat de Clerk-roundtrip-tests pinnen op een echte
// JWT. Zelfde env-var-gate-patroon als convex/_test.ts.
//
// Status-keuze 503 bij gate-fail (i.p.v. 403): semantisch "endpoint
// bestaat maar is uitgeschakeld op deze deployment", niet "auth-rejection".
// 403 zou suggereren dat de caller iets fout doet; 503 maakt duidelijk
// dat de deployment-config bewust off is. Plan-doc liet de keuze open.
http.route({
  path: "/_test/whoami",
  method: "GET",
  handler: httpAction(async (ctx) => {
    if (process.env.INTEGRATION_TEST_ENABLED !== "true") {
      return Response.json(
        {
          error:
            "Test endpoint disabled (INTEGRATION_TEST_ENABLED != \"true\"). " +
            "Zet de env-var alleen op de dev-deployment.",
        },
        { status: 503 },
      );
    }

    // Convex throwt op invalid JWT (signature/issuer mismatch) i.p.v. null
    // te retourneren. Empirisch geverifieerd in WP4 niveau-2: ongeldige
    // Bearer leverde 500 op zonder try/catch. Voor consistente auth-fail
    // semantiek (geen header én invalid token → 401, geen 500-leak van
    // server-side auth-error-detail) vangen we hier af.
    // NB: zelfde pattern in `/upload` (regel ~89) is productie-relevante
    // hardening — buiten WP4 scope, vlaggen voor latere fix.
    let identity;
    try {
      identity = await ctx.auth.getUserIdentity();
    } catch {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!identity) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // requireWebmaster heeft ctx.db nodig (QueryCtx). httpAction = ActionCtx,
    // dus hop via internal query. Auth-identity propageert mee.
    const webmaster = await ctx.runQuery(internal._test.whoamiCheckWebmaster);

    return Response.json(
      {
        subject: identity.subject,
        email: identity.email ?? null,
        issuer: identity.issuer,
        webmaster,
      },
      { status: 200 },
    );
  }),
});

export default http;
