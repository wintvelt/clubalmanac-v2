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
- **Mockup** (Wouter akkoord, 2026-11-24): `builds/filmproject-mockup.html` (gitignored, alleen op de server). Groep met balk, projectpagina, toevoegscherm met splitsen, starten en sluiten, downloadpagina in de webapp. Leidraad voor 38c.

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
   - **Een user die niet meer inlogt** (besluit red-team N6). Originelen van een user die niet is ingelogd, gaan na 30 dagen van het toestel: bestand, deelbestanden en iOS-taken, zoals bij Account verwijderen. Geen aanroep naar de backend; de inzending blijft "onderweg", zoals bij een kapot bestand (open vraag 4).
     - De 30 dagen tellen vanaf het laatste moment dat de app die user ingelogd zag: bij inloggen, bij het laden, bij terugkomst in de app, bij toevoegen, en op het moment dat hij uitlogt of een ander inlogt.
     - Dat moment wordt nooit vroeger. Springt de klok terug, dan blijft het laatste moment staan. Staat de klok bij de controle vóór dat moment, dan gaat er niets weg.
     - De app controleert bij het laden en bij elke login (een andere user, of dezelfde opnieuw).
     - Wie nu is ingelogd, verliest op grond van deze regel nooit iets. Is niemand ingelogd, dan gaat er niets weg: een ontbrekende login wist nooit iets (38b-8).
     - Het moment staat in de wachtrij op schijf. In een wachtrij van vóór deze regel telt het moment van toevoegen.
   - De wachtrij staat op schijf en overleeft een herstart. Hij bewaart geen links; die staan alleen in de opslag van de uploader.
   - De wachtrij en de opslag van de uploader hebben elk een versie. Een nieuwe versie zet er alleen velden bij; een oudere app leest wat hij kent (punt 9, runbook voor 38c). Een onleesbare wachtrij geeft een regel in het log met "onleesbaar".
   - Het laden wist niets wat in dit proces is aangemaakt: geen origineel en geen bestand dat het toevoegscherm net heeft verplaatst (punt 3). Het toevoegscherm wacht tot de wachtrij geladen is voordat het de kopie verplaatst.
   - Neemt de wachtrij het origineel niet aan (`addOriginalToQueue` geeft `false`), dan blijft het verplaatste bestand tot een eindstand (fix-cyclus 2, punt 5). Een eindstand is: het filmpje staat in het album, het kreeg een vaste reden, of de ronde eindigt (sluiten of een nieuwe keuze). Na een uitkomst die het lid opnieuw kan proberen (`videoRetryable`), blijft het staan: "Opnieuw proberen" en besluit 25 verkleinen weer uit dat bestand. Hetzelfde onderscheid geldt voor een origineel in de wachtrij (38b-3). Wat het scherm laat staan, ruimt de volgende start op (wezen, 38b-5).
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
   - **Een andere user tussendoor** (fix-cyclus 2, punt 2). De Convex-client stuurt een vastgehouden action pas bij herverbinden, met de login van dat moment. Was er tijdens de aanroep een andere user ingelogd, dan zegt de uitkomst niets over het origineel. Dat geldt ook als de eerste user weer terug is als het antwoord komt. De uitkomst telt dan als `fout`, wat hij ook zegt (`niet_toegestaan`, `te_vaak`, links of binnen):
     - niets weg, niets aan iOS;
     - opnieuw na de wachttijd van een fout, voor de user van het origineel.

     Alleen uitloggen tussendoor is geen wissel: zonder login geeft de backend `uitgelogd`. Dezelfde user met een nieuwe client ook niet.
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
   - **Nieuwe links tijdens afronden** (fix-cyclus 2, punt 3). Liep er een hervatting (bijvoorbeeld omdat de links bijna verliepen) terwijl iOS de laatste delen verstuurde, dan komen er links binnen terwijl de stap al afronden is. Die links blijven liggen: niets aan iOS, geen nieuwe generatie, en `finishOriginal` volgt. Zegt die `missing`, dan opnieuw aanmelden; de links van die ronde gaan wel aan iOS.
   - **Een andere uitkomst van die hervatting** (fix-cyclus 3, punt 4): `te_vaak`, `vol`, `uitgelogd`, een onbekende reden of een fout zet geen wachttijd op het afronden. `finishOriginal` volgt meteen, en een fout telt niet mee voor het oplopend wachten van het afronden. Alleen wat het origineel voorgoed doet weggaan, geldt: een definitieve weigering (`niet_toegestaan`, `te_groot`, `te_klein`, `geen_video`) of binnen (`done`). Of `te_vaak` dan nog geldt voor de andere originelen van die user, is aan B.
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
    - Bij twijfel aan (punt 6). Bij de start legt de app zijn eigen waarde naast die van de uploader; alleen als beide uit zeggen, is het uit. Lukt het bewaren of het omzetten bij de uploader niet, dan blijft de stand aan, in de app en bij de uploader.
    - **Een wekking zet hem niet blijvend aan** (fix-cyclus 3, punt 3). Bij het laden vraagt de runner eerst `uploaderJobs` en pas daarna de stand van de uploader. Lukt `uploaderJobs` niet (de uploader kon zijn opslag nog niet lezen), dan laadt de runner niet en verandert hij niets aan de stand. Kan de uploader daarna zijn stand niet geven, of kan de app zijn eigen waarde niet lezen (een leesfout, geen onleesbare waarde), dan geldt aan voor nu. Dat wordt niet bewaard, niet in de app en niet bij de uploader: bij het volgende laden telt weer wat er bewaard is.
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
    - Is een deel klaar of niet meer nodig als zijn snijden afloopt (fix-cyclus 2, punt 6), dan gaat het deelbestand meteen weg. Na "klaar" staat er van dat deel geen bestand meer, ook niet als het snijden later afliep dan het versturen.
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
    - Onleesbaar betekent: het bestand is gelezen, maar de inhoud is geen opslag van een bekende vorm. Een leesfout is iets anders (38b-18).
18. **Op slot na een herstart** (fix-cyclus 2, punt 4; fix-cyclus 3, punt 1). Na een herstart van de telefoon zijn de bestanden van de app tot de eerste ontgrendeling niet te lezen. iOS kan de app in die tijd op de achtergrond wekken. Na de eerste ontgrendeling zijn ze leesbaar, ook met het scherm op slot (38b-2).
    - **Geen poort op de stand van het toestel.** `isProtectedDataAvailable` is ook `false` als het scherm gewoon op slot is, lang na de eerste ontgrendeling. De uploader kijkt er niet naar om te beslissen of hij start. Hij leest zijn opslag; of dat lukt, beslist.
    - Lukt het lezen niet, dan probeert hij het later opnieuw: na een korte tijd en zodra het toestel open gaat. Tot het lukt, legt hij niets naast elkaar en start hij geen taak. Hij stopt ook niets, wist niets en schrijft niets weg, ook geen lege opslag.
    - Een leesfout van zijn opslag (op slot of een andere fout) is geen onleesbare opslag. Dan geen lege start, geen taak stoppen en niets wissen.
    - Zolang het lezen niet lukte, geven `uploaderJobs` en de stand "Alleen via wifi" een fout, geen lege lijst of standaard. De runner laadt dan niet en probeert het later (38b-4, 38b-11; getest).
    - `readState` geeft `null` alleen als het bestand er niet is. Een leesfout gaat als fout naar de app (zoals nu).
    - Lukte het lezen eerst niet en later wel, dan schrijft de uploader een regel in het log ("op slot"), eventueel pas na het ontgrendelen. Met het scherm op slot na de eerste ontgrendeling lukt het lezen meteen: dan geen "op slot".
    - Wat iOS in die tijd meldde en verloren gaat, kost hooguit dat een deel nog eens over de lijn gaat (38b-14). Nooit stopt een taak of verdwijnt een bestand.
19. **De gate-schakelaar "stoppen na delen op de achtergrond"** (gate 6 koud, fix-cyclus 2, punt 1) staat alleen in het geheugen. Niet in `UserDefaults` of een bestand, want een productie-build op hetzelfde toestel (zelfde bundle-id) zou een bewaarde vlag lezen. Bij elke start van de app staat hij uit. Alleen een dev-build kan hem aanzetten.
20. **Eerst de opslag, dan de sessies** (fix-cyclus 3, punt 2).
    - Bij het aanmaken leest de uploader zijn opslag synchroon, vóór hij de twee achtergrond-sessies aanmaakt. Een terugroep van iOS (een deel klaar of mislukt) vindt zo zijn deel.
    - Lukt het lezen dan niet (op slot, 38b-18), dan maakt hij de sessies toch. Wat iOS meldt voordat het laden lukt, gaat niet verloren omdat het deel nog onbekend is. Hij bewaart die events in het geheugen, in volgorde, en verwerkt ze na het laden zoals ze kwamen: een deel klaar telt, een mislukking met status gaat naar de app. De regels voor een oude link of generatie (38b-14) gelden ook dan.
    - Die bewaarde events gaan vóór het naast elkaar leggen (38b-14). Een deel dat klaar meldde terwijl het laden wachtte, heeft daarna geen taak meer bij iOS, maar krijgt er geen nieuwe: het is klaar.
    - Gaat het proces weg voordat het laden lukt, dan zijn die events weg. Dat kost hooguit dat een deel nog eens over de lijn gaat (38b-18).

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

Fix-cyclus 2, punt 5, het verplaatste bestand in de ronde van het toevoegscherm (ook in `originalUpload.ts`):

```ts
export type VideoOutcome = { ok: true; photoId: string } | { ok: false; reason: VideoFailReason };  // WP37
export type MovedOriginalAction =
  | { kind: "album_klaar"; photoId: string }   // in de wachtrij: dat event
  | { kind: "album_mislukt" }                  // in de wachtrij: dat event
  | { kind: "bestand_weg" }                    // niet in de wachtrij: het verplaatste bestand weg
  | { kind: "laten" };                         // niets
export function originalAfterVideo(input: { queued: boolean; outcome: VideoOutcome }): MovedOriginalAction;
export function originalAtRoundEnd(input: { queued: boolean; inAlbum: boolean }): MovedOriginalAction;
```

- `originalAfterVideo`: na de uitkomst van het filmpje voor het album (na besluit 25). Opnieuw te proberen (`videoRetryable`) is `laten`. Anders in de wachtrij het event, en niet in de wachtrij `bestand_weg`.
- `originalAtRoundEnd`: in de wachtrij en niet in het album `album_mislukt`, in het album `laten`. Niet in de wachtrij altijd `bestand_weg`.
- Het toevoegscherm volgt deze twee. De aansluiting toetsen audit en gate.

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
export const ABSENT_USER_MS: number;  // 30 dagen (besluit red-team N6)
export function seenUser(queue: QueueEntry[], userId: string, now: number): QueueEntry[];
export function dropAbsent(queue: QueueEntry[], ctx: { now: number; userId: string | null }): QueueStep;
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
- Besluit red-team N6: elk origineel onthoudt wanneer de app zijn user voor het laatst ingelogd zag (het veld is aan B). `addOriginal` zet het op `now`. `seenUser` zet het voor die user op `now`, maar nooit vroeger dan het was. `dropAbsent` haalt de originelen weg van elke user behalve `ctx.userId` die `ABSENT_USER_MS` of langer niet gezien is, met `ios_vergeten` en `bestand_weg`; met `userId` `null` niets. `queueFromStore` leest een origineel zonder dat moment als niet kapot, met het moment van toevoegen.

**De runner (`src/data/originals.ts`)**, getest met een nagebootste uploader en Convex-client (`tests/originals.test.ts`). De tests gebruiken alleen wat er al is: `startOriginals`, `setOriginalsSession`, `nudgeOriginals`, `addOriginalToQueue`, `originalEvent`, `forgetOriginalsOf`, `setOriginalsWifiOnly`, `originalsSnapshot`. Van de uploader-module verwachten ze daarnaast `uploaderWifiOnly` bij het laden; fix-cyclus 3: pas na `uploaderJobs` (punt 3). De namen van de bestanden in de opslag zijn aan B. Fix-cyclus 2: de user van een aanroep is de user van `setOriginalsSession` toen hij begon. Elke `setOriginalsSession` met een andere user dan die (niet `null`) tijdens de aanroep maakt de uitkomst een `fout` (punt 2). Besluit red-team N6: de runner geeft de user door aan `seenUser` bij `setOriginalsSession` (de nieuwe en de vorige), bij het laden, bij `nudgeOriginals` en bij toevoegen. Hij roept `dropAbsent` aan na het laden en bij elke `setOriginalsSession` met een user.

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
| 38b-4 | `originalQueue.test.ts` (één per sleutel, alleen de ingelogde user, `forgetUser`, `queueToStore`/`queueFromStore`, 30 dagen: `dropAbsent`, `seenUser`), `originals.test.ts` (toevoegen tijdens het laden, Account verwijderen als het laden niet lukt, versie op schijf, log bij een onleesbare wachtrij, de uploader kan niet lezen, 30 dagen bij het laden en bij een login), `originalUpload.test.ts` (`originalAfterVideo`, `originalAtRoundEnd`) | vanuit de wortel; het toevoegscherm wacht op het laden en volgt de twee functies: audit en gate |
| 38b-5 | `originalQueue.test.ts` (`atLaunch`, links bijna verlopen, oudere generatie bij de uploader, klok van het toestel) | |
| 38b-6 | `originalUpload.test.ts` (`partFailure`), `originalQueue.test.ts` (rondes, veel 403 tegelijk, generaties) | |
| 38b-7 | `originalQueue.test.ts` (volgorde, `te_vaak`, `bezig`, wachttijden, oplopend na `fout`), `originals.test.ts` (één aanroep tegelijk, ook als hij hangt of wegvalt; een andere user tussendoor) | |
| 38b-8 | `originalQueue.test.ts` (afronden, nieuwe links of een andere uitkomst tijdens afronden) | op de achtergrond: gate |
| 38b-9 | `originalQueue.test.ts` (weg en nooit meer, het bestand blijft bij wachten) | |
| 38b-10 | | alleen op het toestel |
| 38b-11 | `originalUpload.test.ts` (wifi, `wifiOnlyAtStart`), `originalQueue.test.ts` (`ownOriginalStand`), `originals.test.ts` (bij twijfel aan; eerst `uploaderJobs`, een wekking bewaart niets) | hotspot en omzetten: gate |
| 38b-12 | `compressResume.test.ts` | de aansluiting op AppState: gate |
| 38b-13–20 | | native: gate en audit |

`originals.test.ts` staat in `app/tests/` (niet de backend-test met dezelfde naam).

### Gate 38b (op de iPhone, dev, met het proefscherm)

1. **Datering in R2** (open punt van 38a). Verstuur een upload over twee dagen: de helft vandaag, de rest morgen. Kijk in het R2-dashboard welke datum het object krijgt. Daarmee beslist regie het open punt.
2. **Persoonlijke hotspot** met "Alleen via wifi" aan: de delen wachten.
3. **Een origineel van ≥ 1 GB** (4K, 60 fps):
   - binnen op wifi, ook met de app op de achtergrond en het scherm uit;
   - daarna staat er van dat origineel geen deelbestand meer (38b-13, fix-cyclus 2, punt 6). Controleer met het aantal bestanden, niet met de vrije ruimte;
   - de SHA-256 van het object in R2 is gelijk aan die van het bewaarde bestand.
4. **Wegvegen** tijdens het versturen, dan openen: hij gaat verder en het log toont elk deel één keer over de lijn. De telefoon herstarten: hij gaat ook verder.
   - *Koud* (punt 1): veeg weg, wacht een minuut, open de app met een tik en laat hem voor staan. Alle delen lopen binnen 20 s, zonder de app eerst te verlaten en terug te komen.
5. **Omzetten van de schakelaar**, tijdens het wachten en tijdens het versturen: het geldt meteen. Ook tijdens het snijden van een origineel van ≥ 1 GB (punt 10): de delen die al bij iOS zijn, wachten meteen (aan) of gaan meteen (uit).
6. **Delen die op de achtergrond aan iOS gegeven zijn**, bijvoorbeeld als het album pas klaar was na het verlaten van de app, gaan meteen zodra de app voor komt.
   - *Koud* (punt 1): hetzelfde, maar iOS ruimt het proces op vóór de app terugkomt (niet wegvegen: dan stopt iOS de taken). B geeft het proefscherm daarvoor een schakelaar (alleen dev): de app stopt zichzelf direct nadat hij op de achtergrond delen aan iOS gaf. Zet hem aan, voeg een filmpje toe, verlaat de app tijdens het verkleinen of versturen voor het album, wacht een minuut na "klaar", en open de app met een tik. De delen lopen binnen 20 s.
   - *De schakelaar is niet bewaard* (38b-19, fix-cyclus 2, punt 1): zet hem aan, veeg de app weg en open hem. De schakelaar staat uit. Na de koude variant hierboven staat hij ook uit.
   - *Koud, met het scherm op slot* (38b-18 en 38b-20, fix-cyclus 3, punt 1 en 2). De telefoon is sinds de laatste herstart al eens ontgrendeld. Op wifi, aan de lader: zet de schakelaar aan, voeg een filmpje toe, verlaat de app tijdens het verkleinen of versturen voor het album en zet het scherm op slot. Laat het een uur op slot. Ontgrendel dan en kijk in het log op het proefscherm, naar de regels van vóór het ontgrendelen:
     - de uploader startte op de achtergrond, met het scherm op slot;
     - geen regel "op slot" en geen "niet te lezen";
     - elk deel één keer over de lijn;
     - de app riep `finishOriginal` aan, op de achtergrond.

     Liepen de delen in dat uur niet, dan is de gate niet getoetst: opnieuw, en langer wachten.
7. **De oprichter verwijdert het origineel in de webapp** tijdens het versturen. Op de iPhone:
   - een deel krijgt `NoSuchUpload`;
   - `startOriginal` geeft `niet_toegestaan`;
   - het bestand en de deelbestanden zijn weg.

   Hetzelfde na Terugtrekken op het proefscherm. Controleer met "bestaat het bestand", niet met de vrije ruimte.
8. **Afronden op de achtergrond met het scherm op slot**: binnen een uur binnen (door de app of door de cron).
9. **Besluit 25**: verlaat de app tijdens het verkleinen en kom terug. Het verkleinen gaat vanzelf verder, zonder "verkleinen lukte niet".
10. **Zonder project, of te klein**: een filmpje in een groep zonder project, en een clip onder 1 MiB, gaan alleen naar het album. Er komt geen bestand in de map van de originelen.
11. **Herstart tijdens het verkleinen** van het filmpje voor het album: na het openen staat er geen bestand meer in de map van de originelen.
12. **Op slot na een herstart** (38b-18, fix-cyclus 2, punt 4; fix-cyclus 3, punt 1 en 3).
    - Een app openen vóór de eerste ontgrendeling kan niet: na een herstart vraagt iOS eerst de toegangscode. Wel kan iOS de app op de achtergrond wekken, bijvoorbeeld als een deel klaar is.
    - Daarom: herstart de telefoon tijdens het versturen van een origineel van ≥ 1 GB, op wifi, aan de lader. Ontgrendel hem 15 minuten niet. Ontgrendel dan en open de app.
    - Het log toont: geen "onleesbaar", geen gestopte taken, elk deel hooguit één keer opnieuw over de lijn, en het origineel gaat verder tot binnen. De schakelaar "Alleen via wifi" staat zoals hij stond.
    - Doe het ook één keer met "Alleen via wifi" uit. Na het ontgrendelen staat hij nog uit, ook na het opnieuw openen van de app.
    - Staat er een regel "op slot" in het log, dan is de wekking vóór het ontgrendelen gezien en lukte het lezen toen niet. Staat hij er niet, dan heeft iOS de app niet gewekt. Dan dekt de audit dat pad, en regie noteert het als open punt.
13. **Opnieuw proberen na een origineel dat de wachtrij niet aannam** (fix-cyclus 2, punt 5). Alleen als B dat op het proefscherm kan nabootsen, bijvoorbeeld met een dev-schakelaar "wachtrij weigert". Voeg een filmpje toe in een groep met een project. Zet tijdens het versturen voor het album de vliegtuigmodus aan en wacht op de melding over de verbinding. Zet de vliegtuigmodus uit en tik "Filmpjes opnieuw proberen". Het filmpje komt in het album. Na sluiten staat er geen bestand meer in de map van de originelen.

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

### Fix-cyclus 2 38b (A)

De zes punten staan nu in de invarianten 38b-4, 38b-7, 38b-8, 38b-13, 38b-17 tot en met 38b-19, het testcontract en de gate.

| Punt | Gepind in | Hoe |
|---|---|---|
| 1 | 38b-19, gate 6 | native: alleen in het geheugen, bij de start uit |
| 2 | `originals.test.ts` | een aanmelding of afronding hangt, U2 logt in, dan het antwoord (`niet_toegestaan`, `te_vaak`, links). Ook als U al terug is. Steeds: niets weg, niets aan iOS, na 1 minuut opnieuw voor U. Alleen uitloggen tussendoor of dezelfde user: het antwoord telt |
| 3 | `originalQueue.test.ts` | links tijdens afronden: niets aan iOS, `finishOriginal` volgt, een oud event verandert niets; `missing` daarna stuurt de nieuwe links wel; `done` is binnen |
| 4 | 38b-17, 38b-18, gate 12; `originals.test.ts` | de uploader kan zijn opslag niet lezen: niets weg, de wachtrij blijft op schijf, later verder (groen: dat deel in JS werkt al) |
| 5 | `originalUpload.test.ts` | `originalAfterVideo` en `originalAtRoundEnd`, voor elke reden van WP37 volgens `videoRetryable`; gate 13 als B het kan nabootsen |
| 6 | 38b-13, gate 3 | native: geen deelbestand na "klaar" |

**Stand na A (fix-cyclus 2):**

- 51 nieuwe tests, 47 rood om de goede reden:
  - 37 in `originalUpload.test.ts`: `originalAfterVideo` en `originalAtRoundEnd` bestaan nog niet.
  - 5 in `originalQueue.test.ts`: links tijdens afronden gaan nu aan iOS.
  - 5 in `originals.test.ts`: een antwoord onder een andere user telt nu gewoon.
- Groen: 4. De lijst met redenen van WP37, de uploader die niet kan lezen, en de 2 controles van punt 2 (uitloggen tussendoor, dezelfde user).
- Bestaande tests niet aangepast. De andere 2272 app-tests blijven groen.
- De app-typecheck faalt alleen op de twee ontbrekende exports.
- A draaide alle app-tests tegen een wegwerp-uitwerking buiten de repo: alle groen, typecheck schoon. Die uitwerking is weggegooid.

**Open vragen (fix-cyclus 2):**

1. **Punt 2, eerst U2 en dan weer U.** A pint: ook dan `fout`. De action kan tijdens U2 zijn verstuurd. Kost hooguit een minuut. Aanbevolen: zo laten.
2. **Punt 4 zonder wekking.** Wekt iOS de app niet vóór de eerste ontgrendeling, dan toetst gate 12 alleen dat de herstart niets kapotmaakt. Het pad "op slot" dekt dan alleen de audit. Aanbevolen: aanvaarden.
3. **Punt 5 op het toestel.** Zonder een dev-schakelaar is "de wachtrij neemt het niet aan" niet na te bootsen; gate 13 vervalt dan en de audit toetst de aansluiting. Aanbevolen: B beslist of de schakelaar goedkoop is.

**Regie op de open vragen van A (fix-cyclus 2):** 1 zo laten (ook bij terug naar U telt het antwoord als `fout`); 2 aanvaarden; 3 geen dev-schakelaar voor "de wachtrij weigert": gate 13 vervalt, de audit toetst de aansluiting van het scherm.

**Wouter op red-team N6 (2026-11-23): ja.** Wachtende originelen van een user die niet is ingelogd, gaan na 30 dagen van het toestel (bestand, deelbestanden, iOS-taken). Na fix-cyclus 2: A tests, dan B.

### 30 dagen voor originelen van een andere user (A)

Het besluit staat in 38b-4 en in het testcontract (`ABSENT_USER_MS`, `seenUser`, `dropAbsent`).

| Keuze | Waarom |
|---|---|
| De 30 dagen tellen vanaf het laatste moment dat de app de user ingelogd zag, ook bij uitloggen, een wissel en terugkomst in de app | Het gaat om een user die weg is, bijvoorbeeld omdat hij zijn account elders verwijderde. Een origineel kan weken stilstaan (`vol`) terwijl zijn user gewoon inlogt; de laatste stap in de wachtrij zegt dus niets. Wie 60 dagen ingelogd bleef, telt vanaf zijn uitloggen, niet vanaf zijn login. |
| Controle bij het laden en bij elke login | Op die momenten is bekend wie er is ingelogd. In het geval van red-team N6 logt er hier een ander in. |
| Zonder login nooit | Op de achtergrond kan de sessie nog ontbreken terwijl de user wel is ingelogd. Zo blijft 38b-8 gelden: een ontbrekende login wist nooit iets. |
| Het moment wordt nooit vroeger | Een klok die terug springt, mag het moment niet naar het verleden halen: anders gaat er te vroeg iets weg zodra de klok weer klopt. |

Gepind in `originalQueue.test.ts`:
- 29 dagen blijft, 30 dagen min een minuut blijft, 30 dagen weg;
- de user die nu is ingelogd, en niemand ingelogd: niets weg;
- `seenUser` alleen voor die user, en nooit vroeger;
- elke user apart;
- over `queueToStore`/`queueFromStore` heen, ook een wachtrij van vóór deze regel.

Gepind in `originals.test.ts`:
- bij de start en bij een login: 29 dagen blijft, 30 dagen weg, ook op schijf;
- 400 dagen zonder login: niets weg, pas bij de login van een ander;
- de ingelogde user na 400 en 800 dagen: niets weg;
- de 30 dagen tellen vanaf uitloggen of een wissel na 60 dagen ingelogd;
- terugkomst in de app na 40 dagen telt als gezien;
- de klok 40 dagen terug: niets weg vóór 30 dagen na het echte laatste moment.

`vi.clearAllTimers()` zet de nagebootste klok terug naar het moment van `useFakeTimers`. Daarom start dit blok de app met een eigen `bootAt`, die de klok pas daarna zet.

**Stand na A (30 dagen):**

- 20 nieuwe tests, alle rood om de goede reden:
  - 12 in `originalQueue.test.ts`: `ABSENT_USER_MS`, `seenUser` en `dropAbsent` bestaan niet;
  - 8 in `originals.test.ts`: het origineel van de user die niet is ingelogd, blijft staan.
- Bestaande tests niet aangepast. De andere 2323 app-tests blijven groen.
- De app-typecheck faalt alleen op de drie ontbrekende exports (en twee parameters zonder type die daaruit volgen).
- A draaide alle app-tests tegen een wegwerp-uitwerking buiten de repo: alle 2343 groen, typecheck schoon. Zonder "nooit vroeger", zonder het moment van uitloggen of wissel, of zonder het moment van terugkomst wordt telkens een test rood. Die uitwerking is weggegooid.

**Open vragen (30 dagen):**

1. **Uitloggen zonder dat een ander inlogt.** Dan gaat er niets weg tot iemand inlogt. Logt dezelfde user weer in, dan blijven zijn originelen. Aanbevolen: zo laten.
2. **Geen eigen wekker voor de 30 dagen.** Blijft een ander ingelogd en draait de app dagen door zonder herstart of login, dan wacht het wissen tot de volgende start of login. iOS start de app vaak opnieuw. Aanbevolen: aanvaarden.
3. **Een klok die voorliep** toen de app de user zag, maakt het wissen later, nooit eerder. Aanbevolen: aanvaarden.

**Regie op de open vragen van A (30 dagen):** alle drie volgens het advies (zonder login gaat niets weg; geen eigen wekker; een voorlopende klok wist later, nooit eerder).

### 38b fix-cyclus 3 (hercheck cyclus 2 en 30 dagen, regie 2026-11-23)

Hercheck op `fa394b8`: punt 1–3, 5, 6 van fix-cyclus 2 en de 30 dagen dicht. Punt 4 was in de spec fout (regie): `isProtectedDataAvailable` is ook `false` als het toestel gewoon op slot is, niet alleen vóór de eerste ontgrendeling. Te fixen (A eerst spec en tests, dan B):

1. **Geen poort op `isProtectedDataAvailable`** (audit S1, red-team Z1). De uploader leest zijn opslag; lukt lezen niet (vóór de eerste ontgrendeling), dan probeert hij het later opnieuw, zonder te wissen, te stoppen of weg te schrijven. 38b-18 en gate 12 gaan mee. Nieuwe gate: gate 6 koud met het scherm op slot tijdens het wachten; het log toont geen "op slot" en geen dubbel deel, en de app rondt op de achtergrond af.
2. **De opslag laden vóór de sessies events kunnen geven** (audit S2). `init` leest de opslag synchroon vóór de sessies worden aangemaakt; events die toch vóór het laden komen, worden bewaard tot na het laden en dan verwerkt.
3. **"Alleen via wifi" niet blijvend aan door een wekking** (audit N1, red-team N1). Eerst `uploaderJobs`, dan de wifi-stand. Kan de uploader zijn stand niet geven, dan geldt aan voor nu, maar dat wordt niet bewaard.
4. **Een andere uitkomst dan links tijdens afronden** zet geen wachttijd op het afronden (red-team). Alleen een definitieve weigering geldt.

**Aanvaard (regie):** een klok die met de hand vooruit wordt gezet, kan de 30 dagen te vroeg laten aflopen (red-team N2); offline gebruik telt niet als gezien; het toevoegscherm dat tijdens een ronde verdwijnt door uitloggen; `send` vóór de start; downgrade van versie 2 naar 1 (runbook 38c: geen TestFlight-downgrade met wachtende originelen).

Patronen voor het track-record: (a) bewaarde stand laden vóór de bron van events aangaat; (b) een native poort op de stand van het toestel ook toetsen met het scherm op slot, ruim na de eerste ontgrendeling.

### Fix-cyclus 3 38b (A)

De vier punten staan nu in 38b-8, 38b-11, 38b-18, de nieuwe 38b-20, het testcontract en gate 6 en 12.

| Punt | Gepind in | Hoe |
|---|---|---|
| 1 | 38b-18, gate 6 (koud, met het scherm op slot), gate 12 | native: geen poort op `isProtectedDataAvailable`; een leesfout betekent later opnieuw, zonder wissen, stoppen of wegschrijven |
| 2 | 38b-20, gate 6 (koud, met het scherm op slot) | native: eerst de opslag, dan de sessies; events van vóór het laden bewaard en vóór het naast elkaar leggen verwerkt |
| 3 | `originals.test.ts`, gate 12 | eerst `uploaderJobs`, dan de stand; een wekking terwijl de uploader niet kan lezen, verandert niets; kan de uploader zijn stand niet geven, of de app zijn eigen waarde niet lezen, dan aan voor nu en niets bewaard; de volgende start weer uit |
| 4 | `originalQueue.test.ts` | `te_vaak`, `vol`, `uitgelogd`, een onbekende reden of een fout tijdens afronden: `finishOriginal` volgt meteen, niets weg; een fout telt niet mee voor het oplopen. Een definitieve weigering en `done` gelden wel |

Aanvullingen van A:
- *Punt 2, de volgorde.* Een deel dat klaar meldde terwijl het laden wachtte, heeft geen taak meer bij iOS. Zou het naast elkaar leggen vóór de bewaarde events gaan, dan kreeg het een nieuwe taak en ging het twee keer over de lijn. Daarom de events eerst.
- *Punt 3, de eigen waarde van de app.* Een leesfout van de eigen waarde zette die net zo blijvend aan. Die geldt nu ook als "aan voor nu, niets bewaard". Een onleesbare waarde (gelezen, maar geen bekende vorm) blijft aan, zoals in 38b-11.
- *Punt 4, `done`.* Binnen is geen wachttijd; het origineel gaat weg zoals altijd.

Bestaande tests niet aangepast. Geen test eiste dat een "aan" bij twijfel ook bewaard wordt: "de uploader kan zijn stand niet geven: aan" kijkt alleen naar de stand van nu.

**Stand na A (fix-cyclus 3):**

- 15 nieuwe tests, 10 rood om de goede reden:
  - 4 in `originals.test.ts`: de runner vraagt de stand vóór `uploaderJobs` en bewaart "aan" na een wekking of een leesfout;
  - 6 in `originalQueue.test.ts`: een andere uitkomst tijdens afronden zet een wachttijd (of telt mee voor het oplopen).
- Groen: 5 in `originalQueue.test.ts`, de definitieve weigeringen en `done` tijdens afronden.
- De andere 2343 app-tests blijven groen; de typecheck is schoon.

**Open vragen (fix-cyclus 3):**

1. **Gate 6 op slot als iOS de delen niet laat lopen.** Delen die op de achtergrond aan iOS gegeven zijn, stelt iOS uit (spike 3). Lopen ze in het uur op slot niet, dan is de gate niet getoetst. Aanbevolen: dan één keer langer wachten; lukt het niet, dan dekt de audit punt 1 en 2.
2. **`te_vaak` voor de andere originelen.** A pint alleen dat het afronden niet wacht. Aanbevolen: aan B laten.

**Regie op A (fix-cyclus 3):** de aanvulling van A (ook een eigen leesfout bewaart geen "aan") blijft. Open vragen: 1 één keer langer wachten, anders dekt de audit het; 2 aan B.

**Hercheck fix-cyclus 3 (`816185a`):** alle vier punten dicht, geen Z/S. Aanvaard (regie): de eigen wifi-waarde onleesbaar terwijl de uploader "uit" zegt (scherm toont aan, uploader blijft uit; bijna onmogelijk); `save()` in Swift negeert een schrijffout; de buffer van vroege events (38b-20) is alleen door de audit getoetst, niet op een gate. Gate op de build daarna.

### Uitslag gate 38b

**Ronde 1 (build 87, 2026-11-23):** gate 3 goed (1,83 GB binnen op de achtergrond met het scherm uit; grootte in R2 gelijk; SHA-256 niet tegen de telefoon vergeleken). Gate 9 goed: het verkleinen begint na terugkomen opnieuw bij 0%, zonder melding (besluit 25). Gate 10 goed voor een groep zonder project; een clip onder 1 MiB niet apart getoetst.

Nog open: 1, 2, 4, 5, 6, 7, 8, 11, 12. Vanaf build 88 met "Kopieer log".

**Ronde 2 (build 88, 2026-11-23):** gate 6 goed: warm (delen binnen 8 s na voor), koud met de dev-schakelaar (11 uitgestelde delen binnen 14 s), en de schakelaar staat na wegvegen en na de koude start uit. Gate 4 goed: twee keer wegvegen (meteen en na een paar minuten openen), elk deel één keer binnen, 55 van 55; daarna wekte iOS de app en rondde die op de achtergrond af. Gate 7 goed voor de oprichter: `NoSuchUpload`, `niet_toegestaan`, vergeten, deelbestanden weg.

**Wouter (2026-11-23): genoeg getest.** Vervallen: gate 1 (regie gaat uit van de datum van de start van de upload; de lifecycle-marge rekent daarmee), 2, 5, 7 met Terugtrekken, 11 en 12; die dekken de tests en de audit. Nog lopend: gate 6 en 8 in het gewone gebruik (scherm op slot, telefoon weg), log de ochtend erna.

**Ronde 3 (build 88, 2026-11-24), scherm op slot:** goed. Een nieuw filmpje van 1656 MiB; scherm op slot bij "Versturen… 16%". Daarna op de achtergrond: aanmelden, `startOriginal` met 52 links, de delen klaargezet en aan iOS gegeven, zonder regel "op slot" of "niet te lezen". iOS wekte de app, elk deel kwam één keer binnen (52 van 52, HTTP 200), `finishOriginal` gaf `binnen` en de deelbestanden waren weg, 4,5 minuten na het op slot zetten. De eerste poging viel af: dat filmpje was eerder door de oprichter verwijderd en nam terecht geen origineel meer aan (`niet_toegestaan`).

Gate 38b afgerond.

## Opdracht 38c: schermen (regie, 2026-11-25)

38b staat op `main` (PR #58), R2 op prod is ingericht met backup. 38c maakt de schermen; 38b en 38c gaan samen in app 2.0.2. Leidraad: de UI-sectie bovenaan, de mockup (`builds/filmproject-mockup.html`) en de lijst "38c" bij *De grens tussen 38b en 38c*.

**In:**
- Groep: de balk "Filmproject [album]" met einddatum; tik opent de projectpagina. Na sluiten blijft de projectpagina bereikbaar tot de originelen weg zijn.
- Starten (oprichter): album van de groep en einddatum kiezen. Sluiten op de projectpagina.
- Projectpagina (alle leden): schakelaar "Alleen via wifi"; eigen inzendingen met de stand uit `ownOriginalStand` (ook `elders`) en grootte; Terugtrekken met de waarschuwing dat het definitief is; alle inzendingen met poster, lengte, inzender, datum van inzending en opnamedatum als die er is.
- Toevoegscherm: besluit 3 (A-invariant 17) met splitsen en de regel over volle kwaliteit; de schakelaar; de meldingen bij `te_klein`, `te_groot` en `geen_ruimte`; besluit 24 (tonen wat er gebeurt bij ophalen uit iCloud en verkleinen, scherm wakker).
- Webapp (oprichter): downloadpagina met download per origineel (`<a href>`, geen fetch), "alles downloaden" na elkaar met verse links, "alles verwijderen" met waarschuwing.
- De regel "tot 38c er is" (elk nieuw filmpje gaat mee zodra er een open project is) vervalt waar 38c hem vervangt; het proefscherm blijft alleen in dev-builds.

**Uit:** backend-wijzigingen, tenzij A een gat vindt (dan melden, niet zelf bouwen in 38c).

**Voor A:** vul de spec aan (blind spots, waar de knop "Filmproject starten" staat, lege en foutstanden, webapp-varianten), schrijf RED tests voor de pure delen (besluit 3, teksten, standen, bestandsnaam, wat wie ziet), en zet open vragen voor Wouter in een eigen kopje. Gate-checks voor 38c: iPhone met dev-build, en downloaden in Safari en Chrome.

## Spec-criticus 38c (A)

> A 2026-11-25. Bronnen: deze spec, de mockup (`builds/filmproject-mockup.html`), de backend van 38a (`convex/filmProjects.ts`, `lib/filmOriginals.ts`), de modules van 38b (`originalUpload.ts`, `originalQueue.ts`, `src/data/originals.ts`), het toevoegscherm (`AddPhotosScreen.tsx`, `.web.tsx`), `GroupScreen.tsx`, `groupAdmin.ts`, `readOnly*.ts`. Pariteit met de oude app: niet van toepassing, v1 kende geen filmproject.

### Blind spots

1. **De backend gaf niet alles wat de downloadpagina toont.** `get` had per inzending geen grootte en geen datum van weggaan, en het project geen datum van sluiten. Besluit 3 na A: `get` krijgt ze (38c-22).
2. **De webapp is alleen-lezen** (WP35 W5). Downloaden en "Alles verwijderen" zijn de eerste schrijfacties op het web buiten uploaden (WP36). Dat is een bewuste uitzondering, alleen voor de oprichter, alleen op de downloadpagina. De rest van het filmproject is op het web alleen te bekijken: geen starten, sluiten, verschuiven, terugtrekken of wifi-schakelaar.
3. **De webapp voegt geen filmpjes toe** (WP36: alleen foto's). Besluit 3 speelt op het web dus niet: een foto naar Y blijft in Y.
4. **Een origineel dat nog niet is aangemeld, staat niet in `get`.** Tussen "Toevoegen" en een gelukte `startOriginal` kent de backend het niet. Bij geen verbinding, `te_vaak`, `bezig` of `vol` kan dat uren tot dagen duren. "Mijn filmpjes" toont daarom ook de originelen in de wachtrij van dit toestel zonder inzending (A-invariant 38c-6).
5. **Datums in Nederlandse tijd, ook op reis.** De einddatum is het einde van een dag in Nederland (besluit 13). Wie in het buitenland een project start of de balk leest, ziet dezelfde dag als in Nederland, niet de dag van de tijdzone van het toestel. Een opnamedatum is de kloktijd van de camera (zoals bij foto's), zonder omrekening.
6. **De laatste dag die kan.** De backend neemt een einddatum tot 366 dagen na nu. "Vandaag plus 365 dagen" past niet altijd: rond een wissel van zomertijd in een schrikkeljaar ligt het einde van die dag net te laat. De datumkiezer laat alleen dagen toe waarvan het einde binnen de grens valt.
7. **Het album van de filmpjes is X, ook in de upload.** De ronde stuurt de filmpjes met album X naar `startUpload`, en de upload-id van een filmpje hoort bij X (A-invariant 25 van WP33). De backend zou Y toch omleiden, maar dan klopt de melding na afloop niet en verschilt de upload-id tussen "Y gekozen" en "X gekozen".
8. **"Album verwijderen" kent `FILM_PROJECT_OPEN` niet** (besluit 17). De melding is nu de algemene fout. 38c geeft "Sluit eerst het filmproject."
9. **Besluit 16 in de app.** "Filmpje overal verwijderen?" zegt nu "De foto verdwijnt…" en niets over het origineel. De app weet niet of een filmpje een origineel heeft (open vraag 7).
10. **Besluit 24 bestaat al grotendeels.** "Je keuze ophalen…" met teller, uitleg en scherm wakker (WP39), en "Verkleinen… %" met scherm wakker (WP37); besluit 25 is in 38b gebouwd. De meting van de spike (knop 3 minuten grijs) was op het proefscherm. 38c voegt niets toe; de gate toetst het in het toevoegscherm.
11. **Lege lijst van albums.** Een groep zonder album kan geen filmproject krijgen. "Filmproject starten" toont dan "Nog geen albums" met de knop "Nieuw album".

### Waar "Filmproject starten" staat

Besloten (besluit 1 na A): een kleine knop "Filmproject starten" met een sleutel-icoon, naast "Bewerk groep", in de kop van de groep (smal) en in de zijkolom (breed, iPad liggend). Alleen voor de oprichter, alleen in de app, en alleen zolang er geen open project is. Staat er een open project, dan staat daar de balk. De knop opent een eigen scherm (mockup 4) in de stack van de groep: albumlijst, einddatum, "Starten".

### Lege en foutstanden

| Waar | Stand | Wat het scherm doet |
|---|---|---|
| Groep | projecten nog niet geladen | geen balk, geen knop |
| Groep | geen project | geen balk; de oprichter (app) ziet "Filmproject starten" |
| Groep | alleen gesloten projecten met originelen | balk "Filmproject [album]" met "Gesloten"; de oprichter kan een nieuw project starten |
| Starten | geen albums | "Nog geen albums" en "Nieuw album" |
| Starten | geen album gekozen | "Starten" grijs |
| Starten | `PROJECT_ALREADY_OPEN`, `DATE_INVALID`, `NOT_ALLOWED`, `NOT_MEMBER`, anders | eigen melding per code; nooit de tekst van de fout |
| Projectpagina | laden | "Laden…" |
| Projectpagina | `NOT_MEMBER` (geen lid, project weg na een jaar) | "Dit filmproject is er niet meer, of je bent geen lid meer van de groep", met een weg terug naar de groep |
| Projectpagina | nog geen inzendingen | lege stand "Nog geen filmpjes"; nieuwe filmpjes in deze groep gaan naar [X] (alleen zolang hij open is) |
| Projectpagina | poster geeft 404 (net teruggetrokken of verwijderd) | een lege tegel, geen fout |
| Projectpagina | filmalbum verwijderd na sluiten | titel met de naam van toen (`albumName`) |
| Terugtrekken | `ORIGINAL_NOT_FOUND` | "Dit origineel is er niet meer"; de rij verdwijnt vanzelf |
| Sluiten, verschuiven | `NOT_ALLOWED`, `PROJECT_CLOSED`, `DATE_INVALID` | eigen melding |
| Toevoegscherm | open projecten nog niet geladen, met filmpjes in de keuze | knop "Toevoegen aan album" uit, zoals bij een album dat nog gecontroleerd wordt; een fout bij het laden telt als "geen project" (de backend leidt toch om) |
| Toevoegscherm | origineel gaat niet mee (`te_klein`, `te_groot`, `geen_ruimte`, of verplaatsen of de wachtrij lukte niet) | één regel per reden in de uitkomst van de filmpjes; het filmpje staat wel in het album |
| Downloadpagina | niets binnen | "Alles downloaden" weg; rijen onderweg zonder downloadknop |
| Downloadpagina | `ORIGINAL_NOT_FOUND` (net verwijderd of nog onderweg) | melding bij die rij |
| Downloadpagina | een andere fout (ook `R2_CONFIG_MISSING`) | algemene melding, geen fouttekst |

### Webapp-varianten

| Scherm | App (iPhone, iPad) | Webapp |
|---|---|---|
| Groep: balk | ja | ja (bekijken) |
| Groep: "Filmproject starten" | oprichter | nee; het pad toont "Alleen in de app" |
| Projectpagina, lid | alles, met schakelaar en Terugtrekken | lijst en eigen inzendingen met "Onderweg" of "Binnen"; geen schakelaar, geen Terugtrekken |
| Projectpagina, oprichter | als lid, plus Sluiten en Einddatum wijzigen (open), Titel wijzigen (altijd), "nog N onderweg" en "Downloaden kan in de webapp" | de downloadpagina |
| Downloadpagina | nee | oprichter: download per origineel, "Alles downloaden", "Alles verwijderen" (na sluiten), Sluiten en Einddatum wijzigen (open), Titel wijzigen (altijd); dezelfde bevestigingen als in de app; elke knop met de gele sleutel (`FOUNDER_BUTTONS`) |
| Mijn groepen | "Oprichter" met de gele sleutel als je de oprichter bent, anders "Admin" of "Lid" | idem |
| Toevoegscherm | besluit 27: het gekozen album, regel boven de knop, schakelaar | ongewijzigd (alleen foto's) |

Een build zonder uploader (`originalUploaderAvailable` uit) gedraagt zich als de app, maar zonder schakelaar en zonder regel boven de knop. Filmpjes gaan ook daar naar het gekozen album (besluit 27).

### Invarianten 38c

*Getest in de pure modules:*

1. **Besluit 3 in één functie** (A-invariant 17). Uit de keuze (aantal foto's, aantal filmpjes dat meegaat: een te lang filmpje telt niet), het gekozen album en de open projecten volgt: het album van de foto's, het album van de filmpjes, of er gesplitst wordt, welk album de albumrij toont, de regels boven de knop, en of de schakelaar er staat.
   - Het gekozen album blijft wat het lid (of de +, of het onthouden album) koos. Alleen filmpjes met Y gekozen: de rij toont X. Komen er foto's bij, dan staat Y er weer en wordt er gesplitst. Het onthouden album (WP39 F2) is het gekozen album.
   - Regels boven de knop (feedback build 89, punt 2):
     - zonder splitsen, filmpjes naar X: "Je filmpje wordt ook in volle kwaliteit bewaard voor de feature-film." of "Je [n] filmpjes worden ook in volle kwaliteit bewaard voor de feature-film.";
     - bij splitsen: "[n] foto's gaan naar [Y]" en "[n] filmpjes gaan naar [X] en worden ook in volle kwaliteit bewaard voor de feature-film." (enkelvoud "1 filmpje gaat … en wordt ook …");
     - zonder uploader: geen zin over volle kwaliteit; bij splitsen alleen "[n] filmpjes gaan naar [X]", zonder splitsen geen regel;
     - zonder project geen regel.
   - De schakelaar "Alleen via wifi" staat er alleen met uploader en met minstens één filmpje naar X.
   - Zijn de open projecten nog niet geladen en zitten er filmpjes in de keuze, dan is de uitkomst "nog niet klaar".
2. **Y grijs in het kiesscherm.** Alleen filmpjes in de keuze: elk album van een groep met een open project, behalve X zelf, is niet te kiezen, met "Filmpjes gaan nu naar [X]". Met foto's erbij is Y te kiezen.
3. **Wie wat ziet in de groep.** "Filmproject starten" alleen voor de oprichter, in de app, als de projecten geladen zijn en er geen open project is. Een balk per project uit `listForGroup`: het open project eerst. "Filmproject [album]", met "Open tot [dag maand]" (het jaar erbij als het niet dit jaar is, in Nederlandse tijd) of "Gesloten".
4. **Wie wat ziet op de projectpagina.**
   - Schakelaar: app met uploader.
   - Sluiten en einddatum verschuiven: oprichter, app en web, project open. Titel wijzigen: oprichter, app en web, ook na sluiten (feedback webapp dev, tweede ronde).
   - "Downloaden kan in de webapp": oprichter, app.
   - Downloadpagina: oprichter, web.
   - "Alles verwijderen": oprichter, web, project gesloten, minstens één inzending.
   - Het aantal filmpjes in de kop is het aantal dat binnen is. De oprichter ziet daarnaast hoeveel er onderweg zijn.
5. **"Alle filmpjes"**: alleen wat binnen is, het nieuwste eerst. Eigen inzendingen heten "Jij".
6. **"Mijn filmpjes"**: de eigen inzendingen uit `get`, plus (in de app met uploader) de originelen in de wachtrij van dit toestel voor dit project en deze user die nog geen inzending hebben. Het nieuwste eerst.
   - De stand komt uit `ownOriginalStand` (38b). Zonder uploader en op het web: "Onderweg" of "Binnen".
   - Een origineel zonder inzending heeft de stand "Wordt verstuurd", of "Later opnieuw" als er een wachttijd loopt.
   - De grootte: bij een inzending die uit `get`, bij een origineel zonder inzending die uit de wachtrij.
   - Terugtrekken: in de app, bij elke eigen inzending (onderweg, `elders` of binnen). Niet bij een origineel zonder inzending, niet op het web.
7. **Teksten van de stand**: "Binnen", "Wordt verstuurd", "Wacht op wifi" (mockup), "Later opnieuw" (`wacht`), "Niet op dit toestel" (`elders`), "Onderweg" (web, geen uploader).
8. **Na terugtrekken** hoort de wachtrij het (`teruggetrokken`), pas als `withdraw` gelukt is. De bevestiging zegt dat het definitief is: dat filmpje kan nooit meer naar een clubfilm, en het blijft in het album. "Alles verwijderen" zegt hetzelfde, met het aantal.
9. **Downloadpagina**: de kop zoals mockup 5: "Gesloten op [dag] · [n] originelen · [grootte] · weg op [datum]" (of "Open tot …" vooraan). Aantal, grootte en "weg op" (de eerste die weggaat) tellen alleen wat binnen is; zonder iets binnen "nog geen originelen". Per rij de grootte en "weg op [datum]". Alle inzendingen die de oprichter ziet, in de volgorde van de bestandsnamen: de opnamedatum, of zonder die het inzenden in Nederlandse tijd (zoals `originalFilename` in 38a). Zo staan ze in de map van de downloads in dezelfde volgorde. Alleen wat binnen is, is te downloaden. "Alles downloaden" haalt per origineel een verse link, in die volgorde.
10. **Data en tijden.** Inzenden: "Vandaag 14:12", "Gisteren 19:03", anders "21 nov 19:03", met het jaar als het niet dit jaar is, in Nederlandse tijd. Bij elke rij in "Alle filmpjes": "Ingestuurd 22 nov · opgenomen 20 nov". De opnamedatum is de kloktijd van de camera. Grootte decimaal, zoals iOS: "410 MB", "1,2 GB".
11. **Einddatum.** Het lid kiest een dag. `endsAt` is het einde van die dag in Nederland (23:59:59,999), ook bij een wissel van zomertijd. Te kiezen: vandaag tot de laatste dag waarvan het einde binnen 366 dagen na nu valt.
12. **Weigeringen**: een eigen tekst per code (zie de tabel). Een onbekende code of een fout zonder code geeft de algemene tekst, zonder de tekst van de fout (geen "Server Error", geen `R2_CONFIG_MISSING`, geen link).
13. **Meldingen als het origineel niet meegaat**: één regel per reden, met het aantal filmpjes, in de uitkomst van de filmpjes. `geen_uploader` en `geen_project` geven geen melding.

20. **De knop "Filmproject starten"** (besluit 1 na A): tekst, sleutel-icoon (`key`) en een toegankelijkheidslabel dat zegt dat hij alleen voor de oprichter is, uit één constante in de pure module.
21. **"Filmpje overal verwijderen?"** (besluit 16, besluit 7 na A): de bevestiging in het menu krijgt bij een filmpje de zin "Is het ingestuurd voor een filmproject, dan gaat het origineel ook weg." Ook bij meerdere tegelijk als er een filmpje bij is.
22. **`filmProjects.get` in de backend** (besluit 3 na A):
    - per inzending `bytes` (de aangemelde grootte) en `goneAt`: binnen een jaar na binnenkomst; onderweg 14 dagen na het sluiten (of de einddatum als het project nog open is, of eerder dichtging), maar nooit later dan een jaar na het aanmelden. Dat is wat de opruimronde doet; verschuift de einddatum, dan schuift `goneAt` mee;
    - per project `closedAt`: `null` zolang hij open is, anders het sluiten door de oprichter, of de einddatum als hij vanzelf dichtging (ook als de geplande stap nog niet liep);
    - toegang: elk veld staat bij elke rij die de caller al ziet. Geen veld alleen voor de oprichter: een grootte en een datum zeggen niets over de inhoud of de plek. `listForGroup` en `listOpenForMe` blijven zoals ze zijn.

*Aansluiting (audit en gate):*

14. **De filmpjes gaan met album X naar `startUpload`** (blind spot 7). De melding na afloop noemt per soort het eigen album: "3 foto's toegevoegd aan [groep] · Dag 3." en "2 filmpjes toegevoegd aan [groep] · Reis 2026.". "Naar album" bij de foto's gaat naar Y; zonder foto's gaat "Naar album" naar X.
15. **Eén stand van "Alleen via wifi"**: de schakelaar in het toevoegscherm en op de projectpagina tonen dezelfde waarde (38b), en zetten hem via `setOriginalsWifiOnly`. Lukt dat niet, dan springt hij terug op aan.
16. **De stand leeft**: de projectpagina volgt de wachtrij (`listenOriginals`) en het netwerk; geen verversen nodig.
17. **Downloaden met een gewone link**, geen fetch: de browser bewaart het bestand onder de naam uit de link (38a). Een download van gigabytes gaat niet door het geheugen van de pagina.
18. **De regel "tot 38c er is" vervalt**: het origineel gaat mee als de filmpjes naar X gaan (`originalPlan` met de groep van X). Het proefscherm blijft alleen in dev-builds.
19. **Routes**: de projectpagina onder de groep (`/groep/<groep>/filmproject/<project>`), starten modaal als `/groep/<groep>/nieuw-filmproject` met een web-variant "Alleen in de app". De poster via `/beeld/inzending/<id>`, met het token zoals een foto.

### A-keuzes

- **Eén module** `app/src/lib/filmProject.ts` voor de pure delen; paden in `groupRoutes.ts`, de poster in `imageUrls.ts`, `FILM_PROJECT_OPEN` in `refusalOf` van `groupAdmin.ts`.
- **Standaard einddatum**: over 14 dagen (zoals de spike). Niet getest.
- **Volgorde**: "Mijn filmpjes" en "Alle filmpjes" het nieuwste eerst (mockup); de downloadpagina op opname (mockup 5).
- **Bestandsnaam**: staat in de backend (38a, `originalFilename`) en is daar getest. 38c voegt geen eigen naam toe; de gate toetst dat Safari en Chrome hem bewaren.
- **"Nog N onderweg"** voor de oprichter telt alle inzendingen onderweg, ook de eigen.

### Testcontract 38c

> Namen en vormen zijn A-keuzes; het hoe is aan B. Pure module, zonder React Native.

**`app/src/lib/filmProject.ts`**

```ts
export type Platform = "ios" | "web";
export type OpenFilmProject = { groupId: string; projectId: string; albumId: string; albumName: string };
export type ChosenAlbumRef = { albumId: string; groupId: string; name: string };

export type AddTargets =
  | { ready: false }
  | { ready: true; photoAlbumId: string | null; videoAlbumId: string | null; rowAlbumId: string | null;
      projectId: string | null; split: boolean; lines: string[]; wifiSwitch: boolean };
export function addTargets(input: { photos: number; videos: number; album: ChosenAlbumRef | null;
  openProjects: readonly OpenFilmProject[] | undefined; originals: boolean }): AddTargets;
export function albumOption(input: { albumId: string; groupId: string; photos: number; videos: number;
  openProjects: readonly OpenFilmProject[] }): { disabled: boolean; note: string | null };

export type SkipReason = "te_klein" | "te_groot" | "geen_ruimte" | "fout";
export function originalSkipLines(reasons: readonly SkipReason[]): string[];

export type ProjectRow = { projectId: string; albumId: string | null; albumName: string; endsAt: number; open: boolean };
export function projectTitle(albumName: string): string;
export function projectStatusText(project: { open: boolean; endsAt: number }, now: number): string;
export function groupFilmView(input: { platform: Platform; isFounder: boolean;
  projects: readonly ProjectRow[] | undefined; now: number }):
  { start: boolean; banners: { projectId: string; title: string; text: string }[] };

export function dutchDayOf(ms: number): Day;              // Day uit groupAdmin.ts
export function endOfDutchDay(day: Day): number;
export function endDayRange(now: number): { first: Day; last: Day };
export function submittedText(ms: number, now: number): string;
export function originalMetaText(o: { submittedAt: number; takenAt: number | null }, now: number): string;
export function formatBytes(bytes: number): string;

export type ProjectOriginal = { originalId: string; ownerName: string; mine: boolean; status: "onderweg" | "binnen";
  durationMs: number; submittedAt: number; takenAt: number | null; bytes: number; goneAt: number };   // = een rij uit filmProjects.get
export function goneText(goneAt: number, now: number): string;                 // "weg op 30 november 2027"
export function downloadHeaderText(project: { open: boolean; endsAt: number; closedAt: number | null },
  originals: readonly ProjectOriginal[], now: number): string;
export const START_BUTTON: { title: string; icon: "key"; accessibilityLabel: string };
export function projectPageView(input: { platform: Platform; uploader: boolean; isFounder: boolean; open: boolean;
  originals: readonly ProjectOriginal[] }): { wifiSwitch: boolean; close: boolean; changeEnd: boolean;
  downloadHint: boolean; download: boolean; removeAll: boolean; count: number; underway: number | null };

export type MineStand = OwnStand | "onderweg";             // OwnStand uit originalQueue.ts
export function standText(stand: MineStand): string;
export type MineRow = { key: string; originalId: string | null; stand: MineStand; bytes: number | null;
  durationMs: number | null; submittedAt: number; canWithdraw: boolean };
export function mineRows(input: { platform: Platform; projectId: string; originals: readonly ProjectOriginal[];
  device: { userId: string; queue: readonly QueueEntry[]; wifiOnly: boolean; network: NetworkView } | null;
  now: number }): MineRow[];
export function allRows(originals: readonly ProjectOriginal[]):
  { originalId: string; name: string; durationMs: number; submittedAt: number; takenAt: number | null }[];
export function downloadRows(originals: readonly ProjectOriginal[]): (ProjectOriginal & { canDownload: boolean })[];
export function downloadAllIds(originals: readonly ProjectOriginal[]): string[];

export const WITHDRAW_CONFIRMATION: Confirmation;         // Confirmation uit groupAdmin.ts
export function closeConfirmation(albumName: string): Confirmation;
export function removeAllConfirmation(count: number): Confirmation;
export type FilmAction = "start" | "close" | "changeEnd" | "withdraw" | "download" | "removeAll";
export function filmRefusalText(error: unknown, action: FilmAction): string;
```

- `mineRows`: `device` is `null` op het web en zonder uploader. `key` is het inzending-id, of voor een origineel zonder inzending de sleutel uit de wachtrij; `submittedAt` is dan het moment van toevoegen.
- `downloadRows` krijgt wat `get` de oprichter geeft (ook onderweg).

**Backend**: `filmProjects.get` geeft per inzending ook `bytes: number` en `goneAt: number`, en in `project` ook `closedAt: number | null` (38c-22).

**Elders**: `filmProjectPath(groupId, projectId)` en `newFilmProjectPath(groupId)` in `groupRoutes.ts`; `originalPosterUrl(siteUrl, originalId, format)` in `imageUrls.ts`; `refusalOf` kent `FILM_PROJECT_OPEN` bij `deleteAlbum`.

### Tests per invariant (stand na A)

| Inv. | Test (`app/tests/`) | Niet getest, omdat … |
|---|---|---|
| 38c-1, 2 | `filmProject.test.ts` (`addTargets`: de tabel van besluit 3, ook zonder uploader, enkelvoud, te lang, niet geladen; `albumOption`) | de aansluiting in het scherm: audit en gate |
| 38c-3 | `filmProject.test.ts` (`groupFilmView`) | plek van de knop: open vraag 1 |
| 38c-4, 5 | `filmProject.test.ts` (`projectPageView`, `allRows`) | |
| 38c-6, 7 | `filmProject.test.ts` (`mineRows` met een echte wachtrij uit 38b, `standText`) | |
| 38c-8 | `filmProject.test.ts` (bevestigingen) | de volgorde `withdraw` dan `teruggetrokken`: audit |
| 38c-9 | `filmProject.test.ts` (`downloadRows`, `downloadAllIds`) | of de browser het bewaart: gate |
| 38c-10, 11 | `filmProject.test.ts` (data, ook met een andere tijdzone op het toestel, zomertijd, de laatste dag over twee jaar, grootte) | |
| 38c-12, 13 | `filmProject.test.ts` (`filmRefusalText`, `originalSkipLines`), `filmProjectRoutes.test.ts` (`FILM_PROJECT_OPEN`) | |
| 38c-14–18 | | aansluiting: audit en gate |
| 38c-19 | `filmProjectRoutes.test.ts` (paden, routebestanden, web-variant van starten, posterpad) | |
| 38c-9 (kop) | `filmProject.test.ts` (`downloadHeaderText`, `goneText`) | |
| 38c-20 | `filmProject.test.ts` (`START_BUTTON`), `filmProjectRoutes.test.ts` (`key` in Icon, een scherm gebruikt `START_BUTTON`) | de plek naast "Bewerk groep": gate |
| 38c-21 | `filmProjectRoutes.test.ts` (de zin staat in het menu) | of hij alleen bij filmpjes staat: audit |
| 38c-22 | `tests/filmProject/getDetails.test.ts` (open, gesloten, vanzelf dicht; binnen, onderweg, verschoven, eerder gesloten, bijna een jaar open; gelijk aan de opruimronde; wie wat ziet) | |

**Stand na A (38c):**

- Twee nieuwe testbestanden, 104 tests, alle rood om de goede reden:
  - 96 in `filmProject.test.ts`: de module bestaat nog niet (`Cannot find module`).
  - 8 in `filmProjectRoutes.test.ts`: de paden, de poster en de routebestanden ontbreken; `FILM_PROJECT_OPEN` geeft de algemene tekst.
- De andere 2358 app-tests blijven groen. De app-typecheck faalt alleen op de ontbrekende module en exports.
- A draaide de tests tegen een wegwerp-uitwerking buiten de repo: alle 104 groen, typecheck schoon. Met "vandaag plus 365 dagen", een sortering zonder Nederlandse tijd, de tijdzone van het toestel, of zonder de originelen zonder inzending werd telkens een test rood. Die uitwerking is weggegooid.
- Na de besluiten van Wouter: zie "Na de besluiten van 38c (A)".

### Gate 38c (iPhone met dev-build; Safari en Chrome op de Mac)

1. **Starten**: als oprichter in een groep zonder project: de knop met het sleutel-icoon naast "Bewerk groep"; VoiceOver zegt dat hij alleen voor de oprichter is. Album en einddatum kiezen, de balk verschijnt. Een lid (tweede account) ziet de balk, niet de knop.
2. **Besluit 3**: alleen filmpjes met het onthouden album Y: de rij toont X, Y is grijs met "Filmpjes gaan nu naar X". Foto's en filmpjes met Y: twee regels boven de knop; na afloop staan de foto's in Y en de filmpjes in X, en de meldingen noemen elk hun album. Ook via de + in album Y.
3. **Schakelaar**: in het toevoegscherm en op de projectpagina dezelfde stand; omzetten op de een staat meteen op de ander. Opmaak (feedback build 89, punt 1): label en schakelaar op één lijn, verticaal gecentreerd, in een kaart zoals mockup 2, op beide schermen.
4. **Projectpagina**, per filmpje: een eigen filmpje gaat van "Wordt verstuurd" naar "Binnen"; met de schakelaar aan op mobiel internet "Wacht op wifi". Een filmpje staat bij "Mijn filmpjes" zodra het in de wachtrij is: dat is als zijn verkleinen voor het album begint. Bij een reeks komt het volgende filmpje pas in de wachtrij als het vorige voor het album verstuurd is (38b); dat is goed.
5. **Terugtrekken**, met de waarschuwing: de rij is weg, het filmpje staat nog in het album, in het log van het proefscherm is het bestand weg.
6. **Een clip onder 1 MiB**: de melding "te klein", het filmpje staat in het album.
7. **Sluiten**: de balk zegt "Gesloten", een nieuw filmpje gaat naar het gekozen album, de projectpagina blijft bereikbaar. Einddatum verschuiven: tik op "Open tot …", kies een andere dag.
8. **Tijdzone**: zet op de iPhone een andere tijdzone (bv. New York). De balk toont dezelfde einddatum.
9. **Besluit 24**: een filmpje dat alleen in iCloud staat: "Je keuze ophalen…" met teller, het scherm blijft aan; daarna "Verkleinen… %", het scherm blijft aan.
10. **Webapp, Safari en Chrome**, als oprichter: de downloadpagina, met de kop en per rij grootte en "weg op". Download een origineel van ≥ 1 GB: de naam is "jjjj-mm-dd uu.mm Naam.mov" en de grootte is gelijk aan die in R2. "Alles downloaden" met minstens drie: alle bestanden komen heel binnen (Chrome kan vragen of de site meer bestanden mag downloaden). Het geheugen van het tabblad blijft laag.
11. **Webapp als lid**: de projectpagina zonder Terugtrekken en zonder schakelaar; het pad van starten toont "Alleen in de app".
12. **Alles verwijderen** in de webapp, met de waarschuwing: de lijst is leeg; op de iPhone gaat een origineel dat nog onderweg was uit de wachtrij.
13. **iPad liggend**: de balk en de knop in de zijkolom.

### Open vragen 38c (voor Wouter)

1. **Waar staat "Filmproject starten"?** Advies: een kleine knop naast "Bewerk groep", alleen voor de oprichter en alleen zolang er geen project open staat. Alternatief: in "Bewerk groep".
2. **"Met plek" in de regel boven de knop?** De UI-tekst van 22 november zegt "in volle kwaliteit, met plek"; de mockup zegt "in volle kwaliteit voor de clubfilm". Advies: "met plek" erbij, omdat alleen het origineel de plek meestuurt (besluit 10) en het lid dat moet weten. De tests laten beide toe.
3. **De downloadpagina mist gegevens uit de backend** (blind spot 1). Advies: `get` uitbreiden met de grootte en de datum van weggaan per inzending, en de datum van sluiten per project. Dat is een kleine wijziging in 38a, met eerst tests van A. Alternatief: die drie uit de downloadpagina laten.
4. **Einddatum verschuiven in de app** (besluit 13, de backend kan het al). Advies: ja, de oprichter tikt op "Open tot …" op de projectpagina en kiest een andere dag.
5. **"Alles verwijderen" alleen na sluiten?** Advies: ja. Zo kan het niet per ongeluk terwijl leden nog insturen; sluiten kan eerst.
6. **Eén origineel verwijderen op de downloadpagina?** Advies: nee, zoals de mockup. De backend kan het wel (`removeOriginal`).
7. **"Filmpje overal verwijderen?"** (besluit 16). De app weet niet of een filmpje een origineel heeft. Advies: bij elk filmpje één zin erbij: "Is het ingestuurd voor een filmproject, dan gaat het origineel ook weg." Geen backend-wijziging.
8. **Teksten voor twee standen** die de mockup niet toont. Advies: "Later opnieuw" (er loopt een wachttijd) en "Niet op dit toestel" (onderweg, maar niet in de wachtrij van deze iPhone: een ander toestel, of het bestand is weg). Bij die laatste kan het lid terugtrekken.

### Besluiten Wouter na A van 38c (2026-11-25)

Open vragen 1–8 volgens het advies van A, met twee aanvullingen:

1. De knop "Filmproject starten" moet herkenbaar alleen voor de oprichter zijn: een sleutel-icoon (`key` uit Ionicons) vóór de tekst, en een toegankelijkheidslabel dat het zegt.
2. Niet "met plek" maar **"met gps"**: de regel boven de knop noemt "volle kwaliteit", "met gps" en "clubfilm".
3. `filmProjects.get` krijgt grootte en datum van weggaan per inzending en de datum van sluiten per project (kleine uitbreiding van 38a, eerst tests van A). Na de merge deployt Wouter de backend naar prod.

### Na de besluiten van 38c (A, 2026-11-25)

Verwerkt in 38c-1, 4, 6, 7, 9 en de nieuwe 38c-20 tot 22, het testcontract, de tabel en de gate.

- **Besluit 2**: vervangen door feedback build 89, punt 2 (zie 38c-1).
- **Besluit 3**: backend-tests voor `get` (38c-22); in de app de kop van de downloadpagina en "weg op". De grootte van een eigen inzending komt nu uit `get`, ook bij `binnen` en `elders`.
- **Besluit 1**: `START_BUTTON` met `key` en een label; Icon kent `key`; een scherm gebruikt de constante.
- **Besluit 7**: de zin over het origineel in het menu.
- **Besluiten 4, 5, 6, 8**: stonden al in de tests zoals geadviseerd; niets veranderd.

**Stand na A (besluiten 38c):**

- Backend: 11 nieuwe tests in `tests/filmProject/getDetails.test.ts`, alle rood: `closedAt`, `bytes` en `goneAt` ontbreken. De andere 147 tests van het filmproject blijven groen; de root-typecheck is schoon (`_film.ts` kent de nieuwe velden).
- App: `filmProject.test.ts` heeft nu 104 tests (8 nieuw), rood zolang de module ontbreekt; `filmProjectRoutes.test.ts` 11 (3 nieuw), alle rood. De andere 2358 app-tests blijven groen.
- A draaide alles tegen een wegwerp-uitwerking buiten de repo (backend en app): groen, beide typechecks schoon, ook de inventaristests. Die uitwerking is weggegooid.


### 38c fix-cyclus 1 (audit, regie 2026-11-25)

Audit: geen blockers, één moet. Regie neemt ook de nits mee.

1. **Moet: een te lang filmpje krijgt geen uitkomst meer** (regressie op WP37 A12). Ook als de ronde alleen te lange filmpjes heeft, of foto's met een te lang filmpje, komt er een uitkomst met "niet gelukt: te lang". A pint dit in een pure functie die de doelen van de ronde bepaalt; B sluit `startUpload`/`runVideos` daarop aan.
2. Downloadpagina: een rij die onderweg is, toont "Onderweg · weg op …".
3. "Alles downloaden": een foutmelding per rij, niet alleen bij de laatste.
4. Ook de bevestiging bij het verwijderen van een gemeld filmpje (`FlagScreens.tsx`) krijgt de zin over het origineel. Bij een filmpje begint de tekst met "Het filmpje verdwijnt…", niet "De foto verdwijnt…".
5. De nieuwe groepen-query in het toevoegscherm valt onder een `QueryBoundary` of komt uit `useKnownMyGroups`.

Aanvaard: gate 38c-4 geldt per filmpje; het tweede filmpje van een reeks komt pas in de wachtrij als het eerste verstuurd is (38b-gedrag). De gate zegt dat zo.

### Fix-cyclus 1 38c (A)

| Punt | Gepind in | Hoe |
|---|---|---|
| 1 | `filmProject.test.ts` (`roundTargets`) | de doelen van de ronde: albums zoals `addTargets` met de filmpjes die meegaan, en `videoResult` zodra er een filmpje in de keuze zit, ook als het te lang is. Alleen te lange filmpjes; foto's met een te lang filmpje; een te lang naast een goed filmpje met een open project; zonder project; open projecten die nog laden |
| 2 | `filmProject.test.ts` (`downloadStatusText`) | binnen "weg op …", onderweg "Onderweg · weg op …" |
| 3 | `filmProject.test.ts` (`downloadAll`) | na elkaar met een pauze ertussen; elke mislukte rij haar eigen tekst; een downloader die gooit, is een fout bij die rij (algemene tekst, geen fouttekst) en de rest gaat door |
| 4 | `filmProjectRoutes.test.ts` (`deleteMessage` in `photoActions.ts`, bronscan `FlagScreens.tsx`) | één filmpje "Het filmpje verdwijnt…" met de zin over het origineel; een foto zoals nu; meerdere alleen met de zin als er een filmpje bij is; alleen filmpjes "De 3 filmpjes verdwijnen…". In `FlagScreens.tsx` een titel voor een filmpje, en de tekst via `deleteMessage` of letterlijk |
| 5 | `filmProjectRoutes.test.ts` (bronscan) | in de body van `AddPhotosScreen` zelf geen `useMyGroups` of `useLiveQuery` (wel in een deel onder een `QueryBoundary`, of `useKnownMyGroups`) |

**Testcontract erbij** (`app/src/lib/filmProject.ts`, `photoActions.ts`):

```ts
export type RoundTargets =
  | { ready: false }
  | { ready: true; photoAlbumId: string | null; videoAlbumId: string | null; projectId: string | null;
      videoResult: boolean; tooLong: number };
export function roundTargets(input: { photos: number; videos: number; tooLong: number; album: ChosenAlbumRef | null;
  openProjects: readonly OpenFilmProject[] | undefined; originals: boolean }): RoundTargets;   // videos: die meegaan
export function downloadStatusText(original: ProjectOriginal, now: number): string;
export function downloadAll(ids: readonly string[], download: (id: string) => Promise<string | null>,
  pause: () => Promise<void>): Promise<Map<string, string>>;   // download: null = gelukt, anders de tekst
export function deleteMessage(input: { count: number; videos: number }): string;              // photoActions.ts
```

De ronde van het scherm volgt `roundTargets`: met `videoResult` krijgt elk filmpje een uitkomst, ook als `videoAlbumId` `null` is (alleen te lange). De aansluiting toetsen audit en gate. Gate 4 is aangepast: hij geldt per filmpje.

**Stand na A (fix-cyclus 1):** 23 nieuwe tests, alle rood om de goede reden: `roundTargets` (12), `downloadStatusText` (1), `downloadAll` (3) en `deleteMessage` (4) bestaan nog niet; `FlagScreens.tsx` kent geen filmpje (2); `AddPhotosScreen` roept `useMyGroups` zelf aan (1). De andere 2473 app-tests blijven groen. A draaide de 138 tests van 38c tegen een wegwerp-uitwerking buiten de repo: groen, typecheck schoon; weggegooid.


### Feedback Wouter op build 89 (2026-11-25)

1. **Schakelaar "Alleen via wifi"** (projectpagina en toevoegscherm): label en schakelaar netjes op één lijn, verticaal gecentreerd, in een kaart zoals mockup 2.
2. **De regel boven de knop** wordt (vervangt besluit 2 na A, "met gps" vervalt):
   - zonder splitsen: "Je filmpje wordt ook in volle kwaliteit bewaard voor de feature-film." (meervoud: "Je [n] filmpjes worden ook …");
   - bij splitsen blijft de regel van de foto's ("[n] foto's gaan naar [Y]"), en voor de filmpjes: "[n] filmpjes gaan naar [X] en worden ook in volle kwaliteit bewaard voor de feature-film."
   - Zonder uploader: geen zin over volle kwaliteit; bij splitsen alleen "[n] filmpjes gaan naar [X]".

### Feedback build 89 (A)

- **Punt 1** (opmaak van de schakelaar) is niet puur te toetsen: gate 3.
- **Punt 2** staat in 38c-1 en in `filmProject.test.ts` (`addTargets`), met de exacte zinnen: zonder splitsen enkel- en meervoud (ook met foto's naar X), bij splitsen enkel- en meervoud, zonder uploader, en nergens nog "gps" of "clubfilm".

**Stand na A (build 89):** 9 tests rood om de goede reden (de oude zin met "met gps … clubfilm"): de vijf van de tabel van besluit 3 met een regel, het enkelvoud bij splitsen, en drie nieuwe (enkelvoud zonder splitsen, meervoud zonder splitsen, geen "gps" of "clubfilm"). Zonder uploader is al groen. De andere 2547 app-tests blijven groen; typecheck schoon.


### Besluit 27 (Wouter, 2026-11-25, na build 89): alles naar het gekozen album

Vervangt besluit 2 en 3, A-invariant 2 en 17, en de punten over splitsen en het grijze album.

1. **Alles wat het lid kiest, gaat naar het album dat het lid kiest.** Ook filmpjes. De backend leidt niets meer om; geen splitsen, geen grijs album in het kiesscherm.
2. **Staat er in die groep een project open, dan gaat van elk nieuw filmpje ook het origineel naar het project**, in welk album van de groep het ook komt. De voorwaarden blijven verder gelijk (eigen nieuw filmpje, gemaakt terwijl het project open staat, lid van de groep; besluit 4 over bestaande filmpjes blijft).
3. **Een project hangt niet meer aan een album.** De oprichter geeft bij het starten een **titel** en een einddatum. Banner, projectpagina en downloadpagina tonen de titel. Bestaande projecten (alleen dev; op prod staat er geen) krijgen als titel de albumnaam.
4. **De regel boven de knop**, alleen met uploader en minstens één filmpje dat meegaat: "1 filmpje wordt ook als origineel bewaard voor filmproject [titel]" / "[n] filmpjes worden ook als origineel bewaard voor filmproject [titel]". Zonder uploader geen regel.
5. **Backend (38a) verandert**: `startOriginal` en wat ervan afhangt kijken naar de groep in plaats van naar het filmalbum; het schema krijgt een titel. Na de merge deployt Wouter de backend naar prod (er staat daar nog geen project, dus geen migratie van echte data).

### Besluit 27 (A)

> A 2026-11-25, op `76bfc4d`. Vervangt wat hieronder genoemd staat; de rest van 38a, 38b en 38c blijft.

**38a (backend)**

- **Albumregel weg** (besluit 2, 19, A-invariant 2). `videos.reserveVideo` legt elk filmpje in het gevraagde album. App 2.0.2 krijgt hetzelfde: het filmpje staat in het album dat het lid koos, zonder origineel.
- **Wie mag insturen** (A-invariant 3): "in het filmalbum" wordt "in een album van de groep van een open project". De rest blijft:
  - eigen filmpje;
  - gemaakt terwijl het project open stond;
  - lid van de groep;
  - één inzending per filmpje;
  - de blokkade na terugtrekken;
  - 14 dagen na sluiten.

  Staat een nieuw filmpje in albums van twee groepen die elk een project open hebben, dan telt het album waar het het eerst in kwam (A-keuze).
- **Starten** (A-invariant 1): `open({ groupId, title, endsAt })`.
  - De titel volgt de regels van een albumnaam (`lib/names.ts`): getrimd, 1 tot 50 tekens, geen onzichtbare tekens. Weigeringen: `NAME_REQUIRED`, `NAME_TOO_LONG`, `NAME_INVALID`.
  - Een groep zonder albums kan een project hebben.
  - De weigering "album van een andere groep" vervalt.
- **Schema `filmProjects`**:
  - `title: v.optional(v.string())` komt erbij.
  - `albumId` en `albumName` worden beide optioneel: ze bestaan alleen nog in oude rijen op dev.
  - Overal geldt als titel `title ?? albumName`.
  - `by_album` blijft zolang het veld bestaat; bij het verwijderen van een album haalt de backend `albumId` weg uit zo'n oude rij.
- **Antwoorden**, zonder `albumId` en `albumName`:
  - `listForGroup`: `{ projectId, title, endsAt, open }`;
  - `listOpenForMe`: `{ groupId, projectId, title, endsAt }`;
  - `get.project`: `{ projectId, groupId, title, endsAt, open, closedAt }`.
- **Album verwijderen**:
  - Mag altijd, ook als het project open staat, en ook bij een oude rij met `albumId`. Inzendingen blijven, want ze horen bij het project en het filmpje.
  - Daarmee vervallen `FILM_PROJECT_OPEN`, `albumHasOpenProject` en de melding in `groupAdmin.ts` (besluit 17).
- **Herinnering** (besluit 15): de mail noemt de titel.
- **WP10**: `filmProjects.albumId` blijft in `MONITORED_FKS`, als optioneel veld, zolang het in het schema staat.

**38c (app)**

- **Toevoegscherm** (vervalt: besluit 3, A-invariant 17, 38c-1, 38c-2, het splitsen bij 38c-14):
  - `addTargets` geeft:
    - het gekozen album;
    - het project van die groep, als er filmpjes meegaan;
    - één regel (besluit 27.4);
    - de schakelaar.
  - `roundTargets` werkt met datzelfde ene album.
  - `albumOption` en het grijze album vervallen; het kiesscherm is weer zoals WP39.
  - Met filmpjes en uploader wacht de knop tot de open projecten geladen zijn. Anders gaat het origineel stil niet mee.
  - Na afloop één melding, en "Naar album" gaat naar het gekozen album.
  - De upload-id van een filmpje hoort bij het gekozen album, zoals in WP37.
- **Starten**:
  - een titelveld en de einddatum; geen albumlijst, en de lege stand "Nog geen albums" vervalt;
  - "Starten" blijft grijs zolang de titel leeg is;
  - weigeringen over de titel zeggen "titel", niet "naam".
- **Balk, projectpagina, downloadpagina**:
  - overal "Filmproject [titel]";
  - de lege stand van de projectpagina zegt dat nieuwe filmpjes in deze groep ook als origineel naar dit project gaan.
- **Bestandsnaam**: blijft "datum en naam van de inzender". De titel staat er niet in (A-keuze): de map kiest de oprichter zelf bij het downloaden.
- **`originalPlan` (38b)**: ongewijzigd. Het kijkt naar de groep van het gekozen album, en dat is nu ook het album van het filmpje.

**Prod en deploy**

- Op prod draait 38a zonder projecten: `filmProjects` is leeg. Op dev staan rijen met `albumId` en `albumName`, zonder titel.
- Convex controleert bij een deploy alle bestaande rijen tegen het schema. Een verplichte `title` zou op dev falen. Daarom is `title` optioneel, met de albumnaam als terugval, en zijn `albumId` en `albumName` optioneel. Dat past op prod en op dev zonder migratie en zonder vaste volgorde. De tests met een oude rij leggen dat vast (`projects.test.ts`, `cascade.test.ts`, `integrity.test.ts`).
- De backend gaat vóór of samen met de app van 38c. Een oudere dev-build die `open` nog met `albumId` aanroept, krijgt een validatiefout; dat raakt alleen Wouter.
- Later, in een eigen klein WP en niet nodig voor 2.0.2: als de oude dev-rijen weg zijn, `title` verplicht maken en `albumId`, `albumName` en `by_album` weghalen.

**Blind spots**

1. **"Naar album" naar een groep met een project.** Een nieuw filmpje uit groep H (zonder project) dat tijdens een project van G met "Naar album" in G komt, mag insturen: het is nieuw, van de eigenaar, en staat in een album van G. Met X kon dat ook al. De app doet het niet, en het blijft het eigen filmpje van het lid. Aanvaardbaar; niet getest.
2. **Een album van het project verwijderen.** Leden zien het filmpje dan niet meer in dat album. Het origineel blijft wel op de projectpagina, met de poster via `/beeld/inzending/`. Dat is zoals bedoeld.
3. **Het lid ziet vooraf alleen de regel boven de knop.** Het kiesscherm zegt niets meer over een project. Zonder uploader (web, 2.0.1) is er geen regel en gaat er ook geen origineel.

**Testcontract (wijzigingen)**

- Backend: `open({ groupId: Id<"groups">, title: string, endsAt: number })`, en de antwoorden hierboven.
- App (`filmProject.ts`):

```ts
export type OpenFilmProject = { groupId: string; projectId: string; title: string };
export type AddTargets =
  | { ready: false }
  | { ready: true; albumId: string | null; projectId: string | null; lines: string[]; wifiSwitch: boolean };
export type RoundTargets =
  | { ready: false }
  | { ready: true; albumId: string | null; projectId: string | null; videoResult: boolean; tooLong: number };
export type ProjectRow = { projectId: string; title: string; endsAt: number; open: boolean };
// albumOption vervalt.
```

**Tests**

| Wat | Waar |
|---|---|
| alles naar het gekozen album, ook met een project, ook bij sluiten of openen tijdens de upload | `tests/filmProject/albumRule.test.ts` (omgedraaid) |
| een nieuw filmpje in Y mag insturen; een filmpje van vóór het project in Y niet; "Uit album" laat de inzending staan | `albumRule.test.ts`, `originals.test.ts` |
| starten met een titel: getrimd, 50 tekens wel, leeg, 51 en een tab niet; een groep zonder albums; geen album in het antwoord | `projects.test.ts` |
| een oude rij zonder titel: de albumnaam als titel, insturen werkt | `projects.test.ts` |
| album verwijderen tijdens een project mag (ook bij een oude rij); de inzending blijft en is te downloaden | `cascade.test.ts` (omgedraaid) |
| de herinnering noemt de titel | `cascade.test.ts` |
| WP10 met een oude rij; inventaris `open` met `title` | `integrity.test.ts`, `inventory.test.ts` |
| app: `addTargets`, `roundTargets` met één album, de regel van besluit 27.4, `ProjectRow` met titel, titel-weigeringen; geen test meer voor `FILM_PROJECT_OPEN`, `albumOption` of splitsen | `app/tests/filmProject.test.ts`, `filmProjectRoutes.test.ts` |

`tests/filmProject/_film.ts`: `openProject` geeft een titel (`PROJECT_TITLE`); `newVideoInX` kan een ander album van Reis nemen.

**Stand na A (besluit 27):**

- Backend: 163 van de 169 tests in `tests/filmProject/` rood. De meeste omdat `open` nog `albumId` eist (`Missing required field albumId`); de rest om het oude gedrag (omleiden, `FILM_PROJECT_OPEN`, `albumId`/`albumName` in de antwoorden, inventaris). De root-typecheck is schoon.
- App: 20 rood in `app/tests/filmProject.test.ts` (één album, de regel van besluit 27.4, de titel in de balk, titel-weigeringen). De app-typecheck faalt alleen op de nieuwe types in dat testbestand (`title` in plaats van `albumId`/`albumName`). De andere 2523 app-tests blijven groen.
- A draaide alles tegen een wegwerp-uitwerking buiten de repo (schema met optionele `title`, `albumName` en `albumId`; geen omleiden; geen `FILM_PROJECT_OPEN`; insturen per groep): de film-, inventaris- en migratietests van de backend (315) en de 128 app-tests van 38c groen, backend-typecheck schoon. Die uitwerking is weggegooid.

**Open vragen (voor Wouter)**

1. **De titel achteraf wijzigen?** Een tikfout staat anders een jaar lang op de balk, de projectpagina en in de mail. Advies: ja, voor de oprichter, op dezelfde plek als de einddatum. Dat is één extra backend-functie met de gate van `setEndsAt`. A schrijft de tests na het besluit.

**Wouter (2026-11-25), open vraag 1 van besluit 27 (A):** ja, de oprichter kan de titel achteraf wijzigen, op dezelfde plek als de einddatum (tik op de kop van de projectpagina). A-keuzes (album verwijderen mag altijd; bestandsnaam datum plus inzender; bij twee groepen telt het eerste album) aanvaard.

### Titel achteraf wijzigen (A)

- **Backend**: `filmProjects.setTitle({ projectId, title })` → `null`.
  - Toegang zoals `setEndsAt`: alleen de oprichter op het moment van het verzoek. Een admin of lid krijgt `NOT_ALLOWED`. Wie geen lid is, en een onbekend, ongeldig of verwijderd project, krijgt `NOT_MEMBER`.
  - De titelregels van `open`: `NAME_REQUIRED`, `NAME_TOO_LONG`, `NAME_INVALID`, getrimd. Een weigering verandert niets.
  - Alleen de titel verandert. Open, einddatum, sluiten en inzendingen blijven.
  - Een project van vóór besluit 27 krijgt zo een eigen titel in plaats van de albumnaam.
  - Inventaris: `setTitle` met `projectId` en `title`. Het id is een project-id, net als bij `setEndsAt`, en hoort dus niet in `beheerInventory`.
- **A-keuze: ook na sluiten.** Geen `PROJECT_CLOSED`, anders dan bij `setEndsAt`. Redenen:
  - de titel verandert niets aan insturen of opruimen;
  - een gesloten project staat nog tot een jaar op de balk, de projectpagina, de downloadpagina en in de herinnering, en juist dan valt een tikfout op.
- **App**:
  - `projectPageView` krijgt `changeTitle`: de oprichter in de app, open of gesloten. Niet voor een lid, niet op het web (alleen-lezen, W5).
  - `FilmAction` krijgt `"changeTitle"`, met dezelfde titel-teksten als bij starten.
  - Het scherm: tik op de kop van de projectpagina, zoals bij de einddatum. Dat toetst de gate.

| Wat | Test |
|---|---|
| backend | `tests/filmProject/setTitle.test.ts` (wijzigen, getrimd, overal zichtbaar; na sluiten; alleen de titel; oude rij; na overdragen; admin, lid, geen lid, onbekend, weg, uitgelogd; titelregels; 50 tekens), `inventory.test.ts` |
| app | `app/tests/filmProject.test.ts` (`changeTitle` per rol, platform en stand; `filmRefusalText` bij `changeTitle`) |

**Stand na A (titel):**

- Backend: 14 tests rood (13 nieuw in `setTitle.test.ts`, 1 in de inventaris) (`setTitle` bestaat niet). In `tests/filmProject/` samen 176 van de 182 rood, met die van besluit 27. De root-typecheck is schoon.
- App: 5 rood erbij in `filmProject.test.ts`, samen 25. De andere 2521 app-tests blijven groen.

### Feedback Wouter na besluit 27 (2026-11-25, webapp dev)

1. **Oprichter-sleutel:** op elke knop die alleen de oprichter heeft, staat links het eigen icoon van de handeling en **achter de tekst een gele sleutel** (Ionicons `key-outline`, goud: lichter in donker, donkerder in licht thema, contrast ≥ 3:1). Geldt voor: Filmproject starten (links een filmrol), Project sluiten, titel en einddatum wijzigen, Downloaden, Alles downloaden, Alles verwijderen. Het toegankelijkheidslabel noemt "oprichter".
2. **Lege standen in de hele app:** geen icoon in een cirkel met verloop meer, maar het icoon zelf in de kleuren van het verloop (zoals de verlooptekst). Lukt een verloop op het icoon niet netjes op iOS, Android en web, dan één effen kleur uit het verloop; melden.
3. **Overal "feature-film"** in plaats van "clubfilm" in de teksten van het filmproject (meldingen als een origineel niet meegaat, terugtrekken, alles verwijderen, lege standen).
4. Audit-nits besluit 27: commentaar in `convex/filmProjects.ts` (±72) en `convex/monitoring.ts` (±84) naar besluit 27; `TitleEditor` volgt een titel die elders verandert zolang de gebruiker niet typt.

### Feedback na besluit 27 (A)

- **Punt 1, de sleutel.** `FOUNDER_BUTTONS` in `filmProject.ts` vervangt `START_BUTTON`. Het bevat per handeling een tekst, een eigen icoon links (nooit de sleutel) en een label met de tekst en "oprichter". De handelingen: `start`, `close`, `changeTitle`, `changeEnd`, `download`, `downloadAll` en `removeAll`.
  - Vast: "Filmproject starten" met `film`, "Project sluiten", "Downloaden" en "Alles downloaden" met `download`, "Alles verwijderen" met `trash`.
  - Titel en einddatum wijzigen zijn twee knoppen met elk een eigen tekst.
  - Een knop in `src/components` zet de sleutel (`key`, getekend als `key-outline`) achter de tekst, in een nieuwe kleur `founderKey`.
  - `founderKey` is goud: tint 35–60°, verzadigd. In donker is hij lichter dan in licht. Het contrast is ≥ 3:1 op `bg` en `surface`, in beide thema's.
  - De schermen gebruiken `FOUNDER_BUTTONS` voor elke handeling, en `START_BUTTON` verdwijnt (bronscan). Hoe het eruitziet, toetst de gate.
- **Punt 2, lege standen.** Getest met een bronscan:
  - `EmptyState` tekent geen `Gradient` als cirkel meer;
  - het icoon staat niet meer in `onGradient`.

  Of het verloop op het icoon goed lukt op iOS, Android en web, toetst de gate. Lukt dat niet, dan één effen kleur: B meldt het.
- **Punt 3, feature-film.** Waar "feature-film" moet staan en "clubfilm" niet meer mag:
  - de meldingen als een origineel niet meegaat, elke reden, in enkel- en meervoud;
  - de bevestigingen van terugtrekken en alles verwijderen.

  Een bronscan zoekt in de strings (niet in het commentaar) van `filmProject.ts`, `FilmProjectScreens.tsx`, `FilmProjectParts.tsx`, `AddPhotosScreen.tsx` en `AddPhotosParts.tsx`: daar staat geen "clubfilm" meer. De clubfilms van WP21 houden hun naam.
- **Punt 4** (audit-nits) is alleen commentaar en het gedrag van `TitleEditor`: aan B, en de audit toetst het.

**Gate erbij:**
- de gele sleutel achter de tekst op elke knop van de oprichter, in licht en donker;
- VoiceOver zegt "oprichter";
- de lege standen zonder cirkel, op iPhone en in Safari en Chrome.

**Stand na A:** 26 nieuwe tests, alle rood: 15 in `app/tests/filmProject.test.ts` en 11 in `filmProjectRoutes.test.ts`. `FOUNDER_BUTTONS` en `founderKey` bestaan nog niet, de teksten zeggen nog "clubfilm", en `EmptyState` heeft nog de cirkel. De andere 2550 app-tests blijven groen. De app-typecheck faalt alleen op de ontbrekende export.

### Feedback Wouter, webapp dev (2026-11-25, tweede ronde)

1. **Sluiten ook in de webapp**, op de downloadpagina van de oprichter, met dezelfde bevestiging als in de app. Titel en einddatum wijzigen komen daar ook bij (zelfde plek, zelfde knoppen met sleutel).
2. **Mijn groepen:** bij een groep waarvan je oprichter bent, staat "Oprichter" in plaats van "Admin", met de gele sleutel erachter. App en webapp.

### Feedback webapp dev, tweede ronde (A)

- **Punt 1, de webapp.** `projectPageView` geeft op het web voor de oprichter ook `close` en `changeEnd` (alleen als het project open is) en `changeTitle` (altijd). Voor een lid op het web blijft alles uit. Dit is een tweede bewuste uitzondering op W5 (alleen-lezen web), net als downloaden en "Alles verwijderen": alleen de oprichter, alleen op de downloadpagina.
  - De knoppen komen uit `FOUNDER_BUTTONS`; de bevestiging is `closeConfirmation`, dezelfde als in de app.
  - De webvarianten-tabel en 38c-4 zijn bijgewerkt.
  - De plek op de downloadpagina toetsen audit en gate.
- **Punt 2, Mijn groepen.** Een nieuwe pure functie `myGroupRole({ role, createdBy, me })` in `groups.ts` geeft `{ label, founderKey }`.
  - Ben je de oprichter: "Oprichter", met de sleutel.
  - Anders "Admin" of "Lid", zonder sleutel.
  - Zolang de eigen user nog laadt: zoals nu, zonder sleutel.
  - Een bronscan checkt dat `MyGroupsScreen.tsx` `myGroupRole` gebruikt (niet meer `roleLabel`) en de sleutel tekent in `founderKey`, direct of via een `Founder…`-component.
  - Hetzelfde scherm geldt voor app en webapp.

**Gate erbij:**
- in Safari en Chrome als oprichter: Sluiten (met de bevestiging), Titel wijzigen en Einddatum wijzigen op de downloadpagina, elk met de gele sleutel;
- in Mijn groepen "Oprichter" met de sleutel, op de iPhone en in de webapp.

**Stand na A:** 9 tests rood:
- `app/tests/filmProject.test.ts`: 3, want het web geeft nog geen sluiten of titel en einddatum wijzigen;
- `app/tests/myGroupRole.test.ts`: 6 (nieuw bestand), want `myGroupRole` ontbreekt en het scherm gebruikt `roleLabel`.

De andere app-tests blijven groen.


### Feedback Wouter, derde ronde (2026-11-25)

1. **Lege standen: het icoon in het verloop**, het huidige schuine verloop (`gradStart` → `gradEnd`, 135°), in licht én donker thema gelijk. Web: CSS (`background-clip: text`). iOS en Android: `@react-native-masked-view/masked-view` als echte afhankelijkheid (`npx expo install`), komt mee in de volgende native build.
2. **Brede schermen** (webapp, iPad liggend): projectpagina en downloadpagina gebruiken de indeling van de groepspagina (`WideSplit`/`WideSide`): links titel, stand, schakelaar en de knoppen van de oprichter; rechts de lijsten. Smal blijft zoals nu.

### Feedback derde ronde (A)

Bronscans in `app/tests/filmProjectLayout.test.ts`. Het uiterlijk zelf toetst de gate.

- **Punt 1, het icoon in het verloop.** A-keuze: één component `GradientIcon`, die `EmptyState` gebruikt, in plaats van `Icon` in een effen kleur.
  - `src/components/GradientIcon.tsx` (iOS en Android): maskeert het verloop van `gradStart` naar `gradEnd` met `@react-native-masked-view/masked-view`. Dat is een echte afhankelijkheid in `app/package.json` (`npx expo install`), en komt dus mee in de volgende native build.
  - `src/components/GradientIcon.web.tsx`: CSS met `background-clip: text` en `linear-gradient(135deg, …)` van `gradStart` naar `gradEnd`, zonder masked-view.
  - Vangnet: het verloop is in licht en donker gelijk (de tokens). Deze test is al groen.
  - De scan van de vorige ronde blijft: geen cirkel en geen `onGradient`.
- **Punt 2, brede schermen.** `FilmProjectScreens.tsx` importeert `WideSplit` en `WideSide` uit `./WideSide`. `ProjectPage` en `DownloadPage` roepen elk `useWideLayout()` aan en gebruiken een `Wide…`-component. Wat links en wat rechts staat, toetst de gate.

**Gate erbij:**
- het icoon in het verloop in een lege stand: op de iPhone (licht en donker) en in Safari en Chrome;
- projectpagina en downloadpagina breed, in de webapp en op een iPad liggend. Links staan titel, stand, schakelaar en de knoppen van de oprichter, rechts de lijsten. Smal blijft zoals het was.

**Stand na A:** 7 tests rood:
- masked-view ontbreekt in `package.json`;
- `EmptyState` gebruikt `GradientIcon` niet;
- `GradientIcon.tsx` en `.web.tsx` bestaan niet;
- `useWideLayout`, `WideSplit` en `WideSide` ontbreken in het scherm, in `ProjectPage` en in `DownloadPage` (3 tests).

Groen: het vangnet voor de tokens. De andere app-tests blijven groen.

### Besluit 28 (Wouter, 2026-11-25, build 93)

Start de oprichter een filmproject in een groep **zonder album**, dan maakt de backend in dezelfde mutation een leeg album met de titel van het project (de gewone albumregels: maker is de oprichter, naam als albumnaam). Heeft de groep al een album, dan gebeurt er niets extra. Aanleiding: in een groep zonder album kon je wel een project starten, maar geen filmpje toevoegen.

### Besluit 28 (A)

- **Gedrag.** `filmProjects.open` in een groep zonder album maakt in dezelfde mutation een album, met de velden die `albums.create` zou geven:
  - `groupId`;
  - als naam de getrimde titel (dezelfde naamregels);
  - `createdBy` de oprichter;
  - `createdAt` nu;
  - geen omschrijving, cover of `sortDate`;
  - geen foto's.

  Leden zien het album in de groep, zonder ongelezen foto's. Er is verder niets dat een nieuw album "merkt": `albums.create` doet ook niets anders.
- **Los van het project.** Het album is een gewoon album en het project hangt er niet aan (besluit 27). Een andere albumnaam verandert de titel niet, en andersom ook niet. Een nieuw filmpje in dat album levert een origineel.
- **Niets erbij:**
  - de groep heeft al een album, ook als dat het album van een eerder project is;
  - elke weigering van `open`: titel, datum, `PROJECT_ALREADY_OPEN`, `NOT_ALLOWED`, `NOT_MEMBER`. De mutation is één transactie, en de controles gaan vóór het maken.
- **Cascades.** Het album is van de oprichter, zoals elk album dat hij maakt. Account verwijderen (WP29, `by_createdBy`) en groep verwijderen behandelen het dus als elk ander album. Geen nieuwe rij in de cascade-matrix: het is de bestaande "album maken", via een ander pad.
- **App.** Geen pure logica erbij: de albumlijst van de groep is live, dus het nieuwe album staat er vanzelf.

| Wat | Test |
|---|---|
| album met de titel, velden zoals `albums.create`, zichtbaar zonder ongelezen; los van de titel; origineel in dat album | `tests/filmProject/emptyGroupAlbum.test.ts` (rood: 4) |
| geen album bij een groep met album, bij een tweede project, en bij elke weigering | `emptyGroupAlbum.test.ts`: 6 tests. 5 groen als vangnet, 1 rood: "tweede project na sluiten" heeft het album van het eerste nodig |

**Gate erbij:** start als oprichter een project in een groep zonder album. Het album met de titel staat meteen in de groep en in het kiesscherm van het toevoegscherm. Een filmpje daarin geeft "wordt ook als origineel bewaard".

**Stand na A:** 5 rood en 5 groen, in één nieuw bestand. A draaide alle 192 tests van het filmproject tegen een wegwerp-uitwerking (een album maken na de controles in `open`): allemaal groen. Die uitwerking is weggegooid. De root-typecheck is schoon.

### Besluit 30 (Wouter, 2026-11-25): kortere teksten

De bevestigingen en meldingen van het filmproject worden ongeveer de helft korter (de iOS-melding met Liquid Glass leest slecht bij veel tekst):

| Waar | Tekst |
|---|---|
| Project sluiten | "Nieuwe filmpjes gaan dan niet meer mee. Wat onderweg is, mag nog 14 dagen binnenkomen." |
| Terugtrekken | "Het filmpje blijft in het album, maar kan nooit meer mee naar een feature-film." |
| Alles verwijderen | "[n] originelen gaan weg, ook wat nog onderweg is. De filmpjes blijven in de albums." (enkelvoud: "1 origineel gaat weg, ook als het nog onderweg is. Het filmpje blijft in het album.") |
| Geen ruimte | "[n] filmpjes niet naar de feature-film: te weinig ruimte op je iPhone." (enkelvoud "1 filmpje") |
| Te klein / te groot | "[n] filmpjes te klein voor de feature-film." / "… te groot …" (enkelvoud "1 filmpje") |
| Niet gelukt (overig) | "[n] filmpjes niet naar de feature-film." |
| Algemene fout | "Dat lukte niet. Probeer het opnieuw." |
| Verkeerd teken in titel | "De titel bevat een teken dat niet mag." |

Andere teksten die langer zijn dan nodig: zelfde stijl (kort, wat de gebruiker moet weten). Een eigen dialoog met dichte achtergrond in plaats van de iOS-melding is een apart werkpakket (later).
