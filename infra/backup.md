# Backup van Convex-prod (WP31 B4)

Elke 1e van de maand zet de GitHub Action [`Backup`](../.github/workflows/backup.yml) een volledige export van prod, met bestanden, in S3-bucket `clubalmanac-convex-backup` (eu-west-1, klasse Glacier Instant Retrieval). Daarnaast een lijst met de namen van de env-vars van prod, zonder waarden: een export bevat geen env-vars en geen code. Per bestand blijven de laatste 6 versies staan, plus elke versie van het laatste half jaar; oudere gaan automatisch weg. Stoppen de runs, dan blijven die 6 gewoon staan. Tien runs op één dag verdringen dus geen goede versie.

Tot T+30 staat de workflow uit: zonder repo-variabele `BACKUP_ENABLED` slaat hij elke run over (status *skipped*, grijs). Tot T0 is prod leeg of bevat hij de repetitie; een rode run daarvan leert alleen rood te negeren.

Kosten: ~$0,80 per run aan Convex-bandbreedte (6 GB lezen) plus ~$0,15 per maand opslag (6 × 6 GB; ~$0,20 met de versies van het halfjaar). Terughalen kost $0,03 per GB.

## Opzet (eenmalig, Wouter, vóór T0)

1. **Stack** in eu-west-1, met de OIDC-provider die de site-stack al gebruikt (IAM → Identity providers → `token.actions.githubusercontent.com`):
   ```bash
   aws cloudformation deploy --region eu-west-1 --stack-name clubalmanac-convex-backup \
     --template-file infra/backup.yml --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides GitHubOidcProviderArn=<arn van de provider>
   aws cloudformation describe-stacks --region eu-west-1 --stack-name clubalmanac-convex-backup \
     --query "Stacks[0].Outputs"
   ```
2. **GitHub-environment** `prod-backup` (repo → Settings → Environments → New environment):
   - *Deployment branches and tags*: alleen `main`. Dat is wat "alleen vanaf main" afdwingt: de rol vertrouwt de environment, niet de branch.
   - *Environment secret* `CONVEX_PROD_DEPLOY_KEY`: een deploy-key van de **prod**-deployment (Convex-dashboard → prod → Settings → Deploy key). Die sleutel kan prod ook wijzigen; hij staat daarom alleen in deze environment, en de workflow doet niets anders dan exporteren.
3. **Repo-variabelen** (Settings → Secrets and variables → Actions → Variables): `BACKUP_BUCKET` en `BACKUP_ROLE_ARN`, uit de outputs van stap 1. `BACKUP_ENABLED` nog **niet** (pas bij stap 4).

En: zet in je GitHub-instellingen (Settings → Notifications → Actions) mail aan voor mislukte workflows. Een rode run valt dan op. Let op: de repo is publiek, en GitHub zet een geplande workflow uit na 60 dagen zonder activiteit in de repo. Je krijgt daar vooraf een mail over; zet hem dan weer aan (Actions → Backup → *Enable workflow*).

## De eerste run en het terugzetten (gate B4, vóór T+30)

4. **Aanzetten en met de hand draaien:** repo-variabele `BACKUP_ENABLED` = `true`, dan Actions → Backup → *Run workflow* (branch `main`).
   Verwacht: groen; de stap *Export controleren* toont ~6 GB, ~4700 bestanden (originelen plus twee formaten per foto), ~1544 foto-rijen en 20 users (19 leden plus het demo-account); de stap *Uploaden* eindigt met "klaar".
   Afwijking: rood bij *Export controleren* → de drempels in de workflow vergelijken met wat de stap afdrukt. Rood bij *Uploaden* met `AccessDenied` → `BACKUP_ROLE_ARN` en de environment-naam in de stack nalopen.
5. **Terugzetten in een wegwerp-deployment:**
   ```bash
   aws s3 cp s3://clubalmanac-convex-backup/convex-prod/snapshot.zip ./backups/restore-test.zip
   ```
   Maak in het Convex-dashboard een nieuw project `restore-test` en zet dezelfde code erop (`npx convex deploy` met de deploy-key van dat project). Dan:
   ```bash
   CONVEX_DEPLOY_KEY=<key van restore-test> npx convex import --replace-all ./backups/restore-test.zip
   ```
   Verwacht: per tabel hetzelfde aantal rijen als op prod (dashboard → Data), en een foto opent in het dashboard (Files). Daarna project `restore-test` verwijderen en `./backups/restore-test.zip` wissen (echte ledendata).
   Vanaf nu is de backup bewezen; pas daarna mag `blob-images` weg (T+90, W9).

## Een oudere versie terughalen

```bash
aws s3api list-object-versions --bucket clubalmanac-convex-backup --prefix convex-prod/snapshot.zip \
  --query "Versions[].[VersionId,LastModified]" --output table
aws s3api get-object --bucket clubalmanac-convex-backup --key convex-prod/snapshot.zip \
  --version-id <id> ./backups/snapshot-<datum>.zip
```

De rol van de workflow mag alleen schrijven, niet lezen of wissen; dit doe je met je eigen AWS-login.
