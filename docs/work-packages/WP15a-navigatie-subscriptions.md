# WP15a: Navigatie-skelet + subscription-discipline

> Regie-draft. App-WP (zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4)), plus een adversarial pass omdat ops hoog is. Eigen sessie per rol. WP15b (Profiel, Instellingen, Info, `recordVisit`) bouwt hierop.

## Productdoel

Een ingelogde user gaat met de tabbalk naar Home, Mijn foto's, Toevoegen, Profiel en Instellingen. Op elk scherm dat hij opent, ziet hij een terugknop. De app houdt geen live verbinding open voor een scherm dat niet in beeld is, of zolang de app op de achtergrond staat.

## Besluiten Wouter 2026-11-02

| Vraag | Besluit |
|---|---|
| Opsplitsen | 15a (deze) = router, tabbalk, terugknop, subscriptions. 15b = Profiel, Instellingen, Info, `recordVisit`. |
| Avatar uploaden | WP18, samen met de upload-pipeline |
| Account verwijderen | Eigen WP (backend: Clerk-user mee verwijderen + nieuwe bevestiging) |
| "Laatste bezoek" op het profiel | Vervalt |

## Invarianten

1. **Expo Router, routes in `app/src/app/`.** De versie hoort bij de Expo SDK van de app en staat vast. Er komt geen map `app/app/`. Bron: [`design.md`](../design.md) §7.
2. **Tabbalk volgens design.md §5 en §7.** Vijf bestemmingen, elk met icoon en label. Actief: gevuld icoon op een pil, vet label. De + is verhoogd en is een actie, geen tab: hij opent een modaal scherm "Foto's toevoegen" met een zichtbare knop "Sluiten". Tabbalk-labels groeien hoogstens 1,2× mee; de tabbalk zelf groeit mee in hoogte.
3. **Elke tab heeft een eigen stack, en elk scherm in een stack een zichtbare terugknop** met de naam van het vorige scherm. Vegen vanaf de rand mag ook, maar is nooit de enige weg (WP-Design invariant 11).
4. **Geen ingelogd scherm zonder geldige sessie.** Alleen in de toestand "ready" van WP13 (`deriveAuthState`) rendert een ingelogd scherm. Dat geldt ook via een deep link, en ook na uitloggen via de terugknop of een veeggebaar. Na uitloggen is er geen weg terug naar een ingelogd scherm.
5. **Een live query loopt alleen voor het scherm in beeld, zolang de app actief is.** Een scherm zonder focus vraagt niets live op. Staat de app op de achtergrond (`AppState` niet `active`), dan loopt er geen enkele live query. Komt de app terug, dan krijgt het scherm in beeld verse data, zonder herstart en zonder opnieuw inloggen.
6. **Eén toegangspad voor live data.** Er is één manier waarop een scherm live Convex-data opvraagt, en die volgt invariant 5. Geen scherm gebruikt `useQuery` van Convex direct. Een feature-WP die dit omzeilt, laat een test falen.
7. **Deep links blijven open voor WP22 en WP19.** Elk scherm heeft een vaste route op scheme `clubalmanac`. Een nieuwe route (de login-link van WP22, een uitnodiging van WP19) erbij zetten verandert geen bestaande route.
8. **WP13 en WP-Design blijven werken.** De login-flow gedraagt zich hetzelfde, de bestaande tests in `app/tests/` blijven ongewijzigd groen, en schermen gebruiken alleen de tokens en componenten uit `app/src/theme` en `app/src/components`.
9. **iPad en liggend werken** (WP-Design invariant 6): de tabbalk blijft, niets valt weg.

## Edge cases + scope-uitsluitingen

**In scope:**
- Overstap van `index.ts` + `App.tsx` naar Expo Router, met de WP13-auth-poort ervoor
- Tabbalk, plusknop, terugknop-pil (design.md §5, §7)
- De vijf bestemmingen als lege schermen met de leeg-toestand uit WP-Design ("Komt in een volgende versie"). Uitzondering: Instellingen → "Over de app" (app-naam en versie) als echt stack-scherm, zodat de terugknop te testen is.
- Modaal "Foto's toevoegen" met "Sluiten", verder leeg
- Subscription-discipline (invarianten 5 en 6) en de bijbehorende tests
- Uitloggen bereikbaar vanaf Instellingen, zodat invariant 4 te testen is

**Te beslissen door A (spec-criticus):**
- Tik op de tab die al actief is: terug naar het begin van die stack (iOS-gewoonte)? Wat werkt voor 50+?
- Wat de Convex-client in de achtergrond doet met de verbinding zelf, los van de queries. Is "geen live query" genoeg om geen functieaanroepen meer te krijgen?
- Wat er gebeurt als de app na lange tijd terugkomt en het Clerk-token verlopen is
- Wat de pariteit-checklist van WP13 nog vraagt voor de tabbalk (landscape-menu van de oude app: vervalt door WP-Design invariant 6)

**Bewust niet:**
- Profiel, Instellingen-inhoud, Info-pagina's, `recordVisit`: WP15b
- Uitgelogde tabbalk (Inloggen · Uitnodiging · Info): WP15b (Info) en WP19 (Uitnodiging). Uitgelogd blijft in 15a het inlogscherm van WP13.
- Home opent de laatst bezochte groep: WP16
- Login-link die de app opent: WP22
- Backend-wijzigingen in `convex/`. Mist er iets: stop en meld aan regie.

## Risico-assessment

- **security/privacy: medium.** Invariant 4: een deep link of de terugknop mag geen ingelogd scherm tonen zonder sessie, ook niet heel kort.
- **ops: hoog.** Een live query op een scherm buiten beeld, of in de achtergrond, kost batterij en Convex-bandbreedte. Geen unit-test en geen user ziet dat. Daarom invariant 6 (één toegangspad, met test), een adversarial pass, en een meting in het Convex-dashboard bij de gate.
- **external deps: medium.** Expo Router en React Navigation binden alle volgende WP's. Versies vast, gekoppeld aan SDK 58.
- **multi-user/concurrency: laag.** Geen schrijfacties.
- **data/schema-evolutie: laag.** Geen schema-wijziging.
- **ops-runbook-impact:** geen env-vars. Wel: hoe je in het Convex-dashboard ziet of er live queries lopen (voor de gate en latere WP's). B zet dat in [`external-services.md`](../conventions/external-services.md) bij Convex.

## Werkwijze

| Stap | Rol | Output |
|---|---|---|
| 1 | regie | dit doc |
| 2 | A (`wp-a`), eigen sessie | spec-aanvulling (beslispunten hierboven, pariteit) + RED tests voor pure logica: de beslissing "live of niet" (focus × AppState × auth), de auth-poort per route, invariant 6 als test |
| 3 | B (`wp-b`), eigen sessie | impl tot groen, simulator-check licht en donker, runbook-regel |
| 4 | audit (`wp-audit`), eigen sessie | rapport in chat |
| 5 | red-team, eigen sessie | zoekt actief een pad waarop een live query blijft lopen buiten beeld of in de achtergrond, en een pad naar een ingelogd scherm zonder sessie. Rapport verbatim naar Wouter. |
| 6 | Wouter | gate |

## Cross-refs

- [`design.md`](../design.md) §5 (tabbalk, plusknop, terugknop), §7 (navigatie, Expo Router, subscription-discipline), §9 (iPad)
- [WP13](./WP13-app-scaffold-auth.md): `deriveAuthState`, invarianten 4, 10, 11, 13; §Pariteit-checklist (tabbalk)
- [WP-Design](./WP-Design.md): invarianten 6 en 11; gate-uitslag (stap 2–5 schuiven hierheen)
- [`migratie-status.md`](../migratie-status.md) §Fase 4 Track A, Subscription discipline
- Oude app (alleen A): `/Users/wintvelt/Documents/DEV/DEV/clubalmanac-app`, navigatie en tabbalk

## Acceptance

- App: typecheck en tests groen op Node 24, ook in CI. WP13- en WP-Design-tests ongewijzigd groen.
- Audit en red-team: geen open blockers
- **Empirische gate (Wouter, TestFlight-build op iPhone, met het Convex-dashboard open):**
  1. Tabbalk: vijf labels, wisselen werkt, de actieve tab is duidelijk
  2. Instellingen → Over de app → terugknop "‹ Instellingen" brengt je terug; vegen werkt ook
  3. + opent "Foto's toevoegen", "Sluiten" sluit het
  4. Uitloggen → inlogscherm. Terugvegen brengt je niet terug in de app.
  5. Dashboard: wissel van tab → de query van het vorige scherm stopt. App naar de achtergrond → geen live queries meer. App terug → het scherm heeft verse data.
  6. Uit WP-Design: licht/donker wisselen terwijl de app open is, icoon in donker, grootste tekststand, liggend
  7. Ruimte voor bevindingen buiten deze stappen
