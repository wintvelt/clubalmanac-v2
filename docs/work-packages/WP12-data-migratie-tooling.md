# WP12: Data-migratie tooling (DynamoDB + S3 → Convex)

> Draft door regie 2026-08-23. A vult onderaan aan.

## Productdoel

Tool om bestaande Clubalmanac-data uit AWS naar Convex overzetten — nu een gefilterde, geanonimiseerde subset naar dev om de clients tegenaan te bouwen, en straks op cutover-dag de volledige set naar prod.

## Terminologie (vast — niet variëren)

| Term | Betekent |
|---|---|
| **extract** | Alles uit DynamoDB halen en lokaal wegschrijven |
| **transform** | DynamoDB-records omzetten naar Convex-vormige records |
| **load-files** | Foto- en videobestanden uit S3 naar Convex-storage uploaden |
| **load-records** | De records via de Convex-API wegschrijven |
| **verify** | Controleren dat de load klopt |
| **reset** | De doel-deployment leegmaken |
| **API-import** | Het gekozen mechanisme: script → Convex-mutations + storage-upload |
| **chosen users** | De 3 users waarop de dev-seed filtert |

## Gekozen mechanisme + waarom niet anders

**API-import.** Het script roept internal Convex-mutations aan; Convex genereert `_id` en `_storage`-waarden; het script houdt een map `DynamoDB-sleutel → Convex-_id` bij en gebruikt die om foreign keys op te lossen.

Het alternatief — een zelfgebouwde snapshot-zip met `npx convex import` — is getest en afgewezen op 2026-08-23. Convex weigert een zelf-gemunte `_id`.

`npx convex export` blijft wél in gebruik, als backup-mechanisme vóór elke schrijf-actie.

## Invarianten

- **Eén bron.** Brondata komt altijd uit productie-AWS: DynamoDB-tabel `blob-images-photos-prod` en de prod-S3-bucket. Er bestaat wél een dev-omgeving in AWS, maar die wordt bewust genegeerd — alleen productie bevat een dataset die representatief genoeg is om de clients tegenaan te bouwen. Ook de dev-seed leest dus productie.
- **Eén tool, twee configuraties.** Dev en prod verschillen alleen in config (filter, anonimisatie, ID-map, doel-deployment), niet in code-pad. Een verschil dat niet in config uit te drukken is, is een ontwerpfout.
- **AWS wordt nooit geschreven.** Alle AWS-toegang is read-only. Het script heeft geen enkele write-operatie richting DynamoDB of S3.
- **Werkdata verlaat de repo niet.** Alles wat het script wegschrijft landt onder `scripts/.data/`, dat in `.gitignore` staat. Het script weigert te schrijven naar een pad buiten die map.
- **Testfixtures zijn synthetisch.** Geen enkel testbestand in de repo bevat echte namen, emails, Cognito-subs of foto's.
- **Anonimisatie zit in de transform.** Bij dev-config verlaten echte namen en emails de transform-stap niet. Geen opruimactie achteraf.
- **Herhaalbaar.** `reset` gevolgd door `load-records` levert dezelfde eindtoestand. Twee keer `load-records` zonder `reset` is geen ondersteund scenario en moet fail-loud stoppen, niet stilletjes verdubbelen.
- **Bestanden worden nooit twee keer geüpload.** `load-files` houdt `.data/storage-map.json` bij: S3-sleutel → Convex-`_storage`-id. Een bestand dat daarin staat wordt overgeslagen. Opnieuw draaien na een afgebroken run hervat waar het gebleven was.
- **Foreign keys kloppen.** Na `load-records` verwijst elke `v.id(...)`-waarde naar een bestaand document, en elke `storageId` naar een bestaand bestand.
- **Aggregates kloppen bij oplevering.** `users.photoCount`, `photos.ratingAverage`, `photos.ratingCount` en `features.upvoteCount` worden in de transform berekend uit de brondata, niet opgebouwd door mutations.
- **Auth-koppeling klopt.** Elke `users.subject` is een echte Clerk-ID in de Clerk-instance die bij de doel-deployment hoort. Dev-Convex ↔ dev-Clerk, prod ↔ prod.

## De commando's

| # | Commando | Leest | Schrijft | Duur (prod) |
|---|---|---|---|---|
| 1 | `extract` | DynamoDB prod | `.data/dynamo-extract.json` | minuten |
| 2 | `inspect` | `.data/dynamo-extract.json` | overzicht in terminal: per user het aantal groepen, admin ja/nee, aantal foto's, aantal ratings | seconden |
| 3 | `transform` | `.data/dynamo-extract.json` + config | `.data/convex-records.json` — Convex-vormige records met hun DynamoDB-sleutel als tijdelijke verwijzing | seconden |
| 4 | `load-files` | `.data/convex-records.json` + S3 | Convex-storage, plus `.data/storage-map.json` | uren |
| 5 | `load-records` | `.data/convex-records.json` + `.data/storage-map.json` | de Convex-tabellen | minuten |
| 6 | `verify` | beide `.data`-bestanden + de deployment | rapport in terminal | minuten |
| 7 | `reset` | — | leegt de tabellen; met `--all` ook de storage | minuten |

`extract` is traag en de uitkomst is herbruikbaar; bij het itereren op `transform` mag DynamoDB niet opnieuw geraakt worden. Daarom zeven losse commando's en geen enkele knop.

De splitsing tussen `load-files` en `load-records` is geen netheid maar noodzaak — zie §Gefaseerde prod-run. `reset` leegt standaard alleen de tabellen, zodat een reset vóór T-0 de al geüploade bestanden niet weggooit.

`inspect` bestaat om de 3 chosen users op feiten te kiezen in plaats van uit het geheugen. De uitkomst gaat handmatig in de dev-config.

### Volgorde binnen `load-records`

De volgorde volgt de afhankelijkheden. Elke stap vult de ID-map die de volgende nodig heeft.

| # | Wat | Hangt af van |
|---|---|---|
| 1 | `users` | Clerk-ID-map uit config, `storage-map.json` voor profielfoto's |
| 2 | `groups`, `memberships` | 1 |
| 3 | `albums` | 2 |
| 4 | `photos` | 1, `storage-map.json` |
| 5 | `albumPhotos`, `ratings`, `invites`, `features`, `featureUpvotes` | 3, 4 |
| 6 | `albumLastSeen` | 3, 4 |
| 7 | `coverPhotoId` invullen op `groups` en `albums` | 4 |

Stap 7 is een aparte pass omdat groups en albums vooruit verwijzen naar photos, terwijl photos via `ownerId` terugverwijst naar users. Die cirkel is niet in één pass te schrijven.

`albumLastSeen` bestaat niet in DynamoDB en wordt afgeleid: per membership de `seenPics`-array doorlopen, groeperen op album, en per album `max(photo.createdAt)` nemen. Geen record voor een (user, album)-paar zonder geziene foto's — de bestaande fallback in `albums.ts` vangt dat af.

### Configuratie per doel

| | dev | prod |
|---|---|---|
| Filter | 3 chosen users | geen |
| Anonimisatie | namen → herkenbare dev-namen, emails → `dev-{n}@clubalmanac.test` | uit |
| User-ID-map | 3 Cognito-subs → 3 handmatig aangemaakte Clerk-dev-ID's | email → Clerk-prod-ID (vooraf aangemaakt op T-2 weken via de Invitations API) |
| Doel | dev-deployment | prod-deployment |
| Omvang storage | enkele honderden MB | ~5,6 GB |

Filterregels per entiteit staan in [`migratie-plan-convex.md` §Dev seed strategie](../migratie-plan-convex.md#dev-seed-strategie) en worden daar niet gedupliceerd.

## Gefaseerde prod-run

De uploadverbinding waarop de prod-run draait haalt minder dan 20 Mbit/s omhoog. De bucket `blob-images` bevat 1601 objecten van samen 5,6 GB (gemeten met `aws s3 ls --summarize`, 2026-08-23). Dat is ruim drie kwartier pure zendtijd, en met de overhead per bestand over 1601 objecten loopt dat naar ruim een uur. Te veel voor een cutover-venster.

Foto- en videobestanden zijn onveranderlijk: eenmaal geüpload verandert er niets meer aan. Daarom wordt de prod-run gesplitst.

| Wanneer | Commando | Duur | Wat er gebeurt |
|---|---|---|---|
| T-2 weken | `extract` + `transform` + `load-files` | uren | Alle bestanden naar Convex-prod-storage. `storage-map.json` wordt gevuld. Er staat nog geen enkel record in de database. |
| T-0 | `extract` + `transform` | minuten | Verse DynamoDB-stand, inclusief alles wat sinds T-2 is bijgekomen |
| T-0 | `load-files` | minuten | Alleen de nieuwe bestanden; de rest staat al in `storage-map.json` en wordt overgeslagen |
| T-0 | `load-records` + `verify` | minuten | De hele database in één keer, met de storage-ID's uit de map |

Dit stelt twee eisen aan het ontwerp:

- `load-files` moet hervatbaar zijn. Een run van uren over een trage lijn breekt af; opnieuw starten mag niet betekenen dat alles opnieuw gaat.
- `storage-map.json` moet een run overleven en tussen runs herbruikbaar zijn. De sleutel is de S3-objectsleutel, niet iets wat per `transform` opnieuw wordt bedacht.

Gevolg voor de planning: de Convex-prod-deployment moet op T-2 weken al bestaan. Dat past binnen het bestaande T-4-weken-blok in `migratie-status.md`.

## Video's — buiten scope

**Besluit Wouter, 2026-08-23: de video's gaan niet mee naar Convex.** Ze blijven op S3 staan tot de overstap naar Cloudflare R2. WP12 raakt de bucket `blob-videos` niet: geen extract, geen upload, geen records.

De aanname in het migratieplan klopte niet. Empirisch vastgesteld:

| | Plan | Werkelijkheid |
|---|---|---|
| Aantal | 6 | 10 |
| Omvang | ~3 GB | ~19 GB (17,7 GiB) |
| Grootste bestand | — | 5,8 GiB |
| Locatie | aangenomen: `blob-images/protected/` | eigen bucket `blob-videos` |

Ze staan dus buiten het bereik van de S3-trigger op `blob-images/protected/`, en hebben daarom géén `PO`-record in DynamoDB. Het orphan-scenario dat A signaleerde was reëel — en verdwijnt doordat de bestanden nu helemaal buiten Convex blijven.

Waarom niet meenemen: de video's zouden ~80% van de overzettijd opslokken (~3 uur extra bij <20 Mbit/s), het bestand van 5,8 GiB moet in één keer door een upload-URL zonder hervattingsmogelijkheid, en er is geen user-feature die ze nodig heeft. De opslagkosten waren het bezwaar niet ($0,04/GB/maand).

Naast de video's staat er een map `covers/` met 9 PNG's, genoemd naar reis en jaartal (1991 Tanzania t/m 2022 Georgië). Die worden in de oude iPhone-app getoond, maar de verwijzing staat **niet in DynamoDB** — hij zit in de front-end. Gevolgen buiten WP12:

- **Fase 4**: de nieuwe app moet de video's en covers weer tonen. Bron blijft S3, later R2.
- **Fase 5, T+30**: bij het opruimen van AWS mag `blob-videos` **niet** weg. Zolang R2 er niet is, is dat de live bron voor de app.
- **Nieuw werkpakket**: video's van S3 naar R2. Losstaand van de cutover.

## Migratiecode in `convex/`

`load-files`, `load-records`, `verify` en `reset` hebben internal mutations nodig die de normale auth-checks omzeilen. Afspraken:

- Alles in één bestand: `convex/migration.ts`. Niets verspreid over bestaande bestanden.
- Alleen `internalMutation` / `internalAction` — niet aanroepbaar zonder deploy key.
- Weghalen na T+30, samen met de andere cutover-opruiming. Opnemen in het fase 5-stappenplan.

Bewust geaccepteerd door Wouter op 2026-08-23, met die einddatum als voorwaarde.

## Edge cases + scope-uitsluitingen

**In scope**
- Alle tien de tabellen uit `schema.ts` die brondata hebben, plus `albumLastSeen` als afgeleide.
- Profielfoto's (`users.profilePhotoStorageId`), niet alleen album-foto's.
- `load-files` is hervatbaar. `load-records` niet: dat is een run van minuten, daar volstaat `reset` en opnieuw.
- Afbreken halverwege `load-records`: fail-loud, met een bruikbare foutmelding en de instructie om `reset` te draaien.
- Prod-configuratie wordt gebouwd en reviewbaar opgeleverd, maar in deze WP niet uitgevoerd.

**Bewust niet**
- De prod-run zelf. Die staat in fase 5 op T-0.
- Hervatten na een afgebroken `load-records`. `reset` plus opnieuw duurt minuten; hervatting zou een tweede foutbron zijn.
- De video's en hun covers. Blijven op S3 tot de R2-overstap — zie §Video's.
- Vergelijken van dev-data met prod na afloop. Dev is geanonimiseerd en gefilterd; die vergelijking bestaat niet.
- R2-storage. Blijft Convex-storage, conform het plan.
- Terugmigratie naar AWS.

## Risico-assessment

- **security/privacy**: **hoog** — productie-PII van 16 mensen komt op een laptop te staan: namen, emails, foto's, locatiegegevens. Mitigatie: alles onder één gitignored map, anonimisatie in de transform en niet erna, synthetische testfixtures, en een expliciete opruim-instructie in de runbook.
- **ops**: **hoog** — de uploadlijn haalt minder dan 20 Mbit/s, waardoor 5,6 GB niet binnen een cutover-venster past. Het gefaseerde ontwerp (bestanden op T-2, records op T-0) is daarmee geen optimalisatie maar een harde eis, en `load-files` moet hervatbaar zijn. Zie §Gefaseerde prod-run.
- **external deps**: **medium** — nieuwe AWS-SDK-dependencies. De onbevestigde Convex-limiet op bestandsgrootte is vervallen als risico nu de video's buiten scope zijn; de grootste resterende bestanden zijn gewone foto's.
- **multi-user/concurrency**: **laag** — één operator, geen gelijktijdig verkeer op de doel-deployment.
- **data/schema-evolutie**: **hoog** — dit ís de cutover-batch. Pre-flight per [`data-migration-preflight.md`](../conventions/data-migration-preflight.md) is verplicht vóór de eerste regel implementatiecode, inclusief `npx convex export` als anker.
- **ops-runbook-impact**: nieuwe AWS-credentials (read-only, alleen lokaal — nooit als Convex-env-var), plus een runbook die beide runs beschrijft. Landt in `docs/runbooks/`. De prod-run-stappen moeten aansluiten op het bestaande T-0-blok in `migratie-status.md`.

## Cross-refs

- migratie-plan: §Database single-table DynamoDB, §File storage, §Environments, §Dev seed strategie, §Teststrategie punt 2
- migratie-status: fase 3 in zijn geheel; fase 5 T-0-stappen
- cascade-matrix: AP1/AP2 voor de `seenPics` → `albumLastSeen`-afleiding
- oude AWS-code (alleen A leest): `blob-images-api*` — de PK/SK-patronen en de werkelijke attribuutnamen per entiteit
- bestaand: `internal.monitoring.integrityCheck` uit WP10 wordt hergebruikt door `verify`

## Acceptance — hoe weten we dat het klaar is

- **Unit-tests** op `transform`, met een synthetische DynamoDB-fixture: filterregels per entiteit, anonimisatie, aggregate-berekening, de `seenPics` → `albumLastSeen`-afleiding, en de randgevallen daarvan.
- **Unit-tests** op de ID-map: foreign keys worden correct omgeschreven, en een verwijzing naar een weggefilterd record leidt tot een harde fout, niet tot een stille `undefined`.
- **Integration-test** die een kleine synthetische set door `load-files`, `load-records` en `verify` haalt tegen de dev-deployment, achter dezelfde env-var-gate als de bestaande integration-tests. Inclusief een tweede `load-files`-run die aantoont dat al geüploade bestanden worden overgeslagen.
- **Empirische check**: de dev-seed is gedraaid, `verify` is groen, en `internal.monitoring.integrityCheck` meldt geen drift.
- **Meting**: `load-files` rapporteert de gehaalde doorvoer in MB/s, zodat de duur van de prod-run op T-2 te voorspellen is.
- **Runbook** in `docs/runbooks/` die beide runs beschrijft, inclusief de opruimstap voor `scripts/.data/`.

## Beantwoorde vragen (Wouter, 2026-08-23)

| Vraag | Antwoord |
|---|---|
| Is productie de enige AWS-bron? | Er is ook een dev-omgeving in AWS, maar die negeren we. Uitsluitend productie. |
| Moeten de video's mee? | Ja, de content moet mee. Maar het is geen user-feature — geen API-endpoints voor video. Uit te zoeken: staat er in DynamoDB een verwijzing naar de video's? |
| Hoe snel is de upload? | Minder dan 20 Mbit/s omhoog. Daarmee is de gefaseerde prod-run verplicht. |
| Migratiecode in `convex/`? | Akkoord, mits die na T+30 weer weg gaat. |

Na A's spec-criticus-pass, tweede ronde:

| Vraag | Besluit |
|---|---|
| Gaan de stemscores op features verloren? | **Ja.** `upvoteCount = 0`, geen `featureUpvotes`-records. Bevestigt A-besluit optie 3 bij correctie 3. De oude `votes`-waarde komt in het transform-rapport, zodat Wouter 'm desgewenst handmatig terugzet. |
| Invite-tokens overnemen of vernieuwen? | **Vernieuwen.** Uitstaande invite-links uit oude mails werken na cutover niet meer; genodigden krijgen handmatig een nieuwe uitnodiging. Het oude token is base64 van `{PK, SK}` en draagt daarmee een emailadres plus de DynamoDB-sleutelvorm — dat halen we niet over. Dekt de drie RED privacy-tests uit `7281232`. |
| Dev-filter: groep opgericht door een niet-chosen user? | **Groep uitsluiten.** Geen vierde Clerk-dev-account. Als bij `inspect` blijkt dat dit een groep wegneemt die je juist wilde testen, is dat een reden om de keuze van de 3 chosen users te herzien — niet om de regel te verzachten. |

## Nog open

1. **Voor Wouter, ná `inspect`**: welke 3 users worden de chosen? Kan pas beantwoord worden als het overzicht er is.

## Omgeving

AWS-bron staat in **eu-central-1** (bucket `blob-images` en de DynamoDB-tabel). Doel is Convex in eu-west-1 (Dublin). Vastgesteld door A; stond niet in het migratieplan.

---

## Audit-bevindingen cyclus 1 (2026-08-23)

Audit gedraaid op `28d5c1d` + `f86b2c2` + `03a52db`. Suite 675 groen, typecheck clean. Drie blockers, vijf should-fixes. A schrijft hier RED tests op, B fixt daarna.

### B-1 (blocker) — stil fotoverlies met een groene `verify`

`readStorageMap` (`scripts/migrate/loadFiles.ts:53-56`) geeft een lege map terug als het bestand ontbreekt, zonder fout. `applyStorageMap` (`loadRecords.ts:232-238`) gooit vervolgens elke foto weg waarvan de sleutel niet in die map staat; het enige signaal is een `console.warn`. De `--accept-missing-files`-gate helpt niet, want die kijkt naar `missing-files.json` en dat wordt pas aan het eind van `load-files` geschreven — juist niet als de run halverwege afbreekt.

Empirisch op A's fixture met een lege map: `photos` 5 → 0, `albumPhotos` 3 → 0, `ratings` 3 → 0, 2 covers en 3 profielfoto's gewist, alle `photoCount` op 0.

`verify` ziet dit structureel niet, want die past dezelfde `applyStorageMap` toe op zijn eigen verwachting (`verify.ts:28`). Verwacht 0, gevonden 0, dus `ok`. Storage-orphans vangen het ook niet — de weggevallen foto's staan per definitie niet in storage.

Fix-richting: (a) `load-records` weigert bij een ontbrekende `storage-map.json`; (b) coverage-check `referencedStorageKeys(recordsFile)` ⊆ `storageMap.files` vóór de eerste schrijf, harde fout tenzij `--accept-missing-files`; (c) `verify` neemt zijn verwachting uit `recordsFile.meta.counts` — de onafhankelijke, eerdere laag — en rapporteert elk verschil als bevinding in plaats van als aftrekpost.

### B-2 (blocker) — `uploadIdempotency` valt buiten de migratie-tabellen

`MIGRATION_TABLES` (`convex/migration.ts:26-38`) mist `uploadIdempotency`, terwijl WP10 er twee FK's op controleert (`convex/monitoring.ts:50` en `:68`). Gevolg: de preconditie "alle doeltabellen leeg" ziet achtergebleven rijen niet, en `reset` kan ze niet verwijderen omdat `assertMigrationTable` de naam weigert. De dev-deployment heeft aantoonbaar zulke rijen — `tests/integration/uploads/uploadRoundtrip.test.ts` schrijft ze. Na `reset` plus seed wijzen die `ownerId`'s naar verwijderde users, en meldt `integrityCheck` dagelijks dangling FK's. De acceptatie-eis "`verify` groen en geen drift" is dan niet haalbaar zonder handwerk buiten de tool om.

### B-3 (blocker) — twee acceptatie-eisen zonder dekking

De ID-map-unit-tests en de integration-test uit §Acceptance bestaan niet. `grep -rn "applyStorageMap\|loadRecords\|loadFiles\|migration\." tests/` geeft nul treffers. Ongetest: `loadRecords.ts`, `loadFiles.ts`, `verify.ts`, `reset.ts`, `config.ts` en `convex/migration.ts`. B-1 en B-2 waren met die tests waarschijnlijk gevonden. `toDoc` en `applyStorageMap` zijn pure, geëxporteerde functies — goedkoop te dekken. `convex/migration.ts` is met `convex-test` te dekken zoals elke andere convex-module hier. Uitstel van de *integration*-test past in het WP5/WP6/WP11-precedent, maar dan met een expliciete marker in spec én commit-message.

### S-1 (should-fix) — PII lekt via `warnings`

De anonimisatie-invariant eist dat in de volledige `convex-records.json` van een dev-run geen bron-naam of bron-email voorkomt. `warnings` zit in dat bestand (`runTransform.ts:33-42`), en de warn-teksten gebruiken de rauwe `inviteeKey` — die *is* een emailadres bij een invite aan iemand zonder account (`transform.ts:474-475` en `:518`). Gereproduceerd. De records zelf zijn schoon; het lek zit puur in het waarschuwingskanaal. A's scan mist het omdat die op `runDev().records` test in plaats van op het weggeschreven bestand.

### S-2 (should-fix) — invite-filterregel wijkt af van het plan

`migratie-plan-convex.md` §Dev seed strategie zegt "Invites: alleen tussen de 3 chosen". De implementatie leest het als: uitnodiger chosen, groep opgenomen, en een genodigde die al user is moet chosen zijn. **Geratificeerd door regie** — de planregel is onhoudbaar, want een invite aan iemand zónder account is juist het normale geval en die persoon kán geen chosen user zijn. Zonder deze lezing bevat de dev-seed nul invites. Actie: planregel bijwerken en één test die de gekozen regel pint.

### S-3 (should-fix) — cijfer-drift *(afgehandeld door regie)*

Opgelost door te meten in plaats van te redeneren: `aws s3 ls s3://blob-images/ --recursive --summarize` geeft 1601 objecten, 5.605.457.261 bytes = **5,6 GB**. De 8,3 GB uit het oorspronkelijke plan was het totaal inclusief video's, en die gaan niet mee. Alle documentatie staat nu op 5,6 GB. **Rest voor B:** `loadFiles.ts:154` en `:222` hebben 8,3 GB respectievelijk `8.3e9` hardcoded staan.

### S-4 (should-fix) — commit-hygiëne

De volledige implementatie landde in `28d5c1d`, een commit met een docs-titel over het video-besluit, samen met spec-edits die niet van B waren. Wie dit WP later reconstrueert vindt de implementatie niet terug via de commit-messages, en de rolgrens is niet uit de historie af te lezen. Geen code-actie; wel een punt voor `commit-discipline.md`.

### S-5 (should-fix) — pre-flight §0 nooit uitgevoerd

`data-migration-preflight.md` schrijft een 0e sub-fase voor vóór de eerste regel implementatiecode: git tag, snapshot, count-query, go/no-go. Er is geen tag en geen status-notitie. B heeft de export-ankers wel in het runbook gezet, maar dat dekt de runs, niet de verplichte voorfase. Alsnog doen vóór de eerste echte `load-records`.

### Nice-to-have

- `fetchFromS3` (`loadFiles.ts:188-192`) vangt alleen `NoSuchKey`/`NotFound`. Zonder `s3:ListBucket` geeft S3 op een niet-bestaande sleutel `AccessDenied`, en breekt de hele run af. Opnemen in de runbook-policy.
- Een user met alleen een `UVvisit`-record valt hard om op `transform.ts:406` of `:412`, met een melding die de operator naar de verkeerde oorzaak stuurt. Overweeg overslaan plus rapporteren.
- Een ontbrekende *profielfoto* valt in dezelfde gate als een echte foto, waardoor de operator `--accept-missing-files` moet zetten en daarmee ook de gate op echt fotoverlies opent. Splitsen.
- `sourceKey` draagt de Cognito-sub ook in geanonimiseerde dev-output. Verdedigbaar, maar de spec noemt die uitzondering alleen voor storage-sleutels.
- Typo `loadRecords.ts:75`: "Aggregates zijn hertelt" → "herteld".

### Recurring pattern — self-referentiële verificatie

B-1 is een herhaling van het WP10-patroon *geen recompute-vs-recompute*, één laag hoger: `verify.ts:28` en `loadRecords.ts:69` roepen dezelfde `applyStorageMap` aan, dus de controlestap kan de belangrijkste fout van de laadstap structureel niet zien. Voorstel voor `ab-audit-workflow.md`: **een verify- of check-stap mag zijn verwachting nooit afleiden met code die hij deelt met de te controleren stap — de verwachting komt uit de eerdere, onafhankelijke artefact-laag.**

---

## Spec-criticus aanvullingen (A, 2026-08-23)

A heeft de oude AWS-code gelezen (`blob-images-api`, `-user`, `-groups`, `-photos`, `-invites`, `blob-images-features`, `blob-common`) en de draft daartegen gelegd. De draft klopt op mechanisme, planning en risico-weging. Waar hij niet klopt is in de **aanname dat de brondata dezelfde vorm en betekenis heeft als het Convex-schema**. Op zes punten is dat aantoonbaar niet zo. Die staan hieronder als correcties, gevolgd door de invarianten en edge cases die daaruit volgen.

### Bronwerkelijkheid — wat er écht in DynamoDB staat

Tabel `blob-images-photos-prod`, bucket `blob-images`, regio **eu-central-1** (Frankfurt). Die regio staat nergens in de draft; hij bepaalt wel de AWS-client-config en de latency van `extract` en `load-files`.

| Convex-tabel | Bron-record(s) | Bijzonderheid |
|---|---|---|
| `users` | `UBbase / U{sub}` (naam, email, profielfoto), `UPstats / U{sub}` (photoCount), `UVvisit / U{sub}` (bezoekdata, cognitoId), `USER / U{sub}` (afgeleide merge, geschreven door de stream) | Eén user = vier records. `USER` is een **afgeleide kopie** en is dus géén bron — hij kan achterlopen. |
| `groups` | `GBbase / {groupId}` | |
| `memberships` | `UM{userId} / {groupId}` **zonder** `status: 'invite'` | |
| `invites` | `UM{inviteeId} / {groupId}` **mét** `status: 'invite'` | `inviteeId` is `U{sub}` óf een **emailadres**. Zelfde recordtype als membership. |
| `albums` | `GA{groupId} / {albumId}` | |
| `albumPhotos` | `GP{groupId}#{albumId} / {photoId}` | |
| `photos` | `PO{photoId} / U{ownerSub}` | |
| `ratings` | `UF{photoId} / U{userSub}` | |
| `features` | `NFfeature / {featureId}` | |
| `featureUpvotes` | — | **geen bron**, zie correctie 3 |
| `albumLastSeen` | `seenPics` op `UM`-records | zie correctie 2 |

### Correctie 1 — `createdAt` is een kalenderdag, geen timestamp

`blob-common/core/date.js` levert `YYYY-MM-DD`. Élk `createdAt`, `exifDate`, `flaggedDate`, `flaggedDeleteDate`, `flaggedAppealDate` en `visitDateLast` in de bron is een datumstring op dag-granulariteit. Het Convex-schema verwacht overal `v.number()` (epoch-ms).

Gevolgen die de draft niet noemt:

- **Tijd-op-de-dag bestaat niet in de bron.** Alle foto's van dezelfde dag krijgen dezelfde `createdAt`/`addedAt`. Sorteervolgorde binnen een dag is niet reconstrueerbaar. De oude app gebruikte `dateSK = createdAt + '#' + photoId` als tiebreak; die volgorde is willekeurig en hoeft niet bewaard te worden.
- **De strict-`>`-semantiek van `albumLastSeen` botst hierop.** Zie correctie 2.
- **Conversie-afspraak (A-besluit, regie mag overrulen):** `YYYY-MM-DD` → epoch-ms op **UTC-middernacht** van die dag. Deterministisch, omkeerbaar, en de kalenderdag blijft in Europe/Amsterdam dezelfde. Geen "slimme" spreiding van timestamps binnen de dag om ties te breken — dat verzint data die niet bestaat.
- **Invariant:** een datum die in de oude app als 14 juli werd getoond, wordt na migratie ook als 14 juli getoond. Dat is de acceptatie-eis, niet de exacte ms-waarde.

### Correctie 2 — `seenPics` is een **ongelezen**-lijst, niet een gelezen-lijst

Dit is de zwaarste vondst. `migratie-plan-convex.md` §Unread-count beschrijft `seenPics` als "bevat photoIds van foto's die user heeft gezien" en leidt daaruit `lastSeenAt = max(addedAt)` af. De bron zegt het omgekeerde:

- `blob-images-api/handlersDBstreams/groupPhotoAddToMember.js` voegt bij **elke nieuwe albumfoto** een entry `{ albumId, photoId }` toe aan `seenPics` van álle groepsleden behalve de eigenaar.
- `blob-images-api-groups/libs/lib-newPics.js` telt precies die entries als **nieuw**: `filter(item => !item.seenDate || item.seenDate === today)`.
- `userChangeToMembership.js` stempelt bij een nieuw bezoek `seenDate = visitDateLast` op entries zonder stempel, en verwijdert entries waarvan de `seenDate` ouder is dan de huidige bezoekdag.

Dus: **entry zonder `seenDate` = ongelezen. Entry met `seenDate` = één dag geleden getoond, daarna opgeruimd.** De array is een wachtrij van ongelezen foto's, geen historie van gelezen foto's.

Het algoritme uit het migratieplan toegepast op deze data zet `lastSeenAt` op de *nieuwste ongelezen* foto — waardoor iedere user na cutover exact nul ongelezen foto's ziet, terwijl de badge in de oude app juist wél stond. Precies de omgekeerde uitkomst.

**Correcte afleiding (A-besluit):** per (user, album):

- `ongelezen` = de `seenPics`-entries voor dat album **zonder** `seenDate`, waarvan het bijbehorende `GP`-record nog bestaat.
- Heeft het album ongelezen entries → `lastSeenAt` = de kleinste `addedAt` binnen die ongelezen set, **min 1 ms**.
- Heeft het album wél albumfoto's maar geen ongelezen entries → `lastSeenAt` = de grootste `addedAt` in dat album.
- Heeft het album geen albumfoto's → geen record; de bestaande fallback in `albums.ts` regelt het.

**Richtings-invariant bij twijfel:** de afleiding mag fout gaan richting *"te veel ongelezen"*, nooit richting *"ten onrechte gelezen"*. Een badge die één keer te veel staat is een schoonheidsfoutje; een foto die de user nooit te zien krijgt is verlies. Dit is de regel die de dag-granulariteit uit correctie 1 opvangt: staan een gelezen en een ongelezen foto op dezelfde dag, dan worden ze allebei ongelezen.

Entries verwijzen naar een album buiten de groep van de membership, naar een verwijderd album, of naar een verwijderde foto → overslaan, geteld in het transform-rapport.

### Correctie 3 — `featureUpvotes` heeft geen brondata

`blob-images-features/handlers/upvote.js` doet één anonieme increment op `NFfeature.votes`, met als enige conditie "je bent niet de indiener". Er wordt **geen** per-user record geschreven. Bovendien start `votes` in `handlers/create.js` op **10**, niet op 0 — het is een score, geen telling.

De draft zegt "`features.upvoteCount` wordt in de transform berekend uit de brondata". Dat kan niet: er is geen brondata om uit te rekenen, en `internal.monitoring.integrityCheck` (WP10) eist keihard `features.upvoteCount === count(featureUpvotes met dat featureId)`.

Drie opties, waarvan er maar één zowel eerlijk als integriteits-schoon is:

| Optie | Uitkomst |
|---|---|
| `upvoteCount = votes`, geen upvote-records | Permanente dagelijkse drift-mail vanaf dag één. Onacceptabel, zelfde bezwaar als bij de video's. |
| Upvote-records verzinnen en aan willekeurige users toeschrijven | Fabriceert attributie die nooit bestaan heeft. Afgewezen. |
| **`upvoteCount = 0`, geen `featureUpvotes`-records** | De stemscore gaat verloren, de rest van de feature blijft. Integriteits-schoon. |

**A-besluit: optie 3.** De oude `votes`-waarde wordt wel in het transform-rapport genoemd, zodat Wouter 'm desgewenst handmatig terugzet. Expliciet als data-verlies te bevestigen door Wouter — zie §Nog open.

### Correctie 4 — rollen, statussen en types matchen niet

| Bron | Convex | Regel |
|---|---|---|
| `role: 'guest'` (default bij invite) | `role: 'member'` | `guest` → `member`, `admin` → `admin`. Een andere waarde is een harde fout. |
| membership zonder `status` (aangemaakt via `createGroup`) of `status: 'active'` | `memberships` | lid |
| `status: 'invite'` | `invites` | **geen** membership |
| `isFounder: true` op membership | `groups.createdBy` | zie edge cases |
| feature `status: 'submitted'` | `'open'` | |
| feature `status: 'in progress'` | `'inProgress'` | |
| feature `status: 'completed'` | `'done'` | |
| feature `type` | `'feature'` | Problem-reports gingen alleen per mail (`handlersProblem/create.js` schrijft niets naar DynamoDB). Er is dus geen enkele `type: 'problem'`-rij te migreren. |
| rating `0` / `1` | `ratings.value` | Het oude "rating" is een **like** (0 of 1), geen 1..5-score. |

Over ratings: `updateRating.js` schrijft ook een record met `rating: 0` als een user zijn like weer intrekt. **A-besluit:** alleen records met `rating === 1` worden een `ratings`-rij (met `value: 1`); `rating: 0` levert geen rij op. `photos.ratingCount` = aantal likes, `photos.ratingAverage` = `1` bij ≥1 like en `undefined` bij 0 likes. Daarmee is de user-truth "aantal likes" bewaard en klopt de aggregate met WP10.

Zijdelings: het schema-commentaar bij `ratings.value` ("bv. 1..5") past niet bij de werkelijke feature. Dat is geen WP12-werk, wel een signaal voor regie.

Feature-veld `comment` (webmaster-notitie) heeft geen Convex-veld. Gaat verloren; noemen in het rapport.

### Correctie 5 — velden die het Convex-schema verplicht stelt maar de bron niet heeft

| Convex-veld | Bron | Regel |
|---|---|---|
| `groups.createdBy` (verplicht) | geen veld op `GBbase`; wel `isFounder: true` op één `UM`-record | afleiden uit de founder-membership. Géén founder gevonden → **harde fout**, met een config-override per groepId als ontsnapping. Niet stilletjes de oudste member pakken. |
| `albums.createdBy` (verplicht) | **bestaat niet**, in geen enkele vorm | valt terug op de founder van de groep (`groups.createdBy`). Gesynthetiseerd, dus expliciet als zodanig in het rapport tellen. |
| `albumPhotos.addedBy` (verplicht) | bestaat niet op `GP` | valt terug op de eigenaar van de foto. Verdedigbaar: beide schrijfpaden (`createAlbumPhoto.js` en de `albumphoto`-actie in `createPhoto.js`) staan alleen toe dat je je **eigen** foto publiceert. |
| `albums.description` (optioneel) | `createAlbum.js` schrijft 'm nooit | blijft leeg |
| `users.subject` (verplicht) | Cognito-sub, geen Clerk-ID | uit de ID-map. Ontbrekende mapping = harde fout, geen placeholder-subject. |
| `users.photoLimit` (verplicht) | stond in AWS als env-var, niet per user | `DEFAULT_PHOTO_LIMIT` uit `convex/users.ts` |
| `users.photoCount` | `UPstats.photoCount` | **niet overnemen** maar hertellen uit de `PO`-records. Het oude veld werd bijgehouden door een stream met bekende drift-historie (`fixPhotoStats.js` bestaat niet voor niks), en WP10 eist dat het klopt met de werkelijke rijen. |
| `photos.mimeType`, `filename`, `width`, `height` | **niet in DynamoDB** | blijven leeg. Alleen af te leiden uit S3-metadata; dat is geen verplichting van deze WP. Als `load-files` de content-type toch al van S3 krijgt, is 'm meenemen gratis — maar het is geen acceptatie-eis. |
| `photos.exifOrientation` | bestaat niet | blijft leeg. De oude app roteerde het bestand zelf (`fixPhotoRotation.js`), dus de bytes staan al goed. |
| `photos.flagReason` | bestaat niet | blijft leeg |
| `invites.token` | `otob({PK, SK})` — base64 van de invite-sleutel | zie edge cases |
| `invites.expiresAt` | `createdAt + 30 dagen` (`expireDate`) | |

### Correctie 6 — lege string als "leeg"-sentinel

`updateUser.js` zet `photoUrl: ''` en `photoId: ''` om een profielfoto te wissen; `flagPhotoAppeal.js` zet `flaggedDeleteDate: ''`. Die lege strings staan gewoon in de tabel. De transform moet `''` als *afwezig* behandelen — anders landt er een lege string waar Convex een `v.id("_storage")` of een `v.number()` verwacht en faalt `load-records` halverwege.

Zelfde categorie: `photoId` verwijst naar een foto die intussen verwijderd is. Komt voor bij `groups.coverPhotoId`, `albums.coverPhotoId` en `users.profilePhotoStorageId`.

### Toegevoegde invarianten

Aanvullend op §Invarianten in de draft:

- **De transform faalt luid op onoplosbare verplichte FK's.** Een verplichte verwijzing die niet resolvet stopt de run met de bron-sleutel in de melding. Nooit `undefined` doorlaten, nooit de rij stilletjes overslaan. Optionele verwijzingen (cover-foto's, `invites.groupId`) die niet resolven worden **gewist** en geteld — die zijn ontworpen om leeg te mogen zijn.
- **Referentiële geslotenheid van de dev-filter.** De filterregels in `migratie-plan-convex.md` §Dev seed strategie garanderen die geslotenheid *niet*: een groep wordt opgenomen zodra één chosen user lid is, maar de founder — en dus `groups.createdBy` — kan een niet-chosen user zijn. Zelfde probleem bij cover-foto's van niet-chosen eigenaren. De regel wordt: na filtering resolvet elke verplichte FK binnen de gefilterde set, of de transform stopt. Waar dat niet kan zonder data te verzinnen, is dat een filterregel die aangescherpt moet worden (bijvoorbeeld: neem de founder van een opgenomen groep altijd mee als user), niet iets om in de load op te lossen.
- **Anonimisatie is aantoonbaar volledig.** Niet "namen en emails zijn vervangen" maar: in de volledige `convex-records.json` van een dev-run komt geen enkele bron-naam of bron-email voor. Dit is als test uit te voeren over de hele output, niet per veld. Drie plekken waar dat minder vanzelf gaat dan het klinkt:
  - **Gedenormaliseerde kopieën.** `UM.user`, `UM.invitation.from`, `PO.user`, `GP.photo.user` en `NFfeature.user` bevatten allemaal complete user-records, inclusief naam en email.
  - **De bron-sleutel van een invite ís een emailadres.** Een invite aan iemand zonder account heeft PK `UM{email}`. Dat adres is daarmee de natuurlijke bron-ID en belandt in het `sourceKey`-veld van de transform-output — dus in een bestand op de laptop, ook al haalt het Convex nooit. De invariant gaat over wat de transform verlaat, niet over wat de database haalt; die sleutel moet dus óók vervangen worden.
  - **De invite-token draagt diezelfde sleutel, base64-gecodeerd.** Hem ongewijzigd overnemen zet het echte adres alsnog in het bestand, alleen minder leesbaar. Een scan op platte tekst mist dat; de test decodeert daarom.
  - **Uitzondering: S3-sleutels.** `protected/{sub}/{bestandsnaam}` bevat de Cognito-sub. Die sleutel is nodig om het bestand op te halen en verdwijnt bij `load-files` (vervangen door een `_storage`-id). Storage-sleutels vallen daarom buiten de scan — met als prijs dat de sub tijdelijk in `.data/` staat, wat de gitignore-invariant en de opruimstap in de runbook moeten afdekken.
- **Email-normalisatie.** Elke email die de transform verlaat is `trim().toLowerCase()`, conform §Email-normalisatie invariant in het migratieplan. Twee bron-users die daarna botsen op hetzelfde adres = harde fout, geen "laatste wint".
- **`load-files` is record-gedreven, nooit bucket-gedreven.** De set te uploaden bestanden is exact: `photos.url` ∪ `users.photoUrl` uit de getransformeerde records. Nooit een `ListObjectsV2` over de bucket. De bucket bevat aantoonbaar objecten zonder record: `fixPhotoRotation.js` schrijft een nieuw object en verwijdert het oude pas daarna (een gefaalde delete laat een wees achter), objecten met `Metadata.iscopy` worden door de S3-trigger genegeerd, en `public/img/...` bevat mail-assets. Een bucket-listing zou die allemaal importeren en daarmee vanaf dag één WP10-drift produceren.
- **Twee bestanden met dezelfde S3-sleutel worden één storage-object.** De standaard-profielfoto's zijn gedeeld (zie edge cases); `storage-map.json` op S3-sleutel geeft die dedup gratis. Het is dus geen 1:1 relatie tussen records en storage-objecten, en `verify` mag daar niet van uitgaan.
- **`verify` reconcilieert twee kanten op.** Niet alleen "elke `storageId` in een record bestaat" maar ook "elk object in `_storage` is aan minstens één record gekoppeld" — dat is exact de check die WP10 dagelijks draait, en het is beter die op T-0 al te zien dan de volgende ochtend per mail.
- **`extract` legt vast wanneer hij gedraaid is.** Een `transform` op een extract van twee weken oud tegen een `storage-map.json` van vandaag is een reële fout in het gefaseerde scenario. Het extract-bestand draagt zijn eigen tijdstempel en bron (tabelnaam + regio + account), en de latere stappen tonen die.
- **Geen enkel commando schrijft naar zowel AWS als Convex in dezelfde stap.** Al impliciet in "AWS wordt nooit geschreven", maar het maakt de leesrichting expliciet: DynamoDB en S3 zijn read-only bronnen, `.data/` is de enige tussenlaag.

### Gemiste edge cases

- **Invite-records met een emailadres als sleutel.** `UM{email} / {groupId}` — de PK bevat een `@`. Dat is de reden dat `inviteHelpers.js` op `PK.includes('@')` test. Voor de transform betekent het: een invite hoort niet bij een user, `invites` heeft geen `userId`, en het emailadres komt uit `PK.slice(2)` óf uit `user.email`. Die twee kunnen verschillen als de invitee later zijn adres wijzigde; `user.email` is leidend.
- **Invite naar een bestaande user.** Dan is de PK `UMU{sub}` en zit de email in `user.email`. Ook dan wordt het een `invites`-rij, niet een membership.
- **Invite-status bij migratie.** Geaccepteerde en geweigerde invites bestaan niet meer als record — accepteren zet `status: 'active'` (wordt membership), weigeren verwijdert de rij. Er zijn dus alleen `pending` en `expired` te migreren. Een invite waarvan `createdAt + 30 dagen` in het verleden ligt wordt `expired`, de rest `pending`. `respondedAt` en `bouncedAt` blijven leeg.
- **Invite-tokens.** De oude token is base64 van `{PK, SK}` en zit in mails die mogelijk nog in iemands inbox staan. Hem overnemen houdt oude links werkend maar lekt de DynamoDB-sleutelvorm in het nieuwe systeem; een nieuwe token genereren maakt uitstaande links dood. Bij ≤30 dagen geldigheid en een cutover die dat venster overspant, is dit een echte keuze — zie §Nog open.
- **Verlopen invites en de "actief lid"-vraag.** De oude leeslaag filtert verlopen invites weg (`dynamodb-lib-memberships.js`: `expireDate(createdAt) >= today`), maar verwijdert ze niet. In de tabel staan dus invites van jaren geleden. Ze migreren als `expired` is correct; ze meetellen als membership zou zomaar een 17e "lid" opleveren.
- **Standaard-profielfoto's ("knorren").** `createUser.js` geeft elke nieuwe user `public/img/knorren/knor{0..22}.jpg` als `photoUrl`. Dat zijn **gedeelde** bestanden buiten `protected/`, zonder `PO`-record. Ze zijn geen photo's; ze zijn wel de profielfoto van waarschijnlijk meerdere van de 16 users. Twee dingen volgen: het pad naar `users.profilePhotoStorageId` loopt niet altijd via een `photos`-record, en of die objecten überhaupt nog in de bucket staan is niet uit de code af te leiden — als ze ontbreken moet de user gewoon zonder profielfoto landen, niet crashen.
- **De S3-sleutel is geen betrouwbare eigenaars-aanwijzing.** `createPhoto.js` accepteert zowel `protected/{sub}/...` als `protected/eu-central-1:{identityId}/...` en zoekt de user in het tweede geval op via de `cog-idx`. Eigendom komt uit `PO.SK`, nooit uit het pad. Voor `load-files` maakt het niet uit — `photo.url` is de volledige sleutel — maar een tool die eigenaarschap uit het pad afleidt is fout op een deel van de data.
- **URL-encoding in S3-sleutels.** De S3-event-sleutel is percent-encoded en `createPhoto.js` decodeert alleen het derde segment. Bestandsnamen met spaties of diakritieken staan daardoor mogelijk in een andere vorm in `photo.url` dan in de bucket. `load-files` moet een 404 op een bestaand record als **fout** melden, niet als "overslaan" — anders verdwijnt een foto zonder dat iemand het merkt.
- **`photos` zonder bijbehorend S3-object.** Kan bestaan (mislukte rotatie, handmatig opgeruimde bucket). `photos.storageId` is verplicht, dus zo'n record kán niet zonder bestand geladen worden. Beslissing nodig: overslaan-en-rapporteren of hard falen. **A-besluit: rapporteren en overslaan, met het aantal in het `verify`-rapport** — één ontbrekend bestand mag een cutover van 1650 foto's niet blokkeren, maar het moet zichtbaar zijn.
- **Groepen zonder chosen founder in dev**, cover-foto's van niet-chosen eigenaren, ratings waarvan één kant wegvalt — zie de geslotenheids-invariant hierboven.
- **`albumPhotos.groupId` is gedenormaliseerd** in Convex. Hij zit in de `GP`-PK, dus hij is beschikbaar; hij moet wél consistent zijn met `albums.groupId` van hetzelfde album. Inconsistentie hier is een bronfout die zichtbaar moet worden.
- **Dezelfde foto in meerdere albums.** `GP`-records zijn per (groep, album, foto); één foto kan in meerdere albums zitten. De ID-map foto → Convex-id moet dus 1:N-gebruik aankunnen, en `load-files` mag zo'n foto maar één keer uploaden.
- **`reset` en de storage-map.** `reset` zonder `--all` laat de bestanden staan, maar leegt wel de tabellen. `storage-map.json` blijft dan geldig. `reset --all` maakt hem juist **ongeldig** — als hij daarna blijft staan, verwijst `load-records` naar storage-ID's die niet meer bestaan. Dat is een stille corruptie-route: `reset --all` moet de storage-map in dezelfde beweging ongeldig maken.
- **`load-records` op een niet-lege deployment.** De draft eist fail-loud. Concreet: de precondition is "alle doel-tabellen zijn leeg", vóór de eerste schrijf gecontroleerd, niet halverwege ontdekt.
- **Verkeerde deployment.** Hetzelfde patroon als `tests/integration/_helpers/safety.ts`: een tweede laag die weigert te schrijven naar prod tenzij expliciet aangezet. `reset` tegen prod is de duurste knop in dit werkpakket.
- **De ID-map is niet één map maar acht.** Users, groups, albums, photos, features en de koppel-entiteiten hebben elk hun eigen sleutelruimte, en de sleutels overlappen niet toevallig (`P…`, `G…`, `A…`, `F…`, `U…`). Toch: een gedeelde platte map waarin een photoId per ongeluk als groupId resolvet is een klasse fouten die met gescheiden namespaces niet bestaat.

### Risico-dimensies — bijstellingen

- **data/schema-evolutie: hoog blijft hoog, maar om een andere reden dan de draft geeft.** De draft ziet het risico in "dit is de cutover-batch". Het echte risico is dat de brondata *semantisch* afwijkt van het doelschema op minstens zes punten (correcties 1-6), waarvan er één — `seenPics` — in het migratieplan zélf verkeerd gedocumenteerd staat. Wat hier misgaat is niet zichtbaar als een foutmelding; het is data die er correct uitziet en het niet is. Vandaar dat de transform-tests unit-tests zijn met een synthetische fixture waarin de semantiek expliciet gepind wordt.
- **security/privacy: hoog, en breder dan de draft schat.** De draft noemt "namen, emails, foto's, locatiegegevens". Daar komt bij: **Cognito-subs** (identificerend), **gedenormaliseerde user-kopieën** verspreid over `UM`, `PO`, `GP` en `NFfeature`-records, en de **volledige inhoud van invite-berichten** (`invitation.message`, vrije tekst van de uitnodiger). De anonimisatie moet die allemaal raken, niet alleen de velden op `users`.
- **external deps: van medium naar medium/hoog.** Naast de AWS-SDK en de onbevestigde storage-limiet: de video's van ~500 MB moeten in één keer door een Convex-upload-URL heen over een lijn van <20 Mbit/s. Dat is ruim drie minuten per bestand aan pure zendtijd bij een perfecte verbinding. Of Convex' upload-URL zo lang openblijft, is een tweede onbevestigde aanname naast de groottelimiet.
- **ops: hoog, correct ingeschat.** Eén toevoeging: het gefaseerde scenario betekent dat er twee weken lang een prod-deployment bestaat met **5,6 GB storage en nul records**. WP10's `integrityCheck` draait daar dagelijks en meldt dan 1600+ storage-orphans, elke dag, twee weken lang. Dat moet vóór T-2 geregeld zijn — of de cron staat nog uit op prod, of de check wordt tijdelijk stilgezet. Als dat niet geregeld is, is de eerste ervaring met de monitoring op prod een stortvloed vals-positieven, en dat is precies hoe monitoring genegeerd gaat worden.

### Transform-outputcontract

Om `transform` als pure functie te kunnen testen — en omdat `load-files`, `load-records` en `verify` alle drie op dezelfde vorm leunen — ligt de vorm van `.data/convex-records.json` vast:

- Per Convex-tabel een lijst rijen. Elke rij draagt de Convex-veldnamen.
- Elke rij heeft een `sourceKey`: de natuurlijke bron-ID (`U{sub}`, `{groupId}`, `{albumId}`, `{photoId}`, `{featureId}`; voor koppel-entiteiten de samenstelling daarvan).
- Foreign-key-velden bevatten de `sourceKey` van het doel, niet een Convex-`_id`. `load-records` vervangt ze.
- Storage-verwijzingen zijn **S3-sleutels** in een apart veld (`storageKey` op photos, `profilePhotoStorageKey` op users), niet `storageId`. `load-records` vervangt ze aan de hand van `storage-map.json`.
- Naast de records levert de transform een lijst waarschuwingen op: overgeslagen records, gewiste optionele FK's, gesynthetiseerde velden, verloren gegane data. Die lijst is de input van het `inspect`/`verify`-rapport en van de opruim-verantwoording in de runbook.

### Openstaande vragen — bijgewerkt

De vier vragen uit de draft, plus wat er bij komt.

1. **Video's — code-antwoord gevonden, empirisch deel blijft open.** De S3-trigger (`blob-images-api-photos/serverless.yml`) staat op prefix `protected/` zónder suffix-filter, en `createPhoto.js` maakt een `PO`-record voor élk object daaronder dat geen `Metadata.iscopy` draagt — ongeacht bestandstype. EXIF-extractie faalt bij een video, wordt gevangen, en het record wordt alsnog geschreven. Er is verder nergens in de backend een spoor van video: geen mime-check, geen apart endpoint, geen apart pad. **Conclusie:** staan de video's onder `protected/`, dan hebben ze gewoon een `PO`-record en lopen ze via het normale pad mee — het derde scenario uit §Video's (bestanden zonder record) vervalt dan. De resterende vraag is puur empirisch en niet uit code te beantwoorden: **onder welke prefix staan de video's?** — is inmiddels empirisch beantwoord: ze staan in een eigen bucket `blob-videos`, buiten het bereik van de trigger, en hebben dus géén record. Wouter heeft daarop besloten ze buiten Convex te houden. Zie §Video's.
2. **Attribuutnamen per entiteit — beantwoord.** Zie §Bronwerkelijkheid en correcties 1-6.
3. **Convex-storage-limiet — nog open, voor B.** Uitgebreid: naast de maximale bestandsgrootte ook de levensduur van een upload-URL, gegeven ~3 minuten zendtijd per video.
4. **Chosen users — nog open, voor Wouter na `inspect`.**
5. **Nieuw, voor Wouter: het verlies van de feature-stemmen bevestigen.** Zie correctie 3.
6. **Nieuw, voor Wouter: invite-tokens overnemen of hergenereren?** Zie edge cases.
7. ~~Nieuw, voor regie: WP10's cron op prod tussen T-2 en T-0.~~ **Opgelost** door regie in `migratie-status.md` (fase 5-stappenplan: cron uit vóór `load-files` op T-2, weer aan na een groene `verify` op T-0).
8. **Nieuw, voor Wouter: hoe lost de dev-filter een groep op waarvan de founder niet chosen is?** De twee bruikbare uitwegen zijn "groep uitsluiten" of "founder als vierde user meenemen" — die tweede vereist een vierde Clerk-dev-ID en botst met "3 chosen users". De tests pinnen alleen dat de output referentieel gesloten is, niet welke uitweg gekozen wordt; die keuze is aan Wouter, want hij bepaalt wat er in dev testbaar moet zijn.
9. ~~Nieuw, voor regie: de `seenPics`-beschrijving in `migratie-plan-convex.md` §Unread-count klopt niet~~ (correctie 2). **Opgelost** door regie: §Unread-count draagt nu de gecorrigeerde afleiding plus de richtings-invariant.

---

## Fix-cyclus 1 — invarianten bij de audit-bevindingen (A, 2026-08-23)

De audit hierboven beschrijft *wat* er mis is en geeft per bevinding een
fix-richting. Deze sectie zet daar de gedrags-eis onder die B moet halen, in
dezelfde vorm als §Invarianten: waaraan is het af te lezen, niet hoe het
gebouwd wordt. De RED tests van deze cyclus pinnen precies deze punten.

Scope van de cyclus: **B-1, B-2, B-3, S-1, S-2.** S-3 (het resterende
8,3 GB-cijfer in de tooling), S-4 (commit-hygiëne, regie) en S-5 (pre-flight §0,
operationeel) hebben geen test — ze staan hieronder als losse actie. De
nice-to-haves blijven nice-to-have: geen test, geen verplichting in deze cyclus.

### Invariant — een ontbrekend bestand is nooit een stille aftrekpost (B-1)

Het onderliggende gedrag dat misging: de tool kon een volledige dataset laden
mét nul foto's, mét lege cover- en profielfoto-verwijzingen, mét alle
`photoCount` op 0, en dat afsluiten met een groene `verify`. Dat is precies de
klasse fout die deze WP niet mag hebben: data die er correct uitziet en het niet
is.

- **`load-records` begint niet aan zijn eerste schrijf zolang niet vaststaat dat
  elke storage-sleutel waar een record naar verwijst een bestand in de
  storage-map heeft.** Een ontbrekende, lege of onvolledige map is een harde
  fout. "Nul bestanden bekend, dus nul foto's te laden" is nooit een geldige
  conclusie.
- **`load-files` mag een ontbrekende map wél als eerste run lezen.** Het verschil
  zit in de stap, niet in het bestand: voor `load-files` is een lege map het
  normale begin, voor `load-records` het bewijs dat de vorige stap niet
  (af)gedraaid is.
- **De ontsnapping is expliciet en zichtbaar.** Alleen met de accept-vlag gaat
  een run door met bestanden die aantoonbaar niet in S3 staan; het verlies wordt
  dan geteld, benoemd met bron-sleutel, en komt terug in het `verify`-rapport.
  De vlag is geen voorwaarde om te kunnen draaien maar een bevestiging van
  geaccepteerd verlies.
- **De gate mag niet afhangen van een artefact dat pas aan het eind van de
  vorige stap geschreven wordt.** Een `load-files` die halverwege afbreekt is
  juist het scenario waarin de gate moet werken.

### Invariant — een controle leidt zijn verwachting niet af uit de gecontroleerde stap (B-1c)

- **De verwachting van `verify` komt uit de eerdere, onafhankelijke laag**: de
  tellingen die `transform` in `convex-records.json` heeft vastgelegd. Niet uit
  een herberekening die dezelfde weg aflegt als de laadstap.
- **Elk verschil tussen die verwachting en de deployment is een bevinding**, ook
  als het verschil verklaarbaar is door overgeslagen bestanden. Verklaarbaar is
  niet hetzelfde als goedgekeurd: de operator moet het zien en accepteren, en
  `verify` is de laatste plek waar dat nog kan vóór T-0 doorgaat.
- Dit is de WP-specifieke vorm van een algemene regel die regie in
  `ab-audit-workflow.md` opneemt (§Recurring pattern in de audit hierboven).

### Invariant — de migratie-tabellenset is dezelfde set die WP10 bewaakt (B-2)

- **Elke tabel waarop `internal.monitoring.integrityCheck` een controle doet,
  valt onder de leeg-preconditie van `load-records` én onder `reset`.** Anders
  is "groene `verify` en geen drift" niet haalbaar zonder handwerk buiten de
  tool om — en handwerk buiten de tool is op cutover-dag precies wat we niet
  willen.
- **Aflezing:** na een `reset` is élke tabel die de preconditie telt leeg, en de
  preconditie telt élke tabel die WP10 aanraakt. Twee lijsten die uit elkaar
  kunnen lopen zijn een ontwerpfout; dat ze vandaag uit elkaar lopen is de
  bevinding.
- Concreet gemist: `uploadIdempotency`. De dev-deployment heeft er aantoonbaar
  rijen in (de upload-roundtrip-integration-test schrijft ze), met `ownerId`'s
  die na een reset naar verwijderde users wijzen.

### Invariant — anonimisatie geldt over alles wat de transform verlaat (S-1)

- De bestaande invariant ("in de volledige `convex-records.json` van een dev-run
  komt geen enkele bron-naam of bron-email voor") gaat over **het bestand**, niet
  over het records-deel ervan. Het waarschuwingskanaal zit in datzelfde bestand
  en valt er dus onder.
- De scan die dat aantoont neemt daarom de waarschuwingen mee. Storage-sleutels
  blijven de enige uitzondering, om de reden die in §Toegevoegde invarianten
  staat.
- Dit raakt de records niet: die waren schoon. Het is het meldkanaal dat de
  invariant breekt — en dat is precies waarom de scan over het geheel moet en
  niet per veld.

### Geratificeerde regel — de dev-invite-filter (S-2)

Regie heeft de lezing van de implementatie geratificeerd; de planregel "invites:
alleen tussen de 3 chosen" is onhoudbaar. De regel is:

- de **uitnodiger** moet een chosen user zijn — dat is ook de enige verplichte
  FK (`invitedBy`);
- de **groep** moet in de dev-set zitten;
- is de **genodigde** een bestaande user, dan moet die chosen zijn; is hij dat
  niet (invite aan een adres zonder account), dan is dat juist het normale geval
  en blijft de invite staan.

Zonder de derde clausule bevat de dev-seed nul invites en is de invite-flow er
niet op te testen. `migratie-plan-convex.md` §Dev seed strategie is
overeenkomstig bijgewerkt.

### Testbaarheid — waar de tests aan mogen raken (B-3)

- **Geen enkele test raakt `scripts/.data/`.** Daar staat productie-PII; een
  test die daar leest of schrijft kan de werkdata van een lopende migratie
  overschrijven. De bestandslaag en de Convex-verbinding zijn in een test
  vervangbaar, en die vervangbaarheid is een eis aan de tooling, niet een
  toevalligheid van de huidige opzet.
- **De laadstappen zijn zonder deployment te controleren.** Wat `load-records`
  de deployment in stuurt (documenten met opgeloste FK's en storage-ID's, zonder
  tooling-interne velden), wat `reset` leegmaakt en waar `verify` op afgaat, is
  vast te stellen zonder AWS en zonder Convex-cloud.
- **De integration-test uit §Acceptance is uitgesteld**, met hetzelfde precedent
  als WP5/WP6/WP11: hij vereist AWS-credentials plus een dev-deployment en is
  daarmee dezelfde categorie als de bestaande `tests/integration/**`-laag.
  *Marker:* WP12-integration-test (load-files → load-records → verify,
  inclusief de tweede `load-files`-run die overslaan aantoont) staat open en
  wordt bij de dev-seed-run empirisch afgedekt. Dit uitstel hoort expliciet in
  de commit-message van de cyclus.

### Losse acties zonder test

- **S-3** — de tooling meldt de prod-planning nog in 8,3 GB. Het gemeten getal
  is 5,6 GB (1601 objecten, 5.605.457.261 bytes); de video's zitten er niet in.
  Eén getal, één plek.
- **S-5** — pre-flight §0 uit `data-migration-preflight.md` alsnog uitvoeren
  vóór de eerste echte `load-records`: git tag, `npx convex export` als anker,
  count-baseline, go/no-go-notitie. Niet te vervangen door de export-ankers in
  het runbook: die dekken de runs, niet de voorfase.
- **S-4** — commit-hygiëne; punt voor regie in `commit-discipline.md`, geen
  code-actie.
