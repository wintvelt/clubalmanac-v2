# WP-Design: Designstap (navigatie, thema, icoon)

> Regie-draft. Geen A→B→audit: er valt weinig te testen en het grootste risico is smaak en herkenbaarheid, en daar beslist Wouter. Zie §Werkwijze. Bewust zonder nummer (besluit Wouter 2026-10-25); de README zet hem vóór WP15.

## Productdoel

Elke feature-WP (15–21) bouwt zijn schermen in één herkenbare stijl en navigatie, zonder zelf stijl te verzinnen. De users herkennen na de cutover de structuur van de oude app in een fris jasje, en vinden hun weg zonder uitleg.

## Besluiten Wouter 2026-10-25

| Vraag | Besluit |
|---|---|
| Navigatie | Herkenbaar, fris jasje: de structuur van de oude app blijft |
| Output | Mockups én thema-code én app-icoon in `app/` |
| Dark mode | Ja, volgt de iOS-instelling |
| iPad / landscape | Alleen "werkt", geen eigen layout |

## Invarianten

1. **Herkenbare structuur.** De tabbalk heeft dezelfde vijf bestemmingen als de oude app: Home · Mijn foto's · + · Profiel · Instellingen. Een andere naam, volgorde of indeling kan alleen met een reden in het design-doc, en Wouter moet die goedkeuren.
2. **Eén bron voor stijl.** Kleuren, typografie, afstanden en afrondingen zijn tokens. Schermen en componenten gebruiken alleen tokens, geen losse kleurwaarden of lettergroottes. Een feature-WP die iets mist, vult de tokens aan in plaats van lokaal af te wijken.
3. **Licht en donker volgen iOS.** Elk kleurtoken heeft een waarde voor licht en voor donker. Wisselt de user tijdens gebruik van modus, dan volgt de app zonder herstart.
4. **Leesbaar voor iedereen.** Tekst haalt contrast WCAG AA in beide modi: 4,5:1 voor gewone tekst, 3:1 voor grote tekst en voor iconen die iets betekenen. Tekst schaalt mee met de iOS-tekstgrootte. Bij de grootste standaardstand (zonder de extra toegankelijkheidsstanden) wordt geen bedieningselement afgesneden of onbereikbaar. Aanraakvlakken zijn minstens 44×44 pt.
5. **Eén patroon voor toestanden.** Laden, leeg, fout en bevestiging zien er overal hetzelfde uit. Een melding staat direct onder de actie die hem veroorzaakte (vuistregel uit de WP13-gate).
6. **iPad en landscape werken.** Niets valt weg, overlapt of is onbereikbaar. Er is geen eigen layout. iPad-ondersteuning blijft aan (WP13 invariant 8a).
7. **App-icoon voldoet aan de App Store-eisen**, ook in de iOS-varianten voor donker en getint, als iOS die vraagt. Dezelfde bron levert alle formaten. Niemand tekent formaten met de hand na.
8. **Mockups bevatten geen echte data.** Geen namen, foto's of groepen uit de dev-seed of de oude app. Ook niet in een artifact dat privé blijft.
9. **WP13 blijft werken.** De bestaande schermen (login, statusschermen, home) krijgen het thema. Hun gedrag verandert niet, en de WP13-tests blijven groen.
10. **De navigatiekeuze houdt de deur open** voor wat al vastligt: schermen die bij wegnavigeren unmounten (subscription-discipline, WP15), deep links op scheme `clubalmanac` en de login-link van WP22. Het design-doc kiest de navigatiebibliotheek met reden. WP15 installeert hem.

## Edge cases + scope-uitsluitingen

**In scope:**
- Design-doc in `docs/design.md`: navigatiestructuur, tokens (licht + donker), typografie, lijst van basiscomponenten met hun toestanden, patroon voor meldingen, keuze navigatiebibliotheek, icoon
- Mockups van vijf kernschermen, licht en donker: Inloggen, Mijn groepen, Groep → albums, Album (fotoraster), Profiel. Plus de tabbalk.
- Thema-code in `app/`: tokens, volgen van de iOS-modus, de basiscomponenten (bestaande `Button` en `LinkButton` plus wat het doc vastlegt)
- App-icoon in `app/` en `app.json`
- WP13-schermen omgezet naar het thema

**Bewust niet:**
- Navigatie-skelet en echte tabbalk-schermen: WP15
- Feature-schermen: WP15–21
- Eigen iPad- of landscape-layout
- Splash-screen en App Store-screenshots: vóór de indiening (fase 5)
- Android en web
- Backend-wijzigingen. Vraagt het ontwerp iets dat de backend niet levert, dan stopt de sessie en meldt het aan regie.

**Let op:**
- Expo-iconen en lettertypen moeten in de build zitten. Een lettertype dat bij de start pas laadt, geeft een flits van het systeemlettertype.
- De oude app had eenmalige hulp-modals (WP13 pariteit-checklist). Het design-doc kiest of die terugkomen, en in welke vorm.

## Werkwijze

| Stap | Wie | Output | Toegang |
|---|---|---|---|
| 1. Draft-spec | regie | dit doc | — |
| 2. Screenshots oude app | Wouter | screenshots van de vijf kernschermen + tabbalk (1.6.0 staat nog op zijn telefoon), in `docs/design/oude-app/`. Echte namen en foto's onherkenbaar maken of weglaten. | — |
| 3. Twee à drie richtingen | design-sessie, fresh | mockups (artifact) + korte toelichting per richting. Elke richting houdt invariant 1 aan. | spec + screenshots, geen oude code |
| 4. Keuze | Wouter | één richting, met aanpassingen | — |
| 5. Toegankelijkheidscheck | fresh criticus | rapport in chat: contrast, tekstgrootte, aanraakvlakken van de gekozen richting | spec + mockups, geen code |
| 6. Design-doc | design-sessie | `docs/design.md` met de gekozen richting en de criticus-punten verwerkt | — |
| 7. Thema-code + icoon | B-sessie (`wp-b`) | code in `app/`, tests, runbook-regel | spec + design-doc, geen oude code |
| 8. Review + gate | regie, Wouter | — | — |

Na stap 4 en 6 reviewt regie of de spec nog klopt.

## Risico-assessment

- **security/privacy: laag.** Geen data. Invariant 8 houdt echte gegevens uit mockups en screenshots.
- **ops: laag.** Geen backend, geen env-vars.
- **external deps: medium.** De navigatiebibliotheek bindt alle volgende WP's (invariant 10). Versies vastzetten.
- **multi-user/concurrency: laag.**
- **data/schema-evolutie: laag.**
- **product/UX: hoog.** Bij een harde cutover is er geen terugweg naar de oude app, dus een onherkenbare navigatie verwart users (invariant 1). Toegankelijkheid staat als cross-cutting gat in [`audit-track-record.md`](../conventions/audit-track-record.md) (invariant 4, stap 5). Geen adversarial pass: het risico zit in smaak en herkenbaarheid, en daar beslist Wouter op basis van mockups.
- **ops-runbook-impact:** geen env-vars. Het icoon en eventuele lettertypen zijn assets in `app/`. Krijgt een EAS-build daardoor een nieuwe stap, dan komt die in [`external-services.md`](../conventions/external-services.md) §EAS-build en TestFlight.

## Cross-refs

- [WP13](./WP13-app-scaffold-auth.md) §Pariteit-checklist Track A (schermen en tabbalk van de oude app), invarianten 8a en 8b
- [WP14](./WP14-eas-testflight-spike.md) §Uitkomsten spike (leeg app-icoon)
- [`migratie-status.md`](../migratie-status.md) §Fase 4 Track A, subscription-discipline
- [`audit-track-record.md`](../conventions/audit-track-record.md) §Cross-cutting gaps

## Acceptance

- `docs/design.md` staat er, met de gekozen richting en de verwerkte criticus-punten
- App: typecheck en tests groen. Pure logica krijgt tests, minimaal: elk tekst/achtergrond-tokenpaar haalt de contrastnorm van invariant 4 in licht én donker. De test berekent het contrast met de WCAG-formule, niet tegen een tabel uit de tokens zelf.
- WP13-tests ongewijzigd groen
- **Empirische gate (Wouter, TestFlight-build op iPhone):**
  1. Login- en homescherm in het nieuwe thema, licht en donker
  2. Wissel van modus terwijl de app open is → de app volgt
  3. iOS-tekstgrootte op de grootste standaardstand → alles leesbaar en bereikbaar
  4. App-icoon op het beginscherm, licht en donker
  5. iPad of landscape → niets valt weg
  6. Ruimte voor bevindingen buiten deze stappen

## Open vragen (Wouter, vóór stap 3)

1. **Wie zijn de users?** Ongeveer welke leeftijd en hoe handig met techniek? Dat bepaalt de basis-tekstgrootte en hoeveel uitleg in de app staat.
2. **Huisstijl en icoon.** Is er een logo of kleur om aan vast te houden? Houdt het nieuwe icoon het motief van het huidige (oranje/blauw, figuur), of mag het helemaal nieuw?
