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
Single-table design wordt aparte Convex tables: `users`, `photos`, `groups`, `albums`, `albumPhotos`, `memberships`, `invites`, `ratings`, `features`. Verbetering: leesbaarder, typed schemas, geen PK/SK encoding.

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
Aanbeveling: **Clerk + Convex** (bewezen Expo combo, werkt ook voor web). 16 users: gewoon opnieuw laten registreren. Cognito wordt volledig vervangen.

### TypeScript: overstappen
Convex is volledig TypeScript-native: schema genereert types die end-to-end doorlopen van DB tot React Native components. Zonder TS verlies je het halve voordeel (type-safe queries, autocompletion, compile-time checks).

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

- [ ] **Users:** mutations + queries voor CRUD, photo count limiet
- [ ] **Groups:** create, update, delete, list, members
- [ ] **Albums:** CRUD, album-photo relaties
- [ ] **Photos:** CRUD met cascade logic (stream handler logica → transactionele mutations)
- [ ] **Ratings:** create/update met aggregate berekening
- [ ] **Invites:** create, accept, decline, invite-only signup validatie
- [ ] **Features:** CRUD + upvoting
- [ ] **File upload:** `generateUploadUrl` + EXIF extractie action
- [ ] **Email:** actions voor invite mails, notificaties (Resend/SendGrid)
- [ ] **Auth:** Clerk + Convex integratie

Backend is client-agnostisch. Zelfde queries/mutations werken straks voor zowel iPhone app als webapp.

### Fase 3: Data migratie
- [ ] DynamoDB full table scan → JSON export
- [ ] Transformatie script: DynamoDB records → Convex documents per table
- [ ] Import naar Convex via mutations of bulk import
- [ ] S3 → Convex file storage (of R2): migratiescript dat alle ~1650 foto's + 6 video's overzet (~8.3 GB, paar uur)
- [ ] Photo records updaten met storage IDs
- [ ] **Validatie:** counts vergelijken, steekproeven, referenties checken
- [ ] S3 data voorlopig laten staan als backup
- [ ] Performance check op foto laden. Als te traag: switch naar R2 component (kan ook later)

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

Werk door de app per feature. Elke stap lokaal testbaar in Expo dev build tegen de Convex dev deployment (met de gemigreerde data uit fase 3).

1. Auth screens (login/register met Clerk, vervangt Cognito)
2. User profile (lezen/schrijven naar Convex)
3. Groups overzicht + detail
4. Albums + foto's bekijken
5. Foto upload flow
6. Ratings
7. Invites
8. Features/problem reporting

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

- [ ] T-3 weken: cutover-datum vastleggen, communicatie naar 16 users
- [ ] T-1 week: group-injection aanzetten in DynamoDB (in-app reminder verschijnt)
- [ ] T-1 week: nieuwe iPhone app live in App Store (beschikbaar voor download), nieuwe webapp live
- [ ] T-1 dag: laatste reminder via WhatsApp/email
- [ ] T-0: frisse data migratie herhalen (fase 3) met actuele data, vlak voor launch
- [ ] T-0: backend write-block aan
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
| **Vendor lock-in** | Convex is relatief nieuw | Open-source + self-hostable mitigeert dit. R2 als file storage maakt je nog minder afhankelijk |
| **Invite-only signup** | Custom Cognito trigger | Herbouwen als Clerk custom flow |
