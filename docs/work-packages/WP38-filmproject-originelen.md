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
