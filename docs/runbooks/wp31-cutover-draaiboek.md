# WP31 — draaiboek overstap naar prod (T0)

Het draaiboek voor de overstap van de oude app (AWS) naar de nieuwe (Convex), voor 19 leden. Besluiten en achtergrond: [`WP31`](../work-packages/WP31-cutover.md) §Spec-criticus aanvullingen (W1-W12). Commando's van de migratie: [`wp12-data-migratie.md`](./wp12-data-migratie.md) §Run 2.

Spelregels:
- **Wie:** Wouter doet alles in een extern account (AWS, Clerk, Convex prod, App Store Connect, GitHub-instellingen) en draait de schrijvende migrate-commando's. Claude mag lezen en controleren.
- **Bij afwijking stopt het draaiboek** (invariant 6). "Waarschijnlijk goed" bestaat niet. Kijk dan bij *Afwijking* of bij §Terug.
- **Punt zonder terugkeer:** *Release This Version* in App Store Connect (stap T0.9). Daarvoor is alles terug te draaien; daarna niet zonder dataverlies.
- Een `[ ]` is pas af met de verwachte uitkomst erbij.

## T-4 weken — prod klaarzetten

Alles hieronder laat rijen achter op prod. Dat geeft niets: vóór de repetitie en vóór T0 gaat prod door `reset` (invariant 16).

- [x] **Convex prod** (EU, Dublin) aanmaken; env-vars zetten: `MAILJET_API_KEY`, `MAILJET_API_SECRET`, `MAILJET_VERIFIED_SENDERS`, `MAILJET_WEBHOOK_SECRET`, `CLUBALMANAC_STAGE=prod`, `CLERK_FRONTEND_API_URL`, `CLERK_WEBHOOK_SECRET`, `CLERK_SECRET_KEY` (`sk_live_…`, WP29), `CLUBALMANAC_APP_STORE_ID=1663038609`, en de vier `FILMS_S3_*` (WP21) met de sleutel van een eigen IAM-user die alleen `s3:GetObject` op `blob-videos/*` mag. **Nog niet** `WEBMASTER_EMAILS` (W12, pas op T0.5). Mailjet: dezelfde `MAILJET_API_KEY`, `MAILJET_API_SECRET` en `MAILJET_VERIFIED_SENDERS` als dev (één primary key, [`external-services.md`](../conventions/external-services.md) §Mailjet punt 3); alleen `MAILJET_WEBHOOK_SECRET` is eigen. *Gedaan 2026-11-16* (deafening-shark-296).
  Verwacht: `npx convex env list --prod --names-only` toont precies deze namen, en níet `INTEGRATION_TEST_ENABLED` of `INTEGRATION_TEST_SECRET` (WP26).
- [x] **Deploy-keys van prod**, elk met een eigen naam en alleen de rechten die hij nodig heeft (dashboard: prod → Settings → Deploy Keys → *Create Deploy Key*, *No expiration*): `migratie` met `deployment:functions:runInternalQueries`, `…runInternalMutations` en `…runInternalActions` (`.env.migrate`, [`wp12-data-migratie.md`](./wp12-data-migratie.md) §A); `backup` met `deployment:backups:view`, `…:create`, `…:download` en `deployment:env:view` (GitHub-environment `prod-backup`, [`infra/backup.md`](../../infra/backup.md) stap 2). Geen key `release`: deployen gaat met je Convex-login (volgende punt). Een sleutel zie je één keer; kwijt = verwijderen en opnieuw maken. *Gedaan 2026-11-16.*
  Verwacht: in het dashboard staan bij prod alleen keys met deze namen.
- [x] **Backend op prod zetten** met `npm run deploy:prod` ([`scripts/deploy-prod.sh`](../../scripts/deploy-prod.sh)), in een eigen clone die alleen hiervoor is (bv. `~/Code/clubalmanac-v2-release`), niet in de werk-checkout: daar werken meerdere sessies, en `npx convex deploy` zet ook niet-gecommitte code op prod. Het script weigert buiten een schone `main` die gelijk is aan `origin/main`. Na elke merge die de backend raakt opnieuw.
  Zo, in de release-clone (de server is met je Convex-account ingelogd; de dev-naam wijst alleen het project aan, de deploy gaat naar prod):
  ```bash
  cd ~/Code/clubalmanac-v2-release && git pull
  CONVEX_DEPLOYMENT=dev:glorious-pheasant-759 npm run deploy:prod
  ```
  Geen deploy-key in de shell plakken via de telefoon-app: die stuurt een Escape-teken mee, en dan geeft `npx convex deploy` alleen `TypeError: fetch failed`. *Gedaan 2026-11-16 (63954cb).*
  Verwacht: `npx convex deploy` noemt de prod-deployment en eindigt zonder fout.
- [x] **Clerk prod** activeren, op **Hobby** (W8: sessie maximaal 7 dagen, leden loggen wekelijks opnieuw in). Instellingen gelijk aan dev: e-mailcode aan, wachtwoord uit, sign-up aan zonder verplichte naamvelden, bot sign-up protection uit (heet nu *Challenge suspicious sign-ups*, Configure → Protections: *Inactive*; daar ook *Block email subaddresses* op *Inactive* laten, anders werkt `+clerk_test` niet; *Prevent user enumeration* staat op *Active*, net als dev), *Verification required before session* aan (Configure → Email address; standaard aan, de webhook rekent erop, WP6). JWT-template `convex`: claim `email` = `{{user.primary_email_address}}`. Webhook naar `https://<prod>.eu-west-1.convex.site/clerk-webhook` met eigen Svix-secret. *Gedaan 2026-11-16/17.*
- [x] **Clerk test mode aan op prod, permanent** (W4, besluit 2026-11-16). Dan logt de reviewer van Apple in met een `+clerk_test`-adres en code 424242, bij elke volgende review ook.
  Verwacht: in het Clerk-dashboard van de prod-instance staat *Test mode* aan.
  Restrisico (besluit staat): iedereen kan zich aanmelden met een `+clerk_test`-adres en code 424242, zonder mailbox, en bot sign-up protection staat uit. Zulke accounts tellen mee in de MAU van Clerk en zijn te scripten. Ze zien niets: zonder uitnodiging maakt de app geen user-rij (WP19b). Het demo-adres plus 424242 is een blijvend wachtwoord dat bij Apple ligt; het demo-account ziet alleen Demo. Kijk eens per kwartaal in Clerk prod → *Users* of er onbekende accounts bijkomen.
- [x] **Mailjet prod:** webhook naar `https://<prod>.eu-west-1.convex.site/email-event` met eigen Basic-auth-secret: Mailjet → app.mailjet.com/account/triggers (*Event notifications (webhooks)*; niet te vinden via de menu's), URL bij *Bounce* vervangen, *Apply url to all events*, *Group events* aan, *Save*. Mailjet heeft één URL per account: sinds 2026-11-16 krijgt dev geen bounce-meldingen meer. Afzender gevalideerd ([`external-services.md`](../conventions/external-services.md) §Mailjet: anders gaat mail stil verloren); zelfde account en domein als dev. *Gedaan 2026-11-16.*
- [x] **Inlogtest op prod** met de cutover-build (2026-11-17): eerst "Verbinden met de server lukt niet", want `convex/auth.config.ts` had het adres van dev-Clerk vast in de code (sinds fase 1; opgelost in #28: de issuer komt uit `CLERK_FRONTEND_API_URL`). Daarna, na een nieuwe deploy: inlogcode komt aan, en de app toont "Je hebt eerst een uitnodiging nodig". Daarna de eigen Clerk-user in Clerk prod verwijderd (anders telt de pre-create 18 in plaats van 19).
  De overige rooktests (uitnodigen, bounce, account verwijderen) staan in de gate van de generale repetitie: prod is nu leeg, en zonder lid met groep kan niemand uitnodigen (besluit Wouter 2026-11-17).
- [ ] **"Cannot Sell App" oplossen. Begin hier als eerste: dit kan weken duren.** Stand 2026-11-16 (App Store Connect → app → *Pricing and Availability*): de app staat aan in België, Luxemburg, Nederland, Zwitserland en het VK, alle vijf met status *Cannot Sell App*; alle andere landen *Not Available*. Zolang dat zo is, komt ook de nieuwe versie bij geen enkel lid aan.
  1. App Store Connect → *Business* (*Agreements, Tax, and Banking*): staat de *Free Apps Agreement* op *Active*? Een verlopen of nog niet geaccepteerde overeenkomst is de gebruikelijke oorzaak. Accepteer wat openstaat (alleen de Account Holder kan dat).
  2. De Digital Services Act op twee plekken, ter vergelijking met de stand van 2026-11-16:
     - account: *Business* → *Agreements* → *Compliance* → *Digital Services Act*: *Active* sinds 16 Aug 2024, 27 landen;
     - app: *App Information* → *App Store Regulations & Permits*: "This developer has identified itself as a trader for this app."
     Zo staat het, dan is de DSA niet de oorzaak. Wijzig de traderstatus niet vóór T0.
  3. Is alles daar actief en blijft *Cannot Sell App* staan: Apple Developer Support (developer.apple.com/contact), onderwerp App Store Connect, met de app-ID `1663038609` en de melding. Antwoord kan dagen duren.
  Verwacht: elk aangezet land waar een lid woont op *Available* (minstens Nederland en België; vraag bij bericht 1 na of iemand in Luxemburg, Zwitserland of het VK woont), ruim vóór de datum van de schrijfstop (T-3 weken). Daarmee is ook 1.6.0 tot T0 weer te downloaden; dat is geen probleem.
  Afwijking: op T-3 weken nog *Cannot Sell App* → de datum van de schrijfstop nog niet vastleggen. Zonder verkoop is er geen T0.
- [ ] **Cutover-build** met profiel `production` (`pk_live`, prod-URL). Die build wist eenmalig de Clerk-cache-sleutels van de oude `pk_test`-key (WP15a). Gefaseerde release uit (W10). Vooraf in Expo (expo.dev → project → Environment variables, omgeving *production*, visibility *Plain text*): `EXPO_PUBLIC_CONVEX_URL` = `https://deafening-shark-296.eu-west-1.convex.cloud` en `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` = `pk_live_…`. Bouwen vanuit de release-clone:
  ```bash
  cd ~/Code/clubalmanac-v2-release/app && npm ci && npx eas-cli build --platform ios --profile production --auto-submit
  ```
  Verwacht: de build-log noemt beide variabelen uit de omgeving *production*; de build staat in TestFlight. De waarschuwing over Expo Go is onschuldig.
- [x] **Backup-bucket en -workflow** klaarzetten: [`infra/backup.md`](../../infra/backup.md) stap 1-3. Repo-variabele `BACKUP_ENABLED` **niet** zetten: zonder die variabele slaat de workflow elke run over (grijs, niet rood). Prod is tot T0 leeg of bevat de repetitie. *Gedaan 2026-11-16.*
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
- [ ] **Uitzondering in de schrijfstop opzoeken** (alleen lezen, AWS-prod). De tabel-policy van T0.2 laat alleen de stream-Lambda van `blob-images-api` door, niet de hele rol: bij Serverless delen alle functies van een service vaak één rol, ook handlers en Cognito-triggers zoals `cognitoSync`. Een Lambda neemt zijn rol aan met de functienaam als sessienaam; daarop zit de uitzondering. Noteer:
  - de naam van de stream-functie en zijn rol (Lambda → functie → Configuration → Permissions);
  - de `RoleId` van die rol (begint met `AROA`):
    ```bash
    aws iam get-role --role-name <rolnaam> --query Role.RoleId --output text
    ```
  Ter informatie, welke functies dezelfde rol delen (die worden tijdens de stop allemaal geweigerd):
  ```bash
  aws lambda list-functions --region eu-central-1 \
    --query "Functions[?Role=='<rol-ARN>'].FunctionName" --output text
  ```
  Doe hetzelfde op AWS-dev voor de repetitie.
  Verwacht: een `RoleId` en een functienaam, ingevuld in de policy van T0.2.
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
  - **rooktests** (WP5, WP6, WP29), in build met profiel `production`, met een wegwerp-adres dat je leest en dat geen lid is (geen mail naar leden, invariant 8):
    - uitnodigen vanuit je eigen groep: de mail komt van `invites@clubalmanac.com`, niet in spam;
    - uitloggen, inloggen met het wegwerp-adres: de groep staat er; nog eens uit- en inloggen geeft geen tweede user (Convex → Data → `users`);
    - een uitnodiging naar een niet-bestaand adres bij een echte provider (bv. `bestaat-niet-<willekeurig>@gmail.com`): binnen enkele minuten staat die uitnodiging op verlopen (`invites`: `status: "expired"`, `bouncedAt` gezet), en jij krijgt de mail dat hij niet aankwam;
    - met het wegwerp-account in de app *Account verwijderen*: de user is weg in Clerk prod (*Users*) en in Convex (`users`).

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
         "Condition": { "StringNotLike": { "aws:userid": "<RoleId>:<naam van de stream-functie>" } }
       }]
     }
     ```
     `RoleId` en functienaam komen uit T-1 week. Alleen de stream-Lambda mag nog schrijven, zodat een cascade die bij de stop al liep niet halverwege blijft hangen. Alle andere functies met dezelfde rol (handlers, `cognitoSync`) worden geweigerd; maak tijdens de stop dus ook geen user aan in de Cognito-console.
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
   Verwacht: de versie staat op *Ready for Distribution*, en bij *Pricing and Availability* staat elk land waar een lid woont op *Available* (minstens Nederland en België).
   Afwijking: weer *Cannot Sell App* → geen bericht aan de leden; *Agreements, Tax, and Banking* en Developer Support zoals bij T-4 weken. De oude app blijft zolang alleen-lezen.
10. **Wachten tot de app echt in de App Store staat**, gecontroleerd op een gewoon toestel (geen TestFlight).
    Controle vlak vóór het bericht: bij *Pricing and Availability* staat elk land waar een lid woont op *Available*, niet alleen Nederland en België.
    Dan pas: bericht 4 naar de leden (invariant 14), en bucket `blob-videos` dicht (S3 → Permissions → *Block public access*, alle vier aan).
    Verwacht: een film-link zonder het deel na `?` geeft 403, mét geeft 206; de film speelt in de nieuwe app.
    Afwijking: na 24 uur nog niet te vinden → *Pricing and Availability* nakijken (status per land).
11. **Rem op `reset`, en de backup aan:**
    - de deploy-key **`migratie`** intrekken (Convex-dashboard → prod → Settings → Deploy keys), alleen die, en `MIGRATE_CONVEX_ADMIN_KEY_PROD` uit `.env.migrate` halen. Zonder die key kan geen migrate-commando prod nog wijzigen; een `reset` na de vrijgave zou alles wissen wat leden sindsdien deden. `backup` blijft;
    - repo-variabele `BACKUP_ENABLED` = `true`: vanaf de 1e van de volgende maand draait de backup vanzelf. De gate (met de hand terugzetten) blijft bij T+30.
    Verwacht: `npm run migrate -- verify --target prod` stopt met "MIGRATE_CONVEX_ADMIN_KEY_PROD ontbreekt".
    Na elke review: controleren dat het demo-account nog bestaat (de reviewer kan *Account verwijderen* proberen).

## Terug

- **Vóór T0.9:** eerst de ingediende versie intrekken: op *Waiting for Review* of *In Review* met *Remove from Review*, op *Pending Developer Release* met *Developer Reject*. Dan kan hij niet alsnog per ongeluk worden vrijgegeven. Daarna beide policies weghalen (de oude app schrijft weer). Prod blijft staan zoals hij is; niemand kan erbij zolang de app niet is vrijgegeven. Dien daarna **niets** in bij Apple: een goedgekeurde versie die (per ongeluk) automatisch vrijkomt, zet leden op een prod zonder wat ze sinds het terugdraaien in de oude app deden. Een volgende poging is een nieuwe ronde vanaf T0.1, met bij T0.3 `MIGRATE_ALLOW_PROD=yes npm run migrate -- reset --target prod --yes --all` (en daarna opnieuw de demo-groep).
- **Afgewezen review:** de oude app blijft alleen-lezen tot een nieuwe build is goedgekeurd. Prod is dan nog actueel, dus opnieuw indienen mag (met *Manually release*, zie T0.8). Grens: twee weken. Daarna terug zoals hierboven, en later opnieuw.
- **Na T0.9:** niet meer terug, en nooit meer `reset` op prod. Leden schrijven dan op prod.

## T+1

- [ ] Alle 19 leden kunnen inloggen (vraag na wie nog niet is gelukt).

## Een week na T0.10

- [ ] Backup-gate B4: een run met de hand (workflow *Backup*, *Run workflow*; `BACKUP_ENABLED` staat sinds T0.11 aan) en terugzetten in een wegwerp-deployment: [`infra/backup.md`](../../infra/backup.md) stap 4-5. Niet wachten tot T+30: tot deze run is het anker van T0.5 de enige kopie, en wat leden sindsdien deden staat nergens anders.

## T+30

- [ ] Agenda-herinnering **elk kwartaal**: Actions → *Backup*: de laatste run is groen en de workflow staat niet uit. GitHub zet een geplande workflow uit na 60 dagen zonder activiteit in de repo, en een uitgezette workflow geeft geen rode run, alleen vooraf één mail. Staat hij uit: *Enable workflow* en met de hand draaien.
- [ ] Opruimen (invariant 7), na de backup-gate van een week na T0.10:
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
