# Externe service keuzes

## Geocoding: Photon (Komoot)

Gekozen 2026-05. Geen API key nodig (publieke instance op `photon.komoot.io`). Fair-use voor 16-user volume. URL gebruikt `lang=en` voor internationale leesbaarheid (Georgië/Nepal scenario's). Vervangt MapQuest die wegens revoked keys + paid-only tier niet meer geschikt was.

Endpoint: `https://photon.komoot.io/reverse?lat=<lat>&lon=<lon>&lang=en`
Header: `User-Agent: Clubalmanac/2.0` (fair-use vereiste)

## Email: Mailjet (Frankrijk)

Gekozen 2026-05. EU-based, GDPR-compliant. Free tier 6000/maand voldoende voor 16-user volume. Voor invites + member changes + flag-decide notifications + bounce webhook. Geïmplementeerd in WP5 (2026-05-17).

### Vereiste env-vars per deployment

WP5 introduceert 5 env-vars. Alle vijf moeten op zowel dev als prod gezet zijn — anders fail-loud throw bij eerste send. Geen "stille" fallback-defaults meer (WP5-audit S-3 fix: APP_URL had silent prod-fallback, STAGE had silent "dev"-fallback — beide leidden tot subtiele mis-routing).

| Env-var | Waarde dev | Waarde prod | Wat gebeurt bij ontbreken |
|---|---|---|---|
| `MAILJET_API_KEY` | dev-key uit Mailjet dashboard | prod-key uit Mailjet dashboard | `MAILJET_CREDS_MISSING:` throw vóór fetch (WP5-audit N-1 fix) |
| `MAILJET_API_SECRET` | dev-secret | prod-secret | idem |
| `MAILJET_WEBHOOK_SECRET` | gegenereerde random string, zelfde in Mailjet dashboard webhook-config | aparte prod-string | `/email-event` → 503, geen state-mutatie |
| `MAILJET_VERIFIED_SENDERS` | comma-sep van alle from-addresses die in code voorkomen (`invites@…`, `info@…`) | idem, met prod-domain | `UNVERIFIED_SENDER:` throw vóór elke send |
| `CLUBALMANAC_APP_URL` | dev-app-host (bv. `http://localhost:5173`) | `https://clubalmanac.com` | throw bij `buildInviteUrl`-call (S-3 fix) |
| `CLUBALMANAC_STAGE` | `"dev"` | `"prod"` | throw bij `getStageLabel`-call op problem-report-pad (S-3 fix) |

### Rotation

Mailjet keys roteren via dashboard + Convex env-var update. `MAILJET_VERIFIED_SENDERS` aanpassen wanneer een nieuwe from-address wordt toegevoegd of een bestaande sender-verification verloopt in Mailjet. Geen hot-reload nodig — Convex actions lezen env-vars vers per call.

### Known issues en geaccepteerde trade-offs (2026-05-15)

Tijdens setup en eerste integratie-werk drie fricties geconstateerd. Bewust geaccepteerd of als hard gate in WP5-impl opgenomen.

### Known issues en geaccepteerde trade-offs (2026-05-15)

Tijdens setup en eerste integratie-werk drie fricties geconstateerd. Bewust geaccepteerd of als hard gate in WP5-impl opgenomen.

1. **Mailing list header**: Mailjet voegt op alle tiers een `List-Unsubscribe` header toe aan transactional emails. Niet uitzetbaar. Voor CA's invites/notifications acceptabel — gebruikers verwachten geen opt-out, maar 'm hebben is geen breaker. Andere providers zoals Scaleway TEM bieden 'm niet; bij voldoende frictie heroverwegen.
2. **Silent failure op niet-gevalideerde sender**: Mailjet retourneert `200 OK` op de send-API ook wanneer de from-address niet geverifieerd is. Mail wordt dan niet verstuurd zonder dat de caller dat ziet. **Hard gate voor WP5-impl**: vóór elke send een verified-sender-check via Mailjet's REST API (`/REST/sender` endpoint), of een setup-time-gate die alle gebruikte from-addresses op deployment-start verifieert. Niet vertrouwen op send-response.
3. **Sub-account API key frictie**: Mailjet's "primary + sub-account" key-model gaf onbekende frictie (root cause niet achterhaald). Voor CA: één primary API key gebruiken, geen sub-accounts. Bij meerdere projecten op één account: sender-domain-separation of een aparte account per project — niet sub-accounts.

Bij escalerende blockers op één van deze drie: heroverweeg Scaleway TEM. Pre-onderzoek 2026-05-15 toonde dat Scaleway bounce-webhook nog in beta is + geen HMAC biedt + payload-shape volledig anders (delivery via Topics-and-Events-topic ipv direct POST). Switch is niet 1-op-1 maar wel mogelijk.

### Mail-templates per kind

Alle templates leven in [`convex/lib/emailTemplates.ts`](../../convex/lib/emailTemplates.ts) en gaan via `sendMailjetMessage` met de per-kind sender-policy.

| Kind | Sender | Bestemming | Subject (samengevat) | Body bevat |
|---|---|---|---|---|
| `invite` | `invites@` | geïnviteerde | "… nodigt je uit …" | inviter-naam, groep, invite-link + token, expiry |
| `accepted` / `declined` / `bounced` | `invites@` | inviter | accept/decline/bounce-melding | inviter-naam, accepter/decliner-naam, groep |
| `flagDecisionDeny` | `info@` | photo-owner | "Je bezwaar … is afgewezen" | owner-naam |
| `problemReport` | `info@` | `WEBMASTER_EMAILS` | "Probleem gemeld op {stage}" | submitter-naam/email, titel, beschrijving |
| `monitor-drift-alert` (WP10) | `info@` | `WEBMASTER_EMAILS` | "Clubalmanac integriteits-check: drift gedetecteerd (N)" | run-timestamp + per drift-rij `table/id: detail` (counts + IDs). **Géén user-content** (geen namen, emails, comments) — PII-grens invariant 9 |
| `monitor-heartbeat` (WP10) | `info@` | `WEBMASTER_EMAILS` | "Clubalmanac integriteits-check: maandelijkse heartbeat" | run-timestamp + "monitor draait nog"-tekst. Geen drift-data |

WP10-monitoring (`convex/monitoring.ts`) gebruikt dezelfde `info@`-sender en `getWebmasterEmails()`-bestemming als `problemReport`. Geen nieuwe env-vars: `WEBMASTER_EMAILS` is bestaand. Best-effort: lege `WEBMASTER_EMAILS` → no-op zonder throw (mag de daily cron niet stuk maken).

## Auth: Clerk

`picked-quail-97.clerk.accounts.dev` is de dev instance. Free tier vanaf `accounts.clerk.dev` voor signup-mails (geen custom email domain — paid feature, niet nodig voor 16 signups).

Webmaster-rol via env-var `WEBMASTER_EMAILS` met case-insensitive match (audit-7 fix).

### Vereiste env-vars per deployment (WP6)

| Env-var | Waarde dev | Waarde prod | Wat gebeurt bij ontbreken |
|---|---|---|---|
| `WEBMASTER_EMAILS` | comma-sep, bv. `clubalmanac-integration-webmaster@example.com` | comma-sep, bv. `wintvelt@me.com` | webmaster-bypass werkt niet; bootstrap onmogelijk |
| `CLERK_WEBHOOK_SECRET` | `whsec_<base64>` uit Clerk dashboard (Webhooks → Add endpoint → Signing secret) | aparte prod-`whsec_<base64>` | `/clerk-webhook` retourneert 503 voor élk POST (fail-closed, geen accidenteel-open endpoint) |

Webhook-config Clerk dashboard:
- **URL**: `https://<deployment>.<region>.convex.site/clerk-webhook` (region-suffix verplicht, zelfde discipline als Mailjet — zie [`work-packages/WP5-email.md`](../work-packages/WP5-email.md) §Webhook-auth correctie 2026-05-18)
- **Events**: minimaal `session.created`. Andere events (`user.created`, `user.deleted`, etc.) worden 200-no-op door handler — geen schade, maar minder webhook-traffic = minder noise
- **Signing**: standard Svix HMAC, geheel door Clerk geleverd. `CLERK_WEBHOOK_SECRET` is uit dashboard gekopieerd, **niet** zelf via `openssl rand -hex 32` gegenereerd zoals bij Mailjet
- **Verification settings** (Clerk Configure → Email, Phone, Username): email-verification = **required before session**. Default-on; controleer dat 't aan blijft. Onverified-primary-email-pad in handler is defensive safety-net en mag niet getriggerd raken in normale flow

Verified per WP6-spec §risico-assessment + §ops-runbook-impact + [`audit-track-record.md`](./audit-track-record.md) recurring-pattern §env-var-runbook-gap.

## Productie-blind-spots

JWT validation roundtrip, Mailjet bounce webhook, Photon connection: deze zijn unit-test alleen via mocks gevalideerd. Echte service-integratie loopt via de [integration-test laag](./integration-tests.md) (`npm run test:integration`, niet in CI), per werkpakket apart. Photon (WP1) is gepind; Convex/Clerk/Mailjet (WP2-4) staan op de planning.

## Waarom deze keuzes

Eerlijke evaluatie tegen 16-user hobby use case. EU-providers waar mogelijk voor GDPR-coherentie. Geen paid services voor functionaliteit die gratis kan.
