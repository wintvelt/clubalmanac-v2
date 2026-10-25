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
| `monitor-heartbeat` (WP10) | `info@` | `WEBMASTER_EMAILS` | "Clubalmanac integriteits-check: maandelijkse heartbeat" | run-timestamp + "monitor draait nog"-tekst. Conditioneel op drift-aanwezigheid: bij gededupte openstaande drift een waarschuwingszinsnede ("openstaande drift" + verwijzing naar dashboard-log) zonder drift-IDs (PII-grens invariant 9 blijft); schone run zonder waarschuwing |

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

### App-client-env (WP13)

De Expo-app in `app/` leest twee publieke vars. Ze komen leesbaar in de app-bundel; nooit een `sk_…` gebruiken (de app weigert die bij de start).

| Env-var | Waarde dev | Waarde prod | Wat gebeurt bij ontbreken of ongeldig |
|---|---|---|---|
| `EXPO_PUBLIC_CONVEX_URL` | `https://glorious-pheasant-759.eu-west-1.convex.cloud` | prod-`https://<deployment>.<region>.convex.cloud` (fase 5) | app toont bij de start "verkeerd ingesteld" met de var-naam; geen terugval |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_test_…` van `picked-quail-97` (Clerk → API keys) | `pk_live_…` van de prod-instance (fase 5) | idem |

- **Lokaal**: `app/.env.local` (gitignored via de root-`.gitignore`). Sjabloon: `app/.env.example`. Expo leest het bestand bij `npx expo start` / `expo run:ios`.
- **EAS**: als EAS-env-var per EAS-omgeving, zie §EAS-build en TestFlight hieronder.
- **Verkeerde combinatie** (URL van de ene, key van de andere omgeving): de app start, maar Convex weigert het token. De app toont dan "Verbinden met de server lukt niet" met een uitlog-knop.

Clerk-dashboard voor de app-login (per instance, dev al gedaan, prod in fase 5):
- **Configure → Email, Phone, Username**: e-mailadres met **verificatiecode** als enige inlogmethode. Wachtwoord uit. Sign-up uit of invite-only.
- **Configure → Attack protection**: bescherming tegen enumeratie aan. De app verraadt een onbekend adres ook niet als die uit staat.
- **Configure → Native applications**: Native API aan.
- **JWT-template `convex`**: bestaat al (WP4); zonder template weigert Convex het token.

### EAS-build en TestFlight (WP14)

Config: [`app/eas.json`](../../app/eas.json). EAS project `@wintvelt/clubalmanac-app` (`bd5c6c93-…`), owner `wintvelt` in `app/app.json`. ASC-app-ID `1663038609` staat in `eas.json` §submit.

| Profiel (build + submit) | EAS-omgeving | Backend | Status |
|---|---|---|---|
| `dev` | `development` | `glorious-pheasant-759` + `picked-quail-97` | in gebruik (TestFlight, internal testing) |
| `production` | `production` | prod (fase 5) | nog geen env-vars: een build start met "verkeerd ingesteld" |

- **Node**: 24 overal. `.nvmrc` (root) stuurt CI en lokaal fnm, `engines` + `engine-strict` in beide `package.json`'s laten `npm ci`/`npm install` op een andere versie stoppen met `EBADENGINE`. EAS leest `.nvmrc` niet: `eas.json` `build.base.node` pint een exacte 24-versie. Bij een Node-update beide aanpassen.
- **Buildnummer**: `appVersionSource: remote` + `autoIncrement`. EAS telt door; `app.json` heeft geen `buildNumber`. Laatste oude build in App Store Connect is 38, dus de teller moet op ≥ 38 staan vóór de eerste build.
- **Wat EAS uploadt**: de hele git-repo (de app typecheckt tegen `../convex`), zonder wat `.gitignore` uitsluit. Dus geen `app/ios/` (EAS doet zelf prebuild uit `app.json`), geen `.env.local`, geen `backups/` of `scripts/.data/`. Maak géén `.easignore`: die vervangt `.gitignore` voor EAS, en dan gaat prod-data mee als je hem niet volledig overneemt.
- **Env-vars**: alleen de twee `EXPO_PUBLIC_`-vars, zichtbaarheid `plaintext` (publiek). Geen geheimen in EAS-env-vars of `eas.json`.
- **Credentials**: EAS-managed. Distributiecertificaat en provisioning profile maakt EAS aan of vernieuwt ze tijdens `eas build`, na login met Apple ID. Voor `eas submit` laat EAS een App Store Connect API key aanmaken en bewaart die. Wouter beantwoordt deze vragen zelf.
- **Exportcompliance**: `ios.config.usesNonExemptEncryption: false` (alleen standaard-HTTPS). App Store Connect vraagt het dan niet per build.
- **Alleen internal testing** zolang de build tegen dev praat (echte data van dev-users). Geen externe testers, geen Beta App Review.

Gate-commando's (Wouter, in `app/`, Node 24 actief):

1. Node 24 via fnm: `brew install fnm`, `eval "$(fnm env --use-on-cd --version-file-strategy=recursive)"` in `~/.zshrc`, dan `fnm install 24 && fnm default 24`. `recursive` is nodig omdat `.nvmrc` alleen in de root staat en je in `app/` werkt. Een terminal die al open was, ziet dit pas na `fnm use 24` of in een nieuw tabblad. Check: `node -v` toont `v24.x`.
2. `npm install -g eas-cli@25.3.0` (vaste versie, geen `latest`) en `eas login`. Check: `eas whoami` toont `wintvelt`.
3. Env-vars voor `development`, waarden uit `app/.env.local` (niet de root-`.env.local`, die is van de backend):
   - `eas env:set --environment development --name EXPO_PUBLIC_CONVEX_URL --value https://glorious-pheasant-759.eu-west-1.convex.cloud --visibility plaintext --scope project`
   - `eas env:set --environment development --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value "$(grep '^EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=' .env.local | cut -d= -f2- | tr -d '"')" --visibility plaintext --scope project`
   - Check: `eas env:list --environment development`
4. Buildteller: `eas build:version:get -p ios -e dev`. Lager dan 38 of leeg: `eas build:version:set -p ios -e dev` en vul `38` in. Een mislukte build kan een nummer verbruiken; dat is geen probleem.
5. `eas build -p ios --profile dev`. Kies EAS-managed credentials; log in met Apple ID als EAS dat vraagt. Stopt hij op *"agreement updates"*: accepteer de overeenkomst op developer.apple.com/account en in App Store Connect → Business, en probeer opnieuw. Certificaat en profiel (aangemaakt 2026-10-25) verlopen **2027-10-25**; daarna maakt EAS bij de volgende build nieuwe aan.
6. `eas submit -p ios --profile dev --latest`. Laat EAS een App Store Connect API key aanmaken.
7. App Store Connect → TestFlight: wacht tot de build verwerkt is (~10 min, mail van Apple). Hij komt automatisch in de interne groep "Clubalmanac test groep" (tester `wintvelt@mac.com`). Niet in "Blob testgroep" (extern).
8. iPhone: TestFlight-app (ingelogd als `wintvelt@mac.com`) → installeren → inloggen als dev1 met de Clerk-testcode → eigen naam. App sluiten en openen → nog ingelogd. Uitloggen werkt.

Blokkeert een stap (overeenkomsten, lidmaatschap, Apple-mail met ITMS-code), noteer de letterlijke melding in WP14 §Uitkomsten spike.

## AWS (alleen migratie, WP12)

De data-migratie leest de oude AWS-omgeving: DynamoDB-tabel `blob-images-photos-prod` en S3-bucket `blob-images`, beide in **eu-central-1** (Frankfurt). Doel is Convex in eu-west-1 (Dublin).

Read-only, altijd. Het script heeft geen enkele write-operatie richting DynamoDB of S3; gebruik daarom ook een read-only IAM-user of -rol, zodat die belofte in de policy staat en niet alleen in de code.

De bucket `blob-videos` blijft buiten de migratie: die bestanden hebben geen DynamoDB-record, en `load-files` is record-gedreven. Ze blijven op S3 tot de latere R2-overstap en mogen bij de T+30-opruiming dus niet weg.

### Env-vars (lokaal, `.env.migrate` — nooit als Convex-env-var)

| Env-var | Waarde | Wat gebeurt bij ontbreken |
|---|---|---|
| `MIGRATE_CONVEX_URL_DEV` / `_PROD` | deployment-URL, mét region-suffix | commando stopt met melding |
| `MIGRATE_CONVEX_ADMIN_KEY_DEV` / `_PROD` | deployment-scoped deploy key (dashboard → Settings → Deploy Keys) | commando stopt; de migratie-functies zijn internal en anders niet aanroepbaar |
| `MIGRATE_ALLOW_PROD` | `yes`, alleen tijdens de prod-run | elke schrijf-actie op prod wordt geweigerd (tweede laag naast de URL-check) |
| `MIGRATE_AWS_REGION` / `MIGRATE_DYNAMO_TABLE` / `MIGRATE_S3_BUCKET` | optioneel; defaults `eu-central-1` / `blob-images-photos-prod` / `blob-images` | defaults worden gebruikt en staan in de banner van elke run |
| AWS-credentials | `AWS_PROFILE` of `AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY` | AWS-SDK faalt met een credential-fout |

De AWS-credentials horen **niet** in Convex: geen enkele Convex-function praat met AWS. Ze leven op de laptop van de operator, voor de duur van de migratie, en worden bij T+30 ingetrokken.

Draaiboek + opruimstap: [`runbooks/wp12-data-migratie.md`](../runbooks/wp12-data-migratie.md).

## Productie-blind-spots

JWT validation roundtrip, Mailjet bounce webhook, Photon connection: deze zijn unit-test alleen via mocks gevalideerd. Echte service-integratie loopt via de [integration-test laag](./integration-tests.md) (`npm run test:integration`, niet in CI), per werkpakket apart. Photon (WP1) is gepind; Convex/Clerk/Mailjet (WP2-4) staan op de planning.

## Waarom deze keuzes

Eerlijke evaluatie tegen 16-user hobby use case. EU-providers waar mogelijk voor GDPR-coherentie. Geen paid services voor functionaliteit die gratis kan.
