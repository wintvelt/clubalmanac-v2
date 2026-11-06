# WP25: Verkleinde versies van foto's (formaten *klein* en *groot*)

> Draft regie 2026-11-06; spike en besluiten 2026-11-06. Backend-WP met een raakvlak met de app en de migratie. Eerst een spike, dan kiest Wouter de optie, dan A → B → audit, en een red-team op de backfill en de T0-keten (data/schema hoog). Volgt uit [WP17a](./WP17a-fotos-bekijken.md) besluit 2, vraag 2 en vraag 9. Af vóór de gate van WP17a.

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
3. **Een foto zonder formaat toont het origineel.** Traag, maar nooit leeg en nooit een fout. Dat het gebeurt, is zichtbaar voor ops (niet stil, zie A-invariant 14). Zo'n terugval blijft niet in een cache staan onder de URL van het formaat (A-invariant 13).
4. **Een formaat volgt de toegang van zijn foto, precies.** Wie de foto niet mag zien, krijgt geen formaat: hetzelfde antwoord als voor het origineel (WP17a invariant 1, 2, 13). Het formaat van een profielfoto volgt de profielregel: openbaar, en alleen dat van de huidige profielfoto (WP17a invariant 3, 16).
5. **Geen nieuw id naar buiten.** Geen `_storage`-id van een formaat in een publieke response (WP17a invariant 10). De client vraagt een formaat op met het foto-id of het user-id.
6. **Elk beeld staat rechtop, precies één keer gedraaid.** Een formaat bevat de ruwe pixels zonder EXIF-tag. De app draait het volgens `exifOrientation` uit de DB. Voor gemigreerde foto's zonder `exifOrientation` zet de backfill de tag uit het bestand in de DB, behalve bij HEIC (A-kernvondst 1). Daarmee is WP17a invariant 4 volledig te halen.
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

## Uitkomst spike (2026-11-06)

Gemeten op dev in een Node-action (linux arm64, ~1 core), met echte dev-bestanden. Niets gecommit; dev wordt na afloop opgeruimd met een deploy vanaf `wp25`.

- **Verkleinen in Convex werkt** met sharp 0.35.5 (`externalPackages` in `convex.json`). Eén keer decoderen naar *groot* en *klein* uit *groot* maken: 1–5 s per foto, ook voor de grootste (20 MB). Piek ~260–390 MB.
- **Harde grens: 512 MB per Node-action.** Vier grote foto's tegelijk gaf een out-of-memory. Parallel werken levert niets op (~1 core). Eén foto per keer.
- **HEIC:** op dev 0 (995 JPEG, 6 PNG; de 444 octet-stream zijn JPEG of PNG). Sharp decodeert HEIC niet; heic-decode 2.1.0 (WASM) wel. Niet gemeten: een echte iPhone-HEIC met `irot` of oriëntatie ≠ 1.
- **Oriëntatie:** 114 van de 1001 bestanden hebben een tag ≠ 1 (58× 6, 56× 3); `exifOrientation` is overal leeg.
- **Grootte** (langste zijde, JPEG mozjpeg q80): *klein* gemiddeld 35 kB (max 71), *groot* 258 kB (max 667). WebP levert gemiddeld niets op. Opslag erbij ~10%.
- **Backfill prod** (~1600 foto's, ~3 s per foto): ruwweg 16–80 minuten, in batches.
- **Prod-telling** niet gedaan: het besluit hangt er niet van af (HEIC wordt ondersteund, de backfill leest de tag per bestand).

## Besluiten Wouter (2026-11-06)

1. **Optie A:** formaten op de server, in een Node-action die na de upload wordt ingepland, één foto per keer. De backfill gebruikt dezelfde action, in batches.
2. **Maten:** *klein* 512 px en *groot* 1600 px, langste zijde.
3. **Bestandstype:** JPEG.
4. **HEIC:** de formaten worden JPEG (via heic-decode); het origineel blijft. Open voor A: past libheif `irot` zelf toe? Zo ja, dan draait een HEIC dubbel (invariant 6). A test met een echte iPhone-HEIC. *Antwoord A: ja, zie A-kernvondst 1.*

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
| 0 | Spike-sessie | ✅ §Uitkomst spike. |
| 1 | Wouter | ✅ Optie A, 512/1600, JPEG, HEIC als JPEG (§Besluiten). |
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

## Spec-criticus aanvullingen (A, 2026-11-06)

Gelezen: deze spec, WP17a (vraag 2 en 9, kernvondst 4, invarianten 1–5, 10, 16, 17), het beeldpad en de upload in `convex/http.ts`, `convex/images.ts`, `convex/photoMetadata.ts`, `convex/photos.ts` (wissen, draaien), `convex/monitoring.ts`, `convex/migration.ts`, `scripts/migrate/{verify,pruneStorage,reset}.ts`, het WP12-runbook, cascade-matrix P3/P5/U7, `data-migration-preflight.md`, en de ruwe spike-notities. Geen v1-code nodig: de maten staan in WP17a.

### Kernvondsten

1. **libheif past `irot` en `imir` zelf toe; een HEIC van Apple draagt daarnaast nog de EXIF-tag.** Gemeten met heic-decode 2.1.0 (de versie uit de spike) op HEIC's die macOS ImageIO maakt uit een JPEG met tag 3, 6 of 8. Dat is de encoder van Apple, met tegels (`grid`) zoals een iPhone-camera ze schrijft. Elk bestand heeft een `irot` (6 → hoek 3, 3 → hoek 2, 8 → hoek 1) én EXIF-tag 3, 6 of 8. heic-decode levert de pixels al gedraaid: tag 6 geeft een staand beeld met het rode vlak rechtsboven, precies de bedoelde stand. sharp leest de oriëntatie van zo'n HEIC ook als "geen" (libvips zet hem na het laden op 1), maar een EXIF-lezer (exifr, exif-parser) leest 6. **Gevolg:** zet de backfill bij een HEIC "de tag uit het bestand" in de DB, dan draait de app hem een tweede keer. Voor HEIC blijft `exifOrientation` dus leeg (= 1). De tests pinnen dit met drie zulke bestanden (`tests/fixtures/wp25/`, 3 kB per stuk, synthetisch, zonder persoonsgegevens). Niet gemeten: een HEIC rechtstreeks uit een iPhone-camera. Die blijft een punt voor de gate (§Acceptance).
2. **Een terugval op het origineel draait dubbel zodra de DB de tag uit het bestand heeft.** iOS past bij het origineel de tag uit het bestand toe, en de app daarna `exifOrientation`. Nu zet `extractMetadata` (WP7) die tag direct na de upload, dus een verse upload met tag 6 staat in het raster scheef tot zijn formaten er zijn. Met `Cache-Control: private, max-age=3600` blijft dat scheve origineel van 3 MB een uur in de cache, onder de URL van *klein*. Hetzelfde gebeurt bij een gemigreerde foto als de backfill de tag zou zetten zonder dat de formaten er al zijn. Oplossing in A-invariant 12 en 13: de tag uit het bestand komt alleen samen met de formaten in de DB, en een terugval wordt niet bewaard.
3. **`prune-storage` wist alles wat aan geen record hangt en niet in `convex-records.json` staat.** Een formaat staat nooit in `convex-records.json`. Ziet `storageInventory` de formaten niet als verwezen, dan wist een `prune-storage` na de backfill élk formaat. De vloer houdt dat niet tegen: de originelen blijven staan, dus "alles wissen" is het niet. Hetzelfde geldt voor de wees-controle van WP10, die elk formaat zou mailen. A-invariant 15 pint beide op de echte functies.
4. **`reset` (zonder `--all`) laat de originelen bewust staan.** De formaten staan niet in `storage-map.json`, dus na `reset` + `load-records` hangen ze aan niets meer. A-invariant 16: `reset` wist de formaten van de foto's die hij weghaalt.
5. **Een profielfoto heeft geen eigen formaten.** Sinds WP17a invariant 16 is een nieuwe profielfoto altijd het beeld van een eigen foto. Het formaat van een profielfoto is dus het formaat van de foto met hetzelfde beeld. Een profielfoto vervangen wist niets: de foto houdt zijn formaten. Alleen een los gemigreerd beeld zonder foto-rij heeft geen formaten (dev: 1 user; prod: 0, WP17a besluit 13). Dat toont het origineel. Invariant 8 ("een profielfoto vervangen ruimt de formaten op") vervalt daarmee voor dat deel.
6. **Convex weigert een schema-push als een bestaande rij er niet aan voldoet.** Wie na de backfill terug wil naar code zonder het veld voor de formaten, kan dat schema niet meer pushen. Terugrollen betekent: het optionele veld laten staan, of eerst de formaten weghalen (§Pre-flight).

### Aanvullende invarianten

12. **De oriëntatie uit het bestand komt alleen samen met de formaten in de DB.** `exifOrientation` is de draaiing ten opzichte van de pixels van de formaten. Voor JPEG, PNG en WebP is dat de tag uit het bestand (1–8), of leeg zonder tag. Voor HEIC is het leeg: de decoder heeft de stand al toegepast (kernvondst 1). De stap die de formaten maakt, zet deze waarde in één schrijfactie met de formaten, en alleen als `exifOrientation` nog leeg is. Een waarde die er al staat (draaien, WP8) blijft staan. `extractMetadata` (WP7) schrijft `exifOrientation` niet meer. Zo krijgt een foto zonder formaten nooit een tag uit het bestand in de DB, en toont de terugval het origineel precies één keer gedraaid, door iOS. Dat geldt voor een verse upload en voor een gemigreerde foto vóór de backfill. `width` en `height` vult dezelfde stap als ze nog leeg zijn (HEIC), met de afmetingen van de pixels op volle grootte, vóór de draaiing. Zo telt ook WP8 met dezelfde pixels.
13. **Een terugval blijft niet bewaard.** Vraagt de client een formaat dat er niet is, dan krijgt hij het origineel met `Cache-Control: no-store`, op het foto- en het profielpad. Een formaat dat er wel is, gaat met de headers van WP17a: foto `private`, profiel `public, no-cache`. Het type is altijd `image/jpeg`, met `nosniff` (WP17a invariant 17). Een formaat-veld dat naar een gewist object wijst, valt ook terug op het origineel, nooit op een 404.
14. **Ontbrekende formaten zijn zichtbaar.** De integriteitsscan van WP10 (en daarmee `verify`, via `integrityReport`) meldt elke foto die ouder is dan een uur en geen formaten heeft. Het uur geeft de stap na de upload ruimte. Een foto waarvan het bestand niet te lezen is, blijft zo een melding tot iemand hem wist. Dat is bewust: hij toont in de app ook alleen het trage origineel.
15. **De formaten zijn verwezen storage.** `storageInventory` (WP12) en de wees-controle van WP10 rekenen de formaten van elke foto tot de verwezen objecten, naast `photos.storageId` en `users.profilePhotoStorageId`. Een formaat-veld dat naar een gewist object wijst, telt als *dangling*. Een formaat-object waar geen foto naar wijst, is een wees. `prune-storage` haalt zijn lijst uit `storageInventory`, dus wist het na de backfill geen formaat.
16. **`reset` neemt de formaten mee.** Wist `reset` (via `clearTable`) een foto-rij, dan wist hij ook de twee formaat-objecten van die foto. Het origineel blijft staan, zoals nu. Na `reset` + `load-records` is er dus geen wees.
17. **Eén set formaten per foto, ook bij een race.** De stap na de upload en de backfill kunnen tegelijk dezelfde foto doen, en een foto kan gewist worden terwijl de stap loopt. De eerste set die vastgelegd wordt, blijft. Een stap die te laat komt (de foto heeft al formaten, of is weg) wist zijn eigen nieuwe objecten. Een crash tussen opslaan en vastleggen laat wezen achter; WP10 meldt die (invariant 9).
18. **Een formaat bevat alleen pixels.** Een JPEG, met de langste zijde hooguit 512 (*klein*) of 1600 (*groot*), nooit opgeschaald, in sRGB, zonder EXIF (ook geen GPS), zonder ICC-profiel en zonder oriëntatie-tag. Transparantie wordt een witte achtergrond (open vraag 2). Van een animatie alleen het eerste beeld. Een bestand dat niet als beeld te lezen is: geen formaten, de stap meldt "mislukt" en laat de foto ongewijzigd.

### Edge cases

- **Verse upload:** tot de formaten er zijn (seconden), toont het raster het origineel, één keer gedraaid (invariant 12). Daarna, bij het volgende verzoek, *klein* (invariant 13: de terugval is niet bewaard).
- **Draaien vóór de formaten** (seconden na een upload, of op T0 vóór de backfill): de DB-stand geldt ten opzichte van wat de user zag, het origineel met de tag toegepast. Komen de formaten daarna, dan blijft die DB-stand staan (invariant 12), maar de formaten hebben de ruwe pixels. Bij een bestand met tag ≠ 1 staat zo'n foto dan scheef, en de user draait hem opnieuw. Geaccepteerd: het venster is seconden, en op T0 gaat de app pas open na de backfill (open vraag 1).
- **Klein origineel** (kleiner dan 512 px): beide formaten hebben de maat van het origineel.
- **Twee foto-rijen met hetzelfde beeld:** elke rij krijgt eigen formaten. Een profielfoto op zo'n beeld toont de formaten van één van die rijen.
- **Foto gewist terwijl de stap loopt:** invariant 17. Het origineel wist P/U7 al.
- **Gemelde foto die na 14 dagen weggaat (FL1):** loopt via `internalRemovePhoto`, dus de formaten gaan mee.
- **Bestaande tests die de scheduler leegdraaien** (`finishAllScheduledFunctions`): een upload plant nu ook de formaat-stap. De inventaristests (`tests/images/noStorageIds.test.ts`, `tests/readWhitelist/inventory.test.ts`) laden elke module in `convex/` in de edge-runtime. Een module mag bij het laden de beeldbibliotheek dus niet nodig hebben.

### De T0-keten

Volgorde op T0 (de runbook-entry levert B, invariant 10):

1. `extract`, `transform`, `load-files` (de delta), `load-records`: ongewijzigd.
2. **`formaten --target prod`** (nieuw): de backfill. Leest alleen foto-rijen en originelen, schrijft formaten en `exifOrientation`. Exitcode 0 alleen als na de run geen foto meer zonder formaten is en niets mislukte. 16–80 minuten.
3. `verify`: nu ook "geen foto zonder formaten" (via de integriteitsscan, invariant 14). Groen is de gate.
4. Meldt `verify` wezen van tussen T-2 en T0: `prune-storage`, dan opnieuw `verify`. Formaten staan niet op de lijst (invariant 15); de operator ziet dat in de volledige lijst die `verify` afdrukt (verwacht: een handvol, geen ~3200).
5. `integrityCheck`-cron weer aan, daarna de app open (open vraag 1).

Waarom de backfill vóór `verify`: dan is er één groene `verify` die alles dekt, en de backfill hangt niet van `verify` af. Een ontbrekend origineel meldt hij zelf als mislukt. Waarom niet vóór `load-records`: er is dan geen foto-rij. Formaten bij T-2 maken kan wel (de bestanden staan er), maar dan moet `load-records` ze aan de rijen koppelen. Dat is een tweede bron van waarheid in de WP12-tooling, voor een winst van hooguit een uur op T0.

**Stopt de backfill halverwege** (laptop dicht, netwerk weg, action-timeout, crash): elke foto die klaar is, heeft zijn formaten en `exifOrientation` in één schrijfactie. Een foto die nog niet klaar is, heeft geen van beide. De app werkt met beide (invariant 3 en 12). Hooguit één foto per afgebroken batch laat twee wezen achter (invariant 17). Herstel: hetzelfde commando opnieuw. Het slaat foto's met formaten over (invariant 11). Daarna `verify`. Zijn er wezen, dan staan ze in de lijst van `verify`, en `prune-storage` wist ze (ze staan niet in `convex-records.json`). **Moet `load-records` na de backfill opnieuw** (`reset` + `load-records`): `reset` wist de formaten mee (invariant 16), dus daarna de backfill opnieuw.

Gedrag van het commando: per batch een regel met de tellingen (gemaakt, al klaar, weg, mislukt met foto-id's), aan het eind de totalen en `formatStatus`. Tegen prod achter `MIGRATE_ALLOW_PROD`, zoals de andere schrijvende commando's. Een batch blijft ruim binnen de tijdslimiet van een action (10 minuten) en verwerkt één foto tegelijk (spike: 512 MB). B kiest de grootte en noteert de meting in het runbook.

### Pre-flight (vóór B de backfill op dev draait)

Volgens [`data-migration-preflight.md`](../conventions/data-migration-preflight.md). Het schema is additief (één optioneel veld), maar de backfill is een bulk-actie op alle foto's en vult een bestaand veld. B meet en noteert in de B-rapportage:

1. **Anker:** git-tag op de commit die B naar dev deployt (regie pusht), plus `npx convex export --path ./backups/wp25-dev-voor.zip` van dev.
2. **Tellingen vóór** (`npx convex run photos:formatStatus` en `migration:storageInventory`):
   - foto's: 1001; met formaten: 0; met `exifOrientation`: 0;
   - storage-objecten: 1002, 2,98 GB; wezen: 0; dangling: 0.

   Zijn er al wezen, ruim die eerst op of noteer ze, anders zijn de tellingen na de run niet te lezen.
3. **Verwachting na run 1** (uit de spike):
   - met formaten: 1001;
   - storage-objecten: 1002 + 2002;
   - erbij ~0,3 GB (1001 × (35 + 258) kB);
   - met `exifOrientation`: 589 (475× 1, 58× 6, 56× 3; de 412 zonder tag blijven leeg; 0 HEIC);
   - wezen en dangling: 0; mislukt: 0.

   Elke afwijking verklaren vóór prod.
4. **Run 2:** gemaakt 0, mislukt 0, alle tellingen gelijk aan run 1.
5. **Gemeten tijd en geheugen** per batch (piek-RSS in de action-log): de schatting voor prod (~1600 foto's).
6. **Steekproef in de app:** drie foto's met tag 6 en drie met tag 3 staan rechtop, in het raster en in het detail.
7. **Lib-versies:** sharp en heic-decode exact gepind in `package.json` (geen `^`), plus `externalPackages` in `convex.json`. Changelogs gelezen sinds 0.35.5 en 2.1.0.
8. **Strategie per tussenstap:**

   | Na stap | Schema | Code | Data |
   |---|---|---|---|
   | deploy | veld `formats` optioneel | upload plant de formaat-stap; `extractMetadata` schrijft geen `exifOrientation` meer | oude foto's zonder formaten: origineel, één keer gedraaid |
   | backfill halverwege | idem | idem | deels formaten + oriëntatie, rest als hierboven |
   | backfill klaar | idem | idem | alle foto's formaten; `verify` groen |

   Terugrollen: code terug met het optionele veld in het schema (kernvondst 6). De formaten blijven dan ongebruikt staan, en de WP10-controle ziet ze als verwezen zolang dat veld bestaat.

### Signaturen (contract met de tests)

- Schema `photos.formats`: optioneel object `{ klein: Id<"_storage">, groot: Id<"_storage"> }`. Beide of geen.
- `convex/lib/photoFormats.ts` (Node): `makeFormatImages(bytes: Uint8Array): Promise<{ klein: Uint8Array; groot: Uint8Array; width: number; height: number; exifOrientation?: number }>`. Gooit bij bytes die geen beeld zijn.
- `internal.photoFormats.makeFormats({ photoId })` (Node-action): de stap voor één foto. Geeft `"created" | "alreadyDone" | "gone" | "failed"`. `createFromUploadInternal` plant hem in, naast `extractMetadata`.
- `internal.photoFormats.backfill({ cursor: string | null, batchSize: number })` (Node-action): één batch, in vaste volgorde. Geeft `{ cursor: string | null, created, alreadyDone, gone, failed: Id<"photos">[] }`. `cursor: null` betekent dat de doorloop klaar is.
- `internal.photos.attachFormats({ photoId, klein, groot, width?, height?, exifOrientation? })`: legt een set vast volgens invariant 12 en 17. Geeft `"attached" | "alreadyDone" | "gone"`.
- `internal.photos.formatStatus({})`: `{ photos, withFormats, withoutFormats, withExifOrientation }`.
- CLI: `npm run migrate -- formaten --target <dev|prod>`.

### Open vragen voor Wouter (advies erbij)

1. **Gaat de app op T0 pas open na de backfill?** Advies: ja. De backfill duurt 16–80 minuten. Daarna zijn er een groene `verify` en snelle albums, en niemand ziet in dat venster een foto die net gedraaid is (§Edge cases). Het kan ook eerder: alles werkt dan, alleen traag en met de originelen. Bij 16 users die op de cutover wachten, kost een uur langer dicht weinig.
2. **Transparante PNG's: wit of zwart?** Een JPEG heeft geen transparantie. Advies: wit, de achtergrond van de app. Op dev zijn er 6 PNG's (waarschijnlijk schermafdrukken of logo's).

### Tests (A)

| Bestand | Pint |
|---|---|
| `tests/photoFormats/images.test.ts` (Node-omgeving, echte sharp en heic-decode) | invariant 6 en 18, kernvondst 1: maten, geen opschaling, ruwe pixels, geen EXIF, JPEG, HEIC (drie fixtures) rechtop na het toepassen van de teruggegeven stand, wit achter transparantie, onleesbare bytes |
| `tests/photoFormats/attach.test.ts` | invariant 12 en 17, `formatStatus` |
| `tests/photoFormats/backfill.test.ts` (beeldbibliotheek gemockt) | invariant 2, 11, 12, 17: upload plant de stap, de stap, de backfill (batches, hervatten, run 2 doet niets, mislukt blokkeert niets) |
| `tests/photoFormats/httpFormats.test.ts` | invariant 1, 3–5, 13: formaat serveren, toegang ongewijzigd, terugval `no-store`, profiel |
| `tests/photoFormats/cascade.test.ts` | invariant 7, 8: wissen (foto, user, FL1), draaien laat de formaten staan |
| `tests/photoFormats/inventory.test.ts` | invariant 9, 10, 14–16: WP10 (wees, ontbrekend formaat), `storageInventory`, `clearTable` |
| `tests/photos/extractMetadata.test.ts` (aangepast) | invariant 12: `extractMetadata` schrijft `exifOrientation` niet meer |

`images.test.ts` heeft sharp en heic-decode nodig in `dependencies` (B voegt ze toe, exact gepind). A heeft hem gecontroleerd tegen een wegwerp-implementatie buiten de repo: groen, en rood voor twee mutanten (HEIC met de EXIF-tag uit het bestand; JPEG-pixels zelf gedraaid). De andere files draaien in de edge-runtime van convex-test en mocken de beeldbibliotheek.

De CLI (`formaten`) en de runbook-entry hebben geen eigen test: het gedrag staat hierboven, en de preview-run op dev is de gate.
