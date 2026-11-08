# Integration test conventie

Aparte test-laag voor productie-blind-spots: aannames over externe services
die met mocks niet te valideren zijn (zie [`external-services.md`](./external-services.md)).

## Architectuur

- **Aparte config:** [`vitest.integration.config.ts`](../../vitest.integration.config.ts).
  Node-environment (geen edge-runtime VM), langere timeouts, alleen
  `tests/integration/**`.
- **Aparte folder:** [`tests/integration/`](../../tests/integration/), per
  externe service een sub-folder.
- **Aparte script:** `npm run test:integration`. Default `npm test` excludeert
  deze folder.
- **Niet in CI:** netwerk-flakes en fair-use limits zouden builds breken op
  zaken buiten onze controle. Lokaal handmatig draaien per werkpakket of
  vóór een release.
- **Env-vars per werkpakket:** via `.env.integration` (in `.gitignore`).
  WP1 (Photon) heeft geen env-vars nodig — publieke fair-use endpoint.

## Werkpakketten

Elk werkpakket pinnt het contract van één externe service:

| WP | Service | Status |
|----|---------|--------|
| WP1 | Photon reverse-geocoding | landed |
| WP2 | Convex storage roundtrip via `ConvexHttpClient` | landed |
| WP4 | Clerk JWT roundtrip via `whoami` httpAction | A landed, B WIP |
| WP5 | Mailjet send (direct Send-API-contract, via WP11) | landed |
| WP6 | Clerk onboarding-webhook (atomic, via WP11) | landed |

## Discipline

Integration-tests pinnen externe contracten, niet ons eigen gedrag. Bij rood:
**rapporteer eerst** welk gat tussen aanname en werkelijkheid je vindt. Geen
ad-hoc workarounds, geen scope-uitbreiding. Wouter beslist of het een
mini-fix-cyclus wordt of een aparte issue.

Niet klassiek RED→GREEN: groen vanaf eerste run is prima — dat valideert dat
productie-aannames kloppen. Het *bestaan* van de test is de waarde.

**Integration-tests zijn óók discovery.** Tijdens een run actief observeren wat
onverwacht is, niet alleen of de geplande assertions slagen. Externe API's
hebben gedrag dat in mocks nooit zichtbaar wordt — een retry-pattern dat
plotseling werkt, een response-shape die net iets afwijkt, een edge-case die
je niet had verwacht. Capture out-of-scope vondsten in een korte note
(backlog-sectie in `migratie-plan-convex.md`, of een `audit-track-record.md`
entry), **niet** door ze mee te slepen in de huidige WP-scope.

**Count-return voor data-mutations.** Cleanup of migration-mutations (alles
wat in één call meerdere rijen patcht of verwijdert) retourneert een
gestructureerd object met aantallen per tabel + totaal. Zonder die return is
"groene mutation-run" een geloof, niet een feit. Met de return kun je op
dev-deployment de baseline-counts vergelijken, en op prod-deployment met de
pre-flight-baseline uit [`data-migration-preflight.md`](./data-migration-preflight.md).
Idempotentie beschermt niet tegen filter-bugs — gestructureerd count-return
wel.

Voor integration-tests is **A + audit** de norm, niet de volle A→B→audit
cyclus uit [`ab-audit-workflow.md`](./ab-audit-workflow.md). De B-fase wordt
alleen toegevoegd wanneer de pin een productie-code-wijziging vereist
(bijvoorbeeld een nieuwe httpAction die nodig is om iets testbaar te maken).
Bij een groen-passende A-test ligt de waarde in het bestaan van de pin, niet
in een RED→GREEN cyclus.

## Test-only Convex functions achter een geheim

Voor werkpakketten die productie-code raken zonder dat we klanten daaraan
willen blootstellen (bv. WP2 — storage roundtrip moest auth-vrij ontkoppeld
worden van de bestaande Clerk-gekoppelde upload-httpAction) gebruiken we
**test-only Convex functions**: een apart bestand `convex/_test.ts` met
public mutation/query/action's die `ConvexHttpClient` kan aanroepen, plus de
route `GET /_test/whoami` in `convex/http.ts`.

Gate (WP26, `convex/lib/testGate.ts`): een aanroep werkt alleen als op de
deployment `INTEGRATION_TEST_ENABLED=true` staat, `INTEGRATION_TEST_SECRET`
niet leeg is, en de aanroeper exact dat geheim meestuurt: als argument
`testSecret` (functies) of header `X-Test-Secret` (whoami). Beide env-vars
staan alleen op dev; prod krijgt ze nooit. De tests sturen het geheim mee
via [`_helpers/testSecret.ts`](../../tests/integration/_helpers/testSecret.ts),
dat het uit `.env.integration` leest en luid faalt als het ontbreekt. De
[safety-helper](../../tests/integration/_helpers/safety.ts) blokkeert
daarnaast prod-URL's.

**Weigering:** functies gooien `ConvexError("Forbidden")`, whoami geeft 403.
Hetzelfde antwoord voor elke oorzaak, dus bij een weigering zijn er drie
mogelijkheden: de vlag staat niet op `true`, het geheim ontbreekt op de
deployment, of het geheim in `.env.integration` wijkt af (ook een spatie of
hoofdletter telt).

**Nieuwe test-only functie:** spread `testSecretArg` in de args en roep
`assertTestGate(testSecret)` aan als eerste regel van de handler, vóór elk
effect. Voeg een recept toe in `tests/testGate/_recipes.ts`;
`tests/testGate/inventory.test.ts` is rood zolang een publieke export van
`_test.ts` het argument of een recept mist. Een nieuwe `/_test`-route komt in
`HTTP_TEST_ROUTES` en gebruikt `testGateOpen`.

**Draai de tests pas als de code op dev staat.** Kent de deployment
`testSecret` niet, of klopt een ander argument niet, dan kan Convex' validatiefout
de waarden van de argumenten tonen, ook het geheim. Gebeurt dat: roteren
(zie [`external-services.md`](./external-services.md) §Test-only functies).

Deze aanpak triggert een volle A→B→audit cyclus (niet de A+audit norm
hierboven): A schrijft tests + spec, B implementeert `convex/_test.ts`,
auditor checkt onafhankelijkheid en roundtrip-correctheid.

## Waarom apart van de unit suite

- **Determinisme:** unit-tests moeten reproduceerbaar groen zijn op elke
  machine, elke commit. Externe API's geven geen garanties.
- **Snelheid:** integration-suite duurt seconden-tot-minuten, unit-suite is
  sub-seconde. Mengen verpest dev-feedback-loop.
- **Doel:** unit-tests testen ónze code. Integration-tests testen onze
  *aannames over* externe code. Verschillende vragen, verschillende lagen.
