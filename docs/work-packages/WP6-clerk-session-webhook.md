# WP6: Clerk session-webhook + atomic onboarding

## Productdoel

Wanneer een gebruiker zijn Clerk-signup voltooit (of opnieuw inlogt na een eerdere session-end), is binnen één webhook-roundtrip de Convex users-row aangemaakt en zijn alle pending invites voor die email geaccepteerd inclusief bijbehorende memberships — atomair en zonder dat de frontend daar een aparte onboarding-call voor hoeft te doen.

## Invarianten

- **Idempotent op subject**: tweede `session.created`-event voor een al bestaande users-row (re-login) = no-op + 200. Geen dubbele rows, geen dubbele membership-inserts.
- **Atomair binnen Convex**: users-row insert + invite-status-patch(es) + membership-insert(s) gebeuren in **één** Convex-mutation-transactie. Een crash halverwege = alles teruggedraaid, niets half-doorgevoerd.
- **Webhook is niet spoofbaar**: een POST op `/clerk-webhook` zonder geldige Svix-signature wijzigt geen state. Een aanvaller die de URL kent maar het secret niet, krijgt 401 en raakt geen DB.
- **Fail-closed op missing secret**: `CLERK_WEBHOOK_SECRET` env-var unset → endpoint returnt 503 voor élk POST, geen state-mutatie. Consistent met `/email-event`-pattern uit WP5.
- **Verified email is ownership-bewijs**: invite-acceptance lookt invites op via lowercase-trimmed email uit Clerk-payload. Token-in-payload is niet vereist — Clerk's email-verification garandeert eigenaarschap, identiek aan WP5 `handleBounce` discipline.
- **Multi-pending-invite atomic**: als één email twee pending invites heeft (bv. uitgenodigd voor groep A én groep B), worden bij signup beide geaccepteerd + twee memberships ingelegd in dezelfde transactie.
- **Zero-invite fallback acceptabel**: signup zonder pending invite (webmaster-bypass cold-start, of edge-case na manual Clerk-create) → users-row wordt ingelegd zonder membership. Terminal state "registered-no-membership" is acceptabel (zelfde uitkomst als user die zijn laatste groep verlaten heeft).
- **Email-normalization consistent**: alle email-vergelijkingen via `normalizeEmail` (lowercase + trim). Mixed-case email in Clerk-payload mag pending-invite-lookup niet missen — spiegelt audit-7/audit-8 discipline.
- **Geen frontend-onboarding-pad**: na webhook-deploy roept de frontend géén `users.register` of `invites.accept` meer aan. Onboarding is volledig server-side. De huidige publieke `api.users.register` mutation wordt verwijderd (geen call-sites in frontend, alleen test-helpers — die migreren naar `internal.users.registerFromSession` via `t.run()`).

## Edge cases + scope-uitsluitingen

- **In scope**:
  - `/clerk-webhook` http-action in `convex/http.ts` met Svix HMAC-verify
  - `internal.users.registerFromSession({subject, email, name})` interne mutation met atomic flow
  - Verwijderen van publieke `api.users.register` mutation; test-helpers + 13 test-files mechanisch migreren naar `t.run()` pattern
  - Filter op event-type `session.created` — andere event-types (`user.created`, `user.updated`, etc.) → 200 no-op zodat Clerk geen webhook-disable triggert
  - Idempotency op subject-lookup + email-uniqueness-check (defense-in-depth)
  - Multi-pending-invite atomic accept-and-membership-insert
  - Webmaster-bypass-pad (cold-start zonder invite) blijft werken
  - `CLERK_WEBHOOK_SECRET` env-var fail-loud bij ontbreken (zoals WP5 `MAILJET_WEBHOOK_SECRET`-pattern)
  - Email-normalization consistent met bestaande pattern (lib/email.ts)
- **Bewust niet** (voor deze WP):
  - **`user.deleted` cascade**: Clerk-side user-deletion triggert geen Convex-cleanup. Bij 16-user-app zelden gebeurd; ad-hoc admin-action voldoende. Future-WP indien gewenst.
  - **`user.updated` profile-sync**: name/email-changes in Clerk worden niet teruggespiegeld naar Convex. `users.name`/`email` blijven snapshot uit eerste signup. Wouter kan zelf via `updateProfile` mutation als nodig.
  - **Pre-signup webhook** (Clerk → Convex vóór user-create): genoemd in migratie-plan-convex.md fase 2 Auth-bullet als invite-gate-laag. Niet vereist met session.created-pattern: een Clerk-signup zonder pending invite landt in users-row-zonder-membership (acceptabel terminal). User kan inloggen maar ziet leeg dashboard. Niet schadelijk.
  - **Clerk Invitations API integratie** (pre-create Clerk-user bij Convex `invites.create`): alternatief design dat invite-visibility pre-Clerk-signup zou geven via `users.status: "invited"`. Te zware ingreep voor nu — gemarkeerd als TBD in [`README.md`](./README.md). Kan als upgrade na WP6 als 16-user-app het wil.
  - **Schema-changes**: `users.subject` blijft NOT NULL, geen nieuwe velden, geen migratie. WP6 raakt schema niet.

## Risico-assessment

- **security/privacy**: medium-hoog — webhook is unauthenticated public surface tot Svix-verify staat; payload bevat email + subject (PII). Spoof-risico = lockout/abuse zonder verify. Svix-lib is bewezen standaard, low-risk om te integreren.
- **ops**: medium — externe Clerk-webhook-delivery met retry; bij Convex-side outage retried Clerk automatisch, ongeveer zoals WP5's bounce-webhook. Onze fail-closed 503 bij ontbrekend secret matcht het Mailjet-pattern.
- **external deps**: medium — Svix npm-package (`@clerk/backend` of `svix` direct) als HMAC-verify dependency. Eén nieuwe lib, klein attack-surface.
- **multi-user/concurrency**: laag — per-user signup, geen shared race-paths. Subject-uniqueness check is structureel via `by_subject` index.
- **data/schema-evolutie**: laag — geen schema-changes; geen `verifiedSenderCache`-achtige toevoegingen. Tests-migratie is mechanisch, niet schema-touching.
- **ops-runbook-impact**: één nieuwe env-var `CLERK_WEBHOOK_SECRET` (gegenereerd via `openssl rand -hex 32`, zelfde patroon als `MAILJET_WEBHOOK_SECRET`) + Clerk dashboard webhook-config naar `https://<deployment>.<region>.convex.site/clerk-webhook` met Svix-signing aan. Dev + prod aparte secrets. Documenteren in [`external-services.md`](../conventions/external-services.md) §Auth Clerk + verplichte ops-runbook-impact-tabel zoals bij WP5.

## Cross-refs

- **migratie-plan**: §Fase 2 Auth-bullet ([`docs/migratie-plan-convex.md:911-915`](../migratie-plan-convex.md)) — pre-signup webhook genoemd, deze WP realiseert defense-in-depth alternatief via session.created
- **audit-track-record**: §audit-7 (case-insensitive email match, server-side invite-gate als defense-in-depth)
- **cascade-matrix**: nieuwe rij toe te voegen bij A-fase — `SE1: Clerk session.created → atomic onboarding (users-row + invite-accept(s) + membership(s))`
- **oude AWS-code** (alleen A leest): `blob-images-api/handlers/cognito/preSignup.js` + `postConfirmation.js` (Cognito triggers) — voor WP6 vergelijkbaar concept maar andere provider; A toetst welke gates de oude code had die we mogelijk missen
- **externe service**: [`external-services.md` §Auth Clerk](../conventions/external-services.md) — uitbreiden met webhook-config + Svix-lib-keuze
- **bestaande backend-haken** (B implementeert *in*, niet *vanaf nul*):
  - `convex/users.ts` r.66-117 `register` mutation — wordt geconverteerd naar `internal.users.registerFromSession` met aangepaste signature + uitgebreide logic
  - `convex/invites.ts` r.155-203 `accept` mutation + r.180-194 membership-insert-logica — wordt **niet** verwijderd (kan apart aangeroepen worden voor handmatige accept-flows post-WP6) maar de webhook duplicaat een deel van de logica voor atomic-accept-binnen-registerFromSession
  - `convex/http.ts` — derde route erbij naast `/email-event` (WP5) en `/upload` (WP4)
  - `tests/_helpers/auth.ts` r.64 `registerUser` helper — wijzigt van `api.users.register` naar `t.run(internal.users.registerFromSession, ...)`

## Acceptance — hoe weten we dat het klaar is

### Tests (unit, mock-based)

- `tests/clerk/webhookAuth.test.ts` — `/clerk-webhook` POST zonder/met-verkeerde Svix-signature → 401; met geldige signature → 200 + delegeert naar `registerFromSession`. Plus 503 op missing secret.
- `tests/clerk/webhookPayloadShape.test.ts` — Clerk payload-variaties: `session.created`, `user.created` (skip), `user.updated` (skip), missing email-claim, missing subject. Pinnen wat wel/niet doorgaat.
- `tests/users/registerFromSession.test.ts` — happy-path (één pending invite → users-row + accept + membership in één run), multi-invite atomic (twee invites op zelfde email → twee memberships), idempotency (her-call met zelfde subject → no-op), zero-invite (geen pending invite → users-row zonder membership), webmaster-bypass (geen invite vereist), email-normalization (`Bouncer@X.com` payload → match op `bouncer@x.com` invite).
- **Migratie-tests**: bestaande 13 test-files die `api.users.register` callden via `tests/_helpers/auth.ts` worden geüpdatet naar `t.run(internal.users.registerFromSession, ...)`. Assertions blijven dezelfde — alleen de seed-call-vorm verandert.

### Integration-tests (`npm run test:integration`, niet in CI)

- `tests/integration/clerk/onboardingWebhook.test.ts` — pin tegen echte Clerk dev-instance test-event-payload (Clerk dashboard heeft "Send test event"-knop zoals Mailjet had). Verifieer end-to-end: Svix-verify werkt tegen Clerk's productie-signing, payload-parsing klopt, atomic-mutation draait succesvol.

### Empirische gate (mens, geen agent)

Drie gates, allemaal getekend door Wouter vóór WP-afsluiting:

**Gate 1 — Happy-path signup-completion**:
- Maak via `api.invites.create` een pending invite voor een vers test-email (bv. `wintvelt+wp6-gate1@gmail.com`)
- Open Clerk dev-instance signup-pagina, signup met die email + password, voltooi email-verification
- Verificatie via Convex dashboard → Data:
  - `users`-tabel: nieuwe row met juiste subject (`user_xxx` uit Clerk), email lowercase, name uit Clerk
  - `invites`-tabel: invite gepatcht naar `status: "accepted"` + `respondedAt`
  - `memberships`-tabel: nieuwe row met juiste userId + groupId + role
- Verificatie via Convex Logs: één entry voor `/clerk-webhook` http-action + één voor `internal.users.registerFromSession` mutation, beide success

**Gate 2 — Idempotency re-login**:
- Log uit en weer in met dezelfde test-user
- Verificatie: `users`-rij blijft 1, geen extra `memberships`-row, webhook log toont 200 + no-op
- Pin't dat `session.created` ook bij subsequent sign-ins idempotent is

**Gate 3 — Zero-invite fallback**:
- Maak in Clerk dev-instance handmatig een nieuwe user via dashboard (geen invite-mail-flow)
- Verificatie: `users`-rij wordt aangemaakt, géén membership-row (acceptabel terminal "registered-no-membership")
- Pin't dat orphan-Clerk-state niet meer kan ontstaan

**Negatieve curl-test** (optioneel maar aanbevolen): POST naar `/clerk-webhook` zonder Svix-headers → 401, geen state-mutatie.

---

## Spec-criticus aanvullingen (A vult in)

A leest oude AWS-code + cascade-matrix + bovenstaande spec, vult hier aan:

- Ontbrekende invarianten: ...
- Gemiste edge cases: ...
- Risico-dimensie die regie overschatte/onderschatte: ...
- Open product-vragen voor regie/Wouter: ...
- Cascade-matrix-rij SE1 exact-formuleren: ...
- Svix-lib-keuze (`svix` standalone vs `@clerk/backend` met ingebouwde verify) + motivatie: ...
- Test-migratie-strategie (per file mechanisch of via helper-refactor in `tests/_helpers/auth.ts`) + motivatie: ...

(Leeg in draft. A commit edits hier.)
