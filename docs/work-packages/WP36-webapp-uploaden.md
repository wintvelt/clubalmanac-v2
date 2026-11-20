# WP36: webapp, foto's uploaden

> Regie 2026-11-20. Tweede WP van Fase 4 Track B, bovenop [WP35](./WP35-webapp-bekijken.md). App-WP met een stuk backend. A → besluiten Wouter → B → audit → red-team op het uploadpad vanuit de browser → gate in een browser (dev). WP35 en WP36 gaan samen naar prod (WP35 runbook stap 8–12 wachten hierop). Eigen branch `wp36`.

## Productdoel

Een lid met een Android-telefoon zet in de browser foto's uit zijn galerij in een album van zijn groep. Ze staan rechtop, met hun datum en plaats, en de andere leden zien ze, net als bij een upload vanuit de iPhone-app. Mislukt er iets, bijvoorbeeld op mobiel internet, dan ziet hij welke foto's, en kan hij die opnieuw proberen zonder dat er een foto dubbel komt. Daarnaast kan hij op Profiel een eigen profielfoto uploaden of weghalen. Op een computer werkt het ook.

## Besluiten (Wouter, 2026-11-20)

1. **Alleen uploaden erbij.** Foto's in een album en een eigen profielfoto. Groepsbeheer, het foto-menu, melden en de andere acties blijven op het web weg.
2. **Telefoon eerst:** Chrome op Android is de belangrijkste omgeving, een laptop de tweede.
3. **Twee ingangen, zoals in de app:** een knop "Foto's toevoegen" in het album, en de "+" in de tabbalk (foto's kiezen, dan een album kiezen).
4. **Profielfoto uploaden en weghalen** op Profiel, zoals in de app (WP18 besluit 1: een gewone eigen foto zonder album).
5. **Geen Android-toestel bij Wouter.** Testen in Chrome met de apparaat-emulatie; zie open vraag 7 voor wat die niet dekt.

## Wat er is

- De upload bestaat: `POST /upload` in [`convex/http.ts`](../../convex/http.ts), met een reservering per upload-id tegen dubbele foto's en het album in hetzelfde verzoek ([WP18](./WP18-foto-upload.md)). De iPhone-app stuurt elke foto als JPEG met langste zijde hooguit 4032, zonder EXIF, met de opnamedatum en de locatie als aparte headers; grens 15 MiB. Daarna maakt de backend de formaten ([WP25](./WP25-fotoformaten.md)).
- `/upload` heeft geen CORS ([WP35](./WP35-webapp-bekijken.md) §CORS): een browser kan er nu niet naartoe.
- De webapp (WP35) verbergt alle wijzigknoppen via `readOnly` en toont op de routes buiten scope (`toevoegen` en andere) "Alleen in de app".
- De iPhone-app gebruikt `expo-image-picker` en `expo-image-manipulator` (of vergelijkbaar) voor kiezen en verkleinen; op het web werken die anders of niet.

## Invarianten

1. **Toegang zit in de backend.** Uploaden in een album mag alleen als lid van die groep, net als nu. De browser krijgt geen ruimere rechten dan de iPhone-app.
2. **CORS op `/upload` alleen voor de eigen webadressen** (dezelfde lijst als WP35, `CLUBALMANAC_WEB_ORIGINS`), nooit `*`, geen credentials. De iPhone-app merkt niets.
3. **Geen GPS buiten de backend.** Wat de browser verstuurt, bevat geen EXIF; datum en plaats gaan als dezelfde headers als vanuit de app. Een bestand dat de backend geeft, bevat nooit GPS (WP17d, ongewijzigd).
4. **Rechtop en met datum en plaats.** Een foto uit de browser ziet er in de app en op het web hetzelfde uit als dezelfde foto uit de iPhone-app: draaiing goed, opnamedatum en locatie bewaard. Een foto zonder datum of plaats komt binnen zonder, niet met de datum van vandaag.
5. **Geen dubbele foto's.** Opnieuw proberen na een mislukte of afgebroken upload maakt geen tweede foto (WP18, zelfde reservering).
6. **Geen stille mislukking.** De user ziet per foto wat niet lukte, met een NL-reden en opnieuw proberen. Een bestand dat niet kan (geen beeld, te groot na verkleinen, een formaat dat de browser niet leest) krijgt een duidelijke melding, geen hangende voortgang.
7. **Grote foto's over mobiel internet.** De browser verkleint vóór het versturen (zoals de app). Het geheugen van een telefoon loopt niet vol bij een ronde van veel foto's.
8. **De iPhone-app verandert niet.** De hele testsuite blijft groen; gedeelde code doet op iOS hetzelfde.
9. **De rest blijft alleen-lezen** (WP35 invariant 7), op uploaden en de profielfoto na.

## Scope

- **In:** foto's kiezen (meerdere tegelijk) op Android en op een laptop; verkleinen en EXIF lezen in de browser; uploaden met voortgang, fouten en opnieuw proberen; de twee ingangen (besluit 3); profielfoto uploaden en weghalen; CORS op `/upload`; runbook- en `external-services`-updates.
- **Bewust niet:** foto's met de camera maken vanuit de webapp (tenzij de kiezer van Android dat zelf aanbiedt); een bestaande foto als profielfoto kiezen (dat zit in het foto-menu); slepen als eis (mag, hoeft niet); uploaden onthouden over het sluiten van de browser heen; video's; alle andere acties.

## Open vragen voor A (rapporteren aan regie)

1. **Kiezen.** Werkt `expo-image-picker` op het web (Android Chrome en laptop) met meerdere foto's, of is een eigen `<input type="file" multiple accept="image/*">` beter? Wat geeft Android Chrome terug (bestand, naam, type, EXIF intact of niet)?
2. **Verkleinen en EXIF.** Hoe verkleint de browser naar JPEG ≤ 4032 met de juiste draaiing, en leest hij vooraf datum en GPS uit de EXIF (welke bibliotheek, hoe groot)? Klopt de draaiing in Chrome en Safari (canvas past de EXIF-oriëntatie soms al toe)?
3. **Formaten.** JPEG en PNG zeker. HEIC/HEIF: hoe vaak komt dat op Android of een laptop voor, kan de browser het lezen, en is omzetten (alleen laden als nodig) de moeite waard? WebP?
4. **CORS op `/upload`.** Welke methoden en headers (`Authorization`, `Content-Type`, `X-Upload-Id`, de datum- en locatieheaders), en welke response-headers moet de browser kunnen lezen? Is de bestaande code voor CORS uit WP35 uit te breiden zonder dat de beeldpaden veranderen?
5. **Mobiel netwerk.** Gedrag bij een upload die halverwege stopt, het tabblad dat op de achtergrond gaat, of het scherm dat uitgaat. Hoeveel uploads tegelijk? Moet het scherm wakker blijven (Wake Lock) zoals in de app?
6. **Geheugen.** Een ronde van 50 foto's van 50 MP op een gewone Android-telefoon: hoe voorkomen we dat de browser vastloopt (één voor één verkleinen, bitmaps vrijgeven)?
7. **Testen zonder toestel** (besluit 5). Wat dekt de apparaat-emulatie in Chrome wel en niet (de kiezer van Android, EXIF van een echte camera, geheugen, mobiel netwerk)? Is een Android-emulator op de Mac (Android Studio, gratis) haalbaar voor de gate, ook voor het bekijken uit WP35 (vegen, smal scherm, inloggen)?
8. **Profielfoto.** Welke schermen en functies hergebruikt het web uit de app, en wat moet er voor het web anders?

A rapporteert ook wat hier ontbreekt of niet klopt. Oude code is hier nauwelijks bron: het gaat om pariteit met de nieuwe iPhone-app.

## Risico-assessment

- **security/privacy: hoog.** Het uploadpad wordt voor het eerst vanuit een browser bereikbaar (CORS), en foto's bevatten GPS. Red-team op `/upload` vanuit de browser: origins, grootte- en typecontrole, EXIF die toch meegaat, rechten op het album.
- **ops: medium.** Grote bestanden over mobiel internet, afgebroken uploads, geheugen op een telefoon; mislukkingen moeten zichtbaar zijn.
- **external deps: medium.** Browserverschillen (Android Chrome, Safari, desktop) bij kiezen, EXIF en canvas; eventueel een bibliotheek voor EXIF of HEIC.
- **multi-user/concurrency: laag.** De reservering per upload-id bestaat al.
- **data/schema-evolutie: laag.** Naar verwachting geen schemawijziging.
- **ops-runbook-impact:** CORS op `/upload` via dezelfde env-var; aanvulling op [`docs/runbooks/webapp.md`](../runbooks/webapp.md) (gate-stappen voor uploaden, ook op prod in stap 11) en [`external-services.md`](../conventions/external-services.md). B levert ze mee, audit toetst.

## Cross-refs

- WP35 (webapp bekijken, CORS, beeldgeheugen, hosting), WP18 (upload en reservering), WP25 (formaten), WP17d (geen GPS in uitgaande bestanden), WP27 (profiel).

## Spec-criticus aanvullingen (A vult in)

> A 2026-11-20. Bronnen: de nieuwe app (`app/`, vooral `AddPhotosScreen`, `ProfileScreen`, `src/data/upload.ts`, `src/lib/upload.ts`), `convex/http.ts` en `convex/lib/webCors.ts`, de web-code van de geïnstalleerde pakketten (`expo-image-picker` 58.0.10, `expo-image-manipulator` 58.0.16, `expo-keep-awake` 58.0.4), WP18, WP25, WP35, en openbare bronnen over de fotokiezer van Android. Oude code is hier geen bron (pariteit met de iPhone-app).

### Wat niet klopt of ontbreekt in de draft

1. **Op Android komt de plaats meestal niet mee.** Sinds Android 13 haalt de fotokiezer van het systeem de GPS uit een foto die een app (ook Chrome) krijgt; vaak staan de GPS-velden er nog, maar op 0/0. Volgens meldingen van ontwikkelaars vraagt Chrome de toestemming niet die dat zou omzeilen (niet zelf op een toestel gezien; de emulator kan het laten zien). Nieuwere Android-versies krijgen een vraag "Locatie meesturen?", maar of Chrome die gebruikt, is onbekend. Invariant 4 ("met datum en plaats") kan op Android dus alleen voor de datum. Zonder maatregel landt een foto met 0/0 midden in de oceaan op de kaart (A-invariant U3). **Besluit Wouter (B1).**
2. **`expo-image-picker` op het web leest geen EXIF** (`asset.exif` ontbreekt) en geeft geen `assetId`. De bestaande koppeling `metadataHeaders(asset.exif)` geeft in de browser dus niets mee, en `albumBatch` maakt bij "Meer foto's" met dezelfde foto een tweede foto (WP18 A-invariant 25 vervalt stil).
3. **`toUploadJpeg` loopt op een telefoon vast.** De web-variant van `expo-image-manipulator` tekent eerst het hele origineel op een canvas, verkleint dan in JavaScript (pixel voor pixel, op de hoofdthread) via nog een canvas op volle maat, en maakt in `renderAsync` eerst een PNG die niemand gebruikt. Voor 50 MP is dat ruim 600 MB en tientallen seconden per foto; Safari weigert een canvas boven ~16,7 MP helemaal. De gemaakte JPEG (een `blob:`-URL) wordt nooit vrijgegeven: 50 foto's houden ~200 MB vast.
4. **De kiezer opent niet vanzelf.** `AddPhotosScreen` opent de kiezer na de schermovergang (of na een seconde). Een browser opent een bestandskiezer alleen direct na een tik; daarna blokkeert hij stil. De gebruiker ziet dan een leeg scherm (invariant 6).
5. **De voorbeeldtegels lopen het geheugen vol.** `AddPhotosScreen` toont elke gekozen foto met zijn eigen URI. Op het web is dat het origineel: 50 × 50 MP decoderen voor kleine tegels.
6. **Profiel op het web heeft drie iOS-onderdelen.** Het menu bij de foto is `ActionSheetIOS` (bestaat niet op het web), de bevestigingen in `ProfileScreen` gebruiken `Alert.alert` direct (op het web een no-op; WP35 loste dat alleen op voor de alleen-lezen-versie), en bijsnijden (`allowsEditing`) bestaat op het web niet. De hulptekst `PROFILE_PHOTO_HINT` verwijst naar het foto-menu, dat op het web weg blijft.
7. **`/upload` kan een 500 geven zonder CORS-header** (de `throw e` na een mislukte opslag). De browser ziet dan een netwerkfout. Dat is veilig (reden "netwerk", opnieuw met dezelfde id), maar een 500 met header is duidelijker in de log. Geen eis.
8. **`readOnly` is één vlag.** `toevoegen`, de "+" in de tabbalk, de knop in het album en de profielfoto hangen aan `READ_ONLY`. Uploaden moet aan terwijl de rest uit blijft (invariant 9); hoe, kiest B.

### Vraag 1: kiezen

- **Advies: een eigen web-kiezer** (`<input type="file" multiple accept="image/*">`, in een web-bestand), niet `expo-image-picker`. Die doet hetzelfde, maar: hij laadt bij het kiezen elk bestand in een `<img>` om de maat te lezen, faalt voor de héle keuze als één bestand geen beeldtype heeft, geeft geen EXIF en geen vaste id, en zet `capture`/bijsnijden-opties stil opzij. Houd `accept="image/*"`: dan opent Chrome op Android de fotokiezer met meerdere tegelijk; een lijst met exacte types valt terug op de bestandsbeheerder.
- **Wat Android Chrome teruggeeft:** per foto een `File` met een naam (vaak de originele, zoals `PXL_…jpg`, niet gegarandeerd), een type (`image/jpeg`, soms leeg) en een `lastModified` die niet te vertrouwen is (vaak het moment van kiezen). De bytes zijn het origineel, met EXIF, maar met de GPS weggehaald of op 0/0 (zie punt 1). De datum blijft.
- **Op een laptop** opent de bestandsdialoog van het systeem: EXIF compleet, ook de GPS.
- **Annuleren** geeft in Chrome ≥ 113 en Safari ≥ 16.4 een `cancel`-event. In oudere browsers komt er niets: de knop "Foto's kiezen" moet daarom altijd opnieuw te tikken zijn (A-invariant U9).

### Vraag 2: verkleinen, draaien en EXIF

- **Draaien:** Chrome (≥ 81), Safari (≥ 13.1) en Firefox (≥ 77) tonen een `<img>` rechtop volgens de EXIF-stand, en tekenen hem zo ook op een canvas; `naturalWidth/Height` zijn al de rechtop-maten. Dus: niet zelf draaien op de EXIF-tag (dat draait dubbel). `createImageBitmap` alleen met expliciet `imageOrientation: "from-image"`. De gate controleert het met de testfoto's (stand 3, 6 en 8).
- **Verkleinen:** in één stap tekenen op een canvas met de doelmaat (`fitWithin`, ≤ 4032), JPEG via `toBlob` met dezelfde kwaliteit als de app (0,85), daarna het canvas leegmaken en alle `blob:`-URL's vrijgeven. Een canvas maakt nooit EXIF: geen GPS en geen stand-tag in wat verstuurd wordt. Doorzichtig wordt wit, niet zwart (een canvas zonder achtergrond geeft in JPEG zwart).
- **EXIF lezen:** alleen het begin van het bestand (de eerste 128 KiB is ruim; EXIF staat vooraan), en alleen datum en GPS. Een eigen kleine lezer (~150 regels, pure functie, getest) of `exifr` in de lite-versie (enkele tientallen kB); B kiest. Geen bibliotheek die het hele bestand inleest. Vorm van de headers gelijk aan de iPhone (`X-Taken-At` in EXIF-vorm, graden met teken); de opnamedatum zoals de backend hem uit een bestand leest (`DateTimeOriginal`, anders `CreateDate`).

### Vraag 3: formaten

- **JPEG, PNG, WebP, GIF, AVIF:** de browser decodeert ze; alles wordt JPEG. Een GIF wordt zijn eerste beeld.
- **HEIC/HEIF:** op Android zeldzaam (Pixel maakt JPEG, Samsung alleen met de optie "Foto's met hoge efficiëntie", standaard uit). Op een laptop komt HEIC vooral van een iPhone (AirDrop, Foto's op de Mac); wie een iPhone heeft, heeft de app. Chrome kan HEIC niet lezen, Safari op de Mac wel. Een decoder in de browser (libheif als WebAssembly) is ruim 1 MB. Het origineel ongewijzigd doorsturen (de backend kan HEIC) zou de GPS meesturen (invariant 3).
- **Advies:** geen HEIC-decoder. Wat de browser niet kan lezen, krijgt per foto de reden "formaat" met een NL-tekst; Safari op de Mac leest HEIC gewoon en zet hem om. **Besluit Wouter (B2).**
- SVG wordt geweigerd ("geen foto"): een vector, geen foto.

### Vraag 4: CORS op `/upload`

- **Preflight `OPTIONS /upload`:** `POST`, en de headers `Authorization`, `Content-Type`, `X-Upload-Id`, `X-Album-Id`, `X-Taken-At`, `X-Latitude`, `X-Longitude`. Niet `X-Filename`: de iPhone stuurt hem niet en een bestandsnaam kan iets verraden. Geen `*`, geen `Allow-Credentials`, dezelfde origins en dezelfde fail-loud als WP35. De preflight vraagt geen login.
- **Antwoorden:** de app leest alleen de status en de JSON. Geen `Expose-Headers` nodig. Elk antwoord op een toegestane origin draagt de header, ook 400, 401, 403, 404, 409, 413 en 415: anders ziet de app "netwerk" waar het "uitgelogd" of "limiet" is.
- **Bestaande code:** `withWebCors` hangt niet af van het pad en is zo te gebruiken. De preflight voor de beeldpaden zet vast `GET` en `Authorization`; die moet zo blijven (getest), dus `/upload` krijgt zijn eigen methoden en headers.
- **Geen CSRF:** een upload vraagt het token in de header; een formulier of `<img>` van een andere site kan die niet zetten. Voor de red-team.
- De browser onthoudt de preflight een uur voor `/upload` (één URL), dus hooguit één extra verzoek per uur.

### Vraag 5: mobiel netwerk

- **Halverwege afgebroken:** `fetch` geeft een fout → reden "netwerk", opnieuw met dezelfde id. Lukte de upload maar ging het antwoord verloren, dan geeft opnieuw dezelfde foto terug (WP18). Dat werkt al; de termijn van 120 s per verzoek blijft. Een JPEG van 2–5 MB haalt dat bij ~0,5 Mbit/s omhoog nog net.
- **Voortgang:** zoals de app, per foto ("3 van 10"). `fetch` geeft geen voortgang binnen één foto; niet nodig.
- **Tegelijk:** uploaden met 2 tegelijk zoals de app, maar **omzetten één voor één** (geheugen, vraag 6).
- **Scherm wakker:** ja, zoals de app. `expo-keep-awake` gebruikt op het web de Wake Lock API (Chrome Android ≥ 84, Safari ≥ 16.4, alleen via https of localhost). De browser laat de lock los zodra het tabblad verborgen raakt en vraagt hem niet opnieuw: de webapp moet hem bij terugkeer opnieuw vragen zolang er een ronde loopt.
- **Tabblad op de achtergrond of scherm uit:** lopende verzoeken lopen vaak door, maar Chrome bevriest de pagina na een paar minuten en kan hem bij geheugentekort weggooien. Bij terugkeer gaan de wachtende foto's verder; een afgebroken foto krijgt "netwerk". Weggegooid = de pagina herlaadt en de ronde is weg (scope: niet onthouden). Wie dan dezelfde foto's opnieuw kiest, krijgt dubbele foto's, want de vaste id's zitten in het geheugen van de pagina. **Besluit Wouter (B4)**: accepteren, of de id's per tabblad bewaren in `sessionStorage` (overleeft herladen in hetzelfde tabblad, niet het sluiten).
- **Vertrekken tijdens een ronde:** de browser vraagt "Pagina verlaten?" zolang er foto's onderweg zijn (A-invariant U10). Klein, en het voorkomt de meest voorkomende stille mislukking op het web.

### Vraag 6: geheugen

- Een foto van 50 MP is gedecodeerd ~200 MB; het canvas op 4032 × 3024 ~49 MB; de JPEG 2–5 MB. **Eén foto tegelijk omzetten** houdt de piek rond 250 MB, wat een gewone Android-telefoon (4–6 GB) aankan. Twee tegelijk verdubbelt dat.
- Na elke foto: canvas leeg (maat 0), `<img>` los, `blob:`-URL's vrij (ook die van het origineel), en de JPEG loslaten na de upload (gelukt of niet). Opnieuw proberen zet de foto opnieuw om vanuit het bestand.
- **Voorbeeldtegels** niet uit het origineel (punt 5). Of kleine tegels maken tijdens het omzetten (één voor één), of geen beeld in de tegel tot de foto klaar is; B kiest. Bij 50 foto's mag het kiesscherm geen 50 originelen decoderen.
- **Een grens:** boven een aantal pixels (advies 100 MP; 50 MP moet kunnen) krijgt de foto "te groot" zonder te decoderen; de maat staat in de kop van het bestand. Zo laat één foto van een 200 MP-camera de pagina niet crashen. **Besluit Wouter (B3).**

### Vraag 7: testen zonder Android-toestel

**Chrome op de Mac met apparaat-emulatie** dekt: smal scherm, aanraken, user-agent, een trager netwerk (ook omhoog) en een tragere processor; dus de schermen, de voortgang, fouten en opnieuw proberen, CORS, draaien en verkleinen. Hij dekt niet: de fotokiezer van Android (je krijgt de bestandsdialoog van de Mac, mét GPS, dus een te mooi beeld), het geheugen van een telefoon, het bevriezen of weggooien van een tabblad, de Wake Lock op een telefoon, de echte adresbalk en het toetsenbord van Android.

**Android-emulator op deze Mac** (M1, 16 GB, 58 GB vrij): haalbaar en gratis.
- Draait een arm64-image native op Apple Silicon. Een image "Google Play" (Android 15 of 16) heeft Chrome; met een Google-account werkt hij bij via de Play Store.
- Ruimte: Android Studio (met eigen Java) ~3 GB, emulator en één image ~3 GB, het virtuele toestel 6–8 GB: samen ~10–14 GB. Er staat nu geen Java en geen Android-SDK op de Mac; met Android Studio hoeft dat ook niet apart. Alleen de command-line-tools kan ook (Homebrew `android-commandlinetools` plus een JDK 17), ongeveer even groot.
- Geheugen: het toestel krijgt standaard 2–4 GB; op 2 GB zetten bootst een gewone telefoon beter na. Naast Metro en Convex past dat.
- **De echte fotokiezer zit erin** (Android 13+): dus ook het weghalen van de GPS. Precies wat de gate op Android moet zien.
- **Foto's met EXIF erop:** `adb push tests/fixtures/wp36/*.jpg /sdcard/DCIM/Camera/`, daarna de mediascanner laten kijken (`adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/DCIM/Camera/<naam>`, of het toestel herstarten). Slepen op het venster kan ook (komt in Downloads). De bytes blijven gelijk, dus de EXIF ook. De camera-app van de emulator maakt nep-foto's met EXIF.
- **De webapp tegen dev:** `adb reverse tcp:8081 tcp:8081`, dan in Chrome op de emulator `http://localhost:8081`. Dat is dezelfde origin als op dev in `CLUBALMANAC_WEB_ORIGINS` staat en een "veilige context" (Wake Lock werkt). `10.0.2.2:8081` werkt niet: andere origin, en geen veilige context.
- **Ook voor WP35:** vegen tussen foto's, smal scherm, inloggen met de code uit de mail, de kaart.
- **Op afstand:** het emulator-venster staat op het scherm van de Mac. Claude kan hem met `adb` bedienen (tikken, typen, schermafbeeldingen), dus een groot deel van de gate kan Claude doen; Wouter kijkt mee via schermdelen.
- Niet gedekt: een echte camera (HDR, Ultra HDR, bewegende foto's), de galerij en skin van Samsung, een trage echte telefoon. **Advies:** de emulator voor de gate op dev, en na de livegang één Android-lid één ronde laten doen op prod (runbook stap 11). **Besluit Wouter (B5)**: emulator installeren of niet.

### Vraag 8: profielfoto

- **Hergebruik:** het blok `ProfilePhotoBlock` met zijn stappen (kiezen, de melding "Profielfoto is openbaar", uploaden met één upload-id, opslaan met `setProfilePhoto`, opnieuw proberen via `profileRetry`, weghalen met `removeProfilePhoto` na bevestiging), de teksten uit `profileEdit.ts` en dezelfde mutations. De backend verandert niet: de upload zonder `X-Album-Id` is al de profielfoto (WP18 besluit 1).
- **Anders op het web:**
  - Het menu (`ActionSheetIOS`) wordt twee knoppen of een eigen menu: "Foto kiezen"/"Andere foto kiezen", en "Profielfoto weghalen" als er een is (`profilePhotoMenu`).
  - Bevestigen via de web-bevestiging van WP35 (`confirm.web`), niet `Alert.alert`.
  - De kiezer opent direct op de tik (punt 4); één foto.
  - Geen bijsnijden in de browser. **Advies:** automatisch een vierkant uit het midden (A-invariant U8). Het profielpad is openbaar (WP17a besluit 8): zo wordt niet meer van de foto openbaar dan de ronde avatar laat zien, zoals op de iPhone na bijsnijden. **Besluit Wouter (B6).**
  - Geen datum en geen plaats mee (de iPhone stuurt ze bij de profielfoto ook niet).
  - Geen "Toegang tot je foto's nodig" (een browser vraagt dat niet).
  - De hulptekst over het foto-menu weg op het web (dat menu is er niet).

### A-invarianten

**U1. CORS op `/upload`, alleen voor de eigen origins.** Preflight van een toegestane origin: 204 met die origin, `POST`, precies de headers van vraag 4, een `Max-Age`, `Vary: Origin`; nooit `*`, nooit `Allow-Credentials`, geen `X-Filename`; zonder login. Andere origin: 403 zonder header. Elk antwoord van `/upload` op een toegestane origin draagt de header (200, 400, 401, 403, 404, 409, 413, 415). De beeldpaden blijven `GET` met alleen `Authorization`; het profielpad blijft zonder preflight.

**U2. De toegang verandert niet.** Zelfde status en zelfde gevolg met of zonder `Origin`, van elke origin: niet-lid 404 en niets achter, opnieuw met dezelfde id dezelfde foto, datum en plaats uit de headers bij de foto. De iPhone (geen `Origin`) merkt niets; een ontbrekende env-var raakt hem niet en geeft een fout met de naam in de log.

**U3. Datum en plaats uit het bestand, zoals op de iPhone.** De webapp leest ze uit de EXIF van het gekozen bestand en stuurt ze als `X-Taken-At`, `X-Latitude`, `X-Longitude`. Opnamedatum: `DateTimeOriginal`, anders `CreateDate`; nooit de wijzigingsdatum, nooit "vandaag". Plaats alleen met breedte én lengte, binnen bereik, en niet 0/0. Big- en little-endian. Een kapot of afgekapt EXIF-blok geeft geen fout, alleen geen gegevens. De profielfoto stuurt geen datum en geen plaats.

**U4. Geen GPS in wat de browser verstuurt.** Elke foto gaat als nieuw gemaakte JPEG (≤ 4032, rechtop), nooit als het origineel, ook niet als het origineel al een kleine JPEG is. Vóór het versturen een controle over het héle bestand (EXIF-GPS, XMP-GPS, ook na het beeld): vindt die iets, dan gaat de foto niet en krijgt hij een reden. Een stand-tag zonder GPS mag (een browser kan er een schrijven).

**U5. Per foto een reden, nooit een hangende voortgang.** Geen beeldtype (en geen beeldnaam bij een leeg type), SVG of een leeg bestand: "geen foto", vóór het decoderen. Een beeld dat de browser niet kan lezen: de nieuwe reden "formaat" met een eigen NL-tekst, zonder opnieuw proberen. Een fout in één bestand stopt de andere niet.

**U6. Het geheugen blijft begrensd.** Omzetten één foto tegelijk; per foto alles vrijgeven (vraag 6); geen voorbeeldtegel uit het origineel; boven `WEB_MAX_PIXELS` (50 MP moet kunnen, onder 200 MP) "te groot" zonder te decoderen. Gate: 50 grote foto's in één ronde op de emulator met 2 GB.

**U7. Opnieuw proberen en "Meer foto's" zonder dubbele foto's.** Binnen een ronde houdt elke foto zijn upload-id (zoals nu). Over rondes heen (zelfde album, zelfde pagina) krijgt dezelfde foto dezelfde id, via een vaste id uit de inhoud van het bestand (begin van de bytes plus de maat), niet uit de naam of `lastModified`.

**U8. Profielfoto zonder bijsnijden in beeld** (advies B6): een vierkant uit het midden van de rechtop-foto, daarna verkleind. Vervalt als Wouter kiest voor de hele foto.

**U9. De kiezer opent op de tik.** Op het web opent elke ingang (knop in het album, de "+", Profiel) de kiezer direct in de tik. Gaat hij niet open of annuleert de user, dan staat er een knop "Foto's kiezen" die het opnieuw doet; nooit een leeg scherm.

**U10. Vertrekken tijdens een ronde vraagt eerst.** Zolang er foto's wachten of onderweg zijn: "Pagina verlaten?" van de browser bij sluiten of herladen, en het scherm blijft wakker (Wake Lock, opnieuw gevraagd na terugkeer).

**U11. Alleen uploaden erbij** (besluit 1, invariant 9). Op het web verschijnen alleen: de knop "Foto's toevoegen" in een album waar de user mag toevoegen (zelfde regel als de app), de "+" in de tabbalk, `toevoegen` (geen "Alleen in de app" meer), en het profielfoto-blok (kiezen, weghalen). Naam wijzigen, account verwijderen, meldingen, het foto-menu en alles anders blijven weg.

**U12. iOS gelijk.** Web-varianten in eigen bestanden of achter een platformcheck; het iOS-pad van kiezen, omzetten en uploaden verandert niet (`toUploadJpeg`, `metadataHeaders`, `expo-image-picker`). De nieuwe reden "formaat" komt op iOS niet voor. Root- en app-suite blijven groen.

### Pariteit-checklist (per scherm, gedrag)

| Scherm | Zoals de app | Op het web anders |
|---|---|---|
| Album → "Foto's toevoegen" | Opent het toevoeg-scherm met dit album, kiezer met meerdere, tegels, "Toevoegen aan …", voortgang "n van m", per reden een regel, "Opnieuw" met dezelfde id's, "Meer foto's", "Naar het album", groene melding als alles erin staat | Kiezer op de tik (U9); tegels zonder originelen (U6); vraagt bij vertrekken (U10) |
| "+" in de tabbalk | Eerst foto's kiezen, dan een album (`AlbumChoice`), met het album van de huidige route voorgekozen (`albumIdFromPath`) | Kiezer op de tik |
| Profiel → profielfoto | Kiezen, melding "openbaar", opslaan, opnieuw proberen, weghalen met bevestiging, meldingen per bezoek | Knoppen i.p.v. actiemenu, web-bevestiging, vierkant uit het midden (B6), geen hulptekst over het foto-menu |
| Fouten | NL-teksten uit `reasonText` | Plus "formaat" |

### Tests (A)

| Bestand | Wat |
|---|---|
| `tests/http/uploadCors.test.ts` (nieuw) | U1, U2: preflight op `/upload` (toegestane en andere origins, headers, geen `*`, geen `X-Filename`, zonder login), de header bij elke status, toegang gelijk (niet-lid 404 zonder resten, herhaling één foto, datum en plaats), iPhone zonder `Origin`, env ontbreekt, prod alleen `https`, beeldpaden ongewijzigd |
| `tests/images/httpRoute.test.ts` (aangepast) | Routelijst: plus `OPTIONS /upload`; webhooks en `/_test/whoami` nog steeds zonder |
| `app/tests/webPhoto.test.ts` (nieuw, module `app/src/lib/webPhoto.ts`) | U3 (`webMetadataHeaders`), U4 (`isSafeToSend`), U5 (`webPickProblem`, reden `"formaat"` in `src/lib/upload.ts`), U6 (`WEB_MAX_PIXELS`, `tooManyPixels`), U7 (`webAssetId` met `albumBatch`), U8 (`profileSquare`) |
| `app/tests/support/exifJpeg.ts` (nieuw) | Bouwt EXIF (II en MM) voor de lezer; zelf gecontroleerd met exif-parser |
| `tests/fixtures/wp36/` + `scripts/wp36/maak-testfotos.mjs` | Testfoto's met stand 3/6/8, datum, GPS (ook 0/0), zonder EXIF, doorzichtige PNG; voor de tests en de gate |

Niet in unit-tests (gate en audit): draaien en verkleinen op een canvas, het vrijgeven van geheugen, U9, U10, U11, de schermen, het gedrag van de Android-kiezer.

Tegen een wegwerp-referentie (buiten de commit): root `tests/http` + `tests/images` 276 groen, app 1712 groen, app-tsc schoon. Mutanten gevangen: 0/0 als plaats, geen `CreateDate`, GPS-controle alleen vooraan, SVG toegestaan, id uit een te klein stuk, preflight zonder de datum/plaats-headers, `*` als headers, CORS alleen op 200.

### Besluiten voor Wouter

- **B1.** Plaats op Android: accepteren dat die meestal ontbreekt (advies; de datum komt wel mee), of later een tweede knop "Kies via Bestanden" die de fotokiezer omzeilt (onzeker, eerst op de emulator proberen)?
- **B2.** HEIC: geen decoder, per foto de melding "formaat" (advies), of een decoder van ruim 1 MB die alleen laadt als nodig?
- **B3.** Grens per foto: 100 MP (advies), of een ander getal tussen 50 en 200 MP?
- **B4.** Pagina weggegooid tijdens een ronde: accepteren (advies), of de upload-id's per tabblad bewaren in `sessionStorage`?
- **B5.** Android-emulator op de Mac installeren voor de gate (advies; ~10–14 GB, gratis), of alleen Chrome met apparaat-emulatie plus één Android-lid na de livegang?
- **B6.** Profielfoto op het web: automatisch een vierkant uit het midden (advies), of de hele foto?

## Besluiten Wouter na A (2026-11-20)

Alle zes volgens het advies van A:

- **B1.** De plaats ontbreekt op Android meestal; dat accepteren we. Geen tweede knop "Kies via Bestanden".
- **B2.** Geen HEIC-decoder: per foto de melding "formaat".
- **B3.** Grens 100 MP per foto.
- **B4.** Een weggegooide pagina tijdens een ronde accepteren; geen `sessionStorage`.
- **B5.** Android-emulator op de Mac voor de gate van WP35 en WP36. Regie installeert hem.
- **B6.** Profielfoto op het web: automatisch een vierkant uit het midden.
