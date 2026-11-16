# WP31 — draaiboek overstap naar prod (T0)

Het draaiboek voor de overstap van de oude app (AWS) naar de nieuwe (Convex), voor 19 leden. Besluiten en achtergrond: [`WP31`](../work-packages/WP31-cutover.md) §Spec-criticus aanvullingen (W1-W12). Commando's van de migratie: [`wp12-data-migratie.md`](./wp12-data-migratie.md) §Run 2.

Spelregels:
- **Wie:** Wouter doet alles in een extern account (AWS, Clerk, Convex prod, App Store Connect, GitHub-instellingen) en draait de schrijvende migrate-commando's. Claude mag lezen en controleren.
- **Bij afwijking stopt het draaiboek** (invariant 6). "Waarschijnlijk goed" bestaat niet. Kijk dan bij *Afwijking* of bij §Terug.
- **Punt zonder terugkeer:** *Release This Version* in App Store Connect (stap T0.9). Daarvoor is alles terug te draaien; daarna niet zonder dataverlies.
- Een `[ ]` is pas af met de verwachte uitkomst erbij.

## T-4 weken — prod klaarzetten

Alles hieronder laat rijen achter op prod. Dat geeft niets: vóór de repetitie en vóór T0 gaat prod door `reset` (invariant 16).

- [ ] **Convex prod** (EU, Dublin) aanmaken; env-vars zetten: `MAILJET_API_KEY`, `MAILJET_API_SECRET`, `MAILJET_VERIFIED_SENDERS`, `MAILJET_WEBHOOK_SECRET`, `CLUBALMANAC_STAGE=prod`, `CLERK_FRONTEND_API_URL`, `CLERK_WEBHOOK_SECRET`, `CLERK_SECRET_KEY` (`sk_live_…`, WP29), `CLUBALMANAC_APP_STORE_ID=1663038609`, en de vier `FILMS_S3_*` (WP21). **Nog niet** `WEBMASTER_EMAILS` (W12, pas op T0.5).
  Verwacht: `npx convex env list --prod --names-only` toont precies deze namen, en níet `INTEGRATION_TEST_ENABLED` of `INTEGRATION_TEST_SECRET` (WP26).
- [ ] **Release-script** voor `npx convex deploy --prod`: alleen met een schone werkmap op `main`, gelijk aan `origin/main`.
- [ ] **Clerk prod** activeren, op **Hobby** (W8: sessie maximaal 7 dagen, leden loggen wekelijks opnieuw in). Instellingen gelijk aan dev: e-mailcode aan, wachtwoord uit, sign-up aan zonder verplichte naamvelden, bot sign-up protection uit. JWT-template `convex`: claim `email` = `{{user.primary_email_address}}`. Webhook naar `https://<prod>.eu-west-1.convex.site/clerk-webhook` met eigen Svix-secret.
- [ ] **Clerk test mode aan op prod, permanent** (W4, besluit 2026-11-16). Dan logt de reviewer van Apple in met een `+clerk_test`-adres en code 424242, bij elke volgende review ook.
  Verwacht: in het Clerk-dashboard van de prod-instance staat *Test mode* aan.
- [ ] **Mailjet prod:** webhook naar `https://<prod>.eu-west-1.convex.site/email-event` met eigen Basic-auth-secret. Afzender gevalideerd ([`external-services.md`](../conventions/external-services.md) §Mailjet: anders gaat mail stil verloren).
- [ ] **Rooktests:** WP5-gates 1+2 en WP6-gates 1+2+3 op prod ([`wp5-mailjet-empirical-gates.md`](./wp5-mailjet-empirical-gates.md), [`wp6-clerk-empirical-gates.md`](./wp6-clerk-empirical-gates.md); WP6 eerst omzetten naar inloggen met code). Daarna een wegwerp-account uitnodigen, in de app *Account verwijderen*, en in Clerk prod controleren dat de user weg is (WP29).
- [ ] **Cutover-build** met profiel `production` (`pk_live`, prod-URL). Die build wist eenmalig de Clerk-cache-sleutels van de oude `pk_test`-key (WP15a). Gefaseerde release uit (W10).
- [ ] **Backup-bucket en -workflow** klaarzetten: [`infra/backup.md`](../../infra/backup.md) stap 1-3. De eerste run pas na T0.

## T-3 weken — datum en leden

- [ ] Datum van de schrijfstop (T0.1) vastleggen. T0 zelf is de dag van de vrijgave, en die hangt van Apple af.
- [ ] Bericht 1 naar de leden (WhatsApp en mail, tekst in §Teksten). Vraagt ook of hun e-mailadres nog klopt: wie dat niet meer leest, kan op T0 de code niet ontvangen.
  Afwijking: een lid heeft een nieuw adres. Liefst laten inloggen met het oude adres; anders zie WP31 §Edge cases, "Lid zonder bereikbaar adres".

## T-1 week — voorbereiden en repetitie op prod

- [ ] **Herinnering in de oude app** (W2): in Blob bibliotheek een album met een banner, tekst zonder vaste datum ("Nieuwe app komt binnenkort"). Banner eerst via de S3-console onder `public/img/` zetten, dan één record `GA<groepId>` / `A…` met `name`, `photo.url` en `createdAt` (WP31 vraag 2).
  Verwacht: het album staat in je eigen oude app in Blob bibliotheek. Noteer de album-ID voor `excludeAlbumIds`.
- [ ] **Extract en inspect** (alleen lezen): `npm run migrate -- extract`, `npm run migrate -- inspect`.
  Verwacht: 20 users, waarvan John Appleseed het reviewaccount; telling gelijk aan WP31 §Telling, of verklaarbaar.
- [ ] **Clerk pre-create:** de 19 leden (iedereen behalve John Appleseed) via de Clerk Backend API aanmaken op prod, met het adres uit `UBbase.email`, zonder wachtwoord.
  Verwacht: 19 users in Clerk prod, en geen mail bij de leden (invariant 8).
- [ ] **`scripts/.data/prod-config.json`** vullen ([`wp12-data-migratie.md`](./wp12-data-migratie.md) §B): `clerkIdByEmail` met de 19, `excludeUserIds` met John Appleseed, `excludeGroupIds` met "Test group", "Familievakantie", "testgroep 2" en "blob", `excludeAlbumIds` met het herinneringsalbum (W5).
  Verwacht: `transform --target prod` slaagt en drukt onder "uitgesloten via prod-config" één regel per ID af. Een ID die niet in het extract staat, of een uitgesloten user die oprichter is van een groep die meegaat, stopt de transform: corrigeer de config.
- [ ] **Generale repetitie op prod** (W6): T0.2 tot en met T0.7 hieronder, met deze verschillen:
  - schrijfstop (T0.2) op de AWS-**dev**-tabel `blob-images-photos-dev` en bucket `blob-images-dev`, inclusief terugdraaien: schrijfactie geweigerd, policies weg, schrijfactie lukt weer;
  - geen `WEBMASTER_EMAILS` (T0.5);
  - wel de demo-groep, het demo-account en de production-build op TestFlight (T0.7), maar **niet indienen** bij Apple.

  Gate, alles verplicht:
  - `formaten` eindigt met exitcode 0 (blokker B1: de telling is per pagina, nog niet op prod-volume gedraaid);
  - `verify` groen;
  - inloggen als Wouter toont zijn 4 groepen;
  - het album van 540 foto's opent op prod, en scrollen gaat zonder fout (blokker B3: per foto worden de formaten opgevraagd; op dev was het grootste album 302);
  - de doorvoer van `load-files` en de duur van `formaten` noteren (verwacht ~18 en ~70 minuten, W7).

  Afwijking bij B1 of B3: niet naar T0. Meld het aan regie; dat is code.
- [ ] **Na de repetitie prod leegmaken:** `MIGRATE_ALLOW_PROD=yes npm run migrate -- reset --target prod --yes --all`.
  Verwacht: `verify` (baseline) toont 0 rijen. De filmlijst staat nog (valt buiten `reset`) en wijst naar een gewiste groep: op T0.5 opnieuw vullen is daarom verplicht.

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
   Verwacht: een wijziging in je eigen oude app (bv. een albumnaam) geeft een foutmelding, en de dbStream-Lambda heeft daarna 5 minuten geen aanroepen (CloudWatch, *Invocations*). Kijken in de oude app werkt nog.
   Afwijking: de wijziging lukt → policy controleren, niet verder.
3. **Anker en leeg-controle:** `npx convex export --prod --path ./backups/wp31-prod-t0.zip`, en `verify --target prod` (baseline).
   Verwacht: 0 rijen. Anders eerst `reset --target prod --yes --all`.
4. **Migratie**, in deze volgorde, elk met exitcode 0 ([`wp12-data-migratie.md`](./wp12-data-migratie.md) §Run 2 voor de meldingen):
   ```bash
   export MIGRATE_ALLOW_PROD=yes
   npm run migrate -- extract
   npm run migrate -- transform --target prod
   npm run migrate -- load-files --target prod     # ~18 min
   npm run migrate -- load-records --target prod
   npm run migrate -- formaten --target prod       # ~70 min, hervatbaar
   npm run migrate -- verify --target prod
   ```
   Verwacht: `load-files` zonder ontbrekende bestanden (een ontbrekend bestand na de schrijfstop is een stop, geen `--accept-missing-files`, invariant 10); `formaten` "klaar", exit 0; `verify` groen.
5. **Na een groene `verify`:**
   - `WEBMASTER_EMAILS` op prod zetten (W12);
   - filmlijst vullen: `node scripts/wp21/seedArgs.ts --group <prod-id van "Blob bibliotheek">`, dan het geprinte `--prod`-commando (`films:replaceAll`); daarna `npx convex run --prod films:checkLinks`.
   Verwacht: `checkLinks` meldt niets (geen mail).
6. **Zelf inloggen** met een TestFlight-build (profiel `production`) tegen prod, met je eigen adres.
   Verwacht: je 4 groepen, met albums, foto's en profielfoto's; in Blob bibliotheek spelen de films; het herinneringsalbum, Test group en de drie lege groepen ontbreken.
7. **Demo voor Apple** (W4, invariant 12): in de app een groep "Demo" maken, het adres `<naam>+clerk_test@<eigen domein>` uitnodigen als **lid** (geen admin), daarmee inloggen (code 424242) en een paar eigen, niet-persoonlijke foto's in een album zetten.
   Verwacht: het demo-account ziet alleen Demo.
8. **Indienen** in App Store Connect, met *Manually release this version* en gefaseerde release uit. Inloggegevens voor de reviewer: het demo-adres en code 424242.
   Controle vóór indienen (invariant 13): het buildnummer hoort bij een EAS-build met profiel `production`, niet `dev` (die dient bij dezelfde app in).
   Verwacht: status *Waiting for Review*, daarna *Pending Developer Release*.
   Afwijking: afgewezen → zie §Terug, "Afgewezen review".
9. **Vrijgeven: *Release This Version*. Punt zonder terugkeer** (invariant 15). Niet vlak voor een afgesproken tijd: zichtbaar worden duurt tot 24 uur.
10. **Wachten tot de app echt in de App Store staat**, gecontroleerd op een gewoon toestel (geen TestFlight).
    Dan pas: bericht 4 naar de leden (invariant 14), en bucket `blob-videos` dicht (S3 → Permissions → *Block public access*, alle vier aan).
    Verwacht: een film-link zonder het deel na `?` geeft 403, mét geeft 206; de film speelt in de nieuwe app.
11. `unset MIGRATE_ALLOW_PROD`. Na elke review: controleren dat het demo-account nog bestaat (de reviewer kan *Account verwijderen* proberen).

## Terug

- **Vóór T0.9:** beide policies weghalen (de oude app schrijft weer). Prod blijft staan zoals hij is; niemand kan erbij zolang de app niet is vrijgegeven. Een volgende poging begint bij T0.3 met `reset --target prod --yes --all` (en daarna opnieuw de demo-groep).
- **Afgewezen review:** de oude app blijft alleen-lezen tot een nieuwe build is goedgekeurd. Grens: twee weken. Daarna terug zoals hierboven, en later opnieuw.
- **Na T0.9:** niet meer terug. Leden schrijven dan op prod.

## T+1

- [ ] Alle 19 leden kunnen inloggen (vraag na wie nog niet is gelukt).

## T+30

- [ ] Eerste backup met de hand (workflow *Backup*, *Run workflow*) en terugzetten in een wegwerp-deployment: [`infra/backup.md`](../../infra/backup.md) stap 4-5 (gate B4). Daarna draait hij elke maand.
- [ ] `scripts/.data/` opruimen: `prod-config.json` en het extract bevatten echte adressen (invariant 7). Eerst de backup-gate.
- [ ] AWS opruimen, behalve `blob-images` (tot T+90) en `blob-videos` (blijft, de films draaien erop).
- [ ] Na een maand vragen of wekelijks opnieuw inloggen hindert (W8).

## T+90

- [ ] `blob-images` pas weg als een volledige export aantoonbaar is teruggezet (W9).

## Teksten

Kort, in je eigen woorden aan te passen.

1. **T-3 weken.** "Op {datum} gaat de oude app op slot: je kunt dan nog kijken, maar niets meer toevoegen. Een paar dagen later komt de nieuwe app, als gewone update in de App Store. Je logt dan in met je e-mailadres en een code die je per mail krijgt. Klopt het adres waarmee je in de app zit nog? Laat het weten als dat niet zo is."
2. **T-1 dag.** "Morgen gaat de oude app op slot. Upload of nodig vandaag niemand meer uit; wat je na morgen toevoegt, gaat verloren."
3. **T0.1.** "De oude app is nu op slot: kijken kan, toevoegen niet. Zodra de nieuwe app in de App Store staat, hoor je het."
4. **T0.10.** "De nieuwe app staat in de App Store. Werk de app bij (of installeer hem opnieuw), log in met je e-mailadres en de code uit de mail. Je ziet al je groepen, albums en foto's. Eén keer per week vraagt de app opnieuw om een code."
