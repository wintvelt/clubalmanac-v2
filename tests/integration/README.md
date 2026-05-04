# Integration tests

Tests die tegen **echte externe services** praten — geen mocks, geen Convex
in-memory runtime. Doel: aannames over service-contracten valideren die de
default suite (mocks-only) niet kan vangen. Zie productie-blind-spots in
[`docs/conventions/external-services.md`](../../docs/conventions/external-services.md).

## Hoe runnen

```sh
npm run test:integration
```

Aparte config: [`vitest.integration.config.ts`](../../vitest.integration.config.ts)
(node-environment, langere timeouts, alleen `tests/integration/**`).

De default `npm test` excludeert deze folder — CI roept alleen `test` aan,
integration draait nooit automatisch. Bewust: externe API's zijn flaky en
counten richting fair-use limits.

## Werkpakketten

Integration suite groeit per werkpakket. Elk werkpakket = aparte sub-folder.

| WP | Service | Folder | Env-vars |
|----|---------|--------|----------|
| WP1 | Photon (Komoot) reverse geocoding | `photon/` | _(geen)_ |
| WP2 | Convex deployment + `ConvexHttpClient` | `convex/` _(planned)_ | `CONVEX_URL` |
| WP3 | Clerk JWT validation roundtrip | `clerk/` _(planned)_ | `CLERK_*` |
| WP4 | Mailjet send + bounce webhook | `mailjet/` _(planned)_ | `MAILJET_*` |

Env-vars voor WP2-4 lopen via `.env.integration` (in `.gitignore`,
`dotenv`-style loading komt mee met die werkpakketten).

## Waarom apart van de unit suite

- **Niet in CI:** netwerk-flakes, fair-use limits, externe downtime
  zouden anders builds breken op zaken die wij niet controleren.
- **Verschillende runtime:** unit-tests gebruiken edge-runtime VM
  (convex-test); integration-tests gebruiken plain Node + native fetch.
- **Verschillende discipline:** integration-tests pinnen externe contracten,
  niet onze eigen code-paths. Bij rood: bewijs dat onze aanname klopt-niet,
  niet dat onze code stuk is.
