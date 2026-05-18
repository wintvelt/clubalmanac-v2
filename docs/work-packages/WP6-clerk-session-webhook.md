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

### Ontbrekende invarianten

- **Email-extractie uit Clerk-payload, expliciet gepin'd**: draft zegt "email uit Clerk-payload" zonder de vorm te pinnen. `session.created` payload is `SessionWebhookEventJSON` met `data.user_id` + `data.user: UserJSON | null`. Email zit niet direct op `data` — alleen op `data.user.email_addresses[]`. Resolve-volgorde: pak het object uit `email_addresses` waar `id === data.user.primary_email_address_id`, gebruik `.email_address` als bron, daarna `normalizeEmail`. Subject = `data.user_id`. Een afwijkende resolve (eerste address, of `data.user.email_addresses[0]`) zou bij users met meerdere addresses tot fout-email leiden — pin't dat dat niet mag.
- **`data.user === null` afhandeling**: payload-schema staat `null` toe (sessie zonder user-snapshot, theoretisch zeldzaam maar typed-mogelijk). Zonder snapshot is er geen email/name resolvebaar → onboarding-flow kan niet draaien. Pin: 200 no-op + structured log; géén throw (anders eindeloze Clerk-retry).
- **Verified-email-eis voor invite-match**: draft leunt op "Clerk's email-verification garandeert eigenaarschap". Pin't expliciet welk veld dat garandeert: gebruik alleen email-addresses met `verification.status === "verified"`. Primary-address dat onverified is → behandeld als "geen email beschikbaar" → 200 no-op (geen users-row, geen invite-match). Voorkomt dat een oauth-flow met onverified primary email een invite voor een ander emailadres "claimt".
- **Subject + email moeten consistent binnen één event blijven**: in dezelfde mutation-tx wordt subject opgeslagen én alle pending-invites-voor-email geaccepteerd. Tussenstaat "users-row created maar invite-accept gefaald" mag niet ontstaan — pin't dat élke throw binnen `registerFromSession` de hele transactie terugdraait (gevolg van Convex mutation-atomiciteit, maar maakt het expliciet voor B).
- **Idempotency-discipline staat in de mutation, niet in de http-laag**: subject-lookup gebeurt aan het begin van de mutation. Dat vangt Clerk's normale webhook-retry (zelfde event, paar seconden later) én re-login-events (`session.created` bij subsequent sign-in). Pin't dat een aparte event-dedup-store (à la `inviteBounceEvents` voor Mailjet) niet nodig is — Convex serialiseert overlapping mutations, dus parallelle retries vóór commit converger op één winner + tweede ziet existing-user en bailt no-op uit.
- **Naam-opbouw uit Clerk**: `data.user.first_name` + " " + `data.user.last_name` met whitespace-trim, beide null → name blijft `undefined` (users-row valid zonder name, user kan via `updateProfile` later zetten). Pin't dat geen email-localpart-fallback komt — anders zou een rename via Clerk later confusing zijn.
- **`/clerk-webhook` is geen drop-in van `register`-call-site**: na deze WP heeft een logged-in Clerk-user géén route meer om expliciet "registreer me" te roepen. Spec zegt al "geen frontend-onboarding-pad", pin't expliciet: `api.users.register` wordt **verwijderd** (niet alleen ge-deprecate'd) en `internal.users.registerFromSession` is internal-only. `api.invites.accept` blijft bestaan voor manuele token-accept (logged-in user die een invite-link uit zijn mailbox klikt voor een tweede group), maar is geen onboarding-pad meer.

### Gemiste edge cases

- **`user.created` event komt vóór `session.created`**: Clerk fires beide in volgorde. Spec kiest `session.created` om signup-completion-OR-re-login te dekken in één pad. Pin't dat `user.created` 200 no-op moet zijn (anders disablet Clerk de webhook na 5xx). Idem `session.ended`, `session.removed`, `session.revoked` (kunnen bij logout of revoke fire'n).
- **Re-login na Clerk-side user-delete + re-signup met zelfde email**: scenario waarin een nieuwe Clerk-subject een email claimt die al in een bestaande Convex `users`-row staat (oude subject, achtergebleven na admin-delete in Clerk dashboard). Email-uniqueness-check throwt "Email is al in gebruik" → mutation rollbackt → webhook 500 → Clerk retried → ops-zichtbaar via logs. Pin't dat dit gewenst gedrag is (geen silent overwrite van rij met andere subject — die zou data van vorige user laten "overerven" naar nieuwe). Wouter doet manual cleanup van oude rij vóór re-signup.
- **Expired invite bij signup**: invite-lookup vindt rows met `email`-match, filter is `status === "pending" && expiresAt > now`. Expired invites worden genegeerd — equivalent aan zero-invite-fallback (users-row only, geen membership). Pin't omdat draft alleen "zonder pending invite" als zero-invite definieert; expired-invite valt onder dezelfde noemer.
- **Bounced invite bij signup**: `bouncedAt`-gepatchte invites zitten op `status="expired"` (zie `handleBounce`), dus zelfde no-op-pad als expired. Pin't dat een gebouncete invite gevolgd door succesvolle signup (theoretisch: typo gerepareerd, of Mailjet retry succeeded later — onwaarschijnlijk maar mogelijk) géén automatic accept oplevert. User zou via Wouter een nieuwe invite moeten krijgen.
- **`session.created` voor existing users-row + nieuwe pending invite ná eerste signup**: user X heeft users-row, krijgt later invite voor group Y, logt opnieuw in. Webhook firet `session.created`, idempotent-on-subject pakt no-op-pad. **Nieuwe pending invite voor X wordt niet automatisch geaccepteerd op re-login.** Pin't dat dit gewenst is: re-login = login-event, niet onboarding-event; post-signup invites accepteert user via `invites.accept` token-flow. Voorkomt verrassend gedrag waarbij relogins stille membership-changes triggeren.
- **Webmaster zonder pending invite + bestaande users-row**: idempotent — geen probleem. Webmaster met pending invite voor een group: invite wordt geaccepteerd (webmaster is ook "gewoon" een user voor invite-doeleinden). Pin't dat webmaster-bypass alleen geldt voor de "geen invite vereist" gate, niet als blokkade voor invite-acceptance.
- **`invites.accept` mutation blijft naast webhook bestaan**: race tussen webhook-side auto-accept en frontend `invites.accept(token)` zou theoretisch dubbele membership-insert kunnen triggeren. Convex serialiseert; `getMembership`-check vóór insert in beide paden vangt 'm op. Pin't dat beide paden dezelfde idempotency-guard hebben (existing-membership check + role-upgrade-only).
- **Mixed-case email in Clerk-payload vs normalized invite**: invariant in draft zegt "via `normalizeEmail`". Edge-case-pin: een payload met `"Wouter@Me.COM"` moet matchen op invite seeded met `"wouter@me.com"`. Spiegelt audit-7/8 discipline.
- **Lege `email_addresses` array**: edge case waarin Clerk een user zonder enige email aanmaakt (oauth-only flow met provider die geen email teruggeeft). Pin: 200 no-op + log, géén throw.
- **Email zonder `verification` veld of `verification.status !== "verified"`**: behandeld als "geen verified email". Idem 200 no-op + log.

### Risico-dimensies — aanvullingen op draft

- **Test-migratie undercount (medium)**: draft zegt "13 test-files". Daadwerkelijk: **31 test-files + `tests/_helpers/auth.ts`** = 32 files raken `api.users.register`. Per-file mechanisch is geen redelijke route; helper-refactor in `_helpers/auth.ts` is de enige duurzame strategie (zie test-migratie-sectie hieronder). Onderschatting kan B verleiden tot per-file edits met 31x bias-risico — pin't strategie expliciet.
- **Frontend-impact (laag, nuance)**: draft zegt "alleen test-helpers" — feitelijk is er momenteel überhaupt geen `src/` directory. Geen frontend deployed nu; frontend onboarding-pad is "niet-gebouwd", niet "actief gemigreerd weg van `users.register`". Risico verschuift naar toekomstige frontend-WP: post-WP6 mag een nieuwe frontend nooit `users.register` aanroepen (mutation bestaat niet meer). Plan-doc / frontend-WP-spec moet daar op pin'nen.
- **`@clerk/backend.verifyWebhook` env-var-naming mismatch (laag)**: standaard leest de lib `CLERK_WEBHOOK_SIGNING_SECRET`. Draft spec gebruikt `CLERK_WEBHOOK_SECRET` (consistent met `MAILJET_WEBHOOK_SECRET`-pattern). B moet expliciet `verifyWebhook(request, { signingSecret: process.env.CLERK_WEBHOOK_SECRET })` aanroepen, niet leunen op default-env-lookup. Anders silent miss op verkeerde env-var-naam → 503 vóór de Mailjet-style fail-loud kan firen. Pin't.
- **Svix timestamp-tolerance niet-overschreven (laag)**: `standardwebhooks` `Webhook.verify` heeft ingebouwde replay-window (default 5min, opgeslagen in lib). Daar is niets aan over te schrijven via `verifyWebhook(...)` opts. Een replayed payload van >5min oud zou daardoor 401'en, ook met geldige signature. Acceptabel — pin't dat dit het gedrag is en we het niet customizen.
- **Ops-runbook-impact**: één nieuwe env-var `CLERK_WEBHOOK_SECRET` (waarde = `whsec_<base64>`-format zoals Clerk dashboard genereert; **niet zelf via `openssl rand -hex 32`** zoals draft suggereert — Clerk genereert 'm bij webhook-aanmaak, je kopieert 'm uit dashboard) + Clerk dashboard webhook-config naar `https://<deployment>.<region>.convex.site/clerk-webhook` met **event-filter op minimaal `session.created`** (kan zonder filter om andere events stil-200 te ontvangen — keuze: filter aan voor minder noise vs. uit voor toekomst-zekerheid). Dev + prod aparte secrets. Documenteren in [`external-services.md`](../conventions/external-services.md) §Auth Clerk met tabel parallel aan WP5's Mailjet-tabel.

### Open product-vragen voor regie/Wouter

1. **`whsec_`-prefix in `CLERK_WEBHOOK_SECRET`**: opslaan inclusief prefix (`whsec_xxx`) of zonder? `standardwebhooks` accepteert beide vormen. Aanbeveling: **inclusief prefix**, zoals Clerk dashboard 'm aanlevert — geen string-manipulatie tussen dashboard en env-var. Bevestiging? - AKKOORD
2. **Onverified-primary-email-flow**: voorstel = 200 no-op + log + géén users-row. Alternatief = users-row aanmaken op primary email, invite-match overslaan. Voorkeur? - AKKOORD (defensive safety-net; Clerk-config-aanname blijft verification-required, dus dit pad triggert in praktijk nooit)
3. **Lege `email_addresses` array (oauth zonder email)**: 200 no-op of users-row met email = stub? Voorstel: 200 no-op (consistent met onverified-pad), gebruiker krijgt simpelweg geen users-row tot ze een verified email koppelen + opnieuw inloggen. - AKKOORD
4. **Email-uniqueness-clash bij re-signup met zelfde email + nieuwe Clerk subject**: voorstel = mutation-throw → webhook 500 → Clerk retried → ops merkt 't via logs. Alternatief = "silent claim" (oude row over-patchen naar nieuwe subject). Voorkeur is fail-loud — bevestiging? - AKKOORD (500 fail is OK)
5. **Cascade-matrix-rij**: draft suggereert nieuwe rij `SE1`. Bestaande cascade-matrix heeft echter **`S1` (`userStatsAddToMembership`, status ⏳)** voor exact dit pad (auto-accept invite na signup). Voorstel: **S1 update** in plaats van SE1-toevoeging, met aangepast effect + Convex-aanpak (zie hieronder). Akkoord? - AKKOORD
6. **`user.deleted` event**: spec markeert "bewust niet" — bevestiging dat webhook desondanks 200 retourneert op het event (anders Clerk-disable-risico)? Geen DB-state-mutatie, alleen ack. - AKKOORD

### Cascade-matrix-rij — voorstel-formulering (vervangt S1)

```
| S1 | userStatsAddToMembership | Clerk `session.created` webhook (was: UP-insert DynamoDB stream) | Atomic onboarding: insert users-row + accept alle pending invites voor email + insert membership(s) in één Convex mutation. Idempotent op subject (re-login = no-op). Webmaster cold-start zonder invite acceptabel (users-row only) | 2+3 | `/clerk-webhook` httpAction in `convex/http.ts` met `@clerk/backend.verifyWebhook` (Svix Standard Webhooks), delegeert naar `internal.users.registerFromSession({subject, email, name?})`. Mutation verwijdert publieke `api.users.register` en consolideert invite-accept-logica uit `invites.accept` voor email-match-pad | `tests/clerk/webhookAuth.test.ts` + `tests/clerk/webhookPayloadShape.test.ts` + `tests/users/registerFromSession.test.ts` | ⏳ → ✅ na WP6 |
```

### Svix-lib-keuze — motivatie

**`@clerk/backend.verifyWebhook`** (al geïnstalleerd v3.4.4). Onder de motorkap leunt 't op `standardwebhooks` (Standard Webhooks = open-spec spin-off van Svix), beide al als transitive dep aanwezig (zie `node_modules/@clerk/backend/dist/webhooks.mjs:8` import). Geen nieuwe top-level dep nodig.

Voordelen vs. standalone `svix`:
- Eén lib-keten minder om te onderhouden.
- Clerk-aligned: event-typing (`SessionWebhookEvent`, `UserWebhookEvent`, etc.) komt out-of-the-box.
- Toekomstige Clerk-protocol-shifts (Standard Webhooks → andere encoding) draagt Clerk zelf in `@clerk/backend`.

B moet de secret expliciet doorgeven: `verifyWebhook(request, { signingSecret: process.env.CLERK_WEBHOOK_SECRET })` — niet leunen op default `CLERK_WEBHOOK_SIGNING_SECRET`-env-var-lookup (zie risico-dimensie hierboven).

Voor tests: `standardwebhooks.Webhook.sign(msgId, timestamp, payload)` is via transitive dep importeerbaar (`node_modules/standardwebhooks`) — A schrijft test-helper die geldige Svix-headers genereert voor happy-path tests, zodat we niet alleen op fail-mode-tests (missing/invalid headers) leunen.

### Test-migratie-strategie — motivatie

**Helper-refactor in `tests/_helpers/auth.ts`** is de enige redelijke route bij 32 files. Per-file mechanisch zou 31 vrijwel-identieke edits opleveren met onnodig regression-risico (typo's, weggelaten assertions) zonder nieuwe testdekking.

Plan:
- `registerUser(t, subject, email, name?)`: roept onder de motorkap `t.run((ctx) => ctx.runMutation(internal.users.registerFromSession, {subject, email, name}))` aan. Geen `withUser`-identity-roundtrip meer nodig — internal mutation neemt subject als arg. Helper-signature blijft hetzelfde, call-sites onveranderd.
- `registerUserWithInvite(t, subject, email, name?)`: seedt pending invite + roept `registerUser`. Onveranderd qua signature. Membership-creation gebeurt nu binnen `registerFromSession` (zelfde tx als users-row-insert) i.p.v. via aparte `api.invites.accept`-call zoals nu — call-sites blijven onveranderd.
- **Uitzondering: `tests/users/register.test.ts`** test expliciet `api.users.register` mutation-gedrag (gate-fails, email-uniqueness, identity-required). Mutation bestaat niet meer post-WP6 → file wordt **gerenamed naar `tests/users/registerFromSession.test.ts`** met herschreven assertions tegen de nieuwe internal mutation. (A schrijft die nieuwe file als onderdeel van deze RED-phase; oude file blijft tot B 'm vervangt — anders zou de huidige test-suite onmiddellijk breken.)

B krijgt zo: één helper-edit + één test-file-rename, geen 31-file mechanische edit-storm.

### Concrete invariants die A in tests pin't (preview)

Bij `tests/users/registerFromSession.test.ts`:
- Happy path: 1 pending invite voor email → users-row + invite.status=accepted + membership in 1 mutation-run.
- Multi-invite atomic: 2 pending invites zelfde email (verschillende groups) → 2 memberships + 2 accepted-invites in 1 run.
- Idempotent-on-subject: tweede call zelfde subject = no-op, returned id = bestaande row.
- Idempotent-on-subject + nieuwe pending invite tussen 1e en 2e call: 2e call accepteert die invite NIET (re-login pad ≠ onboarding pad).
- Zero-invite fallback (geen invite, geen webmaster-email): mutation throwt — webhook moet daarop 500'en (Clerk retry'd). **Of**: webhook vangt af en 200 no-op + log? **Decision-needed; default keuze als regie niets zegt = throw, want anders silent user-creation-fail.** _Update na regie-call: voorstel keuze = **users-row created, geen membership** (acceptabel terminal "registered-no-membership" zoals draft-spec invariant zegt). Pin't dat._
- Webmaster-bypass zonder invite: users-row created, geen membership.
- Email-normalization: payload `"Bouncer@X.com"` matcht pending invite seeded met `"bouncer@x.com"` → accepted.
- Expired invite: behandeld als zero-invite (users-row, géén accept, géén membership).
- Name from Clerk: payload `{first_name: "Anna", last_name: "B"}` → users-row.name = "Anna B". Beide null → name undefined.
- Email-uniqueness-clash met andere subject: mutation throws (rollback de users-row die anders gemaakt zou worden).
- Group-less invite (`groupId === undefined`): invite-accept patcht status, geen membership-insert (mirror `invites.accept`-gedrag).

Bij `tests/clerk/webhookAuth.test.ts`:
- `CLERK_WEBHOOK_SECRET` ontbreekt → 503, geen state-mutatie.
- Missing `svix-id` header → 401.
- Missing `svix-timestamp` header → 401.
- Missing `svix-signature` header → 401.
- Geldige Svix-headers + body + secret → 200 + state-mutatie (users-row created).
- Wrong-secret signature → 401.
- Mismatched-body signature (signature van andere body) → 401.

Bij `tests/clerk/webhookPayloadShape.test.ts`:
- `type: "session.created"` + valid user → onboarding flow runs.
- `type: "user.created"` → 200 no-op (geen users-row).
- `type: "user.updated"` → 200 no-op.
- `type: "user.deleted"` → 200 no-op.
- `type: "session.ended"` → 200 no-op.
- `data.user === null` → 200 no-op (geen state-mutatie).
- Primary-email-id punt naar onverified address → 200 no-op.
- Lege `email_addresses[]` → 200 no-op.
- Mixed-case email in payload → match op lowercase invite.
