# WP7 — upload-pipeline empirische gate runbook

Eén mens-gate uit [`work-packages/README.md`](../work-packages/README.md) WP7-rij. Pin't de complete upload-pipeline `POST /upload → reservation → storage → scheduled extractMetadata → Photon reverseGeocode → locationLabel` op een echte iPhone-foto met EXIF + GPS.

Geïmplementeerd als integration-test (vs. WP5/WP6 die handmatige dashboard-stappen waren), omdat:
- `/upload` vereist een Clerk JWT — moeilijk handmatig te extraheren
- We hebben al `mintTokenForEmail`-helper uit WP4 — hergebruik
- Een test-file blijft pinnable en herbruikbaar voor regressies + pre-cutover-prod-run

## Pre-flight checklist

### A. Photo-fixture
- [ ] **Echte iPhone JPEG** met EXIF + GPS metadata kiezen. Eisen:
  - **JPEG** (geen HEIC — HEIC gaat door `extractMetadata` graceful-no-op vanwege exif-parser-limitatie en triggert de gate niet)
  - **EXIF DateTimeOriginal of CreateDate** gevuld (alle iPhone-foto's: ✓)
  - **GPS** coördinaten in EXIF (iPhone Settings → Privacy → Camera: Location aan vóór de foto werd genomen)
  - **< 20 MiB** (Convex platform-limit voor /upload-body)
- [ ] **Path bepalen** + niet committen — fixture is persoonlijk. Voorstel: `~/Pictures/wp7-gate-fixture.jpg` of vergelijkbaar.

### B. .env.integration

Zorg dat `.env.integration` deze vars bevat (zie [`.env.integration.example`](../../.env.integration.example)):

```
CONVEX_URL=https://glorious-pheasant-759.eu-west-1.convex.cloud
CLERK_SECRET_KEY=sk_test_<dev-secret>
CLERK_TEST_USER_REGULAR_EMAIL=clubalmanac-integration-regular@example.com
UPLOAD_GATE_PHOTO_PATH=/absolute/path/naar/iphone-foto.jpg
```

Optional: `UPLOAD_GATE_PHOTO_MIMETYPE=image/jpeg` (default als ongezet).

### C. Convex dev-deployment

- [ ] `INTEGRATION_TEST_ENABLED=true` op deployment (al gezet via WP4)
- [ ] `regular` test-user heeft Convex users-row (al aanwezig uit eerdere WPs — `clubalmanac-integration-regular@example.com`)
- [ ] Regular test-user heeft `photoLimit > photoCount` — bij 0/1000 geen issue
- [ ] Convex deployment up-to-date: `npx convex dev --once`

## Gate draaien

```bash
npm run test:integration -- tests/integration/uploads/uploadRoundtrip.test.ts
```

Verwacht: één test, ~3-15s, groen. Test:
- POST /upload → 200 + photoId in body
- Poll Convex tot scheduler-action `extractMetadata` klaar is (max 15s)
- Assert `takenAt`, `latitude`, `longitude`, `locationLabel` allemaal gevuld
- Cleanup: photo verwijderd via `photos.remove` met dezelfde JWT, Clerk-session gerevoked

## Pass-criterium

✅ Test groen — pipeline correct end-to-end op echte iPhone-foto.

Aanvullende verificatie via Convex Logs (Convex dashboard → Logs):
- Eén `/upload` http-action hit, status 200
- Eén `internal.uploads.reserve` mutation
- Eén `internal.photos.createFromUploadInternal` mutation (atomic: photo insert + reservation patch + scheduler-queue)
- Eén `internal.photoMetadata.extractMetadata` action, success (let op: `photoMetadata` namespace, niet `photos` — verhuisd naar `"use node";` file in gate-fix)
- Eventueel: Photon reverseGeocode fetch in log (debug-niveau)

## Bij fouten

- **`takenAt` undefined na 15s polling**: extractMetadata heeft EXIF niet kunnen parsen. Mogelijke oorzaken: HEIC i.p.v. JPEG (graceful-no-op-pad), corrupte EXIF, of exif-parser-bug. Check Convex Logs op extractMetadata-error.
- **`locationLabel` undefined maar `latitude`/`longitude` wel**: Photon API outage of GPS-coords te exotisch (Photon's coverage is wereldwijd maar niet perfect). Re-run later, of pin met andere photo.
- **401 op POST /upload**: Clerk JWT-template "convex" levert geen email-claim, of `auth.config.ts` mismatch. Check dat WP4 jwtRoundtrip-test ook nog groen is.
- **403 photo-limit bereikt**: test-user heeft photoCount === photoLimit. Cleanup oude test-photos via `npx convex data photos` + manual delete, of bump photoLimit op test-user.
- **409 race-loser**: zelfde X-Upload-Id binnen 30min. Onmogelijk in test (random uuid per run); duidt op test-runner-bug of stale state.
- **CONVEX_URL prod**: `assertNotProd` weigert — bewust, integration-tests draaien nooit tegen prod.

## Pre-cutover

Voor prod-cutover herhaal:
1. Zelfde test tegen prod Convex URL + prod Clerk secret + nieuwe `clubalmanac-integration-regular@prod.example` test-user (of vergelijkbare scratch-account)
2. Aparte `.env.integration.prod` met `assertNotProd`-bypass — of: skip integration-test in prod, vertrouw op dev-pin + smoke-test met echte gebruiker tijdens cutover-week
3. Documenteer in audit-track-record gates-passed

## Cross-refs

- Impl-cycli: [WP1] Photon switch, [WP2] storage roundtrip, [WP4] /upload httpAction + JWT-roundtrip
- Audit-cyclus-1 + cyclus-2 hardening: reservation pattern, EXIF DateTimeOriginal-fallback, locationLabel multi-deel format, HEIC graceful no-op
- Spec-doc: deze pipeline staat niet in een aparte WP-spec (impl was af vóór de WP-discipline begon); gate-discipline volgt het WP5/WP6-patroon
