# WP13: App-scaffold + Clerk-login

> Regie-draft. A vult onderaan aan (spec-criticus + pariteit-checklist). App-WP: lichtere A-variant, zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4).

## Productdoel

Een bestaande user opent de nieuwe app op een iPhone (simulator), logt in met zijn e-mailadres en een code uit zijn mail, en ziet zijn eigen naam uit Convex. Na het herstarten van de app is hij nog steeds ingelogd.

## Invarianten

1. **Eén bron voor de API-types.** De app gebruikt de getypeerde API uit `convex/_generated` van deze repo. Geen kopie, geen handgeschreven types voor Convex-functies. Een backend-wijziging die een aanroep in de app breekt, laat de typecheck van de app falen.
2. **Eén Convex-versie.** De `convex`-client in de app is dezelfde versie als die waarmee `convex/_generated` gemaakt is.
3. **Backend-tooling blijft ongemoeid.** `npm ci`, `npm run typecheck` en `npm test` in de root doen na deze WP hetzelfde als ervoor. App-bestanden lekken niet in de root-typecheck of de vitest-suite.
4. **Ingelogd = geldige Clerk-sessie + gevonden users-rij.** Het hoofdscherm toont alleen data als `users.current` een rij teruggeeft. Ingelogd zonder rij (webhook nog niet verwerkt, of geen account) is een eigen, zichtbare toestand: geen leeg scherm en geen crash.
5. **Sessie overleeft een herstart.** Het Clerk-token staat in de veilige opslag van het toestel, niet in platte opslag.
6. **Uitloggen is volledig.** Na uitloggen staat er geen token met een actieve sessie meer op het toestel, en de Convex-client stuurt geen identiteit meer mee. (Clerk kan een token zonder sessie terugschrijven; dat geeft geen toegang.)
7. **Geen stille env-defaults.** Ontbreekt de Convex-URL of de Clerk publishable key, dan stopt de app bij de start met een duidelijke melding. Geen terugval op een hardcoded deployment, zeker niet op prod.
8. **App Store-identiteit.** Bundle ID `com.wintvelt.clubalmanac-app` en EAS project `bd5c6c93-059d-409f-bca5-f658ec5722d5`. Het versie- en buildnummer liggen boven de laatst gepubliceerde versie van de oude app, zodat WP14 zonder aanpassing kan uploaden.
9. **Inloggen wijzigt de gezaaide data niet.** Inloggen als een van de drie dev-accounts maakt geen tweede users-rij aan en overschrijft geen velden van de gezaaide rij. Dit loopt via het bestaande `session.created`-pad (WP6).
18. **Inloggen = e-mailadres + eenmalige code uit de mail. Geen wachtwoord.** De app vraagt nergens om een wachtwoord en biedt geen wachtwoord-schermen.
19. **De login-flow laat ruimte voor de mail-link.** Een later WP (WP22) laat een link in de mail de app openen en de login afronden. WP13 bouwt die link niet, maar niets in WP13 mag hem blokkeren: de code moet ook van buiten het invoerveld in de lopende login terecht kunnen komen.

## Edge cases + scope-uitsluitingen

**In scope:**
- Verse Expo-app in `app/` (huidige stabiele Expo SDK), TypeScript strict
- Inlogscherm: e-mailadres → code per mail → code invoeren. Opnieuw sturen van de code. Uitloggen. Foutmeldingen bij een verkeerde of verlopen code en een onbekend account
- Eén scherm achter de login dat `users.current` toont
- De drie toestanden van invariant 4: niet ingelogd / ingelogd zonder rij / ingelogd met rij
- Typecheck van de app in CI, naast de bestaande root-checks
- Draait in de iOS-simulator tegen dev `glorious-pheasant-759` en Clerk dev `picked-quail-97`

**Bewust niet (voor deze WP):**
- Registreren / signup: dat is invite-only en hoort bij de invites-WP
- De link in de mail die de app opent: WP22
- Clerk-dev-instance omzetten naar code-login (wachtwoord uit): dashboard-actie van Wouter, vóór B start
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
- **ops-runbook-impact:** twee nieuwe client-env-vars: Convex-URL en Clerk publishable key, per omgeving (dev nu, prod in fase 5). Ze landen in [`external-services.md`](../conventions/external-services.md), met waar ze lokaal staan (gitignored) en hoe ze later in EAS komen. Ook de Clerk-dashboardinstellingen voor de app-login komen daar: e-mailcode als enige inlogmethode, wachtwoord uit, en de native-app-config als Clerk die vraagt. B levert de runbook-entry mee.

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
  4. Verkeerde code → leesbare foutmelding; nieuwe code aanvragen werkt
  4a. Verlopen code → eigen leesbare melding (bevestigt meteen de Clerk-foutcodes uit het test-contract)
  4b. Code aanvragen, "ander e-mailadres" kiezen, app afsluiten en openen → het code-scherm van het oude adres komt niet terug
  5. Na de gate: de users-rij van dev1 is ongewijzigd (invariant 9)
  6. Ruimte voor bevindingen buiten deze scenario's

---

## Regie-besluit 2026-10-25: code-login, geen wachtwoord

Na A's open vragen 1-3 koos Wouter voor **inloggen met een code per mail, zonder wachtwoord**. Reden: met "wachtwoord vergeten" via de mail is een wachtwoord niet sterker dan de mailbox zelf, en het scheelt de wachtwoord-schermen plus het activatieprobleem bij de cutover. Eis van Wouter: een link in de mail opent de app op de telefoon en rondt de login af. Die link komt in WP22 (invariant 19).

Gevolgen:
- Invarianten 15 en 17 en het test-contract voor `loginErrors` hieronder gingen uit van een wachtwoord. A werkt ze bij.
- Open vragen 1-3 zijn hiermee beantwoord. Fase 5 maakt de Clerk-accounts vooraf aan via de Users-API, zonder wachtwoord en zonder uitnodiging.
- Dev-testaccounts `devN+clerk_test@example.com` krijgen geen echte mail. Clerk accepteert daar de vaste testcode.

## Spec-criticus aanvullingen (A, 2026-10-25)

Bron: oude app `../DEV/clubalmanac-app` (Expo 47, Amplify/Cognito), `app.json`, `eas.json` en de meegeleverde `.ipa`. De oude login was volledig client-side Cognito; de AWS-backend speelt geen rol in deze flow.

### Invariant 8: versie en build

| Gegeven | Waarde | Bron |
|---|---|---|
| Laatst gebouwde versie | **1.6.0**, build **38** | `build-1679776789329.ipa` (25-03-2023), `app.json` |
| Buildnummer-beheer | `appVersionSource: "remote"`: EAS houdt de teller bij, niet `app.json` | `eas.json` |
| App Store Connect app-ID | `1663038609` | `eas.json` §submit (nodig in WP14) |
| iPad | `supportsTablet: true` | `app.json` |

- Nieuwe app: versie **2.0.0** (hoger dan 1.6.0, en een nieuwe app). Buildnummer via dezelfde remote EAS-teller van project `bd5c6c93-…`. Die komt dan vanzelf boven 38.
- Niet bewezen: dat 1.6.0 ook de laatst *goedgekeurde* versie is. De `.ipa` bewijst alleen dat hij gebouwd is. Wouter checkt dit in App Store Connect vóór WP14.
- **Nieuwe invariant 8a: iPad-ondersteuning blijft aan.** Een update mag geen apparaten laten vallen die de vorige versie ondersteunde. App Store Connect weigert zo'n build. Dus `supportsTablet` blijft `true`, ook al ligt de focus op iPhone.
- **Nieuwe invariant 8b: URL-scheme blijft `clubalmanac`.** De oude app opende links als `clubalmanac://invites/<id>`. WP13 gebruikt ze nog niet, maar het scheme ligt hiermee vast.

### Aanvullende invarianten

10. **Er zijn vijf toestanden, niet drie.** Naast de drie van invariant 4:
    - *laden*: Clerk of Convex weet het nog niet. Kort, met een indicator.
    - *Convex weigert het token*: Clerk is ingelogd, maar Convex accepteert het token niet. Oorzaken: Clerk-instance en Convex-deployment horen niet bij elkaar, of de JWT-template `convex` ontbreekt. Ook dit is een zichtbare foutmelding: geen eindeloze spinner, en niet "ingelogd zonder rij". Dit is de runtime-vangst voor een verkeerde env-combinatie (invariant 7 vangt alleen *ontbrekende* waarden).
11. **Uitloggen kan in élke ingelogde toestand**, ook in "ingelogd zonder rij" en "Convex weigert token". Anders zit de user vast in een sessie zonder uitweg.
12. **"Ingelogd zonder rij" lost zichzelf op.** `users.current` is live. Maakt de webhook de rij alsnog aan, dan gaat het scherm vanzelf naar "ingelogd met rij", zonder herstart of opnieuw inloggen.
13. **Geen data van de vorige user.** Log in als A, log uit, log in als B: het scherm toont nooit, ook niet heel kort, de naam van A. Als Clerk uitgelogd is, wint dat altijd van gecachte Convex-data.
14. **Geen geheimen in de app-bundel.** Alles met `EXPO_PUBLIC_` komt leesbaar in de app. Een Clerk *secret* key (`sk_…`) in plaats van de publishable key moet de app weigeren bij de start. De foutmelding toont de waarde niet.
15. **Geen test-inloggegevens in de app.** De oude app had in de dev-build knoppen met hardcoded e-mail + wachtwoord. Dat nemen we niet over. Ook geen vooringevulde `+clerk_test`-adressen of vaste testcode, niet achter een dev-vlag en niet voor de dev-accounts.
16. **Inloggen roept alleen lees-functies aan.** WP13 roept geen `recordVisit` aan (dat is WP15). Anders schrijft inloggen `lastVisitAt` en breekt invariant 9.
17. **De app verraadt niet of een e-mailadres bij een account hoort.** Na de e-mailstap ziet de user bij een bekend en een onbekend adres hetzelfde: het code-scherm met een neutrale melding ("als dit adres bij ons bekend is, krijg je een code; komt er niets, controleer het adres"). Dat geldt ook als Clerk toch `form_identifier_not_found` teruggeeft. De bescherming van Clerk tegen enumeratie blijft aan; de app is het tweede slot. Verkeerde code, verlopen code, te veel pogingen en een geblokkeerd account krijgen wél elk een eigen NL-melding. Een onbekende fout toont een algemene NL-melding, nooit de ruwe Engelse Clerk-tekst.
20. **Naar Mail en terug breekt de login niet.** De user verlaat de app om de code te lezen. Komt hij terug, dan staat het code-scherm er nog, voor hetzelfde e-mailadres. De app vraagt bij terugkomst nooit uit zichzelf een nieuwe code aan: dan klopt de code in de mail niet meer.

### Edge cases bij inloggen

- **Twee stappen.** Stap 1: e-mailadres → Clerk stuurt een code. Stap 2: code invoeren. Vanaf stap 2 kan de user terug naar stap 1 om een ander adres te kiezen. Het code-scherm toont het ingevoerde adres, zodat een tikfout opvalt; bij een onbekend adres komt er immers geen mail en geen foutmelding.
- **Code opnieuw sturen.** Vanaf het code-scherm. De app meldt dat er een nieuwe code onderweg is en dat alleen de nieuwste code werkt. Clerk begrenst hoe vaak dat mag; de melding daarvan valt onder invariant 17.
- **Code plakken of laten invullen.** iOS kan een code uit Mail zelf voorstellen boven het toetsenbord. Het invoerveld staat dat toe (veld voor eenmalige codes, cijfertoetsenbord). Geplakte tekst met spaties of een streepje ("123 456") werkt ook. Dit is ook de opstap voor invariant 19.
- **Inloggen is na de code niet altijd klaar.** Geeft Clerk na een juiste code nog een vervolgstap terug (bv. een tweede factor als iemand die ooit aanzet), dan is dat een zichtbare melding. Nooit stil blijven hangen.
- **E-mailadres invoeren.** Spaties voor of achter het adres halen we weg. Geen autocorrectie of hoofdletter aan het begin (de oude app had die ook uit).
- **Dubbel tikken** op "stuur code" of "log in" start geen tweede poging terwijl de eerste loopt. Bij "stuur code" zou een tweede poging de eerste code ongeldig maken.
- **Geen netwerk**: een leesbare melding, geen crash.
- **Env-vars en Expo.** Expo neemt een `EXPO_PUBLIC_`-var alleen in de build op bij letterlijke toegang (`process.env.EXPO_PUBLIC_X`). Een dynamische lookup levert `undefined` in de build. Door invariant 7 crasht de app dan bij de start. Dat is luid, maar wel verwarrend.
- **Twee kopieën van `convex`.** De app importeert `convex/_generated` uit de root. Die bestanden lossen `convex/*` op vanuit de root-`node_modules`, terwijl de app zijn eigen `convex` heeft. Daarom bestaat invariant 2, en de test hieronder bewaakt hem via de lockfiles.
- **Root niet als npm-workspace.** Is de root een workspace met `app/` erin, dan installeert root-`npm ci` heel Expo/React Native mee, en dat breekt invariant 3. `app/` krijgt dus een eigen `package.json` + lockfile.

### Contract voor A's tests (pure logica)

Tests staan in `app/tests/`. Ze draaien met vitest in Node, zonder React Native, via `npm test` in `app/`. CI draait in `app/`: typecheck + test, naast de bestaande root-stappen. De root-vitest pakt `app/tests/` niet op: de include `tests/**` geldt vanaf de root.

| Module | Signatuur | Pint |
|---|---|---|
| `app/src/lib/env.ts` | `parseClientEnv(env: { EXPO_PUBLIC_CONVEX_URL?: string; EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?: string }): { convexUrl: string; clerkPublishableKey: string }` | Invarianten 7 en 14. Gooit een `Error` die elke ontbrekende of ongeldige var bij naam noemt. Convex-URL: `https`, host eindigt op `.convex.cloud` (niet `.convex.site`, dat is de HTTP-actions-host). Clerk-key: begint met `pk_test_` of `pk_live_`. |
| `app/src/lib/authState.ts` | `deriveAuthState(input: { clerkLoaded: boolean; clerkSignedIn: boolean; convexAuthLoading: boolean; convexAuthenticated: boolean; currentUser: undefined \| null \| object }): "loading" \| "signedOut" \| "convexAuthFailed" \| "noUserRow" \| "ready"` | Invarianten 4, 10 en 13. `currentUser` volgt de `useQuery`-conventie: `undefined` = laadt, `null` = geen rij. |
| `app/src/lib/loginErrors.ts` | `loginErrorMessage(error: unknown): string` en `emailStepResult(error: unknown): { kind: "codeScreen" } \| { kind: "error"; message: string }` | Invariant 17. Input = wat Clerk gooit: een object met `errors: [{ code, message, longMessage }]`, of iets anders (`undefined` = geen fout). `emailStepResult` beslist na de e-mailstap: geen fout en een onbekend account geven allebei `codeScreen`; andere fouten geven `error` met de melding van `loginErrorMessage`. Gooien zelf nooit. |
| `app/src/lib/loginCode.ts` | `normalizeLoginCode(input: string): string \| null` | Invariant 19 + plakken. Geeft de 6 cijfers terug als de invoer na het weghalen van spaties, streepjes en regeleinden precies 6 cijfers is; anders `null`. Raadt niet uit langere tekst. |
| (geen module) | `app/tests/convexVersion.test.ts` | Invariant 2: de `convex`-versie in `app/package-lock.json` is gelijk aan die in de root-`package-lock.json`. |

De Clerk-errorcodes in de tests: `form_identifier_not_found` (mag niet zichtbaar worden), `form_code_incorrect`, `verification_expired`, `verification_failed`, `user_locked`, `too_many_requests`. B checkt ze tegen de Clerk-versie die hij vastzet.

### Ops-runbook (aanvulling op B's entry in `external-services.md`)

- De namen van de env-vars liggen vast: `EXPO_PUBLIC_CONVEX_URL` en `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`. Lokaal in `app/.env.local`, gitignored. De root-`.gitignore` dekt `.env.local` al in submappen; B checkt dat met `git check-ignore`.
- Clerk-dashboard: de Native API moet aan staan voor Expo (Configure → Native applications). E-mailcode als enige inlogmethode, wachtwoord uit, bescherming tegen enumeratie aan.

### Pariteit-checklist Track A

Per scherm het gedrag van de oude app, in het kort. "Backend?" = iets dat B of de A van dat WP in `convex/` moet nagaan; dit is geen vaststelling dat het ontbreekt.

**Zonder login**

| Scherm (oude naam) | Gedrag | WP |
|---|---|---|
| Inloggen | E-mail + wachtwoord. Melding bij verkeerde gegevens, geblokkeerd account en algemene fout. Links naar "wachtwoord vergeten" en "ik heb een uitnodiging". Tabbalk: inloggen / uitnodiging / info. | **WP13**, als e-mail + code (invariant 18) |
| Vergeten / Nieuw wachtwoord | Resetcode per mail, daarna een nieuw wachtwoord. Na succes direct ingelogd. Deep link `newPassword/:email/:code`. | vervalt (code-login). Het patroon "code uit de mail" leeft voort in WP13 + WP22 |
| Berichten | Uitnodigingscode invoeren → uitnodiging ophalen → "Uitnodiging". Foutmodaal bij een ongeldige of verlopen code. Link naar "e-mail bevestigen". | WP19 |
| Uitnodiging | Brief: van wie, bericht, groepscover. Accepteren → aanmelden; afwijzen. Deep link `invites/:inviteId`. | WP19 |
| Aanmelden | Code, naam, e-mail, nieuw wachtwoord, opt-in → "E-mail bevestigen". | WP19 |
| E-mail bevestigen | E-mail + code. Bug in de oude app: "code opnieuw sturen" riep wachtwoord-reset aan. Niet overnemen. | WP19 |
| Account maken | Cognito-flow voor accounts die de beheerder aanmaakte (tijdelijk wachtwoord → naam + nieuw wachtwoord). | vervalt: accounts worden vooraf aangemaakt (fase 5), de eerste login is een gewone code-login |
| Info / Over ons / Algemene voorwaarden / Privacy | App-naam en -versie, statische teksten. Privacy werd opgehaald van de oude API (`/info/privacy/nl`). | WP15. Backend? privacytekst |
| Probleem | E-mail en naam (optioneel), omschrijving, opt-in. Stuurt het lokale logbestand mee. Werkt ook zonder login. | WP20. Backend? melding zonder login |

**Met login**

| Scherm (oude naam) | Gedrag | WP |
|---|---|---|
| Tabbalk | Home (laatst bezochte groep, anders "Mijn groepen"), Mijn foto's, + (nieuwe foto's met de huidige groep/album als context), Profiel, Instellingen. In landscape een inklapbaar menu. | WP15 |
| Startscherm | Opent de laatst bezochte groep. Die voorkeur staat lokaal, per user. | WP15/16 |
| Hulpteksten | Eenmalige uitleg-modals (fotolijst, eigen foto, gemelde foto, groep, home). Per user lokaal onthouden, aan/uit in Instellingen. | WP15 of designstap |
| Mijn groepen | Groepen gesorteerd op datum, zonder openstaande uitnodigingen. Kaart: cover, naam, "sinds jaar", aantal leden, badge met nieuwe foto's. "Nieuwe groep". | WP16 |
| Groep (tabs) | Albums · Films (alleen hardcoded premium-groepen) · Leden. Admin extra: Cover · Uitnodigen. Header met naam, omschrijving, opgericht, leden/albums/foto's. | WP16 |
| Groep → Albums | Albums gesorteerd, badge met nieuwe foto's. Lege staat verschilt voor admin en gast. "Nieuw album" alleen voor admin. | WP16/17 |
| Groep → Leden | Secties uitgenodigd / admins / gasten, op naam. Labels "Eigenaar" en "Me". Menu per lid: groep verlaten, admin/gast maken, eigenaarschap overdragen, verwijderen, uitnodiging intrekken. Telkens met bevestiging. | WP16. Backend? eigenaar overdragen |
| Groep → Cover | Naam, omschrijving, datum, cover (uploaden of kiezen uit groepsfoto's). Knop "groep verwijderen" voor de eigenaar deed in de oude app niets. | WP16 |
| Groep → Uitnodigen | Verzendlijst opbouwen (naam, e-mail, als admin). Weigert dubbele adressen en bestaande leden. Bericht erbij, verzenden. | WP19 |
| Nieuwe groep / Kies cover | Naam, omschrijving, optionele cover / foto kiezen uit albums van de groep. | WP16 |
| Foto's (album) | Raster, cover bovenaan, markering voor nieuwe en eigen foto's. Tik → detail, lang drukken → foto-modal. Meervoudige selectie → selectiemenu. Kaart-knop. "Bewerk album" alleen voor admin. Deep link `photos/:groupId/:albumId`. | WP17 |
| Foto detail | Swipen door de lijst, zoom, eigenaar + datum, "staat in deze albums", foto-menu. | WP17. Backend? albums per foto |
| Foto-modal / foto-menu | Delen, als album- of groepscover (admin), als profielfoto, uit album halen (eigenaar), draaien (eigenaar/admin), locatie (eigenaar/admin), melden als ongepast (niet-eigenaar), overal verwijderen (eigenaar). | WP17 (melden: WP20) |
| Selectiemenu | Voor meerdere foto's: aan album toevoegen (alleen eigen), uit album halen (admin), verwijderen (eigen), melden (niet-eigen). Met voortgangsteller. | WP17/18/20 |
| Foto bewerken | Draaien links/rechts en spiegelen, opslaan via `photos.rotate` (WP8-contract). | WP17 |
| Bewerk album / Nieuw album / Kies album | Naam, datum, cover. Verwijderen alleen door de groepseigenaar, met bevestiging. Kies album: albums per groep, "nieuw album"-tegel bij admin-groepen, geselecteerde foto's toevoegen. | WP17 |
| Nieuwe foto's | Toestemming fotobibliotheek (met link naar Instellingen bij weigering), meerdere foto's kiezen (geen video), album kiezen, upload met teller voor klaar en fouten, "ga naar album" / "meer foto's". | WP18 |
| Mijn foto's | Eigen foto's per album plus "Ongepubliceerde foto's". Markering bij gemelde foto's. Selectie. Deep link `myphotos`. | WP17 |
| Kaart | Foto's met GPS als geclusterde markers. Foto's zonder locatie in een aparte stapel. Adres bij een marker. | **geen WP** |
| Foto locatie | Pin verslepen om de locatie van een foto te zetten, opslaan. | **geen WP** |
| Film | Videospeler, geluid ook in de stille modus. Lijst en covers hardcoded; volledige films alleen voor één groep. | WP21 |
| Profiel | Header: naam, avatar, lid sinds, aantal foto's. E-mail, "laatste bezoek". Menu: meldingen beoordelen (webmaster, als er iets openstaat), groepen, uitnodigingen, mijn gemelde foto's (met badge), profiel aanpassen, wachtwoord aanpassen (vervalt), uitloggen, account verwijderen. | WP15 (+19/20) |
| Profiel bewerken | Naam + avatar (uploaden of verwijderen). | WP15 |
| Wachtwoord aanpassen | Huidig + nieuw wachtwoord. | vervalt (code-login) |
| Account verwijderen | Uitleg (definitief, lidmaatschappen en foto's weg). Ter bevestiging het wachtwoord opnieuw invoeren, dan verwijderen en uitloggen. Zonder wachtwoord is een andere bevestiging nodig. | **geen WP** (backend `users.deleteSelf` bestaat) |
| Uitnodigingen / Uitgenodigd | Lijst met openstaande uitnodigingen + code handmatig invoeren. Accepteren (groep wordt home, ga naar groep) of afwijzen. Melding "uitnodiging voor iemand anders". | WP19 |
| Ongepast / Review ongepast | Eigen gemelde foto's: bezwaar maken of verwijderen. Webmaster: lijst met bezwaren bovenaan, goedkeuren of afwijzen. | WP20 |
| Instellingen | Home-groep wissen, hulpteksten aan/uit, app-versie, links naar info, voorwaarden, privacy en probleem melden (naam en e-mail vooraf ingevuld). | WP15 |

**Bewust niet overnemen:** de dev-knoppen met wachtwoorden (invariant 15), de hardcoded premium-groep-ID's (WP21 kiest een andere bron), de lege knop "groep verwijderen", de verkeerde "code opnieuw sturen".

### Mail-links in de oude app (input voor WP22)

De oude app opende alleen links met een **eigen scheme**: `clubalmanac://`. Er waren geen universal links: geen associated domains in de app en geen `apple-app-site-association` in de oude web-frontend. `Info.plist` registreerde de schemes `clubalmanac`, `com.wintvelt.clubalmanac-app` en `exp+clubalmanac-app` (die laatste alleen voor de dev-client).

| Mail | Wie stuurde hem | Link naar de app | Web-link in dezelfde mail | Scherm in de app |
|---|---|---|---|---|
| Wachtwoord resetten | Cognito, `CustomMessage_ForgotPassword` | `clubalmanac://newPassword/<email>/<code>` | `https://clubalmanac.com/confirmpsw?email=…&code=…` | "Nieuw wachtwoord", e-mail en code ingevuld |
| Aanmelding bevestigen | Cognito, `CustomMessage_SignUp` / `_ResendCode` | `clubalmanac:/verify/<email>/<code>` (één slash: waarschijnlijk een bug) | `…/verifysignup?email=…&code=…` | "E-mail bevestigen", e-mail en code ingevuld |
| Account activeren | Cognito, `CustomMessage_AdminCreateUser` | `clubalmanac://createAccount/<email>/<tijdelijk wachtwoord>` | `…/completepsw?email=…` | "Account maken" |
| Groepsuitnodiging | eigen Lambda `sendInvite` | `clubalmanac://invites/<code>` | `https://clubalmanac.com/invites/<code>` | "Uitnodiging" (uitgelogd) of "Uitgenodigd" (ingelogd) |

Bronnen (alleen A): `blob-images-api/handlersCognito/{sync,forgotPassword,verifySignup,tempPassword}.js`, `blob-images-api-groups/handlersGroup/sendInvite.js` + `emails/invite.js`, de `linking`-config in `clubalmanac-app/screens/NAVIGATOR.jsx`.

Wat WP22 hiervan kan leren:
- **Invullen, niet afronden.** De oude links vulden e-mail en code in het formulier in. De user tikte zelf nog op "bevestigen". De app rondde niets automatisch af.
- **De code stond als leesbare tekst in de mail**, naast de link ("Of kopieer onderstaande code"). De link was een extra.
- **Een eigen scheme is onbetrouwbaar in mail.** In de reset-mail stond de knop "Open in app" uitgecommentarieerd met de notitie *"button werkt niet in deze mail"*. Alleen een tekstlink bleef over. De mail zei er ook bij: alleen klikken "als je de app hebt en dit op je telefoon leest". Een universal link (https op een eigen domein + `apple-app-site-association`) valt terug op de browser als de app er niet is. Daarvoor is een domein nodig dat we zelf beheren.
- **E-mailadres en geheim stonden in het pad**, zonder encoding (`@`, `+`). Breekbaar, en het tijdelijke wachtwoord stond leesbaar in een URL.
- **Ingelogd en uitgelogd hadden elk een eigen link-config.** Hetzelfde pad (`invites/:id`) kwam in beide terecht, op een ander scherm.

### Open vragen voor regie / Wouter

1. **Ratings hebben geen scherm in de oude app.** De backend had ze wel (en Convex ook). Is WP19 "ratings" een nieuwe feature, of vervalt hij?
2. **"Laatste bezoek" op het profiel.** De oude backend bewaarde per dag het vorige bezoek (`visitDatePrev`) en toonde dat. Convex heeft alleen `lastVisitAt`, en `recordVisit` overschrijft die. Tonen we dit nog (WP15)?
3. **Kaart, foto-locatie en account verwijderen** vallen in geen enkel WP. Account verwijderen vraagt bovendien een nieuwe bevestiging nu het wachtwoord weg is.
4. **Invite-links.** De backend mailt `https://…/invite/<token>` (`CLUBALMANAC_APP_URL`). De oude app gebruikte `clubalmanac://invites/<id>`. Dat is dezelfde keuze als in WP22 (universal link of scheme); slim om die één keer te maken.
5. **DEV-label.** Wil je in niet-prod builds een zichtbaar "DEV"-label (afgeleid van `pk_test_`), als extra vangnet bij invariant 7? Niet gepind.
