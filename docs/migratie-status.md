# Migratie-status

Status-overzicht van de AWS → Convex migratie. WP's updaten dit doc bij elke closeout. Architectuur-detail blijft in [`migratie-plan-convex.md`](./migratie-plan-convex.md); operationele lopende-staat staat hier.

**Huidige stand 2026-06-21**:
- Fase 1 (project setup) ✅ afgerond
- Fase 2 (backend) ✅ **AFGEROND** — alle domein- + cron-werk + monitoring + deferred integration-tests klaar (WP11 net dicht)
- Fase 3-5 — open. Volgende keuze: fase 3 (data migratie tooling), fase 4 (clients), of fase 5 cutover-prep (T-4-weken-stappenplan: prod-env-vars + prod-Gates-herhaling). Regie beslist per kickoff.

**Volgende fase**: regie's keuze — fase 3, fase 4, of fase 5 cutover-prep.

Cross-refs: [`work-packages/README.md`](./work-packages/README.md) (WP-overzicht), [`conventions/audit-track-record.md`](./conventions/audit-track-record.md) (bugs + recurring patterns), [`cascade-matrix.md`](./cascade-matrix.md) (cross-flow afhankelijkheden).

---

## Fase 1: Project setup ✅ AFGEROND

- [x] Nieuw repo opzetten met TypeScript — [github.com/wintvelt/clubalmanac-v2](https://github.com/wintvelt/clubalmanac-v2) (public)
- [x] Convex project aanmaken op **Starter plan, EU region (Dublin)** — deployment `glorious-pheasant-759`, region bevestigd als `eu-west-1` via deployment URL
- [x] Vitest + `convex-test` configureren — [`vitest.config.ts`](../vitest.config.ts) met `edge-runtime` environment, 6 smoke tests groen lokaal en in CI
- [x] Convex schema ontwerpen (`schema.ts`): alle tables en indexes — **10 tables** in [`convex/schema.ts`](../convex/schema.ts): `users`, `groups`, `memberships`, `albums`, `albumPhotos`, `photos`, `ratings`, `invites`, `features`, `featureUpvotes`. Afwijking van plan: `featureUpvotes` apart (niet impliciet in `features`) om dubbele votes per user te voorkomen via composite index `by_feature_and_user`.
- [x] Clerk account opzetten — applicatie aangemaakt, JWT template "convex" geconfigureerd, issuer `https://picked-quail-97.clerk.accounts.dev` gewired in [`convex/auth.config.ts`](../convex/auth.config.ts). Sign-in opties: alleen Email (geen socials, kunnen later zonder code-impact). Clerk API keys (publishable/secret) pas in fase 4 nodig wanneer een client komt.

### Smoke-test uitkomsten

- ✅ TypeScript compileert (`npm run typecheck`), lokaal én in CI
- ✅ Convex schema valideert (`npx convex dev --once` push zonder errors)
- ✅ EU region bevestigd: `eu-west-1` in URL `glorious-pheasant-759.eu-west-1.convex.cloud`
- ✅ `convex-test` werkt: write → read → delete via `ctx.db`, plus index lookup via `by_subject`
- ✅ Type-flow end-to-end: `api.smoke.ping` query met `v.object()` return validator, return type komt typed door tot in de test
- ⚠️ Clerk smoke test deels: `auth.config.ts` staat goed, `ctx.auth.getUserIdentity()` returnt `null` zonder token, `t.withIdentity()` impersonation in tests werkt. **Volledige JWT round-trip pas in fase 4** wanneer een client een echte Clerk token mint — auth-bedrading is bewezen, end-to-end JWT validatie vereist een client. ✅ Later gepin'd in WP4 (`whoami` httpAction + integration-test).
- ✅ CI baseline: GitHub Action draait `tsc` + `vitest` op elke push.

### Afwijkingen van plan (toelichting)

**`convex/_generated/` wordt gecommit** in plaats van geregenereerd in CI. Reden: `npx convex codegen` heeft een deployment-call nodig die een dev-deploy-key niet honoreert in CI mode (vereist een project-level deploy key, overkill voor deze fase). Trade-off: bij schema-wijzigingen `npx convex dev --once` lokaal draaien en de `_generated` diff meecommitten. Switch naar full deploy-key flow kan in fase 5 wanneer er een echte CD-pipeline komt.

Acceptatiecriterium fase 1: alle smoke tests groen. ✅ Klaar voor fase 2.

## Fase 2: Convex backend bouwen + testen ✅ AFGEROND

Alle domein-bullets + crons (FL1, UI1, IB2 via WP9) + monitoring (MON1 via WP10) + deferred integration-tests (WP11) klaar. Fase 2 gesloten 2026-06-21.

Prod-env-activatie + prod-Gates-herhaling (Mailjet + Clerk) staan in fase 5 T-4-weken-stappenplan — niet in fase 2.

De hele backend bouwen en testen, los van de app en los van de data. Tests draaien tegen een lege `convex-test` database.

Per domein: unit tests eerst, dan implementatie.

**Schema-uitgangspunt (vastgelegd in fase 1):** geen denormalisatie van user-data (naam, profielfoto) naar `memberships`/`photos`/etc. In Convex zijn joins binnen een query function lokale lookups (geen netwerk hops), dus we halen user-data on-read via `ctx.db.get(ownerId)`. Dit elimineert de hele klasse stream-handler bugs uit DynamoDB waar denormalized kopieën uit-sync konden raken — en daarmee ook de UB/UV split-truc om write-amplification te vermijden. De enige denormalized velden die we wel houden zijn aggregates die te duur zijn om bij elke read te recomputen: `users.photoCount`, `photos.ratingAverage` + `ratingCount`, `features.upvoteCount`. Die worden in mutations transactioneel onderhouden, en in fase 1's "data integriteit monitoring" (zie Teststrategie §3) periodiek gevalideerd tegen de werkelijkheid.

- [x] **Users:** mutations + queries voor CRUD, photo count limiet
- [x] **Groups:** create, update, delete, list, members
- [x] **Albums:** CRUD, album-photo relaties
- [x] **Photos:** CRUD met cascade logic (stream handler logica → transactionele mutations). EXIF/geocoding hardening + Photon switch via **[WP1]**
- [x] **Ratings:** create/update met aggregate berekening
- [x] **AlbumLastSeen:** upsert bij album-open, "markeer alles gelezen"-mutation op groep-niveau, query voor unread-count per album met fallback naar `max(album.createdAt, membership.joinedAt)`
- [x] **Invites:** create, accept, decline, invite-only signup validatie. Plus `remove` (sender of group-admin), bounce-handler `internal.invites.handleBounce` met dedup via `inviteBounceEvents` table (zie cascade matrix IB1). **WP5** voltooide de Mailjet bounce-webhook (`http.ts` route + secret-auth). **Open:** scheduled cron (daily) die `invites` met `status="pending"` en `expiresAt < now` patcht naar `status="expired"` (cascade matrix IB2 — TBD-WP per work-packages/README.md).
- [x] **Features:** create + upvoting (open voor users), update + remove (webmaster only via `requireWebmaster`). Probleem-report action verstuurt email naar webmaster (zelfde env-var). Audit-7 §4 fixte hier de drift: code stond submitter-only, plan zei webmaster-only — tests in `tests/features/crud.test.ts` pinnen nu het webmaster-only gedrag.
- [x] **Flagging:** flag/appeal/decide mutations met owner+webmaster checks (via `requireWebmaster` helper in `convex/lib/auth.ts`), listMyFlagged + listAllFlagged queries, daily cron `cleanupFlaggedPhotos` (in `convex/crons.ts`) voor auto-delete na countdown, `internal.photos.sendFlagDecisionEmail` (geïmplementeerd in **WP5**). Schema uitgebreid met `flaggedDeleteDate`, `flaggedAppealDate`, `flaggedAppealDenyDate` + index `by_flagged_delete`. Cascade matrix FL1, FL2, U10 alle ✅. Afwijking van oude AWS: email alleen bij deny (niet bij approve), `listAllFlagged` throwt voor non-webmaster, appeal niet meer mogelijk na deny
- [x] **File upload:** 1-step backend-mediated `POST /upload` httpAction met reservation pattern (cyclus 1 architectuur rewrite — zie File Storage sectie in migratie-plan-convex.md), idempotency via `X-Upload-Id`/`uploadIdempotency` table, daily cron `cleanupOldUploadIdempotency` voor 7d-cleanup (UI1). **Cyclus 2 (audit-10 hardening)**: DateTimeOriginal ?? CreateDate fallback voor `takenAt`, locationLabel multi-deel format `${street}, ${city}, ${country}` (lege fields gefilterd), granulaire try/catch + console.error logging in extractMetadata, HEIC graceful no-op met "unsupported format" log (client-side conversion komt in fase 4), MapQuest → **Photon** geocoding-switch via **[WP1]**. Implementatie-pad via **[WP2]** (storage roundtrip) + **[WP4]** (`POST /upload` httpAction + 401-hardening). **[WP7] gate gepasseerd 2026-05-18** — twee runtime-bugs gevonden + gefixt: `blob.slice().arrayBuffer()` RangeError + Buffer-global ontbreekt in isolate-runtime → `extractMetadata` verhuisd naar `convex/photoMetadata.ts` met `"use node";`.
- [x] **Photo rotation:** `photos.rotate` mutation (owner OR group-admin), **EXIF-only** — `photos.exifOrientation` waarde berekend via 8-staat-arithmetiek-tabel op `(rotation, flipY)`, `width`/`height` geswapt bij 90°/270°, bestand zelf ongemoeid. Geen sharp, geen scheduled action, geen storage-swap. Client past CSS-transform toe gebaseerd op DB-`exifOrientation` (Phase-4 contract, zie [`WP8-photo-rotation.md`](../work-packages/WP8-photo-rotation.md) §Frontend-contract). Implementatie via **[WP8]**: cyclus 1 (auth-pad owner OR group-admin via `albumPhotos.by_photo` → `memberships`) + audit-bug #10 fix-cyclus (5↔7 transpose/transverse swap; pixel-array-oracle als onafhankelijke verifier in test; gepromoveerd tot recurring-pattern "gedeelde-lookup-tabel blind spot" in `ab-audit-workflow.md`). 99 tests groen, suite 566.
- [x] **Visit tracking:** `users.recordVisit` mutation, client throttled max 1x/min op AppState=active
- [x] **Email:** Mailjet account + DNS setup (DKIM, SPF, DMARC), Convex actions voor alle applicatie-emails (invite/accept/decline/bounced/flag-decide/problem-report), HTTP endpoint `/email-event` voor bounce-webhook met Basic-auth-in-URL, NL templates 1:1 oude SES tone-of-voice. Implementatie via **[WP5]**. Gates 1+2 (send-roundtrip + bounce-roundtrip) op dev gepasseerd 2026-05-18. Pre-cutover deferred: integration-test + prod-gate-herhaling.
- [x] **Auth:** Clerk + Convex integratie via `session.created` webhook + atomic onboarding (`/clerk-webhook` httpAction + `internal.users.registerFromSession` mutation). `requireWebmaster(ctx)` helper op basis van `WEBMASTER_EMAILS` env-var. Implementatie via **[WP4]** (JWT roundtrip + `whoami`) + **[WP6]** (session.created webhook + atomic onboarding). Gates 1+2+3 op dev gepasseerd 2026-05-18. Audit-7 fixes (case-insensitive webmaster, server-side invite-gate, RBAC drift) gepind. **Pre-signup webhook** uit oorspronkelijke plan is bewust **niet** geïmplementeerd — vervangen door defense-in-depth `users.register` + `session.created`-pad (per WP6 design-discussie). Pre-cutover deferred: integration-test.
- [x] **IB2 natural-expiry cron:** scheduled Convex cron `"expire pending invites"` 04:00 UTC → `internal.invites.expirePendingInvites` patcht `invites` met `status="pending"` en `expiresAt <= now` naar `status="expired"`. Boundary `<=` consistent met FL1 + invites-accept. Stille expiry (geen email-action, geen `bouncedAt`/`respondedAt`-write). Natural-expiry-fingerprint = `expired` ∧ geen `bouncedAt` ∧ geen `respondedAt` — onderscheidbaar van bounce-expiry (IB1) en user-decline. `by_status`-index + in-memory filter (geen composite-index nodig op 16-user schaal). Implementatie via **[WP9]**. 15 tests groen, suite 578, geen blockers/should-fix uit audit.
- [x] **Integrity-check / monitoring:** dagelijkse `internal.monitoring.integrityCheck` 04:30 UTC scant vier categorieën in één transactie (storage-orphans incl. `users.profilePhotoStorageId`, aggregate-drift met float-epsilon op `ratingAverage`, FK-integriteit 19 verplicht + 5 optioneel, geen self-healing). Alert-pad via bestaand Mailjet `info@`-sender → `WEBMASTER_EMAILS`: dashboard-log altijd autoritatief, drift-mail met strict-consecutive dedup (drift→clean→drift = re-alert per audit-S-1-fix), maandelijkse heartbeat met conditionele warning bij gededupte drift (per audit-N-1-fix). Nieuwe `monitoringRuns` tabel met `by_runAt` index. Implementatie via **[WP10]** (cyclus 1 + audit-fix-cyclus 2026-06-04). 30 tests groen, suite 609, typecheck clean.
- [x] **Deferred integration-tests (WP5+WP6 follow-up):** `tests/integration/mailjet/sendRoundtrip.test.ts` (directe Send-API call, silent-failure-pin van WP5 known-issue #2 + happy-path met MessageID) + `tests/integration/clerk/onboardingWebhook.test.ts` (synth-payload met fresh subject + echte Svix-HMAC, atomic onboarding pin op drie velden `users.createdAt`/`invites.respondedAt`/`memberships.joinedAt`, tamper→401-pad). Zes nieuwe `INTEGRATION_TEST_ENABLED`-gated helpers in `convex/_test.ts` (seed/reads/cleanup voor Clerk-fixture). `getConvexSiteBase` + `requireEnv` gecentraliseerd in `tests/integration/_helpers/convexSite.ts`. Combo-runbook `docs/runbooks/wp11-deferred-integration-gates.md`. Implementatie via **[WP11]**. Niet tegen live services gedraaid in deze WP — dat is runbook-stap pre-cutover. Prod-Gates herhalen staat in fase 5 T-4-weken-stappenplan.

Backend is client-agnostisch. Zelfde queries/mutations werken straks voor zowel iPhone app als webapp.

## Fase 3: Data migratie tooling + dev seed — open

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
- [ ] **AlbumLastSeen herleiden uit seenPics:** per membership in DynamoDB export, walk `seenPics` array, group by albumId, neem `max(photo.createdAt)`. Insert `albumLastSeen` records. Geen records voor (user, album) zonder seen photos (fallback regelt het). Zie design-sectie in migratie-plan-convex.md
- [ ] **Dev seed draaien:** filter + anonimiseer aan, push naar Convex dev
- [ ] **Validatie dev:** counts kloppen met filter, referentiële integriteit, alle storage IDs geldig
- [ ] **Idempotentie dev:** drop + reseed in 5 min werkt, voor schema-iteraties
- [ ] Performance check op foto laden in dev. Als te traag: switch naar R2 component (kan ook later)
- [ ] S3 prod data laten staan als backup tot ~T+90

## Fase 4: Clients updaten — open

Twee parallelle tracks. Beide kunnen onafhankelijk doorlopen worden, maar moeten samen klaar zijn voor cutover.

### Track A: iPhone app

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
4. Albums + foto's bekijken — **photo-display-contract**: client gebruikt `photos.exifOrientation` uit Convex (niet de file-EXIF-tag) voor de CSS-transform / native rotate. Bron: [`WP8-photo-rotation.md`](../work-packages/WP8-photo-rotation.md) §Frontend-contract.
5. Foto upload flow
6. Ratings
7. Invites
8. Features/problem reporting
9. Flagging (`Inappropriate.jsx` voor user, `InappropriateAdmin.jsx` voor webmaster, flag-knop + `HelperFlaggedPhotoModal` in `PhotoMenu.jsx`)

Per scherm: oude `aws-amplify` API call vervangen door `useQuery` / `useMutation`. De oude productie-app blijft draaien op AWS totdat de nieuwe versie helemaal klaar is.

### Track B: Webapp

Webapp is fallback voor Android users met corporate restricties. Niet schrappen.

- [ ] **Keuze maken:** Expo Web (zelfde codebase, simpelste pad — `expo start --web` werkt al) vs aparte Next.js app (betere desktop UX, meer werk)
- [ ] Default-aanbeveling: **Expo Web**, gegeven de smalle use case (foto's bekijken/uploaden) en dat de huidige codebase al een `web` script heeft
- [ ] Scope bepalen: feature-pariteit met iPhone of view-only?
- [ ] Backend: gedeelde Convex deployment, geen extra werk in fase 2
- [ ] Auth: Clerk web component
- [ ] Hosting: Vercel of Cloudflare Pages
- [ ] Werkt met camera/maps in browser? `react-native-maps` heeft geen web support out-of-the-box → alternatief nodig (Leaflet, Google Maps JS)

## Fase 5: Lancering — hard cutover — open

Geen parallel draaien. Bij 16 users en een 3 jaar oude oude app is parallel draaien absurd veel werk (dual-write, sync layer, Cognito↔Clerk mapping). Hard cut.

### Constraints

De oude iPhone app heeft **geen `expo-updates` en geen `expo-notifications`** geïnstalleerd. Dat betekent:
- Geen OTA mogelijk → geen forced-upgrade screen via code-push
- Geen push notifications mogelijk
- Een laatste oude-stack release submitten naar App Store wordt afgeraden: SDK 47 / RN 0.70 voldoet niet meer aan Apple's huidige eisen (privacy manifests, min-iOS targets), submit gaat moeizaam zijn voor een codebase die je toch al gaat vervangen.

Dus: communicatie en blokkade gaan **buiten de oude app om**.

### Cutover-mechanieken

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

### Cutover stappenplan

- [ ] T-4 weken: prod environments activeren — Convex prod deployment aanmaken (EU Dublin), Clerk prod instance activeren, env-paren wirën (Convex `CLERK_FRONTEND_API_URL` → prod Clerk, EAS prod build profile met juiste keys)
- [ ] T-4 weken: prod env-vars op Convex deployment zetten (apart van dev) — `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, `MAILJET_SENDER_EMAIL`, `MAILJET_WEBHOOK_USER`, `MAILJET_WEBHOOK_SECRET`, `CLUBALMANAC_APP_URL=https://clubalmanac.com`, `CLUBALMANAC_STAGE=prod`, `CLERK_WEBHOOK_SECRET` (prod Svix), aparte `WEBMASTER_EMAILS`
- [ ] T-4 weken: Mailjet prod webhook-config — eigen webhook-URL (`https://<prod-deployment>.eu-west-1.convex.site/email-event`) + eigen Basic-auth-secret in Mailjet dashboard configureren
- [ ] T-4 weken: Clerk prod webhook-config — eigen `/clerk-webhook`-URL (`https://<prod-deployment>.eu-west-1.convex.site/clerk-webhook`) + eigen Svix signing-secret + verification-required-flag aan
- [ ] T-4 weken: smoke test prod env (lege DB, dummy registratie, JWT round-trip via prod build van app)
- [ ] T-4 weken: WP5 prod-Gates 1+2 herhalen op prod-deployment (send-roundtrip naar test-inbox + bounce-roundtrip via echte bounce of dashboard test-event)
- [ ] T-4 weken: WP6 prod-Gates 1+2+3 herhalen op prod-deployment (atomic-onboarding happy-path + idempotency-relogin + zero-invite-fallback via Clerk Account Portal)
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

## Monitoring & backup (ongoing) — open

- [ ] **Backup:** Convex backup/restore beschikbaar op alle plans. Periodiek instellen.
- [ ] **Integriteits-checks:** scheduled function voor data validatie (zie teststrategie punt 3 in migratie-plan-convex.md)
- [ ] **Monitoring:** Convex Health & Insights dashboard (gratis), function errors in dashboard
- [ ] **Alerting:** integriteits-checks sturen email bij inconsistentie

## Cyclus-2 backlog (audit-12 follow-up)

- **Integration smoke-test voor upload-flow**: race-409 verifie via parallel POST met zelfde X-Upload-Id (Convex OCC race-detectie pinnen) + JWT round-trip met echte Clerk-token. Gepland voor **[WP7]** of fase 4A2.
- **Integrity-check storage orphans**: scheduled function die storage objects zonder photo-record detecteert en alert/cleanupt. Audit-10 + audit-12 §5 identificeerden deze gap. Werkpakket: monitoring/integrity-checks (TBD).
- **`.take(N)` guard in cleanupOld**: preventieve cap tegen toekomstige transactie-limit overschrijding (16k records). Niet kritiek bij huidige schaal maar grow-guard waardig.

## Pre-cutover deferred items

WP5/WP6 deferred items zijn nu verdeeld over fase 2 en fase 5:

- **Backend-code** (fase 2, [ ]-bullet bovenaan §Fase 2): WP5/WP6 integration-tests `tests/integration/mailjet/sendRoundtrip.test.ts` + `tests/integration/clerk/onboardingWebhook.test.ts`
- **Prod-env activatie + Gates herhalen** (fase 5 T-4 weken, zie §Cutover stappenplan): prod env-vars, Mailjet prod webhook-config, Clerk prod webhook-config, WP5 Gates 1+2 herhalen, WP6 Gates 1+2+3 herhalen

Reden voor split: integration-tests zijn écht backend-code (env-var-gated, in CI-uitsluitingslijst per `integration-tests.md`) — past in fase 2. Prod-env-activatie heeft pas zin in T-4 weken (idle prod-deployment eerder = cost + drift-risico, plus Gates moeten toch herhaald worden vlak vóór T-0).

## Hoe dit doc bijwerken

Per WP-closeout: regie update de relevante regels hier mee in dezelfde commit als de audit-track-record-entry. WP-referenties zijn in `[WP<n>]`-vorm voor traceability. Open items mogen oude AWS-handler-namen (cascade matrix codes) bewaren want die referenties zijn permanent.
