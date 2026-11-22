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

- **Inventarissen.** De nieuwe paden voldoen aan de regels: `get`, `listForGroup` en `listOpenForMe` hebben een return-validator zonder `any` of `record`; `open` heeft de gate van de beheerpaden; `GET` en `OPTIONS /beeld/inzending/*` volgen de regel van WP35 (preflight alleen op paden met een token). Geen probleem met een gate gevonden. Kleine afwijking, geen gate: het beeldpad van een inzending neemt `?formaat=origineel` aan (geeft dan *groot*), waar `/beeld/foto/` dat met 400 weigert.
- **Test "een ontbrekend deel".** Deel 1 bestond uit nullen, dus de `ftyp`-controle weigerde terecht. Deel 1 begint nu met de echte bytes van een filmpje.
- **B-keuzes, door A bevestigd:**
  - *Opnieuw aanmelden met een andere grootte* weigert met `niet_toegestaan`, en de inzending blijft zoals hij is. Een andere grootte is een ander bestand; zo komen delen van twee bestanden nooit in één origineel. De app trekt eerst terug (38b).
  - *Een gesloten project zonder originelen* is meteen uit de groep; de rij mag nog even blijven (geen originelen, geen GPS). De test legt alleen de bovengrens vast: na een jaar en 14 dagen is hij weg.
  - *Herinnering*: één mail per project aan de oprichter van nu, met het aantal en de eerste en laatste datum. Geen tweede mail. Wat na de mail nog binnenkomt (alleen bij een project dat bijna een jaar open staat), krijgt geen eigen herinnering: dat is aanvaardbaar.
  - *Bestandsnaam zonder opnamedatum*: datum en tijd van inzenden in Nederlandse tijd (CET en CEST).

**Stand na A (na B):** 16 rood voor B: `setEndsAt` (6 tests in `projects.test.ts`, 1 in `inventory.test.ts`), `albumId` leeg na het verwijderen van het filmalbum (1 in `cascade.test.ts`), WP10 (3 in `integrity.test.ts`, 3 in `tests/migration/sharedLists.test.ts`, 2 in `tests/migration/migrationFunctions.test.ts`). De rest is groen, ook de nieuwe tests voor besluiten 11, 12, 15, 16, 17 en 18 en de vier B-keuzes. Typecheck schoon.
