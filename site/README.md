# Site op clubalmanac.com (na de oude webapp)

Besluit Wouter 2026-11-15: de oude webapp gaat uit vóór de overstap. Op clubalmanac.com staan dan alleen:

- `/`: de webapp is uit dienst, gebruik de iPhone-app
- `/privacy/nl`: de privacyverklaring. App Store Connect linkt hierheen, dus deze pagina moet blijven.

De bestanden maak je met `node scripts/site/build.mjs` (vanuit de repo-root). De privacytekst komt uit `app/src/content/infoTexts.ts`. Pas je die aan, draai het script opnieuw en upload `privacy/nl` opnieuw.

## Hosting

CloudFront-distributie met alternate domain `clubalmanac.com`, DNS in Route 53. De oude webapp komt uit bucket `blob-images-frontend-master` (Next.js). Die bucket blijft staan als terugvaloptie. De nieuwe site staat in een eigen bucket `clubalmanac-site`.

Domein, DNS en CloudFront blijven staan: de mail van `invites@`, `info@` en `wouter@` hangt aan het domein.

## Uitzetten (Wouter, AWS-console)

1. **S3 → Create bucket** `clubalmanac-site`, regio `us-east-1`, Block public access aan (standaard).
2. **Upload** `index.html`. Daarna **Create folder** `privacy` en upload daarin het bestand `nl`. Zet bij die upload onder **Properties → Metadata** het type *System defined*, key `Content-Type`, value `text/html; charset=utf-8`. Doe dat ook voor `index.html`.
3. **CloudFront → de distributie → Origins → Create origin**: origin domain `clubalmanac-site.s3.us-east-1.amazonaws.com`, origin access **Origin access control settings**, maak een nieuwe OAC. Na het opslaan toont de console een bucket policy: kopieer die naar **S3 → clubalmanac-site → Permissions → Bucket policy**.
4. **Behaviors → Default (\*) → Edit**: noteer eerst wat er bij *Function associations* staat (voor terugzetten). Zet de origin op `clubalmanac-site` en alle function associations op *No association*. Opslaan.
5. **General → Edit → Default root object**: `index.html`.
6. **Invalidations → Create invalidation**: `/*`.
7. Controle: https://clubalmanac.com toont "uit dienst", https://clubalmanac.com/privacy/nl de privacyverklaring.

Terugzetten: Default (\*) weer op `blob-images-frontend-master` met de genoteerde function associations, en opnieuw `/*` invalideren.
