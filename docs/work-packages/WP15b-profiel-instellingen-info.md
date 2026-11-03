# WP15b: Profiel, Instellingen, Info, recordVisit

> Regie-draft. App-WP (zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4)), met een klein backend-deel. Eigen sessie per rol. Bouwt op [WP15a](./WP15a-navigatie-subscriptions.md).

## Productdoel

Een ingelogde user ziet zijn naam en e-mailadres op Profiel en kan zijn naam wijzigen. Op Instellingen vindt hij uitloggen en de info over de app. Uitgelogd kan hij de info ook lezen, via een eigen tab naast Inloggen. De app onthoudt wanneer de user er voor het laatst was, zonder dat hij dat ziet.

## Invarianten

1. **Naam wijzigen werkt, en de backend bewaakt de naam.** Een lege naam, een naam van alleen spaties, een te lange naam of een naam met controletekens wordt in `users.updateProfile` geweigerd. Een UI-check staat daar hooguit extra naast. De user ziet een NL-melding onder het veld (design.md §6). Spaties aan het begin en eind worden niet bewaard. Gemigreerde namen blijven zoals ze zijn, tot de user ze zelf wijzigt.
2. **Een gewijzigde naam is meteen overal te zien**, ook bij andere leden, zonder herstart.
3. **Profiel toont geen "laatste bezoek"** (besluit 2026-11-02). Ook geen profielfoto uploaden (WP18) en geen account verwijderen (eigen WP).
4. **Info is ingelogd en uitgelogd hetzelfde, en toont geen user-gegevens.** Uitgelogd bestaat de tabbalk uit Inloggen en Info. Uitnodiging komt met WP19. Elke Info-route is publiek (`PUBLIC_PATHS`), en een publieke route rendert niets uit de sessie.
5. **Een bezoek registreren gebeurt hoogstens één keer per vaste periode per user, ook als de client vaker vraagt.** Een bezoek is een terugkeer naar `active` terwijl de user ingelogd is. Een mislukte registratie merkt de user niet, en die levert geen poging-lus op.
6. **Een bezoek registreren laat geen live query opnieuw draaien.** Wat een scherm of de poort live toont, verandert niet door `lastVisitAt`.
7. **De tabwissel is meetbaar.** Minstens één scherm in deze WP heeft een eigen live query, via `useLiveQuery`. Die query mag niet identiek zijn aan `users.current` van de poort, want Convex voegt identieke abonnementen samen. Wissel je van tab, dan stopt die query.
8. **WP15a en WP13 blijven werken.** De bestaande tests in `app/tests/` en root-`tests/` blijven ongewijzigd groen. Schermen gebruiken alleen tokens en componenten uit `app/src/theme` en `app/src/components`, en `Screen` voor `reconnecting`.

## Edge cases + scope-uitsluitingen

**In scope:**
- Profiel: naam en e-mailadres tonen, naam wijzigen (laden, opslaan, fout, bevestiging onder de knop, design.md §6)
- Instellingen: uitloggen, "Over de app" (bestaat al), en de instellingen die de oude app had, voor zover ze nu zin hebben
- Info-pagina's, ingelogd en uitgelogd
- De uitgelogde tabbalk: Inloggen · Info
- `recordVisit` met throttle, en de keuze waar `lastVisitAt` wel en niet zichtbaar is
- Backend: naamvalidatie in `users.updateProfile`. Ook een query of een vorm voor het profiel als invariant 6 of 7 dat vraagt.
- design.md §10 nr. 14: de `Notice`-titel breekt bij xxxLarge niet midden in een woord

**Te beslissen door A (spec-criticus, leest de oude app):**
- Welke Info-pagina's had de oude app (bijvoorbeeld Over, privacy, voorwaarden, help of contact)? Welke tekst was er, en wat klopt na de migratie niet meer? Denk aan AVG, verwerkers (Convex, Clerk, Mailjet) en het contactadres.
- Welke instellingen had de oude app, en welke vervallen?
- Wat de oude app met de naam deed: maximale lengte, verplicht of niet, waar hij zichtbaar was
- Hoe invariant 6 en 7 samen gaan, bijvoorbeeld:
  - een eigen profielquery naast een smallere `users.current`;
  - `lastVisitAt` uit de vorm van `users.current` halen.

  Dit raakt de vorm van WP23 (`ownProfile`) en de poort van WP15a.
- De periode voor de throttle, en waar de throttle zit: in de client, in de backend, of in allebei
- Of het e-mailadres op Profiel te wijzigen is. Nu is dat niet zo: het wijzigen gaat via Clerk en hoort bij de login.

**Bewust niet:**
- Profielfoto uploaden of wijzigen: WP18
- Account verwijderen: eigen WP (backend: de Clerk-user mee verwijderen, plus een nieuwe bevestiging)
- Uitnodiging in de uitgelogde tabbalk: WP19
- E-mailadres wijzigen
- Push-meldingen en meldingsinstellingen

## Risico-assessment

- **security/privacy: medium.**
  - Andere leden zien je naam (WP23 `publicProfile`). Daarom is validatie in de backend verplicht, niet alleen in de UI (invariant 1).
  - Publieke Info-routes mogen niets uit de sessie tonen (invariant 4).
  - De privacytekst moet kloppen met de verwerkers na de migratie.
- **ops: medium.**
  - `recordVisit` schrijft bij elke terugkeer naar de app.
  - Zit `lastVisitAt` in een live vorm, dan draait die query bij elk bezoek opnieuw (invariant 6).
  - Een throttle in de backend beschermt tegen een client in een lus (invariant 5).
  - Dit is de eerste echte tabwissel-meting (invariant 7).
- **external deps: laag.** Geen nieuwe dienst. Hooguit een `mailto:`-link of een externe link op een Info-pagina.
- **multi-user/concurrency: laag.** Alleen de eigen rij. Twee toestellen die tegelijk de naam wijzigen: de laatste wint.
- **data/schema-evolutie: laag.** Geen schemawijziging verwacht. De validatie geldt alleen bij schrijven.
- **ops-runbook-impact:** geen env-vars. Wel krijgt `external-services.md` §Convex een regel over hoe je `recordVisit` en de tabwissel in het dashboard ziet. B levert die mee.

## Werkwijze

| Stap | Rol | Output |
|---|---|---|
| 1 | regie | dit doc |
| 2 | A (`wp-a`), eigen sessie | spec-aanvulling (beslispunten hierboven, pariteit-checklist per scherm) en RED tests: backend-naamvalidatie, de throttle van `recordVisit`, de vorm van `users.current` en het profiel (invariant 6 en 7), en `PUBLIC_PATHS` en routes voor Info |
| 3 | B (`wp-b`), eigen sessie | impl tot groen (backend en app), simulator-check in licht en donker en bij xxxLarge, runbook-regel |
| 4 | audit (`wp-audit`), eigen sessie | rapport in chat |
| 5 | Wouter | gate |

Er is geen red-team: geen enkele dimensie is hoog. Vindt de audit iets in de auth-poort of in de subscriptions, dan beslist regie opnieuw.

## Cross-refs

- [WP15a](./WP15a-navigatie-subscriptions.md): `useLiveQuery`, `PUBLIC_PATHS`, `routeFiles.test.ts`, `Screen` in `reconnecting`, besluit 5 (tabwissel)
- [WP23](./WP23-read-whitelist.md): `ownProfile` en `publicProfile` in `convex/lib/shapes.ts`
- [`migratie-plan-convex.md`](../migratie-plan-convex.md) §User visit tracking
- [`design.md`](../design.md) §5, §6, §7, §9, §10 nr. 14
- [`external-services.md`](../conventions/external-services.md) §Convex (live queries meten)
- Oude app (alleen A): `/Users/wintvelt/Documents/DEV/DEV/clubalmanac-app`, schermen Profiel, Instellingen, Info en de uitgelogde tabbalk

## Acceptance

- Root en app: typecheck en tests groen op Node 24, ook in CI. WP13-, WP15a- en WP23-tests blijven ongewijzigd groen.
- Audit: geen open blockers.
- **Empirische gate (Wouter, TestFlight-build, met het Convex-dashboard open):**
  1. Profiel toont je naam en e-mailadres. Wijzig je naam: er verschijnt een bevestiging onder de knop. Log in als dev2: die user ziet de nieuwe naam (zodra er een scherm met leden is, anders in het dashboard).
  2. Een lege naam, of een naam van alleen spaties, geeft een melding onder het veld, en er wordt niets opgeslagen.
  3. Dashboard, tabwissel: open Profiel en wissel naar een andere tab. De profielquery stopt: een wijziging in je rij geeft geen uitvoering meer. Terug op Profiel: één uitvoering.
  4. Dashboard, `recordVisit`: open de app een paar keer kort na elkaar. Er komt hoogstens één schrijfactie per periode, en er volgt geen extra `users:current`.
  5. Instellingen: uitloggen werkt, en "Over de app" opent.
  6. Uitgelogd: de tabbalk toont Inloggen en Info. Info opent en toont geen user-gegevens.
  7. Info en Profiel bij de grootste tekst, in licht en donker. De `Notice`-titel breekt niet midden in een woord.
  8. Ruimte voor bevindingen buiten deze stappen

---

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft.)
