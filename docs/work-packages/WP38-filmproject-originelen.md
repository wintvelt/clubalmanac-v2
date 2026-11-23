# WP38: filmproject, originelen voor de clubfilm

> Regie 2026-11-21, herzien 2026-11-22 na de besluiten van Wouter. Bouwt voort op [WP37](./WP37-filmpjes-in-albums.md) (R2, poster, upload naar R2), [WP39](./WP39-toevoegscherm.md) (toevoegscherm) en [WP40](./WP40-selectiebalk.md) (selectiebalk). A → besluiten Wouter → B → audit → red-team → gate op een echte iPhone met een origineel in 4K. Eigen branch `wp38`.

## Productdoel

Na een reis wil Wouter een nieuwe clubfilm monteren uit de filmpjes van de leden, in volle kwaliteit. Een lid denkt niet "casual of clubfilm", maar "ik heb een filmpje om te delen". Daarom kiest het lid niets: zolang de oprichter een filmproject heeft openstaan, gaat elk nieuw filmpje in die groep naar het filmalbum (verkleind, zoals in WP37, voor iedereen te bekijken) en gaat het origineel ook naar de inbox van het project. Wouter downloadt de originelen in de webapp, met datum en plaats erin, en ruimt ze op als de film klaar is; na een jaar gaan ze sowieso weg.

## Besluiten (Wouter, 2026-11-21 en 2026-11-22)

1. **Filmproject per groep, alleen de oprichter** zet het open en dicht. Bij het openen kiest hij een album van de groep (het filmalbum) en een einddatum. Hooguit één open project per groep.
2. **Zolang het project open staat, gaat elk nieuw filmpje in die groep naar het filmalbum.** Het origineel gaat mee naar de inbox. Foto's gaan gewoon naar het album dat het lid kiest. Elk lid dat filmpjes mag toevoegen (dat is elk lid, WP28) draagt dus bij. Ledenrechten blijven zoals ze zijn.
3. **Kiezen in het toevoegscherm** (lid kiest eerst foto's en filmpjes, dan een album; X = filmalbum, Y = ander album van dezelfde groep):

   | Keuze | Album | Gedrag |
   |---|---|---|
   | alleen foto's | elk album | zoals nu |
   | alleen filmpjes | X | alles naar X |
   | alleen filmpjes | Y | Y niet te kiezen (grijs, met uitleg "Filmpjes gaan nu naar [X]"); X staat gekozen |
   | foto's en filmpjes | X | alles naar X |
   | foto's en filmpjes | Y | **splitsen**: foto's naar Y, filmpjes naar X; boven de knop "2 filmpjes gaan naar [X]"; de melding na afloop noemt beide albums |
   | alles | album van een andere groep | zoals nu (tenzij daar ook een project open staat) |
   | alles | nog geen album | knop grijs, zoals nu |

   De + in album Y werkt als "Y gekozen".
4. **Bestaande filmpjes** (van vóór het project, of al in een album) tellen niet mee: geen knop "Insturen". "Naar album" met een bestaand filmpje naar Y mag gewoon; het is geen inzending en gaat niet naar de inbox. "Uit album" op een filmpje in X haalt het alleen uit het album, niet uit de inbox.
5. **Terugtrekken achteraf.** Er is geen schakelaar om een filmpje uit te sluiten. Een inzender trekt een eigen origineel terug op de projectpagina; het filmpje blijft in het album.
6. **Wifi: het lid kiest.** Een schakelaar "Alleen via wifi", standaard aan.
7. **Leden zien alleen de poster** van een origineel, geen afspelen.
8. **Downloaden alleen in de webapp, door de oprichter.** Niet op de telefoon.
9. **Bewaren tot de oprichter ze verwijdert, hooguit een jaar.**
10. **GPS blijft in het origineel.** Bewuste uitzondering op WP17d: alleen de downloader krijgt het bestand. De poster bevat geen GPS.

## UI (Wouter, 2026-11-22)

- **Openzetten en sluiten (oprichter):** in de groep "Filmproject starten": album kiezen, einddatum. Sluiten op de projectpagina.
- **Banner in de groep**, kort: "Filmproject [albumnaam] open tot [datum]". Tik opent de projectpagina.
- **Projectpagina** (alle leden): per inzending poster, lengte, inzender, datum van inzending (en opnamedatum als het origineel die heeft). Eigen inzendingen met stand: wacht op wifi, wordt verstuurd, binnen. Terugtrekken van eigen inzendingen. Voor de oprichter: sluiten.
- **Toevoegscherm:** een korte regel dat filmpjes in volle kwaliteit, met plek, naar de clubfilm gaan; het gedrag uit besluit 3.
- **Downloadpagina in de webapp** (oprichter): lijst met download per filmpje, waar het kan "alles downloaden"; alles verwijderen als de film klaar is.
- **Na sluiten:** de projectpagina blijft zichtbaar tot de originelen weg zijn (hooguit een jaar). Filmpjes gaan weer naar het gekozen album.

## Wat er is

- R2 met ondertekende links, poster op het toestel, upload naar R2 met reservering, opruimen en integriteits-check voor filmpjes (WP37). Verkleinen op de iPhone naar 1080p; grens 3 minuten.
- Toevoegscherm met albumkiezer en laatst gekozen album (WP39); selectiebalk met "Naar album" en "Uit album" (WP40).
- Rollen per groep: oprichter (`groups.createdBy`), admin, lid (WP28). Op prod is bijna iedereen admin; de oprichter is overal Wouter.

## Invarianten

1. **Toegang zit in de backend.** Project openen en sluiten: alleen de oprichter. Een origineel insturen kan alleen mét een nieuw filmpje in die groep terwijl het project open staat. Posters en de lijst: alleen leden van de groep. Downloaden: alleen de oprichter, alleen via de webapp. Geen link naar een origineel voor wie niet mag downloaden, ook niet via een poster- of afspeelpad.
2. **De albumregel zit ook in de backend.** Een nieuw filmpje in een groep met een open project komt in het filmalbum terecht, ook als een oude app of een andere client iets anders vraagt (of wordt geweigerd: A kiest en motiveert, met de oude app 2.0.x in gedachten).
3. **Een origineel is nergens anders zichtbaar**: niet in albums, Mijn foto's, de kaart of als afspeelbaar bestand, behalve de poster op de projectpagina en de download voor de oprichter.
4. **Het origineel blijft onaangetast**: zelfde bestand als op de iPhone (geen compressie, metadata met GPS intact).
5. **Grote bestanden komen heel aan of niet.** Een upload van 1 GB of meer die stopt, gaat verder of begint opnieuw; geen half bestand dat als klaar telt. Geen dubbele originelen bij opnieuw proberen. Het filmpje in het album hangt niet op het origineel: de verkleinde versie staat er meteen.
6. **Weg na een jaar, ook in R2.** Ook bij terugtrekken, project verwijderen, groep verwijderen en account verwijderen.
7. **Kosten blijven binnen budget** (≤ €15 per maand voor alles samen): grens per bestand of per project als dat nodig is.

## Scope

- **In:** project openen en sluiten; banner; projectpagina; toevoegscherm volgens besluit 3; originelen uploaden vanaf de iPhone (in delen, hervatten, wifi-keuze, bij voorkeur op de achtergrond); terugtrekken; downloadpagina in de webapp; verwijderen en de grens van een jaar; integriteits-check en kosten.
- **Bewust niet:** afspelen van originelen; monteren in de app; bestaande filmpjes insturen; downloaden op de telefoon; uploaden van originelen vanuit de webapp; originelen in de maandelijkse backup (open vraag 7).

## Open vragen voor A (rapporteren aan regie)

1. **Uploaden van grote bestanden.** Multipart naar R2 met ondertekende delen; hervatten na een onderbreking; op de achtergrond doorgaan (iOS background-sessie) of alleen met de app open; hoe werkt "Alleen via wifi"? Wat als het project sluit terwijl er nog originelen onderweg zijn?
2. **Het origineel uit de kiezer.** Geeft de picker (WP39: `preferredAssetRepresentationMode` current, `videoExportPreset` passthrough) het echte origineel (HEVC, 4K, met metadata) zonder omzetten, ook bij iCloud-items? Hoe bewaren we het tot het verstuurd is, als de app intussen sluit?
3. **Grenzen en kosten.** Geldt de grens van 3 minuten ook voor een filmpje dat insturen? Grootte per bestand, totaal per project; opslag 50–100 GB een jaar lang; R2-tarieven bevestigen.
4. **Oude apps.** Wat doet app 2.0.x (zonder WP38) als iemand tijdens een project een filmpje toevoegt aan Y (zie invariant 2)?
5. **Vertrek en account verwijderen.** Gaan de originelen van een vertrekkend lid weg, of blijven ze tot het project weg is?
6. **Einddatum.** Sluit het project vanzelf op de einddatum, of is het alleen een aankondiging?
7. **Backup.** Originelen bewust niet in de backup (ze staan ook nog op de telefoons)? Wouter beslist.
8. **Herinnering** vóór de grens van een jaar, of stil verwijderen?

## Risico-assessment

- **security/privacy: hoog.** Originelen met GPS; strikte toegang op downloaden; uitzondering op WP17d; elk lid stuurt in.
- **ops: hoog.** Uploads van gigabytes over mobiel en wifi; halve multipart-uploads in R2 (kosten, wezen); automatisch verwijderen na een jaar.
- **external deps: medium.** R2 multipart; achtergrond-upload op iOS.
- **multi-user/concurrency: medium.** Meerdere leden tegelijk; project sluiten tijdens uploads; filmalbum verwijderen tijdens een project.
- **data/schema-evolutie: medium.** Nieuwe tabellen (project, inzending); geen wijziging aan bestaande rijen.
- **backward compat: medium.** Oude apps kennen de albumregel niet (open vraag 4).
- **ops-runbook-impact:** levenscyclusregels in R2 (halve multipart-uploads, een jaar), eventueel een aparte bucket; runbook voor downloaden. B levert ze mee, audit toetst.
- **toegangsdefinitie:** nieuwe toegang tot originelen, posters en projectbeheer; inventaristest.

## Cross-refs

- WP37 (R2, verkleinen), WP39 (toevoegscherm), WP40 (selectiebalk), WP28 (rollen, oprichter), WP21 (tab Films), WP17d (GPS-regel), WP29 (account verwijderen).

## Spec-criticus aanvullingen (A vult in)

> A 2026-11-22. Bronnen: deze spec, de oude repos (`~/Code/v1`), de huidige code (`convex/videos.ts`, `lib/r2.ts`, `uploads.ts`, `groups.ts`, `albums.ts`, `photos.ts`, `accountDeletion.ts`, `crons.ts`, `.github/workflows/backup.yml`; in de app `videoUpload.ts`, `AddPhotosScreen.tsx`, de module `clubalmanac-video`, `expo-file-system` 58.0.14 en `expo-image-picker` 58 in `node_modules`), WP37, WP39, WP40 en WP28. Niets op een iPhone of tegen echte R2 getest: dat staat bij de gate-checks.

### Pariteit met de oude app

Bestond niet in v1. De oude backend en de oude app kennen geen filmpjes van leden, geen originelen en geen inzendingen (gezocht op video, film, multipart, original: alleen EXIF-datum van foto's en een mailstijl). Oude code is hier dus geen bron; dit WP is nieuw gedrag.

### Wat de huidige v2-code doet (en wat WP38 raakt)

- **Filmpje toevoegen (WP37)**: `videos.startUpload` (album, duur, grootte) reserveert per upload-id, met het album in de reservering; `POST /upload/video` maakt de rij en zet hem in dat album. Het album wordt bij `startUpload` gekozen en ligt daarna vast. De albumregel van WP38 hoort dus in `startUpload` (en in wat daar het album bepaalt), niet in de app. De tests van WP37 pinnen het antwoord van `startUpload` exact (`{ kind: "done", photoId }`); een extra veld in dat antwoord breekt ze. De app weet het filmalbum zelf al (uit de projectlijst), dus dat is ook niet nodig.
- **Upload naar R2 (WP37)**: één PUT, met `expo-file-system/legacy` in een achtergrond-sessie. Die sessie krijgt per taak een willekeurige naam (`NetworkingHelpers.swift`: `background(withIdentifier: UUID().uuidString)`), heeft geen instelling voor mobiel internet en uploadt alleen een heel bestand. Na een herstart of een geforceerd sluiten vindt de app de taak dus niet terug, en "Alleen via wifi" kan er niet mee. Voor originelen is een eigen uploader in de module `clubalmanac-video` nodig (antwoord 1).
- **Kiezer (WP39)**: `preferredAssetRepresentationMode: Current` en `videoExportPreset: Passthrough` staan expliciet in `AddPhotosScreen.tsx`. De kiezer kopieert het origineel naar de cache van de app; het scherm wist die kopieën (`dropCopies`, en bij sluiten). Een origineel dat nog moet, mag daar niet onder vallen (A-invariant 20).
- **Selectiebalk (WP40)**: "Naar album" is `albums.addPhoto` (eigenaar), "Uit album" `albums.removePhoto` (toevoeger of admin). Beide raken alleen `albumPhotos`. Besluit 4 vraagt daar geen wijziging: "Naar album" naar Y blijft mogen en is geen inzending.
- **Rollen (WP28)**: de oprichter is `groups.createdBy`, met `requireFounder`. Hij kan overdragen (`transferFounder`); verwijdert hij zijn account, dan wordt de eerste admin oprichter (M2-d). Albums verwijderen mag alleen de oprichter. Een lid dat vertrekt of verwijderd wordt, verliest zijn foto's in de albums van die groep (M1).
- **Opruimen en bewaken (WP37)**: elk wis-pad van een rij gaat via `internalRemovePhoto`, dat ook R2 wist. De dagelijkse R2-check (`videos.checkStorage`) lijst de hele bucket en meldt wat geen rij heeft. De maandelijkse backup kopieert de bucket `R2_BACKUP_BUCKET` met `rclone sync` naar S3, behalve `uploads/**`, en de backup-bucket bewaart versies een half jaar.

### Antwoorden op de open vragen

1. **Uploaden van grote bestanden.**
   - *In delen.* R2 kent multipart zoals S3 (aanmaken, delen, afronden, afbreken, lijst van delen). Delen zijn 5 MiB tot 5 GiB, hooguit 10.000, en bij R2 moeten **alle delen even groot zijn behalve het laatste**. Voorstel: delen van 32 MiB (een origineel van 1,5 GB is 45 delen). De backend maakt de upload aan, kiest de sleutel en tekent per deel een PUT met het deelnummer, de upload-id en de grootte van dat deel in de handtekening (zoals WP37 A-invariant 11).
   - *Hervatten.* De backend is de bron van wat er al is: hij vraagt R2 welke delen binnen zijn (ListParts) en geeft alleen links voor de rest. De app hoeft geen ETags te bewaren of door te geven, en een client kan geen deel van een ander aanwijzen. Afronden doet de backend met de lijst van R2.
   - *Op de achtergrond.* Ja, met een eigen uploader in `clubalmanac-video`: een achtergrond-URLSession met een **vaste naam** (zodat iOS de app na een herstart of op de achtergrond weer koppelt), één taak per deel uit een eigen deelbestand (een achtergrond-taak uploadt alleen een heel bestand). Om niet het dubbele aan schijf te gebruiken, snijdt de module een paar delen tegelijk en het volgende pas als er een klaar is; dat gaat ook op de achtergrond, in de terugroep van de sessie. Een taak die iOS op de achtergrond krijgt, plant het zelf (vaak op wifi en aan de lader): dat is in orde voor een nacht in het hotel. Met de app open gaat het meteen. Een user die de app wegveegt, stopt de taken (iOS-regel); bij de volgende start gaat het verder met de delen die nog niet binnen zijn.
   - *Links.* Een deel-link geldt 7 dagen (het maximum van SigV4 en R2): een taak die iOS pas uren later start, moet nog een geldige link hebben. Het risico is klein: de link schrijft alleen precies dat deel, met precies die grootte, van een upload die na afronden of afbreken niet meer bestaat. Bij een verlopen link (403) haalt de app bij de volgende start verse.
   - *Afronden zonder de app.* De backend rondt elk uur zelf af wat helemaal binnen is (A-invariant 9). Anders staat een origineel dat 's nachts op de achtergrond binnenkwam op "onderweg" tot het lid de app weer opent.
   - *"Alleen via wifi".* Een sessie met `allowsCellularAccess = false` en `allowsExpensiveNetworkAccess = false` (dan telt ook een persoonlijke hotspot niet als wifi), en een tweede sessie zonder die grenzen. Zet het lid de schakelaar om, dan gaan de wachtende delen naar de andere sessie. De schakelaar geldt per toestel, voor alle originelen, en staat in het toevoegscherm en op de projectpagina. Op de achtergrond wacht iOS zelf tot er wifi is.
   - *Project sluit terwijl er originelen onderweg zijn.* Nieuwe inzendingen kunnen dan niet meer; wat al aangemeld is, mag nog binnenkomen (besluit 18 voor Wouter: hoe lang).
2. **Het origineel uit de kiezer.** Met Current en Passthrough geeft `expo-image-picker` 58 de bestandsvorm van het item zoals het in Foto's staat, zonder omzetten: bij een iPhone-opname de `.MOV` in HEVC, 4K, met datum en plaats. WP37 zag dat al (gate: datum en plaats kwamen binnen, en het origineel op de server had `location.ISO6709` en `creationdate`). Een item in iCloud haalt de kiezer eerst helemaal op ("Je keuze ophalen…", WP39). Open voor de gate: of het bestand bit voor bit gelijk is aan het origineel (SHA-256 naast een AirDrop met "Alle fotogegevens"), en wat de kiezer geeft bij een filmpje dat in Foto's is bewerkt of ingekort (vermoedelijk de bewerkte versie), bij slow-motion en bij Cinematic. *Bewaren tot het verstuurd is*: de app verplaatst de kopie van de kiezer meteen na "Toevoegen" naar een eigen map (Application Support, buiten de iCloud-backup van het toestel). Verplaatsen is hernoemen op dezelfde schijf: direct en zonder extra ruimte. Het verkleinen voor het album leest daarna die verplaatste kopie. Het bestand gaat pas weg als het origineel binnen is, teruggetrokken of geweigerd, of als het project het niet meer aanneemt.
3. **Grenzen en kosten.**
   - *3 minuten*: ja, vanzelf. Een origineel gaat alleen mee met een nieuw filmpje in het album (invariant 1), en dat filmpje mag hooguit 3 minuten zijn (WP37). Een eigen duurgrens voor het origineel is dus niet nodig, en de backend hoeft het origineel niet te ontleden.
   - *Grootte*: 3 minuten 4K 60 fps HEVC is ~1,2 GB, met HDR iets meer. Gemeten in WP37: 4K 24 fps HDR is ~235 MB per minuut. ProRes is ~6 GB per minuut, dus 3 minuten ~18 GB. Voorstel: **hooguit 2 GiB per origineel** (dekt elke HEVC-opname van 3 minuten; ProRes niet: dan komt het filmpje wel in het album, maar het origineel niet, met een melding), **hooguit 200 GiB per project** en **400 GiB voor alle projecten samen**.
   - *R2-tarieven* (Standard, november 2026, nog te bevestigen in het dashboard): opslag $0,015 per GB per maand, schrijven (klasse A) $4,50 per miljoen, lezen (klasse B) $0,36 per miljoen, uitgaand verkeer gratis. Gratis per maand: 10 GB opslag, 1 miljoen klasse A, 10 miljoen klasse B. Elk deel, aanmaken, afronden en een lijst van delen is klasse A. Downloaden kost alleen een paar klasse B.
   - *Kosten*: 100 GB een jaar lang is ~$1,35–1,50 per maand. Twee reizen per jaar die elkaar overlappen: ~$3. Het plafond van 400 GiB kost hooguit ~$6 per maand, ruim binnen €15. Operaties vallen in het gratis deel: 100 GB in delen van 32 MiB is ~3.200 schrijfacties, plus een lijst van delen per open inzending per uur. *Infrequent Access* (opslag $0,01, ophalen $0,01 per GB, minimaal 30 dagen) scheelt een derde, maar valt buiten het gratis deel en maakt de opzet ingewikkelder. Niet doen.
4. **Oude apps.** App 2.0.0 en 2.0.1 kunnen geen filmpjes toevoegen. App 2.0.2 (WP37, WP39) vraagt `startUpload` met album Y. **Voorstel: omleiden, niet weigeren** (A-invariant 2). Het filmpje komt dan in X. De oude app meldt "toegevoegd aan Y", maar het filmpje staat voor iedereen zichtbaar in X. Het origineel stuurt de oude app niet mee: dat filmpje heeft geen inzending. Weigeren zou in 2.0.2 een onbegrijpelijke fout geven ("Album niet gevonden" of "Er ging iets mis") en het filmpje helemaal tegenhouden. De What's New van de nieuwe versie en een bericht aan de leden vragen om bij te werken.
5. **Vertrek en account verwijderen.** *Account verwijderen*: zijn originelen gaan weg, ook in R2 (invariant 6, WP29: weg is weg). *Vertrekken of verwijderd worden uit de groep*: voorstel ook weg, net zoals zijn filmpjes uit de albums van die groep gaan (M1) en omdat er GPS in staat. Besluit 12 voor Wouter.
6. **Einddatum.** Voorstel: het project **sluit vanzelf** aan het eind van de einddatum (23:59 in Nederland). De oprichter kan eerder sluiten en zolang het open staat de einddatum verschuiven. De einddatum ligt in de toekomst en hooguit een jaar vooruit. Besluit 13.
7. **Backup.** Voorstel: **niet in de backup**. Ze staan ook nog op de telefoons. De backup-bucket bewaart versies een half jaar, dus een teruggetrokken of verlopen origineel (met GPS) bleef daar anders nog maanden staan, en dat botst met invariant 6. Dat lukt het eenvoudigst met een **eigen bucket** voor originelen (A-keuze), die de backup-stap niet kent. Besluit 14.
8. **Herinnering.** Voorstel: één mail aan de oprichter, 30 dagen voordat de eerste originelen van een project weggaan, met het project, het aantal en de datum. Geen mail aan de leden. Besluit 15.

### Wat in de draft niet klopt of ontbreekt

- **"Alleen via de webapp" is geen regel die de backend kan afdwingen.** De app en de webapp gebruiken dezelfde login; een Origin-header kan elke client zelf zetten. De dreiging is ook niet de oprichter zelf. Voorstel: invariant 1 wordt "downloaden: alleen de oprichter (backend)"; "alleen in de webapp" is een UI-regel (de app heeft geen downloadknop).
- **Het filmpje in het album verwijderen** (de eigenaar, de webmaster na een melding, de opruimronde na 14 dagen). Besluit 4 regelt "Uit album", niet "Verwijderen". Voorstel: verwijderen haalt ook het origineel weg (weg is weg; een gemeld en verwijderd filmpje hoort ook niet in de clubfilm). De bevestiging zegt dat als er een origineel is. Besluit 16.
- **Het filmalbum verwijderen tijdens een open project.** Dat kan nu (`albums.remove`, de oprichter). Daarna komen nieuwe filmpjes nergens terecht. Voorstel: weigeren zolang het project open staat ("Sluit eerst het filmproject"). Besluit 17.
- **Andere oprichter.** De rechten volgen `groups.createdBy` op het moment van het verzoek. Na overdragen (of na M2-d bij account verwijderen) downloadt de nieuwe oprichter de originelen van de leden, met GPS. Dat is consequent; Wouter moet het wel weten.
- **"Elk nieuw filmpje stuurt mee in" geldt per app, niet in de backend.** De backend kan een origineel niet zelf ophalen. Hij dwingt af dat een inzending alleen kan bij een nieuw filmpje in het filmalbum (invariant 1) en dat het filmpje in het filmalbum komt (invariant 2). Of het origineel ook komt, hangt af van de app (en de oude app stuurt het niet, antwoord 4).
- **De poster op de projectpagina.** Leden zien een inzending ook als het filmpje uit het filmalbum is gehaald (besluit 4). Het beeldpad van foto's laat dan geen lid meer toe. Een inzending heeft dus een eigen beeldpad, met als regel "lid van de groep van het project". Hetzelfde beeld als de poster van het filmpje, zonder GPS (WP37 A-invariant 15). Geen afspeellink.
- **Wat de projectpagina toont van anderen.** Voorstel: de inzendingen van anderen pas als ze binnen zijn. Eigen inzendingen altijd, met hun stand. De oprichter ziet daarnaast hoeveel er nog onderweg zijn.
- **Hooguit een jaar vanaf wanneer?** Per origineel, een jaar na binnenkomst (zoals een lifecycle-regel in R2 telt). De downloadpagina toont per origineel de datum waarop het weggaat.
- **Daggrenzen.** Een inzending hoort bij een nieuw filmpje, en filmpjes hebben al een grens van 30 per dag (WP37 A-invariant 36). Een eigen daggrens voor originelen is dus niet nodig. Originelen tellen niet mee voor de limiet van 1000 foto's: ze zijn geen foto.
- **Schijf van de telefoon.** Wachtende originelen staan op het toestel tot ze binnen zijn; met "Alleen via wifi" kan dat dagen gelden. De projectpagina toont per eigen inzending de grootte. Bij te weinig vrije ruimte meldt het toevoegscherm dat het origineel niet mee kan (het filmpje voor het album gaat gewoon).
- **De ronde in het toevoegscherm** is klaar als het filmpje in het album staat. Het origineel loopt daarna door, ook als het scherm dicht is; de stand staat op de projectpagina.
- **WP10.** De nieuwe tabellen wijzen naar groepen, albums, foto's en users. De integriteits-check krijgt dezelfde controle op losse verwijzingen als de andere tabellen (regie: ja, in `MONITORED_FKS`). Het filmalbum mag na sluiten weg (besluit 17); dan wijst het project nergens meer naar (`albumId` leeg) en houdt het de naam. De migratie-tooling vult deze tabellen niet, maar telt en leegt ze wel (zoals `uploadIdempotency`).

### A-invarianten

1. **Project openen, sluiten en de einddatum verschuiven: alleen de oprichter**, op het moment van het verzoek (`groups.createdBy`). Een admin of lid krijgt `NOT_ALLOWED`; geen lid, een onbekende groep of een onbekend project `NOT_MEMBER`, net als bij de beheerpaden van WP28. Het filmalbum hoort bij de groep (anders `NOT_MEMBER`). De einddatum ligt in de toekomst en hooguit een jaar vooruit (anders `DATE_INVALID`). Staat er al een open project in de groep, dan `PROJECT_ALREADY_OPEN`. Sluiten van een gesloten project verandert niets. Na sluiten kan een nieuw project open. Het project **sluit vanzelf** op de einddatum (besluit 13): daarna is het dicht, ook als de geplande stap nog niet liep. **Verschuiven** (besluit 13) kan alleen zolang het project open staat (anders `PROJECT_CLOSED`), met dezelfde grenzen als bij openen, eerder of later; de sluiting gaat mee naar de nieuwe einddatum.
2. **De albumregel zit in `startUpload`.** Staat er in de groep van het gevraagde album een open project, dan reserveert `startUpload` voor het filmalbum X, welk album van die groep ook gevraagd werd. Het filmpje komt na afronden alleen in X. Beslist wordt bij `startUpload`: een project dat daarna sluit of opent, verandert die upload niet. Foto's (`POST /upload`), "Naar album" (`albums.addPhoto`) en albums van andere groepen vallen er niet onder.
3. **Een inzending hoort bij precies één nieuw filmpje.** Insturen kan alleen de eigenaar van een filmpje (een rij met `video`) dat (a) in het filmalbum staat van een project van een groep waar hij lid van is, en (b) gemaakt is terwijl dat project open stond. Eén weigering voor alles wat niet mag: geen filmpje, een foto, van een ander, van vóór het project, gemaakt na het sluiten, niet in het filmalbum, geen lid. Per filmpje hooguit één inzending: opnieuw aanmelden geeft dezelfde inzending terug, met dezelfde upload in R2, en nooit een tweede.
4. **De backend kiest sleutel en bucket.** Een origineel staat in een eigen bucket (`R2_ORIGINALS_BUCKET`), onder een willekeurige sleutel die niets uit het verzoek bevat. De app krijgt alleen deel-links: een PUT op precies die sleutel, met het deelnummer en de upload-id in de query en de grootte van dat deel in de handtekening (`content-length;host`), 7 dagen geldig. Alle delen zijn 32 MiB, behalve het laatste. De sleutel en de upload-id van R2 staan nooit los in een antwoord.
5. **Pas binnen als het heel is.** Een inzending is "onderweg" tot de backend alle delen in R2 ziet, elk met de goede grootte, de upload afrondt en het object precies de aangemelde grootte heeft. Ontbreekt er een deel, dan zegt afronden welke, en verandert er niets. Begint het bestand niet met een `ftyp` van QuickTime of mp4, dan gaat het object weg en de inzending ook (weigering `geen_video`).
6. **Het origineel blijft onaangetast.** De backend kopieert, herschrijft of ontleedt het niet. Na afronden zijn de bytes in R2 precies wat de app stuurde, met de GPS erin (besluit 10). Er is geen GPS-controle zoals in WP37.
7. **Nergens anders zichtbaar.** Een origineel maakt geen rij in `photos` en staat dus niet in albums, Mijn foto's of op de kaart. Er is geen afspeellink. Leden zien de lijst en de poster via een eigen beeldpad (`/beeld/inzending/<id>`); wie geen lid is van de groep van het project krijgt daar hetzelfde 404 als bij een onbekend id. Het antwoord van de lijst bevat geen sleutel, geen upload-id en geen link.
8. **Downloaden: alleen de oprichter**, alleen een origineel dat binnen is. De link is een GET van 1 uur op precies die sleutel in de originelen-bucket, met `response-content-disposition: attachment` en een bestandsnaam met datum en inzender (zonder plaats). Iedereen anders, de inzender zelf en de webmaster inbegrepen, krijgt één weigering (`ORIGINAL_NOT_FOUND`), ook voor een onbekend id.
9. **De backend rondt zelf af.** Elk uur rondt hij de inzendingen af die helemaal binnen zijn, ook als de app niet meer langskomt (cron `film originals complete`).
10. **Terugtrekken en verwijderen.** De inzender trekt zijn eigen inzending terug, onderweg of binnen; de oprichter verwijdert er één of alle van een project. Het filmpje in het album blijft. De inzending is meteen weg uit elke lijst; het object in R2 gaat weg en een open upload wordt afgebroken. Een ander krijgt `ORIGINAL_NOT_FOUND`.
11. **Weg na een jaar.** Een origineel dat een jaar binnen is, haalt de dagelijkse ronde weg, rij en object (cron `film originals expiry`). Een lifecycle-regel op de originelen-bucket (verwijderen na 365 dagen, halve uploads afbreken na 7 dagen) is het vangnet. Een gesloten project zonder originelen verdwijnt uit de groep.
12. **Elk wis-pad haalt R2 mee.** Groep verwijderen (ook als het laatste lid weggaat) en account verwijderen halen de projecten en inzendingen weg, met hun objecten en open uploads in R2. "Uit album" op een filmpje in X raakt de inzending niet.
13. **Toegang vóór config.** Wie niet mag, krijgt de gewone weigering, ook als een R2-env-var ontbreekt. Mag hij wel, dan een fout die begint met `R2_CONFIG_MISSING:` en de namen noemt (ook `R2_ORIGINALS_BUCKET`). Geen geheim, link of sleutel in een fout of log.
14. **Een eigen R2-check voor de originelen** (cron `film originals check`, dagelijks), naast die van WP37, die onveranderd blijft. Hij legt de originelen-bucket naast de inzendingen: een object zonder inzending (ouder dan een dag), een inzending die binnen is zonder object, en een halve upload zonder inzending (ouder dan 8 dagen: de lifecycle-regel werkt niet) geven één mail aan de webmaster, net als een ontbrekende `R2_ORIGINALS_BUCKET` ("kon niet draaien"). Een origineel dat klopt, meldt hij niet. De check wist niets.
15. **Grenzen in de backend** (getallen: besluit 11). Een origineel boven de grens per bestand, of een aanmelding die het project of het totaal over de grens brengt, weigert de backend al bij het aanmelden (`te_groot`, `vol`). De aangemelde grootte telt mee zolang de inzending onderweg is.
16. **Toegangsdefinitie.** Nieuwe publieke paden die een project-id, inzending-id, foto-id of groep-id aannemen: `filmProjects.open`, `close`, `setEndsAt`, `listForGroup`, `listOpenForMe`, `get`, `startOriginal`, `finishOriginal`, `withdraw`, `downloadUrl`, `removeOriginal`, `removeAll`, en `GET /beeld/inzending/<id>`. Elk heeft een gate; de inventaristest legt ze vast. Een inzending-id is zichtbaar in `get` (alleen voor leden) en in de routes van de app.

*In de app (deelpakket 38b en 38c):*

17. **Kiezen volgens besluit 3**, met één pure functie die uit de keuze (aantal foto's en filmpjes, het gekozen album) en de open projecten bepaalt waar foto's en filmpjes heen gaan, of Y te kiezen is, en welke tekst er boven de knop staat. Ook de + in album Y.
18. **Het filmpje voor het album hangt niet op het origineel.** Verkleinen en toevoegen gaan zoals in WP37. Het aanmelden van het origineel gebeurt na afronden, op elk netwerk. Alleen de delen wachten op wifi.
19. **Een wachtrij die een herstart overleeft.** Per origineel de inzending, het bestand en de stand. Na een herstart vraagt de app de backend welke delen nog moeten. Geen tweede inzending, geen dubbel deel.
20. **De kopie van de kiezer blijft staan zolang het origineel moet.** De opruimregels van WP39 wissen een verplaatst origineel niet. Pas na binnen, terugtrekken, weigeren of verlopen gaat het weg.
21. **"Alleen via wifi", standaard aan**, per toestel onthouden. Aan: geen mobiel internet en geen persoonlijke hotspot. Omzetten geldt meteen, ook voor wachtende delen.

### Gate-checks (alleen te zien op echte R2, iOS of in de browser)

De nep-R2 in de tests doet multipart zoals S3. Of R2 en iOS het ook zo doen, toetst de gate op dev:

- R2 neemt een ondertekende UploadPart aan (PUT met `partNumber` en `uploadId` in de query, `content-length` ondertekend), weigert een andere grootte (403) en neemt een geldigheid van 7 dagen aan.
- ListParts geeft nummer, grootte en ETag; afronden met die lijst lukt; delen van ongelijke grootte (behalve het laatste) weigert R2 bij afronden.
- Afbreken (DELETE met `uploadId`) haalt de delen weg; ListMultipartUploads toont halve uploads.
- Lifecycle op de originelen-bucket: verwijderen na 365 dagen, halve uploads afbreken na 7 dagen. Runbook: nakijken dat er op de bucket van de albums géén regel van 365 dagen staat.
- Een ondertekende GET met `response-content-disposition`: Chrome en Safari bewaren het bestand onder de naam uit de link; een download van ~1,5 GB komt heel aan.
- iPhone, met een origineel van ≥ 1 GB in 4K: de upload loopt door met de app op de achtergrond en het scherm uit; "Alleen via wifi" wacht op mobiel internet en op een hotspot, en gaat door op wifi; omzetten tijdens het wachten; app wegvegen en opnieuw openen gaat verder; na een herstart van de telefoon ook.
- De kiezer geeft het origineel bit voor bit (SHA-256 naast een AirDrop met "Alle fotogegevens"), ook bij een item uit iCloud. Wat hij geeft bij een bewerkt filmpje, slow-motion, Cinematic en ProRes.
- De vrije ruimte op de telefoon komt terug na binnen of terugtrekken.

### A-keuzes

- **Eigen bucket** per omgeving (`clubalmanac-originals-dev`, `-prod`, jurisdictie EU), met het bestaande token uitgebreid naar die bucket. Env-var `R2_ORIGINALS_BUCKET`; endpoint en sleutels zijn die van WP37. Redenen: de lifecycle-regel van 365 dagen kan nooit de albumfilmpjes raken; de backup-stap ziet hem niet (antwoord 7); de check van WP37 ziet geen originelen als wees.
- **Delen van 32 MiB**, deel-links 7 dagen, downloadlink 1 uur.
- **Container**: het bestand begint met `ftyp` met merk `qt  ` of een mp4-merk (`isom`, `iso2`–`iso6`, `mp41`, `mp42`, `avc1`, `M4V `). Meer controleert de backend niet (antwoord 3).
- **Bestandsnaam** bij downloaden: `<jjjj-mm-dd uu.mm> <naam inzender>.mov` (of `.mp4`), met de opnamedatum van het filmpje, of zonder die de datum van inzenden. Geen plaats in de naam.
- **Eén module** `convex/filmProjects.ts` voor projecten en inzendingen; twee tabellen (project en inzending). De inzending verwijst naar het filmpje in het album; de poster en de opnamedatum komen daarvandaan.
- **"Alles downloaden"** in de webapp: de originelen na elkaar, elk met een eigen verse link. Geen zip (dat kan Convex niet voor gigabytes).

### Voorstel: drie deelpakketten

Het risico zit op drie plekken: de toegang en het opruimen (backend), de achtergrond-upload van gigabytes (native iOS, het meest onbekend), en de schermen. Voorstel om ze los te bouwen en te toetsen:

- **WP38a, backend**: projecten, albumregel, inzendingen met multipart, eigen beeldpad, downloadlink, terugtrekken en verwijderen, een jaar, cascades, R2-check, crons, inventaris, runbook (bucket, lifecycle, env-var). De RED tests hieronder zijn voor 38a. Kan naar prod vóór de app: zonder open project verandert er niets.
- **WP38b, uploader op de iPhone**: de eigen achtergrond-uploader in `clubalmanac-video`, de wachtrij, de wifi-schakelaar, het verplaatsen van de kopie. **Eerst een spike op het toestel** (een origineel van 1,5 GB tegen dev-R2: achtergrond, wifi en hotspot, wegvegen, herstart), daarna pas bouwen. Tests voor de pure delen (delen plannen, de stand van de wachtrij).
- **WP38c, schermen**: starten en sluiten, banner, projectpagina, toevoegscherm volgens besluit 3, downloadpagina in de webapp. Tests voor de pure delen (besluit 3, teksten, bestandsnaam). A schrijft die tests als 38c begint, na de besluiten.

38b en 38c komen samen in één app-release. A schrijft de tests van 38b en 38c pas na de spike en de besluiten, zodat ze niet op een aanname over iOS rusten.

### Besluiten voor Wouter

11. **Grenzen**: hooguit 2 GiB per origineel, 200 GiB per project, 400 GiB voor alles samen (hooguit ~$6 per maand). Aanbevolen: **ja**.
12. **Vertrekt een lid of wordt hij uit de groep gezet**: gaan zijn originelen weg? Aanbevolen: **ja** (zoals zijn filmpjes uit de albums; er zit GPS in).
13. **Einddatum**: sluit het project vanzelf aan het eind van die dag, en mag de oprichter hem verschuiven zolang het open staat? Aanbevolen: **ja en ja**.
14. **Backup**: originelen niet in de backup, in een eigen bucket. Aanbevolen: **ja**.
15. **Herinnering**: één mail aan de oprichter 30 dagen voordat originelen weggaan. Aanbevolen: **ja**.
16. **Verwijdert iemand het filmpje in het album** (zelf, of de webmaster na een melding), gaat het origineel dan ook weg? Aanbevolen: **ja**. ("Uit album" blijft zonder gevolg, besluit 4.)
17. **Het filmalbum verwijderen** terwijl het project open staat: weigeren met "Sluit eerst het filmproject"? Aanbevolen: **ja**.
18. **Na sluiten nog binnenkomen**: hoe lang mag een origineel dat al aangemeld was nog binnenkomen? Aanbevolen: **14 dagen na sluiten**. Daarna ruimt de backend de halve upload op, en de app het bestand.
19. **Omleiden voor de oude app 2.0.2** (filmpje naar Y komt in X, zonder origineel), met een bericht aan de leden om bij te werken. Aanbevolen: **ja**.
20. **Drie deelpakketten** (38a backend, 38b uploader met eerst een spike, 38c schermen). Aanbevolen: **ja**.

### Besluiten Wouter na A (2026-11-22)

Besluiten 11–20: alle tien volgens het advies van A. WP38 gaat in drie deelpakketten: 38a (backend, mag vóór de app naar prod), 38b (uploader, eerst een proef op de iPhone), 38c (schermen). 38b en 38c komen samen in één app-release.

### Testcontract (A, voor WP38a)

> Namen en vormen zijn A-keuzes; het hoe is aan B.

- **Env**: `R2_ORIGINALS_BUCKET` naast de vier van WP37.
- **`api.filmProjects.open({ groupId, albumId, endsAt })`** (mutation) → project-id. Weigeringen `ConvexError({ code })`: `NOT_MEMBER`, `NOT_ALLOWED`, `DATE_INVALID`, `PROJECT_ALREADY_OPEN`.
- **`api.filmProjects.close({ projectId })`** (mutation) → `null`; alleen de oprichter.
- **`api.filmProjects.setEndsAt({ projectId, endsAt })`** (mutation) → `null`; alleen de oprichter, alleen een open project. Weigeringen `NOT_MEMBER`, `NOT_ALLOWED`, `DATE_INVALID`, `PROJECT_CLOSED`.
- **`api.filmProjects.listForGroup({ groupId })`** (query, leden; anders `NOT_MEMBER`) → `[{ projectId, albumId, albumName, endsAt, open }]`: het open project, en gesloten projecten zolang er originelen zijn. `albumId` is `null` als het filmalbum na sluiten verwijderd is; `albumName` is dan de naam bij het openen.
- **`api.filmProjects.listOpenForMe({})`** (query) → `[{ groupId, projectId, albumId, albumName, endsAt }]` voor de groepen van de caller.
- **`api.filmProjects.get({ projectId })`** (query, leden; anders `NOT_MEMBER`) → `{ project: { projectId, groupId, albumId (of null, zoals hierboven), albumName, endsAt, open }, isFounder, originals: [{ originalId, ownerName, mine, status: "onderweg" | "binnen", durationMs, submittedAt, takenAt }] }`. Van anderen alleen `binnen`; de oprichter ziet alles.
- **`api.filmProjects.startOriginal({ photoId, bytes })`** (action) → `{ kind: "upload", originalId, partSize, parts: [{ partNumber, url }], expiresAt }` (alleen de delen die nog niet in R2 staan) of `{ kind: "done", originalId }`. Weigering `ConvexError({ code: "ORIGINAL_REFUSED", reason })` met `uitgelogd | niet_toegestaan | te_groot | vol`.
- **`api.filmProjects.finishOriginal({ originalId })`** (action) → `{ kind: "done" }` of `{ kind: "missing", parts: number[] }`. Weigering `ORIGINAL_REFUSED` met `niet_toegestaan` of `geen_video`.
- **`api.filmProjects.withdraw({ originalId })`**, **`removeOriginal({ originalId })`**, **`removeAll({ projectId })`** (mutations); weigering `ConvexError({ code: "ORIGINAL_NOT_FOUND" })` (bij `removeAll`: `NOT_MEMBER` of `NOT_ALLOWED`).
- **`api.filmProjects.downloadUrl({ originalId })`** (action) → `{ url, expiresAt }`; weigering `ORIGINAL_NOT_FOUND`.
- **`GET /beeld/inzending/<originalId>[?formaat=klein|groot]`**: 401 uitgelogd, 404 geen toegang of onbekend, 200 de poster (zoals `/beeld/foto/`); `OPTIONS` voor de webapp.
- **`internal.filmProjects.completeUploaded({})`** (action, cron `film originals complete`, elk uur) en **`internal.filmProjects.expireOriginals({})`** (mutation, cron `film originals expiry`, dagelijks).
- **`internal.filmProjects.checkStorage({})`** (cron `film originals check`, dagelijks): de R2-check van de originelen. `videos.checkStorage` (WP37) blijft zoals hij is.
- **`albums.remove`** van het filmalbum van een open project: `ConvexError({ code: "FILM_PROJECT_OPEN" })` (besluit 17).
- **WP10**: `MONITORED_FKS` krijgt `filmProjects.groupId`, `filmProjects.albumId` (optioneel), `filmOriginals.projectId`, `groupId`, `ownerId` en `photoId`; beide tabellen vallen onder "niet door de import gevuld" (`tests/migration/fkOracle.ts`).

### Tests per invariant (stand na A)

| Inv. | Test (`tests/filmProject/`) | Niet getest, omdat … |
|---|---|---|
| A1 | `projects.test.ts` (ook besluit 13: een jaar, vanzelf sluiten, `setEndsAt`) | |
| A2 | `albumRule.test.ts` (Y wordt X, foto blijft in Y, andere groep, na sluiten, "Naar album" naar Y) | wat 2.0.2 dan toont: gate |
| A3 | `originals.test.ts` (eigenaar, nieuw, in X, foto, van vóór het project, na sluiten in X gezet, ander, opnieuw = dezelfde) | |
| A4 | `originals.test.ts` (bucket, sleutel, deel-links, grootte, 7 dagen, delen van 32 MiB) | |
| A5 | `originals.test.ts` (ontbrekend deel, geen half bestand binnen, `geen_video`) | |
| A6 | `originals.test.ts` (bytes met GPS gelijk, geen kopie) | |
| A7 | `access.test.ts` (lijst, beeldpad, geen sleutel), `originals.test.ts` (geen rij in `photos`) | |
| A8 | `access.test.ts` (oprichter, admin, inzender, webmaster, link) | |
| A9 | `originals.test.ts` (afronden zonder app) | |
| A10 | `cascade.test.ts` | |
| A11 | `cascade.test.ts` (een jaar, herinnering, gesloten project zonder originelen, 14 dagen na sluiten) | lifecycle-regel: runbook |
| A12 | `cascade.test.ts` (groep, account, "Uit album", vertrek, filmpje verwijderen, filmalbum verwijderen), `integrity.test.ts` (WP10) | |
| A13 | `originals.test.ts` (config ontbreekt) | |
| A14 | `storageCheck.test.ts` (klopt, wees, ontbrekend object, config ontbreekt) | halve upload ouder dan 8 dagen: na de gate (wat ListMultipartUploads van R2 geeft) |
| A15 | `originals.test.ts` (2 GiB, 200 GiB, 400 GiB, terugtrekken maakt vrij) | |
| A16 | `inventory.test.ts` (publieke functies met soort en argumenten, routes, crons); de inventarissen van WP23 (`readWhitelist`), WP28 (`beheerInventory`) en de beeldpaden (`images/httpRoute`) | |
| A17–21 | | app: 38b en 38c |

Bestaande tests die A aanpaste: `tests/crons/registration.test.ts` (negen crons), `tests/readWhitelist/inventory.test.ts`, `tests/groups/beheerInventory.test.ts`, `tests/images/httpRoute.test.ts` en `tests/migration/fkOracle.ts`. De nep-R2 voor de originelen (multipart zoals S3, alle delen even groot behalve het laatste, minstens 5 MiB) staat in `tests/filmProject/_film.ts`. Let op: `settle()` laat de klok doorlopen tot de laatste geplande stap, ook de geplande sluiting van een open project; `flush()` en `runUntil()` laten alleen lopen wat nu (of binnen de gegeven tijd) klaarstaat.

### Ronde na B (A, 2026-11-22)

- **Inventarissen.** De nieuwe paden voldoen aan de regels: `get`, `listForGroup` en `listOpenForMe` hebben een return-validator zonder `any` of `record`; `open` heeft de gate van de beheerpaden; `GET` en `OPTIONS /beeld/inzending/*` volgen de regel van WP35 (preflight alleen op paden met een token). Geen probleem met een gate gevonden.
- **Test "een ontbrekend deel".** Deel 1 bestond uit nullen, dus de `ftyp`-controle weigerde terecht. Deel 1 begint nu met de echte bytes van een filmpje.
- **B-keuzes, door A bevestigd:**
  - *Opnieuw aanmelden met een andere grootte* weigert met `niet_toegestaan`, en de inzending blijft zoals hij is. Een andere grootte is een ander bestand; zo komen delen van twee bestanden nooit in één origineel. Vervangen kan niet: na terugtrekken neemt de backend voor dat filmpje geen inzending meer aan (fix-cyclus 2, punt 1).
  - *Een gesloten project zonder originelen* is meteen uit de groep; de rij mag nog even blijven (geen originelen, geen GPS). De test legt alleen de bovengrens vast: na een jaar en 14 dagen is hij weg.
  - *Herinnering*: één mail per project aan de oprichter van nu, met het aantal en de eerste en laatste datum. Geen tweede mail. Wat na de mail nog binnenkomt (alleen bij een project dat bijna een jaar open staat), krijgt geen eigen herinnering: dat is aanvaardbaar.
  - *Bestandsnaam zonder opnamedatum*: datum en tijd van inzenden in Nederlandse tijd (CET en CEST).

**Stand na A (na B):** 16 rood voor B: `setEndsAt` (6 tests in `projects.test.ts`, 1 in `inventory.test.ts`), `albumId` leeg na het verwijderen van het filmalbum (1 in `cascade.test.ts`), WP10 (3 in `integrity.test.ts`, 3 in `tests/migration/sharedLists.test.ts`, 2 in `tests/migration/migrationFunctions.test.ts`). De rest is groen, ook de nieuwe tests voor besluiten 11, 12, 15, 16, 17 en 18 en de vier B-keuzes. Typecheck schoon.

### Fix-cyclus 1 (audit en red-team)

> A 2026-11-22, op `02eda77`, met de besluiten van regie. Tests: `tests/filmProject/races.test.ts` (nieuw) en aanvullingen in `originals`, `access`, `cascade` en `storageCheck`.

**Moet**

1. **Afronden wist alleen wat weg is** (audit B1 = red-team B1). Afronden (door de app of de cron) kent voor de inzending drie uitkomsten: nu binnen, al binnen, of weg. Alleen bij *weg* (teruggetrokken of verwijderd tijdens het afronden) gaat het object uit R2; de app krijgt dan `niet_toegestaan`. Bij *al binnen* (twee keer tegelijk afronden, de app en de cron, de cron met een oude stand) is het antwoord `done` en blijft het object heel. Na elke volgorde: binnen, het object precies zoals verstuurd, geen open upload, en de oprichter kan downloaden.
2. **Loskoppelen alleen bij de verwachte upload** (red-team S1). Wie ziet dat een upload niet meer bestaat en opnieuw wil beginnen, koppelt alleen los als de inzending nog die upload heeft. Heeft een gelijktijdig hervatten intussen een nieuwe gekoppeld, dan blijft die staan en kan de app daarop versturen en afronden.
3. **Hervatten tijdens het afronden** (red-team S2). Kent R2 de upload niet meer, dan kijkt hervatten eerst of het object er is met de aangemelde grootte. Zo ja, dan rondt hervatten af zoals in punt 1 en geeft `done`, zonder nieuwe upload. Is de inzending binnen gekomen terwijl hervatten een nieuwe upload maakte, dan ook `done` (geen weigering), en die nieuwe upload wordt afgebroken.

**Zou (deze ronde)**

4. **Testgaten** (audit S1, S2, N1, N2), nu vastgelegd: de poster van andermans inzending die nog onderweg is geeft een lid (ook een admin) 404; op dag 14 na sluiten plus een uur weigeren `startOriginal` en `finishOriginal` met `niet_toegestaan` en rondt de cron niets af, ook als de opruimronde nog niet liep; MON3 noemt een inzending met een andere grootte (inzending-id) en een halve upload zonder inzending ouder dan 8 dagen (sleutel) in de mail, en niet de upload van een inzending onderweg of een halve upload van 7 dagen; een `ftyp` met een ander merk (`heic`) is `geen_video`.
5. **MON3 rond het einde van het jaar** (red-team S3). Regie: de R2-regel blijft 365 dagen. MON3 meldt een inzending die binnen is niet als "zonder bestand" vanaf een dag vóór het einde van zijn jaar, en ook niet erna (de opruimronde liep dan nog niet). Twee dagen ervoor wel. Waar het jaar hier begint: fix-cyclus 2, punt 5.
6. **Kosten** (red-team S4). Een ondergrens per origineel: kleiner weigert `startOriginal` met `te_klein`, zonder iets in R2. Een daggrens op `startOriginal` en `finishOriginal` samen per lid (glijdend, zoals `videoUploadRequests` van WP37), daarboven `te_vaak` zonder verzoek aan R2. Een geweigerde aanroep telt niet; de cron telt niet mee; toegang gaat vóór (wie niet mag, krijgt `niet_toegestaan`). De getallen en de motivatie staan bij fix-cyclus 2 (punt 2 tot 4). Wat de grens niet dekt: de PUT's op de deel-links zelf (een link geldt 7 dagen en kan vaker gebruikt worden). Daarvoor is de kostenmelding van $5 in Cloudflare (runbook). In de app (38c): bij een bestand onder de ondergrens gaat het filmpje naar het album, zonder origineel.
7. **Wissen in R2 robuuster** (audit N4). Afbreken van de upload en wissen van het object worden los van elkaar geprobeerd: mislukt het een (storing), dan gebeurt het ander toch.
8. **Herinnering opnieuw proberen** (red-team N7). De herinnering geldt pas als verstuurd als de mail weg is. Mislukt hij, dan probeert de volgende dagelijkse ronde het opnieuw. Nog steeds hooguit één mail per project, ook als twee rondes vlak na elkaar lopen.
9. **`/beeld/inzending/<id>?formaat=origineel` → 400** (audit N6), zoals `/beeld/foto/`: vóór alles, voor iedereen gelijk.

**Testcontract erbij**: `startOriginal` weigert ook met `te_klein` en `te_vaak`; `finishOriginal` ook met `te_vaak`.

**Opdrachten voor B (alleen doc)**

- *Cascade-matrix* (audit S3): A3, P11 en M5 bijwerken voor WP38, de aantallen bij MON1, en de dubbele backtick.
- *Runbook*: `R2_ORIGINALS_BUCKET` vóór of samen met de deploy zetten (audit N7); geen filmproject openen op prod vóór de release van 38b/38c (red-team N8); de tabellen leegmaken (migratie-tooling) laat de objecten in de originelen-bucket staan, dus die apart leegmaken (red-team N9); een kostenmelding in Cloudflare op $5.

**Gate-checks erbij**

- *Als eerste stap* op echte R2 (audit S4): aanmaken en afronden van een multipart-upload met de ondertekening in de query werkt. Zo niet, dan terugvallen op de `Authorization`-header.
- Welke datum R2 een object uit een multipart-upload geeft (begin of einde van de upload). Bij het begin: zie het open punt hieronder.

**Voor 38b en 38c** (red-team N2, audit N8): een PUT die `NoSuchUpload` krijgt, betekent opnieuw `startOriginal` (dat geeft links op een nieuwe upload, of `done`). Overweeg de multipart pas te maken bij de eerste vraag om links, zodat een upload niet ongebruikt op wifi wacht tot de lifecycle-regel hem na 7 dagen afbreekt; dat moet passen bij A-invariant 18 (aanmelden op elk netwerk). De downloadpagina navigeert met een gewone link (`<a href>`) naar de downloadlink, geen fetch: zo gaat een bestand van gigabytes niet door het geheugen van de browser.

**Open punt voor regie.** Dateert R2 een multipart-object op het begin van de upload, dan wist de lifecycle-regel een origineel eerder dan de datum die de downloadpagina en de herinnering noemen (een jaar na binnenkomst), met de tijd tussen aanmelden en binnen: meestal minuten tot dagen, hooguit de looptijd van het project plus 14 dagen. Advies A: na de gate beslissen; blijkt het zo, dan het jaar overal laten tellen vanaf het aanmelden.

| Punt | Test (`tests/filmProject/`) |
|---|---|
| 1 | `races.test.ts` (twee keer tegelijk, een tweede afronding ertussen, de cron met een oude stand, de cron ertussen, terugtrekken op twee momenten) |
| 2 | `races.test.ts` (de cron met U1, de app met U2) |
| 3 | `races.test.ts` (object al heel, binnen gekomen tijdens hervatten) |
| 4 | `access.test.ts`, `cascade.test.ts`, `storageCheck.test.ts`, `originals.test.ts` |
| 5 | `storageCheck.test.ts` (halve dag ervoor, erna, twee dagen ervoor, tien dagen na aanmelden binnen) |
| 6 | `originals.test.ts` (5 MiB, toegang eerst, 300 per dag) |
| 7 | `cascade.test.ts` (afbreken mislukt, wissen mislukt) |
| 8 | `cascade.test.ts` (mail mislukt, twee rondes) |
| 9 | `access.test.ts` |

Aangepast: `ORIGINAL` in `_film.ts` is de fixture aangevuld tot 6 MiB (boven de ondergrens); de JPEG-test en de config-test gebruiken een grootte boven 5 MiB. De nep-R2 kan een verzoek laten wachten op een tweede aanroep (`onceBefore`), een storing geven (`failWhen`) en Mailjet laten falen (`mailDown`).

**Stand na A (fix-cyclus 1):** 15 rood voor B: punt 1 (4 in `races.test.ts`), punt 2 (1), punt 3 (2), punt 5 (3 in `storageCheck.test.ts`), punt 6 (2 in `originals.test.ts`), punt 7 (1 in `cascade.test.ts`, afbreken mislukt), punt 8 (1, mail mislukt), punt 9 (1 in `access.test.ts`). Groen als vangnet: terugtrekken tijdens het afronden, de testgaten van punt 4, twee dagen ervoor wel een mail, toegang vóór `te_klein`, wissen mislukt, twee rondes één mail. De rest van de suite groen; typecheck schoon.

### Fix-cyclus 2 (heraudit en red-team-hercheck)

> A 2026-11-22, op `a72e7e3`, met de besluiten van regie. Tests: `tests/filmProject/blocked.test.ts` (nieuw) en aanvullingen in `originals`, `races`, `cascade` en `storageCheck`.

**Moet**

1. **Teruggetrokken blijft teruggetrokken** (heraudit 1 = red-team Z1). Na terugtrekken (`withdraw`) of verwijderen door de oprichter (`removeOriginal`, en ook `removeAll`: dat is hetzelfde besluit voor alle inzendingen van een project) onthoudt de backend bij het filmpje dat zijn origineel weg moest. Een nieuwe aanmelding voor dat filmpje geeft `niet_toegestaan`, ook zolang het project open is, wie hem ook stuurt (een telefoon die na `NoSuchUpload` hervat, een ander apparaat). Er komt geen nieuwe inzending en geen nieuwe upload in R2. Andere filmpjes van dezelfde inzender gaan gewoon.
   - *A-keuze*: de markering is een tijdstip op het filmpje zelf (`photos`), niet een eigen tabel. Zo gaat hij vanzelf mee als het filmpje of het account weg is (P10, P11, U18), en is er geen nieuwe verwijzing voor WP10 of de migratie-tooling. Geen publiek pad toont het veld.
   - Weg om een andere reden markeert niet: `geen_video`, 14 dagen na sluiten, een jaar, vertrek uit de groep. Na 14 dagen na sluiten of vertrek kan een nieuwe inzending toch al niet (geen open project, geen lid, of het filmpje staat niet meer in X); bij `geen_video` was het bestand geen filmpje en mag het echte bestand nog. Voor een jaar: zie "Na fix-cyclus 2".
   - *Afronden als de inzending weg is*: `finishOriginal` geeft `niet_toegestaan`, nooit `missing`, ook als het terugtrekken gebeurt terwijl afronden loopt (de upload in R2 al afgebroken, of nog niet alle delen binnen). De cron laat dan niets achter en maakt niets opnieuw.
   - Gevolg voor de B-keuze over een andere grootte (ronde na B): vervangen door terugtrekken en opnieuw insturen kan niet meer.

**Zou (deze ronde)**

2. **Kosten: inzendingen onderweg en de cron** (red-team Z2). *Regie*: hooguit **30 inzendingen onderweg per lid**, over alle projecten. Een nieuwe aanmelding daarboven weigert `startOriginal` met **`bezig`** (*A-keuze*, zoals `bezig` bij `MAX_OPEN_VIDEO_UPLOADS` van WP37), zonder iets in R2 en zonder dat de aanroep meetelt voor de daggrens. Hervatten van een inzending die al onderweg is, mag altijd. Is er een binnen of teruggetrokken, dan mag er weer een nieuwe. *Regie*: de uurlijkse afrond-cron kijkt alleen inzendingen na waarvoor `startOriginal` in de laatste 7 dagen plus 1 dag deel-links gaf (de looptijd van een link, plus een dag voor een deel dat op het laatste moment binnenkwam; daarna kan er zonder nieuwe aanmelding niets meer binnenkomen). Een oudere inzending rondt de app zelf af (`finishOriginal`) of de cron weer na een nieuwe aanmelding. De grens precies op 8 dagen ligt bij B; de tests liggen op 7 dagen en 22 uur (wel) en 9 dagen (niet).
3. **Daggrens 600** (red-team N1). *Regie*: hooguit 600 aanroepen van `startOriginal` en `finishOriginal` samen per lid in 24 uur. Motivatie: een lid stuurt hooguit 30 filmpjes per dag in (WP37), en een telefoon op een wisselend netwerk doet per origineel tot zo'n 20 aanroepen (aanmelden, hervatten na `NoSuchUpload` of een 403, na een herstart of na het omzetten van de wifi-schakelaar, afronden). Met 300 kwam zo'n dag in de knel.
4. **Ondergrens 1 MiB** (red-team N2). *Regie*: een origineel is minstens 1 MiB, zodat korte clips meegaan. Een origineel van één deel mag kleiner zijn dan 5 MiB (R2 eist die grootte alleen van delen vóór het laatste).
5. **MON3: het jaar begint bij de laatste upload** (red-team N3). De check meldt een inzending die binnen is zonder bestand niet vanaf een dag vóór een jaar na het moment waarop de laatste upload in R2 is aangemaakt. De backend legt dat moment vast als hij een upload aan de inzending koppelt, ook bij hervatten met een nieuwe upload, en het blijft staan na binnen. Zonder dat moment telt het aanmelden. Zo blijft echt verlies bij een origineel dat maanden na het aanmelden binnenkwam niet maanden onopgemerkt. R2 breekt een halve upload na 7 dagen af, dus het verschil met het einde van de upload is hooguit een week.
6. **Testgat** (heraudit 2): account verwijderen wist de rijen in `originalRequests` van die user; die van een ander blijven.

**Testcontract erbij**: `startOriginal` weigert ook met `bezig`.

**Opdrachten voor B (alleen doc)**

- *Uitzondering op WP10* (heraudit 3, red-team N7): `originalRequests` en `videoUploadRequests` staan bewust niet in `MONITORED_FKS` en niet in de reset van de migratie-tooling. Reden: het zijn tellers voor een daggrens, zonder inhoud, een tijdstip per aanroep; ze tellen alleen voor hun eigen user, account verwijderen wist ze (U17, U18), en een rij van een user die niet meer bestaat doet niets. Vastleggen in `docs/cascade-matrix.md` bij U17 en U18 (of waar de lijsten beschreven staan) en als commentaar bij `MONITORED_FKS`. De markering van punt 1 staat op `photos` en is geen verwijzing.
- *Runbook* (`docs/conventions/external-services.md`, originelen): bij de kostenmelding het R2-token van die omgeving rollen en de nieuwe sleutels in Convex zetten; de deel-links (en downloadlinks) werken dan niet meer. Waarschuwing erbij: hetzelfde token tekent de links van de albumfilmpjes, dus ook die vallen weg tot de nieuwe sleutels er staan (red-team N6). Bij *Opruimen*: de herinnering kan bij een zeldzame storing twee keer komen (de mail ging weg, maar het vastleggen daarvan mislukte) (red-team N4). Bij de kosten en grenzen: de getallen van punt 2 tot 4 (A paste die regels al aan).

**Voor 38b** (red-team N1): hervatten (`startOriginal` opnieuw) alleen na `NoSuchUpload` of een 403 op een deel. Na een herstart gaat de app verder met de bewaarde links (een deel nog eens versturen kan); dat vervangt het vragen bij een herstart uit A-invariant 19. Aanroepen na elkaar, niet parallel per origineel; bij `te_vaak` wachten (de grens glijdt over 24 uur), bij `bezig` wachten tot een eerder origineel binnen is; `finishOriginal` pas als alle delen verstuurd zijn, niet na elk deel. Na terugtrekken (of `niet_toegestaan` bij hervatten) gaat het bestand van het toestel en meldt de app dat filmpje niet opnieuw aan.

**Kosten, opnieuw** (met de cron erbij; R2 Standard, nog te bevestigen in het dashboard). Opslag: het plafond van 400 GiB is ~$6 per maand. Klasse A bij het uiterste: 16 leden een maand lang op de daggrens is 288.000 aanroepen, elk hooguit drie klasse-A-verzoeken (lijst van delen, aanmaken of afronden, afbreken): ~864.000. De cron: hooguit 30 inzendingen per lid, één lijst van delen per uur, alleen in de 8 dagen na nieuwe links: hooguit 16 × 30 × 24 × 30 = ~346.000. Samen ~1,2 miljoen, ~200.000 boven het gratis miljoen: ~$1. In het slechtste geval dus ~$7 per maand, ruim binnen €15. Bij gewoon gebruik (twee reizen per jaar, enkele honderden originelen) blijft alles in het gratis deel. De PUT's op de deel-links vallen erbuiten; daarvoor de kostenmelding van $5 en het rollen van het token.

| Punt | Test (`tests/filmProject/`) |
|---|---|
| 1 | `blocked.test.ts` (terugtrekken onderweg en binnen, `removeOriginal`, `removeAll`, ander filmpje wel, afronden na en tijdens terugtrekken, cascades), `races.test.ts` (terugtrekken tijdens afronden: upload al afgebroken, delen nog niet binnen) |
| 2 | `originals.test.ts` (30 onderweg, `bezig` telt niet, hervatten mag, na binnen weer; de cron na 9 dagen niet, na 7 dagen en 22 uur en na nieuwe links wel) |
| 3 | `originals.test.ts` (600 per dag) |
| 4 | `originals.test.ts` (1 MiB, een origineel van 1 MiB komt binnen) |
| 5 | `storageCheck.test.ts` (nieuwe upload 100 dagen na aanmelden) |
| 6 | `cascade.test.ts` |

Aangepast: in `_film.ts` de ondergrens (1 MiB) en de daggrens (600), plus de grens van 30 onderweg en het venster van 7 dagen plus 1 dag als oracle; de tests van fix-cyclus 1 voor `te_klein` en de daggrens volgen de nieuwe getallen.

**Stand na A (fix-cyclus 2):** 13 rood voor B: punt 1 (4 in `blocked.test.ts`, 2 in `races.test.ts`), punt 2 (2 in `originals.test.ts` voor `bezig`, 1 voor de cron na 8 dagen), punt 3 (1), punt 4 (2), punt 5 (1 in `storageCheck.test.ts`). Groen als vangnet: `finishOriginal` na terugtrekken, een ander filmpje wel, de markering gaat mee met filmpje en account, de cron tijdens terugtrekken, de cron na nieuwe links, MON3 een halve dag vóór een jaar na de laatste upload, en punt 6. De rest van de suite groen; typecheck schoon.

### Na fix-cyclus 2 (regie)

> A 2026-11-22, na de hercheck van fix-cyclus 2.

- **De markering geldt overal en blijft.** `originalBlockedAt` hoort bij het filmpje, niet bij een groep of project, en gaat er nooit meer af: ook een later project, in deze of een andere groep, neemt voor dat filmpje geen origineel meer aan. 38c waarschuwt bij terugtrekken, verwijderen en "Alles verwijderen" dat het definitief is.
- **Een jaar markeert niet.** De reden "toch al geen open project" klopt niet altijd: met `setEndsAt` kan een project langer dan het jaar van een origineel open blijven, en dan mag hetzelfde filmpje opnieuw. Dat is bewust zo: na een jaar is het origineel weg, niet geweigerd.
- **Na `geen_video`** kan hetzelfde filmpje opnieuw worden aangemeld (`originals.test.ts`).
- **Voor 38b**: bewaar het bestand precies zoals het werd aangemeld en exporteer het niet opnieuw. Een andere grootte weigert `startOriginal` met `niet_toegestaan`, en terugtrekken en opnieuw insturen kan niet.
- **Cron-venster** (regie): 7 dagen plus 1 dag; de getallen bij fix-cyclus 2, punt 2, zijn bijgewerkt. Test erbij: een deel op het laatste moment van zijn link, de cron 7 dagen en 22 uur na de links rondt nog af.

## Spike 38b: uploader op de iPhone (regie, 2026-11-23)

Doel: weten wat iOS en R2 echt doen met een origineel van ~1,5 GB, vóór A de tests van 38b schrijft. Net als bij WP14 doet één uitvoer-sessie met het `wp-b`-mandaat de code; regie maakt de dev-build en zet hem op TestFlight; Wouter test op zijn iPhone. De code staat op een eigen branch `wp38b-spike` (worktree `~/Code/clubalmanac-v2-spike`) en gaat niet naar `main`. B van 38b mag hem later lezen. Tegen dev (`glorious-pheasant-759`, `clubalmanac-originals-dev`); de backend van 38a staat daar al.

**Wat de spike bouwt** (snel en wegwerp, geen tests nodig; app-typecheck groen):

- In `clubalmanac-video` een uploader met een URLSession voor de achtergrond. Per deel een eigen bestand (iOS uploadt op de achtergrond alleen vanuit een bestand), een PUT naar de deel-link, de wifi-keuze via de instellingen van de sessie. Voortgang en klaar als events. Na het opnieuw starten van de app pakt hij de lopende taken weer op. Ook: de SHA-256 van een bestand.
- Een proefscherm, alleen in dev-builds, bereikbaar vanuit Instellingen. Daarop:
  - een filmproject openen in een groep waar je oprichter bent (album kiezen, einde over 14 dagen) en sluiten;
  - één filmpje kiezen zoals in het toevoegscherm (WP39), met grootte, SHA-256 en metadata in beeld;
  - het verkleinde filmpje toevoegen zoals in WP37 (de albumregel zet het in het filmalbum), dan `startOriginal`, de delen via de uploader, `finishOriginal`;
  - een schakelaar "Alleen via wifi" die meteen werkt, ook voor wachtende delen;
  - een log met tijden en de stand per deel, die een herstart overleeft;
  - terugtrekken, en de vrije ruimte op het toestel;
  - een knop die één deel met een verkeerde grootte stuurt (R2 hoort 403 te geven).
- Een eenvoudige wachtrij op schijf (inzending, bestand, links, stand), zodat de app na wegvegen of een herstart verder kan.

**Wat Wouter meet op de iPhone** (de gate-checks voor iOS en R2):

1. Upload van ~1,5 GB op wifi: hoe lang, en loopt hij door met de app op de achtergrond en het scherm uit?
2. "Alleen via wifi": wacht hij op mobiel internet en op een persoonlijke hotspot, en gaat hij verder op wifi? Omzetten tijdens het wachten.
3. App wegvegen en opnieuw openen: gaat hij verder (iOS breekt de taken dan af; de app moet ze opnieuw starten)?
4. De telefoon herstarten: gaat hij daarna verder?
5. Geeft de kiezer het origineel bit voor bit? SHA-256 in de app naast die van dezelfde video via AirDrop met "Alle fotogegevens". Ook een filmpje uit iCloud, een bewerkt filmpje, slow motion, Cinematic en ProRes: wat komt eruit?
6. R2: een deel met een verkeerde grootte geeft 403; afronden lukt; de vrije ruimte komt terug na binnen en na terugtrekken.
7. Datering in R2 (open vraag uit 38a): een upload over twee dagen spreiden (de helft vandaag, de rest morgen) en in het R2-dashboard kijken welke datum het object krijgt.

**Uitkomst:** regie schrijft de metingen hieronder. Daarna besluiten met Wouter, en pas dan A voor 38b.

### Uitkomst spike (2026-11-23, build 83, iPhone 15 Pro, dev)

Gemeten met filmpjes van 217 MiB (1080p, 1:46) en 291 MiB (4K, 1:59, 10 delen). Code: branch `wp38b-spike` (commit `990fd2b`).

1. **Grootte en snelheid.** Een 4K-filmpje van de iPhone zelf is ongeveer 150 MB per minuut; 1,5 GB haal je alleen met 4K op 60 fps of ProRes. Op wifi ging een origineel met ongeveer 20 MB/s (291 MiB in 15 s). Een filmpje van 4:55 (3,2 GiB) weigert de albumregel al met `te_lang`.
2. **Achtergrond en scherm uit: werkt.** iOS wekt de app per afgerond deel; `finishOriginal` loopt dan ook op de achtergrond, zonder dat het lid de app opent.
3. **Een taak die de app op de achtergrond start, stelt iOS uit** (2,8 MB duurde 82 s). Met alle delen tegelijk aan iOS gegeven, terwijl de app open is, gebeurt dat niet.
4. **"Alleen via wifi": werkt.** Op 5G wachtten alle delen op 0%. Zodra er wifi was, merkte de app dat, ook op de achtergrond, en 28 s later was het origineel binnen. Een persoonlijke hotspot is niet getest.
5. **App wegvegen: iOS breekt alle taken af** (fout -999). Er gebeurt niets tot het lid de app weer opent; dan gaat hij verder en is het binnen 20 s klaar. Bij het opnieuw starten gingen een paar delen twee keer over de lijn (dubbel opnieuw in de rij); dat kan geen kwaad maar kost data.
6. **Telefoon herstarten: werkt.** De taken die nog liepen staan na de herstart nog bij iOS en gaan door.
7. **Bit voor bit:** het object in R2 (304.848.345 bytes) heeft dezelfde SHA-256 als het bestand dat de app uit de kiezer bewaarde, met opnamedatum en plaats. Niet vergeleken met AirDrop. Slow motion, bewerkt, Filmisch, ProRes en een filmpje dat alleen in iCloud staat: niet getest (Wouter: overslaan).
8. **R2:** een deel met één byte te weinig geeft 403 `SignatureDoesNotMatch`; afronden lukt; terugtrekken lukt en haalt de deelbestanden weg; de downloadlink (GET met `response-content-disposition`) geeft het bestand. Links van 7 dagen neemt R2 aan.
9. **Vrije ruimte:** het getal van iOS loopt achter (soms geen verschil, soms 0,15 GiB terug). Niet gebruiken als bewijs; kijk of het bestand weg is.
10. **Kiezer bij een filmpje uit iCloud:** de knop stond ~3 minuten grijs zonder uitleg; ging de telefoon intussen slapen, dan was de app weg.
11. **Verkleinen stopt als de app de voorgrond verlaat** (`comprimeren`, ~50 s voor 4K van 2 min). Het toevoegscherm van WP37 houdt het scherm wakker, maar wie zelf de app verlaat, krijgt "verkleinen lukte niet". Dat geldt nu ook al voor elk filmpje in een album.

Nog open voor de gate van 38b: datering in R2 (upload over twee dagen spreiden), persoonlijke hotspot. Voor 38c: download in Safari en Chrome.

### Voorstel besluiten 38b (regie, na de spike)

21. **Alle delen meteen aan iOS** zodra het origineel is aangemeld, terwijl de app open is (geen rij van een paar tegelijk). Tijdelijk kost dat de grootte van het origineel nog eens aan schijfruimte; elk deelbestand gaat weg zodra het deel binnen is.
22. **Na wegvegen gaat de app verder bij het openen**, zonder dubbele delen. Geen herinnering in 38b; die komt mee als de app notificaties krijgt (Wouter, 2026-11-23).
23. **De kiezer geeft wat het lid in Foto's ziet.** Bij een bewerkt filmpje, slow motion of Filmisch is dat de getoonde versie, niet per se het ruwe bestand. Geen extra werk daarvoor.
24. **Tijdens het ophalen uit iCloud en het verkleinen** toont de app wat er gebeurt en houdt hij het scherm wakker (38c, toevoegscherm).
25. **Verkleinen dat stopt omdat de app de voorgrond verliet, probeert het opnieuw** zodra de app terug is (ook voor gewone filmpjes uit WP37).
26. **B van 38b mag de spike-code lezen en als start gebruiken** (`wp38b-spike`); A schrijft eerst de tests, zoals altijd.

### Besluiten Wouter na de spike (2026-11-23)

Besluiten 21–26: alle zes ja. Daarna A voor 38b.

## Spec-criticus 38b (A)

> A 2026-11-23, na besluiten 21–26. Bronnen: deze spec, de spike (`wp38b-spike`, `990fd2b`: `OriginalUploader.swift`, `OriginalFiles.swift`, `ClubalmanacUploadAppDelegate.swift`, het proefscherm), de backend van 38a (`convex/filmProjects.ts`), `videoUpload.ts` en `AddPhotosScreen.tsx` (WP37, WP39), `signOutAndWipe.ts` (WP29). Pariteit met de oude app: niet van toepassing, v1 kende geen originelen.

### De grens tussen 38b en 38c

**38b levert het gedrag en de data, 38c de schermen.** De gate van 38b moet het risico in iOS toetsen voordat er schermen zijn. Daarom zitten de schakelaar en de stand aan de kant van het gedrag in 38b, en hun plek in de schermen in 38c.

- **38b**:
  - de uploader in `clubalmanac-video` en de wachtrij met zijn runner;
  - het aanmelden na het album (A-invariant 18);
  - het verplaatsen en opruimen van de kopie;
  - besluit 25.
  - De beslissing of een origineel meegaat (`originalPlan`), met de ondergrens: die stond bij fix-cyclus 1, punt 6, nog bij 38c. Het is dezelfde beslissing als de grens en de vrije ruimte.
  - De instelling "Alleen via wifi": onthouden per toestel, standaard aan, en het omzetten van de sessie in iOS.
  - De stand per eigen origineel als functie (`ownOriginalStand`).
  - Account verwijderen wist de wachtrij.
  - Een proefscherm, alleen in dev-builds, voor de gate. B mag dat van de spike overnemen. Het toont de wachtrij met de stand, de schakelaar, terugtrekken en of het bestand er nog is.
- **38c**:
  - besluit 3 (A-invariant 17) en de teksten in het toevoegscherm, ook de melding bij `te_klein`, `te_groot` en `geen_ruimte`;
  - de schakelaar "Alleen via wifi" in het toevoegscherm en op de projectpagina (hij zet de instelling van 38b);
  - de stand op de projectpagina;
  - de knop Terugtrekken met de waarschuwing dat het definitief is;
  - de banner, starten en sluiten, de downloadpagina.

Tot 38c er is, gaat in 38b een nieuw filmpje mee als origineel zodra zijn groep een open project heeft (`listOpenForMe`). De backend zet het filmpje toch al in X (A-invariant 2).

### Invarianten 38b

*Getest in de pure modules (testcontract hieronder):*

1. **Gaat het origineel mee.** Bij "Toevoegen", per filmpje, in deze volgorde:
   - een build zonder uploader (de webapp, een oude build): niet;
   - de groep van het gekozen album heeft geen open project: niet;
   - onder 1 MiB of boven 2 GiB (dezelfde getallen als de backend): niet;
   - de vrije ruimte is kleiner dan het origineel plus 1 GiB: niet. Besluit 21 zet alle delen tegelijk op schijf. Kan de module de vrije ruimte niet geven, dan houdt dat het origineel niet tegen.

   Gaat het niet mee, dan gaat het filmpje gewoon naar het album en geldt voor de kopie van de kiezer de opruimregel van WP39.
2. **Bewaren zoals aangemeld.** De kopie van de kiezer wordt verplaatst, niet gekopieerd, naar een eigen map in Application Support:
   - buiten de iCloud-backup;
   - na de eerste ontgrendeling leesbaar, ook op de achtergrond met het scherm op slot.

   De grootte na het verplaatsen gaat naar `startOriginal`, bij de eerste aanmelding en bij elke hervatting. Het bestand wordt nooit gewijzigd of opnieuw geëxporteerd. Het verkleinen voor het album leest dit bestand. De opruimregels van WP39 (`dropCopies`, sluiten) wissen het niet.
3. **Aanmelden na het album** (A-invariant 18). De wachtrij krijgt het origineel bij "Toevoegen", met als stap: wacht op het album. Staat het filmpje in het album (`photoId`), dan aanmelden, op elk netwerk. Het origineel gaat weg in twee gevallen:
   - het filmpje krijgt een vaste reden;
   - de ronde sluit zonder dat het filmpje in het album staat.
4. **De wachtrij.**
   - Per filmpje hooguit één origineel. De sleutel is de upload-id van het filmpje voor het album (WP37).
   - Elk origineel hoort bij een user. Er gaan alleen aanroepen voor de user die nu is ingelogd.
   - Uitloggen pauzeert de wachtrij en wist niets. Account verwijderen (WP29, `signOutAndWipe` met user) wist alles van die user: iOS-taken, deelbestanden en bewaarde bestanden.
   - Laadt de wachtrij nog niet (bijvoorbeeld op slot), dan wacht Account verwijderen daar niet op. De runner onthoudt de user en wist alles van hem zodra het laden lukt (fix-cyclus 1, punt 4).
   - De wachtrij staat op schijf en overleeft een herstart. Hij bewaart geen links; die staan alleen in de opslag van de uploader.
   - De wachtrij en de opslag van de uploader hebben elk een versie. Een nieuwe versie zet er alleen velden bij; een oudere app leest wat hij kent (punt 9, runbook voor 38c). Een onleesbare wachtrij geeft een regel in het log met "onleesbaar".
   - Het laden wist niets wat in dit proces is aangemaakt: geen origineel en geen bestand dat het toevoegscherm net heeft verplaatst (punt 3). Het toevoegscherm wacht tot de wachtrij geladen is voordat het de kopie verplaatst. Neemt de wachtrij het origineel niet aan (`addOriginalToQueue` geeft `false`), dan ruimt het scherm het verplaatste bestand op zodra het verkleinen klaar is.
   - Hij draait vanuit de wortel van de app, ook als iOS de app op de achtergrond start, niet vanuit een scherm. In de webapp draait hij niet.
5. **Herstart en wegvegen** (besluit 22, red-team N1). Bij elke start van de app:
   - wat iOS nog heeft, loopt door, zonder `startOriginal`, zolang de bewaarde links gelden;
   - zijn alle delen klaar, dan afronden;
   - weet de uploader niets meer van het origineel, dan opnieuw aanmelden;
   - een origineel dat nog op zijn album wachtte, gaat weg: die ronde bestaat niet meer na een herstart;
   - iOS-taken en bestanden zonder origineel in de wachtrij gaan weg; die van een andere user blijven.
   - Heeft de uploader alleen een oudere generatie links dan de wachtrij, dan telt dat als "weet niets": opnieuw aanmelden. Zo blijft een origineel niet hangen als de app wegviel tussen het bewaren van de wachtrij en het doorgeven van de nieuwe links (punt 5).

   Gelden de links nog minder dan een dag, dan eerst nieuwe links, ook als de delen op wifi wachten. Zo gaat een deel niet met een verlopen link over de lijn.

   De geldigheid rekent de app vanaf het moment dat het antwoord binnenkwam, met de klok van het toestel: de links gelden `ORIGINAL_PART_LINK_SECONDS` (7 dagen). `expiresAt` staat in de klok van de server en vergelijkt de app niet met de eigen klok (punt 7). Loopt de klok van het toestel dagen voor of achter, dan vraagt de app toch pas na 6 dagen nieuwe links.
6. **Een mislukt deel.**
   - Na 403 (verlopen link, verkeerde grootte) of `NoSuchUpload`: opnieuw aanmelden. Veel delen tegelijk 403 geeft één aanmelding.
   - Anders (geen antwoord, 5xx, 429, andere 4xx): hetzelfde deel met dezelfde link opnieuw bij iOS, hooguit 5 mislukte pogingen. Daarna wacht het origineel een uur en meldt het opnieuw aan.
   - Hervatten loopt niet eindeloos. Na 3 aanmeldingen op rij waarbij R2 niet minder delen mist dan bij de vorige, wacht het origineel een dag. Dat geldt voor 403-rondes en voor steeds `missing` na afronden.
   - **Generaties** (punt 5). Elke ronde links krijgt een eigen generatie, ook twee rondes op hetzelfde moment. De app geeft hem mee aan de uploader; elk event van de uploader en elke taak in zijn stand heeft hem. Een event van een oudere generatie telt niet: geen "alle delen klaar", geen nieuwe aanmelding na 403, geen poging opnieuw.
7. **Aanroepen na elkaar.** Eén aanroep tegelijk (`startOriginal` of `finishOriginal`), voor de hele wachtrij.
   - Ook als een aanroep lang niets geeft (punt 2). De Convex-client houdt een action vast tot hij weer verbinding heeft. Een nieuwe aanroep gaat pas als de vorige een uitkomst heeft: een antwoord of een fout van de client. Een eigen time-out, terugkomst in de app, een wekker of een nieuwe sessie start er geen tweede naast. Komt het antwoord laat, dan telt het nog.
   - Volgorde: eerst afronden, dan hervatten, dan een nieuwe aanmelding; binnen elke soort de oudste eerst.
   - `te_vaak`: alles van die user wacht een uur. De grens glijdt, en een geweigerde aanroep telt in de backend niet mee.
   - `bezig`: alleen die nieuwe aanmelding wacht, tot een ander origineel van die user uit de wachtrij is, hooguit een uur. Hervatten en afronden gaan door.
   - Verder:

     | Uitkomst | Wachten |
     |---|---|
     | fout zonder reden | 1 minuut, bij elke volgende fout op rij langer, uiterlijk bij de tiende 1 uur, nooit langer (punt 8). Na een andere uitkomst weer 1 minuut. |
     | `uitgelogd` | 5 minuten |
     | onbekende reden | 1 uur |
     | `vol` | 1 dag (open vraag 1) |

   - Valt de verbinding weg, dan eerst één nieuwe poging, zoals WP37 (`withOneRetry`).
8. **Afronden pas als alle delen verstuurd zijn**, niet na elk deel. De uploader meldt "alle delen klaar".
   - `missing` betekent opnieuw aanmelden.
   - Afronden mag ook op de achtergrond (spike 2).
   - Kan de app dat niet, bijvoorbeeld zonder login met het scherm op slot, dan rondt de cron het binnen een uur af (A-invariant 9). Een ontbrekende login op de achtergrond wist nooit iets.
9. **Weg is weg.** In deze gevallen stopt de uploader alle taken van dat origineel en wist hij de deelbestanden. Ook het bewaarde bestand gaat weg, het origineel gaat uit de wachtrij, en de app meldt dat filmpje nooit meer aan:
   - binnen (`done`);
   - teruggetrokken (`withdraw` gelukt);
   - geweigerd met `niet_toegestaan`, `te_groot`, `te_klein` of `geen_video`;
   - een kapot bestand.

   Bij wachten of een fout blijft het bestand staan.
10. **Opruimen controleren aan het bestand** (spike 9). Na "weg" bestaan het bewaarde bestand en de deelbestanden van dat origineel niet meer. Het getal voor de vrije ruimte telt niet als bewijs.
11. **"Alleen via wifi"** (besluit 6, A-invariant 21).
    - Standaard aan, per toestel onthouden. Een onleesbare waarde telt als aan.
    - Bij twijfel aan (punt 6). Bij de start legt de app zijn eigen waarde naast die van de uploader; alleen als beide uit zeggen, is het uit. Kan de uploader zijn stand niet geven, dan aan. Lukt het bewaren of het omzetten bij de uploader niet, dan blijft de stand aan, in de app en bij de uploader.
    - Aan: wachten op mobiel internet, een persoonlijke hotspot (een duur netwerk), geen netwerk of een onbekend netwerk.
    - Aanmelden en afronden gaan op elk netwerk; alleen de delen wachten.
    - De stand per eigen origineel:

      | Stand | Wanneer |
      |---|---|
      | `binnen` | de backend zegt binnen |
      | `elders` | onderweg, maar niet in de wachtrij van dit toestel |
      | `wacht` | er loopt een wachttijd |
      | `wacht_op_wifi` | de delen zijn bij iOS en het netwerk is niet goed genoeg |
      | `wordt_verstuurd` | de rest |
12. **Besluit 25.** Was de app tijdens het verkleinen niet steeds `active`, dan is een mislukking geen fout van het filmpje. De app wacht tot hij weer `active` is en probeert het opnieuw:
    - met dezelfde upload-id;
    - zonder melding; het filmpje blijft "bezig" en het scherm blijft wakker zoals nu;
    - hooguit 3 keer op rij, daarna de gewone melding van WP37.

    Bleef de app voor, dan is het de gewone mislukking. Dit geldt ook voor filmpjes zonder origineel.

*Alleen in de native uploader (niet te unit-testen; gate):*

13. **Alle delen meteen aan iOS** (besluit 21).
    - Krijgt de uploader delen, dan snijdt hij ze allemaal, elk naar een eigen bestand met precies het stuk van het bewaarde bestand. Hij geeft ze meteen aan iOS.
    - Een deelbestand gaat weg zodra het deel klaar is.
    - Delen die op de achtergrond aan iOS gegeven zijn en nog niet lopen, gaan zodra de app voor komt (spike 3). Ook bij een koude start (punt 1): heeft iOS het proces opgeruimd, dan doet de uploader na het naast elkaar leggen bij het openen dezelfde controle als bij voorgrond. Wordt de app actief vóór dat klaar is, dan telt die controle alsnog.
    - Heeft het bewaarde bestand niet meer de aangemelde grootte, of is het weg, dan stuurt hij geen kort deel maar meldt hij een kapot bestand.
    - Lukt het snijden niet (geen ruimte), dan meldt hij een mislukking zonder status.
14. **Elk deel één keer onderweg** (spike 5).
    - Bij het openen legt de uploader zijn opslag naast de taken van iOS. Een deel zonder taak krijgt er precies één; een taak zonder deel stopt.
    - Nieuwe links voor een origineel vervangen de oude. Een deel dat met een oude link nog loopt, stopt eerst. De afloop van een taak met een oude link telt niet, niet als klaar en niet als mislukt.
    - Elke taak draagt de generatie van zijn links (punt 5). Events geven die generatie mee; "alle delen klaar" telt alleen de delen van de huidige generatie. De stand van de uploader (`uploaderJobs`) geeft per origineel de generatie.
    - Twee achtergrond-sessies met een vaste naam (alleen wifi zonder dure netwerken, en alles). Omzetten van de schakelaar verplaatst wachtende en lopende delen meteen. Een deel loopt nooit in beide.
    - Omzetten wacht niet op het snijden (punt 10). Delen die al bij iOS zijn, gaan meteen naar de andere sessie, ook als de uploader nog delen van een groot origineel aan het snijden is; de delen die daarna komen, gaan meteen in de goede sessie.
    - De eigen stand van de uploader is standaard aan; een onleesbare stand telt als aan (punt 6).
15. **Events naar de app.** Per deel klaar, of mislukt met de HTTP-status (of geen) en de foutcode van R2 (`<Code>`). Daarbij het aantal mislukte pogingen met de huidige link.
    - Een stop door iOS bij wegvegen (fout -999) telt niet als poging en is geen mislukking: bij het openen gaat het deel verder.
    - Eén event "alle delen klaar" per origineel.
    - Over een mislukking met status beslist de app (invariant 6), niet de uploader.
    - De terugroep van iOS voor een sessie gaat meteen; daarna houdt de app zichzelf 25 s wakker om de events te verwerken en af te ronden. Wat de app in die tijd niet haalt, rondt de cron af (regie, fix-cyclus 1; gate 8 laat zien wie afrondt). De achtergrond-upload van `expo-file-system` (het filmpje voor het album, WP37) blijft werken.
16. **Geen link, sleutel of pad** in een log, een event of de stand naar de app. Alleen inzending-id, deelnummer, status en foutcode.
17. **De opslag van de uploader heeft een versie** (punt 9). Een nieuwe versie zet er alleen velden bij. Is de opslag onleesbaar, dan een regel in het log, en de stand "Alleen via wifi" is aan.

### Testcontract 38b

> Namen en vormen zijn A-keuzes; het hoe is aan B. Pure modules, zonder React Native, in `app/src/lib/`.

**`originalUpload.ts`**

```ts
export const ORIGINAL_MIN_BYTES: number;          // 1 MiB, = MIN_ORIGINAL_BYTES
export const ORIGINAL_MAX_BYTES: number;          // 2 GiB, = MAX_ORIGINAL_BYTES
export const ORIGINAL_FREE_MARGIN_BYTES: number;  // 1 GiB
export const PART_ATTEMPTS: number;               // 5

export type OpenProject = { groupId: string; projectId: string };
export type OriginalPlan =
  | { kind: "mee"; projectId: string }
  | { kind: "niet"; reason: "geen_uploader" | "geen_project" | "te_klein" | "te_groot" | "geen_ruimte" };
export function originalPlan(input: {
  uploaderAvailable: boolean; groupId: string; openProjects: readonly OpenProject[];
  bytes: number; freeBytes: number | null;
}): OriginalPlan;

export type PlannedPart = { partNumber: number; offset: number; size: number };
export function planParts(bytes: number, partSize: number): PlannedPart[];
export type PartToSend = PlannedPart & { url: string };
export function partsToSend(bytes: number, partSize: number, links: readonly { partNumber: number; url: string }[]): PartToSend[] | null;

export type PartFailureAction = "opnieuw" | "opnieuw_aanmelden" | "later";
export function partFailure(failure: { status: number | null; code: string | null; attempts: number }): PartFailureAction;

export type Refusal = { kind: "geweigerd"; reason: string } | { kind: "fout" };
export function originalRefusal(error: unknown): Refusal;

export function wifiOnlyFromStore(stored: string | null): boolean;
export function wifiOnlyToStore(on: boolean): string;
export function wifiOnlyAtStart(stored: string | null, uploader: boolean | null): boolean;  // fix-cyclus 1, punt 6
export type NetworkView = { type: "wifi" | "mobiel" | "kabel" | "geen" | "anders" | "onbekend"; expensive: boolean };
export function waitsForWifi(wifiOnly: boolean, network: NetworkView): boolean;
```

- `planParts` geeft delen die aansluiten en allemaal even groot zijn behalve het laatste. Een ongeldige grootte geeft `[]`.
- `partsToSend` legt de links van `startOriginal` naast het plan. Een link voor een deel dat niet bestaat, of twee keer hetzelfde deel, geeft `null`.
- `originalRefusal`: `ORIGINAL_REFUSED` met zijn reden, of `onbekend` zonder reden. Al het andere is `fout`.

**`originalQueue.ts`**

```ts
export const WAIT_MS: { fout: number; uitgelogd: number; te_vaak: number; bezig: number; later: number; onbekend: number; vol: number; vast: number };
export const RESUME_ROUNDS: number;   // 3
export const LINK_MARGIN_MS: number;  // 1 dag

export type QueueEntry = {
  key: string; userId: string; projectId: string; fileName: string; bytes: number;
  photoId: string | null; originalId: string | null;
  step: "album" | "aanmelden" | "versturen" | "afronden";
  addedAt: number;
  // plus wat B nodig heeft (wachttijd, geldigheid van de links, rondes); geen links
};
export type StartResult =
  | { kind: "upload"; originalId: string; partSize: number; parts: { partNumber: number; url: string }[]; expiresAt: number }
  | { kind: "done"; originalId: string }
  | Refusal;
export type FinishResult = { kind: "done" } | { kind: "missing"; parts: number[] } | Refusal;
export type QueueEvent =
  | { kind: "album_klaar"; key: string; photoId: string }
  | { kind: "album_mislukt"; key: string }
  | { kind: "aangemeld"; key: string; result: StartResult }
  | { kind: "afgerond"; key: string; result: FinishResult }
  | { kind: "delen_klaar"; originalId: string; generation: number }
  | { kind: "deel_mislukt"; originalId: string; generation: number; partNumber: number; status: number | null; code: string | null; attempts: number }
  | { kind: "teruggetrokken"; originalId: string }
  | { kind: "bestand_kapot"; key: string };
export type Effect =
  | { kind: "aan_ios"; originalId: string; fileName: string; generation: number; parts: PartToSend[] }
  | { kind: "ios_opnieuw"; originalId: string; partNumber: number }
  | { kind: "ios_vergeten"; originalId: string }
  | { kind: "bestand_weg"; fileName: string };
export type QueueStep = { queue: QueueEntry[]; effects: Effect[] };

export function addOriginal(queue: QueueEntry[], input: { key: string; userId: string; projectId: string; fileName: string; bytes: number }, now: number): QueueEntry[];
export function applyEvent(queue: QueueEntry[], event: QueueEvent, now: number): QueueStep;
export type NextCall =
  | { kind: "start"; key: string; photoId: string; bytes: number }
  | { kind: "finish"; key: string; originalId: string };
export function nextCall(queue: readonly QueueEntry[], ctx: { now: number; userId: string | null }): NextCall | null;
export function nextWake(queue: readonly QueueEntry[], ctx: { now: number; userId: string | null }): number | null;
export type NativeJobView = {
  originalId: string;
  generation: number;
  parts: { partNumber: number; state: "wacht" | "bezig" | "klaar" | "mislukt"; status: number | null; code: string | null; attempts: number }[];
};
export function atLaunch(queue: QueueEntry[], native: { jobs: readonly NativeJobView[]; files: readonly string[] }, now: number): QueueStep;
export function forgetUser(queue: QueueEntry[], userId: string): QueueStep;
export type OwnStand = "binnen" | "wordt_verstuurd" | "wacht_op_wifi" | "wacht" | "elders";
export function ownOriginalStand(input: {
  status: "onderweg" | "binnen"; originalId: string; queue: readonly QueueEntry[];
  wifiOnly: boolean; network: NetworkView; now: number;
}): OwnStand;
export function queueToStore(queue: readonly QueueEntry[]): string;                               // punt 9
export function queueFromStore(raw: string | null): { queue: QueueEntry[]; broken: boolean };   // punt 9
```

- De runner past de effecten toe op de uploader en de bestanden, en bewaart de wachtrij.
- Hij vraagt `nextCall` om de volgende aanroep en zet een wekker op `nextWake`. Dat is het vroegste moment waarop iets dat nu wacht weer mag, of `null`.
- Een event voor een onbekende sleutel of inzending verandert niets.
- Fix-cyclus 1: `generation` is een getal dat `applyEvent` bij elke ronde links kiest en in `aan_ios` meegeeft; de uploader geeft hem terug. De geldigheid van de links in de wachtrij is die van het toestel (punt 7); de wachtrij bewaart nog steeds geen links.
- `queueToStore` schrijft JSON met bovenaan een geheel getal `version` (vanaf 1). `queueFromStore`: `null` is leeg en niet kapot; wat geen wachtrij van een bekende vorm is, is leeg en kapot; een hogere versie met extra velden leest wat deze app kent.

**De runner (`src/data/originals.ts`)**, getest met een nagebootste uploader en Convex-client (`tests/originals.test.ts`). De tests gebruiken alleen wat er al is: `startOriginals`, `setOriginalsSession`, `nudgeOriginals`, `addOriginalToQueue`, `originalEvent`, `forgetOriginalsOf`, `setOriginalsWifiOnly`, `originalsSnapshot`. Van de uploader-module verwachten ze daarnaast `uploaderWifiOnly` bij het laden. De namen van de bestanden in de opslag zijn aan B.

**`compressResume.ts`**

```ts
export const COMPRESS_AUTO_RETRIES: number;  // 3
export function leftForeground(appStates: readonly string[]): boolean;
export function afterCompressFailure(input: { leftForeground: boolean; autoRetries: number }): "opnieuw_als_actief" | "mislukt";
```

### Tests per invariant (stand na A)

| Inv. | Test (`app/tests/`) | Niet getest, omdat … |
|---|---|---|
| 38b-1 | `originalUpload.test.ts` (`originalPlan`, grenzen gelijk aan de backend) | de vrije ruimte van iOS: gate |
| 38b-2 | `originalQueue.test.ts` (dezelfde grootte bij elke aanmelding) | verplaatsen, map en bescherming: gate |
| 38b-3 | `originalQueue.test.ts` (album klaar of mislukt) | de aansluiting in het toevoegscherm: gate |
| 38b-4 | `originalQueue.test.ts` (één per sleutel, alleen de ingelogde user, `forgetUser`, `queueToStore`/`queueFromStore`), `originals.test.ts` (toevoegen tijdens het laden, Account verwijderen als het laden niet lukt, versie op schijf, log bij een onleesbare wachtrij) | vanuit de wortel; het toevoegscherm wacht op het laden en ruimt op na `false`: audit en gate |
| 38b-5 | `originalQueue.test.ts` (`atLaunch`, links bijna verlopen, oudere generatie bij de uploader, klok van het toestel) | |
| 38b-6 | `originalUpload.test.ts` (`partFailure`), `originalQueue.test.ts` (rondes, veel 403 tegelijk, generaties) | |
| 38b-7 | `originalQueue.test.ts` (volgorde, `te_vaak`, `bezig`, wachttijden, oplopend na `fout`), `originals.test.ts` (één aanroep tegelijk, ook als hij hangt of wegvalt) | |
| 38b-8 | `originalQueue.test.ts` (afronden) | op de achtergrond: gate |
| 38b-9 | `originalQueue.test.ts` (weg en nooit meer, het bestand blijft bij wachten) | |
| 38b-10 | | alleen op het toestel |
| 38b-11 | `originalUpload.test.ts` (wifi, `wifiOnlyAtStart`), `originalQueue.test.ts` (`ownOriginalStand`), `originals.test.ts` (bij twijfel aan) | hotspot en omzetten: gate |
| 38b-12 | `compressResume.test.ts` | de aansluiting op AppState: gate |
| 38b-13–17 | | native: gate en audit |

`originals.test.ts` staat in `app/tests/` (niet de backend-test met dezelfde naam).

### Gate 38b (op de iPhone, dev, met het proefscherm)

1. **Datering in R2** (open punt van 38a). Verstuur een upload over twee dagen: de helft vandaag, de rest morgen. Kijk in het R2-dashboard welke datum het object krijgt. Daarmee beslist regie het open punt.
2. **Persoonlijke hotspot** met "Alleen via wifi" aan: de delen wachten.
3. **Een origineel van ≥ 1 GB** (4K, 60 fps):
   - binnen op wifi, ook met de app op de achtergrond en het scherm uit;
   - de SHA-256 van het object in R2 is gelijk aan die van het bewaarde bestand.
4. **Wegvegen** tijdens het versturen, dan openen: hij gaat verder en het log toont elk deel één keer over de lijn. De telefoon herstarten: hij gaat ook verder.
   - *Koud* (punt 1): veeg weg, wacht een minuut, open de app met een tik en laat hem voor staan. Alle delen lopen binnen 20 s, zonder de app eerst te verlaten en terug te komen.
5. **Omzetten van de schakelaar**, tijdens het wachten en tijdens het versturen: het geldt meteen. Ook tijdens het snijden van een origineel van ≥ 1 GB (punt 10): de delen die al bij iOS zijn, wachten meteen (aan) of gaan meteen (uit).
6. **Delen die op de achtergrond aan iOS gegeven zijn**, bijvoorbeeld als het album pas klaar was na het verlaten van de app, gaan meteen zodra de app voor komt.
   - *Koud* (punt 1): hetzelfde, maar iOS ruimt het proces op vóór de app terugkomt (niet wegvegen: dan stopt iOS de taken). B geeft het proefscherm daarvoor een schakelaar (alleen dev): de app stopt zichzelf direct nadat hij op de achtergrond delen aan iOS gaf. Zet hem aan, voeg een filmpje toe, verlaat de app tijdens het verkleinen of versturen voor het album, wacht een minuut na "klaar", en open de app met een tik. De delen lopen binnen 20 s.
7. **De oprichter verwijdert het origineel in de webapp** tijdens het versturen. Op de iPhone:
   - een deel krijgt `NoSuchUpload`;
   - `startOriginal` geeft `niet_toegestaan`;
   - het bestand en de deelbestanden zijn weg.

   Hetzelfde na Terugtrekken op het proefscherm. Controleer met "bestaat het bestand", niet met de vrije ruimte.
8. **Afronden op de achtergrond met het scherm op slot**: binnen een uur binnen (door de app of door de cron).
9. **Besluit 25**: verlaat de app tijdens het verkleinen en kom terug. Het verkleinen gaat vanzelf verder, zonder "verkleinen lukte niet".
10. **Zonder project, of te klein**: een filmpje in een groep zonder project, en een clip onder 1 MiB, gaan alleen naar het album. Er komt geen bestand in de map van de originelen.
11. **Herstart tijdens het verkleinen** van het filmpje voor het album: na het openen staat er geen bestand meer in de map van de originelen.

Niet op het toestel te toetsen in redelijke tijd: links die na 7 dagen verlopen, `te_vaak`, `bezig` en `vol`. Die dekken de tests.

### Open vragen 38b (voor regie of Wouter)

1. **`vol`** (het project of het totaal zit aan de grens).
   - A-keuze: een dag wachten en opnieuw proberen. Een geweigerde aanroep kost niets, en de oprichter kan ruimte maken.
   - Dat duurt tot het project het origineel niet meer aanneemt (`niet_toegestaan`, dan weg).
   - Het alternatief is meteen weggooien. Aanbevolen: wachten.
2. **Uitloggen** laat wachtende originelen, met GPS, in de map van de app staan tot dezelfde user weer inlogt. Alleen Account verwijderen wist ze. Aanbevolen: zo laten.
3. **Herstart vóór het filmpje in het album staat.** Het origineel gaat weg. Het filmpje moet het lid opnieuw toevoegen; dat geldt in WP37 nu ook. Aanbevolen: aanvaarden.
4. **Bestand kapot of weg.** De app trekt niet vanzelf terug: terugtrekken blokkeert het filmpje voor altijd.
   - De inzending blijft "onderweg" (stand `elders`) en telt mee voor de 30 en het project, tot 14 dagen na sluiten.
   - Het lid kan hem in 38c terugtrekken.
   - Aanbevolen: aanvaarden.
5. **Langer dan 7 dagen geen wifi zonder de app te openen.** Delen die al bij iOS liggen, kunnen dan met een verlopen link gaan (403, wifi-data voor niets). Met de app open vernieuwt de wachtrij de links een dag vooraf. Aanbevolen: aanvaarden.

Geen backend-wijziging nodig: 38b gebruikt `startOriginal`, `finishOriginal`, `withdraw` en `listOpenForMe` zoals ze zijn. De daggrens van 600 laat ruimte voor de rondes hierboven.

**Stand na A (38b):**

- Drie nieuwe testbestanden, 106 tests, alle rood. De modules bestaan nog niet: `Cannot find module`.
- De app-typecheck faalt alleen op die drie imports.
- De bestaande 2118 app-tests blijven groen.
- A draaide de tests tegen een wegwerp-uitwerking. Die is niet gecommit en weggegooid. Zo is gecontroleerd dat de tests samen kloppen en typechecken.

### Besluiten Wouter na A van 38b (2026-11-23)

De vijf open vragen van A: alle vijf volgens het advies (bij `vol` wachten; na uitloggen blijven wachtende originelen staan; herstart vóór het album aanvaarden; kapot bestand aanvaarden; langer dan 7 dagen geen wifi aanvaarden). Daarna B voor 38b.

### 38b fix-cyclus 1 (audit en red-team, regie 2026-11-23)

Audit en red-team op `497f113`: geen blocker. Tests en typecheck groen. Te fixen (A eerst tests, dan B):

1. **Koude start (audit S1).** Geeft de app de delen op de achtergrond aan iOS en ruimt iOS het proces op, dan geeft de app ze bij de volgende start niet opnieuw: `becameActive` komt vóór het einde van `reconcile`. Na `reconcile` doet de app dezelfde controle als bij voorgrond. Gate 4 en 6 krijgen een koude variant.
2. **Offline geen stapel aanroepen (red-team Z1).** De Convex-client houdt een action vast tot hij weer verbinding heeft. De eigen time-out van 60 s laat dan steeds een nieuwe aanroep starten, die bij herverbinden allemaal tegelijk gaan. Eén aanroep tegelijk (38b-7) geldt ook als een aanroep "verloren" lijkt: geen nieuwe aanroep zolang de vorige niet echt is afgehandeld, of pas pompen met verbinding. B kiest; de test pint "nooit twee tegelijk, ook na een time-out".
3. **Toevoegen terwijl de wachtrij nog niet geladen is (audit N1, red-team N2).** `atLaunch` mag geen bestand of item wissen dat in dit proces is aangemaakt. De wachtrij is geladen vóór de kopie wordt verplaatst. Een `false` van `addOriginalToQueue` ruimt het verplaatste bestand op zodra het verkleinen klaar is.
4. **Account verwijderen met een wachtrij die niet laadt (audit N2).** De te wissen user wordt onthouden en gewist zodra het laden lukt.
5. **Events van oude links (audit N3, red-team N3).** Elke ronde links krijgt een generatie; events van een oudere generatie tellen niet.
6. **"Alleen via wifi" bij twijfel aan (red-team N1).** Verschillen JS en de uploader, dan telt aan. Lukt het bewaren niet, dan blijft de stand aan.
7. **Klok van het toestel (red-team N4).** De geldigheid van links rekent de app ten opzichte van de servertijd (`expiresAt` min de tijd van het antwoord), niet met de klok van het toestel.
8. **Oplopend wachten na `fout` (red-team N5):** 1 minuut, oplopend tot 1 uur.
9. **Kapotte opslag (audit N4, red-team N7c):** een regel in het log; de wachtrij en de opslag van de uploader krijgen een versie, en velden komen er alleen bij (runbook voor 38c).
10. **De wifi-schakelaar wacht niet op het snijden (red-team N7a):** omzetten geldt meteen voor delen die al bij iOS zijn.

**Regie, zonder fix:** de terugroep van iOS gaat meteen en de app houdt zelf 25 s wakker (audit N5, red-team N7b). Dat werkte in de spike; 38b-15 volgt dat gedrag, en de cron rondt af wat de app niet haalt (gate 8 laat zien wie afrondt). Vrije ruimte tijdens het snijden (audit N6) volgt uit besluit 21. Audit N7: aanvaard.

**Voor Wouter:** red-team N6. Verwijdert een lid zijn account op een ander toestel terwijl hier iemand anders is ingelogd, dan blijven zijn wachtende originelen (met GPS) hier staan. Voorstel: wachtende originelen van een user die niet is ingelogd, gaan na 30 dagen weg.

### Fix-cyclus 1 38b (A)

De tien punten staan nu in de invarianten 38b-4 tot en met 38b-17, het testcontract en de gate. Wat te testen is zonder iPhone:

| Punt | Gepind in | Hoe |
|---|---|---|
| 2 | `originals.test.ts` | een aanmelding of afronding die uren hangt (ook bij terugkomst, een wekker of een nieuwe sessie), en een client die elke aanroep na anderhalf uur opgeeft: nooit twee tegelijk; een laat antwoord telt nog |
| 3 | `originals.test.ts` | toevoegen terwijl het laden nog loopt: het origineel en zijn bestand blijven; een echt wees-bestand gaat weg |
| 4 | `originals.test.ts` | Account verwijderen terwijl het laden niet lukt: wacht niet; zodra het laden lukt, is alles van die user weg, ook na de volgende start; de andere user blijft |
| 5 | `originalQueue.test.ts` | `generation` in `aan_ios`, events en `NativeJobView`; oude events tellen niet; bij de start een oudere generatie bij de uploader: opnieuw aanmelden |
| 6 | `originalUpload.test.ts`, `originals.test.ts` | `wifiOnlyAtStart`; bij de start, bij een mislukt bewaren en bij een mislukt omzetten blijft hij aan |
| 7 | `originalQueue.test.ts` | met de klok 10 dagen voor of achter: nieuwe links pas 6 dagen na het antwoord, ook bij de start |
| 8 | `originalQueue.test.ts` | aanmelden en afronden: 1 minuut, steeds langer, bij de tiende fout 1 uur; na een andere uitkomst weer 1 minuut |
| 9 | `originalQueue.test.ts`, `originals.test.ts` | `queueToStore`/`queueFromStore` met `version`; een latere versie met extra velden; de runner schrijft zo; een onleesbare wachtrij geeft een regel met "onleesbaar" |

Punt 1, 10 en het native deel van 5, 6 en 9: invarianten 38b-13, 38b-14 en 38b-17, gate 4 en 6 (koud) en 5. 38b-15 volgt de keuze van regie (meteen terugroepen, 25 s wakker, de cron als vangnet).

Bestaande tests aangepast: in `originalQueue.test.ts` hebben `delen_klaar`, `deel_mislukt` en de taken bij `atLaunch` nu de generatie van de laatste `aan_ios` (punt 5), en de verwachte `aan_ios` heeft een `generation`. Verder niets.

**Stand na A (fix-cyclus 1):**

- 48 nieuwe tests. Rood: 42, om de goede reden: geen `generation`, `queueToStore`, `queueFromStore` of `wifiOnlyAtStart`, en de runner doet wat de audit zag. Groen: 6 die laten zien dat het nog werkt (beide uit blijft uit, de klok gelijk, links van 7 dagen, aanzetten als bewaren niet lukt, Account verwijderen als het laden lukt).
- 25 bestaande tests in `originalQueue.test.ts` zijn rood tot de generatie er is.
- De app-typecheck faalt alleen op die ontbrekende exports en velden. De andere 2118 app-tests blijven groen.
- A draaide de 146 tests van de wachtrij, de uploader en de runner tegen een wegwerp-uitwerking buiten de repo: alle groen. Die uitwerking is weggegooid.

**Open vragen (fix-cyclus 1):**

1. **Punt 7 zonder servertijd.** Het antwoord van `startOriginal` heeft geen tijd van de server. A-keuze: de app rekent `ORIGINAL_PART_LINK_SECONDS` (7 dagen) vanaf het moment dat het antwoord binnenkwam. Het alternatief is dat de backend zijn tijd meegeeft (een kleine wijziging in 38a). Aanbevolen: zo laten.
2. **Punt 4 over een herstart heen.** De runner onthoudt de te wissen user in het geheugen. Stopt de app voordat het laden lukt, dan blijven de originelen tot dezelfde user zijn account nog eens verwijdert. Bij Account verwijderen staat de app voor en is het toestel open, dus het laden faalt dan bijna nooit. Aanbevolen: aanvaarden.
3. **Een onleesbare wachtrij** maakt bij de start van alle bestanden en iOS-taken wezen: ze gaan weg, voor alle users. De inzendingen blijven "onderweg" (stand `elders`; het lid kan ze in 38c terugtrekken). Aanbevolen: aanvaarden; het log toont het.
4. **Een aanroep die nooit een uitkomst krijgt** houdt de wachtrij op dit toestel stil tot de app opnieuw start, ook voor een andere user die inlogt. De Convex-client geeft een uitkomst zodra hij weer verbinding heeft. Aanbevolen: aanvaarden.

**Regie op de open vragen van A (fix-cyclus 1):** alle vier volgens het advies. De app rekent 7 dagen vanaf het antwoord (geen wijziging in 38a); het onthouden van de te wissen user geldt alleen zolang de app draait; een onleesbare wachtrij wist alles op het toestel; een aanroep zonder uitkomst legt de wachtrij stil tot de volgende start.

### 38b fix-cyclus 2 (heraudit en red-team-hercheck, regie 2026-11-23)

Hercheck op `4f6e99a`: alle tien punten van fix-cyclus 1 dicht, geen blocker, geen Z. Te fixen (A eerst tests, dan B):

1. **De gate-schakelaar met `exit(0)` alleen in het geheugen** (audit N2, red-team N2). Een vlag in `UserDefaults` overleeft een productie-build op hetzelfde toestel (zelfde bundle-id). Geen bewaarde vlag; bij de start is hij uit.
2. **Een laat antwoord onder een andere user** (red-team N1). Wisselde de ingelogde user tijdens een aanroep, dan zegt de uitkomst niets over het origineel van de vorige user: tellen als `fout`, niets weggooien.
3. **Nieuwe links terwijl alle delen al binnen zijn** (red-team N3). Komt `upload` binnen terwijl de stap `afronden` is, dan blijven de links liggen en volgt `finishOriginal`; `missing` zegt wat er nog moet.
4. **Opslag op slot na een herstart** (red-team N4, audit). De uploader start pas als het toestel open is (`isProtectedDataAvailable`), en een leesfout is iets anders dan een bestand dat niet te decoderen is: bij een leesfout niets wissen en niets stoppen.
5. **Het verplaatste bestand pas weg bij een eindstand** (audit N1, red-team). Neemt de wachtrij het origineel niet aan, dan gaat het bestand pas weg als het filmpje in het album staat, een vaste reden kreeg of de ronde eindigt; niet na een uitkomst die het lid opnieuw kan proberen.
6. **Een deelbestand dat na `klaar` nog gesneden werd, gaat weg** in `sliced` (38b-13).

Patroon voor het track-record: een late uitkomst van een async aanroep toetsen aan de sessie van toen (eerder ook in WP37).
