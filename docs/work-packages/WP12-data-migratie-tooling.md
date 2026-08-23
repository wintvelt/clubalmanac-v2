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
| Omvang storage | enkele honderden MB | ~8,3 GB |

Filterregels per entiteit staan in [`migratie-plan-convex.md` §Dev seed strategie](../migratie-plan-convex.md#dev-seed-strategie) en worden daar niet gedupliceerd.

## Gefaseerde prod-run

De uploadverbinding waarop de prod-run draait haalt minder dan 20 Mbit/s omhoog. 8,3 GB is dan ruim een uur pure zendtijd, en met de overhead per bestand over 1650+ objecten zijn enkele uren realistisch. Dat past niet in een cutover-venster.

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

## Video's

De 6 video's (~3 GB samen) gaan mee naar Convex-storage. Ze zijn géén user-feature: er komen geen API-endpoints voor video, niet in deze WP en niet in fase 4. Het doel is uitsluitend dat de content niet verloren gaat bij het opruimen van AWS.

Uit te zoeken door A, vóór B begint:

1. **Staat er in DynamoDB een verwijzing naar de video's?** Bijvoorbeeld als `PO`-record met een video-`mimeType`, of in een ander patroon. Het antwoord bepaalt de rest.
2. Als er wél een verwijzing is: die records migreren mee via het normale pad, en het enige extra risico is de bestandsgrootte.
3. Als er géén verwijzing is: dan komen de bestanden in Convex-storage te staan zonder bijbehorend record. `internal.monitoring.integrityCheck` uit WP10 meldt zulke bestanden als storage-orphan, en zou dan vanaf dag één elke dag drift rapporteren. Dat is onacceptabel — het maakt de monitoring waardeloos. In dat geval moet WP12 een expliciete keuze maken: een minimale tabel voor video-records, of een gedocumenteerde uitzondering in de orphan-check.

Daarnaast: bij een orde van 500 MB per bestand moet geverifieerd worden dat Convex-storage die omvang aankan, en via welk uploadpad. De 20 MiB-limiet van httpActions is hier niet van toepassing — `load-files` gebruikt het upload-URL-pad — maar dat er géén andere limiet speelt is nog niet vastgesteld.

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
- De 6 video's als storage-content — zie §Video's.
- `load-files` is hervatbaar. `load-records` niet: dat is een run van minuten, daar volstaat `reset` en opnieuw.
- Afbreken halverwege `load-records`: fail-loud, met een bruikbare foutmelding en de instructie om `reset` te draaien.
- Prod-configuratie wordt gebouwd en reviewbaar opgeleverd, maar in deze WP niet uitgevoerd.

**Bewust niet**
- De prod-run zelf. Die staat in fase 5 op T-0.
- Hervatten na een afgebroken `load-records`. `reset` plus opnieuw duurt minuten; hervatting zou een tweede foutbron zijn.
- API-endpoints voor video. De bestanden gaan mee, de feature niet.
- Vergelijken van dev-data met prod na afloop. Dev is geanonimiseerd en gefilterd; die vergelijking bestaat niet.
- R2-storage. Blijft Convex-storage, conform het plan.
- Terugmigratie naar AWS.

## Risico-assessment

- **security/privacy**: **hoog** — productie-PII van 16 mensen komt op een laptop te staan: namen, emails, foto's, locatiegegevens. Mitigatie: alles onder één gitignored map, anonimisatie in de transform en niet erna, synthetische testfixtures, en een expliciete opruim-instructie in de runbook.
- **ops**: **hoog** — de uploadlijn haalt minder dan 20 Mbit/s, waardoor 8,3 GB niet binnen een cutover-venster past. Het gefaseerde ontwerp (bestanden op T-2, records op T-0) is daarmee geen optimalisatie maar een harde eis, en `load-files` moet hervatbaar zijn. Zie §Gefaseerde prod-run.
- **external deps**: **medium** — nieuwe AWS-SDK-dependencies, plus één onbevestigde Convex-limiet: de maximale bestandsgrootte in storage, bij video's van ordegrootte 500 MB. Zie §Video's.
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

## Nog open

1. **Voor A**: staat er in DynamoDB een verwijzing naar de video's, en zo ja in welk patroon? Bepaalt of ze via het normale pad mee kunnen of dat er een aparte oplossing nodig is. Zie §Video's.
2. **Voor A**: de werkelijke attribuutnamen per entiteit in DynamoDB. De spec gaat uit van de PK/SK-patronen uit het migratieplan, maar niet van de veldnamen daarbinnen.
3. **Voor B, vóór implementatie**: bevestig de maximale bestandsgrootte van Convex-storage.
4. **Voor Wouter, ná `inspect`**: welke 3 users worden de chosen? Kan pas beantwoord worden als het overzicht er is.

---

## Spec-criticus aanvullingen (A vult in)

- Ontbrekende invarianten: ...
- Gemiste edge cases: ...
- Risico-dimensie die regie overschatte/onderschatte: ...
- Open product-vragen voor regie/Wouter: ...

(Leeg in draft. A commit edits hier.)
