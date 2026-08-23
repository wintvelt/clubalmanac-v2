# WP12: Data-migratie tooling (DynamoDB + S3 → Convex)

## Productdoel

Tool om bestaande Clubalmanac-data uit AWS naar Convex over te zetten — nu een gefilterde, geanonimiseerde subset naar dev om de clients tegenaan te bouwen, en straks op cutover-dag de volledige set naar prod.

## Terminologie (vast — niet variëren)

| Term | Betekent |
|---|---|
| **extract** | Alles uit DynamoDB halen en lokaal wegschrijven |
| **transform** | DynamoDB-records omzetten naar Convex-vormige records |
| **load-files** | Bestanden uit S3 naar Convex-storage uploaden |
| **load-records** | De records via de Convex-API wegschrijven |
| **verify** | Controleren dat de load klopt |
| **prune-storage** | Storage-objecten wissen die niemand meer nodig heeft |
| **reset** | De doel-deployment leegmaken |
| **API-import** | Het mechanisme: script → Convex-mutations + storage-upload |
| **chosen users** | De 3 users waarop de dev-seed filtert |

"scan" bestaat alleen als naam van de DynamoDB-API-operatie.

## Mechanisme

**API-import.** Het script roept internal Convex-mutations aan; Convex genereert `_id` en `_storage`-waarden; het script houdt een map `DynamoDB-sleutel → Convex-_id` bij en gebruikt die om foreign keys op te lossen.

Een zelfgebouwde snapshot-zip met `npx convex import` is getest en afgewezen: Convex weigert een zelf-gemunte `_id`, en het formaat reverse-engineeren is ongedocumenteerd. `npx convex export` blijft wél in gebruik, als backup vóór elke schrijf-actie.

## Omgeving en omvang

Bron: DynamoDB-tabel `blob-images-photos-prod` en bucket `blob-images`, **eu-central-1**. Doel: Convex, eu-west-1. Er bestaat een dev-omgeving in AWS, maar die wordt genegeerd — alleen productie bevat een representatieve dataset.

Gemeten 2026-08-23: 20 users, 6 groepen, 17 albums, ~1544 foto's, 1524 album-koppelingen, 3 openstaande invites, 12 likes. Bucket: 1601 objecten, 5,6 GB.

## Bronwerkelijkheid

De brondata heeft niet dezelfde vorm en betekenis als het Convex-schema.

| Convex-tabel | Bron | Bijzonderheid |
|---|---|---|
| `users` | `UBbase` (naam, email, profielfoto), `UPstats` (photoCount), `UVvisit` (bezoekdata, cognitoId), `USER` | Eén user = vier records. `USER` is een afgeleide kopie, dus géén bron. |
| `groups` | `GBbase / {groupId}` | |
| `memberships` | `UM{userId} / {groupId}` **zonder** `status: 'invite'` | |
| `invites` | `UM{inviteeId} / {groupId}` **mét** `status: 'invite'` | `inviteeId` is `U{sub}` óf een **emailadres**. Zelfde recordtype als membership. |
| `albums` | `GA{groupId} / {albumId}` | |
| `albumPhotos` | `GP{groupId}#{albumId} / {photoId}` | |
| `photos` | `PO{photoId} / U{ownerSub}` | |
| `ratings` | `UF{photoId} / U{userSub}` | Alleen `rating === 1` wordt een rij — het is een like, geen 1..5-score |
| `features` | `NFfeature / {featureId}` | Alleen `type: 'feature'`; problem-reports gingen per mail en hebben geen bronrij |
| `featureUpvotes` | — | geen bron |
| `albumLastSeen` | `seenPics` op `UM`-records | zie hieronder |

### Datums zijn kalenderdagen

`blob-common/core/date.js` levert `YYYY-MM-DD`. Elk `createdAt`, `exifDate`, `flaggedDate`, `flaggedDeleteDate`, `flaggedAppealDate` en `visitDateLast` is dag-granulair; het schema verwacht epoch-ms.

Conversie: `YYYY-MM-DD` → epoch-ms op **UTC-middernacht**. Geen spreiding binnen de dag om ties te breken — dat verzint data die niet bestaat. Sorteervolgorde binnen een dag is niet reconstrueerbaar.

Acceptatie-eis: een datum die in de oude app als 14 juli werd getoond, wordt na migratie ook als 14 juli getoond. Niet de exacte ms-waarde.

### `seenPics` is een ongelezen-wachtrij

Bij elke nieuwe albumfoto komt er een entry bij voor alle groepsleden behalve de eigenaar. Entry **zonder** `seenDate` = ongelezen; **mét** `seenDate` = één dag geleden getoond, daarna opgeruimd.

Afleiding per (user, album):

- Ongelezen entries aanwezig → `lastSeenAt` = kleinste `addedAt` binnen die set, **min 1 ms**.
- Wel albumfoto's, geen ongelezen entries → `lastSeenAt` = grootste `addedAt` in dat album.
- Geen albumfoto's → geen record; de fallback in `albums.ts` regelt het.

Entries die wijzen naar een album buiten de groep, een verwijderd album of een verwijderde foto: overslaan en tellen.

**Richtings-invariant:** de afleiding mag fout gaan richting *te veel ongelezen*, nooit richting *ten onrechte gelezen*. Een badge te veel is een schoonheidsfoutje; een foto die de user nooit ziet is verlies. Dit vangt ook de dag-granulariteit op: gelezen en ongelezen op dezelfde dag worden allebei ongelezen.

### Waarden die niet 1:1 matchen

| Bron | Convex |
|---|---|
| `role: 'guest'` | `'member'` — een andere waarde is een harde fout |
| membership zonder `status` of `status: 'active'` | lid |
| `status: 'invite'` | `invites`, géén membership |
| `isFounder: true` | `groups.createdBy` |
| feature `'submitted'` / `'in progress'` / `'completed'` | `'open'` / `'inProgress'` / `'done'` |

`photos.ratingCount` = aantal likes, `ratingAverage` = `1` bij ≥1 like en leeg bij 0. Het feature-veld `comment` (webmaster-notitie) heeft geen Convex-veld en gaat verloren; noemen in het rapport.

### Velden die het schema eist en de bron niet heeft

| Convex-veld | Regel |
|---|---|
| `groups.createdBy` | afleiden uit de founder-membership. Geen founder → **harde fout**, met config-override per groepId. Nooit stilletjes de oudste member. |
| `albums.createdBy` | bestaat niet in de bron; valt terug op de founder van de groep. Gesynthetiseerd, dus als zodanig geteld. |
| `albumPhotos.addedBy` | valt terug op de eigenaar van de foto — beide schrijfpaden stonden alleen je eigen foto toe. |
| `users.subject` | uit de ID-map. Ontbrekende mapping = harde fout, geen placeholder. |
| `users.photoLimit` | `DEFAULT_PHOTO_LIMIT` |
| `users.photoCount` | **hertellen** uit de `PO`-records, niet `UPstats` overnemen — dat veld heeft bekende drift-historie. |
| `photos.mimeType`, `filename`, `width`, `height`, `exifOrientation`, `flagReason` | blijven leeg. De oude app roteerde het bestand zelf, dus de bytes staan goed. |
| `invites.expiresAt` | `createdAt + 30 dagen` |
| `albums.description` | blijft leeg |

### Lege string is een sentinel

`photoUrl: ''`, `photoId: ''` en `flaggedDeleteDate: ''` staan als "leeg" in de tabel. De transform behandelt `''` als **afwezig** — anders landt er een lege string waar Convex een `v.id("_storage")` of `v.number()` verwacht en faalt `load-records` halverwege.

## Besluiten

| Onderwerp | Besluit |
|---|---|
| Feature-stemscores | Gaan verloren: `upvoteCount = 0`, geen `featureUpvotes`-records. Er is geen per-user brondata (de oude teller was anoniem en begon op 10) en WP10 eist gelijkheid. De oude waarde komt in het transform-rapport. |
| Invite-tokens | Vernieuwen. Het oude token is base64 van `{PK, SK}` en draagt een emailadres plus de sleutelvorm. Uitstaande links werken na cutover niet meer. |
| Dev-filter, groep zonder chosen founder | Groep uitsluiten. Geen vierde Clerk-dev-account. |
| Invite naar een groep die niet in de bron bestaat | **Prod**: rij behouden, `groupId` wissen, tellen. **Dev**: overslaan, tellen. |
| Video's | Buiten scope — zie hieronder. |
| Migratiecode in `convex/` | Akkoord, mits weg na T+30. |

## Video's — buiten scope

10 clubfilms (~19 GB, grootste 5,8 GiB) plus 9 cover-PNG's staan in een eigen bucket `blob-videos`, buiten het bereik van de S3-trigger, en hebben dus géén DynamoDB-record. Ze blijven op S3 tot de overstap naar Cloudflare R2. WP12 raakt die bucket niet.

Reden: ze zouden ~80% van de overzettijd opslokken, en het grootste bestand moet in één keer door een upload-URL zonder hervatting — voor een feature die niet bestaat. Opslagkosten waren het bezwaar niet.

Gevolgen elders: fase 4 moet ze in de nieuwe app weer tonen (de verwijzing zit in de oude front-end, niet in DynamoDB), en `blob-videos` mag niet mee in de T+30-opruiming.

## Invarianten

### Bron en werkdata

- **Eén bron.** Altijd productie-AWS; ook de dev-seed leest productie.
- **AWS wordt nooit geschreven.** Alle toegang read-only.
- **Geen enkel commando schrijft naar zowel AWS als Convex in dezelfde stap.** `.data/` is de enige tussenlaag.
- **Werkdata verlaat de repo niet.** Alles onder `scripts/.data/`, gitignored; het script weigert daarbuiten te schrijven.
- **`extract` legt vast wanneer hij gedraaid is**, plus tabelnaam, regio en account, en latere stappen tonen die. Een `transform` op een extract van twee weken oud tegen een verse storage-map is een reële fout in het gefaseerde scenario.
- **Eén tool, twee configuraties.** Dev en prod verschillen alleen in config. Een verschil dat niet in config uit te drukken is, is een ontwerpfout.

### Correctheid van de transform

- **Faalt luid op onoplosbare verplichte FK's**, met de bron-sleutel in de melding. Nooit `undefined` doorlaten, nooit stil overslaan.
- **Optionele verwijzingen die niet resolven worden gewist en geteld — zonder uitzonderingen.** Cover-foto's en `invites.groupId` vallen onder dezelfde regel.
- **Referentiële geslotenheid van de dev-filter.** Na filtering resolvet elke verplichte FK binnen de gefilterde set, of de transform stopt. Waar dat niet kan zonder data te verzinnen, moet de filterregel aangescherpt worden — niet de load.
- **Email-normalisatie.** Elke email die de transform verlaat is `trim().toLowerCase()`. Twee bron-users die daarna botsen = harde fout, geen "laatste wint".
- **Aggregates worden in de transform berekend** uit de brondata: `users.photoCount`, `photos.ratingAverage` en `ratingCount`, `features.upvoteCount`.
- **Auth-koppeling klopt.** Elke `users.subject` is een echte Clerk-ID in de instance die bij de doel-deployment hoort. Dev ↔ dev, prod ↔ prod.

### Anonimisatie (dev)

- **Aantoonbaar volledig.** In de volledige `convex-records.json` van een dev-run — records **én** waarschuwingen — komt geen enkele bron-naam of bron-email voor. Als test over het hele bestand, niet per veld.
- Drie plekken waar dat minder vanzelf gaat: gedenormaliseerde user-kopieën in `UM`, `PO`, `GP` en `NFfeature`; de bron-sleutel van een invite ís een emailadres; en het invite-token draagt diezelfde sleutel base64-gecodeerd, dus de scan decodeert.
- **Uitzondering: S3-sleutels.** `protected/{sub}/...` bevat de Cognito-sub, is nodig om het bestand op te halen en verdwijnt bij `load-files`. De prijs is dat de sub tijdelijk in `.data/` staat — afgedekt door de gitignore-invariant en de opruimstap.

### Bestanden en records

- **`load-files` is record-gedreven, nooit bucket-gedreven.** De set is exact `storageKey` ∪ `profilePhotoStorageKey` uit de getransformeerde records. Een bucket-listing zou wezen, `iscopy`-objecten en mail-assets meenemen en vanaf dag één WP10-drift produceren.
- **Bestanden worden nooit twee keer geüpload.** `storage-map.json` houdt S3-sleutel → `_storage`-id bij; opnieuw draaien hervat waar het gebleven was.
- **Twee bestanden met dezelfde S3-sleutel worden één storage-object.** De standaard-profielfoto's zijn gedeeld; de relatie record ↔ object is niet 1:1 en `verify` mag daar niet van uitgaan.
- **Een ontbrekend bestand is nooit een stille aftrekpost.** `load-records` begint niet aan zijn eerste schrijf zolang niet vaststaat dat elke storage-sleutel waar een record naar verwijst een bestand in de map heeft. "Nul bestanden bekend, dus nul foto's te laden" is nooit een geldige conclusie.
- **`load-files` mag een ontbrekende map wél als eerste run lezen, `load-records` niet.** Het verschil zit in de stap, niet in het bestand.
- **De gate hangt niet af van een artefact dat pas aan het eind van de vorige stap geschreven wordt.** Een halverwege afgebroken `load-files` is juist het scenario waarin hij moet werken.
- **De accept-vlag is een bevestiging van verlies, geen draai-voorwaarde.** Het verlies wordt geteld, benoemd met bron-sleutel, en komt terug in `verify`.
- **Aflezing aan de resultaatkant.** Na een geslaagde `load-records` heeft élke user die in de records een profielfoto-sleutel droeg ook een profielfoto in de deployment. Zonder die controle is verlies alleen aan de gate af te lezen en niet aan het resultaat — en een gate is nu net het ding waarvan we niet meer aannemen dat hij dekt wat hij zegt te dekken.

### Controle

- **Een controle leidt zijn verwachting niet af uit de gecontroleerde stap.** De verwachting van `verify` komt uit `meta.counts` in `convex-records.json` — de eerdere, onafhankelijke laag.
- **Elk verschil is een bevinding**, ook als het verklaarbaar is door overgeslagen bestanden. Verklaarbaar is niet goedgekeurd.
- **`verify` reconcilieert twee kanten op**: elke `storageId` in een record bestaat, én elk object in `_storage` hangt aan minstens één record.
- **`verify` noemt élk object dat weg zou gaan**, niet een greep eruit. Een sample van tien alarmeert wel en is te weinig om op te beslissen.
- **Een advies volgt alleen uit een controle die klopt.** `verify` raadt een opruiming alleen aan wanneer de rij-aantallen kloppen; anders is de bevinding "elk bestand is nog nodig, draai eerst `load-records`".
- **De verwachting van een test is met de hand opgeschreven.** De fixture kent de set bestanden uit zichzelf en leidt hem niet af uit de productiefunctie. Geldt voor alles wat het harnas als "wereld" neerzet.
- **De migratie-tabellenset is dezelfde set die WP10 bewaakt.** Elke tabel waarop `integrityCheck` een controle doet valt onder de leeg-preconditie van `load-records`, onder `reset` en onder wat `verify` telt. Een tabel die in de scan bijkomt hoeft nergens bijgeschreven te worden; gebeurt dat toch met de hand, dan valt er een test om.
- De handmatige FK-oracle in de tests blijft handmatig: `transform.ts` gebruikt `FKS` zelf voor zijn slotcontrole, dus importeren zou de transform met eigen materiaal controleren. De lijsten mogen niet stil uit elkaar lopen; elke afwijking valt op een test.

### Opruimen en herstellen

- **Herhaalbaar.** `reset` gevolgd door `load-records` levert dezelfde eindtoestand. Twee keer `load-records` zonder `reset` stopt fail-loud.
- **`reset --all` maakt `storage-map.json` in dezelfde beweging ongeldig.** Blijft hij staan, dan verwijst `load-records` naar storage-ID's die niet bestaan — een stille corruptie-route.
- **`prune-storage` wist nooit alles.** Alles wissen is `reset --all`: ander commando, andere bedoeling, andere bevestiging.
- **De vloer hangt niet van de tellingen af.** Drie toestanden waarin `prune-storage` weigert: (1) hij zou elk object wissen dat er staat; (2) geen enkel record verwijst naar storage terwijl de map niet leeg is; (3) `meta.counts` is in totaal nul. Reden: de route ernaartoe loopt door de tool zelf — een `extract` tegen de verkeerde tabel levert nul items, en op nul items slagen `transform`, `load-records` én `verify` allemaal omdat de tellingen dan met elkaar kloppen. Alles wat "beide kanten vergelijkt" is in die toestand groen.
- **De huidige `convex-records.json` blijft na een opruiming laadbaar.** Elk bestand waar dat bestand naar verwijst overleeft, óók als geen geladen record er nog aan hangt — `reset` plus `load-records` moet erna nog kunnen slagen zonder de accept-vlag. Aflezing: de rotatie uit WP8 schrijft een nieuw object en laat het oude achter, dus een object kan aan geen record meer hangen terwijl de rij-aantallen ongewijzigd zijn.
- **Drie mechanismen, apart benoemd**: de toestandscontrole (beschrijft `convex-records.json` de deployment die er nu staat?), de vloer, en de per-object-bescherming. Spec, code en runbook noemen ze apart, want het zijn er drie.
- **Een weigering zegt wélk mechanisme weigerde**, en de drie vloertoestanden zeggen wélke van de drie. "Er wordt niets gewist" is voor de operator dezelfde uitkomst, maar niet dezelfde diagnose: de ene toestand vraagt om een nieuwe `extract`, de andere om een nieuwe `transform`, de derde om helemaal niet opruimen. Aan de uitkomst alleen is bovendien niet af te lezen welke bescherming nog stáát — de drie vangen elkaars toestanden grotendeels af, dus valt er één stil weg, dan blijft de uitslag gelijk.
- **De opruiming werkt de volledige lijst af, geen greep.** Wat `verify` in zijn geheel opsomt, wist `prune-storage` in zijn geheel. Een afgeknotte lijst wist stil een prefix, laat de rest als wees achter — en zet de vloer buiten werking, want "alle objecten zouden weggaan" gaat dan per definitie niet meer op.
- **Wat gespaard wordt, wordt geteld en gemeld.** Een bescherming die nooit iets meldt is niet te onderscheiden van een die er niet is.
- **Na afloop klopt de storage-map met de werkelijkheid.** Geen entry wijst naar een gewist object.
- **`prune-storage` weigert zonder expliciete bevestiging en zonder `convex-records.json`.** Zonder dat bestand is elke opruiming een gok.
- **Een weigering exit niet als succes.** Elke tak waarin een commando weigert eindigt niet-nul. "Niets te doen" is wél succes.
- **Verkeerde deployment.** Tweede laag die weigert naar prod te schrijven tenzij expliciet aangezet, hetzelfde patroon als `tests/integration/_helpers/safety.ts`.

### Testbaarheid

- **Geen enkele test raakt `scripts/.data/`.** Daar staat productie-PII. De bestandslaag en de Convex-verbinding zijn vervangbaar, en dat is een eis aan de tooling.
- **De laadstappen zijn zonder deployment te controleren**: wat `load-records` verstuurt, wat `reset` leegmaakt, waar `verify` op afgaat.
- **Testfixtures zijn synthetisch.** Geen echte namen, emails, subs of foto's in de repo.
- **Elke test leest alleen zijn eigen terminal-output.** De console-spionage wordt per test opgezet en hersteld; een bewakingstest ná de luidruchtigste test valt om zodra die afbakening verdwijnt.
- **Elke bescherming is apart aantoonbaar.** Zet er één uit en er valt een test om — en wel een test die op díe bescherming afgaat, niet op de toestand die zijn buurman toevallig ook afvangt. Waar drie mechanismen dezelfde uitkomst opleveren, moet de test de toestand zo kiezen dat de andere twee niet kunnen vuren, en aflezen wélk mechanisme sprak. Anders meet de suite dat er íets weigerde, en overleeft het weghalen van een bescherming de hele suite.
- **Een dekkingsgat is een bevinding, ook zonder gedragsfout.** Vier keer op rij was in dit werkpakket de code goed en hield niets hem vast; geen ervan was uit lezen alleen zichtbaar. De aanvulling is dus test-werk, geen implementatie-werk — maar wel werk.

## De commando's

| # | Commando | Leest | Schrijft |
|---|---|---|---|
| 1 | `extract` | DynamoDB prod | `.data/dynamo-extract.json` |
| 2 | `inspect` | het extract | overzicht per user: groepen, admin, foto's, likes |
| 3 | `transform` | extract + config | `.data/convex-records.json` |
| 4 | `load-files` | records + S3 | Convex-storage, plus `.data/storage-map.json` |
| 5 | `load-records` | records + storage-map | de Convex-tabellen |
| 6 | `verify` | beide `.data`-bestanden + de deployment | rapport |
| 7 | `prune-storage` | idem | wist storage-objecten die niemand meer nodig heeft |
| 8 | `reset` | — | leegt de tabellen; met `--all` ook de storage |

Acht losse commando's en geen enkele knop: `extract` en `load-files` zijn traag en hun uitkomst is herbruikbaar. `reset` leegt standaard alleen de tabellen, zodat een reset vóór T-0 de al geüploade bestanden niet weggooit. `inspect` bestaat om de chosen users op feiten te kiezen.

### Volgorde binnen `load-records`

| # | Wat | Hangt af van |
|---|---|---|
| 1 | `users` | Clerk-ID-map, storage-map voor profielfoto's |
| 2 | `groups`, `memberships` | 1 |
| 3 | `albums` | 2 |
| 4 | `photos` | 1, storage-map |
| 5 | `albumPhotos`, `ratings`, `invites`, `features`, `featureUpvotes` | 3, 4 |
| 6 | `albumLastSeen` | 3, 4 |
| 7 | `coverPhotoId` op `groups` en `albums` | 4 |

Stap 7 is apart omdat groups en albums vooruit verwijzen naar photos, terwijl photos via `ownerId` terugverwijst naar users.

### Configuratie per doel

| | dev | prod |
|---|---|---|
| Filter | 3 chosen users | geen |
| Anonimisatie | namen → dev-namen, emails → `dev-{n}@clubalmanac.test` | uit |
| User-ID-map | 3 Cognito-subs → handmatig aangemaakte Clerk-dev-ID's | email → Clerk-prod-ID (pre-created op T-2 weken) |
| Omvang storage | enkele honderden MB | 5,6 GB |

Filterregels per entiteit staan in [`migratie-plan-convex.md` §Dev seed strategie](../migratie-plan-convex.md#dev-seed-strategie). Voor invites geldt de geratificeerde lezing: de **uitnodiger** moet chosen zijn (de enige verplichte FK), de **groep** moet in de dev-set zitten, en is de **genodigde** een bestaande user dan moet die chosen zijn. Een invite aan een adres zonder account is het normale geval en blijft staan.

## Transform-outputcontract

De vorm van `.data/convex-records.json` ligt vast — `load-files`, `load-records` en `verify` leunen er alle drie op:

- Per Convex-tabel een lijst rijen met de Convex-veldnamen.
- Elke rij draagt een `sourceKey`: de natuurlijke bron-ID.
- Foreign-key-velden bevatten de `sourceKey` van het doel, niet een Convex-`_id`. `load-records` vervangt ze.
- Storage-verwijzingen zijn **S3-sleutels** in een apart veld (`storageKey`, `profilePhotoStorageKey`), niet `storageId`.
- Naast de records een lijst waarschuwingen: overgeslagen records, gewiste optionele FK's, gesynthetiseerde velden, verloren data. Die lijst voedt het `verify`-rapport en de opruim-verantwoording.

## Gefaseerde prod-run

De uploadlijn haalt minder dan 20 Mbit/s. 5,6 GB over 1601 objecten past niet in een cutover-venster. Bestanden zijn onveranderlijk, dus de run wordt gesplitst.

| Wanneer | Commando | Wat er gebeurt |
|---|---|---|
| T-2 weken | `extract` + `transform` + `load-files` | Alle bestanden naar prod-storage, `storage-map.json` gevuld. Nog geen enkel record. |
| T-0 | `extract` + `transform` | Verse stand, inclusief alles wat sinds T-2 bijkwam |
| T-0 | `load-files` | Alleen de nieuwe bestanden |
| T-0 | `load-records` + `verify` | De hele database in één keer |
| T-0 | `prune-storage` | Bestanden waarvan de foto sinds T-2 verwijderd is |

Gevolg voor de planning: de Convex-prod-deployment moet op T-2 weken al bestaan, en WP10's cron moet daar uit staan tot na een groene `verify` — anders meldt hij twee weken lang 1600+ storage-orphans.

## Migratiecode in `convex/`

Alles in `convex/migration.ts`, alleen `internalMutation` / `internalQuery` — niet aanroepbaar zonder deploy key. **Weghalen na T+30**, samen met `scripts/migrate/` en de AWS-credentials. Staat in het fase 5-stappenplan.

## Edge cases

- **Invite met een emailadres als sleutel.** PK bevat een `@`. Een invite hoort niet bij een user; het adres komt uit `PK.slice(2)` óf `user.email`, waarbij `user.email` leidend is als ze verschillen.
- **Invite-status.** Geaccepteerde en geweigerde invites bestaan niet meer als record. Alleen `pending` en `expired` zijn te migreren; `respondedAt` en `bouncedAt` blijven leeg. Verlopen invites van jaren geleden staan nog in de tabel — als membership meetellen zou een extra "lid" opleveren.
- **Standaard-profielfoto's ("knorren").** `public/img/knorren/knor{0..22}.jpg` zijn gedeelde bestanden buiten `protected/`, zonder `PO`-record. Het pad naar `users.profilePhotoStorageId` loopt dus niet altijd via een `photos`-record, en ontbreken ze in de bucket dan landt de user zonder profielfoto — geen crash.
- **De S3-sleutel is geen eigenaars-aanwijzing.** Eigendom komt uit `PO.SK`, nooit uit het pad; er bestaan twee padvormen.
- **URL-encoding in S3-sleutels.** Bestandsnamen met spaties of diakritieken kunnen anders in `photo.url` staan dan in de bucket. Een 404 op een bestaand record is een **fout**, geen "overslaan".
- **`photos` zonder S3-object.** Rapporteren en overslaan, met het aantal in `verify` — één ontbrekend bestand mag een cutover van 1544 foto's niet blokkeren, maar het moet zichtbaar zijn.
- **Dezelfde foto in meerdere albums.** De ID-map moet 1:N aankunnen; `load-files` uploadt zo'n foto één keer.
- **`albumPhotos.groupId`** zit in de `GP`-PK en moet consistent zijn met `albums.groupId`. Inconsistentie is een bronfout die zichtbaar moet worden.
- **De ID-map is niet één map maar acht.** Gescheiden sleutelruimtes per entiteit; een gedeelde platte map waarin een photoId als groupId resolvet is een klasse fouten die dan niet bestaat.
- **`load-records` op een niet-lege deployment.** Preconditie "alle doeltabellen leeg", vóór de eerste schrijf gecontroleerd.

### Bewust niet

- De prod-run zelf — die staat in fase 5 op T-0.
- Hervatten na een afgebroken `load-records`. `reset` plus opnieuw duurt minuten; `load-files` is wél hervatbaar.
- De video's en hun covers.
- Dev-data met prod vergelijken — dev is geanonimiseerd en gefilterd.
- R2-storage, en terugmigratie naar AWS.

## Risico-assessment

- **security/privacy: hoog.** Productie-PII van 20 mensen op een laptop: namen, emails, foto's, locatiegegevens, Cognito-subs, gedenormaliseerde user-kopieën en de volledige inhoud van invite-berichten. Mitigatie: één gitignored map, anonimisatie in de transform, synthetische fixtures, verplichte opruimstap.
- **ops: hoog.** De uploadlijn maakt het gefaseerde ontwerp een harde eis, en `load-files` moet hervatbaar zijn.
- **data/schema-evolutie: hoog.** Niet omdat dit de cutover-batch is, maar omdat de brondata semantisch afwijkt van het doelschema op zes punten — waarvan er één in het migratieplan zélf verkeerd stond. Wat hier misgaat is geen foutmelding maar data die er correct uitziet en het niet is. Vandaar unit-tests met een synthetische fixture waarin de semantiek expliciet gepind is. Pre-flight per [`data-migration-preflight.md`](../conventions/data-migration-preflight.md) is verplicht vóór de eerste echte `load-records`.
- **external deps: medium.** AWS-SDK-dependencies. De storage-groottelimiet is geen risico meer nu de video's buiten scope zijn.
- **multi-user/concurrency: laag.** Eén operator.
- **ops-runbook-impact:** AWS-credentials read-only en alleen lokaal, nooit als Convex-env-var. Runbook: [`wp12-data-migratie.md`](../runbooks/wp12-data-migratie.md).

## Acceptance

- **Unit-tests** op `transform` met een synthetische fixture: filterregels, anonimisatie, aggregates, de `seenPics`-afleiding en de randgevallen.
- **Unit-tests** op de ID-map: FK's worden correct omgeschreven, een verwijzing naar een weggefilterd record faalt hard.
- **Integration-test** door `load-files`, `load-records` en `verify` tegen dev, inclusief een tweede `load-files`-run die overslaan aantoont. **Uitgesteld**, precedent WP5/WP6/WP11 — wordt bij de dev-seed-run empirisch afgedekt.
- **Empirische check**: dev-seed gedraaid, `verify` groen, `integrityCheck` meldt geen drift.
- **Meting**: `load-files` rapporteert doorvoer in MB/s, zodat de prod-run op T-2 te voorspellen is.
- **Runbook** die beide runs beschrijft, inclusief de opruimstap voor `scripts/.data/`.

## Nog open

1. **Voor Wouter, ná `inspect`**: welke 3 users worden de chosen? Voorstel op basis van de meting: Wouter (enige met meerdere groepen, alle founder-rollen, alle invites) plus de twee met de meeste content.
2. **Pre-flight §0** uitvoeren vóór de eerste echte `load-records`: git tag, `convex export` als anker, count-baseline ná `transform`, go/no-go-notitie.

## Backlog

Bewust doorgeschoven, geen cutover-blocker:

- `verify` leidt zijn tabellenset af uit het antwoord van de deployment die hij controleert. De oracle-test dekt hem vandaag; `MONITORED_TABLES` direct importeren sluit de vorm.
- `recomputeAggregates` draait onvoorwaardelijk, waardoor de transform-aggregates nooit landen. Botst met de invariant dat ze in de transform berekend worden en maakt een transform-fout end-to-end onzichtbaar.
- `deleteStorageObjects` laat bij een halverwege afgebroken opruiming een storage-map achter met entry's naar gewiste objecten. De volgende `load-records` weigert dan luid op zijn dekkingsgate.
- De anonimisatie-scrub op waarschuwingen is email-only; namen zouden een nieuw meldkanaal kunnen lekken.
- `missing-files.json` veroudert stil — het duidt alleen, het is nooit een gate.
- De prod-gate op `prune-storage` en `reset` is ongetest; hoort bij de empirische afdekking van de eerste prod-run.
- Het schema-commentaar bij `ratings.value` ("bv. 1..5") past niet bij de werkelijke feature (like, 0/1).
- Het invite-token is `mig{FNV-1a(email#oude-groupId)}` — een publiek herrekenbare functie van PII, terwijl `invites.getByToken` een publieke, niet-geauthenticeerde query is die email en groep teruggeeft. Niet exploiteerbaar zonder de oude groupId (die staat nergens in de nieuwe app) en `accept` bindt bovendien op email. Een random token past beter bij het besluit "tokens vernieuwen".
- Een photo-rij zonder `storageKey` glipt langs de dekkingsgate en wordt daarna wél gedropt, met een waarschuwing die naar een niet-gezette vlag verwijst. Kan vandaag niet ontstaan — de transform slaat zo'n foto al over.
- `FULL_LIST` staat twee keer, in `verify.ts` en `pruneStorage.ts`.
- `restoreMocks: true` in `vitest.config.ts` zou de console-afbakening volgorde-onafhankelijk en repo-breed maken, in plaats van per testbestand.

## Cross-refs

- migratie-plan: §Database single-table DynamoDB, §File storage, §Environments, §Dev seed strategie, §Unread-count
- migratie-status: fase 3; fase 5 T-2 en T-0
- cascade-matrix: AP1/AP2 voor de `seenPics`-afleiding
- `internal.monitoring.integrityCheck` (WP10) wordt hergebruikt door `verify`
- oude AWS-code (alleen A leest): `blob-images-api*`
- Historie van vier audit-rondes en drie fix-cycli: git-log; samenvatting bij closeout in [`audit-track-record.md`](../conventions/audit-track-record.md)
