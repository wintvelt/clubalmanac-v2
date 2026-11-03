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
  5. Dashboard: app naar de achtergrond → geen live queries meer. App terug → één uitvoering, verse data. (Tabwissel → naar WP15b, zie besluit 5.)
  6. Uit WP-Design: licht/donker wisselen terwijl de app open is, icoon in donker, grootste tekststand, liggend
  7. Ruimte voor bevindingen buiten deze stappen

## Spec-criticus aanvullingen (A, 2026-11-02)

Bronnen: oude app `clubalmanac-app` (`screens/NAVIGATOR.jsx`, `components/nav/TabBar.jsx`, `App.js`), de huidige `app/` (WP13, WP-Design) en de Convex-client `convex@1.45.0` in `app/node_modules/convex/dist/esm/browser/sync/`.

### Hoe de oude app navigeerde

- **Eén platte stack** voor alle ingelogde schermen, geen echte tabs. De tabbalk was een component dat bijna elk scherm zelf onderaan zette, ook diepe schermen (Foto's, Foto-detail).
- **Een tik op een tab** deed `navigate(<naam>)`. Je ging dus altijd naar het begin van die bestemming. Er was geen eigen stack per tab.
- **Ingelogd en uitgelogd** hadden elk een eigen navigatie-container, met de user-id als scherm-id. Commentaar in de code: anders gaf in- en uitloggen "funny issues". Er bleef dus niets van de vorige user in de navigatie hangen.
- **Geen AppState, geen focus.** De oude app pauzeerde niets bij achtergrond of een ander scherm.

### Beslissingen op "Te beslissen door A"

**1. Tik op de tab die al actief is: terug naar het begin van die stack.**

| Situatie | Gedrag |
|---|---|
| Tik op een andere tab | Die tab opent zoals je hem verliet (iOS-gewoonte, design.md §7: eigen stack per tab) |
| Tik op de actieve tab, dieper in de stack | Terug naar het begin van die tab, in één stap |
| Tik op de actieve tab, al aan het begin | Er gebeurt niets. Naar boven scrollen is voor de WP die een lijst bouwt. |

Waarom: voor 50+ is "tik op Home en je bent thuis" de nooduitgang als je verdwaald bent. Dat deed de oude app ook. Afwijking van de oude app: een andere tab onthoudt nu waar je was. Zie open vraag 1.

**2. De verbinding van de Convex-client in de achtergrond.**

Wat de client doet (gelezen in `convex@1.45.0`):
- De client kent geen AppState. De WebSocket blijft open zolang het OS dat toelaat, ook als er geen enkele query loopt.
- Zonder queries draait de server geen query-functies. Dus geen functieaanroepen en geen databandbreedte voor queries. Wel blijft er een klein verkeer: pings van de server, en het verversen van het Clerk-token vlak voor het verloopt (een aanroep naar Clerk plus een `Authenticate`-bericht naar Convex). Dat zijn geen Convex-functieaanroepen.
- In de achtergrond zet iOS de JS na korte tijd stil. Timers lopen dan niet, en het OS sluit de socket vroeg of laat. Komt de app terug, dan maakt de client zelf weer verbinding.
- `ConvexReactClient.close()` is definitief. Daarna moet er een nieuwe client komen, en zakt de auth-toestand terug naar "laden".

Beslissing: **"geen live query" is genoeg** voor invariant 5. De app sluit de verbinding niet bij achtergrond. Een nieuwe client per terugkeer zou de auth-poort laten flitsen en de navigatie-stack kosten (zie invariant 12 hieronder). De gate meet functieaanroepen in het dashboard, niet sockets.

**3. Terug na lange tijd, met een verlopen token.**

| Wat is verlopen | Gedrag |
|---|---|
| Alleen het korte Clerk-token (JWT) | Normaal; dat gebeurt bij elke terugkeer. De client haalt een nieuw token. De user ziet hetzelfde scherm met dezelfde stack. Geen inlogscherm, geen melding "server weigert je sessie". |
| De Clerk-sessie zelf (lange inactiviteit, ingetrokken in het dashboard, account weg) | Inlogscherm. De stack vervalt. Na opnieuw inloggen begint de app op Home. Kort "Laden…" ervoor mag. |
| Geen netwerk bij terugkeer | Geen uitlog. Kop en tabbalk blijven staan; het inhoudsgebied toont laden of een fout met "Opnieuw" (design.md §6). |

Risico voor B en red-team: bij een verlopen sessie merkt Convex het mogelijk eerder dan Clerk. Dan valt `useConvexAuth` op "niet geauthenticeerd" terwijl Clerk nog "ingelogd" zegt. Dat is de toestand `convexAuthFailed` van WP13, met de tekst "server weigert je sessie". Die tekst is voor een blijvende weigering bij een geldige sessie, niet voor een sessie die net verliep. De user mag hem in dit geval niet blijvend zien.

**4. Pariteit tabbalk.**

| Oude app | Nieuw (15a) |
|---|---|
| Alleen iconen, geen labels | Icoon plus label (design.md §5) |
| Actief: gevuld icoon in indigo | Gevuld icoon op de `tabPill`-pil, vet label |
| Tabbalk op bijna elk scherm, ook diepe | Tabbalk op elk scherm in een tab-stack. Niet in de modaal. |
| + werd chevron-omlaag op het toevoeg-scherm; nog een tik = terug | + opent een modaal met "Sluiten". De tabbalk is dan niet te zien, dus geen wisselend icoon. |
| + gaf de huidige groep en het album mee | Vervalt in 15a. Context meegeven is WP18; de route laat ruimte voor optionele parameters. |
| Home = laatst bezochte groep, anders Mijn groepen | WP16. In 15a is Home een leeg scherm. |
| Liggend: inklapbaar rondmenu rechtsonder | Vervalt. De tabbalk blijft, ook liggend en op iPad (WP-Design invariant 6). |
| Hulp-modal bij de tabbalk (al uitgezet in de oude app) | Vervalt (design.md §6) |

### Routes (deep links liggen hiermee vast)

| Scherm | Pad op `clubalmanac://` | Toegang |
|---|---|---|
| Inloggen | `/inloggen` | alleen uitgelogd |
| Home | `/` | ingelogd |
| Mijn foto's | `/mijn-fotos` | ingelogd |
| Profiel | `/profiel` | ingelogd |
| Instellingen | `/instellingen` | ingelogd |
| Over de app | `/instellingen/over` | ingelogd |
| Foto's toevoegen (modaal) | `/toevoegen` | ingelogd |
| Elk ander pad | — | ingelogd. Ingelogd toont het een scherm "Niet gevonden" met een knop naar Home. |

Een pad is pas publiek als een WP het expliciet publiek maakt. Een nieuw of onbekend pad is dus standaard afgeschermd. Zo kan WP19 of WP22 een publieke route toevoegen zonder iets aan bestaande routes te veranderen (invariant 7).

### Aanvullende invarianten

10. **De auth-poort per route kent vier uitkomsten buiten "tonen"**: wachten, inloggen, naar Home, of het WP13-statusscherm.
    - *Laden*: een laadscherm. Geen ingelogd scherm, geen tabbalk, en ook geen inlogscherm. Een deep link bij een koude start gaat zo niet verloren aan een tussentijdse doorverwijzing.
    - *Uitgelogd* op een afgeschermd pad: het inlogscherm.
    - *Ingelogd* op `/inloggen`: naar Home.
    - *Convex weigert het token* of *geen rij*: de bestaande WP13-schermen, op elk pad. Geen tabbalk.
11. **Geen navigatie van de vorige user.** Log in als A, ga naar Instellingen → Over de app, log uit, log in als B: B begint op Home, met lege stacks. Geen tab onthoudt iets van A.
12. **Terug uit de achtergrond met een geldige sessie: hetzelfde scherm, dezelfde stack.** Ook de query achter de auth-poort (`users.current`) pauzeert in de achtergrond (invariant 5). Dat pauzeren mag de poort niet naar "laden" laten vallen: dan zou de router de stack weggooien of kort het inlogscherm tonen. De laatst bekende rij geldt tot de verse er is. Dit geldt ook voor schermen: een scherm dat weer focus krijgt, toont zijn laatste data tot de verse er is, in plaats van een laadflits. Dat oude data mag blijven staan, geldt alleen binnen één Clerk-sessie (WP13 invariant 13).
13. **Een modaal neemt de focus.** Staat "Foto's toevoegen" open, dan heeft het scherm eronder geen focus en vraagt het niets live op, ook als het half zichtbaar is. Na "Sluiten" (of omlaag vegen) sta je weer op hetzelfde scherm, en dat krijgt verse data.
14. **Elke AppState behalve `active` pauzeert.** Dat geldt ook voor `inactive`: Bedieningspaneel, app-wisselaar, een binnenkomend gesprek. Een onbekende of nieuwe waarde telt ook als niet-actief. Prijs: na elke korte onderbreking draait elke query van het scherm in beeld één keer opnieuw. Zie open vraag 3.
15. **Een deep link naar een dieper scherm heeft een terugknop.** `clubalmanac://instellingen/over` opent, ook bij een koude start, met Instellingen eronder. "‹ Instellingen" werkt dus direct (invariant 3).
16. **De tabbalk is toegankelijk.** VoiceOver leest per tab het label en of hij gekozen is. De + heet "Foto's toevoegen" en is een knop, geen tab.

### Edge cases

- **Uitgelogd een deep link openen** (bv. `clubalmanac://instellingen/over`): het inlogscherm. Na inloggen gaat de app naar Home. Het doel van de link onthouden is voor WP19 en WP22.
- **Dubbel tikken op +**: één modaal, niet twee op elkaar.
- **Tab wisselen terwijl een scherm nog laadt**: de query van dat scherm stopt toch. Er blijft geen abonnement hangen omdat het antwoord nog niet binnen was.
- **Snel heen en weer tussen tabs**: elke wissel stopt de oude query en start de nieuwe. Er stapelen zich geen abonnementen op.
- **Uitloggen terwijl een modaal open is**: kan in 15a niet (uitloggen zit op Instellingen), maar de poort vangt het toch: geen ingelogd scherm meer, ook de modaal niet.
- **Liggend draaien met een modaal open**: de modaal blijft, "Sluiten" blijft zichtbaar.

### Contract voor A's tests (pure logica)

Tests staan in `app/tests/`, net als bij WP13: vitest in Node, zonder React Native. De bestandsnamen hieronder liggen vast omdat de tests ze importeren of lezen.

| Module | Signatuur | Pint |
|---|---|---|
| `app/src/lib/liveQuery.ts` | `screenQueryIsLive(input: { focused: boolean; appState: string; authState: AuthState }): boolean` | Invarianten 5, 13, 14. Live alleen bij focus, AppState `active` en auth `ready`. `appState` is de waarde van React Native `AppState`; elke andere of onbekende waarde betekent niet live. |
| `app/src/lib/liveQuery.ts` | `sessionQueryIsLive(input: { appState: string; clerkLoaded: boolean; clerkSignedIn: boolean; convexAuthLoading: boolean; convexAuthenticated: boolean }): boolean` | Invarianten 5 en 12, voor de ene query achter de auth-poort (`users.current`). Die hangt niet van focus af: hij staat boven de navigatie. Live alleen bij AppState `active`, Clerk geladen en ingelogd, en Convex klaar en akkoord. |
| `app/src/lib/routeAccess.ts` | `routeAccess(pathname: string, authState: AuthState): "show" \| "wait" \| "login" \| "home" \| "convexAuthFailed" \| "noUserRow"` | Invarianten 4 en 10 en de routetabel. `pathname` zoals Expo Router hem geeft (zonder scheme en query). Een slash aan het eind telt niet mee. Publiek is alleen een exacte match, geen voorvoegsel: `/inloggen-x` is afgeschermd. |
| (geen module) | `app/tests/liveQueryAccess.test.ts` | Invariant 6. Leest de broncode van `app/`. Alleen `app/src/data/useLiveQuery.ts` mag live Convex-hooks importeren (`useQuery`, `useQueries`, `usePaginatedQuery`, `usePreloadedQuery`) of `watchQuery` / `onUpdate` gebruiken. Dat bestand gebruikt de beslissing uit `src/lib/liveQuery.ts`. Dit geldt ook voor de auth-poort: die gebruikt nu nog `useQuery` direct. |

`AuthState` is het type uit `app/src/lib/authState.ts` (WP13). De tests pinnen de beslissing, niet hoe de hook focus of AppState uitleest. Of de hook die beslissing echt volgt, zien audit, red-team en de gate in het dashboard.

### Ops-runbook (aanvulling op B's regel in `external-services.md`)

- Meet in het Convex-dashboard **functieaanroepen per functie** (Logs / Functions), niet het aantal verbindingen. Een open socket zonder queries kost geen functieaanroepen.
- Verwacht bij elke tabwissel en elke terugkeer uit de achtergrond één nieuwe uitvoering per query van het scherm in beeld, plus één van `users.current`. Daarna niets meer, tot de data verandert.

### Open vragen voor regie / Wouter

1. **Tab wisselen onthoudt de stack** (iOS), waar de oude app elke tab-tik naar het begin bracht. Een tik op de actieve tab brengt je wel altijd naar het begin. Goed zo voor 50+, of altijd naar het begin? Te zien bij gate-stap 1.
2. **Nederlandse paden** (`/mijn-fotos`, `/instellingen/over`). Ze zijn niet zichtbaar voor de user, maar liggen vast zodra er links in mails staan. Akkoord?
3. **Pauzeren bij `inactive`** volgt de spec letterlijk. Elke keer dat iemand het Bedieningspaneel opent, draait de query van het scherm daarna één keer opnieuw. Klein, maar zichtbaar in het dashboard.
4. **Hoe lang een Clerk-sessie geldig blijft**, staat in het Clerk-dashboard, niet in de app. Dat bepaalt hoe vaak een 50+-user opnieuw moet inloggen. Graag nagaan vóór de cutover; niet in 15a.

### Besluiten Wouter op A's open vragen (2026-11-02)

| Vraag | Besluit |
|---|---|
| 1. Tab wisselen | Onthouden (iOS). Tik op de actieve tab = naar het begin. |
| 2. Nederlandse paden | Akkoord |
| 3. Pauzeren bij `inactive` | Ja: alles behalve `active` pauzeert |
| 4. Duur Clerk-sessie | Naar fase 5 (T-4 weken, prod-Clerk-config), niet in 15a |
| 5. Gate-stap 5, tabwissel | Naar WP15b: de tabschermen in 15a hebben nog geen query. WP15b meet het bij de eerste schermquery. |
| 6. Offline terug uit de achtergrond (audit) | Fixen in 15a. De rij "Geen netwerk bij terugkeer" in §3 geldt. |
| 7. Red-team punt 4 (routebestand buiten de poort) | Fixen in 15a |
| 8. Red-team punt 5 (live query in tabbalk of kop) | Alleen een regel in design.md §7 |

## Fix-cyclus na audit en red-team

| # | Bron | Probleem | Wat er waar moet zijn |
|---|---|---|---|
| F1 | red-team 1 (blocker), audit | Eén mislukte tokenophaal (offline, terug uit de achtergrond of bij een koude start) zet de app blijvend op "server weigert je sessie" | Er komt geen uitlog. Bij een tijdelijke fout blijven kop en tabbalk staan, en het inhoudsgebied toont laden of een fout met "Opnieuw". Na terugkeer van het netwerk of naar `active` probeert de app het token opnieuw. Alleen een weigering terwijl er wel netwerk is, toont het WP13-foutscherm. |
| F2 | red-team 2, audit | `useSessionQuery` is een generieke omweg langs focus | Alleen de poort kan een query buiten focus om draaien, en alleen `users.current` |
| F3 | red-team 3 | `liveQueryAccess.test.ts` mist 9 realistische omwegen | De test vangt alle 9 omwegen uit de tabel van de red-team |
| F4 | red-team 4, audit (kan) | Een route buiten `Stack.Protected` is onbeschermd. Bij "login" blijft dan "Laden…" staan | Elk routebestand is afgeschermd of staat in `PUBLIC_PATHS`, gepind met een test. Bij "login" en "home" leidt de poort zelf om. |
| F5 | audit | `react-native-gesture-handler` 3.4.0, `react-native-reanimated` en `react-native-worklets` staan alleen als peer in de lockfile | Ze staan vast in `package.json` op de SDK 58-versie, via `npx expo install`. `npx expo-doctor` is schoon voor deze pakketten. |

Werkwijze: A schrijft RED tests voor F1–F4, waar dat met pure logica of een scanner kan. Daarna fixt B F1–F5. Dan volgen een frisse heraudit en een hercheck door de red-team op F1–F4.

### Fix-cyclus: aanvulling A (2026-11-02)

**F1: tijdelijk geen token is geen weigering.** Er komt een zesde toestand, `reconnecting` ("opnieuw verbinden"), boven op de vijf van WP13. `deriveAuthState` en de WP13-tests blijven ongewijzigd. Een nieuwe functie bouwt erop voort en kent twee extra signalen:
- *tokenophaal mislukt*: de laatste poging om een Clerk-token voor Convex te halen gaf een fout of geen token;
- *online*: het toestel heeft netwerk. Onbekend telt als niet online.

| WP13 zegt | Signalen | Toestand |
|---|---|---|
| `convexAuthFailed` | tokenophaal mislukt, of niet online | `reconnecting` |
| `convexAuthFailed` | token wel opgehaald, en online | `convexAuthFailed` (WP13-foutscherm) |
| iets anders | — | ongewijzigd |

- **Invariant 4 verruimd.** In `reconnecting` rendert de navigator wel: kop, tabbalk en wat er van deze sessie nog staat. Er loopt geen live query, ook niet `users.current` (Convex heeft dan geen identiteit, en `users.current` zou `null` geven en "geen rij" tonen). Het inhoudsgebied toont laden of een fout met "Opnieuw".
- **Opnieuw proberen.** In `reconnecting` doet de app een nieuwe poging zodra de app actief én online wordt, vanuit een moment waarop dat niet zo was. Een eenmalige Clerk-fout terwijl de app actief en online blijft, geeft dus geen automatische poging: de user tikt dan op "Opnieuw".
- `routeAccess` in `reconnecting`: afgeschermd pad → tonen, `/inloggen` → naar Home.

**F2: alleen `users.current` loopt buiten focus.** De beslissing voor de sessie-query krijgt de functienaam van de query mee (zoals `getFunctionName` hem geeft). Alleen `users:current` kan live zijn. Daarnaast mag alleen `src/AuthGate.tsx` iets anders dan `useLiveQuery` uit het toegangspad importeren.

**F3: de scanner leest de syntaxboom, niet de tekst.** De test gebruikt de TypeScript-parser. Daardoor maken spaties, commentaar en puntkomma's niet meer uit. Hij vangt:
- live hooks uit `convex`, `convex-helpers` en `@convex-dev`;
- elke import uit `convex-helpers/react…` en `@convex-dev/react-query`;
- de client-leden `watchQuery`, `watchPaginatedQuery`, `prewarmQuery`, `paginatedQueryClient`, `sync` en `onUpdate`, ook via `x["…"]`;
- mappen `tests` en `dist` op elke diepte.

Alleen `tests/` en de andere mappen in de wortel van `app/` vallen buiten de scan. Eenmalig lezen (`useConvex().query`) en `connectionState` / `subscribeToConnectionState` blijven toegestaan.

**F4: elk routebestand is gedekt.** `PUBLIC_PATHS` wordt geëxporteerd uit `src/lib/routeAccess.ts`. Een routebestand in `src/app/` is gedekt als hijzelf, of een map erboven, in de `_layout` van zijn ouder als `*.Screen` binnen een `*.Protected` staat. Is hij niet gedekt, dan moet zijn pad in `PUBLIC_PATHS` staan. Elk pad in `PUBLIC_PATHS` en `/` heeft een routebestand.

| Module | Signatuur | Pint |
|---|---|---|
| `app/src/lib/sessionState.ts` | `deriveSessionState(input: AuthStateInput & { tokenFetchFailed: boolean; online: boolean \| null }): SessionState`, met `SessionState = AuthState \| "reconnecting"` | F1, de tabel hierboven |
| `app/src/lib/sessionState.ts` | `authRetryDue(input: { state: SessionState; before: { appState: string; online: boolean \| null }; now: { appState: string; online: boolean \| null } }): boolean` | F1, opnieuw proberen |
| `app/src/lib/liveQuery.ts` | `sessionQueryIsLive` krijgt `query: string` erbij; `screenQueryIsLive` neemt `SessionState` | F2; `reconnecting` is niet live |
| `app/src/lib/routeAccess.ts` | `routeAccess(pathname, state: SessionState)` en `export PUBLIC_PATHS: Iterable<string>` | F1, F4 |
| (geen module) | `app/tests/liveQueryAccess.test.ts`, `app/tests/routeFiles.test.ts`, met de parser in `app/tests/support/sourceScan.ts` | F2, F3, F4 |

**Niet als test te pinnen (naar audit, red-team en gate):**
- dat de poort `tokenFetchFailed` en `online` echt meet en bij `authRetryDue` echt een nieuwe poging doet;
- dat de poort bij "login" en "home" zelf omleidt, en niet op de guard wacht;
- dat de guard in `_layout` dezelfde toestand volgt als de poort;
- **gate-aanvulling:** vliegtuigmodus aan, app langer dan 60 s in de achtergrond, terug: kop en tabbalk blijven, geen "server weigert". Vliegtuigmodus uit: binnen enkele seconden weer live. Hetzelfde bij een koude start in vliegtuigmodus.

## Fix-cyclus 2 na heraudit en hercheck red-team

Besluiten Wouter (2026-11-02):
- Alle punten hieronder gaan vóór de gate.
- K1: er komt geen escalatie naar `convexAuthFailed`. Uitloggen en een eerlijke tekst zijn genoeg.
- R3, de koude start in vliegtuigmodus: de gate beslist. Valt die stap om, dan volgt een gerichte fix.

| # | Bron | Probleem | Wat er waar moet zijn |
|---|---|---|---|
| F6 | red-team R1, heraudit M1 | In `reconnecting` verdwijnt Uitloggen. Bij een blijvende tokenfout met netwerk zit de user vast. | In `reconnecting` zijn "Opnieuw" en "Uitloggen" allebei bereikbaar, op elk scherm. |
| F7 | red-team R7, heraudit K2 | De melding zegt "Controleer je internet" en belooft een automatische poging, ook als er wel netwerk is. | Zonder netwerk: geen internet, en de app probeert het opnieuw zodra er netwerk is. Met netwerk: de server is niet bereikbaar, tik op "Opnieuw". |
| F8 | red-team R6 | "Verbinden…" blijft eindeloos staan als Clerk een token geeft maar Convex niet bevestigt. "Opnieuw" is dan weg. | Na een vaste time-out keren de melding en de knoppen terug. |
| F9 | red-team R4 | Een late `report()` van een oude poging overschrijft `tokenFetchFailed`. | Alleen een rapport van de huidige poging telt. |
| F10 | red-team R2 | De scanner mist `useQuery_experimental`, `usePaginatedQuery_experimental`, `convex/browser`-subscribe, `onPaginatedUpdate_experimental` en `require` van een `convex/dist`-pad. | Voor de `convex`-familie geldt een allowlist: alles wat niet expliciet is toegestaan, is verboden. |
| F11 | red-team R5 | `routeFiles.test.ts` blijft groen bij `guard={true}` en bij een map `dist/` of `tests/` onder `src/app`. | Een guard moet de sessie-toestand volgen. Elk bestand onder `src/app` telt mee. |

Werkwijze: A schrijft RED tests voor F6–F11, waar dat kan met pure logica of een scanner. Daarna fixt B. Dan volgt een korte hercheck door de heraudit en de red-team. Daarna komt de gate.

### Fix-cyclus 2: aanvulling A (2026-11-02)

**F6, F7, F8: wat het inhoudsgebied toont in `reconnecting`.** Eén pure beslissing bepaalt soort, tekst en knoppen. Invoer: online (onbekend telt als offline), of er een poging loopt, en hoe lang die al loopt.

| Situatie | Soort | Tekst | Opnieuw | Uitloggen |
|---|---|---|---|---|
| Poging loopt, korter dan de time-out | bezig | "Verbinden…" | bezig (zichtbaar, niet te tikken) | ja |
| Geen poging (of time-out voorbij), offline | geen internet | Geen internet. De app probeert het opnieuw zodra er netwerk is. | ja | ja |
| Geen poging (of time-out voorbij), online | server niet bereikbaar | De server is niet bereikbaar. Tik op "Opnieuw". Geen woord over internet, en geen belofte van een automatische poging. | ja | ja |

- **Time-out (F8):** een vaste waarde van 5 tot 30 s. Daarna keren de melding en de knoppen terug, ook als Convex het token nog niet bevestigt. Na de time-out mag een poging nog doorlopen. Tikt de user op "Opnieuw", dan begint een nieuwe poging met een nieuwe time-out.
- **Uitloggen (F6)** staat in elke soort, op elk scherm waar `reconnecting` het inhoudsgebied vervangt. Besluit K1 geldt: er komt geen escalatie naar `convexAuthFailed`.
- `authRetryDue` blijft zoals hij is. F7 is een tekstfout, geen fout in de logica.

**F9: alleen de laatst gestarte tokenophaal telt.** Elke aanroep van de tokenophaal krijgt een volgnummer. Een uitkomst van een eerdere aanroep verandert `tokenFetchFailed` niet, ook niet als hij later binnenkomt. Een nieuwe aanroep die nog loopt, verandert `tokenFetchFailed` ook niet: dan blijft de vorige uitkomst gelden.

**F10: een allowlist voor de `convex`-familie.** Buiten het toegangspad mag code uit `convex`, `convex-helpers` en `@convex-dev` alleen deze waarden importeren:

| Module | Toegestaan |
|---|---|
| `convex/react` | `ConvexReactClient`, `ConvexProviderWithAuth`, `useConvexAuth`, `useMutation`, `useAction` |
| `convex/react-clerk` | `ConvexProviderWithClerk` |
| `convex/server` | `anyApi`, `getFunctionName` |
| `convex/values` | `ConvexError` |

- Type-imports mogen altijd.
- De rest is verboden: andere namen, andere modules (`convex/browser`, `convex/dist/…`, `convex` zelf), een namespace-import, `require`, `import(…)`, een kale import en elke import uit `convex-helpers` of `@convex-dev`.
- Een pad met `node_modules/` erin is ook verboden.
- `useConvex` staat bewust niet op de lijst. Wie de client nodig heeft, voegt dat bewust toe.
- Voor leden van de client blijft een denylist: `watchQuery`, `watchPaginatedQuery`, `prewarmQuery`, `paginatedQueryClient`, `sync`, `onUpdate`, `subscribe`, elk lid dat met `onPaginatedUpdate` begint, en elk lid dat op `_experimental` eindigt.

**F11: de routetest leest elk bestand en controleert de guard.**
- De routetest leest alle bestanden onder `src/app`, ook in mappen `dist` of `tests`.
- Een `*.Protected` dekt alleen als zijn `guard` de sessie-toestand volgt. De expressie moet `useAuthState()` aanroepen, of een variabele gebruiken die daarvan is afgeleid (in dezelfde `_layout`). `guard={true}` en een vlag die daar los van staat, dekken niet.

| Module | Signatuur | Pint |
|---|---|---|
| `app/src/lib/reconnectView.ts` | `reconnectView(input: { online: boolean \| null; retrying: boolean; retryingForMs: number }): { kind: "busy" \| "offline" \| "serverUnreachable"; title: string; message: string; retry: "enabled" \| "busy"; signOut: "enabled" }` en `export RECONNECT_TIMEOUT_MS: number` | F6, F7, F8 |
| `app/src/lib/tokenFetch.ts` | `initialTokenFetch: TokenFetchState`; `startTokenFetch(state): { state: TokenFetchState; id: number }`; `finishTokenFetch(state, id: number, ok: boolean): TokenFetchState`; `tokenFetchFailed(state): boolean` | F9 |
| (geen module) | `app/tests/liveQueryAccess.test.ts` (allowlist, F10) en `app/tests/routeFiles.test.ts` (guard, alle bestanden, F11). Elk bestand dat `reconnectView` gebruikt, rendert ook `SignOutButton` (F6). | F6, F10, F11 |

**Niet als test te pinnen (naar de hercheck en de gate):**
- dat de poort de time-out echt laat aflopen en de knoppen terugbrengt;
- dat `startTokenFetch` / `finishTokenFetch` om elke echte aanroep van `fetchAccessToken` heen staan;
- dat "Uitloggen" in `reconnecting` op elk scherm echt zichtbaar is. Dat geldt ook bij de grootste tekststand.
- **Gate:** het JWT-template `convex` tijdelijk hernoemen in het Clerk-dashboard (dev). Met netwerk staat er dan "server niet bereikbaar", en "Opnieuw" en "Uitloggen" werken. Daarna het template terugzetten.
- **Gate:** het Convex-adres blokkeren (bv. een verkeerde `EXPO_PUBLIC_CONVEX_URL` in een dev-build). Binnen de time-out komt de melding met beide knoppen terug.
- **Gate, R3:** koude start in vliegtuigmodus. `loading` zonder sessie valt buiten deze beslissing.

## Gate-uitslag build 42 (2026-11-02), deel 1

- Ronde 2, navigatie: alle stappen ✅. Dat zijn de tabbalk, "‹ Instellingen", vegen, de stack per tab, een tik op de actieve tab, de + met "Sluiten", en uitloggen gevolgd door terugvegen.
- Ronde 3, dashboard: ✅. Op de achtergrond loopt na een wijziging in `users` geen enkele `users:current`. Bij terugkeer volgt één uitvoering met verse data, en daarna steeds één uit de cache.
- Ronde 4, offline:
  - Vliegtuigmodus aan, langer dan 60 s op de achtergrond, dan terug: ✅. Kop en tabbalk blijven staan, er komt geen melding en geen "server weigert".
  - Vliegtuigmodus uit: ✅, zonder melding.
  - Koude start in vliegtuigmodus: ❌. De app blijft op "Laden…" staan, **ook nadat het netwerk terug is**. Dit is R3.

- Ronde 5, overige checks:
  - Herstart met netwerk: ✅, je blijft ingelogd.
  - Inloggen als dev2: ✅, de app begint op Home met lege stacks.
  - Live wisselen tussen licht en donker: ✅.
  - App-icoon in donker: ✅.
  - Grootste tekststand: ✅. "Uitloggen" past en is te bereiken. De tabbalk-labels groeien bewust maar tot 1,2×.
  - Liggend: ✅, redelijk. De tabbalk is liggend vrij hoog (kan-punt, naar de backlog).
  - Deep link via Safari naar `clubalmanac://instellingen/over`: ✅.

## Fix-cyclus 3: koude start offline (R3)

Besluit Wouter: "Valt die stap om, dan volgt een gerichte fix".

| # | Probleem | Wat er waar moet zijn |
|---|---|---|
| F12 | Een koude start zonder netwerk blijft eindeloos op "Laden…" staan. Ook als het netwerk terugkomt, blijft het zo, tot de app geforceerd wordt afgesloten. | Er komt nooit eindeloos "Laden…". Na een vaste time-out volgt een melding met "Opnieuw" (design.md §6). Komt het netwerk terug, dan herstelt de app zich vanzelf, zonder afsluiten. Had de user een sessie, dan komt hij weer in de app; zo niet, dan ziet hij het inlogscherm. Mag het met een bestaande Clerk-sessie, dan liever kop en tabbalk met de melding uit F6–F8, in plaats van een leeg laadscherm. |

Werkwijze: A zoekt eerst uit hoe Clerk offline laadt en pint F12 met tests waar dat kan. B fixt daarna en checkt het in de simulator met een gesimuleerde offline-start. Dan volgt een korte hercheck door de red-team, en daarna een nieuwe build. Op die build herhaalt de gate alleen ronde 4.

### Fix-cyclus 3: aanvulling A (2026-11-02)

**Waarom de app offline op "Laden…" blijft** (gelezen in `@clerk/expo` 4.14.1, `@clerk/clerk-js` 6.40.1 `dist/clerk.native.js`, `@clerk/react` 6.18.1):
1. Clerk kijkt met `navigator.onLine` of hij online is. In React Native is dat `undefined`, en dan telt het als online. Een netwerkfout wordt dus niet als "offline" herkend.
2. Op native laadt `load()` de omgeving en de client van Clerk. Zonder resource-cache gooit een netwerkfout daar door. `load()` faalt, de status wordt `"error"`, en `loaded` blijft `false`. In de app is `isLoaded` dan `false`, dus de app toont "laden".
3. `@clerk/react` vangt die fout op, zet de status op `"error"`, en doet verder niets. Er komt geen nieuwe poging, ook niet als het netwerk terugkomt. Daarom blijft "Laden…" staan tot de app wordt afgesloten.

**Gekozen route: de resource-cache van Clerk, met een vangnet in de poort.**
- `ClerkProvider` krijgt `__experimental_resourceCache={resourceCache}` uit `@clerk/expo/resource-cache`. Die cache staat in de veilige opslag (`AFTER_FIRST_UNLOCK`).
  - Bij een netwerkfout of 5xx laadt Clerk dan de opgeslagen client en omgeving, en wordt de status `"degraded"`. Dat telt als geladen.
  - Had de user een sessie, dan is hij "ingelogd". Het Convex-token lukt offline niet, dus wordt het `reconnecting`: kop, tabbalk en de melding uit F6–F8. Komt het netwerk terug, dan probeert `authRetryDue` het opnieuw.
  - Mist de cache (de eerste start van deze build, offline), dan toont Clerk een lege client. De user ziet dan het inlogscherm. Clerk probeert het zelf opnieuw met backoff (2 s, oplopend tot 30 s). Komt de echte client binnen, dan gaat de app vanzelf door naar de app.
  - Bijwerking: met de cache aan gooit Clerk een netwerkfout ook bij andere aanvragen, zoals de inlogstap. De inlogfout valt dan onder de algemene NL-melding van WP13 (invariant 17).
- **Het vangnet: "laden" duurt nooit eindeloos.** Een pure beslissing kijkt hoe lang de sessie al op "laden" staat, en naar de status van Clerk:

| Sessie | Clerk | Hoe lang "laden" | Toestand |
|---|---|---|---|
| niet "laden" | — | — | ongewijzigd |
| "laden" | `error` | — | `startupFailed` (direct) |
| "laden" | `loading` | korter dan de time-out | "laden" |
| "laden" | `loading` | time-out voorbij | `startupFailed` |
| "laden" | geladen (`ready`/`degraded`), ingelogd | korter dan de time-out | "laden" |
| "laden" | geladen, ingelogd | time-out voorbij | `reconnecting` (Convex bevestigt niet: kop, tabbalk, melding) |
| "laden" | geladen, uitgelogd | time-out voorbij | `startupFailed` |

  - De time-out (`STARTUP_TIMEOUT_MS`) is een vaste waarde van 5 tot 30 s.
  - `startupFailed` blijft niet hangen. Laadt Clerk alsnog, dan volgt de app de nieuwe toestand.
  - `startupFailed` toont op elk pad een statusscherm: "De app kan nu niet starten", een uitleg die past bij offline of online, en "Opnieuw". Er is geen navigator, want zonder Clerk weet de app niet of er een sessie is.
  - "Opnieuw", en vanzelf zodra de app actief en online wordt (`startupRetryDue`, dezelfde regel als `authRetryDue`), start Clerk opnieuw. Clerk biedt geen `load()` om opnieuw te proberen. De route is dus de `ClerkProvider` opnieuw mounten (een nieuwe `key`), waarna `load()` opnieuw loopt. B checkt in de simulator dat dat werkt.

| Module | Signatuur | Pint |
|---|---|---|
| `app/src/lib/startupState.ts` | `deriveStartupState(input: { session: SessionState; clerkStatus: "loading" \| "ready" \| "degraded" \| "error"; clerkSignedIn: boolean; loadingForMs: number }): GateState`, met `GateState = SessionState \| "startupFailed"`, en `export STARTUP_TIMEOUT_MS: number` | de tabel hierboven |
| `app/src/lib/startupState.ts` | `startupRetryDue(input: { state: GateState; before: { appState: string; online: boolean \| null }; now: { appState: string; online: boolean \| null } }): boolean` | opnieuw proberen na `startupFailed` |
| `app/src/lib/routeAccess.ts` | `routeAccess(pathname, state: GateState)` geeft `"startupFailed"` op elk pad | het statusscherm, geen navigator |
| (geen module) | `app/tests/clerkOffline.test.ts`: `ClerkProvider` in `App.tsx` krijgt `__experimental_resourceCache` met `resourceCache` uit `@clerk/expo/resource-cache` | de gekozen route |

**Niet als test te pinnen (naar de simulator-check van B en de gate):**
- dat de poort `loadingForMs` echt meet, en bij `startupFailed` de `ClerkProvider` echt opnieuw mount en dat `load()` dan opnieuw loopt;
- dat Clerk met de cache offline echt op `"degraded"` komt en de sessie uit de cache haalt;
- dat uitloggen de cache leegmaakt: na uitloggen en een koude start offline, geen ingelogde schil (WP13 invariant 6);
- **simulator (B):**
  - koude start met het netwerk van de Mac uit, nadat de app één keer online is gestart: kop, tabbalk en de melding "geen internet". Netwerk aan: vanzelf live.
  - Hetzelfde zonder eerdere online start: het inlogscherm, en na netwerk aan vanzelf door.
- **gate ronde 4:** de koude start in vliegtuigmodus. Binnen de time-out kop, tabbalk en de melding. Vliegtuigmodus uit: vanzelf weer in de app, zonder afsluiten.

**Afwijking B bij F12 (`35e5d69`), regie-besluit: voorlopig aangenomen, de red-team valt het aan.** Clerk 6.40.1 haalt na een offline start zonder cache de echte client wel op, maar maakt de sessie daarin niet actief. Daarom zet `app/src/data/resumeSession.ts` de sessie alsnog actief. Dat gebeurt alleen als Clerk op `degraded` staat, als de user niet ingelogd is, en voor de `lastActiveSessionId` uit de client, mits die in `signedInSessions` staat. Na uitloggen staat daar geen sessie meer (WP13 invariant 6). Komt de red-team met een pad waarop deze hook een sessie activeert die de user niet meer had, dan gaat de hook eruit.

## Fix-cyclus 4 na hercheck F12 (red-team R4-1 t/m R4-4)

Besluiten Wouter (2026-11-02):
- R4-1: uitloggen werkt altijd, ook offline, en wist alles lokaal. Wouter accepteert dat de sessie op de server dan actief blijft tot hij verloopt.
- R4-2: de hook `resumeSession` gaat eruit. Clerk start in plaats daarvan opnieuw zodra er netwerk is.
- R4-3 en R4-4 gaan ook mee.

| # | Bron | Probleem | Wat er waar moet zijn |
|---|---|---|---|
| F13 | R4-1 (blocker) | Na uitloggen offline staan de sessie, de user-gegevens en de JWT nog in de resource-cache van Clerk in de keychain. Een koude start offline toont dan weer een ingelogde schil. | Uitloggen werkt ook offline, en wist alle Clerk-gegevens op het toestel, ook de sleutels van de resource-cache. Na uitloggen volgt bij een koude start nooit een ingelogde schil, met of zonder netwerk. Er blijven geen persoonsgegevens of tokens in de keychain staan. |
| F14 | R4-2 | `resumeSession` kan direct na uitloggen de sessie weer activeren. | Er is geen `setActive` buiten een inlogactie van de user. Startte Clerk uit de cache en is de user uitgelogd, dan start Clerk opnieuw zodra het netwerk terugkomt. Dat gaat via het bestaande herstartmechanisme, en Clerk volgt daarna de echte client. Na een echte uitlog blijft de user uitgelogd. |
| F15 | R4-3 | Een blijvende Clerk-fout (geen netwerkfout) geeft `startupFailed` met een verkeerde tekst. "Opnieuw" geeft dan steeds dezelfde fout, en een uitweg ontbreekt. | De tekst past bij de oorzaak: offline of niet. `startupFailed` biedt naast "Opnieuw" ook een uitweg die alles lokaal wist (zoals F13) en naar het inlogscherm gaat. |
| F16 | R4-4, K-c | De time-outs van `startup` en van `retrying` rekenen met `Date.now()` bij elke render. Springt de klok terug, dan blijft de time-out hangen. | Een time-out loopt altijd één keer af, ook als de klok verspringt. |

Werkwijze: A pint F13–F16 waar dat kan. B fixt en checkt het in de simulator, met nagebootst offline. De red-team doet een korte hercheck. Daarna volgt een nieuwe build, en op die build herhaalt de gate ronde 4, plus uitloggen in vliegtuigmodus en daarna een koude start in vliegtuigmodus.

## Fix-cyclus 4: aanvulling A

Wat A in `@clerk/expo` 4.14.1 zag:

| Feit | Gevolg |
|---|---|
| De prop `__experimental_resourceCache` is een fabriek `() => { get, set }`. Clerk roept hem één keer per cache aan (omgeving, client, sessie-JWT). Itemsleutels: `__clerk_cache_{environment,client,session_jwt}_<pk zonder '='>`. | Een eigen opslag past op de prop. Clerk hoeft niets te merken. |
| De opslag van `@clerk/expo/resource-cache` heeft geen wis-functie. `set()` zet het item in een wachtrij en geeft direct terug. "Verwijderen" is een `set(key, "")` op één slot. In de keychain blijven `<item>-latest`, `<item>-{A,B}-complete`, `<item>-{A,B}-metadata` (`{"totalChunks":n}`) en `<item>-{A,B}-chunk-<i>` staan. | Wissen kan alleen met een eigen opslag. Build 42 schreef deze sleutels al: de wis ruimt ze ook op. |
| De listener van Clerk slaat bij elke wijziging van de client een snapshot op, ook tijdens `signOut`. | Na de wis mag de opslag niets meer schrijven, tot een nieuwe login begint. |
| De tokenCache bewaart het client-token onder `__clerk_client_jwt`. Clerk leest het bij elk verzoek. De sessie op de server blijft actief (R4-1). | Blijft dit token staan, dan logt een koude start online weer in. De wis neemt het mee. |
| Er zit geen native Clerk-module in de app (`@clerk/expo-native-components` staat niet in `package.json`). | Er is geen tweede kopie van het token in de keychain. |
| `src/auth/useEmailCodeLogin.ts` gebruikt `signIn.finalize()`. `setActive` staat alleen in `src/data/resumeSession.ts`. | De scanner voor F14 staat `setActive` nergens toe. |

### Grens en contract

**F13: één opslag voor alles wat Clerk bewaart.** De module is puur. De backend (expo-secure-store) komt als argument binnen.

```ts
// src/auth/clerkStorage.ts
export type SecureBackend = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};
export function createClerkStorage(backend: SecureBackend, publishableKey: string): {
  resourceCache: () => { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };
  tokenCache: {
    getToken(key: string): Promise<string | null | undefined>;
    saveToken(key: string, token: string): Promise<void>;
    clearToken(key: string): Promise<void>;
  };
  wipe(): Promise<boolean>;
  resume(): Promise<void>;
};
```

| Regel | Waarom |
|---|---|
| Een waarde van elke lengte komt via `get` heel terug, ook met é of emoji. Elke waarde in de backend is hooguit 2048 bytes (UTF-8). Elke sleutel past op `/^[\w.-]+$/`. | Grenzen van expo-secure-store. |
| `wipe()` laat in de backend hooguit 2 sleutels achter, met waarden van samen hooguit 64 tekens. Geen opgeslagen waarde komt erin terug, en geen sleutel begint nog met `__clerk_`. Dat geldt ook voor data van een eerdere instantie op dezelfde backend, en voor de sleutels die build 42 schreef (de opslag van Clerk en `__clerk_client_jwt`). | R4-1: geen PII of token in de keychain. Een vlag mag blijven. |
| Na `wipe()` schrijven `set` en `saveToken` niets. `get` en `getToken` geven `null`. Dat blijft zo in een nieuwe instantie op dezelfde backend, tot `resume()`. | De listener van Clerk schrijft na de wis nog snapshots. Een koude start leest niets. |
| Een `set` die al liep toen `wipe()` begon, laat niets achter. | De wachtrij van Clerk deed dat wel. |
| Faalt het verwijderen, dan geeft `wipe()` `false`. Een nieuwe instantie geeft dan toch `null`. | De vlag staat er vóór het verwijderen. `false` toont de bestaande melding "wissen mislukt" (WP13). |
| Na `resume()` werken `set`, `get`, `saveToken` en `getToken` weer gewoon. | De volgende login. |

Aansluiting (B): `App.tsx` geeft `resourceCache` en `tokenCache` uit deze opslag aan `ClerkProvider`, niet die uit `@clerk/expo/resource-cache` of `@clerk/expo/token-cache`. Uitloggen roept `wipe()` aan, ook als `signOut()` faalt. Een loginpoging roept `resume()` aan vóór haar eerste verzoek: anders stuurt Clerk geen client-token mee en raakt hij de poging kwijt. `wipeStoredTokens` en `touchedKeys` vervallen.

**F14: geen `setActive`, wel een herstart.** `resumeSession.ts` en zijn aanroep gaan eruit. Geen bestand in de app gebruikt `setActive`.

```ts
// src/lib/startupState.ts
export function clerkRestartDue(input: {
  clerkStatus: ClerkStatus;
  clerkSignedIn: boolean;
  before: Conditions;
  now: Conditions;
}): boolean;
```

Waar alleen als Clerk `degraded` en uitgelogd is, de app nu actief en online is, en er vlak daarvoor geen netwerk was (`before.online !== true`). De app herstart Clerk dan via `useRestartClerk`. Terugkomen uit de achtergrond telt niet: de user haalt de code uit de Mail-app, en een herstart zou de codestap wissen. Bijwerking: een half getypt e-mailadres op het inlogscherm gaat bij die ene herstart verloren.

**F15: de tekst volgt de oorzaak, plus een uitweg.**

```ts
// src/lib/startupFailedView.ts
export function startupFailedView(input: { online: boolean | null; clerkStatus: ClerkStatus }): {
  kind: "offline" | "serverSlow" | "startupError";
  title: string;
  message: string;
  retry: "enabled";
  reset: "enabled";
};
```

| Soort | Wanneer | Tekst |
|---|---|---|
| `offline` | `online !== true` | Noemt internet. Belooft een nieuwe poging zodra er netwerk is. |
| `startupError` | online, Clerk `error` | Noemt geen internet en zegt niet "niet bereikbaar". Wijst op de uitweg. |
| `serverSlow` | online, Clerk niet `error` (de time-out liep af) | Noemt geen internet. |

De uitweg ("Opnieuw inloggen") roept `wipe()` aan en herstart Clerk. Hij roept geen `signOut` aan, want Clerk is niet geladen. Daarna volgt het inlogscherm.

**F16: een vlag in plaats van een duur.** `deriveStartupState` krijgt `loadingTimedOut: boolean` (geen `loadingForMs`). `reconnectView` krijgt `retryTimedOut: boolean` (geen `retryingForMs`). De poort zet de vlag met één `setTimeout` per periode. Een bestand dat `STARTUP_TIMEOUT_MS` of `RECONNECT_TIMEOUT_MS` gebruikt, rekent niet met `Date.now`, `performance.now` of `new Date`.

### Tests

| Bestand | Pint |
|---|---|
| `tests/clerkStorage.test.ts` | F13: het contract hierboven, op een nep-backend met de grenzen van expo-secure-store en met vertraagde calls. |
| `tests/clerkOffline.test.ts` | F12 en F13: elke `ClerkProvider` krijgt `__experimental_resourceCache` en `tokenCache`. Geen bestand importeert `@clerk/expo/resource-cache` of `@clerk/expo/token-cache`. |
| `tests/clerkRestart.test.ts` | F14: geen `setActive` in de app, en `clerkRestartDue`. |
| `tests/startupFailedView.test.ts` | F15. |
| `tests/startupState.test.ts`, `tests/reconnectView.test.ts` | F16: de vlaggen. Plus de scan op klok-calls. |

### Niet als test te pinnen (B's simulator-check en de gate)

| Wat | Waar |
|---|---|
| Uitloggen in vliegtuigmodus, daarna een koude start in vliegtuigmodus: het inlogscherm, geen ingelogde schil. Daarna netwerk aan: nog steeds uitgelogd. | Gate |
| Na uitloggen staat er in de keychain niets meer onder `__clerk_`. Check met een dev-knop of log, niet in de build van de gate. | B |
| Uitloggen roept `wipe()` aan, ook als `signOut()` faalt. De uitweg van F15 roept `wipe()` aan en herstart Clerk. | B, hercheck |
| Inloggen werkt na een offline uitlog: `resume()` staat vóór het eerste verzoek. Een code uit de Mail-app halen breekt de codestap niet. | Gate |
| De herstart van F14 laadt de echte client. De Clerk-instantie is een singleton (`createClerkInstance`). Een nieuwe `key` draait `load()` opnieuw, zoals in F12 bleek. | B |
| Een time-out loopt af na een klok-sprong (Instellingen > Datum en tijd). | B |
| Een upgrade vanaf build 42: uitloggen ruimt ook de oude sleutels op. | Gate |

**Regie-besluit na B's fix 4 (`070160c`): een herstart van Clerk = de app herladen.** Een nieuwe `key` op `ClerkProvider` start Clerk niet opnieuw. Clerk houdt één instantie, en `load()` slaat zichzelf over als die al geladen is (dat zag B in de simulator en staat in de broncode). Het uitgangspunt van F12 klopte dus niet. De route wordt `reloadAppAsync()` uit `expo` (`expo-modules-core`). Daar is geen nieuwe native module voor nodig. Dit geldt bij:
- `clerkRestartDue` (F14);
- de uitweg van F15, na `wipe()`;
- uitloggen waarbij `signOut()` faalt, na `wipe()`. Zo blijft de user niet in de app hangen terwijl Clerk in het geheugen nog ingelogd is.

Een herladen mag geen lus geven. Een nieuwe start begint zonder "netwerk kwam terug". De gate checkt dat de app na het herladen op het inlogscherm staat, of in de app als er een sessie was.

## Fix-cyclus 5 na hercheck fix-cyclus 4

Besluit Wouter: eerst deze kleine fix, daarna één build voor de hele gate. R5-4 gaat naar het cutover-runbook (fase 5), K4 en K6 naar de backlog.

| # | Bron | Probleem | Wat er waar moet zijn |
|---|---|---|---|
| F17 | red-team R5-1 | `degraded` blijft de hele run staan. Wankelt het netwerk in de codestap (bijvoorbeeld een wissel van wifi naar mobiel), dan herlaadt de app en is de codestap weg. | Een herstart van Clerk, of een herlading, gebeurt nooit terwijl er een inlogpoging loopt (de codestap). |
| F18 | heraudit K8 | In `startupFailed` met netwerk telt elke overgang van `inactive` naar `active` als "kwam terug". Dan herlaadt de app bij elk Bedieningspaneel. | Herladen gebeurt alleen als het netwerk echt terugkomt, of als de app echt terugkomt uit de achtergrond. Een `inactive` telt niet. |
| F19 | red-team R5-2 | `wipe()` tijdens de eerste lees-actie: de lees-actie overschrijft `wiped = true` in het geheugen. | Een wis wint altijd van een lees-actie die nog liep. |
| F20 | red-team R5-3 | "Opnieuw wissen" in de codestap wist het client-token van de lopende login. | In de codestap kan de user geen wis starten. |
| F21 | heraudit K7 | `online.tsx:7-9` beschrijft nog de remount via `key`. | Commentaar klopt met het herladen. |

Werkwijze: A pint F17–F20. B fixt F17–F21. Daarna een korte hercheck door de red-team, dan de build.
