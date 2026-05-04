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
| WP2 | Convex deployment + `ConvexHttpClient` | planned |
| WP3 | Clerk JWT validation roundtrip | planned |
| WP4 | Mailjet send + bounce webhook | planned |

## Discipline

Integration-tests pinnen externe contracten, niet ons eigen gedrag. Bij rood:
**rapporteer eerst** welk gat tussen aanname en werkelijkheid je vindt. Geen
ad-hoc workarounds, geen scope-uitbreiding. Wouter beslist of het een
mini-fix-cyclus wordt of een aparte issue.

Niet klassiek RED→GREEN: groen vanaf eerste run is prima — dat valideert dat
productie-aannames kloppen. Het *bestaan* van de test is de waarde.

## Waarom apart van de unit suite

- **Determinisme:** unit-tests moeten reproduceerbaar groen zijn op elke
  machine, elke commit. Externe API's geven geen garanties.
- **Snelheid:** integration-suite duurt seconden-tot-minuten, unit-suite is
  sub-seconde. Mengen verpest dev-feedback-loop.
- **Doel:** unit-tests testen ónze code. Integration-tests testen onze
  *aannames over* externe code. Verschillende vragen, verschillende lagen.
