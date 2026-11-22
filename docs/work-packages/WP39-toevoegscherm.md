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

## Spec-criticus aanvullingen (A vult in)

> A 2026-11-22. Bronnen: deze spec, de huidige app-code (`AddPhotosScreen*`, `AddPhotosParts`, `upload.ts`, `videos.ts`, `videoUpload.ts`, de module `clubalmanac-video`), de broncode van `expo-image` 58.0.18, `expo-image-picker` 58.0.10 en `expo-video` 58.0.14 in `app/node_modules`, en het oude toevoegscherm (`clubalmanac-app/screens/Add.jsx`). Gemeten op de server (M1) met het iPhone-origineel uit WP37. Niets op een echte iPhone gezien: dat staat bij de gate.

### Pariteit met de oude app

Het oude scherm "Foto's delen" had alleen foto's, 7 tegels van 32 pt en "+ n", één knop "(selecteer foto's)" die de keuze verving, en na de ronde "ga naar album" en "Meer foto's". Geen weghalen, geen aanvullen. Annuleren in de kiezer wiste daar de keuze; nu blijft hij staan, en dat moet zo blijven (A4). Niets uit de oude app dat WP39 mist.

### Gemeten

`VideoPoster` uit de module, los gedraaid op het iPhone 15 Pro-origineel (4K HEVC HDR, 18,8 s, 73,7 MB): de eerste keer 418 ms, daarna 64 ms, een JPEG van 1920 × 1080 en 1,3 MB. Met een grens van 400 px: 36 ms en 61 kB. Zonder tolerantie rond het tijdstip (zoals `expo-video` het doet) ook 36 ms. De M1 is geen iPhone; de orde van grootte (een paar honderd ms voor de eerste, daarna onder de 100 ms) meet de gate na.

### Antwoorden op de open vragen

1. **Omslag maken: `makePoster` op het bestand van de kiezer, één voor één.** Wat de bibliotheken kunnen:
   - `expo-image` met `ph://<assetId>` toont via Foto's ook een beeld van een filmpje, maar alleen met toestemming voor de fotobibliotheek (volledig of beperkt; `PhotoLibraryAssetLoader` weigert anders). De app vraagt die toestemming niet: de systeemkiezer heeft hem niet nodig (WP18 A-kernvondst 7). Erom vragen voor een tegel is een nieuwe iOS-vraag aan elk lid. Niet doen.
   - `expo-image` met de bestands-uri van een `.MOV`: werkt niet. `expo-image` decodeert beelden (SDWebImage, met extra coders voor WebP, SVG en PSD), geen video.
   - `expo-video` kan het: `createVideoPlayer(uri)` en `generateThumbnailsAsync` geven een beeld in het geheugen dat `expo-image` direct toont, zonder tijdelijk bestand. Maar elke omslag kost een speler die je weer moet vrijgeven, en het levert niets op ten opzichte van de module.
   - `makePoster(asset.uri)` uit de eigen module werkt op het bestand dat de kiezer al naar de app kopieerde, zonder toestemming, en is gemeten snel genoeg. Het schrijft een JPEG tot 1920 px (1,3 MB) naar de tijdelijke map; die moet weg als het item uit de keuze gaat of het scherm sluit (invariant 4). Een grens per aanroep (400 px) zou de module veranderen en een nieuwe build vragen; de winst is klein (zie B-besluit 5).
   - **De upload hergebruikt deze omslag niet.** De poster die mee naar de backend gaat, komt uit het verkleinde filmpje (WP37 A-antwoord 4: hetzelfde beeld en dezelfde SDR-kleuren als het filmpje), en dat bestaat pas na het verkleinen. De omslag van de tegel komt uit het origineel. Twee bestanden, twee doelen.
2. **Ontdubbelen op `assetId`.** De kiezer is ingesteld met de fotobibliotheek (`PHPickerConfiguration(photoLibrary: .shared())`); dan heeft elk gekozen item een `assetId`, ook een item dat nog in iCloud staat (het is de lokale id in Foto's, geen bestand). Ontbreekt hij toch, dan is er geen betrouwbare andere sleutel: bestandsnaam en grootte kunnen bij twee verschillende items gelijk zijn. Zo'n item komt er dan altijd bij, net als `albumBatch` hem een nieuwe upload-id geeft (A1). Een item dat in deze app-sessie al in hetzelfde album kwam, krijgt via `albumBatch` dezelfde upload-id: de backend geeft de bestaande foto of het bestaande filmpje terug, geen tweede. Na een herstart van de app weet de app dat niet meer (WP18 besluit 3); dat blijft zo. Een filmpje wordt dan wel eerst opnieuw verkleind voordat blijkt dat het er al is (A14).
3. **Raster: dezelfde regel als het album.** Het album heeft vierkante tegels met 2 pt ertussen, zonder ronde hoeken, 3 kolommen onder 600 pt breedte en 4 vanaf 600 (`columnsFor` in `AlbumScreen`). `radius.albumTile` (12) hoort bij de albumcovers op het groepsscherm en de uitnodigingen, niet bij de fototegels in een album; de huidige 64 px-tegels gebruiken er de helft van. Voor de iPhone: 3 kolommen, staand en liggend; liggend is de modaal ~850 pt breed, dus 4. Op de iPad is "Toevoegen" een paginavel (`presentation: "modal"`), smaller dan het venster, zonder zijkolom: de brede layout van WP35 geldt hier niet. De breedte die telt is die van het vel zelf, niet van het venster (A8). Naar verwachting 4 kolommen; de gate kijkt staand en liggend.
4. **De hoofdknop vast onderin, buiten het scrollen.** Met 50 tegels staat een knop aan het eind van de inhoud ver weg. Aanbevolen indeling, van boven naar beneden: de uitkomst van de ronde (als die er is), de albumkeuze, het aantal met "Meer toevoegen", het raster. Onderin, boven de thuisbalk, "Toevoegen aan album". Klapt de albumkeuze open, dan groeit de inhoud en blijft de knop staan; hij werkt pas als er een album gekozen is. Tijdens en na een ronde staat er onderin niets: de knoppen van de uitkomst ("Opnieuw proberen", "Naar album", "Meer toevoegen") blijven bovenaan bij hun melding, zoals in `RoundResult` (gedeeld met het web). Zie B-besluit 4.
5. **Web: in WP39 alleen de teksten.** × vraagt dat elke tegel zichtbaar is; het web toont nu 7 tegels en "+ n", dus × op het web betekent ook daar het raster. Dat is niet goedkoop, en de gate van WP39 is een iPhone, geen browser. Wel goedkoop en zonder gedragswijziging: kop, knoptitel en "Meer toevoegen" na een ronde (via `RoundResult`). "Andere foto's kiezen" blijft op het web, anders kun je daar een verkeerde keuze niet meer kwijt. De lege stand op het web blijft "Kies foto's": filmpjes kiezen kan op het web niet (WP37-besluit). Zie B-besluiten 1 en 2.

### Wat in de draft niet klopt of ontbreekt

- **"De knop in het album" bestaat alleen op het web** (`WEB_UPLOAD`). Op iOS is de + in de tabbalk de enige ingang.
- **De iconen ontbreken.** Er is geen upload-icoon en geen kruisje in `Icon`. `share` lijkt op een upload-pijl maar betekent delen; niet gebruiken.
- **"Meer toevoegen" heeft twee betekenissen.** Vóór een ronde: aanvullen. Na een ronde: wat er nu "Meer foto's" heet, een nieuwe keuze. Na een ronde aanvullen zou de klare items opnieuw sturen; voor een filmpje betekent dat opnieuw verkleinen (het verkleinde bestand wordt na "klaar" weggegooid) voordat de backend zegt dat het er al is. Zie A4.
- **Annuleren mag de keuze niet wissen.** `morePhotos` wist nu alles vóór de kiezer opengaat; annuleren laat dan een leeg scherm achter. Met aanvullen moet annuleren niets veranderen, ook niet na een ronde (A4).
- **50 tegels is een ander scherm dan 7.** `expo-image` decodeert een lokaal beeld op volle grootte en verkleint pas daarna, tenzij `enforceEarlyResizing` aan staat. Een 24 MP-foto van een iPhone 15 Pro is ~100 MB aan pixels. En `Screen` is een gewone `ScrollView`: alle tegels tegelijk. Met 7 tegels viel dat niet op. Zie A9 en invariant 5.
- **De kiezer kopieert elk gekozen origineel naar de app** (`Caches/ImagePicker`), ook een item dat al in de keuze stond, en niemand ruimt die kopieën op. Bij filmpjes zijn dat honderden MB, en het opnieuw kopiëren verlengt "Je keuze ophalen…". De kiezer kan niet vooraf aanvinken, dus dubbel kiezen gebeurt. Zie B-besluit 3.
- **De breedte van de modaal is niet de breedte van het venster.** Op de iPad geeft `useWindowDimensions` het venster, niet het paginavel (A8).
- **De grens van "te lang" en de getoonde duur.** Een filmpje van 180,45 s toont als "3:00" en is toch te lang (grens 180,4 s). Een tegel met "3:00, te lang" spreekt zichzelf tegen (A7).
- **Bestaande bronscans leggen dingen vast** die B moet laten staan: `pickFetching.test.ts` (in `AddPhotosScreen.tsx` een `pick()` met de ophaal-state om `launchImageLibraryAsync`, en een `Button` met `onPress` naar `startUpload` die niet verschijnt zolang die state waar is), `videos.test.ts` (`videoTooLongToSend(`, `retryVideos` met `videoRetryRound`, `uploadVideo({ … freshToken`), `upload.test.ts` (`albumBatch` met de `assetId`).

### A-invarianten

1. **Sleutel = `assetId`.** Twee items met dezelfde `assetId` staan één keer in de keuze. Zonder `assetId` komt een item er altijd bij (uitzondering op invariant 1, gelijk aan `albumBatch`).
2. **Dubbel gekozen = blijft waar het stond.** Een item dat er al in stond, houdt zijn plek, zijn sleutel en zijn omslag; nieuwe items komen achteraan in de volgorde van de kiezer, foto's en filmpjes door elkaar.
3. **Soort.** Een item met `type: "video"` is een filmpje; een `pairedVideo` komt niet in de keuze; al het andere (`image`, `livePhoto`, geen type) is een foto. Zoals nu.
4. **"Meer toevoegen" en annuleren.** Vóór de eerste tik op "Toevoegen aan album" vult hij de keuze aan. Na een afgeronde ronde begint hij een nieuwe keuze met alleen wat je nu kiest; het album blijft gekozen. Annuleren in de kiezer verandert niets: de keuze, of de uitkomst van de ronde, blijft staan. Zolang iOS de nieuwe items kopieert, staat "Je keuze ophalen…" in beeld; de tegels die er al waren mogen blijven, de knop "Toevoegen aan album" niet.
5. **× alleen vóór de ronde.** Na de tik op "Toevoegen aan album" hoort de keuze bij de ronde: geen ×, ook niet als de ronde klaar is. De tegels tonen dan hun stand.
6. **Leeg na weghalen.** Haal je het laatste item weg, dan staat de lege stand er weer ("Kies foto's of filmpjes", met de knop om te kiezen). Het gekozen album blijft onthouden.
7. **Namen.** Per soort genummerd, in de huidige volgorde: "Foto 3", "Filmpje 1, 0:36". Een filmpje dat te lang is om te versturen: "Filmpje 1, 3:01, te lang"; de duur van zo'n tegel wordt naar boven afgerond, zodat hij nooit "3:00" toont. Zonder duur: alleen "Filmpje 2". De × heet "Haal foto 3 uit je keuze" of "Haal filmpje 1 uit je keuze". Tijdens een ronde komt de stand achter de naam.
8. **Kolommen uit de eigen breedte.** Het raster rekent met de breedte die het zelf krijgt (gemeten), met de kolomregel van het album (A-antwoord 3); bij draaien of een ander formaat van het vel rekent het opnieuw.
9. **Tegels op tegelmaat.** Een foto- of omslagtegel decodeert het beeld op de maat van de tegel, niet op volle grootte, en zet het niet in de schijfcache van `expo-image`. Wat buiten beeld is, hoeft niet gedecodeerd te zijn.
10. **Omslagen.** Na elkaar, in de volgorde van de keuze, alleen voor filmpjes die er nog in staan. Gaat een item uit de keuze terwijl zijn omslag gemaakt wordt, dan gaat die omslag weg zodra hij klaar is. Bij sluiten gaan alle omslagen weg. Een mislukte omslag wordt niet opnieuw geprobeerd: een neutrale tegel met film-icoon en duur.
11. **De omslag is geen poster.** De upload maakt zijn eigen poster uit het verkleinde filmpje, zoals nu.
12. **Te lang telt mee in de ronde.** Een filmpje dat te lang is, staat vóór de ronde gemarkeerd en komt in de ronde direct op "niet gelukt" met de reden, zoals nu. Ook als alleen zulke filmpjes in de keuze staan.
13. **De stand van een filmpje op de tegel.** Wacht, voorbereiden, verkleinen en versturen met percentage (afgerond, tussen 0 en 100 %), afronden, in het album, niet gelukt. Dezelfde stappen als de rijen nu.
14. **Al eerder verstuurd.** Een item dat in deze sessie al in dit album kwam en opnieuw gekozen wordt: geen tweede in het album (dezelfde upload-id). Een filmpje wordt daarvoor eerst opnieuw verkleind; dat lost WP39 niet op.

### Gate-checks (alleen te zien op een echte iPhone of iPad)

- Omslag: hoe lang tot de eerste en de volgende omslag op een 4K HDR-origineel van 1–3 minuten; de kleuren van een HDR-omslag; scrollen terwijl omslagen binnenkomen.
- 50 foto's (24 MP) en 3 filmpjes: openen, scrollen zonder haperen, geen crash door geheugen; hoe lang "Je keuze ophalen…" duurt.
- iCloud: een foto en een filmpje die nog niet op het toestel staan. Heeft de kiezer een `assetId` gegeven (ontdubbelen werkt), en ook bij een item uit een gedeeld album?
- "Meer toevoegen": de kiezer opent boven de modaal; annuleren laat alles staan; twee al gekozen items opnieuw kiezen geeft geen extra tegels.
- iPad staand en liggend, iPhone liggend: aantal kolommen, het vel, × bereikbaar; draaien met een keuze.
- De knop onderin: boven de thuisbalk, bij de grootste tekstgrootte, met de albumkeuze open.
- VoiceOver: de namen van tegels en ×, de volgorde (inhoud, dan de knop onderin), de stand tijdens een ronde.
- De stand van een filmpje leesbaar op een tegel van ~130 pt; × en markering "te lang" leesbaar op een lichte en een donkere foto, in licht en donker.
- "Toevoegen" als kop, als naam van de + (VoiceOver) en het upload-icoon op de knop.

### A-keuzes

- **Geen melding bij dubbel kiezen.** De tegels laten zien wat er is; een extra regel "2 stonden er al in" is niet nodig.
- **Te lang: duur naar boven afgerond** op de tegel (A7). Het album toont de duur van een filmpje dat binnen is ongewijzigd.
- **De bestaande teksten voor de stand** ("Verkleinen… 42%" enz.) blijven; of ze op de tegel passen, ziet de gate.

### Besluiten voor Wouter

1. **Web in WP39: alleen de teksten** (aanbevolen), of ook raster, × en "Meer toevoegen" (dan ook een browser-gate).
2. **Lege stand op het web blijft "Kies foto's"** (aanbevolen: filmpjes kiezen kan daar niet), in plaats van "Kies foto's of filmpjes".
3. **Kopieën van de kiezer opruimen:** de kopie van een dubbel gekozen item en van een item dat je met × weghaalt meteen weggooien (aanbevolen, vooral voor filmpjes), en eventueel alle kopieën bij het sluiten van het scherm (niet tijdens een ronde).
4. **Indeling:** de albumkeuze boven het raster, "Toevoegen aan album" vast onderin, de knoppen na de ronde bovenaan bij de melding (aanbevolen, A-antwoord 4).
5. **`makePoster` een kleinere maat geven** (61 kB in plaats van 1,3 MB per omslag): een wijziging in de module en een nieuwe build. Aanbevolen: niet doen.

### Testcontract (A, vóór de besluiten)

> Namen en vormen zijn A-keuzes; het hoe is aan B. Wijkt een besluit af, dan past A de tests aan vóór B begint.

- **`app/src/lib/addSelection.ts`** (puur, zonder React of native modules):
  - `addToSelection(current, picked)` geeft `{ items, skipped }`. `items`: de nieuwe keuze (`{ key, kind: "foto" | "filmpje", asset }`), volgens A1–A3, met een unieke `key` per item die blijft zolang het item in de keuze staat. `skipped`: de gekozen assets die er niet bij kwamen (dubbel of `pairedVideo`), voor het opruimen van hun kopie.
  - `removeFromSelection(current, key)`: de keuze zonder dat item, de rest in dezelfde volgorde.
  - `selectionTiles(items)`: per item `{ key, kind, number, durationText, tooLong, label, removeLabel }` volgens A7.
  - `videoStatusText(item)`: de tekst van A13 voor `{ state, progress? }` (de vorm van `VideoItem` en `VideoProgress`).
  - `addGrid(width)`: `{ columns, tile }` volgens A-antwoord 3, met 2 pt tussenruimte.
- **Teksten** (bronscan, letterlijke strings in de bestanden): kop "Toevoegen" in `src/app/_layout.tsx`; de + in `TabBar.tsx` en de albumknop in `AlbumScreen.tsx` heten "Toevoegen"; in `AddPhotosScreen.tsx` en `AddPhotosParts.tsx` geen "Andere foto's kiezen", "Foto's kiezen", "Kies foto's", "Foto's uploaden", "Filmpjes uploaden", "Uploaden", "Meer foto's" of "Meer kiezen" (ook de knop om te kiezen zegt niet alleen foto's), wel "Kies foto's of filmpjes", "Meer toevoegen" en "Toevoegen aan album"; de knop met `onPress` naar `startUpload` (iOS en web) heet "Toevoegen aan album" met `icon="upload"`, en `Icon` kent `upload`.

### Tests per invariant (stand na A)

| Inv. | Test | Niet getest, omdat … |
|---|---|---|
| 1, A1, A14 | `app/tests/addSelection.test.ts` (dubbel, zonder `assetId`, weghalen en opnieuw kiezen geeft dezelfde upload-id via `albumBatch`) | |
| 2, A5 | | UI-stand tijdens en na een ronde: gate en audit |
| 3, A2, A3 | `addSelection.test.ts` (volgorde door elkaar, achteraan, plek bij dubbel, na weghalen, `pairedVideo`) | |
| 4, A10, A11 | | omslagen maken en opruimen is native en scherm-werk: gate en audit |
| 5, A9 | `addSelection.test.ts` (`addGrid`) | haperen en geheugen: gate |
| 6, A7 | `addSelection.test.ts` (`selectionTiles`) | tikvlak van 44 pt en VoiceOver: gate |
| 7 | de bestaande bronscans (zie boven) | |
| A4, A6 | | schermstand: gate en audit |
| A8 | `addSelection.test.ts` (`addGrid` per breedte) | dat het raster zijn eigen breedte meet: gate (iPad) |
| A12 | de bestaande bronscan op `videoTooLongToSend(` | |
| A13 | `addSelection.test.ts` (`videoStatusText`) | |
| besluit 1 | `app/tests/addTexts.test.ts` | |
| besluit 5 | `addSelection.test.ts` (`selectionTiles`, `tooLong`) | de markering op de tegel: gate |

## Besluiten Wouter na A (2026-11-22)

Alle vijf aanbevelingen van A (§Besluiten voor Wouter) zijn akkoord: op het web alleen de teksten, de lege stand daar blijft "Kies foto's", de kopie van de kiezer meteen weg bij dubbel kiezen en bij een ×, albumkeuze boven het raster met "Toevoegen aan album" vast onderin, `makePoster` ongewijzigd. De RED tests van A gelden ongewijzigd.

Ook bevestigd: de backend van WP37 is achterwaarts verenigbaar. 2.0.0/2.0.1 tonen een filmpje als poster (geen afspelen; draaien en profielfoto weigert de backend). Geen test in de simulator nodig.

## Gate ronde 1: iPhone (Wouter, 2026-11-22)

Build `wp39-dev`. Bevindingen:
1. **Albumkiezer oogt rommelig** (lange lijst klapt open in het scherm; de uitgeschakelde knop onderin is bruin).
2. **"Meer toevoegen" moet "Meer selecteren" heten.**
3. **Vast in "Je keuze ophalen…"** bij een filmpje van 5 minuten en bij een drone-filmpje van 5 s (4K H.264, 69 MB, geen geluid). Het filmpje zelf is in orde: de module verkleint het op macOS in 2 s, de backend accepteert een filmpje zonder geluid. Oorzaak is vrijwel zeker de download uit iCloud door de kiezer. Er is geen manier om te stoppen behalve de modaal sluiten, en dan is de hele keuze weg.

### Besluiten Wouter na gate ronde 1 (2026-11-22)

1. **Album kiezen:** op het scherm één rij "Album" met het gekozen album (of "Kies een album") en een pijltje. Een tik opent een eigen kiesscherm: groepen als kopjes, albums met omslag en naam, een vinkje bij het gekozen album. Geopend via de + in de tabbalk staat het laatst gekozen album alvast ingevuld (per toestel onthouden; bestaat het niet meer of is de user geen lid meer, dan "Kies een album"). Zonder album is de knop onderin grijs en heet hij "Kies eerst een album".
2. **"Meer selecteren"** in plaats van "Meer toevoegen", vóór en na een ronde.
3. **"Stoppen" tijdens "Je keuze ophalen…":** de vorige keuze en de uitkomst van een ronde blijven staan; komt het resultaat van de kiezer later toch binnen, dan negeert de app het en ruimt het de kopieën op. Een nieuwe tik op "Meer selecteren" kan pas als de vorige kiezer echt klaar is (iOS staat één kiezer tegelijk toe); tot dan zegt het scherm dat.

## Fixronde gate 1: A-aanvullingen (A vult in)

> A 2026-11-22. Bronnen: de besluiten hierboven, B's code (`751026d`, `7f088e5`), `expo-image-picker` 58.0.10 (`ImagePickerModule.swift`, `MediaHandler.swift`, `VideoUtils.swift`), de bestaande albumqueries en `AlbumChoiceSheet` (WP17c), en het patroon van de thuisgroep (WP32, `src/data/lastGroup.ts`). Geen backend-wijziging nodig.

### Wat de code en de bibliotheken zeggen

- **Waarom het ophalen kan blijven hangen.** `launchImageLibraryAsync` antwoordt pas als elk gekozen item naar de app gekopieerd is, één voor één. Zonder toestemming voor Foto's (die vraagt de app niet) gaat dat via de item-provider van de systeemkiezer. Die downloadt een origineel uit iCloud eerst helemaal, zonder voortgang en zonder manier om te stoppen. De kiezer kan niet op duur filteren: een filmpje van 5 minuten wordt dus ook helemaal gekopieerd voordat de app ziet dat het te lang is. Stoppen kan daarom alleen in de app: het resultaat niet meer afwachten en negeren als het toch komt.
- **Eén kiezer tegelijk is een keuze van de app, niet van iOS.** `expo-image-picker` geeft zijn kiezer vrij zodra de user kiest, nog vóór het kopiëren. Een tweede kiezer zou dus al kunnen openen terwijl de eerste nog kopieert. Besluit 3 laat de app toch wachten: de eerste kopie loopt door en is niet te stoppen, en twee kopieën tegelijk maken het trager en de volgorde onduidelijk. De tekst op het scherm zegt dus niet dat iOS het verbiedt.
- **Eén item dat niet lukt, laat de hele keuze mislukken.** Lukt de kopie van één item niet (bv. de download uit iCloud valt weg), dan weigert de kiezer alles. De kopieën van de items daarvoor blijven achter, met paden die de app niet kent. Het scherm toont dan "Toegang tot je foto's nodig", en dat klopt niet. Zie besluit 6.
- **De albumomslag is er al.** `api.albums.listByGroup` geeft per album `coverPhotoId`. `AlbumCoverTile` (`GroupParts.tsx`, ook op het groepsscherm) toont de omslag via `api.albums.getWithCover`, met de letter van het album als terugval. Er is ook al een kiesscherm: `AlbumChoiceSheet` (WP17c, "naar album kopiëren"), met groepen als kopjes in de volgorde van Mijn groepen (`albumChoices`), maar zonder omslag en zonder vinkje.
- **Waarom de knop bruin is.** `Button` maakt elke uitgeschakelde hoofdknop half doorzichtig op `cta`. Dat geldt in de hele app (Bewaren bij draaien, plaats, account verwijderen). design.md: een hoofdknop staat alleen "uit" met uitleg waarom.
- **"Meer toevoegen" staat op drie plekken:** bij het aantal, in de gedeelde `RoundResult` (dus ook op het web) en in `VideoRoundResult` (filmpjes zonder foto's).
- **Onthouden per toestel** bestaat al voor de thuisgroep: per user in de keychain, met de Clerk-id in de sleutel. Fouten ziet de user niet, de waarde gaat weg bij "account verwijderen", en op het web staat alles alleen in het geheugen (`lastGroup.web.ts`).

### Antwoorden op de punten van regie

1. **Laatst gekozen album.** Bewaard zoals de thuisgroep: per user in de keychain, met album-id en groep-id. Bewaard op het moment dat een ronde start, met het album van die ronde. Wie een album kiest en niets toevoegt, heeft het niet "gebruikt" (A-keuze). Bij het openen controleert de app het met wat er al geladen wordt (Mijn groepen, de albums van die groep). Lidmaatschap gaat voor, zoals bij de thuisgroep: staat de groep niet meer in Mijn groepen, of het album niet meer in die groep, dan "Kies een album". Geen melding, en de onthouden waarde wordt vergeten. De naam komt uit de huidige namen, dus een hernoemd album toont de nieuwe naam. Op het web wordt niets onthouden (besluit 9).
2. **"Stoppen".** De app negeert het lopende verzoek aan de kiezer. Wat er stond, staat er weer: keuze, uitkomst van de ronde, album. Komt het resultaat later toch, dan gaan alle kopieën erin weg (behalve een bestand dat een item in de keuze al gebruikt) en verandert er niets aan het scherm. Komt er later een weigering, dan ook niets: geen melding. Dat geldt ook als het scherm intussen dicht is.
3. **Tweede kiezer.** Pas als het vorige verzoek echt klaar is (resultaat of weigering), ook na "Stoppen". Tot dan zijn "Meer selecteren" en "Kiezen" niet te tikken, en zegt een regel waarom. Dat geldt per scherm: wie sluit en opnieuw opent, kan weer kiezen. Dat is de uitweg als iOS nooit klaar komt.
4. **Omslag in het kiesscherm:** `coverPhotoId` uit `listByGroup` en `AlbumCoverTile`. Geen backend-wijziging.
5. **De grijze knop "Kies eerst een album".** Zie besluiten 7 en 8: of de knop tikbaar is, en of de grijze uit-stand alleen hier of in de hele app geldt.
6. **"Meer selecteren" op het web:** ja, na een ronde, via de gedeelde `RoundResult`. Alleen een tekst, geen gedrag. Vóór een ronde blijft "Andere foto's kiezen" op het web (B-besluit 1 na A).

### A-invarianten (fixronde gate 1)

- **F1. Opslag.** Per user op het toestel, met album-id en groep-id. Een ander account op hetzelfde toestel ziet en overschrijft het niet. Lukt lezen of schrijven niet, dan "niets onthouden", zonder melding. Bij "account verwijderen" gaat de waarde weg, bij uitloggen niet (zoals de thuisgroep). Op het web wordt niets bewaard, en de module laadt daar geen keychain.
- **F2. Moment.** Bewaard bij de start van een ronde, met het album van die ronde. Dat geldt ook als het album vooraf was ingevuld vanuit een album.
- **F3. Voorrang.** Geopend vanuit een album (de + op een albumroute): dat album, zoals nu. Anders het onthouden album. Anders "Kies een album".
- **F4. Geldig of niet.** Zie A-antwoord 1. Zolang de groepen of de albums van die groep laden: nog niets ingevuld en geen flits van "Kies een album". De knop doet dan nog niets. Verdwijnt het album terwijl het scherm openstaat (vóór de ronde), dan wordt de rij "Kies een album".
- **F5. Kiesscherm.** Groepen als kopjes in de volgorde van Mijn groepen, albums in de volgorde van het groepsscherm, met omslag (of letter) en naam, en een vinkje bij het gekozen album. Een groep zonder albums valt weg; zonder groepen de bestaande uitleg. Een album kiezen sluit het kiesscherm en vult de rij. Annuleren laat het album zoals het was. Tijdens en na een ronde is de rij niet te tikken.
- **F6. Knop onderin.** Met een album: "Toevoegen aan album". Zonder album: grijs, "Kies eerst een album". Nog onbekend (F4): uit, met "Toevoegen aan album".
- **F7. Stoppen.** Zie A-antwoord 2. "Stoppen" staat bij "Je keuze ophalen…", meteen, met één regel uitleg dat iOS de keuze ophaalt (bv. uit iCloud) en dat dat bij grote filmpjes even kan duren.
- **F8. Wachten op de vorige kiezer.** Zie A-antwoord 3. De regel: "Je vorige keuze wordt nog opgehaald. Daarna kun je weer selecteren." "Toevoegen aan album" met de keuze die er staat, kan wel.
- **F9. "Meer selecteren"** op alle drie de plekken (bij het aantal, `RoundResult`, `VideoRoundResult`).
- **F10. Bestaande regels blijven.** `pickFetching.test.ts` (de ophaal-state rond de kiezer, met een `finally`) en de andere bronscans van A-invariant 13 hierboven.

### Gate-checks (ronde 2)

- Een filmpje uit iCloud van 5 minuten: "Stoppen" werkt meteen, de oude keuze staat er weer, "Meer selecteren" wacht tot het ophalen klaar is, en daarna kun je weer selecteren.
- Na "Stoppen" de modaal sluiten en opnieuw openen: de kiezer opent.
- Het kiesscherm over de modaal: openen, kiezen, annuleren; omslagen, vinkje, lange lijsten; licht en donker; VoiceOver (kopjes, gekozen album).
- Het laatst gekozen album na een herstart van de app; nadat je uit die groep bent gegaan; met het demo-account op hetzelfde toestel.
- De grijze knop: duidelijk uit, leesbaar in licht en donker.

### A-keuzes

- **Bewaren bij de start van een ronde** (F2), niet al bij het kiezen in het kiesscherm.
- **Eén kiesscherm.** B mag `AlbumChoiceSheet` uitbreiden (vinkje bij een gekozen album, omslagen). Dan verandert "naar album kopiëren" (WP17c) mee, en hoort dat scherm bij de gate.

### Besluiten voor Wouter (nog open)

6. **Melding als het ophalen mislukt.** Nu staat er "Toegang tot je foto's nodig". Aanbevolen: alleen die melding als de kiezer niet opengaat. Mislukt het ophalen (de foutcode van de kiezer laat het verschil zien), dan: "Je keuze ophalen lukte niet. Staat er iets in iCloud, probeer het dan opnieuw met een goede verbinding." De keuze die er stond, blijft staan.
7. **"Kies eerst een album" tikbaar?** Aanbevolen: ja, een tik opent het kiesscherm (grijs, maar niet uit). Anders staat er een knop die zegt wat je moet doen, maar die je niet kunt gebruiken.
8. **De grijze uit-stand** voor elke hoofdknop in de app (aanbevolen, één regel volgens design.md) of alleen voor deze knop.
9. **Web:** geen kiesscherm en geen onthouden album (aanbevolen, de gate is een iPhone). Wel "Kies eerst een album" op de knop zonder album, en "Meer selecteren" na een ronde.

### Testcontract (fixronde gate 1)

> Volgt de aanbevelingen; wijkt een besluit af, dan past A de tests aan vóór B begint.

- **`app/src/lib/pickSession.ts`** (puur): `PICK_IDLE`; `beginPick(state)` geeft `{ state, token }`, of `null` zolang een vorig verzoek loopt; `stopPick(state)`; `endPick(state, token)` geeft `{ state, accept }` (`accept`: het resultaat telt); `pickView(state)` geeft `{ fetching, waiting, canPick }` ("Je keuze ophalen…" met "Stoppen", de wachtregel van F8, een kiezer mag openen).
- **`app/src/lib/lastAlbum.ts`** (puur): `lastAlbumChoice({ stored, myGroups, albumsOf })` geeft `{ kind: "album", album: { albumId, groupId, label } }`, `{ kind: "none", forget }` of `{ kind: "unknown" }`. `stored` is `undefined` (nog niet gelezen), `null` of `{ albumId, groupId }`; `albumsOf(groupId)` geeft de albums van die groep, of `undefined` zolang ze laden.
- **`addButton(album)`** in `app/src/lib/addSelection.ts`, met `album` `"chosen" | "none" | "unknown"`: `{ title, action }`, met `action` `"toevoegen"`, `"kies-album"` (besluit 7) of `null` (uit).
- **`app/src/data/lastAlbum.ts`** (iOS, keychain) en een web-variant zonder keychain: `loadLastAlbum(userId)`, `saveLastAlbum(userId, { albumId, groupId })`, `forgetLastAlbum(userId, albumId)`, `clearLastAlbum(userId)`. `signOutAndWipe` roept `clearLastAlbum(deletedUserId)` aan, net als `clearLastGroup`.
- **Teksten** (bronscan): "Meer selecteren" in plaats van "Meer toevoegen" (iOS en `AddPhotosParts`); "Stoppen", "Kies een album" en "Kies eerst een album" op iOS; "Kies eerst een album" ook op het web. De knop met `onPress` naar `startUpload` houdt `icon="upload"`; zijn titel mag een expressie zijn.

### Tests (fixronde gate 1)

| Inv. | Test | Niet getest, omdat … |
|---|---|---|
| F1 | `app/tests/lastAlbumStore.test.ts` (per user, eigen sleutel naast de thuisgroep, kapotte waarde, keychain-fout, vergeten, account verwijderen) | |
| F2, F3, F5 | | schermgedrag: gate en audit |
| F4 | `app/tests/lastAlbum.test.ts` (`lastAlbumChoice`) | |
| F6 | `app/tests/addSelection.test.ts` (`addButton`), `addTexts.test.ts` | het grijs: gate |
| F7, F8 | `app/tests/pickSession.test.ts`, `addTexts.test.ts` ("Stoppen") | de kopieën van een genegeerd resultaat weggooien, ook na sluiten: audit |
| F9 | `addTexts.test.ts` | |
| F10 | de bestaande bronscans | |
