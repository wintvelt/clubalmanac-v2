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
| WP2 | Convex storage roundtrip via `ConvexHttpClient` | `convex/` | `CONVEX_URL` |
| WP4 | Clerk JWT validation roundtrip via `whoami` httpAction | `clerk/` | `CLERK_SECRET_KEY`, `CLERK_TEST_USER_*_EMAIL` |
| WP5 | Mailjet send + bounce webhook | `mailjet/` _(planned)_ | `MAILJET_*` |

Env-vars voor WP2-4 lopen via `.env.integration` (in `.gitignore`),
geladen door [`_helpers/setup.ts`](./_helpers/setup.ts) via `dotenv` —
geregistreerd als `setupFiles` in
[`vitest.integration.config.ts`](../../vitest.integration.config.ts).
Template: [`.env.integration.example`](../../.env.integration.example).

## WP2 — Convex storage setup

WP2 vereist eenmalig per dev-machine:

1. Kopieer `.env.integration.example` → `.env.integration` en vul
   `CONVEX_URL` met de **dev-deployment** URL (zie `.env.local`,
   `CONVEX_URL=...`). Niet prod (`deafening-shark-296`) — de
   safety-helper in [`_helpers/safety.ts`](./_helpers/safety.ts) blokkeert
   dat als tweede laag.
2. Op de Convex dev-deployment zelf (Convex dashboard → Settings →
   Environment Variables): zet `INTEGRATION_TEST_ENABLED=true`. De
   test-only functies in `convex/_test.ts` zitten achter deze gate;
   zonder de var throwen ze met een duidelijke foutmelding. Prod krijgt
   deze var nooit.

Beide lagen — client-side prod-URL-check én server-side env-var-gate —
moeten passeren voordat tests een storage-write kunnen doen. Self-protection
redundant by design: één laag falen ≠ data-pollutie op prod.

## WP4 — Clerk JWT roundtrip setup

WP4 pint dat de Clerk JWT-template `convex` daadwerkelijk de `email`-claim
doorlevert in productie (zie productie-blind-spot in plan-doc r.251 / 
`convex/lib/auth.ts` header-comment). Eenmalig per dev-machine + dev-deployment:

1. Vul in `.env.integration`:
   - `CLERK_SECRET_KEY` met het **dev-instance** secret (prefix `sk_test_`).
     De helper in [`_helpers/clerkAuth.ts`](./_helpers/clerkAuth.ts) weigert
     elke andere prefix als extra prod-bescherming.
   - `CLERK_TEST_USER_REGULAR_EMAIL` en `CLERK_TEST_USER_WEBMASTER_EMAIL`
     met de twee test-user-emails uit het Clerk dev dashboard.
2. Maak in Clerk dev dashboard (`picked-quail-97.clerk.accounts.dev`) twee
   users aan met deze emails (handmatig).
3. Op de Convex dev-deployment:
   - `INTEGRATION_TEST_ENABLED=true` (al gezet voor WP2).
   - `WEBMASTER_EMAILS` bevat de webmaster-test-user.
4. Voor beide test-users: zorg dat ze ook een `users`-record in Convex
   hebben (audit-7 §3: webmaster zónder users-record → `requireWebmaster`
   throwt). Eenvoudigste pad: log één keer in via de app of voer de
   `users.register`-mutation handmatig uit op dev.

## Waarom apart van de unit suite

- **Niet in CI:** netwerk-flakes, fair-use limits, externe downtime
  zouden anders builds breken op zaken die wij niet controleren.
- **Verschillende runtime:** unit-tests gebruiken edge-runtime VM
  (convex-test); integration-tests gebruiken plain Node + native fetch.
- **Verschillende discipline:** integration-tests pinnen externe contracten,
  niet onze eigen code-paths. Bij rood: bewijs dat onze aanname klopt-niet,
  niet dat onze code stuk is.
