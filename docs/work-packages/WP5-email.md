# WP5: Email (Mailjet)

## Productdoel

Wanneer Clubalmanac een applicatie-email moet versturen (invite, accept/decline-notify, flagged-photo-decide, problem-report), arriveert die bij de juiste ontvanger; en wanneer een verstuurde mail bounce't of geblockt wordt, weet het systeem dat binnen één webhook-roundtrip en sluit het de bijbehorende invite-flow correct af.

## Invarianten

User-truth, niet impl-vorm.

- **Geen silent failure**: als de Mailjet send-API een 200 OK retourneert maar de mail is intern niet daadwerkelijk doorgestuurd (bv. ongevalideerde from-address), moet de caller dat zien — niet zwijgend slagen. Hard gate per [`external-services.md` §2](../conventions/external-services.md).
- **Bounce sluit de invite-loop**: na een bounce-event voor een pending invite is die invite `status=expired` met `bouncedAt` gezet, en de inviter ontvangt een notify-mail. Idempotent op `providerEventId` (tweede webhook met zelfde event-id = no-op).
- **Webhook is niet spoofbaar**: een POST op `/email-event` zonder geldige authenticatie wijzigt geen state en mailt niemand. Een aanvaller die de URL kent kan geen invites verlopen.
- **Email-normalisatie blijft consistent**: bounce-handler lookt invites op via lowercase-trimmed email — match met `users`/`invites` schema-invariant. Mixed-case input van Mailjet payload mag de lookup niet missen.
- **NL templates 1:1 met oude AWS**: invite/accept/decline/bounce/flag-decide/problem-report bodies hebben tone-of-voice consistency met de oude SES-templates (geen herformulering). Bron-locatie staat in [`convex/photos.ts:732-735`](../../convex/photos.ts) (flag-decide) — A vertaalt de andere templates uit de oude `blob-images-api*` repo's.
- **Best-effort sends crashen geen mutations**: alle email-sends gebeuren via `ctx.scheduler.runAfter(0, ...)` actions (bestaand patroon in `invites.ts`/`photos.ts`). Een Mailjet-outage of API-fout mag niet de mutation die de schedule deed terugdraaien.

## Edge cases + scope-uitsluitingen

- **In scope**:
  - HMAC/secret-auth op `/email-event` webhook-endpoint (TODO in [`convex/http.ts:14-18`](../../convex/http.ts) afgehandeld)
  - Verified-sender pre-check vóór elke send (hard gate per Mailjet known-issue 2) — keuze tussen per-send REST-call of setup-time cache, A motiveert
  - Implementatie van `internal.invites.sendInviteEmail` action voor 4 kinds: `invite`, `accepted`, `declined`, `bounced`
  - Implementatie van `internal.photos.sendFlagDecisionEmail` action (alleen deny — approve stuurt geen mail per FL2-design)
  - Problem-report email naar webmaster (vanuit `features.create` waar `type="problem"`)
  - NL templates per send-kind (1:1 port van oude SES-templates)
  - Bounce-webhook payload-shape verificatie tegen daadwerkelijke Mailjet Event API v1 docs (huidige aannames in `http.ts:25-32` zijn unverified)
  - Webhook-retries handelen: Mailjet retry't op non-2xx; dedup via `inviteBounceEvents` (al aanwezig) moet onder retry-load correct werken
- **Bewust niet** (voor deze WP):
  - **IB2 cron** (`expirePendingInvites` daily) — hoort bij cron-werkpakket, niet bij email. Cascade matrix bundelt 'm met flagging-cron.
  - **Mailjet sub-account model** — bewust afgewezen per [`external-services.md` §3](../conventions/external-services.md), één primary key only.
  - **Custom email-domain bij Clerk signup-mails** — paid Clerk feature, niet nodig voor 16 users (`accounts.clerk.dev` domain is acceptabel).
  - **Unsubscribe-flow** — Mailjet voegt `List-Unsubscribe` header toe, niet uitzetbaar, geaccepteerd per known-issue 1. Geen eigen unsubscribe-pagina nodig.
  - **Templating-engine** (Handlebars/MJML) — inline string-templates volstaan voor 6 mail-kinds.
  - **Reply-to handling** — out of scope; webmaster reply-flow loopt buiten de app.

## Risico-assessment

- **security/privacy**: medium — PII (namen, group-membership, invite-tokens) in mail body. Webhook is unauthenticated public surface tot HMAC erop zit. Token in invite-link mag niet via mail-body leaken naar onbedoelde ontvangers (lookup-by-email moet hard zijn op normalisatie).
- **ops**: hoog — Mailjet retourneert 200 OK óók bij ongevalideerde sender (silent failure, hard gate); bounce-loop is nu dood in prod (`http.ts` heeft endpoint maar geen auth + payload-shape niet geverifieerd); externe provider zonder retry-guarantee aan onze kant.
- **external deps**: hoog — hele WP draait om Mailjet REST API (send-call + sender-verify endpoint + Event API webhook). Rate limits (Free tier 6000/maand), regional endpoint, payload-shape kan afwijken van docs. Bij escalerende blockers fallback: Scaleway TEM (zie `external-services.md`).
- **multi-user/concurrency**: laag — per-user sends, geen shared state. Dedup via `inviteBounceEvents.by_eventId` is al gepind in unit-tests; race tussen twee parallel webhook-deliveries van zelfde event = één wint via `.unique()` constraint.
- **data/schema-evolutie**: laag — `inviteBounceEvents` table en `invites.bouncedAt` veld bestaan al ([`schema.ts:185-188`](../../convex/schema.ts), `:175`). Géén migratie. Mogelijk optionele `verifiedSenderCache` table als A kiest voor setup-time-gate ipv per-send REST-call — A motiveert; bij toevoeging is het additive zonder backfill (= laag).

## Cross-refs

- **migratie-plan**: §Fase 2 email-bullet ([`docs/migratie-plan-convex.md:910`](../migratie-plan-convex.md)), §Email infrastructure (zoek "Verified-sender-check" rond r.740-745)
- **cascade-matrix**: rij IB1 (bounce → expire + notify), rij FL2 (deny-pad email naar owner) — [`docs/cascade-matrix.md:126,133`](../cascade-matrix.md)
- **oude AWS-code** (alleen A leest):
  - `/Users/wintvelt/Documents/DEV/DEV/blob-images-api-photos/handlersPhoto/flagPhotoDecide.js` r.16-56 (deny-template NL)
  - `blob-images-api*` repo's voor invite/accept/decline/bounce/problem-report SES-templates — A inventariseert exact pad in spec-aanvulling
- **externe service**: [`external-services.md` §Mailjet](../conventions/external-services.md) — drie known-issues, twee als hard gate
- **bestaande backend-haken** (B implementeert *in*, niet *vanaf nul*):
  - `internal.invites.handleBounce` mutation: [`convex/invites.ts:315-357`](../../convex/invites.ts) (af, geen wijziging nodig — alleen webhook-auth ervóór)
  - `internal.invites.sendInviteEmail` stub: [`convex/invites.ts:362-375`](../../convex/invites.ts) (vervangen door echte Mailjet-impl)
  - `internal.photos.sendFlagDecisionEmail` stub: [`convex/photos.ts:726-738`](../../convex/photos.ts) (vervangen door echte Mailjet-impl)
  - `/email-event` http-endpoint: [`convex/http.ts:36-56`](../../convex/http.ts) (auth + payload-verify toevoegen)

## Acceptance — hoe weten we dat het klaar is

### Tests (unit, mock-based)

- `tests/email/mailjetClient.test.ts` — verified-sender gate: send-call moet throwen (of typed error retourneren) wanneer from-address niet in verified-set; happy-path test pinnen.
- `tests/email/webhookAuth.test.ts` — `/email-event` POST zonder/met-verkeerde HMAC/secret → 401, geen state-mutatie; met geldige auth → 200 + delegeert naar `handleBounce`.
- `tests/email/webhookPayloadShape.test.ts` — Mailjet event-array, single-event, missing-fields, niet-bounce-event (delivered/open) — pinnen welke wel/niet doorgegeven worden.
- `tests/email/templates.test.ts` — per send-kind: subject + body bevat de juiste user-data placeholders correct ingevuld (geen "undefined" leaks).
- `tests/invites/sendInviteEmail.test.ts` — action wordt aangeroepen met juiste kind/inviteId per scheduler-call uit `create`/`accept`/`decline`/`handleBounce` (bestaande tests aanvullen, niet vervangen).
- `tests/photos/sendFlagDecisionEmail.test.ts` — action wordt alleen bij deny gescheduled (al gepind in `decideFlag.test.ts`), nu ook: action zelf doet de juiste Mailjet-call met juiste template.

### Integration-tests (`npm run test:integration`, niet in CI)

- `tests/integration/mailjet/sendRoundtrip.test.ts` — echte send-call naar Mailjet sandbox/dev-deployment, assertion op response-shape + Mailjet `MessageID` retour. Sender-verify pre-check ook integration-getest tegen echte REST API (dit is precies de silent-failure-gate).
- Cross-ref: [`integration-tests.md`](../conventions/integration-tests.md) regel "WP5 | Mailjet send + bounce webhook | planned" — afvinken.

### Empirische gate (mens, geen agent)

Twee verplichte gates, beide getekend door Wouter vóór WP-afsluiting:

**Gate 1 — Send-roundtrip (verified-sender silent-failure proof)**:
- Verstuur via dev-deployment een echte invite-mail naar een persoonlijk test-mailbox (gmail/proton — niet de webmaster-mail).
- Mail arriveert in inbox (niet spam): ✅ verified sender werkt.
- Tweede test: verander tijdelijk `WEBMASTER_EMAILS` naar een niet-verified from-address, herhaal: action moet **throwen of error loggen**, niet stilzwijgend slagen. Dit pin't de hard gate.

**Gate 2 — Bounce-roundtrip (webhook end-to-end proof)**:
- Mechanisme: **Mailjet dashboard → Account Settings → Event tracking (Event API) → "Test event" knop, kies event-type `bounce`**. Dit POST't een synthetische bounce-payload naar de geconfigureerde callback-URL `https://<deployment>.convex.site/email-event`.
- Vereist vooraf in dev-deployment: een test-invite aanmaken voor email `bounce-test@example.invalid`, dan in Mailjet dashboard die email als bounce-event triggeren.
- Verificatie via Convex dashboard:
  - (a) Test-event landt in `inviteBounceEvents` met juiste `providerEventId`
  - (b) Pending invite voor `bounce-test@example.invalid` heeft `status=expired` + `bouncedAt` gezet
  - (c) Tweede klik op dezelfde test-event-knop is no-op (zelfde `providerEventId` → `inviteBounceEvents`-rij blijft 1, geen duplicate notify-mail)
  - (d) Notify-mail naar inviter is verstuurd (controleer in Mailjet dashboard Send statistics)
- **Niet** "real-domain hard-bounce" als gate-mechanisme — onbetrouwbaar (DNS-timing, MX-fallback). Dashboard-knop is deterministisch en bewijst de complete loop incl. payload-shape.

### Setup 6 — adversarial pass

Post-impl, vóór WP-afsluiting: red-team-sessie kijkt specifiek naar:
- Webhook spoof-paden (HMAC bypass via timing, missing-header, replay)
- Silent-failure paden (Mailjet 200 OK zonder send — sender niet verified, sub-account quirk, rate-limit)
- PII-leak (invite-token in verkeerde mail-body, mixed-case email lookup-miss)
- Payload-shape divergence (Mailjet stuurt array vs single, missing `MessageID`)

Findings: verbatim quotes voor de hoogste-severity items naar Wouter, niet vooraf-gefilterd door B (Setup 6 alleen-interpretatie-verbod, zie phase-kickoff skill standing rules).

---

## Spec-criticus aanvullingen (A vult in)

A leest oude AWS-code + cascade-matrix + bovenstaande spec, vult hier aan:

- Ontbrekende invarianten: ...
- Gemiste edge cases: ...
- Risico-dimensie die regie overschatte/onderschatte: ...
- Open product-vragen voor regie/Wouter: ...
- Inventarisatie oude SES-templates (exacte paden per send-kind): ...
- Keuze verified-sender mechanisme (per-send REST-call vs setup-time cache) + motivatie: ...
- Keuze webhook-auth mechanisme (Mailjet HMAC indien beschikbaar vs shared-secret header) + motivatie: ...

(Leeg in draft. A commit edits hier.)
