# WP25: Verkleinde versies van foto's (formaten *klein* en *groot*)

> Draft regie 2026-11-06. Backend-WP met een raakvlak met de app en de migratie. Eerst een spike, dan kiest Wouter de optie, dan A → B → audit, en een red-team op de backfill en de T0-keten (data/schema hoog). Volgt uit [WP17a](./WP17a-fotos-bekijken.md) besluit 2, vraag 2 en vraag 9. Af vóór de gate van WP17a.

## Productdoel

Een lid opent een album en ziet de eerste rij foto's binnen 3 seconden op 4G. Elke foto staat rechtop. De app haalt nooit het origineel op om een raster, een cover, een avatar of het foto-detail te tonen.

## Wat er al ligt (WP17a)

- Het beeldpad `GET /beeld/foto/<photoId>` en `GET /beeld/profiel/<userId>` neemt `?formaat=klein|groot` aan. Zolang een formaat er niet is, geeft het het origineel. De toegang hangt niet af van het formaat.
- De app vraagt *klein* in het raster, op covers en bij avatars, en *groot* in het detail.
- Dev (2026-11-06): 1001 foto's, 2,98 GB, mediaan 2,47 MB, max 20,06 MB. 558 `image/jpeg`, 444 `application/octet-stream` (welk formaat erin zit, is niet geteld). `exifOrientation` is leeg op alle 1001. Prod (WP12): ~1601 beelden, 5,6 GB.
- De oriëntatie kan nu dubbel draaien: iOS past de EXIF-tag uit het bestand toe, en de app daarna `exifOrientation` uit de DB (WP17a kernvondst 4).

## Invarianten

1. **De app krijgt een formaat, niet het origineel.** Raster, covers en avatars tonen *klein*, het detail toont *groot*. Het origineel gaat alleen nog naar de app als terugval.
2. **Elke foto heeft zijn formaten.** Een nieuwe upload krijgt ze kort na de upload. Bestaande foto's krijgen ze via een backfill, op dev en op prod na de T0-load. Na de backfill is het aantal foto's zonder formaten nul, en dat is te tellen.
3. **Een foto zonder formaat toont het origineel.** Traag, maar nooit leeg en nooit een fout. Dat het gebeurt, is zichtbaar voor ops (niet stil).
4. **Een formaat volgt de toegang van zijn foto, precies.** Wie de foto niet mag zien, krijgt geen formaat: hetzelfde antwoord als voor het origineel (WP17a invariant 1, 2, 13). Het formaat van een profielfoto volgt de profielregel: openbaar, en alleen dat van de huidige profielfoto (WP17a invariant 3, 16).
5. **Geen nieuw id naar buiten.** Geen `_storage`-id van een formaat in een publieke response (WP17a invariant 10). De client vraagt een formaat op met het foto-id of het user-id.
6. **Elk beeld staat rechtop, precies één keer gedraaid.** Een formaat bevat de ruwe pixels zonder EXIF-tag. De app draait het volgens `exifOrientation` uit de DB. Voor gemigreerde foto's zonder `exifOrientation` zet de backfill de tag uit het bestand in de DB. Daarmee is WP17a invariant 4 volledig te halen.
7. **Draaien maakt geen nieuwe formaten.** Draaien (WP8) blijft een DB-waarde.
8. **Wissen neemt de formaten mee.** Een foto wissen, een user wissen of een profielfoto vervangen ruimt ook de formaten op (cascade-matrix P3, U7, en de profielfoto). Er blijven geen wezen achter.
9. **De bewaking kent de formaten.** De storage-controle van WP10 ziet een formaat niet als wees, en een formaat zonder foto wel.
10. **De migratie kent de formaten.** `verify`, `storageInventory`, `prune-storage` en `reset` van WP12 tellen de formaten mee. Een `prune-storage` na de backfill wist geen formaten.
11. **De backfill is te herhalen en te hervatten.** Een tweede run verandert niets. Een run die halverwege stopt, gaat bij de volgende run verder. Elke run geeft tellingen terug. Een halve backfill laat de app werken (invariant 3).

## Spike (stap 0, vóór de keuze)

Eén sessie op dev, met een timebox. Er gaat niets naar de branch: de spike levert een rapport, geen code. Geen oude code nodig. Vragen:

1. **Verkleinen in Convex.** Werkt een beeldbibliotheek met native code (of een WASM-variant) in een Convex Node-action? Meet met echte foto's van dev: een gewone JPEG, de grootste (20 MB) en een HEIC als die er is. Geheugen, tijd per foto, en of het binnen de limieten van een action blijft.
2. **HEIC.** Hoeveel beelden op dev zijn HEIC, herkend aan de eerste bytes (ook onder de 444 octet-stream)? Kan de bibliotheek uit de spike HEIC lezen?
3. **Oriëntatie.** Hoeveel bestanden op dev dragen een EXIF-oriëntatie ongelijk aan 1?
4. **Grootte van een formaat.** Hoe groot zijn *klein* (~512 px) en *groot* (~1600 px) gemiddeld, als JPEG en als WebP? Toont `expo-image` op iOS beide?
5. **Prod.** Is dev representatief voor de prod-tellingen van vraag 2 en 3? Zo niet: een script dat op Wouters laptop alleen leest uit S3 (zoals `extract`).

## Te beslissen door Wouter (na de spike)

1. **Optie** uit WP17a vraag 2: A (bij de upload, op de server), B (op aanvraag, daarna bewaard), C (op het toestel bij de upload, en de WP12-tooling voor de bestaande foto's) of D (een externe beelddienst).
2. **Maten en bestandstype** van *klein* en *groot*.
3. **HEIC-originelen:** formaten als JPEG of WebP maken en het origineel houden, of iets anders.

## Edge cases en scope

- **In scope:** formaten maken voor nieuwe uploads en voor bestaande foto's, ook profielfoto's die een eigen upload zijn. Het beeldpad geeft het formaat. `exifOrientation` voor gemigreerde foto's. De cascades bij wissen. WP10 en de WP12-commando's. Het runbook voor T0.
- **Bewust niet:**
  - De upload-flow in de app (WP18). WP25 maakt de formaten na de upload, ongeacht wie uploadt.
  - Meer dan twee formaten. Een derde (bijvoorbeeld 1900 px voor koppen) alleen als een scherm erom vraagt.
  - Beelden in mails (WP17a vraag 2: vraagt een open of ondertekende URL).
  - R2 of een CDN, tenzij de spike laat zien dat Convex het niet kan (dan optie D).

## Risico-assessment

- **security/privacy: medium.** Elk formaat is een nieuw beeld in storage. Het moet dezelfde toegang volgen als het origineel, en er mag geen id van lekken.
- **ops: medium.** Een ontbrekend formaat valt stil terug op het origineel. Zonder telling merkt niemand dat. De WP10-controle slaat alarm op elk formaat tot hij ze kent.
- **external deps: medium.** Een beeldbibliotheek met native code in de Convex Node-runtime. HEIC-ondersteuning. Bij optie D een nieuwe externe dienst.
- **multi-user/concurrency: laag.** Bij optie B kunnen twee kijkers tegelijk hetzelfde formaat laten maken. Bij de backfill lopen nieuwe uploads ernaast.
- **data/schema-evolutie: hoog.** Nieuwe optionele velden, een backfill van alle bestaande foto's, en `exifOrientation` gevuld voor gemigreerde foto's. Het raakt de T0-keten (WP12-commando's en runbook). Pre-flight volgens [`data-migration-preflight.md`](../conventions/data-migration-preflight.md), preview-run op dev (run 1, run 2, tellingen) als harde gate vóór prod.
- **ops-runbook-impact:** een stap in het T0-runbook (backfill na `load-records`, vóór `verify`). Mogelijk een dependency of env-var voor de beeldbibliotheek. B levert de runbook-entry mee.

## Werkwijze

| Stap | Wie | Wat |
|---|---|---|
| 0 | Spike-sessie | Het rapport hierboven. Geen code naar de branch. |
| 1 | Wouter | Kiest de optie, de maten en wat er met HEIC gebeurt. |
| 2 | A | Spec-criticus en RED tests. Leest de WP12-tooling, WP7, WP8, WP10 en de cascade-matrix. |
| 3 | B | Impl, plus de preview-run van de backfill op dev. |
| 4 | Audit | Op spec, tests en impl. |
| 5 | Red-team | Op de backfill en de T0-keten: wat als hij halverwege stopt, wat als `prune-storage` erna draait, raakt een formaat ooit iemand zonder toegang. |
| 6 | Gate | Samen met WP17a stap 1 en 4, op één TestFlight-build. |

## Cross-refs

- [WP17a](./WP17a-fotos-bekijken.md): besluit 2, vraag 2 (opties, v1-formaten per scherm), vraag 9, kernvondst 3 en 4, invariant 1–5, 10, 16, 17.
- WP7 (upload en `extractMetadata`, zie [README](./README.md)), [WP8](./WP8-photo-rotation.md) (draaien), [WP10](./WP10-integrity-monitoring.md) (storage-controle), [WP12](./WP12-data-migratie-tooling.md) en het [runbook](../runbooks/wp12-data-migratie.md).
- [`migratie-plan-convex.md`](../migratie-plan-convex.md) §File Storage. [`cascade-matrix.md`](../cascade-matrix.md) P3, P5, U7. [`convex-runtimes.md`](../conventions/convex-runtimes.md) (Node-action, `Blob.slice`).
- Oude code (alleen A): niet nodig voor de spike. A mag de v1-image-handler bekijken voor de maten per scherm, maar die staan al in WP17a vraag 2.

## Acceptance

- Tests: de invarianten 1–11, met de inventaristests van WP17a uitgebreid naar de formaten.
- Preview-run van de backfill op dev: tellingen vóór, run 1, run 2 (niets meer te doen), `verify` groen.
- Gate (Wouter, TestFlight): WP17a stap 1 (alles rechtop) en stap 4 (eerste rij binnen 3 s op 4G), plus een album met een gedraaide foto en een HEIC-foto.

---

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft.)
