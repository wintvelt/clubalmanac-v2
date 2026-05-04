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
| WP5 | Mailjet send + bounce webhook | planned |

## Discipline

Integration-tests pinnen externe contracten, niet ons eigen gedrag. Bij rood:
**rapporteer eerst** welk gat tussen aanname en werkelijkheid je vindt. Geen
ad-hoc workarounds, geen scope-uitbreiding. Wouter beslist of het een
mini-fix-cyclus wordt of een aparte issue.

Niet klassiek RED→GREEN: groen vanaf eerste run is prima — dat valideert dat
productie-aannames kloppen. Het *bestaan* van de test is de waarde.

Voor integration-tests is **A + audit** de norm, niet de volle A→B→audit
cyclus uit [`ab-audit-workflow.md`](./ab-audit-workflow.md). De B-fase wordt
alleen toegevoegd wanneer de pin een productie-code-wijziging vereist
(bijvoorbeeld een nieuwe httpAction die nodig is om iets testbaar te maken).
Bij een groen-passende A-test ligt de waarde in het bestaan van de pin, niet
in een RED→GREEN cyclus.

## Test-only Convex functions met env-var-gate

Voor werkpakketten die productie-code raken zonder dat we klanten daaraan
willen blootstellen (bv. WP2 — storage roundtrip moest auth-vrij ontkoppeld
worden van de bestaande Clerk-gekoppelde upload-httpAction) gebruiken we
**test-only Convex functions**: een apart bestand `convex/_test.ts` met
public mutation/query/action's die `ConvexHttpClient` kan aanroepen.

Elke test-only function gate't op `process.env.INTEGRATION_TEST_ENABLED ===
"true"` en throwt anders met een duidelijke melding. De env-var wordt
alleen op de dev-deployment gezet (Convex dashboard → Settings → Environment
Variables); prod krijgt 'm nooit. De [safety-helper in tests](../../tests/integration/_helpers/safety.ts)
blokkeert daarnaast prod-deployment-URLs als eerste laag — twee lagen,
self-protection redundant by design.

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
