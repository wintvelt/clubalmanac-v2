# WP15a: Navigatie-skelet + subscription-discipline

> ✅ Afgerond 2026-11-03. App-WP (zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4)), plus een adversarial pass omdat ops hoog is. WP15b (Profiel, Instellingen, Info, `recordVisit`) bouwt hierop.

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
- Oude app (alleen A): `~/Code/v1/clubalmanac-app`, navigatie en tabbalk

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

## Fix-cycli (samenvatting)

Zes fix-cycli na de audit, de red-team en de gate. Na elke cyclus volgde een hercheck door de red-team. De contracten staan nu in de tests in `app/tests/`, en de toelichting in de commits.

| Cyclus | F | Kern | Bron |
|---|---|---|---|
| 1 | F1–F5 | Toestand `reconnecting`: tijdelijk geen token is geen weigering. Alleen de poort draait `users.current` buiten focus. De scanner leest de syntaxboom. Elk routebestand is afgeschermd of publiek. De native peers staan vast. | audit + red-team |
| 2 | F6–F11 | In `reconnecting` zijn "Opnieuw" en "Uitloggen" altijd bereikbaar, met een eerlijke tekst (offline of server niet bereikbaar). Er is een time-out op "Verbinden…". De tokenophaal telt per volgnummer. De scanner werkt met een allowlist voor `convex`. De guard moet de sessie volgen. | heraudit + red-team |
| 3 | F12 | Koude start offline: de resource-cache van Clerk staat aan, met het vangnet `startupFailed`. | gate build 42 |
| 4 | F13–F16 | Een eigen opslag voor Clerk. Uitloggen wist alles lokaal, ook offline (besluit Wouter: de server-sessie blijft dan actief tot hij verloopt). `resumeSession` is weg. Een herstart van Clerk is `reloadAppAsync()`, omdat een nieuwe `key` Clerk niet opnieuw laadt. `startupFailed` heeft een tekst per oorzaak en een uitweg. De time-outs werken met een vlag. | red-team |
| 5 | F17–F21 | Geen herlading tijdens een inlogpoging. Een `inactive` geeft geen herlading. Een wis wint van een lees-actie die nog liep. In de codestap kan de user geen wis starten. | red-team + heraudit |
| 6 | F22–F23 | "Netwerk kwam terug" wordt onthouden sinds de app laatst actief en online was, ook als de wissel gebeurde terwijl de app `inactive` was. Een inlogpoging loopt vanaf de tik op "Stuur code". | red-team |

## Gate-uitslag

**Build 42 (2026-11-02):**
- navigatie: ✅;
- dashboard, met op de achtergrond geen enkele `users:current` en bij terugkeer één uitvoering: ✅;
- offline terug uit de achtergrond: ✅;
- licht en donker live, het icoon in donker, de grootste tekst, liggend, een deep link via Safari, en dev2 op Home met lege stacks: ✅;
- koude start offline: ❌, bleef op "Laden…" staan, ook met netwerk (F12).

**Build 44 (2026-11-03), op `945dd58`:**
- koude start in vliegtuigmodus: kop, tabbalk en "Geen internet";
- vliegtuigmodus uit via het Bedieningspaneel: vanzelf weer live;
- uitloggen in vliegtuigmodus, daarna een koude start in vliegtuigmodus: het inlogscherm;
- netwerk aan: de user blijft uitgelogd;
- daarna opnieuw inloggen.

Alles ✅.

**Niet gemeten:** de tabwissel waarbij de query stopt. Dat gaat naar WP15b (besluit 5).

## Backlog (kan-punten)

- De tabbalk is liggend vrij hoog.
- De titel in `Notice` breekt bij de grootste tekst midden in een woord. Zie [`design.md`](../design.md) §10, nr. 14.
- Op `NotFoundScreen` staat in `reconnecting` geen "Uitloggen". "Naar Home" brengt de user in één tik bij beide knoppen.
- Tests:
  - `routeFiles.test.ts` accepteert een guard die altijd waar is, zoals `inApp || true` of `!!state`;
  - de scanner kent `subscribe` en `*_experimental` voor elke naam, niet alleen voor de Convex-client (kans op valse meldingen);
  - een eigen `ConvexReactClient` met `.query` in een interval valt buiten de allowlist.
- Bij de overstap naar `pk_live` (fase 5) wist uitloggen de oude test-cache niet, omdat `wipe()` alleen sleutels met de huidige key wist. Dit staat in het cutover-runbook.
