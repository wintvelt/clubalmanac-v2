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
| 6 | `verify` | beide bestanden + de deployment | rapport in de terminal |
| 7 | `reset` | — | leegt de tabellen; met `--all` ook de storage |

## Pre-flight

### A. `.env.migrate` (gitignored)

```
# Convex-doelen. De admin-key is een deployment-scoped deploy key uit het
# Convex-dashboard → Settings → Deploy Keys. Zonder zo'n key zijn de
# migratie-functies (internal) niet aanroepbaar — dat is de bedoeling.
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
- [ ] Verbinding testen vóór je iets schrijft: `npm run migrate -- verify --target dev`. Dat commando is read-only; het faalt met een expliciete melding als de admin-key niet geaccepteerd wordt.

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

```bash
npx convex export --path ./backups/wp12-dev-voor-seed.zip   # anker (pre-flight)
npm run migrate -- extract                     # minuten, leest productie-DynamoDB
npm run migrate -- inspect                     # kies de 3 chosen users op feiten
#   → vul scripts/.data/dev-config.json
npm run migrate -- transform --target dev      # seconden
npm run migrate -- load-files --target dev     # enkele honderden MB
npm run migrate -- load-records --target dev   # minuten
npm run migrate -- verify --target dev
```

- Ook de dev-seed leest **productie**-AWS. De AWS-dev-omgeving wordt bewust genegeerd: alleen productie is representatief genoeg om de clients tegenaan te bouwen.
- Anonimisatie staat automatisch aan bij `--target dev` en zit ín de transform: echte namen en adressen verlaten die stap niet, ook niet in invite-sleutels of -tokens. Foto's blijven echt (visuele realiteit) — de dev-database dus nooit publiek delen.
- Een groep waarvan de founder niet chosen is, valt volledig af. Blijkt bij `inspect` dat je daarmee een groep kwijtraakt die je wilde testen, kies dan andere users — niet de regel verzachten.
- Opnieuw seeden (bv. na een schema-wijziging): `reset --target dev --yes` en dan `load-records` opnieuw. De bestanden blijven staan, dus dat duurt minuten. Alleen als je ook de bestanden weg wilt: `reset --target dev --yes --all` — dat maakt `storage-map.json` in dezelfde beweging ongeldig.

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


### T-0

```bash
export MIGRATE_ALLOW_PROD=yes
npx convex export --prod --path ./backups/wp12-prod-t0.zip  # tweede anker
npm run migrate -- extract                      # verse stand, inclusief alles sinds T-2
npm run migrate -- transform --target prod
npm run migrate -- load-files --target prod     # alleen de delta; de rest staat al in de map
npm run migrate -- load-records --target prod   # minuten
npm run migrate -- verify --target prod
```

- [ ] `verify` is groen: rij-aantallen kloppen, geen dangling storage-verwijzingen, geen storage-orphans, integriteitsscan leeg.
- [ ] `integrityCheck`-cron op prod weer aan.
- [ ] `unset MIGRATE_ALLOW_PROD`.

Breekt `load-records` halverwege af, dan stopt hij luid met de bron-sleutel in de melding. Het antwoord is altijd hetzelfde: `reset --target prod --yes` (zónder `--all`, de bestanden blijven staan) en opnieuw. Hervatten wordt bewust niet ondersteund — dat zou een tweede foutbron zijn in een run van minuten.

## Bekende meldingen en wat ze betekenen

| Melding | Betekenis |
|---|---|
| `groep X heeft geen membership met isFounder` | `groups.createdBy` is niet af te leiden. Zet een `founderOverrides`-entry. |
| `user X heeft geen Clerk-ID in de ID-map` | De ID-map mist een user. Geen placeholder-subject: die user zou nooit kunnen inloggen. |
| `de doel-deployment is niet leeg` | `load-records` weigert te verdubbelen. Draai `reset`. |
| `N bestand(en) ... staan niet in de bucket` | Records verwijzen naar een verdwenen S3-object. Bekijk `scripts/.data/missing-files.json`; met `--accept-missing-files` slaat `load-records` die foto's over (en telt ze in het rapport). |
| `stemscore votes=N gaat verloren` | Bewust: de bron kent geen per-user upvotes, dus `upvoteCount` wordt 0. De oude score staat in het rapport zodat je 'm desgewenst handmatig terugzet. |
| `createdBy gesynthetiseerd` | `albums.createdBy` bestaat niet in de bron en valt terug op de founder van de groep. |

## Opruimen (verplicht, niet optioneel)

`scripts/.data/` bevat productie-PII van 16 mensen: namen, adressen, Cognito-subs (ook in S3-sleutels), invite-berichten en de volledige recordset. De map staat in `.gitignore`, maar dat is geen bewaartermijn.

- [ ] Na een geslaagde dev-seed: `rm -rf scripts/.data/dynamo-extract.json scripts/.data/convex-records.json` — de config- en storage-map-bestanden bewaar je tot de volgende seed.
- [ ] Na T-0 en een groene `verify`: `rm -rf scripts/.data/` volledig, plus `.env.migrate`.
- [ ] Bij T+30, samen met de rest van de cutover-opruiming: `convex/migration.ts` en `scripts/migrate/` verwijderen, en de AWS-read-only-credentials intrekken. Zie het fase 5-stappenplan in `migratie-status.md`.
