# WP12: Data-migratie tooling (DynamoDB + S3 → Convex)

> Draft door regie 2026-08-23. A vult onderaan aan.

## Productdoel

Als beheerder kan ik met één tool de bestaande Clubalmanac-data uit AWS naar Convex overzetten — nu een gefilterde, geanonimiseerde subset naar dev om de clients tegenaan te bouwen, en straks op cutover-dag de volledige set naar prod.

## Terminologie (vast — niet variëren)

| Term | Betekent |
|---|---|
| **extract** | Alles uit DynamoDB halen en lokaal wegschrijven |
| **transform** | DynamoDB-records omzetten naar Convex-vormige records |
| **load** | Die records via de Convex-API wegschrijven, inclusief foto-upload |
| **verify** | Controleren dat de load klopt |
| **reset** | De doel-deployment leegmaken |
| **API-import** | Het gekozen mechanisme: script → Convex-mutations + storage-upload |
| **chosen users** | De 3 users waarop de dev-seed filtert |

"scan" bestaat alleen als naam van de DynamoDB-API-operatie. De woorden "dump", "seed", "push" en "download" worden niet als procesnaam gebruikt.

## Gekozen mechanisme + waarom niet anders

**API-import.** Het script roept internal Convex-mutations aan; Convex genereert `_id` en `_storage`-waarden; het script houdt een map `DynamoDB-sleutel → Convex-_id` bij en gebruikt die om foreign keys op te lossen.

Het alternatief — een zelfgebouwde snapshot-zip met `npx convex import` — is getest en afgewezen op 2026-08-23. Convex weigert een zelf-gemunte `_id`:

```
invalid _id 'm1grat10ntest00000000000000000a'
```

Lengte (32) en tekenset klopten, dus het ID-formaat draagt structuur (vermoedelijk tabelnummer plus checksum). Reverse-engineeren is ongedocumenteerd en kan bij elke Convex-update breken — onacceptabel voor een eenmalige productie-cutover. Hetzelfde bezwaar geldt voor `_storage`-ID's.

`npx convex export` blijft wél in gebruik, als backup-mechanisme vóór elke schrijf-actie.

## Invarianten

- **Eén bron.** Brondata komt altijd uit productie-AWS: DynamoDB-tabel `blob-images-photos-prod` en de prod-S3-bucket. Er is geen dev-bron; ook de dev-seed leest productie.
- **Eén tool, twee configuraties.** Dev en prod verschillen alleen in config (filter, anonimisatie, ID-map, doel-deployment), niet in code-pad. Een verschil dat niet in config uit te drukken is, is een ontwerpfout.
- **AWS wordt nooit geschreven.** Alle AWS-toegang is read-only. Het script heeft geen enkele write-operatie richting DynamoDB of S3.
- **Werkdata verlaat de repo niet.** Alles wat het script wegschrijft landt onder `scripts/.data/`, dat in `.gitignore` staat. Het script weigert te schrijven naar een pad buiten die map.
- **Testfixtures zijn synthetisch.** Geen enkel testbestand in de repo bevat echte namen, emails, Cognito-subs of foto's.
- **Anonimisatie zit in de transform.** Bij dev-config verlaten echte namen en emails de transform-stap niet. Geen opruimactie achteraf.
- **Herhaalbaar.** `reset` gevolgd door `load` levert dezelfde eindtoestand. Twee keer `load` zonder `reset` is geen ondersteund scenario en moet fail-loud stoppen, niet stilletjes verdubbelen.
- **Foreign keys kloppen.** Na `load` verwijst elke `v.id(...)`-waarde naar een bestaand document, en elke `storageId` naar een bestaand bestand.
- **Aggregates kloppen bij oplevering.** `users.photoCount`, `photos.ratingAverage`, `photos.ratingCount` en `features.upvoteCount` worden in de transform berekend uit de brondata, niet opgebouwd door mutations.
- **Auth-koppeling klopt.** Elke `users.subject` is een echte Clerk-ID in de Clerk-instance die bij de doel-deployment hoort. Dev-Convex ↔ dev-Clerk, prod ↔ prod.

## De commando's

| # | Commando | Leest | Schrijft | Duur (prod) |
|---|---|---|---|---|
| 1 | `extract` | DynamoDB prod | `.data/dynamo-extract.json` | minuten |
| 2 | `inspect` | `.data/dynamo-extract.json` | overzicht in terminal: per user het aantal groepen, admin ja/nee, aantal foto's, aantal ratings | seconden |
| 3 | `transform` | `.data/dynamo-extract.json` + config | `.data/convex-records.json` — Convex-vormige records met hun DynamoDB-sleutel als tijdelijke verwijzing | seconden |
| 4 | `load` | `.data/convex-records.json` + S3 | de Convex-deployment | uren |
| 5 | `verify` | `.data/convex-records.json` + de deployment | rapport in terminal | minuten |
| 6 | `reset` | — | leegt alle tabellen + storage in de deployment | minuten |

`extract` is traag en de uitkomst is herbruikbaar; bij het itereren op `transform` mag DynamoDB niet opnieuw geraakt worden. Daarom zes losse commando's en geen enkele knop.

`inspect` bestaat om de 3 chosen users op feiten te kiezen in plaats van uit het geheugen. De uitkomst gaat handmatig in de dev-config.

### Volgorde binnen `load`

De volgorde volgt de afhankelijkheden. Elke stap vult de ID-map die de volgende nodig heeft.

| # | Wat | Hangt af van |
|---|---|---|
| 1 | `users` | Clerk-ID-map uit config |
| 2 | `groups`, `memberships` | 1 |
| 3 | `albums` | 2 |
| 4 | Foto's uit S3 naar Convex-storage uploaden | — |
| 5 | `photos` | 1, 4 |
| 6 | `albumPhotos`, `ratings`, `invites`, `features`, `featureUpvotes` | 3, 5 |
| 7 | `albumLastSeen` | 3, 5 |
| 8 | `coverPhotoId` invullen op `groups` en `albums` | 5 |

Stap 8 is een aparte pass omdat groups en albums vooruit verwijzen naar photos, terwijl photos via `ownerId` terugverwijst naar users. Die cirkel is niet in één pass te schrijven.

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

## Migratiecode in `convex/`

`load`, `verify` en `reset` hebben internal mutations nodig die de normale auth-checks omzeilen. Afspraken:

- Alles in één bestand: `convex/migration.ts`. Niets verspreid over bestaande bestanden.
- Alleen `internalMutation` / `internalAction` — niet aanroepbaar zonder deploy key.
- Weghalen na T+30, samen met de andere cutover-opruiming. Opnemen in het fase 5-stappenplan.

Bewust geaccepteerd door Wouter op 2026-08-23, met die einddatum als voorwaarde.

## Edge cases + scope-uitsluitingen

**In scope**
- Alle tien de tabellen uit `schema.ts` die brondata hebben, plus `albumLastSeen` als afgeleide.
- Profielfoto's (`users.profilePhotoStorageId`), niet alleen album-foto's.
- Afbreken halverwege `load`: fail-loud, met een bruikbare foutmelding en de instructie om `reset` te draaien.
- Prod-configuratie wordt gebouwd en reviewbaar opgeleverd, maar in deze WP niet uitgevoerd.

**Bewust niet**
- De prod-run zelf. Die staat in fase 5 op T-0.
- Hervatten na een afgebroken `load`. `reset` plus opnieuw is bij deze omvang goed genoeg; hervatting is een tweede foutbron.
- Vergelijken van dev-data met prod na afloop. Dev is geanonimiseerd en gefilterd; die vergelijking bestaat niet.
- R2-storage. Blijft Convex-storage, conform het plan.
- Terugmigratie naar AWS.

## Risico-assessment

- **security/privacy**: **hoog** — productie-PII van 16 mensen komt op een laptop te staan: namen, emails, foto's, locatiegegevens. Mitigatie: alles onder één gitignored map, anonimisatie in de transform en niet erna, synthetische testfixtures, en een expliciete opruim-instructie in de runbook.
- **ops**: **medium** — een `load` van uren tegen prod op cutover-dag. Foto's zijn onveranderlijk, dus de S3-ophaalstap kan vooraf. Dat moet het ontwerp toelaten.
- **external deps**: **medium** — nieuwe AWS-SDK-dependencies, plus onbekende Convex-limieten. Twee openstaande vragen: de maximale bestandsgrootte in Convex-storage (er zijn 6 video's van ordegrootte 500 MB) en of het huidige schema video's überhaupt aankan; `photos` heeft alleen `mimeType`.
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
- **Integration-test** die een kleine synthetische set door `load` en `verify` haalt tegen de dev-deployment, achter dezelfde env-var-gate als de bestaande integration-tests.
- **Empirische check**: de dev-seed is gedraaid, `verify` is groen, en `internal.monitoring.integrityCheck` meldt geen drift.
- **Runbook** in `docs/runbooks/` die beide runs beschrijft, inclusief de opruimstap voor `scripts/.data/`.

## Open vragen voor Wouter / A

1. Bestaat er een dev- of staging-DynamoDB-tabel en S3-bucket in AWS, of is productie echt de enige bron? (regie gaat uit van: alleen productie)
2. Zitten de 6 video's als `PO`-records in dezelfde tabel? Moeten ze mee naar Convex, en past dat binnen de storage-limieten? Zo niet: hoe wel?
3. Welke 3 users worden de chosen? Te beantwoorden ná `inspect`, niet ervoor.
4. Hoe snel is de upload vanaf de plek waar de prod-run draait? Bepaalt of stap 4 van `load` vooraf moet.

---

## Spec-criticus aanvullingen (A vult in)

- Ontbrekende invarianten: ...
- Gemiste edge cases: ...
- Risico-dimensie die regie overschatte/onderschatte: ...
- Open product-vragen voor regie/Wouter: ...

(Leeg in draft. A commit edits hier.)
