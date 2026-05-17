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

## Spec-criticus aanvullingen (A)

### Aanvullende invarianten

- **Notify-mail recipient = inviter via FK-walk**: voor `sendInviteEmail({kind ∈ {accepted, declined, bounced}})` is de ontvanger `users.get(invite.invitedBy).email`. Subject + body gebruiken `inviter.name ?? inviter.email` (naam-fallback). Voor `kind = "invite"` is de ontvanger het invite-email-adres zelf (de geïnviteerde). De action mag **niet throwen** als de inviter inmiddels weg is (user.deleteSelf vóór de scheduled-action draait) — log + skip. Idem voor flag-decide-deny als de owner inmiddels weg is.

- **Mailjet sender-policy per send-kind** (uit plan-doc r.723, bevestigd-verified senders):
  - `invite | accepted | declined | bounced` → from-address `invites@clubalmanac.com`
  - `flagDecisionDeny` → from-address `info@clubalmanac.com`
  - `problemReport` → from-address `info@clubalmanac.com`
  - From-addresses zijn beleid van WP5, niet open voor B-keuze. Eén centrale mapping (B's keuze waar — module-scope of helper).

- **Webhook-auth invariant**: een POST op `/email-event` zonder `Authorization: Bearer <MAILJET_WEBHOOK_SECRET>` (header missing of mismatch) retourneert **401**, roept `internal.invites.handleBounce` **niet** aan, en muteert geen state. Geldige Bearer + bounce-payload → 200 + delegation. Env-var ontbreekt op deployment → **alle** requests 503 (fail-closed; geen accidenteel open endpoint).

- **Verified-sender gate als hard-fail vóór elke Mailjet-call**: élke send-action checkt `isSenderVerified(fromAddress)` vóór de daadwerkelijke fetch. Niet-verified → typed `Error("UNVERIFIED_SENDER: <from>")` (gepin'd string-prefix zodat callers kunnen onderscheiden). Mailjet wordt **niet aangeroepen** in dit pad — anders trekt Mailjet de send aan zonder te versturen (zie known-issue 2) en is de gate loos. Gate-source-of-truth = env-var `MAILJET_VERIFIED_SENDERS` (comma-separated, case-insensitive match). Lege/ontbrekende env-var → álle sends throwen (fail-closed default).

- **Mailjet API-fout = throw**: send-action throwt op non-2xx response van Mailjet. Op 2xx response throwt 'ie niet — Mailjet's silent-failure-pad (2xx + niet verstuurd) is afgevangen door de pre-flight verified-sender-gate. We bouwen géén response-body-parsing als tweede gate, want dat geeft schijnzekerheid: Mailjet's docs reserveren response-shape onder geen contract.

- **Best-effort retry-risk**: Convex scheduler kan een action herhalen bij transient failure. Als Mailjet de eerste send succesvol verwerkt en de action vervolgens throwt op een latere stap (zeldzaam, want fetch is de laatste stap), kan een retry leiden tot dubbel-verzonden mail. Voor 6 mail-kinds + 16-user volume bewust geaccepteerd. Géén dedup-tabel à la `inviteBounceEvents`. Geadresseerd in audit-discussie indien escalerend.

- **Webhook idempotent op non-bounce-event types**: een geldig-geauthenticeerde POST met `event ∈ {open, click, sent, spam, unsub}` → 200, geen state-mutatie, geen call naar handleBounce. Reden: Mailjet retry't op non-2xx; we willen niet dat Mailjet de webhook disablet door geretourneerde 4xx op verwachte non-bounce events.

### Aanvullende edge cases

- **Bounced inviter is verwijderd**: action haalt inviter op via `ctx.runQuery(... invite.invitedBy)`. `users.get` retourneert `null` als deleteSelf inmiddels gedraaid heeft. Action moet gracefully skip (geen mail, geen throw, log).
- **Mailjet payload-shape variaties** die op het webhook-endpoint kunnen aankomen:
  - Array van events (productie-default voor batched delivery)
  - Single-event object (dashboard "Test event"-knop)
  - Missing `MessageID` of `event_id` → skip dit event, ga door met de rest
  - Missing `email` → skip dit event
  - Event-types andere dan `bounce` | `blocked` → skip met 200 (geen retry-trigger)
- **Mixed-case email in Mailjet payload**: `handleBounce` normaliseert al (via `findInvitesByEmail` → `normalizeEmail`). Pin in test dat `Bouncer@X.com` in payload de invite voor `bouncer@x.com` raakt.
- **PII in mail-body**: invite-token mag alleen in de `invite`-mail naar de bedoelde ontvanger zelf. Accept/decline/bounced-notify naar inviter mogen géén invite-token bevatten. Pin in template-tests.
- **Whitespace in env-var `MAILJET_VERIFIED_SENDERS`**: `" invites@clubalmanac.com , info@clubalmanac.com "` moet leiden tot een verified-set van twee adressen. Trim + lowercase per item.
- **`features.create` met `type="problem"`**: schedule't `internal.features.sendProblemReport` action. `type="feature"` schedule't géén email. Pin met scheduler-count delta.
- **Verified-sender gate met case-mismatch**: `Invites@ClubAlmanac.com` vs env-var `invites@clubalmanac.com` → match (case-insensitive). Spiegelt audit-7 webmaster-match-discipline.

### Risico-dimensies herijking

- **Overschat door regie — data/schema-evolutie**: géén nieuwe DB-tabel nodig. Geen `verifiedSenderCache`-tabel (zie keuze-motivatie). Geen migratie. WP5 raakt schema *niet*.
- **Onderschat door regie — env-var-ops-belasting**: drie nieuwe env-vars verschijnen (`MAILJET_API_KEY`, `MAILJET_API_SECRET`, `MAILJET_WEBHOOK_SECRET`, `MAILJET_VERIFIED_SENDERS`). Bij rotation in Mailjet (key revoke, sender DNS-rotation) moet Wouter ze in Convex dashboard pasten. Documenteren in deploy-runbook (out-of-scope voor WP5, flagged voor cutover-prep).
- **Onderschat door regie — empirische Gate 1 wording**: draft zegt "verander tijdelijk `WEBMASTER_EMAILS` naar niet-verified from-address". Dat is de verkeerde env-var — `WEBMASTER_EMAILS` is RBAC-recipiënt, niet sender. Correctie: verander `MAILJET_VERIFIED_SENDERS` zodat de sender die problemReport gebruikt (`info@clubalmanac.com`) **niet** meer in de set staat, herhaal de send, verwacht throw. Of: voeg een test-action toe die expliciet een unverified-from gebruikt.
- **Underspec'd — replay-aanval op /email-event**: een aanvaller die zowel `MAILJET_WEBHOOK_SECRET` als een legacy `providerEventId` weet, kan het webhook hercallen — maar `inviteBounceEvents.by_eventId`-dedup vangt dat af (no-op). Acceptabel als second line of defense. Hoofdverdediging blijft secret-rotation bij compromise.

### Open product-vragen voor regie/Wouter

1. **Problem-report ontvanger**: webmaster (via `WEBMASTER_EMAILS[0]`) of vast `info@clubalmanac.com`? Voorstel: webmaster, hergebruik bestaand env-var; geen tweede ops-touchpoint. Bij meerdere webmasters in env-var: stuur naar alle (CC of TO-list). - AKKOORD
2. **Bounce-template tone-of-voice**: oude AWS had géén bounce-template (zie inventarisatie). Voorstel-tekst hieronder; akkoord of revisie? - AKKOORD
3. **Reply-to-policy**: alle outgoing → reply-to `info@clubalmanac.com`, of geen expliciete reply-to (default = from)? Voorstel: geen expliciete reply-to; from = ontvanger-route. Lichter te configureren in Mailjet, geen extra mailbox-overhead. - AKKOORD
4. **Group-delete notify-mail (oude `memberMail-lib.js`)**: oude AWS stuurde bij M2(e) cascade (laatste lid weg → group delete) een notify-mail naar alle ex-leden. Niet in v2-WP5-scope per draft. Bevestigen: bewust geschrapt, of mini-cyclus na WP5? Voorstel: schrappen — bij 16-user app gaat group-delete via expliciete user-actie en is in-app-notify (via membership-delete uit `groups.remove` cascade) voldoende. - AKKOORD

### Inventarisatie oude SES-templates

Exacte AWS-paden voor 1:1 NL tone-of-voice port.

| Kind | AWS-handler / template | NL-subject template | NL-body kernregel |
|---|---|---|---|
| `invite` (naar ontvanger) | `blob-images-api-groups/handlersGroup/sendInvite.js` r.84-99 + `blob-images-api-groups/emails/invite.js` r.9-35 | `${user.name} nodigt je uit om lid te worden van "${group.name}"` | `${fromName} nodigt je uit om lid te worden van ${groupName} op clubalmanac` + optional `message` + button "Bekijk online" → inviteUrl + `Deze uitnodiging is geldig tot ${expirationDate}` |
| `accepted` (naar inviter) | `blob-images-api-invites/handlersInvite/acceptInvite.js` r.62-79 + `blob-images-api-invites/emails/acceptedInvite.js` r.9-33 | `${fromName} heeft je uitnodiging om lid te worden van "${groupName}" geaccepteerd` | `Hi ${toName}, Yeey! ${fromName} heeft je uitnodiging om lid te worden van ${groupName} geaccepteerd (en terecht). Kijk op de ${groupName} pagina om te zien of er nieuws is.` |
| `declined` (naar inviter) | `blob-images-api-invites/handlersInvite/publicDeclineInvite.js` r.32-36 + `blob-images-api-invites/emails/declinedInvite.js` r.9-33 | `Helaas! ${fromName} heeft je uitnodiging om lid te worden van "${groupName}" afgewezen` | `Hi ${toName}, Balen! ${fromName} heeft je uitnodiging om lid te worden van ${groupName} afgewezen. Typisch geval van ongepast eigen initiatief. Vind troost en gezelligheid bij vrienden op de ${groupName} pagina.` |
| `bounced` (naar inviter) | **Nieuw in v2** — oude AWS had geen bounce-feedback loop. A-draft, zie hieronder. | `Je uitnodiging voor "${groupName}" kon niet worden afgeleverd` (of `Je uitnodiging via clubalmanac kon niet worden afgeleverd` als `groupName` ontbreekt) | `Hi ${inviterName}, de uitnodiging die je naar ${bouncedEmail} hebt gestuurd is teruggekomen. Het emailadres lijkt niet (meer) te bestaan. Controleer of het adres klopt en probeer het opnieuw.` |
| `flagDecisionDeny` (naar photo-owner) | `blob-images-api-photos/handlersPhoto/flagPhotoDecide.js` r.20-23 (text), r.41-56 (body), r.123-136 (call) | `Je bezwaar over een melding voor ongepaste inhoud is afgewezen` | `Hi ${toName}, HELAAS: Je bezwaar op de melding op 1 van je foto's is afgewezen. De foto zal binnenkort definitief van clubalmanac worden verwijderd.` |
| `problemReport` (naar webmaster) | `blob-images-features/handlersProblem/problemMail.js` r.9-31 + `create.js` r.10-17 | `Probleem gemeld op ${STAGE}` (STAGE = dev/prod, op te lossen via env-var of `process.env.CONVEX_CLOUD_URL`-parse) | `Hi Admin, Er is een probleem gemeld op de ${STAGE} omgeving. Door ${name}, vanaf ${email}, op ${timestamp}. "${description}"` (+ optional logs) |

**Tone-of-voice constraints** (bewust niet gewijzigd t.o.v. oude code):
- Informeel "Hi ${name},"
- NL throughout, geen Engelse afsluiting
- Mailjet voegt `List-Unsubscribe` header toe (known-issue 1, niet uitzetbaar, geaccepteerd)
- Geen handtekening-image (oude AWS gebruikte `signature_wouter.png` via S3 public-URL; v2 gebruikt inline tekst-afsluiting om hosting-dependency te vermijden — accept loss of visual polish voor minder ops-load)

### Keuze verified-sender mechanisme — env-var-driven gate

**Gekozen**: env-var `MAILJET_VERIFIED_SENDERS` (comma-separated, lowercased+trimmed lijst). Gate-helper `isSenderVerified(fromAddress)` leest de env-var op elke call en doet case-insensitive set-lookup. Élke send-action checkt vóór de Mailjet-fetch.

**Motivatie**:
- **Predictability**: lijst staat in deployment-config, leesbaar in Convex dashboard. Geen runtime-network-call die kan time-outen of nieuwe failure-modes introduceren.
- **Performance**: geen extra REST-call per send. Mailjet free-tier is 6000/maand totaal — een per-send `/REST/sender`-fetch zou óf het quotum halveren (als dezelfde tier-counter telt) óf latency verdubbelen.
- **Fail-closed semantiek**: env-var ontbreekt → álle sends throwen met `UNVERIFIED_SENDER:`-prefix. Mailjet-API-down beïnvloedt de gate niet — gate is independent.
- **Ops-belasting**: aanpassen na Mailjet sender-status-change (zelden, jaarlijks order-of-magnitude). Documenteren in cutover-runbook.

**Alternatief afgewezen — per-send REST-call**: extra latency per mail, halveert effectieve free-tier quotum, introduceert tweede failure-mode (Mailjet REST-API down ≠ Mailjet send-API down), geen voordeel boven stabiele env-var.

**Alternatief afgewezen — setup-time module-scope cache**: Convex action-runtime heeft geen warm-start-garantie; module-scope state werkt onbetrouwbaar over isolations heen. Een dedicated `internal.email.refreshVerifiedSenders` op deploy-trigger plus DB-tabel-cache zou wel werken, maar voegt complexiteit toe (extra tabel, extra trigger, geen winst boven env-var).

### Keuze webhook-auth mechanisme — Bearer-secret

**Gekozen**: `Authorization: Bearer <MAILJET_WEBHOOK_SECRET>` header. Webhook-endpoint vergelijkt header tegen env-var (case-sensitive secret-string, hele header `=== "Bearer " + secret`). Mismatch of missing → 401, geen handleBounce-call. Env-var ontbreekt op deployment → **alle** /email-event-POSTs → 503 (fail-closed, hard ops-error).

**Motivatie**:
- **Mailjet biedt geen HMAC-signing op Event API** (verified per docs lookup 2026-05). Shared-secret in custom header is de gangbare oplossing voor deze provider.
- **Custom-header support**: Mailjet dashboard ondersteunt per-webhook-URL custom headers. Header-config = deploy-time, secret rotation via env-var-update + dashboard-update.
- **Constant-time compare** is good-to-have. Voor 6000/maand 1-secret-low-volume niet load-bearing; B mag `===` gebruiken. (Audit kan dit opbrengen als findings als ze willen verhogen.)

**Alternatief afgewezen — query-string secret**: lekt in proxy-logs en HTTP-access-logs van Convex-side.

**Alternatief afgewezen — IP-whitelist Mailjet-egress-ranges**: Mailjet publiceert geen vaste IP-allowlist; ranges veranderen. Webhook breekt onbedoeld.

**Alternatief afgewezen — basic-auth in URL**: zelfde leak-pad als query-string; geen winst boven Bearer-header.

### Test-locatie note voor B/audit

A schrijft tests onder:
- `tests/email/` — nieuw — Mailjet client-helper + webhook-auth + payload-shape + template-rendering
- `tests/invites/sendInviteEmail.test.ts` — action wiring per kind
- `tests/photos/sendFlagDecisionEmail.test.ts` — action wiring voor deny (approve-skip is al gepin'd in `decideFlag.test.ts`)
- `tests/features/sendProblemReport.test.ts` — scheduler-call vanuit `features.create` met `type="problem"`

Geen wijzigingen aan bestaande `tests/invites/bouncedHandler.test.ts` (handleBounce is af, blijft af).

---

## Audit-follow-up (post-audit-2026-05-17)

Audit-rapport vond geen blockers, drie should-fix (S-1/S-2/S-3) en één relevante nice-to-have (N-1). Twee aparte cycli: A-only voor regression-guards + RED tests; B daarna voor de twee impl-changes.

### A-taken (één commit, eindigt RED voor de impl-changes)

**S-1 — webhook-auth strict-equality varianten** in [`tests/email/webhookAuth.test.ts`](../../tests/email/webhookAuth.test.ts):

Vier extra negatieve cases die pinnen dat `convex/http.ts:51` `auth !== "Bearer " + secret` strikt blijft (= geen toekomstige refactor naar `.startsWith()` zonder dat tests klagen):

1. lowercase prefix `"bearer <SECRET>"` → 401, geen `handleBounce`-call
2. dubbele spatie `"Bearer  <SECRET>"` → 401
3. geen spatie `"Bearer<SECRET>"` → 401
4. leading whitespace `" Bearer <SECRET>"` → 401

Allemaal: assert geen state-mutatie (`inviteBounceEvents.collect().length === 0`). **Verwacht: GROEN** (code is al strict-equality).

**S-2 — end-to-end replay door webhook-laag** in [`tests/email/webhookPayloadShape.test.ts`](../../tests/email/webhookPayloadShape.test.ts):

Eén case die dezelfde geldig-geauthenticeerde POST tweemaal stuurt en assert:
- `inviteBounceEvents.collect().length === 1` na de tweede call
- Géén tweede notify-mail-schedule (scheduler-count delta = 0 op tweede call)

Dedup zit al in `convex/invites.ts:333-339` en is gepin'd in `tests/invites/bouncedHandler.test.ts` — maar de end-to-end-replay via de Bearer-laag was niet gepin'd. **Verwacht: GROEN** (handleBounce is al idempotent).

**S-3 — fail-loud env-var tests** in nieuwe file [`tests/email/envVarGates.test.ts`](../../tests/email/envVarGates.test.ts):

Twee testen die rood eindigen voor B:
1. `getStageLabel()` throwt met prefix `STAGE_MISSING:` (of vergelijkbare gepin'de string) als `CLUBALMANAC_STAGE` unset — pin't dat silent `"dev"`-fallback weg is
2. `buildInviteUrl(token)` throwt met prefix `APP_URL_MISSING:` als `CLUBALMANAC_APP_URL` unset — pin't dat silent `"https://clubalmanac.com"`-fallback weg is

Daarnaast happy-path-tests die pinnen dat met env-var gezet alles werkt zoals voorheen. **Verwacht: ROOD voor de fail-loud cases tot B impl-change doet.**

**N-1 — Mailjet creds fail-fast** in [`tests/email/mailjetClient.test.ts`](../../tests/email/mailjetClient.test.ts):

Eén test die assert: `sendMailjetMessage()` throwt met prefix `MAILJET_CREDS_MISSING:` wanneer `MAILJET_API_KEY` of `MAILJET_API_SECRET` leeg/unset is — **vóór** de fetch (assert geen network-call via `fetch`-mock spy). Spiegelt de bestaande verified-sender-gate-discipline (fail-closed vóór externe call ipv vertrouwen op 401-roundtrip). **Verwacht: ROOD tot B impl-change doet.**

A doet géén impl-werk. Commit-titel-suggestie: `WP5(A-followup): regression-guards + RED tests voor S-3 + N-1`.

### B-taken (volgende cyclus, na A-commit)

Drie kleine impl-changes:

1. [`convex/lib/emailTemplates.ts:235`](../../convex/lib/emailTemplates.ts) `buildInviteUrl`: vervang silent fallback `?? "https://clubalmanac.com"` door fail-loud throw `APP_URL_MISSING: CLUBALMANAC_APP_URL env-var unset`.
2. [`convex/lib/emailTemplates.ts:243`](../../convex/lib/emailTemplates.ts) `getStageLabel`: vervang silent fallback `?? "dev"` door fail-loud throw `STAGE_MISSING: CLUBALMANAC_STAGE env-var unset`.
3. [`convex/lib/mailjet.ts:71`](../../convex/lib/mailjet.ts) `sendMailjetMessage`: na `assertVerifiedSender(msg.from.email)`, voeg `assertMailjetCreds()`-helper toe die throwt `MAILJET_CREDS_MISSING:` als `MAILJET_API_KEY` of `MAILJET_API_SECRET` leeg/unset.

Tests-runbook-impact: `tests/email/*.test.ts` setups die `MAILJET_VERIFIED_SENDERS` zetten moeten nu ook `CLUBALMANAC_APP_URL` + `CLUBALMANAC_STAGE` + `MAILJET_API_KEY` + `MAILJET_API_SECRET` zetten waar de gemockte fetch het verwacht. B mag bestaande tests aanpassen waar de fail-loud throw ze nu rood maakt — dat is impl-driven test-onderhoud, geen scope-uitbreiding.

Bijwerking deploy-config: [`docs/conventions/external-services.md`](../conventions/external-services.md) Mailjet-sectie heeft de 5 env-vars al beschreven (regie-commit `deee104`). B hoeft daar niets aan te doen.

Commit-titel-suggestie: `WP5(B-followup): STAGE/APP_URL/Mailjet-creds fail-loud`.

### Audit (deze follow-up)

Niet nodig — fixes zijn directe respons op specifieke audit-bevindingen met file:line, en de impl-changes zijn klein + gespiegeld op bestaande pattern (`assertVerifiedSender`). Bij twijfel: regie reviewt B's commit zelf.
