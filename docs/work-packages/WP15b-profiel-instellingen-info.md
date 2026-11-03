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
8. **WP15a en WP13 blijven werken.** De bestaande tests in `app/tests/` en root-`tests/` blijven groen. Alleen A past ze bewust aan (zie regie-besluiten). Schermen gebruiken alleen tokens en componenten uit `app/src/theme` en `app/src/components`, en `Screen` voor `reconnecting`.

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

- Root en app: typecheck en tests groen op Node 24, ook in CI. WP13-, WP15a- en WP23-tests blijven groen, met alleen A's bewuste aanpassingen.
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

## Spec-criticus aanvullingen (A, 2026-11-03)

Bronnen: de oude app (`screens/Profile.jsx`, `ProfileEdit.jsx`, `InfoProtected.jsx`, `Info.jsx`, `About.jsx`, `Privacy.jsx`, `TermsAndConditions.jsx`, `Problem.jsx`, `components/nav/TabBarPublic.jsx`, `components/fields/NameField.jsx`), de oude backend (`blob-images-api-user` `updateUser.js` en `dynamodb-lib-user.js`, `blob-common/core/sanitize.js`, `blob-images-api-info/data/privacyNL.md`), en de huidige `convex/` en `app/`.

### Kernvondst: weglaten uit de vorm is niet genoeg voor invariant 6

Convex draait een query opnieuw zodra een document wijzigt dat de query las. Welke velden de query teruggeeft, maakt niet uit. `recordVisit` schrijft nu in de `users`-rij. Die rij lezen `users.current` (de poort), de profielquery, en elke query die een lid of eigenaar erbij haalt (`groups.listMembers`, `photos.getWithOwner`, `users.getById`). Elk bezoek laat die dus opnieuw draaien, ook bij andere leden. Daarom is `lastVisitAt` uit `ownProfile` halen alleen niet genoeg.

Nog een vondst: een gewone `Error` uit een mutation komt in productie bij de client aan als "Server Error", zonder tekst. Een melding onder het veld (invariant 1) kan alleen als de backend een `ConvexError` met een code gooit. Tot nu toe doet geen enkele mutation in `convex/` dat.

### Beslissingen op "Te beslissen door A"

**1. Invariant 6 en 7: een bezoek staat buiten de `users`-rij, en Profiel krijgt een eigen query.**

| Onderdeel | Besluit |
|---|---|
| Waar een bezoek staat | In een eigen tabel, één rij per user. Geen publieke query leest die tabel. `recordVisit` verandert niets aan de `users`-rij. |
| Uitlezen | Alleen intern: `internal.users.getLastVisit`. Zo zien tests en het dashboard het bezoek. |
| `ownProfile` | Zonder `lastVisitAt`. `users.current` toont dus geen bezoek. |
| Profielquery | Nieuw: `users.profile`, met dezelfde vorm als `users.current`. Alleen Profiel gebruikt hem, via `useLiveQuery`. Het is een andere functie, dus Convex voegt de twee abonnementen niet samen. |
| `users.current` | Blijft wat hij is, zonder `lastVisitAt`. Smaller maken levert niets op: hij draait toch opnieuw bij elke wijziging in de rij. Zo blijft WP15a ongemoeid. |
| Account verwijderen | `deleteSelf` ruimt de bezoekrij op (nieuwe cascade-rij U11). Dit staat nu al vast, niet pas in het WP voor account verwijderen. |
| `users.lastVisitAt` in het schema | Blijft voorlopig staan. Alleen de migratie vult hem nog, en geen code leest of schrijft hem. Regie beslist of de migratie het AWS-bezoek naar de nieuwe tabel zet (open vraag 1). |

Dit draait WP12-cascade-rij U2 deels terug. Daar staat dat de AWS-splitsing tussen gebruiker en bezoek een DynamoDB-truc was. In Convex is er een andere reden voor zo'n splitsing: de reactiviteit.

**2. Throttle: één uur, in de backend, en ook in de client.**

| Waar | Gedrag |
|---|---|
| Backend (de garantie) | `recordVisit` schrijft alleen als het laatste bezoek minstens een uur geleden is (`VISIT_PERIOD_MS`). Binnen het uur doet hij niets en geeft hij geen fout. |
| Client (bespaart aanroepen) | Een bezoek is de overgang naar "actief en ingelogd" (AppState `active` en de toestand `ready`). Ook een koude start en het inloggen tellen mee. De client roept `recordVisit` aan als zijn laatste *poging* voor deze user minstens een uur geleden is. Een mislukte poging telt ook als poging: dus geen nieuwe poging tot de volgende overgang na een uur, en geen lus. Een fout ziet de user niet. |
| Andere user | Een poging voor user A houdt een bezoek van user B niet tegen. |
| Klok terug | Ligt de laatste poging in de toekomst (klok van het toestel verzet), dan telt het als "lang geleden". |

Waarom een uur: de oude app telde één bezoek per kalenderdag. Gelezen werd het alleen voor "laatste bezoek" op Profiel, en dat vervalt. Een uur is fijn genoeg voor later gebruik ("actieve leden", "wat is er nieuw sinds je vorige bezoek"). Met de aparte tabel kost een schrijfactie geen nieuwe uitvoering van een live query.

**3. Naam: regels in de backend.**

De oude app: de naam was verplicht in het formulier, zonder maximumlengte. De backend haalde HTML-tags weg (vanwege de e-mails) en negeerde een lege naam zonder melding. Zichtbaar: de eigen kop, de ledenlijst, bij foto's als eigenaar, en in de uitnodigings-e-mails.

| Regel | Besluit |
|---|---|
| Spaties aan begin en eind | Worden weggehaald vóór de checks, ook vaste spaties (U+00A0 en dergelijke). |
| Leeg | Na het weghalen geen teken over: weigeren, code `NAME_EMPTY`. Een naam weghalen kan dus niet. |
| Te lang | Meer dan 50 tekens (`NAME_MAX_LENGTH`), na het weghalen: weigeren, code `NAME_TOO_LONG`. Tel tekens, geen UTF-16-eenheden: 50 emoji mag. |
| Verboden tekens | Code `NAME_INVALID` bij: controletekens (U+0000–U+001F, U+007F–U+009F, dus ook tab en enter), regel- en alinea-scheiding (U+2028, U+2029), tekens die de leesrichting omdraaien (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069), en onzichtbare spaties (U+200B, U+FEFF). Toegestaan blijven U+200C en U+200D: die zitten in emoji en in sommige schriften. |
| HTML | Niet weghalen: `<b>Jan</b>` wordt bewaard zoals getypt. De e-mails escapen al (`escapeHtml` in `emailTemplates.ts`), en React Native toont tekst als tekst. |
| Fout | `ConvexError` met `{ code }`. Geen opslag: ook een profielfoto in dezelfde aanroep wordt dan niet bewaard. |
| Gemigreerde namen | Worden nooit bij het lezen aangepast. Een aanroep zonder `name` (alleen een foto) checkt de bestaande naam niet. |
| Volgorde van de checks | Eerst weghalen, dan leeg, dan te lang, dan verboden tekens. |

De naam in Clerk blijft wat hij was. Bron van waarheid is `users.name`. `registerFromSession` neemt de Clerk-naam alleen bij het aanmaken over, en checkt hem niet. Dat laatste is een kan-punt, geen WP15b-werk.

**4. Info-pagina's.**

De oude app had dezelfde lijst op twee plekken: Info (uitgelogd) en Instellingen (ingelogd). Bovenaan stonden de officiële naam en de versie. Daaronder vier regels: "Over deze app", "Algemene voorwaarden", "Privacy statement" en "Probleem melden" (een formulier met logbestand). De privacytekst haalde de app op bij de AWS-API `/info/privacy/nl`. Die API verdwijnt bij de overstap.

| Pagina | Besluit |
|---|---|
| Over de app | Blijft, op `over`. Naam en versie (bestaat al), plus de tekst over de app en de maker. |
| Voorwaarden | Blijft, op `voorwaarden`. De tekst moet worden aangepast, zie hieronder. |
| Privacy | Blijft, op `privacy`. Eén tekst, in de app zelf, niet meer opgehaald. Een samenvatting bovenaan, daaronder de officiële versie. |
| Contact | Geen eigen pagina, maar een regel die een `mailto:` opent naar het contactadres. |
| Probleem melden (formulier) | Vervalt in 15b. De backend heeft het al (`features.create` met type `problem` mailt de webmaster), maar alleen voor ingelogde users. Het formulier hoort bij een feature-WP. |

De teksten staan in [`WP15b-info-teksten.md`](./WP15b-info-teksten.md), als concept. B neemt ze letterlijk over. Wouter keurt ze goed bij de gate. Wat na de migratie niet meer klopt:
- Opslag "bij Amazon Web Services in Frankfurt" wordt: Convex (EU, Dublin), Clerk (inloggen; Clerk is een Amerikaans bedrijf, dus doorgifte buiten de EU), Mailjet (e-mail, Frankrijk), en Photon van Komoot (plaatsnamen bij de GPS-gegevens van een foto, Duitsland).
- "Wachtwoord vergeten": er is geen wachtwoord meer, je logt in met een code per e-mail.
- Je e-mailadres is niet meer zichtbaar voor andere leden (WP23). In de oude voorwaarden staat van wel.
- Account verwijderen "via de persoonlijke instellingen" kan nog niet in de app (eigen WP). Tot dan: een verzoek per e-mail.
- Cookies en "analyseert jouw gedrag" gelden niet voor de app.
- In de oude voorwaarden staat een zin twee keer ("geen inbreuk op de privacy").

**5. Instellingen.**

| Oude instelling | Besluit |
|---|---|
| Home-groep wissen | Vervalt in 15b. Hoort bij WP16 (Home opent de laatst bezochte groep). |
| Helpteksten tonen of verbergen | Vervalt. Hulp-modals komen niet terug (design.md §6). |
| App-info en de vier regels | De Info-lijst, zie punt 4 |
| Uitloggen | Stond in de oude app op Profiel. Nu op Instellingen (WP15a). |

Instellingen bevat dus: de Info-regels (Over de app, Privacy, Voorwaarden, Contact) en Uitloggen. De tekst "Meer instellingen komen in een volgende versie" uit 15a gaat weg.

**6. E-mailadres op Profiel: alleen tonen.** Wijzigen gaat via Clerk en hoort bij de login. Een zin eronder zegt dat je met dit adres inlogt.

### Routes

| Scherm | Pad | Toegang |
|---|---|---|
| Info (lijst), uitgelogd | `/info` | publiek, alleen uitgelogd |
| Info-pagina, uitgelogd | `/info/<slug>` | publiek, alleen uitgelogd |
| Info-pagina, ingelogd | `/instellingen/<slug>` | ingelogd |

`<slug>` is `over`, `privacy` of `voorwaarden`. Beide routes per pagina tonen hetzelfde scherm. Ingelogd op een `/info`-pad: naar Home, zoals bij `/inloggen`. Uitgelogd op `/instellingen/privacy`: het inlogscherm. `PUBLIC_PATHS` blijft "alleen voor wie uitgelogd is", en krijgt de vier `/info`-paden erbij.

De uitgelogde tabbalk heeft twee tabs: Inloggen en Info. Het inlogscherm blijft op `/inloggen` staan. Bij de oude app stond in het midden een derde knop voor de uitnodiging: die komt met WP19.

### Pariteit-checklist per scherm

**Profiel** (`/profiel`)

| Oude app | Nieuw (15b) |
|---|---|
| Kop met naam en profielfoto | De naam als titel. Profielfoto: WP18. |
| "email:" met een webmaster-label | E-mailadres, alleen lezen. Het webmaster-label vervalt: dat is beheer, geen profiel. |
| "laatste bezoek" | Vervalt (besluit 2026-11-02) |
| "Profiel aanpassen" op een eigen scherm | Op Profiel zelf: een veld met de naam en een knop "Naam opslaan". Bezig: spinner in de knop. Fout: melding onder het veld. Gelukt: bevestiging onder de knop (design.md §6). |
| Naam verplicht, alleen in het formulier | Ook verplicht in de backend, plus lengte en tekens (punt 3) |
| Wachtwoord aanpassen | Vervalt: er is geen wachtwoord meer |
| Mijn groepen, Uitnodigingen, Ongepaste foto's, Beoordeel meldingen | Niet in 15b. Hoort bij WP16, WP19 en het flag-WP. |
| Uitloggen | Op Instellingen |
| Account verwijderen | Eigen WP |
| "Opgeslagen" kort in beeld, daarna weg | De bevestiging blijft staan tot de volgende actie (design.md §6) |

Een user zonder naam (gemigreerd, of zonder naam in Clerk): het veld is leeg en de titel zegt "Nog geen naam". Opslaan met dezelfde naam mag, en geeft gewoon de bevestiging.

**Instellingen** (`/instellingen`): zie punt 5.

**Info** (`/info` uitgelogd, de Info-regels op Instellingen ingelogd): naam en versie van de app, daarna de regels Over de app, Privacy, Voorwaarden en Contact. Ingelogd en uitgelogd precies hetzelfde. Geen naam, e-mailadres of andere user-gegevens, ook niet in de `mailto:`.

**Uitgelogde tabbalk**: Inloggen en Info, met icoon en label, verder als de tabbalk van WP15a. Geen +.

### Aanvullende invarianten

9. **Een geweigerde naam verandert niets.** Ook een profielfoto in dezelfde aanroep wordt niet bewaard.
10. **De melding bij een geweigerde naam komt uit de code, niet uit de tekst van de fout.** De app leest de `code` van de `ConvexError`. Een andere fout (geen netwerk, of een server die niet antwoordt) geeft een algemene NL-melding. Geen Engelse tekst of technische code voor de user.
11. **De Info-schermen lezen geen user-gegevens.** Geen `useLiveQuery`, geen `api` uit `convexApi`, en geen Clerk-hook die de user geeft (`useUser`, `useSession`). Dat geldt ook voor alles wat ze importeren. `Screen` mag `useAuthState` lezen: dat is een toestand, geen user-gegeven.
12. **Een bezoek wordt bij uitloggen niet doorgegeven aan de volgende user.** Log in als A en daarna als B, binnen het uur: voor B komt er toch een bezoek.

### Edge cases

- **Dubbel tikken op "Naam opslaan"**: één aanroep tegelijk. De knop is bezig tot het antwoord er is.
- **Naam wijzigen in `reconnecting`**: `Screen` toont dan de herverbind-toestand, niet het formulier. Dus niets op te slaan.
- **Twee toestellen**: de laatste wint (zie risico). Het andere toestel ziet de nieuwe naam live, ook in het veld als de user daar niet aan het typen is. Typt hij wel, dan blijft zijn tekst staan.
- **App naar de achtergrond tijdens het opslaan**: het antwoord komt bij terugkeer. De melding of bevestiging staat dan alsnog onder de knop.
- **Een deep link naar `/info/privacy` terwijl je ingelogd bent**: Home, niet de privacypagina. Een deep link naar de juiste plek is voor WP22.

### Contract voor A's tests

| Module | Signatuur | Pint |
|---|---|---|
| `convex/lib/constants.ts` | `VISIT_PERIOD_MS = 3_600_000`, `NAME_MAX_LENGTH = 50` | punt 2 en 3 |
| `convex/users.ts` | `updateProfile` gooit bij een ongeldige naam `ConvexError({ code })`, met `code` = `NAME_EMPTY`, `NAME_TOO_LONG` of `NAME_INVALID` | invarianten 1 en 9 |
| `convex/users.ts` | `recordVisit` (bestaat), met throttle en zonder schrijven in de `users`-rij | invarianten 5 en 6 |
| `convex/users.ts` | `getLastVisit`: internal query, `{ userId: Id<"users"> }` → `number \| null` | punt 1 |
| `convex/users.ts` | `profile`: publieke query, `{}` → `ownProfile \| null`, `null` zonder identity of rij | invariant 7 |
| `convex/lib/shapes.ts` | `ownProfile` zonder `lastVisitAt` | invariant 6 |
| `app/src/lib/visit.ts` | `VISIT_PERIOD_MS`; `shouldRecordVisit(input: { previous: { appState: string; authState: SessionState }; current: { appState: string; authState: SessionState }; userId: string \| null; now: number; lastAttempt: { userId: string; at: number } \| null }): boolean` | punt 2, invarianten 5 en 12 |
| `app/src/lib/nameError.ts` | `NAME_MAX_LENGTH`; `nameErrorText(error: unknown): string` | invariant 10 |
| `app/src/lib/infoPages.ts` | `INFO_PAGES: readonly { slug: string; title: string }[]`; `infoPath(slug: string, signedIn: boolean): string` | punt 4, routes |
| `app/src/lib/routeAccess.ts` | `PUBLIC_PATHS` = `/inloggen`, `/info`, `/info/over`, `/info/privacy`, `/info/voorwaarden` | invariant 4 |

Tests:
- root: `tests/users/updateProfileName.test.ts`, `tests/users/recordVisit.test.ts` (herschreven), `tests/users/profileQuery.test.ts`
- app: `app/tests/visit.test.ts`, `app/tests/nameError.test.ts`, `app/tests/infoRoutes.test.ts`

Aangepaste bestaande tests (bewust):
- `tests/readWhitelist/_world.ts`: `SHAPE.ownProfile` zonder `lastVisitAt`. De seed vult hem nog wel: zo bewijst de test dat hij niet lekt.
- `tests/readWhitelist/inventory.test.ts`: `users:profile` erbij.
- `app/tests/routeAccess.test.ts`: de test "bevat in 15a alleen /inloggen" kijkt nu naar de set van 15b.
- `tests/users/recordVisit.test.ts`: "server throttled niet" vervalt (punt 2).


Doc-deliverables voor B: cascade-rij U11 (`deleteSelf` ruimt het bezoek op) in `cascade-matrix.md`; de runbook-regels hieronder in `external-services.md` §Convex; design.md §10 nr. 14 op "opgelost".

### Ops-runbook (aanvulling op B's regel in `external-services.md`)

- `recordVisit` staat in het dashboard onder Functions. Verwacht één aanroep per terugkeer naar de app, hoogstens één per uur per user. In de bezoektabel verandert hoogstens één keer per uur iets. Na een `recordVisit` volgt geen `users:current` en geen `users:profile`.
- De tabwissel: `users:profile` draait bij het openen van Profiel, en daarna alleen als je eigen rij wijzigt. Na een wissel naar een andere tab: geen `users:profile` meer, ook niet als je naam op een ander toestel wijzigt.

### Regie-besluiten (2026-11-03)

| # | Vraag van A | Besluit |
|---|---|---|
| 1 | AWS-bezoek migreren? | Nee (Wouter). Het eerste bezoek na T0 vult de bezoektabel. `users.lastVisitAt` blijft voorlopig in het schema, ongebruikt. Opruimen staat op de backlog in `migratie-status.md`. |
| 2 | WP23-tests aanpassen? | Ja (regie). De inventaristest vraagt precies om zo'n bewuste wijziging. |
| 3 | Eigen bezoektabel? | Ja (Wouter). Invariant 6 en gate-stap 4 blijven zoals ze zijn. |
| 4 | Teksten | Ingevuld in `WP15b-info-teksten.md` (Wouter): contact `wouter@clubalmanac.com`, alleen het adres (geen telefoon), de website blijft met de foto's. Clerk valt onder het EU-VS Data Privacy Framework ([Clerk DPF-notice](https://clerk.com/legal/dpf)). De back-upbelofte vervalt: het Starter-plan van Convex heeft geen automatische back-ups ([Convex docs](https://docs.convex.dev/database/backup-restore)). |
| 5 | Probleem melden | Naar een feature-WP (regie). In 15b alleen Contact via `mailto:`. |
