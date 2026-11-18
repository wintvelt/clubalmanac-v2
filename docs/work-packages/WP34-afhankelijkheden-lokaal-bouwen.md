# WP34: afhankelijkheden bijwerken en lokaal bouwen

> Regie 2026-11-18. Onderhoud, geen nieuw gedrag. Eén uitvoerende sessie (solo, zoals [WP30](./WP30-afhankelijkheden.md)), daarna een lokale testbuild en Wouters gate op een toestel. Eigen branch `wp34`. Vóór de cutover-build.

## Productdoel

Na de updates werkt de app precies als nu, Dependabot meldt geen open kwetsbaarheid meer, en wie een build maakt, kan dat op de server doen zonder EAS-tegoed.

## Aanleiding

- Dependabot (2026-11-18): **picomatch**, hoog, in `app/package-lock.json`. Alleen bouwtools gebruiken het (Metro, Vitest, tinyglobby), niet de app op het toestel.
- `expo doctor` in de lokale build van 2026-11-18: `expo` 58.0.25 → ~58.0.26, `expo-file-system` 58.0.13 → ~58.0.14, `expo-router` 58.0.31 → ~58.0.32.
- De eerste lokale build (2026-11-18) liep vast op een ontbrekend Apple-tussencertificaat. Wat daarvoor nodig is, staat nog nergens.

## Scope

1. **App:** de Expo-patches via `npx expo install --check` (en `--fix`), daarna `npm audit fix` zonder `--force`. Ook de root als daar dezelfde melding staat.
2. **picomatch:** naar een gerepareerde versie. Lukt dat niet via de pakketten die het meebrengen, dan via `overrides` in `package.json`, met in het rapport waarom.
3. **Docs:** in [`external-services.md`](../conventions/external-services.md) §EAS-build en TestFlight een korte sectie *Lokaal bouwen*:
   - het commando;
   - dat een lokale build geen EAS-tegoed kost;
   - Xcode, CocoaPods en fastlane als vereisten;
   - het Apple WWDR G3-tussencertificaat in de login-keychain (zonder: "Distribution certificate … hasn't been imported successfully");
   - `builds/` (gitignored) als uitvoermap;
   - `EAS_LOCAL_BUILD_SKIP_CLEANUP=1` alleen bij debuggen, want die werkmap is ±4 GB;
   - uploaden met `eas submit --path`.

## Buiten scope

- Major-sprongen en een nieuwe Expo SDK.
- Andere waarschuwingen in de bouwtools (`inflight`, `glob`, `uuid` en dergelijke uit eas-cli zelf).
- Code-wijzigingen die geen gevolg zijn van een update. Wat opvalt: noteren, niet meenemen.

## Invarianten

1. **Alles blijft groen:** app- en backend-tests, beide typechecks.
2. **De app volgt Expo:** `npx expo install --check` meldt niets, en `expo doctor` geeft 20 van 20.
3. **Geen open hoge of kritieke kwetsbaarheid** in `npm audit` (app en root). Wat zonder fix binnen de major overblijft: melden, met wat het raakt.
4. **Lockfiles kloppen:** `npm ci` slaagt in root en app.
5. **De native build draait:** een lokale build lukt, en de app start in de simulator zonder rode schermen of nieuwe waarschuwingen.

## Gate

- **Uitvoerende sessie:** de simulator, met inloggen, een groep, een album, een foto en een tik-animatie.
- **Wouter:** een lokale build naar TestFlight. Daarna dezelfde rondgang op een toestel, met de animaties uit WP33 erbij.

## Risico-assessment

- **security/privacy:** laag. De update verkleint het risico.
- **ops:** laag. Patch-versies; native modules veranderen nauwelijks. Wel een nieuwe build, en die test Wouter.
- **external deps:** laag.
- **multi-user/concurrency:** geen.
- **data/schema-evolutie:** geen.
- **ops-runbook-impact:** alleen docs (lokaal bouwen). Geen env-vars of dashboard-config.
