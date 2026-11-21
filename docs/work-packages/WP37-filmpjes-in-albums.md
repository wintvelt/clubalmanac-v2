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

> A 2026-11-21. Bronnen: deze spec, de huidige code (`photos`, `/upload`, beeldpaden, WP21-links, opruimen, WP10), `expo-image-picker` 58 in `app/node_modules`, de R2-documentatie, Wouters voorbeeld (gemeten, niet in de repo) en zelfgemaakte testfilmpjes (AVFoundation op de server, `tests/fixtures/wp37/`). Oude code is geen bron (de oude app had geen filmpjes van leden). Niets op een echte iPhone getest: wat alleen daar te zien is, staat bij de gate.

### Gemeten

- **Wouters voorbeeld** (`builds/video/daatfilmpje.mp4`): 72,8 s, 33,5 MB, gemiddeld 3,7 Mbit/s (beeld 3,5, geluid AAC 129 kbit/s), H.264 1080 × 1920 rechtop zonder draai-matrix, 30 fps, de index (`moov`) vooraan. **Geen datum en geen plaats**: de maaktijd is nul en de enige metadata is `©too = Lavf58.76.100`. Het bestand is dus met ffmpeg gemaakt, niet door een iPhone. De kwaliteit is een goed doel; over datum en GPS zegt het niets.
- **Testfilmpjes**: AVFoundation schrijft een locatie in een `.mp4` niet als tekst maar als een binair `loci`-blok (3GPP), en de datum als `udta/date`. In een `.mov` (zoals de iPhone opneemt) staat de locatie als `©xyz` én als `com.apple.quicktime.location.ISO6709` onder `meta/keys`. Een controle die alleen op de tekst `ISO6709` let, mist dus het `.mp4`-geval.

### Antwoorden op de open vragen

1. **Kiezen en metadata.** De picker geeft bij een video `uri`, `duration` (ms), `width`, `height`, `fileSize`, `assetId` en `type: "video"`, maar geen datum of plaats: `exif` geldt alleen voor foto's. Met de standaard export (`Passthrough`) krijgt de app het bestand zoals in Foto's; een iPhone-opname draagt dan zelf de maaktijd (`com.apple.quicktime.creationdate`, lokale tijd met tijdzone) en de plaats (ISO 6709). Lezen uit dat bestand, vóór het comprimeren, vraagt geen extra toestemming (besluit B2). Alternatief is `expo-media-library` (`getAssetInfoAsync` op `assetId`): dat vraagt "Toegang tot foto's" (volledig, of beperkt met dit filmpje erin) en is een extra native module. Of de picker de plaats meegeeft als de user in de kiezer locatie uitzet, en bij iCloud-filmpjes die nog niet op het toestel staan: gate.
2. **Comprimeren.** De export-presets van de picker en `AVAssetExportSession` regelen resolutie, niet de bitrate: 1080p H.264 komt dan uit op ~15–20 Mbit/s (3 minuten ruim 300 MB), en een export-sessie kopieert de metadata, met GPS. Twee bruikbare wegen: (a) `react-native-compressor` (config-plugin, `compressionMethod: "manual"`, `bitrate`, `maxSize: 1920`); werkt met AVFoundation, maar of het de index vooraan zet, de metadata weglaat en HDR goed omzet, is niet gedocumenteerd. (b) Een eigen kleine Expo-module in Swift (AVAssetReader → AVAssetWriter, H.264 3,5 Mbit/s + AAC 128 kbit/s, langste zijde 1920, hooguit 30 fps, `shouldOptimizeForNetworkUse`, geen metadata). Die module leest meteen ook datum en plaats uit het origineel en maakt de poster. Kosten: ~200 regels Swift in de repo, een nieuwe dev-build, en bij een Expo-upgrade nakijken (de module-API is stabiel). Duur: H.264 gaat op de iPhone in hardware; verwacht ~3–5 × sneller dan afspelen, dus 3 minuten in ~40–60 s. Gate meet het. **HDR**: iPhones nemen standaard op in HDR (HEVC, 10 bit, Dolby Vision). Naar H.264 (8 bit, SDR) moet het beeld worden omgezet naar BT.709, anders oogt het flets of te donker. Gate met een HDR-opname. Zie besluit B1.
3. **GPS eruit.** Een AVAssetWriter schrijft alleen metadata die je hem geeft; een export-sessie kopieert alles. Op de app vertrouwen is niet genoeg (invariant 2): de backend leest het begin van het bestand in R2 en weigert het als er een locatie in staat, in welke vorm ook (`loci`, `©xyz`, een `keys`-sleutel met "location", een metadata-spoor). Daarvoor moet de index vooraan staan (A-invariant 25). Tests: `tests/videos/mp4.test.ts` met de testfilmpjes en met met de hand gebouwde blokken.
4. **Poster.** Op het toestel, als JPEG zonder metadata, van het beeld na ~1 s (het eerste frame is vaak zwart of bewogen); bij een filmpje korter dan 1 s het eerste. De poster wordt het beeld van de rij (`storageId`): de bestaande formaat-stap maakt er *klein* en *groot* van, en alles wat nu een beeld van een foto toont (tegel, cover, kaart, meldwachtrij, Mijn foto's, mail-cover) werkt ongewijzigd. `expo-video-thumbnails` kan het; met keuze B1(b) doet de eigen module het.
5. **Uploaden naar R2.** Rechtstreeks met een ondertekende PUT, in drie stappen: (1) de app vraagt de backend een upload aan met upload-id, album, duur en grootte; de backend toetst, reserveert, kiest zelf een willekeurige sleutel en tekent een PUT voor alleen die sleutel, kort geldig; (2) de app PUT het bestand; (3) de app stuurt de poster met datum en plaats naar de backend, die het bestand in R2 controleert en pas dan de rij maakt. Dezelfde upload-id geeft dezelfde sleutel, dus opnieuw proberen overschrijft en maakt geen tweede bestand (invariant 4). 85 MB in één PUT is prima (R2 neemt tot 5 GB per PUT); in delen (multipart) en hervatten pas in WP38. Achtergrond: iOS pauzeert JavaScript, maar een upload via een achtergrond-URLSession (`expo-file-system`, sessietype *background*) loopt door met de app op de achtergrond of het scherm uit. Comprimeren kan alleen met de app open (scherm aan, zoals bij foto's). Zie B11. `@convex-dev/r2` is niet nodig: de backend heeft al een eigen SigV4-signer (WP21, `lib/s3Presign`); R2 spreekt dezelfde S3-taal (regio `auto`).
6. **Grenzen in de backend.** Grootte: bij de aanvraag (opgegeven grootte) en na de upload met een `HEAD` op het object. Duur, codec en GPS: de backend leest het begin van het bestand met een range-verzoek en ontleedt de index (`mvhd`, sporen, metadata). Dat kan alleen als de index vooraan staat; een bestand met de index achteraan weigert hij. Geweigerd na de upload = het object gaat weg, de reservering ook, geen rij.
7. **Afspelen.** Een ondertekende GET van **1 uur** (B5); elke aanvraag een verse. `expo-video` en de browser vragen het bestand in stukken (range); dat werkt met een ondertekende link. **CORS op R2 is voor afspelen niet nodig**: een `<video>`-element zonder `crossOrigin` laadt een andere host gewoon. Pas als de webapp ooit zelf naar R2 uploadt, of als `expo-video` op het web `crossOrigin` zet (gate), is een CORS-regel nodig. Cache: geen filmpje op schijf, zoals de clubfilms (A-invariant 23); de poster loopt via het beeldpad en de bestaande cache.
8. **Datamodel.** Dezelfde `photos`-rij, met een optioneel `video`-object (R2-sleutel, duur, grootte); `storageId` is de poster. Dan blijven albums, Mijn foto's, de kaart, melden, uit album, verwijderen, covers, de ongelezen-teller, de formaat-stap en `hasFormats` werken zonder aanpassing, want die gaan over de rij en zijn beeld. Aanpassen: de publieke vorm (alleen `video: { durationMs }`), `rotate`, `setProfilePhoto` en `updateProfile` (weigeren), het verwijderen (ook R2), `uploadIdempotency` (de sleutel van een lopende video-upload), WP10 plus een R2-check, en de opruimronde van reserveringen. Een eigen tabel zou elke query die een album leest laten samenvoegen en elke plek die een `photoId` aanneemt dubbel maken. Een filmpje in de formaat-stap is geen probleem: die werkt op de poster.
9. **Cover.** Ja: de poster is een beeld als een ander (eens met regie). Geen werk: covers lopen al via de rij en het beeldpad. Wel: een video-cover toont geen afspeelteken (het is een cover, geen tegel).
10. **Backup en opruimen.** R2 heeft geen versies zoals S3. Voorstel B10: de maandelijkse backup-workflow synchroniseert de bucket naar de bestaande backup-bucket (eigen prefix, met de versies en het halfjaar van die bucket), met een alleen-lezen R2-token als GitHub-secret. Kosten verwaarloosbaar (Glacier IR ~$0,004 per GB per maand; R2-lezen valt in het gratis deel). Opruimen: een dagelijkse R2-check (action, niet in de WP10-mutation, want die mag niet naar buiten) vergelijkt de lijst in R2 met de rijen en open reserveringen. Een object zonder rij en zonder open reservering, ouder dan een dag, is een wees; een rij zonder object is "bestand ontbreekt". Beide geeft één mail aan de webmaster. Weghalen gebeurt in de opruimronde van reserveringen (een video-reservering die een dag open staat: object en reservering weg) en bij verwijderen; de check zelf ruimt niet op (WP10-discipline: melden, niet herstellen).
11. **R2-kosten en EU.** Standaard-opslag $0,015 per GB per maand, schrijven $4,50 per miljoen (klasse A), lezen $0,36 per miljoen (klasse B), uitgaand verkeer gratis. Gratis per maand: 10 GB opslag, 1 miljoen klasse A, 10 miljoen klasse B. 10 GB is ~6 uur filmpje op 28 MB per minuut; bij 20 leden en een paar filmpjes per reis blijft het jaren gratis, en 100 GB kost ~$1,35 per maand. EU: een bucket met jurisdictie `eu` (bij het aanmaken kiezen, daarna niet te wijzigen) slaat de data gegarandeerd in de EU op; het S3-adres is dan `https://<account-id>.eu.r2.cloudflarestorage.com`. Een *location hint* (`weur`) is geen garantie. Of ondertekende links op het EU-adres zich hetzelfde gedragen: runbook-check op dev (de documentatie zegt er niets over).

### Wat in de draft niet klopt of ontbreekt

- **Het voorbeeld heeft geen datum of plaats** (zie Gemeten). De gate heeft een echte iPhone-opname nodig met locatie aan, een HDR-opname en een liggende opname.
- **Datum en plaats lezen uit het gecomprimeerde bestand kan niet**: dat bestand mag ze juist niet hebben. Ze komen uit het origineel, vóór het comprimeren.
- **De tijdzone van de datum.** Een foto heeft `takenAt` als de klokwaarde van de camera, gelezen als UTC (WP18 A-keuze 2). Een iPhone-filmpje heeft een tijd mét tijdzone. Zonder afspraak staat een zomerfilmpje twee uur verschoven tussen de foto's van dezelfde middag. A-invariant 14.
- **Invariant 7 en 2 hangen af van de index vooraan.** Zonder dat kan de backend het bestand niet bekijken zonder het helemaal te lezen. De app moet het zo schrijven (A-invariant 25).
- **De webmaster en een gemeld filmpje.** Het beeldpad laat de webmaster een gemelde foto zien (WP20 A-invariant 9). Zonder dezelfde uitzondering op de afspeellink kan hij een gemeld filmpje niet beoordelen. A-invariant 17.
- **"Als profielfoto" niet** moet in de backend, op twee paden: `users.setProfilePhoto` (foto-id) en `users.updateProfile` (beeld-id, dat ook de poster van een eigen filmpje aanneemt). Alleen de knop weglaten is een verbodslijst in de app.
- **Draaien niet** ook in de backend (`photos.rotate`): de poster zou anders anders staan dan het filmpje.
- **De limiet.** Telt een filmpje mee voor `photoLimit` (1000 per user)? Voorstel: ja, als één item (B7).
- **Mijn foto's** (WP17c) staat niet in de scope; de rij verschijnt daar vanzelf. Voorstel: ja, met dezelfde tegel (B8).
- **iPad.** "Uploaden alleen vanaf de iPhone" betekent in de praktijk: niet vanuit de webapp. De iPad draait dezelfde app; uitzetten kost juist werk (B9).
- **Kosten van misbruik.** Een ondertekende PUT zonder grootte in de handtekening laat tot 5 GB per link toe. De backend weegt het na de upload en gooit te grote objecten weg, en begrenst het aantal open video-uploads per user (A-invariant 20). Red-team.
- **Opnieuw proberen na een herstart van de app** krijgt een nieuwe upload-id (zoals bij foto's, WP18 besluit 3), dus een nieuwe sleutel. Het oude object is dan een wees tot de opruimronde (een dag). Invariant 4 houdt stand ("geen tweede bestand dat blijft staan").
- **Slow-motion, 60 fps, 4K**: omzetten naar hooguit 30 fps en langste zijde 1920. Slow-motion uit Foto's is een bewerkte compositie; wat de picker dan geeft: gate.
- **Delen** (invariant 9) betekent bij een filmpje het bestand uit R2 ophalen naar een tijdelijk bestand en het deelmenu openen; daarna weg. Dat bestand heeft geen GPS (invariant 2 dekt het).
- **Clubfilms naar R2** is niet "vrijwel gratis": de code is klein (dezelfde signer), maar 19 GB overzetten (één bestand van 5,8 GiB) is handwerk, en S3 kost nu niets (onder de 100 GB uitgaand). Niet in WP37 (B12).

### A-invarianten

11. **De backend kiest de sleutel.** Een sleutel in R2 is willekeurig, gekozen door de backend, en nooit van de app. Een ondertekende PUT geldt voor precies die sleutel, alleen met PUT, en hooguit een uur.
12. **Een filmpje bestaat pas als de backend het bekeken heeft.** De rij komt pas na de afronding, als het object in R2 staat, niet groter is dan de grens, mp4 is met H.264 (en AAC als er geluid is), niet langer duurt dan de grens, en geen locatie draagt. Anders gaan object en reservering weg en krijgt de app een reden.
13. **GPS-controle in de backend**, op elke vorm: `loci`, `©xyz`, een metadata-sleutel met "location", een metadata-spoor. Een filmpje met een metadata-spoor wordt geweigerd, ook als de inhoud onbekend is (toestemmingslijst, geen verbodslijst).
14. **Datum zoals bij foto's.** `takenAt` is de lokale kloktijd van de opname, gelezen als UTC, net als de EXIF-tijd van een foto. Geen datum in het origineel: geen `takenAt` (invariant 3), nooit "vandaag" en nooit de maaktijd van het gecomprimeerde bestand.
15. **De poster is het beeld van de rij.** Hij loopt door het beeldpad met dezelfde toegangsregel, krijgt *klein* en *groot*, en draagt geen metadata (de bestaande JPEG-opschoning).
16. **Geen profielfoto en niet draaien**, geweigerd in de backend: `setProfilePhoto` met een filmpje, `updateProfile` met de poster van een filmpje, `rotate` op een filmpje. De rij verandert dan niet.
17. **Afspelen = het beeld mogen zien.** Een afspeellink krijgt precies wie het beeld van die rij mag zien (`canSeePhotoImage`: eigenaar, lid van een groep met het filmpje in een album, en de webmaster bij een gemeld filmpje). Per verzoek opnieuw bepaald.
18. **Eén weigering** voor de afspeellink: niet ingelogd, account in verwijdering, onbekend id, een foto (geen filmpje) en geen toegang geven dezelfde fout.
19. **Geen sleutel in een antwoord.** De publieke vorm van een rij krijgt alleen `video: { durationMs }`; geen sleutel, geen grootte, geen bucket. De sleutel staat alleen in de ondertekende link zelf (zonder handtekening is hij waardeloos: de bucket is privé).
20. **Reservering per upload-id.** Een nieuwe aanvraag met dezelfde upload-id terwijl hij open staat: dezelfde sleutel, een verse link. Al afgerond: dezelfde rij terug (en in het gevraagde album, zoals WP18 A-invariant 24). Hooguit 3 open video-uploads per user. Een video-reservering blijft een dag open (een upload van 85 MB kan lang duren); daarna ruimt de dagelijkse ronde reservering en object op.
21. **Elk wis-pad haalt het object weg.** `photos.remove`, `photos.removeFlagged`, de opruimronde na 14 dagen en account verwijderen gaan allemaal via het wissen van de rij; dat plant het wissen in R2 (en van de poster en zijn formaten, zoals nu). Mislukt R2, dan ziet de R2-check het.
22. **Dagelijkse R2-check**: wees (object zonder rij en zonder open reservering, ouder dan een dag) en ontbrekend bestand (rij zonder object) geven één mail aan de webmaster, met aantallen en foto-id's, zonder link of geheim. Schoon: geen mail. De check wist niets.
23. **Geen filmpje op schijf.** De speler cachet niet; er is geen download, behalve het tijdelijke bestand voor delen.
24. **Config fail-loud, toegang eerst.** Ontbreekt een R2-env-var, dan een fout die begint met `R2_CONFIG_MISSING:` met alleen de namen. Wie geen toegang heeft, krijgt de gewone weigering, ook als de config ontbreekt. Het geheim staat nooit in een antwoord, fout of log.
25. **Index vooraan.** Een bestand waarvan de index niet in het begin staat, weigert de backend (hij kan het anders niet bekijken). De app schrijft hem vooraan.
26. **Toegangsdefinitie.** Een video-id is een foto-id: zichtbaar waar een foto-id nu zichtbaar is. Nieuwe publieke paden: `videos.startUpload` (neemt een album-id), `videos.playUrl` (neemt een foto-id) en `POST /upload/video` (neemt een upload-id). Elk heeft een gate; de inventaristest legt ze vast. Bestaande paden die een foto-id aannemen en anders moeten bij een filmpje: `rotate`, `setProfilePhoto`, `updateProfile` (beeld-id).
27. **Foto's blijven gelijk.** Een rij zonder `video` geeft exact de vorm van nu (geen `video`-veld, ook niet leeg).

### A-keuzes

- **Grens van de duur**: afgerond op hele seconden hooguit 3:00, dus tot 180,499 s. De tegel toont dezelfde afronding, zodat "3:00" nooit geweigerd wordt.
- **Grens van de grootte: 120 MiB.** Ruim boven 3 minuten op 4 Mbit/s (~93 MB), zodat een uitschieter van de encoder niet faalt, en ver onder wat een misbruiker zou willen.
- **Container**: mp4 (merk `mp42`, `isom`, `mp41`, `avc1`, `iso2`…), geen QuickTime (`qt  `): de webapp moet hem overal spelen.
- **Geen streaming-formaat**, één mp4 met de index vooraan: spoelen werkt met range-verzoeken.
- **Filter**: alleen zichtbaar in een album met minstens één filmpje (invariant 10).
- **Detail**: geen autoplay; tik op afspelen, geluid ook in de stille modus (zoals de clubfilms); weg-vegen stopt het filmpje.
- **Env-vars**: `R2_ENDPOINT` (`https://<account-id>.eu.r2.cloudflarestorage.com`), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`; per deployment een eigen bucket. Een R2-token met alleen *Object Read & Write* op die bucket.

### Besluiten voor Wouter

1. **Comprimeren: een eigen kleine module (Swift) of `react-native-compressor`?** Aanbevolen: **eigen module**. Die doet comprimeren, poster en datum en plaats uit het origineel in één, met volledige controle over bitrate, metadata en de index vooraan. `react-native-compressor` is sneller ingebouwd, maar wat hij met metadata, HDR en de index doet staat nergens; de backend vangt fouten wel, maar dan faalt de upload voor de user. Beide vragen een nieuwe dev-build en een nieuwe app-build.
2. **Datum en plaats uit het bestand zelf, zonder extra toestemming?** Aanbevolen: **ja**; pas als de gate laat zien dat de picker ze weglaat, `expo-media-library` erbij (vraagt toegang tot Foto's).
3. **De backend bekijkt elk bestand in R2** (grootte, duur, codec, GPS) voordat het in het album komt? Aanbevolen: **ja** (dekt invariant 2 en 7 zonder op de app te vertrouwen; kost per upload een paar kleine leesverzoeken).
4. **Grenzen**: 3:00 (afgerond), 120 MiB, hooguit 3 open uploads per persoon. Aanbevolen: **ja**.
5. **Afspeellink 1 uur** (een filmpje duurt hooguit 3 minuten; bij een fout haalt de app een verse). Aanbevolen: **ja**.
6. **Cover ja, profielfoto nee.** Aanbevolen: **ja** (zoals regie voorstelde).
7. **Telt een filmpje mee voor de limiet van 1000?** Aanbevolen: **ja, als één**.
8. **Filmpjes ook in Mijn foto's**, met dezelfde tegel. Aanbevolen: **ja**.
9. **Uploaden ook vanaf de iPad-app** (zelfde app), niet vanuit de webapp. Aanbevolen: **ja**.
10. **R2 in de maandelijkse backup**, naar de bestaande backup-bucket. Aanbevolen: **ja** (kost bijna niets; anders is een gewist of kapot object weg).
11. **Uploaden gaat door op de achtergrond** (app weg of scherm uit); comprimeren alleen met de app open en het scherm aan. Aanbevolen: **ja**.
12. **Clubfilms naar R2 in WP37?** Aanbevolen: **nee**, apart (handwerk voor 19 GB, en S3 kost nu niets).
13. **Cloudflare-account**: Wouter maakt het aan, met twee buckets met jurisdictie EU (`clubalmanac-videos-dev`, `clubalmanac-videos-prod`) en per bucket een token. B levert het runbook in `external-services.md`.

### Testcontract (A, vóór de besluiten)

> A 2026-11-21. De RED tests volgen de aanbevelingen hierboven. Wijkt een besluit af, dan past A de tests aan vóór B begint. Namen en vormen zijn A-keuzes; het hoe is aan B.

- **Schema.** `photos.video?: { key: string, durationMs: number, bytes: number }`; `storageId` is de poster. `uploadIdempotency.videoKey?: string` voor een video-upload.
- **Bestand bekijken** (`convex/lib/mp4.ts`, puur): `inspectMp4(bytes)` geeft `{ brand, durationMs, video: { codec, width, height } | null, audio: { codec } | null, hasLocation }`, of `null` als het geen ISO-BMFF is of de index niet in deze bytes staat. `videoProblem(info, sizeBytes)` geeft `null` of één reden: `"geen_mp4" | "index_achteraan" | "te_lang" | "te_groot" | "codec" | "locatie"`. `MAX_VIDEO_MS = 180_000`, `MAX_VIDEO_BYTES = 120 MiB`, `MAX_OPEN_VIDEO_UPLOADS = 3` in `convex/lib/constants.ts`.
- **`api.videos.startUpload({ uploadId, albumId, durationMs, bytes })`** (action): `{ kind: "upload", url, expiresAt }` (een ondertekende PUT op `<R2_ENDPOINT>/<R2_BUCKET>/<sleutel>`, regio `auto`, hooguit 3600 s) of `{ kind: "done", photoId }` (al afgerond). Weigering: `ConvexError({ code: "VIDEO_UPLOAD_REFUSED", reason })` met `reason` uit `"uitgelogd" | "geen_album" | "limiet" | "te_lang" | "te_groot" | "bezig"`.
- **`POST /upload/video`** (httpAction, CORS zoals `/upload`): body de poster (JPEG), headers `X-Upload-Id`, `X-Taken-At`, `X-Latitude`, `X-Longitude` (zoals `/upload`). Antwoorden: 200 `{ photoId }` (ook bij herhaling), 400 zonder upload-id, 401, 403 limiet, 404 geen open video-upload van deze user (of het album is niet meer toegankelijk), 409 `{ reason: "niet_binnen" }` als het object er (nog) niet staat, 413 te groot, 415 poster geen JPEG, 422 `{ reason }` met een reden uit `videoProblem`. Bij 413 en 422 zijn object en reservering weg.
- **`api.videos.playUrl({ photoId })`** (action): `{ url, expiresAt }`, een ondertekende GET op precies de sleutel, 3600 s. Weigering `ConvexError({ code: "VIDEO_NOT_FOUND" })`.
- **Wissen**: elk wis-pad leidt tot een `DELETE` op de sleutel in R2.
- **`internal.videos.checkStorage({})`** (action), cron `"video storage check"` dagelijks 05:15 UTC; de opruimronde (`internal.uploads.cleanupOld`) haalt video-reserveringen ouder dan een dag weg, met hun object.
- **App** (`app/src/lib/videos.ts`, puur): `formatDuration`, `videoTooLong`, `showMediaFilter`, `filterEntries`, `takenAtFromQuickTime`, `locationFromISO6709`, `videoFailMessage`, `videoRetryable`, `VIDEO_TARGET`.

### Tests per invariant (stand na A)

| Inv. | Test | Niet getest, omdat … |
|---|---|---|
| 1 | `tests/videos/upload.test.ts` (album van een andere groep, niet ingelogd), `play.test.ts` (wie mag afspelen) | |
| 2, 13 | `mp4.test.ts` (`loci`, `©xyz`, `keys`, metadata-spoor), `upload.test.ts` (422 `locatie`, object weg) | dat de compressie op het toestel schoon schrijft: gate (de backend vangt het) |
| 3, 14 | `upload.test.ts` (datum en plaats uit de headers; zonder datum geen `takenAt`), `photoRules.test.ts` (kaart), `app/tests/videos.test.ts` (`takenAtFromQuickTime`, `locationFromISO6709`) | of de picker datum en plaats meegeeft: gate |
| 4, 20 | `upload.test.ts` (zelfde upload-id: zelfde sleutel; afgerond: zelfde rij; 3 open) | |
| 5 | `upload.test.ts` (elke weigering met reden, niets achter), `storageCheck.test.ts`, `app/tests/videos.test.ts` (NL-melding, opnieuw proberen) | de melding op het scherm: gate |
| 6, 21 | `cascade.test.ts` (verwijderen, webmaster, na 14 dagen, account verwijderen: `DELETE` in R2) | |
| 7 | `upload.test.ts` (te lang, te groot bij aanvraag en na de upload), `mp4.test.ts` | |
| 8 | | afspelen op iPhone, iPad en in de browsers: gate |
| 9, 16 | `photoRules.test.ts` (draaien, profielfoto op twee paden geweigerd; cover en melden wel) | |
| 10, 27 | `photoRules.test.ts` (een foto heeft geen `video`-veld), de hele suite | |
| 11 | `upload.test.ts` (sleutel niet uit het verzoek, PUT op precies die sleutel, ≤ 3600 s, handtekening klopt) | |
| 12 | `upload.test.ts` (geen rij vóór de afronding; 409 zonder object) | |
| 15 | `photoRules.test.ts` (beeldpad geeft de poster) | |
| 17, 18 | `play.test.ts` | |
| 19 | `photoRules.test.ts` (vorm van `getById`, `listPhotos`, `listMine`) | |
| 22 | `storageCheck.test.ts` | |
| 23 | | speler zonder cache: gate en B's app-test |
| 24 | `play.test.ts`, `upload.test.ts` (config ontbreekt) | |
| 25 | `mp4.test.ts` (`index_achteraan`), `upload.test.ts` | |
| 26 | `tests/videos/inventory.test.ts` | |
