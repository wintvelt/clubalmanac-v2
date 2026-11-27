# Externe service keuzes

## Geocoding: Photon (Komoot)

Gekozen 2026-05. Geen API key nodig (publieke instance op `photon.komoot.io`). Fair-use voor 16-user volume. URL gebruikt `lang=en` voor internationale leesbaarheid (Georgië/Nepal scenario's). Vervangt MapQuest die wegens revoked keys + paid-only tier niet meer geschikt was.

Endpoint: `https://photon.komoot.io/reverse?lat=<lat>&lon=<lon>&lang=en`
Header: `User-Agent: Clubalmanac/2.0` (fair-use vereiste)

## Email: Mailjet (Frankrijk)

Gekozen 2026-05. EU-based, GDPR-compliant. Free tier 6000/maand voldoende voor 16-user volume. Voor invites + member changes + flag-decide notifications + bounce webhook. Geïmplementeerd in WP5 (2026-05-17).

### Vereiste env-vars per deployment

WP5 introduceerde 5 env-vars; sinds WP19b (geen link in de uitnodigingsmail) zijn het er 4 Mailjet-vars plus `CLUBALMANAC_STAGE`. Ze moeten op zowel dev als prod gezet zijn — anders fail-loud throw bij eerste send. Uitzondering: `CLUBALMANAC_APP_STORE_ID` (WP19c) moet ook op beide, maar zonder gaat de uitnodigingsmail gewoon de deur uit, zie de tabel. Geen "stille" fallback-defaults meer (WP5-audit S-3 fix: APP_URL had silent prod-fallback, STAGE had silent "dev"-fallback — beide leidden tot subtiele mis-routing).

| Env-var | Waarde dev | Waarde prod | Wat gebeurt bij ontbreken |
|---|---|---|---|
| `MAILJET_API_KEY` | primary key uit Mailjet dashboard | dezelfde als dev (punt 3 hieronder) | `MAILJET_CREDS_MISSING:` throw vóór fetch (WP5-audit N-1 fix) |
| `MAILJET_API_SECRET` | primary secret | dezelfde als dev | idem |
| `MAILJET_WEBHOOK_SECRET` | gegenereerde random string, zelfde in Mailjet dashboard webhook-config | aparte prod-string. Mailjet heeft één event-URL per account; die wijst sinds 2026-11-16 naar prod (app.mailjet.com/account/triggers), dev krijgt geen bounce-events meer | `/email-event` → 503, geen state-mutatie |
| `MAILJET_VERIFIED_SENDERS` | comma-sep van alle from-addresses die in code voorkomen (`invites@…`, `info@…`) | idem, met prod-domain | `UNVERIFIED_SENDER:` throw vóór elke send |
| `CLUBALMANAC_STAGE` | `"dev"` | `"prod"` | throw bij `getStageLabel`-call op problem-report-pad (S-3 fix) |
| `CLUBALMANAC_APP_STORE_ID` (WP19c) | `1663038609` (Apple ID van de app, openbaar) | idem | Geen throw: de uitnodigingsmail gaat zonder App Store-link, met een `console.error` die de env-var noemt. Geldt alleen als 6–12 cijfers |
| `CLUBALMANAC_WEB_URL` (WP35) | leeg (geen gehoste dev-webapp) | `https://app.clubalmanac.com`, pas als de webapp live is ([runbook](../runbooks/webapp.md) stap 12) | Geen throw: de uitnodigingsmail gaat zonder de regel "Geen iPhone? …", met een `console.error` die de env-var noemt (ook op dev, bij elke uitnodiging). Geldt alleen als exacte `https://`-origin: geen pad, geen `/` aan het eind |

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

**Uitnodiging met groepsfoto: via SMTP (WP19c).**
- Alleen de uitnodiging met groepsfoto gaat via Mailjet's SMTP-ingang (`in-v3.mailjet.com:587`, STARTTLS, nodemailer in [`convex/lib/mailjetSmtp.ts`](../../convex/lib/mailjetSmtp.ts)). Zo staat de foto met de HTML in een `multipart/related` en toont iPhone Mail hem één keer.
- Login met dezelfde `MAILJET_API_KEY`/`MAILJET_API_SECRET`; geen extra env-vars. Sender-check en credentials gelden ook hier.
- Faalt SMTP (poort dicht, login, time-out), dan gaat dezelfde uitnodiging zonder foto via de Send API, met een `console.error` die SMTP noemt.
- `nodemailer` staat in `convex.json` bij `node.externalPackages`.

**Geen tracking (WP19c).** Per bericht uit, boven de instelling van het account: Send API `TrackOpens`/`TrackClicks` `"disabled"`, SMTP `X-Mailjet-TrackOpen: 0`/`X-Mailjet-TrackClick: 0`. Links gaan dus rechtstreeks, zonder `mjt.lu`.

| Kind | Sender | Bestemming | Subject (samengevat) | Body bevat |
|---|---|---|---|---|
| `invite` | `invites@` | geïnviteerde | "… nodigt je uit …" | inviter-naam, groep, inlogadres, expiry, App Store-link, groepsfoto (WP19c); geen invite-link of token (WP19b) |
| `accepted` / `declined` / `bounced` | `invites@` | inviter | accept/decline/bounce-melding | inviter-naam, accepter/decliner-naam, groep |
| `flagReported` (WP20) | `info@` | photo-owner | "Een van je foto's is gemeld als ongepast" | owner-naam, de laatste hele dag (de dag vóór de eerste opruimronde, WP20 S1), waar je bezwaar maakt. Alleen bij de eerste melding; geen melder of reden |
| `flagDecisionDeny` | `info@` | photo-owner | "Je bezwaar … is afgewezen" | owner-naam, laatste hele dag (WP20 S1) |
| `flagRemoved` (WP20) | `info@` | photo-owner | "Je gemelde foto is verwijderd" | owner-naam; geen melder of reden. Na `photos.removeFlagged`, los van de foto-rij |
| `problemReport` | `info@` | `WEBMASTER_EMAILS` | "Probleem gemeld op {stage}" | submitter-naam/email, titel, beschrijving |
| `monitor-drift-alert` (WP10) | `info@` | `WEBMASTER_EMAILS` | "Clubalmanac integriteits-check: drift gedetecteerd (N)" | run-timestamp + per drift-rij `table/id: detail` (counts + IDs). **Géén user-content** (geen namen, emails, comments) — PII-grens invariant 9 |
| `monitor-heartbeat` (WP10) | `info@` | `WEBMASTER_EMAILS` | "Clubalmanac integriteits-check: maandelijkse heartbeat" | run-timestamp + "monitor draait nog"-tekst. Conditioneel op drift-aanwezigheid: bij gededupte openstaande drift een waarschuwingszinsnede ("openstaande drift" + verwijzing naar dashboard-log) zonder drift-IDs (PII-grens invariant 9 blijft); schone run zonder waarschuwing |

De drie mails over gemelde foto's gaan niet naar een eigenaar wiens account wordt verwijderd (WP20 N3, getoetst bij het versturen).

WP10-monitoring (`convex/monitoring.ts`) gebruikt dezelfde `info@`-sender en `getWebmasterEmails()`-bestemming als `problemReport`. Geen nieuwe env-vars: `WEBMASTER_EMAILS` is bestaand. Best-effort: lege `WEBMASTER_EMAILS` → no-op zonder throw (mag de daily cron niet stuk maken).

## Backend: Convex

### Live queries meten in het dashboard (WP15a)

De app vraagt live data alleen op voor het scherm in beeld, zolang de app `active` is. Eén toegangspad: `app/src/data/useLiveQuery.ts`. Zo controleer je dat (gate WP15a, en elke latere app-WP):

- Meet **functieaanroepen per functie** (Logs, of Functions per functie), niet het aantal verbindingen. Een open socket zonder queries kost geen functieaanroepen.
- **Tab wisselen:** één nieuwe uitvoering per query van het nieuwe scherm. Het vorige scherm draait niet meer mee als de data verandert.
- **App naar de achtergrond** (ook Bedieningspaneel of app-wisselaar): geen enkele live query meer, ook `users.current` niet. Een wijziging in de Data-tab geeft dan geen uitvoering.
- **App terug:** één uitvoering per query van het scherm in beeld, plus één van `users.current`. Daarna niets meer, tot de data verandert.

### Bezoek en tabwissel (WP15b)

- **`recordVisit`** staat onder Functions als `users:recordVisit`. Verwacht één aanroep per terugkeer naar de app, hoogstens één per uur per user (de app throttlet zelf ook). In de tabel `userVisits` verandert hoogstens één keer per uur per user iets. Na een `recordVisit` volgt geen `users:current` en geen `users:profile`: het bezoek staat buiten de users-rij. Uitlezen kan alleen intern (`users:getLastVisit`).
- **Tabwissel:** `users:profile` is de eigen query van Profiel. Hij draait bij het openen van Profiel, en daarna alleen als je eigen rij wijzigt. Na een wissel naar een andere tab: geen `users:profile` meer, ook niet als je naam op een ander toestel wijzigt. Terug op Profiel: één uitvoering.

### Groepen en tellers (WP16)

- **`albums:listByGroupWithUnread`** loopt alleen als Groep open staat op de groepstab Albums. Op Leden, op een andere tab, op het albumscherm erboven of met de app op de achtergrond: geen uitvoering, ook niet bij een nieuwe foto. Terug op Albums: één uitvoering.
- **Wat hem laat draaien:** elke wijziging in een album van die groep, een nieuwe of verwijderde koppeling in `albumPhotos` van die albums, een wijziging in een nieuwe foto (ook een rating, die alleen de foto-rij raakt; het getal blijft dan gelijk) en je eigen `albumLastSeen`-rijen. Een nieuwe foto van een ander lid geeft één uitvoering, en de teller gaat met één omhoog.
- **`groups:listMine`** (Mijn groepen) telt dezelfde tellers op voor al je groepen. Hij draait bij een nieuwe foto in élke groep waar je lid van bent, maar alleen zolang Mijn groepen in beeld is.
- **`groups:listMembers`** en **`users:profile`** lopen binnen Groep alleen op de tab Leden (`users:profile` loopt daarnaast op Profiel). **`groups:getWithCover`** loopt zolang Groep in beeld is (WP17a, voor de cover in de kop).
- **Geen lid meer:** de groep-reads geven dan een `ConvexError` met code `NOT_MEMBER`. In Logs staat dat als een mislukte query; dat is verwacht, geen storing.

### Beeldpad en bandbreedte (WP17a)

Beelden lopen via de httpActions `GET /beeld/foto/<photoId>` en `GET /beeld/profiel/<userId>` op de `.convex.site`-host, met een toegangscheck per verzoek. Geen storage-URL naar de app.

- **Beeldverkeer van één album:** Logs, filter op `/beeld/foto`. Elke tegel is één regel, dus een album van 50 foto's geeft bij openen hoogstens 50 regels plus de cover, en alleen voor de tegels in beeld. Daarnaast `internal images:photoImage`, één per beeld. Status 404 is een beeld zonder toegang, een gewiste foto of een misvormd id; 401 is een verlopen of ontbrekend token. Na een mislukt beeld haalt de app één keer zelf een vers token en vraagt het opnieuw: een 401 gevolgd door een 200 voor dezelfde foto is dus normaal. Een beeld zonder toegang geeft zo twee 404's, daarna de fout-tegel (of de letter bij een cover).
- **Bandbreedte:** Usage, regel **Data egress** (GB, ook het origineel zolang WP25 nog geen verkleinde versies heeft). De beeldpaden tellen daarnaast mee in **Function calls** (HTTP action). Wil je de bytes per verzoek: een log stream geeft `network_egress_bytes` per `function_execution`. Meet een album door Usage vóór en na het openen te vergelijken, op een rustig moment.
- **Covers en profielfoto's:** per groeps- of albumkaart met een cover loopt `groups:getWithCover` of `albums:getWithCover` (voor de draaiing) zolang het scherm in beeld is. `/beeld/profiel` is openbaar en heeft geen login nodig. De app cachet een profielfoto niet (dezelfde URL geeft na een wissel een ander beeld), dus elke avatar in beeld is één verzoek.

### CORS voor de webapp (WP35, WP36)

De webapp haalt een foto of uitnodigingscover op met `fetch` en het token in de `Authorization`-header, en uploadt met `POST /upload` (WP36); de browser vraagt eerst `OPTIONS` (preflight, zonder login). CORS staat alleen op `/beeld/foto/*` en `/beeld/uitnodiging/*` (preflight: `GET`, `Authorization`) en op `/upload` (preflight: `POST` en `Authorization`, `Content-Type`, `X-Upload-Id`, `X-Album-Id`, `X-Taken-At`, `X-Latitude`, `X-Longitude`; niet `X-Filename`), in `convex/lib/webCors.ts`. Niet op `/beeld/profiel/*` (openbaar, een gewone `<img>`) of de webhooks. Nooit `*`, nooit `Allow-Credentials`. Elk antwoord aan een toegestane origin draagt de header, ook een 401 of 413, zodat de app de reden ziet; een 500 niet (de browser ziet dan "netwerk", opnieuw proberen met dezelfde id is veilig).

| Env-var | Dev | Prod | Bij ontbreken of ongeldig |
|---|---|---|---|
| `CLUBALMANAC_WEB_ORIGINS` | `http://localhost:8081` (Expo web-dev; komma-gescheiden meer, bv. het LAN-adres voor een telefoon) | `https://app.clubalmanac.com` | Een verzoek uit de browser krijgt geen CORS-header (beelden laden niet, uploaden geeft "Geen verbinding", preflight 403) en de log toont een fout met de naam. De iPhone (geen `Origin`) merkt niets. Alleen exacte origins tellen (schema, host, poort; geen pad, geen `/` aan het eind); op prod alleen `https://` |

- **Logs:** filter op `[webCors]`. Elk beeld- en uploadverzoek uit de browser logt de fout zolang de var ontbreekt of een ongeldige waarde heeft.
- **Verkeer:** een beeld kost op het web de eerste keer twee function calls (preflight en beeld); de browser onthoudt de preflight een uur per URL (voor `/upload` dus hooguit één extra verzoek per uur). De webapp bewaart beelden niet op schijf, dus elke nieuwe pagina-lading haalt ze opnieuw (album van 540 × *klein* ≈ 19 MB).
- De Convex-client (`.convex.cloud`) laat elke origin toe; de queries beschermt het Clerk-token, net als in de app.

### Test-only functies (WP26)

| Env-var | Dev | Prod | Bij ontbreken |
|---|---|---|---|
| `INTEGRATION_TEST_ENABLED` | `true` | nooit | elke `_test`-functie en `/_test/whoami` weigert |
| `INTEGRATION_TEST_SECRET` | 32 willekeurige bytes, hex | nooit | idem |

- **Waar het geheim staat:** alleen op de dev-deployment (dashboard → Settings → Environment Variables) en in `.env.integration` op de server, onder dezelfde naam. Niet in de repo, niet in een chat.
- **Roteren:** `openssl rand -hex 32`, de nieuwe waarde op dev en in `.env.integration`. Convex leest env-vars per aanroep, dus direct actief; tussendoor falen de integratietests luid. Roteer ook na een integratietest die een validatiefout gaf (die kan het geheim tonen).
- **Logs:** een weigering staat als mislukte functie met `Forbidden` (functies) of als 403 op `/_test/whoami`.

## Auth: Clerk

`picked-quail-97.clerk.accounts.dev` is de dev instance. Free tier vanaf `accounts.clerk.dev` voor signup-mails (geen custom email domain — paid feature, niet nodig voor 16 signups).

**Inloggen op dev:** Apple blokkeert mail van een Clerk-dev-instance naar @me.com/@icloud.com (`dev_email_provider_blocked`; de app toont dan de algemene melding). Op dev daarom alleen `+clerk_test`-adressen met code 424242, zonder mail: `dev1+clerk_test@example.com` (Dev Wouter, meerdere groepen) en `wouter+clerk_test@inc-management.com` (Gate Genodigde, één groep). Een adres hangt aan een Clerk-user; de backend koppelt op de Clerk-ID.

Webmaster-rol via env-var `WEBMASTER_EMAILS` met case-insensitive match (audit-7 fix).

**Prod (WP31):** Clerk Hobby, dus een sessie duurt op prod hooguit 7 dagen; leden loggen wekelijks opnieuw in met een code (W8, langer vraagt Pro). *Test mode* staat op prod permanent aan, zodat de reviewer van Apple inlogt met een `+clerk_test`-adres en code 424242 (W4). Iedereen met zo'n adres krijgt dan een Clerk-account, maar komt zonder uitnodiging de app niet in (WP19b). Het demo-account is lid van alleen de groep Demo.

**E-mailadres van een lid wijzigen (prod).** Logt een lid in met een ander adres dan zijn ledenadres, dan maakt Clerk een nieuwe user en ziet de app hem als onbekende (*Je hebt eerst een uitnodiging nodig*). Overzetten: in Clerk de nieuwe user verwijderen (controleer *Created*: vandaag en leeg), bij de oude user het nieuwe adres toevoegen (*Add email address*, door de beheerder toegevoegd is geverifieerd) en *Set as primary*; in het Convex-dashboard (prod, tabel `users`) het veld `email` aanpassen, want mails en uitnodigingen lezen dat veld. Daarna uitloggen en opnieuw inloggen. Gedaan voor één Android-lid op 2026-11-26. De Clerk-ID's van de 19 leden maakt en controleert `npm run migrate -- clerk-ids` (sleutel `MIGRATE_CLERK_SECRET_KEY_PROD` in `.env.migrate`, na T0 weg); inloggen gaat alleen op de Clerk-ID, het adres wordt niet vergeleken.

### Vereiste env-vars per deployment (WP6)

| Env-var | Waarde dev | Waarde prod | Wat gebeurt bij ontbreken |
|---|---|---|---|
| `WEBMASTER_EMAILS` | comma-sep, bv. `clubalmanac-integration-webmaster@example.com` | comma-sep, bv. `wintvelt@me.com` | webmaster-bypass werkt niet; bootstrap onmogelijk |
| `CLERK_WEBHOOK_SECRET` | `whsec_<base64>` uit Clerk dashboard (Webhooks → Add endpoint → Signing secret) | aparte prod-`whsec_<base64>` | `/clerk-webhook` retourneert 503 voor élk POST (fail-closed, geen accidenteel-open endpoint) |
| `CLERK_SECRET_KEY` (WP29) | `sk_test_…` (Clerk → API keys, dev-instance) | `sk_live_…` van de prod-instance, **vóór de App Store-build** | Account verwijderen ruimt de Convex-data wel op, maar de Clerk-user blijft; de webmaster krijgt één mail en de users-rij houdt de login tegen (zie hieronder). Een sleutel die niet bij de omgeving past (prod zonder `sk_live_`, dev zonder `sk_test_`), of een ontbrekende of onbekende `CLUBALMANAC_STAGE` (alleen `prod` en `dev`), geeft hetzelfde als een ontbrekende sleutel |

**Account verwijderen (WP29).** `users.deleteSelf` sluit het account af, ruimt Convex in stappen op en verwijdert de Clerk-user met `DELETE https://api.clerk.com/v1/users/{subject}` (Backend API, gratis plan; 404 telt als gelukt, timeout 30 s). Mislukt Clerk, dan zes pogingen over 111 minuten; daarna, of meteen zonder passende sleutel, één mail aan `WEBMASTER_EMAILS` met de Clerk-subject. De integriteitscheck meldt de rij zolang hij langer dan een uur wordt verwijderd. Na herstel (sleutel gezet) opnieuw starten, met het Convex-id uit de mail:

```bash
npx convex run users:retryAccountDeletion '{"userId":"<id>"}'
```

Op prod met `--prod`. Draai dit ook als je de Clerk-user na de mail zelf in het dashboard hebt verwijderd: anders blijft de users-rij staan en faalt het aanmelden na een nieuwe uitnodiging op "Email is al in gebruik". Loopt er nog een reeks pogingen, dan start hij geen tweede. Een lid kan daarna alleen terug met een nieuwe uitnodiging; zolang het verwijderen loopt, weigert de app die. Dezelfde Clerk-user krijgt nooit meer een account (een hash van de subject blijft bewaard).

Na het zetten van `sk_live_` op prod één keer testen: een wegwerp-account uitnodigen, in de app Account verwijderen, en in het Clerk-dashboard van de prod-instance checken dat de user weg is.

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
- **Configure → Email, Phone, Username**: e-mailadres met **verificatiecode** als enige inlogmethode. Wachtwoord uit. **Sign-up aan, zonder verplichte naamvelden** (WP19b: de app meldt een nieuw adres aan via sign-in-or-up; wie een account krijgt, bepaalt de backend: alleen met een open uitnodiging). Staat sign-up per ongeluk uit, dan ziet een nieuwe genodigde na elke code "Deze code klopt niet"; bestaande leden merken niets.
- **Configure → Attack protection**: bescherming tegen enumeratie aan. De app verraadt een onbekend adres ook niet als die uit staat. **Bot sign-up protection uit**, op dev en op prod (WP19b besluit 3): de app gebruikt sign-in-or-up, en met de bescherming aan vraagt Clerk dan ook bij gewoon inloggen een captcha. Dat raakt alle bestaande leden.
- **Configure → Native applications**: Native API aan.
- **JWT-template `convex`**: bestaat al (WP4); zonder template weigert Convex het token.

**Op het web (WP35).** `@clerk/expo` draait in de browser als gewone Clerk: de sessie staat in de cookies van Clerk, niet in de eigen opslag (`src/auth/deviceClerkStorage.web.ts` is een lege variant; `tokenCache` en de resource-cache gebruikt Clerk daar niet). Uitloggen (`signOut`) haalt de sessie weg en leegt het beeldgeheugen. Sessieduur zoals de app, hooguit 7 dagen; een tabblad sluiten logt niet uit. Dev staat `localhost` al toe. Prod: `app.clubalmanac.com` is een subdomein van het domein van de prod-instance, dus geen satellite-domein ([runbook](../runbooks/webapp.md) stap 9). De scripts van Clerk (`clerk-js`, `@clerk/ui`) staan op het web op een vaste versie (`src/auth/clerkWebScripts.web.ts`; ophogen: runbook §Clerk-versie ophogen). `convex/auth.config.ts` blijft gelijk: het token uit de browser heeft dezelfde issuer en JWT-template.

**Offline starten en uitloggen (WP15a F12, F13).** `App.tsx` geeft `ClerkProvider` de props `__experimental_resourceCache` en `tokenCache` uit één eigen opslag (`src/auth/clerkStorage.ts`, op de keychain via `src/auth/deviceClerkStorage.ts`). Clerk bewaart daarin de laatste client, omgeving en het client-token. Zonder netwerk start hij daaruit (status `degraded`). Uitloggen wist alles, ook offline en ook als `signOut` faalt; daarna staat er alleen de vlag `clubalmanac_clerk_wiped`, tot de volgende login. De wis ruimt ook de sleutels van build 42 op (opslag van `@clerk/expo`). `__experimental_resourceCache` is een **experimentele API**: check bij elke Clerk-upgrade of de prop nog bestaat, dezelfde sleutels gebruikt en hetzelfde doet. Test met een koude start in vliegtuigmodus, ook na uitloggen in vliegtuigmodus (dan moet het inlogscherm komen). Clerk opnieuw starten = de app herladen (`reloadAppAsync` uit `expo`, `src/data/clerkRestart.ts`): Clerk is een singleton, een nieuwe `key` op `ClerkProvider` laadt niets opnieuw.

- **Web (WP35):** de web-build krijgt dezelfde twee vars van prod als GitHub-repo-variabelen `WEBAPP_CONVEX_URL` en `WEBAPP_CLERK_PUBLISHABLE_KEY`; de workflow *Webapp* weigert een sleutel die niet met `pk_live_` begint. Lokaal leest `npx expo start --web` gewoon `app/.env.local`.

### EAS-build en TestFlight (WP14)

Config: [`app/eas.json`](../../app/eas.json). EAS project `@wintvelt/clubalmanac-app` (`bd5c6c93-…`), owner `wintvelt` in `app/app.json`. ASC-app-ID `1663038609` staat in `eas.json` §submit.

| Profiel (build + submit) | EAS-omgeving | Backend | Status |
|---|---|---|---|
| `dev` | `development` | `glorious-pheasant-759` + `picked-quail-97` | in gebruik (TestFlight, internal testing) |
| `production` | `production` | prod (fase 5) | nog geen env-vars: een build start met "verkeerd ingesteld" |

- **Node**: 24 overal. `.nvmrc` (root) stuurt CI en lokaal fnm, `engines` + `engine-strict` in beide `package.json`'s laten `npm ci`/`npm install` op een andere versie stoppen met `EBADENGINE`. EAS leest `.nvmrc` niet: `eas.json` `build.base.node` pint een exacte 24-versie. Bij een Node-update beide aanpassen.
- **Buildnummer**: `appVersionSource: remote` + `autoIncrement`. EAS telt door; `app.json` heeft geen `buildNumber`. Laatste oude build in App Store Connect is 38, dus de teller moet op ≥ 38 staan vóór de eerste build.
- **Wat EAS uploadt**: de hele git-repo (de app typecheckt tegen `../convex`), zonder wat `.gitignore` uitsluit. Dus geen `app/ios/` (EAS doet zelf prebuild uit `app.json`), geen `.env.local`, geen `backups/` of `scripts/.data/`. Maak géén `.easignore`: die vervangt `.gitignore` voor EAS, en dan gaat prod-data mee als je hem niet volledig overneemt.
- **Env-vars**: de twee `EXPO_PUBLIC_`-vars, zichtbaarheid `plaintext` (publiek), en voor Android `GOOGLE_MAPS_ANDROID_API_KEY` (`sensitive`; staat ook leesbaar in de app, beperkt tot het pakket; zie §Android-app). Geen geheimen in EAS-env-vars of `eas.json`.
- **Credentials**: EAS-managed. Distributiecertificaat en provisioning profile maakt EAS aan of vernieuwt ze tijdens `eas build`, na login met Apple ID. Voor `eas submit` laat EAS een App Store Connect API key aanmaken en bewaart die. Wouter beantwoordt deze vragen zelf.
- **Exportcompliance**: `ios.config.usesNonExemptEncryption: false` (alleen standaard-HTTPS). App Store Connect vraagt het dan niet per build.
- **Alleen internal testing** zolang de build tegen dev praat (echte data van dev-users). Geen externe testers, geen Beta App Review.
- **Lettertype en icoon (WP-Design)**: geen eigen EAS-stap. Literata zit via de `expo-font`-plugin in `app.json` in de build. Het icoon komt uit `app/assets/icon/`: nu de PNG's `icon-light.png` en `icon-dark.png` (1024, zonder alfakanaal) via `ios.icon`. Bron: `node scripts/build-icon.mjs` in `app/` schrijft de SVG-lagen en rendert de PNG's (macOS). Android (WP42): `node scripts/build-icon.mjs android` schrijft alleen `android-foreground.png`, `android-background.png` en `android-monochrome.png` (het adaptieve icoon in `android.adaptiveIcon`) en laat de iOS-bestanden staan.
- **Icon Composer (Wouter, eenmalig)**: open Icon Composer (Xcode → Open Developer Tool), nieuw bestand. Sleep `layer-0-background.svg` naar de achtergrond, of kies daar het verloop lime `#A3E635` → sky `#0EA5E9`. Sleep `layer-1-card.svg` en `layer-2-duck.svg` als twee groepen, de eend bovenop. Kaartje: dekking 94%; `layer-1-card-rim.svg` is de rand voor licht en mag mee in de kaartjesgroep. Weergave Donker: achtergrond `#020617`, kaartje en eend in het verloop. Controleer 29 en 40 pt in de preview: eend en kaartje blijven los. Bewaar als `app/assets/icon/Clubalmanac.icon` en zet in `app.json` `"ios": { "icon": "./assets/icon/Clubalmanac.icon" }` in plaats van het light/dark-object. Expo ondersteunt een `.icon`-map in `ios.icon` (gecheckt in `@expo/config-types` bij SDK 58). De top-level `icon` blijft de PNG.

Gate-commando's (Wouter, in `app/`, Node 24 actief):

1. Node 24 via fnm: `brew install fnm`, `eval "$(fnm env --use-on-cd --version-file-strategy=recursive)"` in `~/.zshrc`, dan `fnm install 24 && fnm default 24`. `recursive` is nodig omdat `.nvmrc` alleen in de root staat en je in `app/` werkt. Een terminal die al open was, ziet dit pas na `fnm use 24` of in een nieuw tabblad. Check: `node -v` toont `v24.x`.
2. `npm install -g eas-cli@27.4.1` (vaste versie, geen `latest`) en `eas login`. Check: `eas whoami` toont `wintvelt`.
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

#### Lokaal bouwen (WP34)

Een build op de server zelf kost geen EAS-tegoed. In `app/`:

- Bouwen: `eas build -p ios --profile dev --local --output ../builds/<naam>.ipa`. `builds/` is gitignored.
- Uploaden: `eas submit -p ios --profile dev --path ../builds/<naam>.ipa`. Daarna verder vanaf stap 7 hierboven.
- Bouw via SSH in **tmux** (`tmux new -s <naam> "…; exec zsh"`, terug met `tmux attach -t <naam>`). Valt de verbinding weg zonder tmux, dan blijft de build hangen op een vraag die niemand meer ziet.
- **Vereisten**: Xcode, CocoaPods en fastlane (`brew install cocoapods fastlane`).
- **Apple WWDR G3-tussencertificaat** in de login-keychain. Zonder stopt de build met *"Distribution certificate … hasn't been imported successfully"*. Download `AppleWWDRCAG3.cer` van apple.com/certificateauthority en dubbelklik (Sleutelhangertoegang, login-keychain).
- `EAS_LOCAL_BUILD_SKIP_CLEANUP=1` alleen bij debuggen: de werkmap in `$TMPDIR/eas-build-local-nodejs/` blijft dan staan en is ±4 GB. Daarna weggooien.

**Android (WP42).** Zelfde aanpak, met JDK 17 en de Android-SDK op de server:

- Omgeving: `JAVA_HOME=/opt/homebrew/opt/openjdk@17`, `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` en beide `bin`/`platform-tools` in `PATH`; staat sinds 2026-11-26 in `~/.zprofile` op de server (geldt voor nieuwe terminals). Zonder stopt `eas build` bij *Run gradlew* met *Unable to locate a Java Runtime*. De eerste build haalt de NDK, build-tools en Gradle-caches op (~4–6 GB).
- **Dev, alleen de emulator** (B9, A12): `eas build -p android --profile dev --local --output ../builds/<naam>.apk`, dan `adb install -r ../builds/<naam>.apk`. Profiel `dev` maakt voor Android een APK (`distribution: internal`); die kan niet naar Play.
- **Prod, voor de leden**: `eas build -p android --profile production --local --output ../builds/<naam>.aab`. Controle vóór de upload: in `base/assets/index.android.bundle` van de AAB staat de prod-URL van Convex en een `pk_live_`-sleutel. Zonder `GOOGLE_MAPS_ANDROID_API_KEY` in de EAS-omgeving `production` stopt de build al bij het lezen van de config (`app/app.config.ts`). Uploaden: zie §Android-app hieronder.
- **Zonder EAS** (alleen voor ontwikkelen): `npx expo prebuild -p android --clean`, dan in `app/android/` `./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a`. Leest `app/.env.local`. Draait er al een Metro op 8081 (een andere sessie), geef de build een eigen poort: `-PreactNativeDevServerPort=8082`, Metro met `npx expo start --port 8082`, en `adb reverse tcp:8082 tcp:8082`. Zonder dat haalt de emulator de bundel van de Metro op 8081, met de code van een andere map.
- **Release-builds** worden door R8 verkleind. Zonder de keep-regel voor Room die `app/app.config.ts` in `proguard-rules.pro` zet, crasht de app bij de start (WorkManager, via `react-native-maps`). Na een upgrade van `react-native-maps` of WorkManager: een release-build op de emulator starten.
- **Filmpjes** (WP42b): de module `clubalmanac-video` verkleint met Media3, in dezelfde versie als `expo-video` (`androidxMedia3Version`; `app/tests/androidMedia3Version.test.ts` faalt bij een verschil). Na een Expo-upgrade: een release-build op de emulator starten en een filmpje toevoegen. De emulator halveert soms de beelden van zelfgemaakte testfilmpjes, ook zonder de module; zulke filmpjes zeggen niets over echte toestellen.
- Controle per build (A9 en 16 KB): de rechten met `$ANDROID_HOME/build-tools/36.0.0/aapt dump permissions <apk>`, de pagina's met `$ANDROID_HOME/build-tools/36.0.0/zipalign -c -P 16 -v 4 <apk>`. Een AAB eerst omzetten, of de APK van hetzelfde profiel controleren.

## Android-app: Google Play en Google Maps (WP42)

**Pakketnaam** `com.clubalmanac.app` (B7), los van de iOS-bundle-id. Vast na de eerste upload in Play.

**Google Play.** Organisatie-account (B5, Inc. Management B.V., met het bestaande D-U-N-S-nummer); Wouter maakt het aan, $25 eenmalig. 42a gaat alleen naar de **interne testtrack** (tot 100 testers met een Google-account, via een opt-in-link), en alleen met prod-builds (B9). Dev-builds blijven op de emulator.

- **Ondertekening**: EAS beheert de upload-sleutel (EAS-managed; EAS maakt hem bij de eerste Android-build, Wouter beantwoordt die vraag zelf); Play App Signing ondertekent wat de leden krijgen. De SHA-1 daarvan staat in de Play Console onder *Beveiligd met Play → Play Store-beveiliging → App-ondertekening van Play beheren*, kolom *Klassieke sleutel* (de oude plek *App-integriteit* verwijst daarheen). Elke AAB upload je met de hand in de Play Console (*Testen en releasen → Testen → Interne tests → Nieuwe release maken*); een update komt bij de testers via de Play Store, zonder opnieuw aanmelden. `eas.json` §submit `production` heeft voor Android de track `internal`; `eas submit` vraagt een serviceaccount van Google, met de hand uploaden kan altijd.
- **Testers**: mailinglijst *Android-leden* op de interne track; een tester opent de opt-in-link op de telefoon met het Google-account van de lijst. Vlak na de eerste release gaf Play een paar uur *Something went wrong on our end*; dat ging vanzelf over.
- **Vóór de interne track**: de app aanmaken met de pakketnaam, de lijst testers en de eerste AAB. Data safety, privacyverklaring, de webpagina om een account te laten verwijderen, de winkelvermelding en de keuring zijn pas nodig voor productie (WP42 §Play).
- **Rechten** (A9): als enige gevaarlijke recht `ACCESS_MEDIA_LOCATION`, voor de plaats van gekozen foto's en filmpjes (B4, spike S1; WP42b). De app vraagt het alleen vanaf Android 15 (API 35); daaronder opent de kiezer met dat recht de app Bestanden (API 30, 33) of haalt de fotokiezer de plaats toch weg (API 34), dus daar geen vraag (fix-ronde 42a). De fotokiezer geeft daar geen plaats; opent op een toestel zonder fotokiezer de app Bestanden, dan komt de plaats wel mee. Geen `READ_MEDIA_*`, dus geen verklaring voor foto- en videorechten. `READ_EXTERNAL_STORAGE` en `WRITE_EXTERNAL_STORAGE` staan in het manifest tot API 32 (`maxSdkVersion="32"`, uit `expo-image-picker`); de app vraagt ze nooit. Wat bibliotheken er verder bij zetten en niet nodig is, staat geblokkeerd in `app/app.json` (`android.blockedPermissions`). `WAKE_LOCK` blijft (de videospeler en WorkManager gebruiken het).
- **Back-up** staat uit (`android.allowBackup: false`, A10). Bij overzetten naar een nieuwe telefoon gaat de sleutelopslag (sessie, thuisgroep, laatste album) niet mee; de nieuwe telefoon start uitgelogd.
- **Uitnodigingsmail en webapp**: de Play-link en de zin "Gebruik hiervoor de app Clubalmanac op de iPhone" pas als de app in Play te koop is, in een eigen cyclus (B8).

**Google Maps (Android).** De kaart op Android is Google Maps (B3); iOS houdt Apple Maps, de webapp OpenStreetMap. De Maps SDK voor Android is gratis, maar vraagt een Google Cloud-project met betaalgegevens.

- **Sleutel**: in het Google Cloud-project **Clubalmanac** (eigen project, betaalaccount *My Billing Account*, plan *Pay as you go*; geen Starter/Essentials/Pro-abonnement). *Maps SDK for Android* moet in dát project aanstaan; staat hij uit, dan weigert Google de sleutel (`Authorization failure` in logcat) ook als de beperking klopt. Beperking *Android apps*: twee regels met `com.clubalmanac.app`, met de SHA-1 van Play App Signing (zie hierboven) en die van de debug-keystore van het Expo-template (`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`, voor release-builds via Gradle op de emulator). API-beperking: alleen *Maps SDK for Android*. Budget *Clubalmanac kaart* (Billing → *Budgets & caps*, type *Alerts only*, €1; niet *Spend cap enforcement*, dat zet de kaart stil). De wizard van Google maakt de sleutel in het project dat open staat: controleer bovenin het project.
- **Waar hij staat**: niet in de repo; in 1Password. Als EAS-env-var in `production` en `development`: `eas env:set --name GOOGLE_MAPS_ANDROID_API_KEY --environment production --environment development --visibility sensitive --scope project` (vraagt om de waarde; `env:create` is verouderd). Lokaal in `app/.env.local` op de server (`GOOGLE_MAPS_ANDROID_API_KEY=<sleutel>`), voor builds via Gradle. `app/app.config.ts` zet hem in het manifest; er hoeft geen code te veranderen, wel een nieuwe build.
- **Zonder sleutel**: een dev-build krijgt een nep-waarde en een lege kaart (zonder enige waarde crasht de Maps SDK bij het openen van de kaart). Een prod-build stopt (A8).
- **Donker**: de app geeft de kaart op Android een eigen stijl, nacht in donker thema en zonder bedrijven en plekken, zoals Apple Maps op iOS (`app/src/components/mapStyle.ts`).

**Filmpjes verkleinen (Android, WP42b).** Afspelen doet `expo-video`; verkleinen doet de eigen module (`app/modules/clubalmanac-video/android/`) met **Media3 Transformer** van Google (AndroidX, gratis, geen account, geen rechten, geen dienst). Op iOS doet AVFoundation hetzelfde.

- **Vaste versie**: `media3-transformer`, `-effect` en `-common` **1.9.1** in `app/modules/clubalmanac-video/android/build.gradle`, dezelfde als `expo-video` 58.0.14 (`androidxMedia3Version` in `node_modules/expo-video/android/build.gradle`). Gradle neemt per onderdeel de hoogste versie: een nieuwere Media3 in de module tilt ook de speler van `expo-video` mee. Bij een Expo-upgrade: de versie van `expo-video` nakijken, dezelfde in de module zetten, en een release-build op de emulator een filmpje laten verkleinen en uploaden (R8).
- **Instellingen** (WP42b A15): altijd opnieuw coderen naar H.264 en AAC, HDR naar SDR, hooguit 30 fps, geen metadata van het origineel; daarna kijkt de module het bestand zelf na (`Mp4Check.kt`, dezelfde regels als `convex/lib/mp4.ts`). Klopt iets niet, dan "verkleinen lukte niet" in de app, nooit een upload die de backend weigert.
- **Emulator**: van zelfgemaakte testfilmpjes van 10 en 30 fps (H.264 High, van AVFoundation; tot 1080p) hield het verkleinen op de emulator maar de helft van de beelden over, ook zonder effect dat beelden weglaat; van een filmpje van de camera-app van de emulator alle (29,4 fps). Oorzaak niet gevonden; op een echte telefoon niet gezien. Vraag de testers naar schokkerige filmpjes.

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

Deze AWS-credentials horen **niet** in Convex. Ze leven op de laptop van de operator, voor de duur van de migratie, en worden bij T+30 ingetrokken. De enige AWS-sleutel in Convex is de aparte leessleutel voor de clubfilms (hieronder).

Draaiboek + opruimstap: [`runbooks/wp12-data-migratie.md`](../runbooks/wp12-data-migratie.md).

## AWS S3: clubfilms (WP21)

De clubfilms en hun covers blijven in S3-bucket `blob-videos` (eu-central-1), ook na T+30, tot de R2-overstap. Convex kent alleen de lijst (tabel `films`) en geeft na een toegangscheck een ondertekende S3-link: 3 uur voor een film, 15 minuten voor een cover. De app ziet nooit een sleutel. Zie [WP21](../work-packages/WP21-videos.md).

**IAM-gebruiker** (eigen gebruiker, niet de migratie-leessleutel), met alleen deze policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::blob-videos/*" }
  ]
}
```

Geen `s3:ListBucket`: dan geeft een ontbrekend bestand 403 in plaats van 404, en de lijst van de bucket blijft dicht. "Block public access" (T0) raakt ondertekende links niet.

### Env-vars per deployment (dev en prod)

| Env-var | Waarde | Wat gebeurt bij ontbreken of leeg |
|---|---|---|
| `FILMS_S3_ACCESS_KEY_ID` | access key ID van de IAM-gebruiker | link voor een lid faalt met `FILMS_S3_CONFIG_MISSING: <naam>`; de dagelijkse check mailt |
| `FILMS_S3_SECRET_ACCESS_KEY` | het geheim | idem |
| `FILMS_S3_REGION` | `eu-central-1` | idem |
| `FILMS_S3_BUCKET` | `blob-videos` | idem |

Wie geen toegang heeft, krijgt altijd `FILM_NOT_FOUND`, ook zonder config.

### De filmlijst vullen

De lijst staat niet in de repo (WP21 invariant 9: de repo is publiek, de bestandsnamen niet). Bron: `scripts/.data/wp21/films.json` (gitignored). `node scripts/wp21/seedArgs.ts --group <id van "Blob bibliotheek">` schrijft de argumenten naast die lijst en print het `npx convex run films:replaceAll`-commando (prod met `--prod`). `replaceAll` vervangt de hele lijst en faalt bij een onbekende groep.

### Bewaking en kosten

Tekenen gebeurt lokaal, dus een ingetrokken of verlopen sleutel merkt Convex zelf niet. De cron `film link check` (dagelijks 05:00 UTC) leest één byte van een cover met een ondertekende link en mailt `WEBMASTER_EMAILS` als dat niet lukt (zonder link, geheim of bestandsnaam). Rotatie: nieuwe sleutel aanmaken, beide `FILMS_S3_*`-sleutel-vars zetten, de check handmatig draaien (`npx convex run films:checkLinks`), dan de oude sleutel intrekken. Een link die al is uitgegeven, werkt met de oude sleutel tot hij verloopt of de sleutel wordt ingetrokken.

S3 rekent uitgaand verkeer: 100 GB per maand gratis per account, daarboven ~$0,09 per GB. De grootste film helemaal kijken is ~6,2 GB. De app speelt niets vanzelf af, laadt geen film vooruit en bewaart geen film op de telefoon; covers (samen ~21 MB) staan in de cache van de app.

## Cloudflare R2: filmpjes van leden (WP37)

Filmpjes die leden in een album zetten, staan in Cloudflare R2; de rij (met de poster als beeld) staat in Convex. Geen publieke bucket: de app krijgt alleen kortlevende ondertekende links van de backend, voor precies één sleutel die de backend koos. Twee prefixen in elke bucket:

- `uploads/…`: hier PUT de app het filmpje, met een link van 15 minuten waarin de grootte vastligt (R2 toetst de geldigheid bij de start, dus een lange upload loopt door). De backend bekijkt het object (grootte, duur, sporen, codec, GPS, wat na de index staat).
- `videos/…`: na de controle kopieert de backend het (CopyObject, alleen als het nog hetzelfde object is, met type `video/mp4`) naar een eindsleutel, maakt de rij en wist dan pas het tijdelijke object. Voor `videos/` tekent de backend nooit een PUT; afspelen is een GET van 1 uur.

Per lid hooguit 30 keer "upload aanvragen" per 24 uur (glijdend); de 31e krijgt in de app "Je hebt vandaag al veel filmpjes verstuurd". Dat begrenst wat een lid met links kan neerzetten. Zie [WP37](../work-packages/WP37-filmpjes-in-albums.md) en `convex/videos.ts`.

Kosten: 10 GB opslag, 1 miljoen schrijf- en 10 miljoen leesverzoeken per maand gratis; uitgaand verkeer gratis. Daarboven $0,015 per GB per maand. 10 GB is ~6 uur filmpje (28 MB per minuut).

### Opzetten (eenmalig, Wouter)

1. **Account**: maak op dash.cloudflare.com een account en zet R2 aan (R2 Object Storage → *Purchase R2 Plan*; R2 vraagt een betaalmiddel, ook voor het gratis deel).
2. **Buckets**, twee keer (*Create bucket*): naam `clubalmanac-videos-dev` en `clubalmanac-videos-prod`, *Location*: **Specify jurisdiction → European Union (EU)**. Dat kan later niet meer worden gewijzigd; een *location hint* is geen garantie. Default storage class *Standard*. *Public access* blijft uit (geen r2.dev-adres, geen eigen domein). Geen CORS-regel: afspelen in de browser heeft die niet nodig, en de webapp uploadt geen filmpjes.
3. **Tokens** (R2 → *Manage API tokens* → *Create Account API token*):
   - `clubalmanac-videos-dev`: *Object Read & Write*, alleen bucket `clubalmanac-videos-dev`.
   - `clubalmanac-videos-prod`: *Object Read & Write*, alleen bucket `clubalmanac-videos-prod`.
   - `clubalmanac-videos-backup`: *Object Read only*, alleen bucket `clubalmanac-videos-prod` (voor de backup, zie hieronder).
   Bij elk token toont Cloudflare één keer de *Access Key ID* en de *Secret Access Key*, en het S3-adres voor de EU-jurisdictie: `https://<account-id>.eu.r2.cloudflarestorage.com`. Bewaar ze in de wachtwoordmanager.
4. **Lifecycle-regel per bucket** (bucket → *Settings* → *Object lifecycle rules* → *Add rule*): naam `uploads-na-1-dag`, *prefix* `uploads/`, actie *Delete uploaded objects after* **1 day**. Zo verdwijnt een tijdelijk object dat na afronden of weigeren nog via een geldige link neerkwam, ook als de opruimronde het niet ziet. Niet voor `videos/`: daar wist alleen de backend.
5. **Convex env-vars** per deployment (tabel hieronder), dev met het dev-token, prod met het prod-token. Zet het geheim in het dashboard (Settings → Environment Variables), niet op de opdrachtregel (shell-geschiedenis).
6. **Controle op dev**: `npx convex run videos:checkStorage`. Verwacht: geen mail (lege bucket, geen filmpjes). Een mail "kon niet draaien" met `R2_CONFIG_MISSING` of `HTTP 403` betekent een env-var of token die niet klopt. Daarna op een iPhone met de dev-build een filmpje toevoegen en afspelen (WP37-gate). Ondertekende links op het EU-adres zijn alleen hier echt te toetsen; de tests gebruiken een nep-R2.
7. **Prod**, bij de release: dezelfde env-vars op prod, `npx convex run --prod videos:checkStorage`, en de backup van R2 aanzetten ([`infra/backup.md`](../../infra/backup.md), *Filmpjes in R2*).

### Env-vars per deployment (dev en prod)

| Env-var | Waarde | Wat gebeurt bij ontbreken of leeg |
|---|---|---|
| `R2_ENDPOINT` | `https://<account-id>.eu.r2.cloudflarestorage.com` | uploaden en afspelen falen voor een lid met `R2_CONFIG_MISSING: <naam>`; de dagelijkse check mailt |
| `R2_ACCESS_KEY_ID` | Access Key ID van het token van deze omgeving | idem |
| `R2_SECRET_ACCESS_KEY` | het geheim van dat token | idem |
| `R2_BUCKET` | `clubalmanac-videos-dev` of `clubalmanac-videos-prod` | idem |

Wie geen toegang heeft, krijgt altijd de gewone weigering (`VIDEO_UPLOAD_REFUSED` of `VIDEO_NOT_FOUND`), ook zonder config. Het geheim staat nooit in een antwoord, fout, log of mail. Rotatie: nieuw token met dezelfde rechten, beide sleutel-vars zetten, `videos:checkStorage` draaien, dan het oude token intrekken. Een uitgegeven link werkt met het oude token tot hij verloopt (hooguit een uur) of het token is ingetrokken.

### Bewaking en opruimen

- **Dagelijkse R2-check** (cron `video storage check`, 05:15 UTC): legt de lijst in R2 naast de filmpjes en de open uploads in Convex. Eén mail aan `WEBMASTER_EMAILS` bij een *wees-object* (onder `videos/` zonder filmpje, ouder dan een dag), bij *"de opruimregel van R2 werkt niet"* (een object onder `uploads/` zonder open upload, ouder dan 2 dagen: controleer de lifecycle-regel `uploads-na-1-dag` op de bucket), een *ontbrekend bestand* (een filmpje waarvan het object weg is), een filmpje waarvan het object *een andere grootte* heeft dan de backend bekeek, of een object *boven 120 MiB*, of als de check niet kon draaien. De check wist niets.
  - Andere grootte of boven 120 MiB: het object is na de controle veranderd of er staat iets dat er niet hoort. Onder `uploads/` ruimt de lifecycle-regel het op; onder `videos/` het filmpje laten verwijderen (de eigenaar of de webmaster via melden) en de eigenaar vragen het opnieuw toe te voegen.
  - Wees-object: meestal een upload die strandde (de app is herstart, de opruimronde haalde de reservering weg terwijl R2 niet bereikbaar was) of een wis-stap die R2 niet bereikte. Controleer dat de sleutel bij geen filmpje hoort en wis hem in het Cloudflare-dashboard (bucket → object → *Delete*).
  - Ontbrekend bestand: het filmpje speelt niet af. Haal het object terug uit de backup (`s3://clubalmanac-convex-backup/r2-videos/<sleutel>`) en zet het met dezelfde sleutel terug in de bucket, of laat de eigenaar het filmpje verwijderen en opnieuw toevoegen.
- **Opruimen** gebeurt elders: een open video-upload blijft een dag staan; daarna haalt de opruimronde (`cleanup old upload idempotency`, 03:30 UTC) reservering én tijdelijk object weg, en de lifecycle-regel wist alles onder `uploads/` na een dag. Verwijderen (ook door de webmaster, na 14 dagen gemeld, en account verwijderen) wist het object in R2. Mislukt dat, dan meldt de check het wees-object.
- **Integriteitscheck** (WP10): de poster is het beeld van de rij, dus een filmpje zonder poster of formaten valt onder de gewone meldingen.

## Cloudflare R2: originelen voor de clubfilm (WP38)

Zolang een filmproject open staat, sturen leden bij een nieuw filmpje ook het origineel in (volle kwaliteit, met datum en plaats). Die originelen staan in een **eigen bucket**, los van de filmpjes in de albums: de regel van een jaar raakt zo nooit een albumfilmpje, de backup ziet ze niet (bewust, besluit 14: ze staan ook nog op de telefoons), en de R2-check van WP37 ziet ze niet als wees. Zie [WP38](../work-packages/WP38-filmproject-originelen.md) en `convex/filmProjects.ts`.

- De app krijgt per deel van 32 MiB een ondertekende PUT van 7 dagen (multipart; grootte, deelnummer en upload-id in de handtekening). De backend rondt af als alles er is, en elk uur zelf (cron `film originals complete`).
- Downloaden alleen door de oprichter: een GET van 1 uur, als bijlage met datum en inzender in de naam.
- Grenzen (besluit 11): 2 GiB per origineel, 200 GiB per project, 400 GiB samen; minstens 1 MiB (`te_klein`; de app stuurt dan alleen het filmpje naar het album); hooguit 30 originelen per lid tegelijk onderweg (`bezig`). Een origineel blijft hooguit een jaar na binnenkomst; na sluiten mag een aangemeld origineel nog 14 dagen binnenkomen.
- Kosten: $0,015 per GB per maand; 100 GB een jaar lang is ~$1,50 per maand, het plafond van 400 GiB ~$6. Bij gewoon gebruik vallen delen, lijsten en afronden in het gratis miljoen verzoeken per maand. Per lid hooguit 600 keer aanmelden en afronden samen in 24 uur (`te_vaak`); de afrond-cron kijkt elk uur alleen originelen na die in de laatste 7 dagen links kregen. Alle leden een maand op die grenzen is ~1,2 miljoen verzoeken, ~$1 boven het gratis deel. De PUT's op de deel-links zelf vallen daarbuiten; daarvoor is de kostenmelding (stap 7).

### Opzetten (eenmalig, Wouter)

1. **Buckets** (*Create bucket*): `clubalmanac-originals-dev` en `clubalmanac-originals-prod`, *Location*: **Specify jurisdiction → European Union (EU)**, *Standard*, *Public access* uit. Geen CORS-regel: de iPhone uploadt zonder browser en downloaden is een gewone link.
2. **Tokens**: breid de tokens `clubalmanac-videos-dev` en `clubalmanac-videos-prod` uit (R2 → *Manage API tokens* → token → *Edit*) met *Object Read & Write* op de originelen-bucket van dezelfde omgeving. De sleutels blijven gelijk. Het backup-token (`clubalmanac-videos-backup`) krijgt de originelen-bucket **niet**. Op prod is het één token `clubalmanac-prod` met *Object Read & Write* op beide prod-buckets.
3. **Lifecycle-regel op de originelen-bucket** (bucket → *Settings* → *Object lifecycle rules* → *Add rule*): één regel `originelen-na-365-dagen`, zonder prefix, met twee acties aangevinkt: *Delete uploaded objects after* **365 days** (vangnet; normaal wist de backend ze op de dag zelf) en *Abort incomplete multipart uploads after* **7 days**.
   Kijk daarna op de buckets van de albums (`clubalmanac-videos-*`) na dat daar **geen** regel van 365 dagen staat; daar staat alleen `uploads-na-1-dag`.
4. **Convex env-var** per deployment: `R2_ORIGINALS_BUCKET` (tabel hieronder), in het dashboard (Settings → Environment Variables), **vóór of samen met de deploy** van 38a. De andere R2-vars zijn die van WP37.
5. **Controle op dev**: `npx convex run filmProjects:checkStorage`. Verwacht: geen mail. Een mail "kon niet draaien" met `R2_CONFIG_MISSING: R2_ORIGINALS_BUCKET` of `HTTP 403` betekent een env-var of token die niet klopt. Daarna de WP38-gate (multipart, lifecycle, download in Chrome en Safari).
6. **Prod**: bucket, token en regels als hierboven, de env-var op prod, en `npx convex run --prod filmProjects:checkStorage`. 38a mag eerder live; **open op prod geen filmproject vóór de release van 38b en 38c**: zonder app die insturen kan, gaan nieuwe filmpjes wel naar het filmalbum maar komt er geen origineel.
7. **Kostenmelding** in Cloudflare: een budget alert (*Manage Account* → *Billing* → *Billable Usage*) op **$10** per maand, voor het hele account.
   **Bij een melding** (of misbruik van de deel-links): rol het R2-token van die omgeving. Maak een nieuw token met dezelfde rechten, zet `R2_ACCESS_KEY_ID` en `R2_SECRET_ACCESS_KEY` in Convex op de nieuwe sleutels en trek dan het oude token in. Daarna werken de uitgegeven deel-links en downloadlinks niet meer. **Let op:** hetzelfde token tekent de links van de albumfilmpjes (WP37). Ook die vallen weg tot de nieuwe sleutels in Convex staan; trek het oude token dus niet in voordat ze er staan.

| Env-var | Waarde | Wat gebeurt bij ontbreken of leeg |
|---|---|---|
| `R2_ORIGINALS_BUCKET` | `clubalmanac-originals-dev` of `clubalmanac-originals-prod` | insturen en downloaden falen voor wie mag met `R2_CONFIG_MISSING: R2_ORIGINALS_BUCKET`; de dagelijkse check mailt; filmpjes in albums werken gewoon |

Wie geen toegang heeft, krijgt altijd de gewone weigering (`ORIGINAL_REFUSED` of `ORIGINAL_NOT_FOUND`), ook zonder config.

### Bewaking, opruimen en downloaden

- **Dagelijkse check** (cron `film originals check`, 05:45 UTC): één mail aan `WEBMASTER_EMAILS` bij een *wees-object* (geen inzending, ouder dan een dag), een inzending die binnen is *zonder bestand* of met *een andere grootte*, een *halve upload* zonder inzending ouder dan 8 dagen (dan werkt de lifecycle-regel voor halve uploads niet), of als de check niet kon draaien. De check wist niets.
  - Wees-object: meestal een wis-stap die R2 niet bereikte. Controleer in Convex (tabel `filmOriginals`, veld `key`) dat er geen inzending bij hoort en wis het in het Cloudflare-dashboard.
  - Zonder bestand: er is geen backup. Vraag de inzender het origineel terug te trekken; een nieuw origineel kan alleen bij een nieuw filmpje tijdens een open project.
- **Opruimen** (cron `film originals expiry`, 05:30 UTC): originelen een jaar na binnenkomst, halve inzendingen 14 dagen na sluiten, en een herinnering aan de oprichter 30 dagen vóór de eerste weggaan. Die herinnering komt één keer; bij een zeldzame storing (de mail ging weg, maar het vastleggen daarvan mislukte) kan hij een tweede keer komen. Terugtrekken, verwijderen, groep of account verwijderen, uit de groep gaan en het filmpje in het album verwijderen halen het origineel meteen weg, ook in R2.
- **Tabellen leegmaken** (migratie-tooling, bv. een herstart van de import) wist de rijen in `filmProjects` en `filmOriginals`, niet de objecten in de originelen-bucket. Maak die bucket dan apart leeg in het Cloudflare-dashboard; anders meldt de check ze de volgende dag als wees.
- **Downloaden** (oprichter, in de webapp): per origineel een link van een uur; "alles downloaden" haalt ze na elkaar, elk met een verse link. Is een link verlopen, vraag dan een nieuwe. Daarna "alles verwijderen" als de film klaar is.

## Clubboek → Geld (WP41)

Het clubboek (lokaal, alleen 127.0.0.1) zet een afrekening met **Zet in de app** in de tab Geld van één groep, en haalt hem weg met **Haal uit de app**. Het clubboek stuurt; Convex haalt nooit iets op. Routes op de Convex-site (`https://<deployment>.<region>.convex.site`): `POST /settlements` (vervangt per evenement) en `DELETE /settlements?key=<id>`, met de header `X-Clubboek-Secret: <FINANCE_SECRET>`. Het geheim in `Authorization` telt niet (403). Geen CORS: niet voor een browser. Zie [WP41](../work-packages/WP41-financieel.md).

### Env-vars per deployment (dev en prod)

| Env-var | Waarde | Bij ontbreken of fout |
|---|---|---|
| `FINANCE_SECRET` | 32 willekeurige bytes, hex (64 tekens): `openssl rand -hex 32`. Per deployment een eigen waarde | elk verzoek krijgt dezelfde 403 (fail-closed, geen standaardwaarde). Korter dan 32 tekens telt als geen geheim |
| `FINANCE_GROUP_ID` | het `_id` van de groep op die deployment (dashboard → Data → `groups`) | idem, ook als de groep niet (meer) bestaat |

- **De groep staat op de deployment**, niet in het verzoek: een gelekt geheim beschrijft alleen die groep.
- **In het clubboek** staan de URL van de Convex-site en hetzelfde geheim in een lokaal instellingenbestand naast het clubboek (alleen leesbaar voor de eigenaar), niet in de code en niet in deze repo. Wouter vult het zelf in.
- **Roteren:** een nieuwe waarde met `openssl rand -hex 32`, zet hem op de deployment (dashboard → Settings → Environment Variables) en in het instellingenbestand van het clubboek. Convex leest env-vars per aanroep, dus direct actief; daartussen geeft de knop een 403. De afrekeningen in de app blijven staan. Roteer ook als het geheim ergens anders terecht is gekomen (een chat, een log, een schermafbeelding).
- **Andere groep of groep weg:** een verwijderde groep neemt haar afrekeningen mee (cascade G6); zet daarna `FINANCE_GROUP_ID` op de nieuwe groep en stuur opnieuw.
- **Na een migratie-reset of import:** de tooling leegt `settlements` mee (de import vult hem niet), en de groep krijgt een nieuw id. Zet eerst `FINANCE_GROUP_ID` op het nieuwe id van de groep, dán opnieuw sturen vanuit het clubboek. Met de oude waarde geeft elke poging 403 (de groep bestaat niet meer).
- **Logs:** de routes loggen niets (geen geheim, header of body). Een weigering staat als 403 op `/settlements`; een vormfout als 400 met het pad van het veld in het antwoord.
- **Foto bij een afrekening (WP41c):** het clubboek stuurt `image` (een JPEG als base64, ontsleuteld hoogstens 1 MiB; het hele verzoek dan hoogstens 1,5 MiB) pas als in zijn instellingen `"foto": true` staat voor die omgeving. Een Convex zonder WP41c weigert het veld (400 bij elke verzending). Volgorde, eerst op dev en pas na de gate op prod:
  1. Convex deployen (Wouter).
  2. Dan pas `"foto": true` in het clubboek voor die omgeving, en opnieuw sturen.

  De foto staat in Convex-storage en gaat mee weg bij opnieuw sturen, Haal uit de app, het verwijderen van de groep en een migratie-reset. MON1 en `verify` tellen hem als verwezen storage, dus niet als wees.

## Webapp: app.clubalmanac.com (WP35)

Expo Web van `app/`: bekijken, plus foto's uploaden en de eigen profielfoto (WP36). Stack [`infra/webapp.yml`](../../infra/webapp.yml) (bucket `clubalmanac-webapp`, eigen CloudFront-distributie, certificaat uit ACM us-east-1, DNS in Route 53, deploy-rol via OIDC). Deploy met de hand: Action *Webapp* op `main`, na de Convex-deploy. Repo-variabelen `WEBAPP_BUCKET`, `WEBAPP_DISTRIBUTION_ID`, `WEBAPP_DEPLOY_ROLE_ARN`, `WEBAPP_CONVEX_URL`, `WEBAPP_CLERK_PUBLISHABLE_KEY`. Deploy in twee jobs: *build* (`npm ci --ignore-scripts`, geen deployrecht) en *deploy* (alleen het artefact en de AWS CLI) in GitHub-environment `webapp`, de enige die de deploy-rol mag aannemen. Content-Security-Policy in de response-headers-policy van de stack, met de prod-hosts van Convex en Clerk als parameters. Opzet en controle: [`docs/runbooks/webapp.md`](../runbooks/webapp.md).

- **Kaart:** Leaflet met tegels van `tile.openstreetmap.org`, zonder sleutel. Gebruiksbeleid: de bronvermelding staat zichtbaar met een link, de browser stuurt een `Referer` mee (de distributie zet `Referrer-Policy: strict-origin-when-cross-origin`; nooit `no-referrer`), en er wordt niets vooraf of in bulk geladen. Bij veel meer verkeer: een eigen tegeldienst.
- **Beelden:** met de header opgehaald (`no-store`) en als `blob:` in een begrensd geheugen per user (`app/src/data/images.web.tsx`); geen token in een URL.
- **Films:** dezelfde ondertekende S3-link als de app; een `<video>` zonder `crossOrigin` speelt hem en spoelt, zonder CORS op `blob-videos`.
- **Uploaden (WP36):** de browser zet elke foto om naar een JPEG (≤ 4032, 0,85, rechtop, zonder EXIF) op een canvas, één tegelijk, en stuurt hem naar `/upload` zoals de app (2 tegelijk, upload-id per foto, datum en plaats als headers uit de EXIF van het bestand). Vóór het versturen een controle op GPS in het héle bestand. Wat de browser niet leest (HEIC in Chrome), krijgt "Dit soort foto kan de browser niet openen"; boven 100 MP "te groot" zonder te decoderen (de maat uit het hele bestand; een JPEG zonder maat wordt geweigerd). Datum en plaats komen alleen uit een JPEG: een HEIC (Safari op de Mac), PNG of WebP komt zonder datum en plaats binnen. De fotokiezer van Android haalt de plaats meestal weg (B1): die foto's komen zonder plaats binnen. Zit er na het omzetten toch een locatie in de foto, dan gaat hij niet mee ("Er zat nog een locatie in de foto"). De CSP hoeft niet anders: `connect-src` heeft `.convex.site` al, `img-src` heeft `blob:`.

## Backup: GitHub Action naar S3 (WP31 B4)

Elke maand een volledige export van Convex-prod met bestanden naar bucket `clubalmanac-convex-backup` (eu-west-1), en sinds WP37 de filmpjes uit R2 (prefix `r2-videos/`, met een alleen-lezen R2-token). Geheim `CONVEX_PROD_DEPLOY_KEY` in GitHub-environment `prod-backup` (alleen `main`), repo-variabelen `BACKUP_BUCKET`, `BACKUP_ROLE_ARN` en `BACKUP_ENABLED` (pas `true` bij de vrijgave, draaiboek T0.11; zonder slaat de workflow over). Actions vast op commit-SHA. Per sleutel blijven minstens de laatste 6 versies, plus alles van het laatste half jaar. Opzet, controle en terugzetten: [`infra/backup.md`](../../infra/backup.md). ~$1 per maand.

## Productie-blind-spots

JWT validation roundtrip, Mailjet bounce webhook, Photon connection: deze zijn unit-test alleen via mocks gevalideerd. Echte service-integratie loopt via de [integration-test laag](./integration-tests.md) (`npm run test:integration`, niet in CI), per werkpakket apart. Photon (WP1) is gepind; Convex/Clerk/Mailjet (WP2-4) staan op de planning.

## Waarom deze keuzes

Eerlijke evaluatie tegen 16-user hobby use case. EU-providers waar mogelijk voor GDPR-coherentie. Geen paid services voor functionaliteit die gratis kan.
