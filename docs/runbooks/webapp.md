# Webapp op app.clubalmanac.com (WP35, WP36)

De iPhone-app als webapp: bekijken, uitnodigingen accepteren of afwijzen, foto's uploaden in een album en de eigen profielfoto zetten of weghalen (WP36). Dezelfde code als de app (`app/`, Expo Web), gehost als statische bestanden achter CloudFront. `clubalmanac.com` en de privacypagina ([`site/README.md`](../../site/README.md)) worden niet geraakt.

- **Hosting:** stack [`infra/webapp.yml`](../../infra/webapp.yml): bucket `clubalmanac-webapp`, eigen CloudFront-distributie, DNS-records, deploy-rol (OIDC, alleen `main`).
- **Deploy:** GitHub Action *Webapp* ([`.github/workflows/webapp.yml`](../../.github/workflows/webapp.yml)), **alleen met de hand**, na de Convex-deploy naar prod (besluit B3).
- **Backend:** CORS op de beeldpaden en `/upload` voor de origins in `CLUBALMANAC_WEB_ORIGINS`; de web-link in de uitnodigingsmail uit `CLUBALMANAC_WEB_URL`. Zie [`external-services.md`](../conventions/external-services.md) §Webapp.
- **Kosten:** CloudFront en S3 voor een paar MB aan bestanden en ~20 leden: centen per maand. Kaarttegels van OpenStreetMap: gratis. Clerk blijft gratis.

## Lokaal tegen dev (de gate)

Eenmalig op dev (Wouter):

```bash
npx convex env set CLUBALMANAC_WEB_ORIGINS "http://localhost:8081"
```

```bash
npx convex dev --once
```

Daarna, met de dev-waarden in `app/.env.local`:

```bash
cd app && npx expo start --web
```

Open http://localhost:8081. Inloggen op dev: een `+clerk_test`-adres met code 424242 ([`external-services.md`](../conventions/external-services.md) §Auth). Zonder de env-var laden de beelden niet (de browser blokkeert ze) en staat er in de Convex-logs een fout met `CLUBALMANAC_WEB_ORIGINS`. `CLUBALMANAC_WEB_URL` blijft op dev leeg: er is geen gehoste dev-webapp.

Op een telefoon in hetzelfde netwerk: `npx expo start --web --host lan` en het adres van de Mac (bv. `http://192.168.1.20:8081`). Zet dat adres er dan bij in `CLUBALMANAC_WEB_ORIGINS` (komma-gescheiden), anders laden de beelden niet. Uploaden werkt dan wel, maar het scherm blijft niet vanzelf aan (de Wake Lock vraagt https of localhost).

**Op de Android-emulator** (WP36, B5): `adb reverse tcp:8081 tcp:8081`, dan in Chrome op de emulator `http://localhost:8081` (zelfde origin, geen extra env-var). Testfoto's met EXIF erop: `adb push tests/fixtures/wp36/*.jpg /sdcard/DCIM/Camera/` en de emulator herstarten (of de mediascanner per bestand).

**Uploaden controleren** (WP36), met de testfoto's uit [`tests/fixtures/wp36/`](../../tests/fixtures/wp36/README.md):

1. Een album → **Foto's toevoegen**: de kiezer opent meteen. Kies alle testfoto's (ook `doorzichtig.png`) → **Foto's uploaden**. Voortgang "n van m", daarna de groene melding.
2. In het album (web en iPhone): rechtop zoals in de tabel van de README, `doorzichtig.png` met wit, de datum en de plaats zoals in de tabel; `nul-gps` en `staand-8` zonder plaats, `zonder-exif` zonder datum.
3. De **+** in de tabbalk: kiezer, dan een album kiezen. Annuleer de kiezer één keer: de knop **Foto's kiezen** staat er.
4. Netwerk uit (Chrome: *Ontwikkelaarstools → Netwerk → Offline*) tijdens een ronde: per foto "Geen verbinding met internet", **Opnieuw proberen** na netwerk aan maakt geen dubbele foto's. **Meer foto's** met dezelfde foto ook niet.
5. Een HEIC in Chrome: "Dit soort foto kan de browser niet openen", de andere foto's gaan door.
6. Herladen tijdens een ronde: de browser vraagt eerst of je de pagina wilt verlaten.
7. **Profiel → Foto kiezen**: melding "openbaar" (OK), dan een vierkant uit het midden als profielfoto. **Profielfoto weghalen** na bevestiging: overal de letter.

## Eenmalig opzetten op prod (Wouter)

In deze volgorde. Stap 1 tot en met 7 kunnen vóór de merge; stap 8 tot en met 12 na de merge van de PR naar `main`.

1. **Certificate Manager**, regio **US East (N. Virginia) us-east-1** (CloudFront neemt alleen daar een certificaat) **→ Request certificate → Request a public certificate**. Domeinnaam `app.clubalmanac.com`, validatie **DNS validation**. Open het certificaat → **Create records in Route 53** → **Create records**. Wacht tot de status *Issued* is (meestal een paar minuten). Noteer het **ARN**.
2. **Route 53 → Hosted zones** → `clubalmanac.com`: noteer de **Hosted zone ID**.
3. **IAM → Identity providers** → `token.actions.githubusercontent.com`: noteer de **ARN** (dezelfde als bij `clubalmanac-site`).
4. **De prod-hosts voor de Content-Security-Policy** noteren:
   - **Convex:** de prod-`EXPO_PUBLIC_CONVEX_URL` zonder `https://` en zonder `.convex.cloud` (bv. `happy-otter-123.eu-west-1`).
   - **Clerk-dashboard, prod-instance → Configure → Domains**: de host bij **Frontend API** (bv. `clerk.clubalmanac.com`). Niet een `….clerk.accounts.dev`: dat is dev, en de stack weigert hem.
   - **Films:** `<bucket>.s3.<regio>.amazonaws.com`, met de bucket en regio van prod:

     ```bash
     npx convex env get FILMS_S3_BUCKET --prod
     ```

     ```bash
     npx convex env get FILMS_S3_REGION --prod
     ```
5. **CloudFormation**, regio **eu-west-1 (Ireland)** **→ Create stack → With new resources → Upload a template file** → `infra/webapp.yml`. Stacknaam `clubalmanac-webapp`. Parameters: `CertificateArn` uit stap 1, `HostedZoneId` uit stap 2, `GitHubOidcProviderArn` uit stap 3, `ConvexDeployment`, `ClerkFrontendApiHost` en `FilmsHost` uit stap 4; de rest laten staan (`GitHubEnvironment` = `webapp`). Vink onderaan aan dat de stack IAM-resources mag maken. Wacht op *CREATE_COMPLETE* (de distributie kost ~5 minuten) en open **Outputs**.
6. **GitHub → repo → Settings → Environments → New environment.** Name `webapp` → **Configure environment**. Bij **Deployment branches and tags**: kies **Selected branches and tags** → **Add deployment branch or tag rule** → Ref type **Branch**, Name pattern `main` → **Add rule**. Verder niets: geen geheimen, de variabelen staan op repo-niveau. Alleen een job in deze environment mag de deploy-rol aannemen (de trust van de rol in de stack), en de environment laat alleen `main` toe.
7. **GitHub → repo → Settings → Secrets and variables → Actions → Variables → New repository variable**, vijf keer:
   - `WEBAPP_BUCKET` = output `BucketName`
   - `WEBAPP_DISTRIBUTION_ID` = output `DistributionId`
   - `WEBAPP_DEPLOY_ROLE_ARN` = output `DeployRoleArn`
   - `WEBAPP_CONVEX_URL` = de prod-`EXPO_PUBLIC_CONVEX_URL` (`https://….convex.cloud`, dezelfde als in de EAS-omgeving *production*)
   - `WEBAPP_CLERK_PUBLISHABLE_KEY` = de prod-`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_live_…`)
8. **Convex prod**, de toegestane origin, dan de backend (vanuit de release-clone, [`scripts/deploy-prod.sh`](../../scripts/deploy-prod.sh)):

   ```bash
   npx convex env set CLUBALMANAC_WEB_ORIGINS "https://app.clubalmanac.com" --prod
   ```

   ```bash
   npm run deploy:prod
   ```

9. **Clerk-dashboard, prod-instance → Configure → Domains**: `app.clubalmanac.com` is een subdomein van het domein van de instance, dus er hoeft niets bij (geen satellite-domein). Check alleen dat het domein `clubalmanac.com` er staat en groen is. Laat **Attack protection → Bot sign-up protection** uit (WP19b besluit 3; met hem aan vraagt Clerk op het web een captcha die de app niet heeft, en die de Content-Security-Policy ook blokkeert).
10. **GitHub → Actions → Webapp → Run workflow** (branch `main`). Twee jobs: *build* en dan *deploy* (in de environment `webapp`). Check dat beide groen zijn.
11. **Controle:** https://app.clubalmanac.com toont het inlogscherm; http:// stuurt door naar https://; een diep adres (bv. `/profiel`) herladen geeft de app, geen foutpagina; https://clubalmanac.com/privacy/nl werkt nog. Open de **console** van de browser (Chrome: *Weergave → Ontwikkelaar → JavaScript-console*) en doe: inloggen, een album openen (beelden laden), de kaart, een film afspelen, uitloggen. Upload ook één foto in een album (zoals in §Uploaden controleren, stap 1–2) en zet en verwijder een profielfoto. Er mag geen melding met *Content Security Policy* of *Refused to* staan. Na de livegang laat één lid met Android één ronde doen (B5): komen de foto's rechtop en met datum binnen? Staat die er wel: noteer de geblokkeerde host en meld hem; de CSP staat in `infra/webapp.yml` (`WebappHeadersPolicy`).
12. **Pas als stap 11 goed is**, de web-link in de uitnodigingsmail aanzetten:

    ```bash
    npx convex env set CLUBALMANAC_WEB_URL "https://app.clubalmanac.com" --prod
    ```

    Precies zo: `https://`, geen `/` aan het eind. Anders gaat de mail zonder web-link en staat er een fout met `CLUBALMANAC_WEB_URL` in de log.

## Een nieuwe versie

Na een merge met app-wijzigingen: eerst de Convex-backend naar prod (als die ook veranderde), dan **Actions → Webapp → Run workflow** op `main`. De workflow bouwt, zet eerst de bundels (met hash, een jaar in de cache), dan `index.html` (`no-cache`) en leegt de cache van `index.html`. Een open tabblad krijgt de nieuwe versie bij herladen. Oude bundels blijven 7 dagen staan (een open tabblad breekt niet), daarna ruimt een volgende deploy ze op; de bucket houdt oude versies nog 30 dagen.

**Terugzetten:** de vorige commit van `main` opnieuw deployen kan niet met de knop (die bouwt `main`). Revert de commit via een PR, of zet in S3 de vorige versie van `index.html` terug (*Show versions*) en leeg de cache van `/index.html`.

## Clerk-versie ophogen

Op het web laadt Clerk zijn scripts (`clerk-js` en `@clerk/ui`) van de Frontend API. De versies staan vast in [`app/src/auth/clerkWebScripts.web.ts`](../../app/src/auth/clerkWebScripts.web.ts) (nu `clerk-js` 6.46.2, `ui` 1.44.2). Bij een update van `@clerk/expo`: haal die twee regels tijdelijk weg, kijk lokaal (`npx expo start --web`, Netwerk, filter `npm/@clerk/`) welke versies hij dan laadt, test inloggen en uitloggen, en zet die versies erin.

## Bekend

- Een beeld kost op het web de eerste keer twee verzoeken (preflight + het beeld). Te traag bij het album van 540: dan is de terugval een korte ondertekende link, een nieuw besluit (B1).
- Op een gedeelde computer blijft iemand ingelogd tot hij uitlogt, hooguit 7 dagen (Clerk Hobby); het inlogscherm zegt dat (B5).
- Een film is in de browser met "Videoadres kopiëren" door te sturen; die link werkt 3 uur (WP21 besluit 2).
