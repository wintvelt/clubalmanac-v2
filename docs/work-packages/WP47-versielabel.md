# WP47: versielabel in Info

> Regie 2026-11-27. Wens van Wouter (TBD-regel in het WP-overzicht). Alleen app, geen backend. Voor app 2.0.3. A → B → audit → gate op een echte iPhone via TestFlight (dev-build). Eigen branch `wp47` vanaf `main`.

## Productdoel

Wie de app test, ziet in één oogopslag welke build hij in handen heeft: naast het versienummer het buildnummer, en of het een dev-build is (praat met Convex dev) of een build uit TestFlight. Een lid met de App Store-versie ziet alleen versie en buildnummer.

## Besluiten (Wouter, 2026-11-27)

1. **Waar:** op de plek waar nu "Versie …" staat (Info, en Over).
2. **Wat:** versie en buildnummer, plus een label "dev" en/of "TestFlight" als dat geldt. Een App Store-build krijgt geen label.
3. **Android:** alleen "dev"; de testtrack van Play is niet te herkennen (TBD-regel).

## Wat er is

- `app/src/screens/InfoList.tsx`: `AppIdentity` toont naam en "Versie …" uit `Constants.expoConfig` (`expo-constants`); ook gebruikt in `InfoPageScreen` (Over).
- `app/src/data/devTools.ts`: `DEV_TOOLS`, waar uit de Convex-URL volgt of de build tegen dev praat.
- `app/modules/clubalmanac-video`: de eigen native module (Swift op iOS, Kotlin op Android, WP37/38b/42).
- Builds: `eas build --local` met profiel `dev` (Convex dev, via TestFlight) en `production` (Convex prod, TestFlight en daarna App Store). Het buildnummer telt automatisch op.

## Invarianten

1. **Nooit een fout label.** Weet de app het niet zeker (TestFlight niet te bepalen, module ontbreekt, web), dan géén "TestFlight"-label; nooit "TestFlight" op een App Store-build.
2. **App Store-build:** "Versie 2.0.3 (98)" zonder label.
3. **Dev:** het label "dev" volgt uit dezelfde bron als `DEV_TOOLS`, niet uit een tweede regel.
4. **Geen vertraging of crash:** Info rendert meteen; een native vraag die faalt of traag is, laat het label weg.
5. **Webapp:** geen buildnummer en geen TestFlight; "dev" alleen als de webapp tegen dev praat. A adviseert of de webapp meedoet.
6. **Geen gevoelige gegevens** in het label (geen URL of deployment-naam).

## Open vragen voor A (rapporteren aan regie)

1. Buildnummer: waar komt het betrouwbaar vandaan (`expo-application`, `expo-constants`, de native bundle), op iOS en Android, zonder nieuw pakket als dat kan?
2. TestFlight herkennen: StoreKit `AppTransaction` (omgeving `sandbox`) vanaf iOS 16, of de oude receipt-route (`sandboxReceipt`, deprecated)? Wat zegt `AppTransaction` in een Xcode- of simulatorbuild, en wat zonder netwerk? Hoe in de eigen module, en wat is het minimum-iOS van de app?
3. Tekst en vorm: "Versie 2.0.3 (98) · dev · TestFlight", of labels als kleine pillen? Advies met het oog op `docs/design.md`.
4. Een production-build in TestFlight (vóór de App Store-review) toont "TestFlight" zonder "dev"; klopt dat met wat Wouter wil zien?

## Risico-assessment

- **security/privacy: laag.** Geen nieuwe gegevens; invariant 6.
- **ops: laag.** Wel native code (Swift), dus een nieuwe dev-build is nodig om te testen.
- **external deps: laag.** StoreKit is van Apple, geen nieuw pakket als dat kan.
- **data: geen.** Geen backend.
- **ops-runbook-impact:** geen env-vars. De TestFlight-check staat in [`release-checks.md`](../runbooks/release-checks.md) als B klaar is.
- **toegangsdefinitie:** geen.

## Gate

- Dev-build via TestFlight op de iPhone: "Versie 2.0.3 (n) · dev · TestFlight" (of de vorm uit vraag 3).
- Production-build via TestFlight: "TestFlight", geen "dev".
- Na de release van 2.0.3 in de App Store: alleen versie en buildnummer (check bij de release).
- Android-emulator (dev): "dev", geen TestFlight. Webapp: volgens het besluit na vraag 5.

## Cross-refs

- WP15b (Info-pagina's), WP38b (`DEV_TOOLS`), WP37/38b/42 (eigen native module), TBD-regel versielabel in het WP-overzicht.

## Spec-criticus aanvullingen (A vult in)

> A 2026-11-27. Bronnen: Apple-docs StoreKit (`AppTransaction.shared`, `AppTransaction.refresh()`, `AppStore.Environment`, "Testing in-app purchases with sandbox"), Foundation (`Bundle.appStoreReceiptURL`), GoogleUtilities `GULAppEnvironmentUtil.m` (firebase-ios-sdk), de types van `expo-constants` 58 en `Expo.podspec` 58. De oude app toonde bij Info alleen "App versie" uit app.json; het buildnummer stond uitgecommentarieerd. Er is niets over te nemen.

### Antwoorden op de open vragen

1. **Buildnummer: is er al.** WP42 (B18, A37) bouwde `buildNumber()` in de eigen module (iOS `CFBundleVersion`, Android `versionCode`) en `versionText` in Info. Er is geen nieuw pakket nodig. `expo-constants` heeft het nummer niet: met `appVersionSource: remote` staat het niet in app.json, en de native velden in `expo-constants` zijn deprecated ten gunste van `expo-application`, een nieuw pakket. Op iOS zit het nummer pas in de eerstvolgende TestFlight-build (WP42 closeout). De gate van WP47 controleert het dus voor het eerst op iOS.
2. **TestFlight: `AppTransaction.shared`, niet de receipt-route.** `appStoreReceiptURL` is deprecated sinds iOS 18 (Apple: "Use AppTransaction.shared"). Het is ook een synchrone aanroep die seconden kan blokkeren (firebase-ios-sdk issue 16726). Waar je op moet letten:
   - **`sandbox` is niet genoeg.** Volgens Apple draait ook een development-signed build uit Xcode in de sandbox. Een build uit TestFlight of de App Store heeft geen `embedded.mobileprovision`, want Apple haalt dat bestand weg (GoogleUtilities herkent een App Store-build op dezelfde manier). Een dev-signed of ad-hoc-build heeft het bestand wel.
   - **Simulator:** die heeft ook geen provisioning-bestand, dus een eigen check: in de simulator nooit TestFlight. Met StoreKit Testing in Xcode is de omgeving `xcode`, en dan komt er geen label.
   - **Zonder netwerk:** `shared` kan het netwerk nodig hebben. Hij geeft een fout als de transactie er niet is of de gebruiker niet bij de App Store is ingelogd, en dan komt er geen label. StoreKit bewaart de transactie, dus na een eerdere start werkt het meestal ook offline.
   - **`refresh()`** toont een inlogvraag van de App Store. Die mag de app hier nooit gebruiken.
   - **Minimum-iOS:** 16.4 (Expo SDK 58 en de eigen module). `AppTransaction` bestaat vanaf 16.0, dus een terugval is niet nodig.
   - **In de module:** een asynchrone functie die alleen "ja" zegt als alle checks van invariant 8 kloppen. Android krijgt de functie niet.
3. **Vorm: advies tekst, geen pillen.** De regel blijft de `muted`-regel: "Versie 2.0.3 (98) · dev · TestFlight". In `design.md` zijn pillen voor de actieve tab, de groepstabs en het "nieuw"-label in de actiekleur. Een pil "dev" lijkt dan op een "nieuw"-label of een knop. " · " staat al in de app (toevoegscherm: "Groep · Album"). Er komt geen nieuwe component of kleur bij, en VoiceOver leest het als gewone tekst.
4. **Production-build in TestFlight: "TestFlight" zonder "dev".** Dat volgt uit besluit 2, en het is precies wat je vóór een release wilt zien: dit is de prod-build. Na de release in de App Store verdwijnt het label vanzelf (invariant 7). Wouter bevestigt.
5. **Webapp: advies, doet mee.** Info en Over gebruiken dezelfde `AppIdentity`, dus het kost geen extra werk. Zonder de module heeft de webapp geen buildnummer en geen TestFlight. De gehoste webapp praat met prod en toont "Versie 2.0.3". "dev" staat er alleen lokaal (`expo start --web` tegen dev); een gehoste dev-webapp is er niet (`webapp.md`). De versie op web is die van app.json op `main`, ook vóór de release in de App Store.

### Extra invarianten

7. **Op het toestel bepaald.** Dezelfde production-binary gaat van TestFlight naar de App Store. "TestFlight" komt dus uit de geïnstalleerde app, niet uit het build-profiel of een env-var. "dev" komt wel uit de build (invariant 3).
8. **TestFlight alleen als alles klopt:** een echt toestel (geen simulator), een build zonder eigen provisioning-bestand (door Apple gedistribueerd), en een geverifieerde app-transactie in de omgeving `sandbox`. In alle andere gevallen geen label: een andere omgeving, een fout, een niet-geverifieerd resultaat, of een build zonder de functie (Android, web, een build van vóór WP47).
9. **Geen inlogvraag.** Het label laat nooit een vraag van de App Store zien.
10. **Alleen een echt "ja" telt.** Elk ander antwoord van de module is "weet niet": geen label, en geen fout naar boven.
11. **Vaste woorden en volgorde:** "dev" vóór "TestFlight", precies zo gespeld, met " · " ertussen. Een label staat er alleen als het geldt; er staat nooit "geen TestFlight" of iets dergelijks.
12. **Asynchroon, zonder wachten.** Versie, buildnummer en "dev" staan er meteen. "TestFlight" komt erbij zodra het antwoord er is.

### Beslispunten

- **App Review ziet "TestFlight".** Apple test een production-build in de sandbox, met hetzelfde binary. De reviewer ziet dus "Versie 2.0.3 (n) · TestFlight". De kans op een afwijzing (richtlijn 2.2: bèta's horen in TestFlight) is klein, want het is kleine grijze tekst. Advies: accepteren. Wordt de build toch afgewezen, dan het label in production-builds weglaten.
- **Vorm (vraag 3):** advies tekst. De tests pinnen die tekst; kiest Wouter pillen, dan past regie die tests aan.
- **Vraag 4 en 5:** Wouter bevestigt.

### Besluiten na A (Wouter, 2026-11-27)

- **Vorm:** tekst in de grijze regel, "Versie 2.0.3 (98) · dev · TestFlight" (advies vraag 3).
- **Production-build in TestFlight:** "TestFlight" zonder "dev" (vraag 4).
- **Webapp doet mee** via dezelfde `AppIdentity` (vraag 5).
- **App Review ziet "TestFlight":** accepteren; bij een afwijzing het label in production-builds weglaten.
- De Swift-aanpak van A (antwoord 2, invariant 8) is de aanpak voor B.

### Scope

- **Buiten scope:** de testtrack van Play (besluit 3), een buildnummer op web, en het label op een andere plek dan Info en Over.
- **B:** `release-checks.md` krijgt een blok voor WP47: de prod-build in TestFlight toont "TestFlight" zonder "dev"; na de release van 2.0.3 alleen "Versie 2.0.3 (n)".

### Tests (A)

| Bestand | Pint | RED-reden |
| --- | --- | --- |
| `app/tests/versionLabel.test.ts` | Invariant 1–3, 5, 6, 10, 11 en vraag 3: `buildLabels({ dev, testFlight })` en `versionText` met labels | `buildLabels` ontbreekt; `versionText` negeert labels |
| `app/tests/testFlightBuild.test.ts` | Invariant 1, 4, 8 en 10: `testFlightBuild()` in de module geeft `true`, `false` of `null`, en wijst nooit af | `testFlightBuild` ontbreekt |
| `app/tests/versionLabelSources.test.ts` | Invariant 3, 6, 8, 9 en 12 in de bron: Info leest "dev" uit `DEV_TOOLS` en vraagt `testFlightBuild`; Swift gebruikt `AppTransaction.shared` asynchroon, met checks op simulator en provisioning-bestand, zonder `refresh` en zonder receipt; Kotlin heeft de functie niet | de Swift-functie en het gebruik in Info ontbreken |
