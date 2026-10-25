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
| Users | Vooral 50+ (invariant 11) |
| Huisstijl en icoon | Beide laten zien: elke richting toont een icoon in het motief van het huidige (oranje/blauw, figuur) én een nieuw icoon. Wouter kiest bij stap 4. |

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
11. **Ontworpen voor 50+.** Tabbalk-iconen hebben altijd een tekstlabel. Een handeling zit nooit alleen achter een gebaar (vegen, lang drukken). Er is altijd ook een zichtbare knop of menu-ingang. De basis-tekstgrootte en het contrast kiest het design-doc met die doelgroep in gedachten, niet de iOS-standaard als vanzelfsprekend.

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
| 2. Screenshots oude app | Wouter | screenshots van de vijf kernschermen + tabbalk (1.6.0 staat nog op zijn telefoon), in `docs/design/oude-app/`. Die map is gitignored: de repo is publiek en de screenshots tonen echte clubleden en foto's. | — |
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

## Oude app visueel (A, 2026-10-25)

> Bron: de oude app `clubalmanac-app` (versie 1.6.0), alleen gelezen door A. Paden hieronder zijn relatief aan die repo. De styling loopt via `twrnc` (Tailwind-klassen in React Native) met de standaard Tailwind v3-palet. Er is geen eigen kleurconfig: `tailwind.config.js` legt alleen de lettertypen vast. De hex-waarden hieronder zijn de standaard Tailwind-waarden van de gebruikte klassen. Iconen en logo zijn gesampled uit de PNG's.

### 1. Kleuren

Het palet is in de praktijk drie families: **indigo** (merk en navigatie), **oranje** (actie) en **slate** (grijzen).

| Rol | Tailwind | Hex | Waar |
|---|---|---|---|
| Header / navigatiebalk | indigo-900 | `#312E81` | stack-header op alle schermen met header, banner achter de loginfoto, achtergrond van de camera en kaarten (`screens/NAVIGATOR.jsx`, `screens/Login.jsx`) |
| Headertekst en terug-pijl | white | `#FFFFFF` | header-titels, "‹ Terug" |
| Primaire knop | orange-600 | `#EA580C` | gevulde knop met witte tekst. Ingedrukt: orange-500 `#F97316` (`components/fields/Button.jsx`) |
| Secundaire knop | orange-600 op slate-50 | `#EA580C` / `#F8FAFC` | omlijnd, oranje tekst |
| Flat knop / tekstlink / actief accent | indigo-500 | `#6366F1` | tekstknoppen, links, actief tabicoon, focusrand van invoervelden, tab-indicator in Groep, aan-stand van schakelaar (`ButtonFlat.jsx`, `TabBar.jsx`, `Link.jsx`) |
| Lijst-iconen Profiel | indigo-600 | `#4F46E5` | iconen in de Profiel-menulijst |
| Lijst-iconen Instellingen/Info | orange-600 | `#EA580C` | iconen in de info-lijsten |
| Verwijderen / fout | red-600 | `#DC2626` | foutmelding onder velden, rode rand bij fout, "Account verwijderen", destructieve knop |
| Badge / teller | orange-600 | `#EA580C` | aantal nieuwe foto's op groep- en albumkaart, stip bij meldingen, "webmaster"-label |
| Admin-rij | orange-200 | `#FED7AA` | achtergrond van de admin-only menu-rij in Profiel |
| Succes | green-600 | `#16A34A` | vinkje "klaar" in de laadmodal |
| Tekst primair | slate-700 / slate-800 | `#334155` / `#1E293B` | lijstteksten, invoertekst, titels |
| Tekst secundair | slate-500 | `#64748B` | labels, placeholders, info-labels |
| Tekst gedempt / lege toestand | slate-400 | `#94A3B8` | "Je bent nergens lid", chevrons, placeholder-icoon |
| Achtergrond scherm | slate-50 | `#F8FAFC` | Inloggen, Mijn groepen, Groep |
| Achtergrond Profiel/Instellingen | navigatie-standaard | `#F2F2F2` | daar zet het scherm zelf geen kleur, dus is het de standaard van React Navigation |
| Kaarten / lijstrijen / tabbalk | white | `#FFFFFF` | |
| Lege foto / kaartvlak | slate-200 / slate-300 | `#E2E8F0` / `#CBD5E1` | |
| Veldrand | gray-300 | `#D1D5DB` | invoervelden zonder focus |
| Uitgeschakelde knop | slate-200 met slate-600 tekst | `#E2E8F0` / `#475569` | |
| Hulp-modal | slate-700 | `#334155` | donkere kaart met witte handschrift-tekst, over een half-transparant slate-50 vlak |
| Overlay's | zwart, transparant | `#00000044` tot `#000000EE` | 27% achter laad- en foutmodals, 47% over de loginfoto, verloop naar 73–93% zwart onder coverfoto's |

**Merkkleuren uit het icoon** (gesampled, `assets/icon.png`): oranje `#EF8954`, lichtblauw `#82C0CD`, donker marine `#383A6A`. Het woordmerk is `#EF8955`. Let op: de UI gebruikt deze merkkleuren nergens als token. De UI-oranje (`#EA580C`) is feller en roder dan het icoon-oranje, en de UI-indigo (`#312E81`) ligt dicht bij maar is niet gelijk aan het icoon-marine.

**Donkere modus: nee.** `app.json` zet `userInterfaceStyle` op `light`. Er is geen `useColorScheme` en er staan geen `dark:`-klassen in de code.

### 2. Typografie

- **Raleway Regular** is het enige lettertype van de UI (`font-sans`, `assets/fonts/Raleway-Regular.ttf`). Het wordt bij de start geladen, terwijl het splashscreen staat (`App.js`).
- **Indie Flower** (handschrift, `font-hand`) alleen in de eenmalige hulp-modals.
- **Ubuntu Mono** alleen voor logregels op het scherm Probleem melden.
- `Raleway-Bold.ttf` en `Raleway-Thin.ttf` staan in `assets/fonts/` maar worden niet geladen. In de praktijk is alles één gewicht (regular). Eén keer staat er `font-semibold`; open punt: hoe iOS dat zonder geladen bold-bestand rendert.
- **Groottes (pt):** knoppen en lijsten 16 (meest gebruikt), helper- en foutteksten 14, sub-regels op kaarten 12, groepsnaam op kaart 20, paginakop "Mijn groepen" 18, naam in profielheader 24, groepsnaam in groepsheader 30, "Welkom!" op login 30, emoji erboven 36. Waar geen grootte staat, is het de React Native-standaard van 14 pt.
- **Hoofdletters:** alle knoplabels (gevuld, omlijnd en flat) staan in hoofdletters, net als paginakoppen in de witte balk ("MIJN GROEPEN") en de tab-labels in Groep (ALBUMS, LEDEN …). Lijstteksten en headers niet.
- De code begrenst de iOS-tekstgrootte nergens. Open punt: hoe de oude app zich bij grote tekst gedroeg (veel vaste hoogtes, zie §4).

### 3. Iconen

- **Set:** Ionicons via `@expo/vector-icons`. Inactief de `-outline`-variant, actief de gevulde.
- **Tabbalk** (`components/nav/TabBar.jsx`), van links naar rechts: `home` · `image` (Mijn foto's) · `add` · `person` (Profiel) · `settings` (Instellingen). Grootte 24, actief indigo-500, inactief slate-700.
- De **+** is anders: een witte cirkel van 64 pt met een dunne slate-300-rand, die 16 pt boven de balk uitsteekt, met een groot plus-icoon (42 pt). Als je op het scherm Nieuwe foto's bent, krijgt de cirkel een indigo rand van 2 pt en wordt het icoon een pijl omlaag ("terug").
- **Geen labels** onder de iconen. De hulp-modal "Welkom" legde de vijf iconen eenmalig uit. In de staande stand is die modal uitgezet, met de opmerking dat hij problemen gaf bij een nieuwe login.
- De tabbalk is wit, zonder rand of schaduw, met 32 pt ruimte onder de iconen. **Landschap:** de balk verdwijnt. Rechtsonder staat een ronde knop (`grid-outline`) die vijf witte ronde knoppen met schaduw naar links laat uitschuiven.
- **Home** gaat naar de laatst bezochte groep (Albums) als die bekend is, en anders naar Mijn groepen.
- **Uitgelogd** is er een eigen tabbalk met drie iconen (`components/nav/TabBarPublic.jsx`): `log-in` (Inloggen) · een verhoogde cirkel met `mail-outline` (Berichten/uitnodiging) · `information-circle` (Info).

### 4. Vormtaal

- **Afrondingen:** 4 pt op knoppen en velden, 6 pt op modals en lijstblokken, volledig rond op badges, avatars, ronde icoonknoppen en de +. Groepskaarten zijn hoekig.
- **Schaduwen:** de standaard Tailwind-schaduw op modals, de witte kopbalk onder de profielheader, de groepsheader en de zwevende landschapsknoppen. Albumkaarten hebben een iets zwaardere schaduw.
- **Groepskaarten** (Mijn groepen): twee per rij (drie in landschap), 172 pt hoog, met een witte rand van 4 pt als passe-partout. De coverfoto vult de kaart, met een verloop naar zwart onderaan. Daarover in wit de groepsnaam (20 pt) en "Sinds <jaar> · <n> leden" (12 pt). Rechtsboven een oranje teller voor nieuwe foto's. Zonder cover: een slate-vlak met een grijs foto-icoon. Bij aanraken zoomt de foto licht in.
- **Albumkaarten:** afgerond, met schaduw en twee dunne grijze lijnen erboven, die een stapel foto's suggereren.
- **Lijsten** (Profiel, Instellingen, Info) lijken op iOS-instellingen: witte rijen in blokken met afgeronde hoeken op een lichtgrijze achtergrond. Elke rij heeft een gekleurd icoon links, tekst, en rechts een grijze chevron. Tussen de rijen zit 1 pt ruimte. Open punt: de scheidingslijn is in de code gedefinieerd zonder randdikte; vermoedelijk zie je alleen een kier in de achtergrondkleur, en geen lijn.
- **Headers met coverfoto:** de profielheader toont de eigen profielfoto, vergroot en vervaagd, als achtergrond. De groepsheader toont de coverfoto van de groep, met een verloop van rechts naar zwart links. Beide hebben witte tekst. Gewone stack-headers zijn effen indigo-900 met witte titel en een witte "‹ Terug" of sluit-kruis. Statusbalk-tekst is overal licht.
- **Knoppen** schalen bij indrukken kort op (5–10%).
- **Invoervelden:** wit, rand gray-300, 40 pt hoog, maximaal 352 pt breed en gecentreerd. Er is een zwevend label boven het veld zodra het gevuld is, en de foutmelding staat in rood eronder. Het wachtwoordveld heeft rechts een grijs vlak met een indigo oog-icoon.
- **Toestanden:** laden toont een witte afgeronde modal met spinner en label op een donkere waas. Een fout toont een witte modal met een oranje "SLUITEN"-knop. Een lege lijst toont een gecentreerd grijs icoon met twee grijze regels tekst. Een laadfout in een lijst toont grijze tekst, een 😱-emoji en een flat knop "OPNIEUW LADEN".

### 5. De drie ontbrekende schermen

**Inloggen** (`screens/Login.jsx`)
Van boven naar beneden:
1. Indigo-900 header met de titel "Inloggen" in wit.
2. Een banner van 128 pt hoog. Daarin een groepsfoto (`assets/clubalmanac.jpg`, toont echte personen) onder een zwarte waas van ongeveer 47%. Gecentreerd daarop het kleine app-icoon (48 pt) met het woordmerk ernaast.
3. Daaronder een slate-50 vlak met gecentreerd: een zwaai-emoji (36 pt), "Welkom!" (30 pt) en de regel "Log in om clubalmanac te gebruiken" (14 pt, zwart).
4. Een e-mailveld en een wachtwoordveld met oog-knop.
5. De volle-breedte oranje knop "LOG IN".
6. Twee kleine indigo tekstknoppen in hoofdletters onder elkaar: "WACHTWOORD VERGETEN" en "IK HEB EEN UITNODIGING".
7. Onderaan de publieke tabbalk (Inloggen · uitnodiging · Info).

Fouten verschijnen in rood onder het wachtwoordveld, of als iOS-alert met een emoji als titel. Tijdens het inloggen staat er een laadmodal "Inloggen..". De andere login-schermen (vergeten, nieuw wachtwoord, uitnodiging) hebben dezelfde banner. Let op: deze banner kan zo niet mee naar de nieuwe app, door invariant 8 en de echte personen op de foto.

**Mijn groepen** (`screens/Home.jsx`)
Van boven naar beneden:
1. Geen stack-header. Bovenaan de profielheader, 176 pt hoog: de vervaagde eigen profielfoto met een verloop naar bijna zwart. Linksonder een ronde avatar (48 pt), rechts daarvan de eigen naam (24 pt, wit) en "Lid sinds … · n foto's" (14 pt, wit).
2. Een witte balk met schaduw. Links "MIJN GROEPEN" in hoofdletters (18 pt, slate-700), rechts een flat indigo knop "+ NIEUWE GROEP" op een lichtindigo vlak (indigo-50 `#EEF2FF`).
3. Op slate-50 een raster van groepskaarten, twee per rij (zie §4), gesorteerd op datum. Openstaande uitnodigingen staan er niet tussen.
4. Bij een lege lijst: een wolkje-met-zon-icoon met "Je bent nergens lid / Maak anders je eigen groep" in grijs.
5. Onderaan de tabbalk.

In de oude app kom je hier via Home (als er nog geen home-groep is) of via Profiel → Mijn groepen.

**Profiel** (`screens/Profile.jsx`)
Van boven naar beneden:
1. Dezelfde profielheader als Mijn groepen.
2. Op de lichtgrijze achtergrond, maximaal 512 pt breed, vier witte lijstblokken met afgeronde hoeken:
   - **Gegevens:** rijen "email :" en "laatste bezoek :" met de waarde rechts, alles in slate-500 op 14 pt. Bij een webmaster staat er een oranje pil "webmaster".
   - **Menu:** Mijn groepen (`people-outline`) · Uitnodigingen (`mail-outline`) · Profiel aanpassen (`person-circle-outline`) · Wachtwoord aanpassen (`lock-closed-outline`), met indigo-600 iconen en grijze chevrons. "Meldingen ongepaste foto's" (`flag-outline`, met een oranje stip) verschijnt alleen als er meldingen zijn. "Beoordeel meldingen" (op een oranje-200 rij) verschijnt alleen voor admins.
   - **Uitloggen** (`exit-outline`), een losse rij zonder chevron.
   - **Account verwijderen** (`trash-outline`), helemaal in rood.
3. Onderaan de tabbalk.

### 6. App-icoon en logo

- **App-icoon** `assets/icon.png`, 1024×1024. Een diagonaal verloop van oranje (`#EF8954`, linksonder) naar lichtblauw (`#82C0CD`, rechtsboven). Daarop een dikke donkermarine lijntekening (`#383A6A`): een afgerond vierkant kader (een fotolijst), met daarin een figuur. Het hoofd is een cirkel met rechts een puntig staartje, als een tekstballon. De schouders zijn een wolkvormige boog die links door het kader heen breekt.
- **Formaten:** het PNG heeft een alfakanaal en zelf al afgeronde, transparante hoeken. Dat geldt ook voor `ItunesArtwork@2x.png`. In de native map `ios/clubalmanacapp/Images.xcassets/AppIcon.appiconset/` staan 14 formaten (20 tot 83,5 pt, @1x/@2x/@3x) plus het 1024-artwork. Er zijn geen varianten voor donker of getint. `assets/ca_icon.png` (128×128) en `assets/favicon.png` (128×128) zijn hetzelfde beeld. `assets/adaptive-icon.png` is nog de standaard Expo-placeholder (raster met cirkels).
- **Woordmerk:** "Club" (vet, geometrisch schreefloos) met daaronder, naar rechts ingesprongen, "Almanac" (regular), in oranje `#EF8955` op transparant. Het staat in `assets/ca_wordmark_dark.png` (1203×440), `ca_wordmark_white.png` (1206×439) en `ca_wordmark_sm.png` (89×32). Ondanks de namen zijn dark en white allebei oranje. Open punt: welk lettertype het woordmerk is, valt niet uit de code te halen. Het lijkt geen Raleway.
- **Splash** `assets/splash.png` (1284×2778, transparant op witte achtergrond volgens `app.json`): het woordmerk gecentreerd boven het icoon. De kleuren zijn hier iets verzadigder (oranje ongeveer `#FF8246`).

### 7. Hulpteksten en onboarding

Er zijn eenmalige hulp-modals: een donkere slate-700-kaart met witte handschrift-tekst (Indie Flower, 20–30 pt), emoji's, witte ronde icoonbolletjes en een knop "ik snap t". Ze staan bij de eerste groep, de fotolijst, een eigen foto en een gemelde foto. Via Instellingen → Helpteksten zet je ze weer aan.

### Open punten

- Rendering van `font-semibold` zonder geladen bold-bestand.
- Gedrag bij grote iOS-tekst. De code begrenst niets, maar veel hoogtes liggen vast.
- Hoe de scheidingslijn in de lijsten er echt uitziet. Vermoedelijk een kier, geen lijn.
- Het lettertype van het woordmerk.
- Het gebruikte twrnc-pakket staat niet lokaal geïnstalleerd. De hex-waarden zijn de standaard Tailwind v3-waarden en zijn niet tegen het pakket zelf gecontroleerd.
