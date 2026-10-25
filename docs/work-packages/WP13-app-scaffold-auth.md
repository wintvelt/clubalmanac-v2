# WP13: App-scaffold + Clerk-login

> Regie-draft. A vult onderaan aan (spec-criticus + pariteit-checklist). App-WP: lichtere A-variant, zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4).

## Productdoel

Een bestaande user opent de nieuwe app op een iPhone (simulator), logt in met zijn Clerk-account en ziet zijn eigen naam uit Convex. Na het herstarten van de app is hij nog steeds ingelogd.

## Invarianten

1. **Eén bron voor de API-types.** De app gebruikt de getypeerde API uit `convex/_generated` van deze repo. Geen kopie, geen handgeschreven types voor Convex-functies. Een backend-wijziging die een aanroep in de app breekt, laat de typecheck van de app falen.
2. **Eén Convex-versie.** De `convex`-client in de app is dezelfde versie als die waarmee `convex/_generated` gemaakt is.
3. **Backend-tooling blijft ongemoeid.** `npm ci`, `npm run typecheck` en `npm test` in de root doen na deze WP hetzelfde als ervoor. App-bestanden lekken niet in de root-typecheck of de vitest-suite.
4. **Ingelogd = geldige Clerk-sessie + gevonden users-rij.** Het hoofdscherm toont alleen data als `users.current` een rij teruggeeft. Ingelogd zonder rij (webhook nog niet verwerkt, of geen account) is een eigen, zichtbare toestand: geen leeg scherm en geen crash.
5. **Sessie overleeft een herstart.** Het Clerk-token staat in de veilige opslag van het toestel, niet in platte opslag.
6. **Uitloggen is volledig.** Na uitloggen staat er geen token meer op het toestel, en de Convex-client stuurt geen identiteit meer mee.
7. **Geen stille env-defaults.** Ontbreekt de Convex-URL of de Clerk publishable key, dan stopt de app bij de start met een duidelijke melding. Geen terugval op een hardcoded deployment, zeker niet op prod.
8. **App Store-identiteit.** Bundle ID `com.wintvelt.clubalmanac-app` en EAS project `bd5c6c93-059d-409f-bca5-f658ec5722d5`. Het versie- en buildnummer liggen boven de laatst gepubliceerde versie van de oude app, zodat WP14 zonder aanpassing kan uploaden.
9. **Inloggen wijzigt de gezaaide data niet.** Inloggen als een van de drie dev-accounts maakt geen tweede users-rij aan en overschrijft geen velden van de gezaaide rij. Dit loopt via het bestaande `session.created`-pad (WP6).

## Edge cases + scope-uitsluitingen

**In scope:**
- Verse Expo-app in `app/` (huidige stabiele Expo SDK), TypeScript strict
- Inlogscherm (email-login van Clerk, de methode die de dev-instance aan heeft staan), uitloggen, foutmeldingen bij een verkeerd wachtwoord of een onbekend account
- Eén scherm achter de login dat `users.current` toont
- De drie toestanden van invariant 4: niet ingelogd / ingelogd zonder rij / ingelogd met rij
- Typecheck van de app in CI, naast de bestaande root-checks
- Draait in de iOS-simulator tegen dev `glorious-pheasant-759` en Clerk dev `picked-quail-97`

**Bewust niet (voor deze WP):**
- Registreren / signup: dat is invite-only en hoort bij de invites-WP
- Wachtwoord vergeten / reset: A noteert in de checklist hoe de oude app dit deed; regie plant het in
- Navigatiestructuur, thema, design: designstap na WP14
- Subscription-discipline (AppState-pauze, unmount bij blur): WP15
- EAS-build en TestFlight: WP14
- Android en web: Track B
- Backend-wijzigingen in `convex/`. Mist er iets, dan stopt de sessie en meldt het aan regie.

## Risico-assessment

- **security/privacy: medium.** De sessietoken staat op het toestel (invarianten 5 en 6). De publishable key is publiek bedoeld. Autorisatie blijft volledig in de backend.
- **ops: medium.** Twee stille faalvormen: (a) een app die per ongeluk tegen de verkeerde deployment praat (invariant 7) en (b) een login zonder users-rij die eruitziet als "geen data" (invariant 4).
- **external deps: medium.** Clerk Expo SDK + Expo SDK. Versies vastzetten, geen `latest`.
- **multi-user/concurrency: laag.** Alleen lezen.
- **data/schema-evolutie: laag.** Geen schema-wijziging. Invariant 9 beschermt de gezaaide dev-data.
- **ops-runbook-impact:** twee nieuwe client-env-vars: Convex-URL en Clerk publishable key, per omgeving (dev nu, prod in fase 5). Ze landen in [`external-services.md`](../conventions/external-services.md), met waar ze lokaal staan (gitignored) en hoe ze later in EAS komen. Ook de Clerk-dashboardinstelling voor de app-login (toegestane redirect/native-app-config, als Clerk die vraagt) komt daar. B levert de runbook-entry mee.

## Cross-refs

- [`migratie-status.md`](../migratie-status.md) §Fase 4 Track A (besluit 2026-10-25, stap 1 "Auth screens")
- [`migratie-plan-convex.md`](../migratie-plan-convex.md) §Auth (Clerk + Convex), §TypeScript
- WP4 (JWT-roundtrip, email-claim), WP6 (`session.created` + atomic onboarding)
- `convex/users.ts`: `current`
- Oude app (alleen A leest): `/Users/wintvelt/Documents/DEV/DEV/clubalmanac-app`, login-schermen en `app.json` (versie, buildnummer)
- [`external-services.md`](../conventions/external-services.md) §Auth: Clerk

## Acceptance

- Root: `npm run typecheck` + `npm test` groen en ongewijzigd in scope
- App: typecheck groen, ook in CI; tests voor pure logica die A nodig vindt groen
- **Empirische gate (Wouter, simulator):**
  1. Inloggen als dev1 → eigen naam uit de dev-seed zichtbaar
  2. App afsluiten en opnieuw openen → nog ingelogd
  3. Uitloggen → inlogscherm; opnieuw openen → nog steeds uitgelogd
  4. Verkeerd wachtwoord → leesbare foutmelding
  5. Na de gate: de users-rij van dev1 is ongewijzigd (invariant 9)
  6. Ruimte voor bevindingen buiten deze scenario's

---

## Spec-criticus aanvullingen (A vult in)

A leest de oude app (login-flow, `app.json`) + bovenstaande spec en vult hier aan:

- Ontbrekende invarianten / edge cases in de login-flow
- Versie + buildnummer van de laatst gepubliceerde oude app (voor invariant 8)
- **Pariteit-checklist voor heel Track A**: alle schermen van de oude app, per scherm het gedrag in een paar regels, gekoppeld aan een WP uit [`README.md`](./README.md). Schermen die niet in een WP passen, apart melden. Dit wordt het afvinklijstje voor WP15-WP21.
- Open product-vragen voor regie/Wouter

(Leeg in draft.)
