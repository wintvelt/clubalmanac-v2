# WP11: Deferred integration-tests (WP5 Mailjet sendRoundtrip + WP6 Clerk onboardingWebhook)

> Regie-draft. A vult onderaan aan (spec-criticus). Daarna schrijft A direct de tests — **geen B-fase** (zie §Workflow-afwijking).

## Productdoel

Mailjet's silent-sender-failure-pad en Clerk's Svix-HMAC + atomic-onboarding-pad worden gepind tegen de echte services, zodat contract-regressies (sender-verification, payload-shape, signing-discipline, region-suffix-URL) door een groene WP-impl heen niet stilletjes naar cutover schuiven.

## Workflow — split: Mailjet A+audit, Clerk A→B→audit

Per [`integration-tests.md`](../conventions/integration-tests.md) §Discipline: voor pure pin-the-contract integration-tests is A+audit de norm; B-fase alleen wanneer de pin productie-code-wijziging vereist. A's spec-criticus-pass (zie aanvulling onderaan) maakte de split expliciet:

**Mailjet-helft — A + audit, geen B.** Test pin't het externe Mailjet-contract direct via `fetch` naar Mailjet's Send API. Geen Convex-code aangeraakt. Pure pin-the-contract.

**Clerk-helft — A → B → audit.** Test moet `users`/`memberships`/`invites`/`albumLastSeen` lezen + opruimen voor een fresh subject, zonder Clerk JWT. Per [`integration-tests.md`](../conventions/integration-tests.md) §Test-only-Convex-functions vereist dat nieuwe `convex/_test.ts`-helpers (`INTEGRATION_TEST_ENABLED`-gated). Dat is productie-code-wijziging → A schrijft RED tests verwijzend naar nog-bestaande helpers, B implementeert, audit reviewt.

Verwachte flow:
1. **Regie**: deze draft + spec-correctie post A's spec-criticus-pass, commit + push
2. **A-sessie**: schrijft `tests/integration/mailjet/sendRoundtrip.test.ts` (pin't Mailjet direct) + `tests/integration/clerk/onboardingWebhook.test.ts` (RED, refereert aan toekomstige `convex/_test.ts`-helpers) + doc-deliverables, commit + stop
3. **Regie**: review A's commits, geef B groen licht voor de Clerk-helpers
4. **B-sessie**: implementeert `convex/_test.ts`-helpers tot Clerk-test groen wordt, commit + stop
5. **Audit-sessie**: rapport over de combined diff
6. **Regie**: bij groen → WP11-closeout, fase 2 → AFGEROND

## Invarianten

### Mailjet sendRoundtrip

**Pin't het externe Mailjet-contract direct via `fetch` naar de Send API — niet via `convex/lib/mailjet.ts`.** Onze interne sender-gate (`isSenderVerified` op `MAILJET_VERIFIED_SENDERS` env-var) is een pure logica-check, al unit-getest, en hoort hier niet thuis. Wat we hier pinnen is *Mailjet's eigen gedrag* — en specifiek de silent-failure-bias die WP5's setup-time-gate motiveerde.

1. **Silent-failure pin (onverified From)**: directe `fetch` naar Mailjet Send API met een onverified From-address (een variant die expliciet **niet** in `MAILJET_VERIFIED_SENDERS` staat — bijv. `unverified+wp11@example.com`). Verwachte response = **200 OK** met body die *geen* successful-send indicatie geeft (geen bezorgings-MessageID, eventueel een sender-status-veld). Dit pin't Mailjet's silent-failure-gedrag empirisch. **Als Mailjet ooit z'n gedrag wijzigt** (bv. 400 in plaats van silent 200), faalt deze test — exact wat we willen weten vóór cutover.
2. **Send happy-path (verified From)**: directe `fetch` naar Mailjet Send API met een verified From (`info@<verified-domain>` of `invites@<verified-domain>`, uit `MAILJET_VERIFIED_SENDERS`) naar test-bestemming `clubalmanac-integration-regular@example.com`. Verwachte response = **200 OK** met body die een geldige `MessageID` retourneert (string, niet-leeg). Pin't dat het happy-pad daadwerkelijk een send produceert.
3. **Primary-key only**: test gebruikt de primary Mailjet API-key uit dev-deployment via `MAILJET_API_KEY` + `MAILJET_API_SECRET`. Geen sub-account-keys (WP5 known issue #3).
4. **Geen mailbox-pollutie-checks + geen message-status-poll**: test verifieert niet of de mail in de inbox aankomt en doet geen follow-up `/REST/message/{ID}`-poll. Sender-pre-check + 200 + MessageID is de testbare contract-grens; inbox-arrival en message-status zijn mens-stap in cutover-week (zie runbook §pre-cutover) en Mailjet's eventual-consistency maakt automated poll te flaky.

### Clerk onboardingWebhook

5. **Synthesized-but-faithful payload + fresh subject**: test bouwt per run een Clerk `session.created`-webhook-payload (helper bv. `tests/_helpers/svix.ts`) met **alle velden die de productie-handler daadwerkelijk leest** (`type`, `data.user_id`, `data.user.email_addresses[].email_address`, `data.user.email_addresses[].verification.status`, `data.user.primary_email_address_id`, `data.user.first_name`/`last_name`). De `subject` (= `data.user_id`) is een **fresh** ID per run (bv. `user_wp11_${randomUUID()}`) zodat de insert-pad daadwerkelijk wordt geraakt, niet stilletjes het idempotency-pad. Svix-headers (`svix-id`, `svix-timestamp`, `svix-signature`) worden gegenereerd met de echte `CLERK_WEBHOOK_SECRET` uit `.env.integration` — dat pin't Svix-HMAC-verify tegen de productie-discipline (geen self-bypass). Geen gecommitte capture-fixture (raakt verouderd zonder dat we 't merken).
6. **Atomic onboarding-pad geverifieerd via test-only helpers**: na de webhook-call leest test via nieuwe `convex/_test.ts`-helpers (B levert) dat:
   - `users`-row bestaat voor de fixture-`subject` met juiste email + naam
   - Eventuele pending invites voor diezelfde email zijn ge-accept (status `accepted` + `respondedAt` gezet)
   - Memberships zijn aangemaakt per geaccepteerde invite
   - Alle drie writes binnen dezelfde transactie — gepind via gelijke timestamp-waarde op `users.createdAt`, `invites.respondedAt`, `memberships.joinedAt` (drie verschillende velden in drie tabellen, alle drie gezet op één `now` per `registerFromSession`)
7. **Webhook 401-pad**: tweede sub-test stuurt geldige payload met **gemanipuleerde** signature → assert 401 (of 503 als secret ontbreekt). Pin't de Svix-verify-discipline.
8. **Region-suffix discipline-pin**: `/clerk-webhook` URL gebruikt region-suffix (`https://<deployment>.eu-west-1.convex.site/clerk-webhook`). Test faalt loud bij missende of foutieve region-suffix. WP5-audit S-3-precedent (404 op webhook-URL zonder region) geldt onverkort voor Clerk.

### Self-protection + cleanup

9. **Self-cleanup via test-only helpers**: na de Clerk-test deletet test zelf de fixture-`users`-row + alle bijhorende memberships + `albumLastSeen` via nieuwe `convex/_test.ts`-helpers (B levert). Test eindigt met de DB in dezelfde staat als ervoor. Mailjet-test heeft geen cleanup-spoor in DB. **Cleanup-volgorde**: A bepaalt en pin't (memberships eerst, dan albumLastSeen, dan users-row — om FK-orphan-blip te voorkomen tijdens cleanup, ook al duurt 't milliseconds).
10. **`assertNotProd`-safety voor Convex-rakende tests**: tests die de Convex-deployment raken (Clerk-test via `/clerk-webhook` httpAction) moeten `assertNotProd(process.env.CONVEX_URL)` aanroepen. Dit gebeurt nu transitief via `getConvexSiteBase` in [`_helpers/convexSite.ts`](../../tests/integration/_helpers/convexSite.ts) — alle Convex-rakende tests die die helper gebruiken krijgen de check gratis. De Mailjet-test raakt geen Convex (directe `fetch` naar Mailjet's REST API met deployment-agnostische keys) en heeft daarom geen `assertNotProd`-call nodig. [audit-S-2-correctie 2026-06-21: oorspronkelijke invariant zei "beide tests" — te breed; gescoped tot Convex-rakende tests].
11. **`INTEGRATION_TEST_ENABLED`-gate**: de nieuwe `convex/_test.ts`-helpers (voor DB-reads + cleanup) gaten op `process.env.INTEGRATION_TEST_ENABLED === "true"` en throwen anders met duidelijke melding. Env-var staat alleen op dev-deployment, prod krijgt 'm nooit. Twee-laags self-protect: deze gate + `assertNotProd`. Standard `convex/_test.ts`-patroon (WP2-precedent).
12. **Tests skippen netjes bij ontbrekende env-vars**: ontbreekt één van de vereiste vars (`CONVEX_URL`, `CLERK_WEBHOOK_SECRET`, `MAILJET_*`, etc.), dan skipt de betreffende test-file met duidelijke skip-reason — geen stille pass.

## Edge cases + scope-uitsluitingen

**In scope:**
- Twee test-files: `tests/integration/mailjet/sendRoundtrip.test.ts` + `tests/integration/clerk/onboardingWebhook.test.ts`
- Eén combo-runbook: `docs/runbooks/wp11-deferred-integration-gates.md`
- `.env.integration.example` uitbreiden met de vereiste vars (hergebruik bestaande Mailjet/Clerk dev-secrets; geen nieuwe keys)
- `integration-tests.md`-tabel: WP5 status `planned` → `landed`, WP6 toevoegen als `landed`
- Capture-and-replay fixture-file pad in `.env.integration` (fixture zelf in `.gitignore`'d folder, A pikt locatie uit WP7-precedent)

**Bewust niet (voor deze WP):**
- **Mailbox-arrival-check**: test verifieert niet of mail visueel aankomt in inbox. Sender-verified + 200 + MessageID is de testbare gate; visuele inbox-check is mens-stap in cutover-week (zie pre-cutover-sectie in runbook).
- **Mailjet message-status-poll**: niet pinnen (Mailjet eventual-consistency, te flaky voor automated test).
- **Prod-deployment-run**: deze WP draait alleen tegen dev. Prod-Gates herhalen staat in fase 5 T-4-weken-stappenplan (al gedocumenteerd in `migratie-status.md`).
- **Capture-and-replay payload-fixture**: afgewezen na A's spec-criticus-pass. Een gecaptureerde echte payload zou met een **vast** subject komen (botst met invariant 5 fresh-subject) en raakt verouderd zonder dat we 't merken (Clerk wijzigt payload-shape → test blijft groen tegen verouderde fixture). Synthesized-but-faithful met fresh subject + echte HMAC dekt het pinbare contract (Svix-verify + payload-parsing van velden-die-we-lezen + insert-pad).
- **Mailjet sender-pre-check via `isSenderVerified`**: afgewezen na A's spec-criticus-pass. Onze interne env-var-check is een pure logica-functie, al unit-getest. Een integration-test die 'm her-draait pin't geen extern contract. Het echte pinbare gedrag (Mailjet's silent-200 bij onverified From) raakt productie nooit omdat onze gate vóór de fetch blokkeert — daarom in deze WP een **directe** Mailjet-Send-call buiten Convex om, om dat externe gedrag empirisch te bewijzen.
- **Productie-code-edits buiten `convex/_test.ts`**: WP11 raakt geen bestaande productie-code. Wel: B levert nieuwe test-only helpers in `convex/_test.ts` (INTEGRATION_TEST_ENABLED-gated, WP2-precedent) voor de Clerk-DB-reads + cleanup. Geen schema-change, geen impact op niet-test-paden.
- **Bounce-webhook integration-test**: niet opnieuw — al gedaan in WP5 Gate 2 dev 2026-05-18 als handmatige echte-bounce + replay-test. Geen automatisering nodig; runbook §pre-cutover wijst naar handmatige herhaling.

## Risico-assessment

- **security/privacy: medium** — echte Mailjet API key + Clerk signing-secret in `.env.integration` (gitignore'd). Self-protection via `assertNotProd`-helper + Convex `INTEGRATION_TEST_ENABLED`-gate-on-deployment. Capture-replay fixture-file zou theoretisch een echte user-subject kunnen lekken; bewaring in gitignore'd folder + niet committen. Sender-verified-check zelf raakt geen PII (alleen sender-address).
- **ops: medium** — silent-failure-vector is precies wat we pinnen (Mailjet 200-bij-onverified-sender). Test-flakiness (Mailjet/Clerk service-uptime) reëel maar acceptabel — falen om externe reden is observable in test-output, geen stille pass. Skip-reason bij ontbrekende env-vars duidelijk (niet stilletjes overslaan).
- **external deps: medium** — twee externe services. Mailjet sandbox 6000/maand voldoende. Geen rate-limit-risico bij occasional runs. Region-discipline gepind in invarianten 3+10.
- **multi-user/concurrency: laag** — sequentiele tests, single-tenant.
- **data/schema-evolutie: laag** — geen schema-change. Clerk-test maakt DB-state aan + ruimt zichzelf op (invariant 11). Mailjet-test heeft geen DB-spoor.
- **ops-runbook-impact**: één nieuwe runbook (combo, `wp11-deferred-integration-gates.md`), `.env.integration.example` uitbreiden, `integration-tests.md`-tabel-update (WP5 `planned` → `landed`, WP6 toevoegen). Géén nieuwe env-vars op prod-deployment (hergebruik bestaande Mailjet/Clerk dev-secrets; prod-vars staan al in fase-5-stappenplan). `INTEGRATION_TEST_ENABLED` op dev staat al aan sinds WP2.

## Cross-refs

- **`integration-tests.md`** — workflow-norm (A+audit), test-laag-architectuur, `INTEGRATION_TEST_ENABLED`-gate
- **`external-services.md`** — Mailjet §Known issues (silent-sender-failure hard gate), Clerk §Webhook-config (URL region-suffix, Svix-HMAC, verification-required-flag)
- **WP5-spec** §Integration-tests (regel 70-73): deferred-status nu pinned als landed
- **WP6-spec** §Integration-tests (regel 69-71) + audit-track-record WP6 should-fix-4: deferred-status nu pinned als landed
- **WP7-runbook** `docs/runbooks/wp7-upload-gate.md`: precedent voor runbook-structuur + `clubalmanac-integration-regular@example.com`-bestemming-keuze + `assertNotProd`-pattern + cleanup-discipline
- **audit-track-record**: WP5-audit S-3 (region-suffix-URL bug) en WP6-audit should-fix-4 (integration-test-deferral) zijn directe precedenten voor invarianten 3+10
- **oude AWS-code**: n.v.t. — integration-test-laag is Convex-only

## Acceptance — hoe weten we dat het klaar is

**Mailjet-test** (A schrijft, geen B, groen-vanaf-eerste-run acceptabel):

- `tests/integration/mailjet/sendRoundtrip.test.ts`:
  - Sub-test 1: onverified From → directe Mailjet-fetch → 200-zonder-geldige-MessageID (silent-failure-pin)
  - Sub-test 2: verified From → directe Mailjet-fetch → 200 + niet-lege `MessageID` (happy-path)

**Clerk-test** (A schrijft RED, B implementeert helpers tot groen):

- `tests/integration/clerk/onboardingWebhook.test.ts`:
  - Sub-test 1: synth-payload met fresh subject + echte HMAC → POST /clerk-webhook → 200; daarna via `convex/_test.ts`-helpers asserteer users-row + invite-accept + memberships + timestamp-gelijkheid op de drie write-velden
  - Sub-test 2: zelfde payload met gemanipuleerde signature → 401 (of 503)
  - Sub-test 3: cleanup-flow draait succesvol (`afterEach` of einde test), DB-state terug naar baseline

**B's deliverable** — nieuwe `convex/_test.ts`-helpers (alleen actief bij `INTEGRATION_TEST_ENABLED=true`):
- `getUserBySubject` (read)
- `listInvitesByEmail` (read)
- `listMembershipsByUserId` (read)
- `cleanupUserBySubject` (delete users-row + memberships + albumLastSeen, in juiste volgorde per invariant 9)

A bepaalt de exacte helper-namen + return-shapes in z'n RED tests; B implementeert tot de tests groen worden, zonder spec/test-edits.

**Runbook** (`docs/runbooks/wp11-deferred-integration-gates.md`, A levert mee):
- Pre-flight checklist (combined): `.env.integration` vars, Convex dev-deployment, test-user `clubalmanac-integration-regular@example.com` bestaat, Clerk-payload-fixture-pad gezet
- Gate draaien (twee subsecties: Mailjet + Clerk, beide met commando + verwachte runtime + pass-criterium)
- Bij fouten (per service troubleshooting)
- Pre-cutover: zelfde tests tegen prod URL + prod secrets (verwijst naar fase 5 T-4-weken-stappenplan)

**Doc-deliverables** (per commit-discipline standing rule, A levert in zijn commit):
- `.env.integration.example` uitgebreid met WP11-vars (clear comment per var)
- `docs/conventions/integration-tests.md` tabel: WP5 `planned` → `landed`, WP6 toegevoegd als `landed`
- `docs/runbooks/wp11-deferred-integration-gates.md` (nieuw, zie boven)

**Geen empirische mens-gate apart**: de integration-tests *zijn* de empirische gate (echte Mailjet + Clerk roundtrips). Pre-cutover wel handmatig herhalen tegen prod (fase 5).

**Geen unit-tests toegevoegd of gewijzigd**: WP11 raakt alleen `tests/integration/`.

---

## Spec-criticus aanvullingen (A — 2026-06-04)

A heeft spec + `integration-tests.md` + `external-services.md` Mailjet+Clerk-secties + WP5/WP6-impl (`convex/lib/mailjet.ts`, `convex/http.ts`, `convex/users.ts`, `convex/_test.ts`, `convex/schema.ts`) + bestaande unit-suite (`tests/email/mailjetClient.test.ts`, `tests/clerk/webhookAuth.test.ts`, `tests/clerk/webhookPayloadShape.test.ts`, `tests/users/registerFromSession.test.ts`, `tests/_helpers/svix.ts`) + WP7-integration-precedent gelezen.

**Conclusie: A is gestopt vóór de test-fase en rapporteert.** Twee structurele spec-impl-mismatches reframen beide test-files. Eén ervan (Clerk DB-verificatie + cleanup) raakt productie-adjacent code (`convex/_test.ts`) en triggert de §Workflow-afwijking-escape-hatch (→ A→B→audit voor dat deel). A heeft géén tests geschreven; dat wacht op regie-besluiten hieronder.

### BLOKKER 1 — Mailjet invariant 1 pin't een mechanisme dat niet bestaat

Invariant 1 + acceptance sub-tests 1 & 2 gaan uit van een "bestaande Mailjet verified-sender-REST-call (`/REST/sender`)" die "unit-tests wegmocken" en die deze integration-test "tegen de echte REST API" zou pinnen.

Die REST-call bestaat niet. De verified-sender-gate in `convex/lib/mailjet.ts` is een **pure in-memory env-var-check** (`isSenderVerified` leest de comma-separated set `MAILJET_VERIFIED_SENDERS`). Er is geen enkele netwerk-call naar Mailjet's `/REST/sender`. De énige Mailjet-netwerk-call in de codebase is de Send API (`https://api.mailjet.com/v3.1/send`). `external-services.md` known-issue 2 bood twee opties ("REST-call óf setup-time env-var-gate"); de impl koos de env-var-gate.

Gevolg: er is in de gate niets externs te pinnen. Sub-tests 1 & 2 (verified → no throw, onverified → `UNVERIFIED_SENDER:`-throw) zouden pure logica zonder netwerk her-draaien — dat is per definitie geen integration-test, en het is al uitputtend gedekt als unit-test in `tests/email/mailjetClient.test.ts` (verified / ontbrekend / leeg / whitespace / mixed-case + creds-fail-fast). Ze één-op-één naar de integration-laag kopiëren voegt nul contract-dekking toe en schendt "integration-tests pinnen externe contracten, niet ons eigen gedrag".

### BLOKKER 2 — Het écht pinbare Mailjet-contract staat niet in de spec

Het hele bestaansrecht van de gate (known-issue 2): Mailjet retourneert **200 OK óók bij een niet-geverifieerde from-address** — silent failure. Dát is het externe contract dat een integration-test waard is. Maar onze productie-code raakt dat pad nooit (de gate blokkeert de send vóór de fetch). Om Mailjet's echte gedrag te pinnen moet de test de Send API **direct** aanroepen met een onverified From en observeren dat Mailjet 200 teruggeeft terwijl er niets verstuurd wordt. Dat vereist géén productie-code en is veel waardevoller dan onze pure gate her-testen. De spec draait dit om: ze wil de gate (al unit-getest) pinnen en slaat de echte externe verrassing over.

### BLOKKER 3 — `sendMailjetMessage` retourneert `void`; happy-path kan geen MessageID opleveren

Acceptance sub-test 3 wil "verified sender → 200 + niet-lege `MessageID`". Maar `sendMailjetMessage` (`convex/lib/mailjet.ts`) retourneert `Promise<void>` en parsed bewust de 2xx-body niet ("Mailjet's contract op response-shape is onstabiel"). Een MessageID is dus niet uit de productie-functie te halen. Wil je op `MessageID` asserteren, dan moet de test de Send API direct aanroepen (productie-payload-shape repliceren) — legitiem voor een "pin-the-contract"-integration-test, maar de spec suggereert ten onrechte dat het uit bestaande productie-code komt. Alternatief: alleen no-throw asserteren via `sendMailjetMessage` (dan geen MessageID-pin).

### BLOKKER 4 — Clerk DB-verificatie + cleanup vereisen NIEUWE test-only Convex-functies (B-fase)

Invarianten 7, 8 (lees users-row by subject + accepted invites + memberships + albumLastSeen) en 11 (self-cleanup: delete users-row + memberships + albumLastSeen) vereisen lezen/schrijven van DB-state voor een **arbitrair fake subject** (`user_wp11_<ts>`) via `ConvexHttpClient`. `ConvexHttpClient` kan alleen **public** functies aanroepen. In de huidige codebase bestaat:

- géén public query om een user op `subject` te lezen (`getBySubjectInternal` is internal);
- géén public read voor invites-by-email / memberships-by-user / albumLastSeen;
- géén public mutation om user + memberships + albumLastSeen voor een gegeven subject te verwijderen (`deleteSelf` vereist de eigen auth van die user — onmogelijk voor een fake subject; `internalRemoveMember` is internal).

Het WP7-cleanup-precedent werkte omdat `api.photos.remove` een echte public mutation is. WP11 heeft geen equivalent. Verifiëren + opruimen van de onboarding vereist dus NIEUWE functies in `convex/_test.ts` (gegate op `INTEGRATION_TEST_ENABLED`): een by-subject read-back query + een by-subject teardown mutation. Per de spec's eigen §Workflow-afwijking ("nieuwe httpAction/helper nodig → stop + rapporteer → switch naar A→B→audit voor dat deel") én `integration-tests.md` §"Test-only Convex functions" (die expliciet de volle A→B→audit-cyclus triggeren, niet de A+audit-norm) is dit een stop-conditie.

### Wat WEL doelbaar is zonder regie-besluit (ter info, niet uitgevoerd)

- **Clerk live-endpoint-roundtrip** (delen van invarianten 6, 9, 10): met de echte `CLERK_WEBHOOK_SECRET` lokaal een `session.created`-payload tekenen via `standardwebhooks` en POSTen naar `<deployment>.<region>.convex.site/clerk-webhook` → 200; gemanipuleerde signature → 401. Géén productie-code nodig. De toegevoegde waarde t.o.v. de unit-suite (die Svix-verify + payload-shape al pint via in-process `t.fetch`) is uitsluitend: doet de échte gedeployde route het met de échte secret + region-suffix-URL. De DB-verificatie-helft blijft geblokkeerd door BLOKKER 4.

### Gemiste edge cases / accuraatheids-correcties

- **Invariant 7 "dezelfde `createdAt`-timestamp"**: de drie tabellen gebruiken verschillende veldnamen — `users.createdAt`, `invites.respondedAt`, `memberships.joinedAt`. Alledrie krijgen wel dezelfde `now` binnen de transactie, maar de atomic-pin moet op die drie verschillende velden asserteren, niet op één `createdAt`.
- **Re-login vs onboarding (`registerFromSession` r.92-93)**: bestaande subject → idempotent no-op vóór invite-collect. Invariant 8 ("fresh subject per run") is dus terecht, maar de spec moet expliciet maken dat een tweede webhook-call met hetzelfde fresh subject géén tweede invite-accept doet (re-login-pad) — een waardevolle extra pin als we toch test-only read-back bouwen.
- **`resolveVerifiedEmail` (`convex/http.ts` r.121-129)**: onboarding gebeurt alléén bij een `primary_email_address_id` dat naar een `verification.status === "verified"` address wijst. De fixture/payload moet dus een verified primary email hebben, anders is het een 200-no-op (geen users-row) en faalt de assertie om de verkeerde reden.
- **Region-suffix-pin (invarianten 3, 10)**: er is geen onafhankelijke oracle voor "juiste region-suffix". De test kan alleen de `CONVEX_URL` uit env nemen en loud falen als het endpoint 404't/niet resolvet. Het is dus geen aparte assertie maar een gevolg van de `getConvexSiteBase`-helper (`.cloud`→`.site`, region blijft staan) + een echte roundtrip. Framing in de spec bijstellen.
- **`getConvexSiteBase` is gedupliceerd** in `jwtRoundtrip.test.ts` + `uploadRoundtrip.test.ts`. WP11 zou 't een derde keer dupliceren — kandidaat om naar `tests/integration/_helpers/` te tillen (kleine cleanup, geen blokker).

### Open product-vragen voor regie/Wouter

1. **Mailjet reframe (BLOKKER 1-3)**: vervangen we sub-tests 1 & 2 (pure-gate-herhaling) door één echte externe-contract-pin = "directe Send-API-call met onverified From → observeer 200-maar-niet-verzonden" (BLOKKER 2)? En sub-test 3 (happy-path) = directe Send-call → 200 + MessageID (BLOKKER 3)? Of wil regie de Mailjet-helft anders scopen?
2. **Clerk B-fase (BLOKKER 4)**: bevestigen we de switch naar A→B→audit voor de `convex/_test.ts`-helpers (by-subject read-back query + teardown mutation)? Zo niet, dan vervalt de DB-verificatie + cleanup en blijft alleen de live-endpoint-roundtrip-pin (200/401) over — wat grotendeels de unit-suite dupliceert en weinig toevoegt.
3. **Capture-replay vs fresh-subject (invarianten 6 ↔ 8)**: deze twee staan op gespannen voet. Een écht gecapturede payload heeft een echt, vast subject; invariant 8 eist een nieuw subject per run. Zodra je subject + email + `primary_email_address_id` in de capture herschrijft, is het geen pure capture-replay meer. Voorstel: een gesynthetiseerde-maar-getrouwe payload met fresh subject (hergebruik/optil van `tests/_helpers/svix.ts` `sessionCreatedPayload`), niet een gecommiteerde capture-fixture. Akkoord, of wil regie tóch een echte capture (met de bijbehorende manuele-capture-stap + gitignore-fixture)?

### Capture-replay fixture-strategie (afhankelijk van vraag 3)

Als regie tóch capture-replay wil: fixture lokaal in een gitignore'd folder (precedent: WP7's `UPLOAD_GATE_PHOTO_PATH` buiten repo, pad via env-var) — bv. `CLERK_WEBHOOK_FIXTURE_PATH` in `.env.integration`. Bij Clerk-secret-rotatie verandert de payload-inhoud niet (de secret tekent alleen de headers, niet de body); de fixture blijft geldig zolang Clerk's payload-shape niet wijzigt. A's aanbeveling blijft echter vraag-3-voorstel (gesynthetiseerd + fresh subject) boven een gecommiteerde/gecapturede fixture.

### Cleanup-volgorde Clerk-test (afhankelijk van BLOKKER 4-besluit)

Als de teardown-mutation er komt: omgekeerde insert-volgorde, kindrecords eerst. Concreet: albumLastSeen (`by_user`-index) → memberships (`by_user`-index) → users-row laatst. Invites-accept terugdraaien is niet nodig als de test fresh invites zelf seedt; anders ook invites resetten/verwijderen. Dit spiegelt de `deleteSelf`-cascade-volgorde-rationale (`convex/users.ts` r.197-236) maar moet by-subject werken zonder auth, vandaar de gegate test-only mutation.

---

> **Status na A-pass (2026-06-04)**: spec-criticus afgerond, tests NIET geschreven (geblokkeerd op regie-besluiten 1-3 hierboven). Géén `tests/`-, `runbook`-, `.env.integration.example`- of `integration-tests.md`-tabel-edits in deze commit — die wachten op de scope-beslissing. A heeft alleen dit spec-doc aangevuld.
