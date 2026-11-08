# WP26: `_test`-functies achter een geheim

> Draft regie 2026-11-08. Backend-WP, klein. Uit de WP17a-red-team (R2). Vóór T0. A → B → audit → korte red-team → gate. Eigen branch `wp26`.

## Productdoel

Alleen wie het testgeheim heeft, kan op dev een `_test`-functie aanroepen. Op prod werkt geen enkele, ook niet met het geheim. De integratietests blijven werken.

## Aanleiding

`convex/_test.ts` bevat publieke functies voor de integratietests ([`integration-tests.md`](../conventions/integration-tests.md) §Test-only Convex functions). Ze checken alleen `INTEGRATION_TEST_ENABLED === "true"`, en die vlag staat op dev aan. Zonder login en zonder geheim kan dus iedereen met de URL van de dev-deployment:
- met `_test:storageDownloadUrl` een storage-URL krijgen voor elk beeld-id;
- met `_test:storageUpload` anoniem naar storage schrijven.

Op dev staan echte foto's van leden (de prod-extract).

## Invarianten

1. **Zonder geheim geen toegang.** Elke publieke functie in `convex/_test.ts` weigert zonder geheim of met een fout geheim, ook als `INTEGRATION_TEST_ENABLED` aan staat. Een ontbrekend en een fout geheim geven hetzelfde antwoord.
2. **Prod: nooit.** Staat `INTEGRATION_TEST_ENABLED` niet aan, of is er op de deployment geen geheim ingesteld, dan weigert elke `_test`-functie, ook met een geheim in de aanroep.
3. **Het geheim lekt niet.** Het staat niet in de repo, niet in een foutmelding, niet in een response en niet in een log.
4. **Elke functie, ook een nieuwe.** Een test pint dat elke publieke export van `convex/_test.ts` de gate heeft. Een functie die later wordt toegevoegd zonder gate, maakt die test rood.
5. **De integratietests werken.** Met het geheim in de omgeving van de tests draaien de bestaande integratietests die `_test` gebruiken zoals voorheen.

## Scope

- De gate in `convex/_test.ts`, en het meesturen van het geheim vanuit de integratietests (`tests/integration/`).
- Een inventaris van publieke functies die alleen voor tests bestaan, ook buiten `_test.ts`.
- `integration-tests.md` en `external-services.md` bijwerken: welke env-var, waar het geheim staat, hoe je het roteert.

**Bewust niet:** de integratietests zelf uitbreiden. `_test.ts` uit de prod-bundle halen (zie open vraag 2).

## Open vragen voor A (rapporteren aan regie)

1. **Vorm van de gate.** Hoe gaat het geheim mee (argument, of anders), hoe wordt het vergeleken, en welke naam krijgt de env-var? Advies met de reden.
2. **Prod.** Volstaat de gate (geen vlag en geen geheim op prod), of is er een manier om `_test.ts` niet op prod te deployen? Wat kost dat?
3. **Inventaris.** Welke publieke functies (query, mutation, action, httpAction) bestaan alleen voor tests of fixtures, ook buiten `_test.ts`? Welke zijn op dev zonder login aan te roepen?
4. **Oude URL's.** Een storage-URL van Convex verloopt niet (WP17a). Kan een URL die eerder via `storageDownloadUrl` is uitgedeeld nog steeds werken, en wat is daaraan te doen?
5. **Gate van de tests.** Welke tests in `tests/integration/` gebruiken `_test`, en hoe komen ze aan het geheim (`.env.integration`, gitignored)? Wat ziet wie de tests draait als het geheim ontbreekt?

## Risico-assessment

- **security/privacy:** hoog. Echte foto's op dev; anoniem lezen en schrijven. Het geheim zelf mag niet in de publieke repo of in logs lekken.
- **ops:** laag. Gaat het mis, dan falen de integratietests luid. Ze lopen niet in CI.
- **external deps:** middel. Een nieuwe env-var op de dev-deployment, die Wouter zet (`npx convex env` staat op de deny-lijst), plus `.env.integration` op de server.
- **multi-user/concurrency:** laag.
- **data/schema:** laag, geen wijziging.

## Werkwijze

| Stap | Wie | Wat |
|---|---|---|
| 1 | A | Spec-criticus en open vragen 1–5, RED tests voor invarianten 1–4. Geen oude code nodig. |
| 2 | Wouter | Besluiten op wat A voorlegt. Het geheim zetten op dev en in `.env.integration` op de server. |
| 3 | B | Impl. |
| 4 | Audit | Op spec, tests en impl. |
| 5 | Red-team | Kort: een pad naar test-functionaliteit of beelden op dev zonder geheim, ook buiten `_test.ts`. |
| 6 | Gate | Regie: op dev een `_test`-functie zonder geheim (geweigerd) en een integratietest met het geheim (groen). |

## Cross-refs

- [WP17a](./WP17a-fotos-bekijken.md) besluit 11 (red-team R2).
- [`integration-tests.md`](../conventions/integration-tests.md) §Test-only Convex functions, en de safety-helper in `tests/integration/_helpers/safety.ts`.
- [`external-services.md`](../conventions/external-services.md) §Convex (env-vars per deployment).

## Acceptance

- Tests: invarianten 1–4 in de unit-suite; bestaande suites groen.
- Gate: zie werkwijze stap 6.

---

## Spec-criticus aanvullingen (A, 2026-11-08)

Bronnen: `convex/_test.ts`, `convex/http.ts` (`/_test/whoami`), `convex/migration.ts` en `scripts/migrate/` (deploy-key-patroon, `verify`), de integratietests in `tests/integration/`, de WP17a-red-team. Geen oude code nodig.

### Kernvondsten

1. **Het gat is groter dan storage.** Zonder login kan iedereen met de dev-URL ook: een user met memberships en `albumLastSeen` wissen op Clerk-subject (`cleanupUserBySubject`); een invite, groep en user wissen op id (`cleanupOnboardingSeed`); elk storage-object wissen (`storageDelete`); users, groepen en invites aanmaken (`seedOnboardingFixture`); naam en e-mail van een user lezen op subject (`getUserBySubject`); per e-mailadres zien of en voor welke groep iemand is uitgenodigd (`listInvitesByEmail`); memberships van een user lezen. Dus ook wissen en persoonsgegevens, niet alleen beelden.
2. **Geen geheim aan beide kanten is een open deur.** Ontbreekt het geheim op de deployment en ook in de aanroep (of is het aan beide kanten leeg), dan is "gelijk" waar. Invariant 2 dekt dit; de tests pinnen het apart.
3. **De gate moet vóór elk effect.** `storageUpload` slaat op vóór de check als de volgorde verkeerd is; een action draait niets terug. Een geweigerde aanroep laat niets achter (A-invariant 6).
4. **Convex toont bij een argumentfout de waarden.** Een aanroep met het geheim en een ander argument dat niet klopt (of een veld dat de functie niet kent) geeft een validatiefout waarin Convex de waarden kan tonen, ook het geheim. Die gaat naar de aanroeper en kan in de dev-logs staan. Wij kunnen dat niet afvangen: de validatie draait vóór de handler. Gevolg: draai de integratietests met het geheim pas nadat B's code op dev staat (anders is `testSecret` een onbekend veld). Restrisico, zie vraag W2.
5. **Bestaan en vorm blijven zichtbaar.** Convex valideert de argumenten vóór de gate, dus wie de URL heeft, ziet nog steeds dat een `_test`-functie bestaat en welke argumenten hij neemt (zoals de red-team deed). Geen lek: de repo is publiek.
6. **Er is een tweede test-pad buiten `_test.ts`:** de httpAction `GET /_test/whoami` (`convex/http.ts`). Hij vraagt een geldige Clerk-JWT van de dev-instance en geeft alleen de eigen identiteit en of je webmaster bent. Klein risico, maar wel test-functionaliteit zonder geheim. Zie A-keuze 2.
7. **De huidige weigering verraadt de config.** De melding noemt `INTEGRATION_TEST_ENABLED` en zegt dus aan een anonieme aanroeper of de vlag aan staat. Zie A-keuze 1.

### Antwoorden op de open vragen voor A

**1. Vorm van de gate.** Advies: een argument `testSecret` (optioneel, string) op elke publieke functie in `_test.ts`, vergeleken met de env-var `INTEGRATION_TEST_SECRET` op de deployment. De vergelijking is exact (geen trim, geen hoofdletter-ongevoeligheid, geen prefix) en hangt in tijd niet af van waar het eerste verschil zit. Leeg of ontbrekend telt aan beide kanten als "geen geheim" en weigert. Optioneel, zodat een ontbrekend en een fout geheim hetzelfde antwoord geven (invariant 1); als verplicht argument zou Convex bij ontbreken een eigen validatiefout geven. Het geheim: 32 willekeurige bytes, hex. Voor `/_test/whoami` een header `X-Test-Secret` (A-keuze 2).
Overwogen alternatief: de functies `internal` maken en vanuit de tests aanroepen met een dev-deploy-key, zoals `scripts/migrate/` (red-team R2 noemde dit). Sterker aan de buitenkant (anoniem bestaat de functie dan niet, geen eigen vergelijking, geen geheim in argumenten, dus geen kernvondst 4), maar een deploy key mag alles op dev: alle data, code deployen, en daarmee de env-vars van dev uitlezen (Mailjet, Clerk). Lekt het testgeheim, dan zijn alleen de `_test`-functies open; lekt een deploy key, dan alles. En `/_test/whoami` blijft een publieke route. Beslissing: vraag W1.

**2. Prod.** De gate volstaat, mits op prod geen `INTEGRATION_TEST_ENABLED` en geen `INTEGRATION_TEST_SECRET` staan. Een aparte bundel zonder `_test.ts` kan niet netjes: Convex deployt de hele `convex/`-map, per deployment uitsluiten bestaat niet. Het alternatief is een deploy-script dat het bestand vóór `npx convex deploy` weghaalt; dan breekt `http.ts` (verwijst naar `internal._test`) en wijkt de prod-code af van wat getest is. Kost meer dan het oplevert. Wel nodig: een stap in de T0-checklist dat beide env-vars op prod ontbreken (Wouter, `npx convex env list --prod`).

**3. Inventaris.** Publiek en alleen voor tests:

| Functie | Soort | Zonder login op dev (nu) |
|---|---|---|
| `_test:storageUpload` | action | ja: anoniem schrijven |
| `_test:storageDownloadUrl` | query | ja: URL voor elk storage-id |
| `_test:storageDelete` | mutation | ja: elk storage-object wissen |
| `_test:getUserBySubject` | query | ja: naam, e-mail |
| `_test:listInvitesByEmail` | query | ja: invites per e-mail |
| `_test:listMembershipsByUserId` | query | ja: groepen van een user |
| `_test:seedOnboardingFixture` | mutation | ja: users, groep, invite aanmaken |
| `_test:cleanupUserBySubject` | mutation | ja: user wissen |
| `_test:cleanupOnboardingSeed` | mutation | ja: invite, groep, user wissen op id |
| `GET /_test/whoami` (`http.ts`) | httpAction | nee: vraagt een dev-JWT; geeft de eigen identiteit |

Intern en alleen voor tests: `_test:whoamiCheckWebmaster` (vlag-gegate, alleen via `/_test/whoami`). `smoke:ping` is publiek en geeft alleen "pong": geen data, buiten scope. Alle andere publieke functies zijn productie (WP23-inventaris). `convex/migration.ts` is volledig `internal`.

**4. Oude URL's.** Ja: een URL die ooit via `storageDownloadUrl` is uitgedeeld, werkt tot het object gewist is (WP17a kernvondst 1). Er is geen lijst van uitgedeelde URL's; de dashboard-logs gaan maar kort terug. Wie een URL wilde, had eerst een storage-id nodig, en die geeft geen publieke response (WP17a invariant 10, red-team "niet gelukt"). Echte kans: klein. Prod staat los: prod krijgt op T0 eigen storage-objecten, dus een dev-URL raakt prod nooit. Wat je kunt doen, oplopend in kosten: (a) accepteren; (b) in de dev-logs zoeken op `_test:storageDownloadUrl`, zover ze teruggaan; (c) de beelden op dev opnieuw laden (`migrate reset` en `load-files` op dev): nieuwe objecten, oude URL's dood. Advies: (a) plus (b), en `npm run migrate -- verify dev` om te zien of er anoniem geschreven of gewist is (vraag W3).

**5. Gate van de tests.** Gebruiken `_test`: `tests/integration/convex/storage.test.ts`, `tests/integration/convex/storageUrl.test.ts`, `tests/integration/clerk/onboardingWebhook.test.ts` (functies) en `tests/integration/clerk/jwtRoundtrip.test.ts` (`/_test/whoami`). Ze lezen `INTEGRATION_TEST_SECRET` uit `.env.integration` (gitignored) via een helper in `tests/integration/_helpers/`. Ontbreekt hij, dan faalt de test met een melding die de env-var en `.env.integration.example` noemt; geen skip, zodat een gate-run zonder geheim niet groen lijkt. A heeft deze aanpassing gedaan (tests zijn van A).

### A-keuzes ter bevestiging

De tests staan in een eigen `describe` met "A-keuze n" in de naam.

1. **Eén weigering voor alles.** Vlag uit, geen geheim op de deployment, geen geheim in de aanroep, een fout geheim: per functie hetzelfde antwoord, zonder de naam of stand van een env-var. Wie de tests draait en een weigering krijgt, vindt de drie oorzaken in `integration-tests.md`. Nu verraadt de melding of de vlag aan staat.
2. **`/_test/whoami` krijgt dezelfde gate**, met het geheim in de header `X-Test-Secret`. De gate komt vóór de JWT-check: zonder geheim hetzelfde antwoord, met of zonder geldige JWT, en hetzelfde als vlag uit. Met het geheim blijft alles zoals nu (401 zonder of met ongeldige JWT, 200 met identiteit). Valt deze keuze weg, dan vervalt `tests/testGate/whoami.test.ts` en de header in `jwtRoundtrip.test.ts`.

### Aanvullende invarianten

6. **Een weigering laat niets achter.** Geen storage-object, geen rij aangemaakt, gewist of gewijzigd.
7. **Alleen het exacte geheim.** Een geheim met een teken meer of minder, een prefix, andere hoofdletters of witruimte eromheen weigert.
8. **Ook de waarde van de aanroeper lekt niet.** Een fout geheim (bijvoorbeeld een oud, geroteerd geheim) staat niet in de weigering of in een log. Invariant 3 geldt dus voor beide waarden, voor zover onze code ze kan tonen (kernvondst 4).

### Edge cases

- **Volgorde bij het zetten:** staat B's code op dev vóór het geheim, dan weigert alles (fail-closed). Andersom ook. Geen volgorde nodig.
- **Roteren:** nieuwe waarde op dev en in `.env.integration`; Convex leest env-vars per aanroep, dus direct actief. Tussendoor falen de tests luid.
- **Vlag op prod per ongeluk aan:** zonder geheim op prod nog steeds dicht (invariant 2). Beide moeten fout gaan.
- **Interne functies** (`whoamiCheckWebmaster`) zijn niet van buiten aan te roepen en houden de vlag-check; geen geheim nodig.

### Open vragen voor Wouter (met advies)

- **W1. Geheim-argument of interne functies met deploy key?** Advies: geheim-argument (vraag 1). Kleinste sleutel voor de kleinste deur. Kies je de deploy key, dan schrijft A de tests om (de huidige pinnen het argument).
- **W2. Restrisico kernvondst 4 accepteren?** Advies: ja. Het geheim verschijnt alleen bij een eigen fout in een aanroep mét het geheim, en dan bij die aanroeper en in de dev-logs die alleen jij ziet. Na zo'n fout: roteren.
- **W3. Oude URL's en dev-data.** Advies: accepteren, en eenmalig `npm run migrate -- verify dev` draaien: `orphanCount` boven wat de tests achterlieten wijst op anoniem schrijven, `danglingCount` boven 0 op anoniem wissen. Daarnaast in het dashboard (Logs) filteren op `_test:` en kijken of er aanroepen zijn die niet van jou zijn. Bij twijfel: beelden op dev opnieuw laden (vraag 4c).
- **W4. T0-check.** Een regel in de cutover-checklist: op prod staan `INTEGRATION_TEST_ENABLED` en `INTEGRATION_TEST_SECRET` niet. Regie zet hem in `migratie-status.md`.

### Wat Wouter zet (na W1)

- Een geheim maken (bijvoorbeeld `openssl rand -hex 32`), op de dev-deployment als `INTEGRATION_TEST_SECRET` en in `.env.integration` op de server. Nergens anders, niet in de repo, niet in een chat.

### Tests

| Bestand | Pint |
|---|---|
| `tests/testGate/_recipes.ts` | Per publieke `_test`-functie een geldige aanroep (geen test, gedeeld) |
| `tests/testGate/functions.test.ts` | Invariant 1, 2, 3 en A-invariant 6, 7, 8 per functie; A-keuze 1 |
| `tests/testGate/inventory.test.ts` | Invariant 4: elke publieke export van `_test.ts` heeft `testSecret` en een recept; elke `/_test`-route staat in de lijst |
| `tests/testGate/whoami.test.ts` | A-keuze 2 |
| `tests/integration/**` (aangepast) | Invariant 5: het geheim gaat mee (`_helpers/testSecret.ts`); `.env.integration.example` noemt de var |
| `tests/integration/convex/testGate.test.ts` | Gate-stap 6 op dev: zonder en met fout geheim dezelfde weigering, met het geheim werkt het (niet in CI) |

Het geheim in de tests is een nep-waarde. Rood bij A: 220 tests in `tests/testGate/`, allemaal omdat `testSecret` niet bestaat of de gate ontbreekt; de rest van de suite groen. De integratietests zijn niet gedraaid (eerst B op dev, kernvondst 4). B werkt `integration-tests.md`, `external-services.md` en `tests/integration/README.md` bij (scope).
