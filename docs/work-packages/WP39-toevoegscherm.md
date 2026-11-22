# WP39: toevoegscherm voor foto's en filmpjes

> Regie 2026-11-22. Na [WP37](./WP37-filmpjes-in-albums.md), vóór de release van app 2.0.2: de leden krijgen de filmpjes en een mooier toevoegscherm in één keer. Alleen UI, geen backend. A → B → audit → gate op een echte iPhone (dev-build). Eigen branch `wp39`, vanaf `main` na de merge van WP37.

## Productdoel

Het scherm "Foto's toevoegen" komt uit de tijd van alleen foto's. Sinds WP37 kun je er ook filmpjes kiezen, maar het scherm zegt nog overal "foto's", toont een filmpje als tekstregel in plaats van als tegel, en "Andere foto's kiezen" gooit je hele keuze weg. Na WP39 behandelt het scherm foto's en filmpjes gelijk, zie je wat je kiest als tegels, en kun je je keuze aanvullen en inkorten.

## Besluiten (Wouter, 2026-11-22)

Gezien op de iPhone (gate WP37) en akkoord op alle vijf de voorstellen van regie:

1. **Teksten: foto's én filmpjes.** De kop wordt "Toevoegen" (ook de toegankelijkheidsnaam van de + in de tabbalk en de knop in het album). Lege stand "Kies foto's of filmpjes". "Meer foto's" na een ronde wordt "Meer toevoegen". De uploadknop heet altijd "Toevoegen aan album", met een upload-icoon in plaats van de +.
2. **Een filmpje is een tegel** tussen de foto's, met een omslag (beeld uit het filmpje) en de duur rechtsonder. Volgorde zoals gekozen in de kiezer (nu eerst alle foto's, dan de filmpjes). Tijdens een ronde staat de stand van een filmpje op zijn tegel (verkleinen en versturen met percentage, klaar, mislukt).
3. **Selectie aanpassen.** "Meer toevoegen" opent de kiezer en voegt toe aan de keuze (wat al gekozen is komt er niet dubbel in). Een × op elke tegel haalt dat item uit de keuze. Vervangt "Andere foto's kiezen". De systeemkiezer kan een eerdere keuze niet vooraf aanvinken (expo-image-picker 58 heeft geen optie daarvoor).
4. **Indeling.** Tegels in een raster over de hele breedte, zoals in het album, in plaats van 7 kleine tegels van 64 px plus "+ n". De hoofdknop onderaan het scherm, binnen bereik van de duim.
5. **Te lang meteen zien.** Een filmpje langer dan wat verstuurd mag (`videoTooLongToSend`) krijgt al vóór het uploaden een markering op de tegel, met de reden. Nu blijkt het pas na de tik op uploaden.

## Wat er is

- `app/src/screens/AddPhotosScreen.tsx` (iOS) en `AddPhotosScreen.web.tsx` (web, alleen foto's), met gedeelde delen in `AddPhotosParts.tsx` (`RoundResult`, `AlbumChoice`).
- Kop via `app/src/app/_layout.tsx`; de + in `app/src/navigation/TabBar.tsx`; de knop in `app/src/screens/AlbumScreen.tsx`.
- Upload-ids per asset en album via `albumBatch` (`app/src/lib/upload.ts`); dezelfde id bij opnieuw proberen en in een nieuwe ronde (WP18 A-invariant 25, WP37 invariant 4).
- Poster maken op het toestel: `makePoster` in `app/modules/clubalmanac-video` (JPEG van een beeld na ~1 s).
- Teksten en grenzen voor filmpjes: `app/src/lib/videos.ts` (`formatDuration`, `videoTooLongToSend`, `videoFailMessage`).

## Invarianten

1. **Geen dubbele uploads.** Een item dat via "Meer toevoegen" opnieuw wordt gekozen, staat één keer in de keuze en houdt zijn upload-id. Weghalen en opnieuw kiezen geeft ook geen tweede foto of filmpje in het album.
2. **De keuze ligt vast tijdens een ronde.** Geen × en geen "Meer toevoegen" zolang er iets verstuurd wordt (zoals nu: album en keuze liggen vast, de modaal sluit niet).
3. **Volgorde = volgorde in de kiezer**, ook na "Meer toevoegen" (nieuw achteraan) en na weghalen.
4. **De omslag van een tegel is lokaal en tijdelijk.** Geen extra netwerkverkeer; tijdelijke bestanden worden opgeruimd als het scherm sluit of het item uit de keuze gaat. Lukt een omslag niet, dan een neutrale tegel met film-icoon en duur, geen fout.
5. **Een lange keuze blijft vlot.** 50 foto's plus een paar filmpjes: het scherm opent en scrolt zonder haperen; omslagen van filmpjes komen na elkaar, niet allemaal tegelijk.
6. **Toegankelijk.** Elke tegel heeft een naam ("Foto 3", "Filmpje 1, 0:36, te lang" enz.), de × heeft een eigen naam ("Haal foto 3 uit je keuze") en een tikvlak van minstens 44 pt.
7. **Bestaande regels blijven:** opnieuw proberen per reden, "Naar album", het scherm blijft aan tijdens een ronde, de kiezer opent meteen bij openen, "Je keuze ophalen…" zolang iOS de originelen kopieert.

## Scope

- **In:** iOS-scherm zoals hierboven; de teksten op het web gelijktrekken (kop, lege stand, "Meer toevoegen", knoptitel).
- **Open (A adviseert):** × en "Meer toevoegen" ook op het web, als dat goedkoop is met de bestaande gedeelde delen.
- **Bewust niet:** de iOS-kiezer vervangen door een eigen bibliotheek-scherm; filmpjes op het web (WP37-besluit); bijsnijden of inkorten van filmpjes.

## Open vragen voor A (rapporteren aan regie)

1. **Omslag maken:** `makePoster` op het origineel (4K HEVC) per tegel, of kan `expo-image` een tegel voor een video tonen uit de `ph://`-id of de bestands-uri? Wat kost `makePoster` per filmpje op een iPhone 15 Pro-achtig toestel, en hergebruikt de upload deze omslag?
2. **Keuze samenvoegen:** op welke sleutel ontdubbel je (`assetId`; wat als die ontbreekt, bv. bij iCloud-items)? Wat gebeurt er met een item dat al in het album staat uit een vorige ronde?
3. **Raster:** hoeveel kolommen op iPhone en iPad (liggend met zijkolom), en past dat bij de tegels van het album (`radius.albumTile`)?
4. **Knop onderaan:** vast onder in beeld of aan het eind van de inhoud? Hoe gaat dat samen met de albumkeuze die openklapt?
5. **Web:** zie Scope, open punt.

## Risico-assessment

- **UI/regressie: medium.** Het scherm is het hart van het uploaden; de bestaande regels (invariant 7) moeten blijven werken.
- **data: laag.** Geen backend- of schemawijziging; alleen de keuze aan de kant van de app.
- **multi-user/concurrency: laag.**
- **ops-runbook-impact:** geen. De What's New van 2.0.2 noemt het toevoegscherm.
- **toegangsdefinitie:** geen nieuwe.

## Cross-refs

- WP18 (toevoegscherm, upload-ids), WP33 (melding na een ronde), WP36 (web), WP37 (filmpjes, poster, gate).
