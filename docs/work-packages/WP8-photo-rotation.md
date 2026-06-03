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

## Spec-criticus aanvullingen (A — ingevuld)

Bron-inspectie: `blob-images-api-photos/handlersPhoto/fixPhotoRotation.js` (Jimp) +
`libs/dynamodb-lib-single.js::getPhotoById` + cascade-matrix + bestaande Convex-haken.

### A1 — Idempotency-invariant is mis-geformuleerd (BLOCKER voor regie-review)

De draft-invariant *"tweemaal dezelfde rotate-call → dezelfde eindstaat (idempotent visueel)"*
is **onjuist voor fysieke server-side rotatie**. Rotatie is een **delta-operatie**: `rotate(90)`
gevolgd door `rotate(90)` = 180° totaal, niet 90°. Dit matcht de oude AWS-code, die het nieuwe
bestand altijd roteert vanaf het *huidige* bestand (geen idempotency). Twee user-initiated
`rotate(90)`-calls horen dus legitiem 180° op te leveren.

Wat regie waarschijnlijk bedoelde, en wat A als de échte testbare invariant pint:

- **Delta-semantiek** (user-truth): elke rotate-request past precies één keer de gevraagde
  transformatie toe bovenop de bestaande oriëntatie. De **inverse** brengt terug:
  `rotate(90)` daarna `rotate(270)` = visueel terug bij af (dit staat al in Gate 1 replay-test
  en is de juiste user-truth — niet "call-idempotent").
- **Retry-veiligheid op action-niveau** (de échte risico-dimensie): de Convex-scheduler kan een
  gefaalde action opnieuw draaien. Gevaarlijk window = `storageId` is al gepatcht naar de nieuwe
  (geroteerde) blob, daarna crasht de action → een retry laadt de **al-geroteerde** blob en roteert
  *nog een keer* → dubbele rotatie. Dit is geen storage-niveau-detail maar een zichtbaarheids-bug.
  → Zie open-vraag A6: in-scope hardening (idempotency-token / single-apply-guard) of bewust
  best-effort + gedocumenteerd risico?

**Actie regie:** bevestig de delta-herformulering. A schrijft de tests op delta + inverse, NIET op
call-idempotentie (die test zou onmogelijk groen kunnen worden zonder de operatie kapot te maken —
conflict-protocol: niet gokken, geflagd).

### A2 — EXIF-Orientation bake-in vóór de user-delta (ontbrekende invariant, correctness-kritisch)

De draft pint "exifOrientation → 1 na rotate". Wat ontbreekt: **wat gebeurt er met een foto die
nú correct getoond wordt dankzij de client-side CSS-transform op `exifOrientation` (bv. 6)?**

In v2 toont de client een foto met `exifOrientation=6` rechtop via CSS (cyclus-2 hardening). Roteert
de user dan 90°, en zet de action daarna `exifOrientation=1` (client stopt met CSS-corrigeren), dan
**moet de action de bestaande oriëntatie eerst "inbakken"** in de pixels vóór de user-delta — anders
verdwijnt de CSS-correctie en staat de foto na rotate scheef.

Invariant toevoegen: *na rotate is het bestand fysiek correct, rekening houdend met (a) de
oorspronkelijke EXIF/CSS-oriëntatie én (b) de door de user gevraagde delta. Het eindresultaat is wat
de user op het scherm zag, plus zijn rotatie.* NB: `sharp`'s `rotate(angle)` met expliciete hoek
auto-oriënteert **niet** op EXIF — dit is exact de val. Oude AWS (Jimp) negeerde EXIF-oriëntatie óók
en neutraliseerde 'm niet; v2 voegt de neutralisatie nieuw toe en erft dus dit nieuwe samenspel.

Unit-tests dekken dit niet (sharp is gemockt → geen pixel-waarheid). **Gate 1 moet daarom een
fixture met `exifOrientation ≠ 1` gebruiken** (een iPhone-JPEG die op `Orientation=6` staat), zodat
de bake-in empirisch bewezen wordt. A scherpt de gate hieronder aan.

### A3 — Auth: spec verstrakt t.o.v. oude code (bevestig intentie)

De oude handler-comment claimt "accessible only to admins of a group", maar de **werkelijke code**
(`getPhotoById(photoId, userId)`) liet rotate toe voor **owner OF elk lid met toegang** (membership in
een group waar de foto gepubliceerd staat) — **zónder rol-check**. De spec verstrakt dit bewust naar
**owner OF group-admin** (member-zonder-admin geweigerd). Dat is een legitieme migratie-keuze
(migratie-plan §Photo rotation), maar het is strikter dan v1. → Bevestigd als intentioneel; tests
pinnen de strakke variant. Geflagd zodat regie weet dat dit gedrag wijzigt t.o.v. v1 (een v1-member
die nu niet-admin is verliest de rotate-mogelijkheid).

### A4 — width/height uit de werkelijke output-dims, niet blind swappen (ontbrekende invariant)

De draft zegt "90/270 wisselt width en height". Blind de opgeslagen `width`/`height` swappen faalt als
die velden **stale of `undefined`** zijn (foto nog niet door extractMetadata gelopen, HEIC-origine die
geen dims kreeg, of EXIF-loze upload). Invariant scherper: *na rotate gelden `width`/`height` gelijk
aan de werkelijke afmetingen van de nieuw-opgeslagen blob.* Dit dekt het swap-geval (90/270) én het
geval waarin de bron-dims ontbraken/fout waren. Discriminerende test: rotate van een record met
`width/height === undefined` → na afloop staan ze op de echte output-dims (niet `undefined`).

### A5 — HEIC-rejection: waar? (action authoritative; mutation fast-fail als should)

Spec lijst de action-rejection (magic-bytes, typed error, geen silent skip) als acceptance — A pint die.
Aandachtspunt: de action is **async/gescheduled**, dus een action-throw is voor de user **onzichtbaar**
(de mutation gaf al return). Voor goede UX zou de **mutation** een snelle fast-fail kunnen doen op
`mimeType` die HEIC aangeeft (synchroon, user ziet direct een typed error), terwijl de action de
autoritatieve magic-byte-check houdt. A pint de action-rejection (must, per spec) + voegt de
mutation-fast-fail toe als **should** met aparte test (mimeType `image/heic` → mutation throwt typed
error, geen action gescheduled). Open of regie de fast-fail wil — zie A6.

### A6 — Open product-vragen voor regie/Wouter

1. **Idempotency-herformulering** (A1): akkoord met delta + inverse i.p.v. call-idempotent? — **AKKOORD** (regie was fout in oorspronkelijke formulering; delta+inverse is correcte user-truth)
2. **Action-retry-hardening** (A1): single-apply-guard tegen dubbel-roteren bij scheduler-retry — in scope voor WP8, of bewust best-effort + risico genoteerd? — **OUT OF SCOPE, accepteer als known risk**. B voegt comment in rotateAction toe: "Convex scheduler kan deze action retry'en. Window: storageId al gepatcht + action throws after → retry zal de al-geroteerde blob opnieuw roteren = dubbel. Bij 16-user manual rotate-flow: zeldzaam + user-recoverable (rotate -90 fixt 't). Bewust accepteer hier i.p.v. reservation-pattern; future hardening via rotation-token op photos-row indien escalerend."
3. **HEIC mutation-fast-fail** (A5): wil je de synchrone mutation-rejection op `mimeType`, of alleen de autoritatieve action-rejection? — **AKKOORD synchrone mutation-fast-fail**. Action behoudt autoritatieve magic-byte-check als defense-in-depth (mimeType is client-claim, magic-bytes is waarheid).
4. **`sharp` vs `jimp`** (A7): migratie-plan koos `sharp`. Akkoord dat A de tests sharp-agnostisch houdt — **AKKOORD**. B kiest sharp als first try; jimp als fallback indien sharp-deploy-issues. Gate-validatie bepaalt.
5. **EXIF bake-in fixture** (A2): heb je een iPhone-JPEG met `Orientation=6` (niet 1) beschikbaar voor Gate 1? — **Wouter actie**: zoek in Photos.app een landscape-foto die met telefoon-rechtop is genomen (= meestal Orientation=6 of 8). Verifieer met `file <path>` — output bevat `orientation=right-top` of `orientation=lower-right` voor non-1. Pad invullen in `.env.integration` als `UPLOAD_GATE_PHOTO_ROTATED_PATH` of vergelijkbaar (B definieert exact env-var-naam). De WP7-fixture (`wp7-gate-fixture.jpg`, Tbilisi, Orientation=upper-left=1) volstaat niet voor de bake-in-bewijs.

### A7 — `sharp`-versie + pure-JS fallback

`sharp` heeft native libvips-bindings; de hoog-risico-deploy-zorg in §Risico-assessment staat. A houdt
de unit-tests **sharp-agnostisch**: de mock is een chainable-proxy die elke methode slikt en alleen op
`toBuffer()`/`metadata()` terminaliseert. Daardoor pinnen de units **gedrag op het photo-record**
(storageId-swap, exifOrientation=1, dims, cleanup-schedule) i.p.v. sharp's method-namen — B kan
`sharp` of de pure-JS escape-hatch `jimp` (oude AWS gebruikte jimp) kiezen zonder dat de units breken.
De échte runtime-validatie van de gekozen lib in de Convex `"use node"`-runtime zit in de
integration-gate (`rotateRoundtrip`) + empirische Gate 1, conform `convex-runtimes.md` ("unit-tests
vangen Buffer-runtime-issues niet"). Versie-pin laat A aan B/`package.json` over.

### A8 — Atomic-swap + cleanup-ordering (aanbevolen gedrag, geen pseudo-code)

Om de invarianten *atomic-storage-swap* + *cleanup-na-patch* samen te garanderen: de patch van
`photos` (`storageId` → nieuw, `exifOrientation` → 1, `width`/`height` → output-dims) hoort in **één
transactie** te gebeuren, en de cleanup van de **oude** blob hoort vanuit diezelfde mutatie gescheduled
te worden (zodat de oude blob pas wordt verwijderd nadat de nieuwe `storageId` gecommit is). De action
zelf doet de Node-bewerking (load → sharp → store) en delegeert daarna naar die internal mutation. Of
dit een nieuwe `patchRotated`-helper is of een uitbreiding van `patchMetadata` met een `storageId`-arg
laat A aan B; `patchMetadata` accepteert nu géén `storageId`, dus B moet iets toevoegen. Hergebruik van
de bestaande `internal.photos.cleanupStorage(storageIds)` voor de oude-blob-cleanup is voldoende.

### A9 — Group-admin-check query-pad

Owner-check eerst (goedkoop: `photo.ownerId === user._id`). Anders: `albumPhotos.by_photo(photoId)`
→ verzamel **unieke** `groupId`s van de publicaties → voor elke group `memberships.by_user_and_group
(user._id, groupId)` en check `role === "admin"`. Admin in **één** publicatie-group volstaat (foto kan
in meerdere groups gepubliceerd zijn). Bestaande helper `groups.requireAdmin(ctx, groupId)` past hier
niet 1:1 (die throwt bij niet-member en kent maar één group); B bouwt een "is-admin-in-enige-
publicatie-group"-check. Bij 16 users + bescheiden publicatie-aantal is de scan acceptabel — geen
nieuwe index nodig. Geen toegang via publicatie-group waar de user géén admin is → geweigerd; webmaster
zonder owner/admin → geweigerd (per spec).

### A10 — `flipY` is een horizontale mirror (naamgeving)

De oude AWS-code roept `image.flip(flipY, false)` — Jimp's signatuur is `flip(horizontal, vertical)`,
dus `flipY` werd als **horizontale** flip toegepast (mirror links↔rechts), ondanks de "Y" in de naam.
Spec bevestigt dit ("horizontale flip (mirror)"). A behoudt de argnaam `flipY` voor continuïteit met v1
maar de tests + invariant beschrijven het als horizontale mirror. Een 90°/270°-rotatie + flip swapt
nog steeds w/h (rotatie domineert de dims); flip-only (rotation 0) laat w/h gelijk.

### A11 — Cascade-matrix-rij (toegevoegd door A — zie `docs/cascade-matrix.md`)

Nieuwe rij **P8** onder Trigger: Photos. Geen downstream cascade (ratings/albumPhotos/group-+album-
covers/flagging-state ongemoeid — alleen het beeldbestand + de dims/oriëntatie wijzigen). A pint
"cascade-safe" expliciet met een test.

### A12 — Aanscherping Gate 1 (empirische gate)

- Fixture **moet** `exifOrientation ≠ 1` hebben (bv. iPhone-JPEG `Orientation=6`) om de bake-in (A2)
  te bewijzen — niet alleen een al-rechtopstaande foto.
- Verifieer naast `exifOrientation === 1` ná rotate óók dat de foto die vóór rotate via CSS rechtop
  stond, ná rotate **zonder CSS-transform** nog steeds rechtop + plus-90° staat.
- Replay `rotation: 270` brengt visueel terug bij af (delta-inverse, niet call-idempotentie).
