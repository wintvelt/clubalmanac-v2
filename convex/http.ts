import { httpRouter } from "convex/server";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { parseImageFormat } from "./images";
import { UPLOAD_NO_ALBUM_ACCESS, UPLOAD_RESERVATION_GONE } from "./photos";
import { MAX_UPLOAD_BYTES } from "./lib/constants";
import {
  TEST_SECRET_HEADER,
  testGateOpen,
  testGateRefusalResponse,
} from "./lib/testGate";
import { parseLocation, parseTakenAt, uploadImageType } from "./lib/upload";
import { stripJpegMetadata } from "./lib/jpegMeta";

// Cascade matrix IB1: Mailjet bounce-webhook → internal.invites.handleBounce.
// Voltooit IB1 cascade per docs/cascade-matrix.md (bounce → status=expired
// + bouncedAt + notify-inviter + dedup op providerEventId).
//
// Mailjet webhook setup: configureer in Mailjet dashboard een "Event API"
// callback naar https://mailjet:<MAILJET_WEBHOOK_SECRET>@<convex-deployment>.<region>.convex.site/email-event
// NB: region-suffix verplicht voor EU-deployments (correctie 2026-05-18) —
// Convex HTTP-routes domain volgt de RPC-URL pattern <deployment>.<region>.convex.site,
// niet `<deployment>.convex.site` zoals eerder gedocumenteerd.
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

// WP6: Clerk session-webhook → atomic onboarding. Svix Standard-Webhooks
// signature-verify via `@clerk/backend.verifyWebhook` met expliciete
// `signingSecret` pass-through (Clerk's default leest
// `CLERK_WEBHOOK_SIGNING_SECRET`-env-var; we hanteren `CLERK_WEBHOOK_SECRET`
// consistent met `MAILJET_WEBHOOK_SECRET`-pattern).
//
// Flow:
//   1. `CLERK_WEBHOOK_SECRET` ontbreekt → 503 fail-closed (geen accidenteel
//      open endpoint in prod, Mailjet-pattern).
//   2. `verifyWebhook` throwt op missing/invalid Svix-headers of signature-
//      mismatch → 401, geen state-mutatie.
//   3. Event-type filter: alleen `session.created` triggert onboarding-flow.
//      Andere types (user.created/updated/deleted, session.ended/etc.) →
//      200 no-op (anders disablet Clerk de webhook bij blijvende 5xx).
//   4. Payload-shape extractie:
//        - data.user === null → 200 no-op
//        - lege email_addresses → 200 no-op
//        - resolve email via primary_email_address_id (NIET index 0);
//          alleen address met verification.status === "verified" telt
//        - primary_email_address_id wijst naar niet-bestaand of unverified
//          address → 200 no-op
//   5. Delegeer naar `internal.users.registerFromSession({subject, email, name?})`.
//      Mutation is atomair + idempotent op subject; re-login = no-op.
type ClerkEmailAddress = {
  id?: string;
  email_address?: string;
  verification?: { status?: string } | null;
};
type ClerkUser = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmailAddress[];
};

function resolveVerifiedEmail(user: ClerkUser): string | null {
  if (!user.primary_email_address_id) return null;
  const addresses = user.email_addresses ?? [];
  if (addresses.length === 0) return null;
  const primary = addresses.find((a) => a.id === user.primary_email_address_id);
  if (!primary) return null;
  if (primary.verification?.status !== "verified") return null;
  return primary.email_address ?? null;
}

function resolveName(user: ClerkUser): string | undefined {
  const parts = [user.first_name, user.last_name]
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim());
  if (parts.length === 0) return undefined;
  return parts.join(" ");
}

http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
      return new Response(null, { status: 503 });
    }

    let event;
    try {
      event = await verifyWebhook(request, { signingSecret: secret });
    } catch {
      return new Response(null, { status: 401 });
    }

    if (event.type !== "session.created") {
      return new Response(null, { status: 200 });
    }

    const data = event.data as { user_id?: string; user?: ClerkUser | null };
    const user = data.user;
    if (!user) {
      return new Response(null, { status: 200 });
    }
    const subject = data.user_id ?? user.id;
    if (!subject) {
      return new Response(null, { status: 200 });
    }
    const email = resolveVerifiedEmail(user);
    if (!email) {
      return new Response(null, { status: 200 });
    }
    const name = resolveName(user);

    // WP29 fix 1b: een Clerk-user waarvan het account is verwijderd, krijgt
    // geen rij. 200, anders herhaalt Svix het dagenlang.
    if (await ctx.runQuery(internal.users.isDeletedSubject, { subject })) {
      return new Response(null, { status: 200 });
    }

    await ctx.runMutation(internal.users.registerFromSession, {
      subject,
      email,
      ...(name !== undefined ? { name } : {}),
    });

    return new Response(null, { status: 200 });
  }),
});

// File upload werkpakket — Cyclus 1, gehard in audit-cyclus-1, uitgebreid in
// WP18 (album, type en grootte, datum en locatie, de herhaal-gevallen).
//
// Backend-mediated 1-step upload met reservation pattern als idempotency
// state machine. Server-flow:
//   1. auth check (identity + users-record)
//   2. trim + valideer X-Upload-Id (whitespace-only → 400)
//   3. WP18 A-invariant 15: met `X-Album-Id` het album toetsen (lid van zijn
//      groep), vóór body, reservering en opslag. Geen toegang, onbekend,
//      gewist, misvormd: één antwoord, 404.
//   4. WP18 A-invariant 13 en 14: de body lezen vóór de reservering. Breekt
//      het lezen af, dan 400 en er is nog niets gereserveerd. Boven
//      MAX_UPLOAD_BYTES 413; geen JPEG, PNG of HEIC (aan de bytes) 415.
//   5. internal.uploads.reserve({ownerId, clientUploadId}) — atomair:
//        completed-hit → 200 met bestaande photoId (ook op de limiet, WP18
//                        A-invariant 12); met album staat hij daarna in dat
//                        album (A-invariant 24). Een hit naar een gewiste
//                        foto telt als miss (A-invariant 22).
//        in_progress   → 409 Conflict (race-loser), tot 30 min; ouder telt
//                        als miss met een verse reservering (A-invariant 23)
//        limiet        → 403, geen reservering
//        miss          → insert in_progress, ga door
//   6. storage.store(blob), met het type uit de bytes
//   7. internal.photos.createFromUploadInternal({reservationId, albumId,
//      takenAt, latitude, longitude, ...}) — atomair: insert photo + plek in
//      het album + patch user.photoCount + patch reservation naar completed +
//      schedule extractMetadata en de formaten in één transactie. Throw't
//      typed sentinel "PHOTO_LIMIT_REACHED" of "NO_ALBUM_ACCESS".
//
// Foutpaden:
//   401 geen identity / geen users-record (geen reservation, geen photo)
//   400 ontbrekende/lege/whitespace-only X-Upload-Id (na server-side trim),
//       of een body die niet volledig binnenkwam
//   403 photo-limit bereikt (typed sentinel, was 413)
//   404 album zonder toegang (één antwoord)
//   409 race-loser tegen lopende reservation
//   413 bestand groter dan MAX_UPLOAD_BYTES
//   415 geen JPEG, PNG of HEIC
//
// Bij failure tussen reserve en createFromUploadInternal ruimen we de
// reservation + storage best-effort op zodat een retry niet 409't tot
// stale-cleanup-cron na 30 min.
const UPLOAD_ALBUM_NOT_FOUND = () =>
  Response.json({ error: "Album niet gevonden" }, { status: 404 });
const UPLOAD_LIMIT = () =>
  Response.json({ error: "Photo limiet bereikt" }, { status: 403 });
const UPLOAD_TOO_LARGE = () =>
  Response.json({ error: "Bestand te groot" }, { status: 413 });

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

    // WP18 A-invariant 15: album vóór alles wat iets achterlaat.
    const rawAlbumId = request.headers.get("X-Album-Id");
    let albumId: Id<"albums"> | undefined;
    if (rawAlbumId !== null) {
      const found = await ctx.runQuery(internal.uploads.uploadAlbum, {
        ownerId: user._id,
        albumId: rawAlbumId.trim(),
      });
      if (!found) return UPLOAD_ALBUM_NOT_FOUND();
      albumId = found;
    }

    // WP18 A-invariant 14: een opgegeven lengte boven de grens hoeft niet
    // eerst gelezen te worden.
    const declared = Number(request.headers.get("Content-Length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      return UPLOAD_TOO_LARGE();
    }

    // WP18 A-invariant 13: de body vóór de reservering lezen. Breekt de
    // verbinding af tijdens het versturen, dan staat er nog geen reservering
    // en kan dezelfde upload-id meteen opnieuw.
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return Response.json({ error: "Upload afgebroken" }, { status: 400 });
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) return UPLOAD_TOO_LARGE();
    const imageType = uploadImageType(bytes);
    if (!imageType) {
      return Response.json(
        { error: "Alleen foto's (JPEG, PNG of HEIC)" },
        { status: 415 },
      );
    }

    const reservation = await ctx.runMutation(internal.uploads.reserve, {
      ownerId: user._id,
      clientUploadId,
      albumId,
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
    if (reservation.kind === "limit") return UPLOAD_LIMIT();
    if (reservation.kind === "noAlbum") return UPLOAD_ALBUM_NOT_FOUND();

    const reservationId = reservation.reservationId;

    const filename = request.headers.get("X-Filename") ?? undefined;
    const takenAt = parseTakenAt(request.headers.get("X-Taken-At"));
    const location = parseLocation(
      request.headers.get("X-Latitude"),
      request.headers.get("X-Longitude"),
    );

    let storageId;
    try {
      storageId = await ctx.storage.store(
        new Blob([bytes as BlobPart], { type: imageType }),
      );
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
          mimeType: imageType,
          albumId,
          takenAt,
          latitude: location?.latitude,
          longitude: location?.longitude,
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
      if (message === "PHOTO_LIMIT_REACHED") return UPLOAD_LIMIT();
      if (message === UPLOAD_NO_ALBUM_ACCESS) return UPLOAD_ALBUM_NOT_FOUND();
      if (message === UPLOAD_RESERVATION_GONE) {
        return Response.json(
          { error: "Upload in progress" },
          { status: 409 },
        );
      }
      throw e;
    }

    return Response.json({ photoId }, { status: 200 });
  }),
});

// WP17a: het beeldpad (besluit 1: vorm B). Bij elk verzoek de toegangsregel
// uit convex/images.ts, dan de bytes uit storage. De client kent geen
// `storageId` en geen storage-URL (invariant 10); hij vraagt een beeld op met
// een foto-id of een user-id.
//
//   GET /beeld/foto/<photoId>[?formaat=klein|groot]
//     400 onbekend formaat (vóór alles, dus voor iedereen gelijk)
//     401 uitgelogd of ongeldige token (nooit bytes)
//     404 geen toegang, onbekend, misvormd, foto of beeld gewist: één
//         antwoord (invariant 13)
//     200 de bytes, `Cache-Control: private` (geen proxy of CDN mag een beeld
//         achter een login bewaren), `Vary: Authorization`
//   GET /beeld/profiel/<userId>[?formaat=klein|groot]
//     Openbaar (besluit 8): geen login-check. 400 als hierboven; 404 voor geen
//     profielfoto, onbekend, misvormd of gewist (invariant 14); 200 met de
//     bytes van de actuele profielfoto. `no-cache`: dezelfde URL geeft na een
//     wissel een ander beeld, dus een cache moet het eerst opnieuw vragen.
//
// Formaat (besluit 2, WP25): `klein` of `groot` geeft de verkleinde JPEG van
// die foto. Het formaat wordt pas gekozen nadat de regel een beeld gaf; het
// opent niets (WP25 invariant 4). Heeft de foto het formaat niet (nog niet
// gemaakt, of het object is weg), dan het origineel met `no-store`: anders
// bewaart de app een origineel van megabytes onder de URL van het formaat
// (WP25 A-invariant 13).
const PHOTO_PREFIX = "/beeld/foto/";
const PROFILE_PREFIX = "/beeld/profiel/";
const INVITE_PREFIX = "/beeld/uitnodiging/";

const NOT_FOUND = () => new Response("Niet gevonden", { status: 404 });
const BAD_FORMAT = () => new Response("Onbekend formaat", { status: 400 });
// `private` blijft erbij op het foto-pad: geen gedeelde cache, en de app
// bewaart niets (A-invariant 13).
const FALLBACK_CACHE_PHOTO = "private, no-store";
const FALLBACK_CACHE_PROFILE = "no-store";

// Een id met kapotte procent-codering (`%E0%A4%A`) is een misvormd id: geen
// exception (500), maar een lege string, en daarmee hetzelfde antwoord als een
// onbekend id (invariant 13 en 14; audit S1).
function idFromPath(request: Request, prefix: string): string {
  const raw = new URL(request.url).pathname.slice(prefix.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

// Het type uit de eerste bytes. Veel gemigreerde beelden staan in storage als
// `application/octet-stream` (telling regie op dev: 444 van 1002); dan bepalen
// de magische bytes het type, zodat ook een browser (Track B) het als beeld
// toont ondanks `nosniff`.
function sniffImageType(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|mif1|msf1)$/.test(ascii(8, 12))) return "image/heic";
  return null;
}

// Invariant 17: alleen een opgeslagen rasterbeeld-type gaat door. Elk ander
// type (octet-stream, leeg, of bijvoorbeeld `text/html` of `image/svg+xml`
// van een eigen upload) wordt nooit verstuurd: anders draait zo'n bestand als
// profielfoto op het openbare profielpad in een browser.
const RASTER_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);

function storedRasterType(type: string): string | null {
  const base = type.split(";")[0]!.trim().toLowerCase();
  return RASTER_TYPES.has(base) ? base : null;
}

// Een beeld met een rasterbeeld-type gaat als Blob door, zonder het te lezen.
// Anders leest de action het hele bestand: `Blob.slice()` gevolgd door
// `arrayBuffer()` gaf in de echte Convex-runtime een RangeError (WP7-gate,
// zie convex/photoMetadata.ts; audit B1), dus geen slice, maar één
// `arrayBuffer()` en een `Uint8Array`-view op de eerste bytes. Daarna gaan
// dezelfde bytes als body mee. Geheugen: het grootste origineel is ~20 MB,
// onder de 64 MiB van een httpAction en de 100 MiB per respons (Convex-docs,
// Limits).
async function imageBody(blob: Blob): Promise<{ body: Blob | ArrayBuffer; type: string }> {
  const stored = storedRasterType(blob.type);
  if (stored) return { body: blob, type: stored };
  const bytes = await blob.arrayBuffer();
  const head = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  return { body: bytes, type: sniffImageType(head) ?? "application/octet-stream" };
}

async function imageResponse(
  ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } },
  storageId: Id<"_storage"> | null,
  cacheControl: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  if (!storageId) return NOT_FOUND();
  const blob = await ctx.storage.get(storageId);
  if (!blob) return NOT_FOUND();
  const { body, type } = await imageBody(blob);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

http.route({
  pathPrefix: PHOTO_PREFIX,
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const format = parseImageFormat(
      new URL(request.url).searchParams.get("formaat"),
    );
    if (format === "ongeldig") return BAD_FORMAT();

    // Zelfde JWT-throw-handling als `/upload`: een ongeldige token is 401,
    // geen 500.
    let identity;
    try {
      identity = await ctx.auth.getUserIdentity();
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
    if (!identity) return new Response("Unauthorized", { status: 401 });

    // WP17d besluit 4 (A-invariant 9): een origineel gaat alleen door de
    // schoonmaker naar buiten, voor elk lid en ook voor de eigenaar. Een
    // formaat (door ons gemaakt, zonder EXIF) gaat ongewijzigd mee.
    const photoId = idFromPath(request, PHOTO_PREFIX);
    if (format === "origineel") {
      const storageId = await ctx.runQuery(internal.images.photoImage, { photoId });
      return await cleanOriginalResponse(ctx, storageId, "private, max-age=3600", {
        Vary: "Authorization",
      });
    }
    const choice = await ctx.runQuery(internal.images.photoImageInFormat, {
      photoId,
      formaat: format,
    });
    if (!choice) return NOT_FOUND();
    if (choice.fallback) {
      return await cleanOriginalResponse(ctx, choice.storageId, FALLBACK_CACHE_PHOTO, {
        Vary: "Authorization",
      });
    }
    return await imageResponse(ctx, choice.storageId, "private, max-age=3600", {
      Vary: "Authorization",
    });
  }),
});

http.route({
  pathPrefix: PROFILE_PREFIX,
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const format = parseImageFormat(
      new URL(request.url).searchParams.get("formaat"),
    );
    if (format === "ongeldig") return BAD_FORMAT();

    // WP17d besluit 2: zonder formaat het formaat *groot*, niet het origineel.
    const userId = idFromPath(request, PROFILE_PREFIX);
    const choice = await ctx.runQuery(internal.images.profileImageInFormat, {
      userId,
      formaat: format === "origineel" ? "groot" : format,
    });
    if (!choice) return NOT_FOUND();
    if (choice.fallback) {
      return await cleanOriginalResponse(ctx, choice.storageId, FALLBACK_CACHE_PROFILE);
    }
    return await imageResponse(ctx, choice.storageId, "public, no-cache");
  }),
});

// WP19b A-invariant 15: de cover voor een genodigde, op invite-id.
//   GET /beeld/uitnodiging/<inviteId>[?formaat=klein|groot]
//     400 onbekend formaat (vóór alles, zoals de andere paden)
//     401 uitgelogd of ongeldige token
//     404 alle andere gevallen, één antwoord: geen users-rij, een ander
//         adres, onbekend, misvormd, niet (meer) accepteerbaar, geen cover,
//         cover niet in de groep, beeld gewist
//     200 de bytes; nooit het origineel (zonder formaat of met `origineel`:
//         *groot*). `private, no-cache`: de toegang eindigt met de
//         uitnodiging, dus een cache vraagt het eerst opnieuw.
http.route({
  pathPrefix: INVITE_PREFIX,
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    // `origineel` uitgeschreven geeft hier ook *groot* (A-invariant 15).
    const raw = new URL(request.url).searchParams.get("formaat");
    const format = raw === "origineel" ? "origineel" : parseImageFormat(raw);
    if (format === "ongeldig") return BAD_FORMAT();

    let identity;
    try {
      identity = await ctx.auth.getUserIdentity();
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
    if (!identity) return new Response("Unauthorized", { status: 401 });

    const choice = await ctx.runQuery(internal.images.inviteCoverInFormat, {
      inviteId: idFromPath(request, INVITE_PREFIX),
      formaat: format === "origineel" ? "groot" : format,
    });
    if (!choice) return NOT_FOUND();
    if (choice.fallback) {
      return await cleanOriginalResponse(ctx, choice.storageId, FALLBACK_CACHE_PHOTO, {
        Vary: "Authorization",
      });
    }
    return await imageResponse(ctx, choice.storageId, "private, no-cache", {
      Vary: "Authorization",
    });
  }),
});

// WP17d besluit 2 en 4 (A-invariant 8, 9 en 10): een origineel gaat nooit
// ongewijzigd naar buiten. Een JPEG gaat zonder metadata en zonder wat na het
// eerste beeld staat mee, met alleen de stand (lib/jpegMeta). Een JPEG die de
// schoonmaker niet kan volgen, en elk ander type (PNG, WebP, HEIC, onbekend):
// 404, tot er formaten zijn. Op prod hebben de niet-JPEG-originelen formaten
// (WP25-backfill); zie de spec, §Fix-cyclus 1: rest-risico.
async function cleanOriginalResponse(
  ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } },
  storageId: Id<"_storage"> | null,
  cacheControl: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  if (!storageId) return NOT_FOUND();
  const blob = await ctx.storage.get(storageId);
  if (!blob) return NOT_FOUND();
  const clean = stripJpegMetadata(new Uint8Array(await blob.arrayBuffer()));
  if (!clean) return NOT_FOUND();
  return new Response(new Uint8Array(clean), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

// WP4: `whoami` httpAction. Productie-blind-spot uit plan-doc r.251:
// vitest's `t.withIdentity({ email })` mockt de identity en zegt niets
// over of de Clerk JWT-template "convex" daadwerkelijk de email-claim
// doorlevert. Deze httpAction reflecteert subset van getUserIdentity()
// + webmaster-flag, zodat de Clerk-roundtrip-tests pinnen op een echte
// JWT.
//
// WP26: dezelfde gate als convex/_test.ts, met het geheim in de header
// `X-Test-Secret`. De gate staat vóór de JWT-check: zonder (juist) geheim,
// met vlag uit of zonder geheim op de deployment krijgt iedereen dezelfde
// 403, met of zonder geldige JWT. Met het geheim blijft WP4 gelijk (401
// zonder of met ongeldige JWT, 200 met identity).
http.route({
  path: "/_test/whoami",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!testGateOpen(request.headers.get(TEST_SECRET_HEADER))) {
      return testGateRefusalResponse();
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
