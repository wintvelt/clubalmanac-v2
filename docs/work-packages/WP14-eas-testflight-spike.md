# WP14: Spike EAS-build → TestFlight

> Regie-draft. Spike, Setup 1 (solo). Geen A: er valt niets uit oude code te vertalen, de benodigde feiten staan in [WP13](./WP13-app-scaffold-auth.md) §Invariant 8. Eén uitvoer-sessie met het `wp-b`-mandaat doet de repo-wijzigingen. Wouter draait alle commando's die externe accounts raken (EAS, Apple). Regie reviewt de diff.

## Productdoel

Wouter installeert de WP13-app via TestFlight op zijn eigen iPhone, logt in met een code en ziet zijn naam. Lukt dat niet, dan weten we zwart-op-wit waarom niet, zolang de app uit distributie is.

Het tweede deel telt even zwaar als het eerste. Een geblokkeerde upload met een duidelijke reden is een geslaagde spike.

## Invarianten

1. **App Store-identiteit blijft die van WP13.** Bundle ID `com.wintvelt.clubalmanac-app`, EAS project `bd5c6c93-059d-409f-bca5-f658ec5722d5`, versie 2.0.0, iPad aan, scheme `clubalmanac`. Deze WP wijzigt geen van die waarden.
2. **Het buildnummer komt van de remote EAS-teller** en ligt boven 38, de laatste build van de oude app in App Store Connect (gecheckt door Wouter 2026-10-25). Niemand zet het buildnummer met de hand in `app.json`.
3. **Eén Node-versie: 24.** Lokaal, op EAS en in CI bouwt alles met Node 24. Wie met een andere versie werkt, krijgt een duidelijke melding vooraf, niet een vage build-fout halverwege.
4. **EAS bouwt uit de config, niet uit de lokale `ios/`-map.** `app/ios/` is gitignored prebuild-uitvoer. Een build op EAS mag niet afhangen van wat daar lokaal toevallig staat.
5. **De omgeving van een build volgt uit de profielnaam.** De TestFlight-build van nu praat tegen dev (`glorious-pheasant-759`, `picked-quail-97`): prod bestaat nog niet. Een profiel dat "production" heet, krijgt nooit dev-waarden. Zo hoeft fase 5 alleen prod-waarden toe te voegen, niet profielen om te dopen.
6. **Geen geheimen in de repo of in EAS-env-vars.** EAS-env-vars bevatten alleen de twee publieke `EXPO_PUBLIC_`-vars uit WP13. Apple-certificaten, provisioning profiles en een eventuele App Store Connect API key beheert EAS (managed credentials) of staan bij Wouter. `eas.json` bevat geen wachtwoorden of keys. Het ASC-app-ID `1663038609` is geen geheim en mag erin.
7. **Alleen internal testing.** Geen externe testers, geen Beta App Review, geen indiening voor de App Store. De build bevat echte data van drie dev-users; die blijft binnen Wouters eigen account.
8. **`npm audit` zonder `--force`.** Elke melding in de root en in `app/` krijgt een besluit: opgelost, geaccepteerd (met reden) of uitgesteld (met WP). Een major-versie-sprong is een expliciete keuze in de tabel hieronder, geen bijvangst van `audit fix`. Daarna zijn root- en app-typecheck en -tests groen, en `convex` heeft in beide lockfiles dezelfde versie (bestaande test uit WP13).
9. **Backend-tooling blijft ongemoeid** (WP13 invariant 3). Root-`npm ci`, `typecheck` en `test` doen hetzelfde als vóór deze WP, op de Node-versie na.

## Edge cases + scope-uitsluitingen

**In scope:**
- `app/eas.json` met build- en submit-profielen, `owner` in `app.json` en `eas.json`-context
- Node 24 vastzetten op de plekken uit invariant 3
- `npm audit` beoordelen in root en `app/`, uitkomst in §Uitkomsten npm audit
- Exportcompliance in de config vastleggen: de app gebruikt alleen standaard-HTTPS. Anders vraagt App Store Connect het bij elke build opnieuw.
- Runbook voor EAS in [`external-services.md`](../conventions/external-services.md) §App-client-env: profielen, env-vars per omgeving, credentials, de commando's uit de gate
- Eén build, één upload, één installatie via TestFlight

**Let op tijdens de gate:**
- Het distributiecertificaat en het provisioning profile uit 2023 zijn waarschijnlijk verlopen. EAS kan nieuwe aanmaken; dat is een keuze van Wouter tijdens `eas build`.
- App Store Connect kan blokkeren op niet-geaccepteerde overeenkomsten of een verlopen Developer-lidmaatschap. Dat is een geldige spike-uitkomst, geen bug.
- Apple mailt na de upload soms waarschuwingen (ITMS-codes, privacy manifest). Noteer ze letterlijk, ook als de build toch verwerkt wordt.
- `@types/node` in `app/` staat op 25. Na de Node 24-keuze hoort het type bij de runtime.

**Bewust niet (voor deze WP):**
- Indienen voor App Store-review of de app terug in distributie zetten
- Externe testers, Beta App Review
- Prod-omgeving (fase 5), prod-env-vars in EAS
- `expo-updates` / OTA, push notifications
- Universal links / associated domains (WP22)
- Android, web
- Feature- of designwerk in de app
- Backend-wijzigingen in `convex/`

## Risico-assessment

- **security/privacy: medium.** Apple- en EAS-credentials zijn nodig; Wouter beheert ze (invariant 6). De build praat tegen dev met echte foto's van drie users, daarom alleen internal testing (invariant 7). De `npm audit`-meldingen zijn supply-chain-risico.
- **ops: medium.** Een mislukte build valt op. Twee stille risico's: een build zonder of met verkeerde env-vars (de WP13-startcheck en de "Convex weigert token"-toestand vangen dat op het toestel), en een `audit fix` die `convex` ophoogt (de lockfile-test vangt dat).
- **external deps: hoog.** Hoe Apple omgaat met een app die uit distributie is, weten we niet. Dat is precies de spike-vraag. Geen adversarial pass: het risico zit in Apple's gedrag, en alleen een echte upload beantwoordt dat. Er is geen code om te red-teamen.
- **multi-user/concurrency: laag.** Eén tester, de app leest alleen.
- **data/schema-evolutie: laag.** Geen schema-wijziging.
- **ops-runbook-impact:** nieuw zijn `app/eas.json` (profielen + submit-config), EAS-env-vars per omgeving, de credentials-keuze (EAS-managed of eigen) en de Node-pin. Ze landen in `external-services.md` §App-client-env, waar de EAS-regel uit WP13 al staat. De uitvoer-sessie levert de runbook-entry mee; regie toetst.

## Cross-refs

- [WP13](./WP13-app-scaffold-auth.md) §Invariant 8 (versie, build 38, `appVersionSource: remote`, ASC-app-ID), §Ops-runbook
- [`migratie-status.md`](../migratie-status.md) §Fase 4 Track A ("Open: of nieuwe TestFlight-builds werken")
- [`external-services.md`](../conventions/external-services.md) §App-client-env
- `.github/workflows/` (CI-Node-versie)

## Acceptance

- Root en `app/`: typecheck en tests groen op Node 24, CI groen
- §Uitkomsten npm audit ingevuld, elke melding met een besluit
- Runbook-entry in `external-services.md`
- **Empirische gate (Wouter, echte iPhone).** De uitvoer-sessie zet de definitieve commando's in het runbook; in grote lijnen:
  1. Node 24 actief in de terminal, `eas whoami` toont het juiste account
  2. De twee `EXPO_PUBLIC_`-vars als EAS-env-var voor de dev-omgeving
  3. `eas build` voor iOS met het TestFlight-profiel. Credentials-vragen beantwoordt Wouter zelf.
  4. `eas submit` van die build naar App Store Connect
  5. In App Store Connect: build verwerkt, toevoegen aan een interne testgroep
  6. Installeren via de TestFlight-app op de iPhone
  7. Inloggen met code → eigen naam zichtbaar. App sluiten en openen → nog ingelogd. Uitloggen werkt.
  8. Ruimte voor bevindingen buiten deze stappen
- **Na de gate vult regie §Uitkomsten spike in**, ook bij een blokkade.

## Besluiten Wouter 2026-10-25

| Vraag | Besluit |
|---|---|
| `owner` | Het Expo-account dat EAS project `bd5c6c93-…` nu bezit. De uitvoer-sessie leest het af, niet raden. |
| CI-Node | Gaat mee naar 24 (invariant 3). |
| TestFlight geblokkeerd | Alleen vastleggen. Regie beslist bij de closeout over een vervolg-WP. |
| Laatste build in App Store Connect | 1.6.0 build 38, status "Removed from Sale". De hoogste TestFlight-build is ook 38, verlopen. Invariant 2: de nieuwe build krijgt een nummer boven 38. |

## Uitkomsten npm audit

> Afwijking van de B-regel "geen spec-edits": de uitvoer-sessie vult deze tabel in, omdat het besluit per melding hier thuishoort.

| Locatie | Pakket | Ernst | Besluit | Reden |
|---|---|---|---|---|
| root | `vitest` / `@vitest/mocker` 4.1.5 | moderate | opgelost: 4.1.12 via `npm audit fix` | patch binnen `^4.1.5` |
| root | `vite` 8.2.2 (via vitest) | high | opgelost: 8.3.5 via `npm audit fix` | minor, transitief; alleen test-tooling |
| root | `source-map-js` 1.2.1 | high | opgelost: 1.2.2 via `npm audit fix` | patch, transitief |
| `app/` | `vitest` / `@vitest/mocker` 4.1.5 | moderate | opgelost: pin naar 4.1.12 in `package.json` | `app/` pint exact, dus `audit fix` wilde `--force`; dit is een patch, geen major |
| `app/` | `node-forge` (via `@expo/cli`, `@expo/code-signing-certificates`) | high | geaccepteerd | geen fix beschikbaar. Zit in de Expo-CLI (code signing voor `expo-updates`), niet in de app-bundel; de app gebruikt geen `expo-updates`. Opnieuw bekijken bij een Expo-update |
| `app/` | `zod` 3.25.76 (via `@expo/cli` en `@clerk/expo` → `@base-org/account`) | high | geaccepteerd | geen fix binnen zod 3, en `audit fix` kan de ouders niet ophogen. De DoS vraagt grote invoer die door zod gevalideerd wordt; de app voert geen user-invoer door zod. Opnieuw bekijken bij een Clerk- of Expo-update |
| `app/` | `expo`, `@expo/cli`, `@clerk/expo` | high | geaccepteerd | alleen meldingen omdat ze van `node-forge` / `zod` hierboven afhangen. Geen eigen kwetsbaarheid |

## Uitkomsten spike

> Regie vult in na de gate.

| Vraag | Uitkomst |
|---|---|
| Build op EAS gelukt? (build-ID, buildnummer) | |
| Upload naar App Store Connect gelukt en verwerkt? | |
| Beschikbaar voor internal testing terwijl de app uit distributie is? | |
| Installeerbaar en werkend op de iPhone (login, naam, herstart)? | |
| Meldingen van Apple (letterlijk) | |
| Gevolg voor het Track A-plan | |
