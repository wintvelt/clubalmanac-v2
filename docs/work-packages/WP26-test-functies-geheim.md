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
