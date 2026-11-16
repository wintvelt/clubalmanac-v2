# WP31 — draaiboek overstap naar prod (T0)

Het draaiboek voor de overstap van de oude app (AWS) naar de nieuwe (Convex), voor 19 leden. Besluiten en achtergrond: [`WP31`](../work-packages/WP31-cutover.md) §Spec-criticus aanvullingen (W1-W12). Commando's van de migratie: [`wp12-data-migratie.md`](./wp12-data-migratie.md) §Run 2.

Spelregels:
- **Wie:** Wouter doet alles in een extern account (AWS, Clerk, Convex prod, App Store Connect, GitHub-instellingen) en draait de schrijvende migrate-commando's. Claude mag lezen en controleren.
- **Bij afwijking stopt het draaiboek** (invariant 6). "Waarschijnlijk goed" bestaat niet. Kijk dan bij *Afwijking* of bij §Terug.
- **Punt zonder terugkeer:** *Release This Version* in App Store Connect (stap T0.9). Daarvoor is alles terug te draaien; daarna niet zonder dataverlies.
- Een `[ ]` is pas af met de verwachte uitkomst erbij.

## T-4 weken — prod klaarzetten

Alles hieronder laat rijen achter op prod. Dat geeft niets: vóór de repetitie en vóór T0 gaat prod door `reset` (invariant 16).

- [ ] **Convex prod** (EU, Dublin) aanmaken; env-vars zetten: `MAILJET_API_KEY`, `MAILJET_API_SECRET`, `MAILJET_VERIFIED_SENDERS`, `MAILJET_WEBHOOK_SECRET`, `CLUBALMANAC_STAGE=prod`, `CLERK_FRONTEND_API_URL`, `CLERK_WEBHOOK_SECRET`, `CLERK_SECRET_KEY` (`sk_live_…`, WP29), `CLUBALMANAC_APP_STORE_ID=1663038609`, en de vier `FILMS_S3_*` (WP21) met de sleutel van een eigen IAM-user die alleen `s3:GetObject` op `blob-videos/*` mag. **Nog niet** `WEBMASTER_EMAILS` (W12, pas op T0.5).
  Verwacht: `npx convex env list --prod --names-only` toont precies deze namen, en níet `INTEGRATION_TEST_ENABLED` of `INTEGRATION_TEST_SECRET` (WP26).
- [ ] **Backend op prod zetten** met `npm run deploy:prod` ([`scripts/deploy-prod.sh`](../../scripts/deploy-prod.sh)), in een eigen clone die alleen hiervoor is (bv. `~/Code/clubalmanac-v2-release`), niet in de werk-checkout: daar werken meerdere sessies, en `npx convex deploy` zet ook niet-gecommitte code op prod. Het script weigert buiten een schone `main` die gelijk is aan `origin/main`. Na elke merge die de backend raakt opnieuw.
  Verwacht: `npx convex deploy` noemt de prod-deployment en eindigt zonder fout.
- [ ] **Clerk prod** activeren, op **Hobby** (W8: sessie maximaal 7 dagen, leden loggen wekelijks opnieuw in). Instellingen gelijk aan dev: e-mailcode aan, wachtwoord uit, sign-up aan zonder verplichte naamvelden, bot sign-up protection uit, *Verification required before session* aan (Configure → Email address; standaard aan, de webhook rekent erop, WP6). JWT-template `convex`: claim `email` = `{{user.primary_email_address}}`. Webhook naar `https://<prod>.eu-west-1.convex.site/clerk-webhook` met eigen Svix-secret.
- [ ] **Clerk test mode aan op prod, permanent** (W4, besluit 2026-11-16). Dan logt de reviewer van Apple in met een `+clerk_test`-adres en code 424242, bij elke volgende review ook.
  Verwacht: in het Clerk-dashboard van de prod-instance staat *Test mode* aan.
  Restrisico (besluit staat): iedereen kan zich aanmelden met een `+clerk_test`-adres en code 424242, zonder mailbox, en bot sign-up protection staat uit. Zulke accounts tellen mee in de MAU van Clerk en zijn te scripten. Ze zien niets: zonder uitnodiging maakt de app geen user-rij (WP19b). Het demo-adres plus 424242 is een blijvend wachtwoord dat bij Apple ligt; het demo-account ziet alleen Demo. Kijk eens per kwartaal in Clerk prod → *Users* of er onbekende accounts bijkomen.
- [ ] **Mailjet prod:** webhook naar `https://<prod>.eu-west-1.convex.site/email-event` met eigen Basic-auth-secret. Afzender gevalideerd ([`external-services.md`](../conventions/external-services.md) §Mailjet: anders gaat mail stil verloren).
- [ ] **Rooktests:** WP5-gates 1+2 en WP6-gates 1+2+3 op prod ([`wp5-mailjet-empirical-gates.md`](./wp5-mailjet-empirical-gates.md), [`wp6-clerk-empirical-gates.md`](./wp6-clerk-empirical-gates.md); WP6 eerst omzetten naar inloggen met code). Daarna een wegwerp-account uitnodigen, in de app *Account verwijderen*, en in Clerk prod controleren dat de user weg is (WP29).
- [ ] **"Cannot Sell App" oplossen. Begin hier als eerste: dit kan weken duren.** Stand 2026-11-16 (App Store Connect → app → *Pricing and Availability*): de app staat aan in België, Luxemburg, Nederland, Zwitserland en het VK, alle vijf met status *Cannot Sell App*; alle andere landen *Not Available*. Zolang dat zo is, komt ook de nieuwe versie bij geen enkel lid aan.
  1. App Store Connect → *Business* (*Agreements, Tax, and Banking*): staat de *Free Apps Agreement* op *Active*? Een verlopen of nog niet geaccepteerde overeenkomst is de gebruikelijke oorzaak. Accepteer wat openstaat (alleen de Account Holder kan dat).
  2. Is alles daar actief en blijft *Cannot Sell App* staan: Apple Developer Support (developer.apple.com/contact), onderwerp App Store Connect, met de app-ID `1663038609` en de melding. Antwoord kan dagen duren.
  Verwacht: Nederland en België op *Available*, ruim vóór de datum van de schrijfstop (T-3 weken). Daarmee is ook 1.6.0 tot T0 weer te downloaden; dat is geen probleem.
  Afwijking: op T-3 weken nog *Cannot Sell App* → de datum van de schrijfstop nog niet vastleggen. Zonder verkoop is er geen T0.
- [ ] **Cutover-build** met profiel `production` (`pk_live`, prod-URL). Die build wist eenmalig de Clerk-cache-sleutels van de oude `pk_test`-key (WP15a). Gefaseerde release uit (W10).
- [ ] **Backup-bucket en -workflow** klaarzetten: [`infra/backup.md`](../../infra/backup.md) stap 1-3. Repo-variabele `BACKUP_ENABLED` **niet** zetten: zonder die variabele slaat de workflow elke run over (grijs, niet rood). Prod is tot T0 leeg of bevat de repetitie.
  Verwacht: op de 1e van de maand staat er een run *Backup* met status *skipped*.

## T-3 weken — datum en leden

- [ ] Datum van de schrijfstop (T0.1) vastleggen. T0 zelf is de dag van de vrijgave, en die hangt van Apple af.
- [ ] Bericht 1 naar de leden (WhatsApp en mail, tekst in §Teksten). Vraagt ook of hun e-mailadres nog klopt: wie dat niet meer leest, kan op T0 de code niet ontvangen.
  Afwijking: een lid heeft een nieuw adres. Liefst laten inloggen met het oude adres; anders zie WP31 §Edge cases, "Lid zonder bereikbaar adres".

## T-1 week — voorbereiden en repetitie op prod

- [ ] **Herinnering in de oude app** (W2): in Blob bibliotheek een album met een banner, tekst zonder vaste datum ("Nieuwe app komt binnenkort"). Banner eerst via de S3-console onder `public/img/` zetten, dan één record `GA<groepId>` / `A…` met `name`, `photo.url` en `createdAt` (WP31 vraag 2).
  Verwacht: het album staat in je eigen oude app in Blob bibliotheek. Noteer de album-ID voor `excludeAlbumIds`.
- [ ] **Extract en inspect** (alleen lezen): `npm run migrate -- extract`, `npm run migrate -- inspect`.
  Verwacht: 20 users, waarvan John Appleseed het reviewaccount; telling gelijk aan WP31 §Telling, of verklaarbaar.
- [ ] **`scripts/.data/prod-config.json`: de uitsluitingen** (W5), eerst zonder Clerk-ID's:
  ```json
  {
    "clerkIdByEmail": {},
    "excludeUserIds": ["<ID van John Appleseed, uit inspect>"],
    "excludeGroupIds": ["G1bPko8fqhJ7bTEF", "G0O9PN5O6IRu9oMJ", "GoDoIz0WOM-K-lmP", "Gvh0VEosHYHFfCzZ"],
    "excludeAlbumIds": ["<ID van het herinneringsalbum>"]
  }
  ```
  De groeps-ID's zijn die van "Test group", "Familievakantie", "testgroep 2" en "blob" (extract van 2026-11-06). Let op: "blob" is níet "Blob bibliotheek" (`GT3IgqXKFgBDKZA0`, 18 leden, de films). De transform hieronder zet de naam bij elke ID; daar zie je een verwisseling.
- [ ] **Clerk pre-create** (Wouter), met `MIGRATE_CLERK_SECRET_KEY_PROD=sk_live_…` in `.env.migrate`:
  ```bash
  MIGRATE_ALLOW_PROD=yes npm run migrate -- clerk-ids --create --write
  npm run migrate -- clerk-ids
  ```
  De eerste maakt de 19 leden (het extract min `excludeUserIds`) aan in Clerk prod, zonder wachtwoord en zonder mail, en zet `clerkIdByEmail` uit Clerk zelf: niet overtypen (een verwisselde ID laat het ene lid stil de groepen van het andere zien). De tweede leest alleen en vergelijkt elke ID met het primaire adres in Clerk.
  Verwacht: "19 aangemaakt" en daarna "in orde: clerkIdByEmail is gelijk aan Clerk prod (19 leden)", exitcode 0; geen mail bij de leden (invariant 8). De Clerk-users zonder lid (wegwerp uit de rooktests) staan als ID in de uitvoer.
  Afwijking: `ONTBREEKT` of `MAP KLOPT NIET` → niet verder. Een fout bij `--create` (bv. HTTP 422, adres ongeldig): het adres in het extract nakijken; opnieuw draaien slaat wie al bestaat over.
- [ ] **Transform op prod** (alleen lokaal): `npm run migrate -- transform --target prod`.
  Verwacht: hij slaagt en drukt onder "uitgesloten via prod-config" precies deze regels af (aantallen van 2026-11-06):
  - `uitgesloten user U… "John Appleseed" (config): 1 lidmaatschap(pen), 32 foto('s), 30 publicatie(s)`
  - `uitgesloten groep G0O9PN5O6IRu9oMJ "Familievakantie" (config): 1 lidmaatschap(pen)`
  - `uitgesloten groep G1bPko8fqhJ7bTEF "Test group" (config): 2 album(s), 30 publicatie(s), 2 lidmaatschap(pen)`
  - `uitgesloten groep GoDoIz0WOM-K-lmP "testgroep 2" (config): 1 lidmaatschap(pen), 1 uitnodiging(en)`
  - `uitgesloten groep Gvh0VEosHYHFfCzZ "blob" (config): 1 lidmaatschap(pen)`
  - `uitgesloten album A… "<naam van het herinneringsalbum>" (config): geen andere rijen`

  Afwijking: een andere naam of een groot verschil in aantallen → verkeerde ID, config corrigeren. Een ID die niet in het extract staat, of een uitgesloten user die oprichter is van een groep die meegaat, stopt de transform zelf.
- [ ] **Uitzondering in de schrijfstop nakijken** (alleen lezen, AWS-prod). Zoek de rol van de stream-Lambda van `blob-images-api` (Lambda → functie → Configuration → Permissions) en kijk welke functies die rol delen:
  ```bash
  aws lambda list-functions --region eu-central-1 \
    --query "Functions[?Role=='<rol-ARN>'].FunctionName" --output text
  ```
  Verwacht: alleen de stream-Lambda (en eventueel Cognito-triggers zoals `cognitoSync`).
  Afwijking: ook andere handlers (bij Serverless delen alle functies van een service vaak één rol). Dan schrijven die door de uitzondering heen. Zet de uitzondering in de tabel-policy (T0.2) dan op de sessie van alleen de stream-functie; een Lambda neemt zijn rol aan met de functienaam als sessienaam:
  ```json
  "Condition": { "StringNotLike": { "aws:userid": "<RoleId>:<naam van de stream-functie>" } }
  ```
  `<RoleId>` (begint met `AROA`): `aws iam get-role --role-name <rolnaam> --query Role.RoleId --output text`. Doe hetzelfde op AWS-dev voor de repetitie.
- [ ] **WP31 staat op prod:** gemerged in `main` en met `npm run deploy:prod` gedeployd; de repetitie heeft `photos.formatStatusPage` nodig.
  Verwacht: `npx convex run --prod photos:formatStatusPage '{"cursor":null,"batchSize":1}'` geeft een telling met `"cursor": null`.
- [ ] **Generale repetitie op prod** (W6): T0.2 tot en met T0.7 hieronder, met deze verschillen:
  - schrijfstop (T0.2) op de AWS-**dev**-tabel `blob-images-photos-dev` en bucket `blob-images-dev`, met de twee controles van T0.2 (tabel- en bucketnaam aangepast): beide geweigerd. Daarna de policies weghalen, de controles opnieuw: beide lukken. Ruim dan het testbestand en het testrecord op:
    ```bash
    aws s3 rm s3://blob-images-dev/protected/schrijfstop-test.txt
    aws dynamodb delete-item --region eu-central-1 --table-name blob-images-photos-dev \
      --key '{"PK":{"S":"SCHRIJFSTOP-TEST"},"SK":{"S":"test"}}'
    ```
  - geen `WEBMASTER_EMAILS` (T0.5);
  - wel de demo-groep, het demo-account en de production-build op TestFlight (T0.7), maar **niet indienen** bij Apple;
  - de production-build alleen in *Internal Testing* (jezelf), **niet** in de externe groep "Blob testgroep": anders werken leden op prod, en `reset` wist daarna wat ze deden.

  Gate, alles verplicht:
  - `formaten` eindigt met exitcode 0 (blokker B1: de telling is per pagina, nog niet op prod-volume gedraaid);
  - `verify` groen;
  - inloggen als Wouter toont precies 3 groepen: Blob bibliotheek, zijn groep met 1 album en 2 leden, en Demo (T0.7);
  - het album van 540 foto's opent op prod, en scrollen gaat zonder fout (blokker B3: per foto worden de formaten opgevraagd; op dev was het grootste album 302);
  - de doorvoer van `load-files` en de duur van `formaten` noteren (verwacht ~18 en ~70 minuten, W7).

  Afwijking bij B1 of B3: niet naar T0. Meld het aan regie; dat is code.
- [ ] **Na de repetitie prod leegmaken:** `MIGRATE_ALLOW_PROD=yes npm run migrate -- reset --target prod --yes --all`.
  Verwacht: `npm run migrate -- verify --target prod` toont in de kolom van de deployment overal 0, en `storage: 0 objecten`. Exitcode 1 en "rood" horen hier bij: `verify` vergelijkt met `convex-records.json` van de repetitie. Kijk alleen naar die kolom. De filmlijst staat nog (valt buiten `reset`) en wijst naar een gewiste groep: op T0.5 opnieuw vullen is daarom verplicht.

## T-1 dag

- [ ] Bericht 2 naar de leden (§Teksten): morgen kan de oude app alleen nog kijken; niet uploaden of uitnodigen.

## T0 — de overstap

De dag van de schrijfstop. De vrijgave (T0.9) volgt na de review, mogelijk dagen later.

1. **Leden melden** dat de oude app vanaf nu alleen kijkt (bericht 3). Een uitnodiging die iemand toch stuurt, mailt nog wel maar bestaat daarna niet (W11, geaccepteerd).
2. **Schrijfstop** (W1). Twee policies, geen code:
   - Op tabel `blob-images-photos-prod` (eu-central-1) een resource policy:
     ```json
     {
       "Version": "2012-10-17",
       "Statement": [{
         "Sid": "Schrijfstop",
         "Effect": "Deny",
         "Principal": "*",
         "Action": ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
                    "dynamodb:BatchWriteItem", "dynamodb:PartiQLInsert",
                    "dynamodb:PartiQLUpdate", "dynamodb:PartiQLDelete"],
         "Resource": "arn:aws:dynamodb:eu-central-1:<account>:table/blob-images-photos-prod",
         "Condition": { "ArnNotEquals": { "aws:PrincipalArn": "<rol van service blob-images-api>" } }
       }]
     }
     ```
     De rol vind je bij de stream-Lambda van `blob-images-api` (Lambda → functie → Configuration → Permissions). Zonder die uitzondering kan een cascade halverwege blijven hangen. Maak tijdens de stop geen user aan in de Cognito-console: die rol draait ook `cognitoSync`.
   - Aan de **bestaande** policy van bucket `blob-images` één statement **toevoegen** (niet vervangen, anders valt `img.clubalmanac.com` misschien om):
     ```json
     { "Sid": "Schrijfstop", "Effect": "Deny", "Principal": "*",
       "Action": ["s3:PutObject", "s3:DeleteObject"],
       "Resource": "arn:aws:s3:::blob-images/protected/*" }
     ```
   Controle per policy, met je eigen AWS-login (een Deny in een policy geldt ook voor een admin):
   ```bash
   echo test > schrijfstop-test.txt
   aws s3 cp schrijfstop-test.txt s3://blob-images/protected/schrijfstop-test.txt
   aws dynamodb put-item --region eu-central-1 --table-name blob-images-photos-prod \
     --item '{"PK":{"S":"SCHRIJFSTOP-TEST"},"SK":{"S":"test"}}'
   ```
   Verwacht: de eerste geeft `AccessDenied`, de tweede `AccessDeniedException`. Een wijziging in je eigen oude app (bv. een albumnaam) geeft een foutmelding, en de dbStream-Lambda heeft daarna 5 minuten geen aanroepen (CloudWatch, *Invocations*). Kijken in de oude app werkt nog.
   Afwijking: een van de twee lukt → die policy staat niet goed (niet opgeslagen, of een fout in `Resource`). Haal het testbestand of testrecord weg (`aws s3 rm …` of `aws dynamodb delete-item …`, zoals bij de repetitie), herstel de policy en controleer opnieuw. Niet verder zolang er één lukt: draaien in de oude app wist dan nog originelen.
3. **Leeg-controle:** `npm run migrate -- verify --target prod` (baseline). Een export nu zou leeg zijn; het anker komt bij T0.5.
   Verwacht: in de kolom van de deployment overal 0, en `storage: 0 objecten`. Exitcode 1 en "rood" horen hier bij (`verify` vergelijkt met de oude `convex-records.json`); kijk alleen naar die kolom.
   Afwijking: niet overal 0 → eerst `MIGRATE_ALLOW_PROD=yes npm run migrate -- reset --target prod --yes --all`, dan opnieuw.
4. **Migratie**, in deze volgorde, elk met exitcode 0 ([`wp12-data-migratie.md`](./wp12-data-migratie.md) §Run 2 voor de meldingen):
   ```bash
   npm run migrate -- extract
   npm run migrate -- inspect
   npm run migrate -- clerk-ids                    # alleen lezen
   npm run migrate -- transform --target prod
   MIGRATE_ALLOW_PROD=yes npm run migrate -- load-files --target prod     # ~18 min
   MIGRATE_ALLOW_PROD=yes npm run migrate -- load-records --target prod
   MIGRATE_ALLOW_PROD=yes npm run migrate -- formaten --target prod       # ~70 min, hervatbaar
   npm run migrate -- verify --target prod
   ```
   `MIGRATE_ALLOW_PROD=yes` alleen vóór het commando zelf, nooit met `export`: de review duurt dagen, en een vergeten `reset` in diezelfde shell wist dan prod.
   Verwacht: `inspect` geeft dezelfde telling als bij T-1 week, of een verschil dat je kunt verklaren (iemand heeft vóór de stop nog iets toegevoegd); `clerk-ids` "in orde", exit 0; `transform` met dezelfde uitsluitingsregels als bij T-1 week; `load-files` zonder ontbrekende bestanden (een ontbrekend bestand na de schrijfstop is een stop, geen `--accept-missing-files`, invariant 10); `formaten` "klaar", exit 0; `verify` groen.
   Afwijkingen die de schrijfstop lastig maakt (de Deny geldt ook voor jou; de bron is niet te wijzigen):
   - `clerk-ids` meldt `ONTBREEKT` (iemand werd na T-1 week lid): `MIGRATE_ALLOW_PROD=yes npm run migrate -- clerk-ids --create --write`, dan `clerk-ids` opnieuw ("in orde").
   - `transform` stopt op een gemelde foto met een verwijderdatum: beslis. Of het verlies accepteren met `transform --target prod --accept-flagged-deletion` (de FL1-cron wist de foto). Of de tabel-policy kort weghalen, alleen die datum in de oude app wissen, de policy terugzetten, de twee controles van T0.2 opnieuw, en vanaf `extract` opnieuw.
   - `inspect` wijkt af zonder verklaring: niet verder; §Terug.
5. **Na een groene `verify`:**
   - `WEBMASTER_EMAILS` op prod zetten (W12);
   - filmlijst vullen: `node scripts/wp21/seedArgs.ts --group <prod-id van "Blob bibliotheek">`, dan het geprinte `--prod`-commando (`films:replaceAll`); daarna `npx convex run --prod films:checkLinks`.
   - **anker**, een volledige export mét bestanden: `npx convex export --prod --include-file-storage --path ./backups/wp31-prod-t0.zip` (~6 GB, ~$0,80). Tot de eerste maandelijkse backup is dit de enige kopie van prod met de bestanden.
   Verwacht: `checkLinks` meldt niets (geen mail); `ls -l ./backups/wp31-prod-t0.zip` toont ~5,5-6 GB.
6. **Zelf inloggen** met een TestFlight-build (profiel `production`) tegen prod, met je eigen adres.
   Verwacht: precies 2 groepen, Blob bibliotheek en je groep met 1 album en 2 leden, met albums, foto's en profielfoto's; in Blob bibliotheek spelen de films; het herinneringsalbum, Test group, Familievakantie en testgroep 2 ontbreken. Na T0.7 komt Demo erbij (3).
   Afwijking: een andere groep, of een groep mist → niet indienen; §Terug.
7. **Demo voor Apple** (W4, invariant 12): in de app een groep "Demo" maken, het adres `<naam>+clerk_test@<eigen domein>` uitnodigen als **lid** (geen admin), daarmee inloggen (code 424242) en een paar eigen, niet-persoonlijke foto's in een album zetten.
   Verwacht: het demo-account ziet alleen Demo.
8. **Indienen** in App Store Connect, met *Manually release this version* en gefaseerde release uit. Die keuze geldt per versie: een nieuwe versie (bv. 2.0.1 na een afwijzing) staat standaard weer op automatisch, dus bij **elke** indiening opnieuw nakijken. Inloggegevens voor de reviewer: het demo-adres en code 424242.
   Controle vóór indienen (invariant 13, handmatig: de app weigert een dev-build nog niet zelf): zoek het buildnummer op in het EAS-dashboard (*Builds*); daar moet bij die build profiel `production` staan, niet `dev` (die dient bij dezelfde app in).
   Verwacht: status *Waiting for Review*, daarna *Pending Developer Release*.
   Afwijking: afgewezen → zie §Terug, "Afgewezen review".
9. **Vrijgeven: *Release This Version*. Punt zonder terugkeer** (invariant 15). Niet vlak voor een afgesproken tijd: zichtbaar worden duurt tot 24 uur.
   Verwacht: de versie staat op *Ready for Distribution*, en bij *Pricing and Availability* staan Nederland en België op *Available*.
   Afwijking: weer *Cannot Sell App* → geen bericht aan de leden; *Agreements, Tax, and Banking* en Developer Support zoals bij T-4 weken. De oude app blijft zolang alleen-lezen.
10. **Wachten tot de app echt in de App Store staat**, gecontroleerd op een gewoon toestel (geen TestFlight).
    Controle vlak vóór het bericht: bij *Pricing and Availability* staan Nederland en België op *Available*.
    Dan pas: bericht 4 naar de leden (invariant 14), en bucket `blob-videos` dicht (S3 → Permissions → *Block public access*, alle vier aan).
    Verwacht: een film-link zonder het deel na `?` geeft 403, mét geeft 206; de film speelt in de nieuwe app.
    Afwijking: na 24 uur nog niet te vinden → *Pricing and Availability* nakijken (status per land).
11. **Rem op `reset`, en de backup aan:**
    - de Convex-deploy-key van de migratie intrekken (Convex-dashboard → prod → Settings → Deploy keys) en `MIGRATE_CONVEX_ADMIN_KEY_PROD` uit `.env.migrate` halen. Zonder die key kan geen migrate-commando prod nog wijzigen; een `reset` na de vrijgave zou alles wissen wat leden sindsdien deden. De backup heeft een eigen key; die blijft;
    - repo-variabele `BACKUP_ENABLED` = `true`: vanaf de 1e van de volgende maand draait de backup vanzelf. De gate (met de hand terugzetten) blijft bij T+30.
    Verwacht: `npm run migrate -- verify --target prod` stopt met "MIGRATE_CONVEX_ADMIN_KEY_PROD ontbreekt".
    Na elke review: controleren dat het demo-account nog bestaat (de reviewer kan *Account verwijderen* proberen).

## Terug

- **Vóór T0.9:** beide policies weghalen (de oude app schrijft weer). Prod blijft staan zoals hij is; niemand kan erbij zolang de app niet is vrijgegeven. Dien daarna **niets** in bij Apple: een goedgekeurde versie die (per ongeluk) automatisch vrijkomt, zet leden op een prod zonder wat ze sinds het terugdraaien in de oude app deden. Een volgende poging is een nieuwe ronde vanaf T0.1, met bij T0.3 `MIGRATE_ALLOW_PROD=yes npm run migrate -- reset --target prod --yes --all` (en daarna opnieuw de demo-groep).
- **Afgewezen review:** de oude app blijft alleen-lezen tot een nieuwe build is goedgekeurd. Prod is dan nog actueel, dus opnieuw indienen mag (met *Manually release*, zie T0.8). Grens: twee weken. Daarna terug zoals hierboven, en later opnieuw.
- **Na T0.9:** niet meer terug, en nooit meer `reset` op prod. Leden schrijven dan op prod.

## T+1

- [ ] Alle 19 leden kunnen inloggen (vraag na wie nog niet is gelukt).

## T+30

- [ ] Backup-gate B4: een run met de hand (workflow *Backup*, *Run workflow*; `BACKUP_ENABLED` staat sinds T0.11 aan) en terugzetten in een wegwerp-deployment: [`infra/backup.md`](../../infra/backup.md) stap 4-5.
- [ ] Agenda-herinnering **elk kwartaal**: Actions → *Backup*: de laatste run is groen en de workflow staat niet uit. GitHub zet een geplande workflow uit na 60 dagen zonder activiteit in de repo, en een uitgezette workflow geeft geen rode run, alleen vooraf één mail. Staat hij uit: *Enable workflow* en met de hand draaien.
- [ ] Opruimen (invariant 7), na de backup-gate:
  - `scripts/.data/`: `prod-config.json` en het extract bevatten echte adressen; ook `./backups/wp31-prod-t0.zip`;
  - uit `.env.migrate`: `MIGRATE_CLERK_SECRET_KEY_PROD` en `MIGRATE_CONVEX_URL_PROD` (de admin-key is al weg sinds T0.11);
  - de Clerk-secret-key die je voor `clerk-ids` hebt gebruikt: als het een aparte key was, intrekken (Clerk-dashboard → API keys); `CLERK_SECRET_KEY` op Convex prod blijft;
  - de alleen-lezen AWS-sleutel van `extract`/`load-files` op de server: uit `~/.aws/credentials` en in IAM verwijderen.
  Verwacht: `grep PROD .env.migrate` geeft niets.
- [ ] AWS opruimen, behalve `blob-images` (tot T+90) en `blob-videos` (blijft, de films draaien erop).
- [ ] Na een maand vragen of wekelijks opnieuw inloggen hindert (W8).

## T+90

- [ ] `blob-images` pas weg als een volledige export aantoonbaar is teruggezet (W9).

## Teksten

Kort, in je eigen woorden aan te passen.

1. **T-3 weken.** "Op {datum} gaat de oude app op slot: je kunt dan nog kijken, maar niets meer toevoegen. Een paar dagen later komt de nieuwe app, als gewone update in de App Store. Je logt dan in met je e-mailadres en een code die je per mail krijgt. Klopt het adres waarmee je in de app zit nog? Laat het weten als dat niet zo is."
2. **T-1 dag.** "Morgen gaat de oude app op slot. Upload of nodig vandaag niemand meer uit; wat je na morgen toevoegt, gaat verloren."
3. **T0.1.** "De oude app is nu op slot: kijken kan, toevoegen niet. Zodra de nieuwe app in de App Store staat, hoor je het."
4. **T0.10.** "De nieuwe app staat in de App Store. Werk de app bij (of installeer hem opnieuw), log in met je e-mailadres en de code uit de mail; geen mail binnen een paar minuten? Kijk in je spam, want de code komt van een nieuwe afzender. Je ziet al je groepen, albums en foto's. Eén keer per week vraagt de app opnieuw om een code."
