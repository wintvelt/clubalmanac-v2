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
Upload via `generateUploadUrl()` + POST past 1:1 op het huidige signed URL patroon.

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

### Auth
Aanbeveling: **Clerk + Convex** (bewezen Expo combo, werkt ook voor web). 16 users: gewoon opnieuw laten registreren. Cognito wordt volledig vervangen. Clerk heeft aparte dev en prod instances (zie Environments).

### Webmaster-rol (RBAC)

In oude AWS app was webmaster één hardcoded email (`wintvelt@me.com`) via env-var, geen Cognito group. Convex equivalent: env-var `WEBMASTER_EMAILS` (comma-separated) per deployment, helper `requireWebmaster(ctx)` die `ctx.auth.getUserIdentity().email` matcht tegen de lijst.

```ts
// convex/lib/auth.ts
const WEBMASTER_EMAILS = (process.env.WEBMASTER_EMAILS ?? "").split(",").map(e => e.trim());
export async function requireWebmaster(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !WEBMASTER_EMAILS.includes(identity.email)) {
    throw new Error("Webmaster only");
  }
}
```

Webmaster-gated operations (uit oude AWS code):
- `decideFlag(photoId, approve)` — flag appeal beslissing
- `listAllFlagged()` — admin queue van geflagde photos
- `features.remove(featureId)` — feature requests verwijderen
- `features.update(featureId, ...)` — feature status updaten (bv. "accepted")

Bootstrap: jouw email handmatig in Clerk dashboard aanmaken pre-cutover, env-var `WEBMASTER_EMAILS=wintvelt@me.com` zetten in Convex prod deployment. Dev deployment kan dezelfde of een test-email gebruiken.

**YAGNI keuze:** Clerk publicMetadata-rol of Convex DB-flag zou flexibeler zijn (multi-webmaster zonder redeploy), maar bij 16 users + 1 webmaster levert het niks op. Bij behoefte aan tweede webmaster ooit: ~30 min werk om over te zetten. Probleem-report email-bestemming gebruikt dezelfde env-var.

**TODO voor Fase 4A2 (client-integratie):** verifieer dat `convex/auth.config.ts` daadwerkelijk de `email`-claim uit het Clerk JWT doorgeeft, zodat `ctx.auth.getUserIdentity().email` in productie gevuld is. Implementatie + tests gebruiken `withIdentity({ email })` wat altijd werkt; productie hangt af van Clerk JWT template configuratie. Als email-claim niet doorkomt: Clerk JWT template aanpassen óf `requireWebmaster` switchen naar DB-lookup via `users.email`.

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
  && addedAt > effectiveLastSeen
  && photo.ownerId != currentUserId  // join met photos voor ownerId
```

Filter op `photo.ownerId` (niet `albumPhoto.addedBy`): als Bob een foto van Alice in een album zet, hoort Alice 'm niet als nieuw te zien — zij heeft die foto immers zelf gemaakt.

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
- [x] **Invites:** create, accept, decline, invite-only signup validatie. Plus `remove` (sender of group-admin), bounce-handler `internal.invites.handleBounce` met webhook endpoint en dedup via `inviteBounceEvents` table (zie cascade matrix IB1). **Open:** scheduled cron (daily) die `invites` met `status="pending"` en `expiresAt < now` patcht naar `status="expired"` (cascade matrix IB2). Accept-mutation kan dat zelf niet doen want de status-patch wordt door de bijbehorende throw teruggedraaid (Convex transactionele rollback). Cron landt naast de flagging-cron uit de Flagging-bullet
- [x] **Features:** create + upvoting (open voor users), update + remove (webmaster only via `requireWebmaster`). Probleem-report action verstuurt email naar webmaster (zelfde env-var). **Verifieer:** webmaster-checks aanwezig op update/remove paths
- [x] **Flagging:** flag/appeal/decide mutations met owner+webmaster checks (via `requireWebmaster` helper in `convex/lib/auth.ts`), listMyFlagged + listAllFlagged queries, daily cron `cleanupFlaggedPhotos` (in `convex/crons.ts`) voor auto-delete na countdown, `internal.photos.sendFlagDecisionEmail` als stub (Mailjet komt in email-werkpakket). Schema uitgebreid met `flaggedDeleteDate`, `flaggedAppealDate`, `flaggedAppealDenyDate` + index `by_flagged_delete`. Cascade matrix FL1, FL2, U10 alle ✅. Afwijking van oude AWS: email alleen bij deny (niet bij approve), `listAllFlagged` throwt voor non-webmaster, appeal niet meer mogelijk na deny
- [ ] **File upload:** `generateUploadUrl` + EXIF extractie action (incl. `Orientation` tag in `photos.exifOrientation`)
- [ ] **Photo rotation:** `photos.rotate` mutation (owner OR group-admin) + scheduled action met `sharp` voor server-side rewrite + cleanup oude storage
- [x] **Visit tracking:** `users.recordVisit` mutation, client throttled max 1x/min op AppState=active
- [ ] **Email:** Mailjet account + DNS setup (DKIM, SPF), Convex actions voor alle applicatie-emails (invite/leave/ban/etc), HTTP endpoint voor bounce-webhook, NL templates 1:1 porten van oude SES templates
- [ ] **Auth:** Clerk + Convex integratie + `requireWebmaster(ctx)` helper op basis van `WEBMASTER_EMAILS` env-var (zie sectie Webmaster-rol). **Verifieer en herstel mismatches in al gecommitte code:**
   - `features.update` en `features.remove` zijn nu **submitter-only**, plan zegt **webmaster-only**. Aanpassen wanneer `requireWebmaster` helper landt + tests bijwerken (caller met webmaster-email impersoneren via `t.withIdentity({ email: ... })`)
   - `features.create` (open voor users) en `features.upvote/removeUpvote` blijven zoals ze zijn
   - Clerk pre-signup webhook gebruikt `invites.hasPendingForEmail` (al aanwezig) om invite-only signup te enforcen

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
