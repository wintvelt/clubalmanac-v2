# Site op clubalmanac.com (na de oude webapp)

Besluit Wouter 2026-11-15: de oude webapp gaat uit vóór de overstap. Op clubalmanac.com staan dan alleen:

- `/`: de website is even dicht (bijkomen van een lustrum), gebruik de iPhone-app
- `/privacy/nl`: de privacyverklaring. App Store Connect linkt hierheen, dus deze pagina moet blijven.

De bestanden maak je met `node scripts/site/build.mjs` (vanuit de repo-root). De privacytekst komt uit `app/src/content/infoTexts.ts`. Pas je die aan, draai dan het script opnieuw en commit `site/`. Na de merge naar `main` zet de Action [`site.yml`](../.github/workflows/site.yml) de pagina's online en leegt de cache.

## Hosting

CloudFront-distributie met alternate domain `clubalmanac.com`, DNS in Route 53. De oude webapp komt uit bucket `blob-images-frontend-master` (Next.js). Die bucket blijft staan als terugvaloptie.

De nieuwe site staat in bucket `clubalmanac-site`, gemaakt door CloudFormation-stack [`infra/site.yml`](../infra/site.yml). Die stack regelt ook de leestoegang voor CloudFront (OAC) en de deploy-rol voor GitHub Actions (OIDC, alleen vanaf `main`, alleen deze bucket en cache legen). Geen AWS-sleutels in GitHub. De distributie zelf zit niet in de stack: die bestond al.

Domein, DNS en CloudFront blijven staan: de mail van `invites@`, `info@` en `wouter@` hangt aan het domein.

## Eenmalig opzetten (Wouter)

Stap 1 tot en met 4 vóór de merge van de PR; de merge zet daarna de pagina's in de bucket.

1. **IAM → Identity providers**: staat `token.actions.githubusercontent.com` er al? Noteer dan de ARN, en check dat bij *Audiences* `sts.amazonaws.com` staat.
2. **CloudFront**: noteer het ID van de distributie van clubalmanac.com (begint met `E`).
3. **CloudFormation** (regio *us-east-1*) **→ Create stack → Upload a template file** → `infra/site.yml`. Stacknaam `clubalmanac-site`. Parameters: `DistributionId` uit stap 2, `GitHubOidcProviderArn` uit stap 1 (leeg als die er niet was). Vink onderaan aan dat de stack IAM-resources mag maken. Wacht op *CREATE_COMPLETE* en bekijk **Outputs**.
4. **GitHub → repo → Settings → Secrets and variables → Actions → Variables**: `SITE_BUCKET` = `clubalmanac-site`, `SITE_DISTRIBUTION_ID` = het ID uit stap 2, `SITE_DEPLOY_ROLE_ARN` = output `DeployRoleArn`.
5. **Merge de PR.** De Action *Site* draait vanzelf en zet de pagina's in de bucket. Check in **Actions** dat hij groen is. Later opnieuw draaien kan met **Run workflow** op `main`.
6. **CloudFront → de distributie → Origins → Create origin**: origin domain = output `BucketOriginDomain`, origin access **Origin access control settings**, kies OAC `clubalmanac-site`. De bucket policy staat al goed; de gele balk met *Copy policy* mag je negeren.
7. **Eerst vastleggen voor terugzetten** (screenshots): bij **Behaviors** de lijst en van *Default (\*)* het edit-scherm (origin, viewer protocol policy, cache policy, origin request policy, function associations); de tab **Error pages**; bij **General** het *Default root object*.
8. **Behaviors → Default (\*) → Edit**:
   - Origin: de nieuwe origin.
   - *Viewer protocol policy*: **Redirect HTTP to HTTPS** (S3 krijgt dan altijd HTTPS; met "HTTP and HTTPS" geeft http:// een 403).
   - *Cache policy*: **CachingOptimized**. *Origin request policy*: geen (stuur de Host-header niet door, anders weigert S3).
   - Alle *Function associations*: **No association**. Save.
9. **Behaviors**: verwijder de andere regels (`_next/static/*`, `static/*`, `_next/data/*`); die horen bij de oude webapp. **Error pages**: verwijder eigen foutpagina's van de oude webapp.
10. **General → Settings → Edit → Default root object**: `index.html`. Save.
11. **Invalidations → Create invalidation**: `/*`. Controle: https://clubalmanac.com toont de lustrumtekst, http://clubalmanac.com stuurt door naar https, https://clubalmanac.com/privacy/nl toont de privacyverklaring.

Terugzetten: alles uit stap 7 terug zoals op de screenshots, en opnieuw `/*` invalideren.

Bekend: een onbekend pad (bv. `/favicon.ico`) geeft een 403-foutpagina van CloudFront in plaats van een 404.
