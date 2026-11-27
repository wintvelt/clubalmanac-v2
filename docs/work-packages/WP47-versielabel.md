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
