# WP37: filmpjes in albums

> Regie 2026-11-21. Eerste WP na de livegang van de webapp, voor app-release 2.0.2. Route 1 van twee: filmpjes die leden delen. Route 2 (originelen voor de clubfilm) is [WP38](./WP38-filmproject-originelen.md) en bouwt hierop voort. A → besluiten Wouter → B → audit → red-team → gate op een echte iPhone (dev-build) met Wouters voorbeeldfilmpjes. Eigen branch `wp37`.

## Productdoel

Een lid zet vanaf zijn iPhone een filmpje van hooguit 3 minuten in een album van zijn groep, net zo makkelijk als een foto. Het filmpje staat tussen de foto's, op datum, met een poster en de duur op de tegel; de andere leden spelen het af in de app en in de browser, en zien het op de kaart van het album op de plek waar het is opgenomen. Het bestand dat ze krijgen bevat geen GPS. Mislukt de upload (mobiel internet, app naar de achtergrond), dan ziet hij dat en kan hij opnieuw proberen zonder dubbel filmpje.

## Besluiten (Wouter, 2026-11-21)

1. **Tussen de foto's, zoals in Foto's op de iPhone.** Tegel met poster, afspeelteken en duur (bv. 0:42). In het album een filter: Alle, Foto's, Video's. Vegen in het detail gaat door foto's en filmpjes heen.
2. **Opslag in Cloudflare R2**, metadata in Convex. Wouter maakt het Cloudflare-account aan. Afspelen via een kortlevende link uit de backend, zoals de clubfilms ([WP21](./WP21-videos.md)). Gewone mp4, geen streaming-formaat.
3. **Hooguit 3 minuten.** De app comprimeert vóór het uploaden naar ongeveer de kwaliteit van Wouters voorbeeld: 1080p (rechtop 1080 × 1920), H.264 met AAC, rond 3,5–4 Mbit/s, dus ~28 MB per minuut en ~85 MB voor 3 minuten. Het voorbeeld staat op de server in `builds/video/` (gitignored).
4. **Uploaden eerst alleen vanaf de iPhone.** Afspelen ook in de webapp en op de iPad.
5. **Op de kaart** (Wouter, na de kickoff): datum en plaats van het filmpje worden bewaard zoals bij een foto (`takenAt`, `latitude`, `longitude`, `locationLabel`), en het filmpje staat op de kaart van het album. Het bestand zelf bevat geen GPS.

## Wat er is

- Foto's: `POST /upload` ([WP18](./WP18-foto-upload.md)) met reservering per upload-id; JPEG zonder EXIF, datum en plaats als headers; grens 15 MiB (een httpAction kan ~20 MiB aan, dus filmpjes passen niet op dit pad). Daarna maakt de backend *klein* en *groot* ([WP25](./WP25-fotoformaten.md)); de integriteits-check ([WP10](./WP10-integrity-monitoring.md)) meldt een foto zonder formaten na een uur.
- Een foto-rij (`photos` in [`convex/schema.ts`](../../convex/schema.ts)) heeft o.a. eigenaar, `storageId`, `takenAt`, locatie, `exifOrientation` en `formats`. Albums, Mijn foto's, de kaart ([WP17d](./WP17d-kaart-locatie-delen.md)), melden ([WP20](./WP20-melden.md)), uit album, verwijderen, cover en profielfoto ([WP17b](./WP17b-foto-acties.md), [WP27](./WP27-profiel.md)) gaan allemaal over die rij.
- Beelden komen via de eigen beeldpaden (`/beeld/...`) met een toegangscheck per verzoek; in de app met de header, op het web met een begrensd geheugen ([WP35](./WP35-webapp-bekijken.md)).
- Clubfilms ([WP21](./WP21-videos.md)): afspelen met `expo-video` via een ondertekende S3-link van 3 uur uit de backend. De R2-overstap van die films staat los in de backlog (README, rij TBD).
- `expo-image-picker` en `expo-video` zitten in de app; geen bibliotheek voor compressie, metadata van video of R2.
- Account verwijderen ([WP29](./WP29-account-verwijderen.md)) ruimt in stappen foto's en bestanden op; de maandelijkse backup ([`infra/backup.md`](../../infra/backup.md)) exporteert Convex met bestanden, niet R2.

## Invarianten

1. **Toegang zit in de backend.** Een filmpje toevoegen mag alleen wie ook een foto in dat album mag zetten. Een afspeellink en een poster krijgt alleen wie de foto's van dat album mag zien, net als nu. Geen publieke bucket, geen link die langer leeft dan nodig.
2. **Geen GPS buiten de backend.** Het bestand in R2 en de poster bevatten geen locatie (ook niet in QuickTime-metadata of een metadata-spoor). De plaats staat alleen in de rij, zoals bij foto's (WP17d).
3. **Op de kaart en op datum.** Een filmpje met plaats staat op de kaart van het album; zonder plaats telt het mee bij "zonder locatie". Zonder opnamedatum komt het binnen zonder, niet met vandaag.
4. **Geen dubbele filmpjes.** Opnieuw proberen na een mislukte of afgebroken upload maakt geen tweede rij en geen tweede bestand dat blijft staan.
5. **Geen stille mislukking, geen wezen.** De user ziet wat niet lukte, met een NL-reden en opnieuw proberen. Een upload die halverwege strandt, laat geen bestand in R2 of rij in Convex achter dat niemand ziet of opruimt; de integriteits-check ziet weesbestanden en filmpjes zonder poster of bestand.
6. **Weg is weg, ook in R2.** Filmpje verwijderen, account verwijderen en de webmaster die een gemeld filmpje verwijdert, halen ook het bestand en de poster uit R2.
7. **De grens geldt in de backend.** Langer dan 3 minuten of groter dan de afgesproken grens weigert de backend ook, niet alleen de app.
8. **Speelt overal af:** iPhone, iPad en de webapp (Chrome, Safari, Android Chrome).
9. **Wat niet bij een filmpje past, staat er niet.** Draaien en "Als profielfoto" niet bij een filmpje; melden, verwijderen, uit album en delen wel. Cover: zie open vraag 9.
10. **Foto's veranderen niet.** De hele testsuite blijft groen; een album zonder filmpjes ziet er hetzelfde uit.

## Scope

- **In:** filmpjes kiezen op de iPhone (ook via de "+" in de tabbalk en in het album, zoals foto's); comprimeren, poster maken, datum en plaats lezen; uploaden naar R2 met voortgang en opnieuw proberen; tegel, filter, afspelen in het detail (app en web); kaart; melden, verwijderen, uit album; opruimen bij verwijderen en account verwijderen; integriteits-check; backup van R2; R2 opzetten (dev en prod) met runbook.
- **Bewust niet:** uploaden vanuit de webapp; filmpjes bewerken of inkorten; een filmpje als profielfoto; route 2 (WP38); de clubfilms naar R2 (eigen backlog-item, wel meenemen als dat met deze opzet vrijwel gratis is: A rapporteert).

## Open vragen voor A (rapporteren aan regie)

1. **Kiezen en metadata.** Geeft `expo-image-picker` op iOS bij een video de opnamedatum en de plaats, of is `expo-media-library` (asset-info) nodig? Welke toestemming vraagt dat van de user?
2. **Comprimeren.** Hoe halen we besluit 3 (1080p, H.264, ~3,5–4 Mbit/s)? De exportpresets van de picker regelen de resolutie maar niet de bitrate; welke bibliotheek (bv. een native module met AVAssetWriter) doet het, wat kost dat aan bouwen en onderhoud, en hoe lang duurt 3 minuten op een iPhone?
3. **GPS eruit.** Haalt de compressie de locatie-metadata weg, of blijft die staan (QuickTime `©xyz`, `com.apple.quicktime.location.ISO6709`, metadata-sporen)? Hoe testen we dat het bestand in R2 schoon is?
4. **Poster.** Op het toestel maken (bv. `expo-video-thumbnails`) en dan door de bestaande formaat-stap als *klein* en *groot*, of anders? Welk frame?
5. **Uploaden naar R2.** Rechtstreeks met een ondertekende PUT (bv. `@convex-dev/r2`) en daarna een bevestiging aan de backend? Hoe past de reservering per upload-id daarin? Wat bij ~85 MB over mobiel internet, de app naar de achtergrond of het scherm uit: in één keer of in delen, en kan het hervatten?
6. **Grenzen in de backend** (invariant 7). Hoe controleert de backend duur en grootte van een bestand dat niet langs Convex gaat?
7. **Afspelen.** Ondertekende GET-link uit de backend: hoe lang geldig, cache in de app, spoelen (range-requests) in `expo-video` en in de browser? CORS op R2 voor de webapp.
8. **Datamodel.** Dezelfde `photos`-rij met een soort-veld en videovelden (duur, R2-sleutel, poster), of een eigen tabel? Welke bestaande queries, mutations en de integriteits-check moeten erop aangepast, en wat breekt er als een filmpje bij de formaat-stap of `hasFormats` terechtkomt?
9. **Cover.** Mag de poster van een filmpje album- of groepscover zijn? Voorstel regie: ja, de poster is een beeld als een ander.
10. **Backup en opruimen.** Hoe neemt de maandelijkse backup R2 mee (of R2 als eigen veilige plek met versies)? Hoe ruimt de integriteits-check weesbestanden op?
11. **R2-kosten en grenzen.** Bevestig de tarieven (opslag, operaties, gratis 10 GB, geen uitgaand verkeer) en de EU-locatie van de bucket.

A rapporteert ook wat hier ontbreekt of niet klopt. Oude code is hier geen bron: de oude app had geen filmpjes van leden.

## Risico-assessment

- **security/privacy: hoog.** Nieuwe opslag buiten Convex met eigen links; GPS in videometadata; toegang op poster en link; opruimen bij account verwijderen. Red-team op de upload- en afspeelpaden.
- **ops: hoog.** Grote uploads over mobiel internet; halve uploads en weesbestanden in R2; de backup ziet R2 nu niet (stil dataverlies). Integriteits-check en backup moeten R2 dekken.
- **external deps: medium.** Cloudflare R2 en het account; een native compressie-module (nieuwe dev-build nodig); `expo-video` op het web.
- **multi-user/concurrency: medium.** Opnieuw proberen, verwijderen tijdens uploaden, melden tijdens uploaden.
- **data/schema-evolutie: medium.** Nieuwe (optionele) velden of tabel; elke plek die nu van een beeld uitgaat moet met een filmpje om kunnen. Geen backfill verwacht.
- **ops-runbook-impact:** R2-account, bucket(s) per omgeving, sleutels als Convex env-vars (dev en prod), CORS op R2, backup van R2. Landen in [`external-services.md`](../conventions/external-services.md), [`infra/backup.md`](../../infra/backup.md) en een runbook voor het opzetten. B levert ze mee, audit toetst.
- **toegangsdefinitie:** WP37 voert de toegang tot een filmpje in. Noem alle plekken waar een video-id of R2-sleutel zichtbaar wordt en alle publieke paden die er een aannemen; inventaristest (conventie §Toegangsdefinities).

## Cross-refs

- WP18 (upload, reservering), WP25 (formaten), WP17a/b/c/d (album, acties, Mijn foto's, kaart), WP20 (melden), WP21 (clubfilms, `expo-video`, ondertekende links), WP29 (account verwijderen), WP10 (integriteits-check), WP35/WP36 (web), WP38 (route 2).

## Spec-criticus aanvullingen (A vult in)
