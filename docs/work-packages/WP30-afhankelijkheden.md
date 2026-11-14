# WP30: afhankelijkheden bijwerken

> Regie 2026-11-14, landed 2026-11-14. Onderhoud, geen nieuw gedrag. Eén uitvoerende sessie (solo), daarna een gate van regie in de simulator met een nieuwe build. Geen A/B/audit: er is geen nieuw gedrag om te testen of te bouwen. Eigen branch `wp30`.

## Productdoel

Na de updates werkt alles in de app precies als nu, en zijn de bekende kwetsbaarheden in de app-pakketten weg.

## Scope

Alleen patch- en minor-updates, binnen de huidige major. Stand van `npm outdated` op 2026-11-14:

- **Backend (root):** `convex` 1.45 → 1.50, `@clerk/backend` 3.4 → 3.29, `@aws-sdk/*` 3.1116 → 3.1169 (alleen migratie-scripts), `nodemailer` 10.3 → 10.5, `convex-test` 0.0.50 → 0.0.71.
- **App:** Expo 58.0.19 → 58.0.25 met de expo-modules, `react-native` 0.88.0 → 0.88.1, `react`/`react-dom` 19.3.0 → 19.3.1, `@clerk/expo` 4.14 → 4.16, `convex` 1.45 → 1.50, `react-native-gesture-handler`, `-safe-area-context`, `-svg`, `-worklets`, `@react-native-community/datetimepicker`.
- **Kwetsbaarheden:** `npm audit` in de app meldt 8 (1 laag, 5 middel, 2 hoog). Allemaal met een fix.

## Buiten scope

- Major-sprongen: TypeScript 7, Vitest 5, `@types/node` 26, `dotenv` 18. Elk een eigen WP als we ze willen.
- Een nieuwe Expo SDK.
- Code-wijzigingen die geen gevolg zijn van een update. Wat opvalt en niet nodig is: noteren, niet meenemen.

## Invarianten

1. **Alles blijft groen:** backend- en app-tests, beide typechecks, na elke stap.
2. **De app-pakketten volgen Expo.** Expo-modules, React Native en React op de versies die Expo 58 aanwijst (`npx expo install --check` meldt niets). Geen versie die Expo afraadt.
3. **Convex gelijk in app en backend.** Dezelfde `convex`-versie in beide `package.json`'s, en `npx convex dev --once` deployt zonder fouten of nieuwe waarschuwingen.
4. **Geen hoge kwetsbaarheden meer.** `npm audit` in app en root: 0 hoog en 0 kritiek. Blijft er iets over zonder fix binnen de major: melden, met wat het raakt.
5. **Lockfiles kloppen.** `npm ci` slaagt in root en app, zoals in CI.
6. **Breaking changes gelezen.** Voor `@clerk/backend` (25 minors), `@clerk/expo` en `convex-test` (0.x, dus elke minor mag breken) de changelog doorgelopen. Wat ons raakt, staat in het rapport met de plek in de code.
7. **De native build draait.** Een nieuwe dev-build (`npx expo run:ios`) start in de simulator zonder rode schermen of nieuwe waarschuwingen.

## Werkvolgorde

1. **Uitvoerende sessie**, in stappen met een commit per stap:
   1. backend: `convex`, `@clerk/backend`, `nodemailer`, `@aws-sdk/*`;
   2. `convex-test` (testinfra; los, zodat een breuk herkenbaar is);
   3. app: Expo en de modules via `npx expo install --fix`, daarna `@clerk/expo`, `convex` en de rest;
   4. `npm audit fix` in de app (zonder `--force`), en de root.
   Na elke stap tests en typechecks. Breekt er iets: eerst uitzoeken of de update de oorzaak is. Is de fix klein, dan meenemen met uitleg; anders stoppen en melden.
2. **Deploy naar dev:** `npx convex dev --once`.
3. **Gate (regie)**, in de simulator met een nieuwe dev-build, als dev Wouter:
   - uitloggen en inloggen met code;
   - Mijn groepen, een groep, een album, een foto openen;
   - foto uploaden in een album; draaien; delen; de kaart;
   - groepsbeheer: groep bewerken;
   - uitnodigen (mail naar het `+clerk_test`-adres), en als genodigde de uitnodiging zien;
   - Profiel en Instellingen.
   Daarnaast: Convex-logs zonder nieuwe fouten.

## Risico-assessment

- **Security/privacy: middel.** Inloggen hangt aan Clerk (`@clerk/backend` en `@clerk/expo` gaan omhoog). De updates zelf verkleinen het risico.
- **Ops: middel.** Native modules veranderen, dus een nieuwe build. Een stille breuk bij inloggen, upload of foto-acties zie je alleen door de app te gebruiken; vandaar de gate.
- **External deps: middel.** Convex- en Clerk-versies moeten aan app- en serverkant passen.
- **Multi-user/concurrency: laag.** Geen gedragswijziging.
- **Data/schema-evolutie: laag.** Geen schema-wijziging.

## Ops-runbook-impact

- Geen nieuwe env-vars.
- De volgende TestFlight-build (EAS) neemt de nieuwe native versies mee. Geen aparte stap nodig; noteren in het gate-verslag welke build het eerst draait.

## Uitkomst (2026-11-14)

- **Bijgewerkt:** Convex 1.50 (app en backend), `@clerk/backend` 3.29, `@clerk/expo` 4.16, Expo 58.0.25 met modules, React Native 0.88.1, nodemailer 10.5, AWS SDK. Wat Expo 58 nog op de oude versie houdt (React 19.3.0, gesture-handler, svg, worklets, datetimepicker), bleef staan.
- **Changelogs:** niets dat ons raakt. `@clerk/expo` 4.16.1 geeft `getToken` een vaste identiteit, dus onze workaround is nu overbodig maar onschadelijk.
- **Kwetsbaarheden:** root 0; app 4 middel, 0 hoog (allemaal `minimatch` in Expo's build-tooling, geen runtime).
- **Gate (simulator, nieuwe dev-build, dev Wouter):** uitloggen en inloggen met code; groep, album, foto, kaart; delen; draaien (voorbeeld, niet bewaard); upload in Test group; Bewerk groep met datumkiezer; Profiel; uitnodiging met foto via SMTP komt aan. Groen.

### Backlog

- **`convex-test` 0.0.52 → 0.0.71:** breekt 11 tests (geplande functies lopen nu echt door; `Date.now()` schuift 1 ms per transactie). Aanpassingen in 7 testbestanden, deels grensgevallen. Eigen WP met A.
- **`minimatch` (4× middel) via `@expo/fingerprint`:** wachten op een Expo-patch, of een override naar minimatch 11.
- **Klein:** het versiecommentaar in `app/src/lib/loginErrors.ts:6` noemt nog `@clerk/expo` 4.14.1.
