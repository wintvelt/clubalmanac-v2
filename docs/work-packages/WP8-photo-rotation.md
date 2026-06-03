# WP8: Photo rotation

## Productdoel

Wanneer een gebruiker zijn eigen foto (of een group-admin een foto in zijn groep) bewust rechtop wil zetten omdat EXIF Orientation niet klopte of omdat hij hem anders wil oriënteren, wordt het bestand server-side daadwerkelijk geroteerd (geen CSS-transform-only) zodat alle clients — iOS, web, toekomstige Android — de foto consistent weergeven.

## Invarianten

User-truth, niet impl-vorm.

- **Idempotent op uitkomst**: tweemaal dezelfde rotate-call op dezelfde foto resulteert in dezelfde eindstaat (idempotent visueel). Niet noodzakelijk identiek op storage-niveau (twee rewrites mag), wel identiek op zichtbaarheid voor de gebruiker.
- **Atomic-storage-swap**: `photos.storageId` wordt pas gepatcht wanneer de nieuwe blob daadwerkelijk in storage staat en geldig is. Geen window waarin `storageId` naar lege of corrupte blob wijst.
- **Auth-boundary**: rotate kan uitgevoerd worden door (a) de owner van de foto, of (b) een group-admin van een groep waarin de foto via `albumPhotos` zit. Niet door webmaster (dekking via group-admin is genoeg per migratie-plan). Niet door overige users in dezelfde groep.
- **Cleanup-discipline**: oude storage-blob wordt verwijderd nadat de nieuwe storageId is gepatcht. Faalt cleanup → orphan in storage, géén user-impact, opgepakt door integriteits-check (cyclus-2 backlog, aparte WP).
- **EXIF-Orientation neutralisatie**: na server-side rotate is het beeld fysiek correct geörienteerd. `photos.exifOrientation` wordt na rotate geneutraliseerd (1 = normal) want de client moet géén verdere CSS-transform toepassen — anders krijg je dubbele rotatie.
- **Width/height meeswappen**: een 90°/270° rotatie wisselt width en height. Voor 0°/180° en flip-only blijven ze gelijk. Patch consistent.
- **Geen frontend-blocking**: rotate-mutation geeft snel terug (queue't action via scheduler), client kan optimistisch UI updaten of pollen op nieuwe storageId. Sharp-actie zelf draait async, mag enkele seconden duren.
- **Cascade-safe**: rotate raakt geen ratings, albumPhotos, comments, flagging-state. Alleen het beeldbestand zelf verandert.

## Edge cases + scope-uitsluitingen

- **In scope**:
  - `photos.rotate({photoId, rotation, flipY})` mutation in `convex/photos.ts` (isolate-runtime) — auth-check + schedule action
  - `rotation` arg: `v.union(v.literal(0), v.literal(90), v.literal(180), v.literal(270))` — geen vrije nummers
  - `flipY` arg: `v.boolean()` — horizontale flip (mirror)
  - Scheduled internal action in nieuwe file `convex/photoRotation.ts` met `"use node";` directive (zelfde patroon als `photoMetadata.ts`)
  - Action laadt blob via `ctx.storage.get`, gebruikt `sharp` voor rotate+flip, schrijft nieuwe blob via `ctx.storage.store`, patcht `photos` (storageId + exifOrientation=1 + width/height-swap waar nodig), schedult oude blob-cleanup via bestaande `cleanupStorage` action
  - Group-admin-check via `albumPhotos` + memberships (`role: "admin"`)
  - `npx convex deploy` met `sharp` als nieuwe runtime-dep
- **Bewust niet** (voor deze WP):
  - **Vrije rotatie-hoek** (bv. 15°). Migratie-plan: alleen 90°-stappen + flipY conform oude AWS UI.
  - **EXIF-write-back**: nieuwe blob krijgt geen verse EXIF van ons — sharp's default-gedrag (EXIF stripping of overdragen) accepteren we. Photo-record-fields blijven onze bron voor takenAt/GPS, niet de file-EXIF.
  - **Quality/format-keuze**: sharp default-output (JPEG quality 80) — niet tunen. Geen WEBP/AVIF conversion. Mime-type behoud waar mogelijk.
  - **HEIC-input**: HEIC blijft via `extractMetadata` graceful-no-op. Rotate van HEIC bron is uit scope (sharp ondersteunt HEIC alleen met libheif-build). Bij HEIC-bron throwt rotate (typed error, niet silent skip).
  - **Storage-orphan integrity-check**: aparte WP (cyclus-2 backlog). WP8 cleanup is best-effort; orphans bouwen op tot integrity-check landt.
  - **Rate-limit**: geen per-user-throttle. Bij 16 users + handmatige rotate-actie geen abuse-risk.
  - **Backfill-rotation** voor reeds-geüploade foto's met scheef EXIF: client-side CSS-transform blijft fallback (cyclus-2 hardening al af). Bulk-rotate-tooling niet in scope.

## Risico-assessment

- **security/privacy**: medium — auth-boundary is "owner OR group-admin". Group-admin-check vereist join via `albumPhotos` + `memberships.role` — relatief samengesteld pad met potentiële off-by-one. PII in photo-content blijft ongewijzigd (geen nieuwe surface).
- **ops**: medium — `sharp`-action is scheduled; intermediate state (oude blob nog zichtbaar tot action commit) is observable maar verwarrend voor user die snel re-loads. Storage-cleanup failure → orphan blob, geen user-impact. Action zelf kan crashen (sharp OOM op grote files, libvips-fout op exotische input) → photo blijft in oude staat, scheduler retry-pattern.
- **external deps**: **hoog** — `sharp` is een grote npm-dep met **native bindings** (libvips). Berucht voor platform-mismatch + deploy-failures op serverless. Convex "use node" runtime moet 't aankunnen maar is onbewezen voor deze specifieke lib op deze platform. Cold-start-impact onbekend.
- **multi-user/concurrency**: medium — concurrent rotate door owner + group-admin = race op `storageId`-swap. Lost-update mogelijk (laatste write wint, vorige rotate-resultaat in storage als orphan). Plus: rotate-tijdens-extractMetadata race als upload net is afgerond. Owner-only doet meestal niet twee tegelijk maar group-admin × owner is mogelijk.
- **data/schema-evolutie**: laag — alleen `storageId` + `exifOrientation` + `width`/`height` patcht; allemaal bestaande velden. Geen nieuwe tables, geen migratie, geen backfill.
- **ops-runbook-impact**: één nieuwe npm-dep `sharp` in `package.json`. Bij Convex deploy moet de bundle de native binding-resolution slagen. Geen nieuwe env-vars. Geen Mailjet/Clerk-dashboard-config. Documenteren in [`external-services.md`](../conventions/external-services.md) of `convex-runtimes.md` als "sharp landt in `"use node"` actions; geen extra config nodig".

## Cross-refs

- **migratie-plan**: §Photo rotation ([`docs/migratie-plan-convex.md`](../migratie-plan-convex.md) — zoek "Photo rotation (server-side fix)") — auth-keuze "owner OR group-admin, webmaster niet nodig", motivatie sharp/jimp, EXIF Orientation upstream als parallel pad (al af in cyclus-2 hardening — exifOrientation veld bestaat + extractMetadata populates)
- **audit-track-record**: §audit-9 (FL1 cascade), §audit-10 (extractMetadata hardening waar exifOrientation bij landde), §WP7 (use-node-pattern voor sharp-vergelijkbare lib)
- **cascade-matrix**: **nieuwe rij toe te voegen bij A-fase** — bv. `PR1: Photo rotation → storage-swap + exifOrientation reset + cleanup oude blob` met geen downstream cascades (geen impact op ratings/albumPhotos/comments/flagging)
- **conventies**: [`convex-runtimes.md`](../conventions/convex-runtimes.md) — `sharp` valt in "Buffer-vereisende lib" categorie, dus `"use node";` directive verplicht (WP7-patroon: aparte file `convex/photoRotation.ts`)
- **oude AWS-code** (alleen A leest): `blob-images-api-photos/handlersPhoto/fixPhotoRotation.js` (Jimp-based rotate-impl) — voor begrip van rotate-semantics. NB: oude code gebruikte `jimp`, wij stappen over op `sharp` per migratie-plan-keuze.
- **bestaande backend-haken** (B implementeert *in*, niet *vanaf nul*):
  - `convex/photos.ts`: nieuwe `rotate` mutation toevoegen. `photos.remove` r.258 toont auth-pattern (`requireCurrentUser` + owner-check) voor inspiratie. `requireWebmaster` is NIET nodig hier (per spec).
  - `convex/photos.ts`: `cleanupStorage` internalAction r.275 al aanwezig — hergebruiken voor oude blob-cleanup
  - `convex/photoMetadata.ts`: bestaand `"use node"`-bestand kan als template dienen voor `convex/photoRotation.ts`
  - `convex/photos.ts`: `getByIdInternal` + `patchMetadata` internalQuery/Mutation — A bekijkt of nieuwe `patchRotated`-helper nodig is of bestaand `patchMetadata` voldoet (mogelijk uitbreiden met `storageId` arg)
  - Memberships/groups: `albumPhotos`-tabel + `memberships`-tabel — A toetst exacte query-pad voor group-admin-check

## Acceptance — hoe weten we dat het klaar is

### Tests (unit, mock-based)

- `tests/photos/rotate.test.ts` — happy-path 90°/180°/270°/flipY, idempotency, owner-auth, group-admin-auth, weigert overige users, weigert webmaster (per spec), photoId niet bestaat, action-queue-gepind
- `tests/photos/rotate.test.ts` — argument-validation: rotation niet in {0,90,180,270} → typed error
- `tests/photos/rotateAction.test.ts` — scheduled-action gedrag: laadt blob, mockt sharp, patcht photo, schedult cleanupStorage
- `tests/photos/rotateAction.test.ts` — HEIC-bron rejected (typed error, NIET silent skip — per spec)
- `tests/photos/rotateAction.test.ts` — storage-store-fail → photo blijft in oude staat (geen partial patch)
- `tests/photos/rotateAction.test.ts` — width/height-swap correct voor 90°/270°; gelijk voor 0°/180°
- `tests/photos/rotateAction.test.ts` — exifOrientation gepatcht naar 1 na rotate (neutraliseert client-side CSS-transform)

### Integration-test (`npm run test:integration`, niet in CI)

- `tests/integration/uploads/rotateRoundtrip.test.ts` — end-to-end op echte iPhone JPEG: upload → rotate 90° → poll tot storageId gewisseld → fetch nieuwe blob → assert dimensies geswapt + visueel non-corrupt. Bevestigt `sharp` daadwerkelijk in Convex "use node" runtime werkt.

### Empirische gate (mens, geen agent)

**Gate 1 — Real-rotate-roundtrip** (verplicht):
- Upload via dashboard run-mutation een echte iPhone-foto (zelfde fixture als WP7-gate)
- Roep `photos.rotate({photoId, rotation: 90, flipY: false})` aan
- Wacht ~3-5s
- Download nieuwe blob (via Convex storage URL) en open in image-viewer → moet visueel correct geroteerd zijn
- Convex Logs: één `photoRotation:rotateAction` success-entry, één `photos:cleanupStorage` success voor oude blob
- Convex Data → `photos`-row: `storageId` is nieuw, `exifOrientation === 1`, `width`/`height` geswapt indien 90°/270°
- Replay-test: tweede rotate met `rotation: 270, flipY: false` → terug naar oorspronkelijke oriëntatie zichtbaar

**Adversarial-pass (conditional, niet auto)**: alleen draaien als Gate 1 iets onverwachts oplevert (sharp-crash, race-condition, group-admin-edge-case). Setup 6 niet pre-emptief — kost effort zonder zicht op concrete vondsten.

---

## Spec-criticus aanvullingen (A vult in)

A leest oude AWS-code + cascade-matrix + bovenstaande spec, vult hier aan:

- Ontbrekende invarianten: ...
- Gemiste edge cases: ...
- Risico-dimensie die regie overschatte/onderschatte: ...
- Open product-vragen voor regie/Wouter: ...
- Cascade-matrix-rij PR1 exact-formuleren: ...
- Sharp-versie + alternatives-fallback (jimp als pure-JS escape-hatch): ...
- Group-admin-check query-pad: via `albumPhotos.by_photoId` → group(s) → memberships.by_user_and_group → role == "admin"? Of efficienter pad? + motivatie

(Leeg in draft. A commit edits hier.)
