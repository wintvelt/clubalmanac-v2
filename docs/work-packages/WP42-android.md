# WP42: Android-app

Draft van regie, 2026-11-25. Bron: `builds/android-brief.md`.

## Productdoel

Een lid met een Android-telefoon installeert Clubalmanac uit Google Play en doet er hetzelfde mee als op de iPhone. De webapp (`app.clubalmanac.com`) blijft voor wie geen app wil.

## Voorstel: in drie delen

| Deel | Wat het lid krijgt | Native werk |
|---|---|---|
| **42a** | Inloggen, groepen, albums, foto's bekijken en toevoegen (met datum en plaats), kaart, delen, profiel, uitnodigingen, melden, films, groepsbeheer. Filmpjes alleen bekijken. Via de interne testtrack van Play. | Geen eigen native code |
| **42b** | Filmpjes toevoegen, verkleind zoals op de iPhone (WP37). | Kotlin-tegenhanger van het verkleinen, of een bibliotheek |
| **42c** | Originelen voor het filmproject (WP38), ook als de app dichtgaat. | Uploader op de achtergrond (WorkManager of foreground service) |

42b en 42c starten pas na de gate van 42a, elk met een eigen kickoff. Deze spec gaat over 42a; 42b en 42c staan hier alleen als richting.

## Wat er is (regie, 2026-11-25)

- De app is Expo / React Native; `app/android/` wordt net als `app/ios/` gemaakt uit `app.json` (gitignored).
- Eigen native code: alleen `app/modules/clubalmanac-video`, en die meldt zich alleen voor `apple` aan. Zeven bestanden importeren hem (o.a. `AddPhotosScreen`, `videos.ts`, `originals.ts`, `FilmProjectScreens`).
- `ActionSheetIOS` in zes schermen (o.a. `PhotoMenu`, `GroupScreen`, `ProfileScreen`, `LoginScreen`). `Alert.alert` op 11 plekken.
- De kaart (`AlbumMapScreen`, `LocationScreen`) gebruikt `react-native-maps`. Op iOS is dat Apple Maps; **op Android is dat Google Maps, met een API-sleutel.** De webapp gebruikt OpenStreetMap via Leaflet (WP35 besluit 5).
- **Er zijn geen universal links.** De uitnodigingsmail heeft geen persoonlijke link (WP19b besluit 1), alleen een vaste App Store-link (WP19c). App Links en `assetlinks.json` zijn dus niet nodig; wel een Play-link in de mail zodra de app in Play te koop is.
- Op deze Mac staan de Android command-line-tools, emulator en één image (Android 36) al (WP36-gate). Er is geen JDK.
- Bouwen voor iOS gaat lokaal met `eas build --local` (WP34). De bundle-id `com.wintvelt.clubalmanac-app` kan geen Android-pakketnaam zijn (geen `-` toegestaan).

## Invarianten (42a)

1. **Hetzelfde gedrag als op de iPhone**, behalve wat hieronder bewust anders is. Teksten gelijk.
2. **De iPhone-app verandert niet.** Elke Android-aanpassing laat iOS en web zoals ze zijn.
3. **Geen filmpjes toevoegen op Android in 42a.** De kiezer toont alleen foto's; waar de iPhone filmpjes noemt, zegt Android niets over filmpjes of één korte melding. Filmpjes van anderen bekijken en afspelen werkt wel. De app start en werkt zonder de video-module; nergens een crash of lege knop.
4. **Foto's houden datum en plaats**, net als op de iPhone (`takenAt` uit `DateTimeOriginal ?? CreateDate`, plaats voor de kaart). Lukt dat niet zonder brede toegang tot de galerij: besluit Wouter (B4).
5. **De GPS-regel van WP17d blijft:** geen bestand dat de backend geeft bevat GPS, ook niet van een Android-upload. HEIC/HEIF van een Android-camera gaat als JPEG omhoog, rechtop.
6. **Inloggen met de code uit de mail** werkt; de sessie blijft bewaard (secure store), uitloggen en account verwijderen wissen alles lokaal (WP29).
7. **Android-eigen bediening:** de terugknop en het terugvegen van het systeem doen wat het lid verwacht (selectie eerst sluiten, dan terug); menu's en bevestigingen zijn Android-menu's, geen nagebootste iOS-bladen; tabbalk, randen van het scherm (edge-to-edge), donker thema en grote letters (tot 200%) kloppen.
8. **Geen nieuwe vaste kosten.** Alles samen ≤ €15 per maand; de $25 van Play is eenmalig.

## Scope

- **In 42a:** alles uit het productdoel behalve filmpjes toevoegen en originelen; Android-config in `app.json` (pakketnaam, rechten, icoon), menu's en bevestigingen voor Android, de kaart, foto's met plaats, bouwen voor Android, de interne testtrack, de Play-verplichtingen (zie A-vraag 7).
- **Bewust niet:** filmpjes toevoegen (42b), originelen (42c), meldingen, een tablet-indeling voor Android, Android-toestellen ouder dan wat Expo 58 ondersteunt.

## Keuzes voor Wouter (draft, advies van regie)

- **B1. Wie heeft Android?** Hoeveel leden, en welke telefoons (merk, ongeveer hoe oud)? Bepaalt of 42a genoeg is en of de interne testtrack blijvend kan.
- **B2. Opknippen in 42a/b/c.** Advies: ja. 42a geeft Android-leden bijna alles zonder native code; filmpjes en originelen zijn het dure deel.
- **B3. Kaart op Android.** (a) Google Maps: zelfde code als iOS, gratis voor apps, maar een Google Cloud-project met betaalgegevens en een sleutel die Wouter aanmaakt; (b) OpenStreetMap zoals de webapp: geen account, meer bouwwerk. Advies: (a), sleutel beperkt tot de app.
- **B4. Foto's met plaats.** Volgt na A's meting. De fotokiezer van Android kan de plaats weghalen; de plaats houden kan dan alleen met toegang tot de hele galerij, en daarvoor vraagt Play een verklaring.
- **B5. Hoe in Play.** (a) Interne testtrack: tot 100 testers, geen keuring, leden geven hun Google-adres door; (b) productie: bij een persoonlijk account eerst een gesloten test met een minimum aantal testers en dagen (A checkt de actuele regel), of een organisatie-account (D-U-N-S). Advies: (a) voor 42a; productie later, afhankelijk van B1.
- **B6. Bouwen.** Lokaal met `eas build --local` (JDK 17 erbij, ~0,3 GB; SDK staat er) of in de EAS-cloud (gratis tegoed). Advies: lokaal, zoals iOS.
- **B7. Pakketnaam.** Blijvend, niet te wijzigen na de eerste upload. Advies: `com.wintvelt.clubalmanac`, tenzij de oude app er al een in Play had (A-vraag 1).

## Open vragen voor A (rapporteren aan regie)

1. **Oude app op Android:** had v1 een Android-versie of een pakketnaam in Play? Wat deed hij anders op Android (rechten, menu's, kaart)?
2. **Foto's en plaats:** wat geeft `expo-image-picker` op Android 13+ (fotokiezer) aan EXIF terug, met en zonder `ACCESS_MEDIA_LOCATION`? Meet op de emulator met de fixtures van WP36. Wat is het alternatief als de plaats wegvalt, en wat vraagt Play daarvoor? Ook HEIC/HEIF en een staande foto.
3. **De video-module:** wat gebeurt er nu op Android bij het importeren ervan, en waar moet de app zonder kunnen?
4. **Menu's en bevestigingen:** per `ActionSheetIOS`-plek wat Android toont; `Alert.alert` heeft op Android hoogstens drie knoppen en sluit bij tikken ernaast; waar raakt dat de bediening?
5. **Inloggen:** werkt Clerk met de code en de secure store op Android; hoe komt de code in het veld (geen Mail-suggestie zoals op iOS)?
6. **Delen, kaart, films, webview-schermen:** wat werkt op Android anders of niet (deelmenu, `react-native-maps`, `expo-video`, toetsenbord met `keyboardByWindow`)?
7. **Play-verplichtingen:** target-SDK, 16 KB-pagina's, rechtenverklaringen, Data safety, privacyverklaring, en **account verwijderen via een webadres** (Play eist dat; de webapp kan het nu niet). Wat is nodig vóór de interne testtrack, en wat pas voor productie?
8. **Gate:** wat kan op de emulator, wat alleen op een echte telefoon?

## Risico-assessment

- **security/privacy:** medium. Een nieuwe kiezer en rechten rond foto's met plaats; de GPS-regel van WP17d moet ook voor Android-uploads gelden. Geen nieuwe backend-paden.
- **ops:** medium. Nieuw: Play-account, ondertekening, Android-builds, een tweede winkel bij elke release.
- **external deps:** medium. Google Play (beleid wijzigt), mogelijk Google Maps; Expo/RN-ondersteuning voor Android.
- **multi-user/concurrency:** laag. Zelfde backend.
- **data/schema-evolutie:** laag. Geen schemawijziging verwacht.
- **ops-runbook-impact:** Google Play (account, pakketnaam, ondertekening via EAS, testtrack, Data safety), eventueel de Maps-sleutel (waar die staat, beperkt tot pakket en certificaat) en de Play-link voor de uitnodigingsmail. Alles in `external-services.md` en de bouwstappen in de docs van WP34. B levert die mee, audit toetst.

## Cross-refs

- `builds/android-brief.md`; WP36 §"Android-emulator op deze Mac"; WP35 (webapp, Leaflet-kaart); WP17d (GPS-regel, kaart, delen); WP18 (upload); WP19b/WP19c (uitnodigingsmail); WP22 (login-code); WP29 (account verwijderen); WP34 (lokaal bouwen); WP37/WP38 (video-module).

## Acceptance (42a)

- Tests: pure logica die voor Android verandert (bijv. keuze van menu-opties, EXIF naar `takenAt` en plaats), plus een test dat de app-onderdelen zonder video-module laden.
- Gate door Wouter, eerst dev: op de emulator (Claude kan die met `adb` bedienen) en daarna op een echte Android-telefoon via de interne testtrack. Inloggen, groep, album van 540 foto's, foto toevoegen met datum en plaats, de kaart, delen, profielfoto, uitnodiging accepteren, melden, een film, groepsbeheer, terugknop, donker thema, grote letters, uitloggen. Daarna een iOS-build: niets veranderd.

## Besluiten Wouter (2026-11-25)

- **B1.** Hooguit 3–4 leden gebruiken Android. (Welke telefoons en welke Android-versie: nog navragen, zie A-antwoord 2 en 8.)
- **B5.** Play wordt een **organisatie-account** (bedrijfsaccount), niet persoonlijk. Testers zoeken voor een gesloten test lukt niet. Wat dat account vraagt en wat het oplevert: zie A §Play, "Organisatie-account".

---

## Spec-criticus aanvullingen (A vult in)

> A 2026-11-25, deel 42a. Bronnen: de app (`app/`), de Android-code van de geïnstalleerde pakketten (`react-native` 0.88.1, `expo-image-picker` 58.0.10, `expo-sharing` 58.0.23, `expo-image-manipulator` 58.0.16 met `expo-image-loader`, `expo-secure-store`, `expo-video`, `@react-native-community/datetimepicker` 9.2.1, `@clerk/expo` 4.16.1), het Expo-template van SDK 58, de broncode van MediaProvider in AOSP (`main`, nov 2026), de Play Console Help en developer.android.com (opgehaald 2026-11-25), de prijspagina's van Google Maps Platform en Expo, WP36 (fotokiezer van Android, fixtures) en de oude app (`~/Code/v1/clubalmanac-app`). Niets gebouwd en niets op de emulator gedraaid: wat alleen met een Android-build te meten is, staat als spike S1.

### Wat niet klopt of ontbreekt in de draft

1. **`ActionSheetIOS` crasht op Android, hij doet niet "niets".** Elke aanroep loopt op Android tegen `invariant(RCTActionSheetManager, "ActionSheetManager doesn't exist")` aan, in een tik-handler; in een release-build is dat een crash. Het zijn vijf schermen, niet zes, en `LoginScreen` hoort er niet bij: `PhotoMenu` (foto-menu, tot ~8 opties, plus `dismissActionSheet` als de foto verdwijnt), `GroupScreen` (menu bij een lid, met de naam als titel), `ProfileScreen` (profielfoto), `GroupAdminScreens` (cover weghalen) en `FeatureScreens` (status van een idee, beheer). `Alert.alert` is geen vervanger: het foto-menu heeft meer dan drie opties.
2. **`Alert.alert` sluit op Android níet bij ernaast tikken.** Op Android is een dialoog standaard niet te annuleren (ook niet met de terugknop), tenzij `cancelable: true`. Vijf van de negen bevestigingen geven dat mee (`confirm.ts`, `GroupScreen`, `FlagScreens`, `FeatureScreens`, `GroupAdminScreens`); de drie in `PhotoMenu` (bevestigen, delen, profielfoto) en die in `LocationScreen` niet. Alle bevestigingen hebben twee knoppen, dus de grens van drie raakt niets. `style: "destructive"` kleurt op Android niets rood.
3. **De datumkiezer gaat op Android vanzelf open, en steeds opnieuw.** `DayPicker` (einddatum filmproject, "Filmproject starten" en "Einddatum wijzigen") zet `<DateTimePicker display="spinner">` in het scherm. Op Android opent dat component bij het tonen een dialoog, en opnieuw bij elke render (de handler is elke render nieuw). `locale="nl-NL"` en `textColor` werken alleen op iOS.
4. **`gestureEnabled: false` houdt de terugknop van Android niet tegen.** Op iOS blokkeert het de veeg terug tijdens een ronde (`AddPhotosScreen`), in selectie (`AlbumScreen`) en bij een film. Op Android sluit de terugknop dan gewoon het scherm: midden in een upload, of met een selectie die stil verdwijnt. De webvariant lost dat al op met `usePreventRemove`.
5. **De video-module is al optioneel; de kiezer niet.** `requireOptionalNativeModule` geeft op Android `null`, elk onderdeel controleert `videoModuleAvailable`/`originalUploaderAvailable`, de runner van originelen start niet (geen crash bij importeren). Maar de kiezer vraagt `["images", "videos"]`: een lid kiest een filmpje en krijgt per filmpje "verkleinen lukte niet". De lege stand zegt "Kies foto's of filmpjes".
6. **De datum en plaats van de iPhone-app zijn niet `DateTimeOriginal ?? CreateDate`.** De iPhone-app (`metadataHeaders` in `src/lib/upload.ts`) gebruikt alleen `DateTimeOriginal`; `CreateDate` is de regel van de webapp (WP36 U3). Pariteit voor Android: alleen `DateTimeOriginal`. En de app weigert 0/0 niet: een foto waarvan Android de plaats wegveegt, kan midden in de oceaan landen (de backend neemt 0/0 aan). Zie A5.
7. **De "Ophalen"-teller loopt op Android vanaf het openen van de kiezer.** Zonder module zegt `pickerOnScreen` `null`, en dan telt het scherm vanaf het openen. Wie twee minuten in de kiezer bladert, ziet bij terugkomst "Je keuze ophalen… 2:00".
8. **Een fout van de kiezer zegt op Android "Toegang tot je foto's nodig".** `AddPhotosScreen` (zonder module wordt `closedSeen` nooit gezet) en `ProfileScreen` (elke fout) tonen dan "Instellingen openen". De fotokiezer van Android vraagt geen toegang; die tekst klopt daar nooit.
9. **Delen gooit het bestand weg voordat de ontvanger het heeft.** `useSharePhoto` wist het tijdelijke bestand direct na `shareAsync`. Op Android komt dat terug zodra het deelmenu sluit, niet als de ontvanger (WhatsApp, Gmail) het bestand gelezen heeft.
10. **Teksten noemen de iPhone en Apple.** Over ("zolang Apple hem in de App Store toelaat"), Privacy ("De iPhone-app gebruikt geen cookies"), de webapp ("Gebruik hiervoor de app Clubalmanac op de iPhone", `NotOnWebScreen`) en de uitnodigingsmail ("Geen iPhone? …", App Store-knop). Invariant 1 ("teksten gelijk") botst daarmee. Zie B8.
11. **Het filmproject behandelt Android als iPhone.** `FILM_PLATFORM` is `"ios"` op alles behalve web. Voor 42a is dat goed (de app zonder uploader: geen wifi-schakelaar, "Downloaden kan in de webapp"), maar de lege stand belooft "Nieuwe filmpjes in deze groep gaan ook als origineel mee", wat vanaf Android niet gebeurt. En een dev-build toont "Proef: originelen".
12. **Dev en prod delen één interne testtrack.** Een Play-app heeft één interne track, met één release voor alle testers. Bouwt `dev` net als op iOS voor de winkel, dan krijgen leden een build tegen dev. Zie B9.
13. **Bouwen kost meer dan de JDK.** Naast JDK 17 (~0,3 GB) haalt een Android-build het SDK-platform (compileSdk 37), build-tools, de NDK (27.1, ~1–2 GB) en Gradle-caches (2–4 GB): samen ~4–6 GB. Er staat 34 GB vrij.
14. **Account verwijderen via een webadres hoeft de webapp niet te kunnen.** Play eist een webpagina waar een lid verwijderen kan *aanvragen*; een openbare pagina met de stappen (in de app, of een mail aan het bekende adres) en wat er weggaat, volstaat. En pas voor productie (zie §Play).
15. **Kleinere verschillen.** De fotokiezer van Android kiest hooguit 100 per keer (`MediaStore.getPickImagesMaxLimit`), iOS onbeperkt. Op Android volgt Google Maps het donkere thema niet vanzelf. `app.json` heeft geen Android-icoon (iOS gebruikt een `.icon`-bestand). Back-up naar Google Drive staat standaard aan (`android.allowBackup`).

### Antwoorden op de open vragen

**1. Oude app op Android.** v1 had in `app.json` `android.package: "com.wintvelt.clubalmanacapp"` en een `adaptiveIcon`; `eas.json` bouwde voor Android een APK (`buildType: "apk"`), maar had geen `submit`-config voor Android. Eén commit "some fixes for android" (feb 2023: autofill van het codeveld uit, een plaatje op het inlogscherm, een `BlurView`). Geen Android-eigen menu's (v1 gebruikte eigen JS-modals), geen Maps-sleutel (de kaart kon op Android dus niet werken), `userInterfaceStyle: light`. Of die pakketnaam ooit in Play stond, staat niet in de code: Wouter weet het (B7).

**2. Foto's en plaats.** Gelezen in de code, nog niet gemeten:
- `expo-image-picker` gebruikt op Android de fotokiezer van het systeem (`PickVisualMedia`; op Android 4.4–10 via Google Play-diensten). Met `quality: 1` kopieert hij het bestand byte voor byte en leest de EXIF met `ExifInterface`. `GPSLatitude`/`GPSLongitude` komen als graden **met teken** (uit `getLatLong`), plus `GPSLatitudeRef` als tekst; `DateTimeOriginal` als `"JJJJ:MM:DD UU:MM:SS"`, zoals iOS. `assetId` is het MediaStore-id.
- **De plaats is altijd weg bij de standaardkiezer**, ook met `ACCESS_MEDIA_LOCATION`. MediaProvider (AOSP `main`): een URI van de fotokiezer (`content://media/picker/…`) wordt altijd geredigeerd ("force redact location metadata"), en `setRequireOriginal` op zo'n URI gooit `UnsupportedOperationException`. De GPS-bytes worden overschreven: de velden kunnen weg zijn, `NaN` geven, of 0/0 (zoals WP36 zag).
- **Alleen via `ACTION_GET_CONTENT`** (in `expo-image-picker` de optie `legacy: true`) kan de plaats blijven: als de fotokiezer die intent afhandelt, krijgt de app `content://media/picker_get_content/…`, en dan beslist `ACCESS_MEDIA_LOCATION` of de plaats blijft. Of de fotokiezer of de app Bestanden opent, of het meerdere tegelijk kan, en of `ACCESS_MEDIA_LOCATION` zonder andere fototoegang een vraag aan het lid toont of stil wordt toegekend: alleen te meten (spike S1).
- **Play:** `ACCESS_MEDIA_LOCATION` valt niet onder het Photo and Video Permissions-beleid (dat gaat over `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`). Brede toegang tot de galerij wel: alleen voor apps waarvan het beheren van alle foto's de kern is (galerij-apps); Clubalmanac valt daar vrijwel zeker buiten. Zekerheid: hoog voor de regel, middel voor "geen verklaring nodig voor `ACCESS_MEDIA_LOCATION`".
- **HEIC/HEIF en stand:** de kiezer geeft het origineel; `toUploadJpeg` laat `expo-image-manipulator` decoderen via Glide (HEIF vanaf Android 9). Glide zet een JPEG rechtop volgens de EXIF; voor HEIC is dat te meten (fixtures `tests/fixtures/wp25/g6.heic`, `wp36/staand-6.jpg`). Het resultaat is een JPEG zonder EXIF, dus zonder GPS (WP17d blijft).

**3. De video-module.** Zie draftpunt 5: importeren is veilig, niets crasht. Zonder moet de app kunnen: filmpjes kiezen (42a: niet aanbieden), verkleinen, omslag maken, `pickerOnScreen` (zie draftpunt 7), de uploader en de proefschermen voor originelen. Filmpjes bekijken gebruikt `expo-video`, niet de module.

**4. Menu's en bevestigingen.** Per plek wat Android moet tonen: zie A1 en A2. React Native heeft geen ingebouwd Android-menu met een lijst opties; B kiest hoe (een Material-blad onderaan of een pop-upmenu). De bevestigingen kunnen `Alert.alert` blijven (twee knoppen), mits ze te sluiten zijn (A2). Knoppen in een Android-dialoog staan in hoofdletters en in de accentkleur van het thema; zonder instelling is dat de standaardkleur van Android, niet die van de app.

**5. Inloggen.** De code-login is gewone Clerk-JS (`signIn` met `email_code`), dezelfde als op iOS; `expo-secure-store` gebruikt op Android de Keystore en sluit zijn eigen gegevens standaard uit van de back-up (plugin `configureAndroidBackup`). `keychainAccessible` doet op Android niets. De code in het veld: `autoComplete="one-time-code"` wordt op Android de hint `sms-otp`; die vult alleen sms-codes, geen mail. Het lid kopieert de code in de mail-app (lang drukken; Gmail toont bij sommige code-mails een knop om te kopiëren, niet gemeten), en Gboard biedt het gekopieerde aan boven het toetsenbord; `normalizeLoginCode` laat spaties en streepjes al weg. Uitloggen en account verwijderen wissen via dezelfde JS (WP29). Demo-account met `+clerk_test` en 424242 werkt ook voor de keuring van Play.

**6. Delen, kaart, films, toetsenbord.**
- *Delen:* `expo-sharing` opent de Android-kiezer met het bestand via een FileProvider; werkt, behalve het moment van wissen (draftpunt 9). Op Android staat er geen "Bewaar afbeelding" zoals op iOS, tenzij een app (Google Foto's) dat aanbiedt.
- *Kaart:* `react-native-maps` gebruikt op Android de Maps SDK en heeft een sleutel nodig in de build; zonder sleutel crasht het openen van de kaart. De Maps SDK is onbeperkt gratis, maar vraagt een Google Cloud-project met betaalaccount (B3). Markers met een foto (`tracksViewChanges`) zijn op Android zwaarder; meten met een album met veel plekken. Donker thema: een eigen kaartstijl, anders blijft de kaart licht.
- *Films:* `expo-video` speelt de ondertekende S3-link (mp4) op Android, met een eigen schermvullende speler; terug sluit hem. Geen extra rechten (geen achtergrondafspelen).
- *Toetsenbord:* `keyboardByWindow` is alleen iOS; op Android doet `KeyboardAvoidingView` (padding) het werk. Met edge-to-edge (standaard aan in SDK 58) verschuift Android het venster zelf niet meer. Meten op de inlog-, uitnodig-, groeps- en verwijderschermen.
- *Webview-schermen:* er zijn er geen; Info is gewone tekst, contact gaat via `mailto:`.

**7. Play-verplichtingen.** Zie §Play hieronder.

**8. Gate: emulator of telefoon.** Zie §Gate hieronder.

### A-invarianten (42a)

**A1. Menu's werken op Android.** Elk menu uit draftpunt 1 opent op Android als Android-menu, met dezelfde opties, volgorde en teksten als op iOS; de titel (naam van het lid, "Status") blijft. Sluiten zonder keuze (terugknop, ernaast tikken, vegen) doet niets. Verwijderen, melden, lid verwijderen, groep verlaten en profielfoto weghalen zijn herkenbaar als gevaarlijk. Verdwijnt de foto van een open menu, dan sluit het menu, zonder fout. Nergens een tik die crasht.

**A2. Bevestigingen sluiten zoals op Android.** Elke bevestiging is te sluiten met de terugknop of door ernaast te tikken, en dat telt als Annuleren: er gebeurt niets, en een wachtende actie (één tegelijk, "Bezig…") komt vrij. Annuleren links, de actie rechts. Geldt ook voor de vier die nu niet te sluiten zijn.

**A3. De terugknop doet wat het lid verwacht.** Tijdens een ronde op het toevoegscherm sluit terug het scherm niet (zoals iOS: geen veeg, geen Sluiten). In selectie (album, Mijn foto's) sluit terug eerst de selectie, de tweede keer het scherm. Een modaal (Nieuwe groep, Uitnodigen, Nieuw album, Filmproject starten, album kiezen) sluit met terug zoals met ×. Een film sluit met terug. Voorspellend terug (`predictiveBackGestureEnabled`) blijft uit, de standaard van Expo, zolang A3 daarmee niet bewezen werkt.

**A4. Datum kiezen op Android.** Het filmproject toont de gekozen dag als veld; tikken opent de datumkiezer van Android, met dezelfde eerste en laatste dag als op iOS. Hij gaat niet vanzelf open en niet opnieuw na een keuze. Annuleren laat de dag staan. iOS houdt het wiel.

**A5. Datum en plaats uit de EXIF, ook van Android.** `X-Taken-At` uit `DateTimeOriginal`, zoals de iPhone-app (geen `CreateDate`, geen "vandaag"). Plaats alleen met breedte én lengte, eindig en binnen bereik, met het teken goed (Android geeft graden met teken, en de richting erbij mag het teken niet nog eens omdraaien). **0/0 is geen plaats**, op elk platform: dat is wat de redactie van Android achterlaat. Dit verandert de iPhone-app alleen voor een foto op precies 0/0, die een iPhone niet maakt; de webapp doet het al (WP36 U3). Een foto zonder plaats komt binnen zonder plaats, met zijn datum.

**A6. De kiezer op Android.** In 42a alleen foto's, en de teksten noemen dan geen filmpjes ("Kies foto's", zoals de webapp). Geen vraag om toegang tot foto's, tenzij B4 er één kiest. Een fout van de kiezer zegt nooit "Toegang tot je foto's nodig" of "Instellingen openen", maar dat ophalen mislukte (zelfde tekst als iOS daarvoor). De teller "Je keuze ophalen…" begint pas als de kiezer dicht is. Meer dan 100 foto's gaat in meerdere keren ("Meer selecteren"); de kiezer van Android houdt de grens zelf bij. De profielfoto: kiezen en vierkant bijsnijden met de bijsnijder van Android, zonder EXIF, zonder "Instellingen openen".

**A7. Delen komt aan.** Het bestand bestaat nog als de ontvangende app het leest, ook als die er even over doet; tijdelijke deelbestanden verdwijnen later (bv. bij een volgende keer delen of bij de start), en nooit blijft er een bestand met GPS achter. Rechtop en zonder GPS zoals WP17d.

**A8. De kaart werkt op elke Android-build die een lid of de gate krijgt.** Zelfde clusters, pins en "zonder locatie" als iOS; locatie zetten, verslepen en weghalen werkt. Een grijze kaart of een crash bij openen is een fail. In donker thema geen felwitte kaart (als B3 een donkere stijl kiest). De sleutel staat niet in de repo als geheim; wel beperkt tot de app (pakketnaam en certificaten).

**A9. Alleen de rechten die nodig zijn.** In het samengevoegde manifest van een release-build: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `VIBRATE`, en de oude opslagrechten met `maxSdkVersion="32"` die de pakketten meebrengen. Niet: `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `CAMERA`, `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW` (staat in het Expo-template), `FOREGROUND_SERVICE*`, locatie. `ACCESS_MEDIA_LOCATION` alleen als B4 dat kiest. Audit leest het manifest van de build.

**A10. Een back-up brengt niemand mee.** Een nieuwe telefoon die de back-up van een oude terugzet, start uitgelogd, zonder beelden, laatste album of laatste groep van de vorige user.

**A11. Het filmproject op Android is de app zonder uploader.** Zoals de iPhone zonder uploader (start voor de oprichter, "Downloaden kan in de webapp", terugtrekken van een eigen inzending), maar geen tekst die belooft dat filmpjes van dit toestel als origineel meegaan, en geen proefscherm voor originelen.

**A12. Dev en prod niet door elkaar.** Een lid krijgt via Play nooit een build tegen de dev-deployment (B9).

**A13. iOS en web blijven gelijk.** De bundle-id, het iOS-icoon, `ascAppId`, de iOS-profielen in `eas.json` en het gedrag op iOS en web veranderen niet, behalve A5 (0/0) en wat B8 kiest. Een Android-pakketnaam is los van de bundle-id.

**A14. Scherm en letters.** Edge-to-edge: niets onder de status- of navigatiebalk, met gebarennavigatie én met drie knoppen; de tabbalk staat boven de systeembalk. Grote letters tot 200% (Android 14+ schaalt niet-lineair): knoppen, tabbalk, menu's en dialogen blijven leesbaar en bruikbaar. Het toetsenbord dekt het veld en de knop eronder niet af. Donker thema volgt het systeem, ook in menu's, dialogen en de datumkiezer.

### Pariteit-checklist (Android, per scherm)

| Scherm | Op Android anders dan nu op iOS | Waar |
|---|---|---|
| Inloggen | Code plakken, geen Mail-suggestie | vraag 5 |
| Groep, leden | Menu bij een lid | A1 |
| Groepsbeheer | Cover-menu, bevestigingen | A1, A2 |
| Album, Mijn foto's | Terug sluit eerst de selectie; foto-menu | A1, A3 |
| Foto-detail | Foto-menu, delen, bevestigingen | A1, A2, A7 |
| Toevoegen | Alleen foto's, teller, fouttekst, terug tijdens ronde, max 100 per keer | A3, A5, A6 |
| Kaart, locatie | Google Maps, sleutel, donker, bevestiging weghalen | A2, A8 |
| Profiel | Profielfoto-menu, bijsnijden, account verwijderen | A1, A6 |
| Meldingen, ideeën (beheer) | Bevestigingen, status-menu | A1, A2 |
| Films | Speler schermvullend, terug | A3 |
| Filmproject | Datum, lege stand, geen proefscherm | A4, A11 |
| Financieel (WP41) | Niets bekend; meenemen in de gate | gate |
| Info | Teksten met iPhone/Apple | B8 |

### Play: wat wanneer nodig is

Stand 2026-11-25, uit de Play Console Help (antwoorden 9845334, 14151465, 13628312, 10841920, 13205715, 10787469, 13327111, 10144311, 11926878, 14115180) en developer.android.com/guide/practices/page-sizes. Zekerheid: **hoog** = letterlijk zo op de actuele pagina; **middel** = afgeleid of de pagina zegt het niet per track.

| Regel | Interne test | Productie | Zekerheid |
|---|---|---|---|
| Developer-account ($25 eenmalig), organisatie: D-U-N-S, identiteit en organisatiedocument, website geverifieerd via Search Console, telefoon en mail met code | nodig (het account zelf) | nodig | hoog |
| Gesloten test met 12 testers, 14 dagen | geldt niet | geldt alleen voor persoonlijke accounts na 13-11-2023; niet voor een organisatie | hoog |
| Pakketnaam vast na de eerste upload | ja | ja | hoog |
| AAB met Play App Signing (EAS beheert de upload-sleutel); eerste upload met de hand in de Play Console | ja | ja | hoog (signing), middel (eerste upload met de hand, EAS-docs) |
| Target API 36 (sinds 31-08-2026; uitstel liep tot 01-11-2026). Expo 58 / RN 0.88: target 36, compile 37 | ja | ja | hoog (regel), middel (ook voor de interne track) |
| 16 KB-pagina's: verplicht voor apps met target 35+; vanaf 01-02-2027 weigert Play updates zonder | controleren | controleren | hoog (regel); RN 0.88 voldoet, de native bibliotheken (Maps, beeld) controleert B met `zipalign -c -P 16` |
| Tot 100 testers per e-maillijst, met een Google-account; opt-in-link; misschien geen keuring | ja | — | hoog |
| Data safety-formulier, met de vragen over verwijderen en de link naar de verwijderpagina | vrijgesteld | nodig | hoog |
| Verwijderen van account in de app én via een webpagina (aanvragen mag) | in de app is er al (WP29) | webpagina nodig | hoog (regel), middel (mail-aanvraag volstaat) |
| Privacyverklaring op een openbaar adres | niet nodig | nodig; `app.clubalmanac.com/info/privacy` is openbaar (route voor uitgelogd), tekst bijwerken (B8) | middel |
| Store listing (naam, beschrijvingen, icoon 512, feature graphic 1024×500, 2–8 schermafbeeldingen), contentclassificatie, doelgroep, advertenties: nee, app-toegang (demo-account) | tijdelijke naam mag | nodig | hoog |
| Verklaring foto/video-rechten | niet nodig zonder `READ_MEDIA_*` (A9) | idem | hoog |
| Verklaring foreground service | niet in 42a | 42c (zie richting) | hoog |
| Keuring | interne tests "might not be subject to" keuring | keuring; voor een nieuw account vaak dagen | middel |

**Organisatie-account (B5).** Vraagt: een D-U-N-S-nummer (gratis bij Dun & Bradstreet; aanvragen kan tot 30 dagen duren; een bedrijf uit het KvK-register heeft er vaak al een (niet zeker), dus eerst opzoeken; is het Apple-account een organisatie-account, dan bestaat het nummer al), een officieel document van de organisatie en een identiteitsbewijs, een website die Wouter in Google Search Console als eigenaar bevestigt (clubalmanac.com via DNS in Route 53, of een bestand op app.clubalmanac.com), en een telefoonnummer en mailadres die openbaar worden. **Publiek op Play:** de juridische naam, het D-U-N-S-nummer, het juridische adres (uit het Google-betaalprofiel), het ontwikkelaarsadres voor mail en het telefoonnummer. Is dat adres een huisadres, dan staat het op Play. Een manier om het type account achteraf om te zetten heb ik niet gevonden (middel): kies het goed bij het aanmaken. **Productie zonder gesloten test: ja.** Wel de volledige app-instelling uit de tabel en een keuring. Doorlooptijd: D-U-N-S tot 30 dagen, de verificatie daarna enkele dagen (niet gemeten; middel). De emulator-gate wacht er niet op.

### Spike S1: plaats bij Android (voor B4)

Doel: weten of de plaats van een foto mee kan zonder brede toegang, en hoe dat er voor het lid uitziet. Op de emulator (Android 36, image met Play) met een dev-build, door B of regie; A bouwt niets.

1. Zet `tests/fixtures/wp36/staand-6.jpg`, `omgekeerd-3.jpg`, `nul-gps.jpg`, `staand-8.jpg` en `tests/fixtures/wp25/g6.heic` in `/sdcard/DCIM/Camera` en laat de mediascanner kijken (WP36 vraag 7). Plus één foto van de camera-app van de emulator.
2. Laat de dev-build per gekozen foto tonen of loggen: `exif.GPSLatitude`, `GPSLongitude`, `GPSLatitudeRef`, `GPSLongitudeRef`, `DateTimeOriginal`, `width`/`height`, `mimeType`, `assetId` en de vorm van de bron-URI. Niet de foto zelf.
3. Vier varianten: (a) de kiezer zoals nu; (b) idem met `ACCESS_MEDIA_LOCATION` in het manifest en toegekend (`adb shell pm grant <pakket> android.permission.ACCESS_MEDIA_LOCATION`); (c) `legacy: true` (`ACTION_GET_CONTENT`) zonder dat recht; (d) `legacy: true` met dat recht. Bij (b)/(d) ook: toont een gewone aanvraag van het recht een vraag aan het lid, en welke?
4. Noteer per variant: plaats (echt, 0/0, `NaN`, weg), datum, welk scherm opent (fotokiezer of Bestanden), of meerdere tegelijk kan en tot hoeveel, en de stand van `staand-6` en `g6.heic` na `toUploadJpeg`.
5. Upload in de beste variant één foto naar dev: de plaats staat bij de foto en op de kaart, en `groot`/`klein` hebben geen GPS (zoals de WP17d-controle).

Verwachting uit de broncode: (a) en (b) zonder plaats; (d) met plaats als de fotokiezer `GET_CONTENT` afhandelt. Wat de 3–4 telefoons van de leden doen (Samsung, oudere Android) laat de emulator niet zien: hun Android-versie en merk navragen (B1).

### Gate: emulator of telefoon

- **Emulator** (Claude met `adb`): alles uit de acceptance behalve wat hieronder staat. Terugknop (`input keyevent KEYCODE_BACK`), gebarennavigatie en drie knoppen, donker thema (`cmd uimode night yes`), letters 200% (`settings put system font_scale 2.0`), smal en liggend, de fotokiezer met de fixtures, de kaart (het image heeft Google Play-diensten), delen naar een app op de emulator, films, inloggen met de code (plakken), uitloggen en account verwijderen. Het manifest (A9) en 16 KB lezen uit de gebouwde APK. Installeren via de interne track kan met een Google-account op de emulator.
- **Alleen op een echte telefoon:** echte camerafoto's (HEIC bij Samsung, Ultra HDR, bewegende foto's), de fotokiezer en het thema van Samsung, snelheid en geheugen in het album van 540 foto's en op de kaart, de code uit Gmail kopiëren en plakken met Gboard, mobiel netwerk, trillen, de installatie via de opt-in-link van Play. Wouter heeft geen Android-toestel (WP36): dat doet een lid met de prod-build (B9).
- **Daarna iOS:** een iOS-build op TestFlight, de bestaande iOS-gate in kort: menu's, bevestigingen, datum, toevoegen, kaart, delen.

### Keuzes voor Wouter (aangescherpt door A)

- **B3. Kaart op Android.** (a) Google Maps: zelfde code; de Maps SDK is onbeperkt gratis (prijspagina Google Maps Platform, nov 2026), maar Wouter maakt een Google Cloud-project met betaalaccount (creditcard) en een sleutel, beperkt tot Android-apps met de pakketnaam en de SHA-1 van twee certificaten: dat van Play App Signing (installaties via Play) en de upload-sleutel van EAS (builds via `adb`). Een budgetwaarschuwing op €1 kost niets. Daarbij: (a1) een donkere kaartstijl in donker thema (iets meer werk, zoals iOS), of (a2) de kaart altijd licht. (b) OpenStreetMap: een andere kaartbibliotheek of een webview met Leaflet (nieuwe afhankelijkheid), plus de gebruiksregels van de OSM-tegelservers. **Advies: (a) met (a1).**
- **B4. Plaats bij foto's.** Na spike S1. (a) Accepteren dat de plaats op Android ontbreekt, zoals in de webapp (WP36 B1); de datum komt wel mee. (b) Werkt variant (d) van S1, met dezelfde kiezer en hooguit één vraag aan het lid: de kiezer via `GET_CONTENT` met `ACCESS_MEDIA_LOCATION`; geen verklaring bij Play verwacht. (c) Toegang tot de hele galerij: Play-verklaring, vrijwel zeker afgewezen. **Advies: S1 eerst; dan (b) als hij werkt, anders (a). Nooit (c).**
- **B5. Besloten: organisatie-account.** Advies voor de volgorde: nu het D-U-N-S-nummer opzoeken of aanvragen (langste doorlooptijd), en vertellen of het Apple-account een organisatie-account is; de emulator-gate loopt intussen door; daarna de interne track; productie als de pagina's uit §Play klaar zijn.
- **B6. Bouwen.** Lokaal met `eas build --platform android --local`: JDK 17 plus ~4–6 GB voor SDK, NDK en caches (draftpunt 13); de sleutels van EAS werken ook lokaal. Of in de EAS-cloud: 15 Android-builds per maand gratis, in een trage rij (expo.dev/pricing, nov 2026). Uploaden naar Play kan met de hand in de browser; dan is geen serviceaccount nodig. **Advies: lokaal, cloud als uitwijk.**
- **B7. Pakketnaam.** Blijvend, en zichtbaar in de Play-link. v1 had `com.wintvelt.clubalmanacapp` (geen spoor dat die in Play stond). Stond hij wel in Play, op welk account dan ook: niet opnieuw gebruiken, tenzij via dat account. **Advies: `com.clubalmanac.app`** (het eigen domein, past bij een organisatie-account), of `com.wintvelt.clubalmanac`.
- **B8 (nieuw). Teksten met iPhone en Apple.** (a) Overal neutraal: "de app", "zolang de app in de App Store en Google Play staat", "de app gebruikt geen cookies"; dat verandert ook de tekst op iOS en web. (b) Per platform een eigen tekst. De webapp-zin "Gebruik hiervoor de app Clubalmanac op de iPhone" en de uitnodigingsmail ("Geen iPhone? …", een Play-link) pas als de app in Play te koop is, in een eigen backend-cyclus. **Advies: (a) voor de info-teksten in 42a; de mail en de webapp-zin later.**
- **B9 (nieuw). Dev-builds op een telefoon.** Eén interne track geeft alle testers dezelfde build. (a) Dev alleen op de emulator (APK via `adb`); de interne track alleen voor prod-builds, en de gate op een echte telefoon doet een lid met de prod-build. (b) Een tweede Play-app (`….dev`) voor dev-builds, met eigen track en lijst. (c) "Intern delen van apps" van Play: een link per build, maar de tester moet een verborgen instelling in de Play Store aanzetten. **Advies: (a).**

### Tests (A)

| Bestand | Wat |
|---|---|
| `app/tests/androidExif.test.ts` (nieuw) | A5 op `metadataHeaders` (`src/lib/upload.ts`) met EXIF zoals de Android-kiezer hem geeft: graden met teken en richting, zuid/west niet dubbel omgedraaid; 0/0 (ook zonder richting, ook `-0`, ook als tekst) geeft geen plaats maar wel de datum; `NaN` geen plaats; alleen breedte of alleen lengte 0 is wel een plaats. Rood: 0/0. |
| `app/tests/videoModuleAbsent.test.ts` (nieuw) | Draftpunt 5, acceptance: `modules/clubalmanac-video` laadt zonder native module (zoals op Android): niets beschikbaar, `pickerOnScreen` `null`, stoppen en wissen lukken stil, luisteren geeft een lege afmelder. Een bewaker, nu groen. |

Niet in unit-tests (gate en audit): menu's, bevestigingen en de terugknop (A1–A3), de datumkiezer (A4), de kiezer en zijn teller (A6), delen (A7), de kaart (A8), het manifest (A9), back-up (A10), scherm en letters (A14). Teksten (B8) pas na het besluit.

### Richting 42b en 42c (niet voor 42a)

- **42b:** verkleinen met Media3 Transformer (AndroidX) of een bibliotheek; datum uit `MediaMetadataRetriever`. De fotokiezer haalt ook bij filmpjes de plaats weg; de backend weigert een filmpje mét plaats al (WP37).
- **42c:** WorkManager met een langlopende worker draait als foreground service van het type `dataSync`: Play vraagt dan een verklaring met video, en Android 15 begrenst `dataSync` op 6 uur per 24 uur. Alternatief vanaf Android 14: een door de gebruiker gestarte overdracht (user-initiated data transfer job). Kiezen bij de kickoff van 42c. Zekerheid: middel.
