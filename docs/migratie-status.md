# Migratie-status

Status-overzicht van de AWS → Convex migratie. WP's updaten dit doc bij elke closeout. Architectuur-detail blijft in [`migratie-plan-convex.md`](./migratie-plan-convex.md); operationele lopende-staat staat hier.

**Huidige stand 2026-11-22**:
- Fase 1 tot en met 3 ✅ afgerond.
- Fase 4 ✅: de iPhone-app is klaar (WP13 tot en met WP34). De webapp (WP35, WP36) staat sinds 2026-11-21 live op `app.clubalmanac.com`.
- Fase 5 (cutover): T-4 en de generale repetitie op prod zijn klaar, en cutover-build 70 staat in TestFlight, en App Store Connect staat klaar voor 2.0.0. *Cannot Sell App* is verklaard: Apple haalde 1.6.0 uit de winkel, en goedkeuring van 2.0.0 zet hem terug. Versneld (besluit 2026-11-19): geen T-3 en T-1 dag. **T0 was 2026-11-19:** schrijfstop, migratie (`verify` groen), filmlijst, anker-export en demo-groep. **2.0.0 staat sinds 2026-11-20 in de App Store** (goedgekeurd en vrijgegeven, leden ingelicht met bericht 4). Migratie-key ingetrokken, backup aan. Nog open: `blob-videos` dichtzetten (Wouter: later).

Cross-refs: [`work-packages/README.md`](./work-packages/README.md) (WP-overzicht), [`conventions/audit-track-record.md`](./conventions/audit-track-record.md) (bugs + recurring patterns), [`cascade-matrix.md`](./cascade-matrix.md) (cross-flow afhankelijkheden).

---

## Fase 1: Project setup ✅ AFGEROND

- [x] Nieuw repo opzetten met TypeScript — [github.com/wintvelt/clubalmanac-v2](https://github.com/wintvelt/clubalmanac-v2) (public)
- [x] Convex project aanmaken op **Starter plan, EU region (Dublin)** — deployment `glorious-pheasant-759`, region bevestigd als `eu-west-1` via deployment URL
- [x] Vitest + `convex-test` configureren — [`vitest.config.ts`](../vitest.config.ts) met `edge-runtime` environment, 6 smoke tests groen lokaal en in CI
- [x] Convex schema ontwerpen (`schema.ts`): alle tables en indexes — **9 tables** in [`convex/schema.ts`](../convex/schema.ts): `users`, `groups`, `memberships`, `albums`, `albumPhotos`, `photos`, `invites`, `features`, `featureUpvotes`. Afwijking van plan: `featureUpvotes` apart (niet impliciet in `features`) om dubbele votes per user te voorkomen via composite index `by_feature_and_user`.
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

**Schema-uitgangspunt (vastgelegd in fase 1):** geen denormalisatie van user-data (naam, profielfoto) naar `memberships`/`photos`/etc. In Convex zijn joins binnen een query function lokale lookups (geen netwerk hops), dus we halen user-data on-read via `ctx.db.get(ownerId)`. Dit elimineert de hele klasse stream-handler bugs uit DynamoDB waar denormalized kopieën uit-sync konden raken — en daarmee ook de UB/UV split-truc om write-amplification te vermijden. De enige denormalized velden die we wel houden zijn aggregates die te duur zijn om bij elke read te recomputen: `users.photoCount`, `features.upvoteCount`. Die worden in mutations transactioneel onderhouden, en in fase 1's "data integriteit monitoring" (zie Teststrategie §3) periodiek gevalideerd tegen de werkelijkheid.

- [x] **Users:** mutations + queries voor CRUD, photo count limiet
- [x] **Groups:** create, update, delete, list, members
- [x] **Albums:** CRUD, album-photo relaties
- [x] **Photos:** CRUD met cascade logic (stream handler logica → transactionele mutations). EXIF/geocoding hardening + Photon switch via **[WP1]**
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
- [x] **Integrity-check / monitoring:** dagelijkse `internal.monitoring.integrityCheck` 04:30 UTC scant vier categorieën in één transactie (storage-orphans incl. `users.profilePhotoStorageId`, aggregate-drift, FK-integriteit 18 verplicht + 5 optioneel, geen self-healing). Alert-pad via bestaand Mailjet `info@`-sender → `WEBMASTER_EMAILS`: dashboard-log altijd autoritatief, drift-mail met strict-consecutive dedup (drift→clean→drift = re-alert per audit-S-1-fix), maandelijkse heartbeat met conditionele warning bij gededupte drift (per audit-N-1-fix). Nieuwe `monitoringRuns` tabel met `by_runAt` index. Implementatie via **[WP10]** (cyclus 1 + audit-fix-cyclus 2026-06-04). 30 tests groen, suite 609, typecheck clean.
- [x] **Deferred integration-tests (WP5+WP6 follow-up):** `tests/integration/mailjet/sendRoundtrip.test.ts` (directe Send-API call, silent-failure-pin van WP5 known-issue #2 + happy-path met MessageID) + `tests/integration/clerk/onboardingWebhook.test.ts` (synth-payload met fresh subject + echte Svix-HMAC, atomic onboarding pin op drie velden `users.createdAt`/`invites.respondedAt`/`memberships.joinedAt`, tamper→401-pad). Zes nieuwe `INTEGRATION_TEST_ENABLED`-gated helpers in `convex/_test.ts` (seed/reads/cleanup voor Clerk-fixture). `getConvexSiteBase` + `requireEnv` gecentraliseerd in `tests/integration/_helpers/convexSite.ts`. Combo-runbook `docs/runbooks/wp11-deferred-integration-gates.md`. Implementatie via **[WP11]**. Niet tegen live services gedraaid in deze WP — dat is runbook-stap pre-cutover. Prod-Gates herhalen staat in fase 5 T-4-weken-stappenplan.

Backend is client-agnostisch.

## Fase 3: Data migratie tooling + dev seed ✅ AFGEROND

Uitgewerkt in **[WP12](./work-packages/WP12-data-migratie-tooling.md)** (afgerond 2026-08-23, tooling geleverd). Mechanisme = API-import: het script schrijft via internal Convex-mutations en storage-uploads, Convex mint `_id` en `_storage`. De route via een zelfgebouwde snapshot-zip is getest en afgewezen — `convex import` weigert een zelf-gemunte `_id`. Acht commando's: `extract` / `inspect` / `transform` / `load-files` / `load-records` / `verify` / `prune-storage` / `reset`. De splitsing tussen bestanden en records is nodig omdat de uploadlijn <20 Mbit/s haalt: bestanden gaan op T-2 weken omhoog, records op T-0. Scope van WP12 = tooling + gedraaide dev-seed; de prod-run blijft fase 5, T-0.

Bouw migratie-tooling die zowel dev (subset) als prod (volledig) kan vullen. Eén script, twee config-modes. Dev wordt nu gevuld; prod gebeurt pas op cutover-dag (zie fase 5).

- [x] DynamoDB full table scan → JSON export (snapshot)
- [x] Transformatie script: DynamoDB records → Convex documents per table, met filter-config voor dev (zie [§Dev seed strategie in migratie-plan-convex.md](./migratie-plan-convex.md#dev-seed-strategie)) vs prod (alles)
- [x] Cognito sub → Clerk ID mapping mechanisme:
   - Dev: 3 chosen Cognito subs handmatig naar Clerk dev IDs in script config
   - Prod: **pre-create via de Clerk Users-API**, zonder wachtwoord (regie-keuze 2026-06-21, bijgesteld 2026-10-25: een Clerk-uitnodiging maakt de user pas aan als de genodigde accepteert). Vóór T0 worden alle 20 prod-users via Clerk's API aangemaakt met hun bestaande emails — Clerk-IDs zijn dan bekend voor data-import (email→Clerk-ID lookup). Data-import schrijft alle `userId`-FKs direct met de echte Clerk-IDs — geen placeholders, geen lazy-rewrite, geen schema-impact. Alternatief (lazy-rewrite post-cutover) afgewezen wegens schema-impact (placeholder-strings op alle FKs) + halfgemigreerde-state-risico + WP10-monitoring-noise. Zie fase 5 T-2-weken stap voor de Clerk-pre-create-actie.
- [x] S3 → Convex file storage migratie:
   - Dev: alleen photos van de 3 chosen (1002 bestanden, 3,1 GB)
   - Prod: alle bestanden uit `blob-images` — 1601 objecten, 5,6 GB (gemeten 2026-08-23). Video's gaan niet mee, zie WP12 §Video's. Pas in fase 5.
- [x] Photo records updaten met storage IDs
- [x] **AlbumLastSeen herleiden uit seenPics:** `seenPics` is een wachtrij van **ongelezen** foto's — entry zonder `seenDate` = ongelezen. Per (user, album): ongelezen entries aanwezig → `lastSeenAt` = kleinste `addedAt` min 1 ms; alles gelezen → grootste `addedAt`; geen albumfoto's → geen record. Volledige afleiding in [`migratie-plan-convex.md` §Unread-count](./migratie-plan-convex.md#unread-count-per-album-per-user-albumlastseen).
- [x] **Pre-flight §0 dev** (2026-10-25): tag `pre-wp12-dev`, export `backups/pre-wp12-dev.zip` (alleen CLI, geen dashboard-kopie). Count-baseline dev ná transform: users 6→3, groups 1→5, memberships 2→7, invites 2→3, rest 0→ albums 17 / photos 1001 / albumPhotos 992 / ratings 6 / features 4 / albumLastSeen 43; storage 0, integriteitsscan 0. De 6/1/2/2 zijn testdata uit eerdere WP's. **Go**, met `reset --target dev --yes` vóór `load-records`.
- [x] **3 chosen users** (2026-10-25): Wouter, vincent, Michiel — 5 groepen, 1002 bestanden. Eén groep valt af (founder niet chosen).
- [x] **Dev seed gedraaid** (2026-10-25): `reset` → `load-files` → `load-records`, 2081 rijen, 1002 bestanden (3,1 GB). Doorvoer gemeten: ~3,6 MB/s (~29 Mbit/s).
- [x] **Validatie dev** (2026-10-25): `verify` groen — alle counts gelijk aan de transform, integriteitsscan 0, 1002/1002 storage-objecten door records gebruikt.
- [x] **Dev leegmaken + herladen** (2026-10-25): `reset` + `load-records` + groene `verify` in enkele minuten; bestanden blijven staan. Zo herlaad je dev bij elke schema-wijziging in fase 4.
- [x] **Veldfixes ([WP12b](./work-packages/WP12b-migratie-veldfixes.md), 2026-11-07):** albumcovers gaan nu mee (de transform liet ze leeg), het bezoek naar `userVisits`, `verify` telt covers uit de bron, en de transform stopt bij een gemelde foto met een verwijderdatum (`--accept-flagged-deletion`). Uit een veldaudit over alle bronvelden; de bewuste drops staan in WP12. Dev opnieuw geladen, `verify` groen.
- [ ] Performance check op foto laden in dev. Als te traag: switch naar R2 component (kan ook later)
- [ ] S3 prod data laten staan als backup tot ~T+90

## Fase 4: Clients updaten ✅ AFGEROND

Twee parallelle tracks. Beide kunnen onafhankelijk doorlopen worden, maar moeten samen klaar zijn voor cutover.

### Track A: iPhone app

**Besluit 2026-10-25: verse app in `app/` van deze repo, geen upgrade van de oude.**

- Oude app (`~/Code/v1/clubalmanac-app`, Expo 47, ~10k regels JS, 47 schermen) is alleen referentie en checklist. Upgraden loont niet: de datalaag (Amplify + react-query) gaat er toch uit.
- Monorepo, zodat de app de getypeerde Convex-API (`convex/_generated`) direct importeert.
- Zelfde App Store-identiteit: bundle ID `com.wintvelt.clubalmanac-app`, EAS project `bd5c6c93-059d-409f-bca5-f658ec5722d5`. Apple heeft de oude app op 2026-07-28 uit distributie gehaald (geen update in 3 jaar); het record bestaat nog en een goedgekeurde update zet hem terug. De nieuwe app gaat live als update, bestaande users hoeven niets te zoeken.
- TestFlight werkt terwijl de app uit distributie is ([WP14](./work-packages/WP14-eas-testflight-spike.md) ✅ 2026-10-25). Elke app-WP kan via TestFlight op een toestel getest worden; runbook in [`external-services.md`](./conventions/external-services.md) §EAS-build en TestFlight.
- Opgeknipt in WP13-WP21, met een designstap na WP14 (zie [`work-packages/README.md`](./work-packages/README.md)). [WP-Design](./work-packages/WP-Design.md) ✅ 2026-10-25: stijl en thema vastgelegd in [`design.md`](./design.md), thema-code en icoon in de app. Alleen A leest de oude app-repo. [WP13](./work-packages/WP13-app-scaffold-auth.md) ✅ 2026-10-25: scaffold + code-login, gate op dev groen. [WP15a](./work-packages/WP15a-navigatie-subscriptions.md) ✅ 2026-11-03: Expo Router, tabbalk, auth-poort per route, één toegangspad voor live data. Op de achtergrond lopen geen live queries. Offline starten en uitloggen werken. Gate op build 44 groen. [WP15b](./work-packages/WP15b-profiel-instellingen-info.md) ✅ 2026-11-04: Profiel (naam wijzigen, met validatie in de backend), Instellingen, Info-pagina's ook uitgelogd, en `recordVisit` hoogstens één keer per uur in een eigen tabel. De tabwissel stopt de query van het scherm (gemeten). [WP16](./work-packages/WP16-groepen.md) ✅ 2026-11-04: Mijn groepen en Groep (Albums per jaar, Leden) met live ongelezen-tellers per album en per groep, Home = laatst bezochte groep, en een nette melding als je geen lid meer bent. Nieuw veld `sortDate` via de WP12-transform; dev opnieuw geladen. Groepsbeheer volgt in een eigen WP vóór T0. [WP23](./work-packages/WP23-read-whitelist.md) ✅ 2026-11-02: elke publieke read heeft auth en een veld-whitelist. Andere leden zie je alleen als naam en profielfoto. [WP24](./work-packages/WP24-write-gates.md) ✅ 2026-11-02: mutations die foto-toegang bepalen checken die zelf; een beeld koppel je alleen als je het al mag zien. Geen bestaans-orakels meer in die mutations. [WP17a](./work-packages/WP17a-fotos-bekijken.md) ✅ 2026-11-06: albumscherm en foto-detail, covers en profielfoto's via een eigen beeldpad dat bij elk verzoek de toegang checkt (een profielfoto is openbaar, en alleen een eigen beeld), `NOT_MEMBER` op de album- en foto-reads. Gate op build 54 groen (2026-11-07). [WP25](./work-packages/WP25-fotoformaten.md) ✅ 2026-11-07: elke foto krijgt een *klein* (512) en *groot* (1600) JPEG (ruwe pixels, de app draait volgens `exifOrientation`, die de backfill nu ook vult); nieuwe foto's via een Node-action, bestaande via `npm run migrate -- formaten`. De app laadt een formaat en valt terug op het origineel. [WP17b](./work-packages/WP17b-foto-acties.md) ✅ 2026-11-08: foto-menu en selectie (per foto, met melding wat niet mocht), draaien en spiegelen, uit album, verwijderen, album- of groepscover en profielfoto (alleen een eigen foto). Een foto wissen wist ook de profielfoto met dat beeld. Gate groen. [WP18](./work-packages/WP18-foto-upload.md) ✅ 2026-11-08: foto's uploaden in een album (JPEG ≤ 4032, met datum en locatie, opnieuw proberen zonder dubbele foto's) en profielfoto uploaden en weghalen. Red-team en drie fix-cycli; gate build 57 groen. [WP26](./work-packages/WP26-test-functies-geheim.md) ✅ 2026-11-08: de `_test`-functies en `/_test/whoami` op dev werken alleen met het testgeheim; vóór T0 checken dat de env-vars niet op prod staan. [WP28](./work-packages/WP28-groepsbeheer.md) ✅ 2026-11-09: groepsbeheer volgens de v1-regels (oprichter beschermd, alleen admins nodigen uit), met schermen voor maken, bewerken, rollen, overdragen, verlaten en verwijderen. [WP22](./work-packages/WP22-login-code.md) ✅ 2026-11-09: de login-mail blijft van Clerk met alleen de code (geen Clerk Pro); iOS biedt de code aan vanuit de Mail-app. [WP29](./work-packages/WP29-account-verwijderen.md) ✅ 2026-11-10: een lid verwijdert zijn account in de app door `verwijder` in te typen; het account gaat direct op slot, Convex ruimt in stappen op, en de Clerk-user gaat weg met herhaling en een mail aan de webmaster als het blijft mislukken. [WP27](./work-packages/WP27-profiel.md) ✅ 2026-11-12: Profiel met de foto bovenaan en de naam één keer bewerkbaar; als profielfoto elke foto waar je toegang toe hebt, met een melding die de eigenaar noemt. Wie de toegang kwijtraakt, verliest ook de profielfoto; een gemelde foto wordt geen profielfoto. Een standaard-knor blijft. [WP17c](./work-packages/WP17c-mijn-fotos.md) ✅ 2026-11-12: Mijn foto's (nieuwste upload eerst, schakelaar "Niet in een album"), foto's toevoegen aan een album vanuit de selectie, en in het detail de albums van een foto, alleen uit je eigen groepen. Mijn foto's laadt in één groeiende query (grens rond 2000 foto's; echt bladeren staat in de backlog). Kaart, locatie en delen: WP17d. [WP17d](./work-packages/WP17d-kaart-locatie-delen.md) ✅ 2026-11-13: kaart per album (Apple Maps, exacte plek voor groepsleden), locatie wijzigen of weghalen door de eigenaar met plaatsnaam via Photon, en delen in *groot* via het iOS-deelmenu, met een melding bij andermans foto. Geen bestand dat de backend geeft bevat nog GPS: originelen en profielbeelden gaan door een schoonmaker die bij twijfel niets geeft. Twee fix-cycli; de tweede herstelt het foto-menu bij andermans foto (regressie uit WP17c). [WP19a](./work-packages/WP19a-ratings-schrappen.md) ✅ 2026-11-13: ratings geschrapt. De iPhone-app had ze nooit, de oude webapp had likes (12, de laatste in 2022-12). Bij T0 vallen ze bewust weg en meldt de transform het aantal. Daarmee vervallen de leesgrenzen bij vertrek en account verwijderen met veel ratings. [WP19b](./work-packages/WP19b-uitnodigen-aanmelden.md) ✅ 2026-11-14: uitnodigen en aanmelden. De uitnodigingsmail heeft geen link; de genodigde logt in de app in met een code op dat adres. Een nieuw lid krijgt alleen een account met een open uitnodiging, en die wordt dan meteen geaccepteerd. Een bestaand lid accepteert of wijst af in Profiel → Uitnodigingen (met de groepsfoto); een admin ziet en trekt open uitnodigingen in bij Leden. Clerk bot sign-up protection staat uit (anders vraagt Clerk ook bij inloggen een captcha). [WP19c](./work-packages/WP19c-uitnodigingsmail-opmaak.md) ✅ 2026-11-14: de uitnodigingsmail heeft weer opmaak (licht en donker) en de groepsfoto, rechtop en zonder metadata, plus een knop naar de App Store. Een mail met foto gaat via Mailjet SMTP, zodat de foto in iPhone Mail één keer staat; lukt SMTP niet, dan gaat de mail zonder foto. Mailjet meet geen opens of kliks meer. De cover op de uitnodigingskaart in de app staat rechtop. [WP30](./work-packages/WP30-afhankelijkheden.md) ✅ 2026-11-14: alle pakketten naar de nieuwste versie binnen de huidige major (Convex 1.50, Clerk, Expo 58.0.25, React Native 0.88.1); geen hoge kwetsbaarheden meer. De app doet alles nog net zo. [WP20](./work-packages/WP20-melden.md) ✅ 2026-11-15: een lid meldt andermans foto via het foto-menu; de eigenaar krijgt een mail zonder melder of reden, ziet de foto in Profiel → Gemelde foto's en kan bezwaar maken. De webmaster beslist in de app (laten staan, bezwaar afwijzen, meteen verwijderen) en ziet daarvoor het beeld, alleen in het geheugen. Ideeën en problemen doorgeven en stemmen; de webmaster zet de status. Een gedeeld S3-beeld stopt de migratie. [WP21](./work-packages/WP21-videos.md) ✅ 2026-11-15: leden van Blob bibliotheek bekijken de clubfilms (tab Films, Trailers en Blockbusters) met een ondertekende S3-link van 3 uur uit de backend; spoelen werkt, de film pauzeert buiten beeld en staat nooit op het toestel. Bucket dicht op T0. [WP32](./work-packages/WP32-thuisgroep-ui-fixes.md) ✅ 2026-11-18: na inloggen en via Home naar de groep die je het laatst bezocht (per user, lokaal); het foto-detail verspringt niet meer, en het toetsenbord bedekt geen velden of knoppen. [WP33](./work-packages/WP33-animaties.md) ✅ 2026-11-18: koppen bewegen bij scrollen, tegels en knoppen krimpen bij indrukken, het informatieblok vervaagt bij swipen, meldingen en tegels faden in, haptics; uit bij "Beperk beweging". [WP34](./work-packages/WP34-afhankelijkheden-lokaal-bouwen.md) ✅ 2026-11-18: drie Expo-patches, en lokaal bouwen op de server (geen EAS-tegoed). Picomatch (Dependabot) blijft open: er is geen gerepareerde versie, en het zit alleen in de bouwtools.

**Bouwvolgorde, feature voor feature**

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
6. Invites
7. Features/problem reporting
8. Flagging (`Inappropriate.jsx` voor user, `InappropriateAdmin.jsx` voor webmaster, flag-knop + `HelperFlaggedPhotoModal` in `PhotoMenu.jsx`)
9. **Video's + covers.** 10 clubfilms (~19 GB) met 9 cover-PNG's per reis, in S3-bucket `blob-videos`. Staan **niet** in DynamoDB en gaan niet naar Convex (besluit 2026-08-23, zie [`WP12`](./work-packages/WP12-data-migratie-tooling.md) §Video's) — de verwijzing zit in de oude front-end. De nieuwe app moet ze weer tonen; bron blijft S3 tot de R2-overstap. Uitzoeken bij het bouwen: hoe de oude app de lijst en de covers opbouwt.

Per feature: het gedrag van de oude app is de checklist, data komt via `useQuery` / `useMutation`. Wie de oude app nog heeft, blijft tot cutover op AWS werken.

### Track B: Webapp ✅ live 2026-11-21

Besluit Wouter 2026-11-15: niemand gebruikt de oude webapp. Volgorde: eerst de oude webapp uitzetten (vóór de overstap), dan de iPhone-app overzetten, later een nieuwe webapp toevoegen. **Oude webapp uit sinds 2026-11-15**: clubalmanac.com toont een pagina die naar de app verwijst plus de privacyverklaring ([`site/README.md`](../site/README.md)), dev.clubalmanac.com is uitgeschakeld. 
[WP35](./work-packages/WP35-webapp-bekijken.md) ✅ 2026-11-20: Expo Web op `app.clubalmanac.com`, alleen bekijken plus uitnodigingen accepteren; beelden met de header in een begrensd geheugen, CORS alleen voor de eigen adressen, kaart via OpenStreetMap, op breed scherm een zijkolom. Audit en red-team verwerkt (deploy-rol via de GitHub-environment `webapp`, CSP).

[WP36](./work-packages/WP36-webapp-uploaden.md) ✅ 2026-11-20: Foto's uploaden vanuit de browser (vooral Chrome op Android) en de profielfoto zetten of weghalen, via de bestaande `/upload` met CORS; verkleinen en EXIF lezen in de browser, datum en plaats als headers. Audit en red-team verwerkt. Gate op een Android-emulator (Chrome) tegen dev: uploaden, terug tijdens een ronde, kaart, film, profiel, uitloggen. Niet getest: Safari, een echte HEIC, 50 grote foto's.

**Livegang 2026-11-21:** runbook [`webapp.md`](./runbooks/webapp.md) stap 1–12 gedaan (stack met CSP inclusief Clerk Protect, uitrol via de workflow Webapp, `CLUBALMANAC_WEB_URL` op prod). Fixes na de eerste ronde op prod (PR 43–45, 48): vaste terugknop op smal scherm, het foto-detail blijft op de gekozen foto en toont er één, beelden in beeld blijven in het geheugen, en een nieuwe profielfoto is meteen zichtbaar. Foto-acties (uit album, verwijderen, als profielfoto) zitten bewust niet in de webapp; dat kan een nieuwe WP worden.

## Na de livegang

[WP37](./work-packages/WP37-filmpjes-in-albums.md) ✅ 2026-11-22: filmpjes in albums (hooguit 3 minuten), op de iPhone verkleind naar 1080p, opslag in Cloudflare R2, met poster, duur en plek op de kaart, ook in de webapp. Audit en red-team verwerkt. Gate op een iPhone 15 Pro tegen dev met echte R2: verkleinen, tonen, afspelen, geluid, kaart, doorgaan na een app-switch, eerste tik op Uploaden. Live met app 2.0.2; daarvoor nog R2 op prod en de backup van R2 (Wouter).

## Fase 5: Lancering — hard cutover — open

Geen parallel draaien. Bij 20 users en een 3 jaar oude oude app is parallel draaien absurd veel werk (dual-write, sync layer, Cognito↔Clerk mapping). Hard cut.

### Constraints

De oude iPhone app heeft **geen `expo-updates` en geen `expo-notifications`** geïnstalleerd. Dat betekent:
- Geen OTA mogelijk → geen forced-upgrade screen via code-push
- Geen push notifications mogelijk
- Een laatste oude-stack release submitten naar App Store wordt afgeraden: SDK 47 / RN 0.70 voldoet niet meer aan Apple's huidige eisen (privacy manifests, min-iOS targets), submit gaat moeizaam zijn voor een codebase die je toch al gaat vervangen.

Dus: communicatie en blokkade gaan **buiten de oude app om**.

### Cutover-mechanieken

**1. Out-of-band communicatie (primair kanaal)**
- WhatsApp/email blast naar alle 20 users met datum X: de nieuwe app komt als update van de bestaande (zie fase 4 Track A)
- 1 week vooraf, opnieuw 1 dag vooraf
- Voor de 20 users persoonlijk genoeg om hard genoeg aan te komen

**2. Herinnering in de oude app** ([WP31](./work-packages/WP31-cutover.md) W2)
- Een album "Nieuwe app komt binnenkort" in Blob bibliotheek (18 van de 19 leden zitten erin). Geen cutover-groep: de oude app opent op de laatst bezochte groep.
- De transform sluit het album uit (`excludeAlbumIds`), zodat hij niet mee naar prod gaat.

**3. Schrijfstop** (WP31 W1)
- Twee policies, geen code: een resource policy op de DynamoDB-tabel die schrijven weigert (behalve voor de stream-Lambda), en een statement op bucket `blob-images` dat `PutObject`/`DeleteObject` onder `protected/` weigert. Terugdraaien: beide weghalen.
- Kijken in de oude app blijft werken. De schrijfstop gaat vóór de laatste `extract` (invariant 2).

**4. Oude webapp uit**
- Gedaan 2026-11-15, vóór de overstap: clubalmanac.com toont een pagina die naar de iPhone-app verwijst, dev.clubalmanac.com is uit. Een nieuwe webapp komt na T0.

### Cutover stappenplan

**Stand 2026-11-19:** T0.1 tot en met T0.8 gedaan: schrijfstop (beide controles geweigerd), migratie met `verify` groen (19 users, 2 groepen, 15 albums, 1511 foto's, 4540 storage-objecten), `formaten` 67 min, filmlijst 9 items, anker `backups/wp31-prod-t0.zip` (5,3 GiB), demo-groep, 2.0.0 (build 70) ingediend met handmatige release. 2026-11-20: T0.9 tot en met T0.11 gedaan (vrijgegeven, in de NL-App Store, bericht 4, migratie-key weg, `BACKUP_ENABLED=true`). `blob-videos` blijft voorlopig open.

Per stap wie, wat, verwacht en bij afwijking: [`wp31-cutover-draaiboek.md`](./runbooks/wp31-cutover-draaiboek.md). Punt zonder terugkeer: *Release This Version* in App Store Connect.

- [x] T-4 weken: Convex prod, Clerk prod (Hobby, test mode permanent aan), Mailjet prod, env-vars (zonder `WEBMASTER_EMAILS`), rooktests WP5/WP6/WP29, IAM-user films (alleen `s3:GetObject` op `blob-videos/*`), "Cannot Sell App" verklaren (app uit de winkel; terug na goedkeuring 2.0.0), backend via `npm run deploy:prod`, cutover-build met `pk_live`, backup-stack ([`infra/backup.md`](../infra/backup.md)), workflow nog uit
- [x] T-3 weken: vervallen, versneld naar de T0-dag (adres-check zit in bericht 3)
- [x] T-1 week: herinneringsalbum, `prod-config.json` met uitsluitingen, Clerk pre-create en ID-map met `clerk-ids --create --write`, rol van de schrijfstop-uitzondering nagekeken, WP31 op prod, generale repetitie op prod (gate: schrijfstop op AWS-dev, `formaten` exit 0, `verify` groen, Wouter ziet 3 groepen, album van 540 foto's opent), daarna `reset --all`
- [x] T0 (2026-11-19/20; alleen `blob-videos` dicht staat nog open): schrijfstop → migratie → `WEBMASTER_EMAILS`, filmlijst en anker-export met bestanden → demo-account → indienen met handmatige release → *Release This Version* → Nederland en België op *Available* → leden inlichten en `blob-videos` dicht, zodra de app in de App Store staat → migratie-key intrekken, backup aan
- [ ] T+1: alle leden ingelogd
- [ ] Een week na T0.10: backup met de hand en teruggezet (gate B4)
- [ ] T+30: kwartaal-herinnering backup, `scripts/.data/` en prod-sleutels opgeruimd, AWS opgeruimd behalve `blob-images` en `blob-videos`
- [ ] T+90: `blob-images` weg, na een bewezen terugzet. **`blob-videos` blijft** tot de R2-overstap.

## Monitoring & backup (ongoing) — open

- [ ] **Backup:** maandelijkse export met bestanden via GitHub Action naar S3 (WP31 W9/B4, [`infra/backup.md`](../infra/backup.md)). Geen Convex Pro. Gate: één run met de hand en teruggezet, ongeveer een week na de vrijgave.
- [x] **Integriteits-checks:** dagelijkse controle ([WP10]), ook op ontbrekende formaten. Vondst 2026-11-20: een beschadigde JPEG kreeg geen formaten. Fix (PR 46–47): een herkansing een kwartier na de upload, en zo'n JPEG wordt opnieuw gelezen zonder de grens op waarschuwingen. De foto op prod is hersteld.
- [ ] **Monitoring:** Convex Health & Insights dashboard (gratis), function errors in dashboard
- [x] **Alerting:** integriteits-checks sturen email bij inconsistentie ([WP10])

## Cyclus-2 backlog (audit-12 follow-up)

- **Integration smoke-test voor upload-flow**: race-409 verifie via parallel POST met zelfde X-Upload-Id (Convex OCC race-detectie pinnen) + JWT round-trip met echte Clerk-token. Gepland voor **[WP7]** of fase 4.
- **Integrity-check storage orphans**: scheduled function die storage objects zonder photo-record detecteert en alert/cleanupt. Audit-10 + audit-12 §5 identificeerden deze gap. Werkpakket: monitoring/integrity-checks (TBD).
- **`.take(N)` guard in cleanupOld**: preventieve cap tegen toekomstige transactie-limit overschrijding (16k records). Niet kritiek bij huidige schaal maar grow-guard waardig.

## Pre-cutover deferred items

WP5/WP6 deferred items zijn nu verdeeld over fase 2 en fase 5:

- **Backend-code** (fase 2, [ ]-bullet bovenaan §Fase 2): WP5/WP6 integration-tests `tests/integration/mailjet/sendRoundtrip.test.ts` + `tests/integration/clerk/onboardingWebhook.test.ts`
- **Prod-env activatie + Gates herhalen** (fase 5 T-4 weken, zie §Cutover stappenplan): prod env-vars, Mailjet prod webhook-config, Clerk prod webhook-config, WP5 Gates 1+2 herhalen, WP6 Gates 1+2+3 herhalen
- **`userVisits` onder de FK-controle van WP10** (vondst WP16-A): `reset` leegt alleen `MONITORED_TABLES`, en `userVisits` staat daar niet in. Na een dev-herlaadbeurt wijzen de oude rijen naar users die niet meer bestaan; niemand ziet het, want geen publieke query of scan leest de tabel. Op prod is hij op T0 leeg. Fix: een FK-controle op `userVisits.userId` in WP10, dan neemt `reset` hem vanzelf mee. Tot dan: bij elke dev-herlaadbeurt de tabel in het dashboard leegmaken (WP16 §sortDate, stap 7).
- **`users.lastVisitAt` opruimen** (na WP15b): het bezoek staat nu in een eigen tabel. De transform (WP12) neemt `visitDateLast` niet meer mee, en het veld gaat uit het schema. Eerst de dev-rijen leegmaken, anders faalt de schema-check.

Reden voor split: integration-tests zijn écht backend-code (env-var-gated, in CI-uitsluitingslijst per `integration-tests.md`) — past in fase 2. Prod-env-activatie heeft pas zin in T-4 weken (idle prod-deployment eerder = cost + drift-risico, plus Gates moeten toch herhaald worden vlak vóór T-0).

## Hoe dit doc bijwerken

Per WP-closeout: regie update de relevante regels hier mee in dezelfde commit als de audit-track-record-entry. WP-referenties zijn in `[WP<n>]`-vorm voor traceability. Open items mogen oude AWS-handler-namen (cascade matrix codes) bewaren want die referenties zijn permanent.
