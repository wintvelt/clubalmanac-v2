# WP12 — data-migratie runbook (DynamoDB + S3 → Convex)

Operationeel draaiboek voor de migratie-tooling uit [`WP12`](../work-packages/WP12-data-migratie-tooling.md). Twee runs met dezelfde tool en verschillende config: de **dev-seed** (nu, gefilterd + geanonimiseerd) en de **prod-run** (fase 5, gefaseerd over T-2 weken en T-0).

```
npm run migrate -- <commando> --target dev|prod [opties]
# of: node scripts/migrate/cli.ts <commando> --target dev
```

| # | Commando | Leest | Schrijft |
|---|---|---|---|
| 1 | `extract` | DynamoDB (read-only) | `scripts/.data/dynamo-extract.json` |
| 2 | `inspect` | het extract | overzicht in de terminal |
| 3 | `transform` | extract + config | `scripts/.data/convex-records.json` |
| 4 | `load-files` | records + S3 (read-only) | Convex-storage + `scripts/.data/storage-map.json` |
| 5 | `load-records` | records + storage-map | de Convex-tabellen |
| 6 | `formaten` (WP25) | foto-rijen + originelen | per foto *klein* en *groot* in storage, plus `exifOrientation` als die leeg is |
| 7 | `verify` | beide bestanden + de deployment | rapport in de terminal |
| 8 | `prune-storage` | records + storage-map + de deployment | wist exact de storage-objecten waar niets meer naar verwijst |
| 9 | `reset` | — | leegt de tabellen (en de formaten van de gewiste foto's); met `--all` ook de storage |

## Pre-flight

### §0 — meten vóór de eerste echte `load-records`

Verplicht per [`data-migration-preflight.md`](../conventions/data-migration-preflight.md), per doel-deployment één keer, en **niet** te vervangen door de export-ankers verderop in dit runbook: die dekken de runs, de §0 dekt de voorfase. Alleen meten, niets wijzigen.

- [ ] Git tag op de commit waarmee je draait: `git tag pre-wp12-<dev|prod> && git push origin pre-wp12-<dev|prod>`.
- [ ] `npx convex export [--prod] --path ./backups/pre-wp12-<dev|prod>.zip`, plus een tweede kopie via het dashboard (Settings → Snapshot export). Twee onafhankelijke fallbacks.
- [ ] Count-baseline van de doel-deployment: draai ná `transform` en vóór `load-files`/`load-records` één keer `npm run migrate -- verify --target <dev|prod>`. Dat commando is read-only en drukt per tabel af wat er staat (baseline: nul) tegenover wat de transform gaat laden. Noteer beide kolommen.

  Deze baseline-run is **per definitie rood**: er staat nog niets, dus elke tabel wijkt af van de transform-telling en er zijn nog geen bestanden geüpload. Dat is de meting, geen probleem. Rood ná `load-records` is dat wél.

  Het is meteen het eerste moment waarop een read-only commando de deployment aanraakt, en dus de verbindingstest: een afgewezen admin-key komt eruit met een expliciete melding (zie §A).
- [ ] Go/no-go-notitie in `docs/migratie-status.md`: counts, datum, en het besluit. Ligt er meer dan een week tussen deze meting en de run, herhaal 'm dan.

### A. `.env.migrate` (gitignored)

```
# Convex-doelen. De admin-key is een deployment-scoped deploy key, gemaakt met
# `npx convex deployment token create <naam> --deployment <dev|prod>`. Zonder
# zo'n key zijn de migratie-functies (internal) niet aanroepbaar — dat is de
# bedoeling. De key moet ook internal actions mogen draaien (`formaten`); een
# oudere dev-key mocht dat niet (2026-11-07). Zie de key-controle bij T-2 weken.
MIGRATE_CONVEX_URL_DEV=https://glorious-pheasant-759.eu-west-1.convex.cloud
MIGRATE_CONVEX_ADMIN_KEY_DEV=dev:glorious-pheasant-759|<key>

MIGRATE_CONVEX_URL_PROD=https://<prod-deployment>.eu-west-1.convex.cloud
MIGRATE_CONVEX_ADMIN_KEY_PROD=prod:<prod-deployment>|<key>

# Alleen zetten voor de prod-run zelf, en daarna weer weghalen.
# MIGRATE_ALLOW_PROD=yes

# AWS-bron. Defaults staan al goed; alleen zetten als er iets afwijkt.
# MIGRATE_AWS_REGION=eu-central-1
# MIGRATE_DYNAMO_TABLE=blob-images-photos-prod
# MIGRATE_S3_BUCKET=blob-images
```

- [ ] AWS-credentials staan in de omgeving (`AWS_PROFILE` of `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`). Gebruik een **read-only** IAM-user of -rol: het script schrijft nooit naar AWS, en die belofte hoort ook in de policy te staan. Deze credentials gaan **nooit** als Convex-env-var; ze staan alleen lokaal.
- [ ] Verbinding testen vóór je iets schrijft: dat gebeurt bij de count-baseline uit §0, dus ná `transform` en vóór `load-files`. Eerder kán `verify` niet slagen — hij leest `convex-records.json` voordat hij de deployment aanraakt en faalt anders op dat bestand. De baseline-run is read-only en meldt een niet-geaccepteerde admin-key expliciet.

### B. Config-bestanden in `scripts/.data/` (gitignored, bevatten PII)

`dev-config.json` — na `inspect` handmatig invullen:

```json
{
  "chosenUserIds": ["U<sub-1>", "U<sub-2>", "U<sub-3>"],
  "subjectByUserId": { "U<sub-1>": "user_...", "U<sub-2>": "user_...", "U<sub-3>": "user_..." },
  "founderOverrides": {}
}
```

`prod-config.json` — na de Clerk-pre-create op T-2 weken:

```json
{ "clerkIdByEmail": { "iemand@voorbeeld.nl": "user_..." }, "founderOverrides": {} }
```

- De Clerk-dev-ID's maak je vooraf handmatig aan in de dev-Clerk-instance; de prod-ID's komen uit de Clerk Invitations API-pre-create (zie fase 5 T-2 in `migratie-status.md`). Dev-Convex hoort bij dev-Clerk, prod bij prod — een subject uit de verkeerde instance logt nooit in.
- `founderOverrides` is de ontsnapping voor een groep zonder `isFounder`-membership. De transform stopt in dat geval met de groep-ID in de melding; zet dan `{"<groupId>": "U<sub>"}`. Niet stilletjes de oudste member pakken.

## Run 1 — dev-seed

Doe eerst §0 hierboven — git tag, export-anker, count-baseline, go/no-go. Die stap is verplicht en niet te vervangen door het anker in dit blok.

```bash
npx convex export --path ./backups/wp12-dev-voor-seed.zip   # anker (pre-flight)
npm run migrate -- extract                     # minuten, leest productie-DynamoDB
npm run migrate -- inspect                     # kies de 3 chosen users op feiten
#   → vul scripts/.data/dev-config.json
npm run migrate -- transform --target dev      # seconden
npm run migrate -- load-files --target dev     # 3,1 GB, ~15 min (gemeten 2026-10-25); hervatbaar
npm run migrate -- load-records --target dev   # minuten
npm run migrate -- formaten --target dev       # WP25; ~45 min voor ~1000 foto's
npm run migrate -- verify --target dev
```

- Ook de dev-seed leest **productie**-AWS. De AWS-dev-omgeving wordt bewust genegeerd: alleen productie is representatief genoeg om de clients tegenaan te bouwen.
- Anonimisatie staat automatisch aan bij `--target dev` en zit ín de transform: echte namen en adressen verlaten die stap niet, ook niet in invite-sleutels of -tokens. Foto's blijven echt (visuele realiteit) — de dev-database dus nooit publiek delen.
- Een groep waarvan de founder niet chosen is, valt volledig af. Blijkt bij `inspect` dat je daarmee een groep kwijtraakt die je wilde testen, kies dan andere users — niet de regel verzachten.
- Opnieuw seeden (bv. na een schema-wijziging): `reset --target dev --yes`, `load-records` en `formaten` opnieuw. De bestanden blijven staan, dus dat duurt minuten. Alleen als je ook de bestanden weg wilt: `reset --target dev --yes --all` — dat maakt `storage-map.json` in dezelfde beweging ongeldig.
- `reset` leegt precies de tabellen die de leeg-preconditie van `load-records` telt — inclusief `uploadIdempotency`, dat de import zelf niet vult maar dat wél onder WP10's FK-controle valt. De dev-deployment heeft er rijen in van de upload-integration-test; bleven die staan, dan wezen hun `ownerId`'s na de seed naar verwijderde users en meldde de dagelijkse scan drift.

## Run 2 — prod (fase 5)

De uploadlijn haalt minder dan 20 Mbit/s. 5,6 GB past daarmee niet in een cutover-venster, dus de run is gesplitst. Fotobestanden zijn onveranderlijk: eenmaal geüpload verandert er niets meer.

De video's blijven buiten deze migratie: ze staan in een eigen bucket (`blob-videos`), hebben geen DynamoDB-record, en gaan pas mee bij de latere R2-overstap (WP12 §Video's — buiten scope). `load-files` is record-gedreven en raakt die bucket dus vanzelf niet aan — er is geen extra stap of uitzondering voor nodig.

### T-2 weken

- [ ] `integrityCheck`-cron op prod uitzetten. Tussen T-2 en T-0 staat er 5,6 GB storage met nul records; de dagelijkse check zou twee weken lang 1600+ storage-orphans melden. Weer aanzetten na een groene `verify` op T-0.
- [ ] Clerk-pre-create is gedaan en `prod-config.json` is gevuld.
- [ ] `npx convex export --prod --path ./backups/wp12-prod-t2.zip` als anker vóór de eerste schrijf-actie, plus een tweede kopie via het dashboard ([`data-migration-preflight.md`](../conventions/data-migration-preflight.md)). `backups/` is gitignored.

```bash
export MIGRATE_ALLOW_PROD=yes
npm run migrate -- extract
npm run migrate -- transform --target prod
npm run migrate -- load-files --target prod    # uren; hervatbaar
```

`load-files` rapporteert de gehaalde doorvoer in MB/s en een schatting voor 5,6 GB. Breekt de run af: gewoon opnieuw starten — wat in `storage-map.json` staat wordt overgeslagen.

- [ ] Key- en bibliotheek-controle voor `formaten` (WP25), na `load-files`. `formaten` is het enige migrate-commando dat een internal action aanroept; een key zonder dat recht breekt op T0 af. Vóór de eerste batch draait hij `selfTest`: sharp en heic-decode op een ingebouwde JPEG en HEIC, zonder te schrijven. Zo test deze run ook de bibliotheek op prod. De controle schrijft niets, mits prod nog geen foto-rij heeft. Eerst tellen (met je eigen Convex-login, los van de key):

  ```bash
  npx convex run photos:formatStatus --prod      # door alleen bij photos: 0
  ```

  Is `photos` niet 0, stop dan: `load-records` is al gedraaid en een `formaten`-run zou schrijven. Bij 0:

  ```bash
  MIGRATE_ALLOW_PROD=yes npm run migrate -- formaten --target prod   # verwacht: "beeldbibliotheek: ok", "klaar", exitcode 0
  ```

  Exitcode 0 betekent dat de key internal actions mag draaien en de bibliotheek werkt. Bij `key mag geen internal actions draaien`: maak een nieuwe prod-key (§A) en herhaal. Bij `geen verbinding met de deployment` of `beeldbibliotheek werkt niet`: zie §Bekende meldingen.
- [ ] HEIC's op prod geteld (WP25 besluit 7): `AWS_PROFILE=clubalmanac node scripts/wp25/prod-tel.mjs`. Leest alleen uit S3. Gedaan 2026-11-07: 0 HEIC's. Zouden er HEIC's boven 13 MP tussen zitten, dan krijgen die op T0 geen formaten (`formaten` meldt ze als mislukt, "te groot"); zie §Formaten, "Blijft een foto mislukken".


### T-0

```bash
export MIGRATE_ALLOW_PROD=yes
npx convex export --prod --path ./backups/wp12-prod-t0.zip  # tweede anker
npm run migrate -- extract                      # verse stand, inclusief alles sinds T-2
npm run migrate -- transform --target prod
npm run migrate -- load-files --target prod     # alleen de delta; de rest staat al in de map
npm run migrate -- load-records --target prod   # minuten
npm run migrate -- formaten --target prod       # WP25; ~70 min (gemeten op dev), hervatbaar
npm run migrate -- verify --target prod
```

- [ ] `formaten` eindigt met exitcode 0: geen foto zonder formaten (behalve afgetekende), niets mislukt. Zie §Formaten (WP25) hieronder.
- [ ] `verify` is groen: rij-aantallen kloppen, geen dangling storage-verwijzingen, geen storage-orphans, integriteitsscan leeg (dus ook geen `formaten ontbreken`).

  `verify` vergelijkt met de tellingen die de **transform** heeft vastgelegd, niet met een herberekening uit de storage-map. Dat betekent dat een run met `--accept-missing-files` per definitie níet groen is: het verlies is verklaarbaar, maar verklaarbaar is niet goedgekeurd. Lees dan de bevinding, controleer dat het verschil exact de geaccepteerde bestanden betreft, en teken er bewust voor af.
- [ ] Storage-orphans opgeruimd, als `verify` ze meldt — zie hieronder.
- [ ] `integrityCheck`-cron op prod weer aan.
- [ ] Pas nu de app open (WP25 besluit 5): na `formaten` en een groene `verify`.
- [ ] `unset MIGRATE_ALLOW_PROD`.

#### Formaten (WP25)

`formaten` maakt van elke foto twee JPEG's (*klein* 512 px, *groot* 1600 px, langste zijde) en zet `exifOrientation` uit het bestand als die nog leeg is. Hij draait na `load-records` (eerder is er geen foto-rij) en vóór `verify` (dan dekt één groene `verify` alles).

- Per batch één regel: gemaakt, al klaar, weg, mislukt (met foto-id's). Aan het eind de totalen en de telling vóór en na. Exitcode 0 alleen als geen foto meer zonder formaten is en niets mislukte.
- Eerst `selfTest` (regel `beeldbibliotheek: ok`); mislukt die, dan stopt hij met exitcode 1, zonder batch. De melding noemt de oorzaak: de key, de verbinding of de bibliotheek (§Bekende meldingen).
- Batch van 20 foto's, één foto tegelijk in een Node-action (512 MB per action). `--batch-size N` (1..50) als een batch te lang duurt; de HTTP-aanroep heeft een time-out van 300 s. Gemeten op dev: zie §Meting hieronder.
- **Valt een batch-action om** (geheugen, time-out): de CLI meldt `action brak af` en doet die batch foto voor foto, elk in een eigen action. Valt ook die om, dan telt die foto als mislukt (`<foto-id>: action brak af`) en gaat de CLI door. Exitcode 1; een nieuwe run eindigt net zo, hij blijft niet hangen.
- **Breekt hij af** (laptop dicht, netwerk weg, timeout): start hetzelfde commando opnieuw. Elke foto die klaar is, heeft zijn formaten en `exifOrientation` in één schrijfactie; een nieuwe run slaat die over. De app werkt halverwege: een foto zonder formaten toont het origineel. Hooguit één foto per afgebroken batch laat twee formaat-objecten zonder foto achter. `verify` noemt ze als storage-orphans, en `prune-storage` wist ze.
- **Mislukt een foto** (het origineel ontbreekt, is geen leesbaar beeld, of is een HEIC boven 13 MP: `te groot`, besluit 7): hij krijgt geen formaten en blijft ongewijzigd. De reden staat in de Convex-log onder `[photoFormats] mislukt photoId=…`. Een nieuwe run probeert hem opnieuw. In de app toont hij het origineel.
- **Blijft een foto mislukken** (op T0 houdt dat de app dicht, besluit 5):
  1. Draai `formaten` nog één keer. Mislukt dezelfde foto weer, lees dan de reden in de Convex-log (`[photoFormats] mislukt photoId=…`, of bij `action brak af` de fout bij die functie).
  2. Ligt het aan de deployment (de bibliotheek, de key, het netwerk), los dat op en draai opnieuw. Teken niet af.
  3. Ligt het aan het bestand (`te groot`, geen leesbaar beeld, de action valt om op deze ene foto), teken hem dan af. Noem elke foto bij zijn id:

     ```bash
     npm run migrate -- formaten --target prod --accept-no-formats <foto-id>,<foto-id>
     ```

     Dezelfde run probeert de foto's nog eens, en tekent na de batches alleen af wat in die run mislukte (of al afgetekend was). Dat legt per foto vast dat hij zonder formaten mag (`noFormatsAcceptedAt`); volgende runs slaan hem over. Exitcode 0 als niets anders mislukte. Een ander id (een typfout, een foto die nu wel lukte) weigert hij met dat id: dan is er niets afgetekend, exitcode 1.
  4. `verify` meldt een afgetekende foto niet meer als `formaten ontbreken`, WP10 ook niet. `formaten` noemt ze bij elke run (`afgetekend zonder formaten`).
  5. Noteer de id's en de reden in het cutover-log. In de app toont zo'n foto het origineel: rechtop, maar traag.

  Terugdraaien: `npm run migrate -- formaten --target prod --unaccept <foto-id>`. Die run probeert de foto meteen weer.
- **Een formaat-veld naar een gewist object** (`formaten dangling`, bv. `prune-storage` terwijl een action nog liep): telt als "geen formaten". De volgende run maakt een nieuwe set en ruimt de rest van de oude op.
- **`prune-storage` na `formaten`** wist geen formaten: `storageInventory` telt ze als verwezen. Verwacht in de lijst van `verify` een handvol objecten, geen ~3200. Staan er duizenden formaat-objecten op de lijst, draai `prune-storage` dan niet en zoek uit waarom.
- **`reset` + `load-records` na `formaten`**: `reset` wist de formaten van de foto's die hij weghaalt (het origineel blijft). Draai daarna `formaten` opnieuw.
- **Terugrollen** naar code zonder formaten: het optionele veld `photos.formats` moet in het schema blijven staan (Convex weigert een schema-push die bestaande rijen afkeurt). De formaten blijven dan ongebruikt staan.

Meting (dev, preview-run 2026-11-07, 1001 foto's, batch 20):

- Run 1: 51 batches in 42,8 min; 44–54 s per batch van 20 (~2,6 s per foto). Piek-RSS 351–358 MB van de 512 MB per action (`[photoFormats] batch … peakRssMB=` in de Convex-log). Gemaakt 1001, mislukt 0; 589 foto's kregen `exifOrientation`.
- Run 2: 51 batches in 0,1 min, gemaakt 0, al klaar 1001.
- Opslag: 1002 → 3004 objecten, +300,5 MB (~300 kB per foto).
- Schatting prod (~1600 foto's): ~70 min.

#### Storage-orphans tussen T-2 en T-0

De bestanden staan sinds T-2 in Convex-storage. Wordt in die twee weken een foto in de oude app verwijderd, dan is het bestand op T-0 geüpload terwijl er geen record meer naar verwijst: een storage-orphan, en precies wat WP10 de ochtend erna zou melden.

```bash
npm run migrate -- verify --target prod          # noemt élk object dat weg zou gaan
npm run migrate -- prune-storage --target prod --yes
npm run migrate -- verify --target prod          # nu groen
```

- `verify` drukt de volledige lijst af, geen greep van tien: je moet vóór het opruimen kunnen zien wat er weggaat. Hij **adviseert** het opruimen alleen als de rij-aantallen kloppen; doen ze dat niet, dan is elk bestand nog nodig en stuurt hij je naar `load-records`. Tussen T-2 en T-0 is "storage-objecten zonder record" de normale toestand en niet iets om op te handelen.
- `prune-storage` wist alleen objecten die aan géén enkel geladen record hangen **én** waar `convex-records.json` niet naar verwijst. Daar staan **drie afzonderlijke mechanismen** omheen — ze doen verschillend werk en zijn eerder ten onrechte als één ding beschreven (WP12 fix-cyclus 3, R3-2):

  | Mechanisme | Vraag | Bij weigering |
  |---|---|---|
  | Toestandscontrole | beschrijft `convex-records.json` de deployment die er nú staat? | `de deployment komt niet overeen met convex-records.json`, exitcode 1 |
  | Vloer | zou dit commando alles wissen wat er staat? Óf: nul rijen in de transform-telling? Óf: geen enkel bestand dat de records nog nodig hebben, terwijl de map vol is? | `VLOER: …`, exitcode 1 |
  | Per-object-bescherming | verwijst `convex-records.json` nog naar dit object? | het object blijft staan; het rapport telt ze als "beschermd door convex-records.json" |

  De toestandscontrole alleen is niet genoeg: hij is triviaal waar zodra beide kanten nul zijn — een `extract` tegen de verkeerde tabel of omgeving levert nul items, en op nul items slagen `transform`, `load-records` én `verify`. De vloer is dan het laatste dat nog tussen jou en 5,6 GB staat. De per-object-bescherming houdt `convex-records.json` laadbaar: `reset` (zónder `--all`) plus `load-records` moet erna nog slagen zonder `--accept-missing-files`, ook als een foto tussendoor geroteerd is en het oude bestand aan geen record meer hangt.
- Elke weigering exit met code 1, "niets op te ruimen" met 0. Op cutover-dag lopen deze commando's in een keten: lees de uitkomst uit de exitcode, niet uit twintig regels terminal.
- Het commando verwijdert in dezelfde beweging de bijbehorende entry's uit `storage-map.json`, zodat de map niet naar gewiste objecten wijst.
- Gebruik hier nooit `reset --all`: dat wist de complete storage en maakt de map ongeldig — daarmee gooi je de uren upload weg die het gefaseerde ontwerp juist moest sparen.

Breekt `load-records` halverwege af, dan stopt hij luid met de bron-sleutel in de melding. Het antwoord is altijd hetzelfde: `reset --target prod --yes` (zónder `--all`, de bestanden blijven staan) en opnieuw. Hervatten wordt bewust niet ondersteund — dat zou een tweede foutbron zijn in een run van minuten.

## Bekende meldingen en wat ze betekenen

| Melding | Betekenis |
|---|---|
| `groep X heeft geen membership met isFounder` | `groups.createdBy` is niet af te leiden. Zet een `founderOverrides`-entry. |
| `user X heeft geen Clerk-ID in de ID-map` | De ID-map mist een user. Geen placeholder-subject: die user zou nooit kunnen inloggen. |
| `de doel-deployment is niet leeg` | `load-records` weigert te verdubbelen. Draai `reset`. Ook achtergebleven `uploadIdempotency`-rijen tellen mee: die staan onder WP10's FK-controle en `reset` haalt ze weg. |
| `de deployment komt niet overeen met convex-records.json` | De toestandscontrole van `prune-storage`: hij weigert op te ruimen zolang de records niet (volledig) geladen zijn, want elk bestand is dan nog nodig. Draai eerst `load-records`, daarna `verify`. Exitcode 1. |
| `VLOER: convex-records.json beschrijft nul rijen in totaal` | Het transform-resultaat is leeg — vrijwel altijd een `extract` tegen de verkeerde tabel of AWS-omgeving. Controleer `MIGRATE_DYNAMO_TABLE` en draai `extract` + `transform` opnieuw. Er is niets gewist. Exitcode 1. |
| `VLOER: N bestand(en) in storage-map.json, en convex-records.json heeft er geen enkele van nodig` | Tegenspraak tussen de twee werkbestanden, geen opruimopdracht. Controleer of `convex-records.json` en `storage-map.json` bij dezelfde run horen. Exitcode 1. |
| `VLOER: alle N object(en) in storage zouden weg gaan` | Dit is geen selectieve opruiming meer. Alles wissen is `reset --all` — een ander commando, een andere bedoeling. Zoek eerst uit waarom er niets meer verwezen wordt. Exitcode 1. |
| `verify`: `Nog niet opruimen: de rij-aantallen kloppen niet` | Normale toestand tussen T-2 en T-0: de bestanden staan er, de records nog niet. Niet opruimen; draai `load-records` en daarna opnieuw `verify`. |
| `storage-map.json bestaat niet` | `load-files` is niet (af)gedraaid. `load-records` weigert; "nul bestanden bekend, dus nul foto's" is geen geldige conclusie. |
| `N van de M verwezen bestand(en) staan niet in storage-map.json` | De gate vóór de eerste schrijf. Draai `load-files` (opnieuw) af — hij hervat waar hij gebleven was. Staan de bestanden aantoonbaar niet in S3, dan pas `--accept-missing-files`. |
| `N bestand(en) ... staan niet in de bucket` | Records verwijzen naar een verdwenen S3-object. Bekijk `scripts/.data/missing-files.json`; met `--accept-missing-files` slaat `load-records` die foto's over, benoemt ze per bron-sleutel, en `verify` meldt het verschil daarna als bevinding. |
| `stemscore votes=N gaat verloren` | Bewust: de bron kent geen per-user upvotes, dus `upvoteCount` wordt 0. De oude score staat in het rapport zodat je 'm desgewenst handmatig terugzet. |
| `formaten`: `key mag geen internal actions draaien` | `selfTest` kreeg `OperationNotPermitted` (of de admin-key werd afgewezen). Er is niets geschreven. Maak een nieuwe key met `npx convex deployment token create` (§A), zet hem in `.env.migrate` en start opnieuw. |
| `formaten`: `geen verbinding met de deployment` | Het netwerk viel weg tijdens `selfTest`. Er is niets geschreven. Controleer de verbinding en `MIGRATE_CONVEX_URL_*`, en start opnieuw. |
| `formaten`: `beeldbibliotheek werkt niet op de deployment` | `selfTest` faalde: sharp of heic-decode laadt of decodeert niet in de Node-action. Er is niets geschreven. Controleer de exacte versies in `package.json` en `externalPackages` in `convex.json`, deploy opnieuw en herhaal. Exitcode 1. |
| `formaten`: `action brak af` | Een action viel om (geheugen of time-out). Bij een batch: die wordt foto voor foto overgedaan. Bij één foto: die telt als mislukt; de reden staat bij die functie in de Convex-log. |
| `formaten`: `NIET KLAAR` | Er zijn nog foto's zonder formaten, of er mislukte er een. Draai `formaten` opnieuw; de mislukte foto-id's staan in de uitvoer, de reden in de Convex-log. Exitcode 1. Blijft dezelfde foto mislukken: §Formaten ("Blijft een foto mislukken"). |
| `verify`: `photos/<id>: formaten ontbreken` | Een foto van meer dan een uur oud zonder formaten (WP25). Op T0: `formaten` is niet (af)gedraaid. Daarna: de stap na een upload mislukte. Draai `formaten`; blijft hij mislukken, zie §Formaten ("Blijft een foto mislukken"). |
| `verify`: `photos/<id>: formaten dangling` | De foto verwijst naar een formaat dat niet meer in storage staat. De app toont het origineel. Draai `formaten`: die maakt een nieuwe set. |
| `createdBy gesynthetiseerd` | `albums.createdBy` bestaat niet in de bron en valt terug op de founder van de groep. |

## Opruimen (verplicht, niet optioneel)

`scripts/.data/` bevat productie-PII van 20 mensen: namen, adressen, Cognito-subs (ook in S3-sleutels), invite-berichten en de volledige recordset. De map staat in `.gitignore`, maar dat is geen bewaartermijn.

- [ ] Na een geslaagde dev-seed: `rm scripts/.data/dynamo-extract.json`. Dat is het bestand met de onbewerkte productiedata — namen, adressen, invite-berichten. `convex-records.json`, `storage-map.json` en de config blijven staan tot de volgende seed: `reset` + `load-records` heeft ze nodig, en `verify` en `prune-storage` ook. Let op: `convex-records.json` is geanonimiseerd maar niet PII-vrij — de S3-sleutels dragen Cognito-subs. Weg bij de eindopruiming hieronder.
- [ ] Na T-0 en een groene `verify`: `rm -rf scripts/.data/` volledig, plus `.env.migrate`.
- [ ] Bij T+30, samen met de rest van de cutover-opruiming: `convex/migration.ts` en `scripts/migrate/` verwijderen, en de AWS-read-only-credentials intrekken. Zie het fase 5-stappenplan in `migratie-status.md`.
