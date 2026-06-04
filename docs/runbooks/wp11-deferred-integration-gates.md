# WP11 — deferred integration-gates runbook (Mailjet send + Clerk onboarding)

Combo-runbook voor de twee WP11-integration-tests die de tot nu toe alleen-met-mocks-gevalideerde externe contracten van WP5 (Mailjet) en WP6 (Clerk onboarding) tegen de echte services pinnen. Beide draaien tegen de **dev**-deployment; pre-cutover herhalen tegen prod (zie §Pre-cutover + fase 5 T-4-weken-stappenplan in `migratie-status.md`).

| Gate | Test-file | Workflow | Externe service |
|------|-----------|----------|-----------------|
| Mailjet send-roundtrip | `tests/integration/mailjet/sendRoundtrip.test.ts` | A + audit (geen B) | Mailjet Send API v3.1 |
| Clerk onboarding-webhook | `tests/integration/clerk/onboardingWebhook.test.ts` | A → B → audit | Clerk Svix-webhook + Convex DB |

> **Status na A-pass**: de Clerk-gate is **RED** tot B de test-only helpers in `convex/_test.ts` levert (zie §Clerk gate B-deliverable). De Mailjet-gate is groen-vanaf-eerste-run zodra de env-vars staan.

## Pre-flight checklist (gecombineerd)

### A. `.env.integration`

Vul `.env.integration` (gitignored) aan met de WP11-vars uit [`.env.integration.example`](../../.env.integration.example) §WP11. Hergebruik bestaande Mailjet/Clerk dev-secrets — **geen** nieuwe keys.

```
# Convex dev (al gezet sinds WP2) — region-suffix verplicht
CONVEX_URL=https://glorious-pheasant-759.eu-west-1.convex.cloud

# Mailjet (dev primary key — geen sub-account-key, WP5 known issue #3)
MAILJET_API_KEY=<dev-key>
MAILJET_API_SECRET=<dev-secret>
MAILJET_TEST_VERIFIED_FROM=info@clubalmanac.com         # MOET in Mailjet verified zijn
MAILJET_TEST_UNVERIFIED_FROM=unverified+wp11@example.com # MOET NIET verified zijn
# MAILJET_TEST_TO default = clubalmanac-integration-regular@example.com

# Clerk webhook signing-secret — ZELFDE waarde als op de dev-deployment
CLERK_WEBHOOK_SECRET=whsec_<dev-secret>
```

- [ ] `CONVEX_URL` = dev-deployment, **met** region-suffix (`.eu-west-1.`). Zonder suffix 404't de webhook-POST (WP5-audit S-3). `assertNotProd` blokkeert de prod-deployment-naam als tweede laag.
- [ ] `MAILJET_TEST_VERIFIED_FROM` staat als verified sender in het Mailjet dashboard (Account → Senders & Domains). Anders faalt de happy-path-subtest om de verkeerde reden.
- [ ] `MAILJET_TEST_UNVERIFIED_FROM` staat **niet** verified. `@example.com` is veilig — kan nooit per ongeluk geverifieerd raken.
- [ ] `CLERK_WEBHOOK_SECRET` is exact gelijk aan de waarde op de Convex dev-deployment (anders verifieert onze test-getekende Svix-signature niet → 401 i.p.v. 200).

### B. Convex dev-deployment

- [ ] `INTEGRATION_TEST_ENABLED=true` (al gezet sinds WP2) — de WP11 `convex/_test.ts`-helpers gaten hierop.
- [ ] `CLERK_WEBHOOK_SECRET` gezet (= dezelfde waarde als in `.env.integration`).
- [ ] `MAILJET_VERIFIED_SENDERS` bevat de verified from-address (productie-gate-config; niet door de test zelf gebruikt maar wel relevant voor het bredere WP5-contract).
- [ ] Deployment up-to-date inclusief B's WP11-helpers: `npx convex dev --once`.

### C. Test-bestemming (Clerk)

- [ ] Geen handmatige test-user nodig: de Clerk-gate genereert per run een **fresh** subject + email (`user_wp11_<uuid>` / `wp11-onboard-<uuid>@example.com`) en seedt z'n eigen invite + group via `_test:seedOnboardingFixture`. De DB wordt na afloop teruggebracht naar baseline (cleanup-subtest + `afterAll` safety-net).

## Mailjet-gate draaien

```bash
npm run test:integration -- tests/integration/mailjet/sendRoundtrip.test.ts
```

Verwacht: twee tests, ~enkele seconden, groen.
- **Sub-test 1 (silent-failure-pin)**: onverified From → Mailjet antwoordt **200** maar levert **geen** delivery-MessageID. Dit bewijst known-issue #2 empirisch (200-bij-onverified). De volledige response wordt gelogd (`[WP11] Mailjet onverified-From response: ...`) voor discovery.
- **Sub-test 2 (happy-path)**: verified From → **200 + niet-lege MessageID**. Stuurt één echte mail naar de test-bestemming (acceptabel; geen inbox-arrival-check).

**Pass-criterium**: beide groen. Faalt sub-test 1 (bv. Mailjet geeft nu 400, of levert tóch een MessageID voor onverified), dan is Mailjet's contract veranderd — **inspecteer vóór cutover** en pas de pin + WP5-gate-aanname aan.

## Clerk-gate draaien

```bash
npm run test:integration -- tests/integration/clerk/onboardingWebhook.test.ts
```

Verwacht (na B's helpers): drie tests, groen.
- **Sub-test 1 (happy-path)**: synth `session.created` + echte Svix-HMAC → **200**; daarna read-back via `convex/_test.ts`-helpers: users-row + geaccepteerde invite + membership, met **gelijke timestamp** op `users.createdAt` / `invites.respondedAt` / `memberships.joinedAt` (atomic-pin). Plus re-login-no-op (tweede POST → geen tweede membership).
- **Sub-test 2 (401-pad)**: gemanipuleerde signature (verkeerd secret) → **401**, geen users-row.
- **Sub-test 3 (cleanup)**: cleanup-helpers verwijderen alle fixture-state (count-return geverifieerd), DB terug naar baseline.

### Clerk-gate B-deliverable

B levert in `convex/_test.ts` (alle `INTEGRATION_TEST_ENABLED`-gated, WP2-precedent):

| Helper | Type | Doel |
|--------|------|------|
| `seedOnboardingFixture` | mutation | inviter-user + group + pending invite voor `email`; returnt `{ inviterUserId, groupId, inviteId }` |
| `getUserBySubject` | query | users-row \| null |
| `listInvitesByEmail` | query | invite-rows[] (genormaliseerde email-lookup) |
| `listMembershipsByUserId` | query | membership-rows[] |
| `cleanupUserBySubject` | mutation | delete albumLastSeen + memberships + users-row voor subject; count-return |
| `cleanupOnboardingSeed` | mutation | delete invite + group + inviter-user; count-return |

Cleanup-volgorde (FK-orphan-blip voorkomen): kindrecords eerst — albumLastSeen → memberships → users-row; daarna seed: invite → group → inviter.

**Pass-criterium**: drie tests groen. Tot B levert: RED met "function not found"-achtige fout op de eerste `_test:`-call — exact het bedoelde RED-signaal.

## Bij fouten

### Mailjet
- **Sub-test 1 faalt (kreeg wél een MessageID / kreeg 4xx)**: Mailjet's contract is gewijzigd. Niet wegmoffelen — dit is precies de regressie die de gate moet vangen. Documenteer in `audit-track-record.md` + heroverweeg WP5-gate-aanname.
- **Sub-test 2 faalt (geen MessageID)**: `MAILJET_TEST_VERIFIED_FROM` is (niet meer) verified, of sender-verification verlopen. Check Mailjet dashboard Senders.
- **401 op de Send-call**: `MAILJET_API_KEY`/`MAILJET_API_SECRET` fout, of een sub-account-key gebruikt (WP5 known issue #3 — gebruik de primary key).

### Clerk
- **401 op de happy-path-POST**: `CLERK_WEBHOOK_SECRET` in `.env.integration` ≠ de waarde op de deployment. Beide moeten exact gelijk zijn.
- **404 op de webhook-POST**: `CONVEX_URL` mist de region-suffix (`.eu-west-1.`). Zie WP5-audit S-3.
- **"function not found" op `_test:seedOnboardingFixture`**: B's helpers staan nog niet (of niet gedeployd). RED-by-design tot B landt + `npx convex dev --once`.
- **503 op de POST**: `CLERK_WEBHOOK_SECRET` ontbreekt op de deployment (fail-closed). Zet 'm.
- **happy-path 200 maar geen users-row**: payload-email is niet verified in de synth-payload (`emailVerified: true` vereist), of de email botst met een bestaande users-row (andere subject, zelfde email → `registerFromSession` throwt "Email is al in gebruik"). Fresh email per run voorkomt dit normaal.
- **CONVEX_URL prod**: `assertNotProd` weigert — bewust.

## Pre-cutover

Voor prod-cutover (fase 5 T-4-weken-stappenplan, `migratie-status.md`):
1. **Mailjet**: zelfde test met prod-key + prod-verified-sender (prod-domain). Plus de mens-stap: visueel bevestigen dat de happy-path-mail daadwerkelijk in de inbox aankomt (out-of-scope voor de automated gate — Mailjet eventual-consistency).
2. **Clerk**: zelfde test tegen prod Convex-URL + prod `CLERK_WEBHOOK_SECRET`. `assertNotProd` moet dan bewust omzeild worden (aparte env-config) of de gate wordt vervangen door een echte signup-smoke-test tijdens cutover-week.
3. **Bounce-webhook**: niet opnieuw automatiseren — al gedaan in WP5 Gate 2 (2026-05-18, handmatige echte-bounce + replay). Handmatig herhalen indien Mailjet-config wijzigt.
4. Documenteer gates-passed in `audit-track-record.md`.

## Cross-refs

- WP11-spec: [`docs/work-packages/WP11-deferred-integration-tests.md`](../work-packages/WP11-deferred-integration-tests.md)
- [`integration-tests.md`](../conventions/integration-tests.md) — test-laag-architectuur, `INTEGRATION_TEST_ENABLED`-gate, count-return-discipline, A+audit-vs-A→B→audit-norm
- [`external-services.md`](../conventions/external-services.md) — Mailjet §Known issues #2 (silent-200), Clerk §Webhook-config (region-suffix, Svix-HMAC, verified-email-required)
- WP7-runbook [`wp7-upload-gate.md`](./wp7-upload-gate.md) — runbook-structuur + `assertNotProd`-pattern + cleanup-discipline-precedent
- audit-track-record: WP5-audit S-3 (region-suffix), WP6-audit should-fix-4 (integration-test-deferral)
