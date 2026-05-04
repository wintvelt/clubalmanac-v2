# Clubalmanac: AWS → Convex Migratieplan

## Huidige architectuur

### Repos en verantwoordelijkheden

| Repo | Functie |
|------|---------|
| `blob-images-api` | Core: DynamoDB stream handler (reactive cascades), Cognito triggers (signup, custom messages, pre-signup invite check) |
| `blob-images-api-user` | User CRUD, signed upload URL generatie, photo count limiet |
| `blob-images-api-groups` | Groups, albums, album-photos, memberships, invites sturen |
| `blob-images-api-photos` | Photo CRUD, S3 trigger (EXIF/geocoding), flagging, ratings |
| `blob-images-api-invites` | Invite accept/decline, public invite view |
| `blob-images-api-features` | Feature requests + upvoting, problem reporting |
| `blob-images-common` | Shared lib: DB, S3, SES, Cognito, Lambda wrappers, email templates, handler util |

### Database: single-table DynamoDB
Eén tabel (`blob-images-photos-{stage}`) met PK/SK patronen:

| Prefix | Entiteit | Voorbeeld |
|--------|----------|-----------|
| `USER` | User record | `USER / U{id}` |
| `UB` | User base (naam, foto) | `UBbase / U{id}` |
| `UV` | User visit (dates, cognitoId) | `UV... / U{id}` |
| `US` | User full | `US... / U{id}` |
| `UP` | User stats | `UPstats / U{id}` |
| `PO` | Photo | `PO{photoId} / U{userId}` |
| `UF` | Rating | `UF... / ...` |
| `GB` | Group | `GBbase / {groupId}` |
| `GA` | Album | `GA{groupId} / {albumId}` |
| `GP` | Album-photo | `GP{groupId}#{albumId} / {photoId}` |
| `UM` | Membership | `UM{userId} / {groupId}` |

GSIs: `cover-idx`, `SK-PK-idx`, `email-idx`, `cog-idx`, `date-idx`, `flagged-idx`

### DynamoDB Streams: reactive cascade engine
Stream handler op de hele tabel propageert wijzigingen (~27 imports in `mainStream.js`):
- User wijziging → update memberships, photos (denormalized user data)
- Photo wijziging → update publications, covers, stats
- Group wijziging → update memberships, albums
- Rating wijziging → update photo aggregate
- Membership/group/album/user delete → cascade deletes

### File storage
S3 bucket met `protected/{userId}/` structuur. Upload via signed URL. S3 trigger op `ObjectCreated` doet EXIF extractie + geocoding + DB insert.

### Auth
Cognito met invite-only signup (pre-signup Lambda checkt invite in DB), custom email templates in het Nederlands.

### Clients
- **iPhone app** (App Store): primaire client. Expo SDK 47, React Native 0.70.5 (eind 2022). `aws-amplify` v5 voor Cognito + API + Storage. **Geen `expo-updates` of `expo-notifications` geïnstalleerd** → geen OTA, geen push.
- **Webapp** (legacy): fallback voor Android-users die door corporate restricties geen apps kunnen installeren. Zelfde AWS backend.

### Schaal
16 users, ~1650 foto's (~5.3 GB), 6 video's (~3 GB), laag/casual gebruik. AWS kost ~$10/maand.

## Convex: kan het?

### Database goed haalbaar
Single-table design wordt aparte Convex tables: `users`, `photos`, `groups`, `albums`, `albumPhotos`, `memberships`, `invites`, `ratings`, `features`, `featureUpvotes`, `albumLastSeen`. Verbetering: leesbaarder, typed schemas, geen PK/SK encoding.

### DynamoDB Streams → Convex mutations: grootste winst
Convex mutations zijn transactioneel: je kunt in één mutation meerdere tables updaten. Geen eventual consistency. De complexe stream handler (27 cascade handlers) wordt grotendeels overbodig. Sommige denormalization kun je zelfs elimineren door te joinen i.p.v. dupliceren.

### File Storage

**Upload-flow: 1-step backend-mediated POST met reservation pattern (cyclus 1, gehard in audit-cyclus-1).**

Eerdere ontwerp (3-step: `generateUploadUrl` mutation → client PUT → `createFromUpload` mutation) had drie problemen:

1. **Orphan storage objects** bij client-crash tussen PUT en `createFromUpload`. Convex storage object bestond, maar geen photo record → integrity-check moest 'm later opruimen
2. **Cross-user race** bij gelijktijdige uploads. Pieterpad-scenario: groep wandelt samen, mobiele uploads via flaky netwerk → hogere crash-rate tussen PUT en finalize-mutation
3. **Niet retry-safe**: dubbele POST kon dubbele photo records produceren als client de eerste response miste en retry'de met een nieuwe `generateUploadUrl`. `by_storageId` idempotency-anchor ving dit nét op zolang storageId hergebruikt werd; bij retry met nieuwe upload-URL viel de garantie weg

Cyclus 1 vervangt dat door een 1-step `POST /upload`. Audit-cyclus-1 vond drie productie-issues op die eerste rewrite — alle drie cascaden uit één architectuur-keuze: idempotency was een **post-fact log** (record geschreven NÁ photo-creatie). Dat liet een race-window open tussen photo-insert en idempotency-insert, kon onder concurrent retry's een dubbele photo produceren, en liet een Nederlandstalige `message.includes("limiet")`-substring matchen voor de quota-foutpaden. Fix: **reservation pattern** als state machine, typed sentinel voor quota-fouten, defensieve trim op de idempotency-header.

**Nieuwe flow:**

```
POST /upload    (Convex httpAction in convex/http.ts)
  Headers:
    Authorization: Bearer <Clerk JWT>
    X-Upload-Id: <client-generated UUID>          (server-side getrimd)
    Content-Type: image/jpeg | image/heic | image/png | ...
    X-Filename: <optional, client-meegegeven bestandsnaam>
  Body: file binary (single-file, geen multipart)

  → 200 { photoId: Id<"photos"> }
  → 400 { error: "Missing X-Upload-Id" }          (ook bij whitespace-only header)
  → 401 { error: "Unauthorized" }
  → 403 { error: "Photo limiet bereikt" }          (was 413; quota = Forbidden, niet Payload Too Large)
  → 409 { error: "Upload in progress" }            (race-loser tegen lopende reservation, audit-cyclus-1)
```

**Reservation pattern (state machine).** De `uploadIdempotency`-row wordt nu **vóór** de photo-creatie ingeschreven met `status="in_progress"`, en in dezelfde Convex transactie als de photo-insert ge-patched naar `status="completed"` (zie stap 7). De composite index `by_owner_and_clientUploadId` maakt de lookup atomair per (ownerId, clientUploadId): twee parallelle handlers met dezelfde key triggeren een Convex transaction-conflict; de loser wordt geretry'd en ziet bij retry de in_progress reservation van de winnaar — waaruit een 409 volgt.

**Architectuur-keuze tijdens cyclus 1 implementatie:** completion-patch verschoven van een aparte `markCompleted`-mutation naar `createFromUploadInternal` voor atomicity (geen tussenstaat tussen photo-insert en reservation-completion). Audit-12 §1 documenteert deze keuze expliciet.

Server-side flow:

1. `ctx.auth.getUserIdentity()` → null → 401. Convex valideert de Clerk JWT zelf vóór de httpAction draait
2. Resolve user-record via `subject` lookup (equivalent van `requireCurrentUser`)
3. Trim `X-Upload-Id`; lege string na trim → 400 (audit-cyclus-1 §3: `"   "` mag niet als geldige idempotency-key door)
4. `internal.uploads.reserve({ownerId, clientUploadId})` — atomair:
   - hit `status="completed"` → return `{ kind: "hit", photoId }` (idempotente retry)
   - hit `status="in_progress"` → return `{ kind: "conflict" }` → 409
   - miss → insert `{status: "in_progress", createdAt, photoId: undefined, completedAt: undefined}` → return `{ kind: "reserved", reservationId }`
5. Photo-limit check + storage write + photo-create gaan via `internal.photos.createFromUploadInternal`. Bij quota-fail throwt die de **typed sentinel string** `"PHOTO_LIMIT_REACHED"` — de http handler matcht dat exact en mapt naar **403 Forbidden** met NL-body `"Photo limiet bereikt"`. Geen substring-match meer op een Nederlandse error-message. Limit-check loopt vóór `storage.store`, vóór `reserve` — geen orphan blob, geen phantom in_progress
6. `ctx.storage.store(await request.blob())` → storageId
7. `internal.photos.createFromUploadInternal({storageId, ownerId, reservationId, filename, mimeType})` — internal mutation die in **één Convex transactie**: photo record insert + `photoCount++` + reservation patch (`status="completed"`, `photoId`, `completedAt`) + `scheduler.runAfter(0, extractMetadata)`. Atomair: een commit-failure laat geen window open waarin photo bestaat maar reservation nog in_progress is. Geen aparte `markCompleted`-mutation meer (zie architectuur-keuze hierboven, audit-12 §1)
8. Return `{photoId}`

Bij failure tussen stap 4 en 7 (server crash, exception in 6/7) blijft de reservation in `in_progress` achter. Stale-cleanup-cron ruimt die op na 30 minuten (zie cron-sectie); een retry met dezelfde clientUploadId binnen die 30 min krijgt dus nog 409 — daarna een schone insert.

**Idempotency-tabel (audit-cyclus-1 schema):**

```ts
uploadIdempotency: defineTable({
  ownerId: v.id("users"),                                    // NIEUW: per-user scope structureel
  clientUploadId: v.string(),
  status: v.union(v.literal("in_progress"), v.literal("completed")),  // NIEUW: state machine
  photoId: v.optional(v.id("photos")),                        // CHANGED: optional, alleen na completion
  createdAt: v.number(),
  completedAt: v.optional(v.number()),                        // NIEUW: gevuld bij completion-patch in createFromUploadInternal
})
  .index("by_owner_and_clientUploadId", ["ownerId", "clientUploadId"])  // NIEUW: composite
  .index("by_status_and_createdAt", ["status", "createdAt"]);           // NIEUW: voor stale cleanup
```

Verwijderd t.o.v. cyclus 1: `by_clientUploadId` (vervangen door composite), `by_createdAt` (vervangen door status-aware variant). De composite key levert per-user scope **structureel**: user X kan de upload-id van user Y niet meer "kapen" omdat de DB-key zelf de ownerId bevat. De fallthrough/owner-mismatch defensive-coding uit cyclus 1 vervalt.

Voordeel boven `photos.by_storageId`: de mapping leeft van `clientUploadId` (gegenereerd vóór de upload start, blijft over retries gelijk) i.p.v. `storageId` (server-toegewezen, verandert bij elke nieuwe upload). Daardoor is de idempotency robuust tegen client-retry op netwerkfailure tussen request en response.

**Schema-wijzigingen:**
- Vervangen: `uploadIdempotency` tabel + indexes (zie hierboven — vervangt cyclus-1 versie)
- Toevoegen: cron `cleanupOldUploadIdempotency` met **twee thresholds** (zie cron-sectie + cascade matrix UI1)
- Verwijderen: `photos.by_storageId` index — niet meer nodig na rewrite
- Verwijderen: `api.photos.generateUploadUrl` mutation
- Verwijderen: `api.photos.createFromUpload` mutation (vervangen door internal helper `internal.photos.createFromUploadInternal`)
- `api.photos.create` blijft als test-fixture helper (NIET deprecated voor verwijdering): wordt door 22+ tests gebruikt om photo records te creëren zonder de hele upload-pipeline te doorlopen. Photo-limit error harmonized naar `PHOTO_LIMIT_REACHED` typed sentinel voor consistency met createFromUploadInternal

**Status-code semantiek:**
- **400** Bad Request voor missing/whitespace-only `X-Upload-Id` (client-side fout)
- **401** Unauthorized voor ontbrekende identity / niet-bestaande user
- **403** Forbidden voor quota-overschrijding (audit-cyclus-1 §1: was 413 Payload Too Large; quota is een policy-refuse, niet body-grootte). Body-message blijft NL voor UX
- **409** Conflict voor concurrent same-user same-UUID race (audit-cyclus-1 §2: race-loser krijgt geen valse 200)
- 5xx alleen voor onverwachte fouten — `PHOTO_LIMIT_REACHED` sentinel mag niet als 500 doorlekken

**Trade-offs van backend-mediated upload:**

| | Oude flow (signed URL → PUT) | Nieuwe flow (POST /upload) |
|---|---|---|
| Bandwidth | Client → S3 direct, geen Convex tussenroute | Client → Convex → storage; Convex action draait extra ~ms |
| Bandwidth-kosten | 1× egress (storage→client bij viewing) | 1× ingress + 1× egress, ingress is gratis op Convex |
| Robustness | 2 mutation calls + 1 PUT, tussenstaten kunnen orphans creëren | 1 atomic call, geen tussenstaten |
| Retry-safety | Dubbele records bij retry-na-mislukte-finalize | Idempotent op `X-Upload-Id` |
| Auth | Limit-check 2× nodig (gen + finalize) | 1× check binnen één transactie |

Nettowinst: robustness over een minimale extra hop. Bij JPEG-uploads (~2-5 MB typisch) is de extra latency verwaarloosbaar bij Convex EU.

**Upload-size limit (known limitation, audit-cyclus-1 §5):**
Convex httpAction request body limit is ~20 MiB (default, niet configureerbaar tot R2-pad). Voldoende voor JPEG/HEIC photos in de huidige content-mix (typisch 2–10 MB). Bij body > 20 MiB faalt Convex de hele request al vóór de httpAction draait — geen 4xx/5xx vanuit onze handler, maar een platform-niveau reject. Cyclus 1 kiest bewust om dat **niet** te fixen: het pad voor groot-bestanden (HEIC live-photos, video) loopt sowieso via Cloudflare R2 met presigned-PUT in cyclus 3+, en een tussentijdse mitigatie zou de huidige flow nodeloos compliceren. Risico: een gebruiker met een 25 MB foto krijgt een onduidelijke fout in plaats van een herkenbare 413. Acceptabel bij 16 users; documenteren we als known limitation tot R2-switch.

**Performance:** je huidige setup heeft last van Lambda cold starts bij foto laden. Convex heeft geen cold starts, maar native file storage heeft ook geen CDN edge caching. Twee opties:

**Optie A: Convex native storage (start hiermee)**
Simpelste setup. Serving via signed URLs direct vanuit Convex. Prima startpunt, en als performance tegenvalt eenvoudig te upgraden naar optie B.

**Optie B: Convex R2 component (`@convex-dev/r2`)**
Files in Cloudflare R2, metadata in Convex. Voordelen:
- **Nul egress kosten** (de grootste Convex kostenpost verdwijnt)
- Cloudflare edge network = snellere delivery wereldwijd
- R2 free tier: 10 GB storage + 10M reads/maand gratis. Jouw 8.3 GB valt daar volledig binnen → **$0/maand voor file storage en bandwidth**
- Switch is relatief makkelijk: alleen storage layer verandert, Convex queries/mutations blijven gelijk

Aanbeveling: start met A, switch naar B als performance of kosten een issue worden.

**Video streaming:** video upload is handmatig (geen probleem). Streaming van 30-min video's kan met beide opties. R2 is hier beter vanwege edge caching en nul egress.

### Cron-registratie

Naast `cleanupFlaggedPhotos` (FL1, daily) komt in cyclus 1 de cleanup-cron voor upload-idempotency erbij:

```ts
// convex/crons.ts
crons.daily(
  "cleanup old upload idempotency",
  { hourUTC: 3, minuteUTC: 30 },  // naast cleanupFlaggedPhotos (3:00 UTC)
  internal.uploads.cleanupOld,
  {},
);
```

`internal.uploads.cleanupOld` ruimt records uit `uploadIdempotency` op met **twee verschillende thresholds**, samenhangend met de reservation-pattern state machine (audit-cyclus-1):

- `status="completed"` records met `createdAt <= now - 7d` — retry-safety horizon. 7d is de "geldigheidsduur" van een idempotency-key, voldoende voor legitieme background-upload retry's
- `status="in_progress"` records met `createdAt <= now - 30min` — stale-reservation horizon. Een reservation die langer dan 30 min in_progress staat impliceert een gecrashte/afgebroken handler tussen `reserve` en de atomic completion-patch in `createFromUploadInternal`. 30min cutoff geeft veilige marge voor slow mobile uploads + HEIC parsing (audit-12 §2: 5min was te krap voor real-world mobile flow). Cleanup ontblokkeert toekomstige retries met dezelfde clientUploadId. Alleen de tabel-rij wordt opgeruimd; storage-orphans worden door integrity-check opgepakt (zie cyclus-2 backlog)

Boundary in beide gevallen `<=` (consistent met FL1 `flaggedDeleteDate <= now` en invites accept `expiresAt <= now`). De `by_status_and_createdAt` index laat beide range queries efficiënt draaien. Zie cascade matrix row UI1.

Toekomstige cron-toevoeging: `expirePendingInvites` voor IB2 (natural-expiry op invites — gebundeld met scheduled-functions werkpakket, nog niet geleverd).

### Auth
Aanbeveling: **Clerk + Convex** (bewezen Expo combo, werkt ook voor web). 16 users: gewoon opnieuw laten registreren. Cognito wordt volledig vervangen. Clerk heeft aparte dev en prod instances (zie Environments).

### Webmaster-rol (RBAC)

In oude AWS app was webmaster één hardcoded email (`wintvelt@me.com`) via env-var, geen Cognito group. Convex equivalent: env-var `WEBMASTER_EMAILS` (comma-separated) per deployment, helper `requireWebmaster(ctx)` die `ctx.auth.getUserIdentity().email` matcht tegen de lijst.

```ts
// convex/lib/auth.ts
function getWebmasterEmails(): string[] {
  return (process.env.WEBMASTER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase()) // case-insensitive (audit-7 §2)
    .filter((e) => e.length > 0);
}

export async function requireWebmaster(ctx) {
  // Audit-7 §3: webmaster MOET ook een users-record hebben. Beide gates
  // samen: requireCurrentUser (identity + users-record) én email-match.
  const user = await requireCurrentUser(ctx);
  const identity = await ctx.auth.getUserIdentity();
  const email = identity?.email?.toLowerCase();
  const allowed = getWebmasterEmails();
  if (!email || !allowed.includes(email)) {
    throw new Error("Webmaster only");
  }
  return user;
}
```

Eigenschappen die deze helper pinnen (zie `tests/lib/auth.test.ts`):
- **Case-insensitive match** aan beide kanten (env-var én JWT-claim) — admin tikt mixed-case in dashboard, Clerk normaliseert lowercase. Audit-7 §2.
- **Fail-closed** bij ontbrekende env-var, lege string, of identity zonder email-claim.
- **Whitespace + comma-separated** robuust via `trim` + `filter`.
- **Webmaster zónder users-record** wordt geweigerd door de interne `requireCurrentUser`-call. Audit-7 §3.

Webmaster-gated operations (uit oude AWS code):
- `decideFlag(photoId, approve)` — flag appeal beslissing
- `listAllFlagged()` — admin queue van geflagde photos
- `features.remove(featureId)` — feature requests verwijderen
- `features.update(featureId, ...)` — feature status updaten (bv. "accepted")

Bootstrap: jouw email handmatig in Clerk dashboard aanmaken pre-cutover, env-var `WEBMASTER_EMAILS=wintvelt@me.com` zetten in Convex prod deployment. Dev-deployment krijgt z'n eigen test-email-set bij WP4-setup (zie WP4-sectie hieronder): `WEBMASTER_EMAILS` op dev bevat de webmaster-test-user (`clubalmanac-integration-webmaster@example.com`), zodat de JWT-roundtrip-pin op een echte webmaster-flow draait zonder met Wouter's prod-email te overlappen.

**YAGNI keuze:** Clerk publicMetadata-rol of Convex DB-flag zou flexibeler zijn (multi-webmaster zonder redeploy), maar bij 16 users + 1 webmaster levert het niks op. Bij behoefte aan tweede webmaster ooit: ~30 min werk om over te zetten. Probleem-report email-bestemming gebruikt dezelfde env-var.

**TODO voor Fase 4A2 (client-integratie):** verifieer dat `convex/auth.config.ts` daadwerkelijk de `email`-claim uit het Clerk JWT doorgeeft, zodat `ctx.auth.getUserIdentity().email` in productie gevuld is. Implementatie + tests gebruiken `withIdentity({ email })` wat altijd werkt; productie hangt af van Clerk JWT template configuratie. Als email-claim niet doorkomt: Clerk JWT template aanpassen óf `requireWebmaster` switchen naar DB-lookup via `users.email`.

> **Productie-blind-spot (audit-7):** vitest-suite simuleert de email-claim via `t.withIdentity({ email })`, dat zegt NIETS over de Clerk JWT-template in productie. Pas in Phase 4A2 met een smoke-test (HTTP-endpoint dat `ctx.auth.getUserIdentity()` reflecteert óf log, eenmalig) is verifieerbaar of de claim daadwerkelijk doorkomt. Tot die smoke-test landt: groen-passende tests garanderen geen werkende webmaster-flow op prod. **Status (WP4):** gepind via een `whoami` httpAction + Clerk JWT roundtrip in `tests/integration/clerk/jwtRoundtrip.test.ts` — zie WP4-sectie verderop. Niet schrappen: blijft historisch belangrijk omdat het de motivatie voor WP4 is.

### Email-normalisatie invariant

Alle email-vergelijkingen in deze app zijn case-insensitive (lowercase + trim). Dit geldt voor `invites.email`, `users.email`, en `WEBMASTER_EMAILS` matching. Concreet:

- **Schrijven:** elke insert van een email-veld (in `users.register`, `invites.create`, seed-tools, migratie-scripts) past `email.trim().toLowerCase()` toe vóór persistentie. Geen "raw" email-strings in de DB.
- **Lezen / vergelijken:** elke `by_email`-lookup en elke handmatige email-equality (bv. `invite.email !== normalizeEmail(user.email)` in accept/decline) gaat door dezelfde normalisatie. De `normalizeEmail`-helper in `convex/invites.ts` is de enige reference, `convex/users.ts` past dezelfde regel toe inline.
- **Binnenkomende strings:** Clerk's JWT-claim `email` wordt door Clerk al lowercased aangeleverd, maar code mag daar niet op vertrouwen — altijd opnieuw normaliseren bij vergelijking.
- **Bounce-webhook:** Mailjet kan mixed-case email teruggeven; `internal.invites.handleBounce` normaliseert via `findInvitesByEmail` (audit-8).

**Waarom een expliciete invariant:** audit-8 vond dat `users.register` de invite-gate-lookup wel normaliseerde maar de duplicate-check + insert op `users.email` niet — daardoor kon een `Alice@x.com` user een second-register met `alice@x.com` niet blokkeren, en mistten downstream "is dit emailadres al lid"-checks de mixed-case user. Eén regel, overal toegepast, voorkomt dat soort drift.

**Migratie van prod data (cutover):** het migratie-script (zie Fase 3) lowercaset alle bestaande `users.email` en `invites.email` waarden vóór ze in Convex landen. Records met case-collisions (theoretisch — Cognito normaliseerde óók al) worden tijdens de transformatie geflagd in de validatie-rapport-stap.

### TypeScript: overstappen
Convex is volledig TypeScript-native: schema genereert types die end-to-end doorlopen van DB tot React Native components. Zonder TS verlies je het halve voordeel (type-safe queries, autocompletion, compile-time checks).

### Unread-count per album per user (`albumLastSeen`)

Mechanisme: in groep-overzicht toont elk album het aantal nieuwe foto's van anderen sinds de actieve user het album voor het laatst opende. Vervangt de oude `seenPics` array op memberships (was AP1/AP2 in cascade matrix, blocked op design).

**Schema:**
```ts
albumLastSeen: {
  userId: Id<"users">,
  albumId: Id<"albums">,
  lastSeenAt: number,
}
// index: by_user_album (userId, albumId)
```

`albumPhotos` krijgt index `by_album_added (albumId, addedAt)` voor de range scan. Photos zelf hebben geen `albumId` (m:n via `albumPhotos`), dus de scan loopt over de koppeltabel.

**Schrijven:** alleen wanneer user album-detailscherm opent, upsert `lastSeenAt = now`. Plus optionele "markeer alles gelezen"-actie op groep-niveau.

**Lezen (count per album in group-overzicht):**
```
effectiveLastSeen = albumLastSeen?.lastSeenAt
  ?? max(album.createdAt, membership.joinedAt)

count = aantal albumPhotos waar
  albumId == X
  && addedAt > effectiveLastSeen   // strict >, in beide paden
  && photo.ownerId != currentUserId  // join met photos voor ownerId
```

Filter op `photo.ownerId` (niet `albumPhoto.addedBy`): als Bob een foto van Alice in een album zet, hoort Alice 'm niet als nieuw te zien — zij heeft die foto immers zelf gemaakt. (Concreet: `albumPhoto.addedBy` is wie publiceerde, `photo.ownerId` is wie uploadde; die twee kunnen verschillen.)

**Strict > semantiek (in beide paden):**
- Een foto met `addedAt === effectiveLastSeen` is **niet** unread. Geldt zowel voor het lastSeen-pad (foto landt op exact dezelfde ms als de laatste markSeen) als voor het fallback-pad (foto landt op exact dezelfde ms als `album.createdAt` of `membership.joinedAt`).
- Geen `-1ms` truc of `>=` in de fallback om "binnen-ms" foto's alsnog mee te tellen. Een uniforme strict `>` houdt de query simpel en de semantiek tussen beide paden consistent.
- Sub-ms collision edge case: bij batch-create waarbij foto + album + join binnen dezelfde ms landen, tellen die batch-foto's niet als unread voor de nieuwe member. Acceptabel: in praktijk landen real-world uploads niet op de microseconde tegelijk met een member-join, en de "verloren" badge bij echte collision is een betere trade-off dan een asymmetrisch filter dat soms `>` en soms `>=` is.

**Ontwerpprincipes:**
- Geen denormalization, geen precomputed counter. Voorkomt write-amplification cascade bij elke upload (was probleem in oude AWS aanpak: 1 upload → N membership writes).
- Geen pre-create van `albumLastSeen` records bij member-join of album-create. Fallback in query regelt het.
- `max(album.createdAt, membership.joinedAt)` als fallback: foto's van vóór jouw lidmaatschap of vóór album-bestaan tellen niet als unread. Je kan niet bijhouden wat er was voor je toegang had.
- Counts worden live berekend via Convex range scan. Bij ~50-100 foto's per album triviaal.
- Group-overzicht is één live `useQuery` die albums + counts retourneert. Realtime badge-updates komen er gratis bij.
- "Markeer alles gelezen" op groep-niveau: één mutation die voor elk album in de groep `albumLastSeen` upsert met `now`. Escape hatch voor nieuwe members die niet handmatig elk album willen openen.

**Migratie van bestaande seenPics state:**

Oude AWS state heeft `seenPics` array per membership (per user × group), bevat photoIds van foto's die user heeft gezien. Deze state moeten we omzetten naar `albumLastSeen` records.

Algoritme (per membership):
1. Walk `seenPics` array, look up elk photoId in `albumPhotos` om (albumId, addedAt) te vinden — beperk tot albums in deze membership's groep
2. Group by albumId, take `max(addedAt)` per album
3. Voor elke (user, album) met seen photos: insert `albumLastSeen` record met die max addedAt
4. Geen seen photos in album → geen record (fallback regelt het: `max(album.createdAt, membership.joinedAt)`)

Lossy edge case: als user album-photo A (oudste addedAt) en C (nieuwste) zag maar B (midden) oversloeg, wordt B nu "seen" omdat C's addedAt de cutoff is. In de praktijk niet relevant: oude app-logica bumped seenPics chronologisch (zien van later impliceert zien van eerder), dus deze case komt niet voor.

### Photo flagging (inappropriate content)

Bestaande feature in oude AWS app: non-owner kan photo als ongepast flaggen. Photo wordt gemarkeerd voor delete in 14 dagen. Owner kan in beroep gaan, webmaster beslist. Approve = flag clear. Deny = delete in 7 dagen + email naar owner. Endpoints en frontend-screens (`Inappropriate.jsx`, `InappropriateAdmin.jsx`, `HelperFlaggedPhotoModal.jsx`, flag-optie in `PhotoMenu.jsx`) bestaan al.

**Schema (uitbreiding op `photos`):**
```ts
photos: {
  // ... bestaande velden
  flaggedAt?: number,            // wanneer geflagd (huidig schema heeft dit al)
  flaggedBy?: Id<"users">,       // wie flagde (huidig schema heeft dit al)
  flagReason?: string,           // optionele reden (huidig schema heeft dit al)
  flaggedDeleteDate?: number,    // ONTBREEKT NU: huidige countdown deadline
  flaggedAppealDate?: number,    // ONTBREEKT NU: wanneer owner appeleerde
  flaggedAppealDenyDate?: number,// ONTBREEKT NU: wanneer webmaster appeal afwees
}
// indexes:
// by_flagged (op flaggedAt) — voor admin queue, bestaat al
// by_flagged_delete (op flaggedDeleteDate) — nodig voor auto-delete cron
```

**Mutations:**
- `flag(photoId, reason?)` — non-owner, idempotent. Sets `flaggedAt`, `flaggedBy`, `flaggedDeleteDate = now + 14d`
- `appeal(photoId)` — owner only, idempotent. Sets `flaggedAppealDate`, clears `flaggedDeleteDate` (pause countdown)
- `decideFlag(photoId, approve: boolean)` — webmaster only. Approve = clear alle flag fields. Deny = sets `flaggedAppealDenyDate`, `flaggedDeleteDate = now + 7d`, queue email action naar owner

**Queries:**
- `listMyFlagged()` — current user's eigen photos die geflagd zijn (voor `Inappropriate.jsx`)
- `listAllFlagged()` — webmaster only, scan `by_flagged` index (voor `InappropriateAdmin.jsx`)

**TODO voor Fase 4A2 (client-integratie + dev-deployment validatie):** in `convex-test` blijkt index `by_flagged` óók records te returnen met `flaggedAt = undefined` — niet sparse-strict. B's implementatie heeft daarom een JS-filter na `.collect()` toegevoegd voor zowel `listMyFlagged` als `listAllFlagged`. Verifieer tegen de echte Convex dev deployment of de index daar wél sparse is. Zo ja: filter weghalen (cleanup-PR). Zo nee: filter laten staan en accepteren.

**Scheduled cron (daily):**
Vind photos waar `flaggedDeleteDate < now` (en niet onder appeal), auto-delete via `internalRemovePhoto`. Was niet expliciet in oude AWS code (mogelijk handmatig opgeruimd of bug). Convex cron lost dit definitief op.

**Authorization:**
- `flag`: elke authenticated user behalve owner
- `appeal`: alleen owner van de photo
- `decideFlag` / `listAllFlagged`: webmaster only — via `requireWebmaster(ctx)` helper (env-var based, zie sectie Webmaster-rol)

**Boundary-semantiek (audit-9 §3):**
FL1-cleanup gebruikt `flaggedDeleteDate <= now` — een photo waar de countdown precies aan grenst wordt diezelfde cron-run nog opgeruimd, niet de volgende dag. Consistent met Email-normalisatie invariant + Invites `expiresAt <= now is verlopen`. Strict `<` was bias-gevoelig (cron vuurt op vaste klok, photo bleef 24h extra hangen).

**Re-decision semantiek (audit-9 §2):**
- `decideFlag(approve)` na deny: webmaster mág eigen deny overrulen — alle flag-velden worden alsnog gewist. Bewust permissief voor menselijke fout-correctie. Approve-pad checkt alleen op `flaggedAppealDate !== undefined`, dat blijft gezet ook na deny.
- `decideFlag(deny)` na deny: idempotent — geen re-email, geen reset van de 7d countdown, `flaggedAppealDenyDate` ongewijzigd. Voorkomt dat accidental dubbel-click owner een tweede mail bezorgt of de countdown effectief verlengt naar 14d.

**Owner-self-delete (audit-9 §8.4):**
Owner kan eigen geflagde photo altijd verwijderen via `photos.remove`. Cascade ruimt flag-state automatisch mee op (flag-velden zitten op de photo, geen aparte tabel) + index-entries verdwijnen. FL1-cron na deletion is no-op. Acceptable bypass — flag-doel = content removal, owner doet 't dan zelf.

**Migratie:**
Bestaande flag-state op DynamoDB photo records 1:1 overzetten — velden hebben identieke semantiek. Geen aparte stap nodig naast de standaard photo-import.

**Cascade-vraag bij user delete:**
Als flagger (non-owner) verwijderd wordt, wijst `flaggedBy` naar niet-bestaande user. Drie opties: (a) clear alleen `flaggedBy`, flag blijft actief — content-inappropriateness staat los van flagger-bestaan, (b) clear hele flag — als melder weg is, vervalt de melding, (c) accepteer orphan ref. Default in cascade matrix: optie (a). Heroverwegen indien nodig.

### Photo rotation (server-side fix)

Bestaande feature in oude AWS app (`fixPhotoRotation.js` met Jimp): users kunnen een geüploade foto roteren of flippen na de fact. Resulteert in een nieuwe S3-object met geüpdatete metadata. Endpoint zit in `clubalmanac-app/screens/PhotoEdit.jsx` via `useRotatePhoto` hook.

Reden om server-side te roteren ipv alleen client-side CSS-transform: foto wordt door anderen bekeken, op verschillende clients (iOS, web). Server-side fix garandeert consistente weergave.

**Mutation: `photos.rotate(photoId, { rotation, flipY })`**

Authorization: **owner van photo OF group-admin** waar de foto in een album zit. Reden: bij 16 users en hechte community lossen group-admins het sneller op dan dat ze de uploader achterna moeten. Webmaster heeft geen aparte rechten hierop nodig (dekking via group-admin ruim genoeg).

```ts
// pseudo
export const rotate = mutation({
  args: { photoId: v.id("photos"), rotation: v.number(), flipY: v.boolean() },
  handler: async (ctx, args) => {
    const photo = await ctx.db.get(args.photoId);
    const userId = await getCurrentUserId(ctx);
    const isOwner = photo.ownerId === userId;
    const isGroupAdmin = await checkGroupAdminForPhoto(ctx, args.photoId, userId);
    if (!isOwner && !isGroupAdmin) throw new Error("Not authorized");

    // Schedule action: read file from storage, rotate via sharp/jimp, write new storageId
    await ctx.scheduler.runAfter(0, internal.photos.processRotation, {
      photoId: args.photoId, rotation: args.rotation, flipY: args.flipY
    });
  }
});
```

De action zelf gebruikt `sharp` (Node-runtime in Convex actions) om het bestand te bewerken, schrijft naar nieuw storage-object, patcht photo record met nieuwe `storageId`, verwijdert oude file via `cleanupStorage` action.

**EXIF Orientation als upstream fix:**
Veel rotation-issues zijn eigenlijk al opgelost in de EXIF metadata maar worden door de client genegeerd. Update `extractPhotoMetadata` action (S3 trigger equivalent in Convex): parse ook EXIF `Orientation` tag (1-8) en sla op in `photos.exifOrientation`. Client gebruikt die voor initiële display via CSS-transform — voorkomt veel "scheve foto's" zonder server-side rotate-call.

`photos.rotate` mutation blijft beschikbaar als handmatige fix wanneer EXIF Orientation niet klopt of user de foto sowieso anders wil oriënteren.

**EXIF/geocoding hardening (cyclus 2, audit-10):**

De cyclus 1 implementatie van `extractMetadata` had vier productie-issues die in cyclus 2 expliciet worden gefixt:

1. **`takenAt` fallback (audit-10 §1, fixed in cyclus 2):** voorheen alleen `DateTimeOriginal`. iOS schrijft die wel, maar diverse Android-toestellen + sommige bewerkers laten 'm leeg en hebben alleen `CreateDate`. Resultaat: ~30% van de geüploade foto's had geen `takenAt`. Fix: `takenAt = (DateTimeOriginal ?? CreateDate) * 1000`. Geen verdere fallback naar `createdAt` (upload-tijd ≠ photo-tijd).

2. **`locationLabel` multi-deel format (audit-10 §2, fixed in cyclus 2):** voorheen single-field (`street` óf `adminArea5`). Map-tooltips werden daardoor "Damrak" zonder stad/land context. Fix: format = `${street ?? name}, ${city}, ${country}`, waarbij lege/missende velden uit de Photon-response uitgefilterd worden vóór de join met `, `. `street ?? name` als fallback omdat OSM-data soms `name` (POI: museum, kerk, gebouw) levert waar `street` ontbreekt — voor Clubalmanac context (foto's bij bezienswaardigheden) is `name` waardevolle context. Voorbeelden (met `lang=en`): "Damrak, Amsterdam, Netherlands" (street + city + country), "Rijksmuseum, Amsterdam, Netherlands" (POI fallback), "Amsterdam, Netherlands" (geen street/name), "Netherlands" (alleen country).

3. **Granulaire try/catch + logging (audit-10 §3, fixed in cyclus 2):** cyclus 1 had één lege `catch {}` rond exif-parser + geocoding samen — alle fouten werden stilletjes weggeslikt zonder spoor in logs. Fix: aparte catch-blocks rond (a) `import("exif-parser")`, (b) `parser.parse()`, (c) `reverseGeocode` fetch. Elke catch logt via `console.error` met context (photoId, error type) zodat productie-issues opspoorbaar zijn. Action-shape blijft graceful: nog steeds geen rethrow, photo blijft op defaults.

4. **HEIC graceful no-op (audit-10 §5, known issue tot fase 4):** iPhone uploads arriveren als `image/heic` — exif-parser is JPEG-only en faalt op de container. Cyclus 1 trapte dat als generieke parse-error af zonder onderscheid. Fix: detect `mimeType === "image/heic"` (of magic-bytes `ftypheic/ftypheix`) vóór de exif-parser, log "unsupported format" en skip. Photo blijft in DB zonder EXIF metadata. Limitatie: client-side HEIC → JPEG conversion (via `expo-image-manipulator` of vergelijkbaar) komt in fase 4 client-werkpakket. Tot dan: HEIC-uploads zonder takenAt/GPS/orientation, maar wel zonder errors.

**Geocoding-provider: MapQuest → Photon (cyclus 2):**

Cyclus 1 gebruikte MapQuest met `MAPQUEST_KEY` env-var. Cyclus 2 vervangt dat door **Photon (Komoot)**:

- Endpoint: `https://photon.komoot.io/reverse?lat=<lat>&lon=<lon>&lang=en`
- Header: `User-Agent: Clubalmanac/2.0` (fair-use vereiste van Photon)
- `lang=en`: voor internationale leesbaarheid. Reizen naar landen met eigen schrift (Georgië → Georgisch, Nepal → Devanagari) krijgen Latijnse labels ipv onleesbare native script. NL-photos: minor cosmetisch verschil (`country: "Netherlands"` ipv `"Nederland"`, street/city-namen blijven gelijk). Photon ondersteunt `default, de, en, fr` — geen `nl`.
- Geen API key — publieke instance, OSM-data, EU-gebaseerd (Berlijn)
- Response: GeoJSON FeatureCollection. Properties bevatten `street`, `city`, `country`, `state`, `postcode` (alle optioneel). Lege uitkomst: `features: []`.
- Volume: ruim binnen Photon fair-use voor 16 users (~hooguit honderden geocodes/maand). Bij groei: zelf-hosten van Photon-instance is een paar uur werk.
- Graceful degradation: 5xx, network error, of lege features → `locationLabel` undefined, geen throw

Voordeel boven MapQuest: één env-var minder (geen secret-management coupling tussen dev/prod), EU data-residency expliciet, en de `${street}, ${city}, ${country}` velden zijn 1:1 in de response zonder de MapQuest `adminArea*`-puzzel.

**Integration test (WP1, landed):** `tests/integration/photon/reverseGeocode.test.ts` pint Photon-contract tegen de live API — Amsterdam-coord (response-shape + `lang=en` levert "Netherlands"), Kathmandu A/B (zonder/met `lang=en` om causaliteit van het Latijns-schrift-effect te bewijzen), en Rijksmuseum-POI (street undefined → fallback op `name` in productie-code). Niet in CI — `npm run test:integration` lokaal. Architectuur en planning voor WP2-4 (Convex deployment, Clerk JWT, Mailjet) staan in [`docs/conventions/integration-tests.md`](./conventions/integration-tests.md).

### WP2 — Convex storage roundtrip (ingeland)

Pin't dat bytes via `ctx.storage.store` identiek terugkomen via
`ctx.storage.getUrl` + fetch, **inclusief Blob.type → response
`Content-Type`**. Productie-blind-spot: onze unit-suite gebruikt
`convex-test` als in-memory mock, dat kan divergeren van échte Convex
storage SDK-gedrag voor byte-identiteit en content-type-metadata.

Signed-URL TTL is bewust **buiten scope**: niet automatiseerbaar binnen
redelijk timeframe (vereist tijd-mocking of >TTL wachten). Acceptabel
risico voor 16-user app — TTL-defect zou alleen latency van expirerende
URL's tonen, niet data-corruptie.

**Architectuur-keuze.** Storage-roundtrip is auth-vrij ontkoppeld van de
bestaande `/upload` httpAction (die is Clerk-coupled — wacht op WP3). Daarvoor
staat in `convex/_test.ts` een set test-only Convex functions: public
action/query/mutation (geen `internal.*`), elk env-var-gated op
`process.env.INTEGRATION_TEST_ENABLED === "true"`. Wouter zet die env-var
alleen op de dev-deployment via Convex dashboard; prod krijgt 'm nooit.
Self-protection redundant naast de prod-URL-blocklist in
`tests/integration/_helpers/safety.ts`. Conventie staat in
[`docs/conventions/integration-tests.md`](./conventions/integration-tests.md).

**Env-loading.** WP2 brengt het eerste env-var (`CONVEX_URL`) in de
integration-suite. Keuze: `dotenv` als devDep + setup-file
(`tests/integration/_helpers/setup.ts`) geregistreerd via `setupFiles` in
`vitest.integration.config.ts`. Argument: standaard tooling (zero learning
curve), file-aanwezigheid is optioneel (WP1 blijft werken zonder env-vars),
en de file-naam (`.env.integration`) zit al in `.gitignore`. Alternatieven
overwogen: Node `--env-file=` (vereist script-aanpassing + minder bekend) en
Vite's `loadEnv` (vergt expliciete config voor non-default file-namen).

**Functies in `convex/_test.ts`** (commit `22f1acc`, post-A-fix in
`8264399` voor pseudo-code-strip + content-type-arg):

```ts
export const storageUpload = action({
  args: { bytes: v.bytes(), contentType: v.optional(v.string()) },
  returns: v.object({ storageId: v.id("_storage") }),
});

export const storageDownloadUrl = query({
  args: { storageId: v.id("_storage") },
  returns: v.union(v.null(), v.string()),
});

export const storageDelete = mutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
});
```

`storageUpload` is een **action** (niet mutation) omdat `ctx.storage.store`
alleen in actions/httpActions beschikbaar is. `storageDownloadUrl` is een
**query** (`getUrl` is read-only). `storageDelete` is een **mutation**
(write-side, zonder `store` of `get`).

`contentType` is **optioneel** zodat de bestaande byte-identiteit-tests
zonder content-type kunnen blijven uploaden. Wanneer `contentType` wel
meegegeven wordt, moet het stored object zijn content-type op storage-side
behouden zodat `storageDownloadUrl` + fetch een matchende `Content-Type`
response-header levert. Productie-pad in `convex/http.ts:142-144` doet
het equivalent door content-type uit de request-headers door te geven
aan `ctx.storage.store`; de test-pin valideert dezelfde productie-aanname
op het content-type-pad. Hoe B dat technisch realiseert is implementatie-
keuze.

Tests in `tests/integration/convex/storage.test.ts` gebruiken
`makeFunctionReference<"action"|"query"|"mutation">("_test:<fn>")` voor de
function-references — niet de gegenereerde `api`. Dat houdt de test-types
onafhankelijk van eventuele drift in `convex/_test.ts` en sluit alleen aan
op de spec hierboven.

### WP4 — Cron registration + Clerk JWT roundtrip

Twee deliverable-tracks in één commit:

**Track 1 — Cron registration unit-test (default suite).** Audit-13 fix-cyclus
toonde dat een productie-cron simpelweg ontbreken een silent-fail-modus is —
`npm test` blijft groen, runtime weet niet beter, pas op deploy of in
productie merk je dat een job nooit liep. `tests/crons/registration.test.ts`
pin't statisch (geen Convex runtime, geen netwerk) dat FL1
(`cleanup flagged photos`, daily 03:00 UTC → `internal.photos.cleanupFlaggedPhotos`)
en UI1 (`cleanup old upload idempotency`, daily 03:30 UTC →
`internal.uploads.cleanupOld`) geregistreerd zijn met juiste schedule en
function-reference. Plus een full-set assertie tegen onbedoelde extra
registraties.

**Track 2 — Clerk JWT roundtrip (integration suite).** Pin't de
productie-blind-spot uit r.251 / `convex/lib/auth.ts` header-comment: de
unit-suite simuleert `email` via `t.withIdentity({ email })` en weet
daardoor niets over of de Clerk JWT-template `convex` daadwerkelijk de
`email`-claim doorlevert. WP4 mint via `@clerk/backend` een **echte**
session-JWT voor een test-user en stuurt 'm naar een test-only
`whoami` httpAction op Convex dev. `whoami` reflecteert `subject`,
`email` en een `webmaster: boolean` (via try/catch op `requireWebmaster`)
zodat zowel de Clerk-side claim-aanwezigheid als de Convex-side
webmaster-detection gepind worden tegen het echte JWT-traject.

**Architectuur — `whoami` httpAction (B's spec).** Hetzelfde patroon als
WP2's `convex/_test.ts`: env-var-gated test-only code, prod krijgt 'm nooit.

- **Locatie:** `convex/http.ts`. Geen apart bestand zoals `convex/_test.ts`,
  omdat `httpRouter()` per Convex deployment één export heeft en
  registratie inline aan de router gebeurt — apart bestand zou een tweede
  router introduceren.
- **Pad:** `/_test/whoami`. Underscore-prefix consistent met `convex/_test.ts`
  als signaal "test-only", `_test`-segment in pad voorkomt collision met
  productie-routes (`/upload`, `/email-event`).
- **Method:** `GET`. Read-only reflectie van identity; geen body nodig.
- **Auth:** Convex valideert het Bearer JWT vóór de handler draait
  (standaard mechanisme, geen extra werk). Geen identity → handler ziet
  `getUserIdentity()` als `null` en moet dan 401 returnen. Ongeldige JWT
  laat Convex zelf afkeuren met 401 voordat de handler triggert (gepind
  in test 4 — als die assumptie niet klopt, valt 't op tijdens RED→GREEN
  van B).
- **Env-var-gate:** zelfde `INTEGRATION_TEST_ENABLED === "true"` check als
  `convex/_test.ts`. Bij ontbrekende of false env-var: handler returnt
  een duidelijke melding met een 4xx-status (B kiest tussen 403 of 503 —
  beide signaleren "endpoint bestaat maar is uitgeschakeld op deze
  deployment"). Productie-protection rationale: endpoint exposeert alleen
  identity van de aanvrager zelf (geen escalatie), maar gate consistent
  met WP2 zodat "test-only" één regel blijft, niet twee.
- **Response shape (200, JSON):** subset van `ctx.auth.getUserIdentity()`
  uitgebreid met webmaster-flag.
  ```ts
  type WhoamiResponse = {
    subject: string;
    email: string | null;
    issuer: string;
    webmaster: boolean;
  };
  ```
  `webmaster` wordt afgeleid via try/catch op `requireWebmaster(ctx)` —
  success → `true`, throw → `false`. B kiest of die helper-call binnen
  de httpAction zelf staat of via een `ctx.runQuery(internal.…)`-hop;
  beide werken, geen voorkeur uit deze spec.
- **Foutpaden:**
  - 401 — geen Bearer header / geen geldige identity (`getUserIdentity()` is null).
  - 4xx — env-var-gate gefaald (B kiest exact code, zie boven).

A's tests (`tests/integration/clerk/jwtRoundtrip.test.ts`) doen directe
`fetch()` naar `<deployment>.convex.site/_test/whoami` met een
`Authorization: Bearer <jwt>` header — geen function-reference nodig.

**Token-mint via `@clerk/backend`.** Helper in
`tests/integration/_helpers/clerkAuth.ts` maakt eenmalig een
`createClerkClient({ secretKey })` cliënt en mint per test:
`users.getUserList({ emailAddress: [email] })` → `sessions.createSession({ userId })`
→ `sessions.getToken(sessionId, "convex")`. Email-based lookup omdat dat
leesbaarder is dan losse user-IDs in env-vars. Helper weigert elk secret
zonder `sk_test_` prefix — eerste laag tegen prod-mint, naast de
prod-URL-blocklist in `_helpers/safety.ts`.

**Wat Wouter doet vóór B's sessie + voor de eerste lokale run:**
1. Clerk dev dashboard: maak twee test-users met emails
   `clubalmanac-integration-regular@example.com` en
   `clubalmanac-integration-webmaster@example.com`.
2. Convex dev-deployment env-vars: `WEBMASTER_EMAILS` bevat de
   webmaster-test-user-email. `INTEGRATION_TEST_ENABLED=true` is al
   gezet voor WP2.
3. Voor beide test-users: zorg dat ze ook een `users`-record in Convex
   hebben (audit-7 §3 dubbele gate). Eenvoudigste pad: log één keer in
   via de app of voer de `users.register`-mutation handmatig uit op dev.
4. `.env.integration` lokaal aanvullen met `CLERK_SECRET_KEY`,
   `CLERK_TEST_USER_REGULAR_EMAIL`, `CLERK_TEST_USER_WEBMASTER_EMAIL`.

### User visit tracking (`users.lastVisitAt`)

Oude AWS app had `UV` records in DynamoDB voor visit-tracking. Doel onbekend (geen rapportage of analytics actief). Behouden in nieuwe schema voor toekomstige use cases (active users count, "wie heeft 'm al gezien"-feature).

**Capture-mechanisme:** expliciete mutation `users.recordVisit()` aangeroepen door client bij `AppState` transitie naar `active` (foreground). Niet als side-effect van `users.getMe` query (queries moeten puur blijven, en lastVisitAt-update zou query-cache invalideren).

```ts
// client (App.tsx of vergelijkbaar)
useEffect(() => {
  const sub = AppState.addEventListener("change", state => {
    if (state === "active") recordVisit();
  });
  return () => sub.remove();
}, []);

// convex/users.ts
export const recordVisit = mutation({
  handler: async (ctx) => {
    const userId = await getCurrentUserId(ctx);
    await ctx.db.patch(userId, { lastVisitAt: Date.now() });
  }
});
```

Throttle aan client-zijde: niet vaker dan 1x per minuut, ook al transitioneert AppState meerdere keren snel achter elkaar.

### Email infrastructure (Mailjet + Clerk)

**Provider keuze:** Mailjet (Frankrijk, EU-datacenters, GDPR-compliant). Free tier: 6.000/maand, 200/dag — ruim voor jouw volume. Vervangt SES voor alle applicatie-emails.

**Splitsing oude → nieuwe verantwoordelijkheid:**

| Email type | Oude flow (SES) | Nieuwe flow |
|---|---|---|
| Signup verify, forgot-pw, temp-pw, email-change | Cognito CustomMessage triggers (NL templates in `blob-images-api/handlersCognito/sync.js`) | **Clerk handles** (eigen email infrastructuur, NL templates in Clerk dashboard configureren) |
| Group invite | `blob-images-api-groups/emails/invite.js` | Convex action via Mailjet |
| Invite accepted | `blob-images-api-invites/emails/acceptedInvite.js` | Convex action via Mailjet |
| Invite declined | `blob-images-api-invites/emails/declinedInvite.js` | Convex action via Mailjet |
| Member leave | `blob-images-api-groups/emails/leave.js` | Convex action via Mailjet |
| Member ban | `blob-images-api-groups/emails/ban.js` | Convex action via Mailjet |
| Member update notification | `blob-images-api-groups/emails/memberUpdate.js` | Convex action via Mailjet (optional) |
| Invite uninvited | `blob-images-api-groups/emails/uninvite.js` | Convex action via Mailjet (optional) |
| Flag-decide deny notification | `blob-images-api-photos` (binnen `flagPhotoDecide.js`) | Convex action via Mailjet, queue't in `decideFlag` mutation |
| Problem report | `blob-images-features/handlersProblem/create.js` | Convex action via Mailjet, target = webmaster email |
| Bounce handling | SES → S3 → `blob-images-api-email/handlersMail/incoming.js` | Mailjet webhook → Convex HTTP endpoint → `invites.markBounced` action |

**Domein-setup op clubalmanac.com:**

| From-address | Doel | Forwarding naar |
|---|---|---|
| `info@` | Generieke app-notificaties (member changes, flag decisions) | wintvelt@me.com |
| `invites@` | Specifiek invite-mails (verbetert deliverability + herkenning) | wintvelt@me.com |
| `dpo@` | Genoemd in privacy policy voor AVG-verzoeken | wintvelt@me.com |

Geen actieve mailboxen. Alle inkomende mail (replies, bounces niet via webhook, AVG-verzoeken) forwarden naar wintvelt@me.com.

**DNS-migratie (geen downtime):**

1. Mailjet aanmaken met clubalmanac.com als sending domain. Verifieer DKIM (Mailjet geeft selector-record) — co-existeert met bestaande SES DKIM.
2. SPF: huidige record uitbreiden met `include:spf.mailjet.com` naast bestaande `include:amazonses.com`.
3. DMARC: tijdens overgang `p=quarantine` of `p=none` aanhouden. Na cutover en validatie weer naar `p=reject`.
4. MX (forwarding) niet aanraken — sending en receiving zijn onafhankelijk.
5. Na succesvolle cutover (paar weken): SES DKIM-record + SES SPF-include prunen.

**Mailjet webhook setup:**

Convex HTTP endpoint op `convex/http.ts`:

```ts
http.route({
  path: "/email-event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const events = await request.json();
    for (const event of events) {
      if (event.event === "bounce" || event.event === "blocked") {
        await ctx.runAction(internal.invites.markBounced, {
          email: event.email, reason: event.error_related_to,
        });
      }
    }
    return new Response(null, { status: 200 });
  }),
});
```

URL `https://<deployment>.convex.site/email-event` configureren in Mailjet event-dashboard. Authenticatie via shared secret in header (Mailjet ondersteunt signed payloads).

**NL template-content migratie:**
Alle NL teksten 1:1 overnemen uit oude SES templates. Tone-of-voice consistent houden. Templates inline in Convex actions (geen aparte template-engine nodig bij dit volume).

**Cognito-mails (Clerk-zijde):**
Clerk free tier verstuurt vanaf `accounts.clerk.dev`. Custom email domain is paid feature, niet de moeite voor 16 initiële signups + sporadische password resets. Acceptabel dat users tijdens cutover een mail van `accounts.clerk.dev` krijgen — communicatie hierover via cutover-mailing op clubalmanac.com kanaal.

**Beslispunten/risico's:**
- Mailjet domein-validatie kan paar uur duren — initiate vroeg in fase 2
- Reputation warmup: domein heeft historie via SES, Mailjet bouwt parallel op. Bij ~paar honderd mails/maand naar 16 known users: verwaarloosbaar risico op spamfilters
- AVG: in privacy policy noemen "Mailjet (Sinch, FR/SE) als email-verwerker". Mailjet biedt DPA standaard
- Lock-in laag: switchen naar Scaleway TEM of andere provider = paar uur werk + DNS-update

## Environments

Twee environments, geen aparte staging bij 16 users.

| | Convex deployment | Clerk instance | Doel |
|--|---|---|--|
| **Dev** | `glorious-pheasant-759` (eu-west-1) | `picked-quail-97.clerk.accounts.dev` | development, testing, geseede subset van prod data (3 chosen users) |
| **Prod** | apart aanmaken in fase 5 | apart activeren in fase 5 | de 16 users na cutover, volledige data |

**Koppeling per env:** elke Convex deployment heeft een `CLERK_FRONTEND_API_URL` env var die naar de matching Clerk instance wijst. Verwisselen = kapot. Dev Convex praat alleen met dev Clerk, prod met prod.

**Convex deployment env-vars (server-side, per Convex environment):**

| Env-var | Waar gebruikt | Verplicht? | Fail-mode bij missend |
|---|---|---|---|
| `CLERK_FRONTEND_API_URL` | `convex/auth.config.ts` — JWT issuer match | Ja | Auth gebroken, alle gated mutations falen |
| `WEBMASTER_EMAILS` | `convex/lib/auth.ts` — RBAC | Ja (prod) | Webmaster-only mutations weigeren iedereen |
| _(geen geocoding env-var)_ | `convex/photos.ts` reverseGeocode (cyclus 2: Photon) | n.v.t. | Photon (Komoot, EU/Berlijn, OSM-data) heeft geen API key — fair-use publieke instance op `photon.komoot.io`. Bij downtime: `locationLabel` blijft undefined, extractMetadata throwt niet (zie EXIF-sectie). Cyclus 2 vervangt MapQuest om de **MAPQUEST_KEY**-secret-coupling weg te halen (audit-10 fix #1: geen geheime key meer nodig om geocoding te valideren tussen dev/prod) |
| `MAILJET_API_KEY` + `MAILJET_API_SECRET` | (toekomst) email-werkpakket | Nee (in cyclus 1) | Bounce-webhook + outgoing emails geen-op tot landing van email-werkpakket |
| `MAILJET_WEBHOOK_SECRET` | (toekomst) `convex/http.ts` `/email-event` HMAC-validatie | Nee (in cyclus 1) | TODO in `convex/http.ts` — endpoint accepteert nu elk POST request, **niet uitrollen naar prod zonder secret-check** |

**Client-side env-switch** via EAS build profiles:
- Dev build → `EXPO_PUBLIC_CONVEX_URL=<dev>`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...`
- Prod build → `EXPO_PUBLIC_CONVEX_URL=<prod>`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...`

**Risico's en mitigaties:**
- *Dev build per ongeluk naar prod Convex:* EAS profile expliciet, géén default URL
- *`pk_test_` in prod release:* build-time check in CI die `pk_test_` weigert in prod profile
- *Schema drift dev↔prod:* `npx convex deploy --prod` standaard in release-script

Prod activatie pas in fase 5 (cutover prep), niet eerder. Tot dan is prod deployment leeg en niet aangesloten op een client.

## Dev seed strategie

Dev gebruikt een subset van prod data: 3 chosen users met hun content. Overige 13 users en hun data worden uitgesloten. Reden: kleinere footprint (lagere storage kosten, snellere refresh), genoeg voor feature-testing.

**3 users selectiecriteria:**
1. Admin/oprichter van een groep met meerdere members (test admin flows)
2. Regular member in 2+ groepen (test multi-group navigatie)
3. Member met veel content: foto's, ratings, locaties (test scaling van photo grid en map)

Vaak overlapt dit; 3 unieke users is genoeg.

**Filter-regels in seed-script:**

| Entiteit | Inclusie-regel |
|---|---|
| Users | alleen de 3 chosen |
| Groups | alleen waar minstens 1 chosen user member is |
| Memberships | alleen tussen de 3 chosen in die groepen |
| Photos | alleen geüpload door de 3 chosen |
| Albums | in groepen waar de 3 in zitten |
| AlbumPhotos | alleen voor photos van de 3 |
| Ratings | rater én photo-owner beide in de 3 chosen |
| Invites | alleen tussen de 3 chosen |
| Features / upvotes | alleen door de 3 chosen |

**ID mapping:** Cognito sub van de 3 chosen → Clerk dev user IDs (1:1, configureerbaar in script config). Clerk dev users vooraf aanmaken via Clerk API.

**Anonimiseren:** namen → "Dev Wouter / Anna / Bram" (herkenbaar tijdens testing). Emails → `dev-{n}@clubalmanac.test`. Foto's blijven echt voor visuele realiteit; dev DB nooit publiek delen.

**Idempotentie:** script moet droppen + reseeden in 5 min, voor snelle schema-iteraties tijdens fase 4A2.

**Member-list edge cases:** 3 members per groep is realistisch genoeg voor de meeste UI-testen. Als bij testen blijkt dat large-group rendering issues geven, synthetic dummy users toevoegen in dev.

## Kosten: Convex Starter EU

EU (Dublin) beschikbaar op alle plans. Free plan included resources gelden alleen voor US, dus in EU betaal je vanaf eerste gebruik. Starter plan (pay-as-you-go) is de beste optie. Tarieven inclusief 30% EU surcharge:

| Kostenpost | Jouw gebruik | EU tarief | Kosten/maand |
|------------|-------------|-----------|-------------|
| Function calls | ~50K/maand | $2.86/M | $0.14 |
| Action compute | ~0.1 GB-hr | $0.43/GB-hr | $0.04 |
| DB storage | ~10 MB | $0.29/GB/mo | $0.00 |
| DB bandwidth | ~200 MB | $0.29/GB | $0.06 |
| File storage | 8.3 GB | $0.04/GB/mo | $0.32 |
| File bandwidth | 5-20 GB | $0.43/GB | $2.15 - $8.58 |
| **Totaal** | | | **$2.71 - $9.15** |

File bandwidth is de dominante kostenpost. Vergelijkbaar met of goedkoper dan huidige $10/maand AWS.

**Met R2 component:** file storage en bandwidth vallen binnen R2 free tier (10 GB storage, 10M reads, nul egress). Convex kosten dalen naar ~$0.24/maand (alleen DB + function calls). R2 kost $0. Totaal: **~$0.24/maand.**

## Teststrategie

### 1. Unit tests op Convex functions
`convex-test` library met Vitest. Test queries en mutations in isolatie, elke test krijgt een schone database. Test-driven werken: schrijf eerst de test op basis van verwacht gedrag van de oude API, bouw dan de Convex function.

Voorbeelden: `createPhoto` maakt record aan met juiste EXIF data. `deleteGroup` cascade-delete albums en memberships. Rating update herberekent aggregate op photo.

#### Cascade dekking — matrix-aanpak

Het oude AWS systeem had 28 cascade handlers in `mainStream.js`. Een deel daarvan vervalt in Convex (denormalisatie naar joins), de rest moet expliciet getest worden. Om geen rule te missen: alle cascades zijn geïnventariseerd in [`docs/cascade-matrix.md`](./cascade-matrix.md) als levend audit-document.

Vier categorieën:
1. **Eliminated (join on read):** geen cascade meer, query joint live. Test verifieert dat join fresh data returnt na update
2. **Transactional aggregate:** aggregate veld (`photoCount`, `ratingAverage`) atomisch herrekend in zelfde mutation. Test verifieert correctheid + integrity-check zou drift flaggen
3. **Cascade delete:** parent delete-mutation deletet children inline. Test verifieert zero orphans
4. **Reactive query coverage:** verifieert dat subscribed views correct updaten — proxy voor UI rerender. Werkt alleen als cat-1 join correct is

**Test-locatie regel:** tests leven bij de trigger-mutation, niet bij de affected query. Bij refactor van trigger zie je in `tests/{entity}/` wat kapot gaat. Cross-entity assertions worden binnen die test gedaan (test setup creëert beide entities).

**Acceptance per domain:** alle matrix-rows met dat entity als trigger zijn naar een groene test gemapt. Niet "alle CRUD bedacht". Status per row in matrix doc, Claude Code werkt 'm bij na elke commit.

**Integrity check als test-helper:** de scheduled monitoring function uit §3 is herbruikbaar als `afterEach` in tests die complexe mutaties draaien. Vangt cascade-failures op die specifieke asserts missen.

### 2. Data migratie validatie
Na import: script dat Convex data vergelijkt met DynamoDB export. Counts per table, steekproeven, referentiële integriteit (alle foreign keys wijzen naar bestaande records, alle storage IDs zijn geldig).

### 3. Data integriteit monitoring (ongoing)
Scheduled Convex function (dagelijks/wekelijks) die denormalized data valideert:
- Alle albumPhotos verwijzen naar bestaande photos
- Alle memberships verwijzen naar bestaande users en groups
- Photo counts per user kloppen met werkelijke records
- Alle file storage IDs in photo records zijn geldig
- Bij inconsistentie: alert email

### 4. App-level testen
Handmatig per feature in Expo dev build. Bij 16 users pragmatisch genoeg, geen apart beta-programma nodig.

## Migratieplan in fasen

### Fase 1: Project setup ✅ AFGEROND

- [x] Nieuw repo opzetten met TypeScript — [github.com/wintvelt/clubalmanac-v2](https://github.com/wintvelt/clubalmanac-v2) (public)
- [x] Convex project aanmaken op **Starter plan, EU region (Dublin)** — deployment `glorious-pheasant-759`, region bevestigd als `eu-west-1` via deployment URL
- [x] Vitest + `convex-test` configureren — [`vitest.config.ts`](../vitest.config.ts) met `edge-runtime` environment, 6 smoke tests groen lokaal en in CI
- [x] Convex schema ontwerpen (`schema.ts`): alle tables en indexes — **10 tables** in [`convex/schema.ts`](../convex/schema.ts): `users`, `groups`, `memberships`, `albums`, `albumPhotos`, `photos`, `ratings`, `invites`, `features`, `featureUpvotes`. Afwijking van plan: `featureUpvotes` apart (niet impliciet in `features`) om dubbele votes per user te voorkomen via composite index `by_feature_and_user`.
- [x] Clerk account opzetten — applicatie aangemaakt, JWT template "convex" geconfigureerd, issuer `https://picked-quail-97.clerk.accounts.dev` gewired in [`convex/auth.config.ts`](../convex/auth.config.ts). Sign-in opties: alleen Email (geen socials, kunnen later zonder code-impact). Clerk API keys (publishable/secret) pas in fase 4 nodig wanneer een client komt.

#### Smoke-test uitkomsten

- ✅ TypeScript compileert (`npm run typecheck`), lokaal én in CI
- ✅ Convex schema valideert (`npx convex dev --once` push zonder errors)
- ✅ EU region bevestigd: `eu-west-1` in URL `glorious-pheasant-759.eu-west-1.convex.cloud`
- ✅ `convex-test` werkt: write → read → delete via `ctx.db`, plus index lookup via `by_subject`
- ✅ Type-flow end-to-end: `api.smoke.ping` query met `v.object()` return validator, return type komt typed door tot in de test
- ⚠️ Clerk smoke test deels: `auth.config.ts` staat goed, `ctx.auth.getUserIdentity()` returnt `null` zonder token, `t.withIdentity()` impersonation in tests werkt. **Volledige JWT round-trip pas in fase 4** wanneer een client een echte Clerk token mint — auth-bedrading is bewezen, end-to-end JWT validatie vereist een client.
- ✅ CI baseline: GitHub Action draait `tsc` + `vitest` op elke push.

#### Afwijkingen van plan (toelichting)

**`convex/_generated/` wordt gecommit** in plaats van geregenereerd in CI. Reden: `npx convex codegen` heeft een deployment-call nodig die een dev-deploy-key niet honoreert in CI mode (vereist een project-level deploy key, overkill voor deze fase). Trade-off: bij schema-wijzigingen `npx convex dev --once` lokaal draaien en de `_generated` diff meecommitten. Switch naar full deploy-key flow kan in fase 5 wanneer er een echte CD-pipeline komt.

Acceptatiecriterium fase 1: alle smoke tests groen. ✅ Klaar voor fase 2.

### Fase 2: Convex backend bouwen + testen
De hele backend bouwen en testen, los van de app en los van de data. Tests draaien tegen een lege `convex-test` database.

Per domein: unit tests eerst, dan implementatie.

**Schema-uitgangspunt (vastgelegd in fase 1):** geen denormalisatie van user-data (naam, profielfoto) naar `memberships`/`photos`/etc. In Convex zijn joins binnen een query function lokale lookups (geen netwerk hops), dus we halen user-data on-read via `ctx.db.get(ownerId)`. Dit elimineert de hele klasse stream-handler bugs uit DynamoDB waar denormalized kopieën uit-sync konden raken — en daarmee ook de UB/UV split-truc om write-amplification te vermijden. De enige denormalized velden die we wel houden zijn aggregates die te duur zijn om bij elke read te recomputen: `users.photoCount`, `photos.ratingAverage` + `ratingCount`, `features.upvoteCount`. Die worden in mutations transactioneel onderhouden, en in fase 1's "data integriteit monitoring" (zie Teststrategie §3) periodiek gevalideerd tegen de werkelijkheid.

- [x] **Users:** mutations + queries voor CRUD, photo count limiet
- [x] **Groups:** create, update, delete, list, members
- [x] **Albums:** CRUD, album-photo relaties
- [x] **Photos:** CRUD met cascade logic (stream handler logica → transactionele mutations)
- [x] **Ratings:** create/update met aggregate berekening
- [x] **AlbumLastSeen:** upsert bij album-open, "markeer alles gelezen"-mutation op groep-niveau, query voor unread-count per album met fallback naar `max(album.createdAt, membership.joinedAt)`
- [x] **Invites:** create, accept, decline, invite-only signup validatie. Plus `remove` (sender of group-admin), bounce-handler `internal.invites.handleBounce` met dedup via `inviteBounceEvents` table (zie cascade matrix IB1). **Open:** (a) `convex/http.ts` webhook endpoint dat de Mailjet bounce-payload binnentrekt en `internal.invites.handleBounce` aanroept — `handleBounce` zelf staat al, het HTTP-route-deel volgt in het email-werkpakket; (b) scheduled cron (daily) die `invites` met `status="pending"` en `expiresAt < now` patcht naar `status="expired"` (cascade matrix IB2). Accept-mutation kan dat zelf niet doen want de status-patch wordt door de bijbehorende throw teruggedraaid (Convex transactionele rollback). Cron landt naast de flagging-cron uit de Flagging-bullet
- [x] **Features:** create + upvoting (open voor users), update + remove (webmaster only via `requireWebmaster`). Probleem-report action verstuurt email naar webmaster (zelfde env-var). Audit-7 §4 fixte hier de drift: code stond submitter-only, plan zei webmaster-only — tests in `tests/features/crud.test.ts` pinnen nu het webmaster-only gedrag.
- [x] **Flagging:** flag/appeal/decide mutations met owner+webmaster checks (via `requireWebmaster` helper in `convex/lib/auth.ts`), listMyFlagged + listAllFlagged queries, daily cron `cleanupFlaggedPhotos` (in `convex/crons.ts`) voor auto-delete na countdown, `internal.photos.sendFlagDecisionEmail` als stub (Mailjet komt in email-werkpakket). Schema uitgebreid met `flaggedDeleteDate`, `flaggedAppealDate`, `flaggedAppealDenyDate` + index `by_flagged_delete`. Cascade matrix FL1, FL2, U10 alle ✅. Afwijking van oude AWS: email alleen bij deny (niet bij approve), `listAllFlagged` throwt voor non-webmaster, appeal niet meer mogelijk na deny
- [ ] **File upload:** 1-step backend-mediated `POST /upload` httpAction (cyclus 1 architectuur rewrite — zie File Storage sectie), idempotency via `X-Upload-Id`/`uploadIdempotency` table, daily cron `cleanupOldUploadIdempotency` voor 7d-cleanup. **Cyclus 2 (audit-10 hardening)**: DateTimeOriginal ?? CreateDate fallback voor `takenAt`, locationLabel multi-deel format `${street}, ${city}, ${country}` (lege fields gefilterd), granulaire try/catch + console.error logging in extractMetadata (geen lege catch meer), HEIC graceful no-op met "unsupported format" log (client-side conversion komt in fase 4), MapQuest → **Photon** geocoding-switch (no API key). Tests in `tests/photos/extractMetadata.test.ts` (cyclus 2, mock-based exif-parser approach).
- [ ] **Photo rotation:** `photos.rotate` mutation (owner OR group-admin) + scheduled action met `sharp` voor server-side rewrite + cleanup oude storage
- [x] **Visit tracking:** `users.recordVisit` mutation, client throttled max 1x/min op AppState=active
- [ ] **Email:** Mailjet account + DNS setup (DKIM, SPF), Convex actions voor alle applicatie-emails (invite/leave/ban/etc), HTTP endpoint voor bounce-webhook, NL templates 1:1 porten van oude SES templates
- [ ] **Auth:** Clerk + Convex integratie + `requireWebmaster(ctx)` helper op basis van `WEBMASTER_EMAILS` env-var (zie sectie Webmaster-rol). Audit-7 fixes:
   - `features.update` + `features.remove` zijn webmaster-only via `requireWebmaster` (audit-7 §4 — was submitter-only drift)
   - `features.create` (open voor users) en `features.upvote/removeUpvote` blijven zoals ze zijn
   - Clerk pre-signup webhook gebruikt `invites.hasPendingForEmail` (al aanwezig) om invite-only signup te enforcen — als defense-in-depth doet `users.register` zelf óók een `hasPendingForEmail`-check (audit-7 §5), zodat een directe API-call met een geforceerde Clerk-identity niet door de gate breekt
   - `requireWebmaster` doet intern `requireCurrentUser` (audit-7 §3) en matcht email case-insensitive (audit-7 §2)

Backend is client-agnostisch. Zelfde queries/mutations werken straks voor zowel iPhone app als webapp.

### Fase 3: Data migratie tooling + dev seed

Bouw migratie-tooling die zowel dev (subset) als prod (volledig) kan vullen. Eén script, twee config-modes. Dev wordt nu gevuld; prod gebeurt pas op cutover-dag (zie fase 5).

- [ ] DynamoDB full table scan → JSON export (snapshot)
- [ ] Transformatie script: DynamoDB records → Convex documents per table, met filter-config voor dev (zie Dev seed strategie) vs prod (alles)
- [ ] Cognito sub → Clerk ID mapping mechanisme:
   - Dev: 3 chosen Cognito subs handmatig naar Clerk dev IDs in script config
   - Prod: post-cutover via email-match (Clerk prod users worden vooraf via Clerk Invitations API aangemaakt met de 16 bestaande emails, zodat IDs vóór data-import bekend zijn)
- [ ] S3 → Convex file storage migratie:
   - Dev: alleen photos van de 3 chosen (~paar honderd MB, snel)
   - Prod: alle ~1650 foto's + 6 video's (~8.3 GB, paar uur) — pas in fase 5
- [ ] Photo records updaten met storage IDs
- [ ] **AlbumLastSeen herleiden uit seenPics:** per membership in DynamoDB export, walk `seenPics` array, group by albumId, neem `max(photo.createdAt)`. Insert `albumLastSeen` records. Geen records voor (user, album) zonder seen photos (fallback regelt het). Zie design-sectie hierboven
- [ ] **Dev seed draaien:** filter + anonimiseer aan, push naar Convex dev
- [ ] **Validatie dev:** counts kloppen met filter, referentiële integriteit, alle storage IDs geldig
- [ ] **Idempotentie dev:** drop + reseed in 5 min werkt, voor schema-iteraties
- [ ] Performance check op foto laden in dev. Als te traag: switch naar R2 component (kan ook later)
- [ ] S3 prod data laten staan als backup tot ~T+90

### Fase 4: Clients updaten

Twee parallelle tracks. Beide kunnen onafhankelijk doorlopen worden, maar moeten samen klaar zijn voor cutover.

#### Track A: iPhone app

**Stap A1: Expo upgrade (los van Convex)**

Huidige stack is Expo SDK 47 / RN 0.70 (eind 2022). Upgrade naar huidige SDK is fors: 5+ majors, native deps zoals `react-native-maps`, `expo-camera`, `react-native-pager-view` kunnen breken.

- [ ] Branch maken
- [ ] Stapsgewijs Expo SDK + React Native upgraden naar huidige versie
- [ ] Breaking changes fixen, native deps updaten
- [ ] `aws-amplify` v5 deps voorlopig laten staan (worden in stap A2 vervangen)
- [ ] Bevestigen dat de app nog werkt tegen de oude AWS backend
- [ ] Migreren naar TypeScript (incrementeel of in één keer)
- [ ] **Dit is een apart stuk werk; doe dit eerst**

**Stap A2: Convex integratie, scherm voor scherm**

**Subscription discipline (vooraf vastleggen):**

Convex `useQuery` is een live WebSocket-subscription, niet een one-shot fetch. Default is altijd actief zolang de component mounted is. Om battery drain te voorkomen:

- Live `useQuery` alleen op actief scherm. Bij navigatie weg moet de component unmounten zodat de subscription stopt. Check bij stack navigators dat schermen niet in memory blijven hangen (`unmountOnBlur` of equivalent waar nodig).
- Voor data die zelden muteert (clubinfo, ledenlijst): overweeg one-shot fetch via action of `usePaginatedQuery` met handmatige refresh, ipv live subscription.
- Pauzeer subscriptions bij `AppState !== 'active'` (app naar background).
- Bewuste keuze per scherm: heeft dit écht realtime nodig, of is refresh-on-mount genoeg? Group-overzicht met unread badges = ja, realtime. Profielscherm = nee.

Werk door de app per feature. Elke stap lokaal testbaar in Expo dev build tegen de Convex dev deployment (met de gemigreerde data uit fase 3).

1. Auth screens (login/register met Clerk, vervangt Cognito)
2. User profile (lezen/schrijven naar Convex)
3. Groups overzicht + detail
4. Albums + foto's bekijken
5. Foto upload flow
6. Ratings
7. Invites
8. Features/problem reporting
9. Flagging (`Inappropriate.jsx` voor user, `InappropriateAdmin.jsx` voor webmaster, flag-knop + `HelperFlaggedPhotoModal` in `PhotoMenu.jsx`)

Per scherm: oude `aws-amplify` API call vervangen door `useQuery` / `useMutation`. De oude productie-app blijft draaien op AWS totdat de nieuwe versie helemaal klaar is.

#### Track B: Webapp

Webapp is fallback voor Android users met corporate restricties. Niet schrappen.

- [ ] **Keuze maken:** Expo Web (zelfde codebase, simpelste pad — `expo start --web` werkt al) vs aparte Next.js app (betere desktop UX, meer werk)
- [ ] Default-aanbeveling: **Expo Web**, gegeven de smalle use case (foto's bekijken/uploaden) en dat de huidige codebase al een `web` script heeft
- [ ] Scope bepalen: feature-pariteit met iPhone of view-only?
- [ ] Backend: gedeelde Convex deployment, geen extra werk in fase 2
- [ ] Auth: Clerk web component
- [ ] Hosting: Vercel of Cloudflare Pages
- [ ] Werkt met camera/maps in browser? `react-native-maps` heeft geen web support out-of-the-box → alternatief nodig (Leaflet, Google Maps JS)

### Fase 5: Lancering — hard cutover

Geen parallel draaien. Bij 16 users en een 3 jaar oude oude app is parallel draaien absurd veel werk (dual-write, sync layer, Cognito↔Clerk mapping). Hard cut.

#### Constraints

De oude iPhone app heeft **geen `expo-updates` en geen `expo-notifications`** geïnstalleerd. Dat betekent:
- Geen OTA mogelijk → geen forced-upgrade screen via code-push
- Geen push notifications mogelijk
- Een laatste oude-stack release submitten naar App Store wordt afgeraden: SDK 47 / RN 0.70 voldoet niet meer aan Apple's huidige eisen (privacy manifests, min-iOS targets), submit gaat moeizaam zijn voor een codebase die je toch al gaat vervangen.

Dus: communicatie en blokkade gaan **buiten de oude app om**.

#### Cutover-mechanieken

**1. Out-of-band communicatie (primair kanaal)**
- WhatsApp/email blast naar alle 16 users met datum X en download-link nieuwe app
- 1 week vooraf, opnieuw 1 dag vooraf
- Voor de 16 users persoonlijk genoeg om hard genoeg aan te komen

**2. In-app reminder via group-injection (creatieve hack, geen code-update nodig)**
- Server-side een "cutover-group" aanmaken in DynamoDB en aan elke user koppelen via membership
- Group naam: `🚨 UPDATE NODIG - check je email`
- Group cover-foto: visuele banner met "Nieuwe app komt op {datum}"
- Verschijnt op het home screen bij iedereen
- Aanzetten ~1 week voor cutover
- Na cutover gewoon weer verwijderen

**3. Backend write-block (op cutover-dag)**
- Via `blob-images-common` een feature-flag die alle write-Lambdas een 503 returnen
- Of IAM rechten op DynamoDB write-permissions intrekken
- Reads laten staan een paar weken zodat de oude app niet hard crasht (toont nog content, kan niet meer wijzigen)
- Resultaat in oude app: generic alert "Er ging iets mis, probeer het later anders weer" — acceptabel gegeven de out-of-band communicatie

**4. Webapp cutover**
- Statische redirect-pagina deployen op het oude webapp domein: "Deze webapp is uit dienst, gebruik vanaf nu {nieuwe URL}"
- Geen App Store delay zoals bij de iPhone app

#### Cutover stappenplan

- [ ] T-4 weken: prod environments activeren — Convex prod deployment aanmaken (EU Dublin), Clerk prod instance activeren, env-paren wirën (Convex `CLERK_FRONTEND_API_URL` → prod Clerk, EAS prod build profile met juiste keys)
- [ ] T-4 weken: smoke test prod env (lege DB, dummy registratie, JWT round-trip via prod build van app)
- [ ] T-3 weken: cutover-datum vastleggen, communicatie naar 16 users
- [ ] T-2 weken: 16 Clerk prod users vooraf aanmaken via Clerk Invitations API met bestaande emails — Clerk IDs zijn dan bekend voor data-import mapping
- [ ] T-1 week: group-injection aanzetten in DynamoDB (in-app reminder verschijnt)
- [ ] T-1 week: nieuwe iPhone app live in App Store (beschikbaar voor download), nieuwe webapp live, beide tegen prod env
- [ ] T-1 dag: laatste reminder via WhatsApp/email + Clerk invitation links versturen
- [ ] T-0: frisse data migratie herhalen (fase 3 tooling) met actuele DynamoDB-snapshot, prod-mode, push naar Convex prod
- [ ] T-0: backend write-block aan op AWS
- [ ] T-0: webapp redirect aan
- [ ] T-0: 16 users informeren dat ze nu kunnen overstappen, korte instructie voor Clerk login
- [ ] T+1: bevestigen dat alles werkt voor alle 16 users
- [ ] T+30: AWS resources opschonen (S3 nog even bewaren als backup tot ~T+90)
- [ ] T+30: cutover-group uit Convex verwijderen (was alleen reminder voor oude app)

## Monitoring & backup (ongoing)

- [ ] **Backup:** Convex backup/restore beschikbaar op alle plans. Periodiek instellen.
- [ ] **Integriteits-checks:** scheduled function voor data validatie (zie teststrategie punt 3)
- [ ] **Monitoring:** Convex Health & Insights dashboard (gratis), function errors in dashboard
- [ ] **Alerting:** integriteits-checks sturen email bij inconsistentie

## Cyclus-2 backlog (audit-12 follow-up)

- **Integration smoke-test voor upload-flow**: race-409 verifie via parallel POST
  met zelfde X-Upload-Id (Convex OCC race-detectie pinnen) + JWT round-trip
  met echte Clerk-token. Gepland voor fase 4A2.
- **Integrity-check storage orphans**: scheduled function die storage objects
  zonder photo-record detecteert en alert/cleanupt. Audit-10 + audit-12 §5
  identificeerden deze gap. Werkpakket: monitoring/integrity-checks.
- **`.take(N)` guard in cleanupOld**: preventieve cap tegen toekomstige
  transactie-limit overschrijding (16k records). Niet kritiek bij huidige
  schaal maar grow-guard waardig.

## Risico's

| Punt | Risico | Aanbeveling |
|------|--------|-------------|
| **Foto laden performance** | Huidige Lambda cold starts zijn al een probleem. Convex native storage heeft geen CDN | Start met native storage (geen cold starts = al beter dan nu). Switch naar R2 component als het niet snel genoeg is. R2 heeft edge caching + nul egress |
| **Video streaming** | 30-min video's, bandwidth | Upload is handmatig (geen issue). Streaming: native Convex werkt, R2 is beter vanwege edge caching. Geen harde limiet op file size |
| **Expo upgrade** | App lang niet geüpdatet (SDK 47 → huidige = 5+ majors), native deps kunnen breken | Apart behandelen (fase 4 track A1) voordat Convex integratie begint. Stapsgewijs upgraden |
| **Geen update-mechanisme oude app** | Geen `expo-updates`, geen push, App Store submit van 3 jaar oude codebase wordt afgeraden | Forceert hard cutover. Communicatie via out-of-band kanalen + group-injection als in-app reminder + backend write-block |
| **Webapp scope** | Camera/maps werken niet 1:1 in browser (`react-native-maps` heeft geen web support) | Scope vroeg in fase 4B bepalen: view-only vs full feature. Maps: Leaflet of Google Maps JS als web-alternatief |
| **Stream handler vertaling** | Complex cascade logic, 27 handlers | Test-driven bouwen. Grootste kans: Convex transacties elimineren veel complexiteit |
| **File bandwidth kosten** | Dominante kostenpost bij Convex native storage | $2.71-$9.15/maand native, of ~$0/maand met R2 component |
| **Battery drain via subscriptions** | Convex WebSocket houdt radio warm; te veel/te brede live `useQuery` calls = drain. iOS suspendt in background, maar reconnect-storms bij flaky netwerk kosten ook | Per scherm bewuste keuze: live subscription alleen waar realtime nodig is. Unsubscribe bij navigatie weg. Pauzeer bij `AppState !== 'active'`. Voor zelden-muterende data: one-shot fetch ipv live query |
| **Vendor lock-in** | Convex is relatief nieuw | Open-source + self-hostable mitigeert dit. R2 als file storage maakt je nog minder afhankelijk |
| **Invite-only signup** | Custom Cognito trigger | Herbouwen als Clerk custom flow |
| **Env-cross-contamination** | Dev build die per ongeluk naar prod Convex/Clerk wijst, of `pk_test_` in prod release | EAS profiles expliciet, géén defaults. Build-time check in CI die `pk_test_` weigert in prod profile. `CLERK_FRONTEND_API_URL` per Convex deployment matchend gezet |
| **Prod user pre-registration** | 16 Clerk-IDs moeten bekend zijn vóór data-import om mapping op email te kunnen doen | Clerk Invitations API: 16 users vooraf aanmaken met bestaande emails, IDs ophalen, mapping vastzetten vóór T-0 |
