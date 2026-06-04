# WP11: Deferred integration-tests (WP5 Mailjet sendRoundtrip + WP6 Clerk onboardingWebhook)

> Regie-draft. A vult onderaan aan (spec-criticus). Daarna schrijft A direct de tests — **geen B-fase** (zie §Workflow-afwijking).

## Productdoel

Mailjet's silent-sender-failure-pad en Clerk's Svix-HMAC + atomic-onboarding-pad worden gepind tegen de echte services, zodat contract-regressies (sender-verification, payload-shape, signing-discipline, region-suffix-URL) door een groene WP-impl heen niet stilletjes naar cutover schuiven.

## Workflow-afwijking — A + audit, geen B

Per [`integration-tests.md`](../conventions/integration-tests.md) §Discipline (regel 59-64): voor pure pin-the-contract integration-tests is **A + audit de norm**, niet de volle A→B→audit. B-fase wordt alleen toegevoegd wanneer de pin een productie-code-wijziging vereist (bv. nieuwe httpAction die nodig is om iets testbaar te maken).

WP11 pin't bestaande WP5+WP6 productie-code zonder die aan te raken. Verwachte flow:
1. **Regie**: deze draft, commit + push
2. **A-sessie**: spec-criticus-aanvulling + schrijft `tests/integration/mailjet/sendRoundtrip.test.ts` + `tests/integration/clerk/onboardingWebhook.test.ts` + doc-deliverables (zie §Acceptance) + commit + stop
3. **Regie**: review A's commit, beslis audit-go of mini-fix-eerst
4. **Audit-sessie**: rapport in chat
5. **Regie**: bij groen → WP11-closeout, fase 2 → AFGEROND

Als A onderweg ontdekt dat een nieuwe httpAction/helper nodig is om iets testbaar te maken: stop + rapporteer aan regie. Dan switchen we naar A→B→audit voor dat deel.

## Invarianten

### Mailjet sendRoundtrip

1. **Verified-sender pre-check**: integration-test asserteert dat de bestaande Mailjet verified-sender-REST-call (`/REST/sender` of equivalent uit `convex/lib/mailjet.ts`) een onverified-sender herkent en throwt vóór de send. Dit pin't de WP5 hard-gate uit `external-services.md` §Known issues #2 (silent failure bij niet-gevalideerde sender). De gate is precies waar Mailjet's "200 OK ondanks niet-verzonden" bias zit — unit-tests mocken 'm weg, deze test pin't 'm tegen de echte REST API.
2. **Send happy-path**: één echte send vanaf een verified sender (`info@` of `invites@`) naar de bestaande test-bestemming `clubalmanac-integration-regular@example.com` (zelfde patroon als WP4/WP7-test-user). Response = 200 met geldige `MessageID` (string, niet-leeg). **Geen** follow-up message-status-poll (Mailjet eventual-consistency maakt test flakier; sender-verification is de echte silent-failure-gate, gepind in invariant 1).
3. **Region-suffix discipline-pin**: test gebruikt hardcoded `CONVEX_URL` met region-suffix uit `.env.integration`. Test faalt loud bij missende of foutieve region-suffix. WP5-audit S-3-precedent (404 op webhook-URL zonder region).
4. **Primary-key only**: test gebruikt de primary Mailjet API-key uit dev-deployment. Geen sub-account-keys (WP5 known issue #3).
5. **Geen mailbox-pollutie-checks**: test verifieert niet of de mail in de inbox aankomt — alleen dat Mailjet hem accepteert (sender-verified + 200 + MessageID). Inbox-arrival is buiten test-scope want niet-deterministisch.

### Clerk onboardingWebhook

6. **Capture-and-replay payload**: test gebruikt een vooraf gecapturede echte Clerk `session.created`-webhook-payload (fixture-file, niet in repo gecommit — staat in `.gitignore`'d folder, pad in `.env.integration`). Test stuurt deze payload via `fetch` naar `/clerk-webhook` met geldige Svix-headers (signature gegenereerd met `CLERK_WEBHOOK_SECRET` uit env). Dit pin't payload-shape én Svix-HMAC-verify in één test — dichter bij echte contract dan een self-generated mock-payload (vraag #3-keuze in kickoff).
7. **Atomic onboarding-pad geverifieerd**: na de webhook-call leest test via `ConvexHttpClient` dat:
   - `users`-row bestaat voor de fixture-`subject` met juiste email + naam
   - Eventuele pending invites voor diezelfde email zijn ge-accept (status `accepted` + `respondedAt` gezet)
   - Memberships zijn aangemaakt per geaccepteerde invite
   - Alles met dezelfde `createdAt`-timestamp (atomic-transactie-pin)
8. **Fresh subject per run**: elke test-run genereert een **nieuw** Clerk-`subject`-ID (random UUID-prefix bv. `user_wp11_<timestamp>`) zodat de insert-pad daadwerkelijk wordt geraakt — niet stilletjes het `register`-idempotency-pad. Bestaand `clubalmanac-integration-regular@example.com` mag **niet** als subject hergebruikt worden (zou onboarding niet meer triggeren).
9. **Webhook 401-pad**: tweede sub-test stuurt zelfde payload met **gemanipuleerde** signature → assert 401 (of 503 als secret ontbreekt). Pin't de Svix-verify-discipline.
10. **Region-suffix discipline-pin**: zelfde als invariant 3 — `/clerk-webhook` URL gebruikt region-suffix.

### Self-protection + cleanup

11. **Self-cleanup**: na de Clerk-test deletet test zelf de fixture-`users`-row + alle bijhorende memberships + albumLastSeen via `ConvexHttpClient` calls (zelfde patroon als WP7-test). Test eindigt met de DB in dezelfde staat als ervoor (uitgezonderd Mailjet's send-log die we niet zien). Mailjet-test heeft geen cleanup-spoor in DB.
12. **`assertNotProd`-safety**: beide tests roepen `assertNotProd(process.env.CONVEX_URL)` als eerste statement aan. Hergebruik bestaande helper uit `tests/integration/_helpers/safety.ts`. Test weigert te draaien tegen prod-URL — twee-laags-self-protect via deze assert + Convex dashboard `INTEGRATION_TEST_ENABLED`-env-var.
13. **`INTEGRATION_TEST_ENABLED`-gate**: niet direct toepasselijk hier (gate is voor `convex/_test.ts`-functions, niet voor pure integration-tests die externe contracten pinnen). Maar tests skippen wel netjes met duidelijke reason als één van de vereiste env-vars ontbreekt (geen stille pass).

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
- **Self-generated payload voor Clerk** (kickoff-vraag #3 = optie b): afgewezen, want pin't alleen Svix-HMAC-mechaniek, niet de echte Clerk-payload-shape. Capture-and-replay is dichter bij contract.
- **Productie-code-edits**: WP11 raakt alleen `tests/integration/`, runbook + docs. Geen `convex/`-file-edits, geen schema-change, geen helper-additions. Als A onderweg ontdekt dat een edit nodig is: stop + rapporteer (workflow-afwijking switcht dan naar A→B→audit voor dat deel).
- **Bounce-webhook integration-test**: niet opnieuw — al gedaan in WP5 Gate 2 dev 2026-05-18 als handmatige echte-bounce + replay-test. Geen automatisering nodig; runbook §pre-cutover wijst naar handmatige herhaling.

## Risico-assessment

- **security/privacy: medium** — echte Mailjet API key + Clerk signing-secret in `.env.integration` (gitignore'd). Self-protection via `assertNotProd`-helper + Convex `INTEGRATION_TEST_ENABLED`-gate-on-deployment. Capture-replay fixture-file zou theoretisch een echte user-subject kunnen lekken; bewaring in gitignore'd folder + niet committen. Sender-verified-check zelf raakt geen PII (alleen sender-address).
- **ops: medium** — silent-failure-vector is precies wat we pinnen (Mailjet 200-bij-onverified-sender). Test-flakiness (Mailjet/Clerk service-uptime) reëel maar acceptabel — falen om externe reden is observable in test-output, geen stille pass. Skip-reason bij ontbrekende env-vars duidelijk (niet stilletjes overslaan).
- **external deps: medium** — twee externe services. Mailjet sandbox 6000/maand voldoende. Geen rate-limit-risico bij occasional runs. Region-discipline gepind in invarianten 3+10.
- **multi-user/concurrency: laag** — sequentiele tests, single-tenant.
- **data/schema-evolutie: laag** — geen schema-change. Clerk-test maakt DB-state aan + ruimt zichzelf op (invariant 11). Mailjet-test heeft geen DB-spoor.
- **ops-runbook-impact**: één nieuwe runbook (combo, `wp11-deferred-integration-gates.md`), `.env.integration.example` uitbreiden, `integration-tests.md`-tabel-update. Géén nieuwe env-vars op prod-deployment (hergebruik bestaande Mailjet/Clerk dev-secrets; prod-vars staan al in fase-5-stappenplan).

## Cross-refs

- **`integration-tests.md`** — workflow-norm (A+audit), test-laag-architectuur, `INTEGRATION_TEST_ENABLED`-gate
- **`external-services.md`** — Mailjet §Known issues (silent-sender-failure hard gate), Clerk §Webhook-config (URL region-suffix, Svix-HMAC, verification-required-flag)
- **WP5-spec** §Integration-tests (regel 70-73): deferred-status nu pinned als landed
- **WP6-spec** §Integration-tests (regel 69-71) + audit-track-record WP6 should-fix-4: deferred-status nu pinned als landed
- **WP7-runbook** `docs/runbooks/wp7-upload-gate.md`: precedent voor runbook-structuur + `clubalmanac-integration-regular@example.com`-bestemming-keuze + `assertNotProd`-pattern + cleanup-discipline
- **audit-track-record**: WP5-audit S-3 (region-suffix-URL bug) en WP6-audit should-fix-4 (integration-test-deferral) zijn directe precedenten voor invarianten 3+10
- **oude AWS-code**: n.v.t. — integration-test-laag is Convex-only

## Acceptance — hoe weten we dat het klaar is

**Tests** (A schrijft, geen RED-fase want pure pin-the-contract — groen-vanaf-eerste-run is acceptabel per integration-tests.md):

- `tests/integration/mailjet/sendRoundtrip.test.ts`:
  - Sub-test 1: verified-sender pre-check (positief — verified sender → no throw)
  - Sub-test 2: onverified-sender pre-check (negatief — onverified sender → throw met `UNVERIFIED_SENDER:`-prefix)
  - Sub-test 3: send happy-path (verified sender → 200 + niet-lege `MessageID`)
- `tests/integration/clerk/onboardingWebhook.test.ts`:
  - Sub-test 1: capture-and-replay happy-path (200 + DB-staat correct)
  - Sub-test 2: gemanipuleerde signature → 401 (of 503 als secret ontbreekt)
  - Sub-test 3: cleanup runt en deletet alle fixture-state

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

## Spec-criticus aanvullingen (A vult in)

A leest spec + `integration-tests.md` + `external-services.md` Mailjet+Clerk-secties + WP5/WP6-specs + WP7-runbook-precedent + bestaande `tests/integration/`-structuur (niet bestaande convex/-impl). Vult hier aan:

- Ontbrekende invarianten: ...
- Gemiste edge cases: ...
- Risico-dimensie die regie overschatte/onderschatte: ...
- Open product-vragen voor regie/Wouter: ...
- Capture-replay fixture-strategie: A's exacte plan (waar wordt de fixture lokaal bewaard, hoe wordt hij vervangen bij rotatie van Clerk-secret, etc.)
- Cleanup-volgorde Clerk-test: A's plan (memberships eerst? users-row laatst? albumLastSeen?)

(Leeg in draft. A commit edits hier.)
