# WP8: Photo rotation (EXIF-only)

> **Spec-revisie 2026-05-19**: oorspronkelijke spec (en A's eerste cyclus-werk) ging uit van server-side pixel-rotatie via `sharp` in een `"use node"`-action. Tijdens regie-review verviel dat pad: cyclus-2 hardening had de client al CSS-transform laten toepassen op basis van `photos.exifOrientation` uit Convex DB, waardoor de DB-waarde bron-van-waarheid is en pixel-manipulatie redundant. WP8 wordt nu **EXIF-only**: een mutation die `exifOrientation` herberekent via een 8-staat-arithmetiek-tabel. Geen `sharp`, geen scheduled action, geen `"use node"`-file, geen storage-swap, geen cleanup, geen integration-roundtrip op pixels.

## Productdoel

Wanneer een gebruiker zijn eigen foto (of een group-admin een foto in zijn groep) wil draaien of spiegelen, wordt de gewenste oriëntatie atomair in Convex vastgelegd zodat alle clients (iOS, web, toekomstige Android) de foto vanaf dat moment consistent in de juiste stand tonen.

## Invarianten

User-truth, niet impl-vorm.

- **Delta-semantiek**: elke `rotate({rotation, flipY})`-call past precies één keer de gevraagde transformatie toe bovenop de bestaande oriëntatie. Tweemaal `rotate(90)` = 180° totaal (zoals oude AWS). De **inverse** brengt visueel terug: `rotate(90)` daarna `rotate(270)` = terug bij af. (Géén "call-idempotency" — dat zou de operatie ondergraven.)
- **Atomair binnen Convex**: `exifOrientation` + eventuele `width`/`height`-swap gebeuren in één Convex-mutation-transactie. Geen window waarin de waarden inconsistent zijn.
- **Auth-boundary**: rotate door (a) de owner van de foto, of (b) een group-admin van een groep waarin de foto via `albumPhotos` gepubliceerd is. Niet door webmaster (per migratie-plan). Niet door overige members in dezelfde group.
- **EXIF-arithmetiek correct**: nieuwe `exifOrientation`-waarde wordt berekend via de 8-staat-lookup op `(huidige waarde, rotation, flipY)`. Tabel is deterministisch en kent voor élk (input, delta)-paar exact één uitkomst.
- **Width/height-swap**: een 90°/270°-delta wisselt `width` en `height` in de DB. Voor 0°, 180° en flip-only blijven ze gelijk. Bij `width`/`height` = `undefined`: blijft `undefined` (geen verzonnen waarden).
- **Cascade-safe**: rotate raakt geen ratings, albumPhotos, group-cover, album-cover, comments, flagging-state. Alleen `exifOrientation` + eventueel `width`/`height` wijzigen.
- **Synchroon resultaat**: rotate-mutation geeft direct return; client kan optimistisch UI updaten of opnieuw queryen. Geen scheduler-wachten.
- **Bestand onaangeraakt**: `storageId` wijzigt nooit door rotate. Geen blob-rewrite, geen sharp/jimp, geen storage-cleanup.

## Edge cases + scope-uitsluitingen

- **In scope**:
  - `photos.rotate({photoId, rotation, flipY})` mutation in `convex/photos.ts` (isolate-runtime, geen `"use node"`)
  - `rotation` arg: `v.union(v.literal(0), v.literal(90), v.literal(180), v.literal(270))` — geen vrije nummers
  - `flipY` arg: `v.boolean()` — horizontale mirror (zie A10: ondanks de naam, Jimp-`flip(horizontal, vertical)` patroon → "Y" was historisch verkeerde naam, behouden voor v1-continuïteit)
  - EXIF-arithmetiek helper-tabel (`convex/lib/exifOrientation.ts` of inline): maps `(currentOrientation in 1..8, rotation in {0,90,180,270}, flipY: bool)` → `newOrientation in 1..8`
  - Owner-check + group-admin-check (via `albumPhotos.by_photo` → publicatie-groups → `memberships.by_user_and_group` met `role === "admin"`)
- **Bewust niet** (voor deze WP):
  - **Pixel-rotatie / bestand-rewrite**: niet meer in scope (cyclus-2 hardening maakte DB de bron-van-waarheid; zie spec-revisie-noot bovenaan)
  - **`sharp` / `jimp` dependency**: niet meer nodig
  - **Scheduled action**: rotate is een simpele mutation, geen async werk
  - **`"use node"`-file**: niet nodig (geen Buffer-vereisende lib)
  - **Storage-swap + oude blob cleanup**: niet meer relevant
  - **HEIC-rejection**: rotate is content-agnostic; HEIC-foto's krijgen gewoon hun EXIF-waarde geupdate. Of de client HEIC kan renderen is een display-laag-keuze, geen rotate-blocker.
  - **Vrije rotatie-hoek** (bv. 15°): alleen 90°-stappen (8 EXIF-states accommoderen niet meer)
  - **Backfill voor reeds-foute EXIF**: cyclus-2 CSS-transform-fallback blijft. Bulk-tooling niet in scope.
  - **Webmaster-rol**: dekking via group-admin volstaat per migratie-plan

## Risico-assessment

- **security/privacy**: medium — auth-boundary is "owner OR group-admin". Group-admin-check vereist join via `albumPhotos` + `memberships.role`, off-by-one-pad. PII in photo-content ongewijzigd.
- **ops**: laag — geen externe API, geen scheduler-async, geen storage-mutatie. Mutation-throw is direct user-zichtbaar.
- **external deps**: **laag** — geen `sharp`, geen `jimp`, geen nieuwe npm-deps. (Was hoog in oorspronkelijke spec — vervalt volledig.)
- **multi-user/concurrency**: laag-medium — concurrent rotate door owner + group-admin op zelfde photo: laatste write wint via Convex transactionele mutation. Lost-update mogelijk maar visueel-recoverable (gebruiker draait terug). Geen race met extractMetadata want die patcht andere velden.
- **data/schema-evolutie**: laag — alleen bestaande velden (`exifOrientation`, `width`, `height`) gepatcht. Geen nieuwe velden, geen migratie.
- **ops-runbook-impact**: **geen** — geen nieuwe env-vars, geen externe service-config, geen Convex deploy-bijzonderheden. (Was medium met `sharp` — vervalt.)

## Cross-refs

- **migratie-plan**: §Photo rotation ([`docs/migratie-plan-convex.md`](../migratie-plan-convex.md)) — de daar genoemde server-side pixel-rotatie als architectuur-keuze is **achterhaald** door cyclus-2 hardening (DB-driven CSS-transform). Migratie-plan kan in een latere doc-pass worden geactualiseerd; voor WP8 is de hier-vastgelegde EXIF-only keuze leidend.
- **audit-track-record**: §audit-9 (FL1 cascade), §audit-10 (extractMetadata hardening waar `exifOrientation` veld bij landde + client CSS-transform), §WP7 (use-node-pattern — niet meer relevant voor WP8)
- **cascade-matrix**: rij **P8** bijgewerkt naar EXIF-only formulering (zie [`docs/cascade-matrix.md`](../cascade-matrix.md))
- **oude AWS-code** (alleen A leest): `blob-images-api-photos/handlersPhoto/fixPhotoRotation.js` (Jimp-pixel-rotatie) — historisch model, voor WP8 alleen relevant voor `flipY`-naamgeving (zie A10) en delta-semantiek-bewijs (rotate is delta, niet idempotent). NB: oude code negeerde EXIF; v2 maakt EXIF de bron-van-waarheid.
- **bestaande backend-haken** (B implementeert *in*, niet *vanaf nul*):
  - `convex/photos.ts`: nieuwe `rotate` mutation. `photos.remove` r.258 toont auth-pattern (`requireCurrentUser` + owner-check) voor inspiratie.
  - `convex/lib/auth.ts` of vergelijkbaar: bestaande `requireCurrentUser`-helper hergebruiken.
  - Géén nieuwe file `convex/photoRotation.ts` (was in oorspronkelijke spec).
  - `albumPhotos`-tabel + `memberships`-tabel voor group-admin-check (A9-pad blijft geldig).

## Acceptance — hoe weten we dat het klaar is

### Tests (unit, mock-based)

- `tests/photos/rotate.test.ts` — happy-paths over EXIF-arithmetiek:
  - Vanuit elke startoriëntatie (1..8) → na `rotate(90)` correcte vervolgwaarde (kies de canonieke EXIF-tabel als referentie)
  - 0°/180°/270° + flipY-combinaties vergelijkbaar
  - Delta: tweemaal `rotate(90)` = `rotate(180)`-equivalent
  - Inverse: `rotate(90)` daarna `rotate(270)` → terug bij start
- `tests/photos/rotate.test.ts` — width/height:
  - 90°/270°: `width` en `height` geswapt in DB-row
  - 0°/180°/flip-only: `width`/`height` ongewijzigd
  - `width`/`height` = undefined: blijft undefined
- `tests/photos/rotate.test.ts` — auth:
  - Owner → 200
  - Group-admin (via album-publicatie) → 200
  - Group-member zonder admin → reject
  - Webmaster zonder owner/admin → reject (per spec — geen webmaster-bypass)
  - Niet-ingelogd → reject
  - Photo bestaat niet → typed error
- `tests/photos/rotate.test.ts` — cascade-safety: na rotate ongewijzigd: `storageId`, `takenAt`, `latitude`, `longitude`, `locationLabel`, `ratingAverage`, `ratingCount`, `flaggedAt`, etc. Pin't dat de mutation alleen de drie genoemde velden raakt.

### Integration-tests

**Geen** integration-test deze cyclus. Rationale: er is geen externe service, geen file-rewrite, geen runtime-mismatch-risico (geen `sharp`/`jimp` lib). Unit-tests op de EXIF-arithmetiek-tabel + auth-pad dekken de volledige feature.

### Empirische gate (mens)

**Gate 1 — Round-trip via dashboard**:
- Upload via WP7-runbook een foto (WP7-fixture volstaat; Orientation=1 prima)
- Roep `api.photos.rotate({photoId, rotation: 90, flipY: false})` aan via Convex dashboard Functions
- Verifieer in `photos`-rij: `exifOrientation` op de nieuwe waarde, `width`/`height` geswapt
- Roep `rotate({rotation: 270, flipY: false})` aan → `exifOrientation` terug bij oorspronkelijke waarde, dims terug
- Geen storage-mutatie zichtbaar (`storageId` ongewijzigd over beide calls)
- Geen Convex Logs voor actions/scheduler (niet aanwezig in deze impl)

Frontend-render-check valt buiten WP8-scope (frontend = Phase 4). Sufficiency van DB-waarde voor weergave is al gevalideerd in cyclus-2 hardening.

---

## Spec-criticus aanvullingen — gereset

A's eerste cyclus ging uit van pixel-rotatie + sharp + `"use node"`. Bij deze spec-revisie (EXIF-only) is dat werk grotendeels niet meer toepasselijk. A wordt gevraagd om in een follow-up:

1. **A1 (delta+inverse)** — blijft geldig en wordt overgenomen in deze spec ✅
2. **A2 (bake-in)** — vervalt (geen pixel-manipulatie meer)
3. **A3 (auth tightening)** — blijft geldig ✅
4. **A4 (dims uit output)** — vervangen door dims uit DB-swap-logica (rotatie-arg → swap of niet)
5. **A5 (HEIC fast-fail)** — vervalt (rotate is content-agnostic in EXIF-only model)
6. **A7-A8 (sharp-keuze, atomic-swap)** — vervalt
7. **A9 (group-admin-pad)** — blijft geldig ✅
8. **A10 (flipY = horizontale mirror)** — blijft geldig ✅
9. **A11 (cascade-rij)** — rij is door regie geüpdatet naar EXIF-only

### Wat A wel revisert

- `tests/photos/rotate.test.ts`: herzien naar EXIF-arithmetiek-tabel + dim-swap + auth (geen sharp-mock, geen action-pad). Bron-van-waarheid voor de tabel: canonieke EXIF Orientation-spec (1..8 met rotate+flip-overgangen).
- `tests/photos/rotateAction.test.ts`: **verwijderen** (geen action meer).
- `tests/integration/uploads/rotateRoundtrip.test.ts`: **verwijderen** (geen pixel-roundtrip).
- Cascade-matrix-rij P8: regie heeft 'm al geüpdatet, A confirmeert of vult aan.
- Eventuele helper-imports in tests die naar sharp-mocks of `photoRotation.ts` verwezen: opruimen.

### Wat A op B's input acht: geen open product-vragen voor regie

Alle 5 vragen uit de eerste cyclus zijn met deze spec-revisie beantwoord of vervallen:
- 1 (delta+inverse): ja, opgenomen
- 2 (action-retry-hardening): n.v.t.
- 3 (HEIC fast-fail): n.v.t.
- 4 (sharp vs jimp): n.v.t.
- 5 (Orientation≠1 fixture): n.v.t. — geen empirische pixel-gate

A's revised commits hangen aan WP8-EXIF-only en zijn input voor B's impl.
