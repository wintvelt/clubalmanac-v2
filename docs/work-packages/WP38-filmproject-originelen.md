# WP38: filmproject, originelen voor de clubfilm

> Regie 2026-11-21. Route 2 van twee, na [WP37](./WP37-filmpjes-in-albums.md) (route 1) en bovenop wat die neerzet (R2, poster, upload naar R2). Concept: A begint pas als WP37 af is. A → besluiten Wouter → B → audit → red-team → gate op een echte iPhone met een origineel in 4K. Eigen branch `wp38`.

## Productdoel

Na een reis zetten de admins van een groep hun filmpjes in volle kwaliteit in een tijdelijk filmproject van die groep, zodat Wouter er een nieuwe clubfilm van kan monteren. Ze zien elkaars bijdragen als poster, niet als filmpje. Wouter downloadt de originelen op zijn laptop, met datum en plaats erin, en ruimt ze op als de film klaar is; na een jaar gaan ze sowieso weg.

## Besluiten (Wouter, 2026-11-21)

1. **Leden zien alleen de poster** van een origineel, geen afspelen.
2. **Filmproject per groep.** De eigenaar van een groep zet tijdelijk een filmproject open, als tab naast Albums, Films en Leden. Alle admins van die groep kunnen er originelen in zetten en zien de posters van alle bijdragen.
3. **Bewaren tot Wouter ze verwijdert, hooguit een jaar.**
4. **GPS blijft in het origineel.** Datum en plaats zijn nuttig bij het monteren. Dit is een bewuste uitzondering op WP17d (geen GPS in uitgaande bestanden): alleen de downloader krijgt het bestand.

## Wat er is (na WP37)

- R2 met ondertekende links, poster op het toestel, upload naar R2 met reservering, opruimen en integriteits-check voor filmpjes (WP37).
- Rollen per groep: oprichter, admin, lid ([WP28](./WP28-groepsbeheer.md)). De tab Films bestaat alleen voor groepen met clubfilms ([WP21](./WP21-videos.md)).
- Webmaster-rol (`WEBMASTER_EMAILS`, [WP20](./WP20-melden.md)).

## Invarianten

1. **Toegang zit in de backend.** Uploaden en posters zien: alleen admins van die groep, alleen zolang het project open staat (uploaden). Downloaden: zie open vraag 2. Geen link naar een origineel voor wie niet mag downloaden, ook niet via een poster- of afspeelpad.
2. **Een origineel is nergens anders zichtbaar:** niet in albums, Mijn foto's, de kaart of de webapp, behalve de posters in het project.
3. **Het origineel blijft onaangetast:** zelfde bestand als op de iPhone (geen compressie, metadata inclusief GPS intact). De poster bevat geen GPS.
4. **Grote bestanden komen heel aan of niet.** Een upload van 1 GB of meer die stopt, gaat verder of begint opnieuw; geen half bestand dat als klaar telt. Geen dubbele originelen bij opnieuw proberen.
5. **Weg na een jaar, ook in R2.** Ook bij project verwijderen en account verwijderen (wat gebeurt er met de bijdragen van iemand die vertrekt: open vraag 6).
6. **Kosten blijven binnen budget** (≤ €15 per maand voor alles samen): grens per bestand of per project als dat nodig is.

## Scope

- **In:** filmproject openen en sluiten door de eigenaar; tab in de groep; originelen uploaden vanaf de iPhone (in delen, hervatten, bij voorkeur alleen via wifi en op de achtergrond); posters van alle bijdragen; downloaden op de laptop via de webapp; verwijderen en de grens van een jaar; integriteits-check en kosten.
- **Bewust niet:** afspelen van originelen in de app; monteren in de app; uploaden vanuit de webapp (tenzij A het goedkoop vindt); originelen in de maandelijkse backup (zie open vraag 7).

## Open vragen voor A (rapporteren aan regie)

1. **Wie is "de eigenaar"?** De oprichter, of elke admin? Kan er per groep één project tegelijk open staan, met een naam (bv. "Georgië 2027")?
2. **Wie downloadt?** Alleen de webmaster, of de eigenaar van de groep? Hoe ziet de downloadpagina in de webapp eruit (lijst met poster, naam van de uploader, datum, grootte; alles in één keer)?
3. **Uploaden van grote bestanden.** Multipart naar R2 met ondertekende delen; hervatten na een onderbreking; op de achtergrond doorgaan (iOS background-sessie) of alleen met de app open; wifi-only als keuze?
4. **Kiezen van het origineel.** Geeft de picker het echte origineel (HEVC, 4K, met metadata) zonder om te zetten? Ook bij iCloud-foto's die nog niet op het toestel staan?
5. **Grenzen en kosten.** Grootte per bestand, totaal per project; opslag 50–100 GB een jaar lang; R2-tarieven bevestigen.
6. **Vertrek en account verwijderen.** Gaan de originelen van een vertrekkend lid weg, of blijven ze in het project tot het sluit?
7. **Backup.** Originelen bewust niet in de backup (ze staan ook nog op de telefoons)? Wouter beslist.
8. **Herinnering** vóór de grens van een jaar, of stil verwijderen?

## Risico-assessment

- **security/privacy: hoog.** Originelen met GPS; strikte toegang op downloaden; uitzondering op WP17d.
- **ops: hoog.** Uploads van gigabytes over mobiel en wifi; halve multipart-uploads in R2 (kosten, wezen); automatisch verwijderen na een jaar.
- **external deps: medium.** R2 multipart; achtergrond-upload op iOS.
- **multi-user/concurrency: medium.** Meerdere admins tegelijk; project sluiten tijdens uploads.
- **data/schema-evolutie: medium.** Nieuwe tabellen (project, bijdrage); geen wijziging aan bestaande rijen.
- **ops-runbook-impact:** levenscyclusregels in R2 (halve multipart-uploads, een jaar), eventueel een aparte bucket; runbook voor downloaden. B levert ze mee, audit toetst.
- **toegangsdefinitie:** nieuwe toegang tot originelen en posters in een project; inventaristest.

## Cross-refs

- WP37 (route 1, R2), WP28 (rollen), WP21 (tab Films), WP20 (webmaster), WP17d (GPS-regel), WP29 (account verwijderen).

## Spec-criticus aanvullingen (A vult in)
