# WP17d: de kaart, locatie wijzigen en delen

> Draft (regie, 2026-11-12). App-WP met een backend-deel. Uit WP17c (besluit 2026-11-12). Vóór T0.

## Productdoel

Een lid ziet op een kaart waar de foto's van een album zijn gemaakt. Als eigenaar past hij de locatie van zijn foto aan of haalt hij die weg. Hij kan een foto delen met iemand buiten de app, en weet daarbij dat het beeld de app verlaat. Een plek waar een foto is gemaakt, ziet alleen wie die foto mag zien.

## Besluiten Wouter

1. **Groepsleden zien de exacte plek, met straat en huisnummer** (2026-11-12). Dat geldt voor iedereen die de foto mag zien, zoals in v1. Er komt geen afronding en de plaatsnaam wordt niet ingekort (A-keuze 1 en 2 vervallen).
2. **Een openbare profielfoto draagt geen locatie** (2026-11-12). Het openbare profielpad geeft nooit een bestand met GPS en nooit coördinaten of een plaatsnaam.
3. **A-keuze 3 tot en met 6 volgens het advies van A** (2026-11-12):
   - locatie wijzigen met een speld, plus "Locatie weghalen", zonder zoeken;
   - een melding vóór het delen, alleen bij de foto van een ander;
   - delen in het grote formaat, per foto;
   - de kaart alleen per album.
4. **Fix-cyclus 1 na audit en red-team** (2026-11-13):
   - **Het origineel gaat altijd zonder GPS naar buiten**, voor elk lid en ook voor de eigenaar. Na "Locatie weghalen" of wijzigen mag geen geserveerd bestand de oude plek nog dragen. De app vraagt het origineel zelf niet op.
   - **De schoonmaker is fail-closed**: een bestand dat hij niet begrijpt (afwijkende structuur, of een niet-JPEG zonder formaten) gaat niet ongewijzigd mee. Ook data ná het eerste beeld (een tweede beeld, MPF-preview, motion-photo-trailer) gaat niet mee.
   - **Een late plaatsnaam van de upload** wordt alleen bewaard als de foto die plek nog heeft.
   - **"Opslaan" pas na een tik of sleep** als er geen opgeslagen plek is (ook direct na weghalen).
   - **Delen toont dat het bezig is** en negeert een tweede tik.
   - A telt de 7 losse profielbeelden op prod: data na het eerste beeld of een MPF-blok?
5. **Fix-cyclus 2 na de gate** (2026-11-13):
   - **Het foto-menu verschijnt weer bij andermans foto**, in het album en in het foto-detail. Sinds WP17c gaf `menuActions` zonder plek een lege lijst voor een foto van een ander. Een gewoon lid zag daardoor geen "Delen" en geen "Als profielfoto" (WP27). Elke aanroep moet de plek expliciet meegeven.
   - A pint dit als A-invariant 13 (`app/tests/photoMenuPlace.test.ts`). Alleen PhotoDetailScreen en AlbumScreen hadden de fout; Mijn foto's gaf `null` al expliciet mee.
   - **Knorren:** de telling kan zonder AWS-toegang niet. Na de cutover kijken we of de 9 users met een knor die nog zien. Een geweigerde knor wordt een letter, er lekt niets.

## Invarianten (draft)

1. **De kaart volgt de foto-toegang.** De kaart van een album toont alleen foto's met een locatie, en alleen aan wie het album mag zien. Coördinaten verlaten de backend alleen voor foto's waar de caller toegang toe heeft. Er komt een nieuwe read met een whitelist, en de standing rule [Toegangsdefinities](../conventions/work-package-specs.md#toegangsdefinities-verplicht-bij-wps-die-er-een-invoeren) geldt. Nu toont de foto-vorm alleen de plaatsnaam, geen coördinaten.
2. **Precisie: open vraag 1.** Welke precisie andere leden zien, beslist Wouter. De eigenaar ziet altijd de exacte plek van zijn eigen foto.
3. **Locatie wijzigen: alleen de eigenaar.**
   - Een nieuwe plek krijgt ook een nieuwe plaatsnaam (Photon, zoals bij de upload).
   - Weghalen wist de coördinaten én de plaatsnaam.
   - Een foto van een ander, een onbekende en een gewiste foto geven dezelfde weigering, en er verandert niets.
4. **Delen maakt geen openbare link.** Delen geeft het bestand aan het iOS-deelmenu, geen URL. Er ontstaat geen pad waarmee iemand zonder login een beeld krijgt.
5. **Delen alleen met toegang.** Je deelt alleen een foto die je mag zien. Het beeld gaat in het formaat van open vraag 4 en zonder GPS in het bestand.
6. **Geen locatie van het toestel.** De kaart vraagt geen toestemming voor de locatie van de telefoon.
7. **Kosten nul.** Apple Maps (geen sleutel) en Photon (gratis, EU). Geen nieuwe betaalde dienst.

## Scope

- **In scope:**
  - de kaart per album;
  - locatie wijzigen en weghalen in het menu van een eigen foto;
  - delen in het foto-menu;
  - in de backend een read voor de kaart en een mutation voor de locatie;
  - de nieuwe bibliotheken in de app en een nieuwe EAS-build.
- **Bewust niet:**
  - een kaart over alle albums of over Mijn foto's (open vraag 5);
  - delen via een link;
  - locatie bij een video (WP21).

## Risico-assessment

- **security/privacy: hoog.** Exacte coördinaten kunnen iemands huis aanwijzen. Een gedeeld beeld valt buiten elke toegangscontrole. Er komt een nieuwe read die coördinaten geeft.
- **ops: laag.** Photon kan traag zijn of weigeren; dat moet zichtbaar falen, niet stil.
- **external deps: medium.** Er komt een kaartbibliotheek en een deel-bibliotheek in de native build, en Photon voor zoeken en plaatsnamen (met limieten).
- **multi-user/concurrency: laag.** De eigenaar wijzigt de locatie terwijl een ander de kaart open heeft.
- **data/schema-evolutie: laag.** De coördinaten bestaan al (WP12, WP18). Afronden, als dat de keuze wordt, gebeurt bij het lezen en niet in de data.
- **ops-runbook-impact:** geen sleutels. Wel een nieuwe build voor TestFlight.

## Open vragen voor A / Wouter

1. **Precisie voor andere leden.** De exacte plek (zoals v1) of afgerond, bijvoorbeeld op ongeveer 1 km?
2. **Locatie wijzigen: hoe?** Een speld op de kaart verplaatsen, zoeken op een plaatsnaam, of beide? Wat deed v1?
3. **Een melding vóór het delen?** Bijvoorbeeld: "Deze foto verlaat de app." Ja of nee?
4. **Wat deel je?** Het formaat *groot* (1600) of het origineel, één foto of ook een selectie, en alleen je eigen foto's of elke foto die je ziet?
5. **Kaart alleen per album,** of ook per groep of in Mijn foto's? Wat deed v1?

## Cross-refs

- [WP17c](./WP17c-mijn-fotos.md): de splitsing, Mijn foto's, het foto-menu.
- [WP18](./WP18-foto-upload.md): locatie bewaren als aparte headers (vraag 2), Photon, geen EXIF in het bestand.
- [WP17a](./WP17a-fotos-bekijken.md): het beeldpad en de formaten.
- [WP23](./WP23-read-whitelist.md): de veld-whitelist op reads.
- WP1: Photon (EU) voor plaatsnamen.
- Oude code (alleen A): de albumkaart, "locatie wijzigen" en delen in `clubalmanac-app`.

## Sessies

| Stap | Wie | Wat |
|---|---|---|
| 1 | regie | deze draft |
| 2 | A (`wp-a`) | spec-aanvulling (vraag 1–5 met v1 als bron, pariteit per scherm, telling op de prod-export) en RED tests |
| 3 | B (`wp-b`) | implementatie, nieuwe bibliotheken, release-build in de simulator |
| 4 | audit | toetst B aan de spec en de tests |
| 5 | red-team | zoekt coördinaten of beelden zonder toegang: via de kaart-read, na vertrek, met een oude link of een gedeeld bestand, en via de locatie-mutation. Krijgt alleen het productdoel en de diff. Het rapport gaat letterlijk naar Wouter. |
| 6 | regie + Wouter | gate in de simulator tegen dev |

## Acceptance

- Tests: A bepaalt welke.
- Gate op dev (simulator, release-build):
  - de kaart van een album met foto's met en zonder locatie;
  - het tweede lid ziet de precisie van besluit 1, en ziet geen kaart van een album uit een andere groep;
  - locatie wijzigen en weghalen; de plaatsnaam volgt;
  - een foto delen via het deelmenu, zonder GPS in het bestand.

---

## Spec-criticus aanvullingen (A, 2026-11-12)

Bronnen: de oude app (`screens/AlbumMap.jsx`, `PhotoMap.jsx`, `components/PhotoMenu.jsx`, `AlbumPhotosHeader.jsx`, `datastores/sharing.js`, `datastores/images.js`), de oude backend (`blob-images-api-photos/handlersPhoto/updatePhoto.js`), de huidige `convex/` en `app/`, en de prod-export (`scripts/wp17d/kaart-tel.mjs`).

### Kernvondsten

1. **De plaatsnaam is vaak een adres.** De foto-vorm toont `locationLabel` aan elk lid. Bij gemigreerde foto's is dat het adres van Apple, met straat en vaak een huisnummer ("8 Dorpsstraat - Plaats - Land"). Bij een nieuwe upload maakt Photon er "straat, plaats, land" van. Besluit 1: zo laten, zoals v1.
2. **Het origineel draagt de GPS.** v1 zette de bytes ongewijzigd in S3, met EXIF (WP18). Het beeldpad gaf *zonder* `formaat` het origineel aan elk lid met toegang, en ook na "Locatie weghalen" stond de plek nog in dat bestand (red-team H1). Besluit 4: het origineel gaat nooit meer met GPS naar buiten (A-invariant 9).
3. **Het openbare profielpad geeft zonder formaat ook het origineel**, zonder login. Een profielfoto kan andermans foto zijn (WP27). Een plek gaat dan naar iedereen met een user-id. Op prod zijn er 17 profielbeelden: 10 zijn een foto, 7 zijn een los beeld zonder foto-rij en dus zonder formaten. Die 7 zijn de standaard-knorren van v1 (`public/img/knorren/knor<n>.jpg`, bij het aanmaken van een account willekeurig toegewezen), bij 9 users. Besluit 2: dicht (A-invariant 8).
4. **`photos.update` zet een plek zonder plaatsnaam, en een plaatsnaam naar keuze.** De eigenaar kan zo de coördinaten wijzigen zonder Photon, en elke tekst als plaatsnaam neerzetten. Weghalen kan er niet mee. De app gebruikt hem niet. Na 17d zet alleen `photos.setLocation` een plek of plaatsnaam (A-invariant 4).
5. **Een formaat staat niet rechtop.** *groot* bevat de ruwe pixels; de app draait ze met `exifOrientation` (WP25). Deel je de bytes zoals ze zijn, dan krijgt de ontvanger een scheve foto. Op dev hebben 589 van de 1001 foto's een stand-tag (niet elke tag draait).
6. **v1 had geen weghalen en geen zoeken.** Locatie wijzigen was een speld op de kaart slepen. Het startpunt zonder plek lag bij Hilversum. De plaatsnaam kwam van Apple op het toestel.
7. **In v1 stond "Locatie" ook in het menu van een admin**, maar de backend schreef alleen bij de eigenaar. Alleen de eigenaar (draft invariant 3) is dus pariteit.
8. **v1 deelde elke foto die je zag**, op 800 px, zonder melding vooraf, via `expo-sharing`. De image handler van v1 gaf geen EXIF door.
9. **`reverseGeocode` logt bij een fout de exacte coördinaten** in de Convex-logs. Alleen de beheerder ziet die. Backlog-kandidaat, geen blokker.

### Telling op prod (export 2026-11-06)

- **559 van 1543 foto's** hebben een plek, van 11 eigenaren. 476 daarvan hebben ook een plaatsnaam. Geen enkele staat op (0,0).
- **15 van 17 albums** hebben minstens één foto met plek. Geen album heeft alleen foto's met plek. Het grootste album heeft 327 plekken (van 540). Per album, met plek/totaal: 327/540, 53/59, 43/96, 33/60, 22/108, 18/19, 10/25, 10/11, 8/18, 8/15, 7/119, 7/72, 5/84, 3/44, 2/35, 0/186, 0/33.
- **Losse profielbeelden** (besluit 4): 9 users hebben een knor als profielfoto, 7 verschillende. Of die bestanden data na het eerste beeld, een MPF-blok of een afwijkende structuur hebben, staat alleen in de S3-bucket. Telling: `node scripts/wp17d/profiel-tel.mjs scripts/.data/dynamo-extract.json` (alleen lezen, AWS-credentials nodig; Wouter draait hem). Uitkomst: nog niet geteld. Heeft een knor in gebruik een afwijkende structuur, dan valt hij bij fail-closed weg (de letter); dat moet Wouter dan weten vóór de merge.
- **Mogelijk bij een woonadres** (schatting):
  - 89 foto's van 7 eigenaren hebben een plaatsnaam die met een huisnummer begint;
  - 35 foto's liggen op een plek (vak van ca. 100 m) waar dezelfde eigenaar op 3 of meer dagen fotografeerde: 2 plekken van 2 eigenaren;
  - samen 90 foto's, in 11 albums. Bijna alle "vaste plekken" hebben ook een huisnummer (34 van 35).

### Open vragen: v1 en besluit

1. **Precisie.** v1: de exacte plek voor elk lid, plus het volle adres. Besluit 1: zo.
2. **Locatie wijzigen.** v1: een speld slepen, geen zoeken, geen weghalen. Besluit 3: een speld slepen, plus "Locatie weghalen", geen zoeken. Startpunt: de huidige plek, anders midden-Nederland. De plaatsnaam maakt de backend (A-invariant 3).
3. **Melding vóór delen.** v1: geen. Besluit 3: alleen bij een foto van een ander, één regel: "Deze foto van <naam> verlaat de app." Bij je eigen foto geen melding.
4. **Wat deel je.** v1: één foto, 800 px, elke foto die je ziet. Besluit 3: één foto, *groot*, rechtop en zonder EXIF, elke foto die je ziet. Een foto zonder formaten nog niet: dan zou het origineel met GPS de app verlaten (draft invariant 5).
5. **Kaart.** v1: alleen per album. Besluit 3: zo.

### Pariteit per scherm

**Albumkaart**

| Oude app | Nieuw (17d) |
|---|---|
| Knop met kaart-icoon in de albumkop | Zo |
| Titel "N foto's uit 'Album'" | Zo |
| Apple Maps, de foto's als miniatuur-speld | Zo (react-native-maps, Apple Maps) |
| Dicht bij elkaar: één speld met een aantal | Zo |
| Kaart past zich aan de foto's aan | Zo |
| Tik op een speld: detail, swipen door die foto's | Zo |
| Tik op een speld: adres van Apple onderaan | Niet: de plaatsnaam staat al in het detail |
| Knop "N zonder locatie" opent die foto's | Zo, alleen als er zulke foto's zijn |
| Exacte plek voor elk lid | Zo (besluit 1) |
| Geen eigen locatie van het toestel | Zo (invariant 6) |

**Locatie wijzigen**

| Oude app | Nieuw (17d) |
|---|---|
| Menu "Locatie" bij eigenaar en admin | "Locatie wijzigen", alleen de eigenaar |
| Kaart met de foto als speld, slepen | Zo |
| Zonder plek: start bij Hilversum | Start in midden-Nederland |
| Adres van Apple op het toestel | Plaatsnaam van Photon, in de backend |
| Knop "naar de foto" en "opslaan" | Zo |
| Gelukt: "Locatie is bijgewerkt" | Zo |
| Mislukt: "Opslaan helaas niet gelukt…" | Zo |
| Geen weghalen | "Locatie weghalen", met bevestiging |

**Delen**

| Oude app | Nieuw (17d) |
|---|---|
| "Delen" in het foto-menu, elke foto | Zo, alleen met formaten (besluit 3) |
| 800 px via de image handler | *groot*, rechtop, zonder EXIF |
| Geen melding | Melding bij andermans foto (besluit 3) |
| Bezig: "Delen..." grijs | Zo |
| Fout: "Helaas niet gelukt…" | Zo |
| Eén foto | Zo; niet in de selectie |

### Besluiten verwerkt (A, 2026-11-12)

- A-keuze 1 en 2 vervallen (besluit 1): geen afronding, de plaatsnaam blijft heel, en een lid met toegang krijgt het origineel. De tests ervoor zijn weg; `listLocations` pint nu exact voor iedereen.
- A-keuze 3 en 4 zijn besluit 3. De tests heten nu "besluit 3".
- Besluit 2 is A-invariant 8.
- Besluit 4 (fix-cyclus 1, 2026-11-13) is A-invariant 3 (aangescherpt), 9, 10, 11 en 12, plus §Fix-cyclus 1: rest-risico en gate.

### Aanvullende invarianten

1. **De kaart-read** (`albums.listLocations`):
   - poort zoals `albums.listPhotos`: geen lid, onbekend of gewist album geeft dezelfde `NOT_MEMBER`;
   - alleen foto's die in dít album staan en beide coördinaten hebben, elke foto één keer;
   - per foto precies `photoId`, `latitude` en `longitude`;
   - een gewiste foto (publicatie zonder foto-rij) telt niet;
   - na vertrek uit de groep: `NOT_MEMBER`;
   - na weghalen verdwijnt de foto van de kaart.
2. **De plek van een eigen foto** (`photos.getLocation`): alleen de eigenaar krijgt de exacte plek, of `null` zonder plek. Een foto van een ander (ook met toegang), een onbekende en een gewiste foto: dezelfde `NOT_PHOTO_OWNER`. Nodig voor "Locatie wijzigen" vanuit Mijn foto's, waar geen album is.
3. **Locatie wijzigen** (`photos.setLocation`):
   - alleen de eigenaar; anders, ook bij onbekend of gewist, dezelfde `NOT_PHOTO_OWNER`, en er verandert niets en er wordt niets ingepland;
   - de eigenaar-check komt vóór de controle op de waarden;
   - breedte -90..90, lengte -180..180, eindig; anders `LOCATION_INVALID` en er verandert niets;
   - een nieuwe plek wist meteen de oude plaatsnaam; de backend vraagt daarna een nieuwe aan Photon met de nieuwe coördinaten;
   - Photon faalt: de plek blijft staan, zonder plaatsnaam, zonder fout;
   - weghalen (`location: null`) wist breedte, lengte en plaatsnaam;
   - een late plaatsnaam hoort bij een plek die niet meer geldt (gewijzigd of weggehaald): hij wordt niet bewaard. Dat geldt ook voor de plaatsnaam van de upload (`extractMetadata`): hij wordt alleen bewaard als de foto die plek nog heeft (besluit 4, audit S1).
4. **Eén pad voor de plek.** `photos.update` neemt geen `latitude`, `longitude` of `locationLabel` meer aan. Upload (WP18) en `extractMetadata` blijven intern.
5. **Geen coördinaten in de foto-vorm** (blijft, WP23). Alleen de twee nieuwe reads geven ze.
6. **Delen in het menu:** voor elke foto met formaten. "Locatie wijzigen": alleen bij een eigen foto.
7. **Geen locatie van het toestel:** de app heeft geen `expo-location`, geen `NSLocation…`-tekst en geen `showsUserLocation`.
8. **De openbare profielfoto draagt geen locatie** (besluit 2). Het profielpad, met en zonder formaat, voor iedereen:
   - geeft 200 en een beeld; de profielfoto blijft zichtbaar, ook als los beeld zonder formaten;
   - het bestand bevat geen GPS in de EXIF; een JPEG blijft een JPEG;
   - geen kop met coördinaten of een plaatsnaam.
   Zonder formaat geeft het pad *groot*; bij de terugval gaat de JPEG door de schoonmaker (A-invariant 10).
9. **Het origineel gaat altijd zonder GPS naar buiten** (besluit 4). Het foto-pad, met en zonder formaat, voor de eigenaar en elk lid, ook na "Locatie weghalen" en na wijzigen: 200 en geen GPS in het bestand. Zonder formaat mag het pad *groot* geven of het origineel zonder metadata (B kiest). Het origineel zonder formaten blijft een JPEG met dezelfde beelddata.
10. **De schoonmaker is fail-closed** (besluit 4). Voor een origineel op het foto-pad en het profielpad:
    - na de EOI van het eerste beeld gaat niets mee: geen tweede beeld, geen MPF-beeld, geen trailer. Het eerste beeld blijft zichtbaar (200);
    - een JPEG met een afwijkende structuur (opvulbyte na SOI, rommel tussen segmenten, een lengte buiten het bestand, geen EOI) gaat niet ongewijzigd mee, en zonder GPS; een 404 mag;
    - een niet-JPEG zonder formaten (PNG, WebP, HEIC, onbekend) gaat niet ongewijzigd mee; nooit als HTML of SVG;
    - een gewone JPEG, ook progressief, blijft zichtbaar: 200, een JPEG, de beelddata heel. Een JPEG zonder metadata gaat ongewijzigd mee;
    - een formaat (door ons gemaakt, zonder EXIF, WP25 invariant 18) gaat ongewijzigd mee.
11. **"Opslaan" pas na een tik of sleep** als er geen opgeslagen plek is, ook direct na "Locatie weghalen" (besluit 4, audit S3). Met een plek alleen als de speld ergens anders staat. Verandert de opgeslagen plek, dan begint de speld opnieuw en staat Opslaan uit.
12. **Delen toont dat het bezig is en negeert een tweede tik** (besluit 4, audit N1). Bezig vanaf de tik op "Delen" (bij andermans foto: "Delen" in de melding) tot het delen klaar is, gelukt of niet. Zolang het loopt, start een nieuwe tik op "Delen" niets, ook niet bij een andere foto. Elk scherm met het foto-menu toont het.
13. **Het foto-menu volgt de plek** (besluit 5). In een album en in het foto-detail heeft andermans foto een menu: "Als profielfoto" (WP27), en met formaten ook "Delen". Een eigen foto en Mijn foto's houden hun menu. `menuActions` heeft geen standaard-plek meer: wie de plek vergeet, krijgt een typefout en geen stille lege lijst. De schermen roepen `menuActions` niet zelf aan; ze vragen `hasActions(photo)` aan `usePhotoMenu`, met dezelfde plek als `open`.

### Toegangsdefinities (standing rule)

- **`albums.listLocations({ albumId })`** neemt een album-id aan. Poort: lidmaatschap van de groep (zoals `listPhotos`). Toestemmingslijst: de foto's van dat album. Geeft foto-ids die de caller al ziet via `listPhotos`, exact, met coördinaten (besluit 1).
- **`photos.getLocation({ photoId })`** neemt een foto-id aan. Poort: eigenaar. Geeft alleen de eigen exacte plek.
- **Schrijven:** `photos.setLocation({ photoId, location: { latitude, longitude } | null })`, alleen de eigenaar.
- **Inventaris:** beide reads staan in `tests/readWhitelist/inventory.test.ts`, met een return-validator.

### Edge cases

- **De eigenaar wijzigt de plek terwijl een ander de kaart open heeft:** de kaart volgt live (Convex), de oude plek verdwijnt.
- **Twee keer snel wijzigen:** de plaatsnaam hoort bij de laatste plek (A-invariant 3).
- **Een profielfoto zonder formaten** (los beeld, of een foto vlak na de upload) gaat via de terugval en de schoonmaker; ook dan geen GPS (A-invariant 8 en 10).
- **Een album met 327 plekken:** één read, ruim binnen de limieten. De kaart zelf: zie §Fix-cyclus 1, gate.

### Bibliotheken (Expo SDK 58, EAS-build, geen kosten, geen sleutels)

| Wat | Pakket en versie | Opmerking |
|---|---|---|
| Kaart | `react-native-maps` 1.29.11 | De versie die SDK 58 vastlegt (`bundledNativeModules.json`). Apple Maps zonder sleutel; geen config-plugin nodig voor alleen iOS. Speld als eigen view (miniatuur). Werkt niet in Expo Go, wel in een EAS-build. |
| (alternatief) | `expo-maps` ~58.0.10 | Ook Apple Maps zonder sleutel, maar iOS 17+ en minder vrijheid voor een speld met foto. Niet gekozen. |
| Delen | `expo-sharing` ~58.0.20 | Het iOS-deelmenu met een lokaal bestand, zoals v1. Geen URL. |
| Bestand ophalen | `expo-file-system` ~58.0.11 | Zit al in `expo`; expliciet toevoegen. Download van het beeldpad met de token in de header, naar de cache. |
| Rechtop en zonder EXIF | `expo-image-manipulator` 58.0.15 | Er al (WP18). |

Geen `expo-location`. Na het toevoegen een nieuwe EAS-build (native code).

### Tests

| Bestand | Pint |
|---|---|
| `tests/location/listLocations.test.ts` | A-invariant 1 en 5; besluit 1 (exact) |
| `tests/location/getLocation.test.ts` | A-invariant 2 |
| `tests/location/setLocation.test.ts` | A-invariant 3 en 4 |
| `tests/location/originalImage.test.ts` | A-invariant 8 (besluit 2) |
| `tests/location/cleanOriginal.test.ts` | A-invariant 9 en 10 (besluit 4) |
| `tests/location/lateLabel.test.ts` | A-invariant 3: de late plaatsnaam van de upload (besluit 4) |
| `tests/readWhitelist/inventory.test.ts` | de twee nieuwe reads |
| `app/tests/placeShare.test.ts` | A-invariant 6 en 7; besluit 3; de kaartregio |
| `app/tests/locationDraft.test.ts` | A-invariant 11 |
| `app/tests/shareBusy.test.ts` | A-invariant 12 |
| `app/tests/photoMenuPlace.test.ts` | A-invariant 13 (besluit 5) |

Testbestanden en de GPS-controle: `tests/_helpers/jpeg.ts` en `tests/fixtures/wp17d/` (`gps.jpg`, `gps-progressief.jpg`, `schoon.jpg`, `schoon-b.jpg`). De controle zoekt in het hele bestand naar een TIFF-kop met GPS-wijzer en naar XMP-GPS, niet alleen tot de beelddata (audit S2: dezelfde blinde vlek als de schoonmaker).

Aangepast:
- `tests/photos/crud.test.ts` en `tests/photos/update.test.ts` gebruikten `photos.update` voor de plaatsnaam en gebruiken nu `takenAt` (A-invariant 4).
- Besluit 4: tekst als origineel gaat niet meer over een beeldpad. `tests/images/httpRoute.test.ts`, `tests/photoFormats/httpFormats.test.ts`, `tests/photoFormats/profileOrientation.test.ts` en `tests/users/profileAccess.test.ts` gebruiken nu echte JPEG's zonder metadata (`seedPhoto` kreeg `originalBytes`). In httpRoute pinnen de niet-JPEG-gevallen nu "niet ongewijzigd, nooit HTML of SVG" in plaats van "dezelfde bytes". In httpFormats geeft het foto-pad zonder formaat *groot* of het schone origineel.

Aangenomen API (B kiest de interne vorm, niet de namen):
- `albums.listLocations({ albumId })` geeft `{ photoId, latitude, longitude }[]`.
- `photos.getLocation({ photoId })` geeft `{ latitude, longitude } | null`.
- `photos.setLocation({ photoId, location })`; de plaatsnaam via de scheduler.
- Refusal-code `LOCATION_INVALID` erbij in `RefusalCode`.
- In de app een nieuwe module `app/src/lib/placeShare.ts` met `placeShareActions`, `shareNotice`, `shareEdits` en `mapRegion`.
- Fix-cyclus 1: `useLocationDraft(saved)` in `app/src/lib/locationDraft.ts` geeft `{ pin, move, canSave }`; `LocationScreen` gebruikt hem en zet Opslaan uit met `canSave`. `usePhotoMenu(...)` geeft naast `open` ook `sharing: boolean`.
- Fix-cyclus 2: `usePhotoMenu(...)` geeft ook `hasActions(photo): boolean`; `menuActions(ctx, photo, place)` zonder standaardwaarde.

### Fix-cyclus 1: rest-risico en gate (A, 2026-11-13)

- **Een niet-JPEG zonder formaten wordt niet getoond.** De schoonmaker begrijpt alleen JPEG; een PNG, WebP of HEIC zonder formaten gaat niet ongewijzigd mee, dus in de praktijk een 404 (de app toont dan niets of de letter). Wanneer: een upload die geen JPEG is, in de seconden vóór de formaten er zijn, of een origineel waarvoor de formaten blijven mislukken. Op prod: 43 PNG's in de bucket, 0 HEIC (WP25-telling); die hebben formaten na de backfill. Alternatief later: zo'n bestand in een Node-action opnieuw coderen. Niet in 17d.
- **N2: Apple en `NSLocation…`.** `react-native-maps` linkt CoreLocation. Bij de EAS/TestFlight-upload kan Apple een ontbrekende `NSLocationWhenInUseUsageDescription` melden (ITMS-90683) en de upload blokkeren. Controleren bij de eerste upload. Eist Apple de sleutel, dan gaat hij erin; `app/tests/placeShare.test.ts` (A-invariant 7) verbiedt nu elke `NSLocation`-tekst en moet dan "geen toestemming vragen" pinnen (geen `expo-location`, geen `showsUserLocation`) in plaats van "geen sleutel". Een purpose string vraagt zelf niets. Dat is een besluit van Wouter.
- **N3: de kaart van het grootste album in de gate.** Het album met 327 plekken (van 540): openen, scrollen en in- en uitzoomen tot elke speld los staat. Kijken of de kaart vloeiend blijft (elke speld heeft een miniatuur en `tracksViewChanges`).
- **De stand van een los profielbeeld:** de schoonmaker zet de stand-tag terug (B). In de gate: een los profielbeeld met een stand-tag staat rechtop.

## Gate (dev, simulator, 2026-11-13)

Groen na fix-cyclus 2.

- **Kaart:** "In Georgië" (54 plekken) toont groepjes met aantallen; inzoomen splitst ze en loopt vloeiend. Een album zonder plekken toont "Geen locaties" met het aantal foto's zonder locatie. Het tweede lid (dev3) ziet de kaart van "Gatetest nu" met 14 plekken en 3 zonder.
- **Locatie wijzigen:** tik op de kaart, Opslaan aan, nieuwe plek en plaatsnaam van Photon. Weghalen: melding vooraf, speld naar midden-Nederland, Opslaan uit; dev3 ziet de foto niet meer op de kaart. Testfoto daarna exact teruggezet.
- **Delen:** eigen foto zonder melding, "Foto klaarmaken om te delen…" in beeld, deelmenu met een JPEG. Andermans foto (als dev3): "Deze foto van Dev Wouter verlaat de app.", daarna het deelmenu.
- **Openbaar profielpad:** zonder formaat, *groot* en *klein*: 200, JPEG, geen EXIF.
- **Gate-vondst → fix-cyclus 2:** een gewoon lid kreeg bij andermans foto geen menu (regressie uit WP17c, zie besluit 5).
- **Niet gedekt:** het album met 327 plekken staat niet op dev (grootste: 54). De knorren op prod (besluit 5). N2 (`NSLocation` bij de eerste TestFlight-upload).

### Backlog

- Locatie wijzigen: verandert de plek elders terwijl het scherm open is, dan staat Opslaan aan en blijft "Locatie is weggehaald" staan.
- "Geen locaties" staat in een rode foutbox; het is geen fout.
- Spelden half buiten beeld bij een album over meerdere werelddelen.
- Schoonmaker: alleen bekende segmenten houden (nu gaan gereserveerde markers mee); GPS bij een upload buiten de app; `setLocation` zonder rem (Photon fair use, coördinaten in de log).
- Bezig-staat bij delen geldt per scherm.
