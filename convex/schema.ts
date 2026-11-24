import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { settlementContentFields } from "./lib/settlementShape";

// Schema voor Clubalmanac v2.
// Vertaling van het single-table DynamoDB design (zie docs/migratie-plan-convex.md)
// naar aparte Convex tables. Velden gemarkeerd v.optional(...) zijn nullable
// of pas in latere fasen verplicht.

export default defineSchema({
  // ──────────────────────────────────────────────────────────────────
  // Users
  // ──────────────────────────────────────────────────────────────────
  // Vervangt USER / UB / UV / US / UP records uit DynamoDB.
  // Auth identity (Clerk subject) → "subject" veld voor lookup vanuit ctx.auth.
  users: defineTable({
    // Clerk identity subject (user_xxx). Bron van waarheid voor auth.
    subject: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    // Storage ID van profielfoto in Convex file storage (later naar R2).
    profilePhotoStorageId: v.optional(v.id("_storage")),
    // Denormalized stats — onderhouden door mutations, periodiek gevalideerd.
    photoCount: v.number(),
    // Limiet voor uploads. Default in createUser mutation.
    photoLimit: v.number(),
    // Ongebruikt sinds WP15b: het bezoek staat in `userVisits`. Sinds WP12b
    // vult ook de migratie dit veld niet meer; opruimen staat op de backlog.
    lastVisitAt: v.optional(v.number()),
    createdAt: v.number(),
    // WP29: het account wordt verwijderd (convex/accountDeletion.ts). Vanaf
    // `startedAt` is het lid voor elke publieke functie niet meer ingelogd en
    // maakt een nieuwe sessie geen nieuwe rij. De rij gaat als laatste weg,
    // als de Convex-data (`convexDoneAt`) én de Clerk-user (`clerkDoneAt`)
    // weg zijn. `clerkFailedAt`: Clerk blijvend mislukt, de webmaster is
    // gemaild (`users.retryAccountDeletion` start het opnieuw). Er loopt
    // hooguit één reeks Clerk-pogingen: `clerkRun` is het volgnummer van de
    // lopende reeks, `clerkJobId` de geplande poging ervan (fix 3).
    deletion: v.optional(
      v.object({
        startedAt: v.number(),
        convexDoneAt: v.optional(v.number()),
        clerkDoneAt: v.optional(v.number()),
        clerkFailedAt: v.optional(v.number()),
        clerkRun: v.optional(v.number()),
        clerkJobId: v.optional(v.id("_scheduled_functions")),
      }),
    ),
  })
    .index("by_subject", ["subject"])
    .index("by_email", ["email"]),

  // WP29 fix 1b: Clerk-users waarvan het account is verwijderd. Alleen een
  // SHA-256-hash van de subject, zonder id of adres; blijft staan (Clerk
  // hergebruikt geen ids). `registerFromSession` maakt voor zo'n subject
  // nooit meer een users-rij.
  deletedClerkSubjects: defineTable({
    subjectHash: v.string(),
    deletedAt: v.number(),
  }).index("by_subjectHash", ["subjectHash"]),

  // ──────────────────────────────────────────────────────────────────
  // Groups
  // ──────────────────────────────────────────────────────────────────
  // Vervangt GB records.
  groups: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    coverPhotoId: v.optional(v.id("photos")),
    // WP16 besluit 3: de gekozen datum uit v1 (epoch-ms). Jaar en volgorde in
    // de app; geen rol in de ongelezen-teller.
    sortDate: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_createdBy", ["createdBy"]),

  // Lidmaatschap user ↔ group. Vervangt UM records.
  memberships: defineTable({
    userId: v.id("users"),
    groupId: v.id("groups"),
    role: v.union(v.literal("admin"), v.literal("member")),
    joinedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_group", ["groupId"])
    .index("by_user_and_group", ["userId", "groupId"]),

  // ──────────────────────────────────────────────────────────────────
  // Albums
  // ──────────────────────────────────────────────────────────────────
  // Vervangt GA records.
  albums: defineTable({
    groupId: v.id("groups"),
    name: v.string(),
    description: v.optional(v.string()),
    coverPhotoId: v.optional(v.id("photos")),
    // WP16 besluit 3: zie groups.sortDate.
    sortDate: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_group", ["groupId"])
    // WP29: de albums van wie zijn account verwijdert.
    .index("by_createdBy", ["createdBy"]),

  // Photo ↔ album koppeling (many-to-many). Vervangt GP records.
  albumPhotos: defineTable({
    albumId: v.id("albums"),
    photoId: v.id("photos"),
    groupId: v.id("groups"), // gedupliceerd voor efficient query
    addedAt: v.number(),
    addedBy: v.id("users"),
  })
    .index("by_album", ["albumId"])
    .index("by_photo", ["photoId"])
    .index("by_group", ["groupId"])
    // Range scan voor unread count per album (AP1).
    .index("by_album_added", ["albumId", "addedAt"])
    // WP29: publicaties die iemand toevoegde (gemigreerd: ook andermans foto).
    .index("by_addedBy", ["addedBy"]),

  // ──────────────────────────────────────────────────────────────────
  // Photos
  // ──────────────────────────────────────────────────────────────────
  // Vervangt PO records.
  photos: defineTable({
    ownerId: v.id("users"),
    storageId: v.id("_storage"),
    // Origineel bestandsnaam, mime type.
    filename: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    // EXIF / geocoding (gevuld door action na upload).
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    takenAt: v.optional(v.number()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    locationLabel: v.optional(v.string()),
    // EXIF Orientation tag (1..8). Audit-9 §photo rotation: client past
    // CSS-transform toe zodat liggend-gemaakte JPEGs correct rechtop staan.
    exifOrientation: v.optional(v.number()),
    // WP25: de verkleinde JPEG's (langste zijde 512 en 1600), beide of geen.
    // Gemaakt door `internal.photoFormats.makeFormats` na de upload of in de
    // backfill. Nooit in een publieke response (WP17a invariant 10): het
    // beeldpad kiest het formaat met het foto-id.
    formats: v.optional(
      v.object({ klein: v.id("_storage"), groot: v.id("_storage") }),
    ),
    // WP25 A-invariant 25: de operator tekende deze foto af als "mag zonder
    // formaten" (`formaten --accept-no-formats`), met de tijd. De backfill
    // slaat hem dan over; WP10 meldt hem niet als "formaten ontbreken".
    noFormatsAcceptedAt: v.optional(v.number()),
    // Flagging (FL1: auto-delete na 14 dagen, FL2: appeal + admin decision).
    flaggedAt: v.optional(v.number()),
    flaggedBy: v.optional(v.id("users")),
    flagReason: v.optional(v.string()),
    flaggedDeleteDate: v.optional(v.number()),
    flaggedAppealDate: v.optional(v.number()),
    flaggedAppealDenyDate: v.optional(v.number()),
    // WP37: een filmpje. Dan is `storageId` de poster (het beeld van de rij,
    // met *klein* en *groot*), en staat het bestand in R2 onder `key`: de
    // eindsleutel (`videos/…`), door de backend gekozen, waarvoor nooit een PUT
    // is getekend (A-invariant 11). `durationMs` en `bytes` komen uit
    // het bestand zelf, zoals de backend het bekeek (A-invariant 12). Alleen
    // `durationMs` verlaat de backend (A-invariant 19).
    video: v.optional(
      v.object({ key: v.string(), durationMs: v.number(), bytes: v.number() }),
    ),
    // WP38 fix-cyclus 2 (heraudit 1): het origineel van dit filmpje is
    // teruggetrokken (`withdraw`) of door de oprichter verwijderd
    // (`removeOriginal`, `removeAll`), met de tijd. Dan neemt `startOriginal`
    // voor dit filmpje geen inzending meer aan. Op het filmpje zelf, zodat de
    // markering meegaat als het filmpje of het account weg is; geen verwijzing,
    // en geen publiek pad toont het veld.
    originalBlockedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    // WP20 besluit 6, S2: alleen de gemelde foto's van een eigenaar lezen
    // (listMyFlagged), met een ondergrens op flaggedAt.
    .index("by_owner_and_flagged", ["ownerId", "flaggedAt"])
    // WP17c A-keuze 1: Mijn foto's bladert per eigenaar, nieuwste upload eerst.
    .index("by_owner_and_createdAt", ["ownerId", "createdAt"])
    // WP24 invariant 8: welke foto's horen bij een beeld
    // (users.updateProfile accepteert alleen een beeld van de caller).
    .index("by_storage", ["storageId"])
    .index("by_takenAt", ["takenAt"])
    .index("by_flagged", ["flaggedAt"])
    .index("by_flagged_delete", ["flaggedDeleteDate"]),

  // Reservation-pattern store voor de POST /upload httpAction
  // (audit-cyclus-1). Eén record per (ownerId, clientUploadId) — composite
  // key levert per-user scope structureel. State machine:
  //   in_progress = reservation gemaakt, photo nog niet gecreëerd
  //   completed   = photo gecreëerd, photoId gevuld, completedAt gezet
  // Cascade matrix UI1: daily cron ruimt completed >7d en in_progress >30min op
  // (een video-upload: >1d, met zijn object in R2).
  uploadIdempotency: defineTable({
    ownerId: v.id("users"),
    clientUploadId: v.string(),
    status: v.union(v.literal("in_progress"), v.literal("completed")),
    photoId: v.optional(v.id("photos")),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    // WP37: een video-upload (`videos.startUpload`). De tijdelijke sleutel in
    // R2 (`uploads/…`) die de backend koos en waarheen de app PUT, en het album
    // waar het filmpje in komt. Het filmpje zelf krijgt bij het afronden een
    // eindsleutel (`photos.video.key`, A-invariant 11, 12). Open blijft hij
    // VIDEO_UPLOAD_OPEN_MS (een dag), niet 30 minuten (A-invariant 20).
    videoKey: v.optional(v.string()),
    albumId: v.optional(v.id("albums")),
  })
    .index("by_owner_and_clientUploadId", ["ownerId", "clientUploadId"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    // WP18 A-invariant 26: een foto wissen leest alleen zijn eigen reservering.
    .index("by_photo", ["photoId"]),

  // WP37 A-invariant 36: elke geslaagde `videos.startUpload` (een link of een
  // filmpje terug), voor de grens van 30 per user per 24 uur (glijdend). Een
  // rij ouder dan 24 uur ruimt `reserveVideo` zelf op; account verwijderen
  // wist ze (WP29, fase reserveringen). Geen publieke query leest deze tabel.
  videoUploadRequests: defineTable({
    ownerId: v.id("users"),
    at: v.number(),
  }).index("by_owner_and_at", ["ownerId", "at"]),

  // ──────────────────────────────────────────────────────────────────
  // Filmproject (WP38)
  // ──────────────────────────────────────────────────────────────────
  // Per groep hooguit één open project, door de oprichter geopend met een
  // filmalbum en een einddatum. Open = `closedAt` niet gezet en `endsAt` nog
  // niet voorbij. `albumName` is de naam bij het openen: na sluiten mag het
  // album weg (besluit 17 weigert dat alleen zolang het project open staat);
  // dan gaat `albumId` eruit (WP10: geen losse verwijzing) en blijft de naam.
  // `reminderSentAt`: de herinnering aan de oprichter (besluit 15) is weg.
  // Een gesloten project zonder originelen ruimt de dagelijkse ronde op.
  filmProjects: defineTable({
    groupId: v.id("groups"),
    albumId: v.optional(v.id("albums")),
    albumName: v.string(),
    endsAt: v.number(),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    // Besluit 15, fix-cyclus 1: `reminderClaimedAt` is een ronde die de mail
    // gepland heeft (een paar uur geldig, zodat twee rondes vlak na elkaar één
    // mail geven); `reminderSentAt` pas als de mail weg is.
    reminderClaimedAt: v.optional(v.number()),
    reminderSentAt: v.optional(v.number()),
  })
    .index("by_group", ["groupId"])
    .index("by_album", ["albumId"]),

  // WP38: een inzending, het origineel van één nieuw filmpje (`photoId`) in
  // het filmalbum. Het bestand staat in de originelen-bucket van R2
  // (`R2_ORIGINALS_BUCKET`) onder `key`, door de backend gekozen;
  // `uploadId` is de multipart-upload van R2 zolang hij onderweg is. `key`
  // en `uploadId` verlaten de backend nooit los (A-invariant 4, 7). `bytes`
  // is de aangemelde grootte; binnen pas als R2 het hele object met precies
  // die grootte heeft (A-invariant 5). `groupId` is die van het project, voor
  // de cascades. Geen rij in `photos` (A-invariant 7).
  filmOriginals: defineTable({
    projectId: v.id("filmProjects"),
    groupId: v.id("groups"),
    ownerId: v.id("users"),
    photoId: v.id("photos"),
    key: v.string(),
    uploadId: v.optional(v.string()),
    bytes: v.number(),
    status: v.union(v.literal("onderweg"), v.literal("binnen")),
    container: v.optional(v.union(v.literal("mov"), v.literal("mp4"))),
    submittedAt: v.number(),
    completedAt: v.optional(v.number()),
    // Fix-cyclus 2 (red-team Z2): wanneer `startOriginal` voor het laatst
    // deel-links gaf. De afrond-cron kijkt alleen inzendingen na met links die
    // nog gelden.
    linksAt: v.optional(v.number()),
    // Fix-cyclus 2 (red-team N3): wanneer de laatste upload in R2 aan deze
    // inzending is gekoppeld (ook bij hervatten met een nieuwe upload). Blijft
    // staan na binnen; daar telt MON3 het jaar vanaf.
    uploadCreatedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_photo", ["photoId"])
    .index("by_owner", ["ownerId"])
    .index("by_group_and_owner", ["groupId", "ownerId"])
    .index("by_status_and_completedAt", ["status", "completedAt"]),

  // WP38 fix-cyclus 1: de daggrens van `startOriginal` en `finishOriginal`
  // samen (glijdend, zoals `videoUploadRequests`). Eén rij per aanroep die
  // doorging; een weigering en de cron tellen niet.
  originalRequests: defineTable({
    ownerId: v.id("users"),
    at: v.number(),
  }).index("by_owner_and_at", ["ownerId", "at"]),

  // ──────────────────────────────────────────────────────────────────
  // Invites
  // ──────────────────────────────────────────────────────────────────
  // Invite-only signup: pre-signup checkt of email een open invite heeft.
  invites: defineTable({
    email: v.string(),
    invitedBy: v.id("users"),
    // WP19b A-keuze 1: een nieuwe uitnodiging heeft altijd een groep. Optioneel
    // voor gemigreerde rijen; een uitnodiging zonder groep telt nergens
    // (A-invariant 16).
    groupId: v.optional(v.id("groups")),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
    // WP19b A-invariant 10: de naam die de admin typte en het bericht.
    // Optioneel: gemigreerde rijen hebben ze niet.
    name: v.optional(v.string()),
    message: v.optional(v.string()),
    // WP19b A-invariant 5: het token verlaat de backend niet meer. Het veld
    // en de index blijven voor bestaande rijen; geen publiek pad leest het.
    token: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
    // Onderscheidt bounce-driven expiry van natuurlijke expiry (status='expired'
    // alleen volstaat niet om beide gevallen te kunnen scheiden).
    bouncedAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_token", ["token"])
    .index("by_status", ["status"])
    .index("by_invitedBy", ["invitedBy"])
    // WP28 A-invariant 8: groep weg → al zijn uitnodigingen weg.
    .index("by_group", ["groupId"]),

  // Dedup-store voor bounce-webhook events. Email-providers retry'en
  // webhooks bij non-2xx response; door providerEventId te tracken
  // voorkomen we dubbele state-transitions en notify-mails.
  inviteBounceEvents: defineTable({
    providerEventId: v.string(),
    processedAt: v.number(),
  }).index("by_eventId", ["providerEventId"]),

  // ──────────────────────────────────────────────────────────────────
  // Features (feature requests + upvoting + problem reports)
  // ──────────────────────────────────────────────────────────────────
  features: defineTable({
    type: v.union(v.literal("feature"), v.literal("problem")),
    title: v.string(),
    description: v.string(),
    submittedBy: v.id("users"),
    status: v.union(
      v.literal("open"),
      v.literal("planned"),
      v.literal("inProgress"),
      v.literal("done"),
      v.literal("rejected"),
    ),
    upvoteCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_submittedBy", ["submittedBy"]),

  // Upvotes (apart om dubbele votes te voorkomen).
  featureUpvotes: defineTable({
    featureId: v.id("features"),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_feature", ["featureId"])
    .index("by_feature_and_user", ["featureId", "userId"])
    // WP29: de upvotes van wie zijn account verwijdert.
    .index("by_user", ["userId"]),

  // ──────────────────────────────────────────────────────────────────
  // Films (WP21)
  // ──────────────────────────────────────────────────────────────────
  // De clubfilms in S3 (de bestanden gaan niet naar Convex, WP12). Eén rij per
  // film of trailer, in de volgorde van `order`. Toegang = lid van `groupId`.
  // Gevuld per omgeving via `internal.films.replaceAll` (invariant 9: geen
  // bestandsnaam in de repo). `videoKey` en `coverKey` verlaten de backend
  // nooit, alleen als ondertekende link.
  films: defineTable({
    groupId: v.id("groups"),
    kind: v.union(v.literal("trailer"), v.literal("film")),
    title: v.string(),
    year: v.number(),
    videoKey: v.string(),
    coverKey: v.optional(v.string()),
    order: v.number(),
  })
    .index("by_order", ["order"])
    .index("by_group", ["groupId"]),

  // ──────────────────────────────────────────────────────────────────
  // Afrekeningen uit het clubboek (WP41)
  // ──────────────────────────────────────────────────────────────────
  // Eén rij per afrekening van een evenement in het clubboek; `key` is het id
  // van dat evenement. Alleen het clubboek schrijft, via `POST /settlements`
  // (groep uit `FINANCE_GROUP_ID`); opnieuw sturen vervangt de rij met behoud
  // van `_id`. Bedragen zijn hele centen. Geen intern id van een lid: een
  // deelnemer is zijn korte naam, uniek per afrekening. Toegang = lid van
  // `groupId`. De vorm staat in lib/settlementShape.ts (spec §A2, §A3).
  settlements: defineTable({
    groupId: v.id("groups"),
    key: v.string(),
    ...settlementContentFields,
    receivedAt: v.number(),
  })
    .index("by_group", ["groupId"])
    .index("by_group_key", ["groupId", "key"]),

  // ──────────────────────────────────────────────────────────────────
  // Album last-seen (per user × album)
  // ──────────────────────────────────────────────────────────────────
  // Vervangt de oude `seenPics` array op memberships (cascade matrix
  // AP1 + AP2). Eén record per (user, album) met laatste open-tijdstip;
  // unread count wordt live berekend via range scan op albumPhotos.
  albumLastSeen: defineTable({
    userId: v.id("users"),
    albumId: v.id("albums"),
    lastSeenAt: v.number(),
  })
    .index("by_user_album", ["userId", "albumId"])
    .index("by_user", ["userId"]) // U9 cascade
    .index("by_album", ["albumId"]), // A2 cascade

  // ──────────────────────────────────────────────────────────────────
  // User visits (WP15b)
  // ──────────────────────────────────────────────────────────────────
  // Eén rij per user met het laatste bezoek (was UV record). Buiten de
  // users-rij: Convex draait elke query opnieuw die een gewijzigd document
  // las, dus een bezoek in `users` zou de poort en elke ledenlijst laten
  // herdraaien. Geen publieke query leest deze tabel. Cascade U11.
  userVisits: defineTable({
    userId: v.id("users"),
    lastVisitAt: v.number(),
  }).index("by_user", ["userId"]),

  // ──────────────────────────────────────────────────────────────────
  // Monitoring runs (WP10: integrity-check / monitoring)
  // ──────────────────────────────────────────────────────────────────
  // Eén rij per integrity-check-run (daily cron 04:30 UTC). Additive — geen
  // backfill, geen wijziging aan bestaande tables. State-tabel voor:
  //   - alert-dedup: `driftSignature` (hash van de gevonden drift-rijen);
  //     drift-mail gaat alleen als de signature verschilt van de laatste run
  //     die wél een drift-mail stuurde (invariant 4).
  //   - heartbeat: `lastHeartbeatAt` = tijdstip van laatste monitor-mail (drift
  //     óf heartbeat). Reset bij élke mail; ≥30d sinds = stuur heartbeat (inv 6).
  // `emailSent` = "gequeue'd door deze run", niet "afgeleverd" (best-effort,
  // consistent met alle bestaande mail-paden).
  monitoringRuns: defineTable({
    runAt: v.number(),
    driftFound: v.boolean(),
    driftSignature: v.string(),
    emailSent: v.boolean(),
    lastHeartbeatAt: v.number(),
  }).index("by_runAt", ["runAt"]),
});
