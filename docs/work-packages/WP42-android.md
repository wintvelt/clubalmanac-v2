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

---

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft.)
