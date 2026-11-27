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
- **B5.** Play wordt een **organisatie-account** (bedrijfsaccount), niet persoonlijk. Testers zoeken voor een gesloten test lukt niet. Wat dat account vraagt en wat het oplevert: zie A §Play, "Organisatie-account". Het D-U-N-S-nummer van Inc. Management B.V. bestaat al; Wouter maakt het account aan.
- **B2.** Opknippen in 42a, 42b en 42c.
- **B3.** Google Maps, met een donkere kaartstijl in donker thema (a1). Wouter maakt het Google Cloud-project en de sleutel; tot dan werkt B zonder sleutel (lege kaart op de emulator is verwacht).
- **B4.** Eerst spike S1. Werkt variant (d), dan die; anders ontbreekt de plaats op Android, zoals in de webapp. Nooit toegang tot de hele galerij.
- **B6.** Lokaal bouwen; de EAS-cloud alleen als uitwijk. JDK 17 komt op de server.
- **B7.** Pakketnaam `com.clubalmanac.app`.
- **B8.** (a): info-teksten overal neutraal ("de app"), ook op iOS en web. De uitnodigingsmail en de webapp-zin pas als de app in Play te koop is, in een eigen cyclus.
- **B9.** (a): dev-builds alleen op de emulator; de interne track alleen voor prod-builds; de test op een echte telefoon doet een Android-lid met de prod-build.
- **B10.** Privacytekst: de alinea "Kaart op het web" in `PRIVACY` (`app/src/content/infoTexts.ts`) wordt vervangen door deze, letterlijk; daarna `node scripts/site/build.mjs` en `site/` mee committen:
  > **Kaart.** De albumkaart haalt de kaart op bij Apple Kaarten (op de iPhone), Google Maps (op Android) of OpenStreetMap (in de webapp). Uit welke stukken kaart er worden opgevraagd, is af te leiden waar de foto's ongeveer liggen. Je naam en e-mailadres gaan niet mee.

  (`lead` = "Kaart.", `text` = de rest.) In de fix-ronde van 42a.

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

**Uitkomst S1 (B, emulator Android 36, 2026-11-25).** Alleen (d) geeft de echte plaats (noord/oost en zuid/west goed); (a), (b) en (c) geven 0/0. De datum klopt overal, alle varianten openen dezelfde fotokiezer met meerdere tegelijk, en de stand na `toUploadJpeg` klopt. `assetId` is in alle varianten `null`. De vraag aan het lid bij (d) is de systeemvraag over "photos and videos" met drie knoppen; "Allow all" geeft alleen `ACCESS_MEDIA_LOCATION`, geen galerij. Upload naar dev: plaats bij de foto, `groot`/`klein` zonder GPS. **Gebouwd: (d)**, volgens B4. Open punten voor de fix-ronde: dubbele foto's door `assetId` `null` (WP18 A-inv. 25 geldt niet), GPS-kopieën in `cache/ImagePicker`, Google Maps in de privacytekst.

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
- **Kaartsleutel verhuisd (2026-11-26):** de sleutel staat nu in het eigen Google Cloud-project "Clubalmanac" (met budgetwaarschuwing €1), in EAS (`production`, `development`) en in `app/.env.local` op de server; build 5 (2.0.2) staat op de interne track en is op de emulator met de nieuwe sleutel getest. **Nog open (Wouter):** als de testers build 5 hebben, in project "Mentoring webapp" de oude sleutel verwijderen, *Maps SDK for Android* uitzetten en het budget "Clubalmanac kaart" daar verwijderen.

## Fix-ronde 42a (regie, na audit 2026-11-25)

Audit: niets blokkerends. Door B in één ronde:

1. **Oudere Android.** Variant (d) is alleen op API 36 gemeten. Meet op een emulator met API 30 of 31 (en zo nodig 33) dezelfde varianten als S1. Regel per versie: eerst de fotokiezer met meerdere tegelijk (A6), dan pas de plaats. Opent `legacy` op een versie de app Bestanden, dan daar geen `legacy` en geen plaats. Ook meten: welke systeemvraag het recht daar geeft.
2. **Dubbele foto's** (`assetId` `null`). Als `assetId` ontbreekt, een vaste sleutel uit de inhoud van het bestand (bv. md5 van de kopie van de kiezer) gebruiken voor "Meer selecteren" en voor de upload-id (WP18 A-inv. 25). iOS ongewijzigd.
3. **GPS-kopieën** in `cache/ImagePicker` weghalen zodra ze niet meer nodig zijn. Ook nagaan of iOS hetzelfde doet; zo ja, daar ook.
4. **Privacytekst**: besluit B10.
5. **`docs/conventions/external-services.md`**: de rechten-zin noemt ook `READ/WRITE_EXTERNAL_STORAGE` tot API 32 (uit `expo-image-picker`, nooit gevraagd).
6. **De vraag om het recht**: op de emulator ook "Select photos" en "Don't allow" doorlopen. Geen eigen uitleg vooraf.
7. **Keuze kwijt na het sluiten van de app** door Android: `ImagePicker.getPendingResultAsync()` op Android oppakken, als dat klein blijft; anders melden.

Niet doen: de sleutelcontrole buiten EAS (audit-nit 5, aanvaard).

**Besluit B11 (Wouter, 2026-11-26).** Op Android 11 blijft de plaats staan die via de app Bestanden meekomt; de app doet niets om hem te krijgen of weg te halen. Punt 7 (keuze kwijt als Android de app sluit) blijft open: vraagt eigen native code, niet in 42a.

**Metingen fix-ronde (B, emulator, 2026-11-26).**

| API | `legacy` opent | plaats met `legacy` + recht | vraag om het recht |
|---|---|---|---|
| 30 | app Bestanden | echt (ook zonder recht en zonder `legacy`) | Allow / Deny |
| 33 | app Bestanden | echt | Allow / Don't allow |
| 34 | fotokiezer, meerdere | 0/0, ook met "Allow all" | Select photos and videos / Allow all / Don't allow |
| 35 | fotokiezer, meerdere | echt | Allow limited access / Allow all / Don't allow |

Dus `legacy` + vraag vanaf API 35. Punt 6: "Allow limited access" opent eerst een systeemscherm en daarna de kiezer, met plaats; "Don't allow" geeft de kiezer zonder plaats; na een tweede weigering vraagt Android niet meer. Bij A-inv. 25: de md5-sleutel hangt aan de bytes van de kopie, dus dezelfde foto vóór en na het toekennen van het recht kan één keer dubbel komen. Aanvaard.

**Mini-fix na audit fix-ronde.** De profielfoto leegt de hele map van de kiezer (`ProfileScreen.tsx`, `keepCopy(null)` → `clearPickerCopies()`), ook als het toevoegscherm open is met een keuze (upload van de profielfoto loopt nog en het lid tikt op de plus). Oplossen: in de profielflow alleen de eigen kopieën weghalen.

## Gate en closeout 42a (regie, 2026-11-26)

- Emulator: alles uit de acceptance door B (S1, fix-ronde, mini-fix); regie: kaart met de echte sleutel (oud en nieuw project), screenshots licht en donker.
- Play: interne track, builds 4 en 5 (2.0.2); build 5 heeft de sleutel uit project Clubalmanac. AAB gecontroleerd: prod-Convex, `pk_live_`, rechten zoals A9.
- Echte telefoon: eerste lid (Samsung, Android 17) installeerde via de opt-in-link en is ingelogd, na het overzetten van zijn e-mailadres (zie `external-services.md` §Auth). Foto toevoegen met plaats en de kaart op zijn telefoon nog niet teruggemeld; dat volgt bij de volgende testronde.
- iOS-gate van de iOS-wijzigingen (menu's, kopieën van de kiezer, profielfoto) gaat mee met de volgende TestFlight-build.
- Open voor 42b: zie §Richting 42b en 42c, en punt 7 van de fix-ronde (keuze kwijt als Android de app sluit).

---

# 42b: filmpjes toevoegen op Android (draft regie, 2026-11-26)

> A → besluiten Wouter → B (met spike S2) → audit → gate op de emulator en bij een Android-lid (prod-build, interne track). Branch `wp42b`. Geen red-team: het privacyrisico zit in één meetbare regel (geen plaats in het bestand), die de backend al afdwingt (WP37 A-inv. 13, 28) en die A en de gate toetsen.

## Productdoel (42b)

Een Android-lid zet een filmpje van hooguit 3 minuten in een album, net zo makkelijk als een foto en net als op de iPhone (WP37): het filmpje wordt op de telefoon verkleind tot 1080p, staat op datum tussen de foto's met poster en duur, speelt overal af en staat op de kaart als de plaats bekend is. Het bestand dat de andere leden krijgen, bevat geen plaats. Lukt verkleinen of uploaden niet, dan ziet het lid dat en kan het opnieuw proberen zonder dubbel filmpje.

## Wat er is (42b)

- **Backend en webapp**: compleet sinds WP37 (aanvraag, PUT naar R2, afronden met strikte mp4-controle, afspeellink, R2-check, backup). Weigert alles behalve mp4 met precies één H.264-beeldspoor, AAC-geluid, de index vooraan, hooguit 180,499 s en 120 MiB, en geen locatie in welke vorm ook.
- **App, iOS**: de lokale Expo-module `app/modules/clubalmanac-video` (Swift, alleen `apple`) leest datum, plaats en duur uit het origineel, verkleint (langste zijde 1920, H.264 ~3,5 Mbit/s, AAC 128 kbit/s, hooguit 30 fps, HDR naar SDR, geen metadata, index vooraan) en maakt de poster. De JS-kant (`index.ts`) is platform-onafhankelijk; `videoModuleAvailable` is false zonder module. Dezelfde module bevat ook de uploader voor originelen (WP38b, `originalUploaderAvailable`), die op Android uit moet blijven (42c).
- **App, Android (42a)**: de kiezer toont alleen foto's (A6); de plaats van een foto komt mee vanaf API 35 (`legacy` + `ACCESS_MEDIA_LOCATION`). De afspeelkant (tegel, filter, detail, delen) werkt al op Android.

## Invarianten (42b)

1. **Hetzelfde filmpje als van een iPhone.** Wat de app uploadt, haalt de bestaande mp4-controle van de backend zonder uitzondering voor Android: H.264 + AAC, langste zijde ≤ 1920, ≤ 30 fps, rond 3,5 Mbit/s, SDR, index vooraan, binnen de grenzen van duur en grootte. De backend verandert niet.
2. **Geen plaats in het bestand of de poster**, in welke vorm ook (`©xyz`, `loci`, metadata-sleutels, metadata-sporen). De plaats gaat alleen als veld naar de backend, zoals bij foto's.
3. **Datum en plaats uit het origineel, vóór het verkleinen**, en alleen als het toestel ze geeft. Zonder datum: geen datum, nooit "vandaag". De datum volgt dezelfde regel als bij de iPhone: de lokale kloktijd van de opname, gelezen als UTC (WP37 A-inv. 14).
4. **Plaats volgt de regel van foto's op Android** (42a): alleen waar de kiezer hem niet weghaalt, zonder bredere toegang dan `ACCESS_MEDIA_LOCATION`. Nooit toegang tot de hele galerij.
5. **Geen stille mislukking.** Verkleinen of uploaden dat mislukt (ook doordat Android de app stopt), geeft een NL-melding en opnieuw proberen zonder dubbel filmpje (WP37 inv. 4, 5).
6. **iOS en web veranderen niet.** De hele testsuite blijft groen; de Swift-module en de iOS-flow blijven zoals ze zijn.
7. **Geen originelen op Android.** De uploader voor originelen (42c) is op Android niet beschikbaar; het filmproject belooft op Android niets (42a A11 blijft).

## Scope (42b)

- **In:** de Kotlin-kant van `clubalmanac-video` (metadata lezen, verkleinen, poster, stoppen), de kiezer op Android met filmpjes, de uploadflow van WP37 op Android, de voortgang en meldingen, een build op de interne track.
- **Bewust niet:** originelen (42c), filmpjes inkorten of bewerken, uploaden vanuit de webapp, wijzigingen in de backend.

## Spike S2 (B, vóór de rest)

Op de emulator (API 35 of 36), met een dev-build en een tijdelijk meetscherm (niet committen):

1. Een paar testfilmpjes op de emulator zetten: liggend en rechtop, 4K/60 fps, HDR (HEVC 10 bit) als dat lukt, met en zonder plaats, langer dan 3 minuten.
2. Per kiezer-variant (zoals S1): komen datum en plaats mee, en in welke vorm (UTC of met tijdzone)?
3. Verkleinen met de gekozen bibliotheek (B10): duur, grootte, bitrate, fps, kleuren bij HDR, en vooral: staat de index vooraan en laat de **eigen mp4-controle van de backend** (`convex/lib`, de functie die WP37 gebruikt) het resultaat door, zonder locatie?
4. Upload van één filmpje naar dev: tegel, afspelen in de app en in de webapp, op de kaart.

Uitkomst in het rapport, in de vorm van de S1-tabel. Werkt de gekozen bibliotheek niet met de backend, dan stopt B en meldt regie.

## Open vragen voor A (42b)

1. **Verkleinen.** Welke bibliotheek haalt invariant 1 op Android: Media3 Transformer (AndroidX), een andere, of iets van Expo? Zet die de index vooraan (de standaard `MediaMuxer` zet hem achteraan), laat ze metadata weg, en zet ze HDR naar SDR (vanaf welke Android-versie)? Hoe groot wordt de app erdoor?
2. **Datum.** Android-camera's schrijven de opnametijd in UTC (`creation_time`, `MediaMetadataRetriever.METADATA_KEY_DATE`), zonder tijdzone. Hoe komen we op de lokale kloktijd (invariant 3)? Zie B11.
3. **Plaats.** Geeft de kiezer bij een filmpje de plaats (`METADATA_KEY_LOCATION`, ISO 6709), per Android-versie, met de regel van 42a? Of haalt de fotokiezer hem bij filmpjes ook weg?
4. **Achtergrond.** Wat doet Android met verkleinen en uploaden als het lid de app wegklikt of het scherm uitgaat? Loopt een upload via `expo-file-system` door (zoals de achtergrond-URLSession op iOS)? Wat ziet het lid na terugkomen? Zie B12.
5. **Module.** Hoe krijgt de module een Android-kant zonder dat `originalUploaderAvailable` waar wordt (invariant 7)? Wat verandert er aan `videoModuleAvailable` en de teksten die nu op Android "alleen foto's" zeggen?
6. **Duur van het verkleinen** op een gewone telefoon voor 3 minuten, en wat het lid in die tijd ziet.
7. **Wat de backend weigert**: welke weigeringen van de mp4-controle kan een Android-bestand in de praktijk raken (`udta` na de index, een `edts`, een extra spoor van Samsung zoals een metadata-spoor), en worden die in de app voorkomen of netjes gemeld?

A rapporteert ook wat hier ontbreekt of niet klopt. Oude code is geen bron.

## Keuzes voor Wouter (42b, draft, advies van regie)

- **B10. Verkleinen met Media3 Transformer van Google (advies)**, in de eigen module, zoals op iOS met Apple's eigen bouwstenen. Gratis, onderhouden door Google, volledige controle over metadata en index. Alternatief: een kant-en-klare bibliotheek (bv. `react-native-compressor`) die beide platforms doet, met minder controle over GPS en de index. A bevestigt of weerlegt.
- **B11. Datum van een Android-filmpje: omrekenen naar de tijdzone van de telefoon bij het kiezen (advies).** Dan staat een filmpje van vanmiddag tussen de foto's van vanmiddag. Alleen een filmpje uit een andere tijdzone (vakantie, thuis geüpload) schuift dan het tijdsverschil op. Alternatief: de UTC-tijd laten staan; dan staat elk Android-filmpje een of twee uur verschoven.
- **B12. Tijdens verkleinen en uploaden: de app open houden, met een duidelijke melding (advies voor 42b)**, tenzij A vindt dat uploaden op de achtergrond met weinig werk kan. Verkleinen kan op iOS ook alleen met de app open. Echte achtergrond-uploads horen bij 42c (originelen).
- **B13. Gate**: de emulator met de testfilmpjes, daarna één Android-lid met de prod-build op de interne track, met een echt filmpje van zijn telefoon (Samsung, Android 17). Dat filmpje komt op prod in een album; het lid kan het daarna verwijderen.

## Risico-assessment (42b)

- **security/privacy: medium.** GPS in videometadata; de backend weigert het al, maar dan mislukt het voor het lid (invariant 2).
- **ops: medium.** Hardware-encoders verschillen per merk; Android kan de app stoppen tijdens verkleinen of uploaden (invariant 5).
- **external deps: medium.** Een nieuwe bibliotheek voor verkleinen; de strikte mp4-controle van de backend (WP37).
- **multi-user/concurrency: laag.** Dezelfde flow als op iOS; niets nieuws gedeeld.
- **data/schema-evolutie: laag.** Geen wijziging in de backend verwacht.

## Cross-refs (42b)

WP37 (filmpjes, mp4-controle, A-invarianten 11–38), WP38b (uploader, niet op Android), WP42a (kiezer, S1, versieregel API 35, fix-ronde punt 7), WP18 (upload-id), WP39 (toevoegscherm).

## Besluiten Wouter (42b, 2026-11-26)

- **B10.** Verkleinen met Media3 Transformer in de eigen module (advies), tenzij A het weerlegt.
- **B11.** Datum: omrekenen naar de tijdzone van de telefoon bij het kiezen (advies).
- **B12.** Tijdens verkleinen en uploaden de app open houden, met een duidelijke melding (advies); achtergrond-uploads alleen als A vindt dat het met weinig werk kan.
- **B13 (gewijzigd).** Geen geplande test op een echte telefoon door regie of Wouter. De gate is de emulator; daarna gaat de prod-build via de interne track naar de testers, en Wouter vraagt hen wat ze zien. Meldingen van testers komen terug als fix-ronde.

## Spec-criticus aanvullingen 42b (A)

> A 2026-11-26. Bronnen: deze spec en WP37, de app (`modules/clubalmanac-video`, `src/lib/videos.ts`, `src/data/videoUpload.ts`, `src/data/pickMedia*.ts`, `AddPhotosScreen`), de backend (`convex/lib/mp4.ts`, `convex/videos.ts`), de Android-code van `expo-image-picker` 58.0.10 en `expo-file-system`, de broncode van Media3 1.9.1 (`transformer`, `muxer`, `effect`; de versie van `expo-video` 58.0.14). **Gemeten** op de emulator `clubalmanac-api35` (Europe/Amsterdam) met een eigen meetapp (niet de app): wat `MediaMetadataRetriever` uit een filmpje haalt, originelen van `MediaMuxer` (dezelfde schrijver als de camera) en verkleinen met Media3 Transformer, en elk resultaat door `inspectMp4`/`videoProblem` en de controle na de index. Bestanden en werkwijze: `tests/fixtures/wp42b/README.md`. Niet gemeten: de kiezer met filmpjes en de app zelf (spike S2), echte camerabestanden, HDR, hardware-encoders.

### Gemeten (emulator API 35)

| Wat | Uitkomst |
|---|---|
| Datum (`METADATA_KEY_DATE`) | UTC: `20261126T174453.000Z` bij een klok van 18:44 CET. Zonder datum in het bestand (`mvhd` 0): `19040101T000000.000Z`. |
| Plaats (`METADATA_KEY_LOCATION`) | MediaMuxer: `+52.3676+004.9041/`, `-33.8688+151.2093/`, `+40.7128-074.0060/`, `-00.5000-000.2500/` (teken goed). Media3: `+52.3676+4.9041/` (lengte zonder voorloopnullen). Een `loci`-blok (AVFoundation-mp4) leest Android niet: `null`. |
| MediaMuxer, index | 2 s: vooraan. 3 min: achteraan (`index_achteraan`). Plaats als `©xyz` (`locatie`). |
| Media3 Transformer, standaard | Muxer is in 1.9.1 Media3's eigen `InAppMp4Muxer`, niet MediaMuxer: index vooraan met 400 KB gereserveerde ruimte (`free`). **Neemt de plaats van het origineel over** (`©xyz`): `locatie`. Geluid zonder wijziging gekopieerd als er niets aan het geluid gevraagd wordt. |
| Media3, metadata weg | `ftyp`, `moov`, `free`, `mdat`, merk `isom`, H.264 + AAC (of zonder geluid): de backend neemt hem aan, ook de route (200). |
| Media3, 3 minuten (30 fps) | Index 131 KB, vooraan. Duur volgens de backend = `METADATA_KEY_DURATION` van de uitvoer (179 978 en 180 280 ms bij invoer 180 071 en 180 349); de schatting van de export (`ExportResult`) zit er ~60 ms onder. 29 s verkleinen op de emulator (software, 192 × 108: zegt niets over een telefoon). |
| Staand filmpje | Media3 codeert liggend (192 × 108) met een draai-matrix van 90°; iOS schrijft rechtop zonder matrix. De backend slaat de maat uit `tkhd` op: liggend. Niets in de app gebruikt die maat (gezocht). |

### Wat niet klopt of ontbreekt in de draft

1. **"De standaard `MediaMuxer` zet de index achteraan"** klopt half: MediaMuxer zet hem vooraan zolang hij in de gereserveerde ruimte past, bij 3 minuten niet. Transformer 1.9.1 gebruikt MediaMuxer niet meer maar Media3's eigen muxer, die het vooraan *probeert* en terugvalt naar achteraan als de index niet past. Geen van beide garandeert het (A15).
2. **Transformer neemt standaard metadata van het origineel over**: plaats (`©xyz`), XMP (een `uuid`-blok *na* de index: de route weigert dat als `geen_mp4`) en `mdta`-sleutels. Met de standaard is elk filmpje met plaats een 422 na de hele upload (A15).
3. **HDR wordt HEVC.** Standaard houdt Transformer HDR; heeft de telefoon een HDR-encoder voor HEVC (de meeste telefoons die HDR opnemen), dan schakelt hij stil over van H.264 naar HEVC (`TransformerUtil.getOutputMimeTypeAndHdrModeAfterFallback`), en de backend zegt `codec`. Alleen omzetten naar SDR voorkomt dat. De emulator heeft geen HDR: dit zien alleen de testers (A15).
4. **Transformer kopieert wat niet hoeft te veranderen.** Geluid dat al AAC is, en beeld dat al H.264 is zonder gevraagde wijziging, gaat ongewijzigd mee. Een origineel met ander geluid (Opus, AMR) geeft dan `codec`; een camerafilmpje van ~17 Mbit/s zonder hercodering geeft `te_groot` (A15).
5. **Media3-versie.** `expo-video` gebruikt Media3 1.9.1. Gradle neemt per onderdeel de hoogste versie: een nieuwere `media3-transformer` tilt ook de speler van `expo-video` stil naar een versie waartegen die niet gebouwd is. Zelfde versie als `expo-video`, en bij een Expo-upgrade samen nakijken. Grootte: ~0,85 MB klassen (transformer, effect, muxer) plus `lottie` (afhankelijkheid van `media3-effect`), vóór R8; geen native code, dus geen 16 KB-kwestie.
6. **B11 (datum)** klopt, met twee aanvullingen. (a) Omrekenen met de regels van de tijdzone van de telefoon *op het moment van opnemen*: een filmpje van juli dat in november gekozen wordt, krijgt +2, niet het huidige +1. (b) De tijd in het bestand is die van het schrijven ervan: bij een bewerkt, geëxporteerd of via WhatsApp ontvangen filmpje is dat de tijd van die bewerking, niet van de opname (zoals de terugval op iOS). Of de camera het begin of het einde van de opname schrijft (verschil hooguit de duur): S2.
7. **De plaats-tekst van Media3** (`+52.3676+4.9041/`) leest de app nu niet (de lezer eist drie cijfers voor de lengte): een filmpje dat een andere app met Media3 maakte, verliest zijn plaats. En 0/0 telt bij filmpjes nog als plaats; 42a A5 zegt: op elk platform geen plaats (A18).
8. **De duur die de app gebruikt.** De app weigert vooraf boven 180,4 s op de duur van het verkleinde bestand, met 100 ms marge tot de grens van de backend (WP37 A-keuze). De schatting van de export zit ~60 ms onder wat de backend meet (gemeten, één encoder); daarmee gaat de helft van de marge op, en bij een andere encoder of 48 kHz geluid kan het verschil groter zijn. Dan komt de 422 pas na de hele upload (A19).
9. **De kiezer kopieert het hele origineel** voordat de app iets ziet (`expo-image-picker` op Android: naar `cache/ImagePicker`, altijd met `.mp4`, ook een `.mov`, `.3gp` of `.webm`), ook een filmpje van 20 minuten of 4K van 1 GB of meer; pas daarna zegt de app "te lang". "Je keuze ophalen…" duurt dan lang, en de sleutel uit de inhoud (42a fix-ronde punt 2) leest het bestand nog een keer. De kopie bevat de plaats en is groot (A23). De uitleg "Langere filmpjes en/of hogere kwaliteit kan een paar minuten duren" staat nu alleen op iOS (A20).
10. **Teksten met "Foto's".** `te_lang` en `te_groot` zeggen "Kort het in Foto's in"; dat is de app van de iPhone. Zie B14.
11. **Staand filmpje** (zie Gemeten): de draai-matrix spelen alle spelers goed af in theorie (ExoPlayer, AVPlayer, Chrome, Safari), maar de poster en de tegel moeten rechtop staan; dat ziet alleen S2 en de gate (A24).
12. **Klein:** elke uitvoer van Media3 heeft ~0,4 MB lege gereserveerde ruimte (onschuldig, telt mee in de grootte). De opgeslagen breedte en hoogte van een staand Android-filmpje zijn liggend; niets toont ze nu, niet aanpassen in 42b.

### Antwoorden op de open vragen

**1. Verkleinen.** Media3 Transformer haalt invariant 1, maar niet met de standaard (draftpunten 1–5): zelf de metadata weglaten, HDR naar SDR (OpenGL; vanaf Android 10, want HDR-video bestaat pas daar), beeld en geluid altijd hercoderen naar H.264 en AAC, hooguit 30 fps, langste zijde 1920, de Media3-versie van `expo-video`. Index vooraan: Media3's eigen muxer, en controleren dat hij er staat. Gemeten: zo ingesteld neemt de backend hem aan, ook bij 3 minuten. B10 blijft staan.

**2. Datum.** Android geeft UTC (gemeten). B11 is goed: omrekenen naar de kloktijd van de telefoon, met zomertijd van de opnamedag (draftpunt 6). `19040101T000000.000Z` is geen datum. De app krijgt van de module de UTC-tijd zoals Android hem geeft, en rekent om in de app (puur, getest; A17). Hermes moet daarbij de lokale tijd van een willekeurig moment goed geven: S2 met de emulator in Europe/Amsterdam (een emulator staat vaak op UTC, dan is niets te zien).

**3. Plaats.** `MediaMetadataRetriever` leest alleen `©xyz`; Android-camera's schrijven dat (gemeten met MediaMuxer). De fotokiezer haalt bij filmpjes de plaats waarschijnlijk op dezelfde manier weg als bij foto's (MediaProvider poetst `©xyz`, `loci` en XMP weg zonder `ACCESS_MEDIA_LOCATION`; uit de broncode, middel), dus dezelfde versieregel: `legacy` + het recht vanaf API 35, de app Bestanden op API 30 en 33 laat hem staan. Wat de kiezer per versie bij filmpjes geeft (echt, leeg, nullen, 0/0): S2 met `tests/fixtures/wp42b/android-muxer-*.mp4` in `DCIM/Camera`.

**4. Achtergrond.** `sessionType: BACKGROUND` van `expo-file-system` is alleen iOS; op Android loopt de upload in het proces van de app. Gaat de app naar de achtergrond, dan bevriest of stopt Android het proces na korte tijd (cached-apps-freezer, geheugen; Samsung stopt vroeg); verkleinen en uploaden stoppen dan ook. Echt doorlopen vraagt een foreground service van het type `dataSync` met een verklaring en video bij Play (42c). Dus **B12 klopt**: app open, scherm aan (keep-awake staat al), met een melding. Na terugkomen: leeft het proces nog, dan een mislukt filmpje met "Geen verbinding…" en opnieuw proberen zonder opnieuw verkleinen (WP37 A-inv. 33); is het gestopt, dan is de keuze weg (42a fix-ronde punt 7, nog open) en kiest het lid opnieuw.

**5. Module.** Een Android-kant van dezelfde module (naam `ClubalmanacVideo`) met alleen de vijf functies van filmpjes (`readMetadata`, `compress`, `cancel`, `makePoster`, `remove`). Dan wordt `videoModuleAvailable` waar en blijft `originalUploaderAvailable` onwaar (die kijkt naar `uploaderSend`): de runner, het proefscherm en het filmproject blijven zoals in 42a (A11). `pickerOnScreen` is niet nodig (Android gebruikt `AppState`). De teksten van `pickMedia.android.ts` gaan van "alleen foto's" naar die van iOS zonder iCloud (A20).

**6. Duur.** Op een telefoon met hardware-encoder verwacht ik voor 3 minuten 1080p ~30–90 s, voor 4K60 of HDR (omzetten via OpenGL) ~1–3 minuten; niet gemeten (de emulator heeft alleen software-codecs). Het lid ziet per filmpje de fase "verkleinen" met een percentage dat loopt (A25), het scherm blijft aan, en de melding van B12.

**7. Wat de backend kan weigeren.** `locatie` (metadata van het origineel, draftpunt 2), `codec` (HDR naar HEVC, of gekopieerd geluid dat geen AAC is), `te_groot` (geen hercodering, of een encoder die ver boven de bitrate gaat), `te_lang` (de schatting van de export, draftpunt 8), `index_achteraan` (de muxer viel terug), `geen_mp4` (XMP na de index, of een gefragmenteerde muxer). Een extra spoor van Samsung of een metadata-spoor komt niet mee: Transformer schrijft één beeld- en één geluidsspoor, en `edts`/`elst` van Media3 leest de backend gewoon (gemeten). Voorkomen in de module (A15); lukt dat toch niet, dan de bestaande NL-meldingen (WP37). Een `locatie`, `codec` of `index_achteraan` van een Android-filmpje is altijd een fout in de module, geen fout van het lid.

### A-invarianten (42b)

**A15. Elk verkleind filmpje haalt de controle, door de instelling, niet door geluk.** Beeld en geluid altijd opnieuw gecodeerd naar H.264 en AAC, ook als het origineel al H.264/AAC is; HDR naar SDR, nooit stil naar HEVC; hooguit 30 fps, langste zijde ≤ 1920 (niet groter maken), ~3,6 Mbit/s; één beeld- en hooguit één geluidsspoor; niet gefragmenteerd; niets uit de metadata van het origineel (geen `©xyz`, `loci`, XMP, `mdta`-sleutels). De index staat vooraan; staat hij er niet, dan gaat het bestand niet de deur uit (reden `comprimeren`, opnieuw proberen kan). Media3 in de versie van `expo-video`.

**A16. Geen plaats in de poster.** De poster (tegel en keuze) is een JPEG zonder EXIF, zoals op iOS.

**A17. Datum (B11).** `X-Taken-At` is de UTC-tijd van Android omgerekend naar de kloktijd van de tijdzone van de telefoon, met de regels van die zone op het moment van opnemen. Geen datum, of `19040101T000000.000Z` / `19700101T000000.000Z`, of iets onleesbaars: geen `X-Taken-At`, nooit vandaag. iOS ongewijzigd: de kloktijd uit `com.apple.quicktime.creationdate` wint, de tijdzone van de telefoon telt daar niet.

**A18. Plaats.** Uit het origineel, vóór het verkleinen, in beide vormen van Android (MediaMuxer en Media3). 0/0 is geen plaats, ook niet met hoogte of als −0; alleen breedte of alleen lengte 0 wel. Leeg of weggepoetst: geen plaats, de datum blijft. Zelfde versieregel als foto's (42a), geen ander recht dan `ACCESS_MEDIA_LOCATION`.

**A19. De duur van de backend.** Voor de weigering vooraf (180,4 s) en `startUpload` gebruikt de app de duur van het verkleinde bestand zoals de backend hem meet (de langste in het bestand), niet de schatting van de export. Een filmpje dat de kiezer op 3:00,3 zet, gaat erin.

**A20. De kiezer op Android.** Foto's en filmpjes in één kiezer, op elke Android-versie, met dezelfde regel voor de plaats als foto's. Teksten als op iOS ("Kies foto's of filmpjes", "… (hooguit 3 minuten) …", en de uitleg dat ophalen bij lange filmpjes even duurt), zonder iCloud en zonder "Instellingen openen". Een filmpje zonder `assetId` krijgt de sleutel uit de inhoud, blijft een filmpje met zijn duur, en hetzelfde filmpje nog eens kiezen telt één keer. Langer dan 3 minuten: weigeren vóór het verkleinen (`te_lang`), op de duur van de kiezer.

**A21. Geen originelen op Android (invariant 7).** De Android-kant van de module heeft geen enkele functie van de uploader; `originalUploaderAvailable` blijft onwaar. Geen nieuwe rechten: geen foreground service, geen `READ_MEDIA_*` (app.json blokkeert ze al; de module vraagt ze niet).

**A22. App open (B12).** Zolang er verkleind of verstuurd wordt: scherm aan, een melding dat de app open moet blijven, de terugknop sluit het scherm niet (42a A3). Komt het lid terug na de achtergrond: elk filmpje heeft een eindtoestand (klaar, of mislukt met een NL-reden en opnieuw proberen), niets blijft eeuwig "bezig", en geen dubbel filmpje (WP37 inv. 4).

**A23. Opruimen.** De kopie van de kiezer (met plaats) gaat weg zoals bij foto's (42a fix-ronde punt 3). Het verkleinde bestand en de posters gaan weg als het filmpje binnen is of een vaste reden kreeg; wat een gestopte app achterliet, bij de volgende start. Stoppen tijdens het verkleinen laat geen half bestand achter.

**A24. Rechtop.** Een staand filmpje staat rechtop in de tegel van de keuze, de tegel in het album en de speler, in de Android-app, de iPhone-app en de webapp (Chrome en Safari).

**A25. Voortgang.** Tijdens verkleinen loopt het percentage zichtbaar op (geen 0% tot het eind), ook bij een filmpje van 3 minuten.

**A26. De prod-build verkleint ook.** De release-build (met R8) is op de emulator getest met een filmpje, vóór hij naar de interne track gaat; een dev-build is niet geminificeerd.

### Spike S2: wat precies meten

Emulator op API 35 en 36 (en voor de kiezer ook 30, 33, 34), **tijdzone Europe/Amsterdam** (`-timezone Europe/Amsterdam` of de instellingen), dev-build met een tijdelijk meetscherm. Per uitkomst een regel in de vorm van de S1-tabel.

1. **Invoer** in `/sdcard/DCIM/Camera` (en de mediascanner laten kijken): `tests/fixtures/wp42b/android-muxer-plaats.mp4`, `-zuid-oost`, `-noord-west`, `-staand`, `datum-nul.mp4`; `tests/fixtures/wp37/hevc.mp4`, `iphone-like.mov`, `location-loci-date.mp4`; een filmpje van de camera-app van de emulator (met plaats als dat kan); een van ~200 s en een van 3:00,3 (`tests/fixtures/wp42b/mklang.swift`); als het lukt een 1080p- of 4K-invoer van 60 fps.
2. **Kiezer** per API-versie en variant (zoals S1): staan filmpjes erin, meerdere tegelijk; per bestand de ruwe datum en plaats die de module geeft (echt, leeg, nullen, 0/0), de duur van de kiezer, en de headers die de app ervan maakt. Verwacht voor `android-muxer-plaats.mp4`: `X-Taken-At` `2026:11:26 18:44:53`, plaats 52.3676/4.9041 waar de versieregel hem laat staan.
3. **Verkleinen** per invoer: tijd, grootte, gemiddelde bitrate, fps, maat en draaiing; dan het bestand met `adb exec-out run-as …` ophalen en door `inspectMp4`, `videoProblem` en de controle na de index halen (zoals in `tests/fixtures/wp42b/README.md`). Plus: de duur die de module meldt tegen de duur van de backend, het 3:00,3-filmpje gaat erin, het filmpje van 200 s wordt vooraf geweigerd zonder te verkleinen, HEVC en 60 fps worden H.264 en 30 fps.
4. **Upload naar dev**: tegel en poster rechtop (ook het staande), afspelen in de Android-app en de webapp, datum tussen de foto's, op de kaart.
5. **Achtergrond**: tijdens verkleinen en tijdens versturen naar het homescherm (30 s en 5 min) en `am kill`; wat het lid ziet bij terugkomst (A22), en wat er in `cache` blijft liggen (A23).
6. **Release-build** één keer (A26).

Werkt een punt van A15 niet met Media3 (bv. de index valt bij 3 minuten 1080p toch achteraan), dan stopt B en meldt regie.

### Alleen de gate of de testers

De emulator heeft software-codecs, geen HDR, geen Samsung en geen echte camera. Alleen bij de testers (B13) te zien, en dus de vragen die Wouter hen stelt:
- Een echt filmpje van de eigen camera, staand en liggend, met plaats aan: komt het erin, staat het rechtop, op de goede tijd tussen de foto's van die dag, op de kaart?
- Een HDR-filmpje (Samsung: "HDR10+-video") en een 4K- of 60 fps-filmpje: erin, kleuren normaal (niet flets of te donker)?
- Hoe lang het verkleinen van een filmpje van 1–3 minuten duurde, en of de telefoon warm werd.
- Wat er gebeurde als ze tijdens het verkleinen of versturen de app even wegklikten.
- Slow-motion en een filmpje dat via WhatsApp binnenkwam (datum).
- Afspelen van hun filmpje op een iPhone en in de webapp (door Wouter).

### Keuzes voor Wouter (42b, aangescherpt door A)

- **B10.** Klopt: Media3 Transformer, maar alleen met de instellingen van A15; de standaard faalt op plaats, HDR en kopiëren (draftpunten 2–4). Geen besluit nodig.
- **B11.** Klopt, met omrekenen op de zomertijd van de opnamedag (A17). Geen besluit nodig.
- **B12.** Klopt: uploaden op de achtergrond kan niet "met weinig werk" (foreground service, Play-verklaring; 42c). Geen besluit nodig.
- **B14 (nieuw). Tekst bij te lang of te groot.** Nu "Kort het in Foto's in en kies het opnieuw" (de app van de iPhone). (a) Overal neutraal, zoals B8: "Kort het eerst in en kies het opnieuw" (verandert ook de tekst op iOS); (b) per platform een eigen tekst. **Advies: (a).**

### Testcontract (A)

Namen en vormen zijn A-keuzes; het hoe is aan B.
- `takenAtFromUtc(value)` in `src/lib/videos.ts`: de UTC-tijd van Android (`20260714T133210.000Z`, ook ISO met `Z`) als `X-Taken-At` in de tijdzone van de telefoon (die van `Date`), of `null`.
- `VideoMetadata` krijgt `utcDate` (Android: de datum zoals `MediaMetadataRetriever` hem geeft; iOS: geen). `videoMetadataHeaders` gebruikt `creationDate` als die er is (iOS), anders `utcDate`.
- `locationFromISO6709` leest ook de vorm van Media3 en geeft bij 0/0 `null`.
- `pickMedia.android.ts`: `PICK_MEDIA_TYPES` met filmpjes; de eigen teksten blijven in `PHOTOS_ONLY_TEXTS` (de naam mag blijven), nu met filmpjes.
- De module: `android` in `expo-module.config.json`, Kotlin onder `modules/clubalmanac-video/android`, `Name("ClubalmanacVideo")`.

### Tests (A)

| Bestand | Wat | Stand |
|---|---|---|
| `app/tests/androidVideoMetadata.test.ts` (nieuw) | A17: `takenAtFromUtc` (UTC van Android naar de kloktijd van de telefoon; zomertijd van de opnamedag, middernacht, andere zones, 1904/1970 en onzin geen datum); `videoMetadataHeaders` met `utcDate` van Android, iOS ongewijzigd. A18: `locationFromISO6709` in de gemeten vormen van MediaMuxer en Media3, 0/0 geen plaats. | 22 rood: `takenAtFromUtc` en `utcDate` ontbreken, de vorm van Media3 en 0/0. Typecheck: alleen die twee. |
| `app/tests/androidVideoPicker.test.ts` (nieuw) | A20 op `pickMedia.android.ts`: foto's en filmpjes op API 30–36; versieregel van de plaats ongewijzigd; teksten noemen filmpjes en 3 minuten, geen iCloud; een filmpje zonder `assetId` krijgt de sleutel uit de inhoud en telt één keer. | 6 rood: `PICK_MEDIA_TYPES` is `["images"]`, de teksten zeggen "Kies foto's". |
| `app/tests/androidVideoModule.test.ts` (nieuw) | A21: met een Android-module zonder uploader `videoModuleAvailable` waar en `originalUploaderAvailable` onwaar; `expo-module.config.json` noemt android; de Kotlin-kant heet `ClubalmanacVideo`, heeft de vijf functies en geen functie van de uploader; app.json blokkeert foreground service en `READ_MEDIA_*`; het manifest van de module vraagt geen rechten. | 3 rood: geen Android-kant. |
| `tests/videos/android.test.ts` (nieuw) | Invariant 1, A15, A19 tegen de backend met de bestanden uit `tests/fixtures/wp42b`: Media3 zonder metadata erin (ook via de route, 200), Media3 standaard en MediaMuxer met plaats `locatie`, MediaMuxer 3 min `index_achteraan`, 3:00,349 → 180 280 ms erin. | Groen (bewaker; de backend verandert niet). |

Niet in unit-tests (S2, gate, audit): de Kotlin-kant zelf (A15, A16, A19, A23, A25), de kiezer met echte filmpjes, de achtergrond (A22), rechtop (A24), de release-build (A26), de teksten van B14.

**Stand na A:** app 31 rood / 2677 groen; backend 3794 groen / 3 overgeslagen (met de 14 nieuwe). Typecheck app: alleen `takenAtFromUtc` en `utcDate` ontbreken.

## Besluiten Wouter na A (42b, 2026-11-26)

- **B10–B13** blijven, met de kanttekeningen van A: Media3 alleen met de instellingen van A15; B11 rekent met de zomer-/wintertijd van de opnamedag; B12 zonder achtergrond-upload (dat is 42c).
- **B14 (a)**, overal, ook op iOS, letterlijk:
  - `te_lang`: "Dit filmpje duurt langer dan 3 minuten. Kort het filmpje in en kies het opnieuw."
  - `te_groot`: "Dit filmpje is te groot, ook na het verkleinen. Kort het filmpje in en probeer het opnieuw."
- **Regie:** de namen in A's testcontracten (`takenAtFromUtc`, `VideoMetadata.utcDate`, `PHOTOS_ONLY_TEXTS`) zijn aanvaard.

## Uitkomst spike S2 en bouw (B, 2026-11-26)

S2 werkt met de backend. Elk resultaat met de instellingen van A15 haalt `inspectMp4`/`videoProblem`. De index staat vooraan, ook bij 3:00 1080p. Er is geen locatie en het is H.264 + AAC. B heeft doorgebouwd (commit 9927222).

**Kiezer** (emulator, Europe/Amsterdam):

| API | kiezer | filmpjes, meerdere | plaats (`©xyz`) | datum |
|---|---|---|---|---|
| 35 | fotokiezer (`legacy` + recht) | ja, 13 tegelijk | echt, alle vier de kwadranten met het goede teken | UTC wordt de kloktijd; juli +2 (Hermes klopt) |
| 36 | fotokiezer (`legacy` + recht) | ja | echt; Amsterdam en Sydney op de kaart | klopt |
| 30 | app Bestanden, chip "Videos" | rijen reageerden niet op adb-tikken | niet gemeten | – |
| 33, 34 | niet gemeten | | | |

**Verkleinen** (API 35):

| invoer | tijd | uitvoer | fps in → uit | backend |
|---|---|---|---|---|
| 1080p30 H.264, 3:00,3 | 51 s | 46 MB, 180 333 ms | 30 → 15,5 | goed |
| 3:00,349 met AAC | 31 s | 5,2 MB, 180 400 ms | 30 → 9 | goed, ook na upload |
| 3:20 | – | vooraf `te_lang` | – | – |
| HEVC 1080p60 | 7 s | 3,3 MB | 60 → 30 | goed |
| 4K60 staand | 8 s | 1080×1920 | 60 → 30 | goed |
| camera-app emulator (720p, AMR) | 2 s | 0,7 MB, AMR → AAC | 29,4 → 29,4 | goed |
| met plaats (`android-muxer-*`) | <1 s | zonder locatie | – | goed |

**Verder gemeten door B:**
- De poster is een JPEG zonder EXIF en staat rechtop.
- Een filmpje met datum-nul geeft geen `X-Taken-At`.
- De upload naar dev werkt voor 9 filmpjes. Tegels en speler staan rechtop, de datum en plaats staan in de backend, de kaart op API 36 toont de pins en het filmproject kreeg geen origineel.
- De release-build met R8 werkt op API 35 en 36. De rechten zijn gelijk aan 42a, 16 KB is in orde en de APK is 40,4 MB.
- Achtergrond: 30 s op het homescherm loopt door. Na 5 min staat het stil, maar het loopt verder na terugkomen, zonder dubbel filmpje.
- Na `am kill` is de keuze weg. Het halve bestand gaat weg bij de volgende start.

**Open na B:**
- Bij zelfgemaakte testfilmpjes en `media3-schoon.mp4` valt op de emulator de helft van de beelden weg, ook zonder effect dat beelden weglaat. Een camerafilmpje houdt wel alle beelden. De oorzaak is onbekend.
- B nam daarom niet `createDefaultFrameDropEffect`, maar een eigen n-de-beeld.
- Bij 3:00,3 is de marge klein: 180 400 ms. Dat is precies de grens van de app.
- Niet gemeten: de webapp (poort 8081 is bezet), de kaart op API 35 (tokenfout van Play-diensten), en de kiezer op API 30, 33 en 34.

## Audit 42b (2026-11-26)

Oordeel: klaar voor de gate. Er is niets blokkerend.
- **M1 (moet).** Media3 schrijft een breedte onder 10° met één cijfer (`%+.4f`, dus bijvoorbeeld `-1.2921+36.8219/`). De regex in `videos.ts:101` eist twee cijfers, dus zo'n filmpje komt binnen zonder plaats. De test "0/0 van Media3" slaagt alleen doordat de regex niet matcht.
- **M2 (moet).** De uitkomst van S2 moet in de spec. Dat is gedaan; zie hierboven.
- **G1 (mag).** Het n-de-beeld springt bij ±31,5 fps naar de helft en houdt geen rekening met tijdstempels. Bij een wisselende beeldsnelheid (Samsung Auto FPS) worden stukken van 30 fps 15 fps. De meting die tegen `createDefaultFrameDropEffect` pleitte, zegt niets: het halveren gebeurde ook zonder effect.
- **G2 (mag).** `OnCreate { VideoFiles.clear(context) }` haalt de context op buiten de try.
- **G3 (mag).** `Mp4Check.kt` kijkt het merk in `ftyp` niet na, en gaat uit van een `moov`-kop van 8 bytes.
- **G4 (mag).** Geen test die de Media3-versie gelijk houdt aan die van `expo-video`.
- **G5 (mag).** De melding "Houd Clubalmanac open…" valt weinig op. Dat oordeelt de gate.
- **G6 (bestaand).** `cancelCompress` wordt nergens aangeroepen, ook niet op iOS.

## Fix-ronde 42b (A)

> A 2026-11-26. Nagekeken in de Gradle-cache: `media3-muxer` 1.9.1 schrijft `©xyz` met `"%+.4f%+.4f/"` (ook de breedte zonder voorloopnul).

**M1 (test, rood).** Een filmpje van Media3 onder 10° breedte (`-1.2921+36.8219/`, `+5.1234+4.9041/`, `+1.3521+103.8198/`) houdt zijn plaats. `+0.0000+4.9041/` en `+5.1234+0.0000/` zijn een plaats: zo staat vast dat `+0.0000+0.0000/` en `-0.0000-0.0000/` geen plaats zijn door de 0/0-regel, niet doordat de vorm niet gelezen wordt. De vormen met twee cijfers (iPhone met hoogte, MediaMuxer) blijven gelijk.

**G4 (test, groen).** De Media3-versie van elke afhankelijkheid in de module is `androidxMedia3Version` uit de `build.gradle` van `expo-video`. Bij een Expo-upgrade die Media3 verhoogt, faalt de test tot de module meegaat.

**G1. Minder beelden: kies wat de meting haalt.** Vergelijk op de emulator `createDefaultFrameDropEffect` met het eigen n-de beeld, met dezelfde invoer:
- een filmpje van de camera-app (30 fps; dat halveerde in S2 niet);
- 60 fps (`hevc` 1080p60 of 4K60 uit S2);
- als het lukt een filmpje met wisselende beeldsnelheid: een stuk van 30 fps en een stuk van 60 fps achter elkaar.

Meet per invoer de fps van de uitvoer, en bij het wisselende filmpje per stuk (uit de tijdstempels in `stts`, niet het gemiddelde). Doel: 30 blijft 30, sneller wordt hooguit 30 (niet minder dan ~24), het stuk van 30 fps in het wisselende filmpje blijft 30. Neem de aanpak die dat haalt; halen ze het allebei, dan `createDefaultFrameDropEffect`. Halveert een zelfgemaakt testfilmpje ook zonder effect, dan telt dat filmpje niet mee voor de keuze (zie "Open na B"). Zet de uitkomst als tabel in de spec.

**G2. Opruimen bij de start mag de module niet laten vallen.** Ontbreekt de context bij `OnCreate`, dan slaat de module het opruimen over (de volgende start probeert het weer) en werkt verder gewoon. Meten: na `am kill` midden in het verkleinen en opnieuw starten is het halve bestand weg (A23, zoals in S2).

**G3. `Mp4Check` zoals de backend.**
- Het hoofdmerk in `ftyp` is een van de merken die de backend aanneemt (`MP4_BRANDS` in `convex/lib/mp4.ts`), en `ftyp` is minstens 16 bytes. Anders gaat het bestand niet de deur uit (reden `comprimeren`).
- Een index (`moov`) met een kop van 64 bits (grootte 1, dan 8 bytes grootte) wordt even goed gelezen als een met een kop van 32 bits: dezelfde uitkomst en duur.

Meten: haal met een tijdelijke meting in de dev-build (of een lokale JVM-test) drie bestanden door `Mp4Check` en door `inspectMp4`/`videoProblem`: `media3-schoon.mp4`; dat bestand met een `moov`-kop van 64 bits; en dat bestand met merk `qt  `. Verwacht: de eerste twee door beide aangenomen met dezelfde duur, de derde door beide geweigerd.

**Stand na A:** app 5 rood (M1) / 2714 groen, typecheck schoon.

## Uitkomst fix-ronde 42b (B, 2026-11-26)

Commit f736dae. App 2719 groen, backend 3794 groen.
- **M1:** een breedte met één cijfer wordt gelezen. 0/0 geeft geen plaats, door de 0/0-regel.
- **G1:** de module gebruikt nu `createDefaultFrameDropEffect(30)`, die naar de tijdstempels kijkt. De fps per stuk komen uit `stts` (emulator API 35):

| invoer | eigen n-de beeld | `createDefaultFrameDropEffect(30)` |
|---|---|---|
| camera-app 29,4 | 29,4 | 29,4 |
| 1080p30 | 30 | 30 |
| 1080p60, HEVC 1080p60 | 30 | 30 |
| wisselend 30 / 60 / 30 | **15** / 30 / **15** | 30 / 30 / 30 |
| wisselend 60 / 24 / 60 | 30 / **12** / 30 | 30 / 24 / 30 |

  Het laatste beeld valt weg (8,00 → 7,97 s). Het halveren dat ook zonder effect optreedt (3:00-testfilmpje, 4K60 staand) blijft onverklaard en geldt alleen voor de emulator. Een echte Samsung met Auto FPS testen alleen de testers.
- **G2:** zonder context slaat het opruimen bij de start over. Gemeten met `am kill`: het halve bestand is bij de volgende start weg.
- **G3:** `Mp4Check` eist het ftyp-merk uit `MP4_BRANDS` en leest een moov-kop van 64 bits. Dat is gemeten naast de backend.
- **Hoofdroute:** de release-build met R8 tegen dev is getest met twee filmpjes (wisselend en 60 fps). Ze zijn verkleind, geüpload en speelbaar.
- **Open:** G5 (de melding "Houd Clubalmanac open" valt weinig op) beoordeelt de gate. G6 (`cancelCompress`) bestond al en hoort niet bij 42b.

## Gate 42b (regie, 2026-11-26)

Gate gedaan op de emulator: API 36, release-build met R8 tegen dev, Europe/Amsterdam. Gekozen: vijf filmpjes, namelijk camera-app, wisselend 30/60/30, 3:20, 4K60 staand en een filmpje met plaats.
- Bij 3:20 staan meteen de tegel "Te lang" en de B14-tekst. Na de ronde staat er "1 filmpje niet gelukt" met dezelfde tekst.
- Tijdens de ronde staan "Houd Clubalmanac open tot de filmpjes klaar zijn." en per tegel "Verkleinen… n%". Dat is goed leesbaar (G5: geen actie).
- De andere vier staan in het album, met poster en duur. Het staande filmpje speelt rechtop af en het filmpje met plaats staat op de kaart.
- **Kleine bevinding, geen actie:** de duur van het camera-app-filmpje staat in de kiezer als 0:06 en in het album als 0:07. Dat komt doordat de kiezer en de backend anders afronden.
- **Alleen de testers kunnen nagaan:** echte camerafilmpjes (Samsung Auto FPS, HDR), hoe lang verkleinen duurt en of de telefoon warm wordt, wegklikken op Samsung, en afspelen op een iPhone en in de webapp.

## Closeout 42b (regie, 2026-11-27)

- PR #67 gemerged. Build 6 (2.0.2, prod) op de interne track; AAB gecontroleerd: prod-Convex, `pk_live_`, de B14-tekst. De naam van dev staat alleen in de regex `DEV_CONVEX_URL` (`originalProbe.ts`).
- Testers gevraagd naar echte camerafilmpjes, hoe lang het duurt, warmte, wegklikken, en afspelen op iPhone en webapp. Een nieuwe tester stond met een ander Google-adres op de lijst (*App not available*); toegevoegd.
- iOS krijgt de B14-teksten met de volgende TestFlight-build.
- Open voor 42c: §Richting 42b en 42c; G6 (`cancelCompress` nergens aangeroepen, ook op iOS) blijft buiten 42b.

## Productdoel (42c)

Zolang een filmproject openstaat, gaat van elk nieuw filmpje dat een Android-lid toevoegt ook het origineel naar de inbox van het project, net als op de iPhone (WP38). Het lid hoeft de app niet open te houden: wegklikken, scherm op slot of de telefoon herstarten mag, en met "Alleen via wifi" wacht het origineel op wifi. Op de projectpagina ziet het lid per eigen inzending de stand (wacht op wifi, wordt verstuurd, binnen). Wouter downloadt het origineel in de webapp, met datum en plaats.

## Wat er is (42c)

- **Backend en webapp**: compleet sinds WP38 (project, `startOriginal` met links per deel, `finishOriginal`, terugtrekken, downloadpagina, na een jaar weg). Platform-onafhankelijk.
- **App, iOS**: de uploader in `clubalmanac-video` (achtergrond-URLSession), de wachtrij op schijf met zijn runner (`originalQueue.ts`, `originalUpload.ts`, `data/originals.ts`, `data/originalsRunner.tsx`), `originalPlan`, `ownOriginalStand`, de instelling "Alleen via wifi" per toestel, en de schermen van 38c. Besluiten 21–26 van WP38 (alle delen meteen klaarzetten, verder na wegvegen, opnieuw verkleinen na terugkomen).
- **App, Android (42a/42b)**: verkleinen en uploaden van het album-filmpje met de app open. `originalUploaderAvailable` is false; het filmproject belooft op Android niets (42a A11). De fotokiezer haalt bij filmpjes de plaats weg, behalve met `legacy` + `ACCESS_MEDIA_LOCATION` vanaf API 35 (42a S1, 42b S2).
- **Open uit 42a**: fix-ronde punt 7, de keuze is kwijt als Android de app sluit terwijl de kiezer open is.

## Invarianten (42c)

1. **Hetzelfde gedrag als de iPhone, met de backend van WP38 ongewijzigd.** Wanneer een origineel meegaat, de stand per inzending, terugtrekken en "Alleen via wifi" volgen de regels van 38b en 38c.
2. **Het origineel is het beste bestand dat de kiezer geeft**, zonder dat de app het verkleint of opnieuw schrijft. Bit voor bit met opnamedatum en plaats waar de kiezer dat geeft (WP38 besluit 10); geeft de kiezer op een Android-versie een kopie zonder plaats, dan gaat die kopie mee (B16).
3. **Doorgaan zonder de app.** Wegklikken uit de recente apps, scherm op slot en herstarten van de telefoon: het origineel komt daarna binnen zonder dat het lid iets doet, of zodra het lid de app opent. Elk deel komt één keer binnen.
4. **"Alleen via wifi" geldt ook als de app dicht is.** Op mobiel internet wacht het origineel; op wifi gaat het verder. Omzetten werkt ook voor wachtende delen.
5. **Geen stille mislukking.** Stopt Android het versturen voorgoed (link verlopen, project dicht, terugtrekken, te weinig ruimte), dan staat dat bij de inzending op de projectpagina. Een origineel dat wacht, staat niet als "wordt verstuurd".
6. **Opruimen.** Kopieën en deelbestanden gaan weg na binnen, na terugtrekken en bij account verwijderen, ook na een herstart midden in het versturen.
7. **iOS en web veranderen niet.** De hele testsuite blijft groen.
8. **De keuze blijft bewaard (punt 7 van 42a).** Sluit Android de app terwijl de kiezer open is, dan staat de keuze na terugkomen in het toevoegscherm, of ziet het lid dat hij opnieuw moet kiezen.

## Scope (42c)

- **In:** de Android-kant van de uploader in `clubalmanac-video`, de wachtrij en runner op Android, "Alleen via wifi" op Android, de teksten en schermen van het filmproject op Android (A11 vervalt), de verklaringen in Play als het gekozen mechanisme die vraagt, punt 7 van 42a, een build op de interne track, het buildnummer bij Info op Android en iOS (B18).
- **Bewust niet:** wijzigingen in de backend of de webapp, meldingen (notificaties) aan het lid, downloaden op de telefoon.

## Spike S3 (B, vóór de rest)

Op de emulator (API 36, en API 34 als het mechanisme per versie verschilt), met een dev-build tegen dev en het proefscherm van 38b op Android. Met een origineel van ~300 MB en een van ~1,5 GB:

1. Upload met de app open, en met de app weggeklikt uit de recente apps, scherm uit, en na een herstart van de emulator.
2. Doze en app-standby: `adb shell dumpsys deviceidle force-idle` en `adb shell am set-standby-bucket <pakket> rare`/`restricted`. Hoe lang wacht het, en gaat het daarna verder?
3. "Alleen via wifi": wifi uit (alleen mobiele data), wachten, wifi aan. Omzetten tijdens het wachten.
4. Geeft de kiezer het origineel bit voor bit? SHA-256 van wat de app krijgt naast die van het bestand op de emulator (`adb shell sha256sum`), per kiezer-variant van S1. Staat de plaats erin?
5. Stoppen met `am force-stop` (zoals Instellingen → Gedwongen stoppen): wat gebeurt er, en wat ziet het lid bij openen?

Uitkomst als tabel in de spec. Haalt het gekozen mechanisme invariant 3 of 4 niet, dan stopt B en meldt regie.

## Open vragen voor A (42c)

1. **Mechanisme.** Welke manier van versturen op de achtergrond haalt invariant 3 en 4 op elke Android-versie die de app ondersteunt: WorkManager zonder foreground service (een job per deel, wifi als voorwaarde), WorkManager of een eigen service als foreground service van het type `dataSync` (Play-verklaring met video; Android 15 begrenst op 6 uur per 24 uur), of een door de gebruiker gestarte overdracht (`user-initiated data transfer`, vanaf Android 14)? Wat vraagt elk aan Play, aan rechten en aan meldingen in beeld? Zie B15.
2. **Origineel.** Geeft de kiezer op Android het bestand bit voor bit, ook met de plaats, per Android-versie en per kiezer-variant? Is er een manier zonder bredere toegang dan `ACCESS_MEDIA_LOCATION` (42a A9)?
3. **Ruimte.** Waar staat de kopie (cache kan Android zelf wissen), en wat als er te weinig ruimte is voor kopie en delen?
4. **Wekken.** Doet de runner op Android ook `finishOriginal` als de app dicht is, of pas bij openen?
5. **Fabrikanten.** Wat doen Samsung en andere merken extra (batterijbeheer, "slapende apps")? Wat is daarvan op de emulator te zien en wat alleen bij de testers?
6. **Punt 7 van 42a.** Hoe groot is `ImagePicker.getPendingResultAsync()` op Android, en past het in de flow van WP39?

A rapporteert ook wat hier ontbreekt of niet klopt. Oude code is geen bron.

## Keuzes voor Wouter (42c, draft, advies van regie)

- **B15. Versturen op de achtergrond: WorkManager zonder foreground service, één job per deel, wifi als voorwaarde (advies)**, tenzij A of S3 het weerlegt. Geen melding die in beeld blijft staan, geen Play-verklaring met video. Nadeel: Android kan een weinig gebruikte app uren laten wachten; voor originelen is dat geen probleem. Alternatief: een foreground service met een vaste melding ("Clubalmanac verstuurt filmpjes"), sneller en zekerder, maar met een verklaring en een video voor Play.
- **B16. Een toestel dat het origineel niet bit voor bit geeft: geen origineel van dat toestel, met een korte tekst (advies).** Alternatief: toch sturen wat de kiezer geeft, zonder plaats.
- **B17. Gate**: de emulator tegen dev met S3 en de acceptance; daarna build 7 via de interne track naar de testers, zoals B13. Op prod moet er dan een filmproject openstaan (Wouter opent er een, of de testers testen alleen dat hun filmpje in het album komt).

## Risico-assessment (42c)

- **security/privacy: medium.** Het origineel houdt bewust de plaats (WP38 besluit 10); alleen de downloader krijgt het. Links per deel zijn 7 dagen geldig.
- **ops: hoog.** Stille mislukking kan: Android stelt achtergrondwerk uit of stopt het (Doze, standby, merken), zonder dat het lid het ziet (invariant 5).
- **external deps: medium.** WorkManager en de achtergrondregels van Android per versie, mogelijk een Play-verklaring, R2 multipart.
- **multi-user/concurrency: medium.** Wachtrij op schijf, verder na herstart, dubbele delen, terugtrekken terwijl een deel loopt.
- **data/schema-evolutie: laag.** Geen wijziging in de backend verwacht.

Setup: A → besluiten → spike S3 → B → audit → red-team → gate op emulator → testers, zoals 38b.

## Cross-refs (42c)

WP38 (38a backend, 38b uploader en besluiten 21–26, 38c schermen), WP42a (A9, A11, S1, fix-ronde punt 7), WP42b (S2, de module op Android), WP37 (album-filmpje), WP39 (toevoegscherm).

## Besluiten Wouter (42c, 2026-11-27)

- **B15.** Advies: WorkManager zonder foreground service, één job per deel, wifi als voorwaarde, tenzij A of S3 het weerlegt.
- **B16 (anders dan het advies).** Geeft de kiezer niet het origineel bit voor bit, dan gaat toch wat de kiezer geeft mee, ook zonder plaats. Wouter: beter een kopie dan een missend origineel; niemand garandeert dat een lid het origineel later nog heeft.
- **B17.** Advies: gate op de emulator tegen dev; daarna build 7 via de interne track naar de testers. Wouter zet op prod een filmproject open zodra die build uit is.
- **B18 (regie, 2026-11-27).** Bij Info staat naast de versie het buildnummer, bijvoorbeeld "Versie 2.0.2 (7)", op Android en op iOS. Build 5 en 6 heten allebei 2.0.2, dus een tester kan niet zien welke build hij heeft. Zonder buildnummer (web, Expo Go): alleen de versie, geen lege haakjes. Een bewuste uitzondering op invariant 7: iOS verandert hier wel.

## Spec-criticus aanvullingen 42c (A)

> A 2026-11-27. Bronnen: deze spec (42a, 42b, 42c) en WP38 (38b-invarianten, besluiten 21–27, 38c); de app (`modules/clubalmanac-video` met de Kotlin-kant van 42b, `src/data/originals.ts`, `src/lib/originalQueue.ts`, `originalUpload.ts`, `filmProject.ts`, `AddPhotosScreen.tsx`, `FilmProjectScreens.tsx`, `pickMedia.android.ts`, `pickerCopies.ts`, `app.json`, `eas.json`); de backend (`convex/filmProjects.ts`, `lib/filmOriginals.ts`, `lib/constants.ts`, `crons.ts`); de Android-code van `expo-image-picker` 58.0.10 en van het register voor activity-resultaten in `expo-modules-core`; WorkManager 2.9.1 uit de Gradle-cache (manifest, en `SystemJobInfoConverter` met `javap`); developer.android.com, opgehaald 2026-11-27: *Power management resource limits* (bijgewerkt 2026-05-19), *User-initiated data transfer*, *Support for long-running workers*, *Android 16 behavior changes*. Niets op de emulator gemeten: wat alleen daar te zien is, staat in S3. Oude code is geen bron.

### Wat niet klopt of ontbreekt in de draft

1. **WorkManager zit al in de app, en zijn rechten zijn geblokkeerd.** `react-native-maps` brengt `androidx.work:work-runtime:2.9.1` mee. Het manifest daarvan vraagt `WAKE_LOCK`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED` en `FOREGROUND_SERVICE`; `app.json` blokkeert de laatste twee (42a A9). WorkManager zet zijn taken bij Android niet blijvend (`setPersisted(false)`, gelezen in 2.9.1) en zet ze na een herstart opnieuw klaar via een ontvanger van `BOOT_COMPLETED`. Zonder dat recht gaat een origineel na een herstart pas verder als het lid de app opent. Zie B19.
2. **Op de achtergrond draait er geen JS.** Start Android de app voor een taak, dan start alleen het proces, niet React Native (middel: zo start Expo de JS pas met een scherm; S3 kijkt het na). De runner, `startOriginal` en `finishOriginal` lopen alleen als de app open is of net was. Gevolgen:
   - de delen gaan op de achtergrond; afronden doet de cron binnen het uur (`film originals complete`, elk uur op :20; A-invariant 9 van WP38);
   - opnieuw aanmelden (403, `NoSuchUpload`, verlopen links, `missing`, de wachttijden van 38b-7) gebeurt pas als het lid de app weer opent, zoals op iOS na wegvegen;
   - de bewaarde kopie (tot 2 GiB) gaat pas weg als de app na "binnen" weer draait (invariant 6). Zie B21.
3. **Een mislukt deel beslist nu JS** (38b-6). Op iOS wekt iOS de app per deel. Op Android is er dan geen JS: de uploader moet een tijdelijke fout zelf opnieuw proberen, met dezelfde grenzen, en de rest laten liggen tot `atLaunch` (A28).
4. **Elke taak heeft een tijdslimiet van 10 minuten**, en de delen zijn 32 MiB (`ORIGINAL_PART_BYTES`). Een deel moet dus met minstens ~56 KB/s (0,45 Mbit/s) gaan. Lopen er vier delen tegelijk over trage hotelwifi, dan haalt geen enkel deel de limiet en begint alles steeds opnieuw (A28). De iPhone kent die limiet niet.
5. **Quota, ook vlak na gebruik.** Volgens de tabel van Android (bijgewerkt mei 2026) mag de app op de achtergrond, zonder lader:

   | Stand van de app (bucket) | Tijd voor gewone taken |
   |---|---|
   | active (net gebruikt) | tot 20 min per 60 min (vanaf Android 16) |
   | working set | tot 10 min per 4 uur |
   | frequent | tot 10 min per 12 uur |
   | rare | tot 10 min per 24 uur |
   | restricted (accu "Beperkt") | 1 keer per dag, 10 min |

   Aan de lader geldt geen grens (behalve restricted), en met de app in beeld ook niet. Een taak die begon terwijl de app in beeld was, telt vanaf Android 16 mee zodra de app uit beeld gaat. Een origineel van 1 GB op thuiswifi (~5 MB/s) duurt ~3,5 minuten en past in het eerste uur; op trage wifi (~1 MB/s) ~17 minuten, en dan wacht de rest uren, of tot de telefoon 's nachts aan de lader ligt. Zie B20.
6. **Het alternatief in B15 is niet "zekerder".** Een foreground service (`dataSync`) kan sinds Android 12 niet starten als de app niet in beeld is (dus niet als er later wifi komt), sinds Android 15 niet vanuit `BOOT_COMPLETED`, mag sinds Android 15 hooguit 6 uur per 24 uur, en telt sinds Android 16 mee voor hetzelfde quotum. Daarbij een vaste melding, `POST_NOTIFICATIONS` en een verklaring met video bij Play. Wat Android 16 zelf aanraadt voor een overdracht die het lid start, is een *user-initiated data transfer job* (UIDT, vanaf Android 14): geen quotum, start als de voorwaarden kloppen, maar met een verplichte melding tijdens het versturen, het recht `RUN_USER_INITIATED_JOBS`, en zonder Jetpack-ondersteuning (dus onder Android 14 alsnog WorkManager). De scope sluit meldingen uit. Zie B20.
7. **"Alleen via wifi" is op Android niet hetzelfde als "geen betaald netwerk".** De standaard van WorkManager (`UNMETERED`) laat ook mobiel internet toe dat de provider onbeperkt noemt (5G), en houdt een wifi tegen die Android als betaald ziet (hotspot). Invariant 4 zegt: op mobiel internet wachten. Zie A29.
8. **Omzetten tijdens een lopend deel.** Bij WorkManager geldt een nieuwe voorwaarde pas bij de volgende start van een taak; een lopend deel gaat dan nog over mobiel internet. 38b-14 zegt: meteen (A29).
9. **De kiezer geeft niet altijd het origineel.** `expo-image-picker` kopieert een filmpje byte voor byte uit de stroom van de kiezer naar `cache/ImagePicker` (altijd `.mp4`; de backend leest het formaat uit de bytes, dus de naam bij downloaden klopt). Maar Android poetst de plaats weg *in die stroom*: dezelfde grootte, andere bytes. Dat gebeurt bij de fotokiezer op Android 11–14 altijd, en vanaf 15 als het lid het recht weigerde (zie vraag 2). Een filmpje dat alleen in Google Foto's staat, kan de kiezer van Android 14+ ook tonen; dan krijgt de app wat Google Foto's geeft, bij "Opslagbesparing" een verkleinde kopie (laag). B16 dekt dat: de kopie gaat mee.
10. **De grootte uit de kiezer kan ontbreken.** Het toevoegscherm geeft `originalPlan` de `fileSize` van de kiezer, en die komt uit de bron. Ontbreekt hij, dan zegt het plan `te_klein` en ziet het lid "te klein" bij een filmpje van 1 GB (A31).
11. **Punt 7 en het opruimen bij de start botsen.** `clearPickerCopiesAtStart` leegt `cache/ImagePicker` bij elke start. Een keuze die terugkomt na het sluiten door Android, staat juist daar. Daarbij geeft `getPendingResultAsync` niet aan voor welk scherm de kiezer openging: een profielfoto kan anders in het toevoegscherm belanden (A36).
12. **De projectpagina beslist op het platform.** De lege stand belooft alleen niet op Android (`Platform.OS !== "android"`, 42a A11). Met de uploader op Android moet dat de uploader worden, niet het platform (A34). En de tests van 42b eisen dat Android geen uploader heeft (`androidVideoModule.test.ts`); A heeft die aangepast.
13. **Links in de opslag van WorkManager.** De ondertekende links staan dan ook in de database van WorkManager (in de app). Account verwijderen moet die taken weghalen, niet alleen de bestanden (A32).
14. **Een update via Play tijdens het versturen, en "Opslag wissen".** Een update stopt het proces; of de taken daarna vanzelf doorgaan, is te meten (S3). "Opslag wissen" in de instellingen van Android wist wachtrij, taken en kopieën: de inzending blijft "onderweg" (`elders`), zoals bij opnieuw installeren op iOS.
15. **Na een herstart vóór de eerste ontgrendeling** draait er niets van de app (WorkManager is niet `directBootAware`). De problemen van 38b-18 (opslag op slot) spelen op Android dus niet, zolang de uploader niet `directBootAware` wordt.

### Antwoorden op de open vragen

**1. Mechanisme (B15).** B15 blijft staan: WorkManager zonder foreground service, een taak per deel, met een netwerkvoorwaarde. Het haalt invariant 3 en 4 op elke versie, met drie voorwaarden: `RECEIVE_BOOT_COMPLETED` (B19) voor een herstart zonder openen; een deel moet binnen de 10 minuten passen (A28); en het lid moet accepteren dat de achtergrond uren kan wachten (draftpunt 5, B20). Per manier:

| | Rechten | Melding in beeld | Play | Achtergrond |
|---|---|---|---|---|
| WorkManager, gewone taken (B15) | `WAKE_LOCK`, `ACCESS_NETWORK_STATE` (er al), `RECEIVE_BOOT_COMPLETED` (B19) | nee | niets nieuws | quotum per bucket; aan de lader en met de app open geen grens |
| Foreground service `dataSync` | `FOREGROUND_SERVICE`, `…_DATA_SYNC`, `POST_NOTIFICATIONS` | ja, vast | verklaring met video | start niet zonder de app in beeld (12+), 6 uur per dag (15+), quotum (16+) |
| UIDT (vanaf 14) | `RUN_USER_INITIATED_JOBS`, `POST_NOTIFICATIONS` | ja, tijdens versturen | geen verklaring bekend (laag) | geen quotum; alleen te plannen met de app in beeld; onder 14 WorkManager |

Zekerheid: hoog voor de quota, de 10 minuten, `setPersisted(false)` en de regels voor foreground services; middel voor de duur in de praktijk (S3, testers); laag voor wat Play bij UIDT vraagt. Expedited werk (`setExpedited`) is geen uitweg: onder Android 12 is dat een foreground service met melding.

**2. Origineel per versie.** Wat de kiezer van de app (42a-regel) geeft:

| Android | kiezer | plaats in het origineel | bit voor bit | zekerheid |
|---|---|---|---|---|
| 7–10 (API 24–29) | Bestanden of de fotokiezer van Play-diensten | Bestanden: ja; fotokiezer: nee | Bestanden: verwacht ja | laag (geen meting) |
| 11–13 (30–33) | fotokiezer; zonder fotokiezer Bestanden | fotokiezer: nee; Bestanden: ja (API 30 gemeten bij foto's) | fotokiezer: nee | middel |
| 14 (34) | fotokiezer | nee, ook met het recht (gemeten bij foto's) | nee | middel |
| 15–17 (35–37) | fotokiezer via `legacy`, met het recht | ja (S2 gemeten); "Don't allow": nee | verwacht ja; S3 meet het | middel |

Zonder bredere toegang is er op 11–14 geen manier: de fotokiezer poetst altijd, `setRequireOriginal` werkt niet op zijn links, en alleen `READ_MEDIA_VIDEO` zou helpen (B4: nooit). Transcoderen door Android (HEVC naar H.264) verwacht ik niet bij target 36 (middel); de SHA-256 in S3 laat het zien. De testers (Samsung, Android 17) zitten in de laatste rij.

**3. Ruimte.** De kopie van de kiezer staat in de cache, en die mag Android wissen bij weinig ruimte (en het lid met "Cache wissen"). Daarom verplaatst `keepOriginal` hem naar een eigen map in de opslag van de app (A31). De regel van 38b-1 (vrij: origineel plus 1 GiB) blijft; hij is ruim genoeg, ook als de uploader geen deelbestanden maakt. Te weinig ruimte voor de kopie zelf geeft de bestaande melding van de kiezer; te weinig daarna `geen_ruimte` (38c-13). Lukt het snijden of lezen van een deel niet door ruimte, dan meldt de uploader dat zoals op iOS (38b-13), zonder het bewaarde bestand te wissen.

**4. Wekken.** Nee, de runner doet niets als de app dicht is (draftpunt 2). De cron rondt af binnen het uur (hoog: `crons.ts`); de stand op de projectpagina komt uit de backend, dus "Binnen" verschijnt ook zonder de app. Het opruimen op het toestel wacht tot de app weer draait. Een eigen `finishOriginal` vanuit Kotlin vraagt de login van Clerk in native code; dat raad ik af.

**5. Fabrikanten.** Samsung: "Slapende apps" en "Diep slapende apps" (handmatig, of automatisch voor apps die een tijd niet gebruikt zijn), en de accu-stand per app (Onbeperkt, Geoptimaliseerd, Beperkt). Een app die het lid net gebruikte, slaapt niet; "Beperkt" of "Diep slapend" laat originelen alleen met de app open gaan. Wegvegen uit de recente apps laat de taken bij Samsung en bij gewone Android staan (middel); bij sommige andere merken (Xiaomi, Huawei) is wegvegen hetzelfde als gedwongen stoppen. Op de emulator te zien: buckets, Doze, gedwongen stoppen, "Beperkt" (`appops RUN_ANY_IN_BACKGROUND`), Databesparing, betaalde wifi, trage verbinding, herstart, update. Alleen bij de testers: het batterijbeheer van Samsung, echte wifi-snelheden, een nacht aan de lader.

**6. Punt 7.** De weg bestaat in de code: als Android het scherm van de app weggooit terwijl de kiezer open is, bewaart het register van Expo zijn stand (in `SharedPreferences`), en na terugkomen zet `expo-image-picker` de keuze klaar voor `getPendingResultAsync` (middel). Maar 42a zag dat het "eigen native code" vroeg; dat spreekt dit tegen, dus eerst meten (S3). In de app is het klein: bij de start één aanroep, de uitkomst door één pure functie (A36), en het toevoegscherm opent met die keuze. Werkt `getPendingResultAsync` niet, dan geeft A36 nog steeds "kies opnieuw" (de app weet dat de kiezer open was), zonder native code.

### A-invarianten (42c)

**A27. Versturen zonder de app.** De delen gaan via een taak die Android zelf start, zonder scherm en zonder JS. Zijn de delen eenmaal bij de uploader, dan gaan ze door na wegvegen, scherm op slot, Doze en (met B19) een herstart. Dat is een paar seconden na "klaar" in het toevoegscherm; wie de app in die seconden wegveegt, ziet het origineel verder gaan bij het volgende openen. De Android-kant geeft JS dezelfde functies en events als iOS (`Originals` in `index.ts`), zodat de runner, de wachtrij en de schermen van 38b en 38c ongewijzigd werken; de twee functies voor gate 6 van iOS hoeven niet.

**A28. Doorgaan zonder lus.** Zonder JS zet de uploader een deel zelf voort na een tijdelijke fout (geen antwoord, 5xx, 429, andere 4xx): dezelfde link, hooguit 5 mislukte pogingen (38b-6), met een wachttijd die oploopt. Netwerk weg, gestopt door Android (Doze, quotum, de tijdslimiet) of een voorwaarde die niet meer klopt, telt niet als poging. Na 403, `NoSuchUpload` of 5 pogingen wacht het deel; de stand van de uploader laat dat zien, en `atLaunch` beslist bij de volgende start. Elk deel van 32 MiB kan binnenkomen op een verbinding van ~0,5 Mbit/s: er lopen niet zoveel delen tegelijk dat een deel niet binnen de tijdslimiet van Android past.

**A29. "Alleen via wifi" op Android** (invariant 4, 38b-11). Aan betekent: alleen over wifi of kabel die Android niet als betaald ziet. Mobiel internet wacht altijd, ook als de provider het onbeperkt noemt; een hotspot of een betaalde wifi wacht; een VPN telt als het netwerk eronder. `networkStatus` en `onNetwork` volgen dezelfde regel als de taken, zodat "Wacht op wifi" klopt. Aanzetten op mobiel internet: binnen enkele seconden gaat er niets meer over mobiel internet, ook geen lopend deel. Uitzetten: wachtende delen gaan, met de app open meteen. Aanmelden en afronden gaan op elk netwerk (38b-11).

**A30. Herstart, gedwongen stoppen, update.** Herstart: verder zonder openen als B19 ja is, anders bij openen. Gedwongen stoppen (Instellingen of `am force-stop`): verder bij het openen, zonder dat het lid iets doet. Een update via Play: verder, en hooguit een deel nog eens over de lijn. Elk deel komt één keer als klaar in de stand; generaties en oude links zoals 38b-14.

**A31. Bewaren en opruimen.** De kopie van de kiezer gaat bij "Toevoegen" naar een eigen map in de opslag van de app: niet de cache, niet in een back-up (`allowBackup` blijft uit). Het opruimen van `cache/ImagePicker` (bij de start, uitloggen, de profielfoto) raakt hem niet. De grootte voor `originalPlan` en `startOriginal` is die van het bestand dat de app heeft, niet een getal van de kiezer; ontbreekt dat getal, dan is het geen `te_klein`. Kopie en eventuele deelbestanden gaan weg na binnen, terugtrekken en account verwijderen (38b-9, 38b-10), op Android zodra de app daarna draait.

**A32. Links blijven binnen de app.** Geen link, sleutel of pad in logcat, het log van de uploader of een event (38b-16). Account verwijderen haalt ook de taken bij Android weg, met hun links; uitloggen pauzeert alleen de aanroepen, zoals op iOS (de delen gaan door).

**A33. Geen nieuwe rechten of meldingen (B15).** Geen foreground service, geen expedited werk, geen UIDT, geen melding; dus geen `FOREGROUND_SERVICE*`, `POST_NOTIFICATIONS`, `RUN_USER_INITIATED_JOBS` of `READ_MEDIA_*`, en geen verklaring bij Play. In het samengevoegde manifest staan de rechten van 42b, plus `RECEIVE_BOOT_COMPLETED` alleen als B19 ja is. De uploader is niet `directBootAware`.

**A34. Het filmproject op Android is dat van de iPhone met uploader** (42a A11 vervalt). Schakelaar, stand per eigen origineel, "Mijn filmpjes" met wat in de wachtrij staat, de regel boven de knop (besluit 27.4), Terugtrekken. De lege stand belooft dat nieuwe filmpjes als origineel meegaan zodra de build de uploader heeft, niet op grond van het platform (webapp zoals nu). Het proefscherm alleen in dev-builds.

**A35. De stand klopt als het lid kijkt.** Met de app in beeld gelden geen quota: wat kan, loopt. "Wordt verstuurd" staat er alleen als de delen bij de uploader zijn en het netwerk goed genoeg is; anders "Wacht op wifi" of "Later opnieuw" (38c-7).

**A36. De keuze blijft bewaard** (invariant 8, punt 7). Vóór het openen van de kiezer onthoudt de app waarvoor (toevoegen, met het gekozen album, of de profielfoto) en wanneer. Bij de start, na het legen van `cache/ImagePicker`:
- een keuze voor het toevoegscherm: het toevoegscherm opent met die keuze en het album van toen (of het laatst gekozen album);
- geen resultaat of een fout, binnen een uur na het openen van de kiezer voor het toevoegscherm: het toevoegscherm zegt dat het lid opnieuw moet kiezen; later niets;
- een keuze voor de profielfoto of zonder bekend doel: de kopieën weg, geen scherm;
- geannuleerd: niets.

Alleen op Android; iOS verandert niet.

**A37. Buildnummer bij Info (B18).** "Versie 2.0.2 (7)", op Android en iOS, met het buildnummer van de geïnstalleerde build. `eas.json` telt de nummers op de server (`appVersionSource: remote`), dus ze staan niet in `app.json`: de bron is wat het toestel van de build weet. Zonder nummer alleen "Versie 2.0.2"; zonder versie "Versie onbekend".

**A38. Het origineel is wat de kiezer gaf** (invariant 2, B16). De uploader stuurt de bytes van de bewaarde kopie, zonder iets te herschrijven, ook als de kiezer de plaats wegpoetste. De app probeert niet zelf een "echter" origineel te vinden en vraagt geen bredere toegang.

### Spike S3: aangescherpt

Naast punt 1–5 hierboven, op API 36 (en 34 voor de kiezer en de quota van vóór 16):

0. **Lader los.** De emulator laadt altijd; aan de lader gelden geen quota en geen Doze. Eerst `adb shell dumpsys battery unplug` (na afloop `dumpsys battery reset`).
1. **Geen JS op de achtergrond.** Veeg de app weg terwijl er delen wachten, laat een taak lopen en kijk in logcat: start React Native (`ReactNativeJS`), of alleen het proces?
2. **Buckets en Doze** per bucket (`am set-standby-bucket … active|working_set|frequent|rare|restricted`): hoe lang tot het volgende deel, met `dumpsys jobscheduler` (de reden van wachten en van stoppen; op 16+ ook de geschiedenis van redenen). Daarna de app openen: gaan de delen binnen enkele seconden?
3. **Traag netwerk:** `adb emu network speed` op ~0,5 en ~2 Mbit/s omhoog, met een origineel van ~300 MB. Haalt elk deel de tijdslimiet (geen eindeloos opnieuw), en hoeveel delen lopen er tegelijk?
4. **Wifi-regel** (A29): alleen mobiel (`svc wifi disable`); wifi als betaald (`cmd netpolicy set metered-network <ssid> true`); Databesparing (`cmd netpolicy set restrict-background true`). Omzetten van de schakelaar tijdens een lopend deel over mobiel internet: stopt het?
5. **Herstart** met en zonder `RECEIVE_BOOT_COMPLETED` (B19); **gedwongen stoppen**; **update** (`adb install -r` van dezelfde build) tijdens het versturen.
6. **Bit voor bit** (punt 4): per variant van S1 en ook met "Don't allow"; per uitkomst de SHA-256 van het bestand op de emulator, van de bewaarde kopie en van het object in R2 (download in de webapp), en of de plaats erin staat. Op API 34 en 36.
7. **Punt 7** (A36): open de kiezer vanuit het toevoegscherm, `am kill <pakket>` (de app staat dan op de achtergrond), kies twee filmpjes en kom terug. Geeft `getPendingResultAsync` de keuze? Hetzelfde vanuit de profielfoto.
8. **Account verwijderen** tijdens het versturen: daarna staan er geen taken meer bij Android (`dumpsys jobscheduler`) en geen bestanden.

Haalt WorkManager in punt 2 of 3 invariant 3 of 4 niet, dan stopt B en meldt regie (zie B20).

### Gate en testers (B17)

Emulator: S3 en de gate-checks van 38b (3, 4, 6, 7, 9, 10) die op Android zin hebben, plus 38c 2–7 en 10 op de Android-app. Alleen bij de testers: een echt filmpje van 1 GB of meer op thuiswifi, een dag zonder de app te openen; dezelfde met mobiel internet en daarna wifi; de telefoon een nacht aan de lader; "Slapende apps" van Samsung; de plaats in het gedownloade origineel (Wouter, in de webapp). Wat Wouter de testers vraagt: is het filmpje de volgende ochtend "Binnen" zonder de app te openen?

### Keuzes voor Wouter (42c, aangevuld door A)

- **B19 (nieuw). Verder na een herstart zonder de app te openen.** Daarvoor moet `RECEIVE_BOOT_COMPLETED` uit de geblokkeerde rechten (42a A9). Het is een gewoon recht: geen vraag aan het lid, geen verklaring bij Play. Anders gaat een origineel na een herstart pas verder als het lid de app opent. **Advies: toestaan.**
- **B20 (nieuw). Hoe lang mag een origineel op de achtergrond wachten?** Met B15 gaat een origineel op goede wifi meestal binnen het uur, op trage wifi of na uren zonder de app soms pas als de telefoon aan de lader ligt. (a) Dat aanvaarden, met als grens: binnen een dag, als de telefoon een nacht aan de lader lag; (b) vanaf Android 14 een UIDT met een melding zolang hij verstuurt ("Clubalmanac verstuurt een filmpje"); dan vervalt "geen meldingen" voor die ene melding, en is het meer native werk. **Advies: (a); (b) alleen als S3 of de testers laten zien dat de grens van (a) niet gehaald wordt.**
- **B21 (nieuw). Opruimen na binnen.** Op Android blijft de bewaarde kopie (tot 2 GiB) staan tot het lid de app weer opent, ook als het origineel al binnen is (de cron rondde af). **Advies: aanvaarden.**

### Testcontract (A)

Namen en vormen zijn A-keuzes; het hoe is aan B.
- `projectEmptyText({ open, platform, uploader })` in `src/lib/filmProject.ts`: de tekst van de lege stand van "Alle filmpjes". De projectpagina gebruikt hem en kijkt niet meer naar Android.
- `src/lib/pendingPick.ts` (nieuw), pure module: `PENDING_PICK_MAX_MS` (1 uur), `PICK_AGAIN_TEXT`, het type `PickMark` (`{ kind: "toevoegen"; albumId: string | null; at }` of `{ kind: "profiel"; at }`), `pickMarkToStore`/`pickMarkFromStore` (onleesbaar is `null`), en `pendingPickAction({ mark, result, now })` met als uitkomst `niets`, `toevoegen` (album en bestanden), `opnieuw_kiezen` (album) of `weg` (de bestanden). `result` heeft de vorm van wat `getPendingResultAsync` geeft (een resultaat, een fout met `code`, of `null`).
- `versionText(version, build)` in `src/lib/infoPages.ts`; `InfoList.tsx` gebruikt hem. Waar het buildnummer vandaan komt, is aan B (A37).
- De Android-kant van de module: de functies van `Originals` in `index.ts` en de events van de uploader.

### Tests (A)

| Bestand | Wat | Stand |
|---|---|---|
| `app/tests/androidOriginals.test.ts` (nieuw) | A27: met een Android-module mét uploader is `originalUploaderAvailable` waar en hoort de runner de vijf events; de Kotlin-kant geeft de 21 functies van `Originals` en de events. A33: geen foreground service, expedited werk, UIDT of melding in de Kotlin-code; `app.json` vraagt geen `FOREGROUND_SERVICE*`, `POST_NOTIFICATIONS`, `RUN_USER_INITIATED_JOBS` of `READ_MEDIA_VIDEO` en blokkeert de foreground service. A34: `projectEmptyText`, en de projectpagina gebruikt hem zonder `Platform.OS` voor Android. | 7 rood (de Kotlin-kant mist de uploader; `projectEmptyText` ontbreekt), 3 groen (bewakers) |
| `app/tests/pendingPick.test.ts` (nieuw) | A36: de keuze terug in het toevoegscherm met het album van toen; opnieuw kiezen zonder resultaat binnen het uur of bij een fout; niets bij annuleren of later; een profielfoto of onbekend doel nooit in het toevoegscherm; het doel op schijf heen en terug, onleesbaar is `null`. | 14 rood: de module ontbreekt |
| `app/tests/versionText.test.ts` (nieuw) | A37, B18: "Versie 2.0.2 (7)", zonder nummer geen haakjes, spaties, zonder versie "Versie onbekend"; `InfoList.tsx` gebruikt `versionText`. | 5 rood: `versionText` ontbreekt |
| `app/tests/androidVideoModule.test.ts` (aangepast) | De test "geen enkele functie van de uploader (42c)" is weg (42b A21 vervalt); de rest blijft, als bewaker voor een build zonder uploader. | groen |

Niet in unit-tests (S3, gate, audit): het gedrag van de Kotlin-uploader (A27–A33: taken, quota, wifi-regel, herstart, update, opruimen, logcat), de aansluiting van A31 en A36 in het toevoegscherm en bij de start, waar het buildnummer vandaan komt, en B19 (`RECEIVE_BOOT_COMPLETED`; de test volgt het besluit).

**Stand na A:** app 26 rood (7 + 14 + 5) / 2721 groen. A draaide de 22 tests van de pure functies tegen een wegwerp-uitwerking buiten `src/` (in `builds/`): alle groen; weggegooid. Typecheck app: alleen `projectEmptyText`, `versionText` en de module `pendingPick` ontbreken.

## Besluiten Wouter na A (42c, 2026-11-27)

- **B19.** Ja: `RECEIVE_BOOT_COMPLETED` mag (uit `android.blockedPermissions`), zodat een origineel na een herstart doorgaat zonder de app te openen.
- **B20.** (a): binnen een dag is goed, als de telefoon een nacht aan de lader lag. Een overdracht met melding (UIDT) alleen als S3 of de testers laten zien dat (a) niet gehaald wordt.
- **B21.** Aanvaard: op Android blijft de bewaarde kopie staan tot het lid de app weer opent.
