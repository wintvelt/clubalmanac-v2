# WP31: Overstap naar prod (fase 5, hard cutover)

> Draft regie 2026-11-15. A vult onderaan aan. Dit WP levert vooral een draaiboek en controles; code alleen waar het draaiboek een gat heeft (bv. de cutover-groep in de transform, een preview-modus).

## Productdoel

Op T0 installeren de ~20 leden de nieuwe app, loggen in met hun eigen e-mailadres en zien precies hun eigen groepen, albums, foto's, profielfoto's en (in Blob bibliotheek) de films, zoals ze die in de oude app zagen. Er gaat niets verloren dat vóór de stop in de oude app stond, en niemand ziet iets wat hij daar niet zag.

## Invarianten

1. **Niets verloren.** Elke groep, elk album, elke foto, elk lidmaatschap en elke openstaande uitnodiging die bij de stop in de oude backend stond, staat na T0 op prod (of staat op een lijst met een besluit van Wouter, zoals de likes van WP19a). "Elke" betekent ook: foto's van ex-leden die nog in een groep gepubliceerd staan, covers, gemelde foto's, profielfoto's.
2. **Geen schrijfactie na de laatste export.** De oude backend weigert schrijfacties vóórdat de laatste `extract` begint. Wat daarna nog geschreven had kunnen worden, kan niet.
3. **Niemand ziet meer dan vroeger.** Elke user ziet op prod alleen de groepen waarvan hij in de oude backend lid was. Het review-account van Apple ziet alleen demo-inhoud, nooit ledendata.
4. **De nieuwe app bereikt leden pas op T0.** Tussen goedkeuring door Apple en T0 kan geen lid de nieuwe app installeren of bijwerken en op een lege of halfgevulde prod uitkomen.
5. **Terug kan tot het punt zonder terugkeer.** Tot de app vrijgegeven is, kan de overstap stoppen zonder dat leden iets merken: de oude app werkt weer (schrijven aan), prod blijft dicht. Het punt zonder terugkeer staat expliciet in het draaiboek.
6. **Geen stille fout.** Elke stap heeft een controle met een verwacht resultaat (aantal, statuscode, mail ontvangen). Bij afwijking stopt het draaiboek; er is geen "waarschijnlijk goed".
7. **Prod-sleutels alleen waar ze horen.** Live-sleutels (Clerk, Mailjet, S3-films, Convex deploy-key) staan alleen in de prod-env of in de lokale gitignored config van de migratie, en die config wordt na T0 opgeruimd. Geen test-functies op prod (WP26).
8. **Geen mail naar leden vóór T0.** Pre-create van Clerk-users en het laden van uitnodigingen sturen geen mail. De eerste mail die een lid krijgt, is de inlogcode die hij zelf aanvraagt.
9. **Kosten.** Prod blijft binnen €15 per maand (Convex, Clerk, Mailjet, AWS samen), ook met 5,6 GB foto's plus formaten.

## Scope

- **In scope:** het hele stappenplan van [`migratie-status.md` §Cutover stappenplan](../migratie-status.md), van T-4 weken tot T+30; de volgorde en controles; een generale repetitie; teksten voor de leden; de backup-keuze.
- **Bewust niet:** een nieuwe webapp (na T0, besluit 2026-11-15); R2 voor de films; parallel draaien of dual-write (plan: hard cut).

## Open vragen voor A (oude backend lezen, rapporteren aan regie)

1. **Schrijfstop.** Hoe zet je de oude backend op alleen-lezen: feature-flag in `blob-images-common`, IAM op DynamoDB, of iets anders? Wat merkt een lid in de oude app? Blokkeert het ook uploads naar S3, aanmelden via Cognito, en uitnodigingen accepteren? Is het terug te draaien in minuten?
2. **Cutover-groep.** Hoe ziet een groep met cover en lidmaatschap eruit in DynamoDB, en verschijnt hij zonder app-update bij iedereen? Belangrijk: hoe houden we hem buiten de `extract`/`transform`, zodat hij niet mee naar prod gaat?
3. **Volgorde op T0.** Het huidige stappenplan zet de schrijfstop ná de laatste `extract`. Klopt de volgorde in [`wp12-data-migratie.md`](../runbooks/wp12-data-migratie.md) met invariant 2?
4. **Demo-account voor Apple.** De review vraagt een account met zichtbare inhoud op prod, vóór T0. Hoe past demo-data op prod met `load-records` en `verify` (die tellen rijen tegen de bron)? Alternatief: review tegen een aparte omgeving, of demo-data die `verify` kent.
5. **Vrijgave.** Kan App Store Connect een goedgekeurde versie vasthouden tot een handmatige release op T0 (invariant 4)? Wat gebeurt er met de oude app op toestellen van leden die automatisch bijwerken?
6. **Clerk pre-create.** Welke e-mailadressen (Cognito vs DynamoDB), dubbelen, hoofdletters, en leden zonder bevestigd adres? Gaat er geen mail uit (invariant 8)?
7. **Uitnodigingen in de lucht.** Openstaande uitnodigingen van de oude backend: gaan ze mee, en werkt de link uit een oude mail na T0 nog of niet? Wat ziet de ontvanger?
8. **Generale repetitie.** Waar draaien we de volledige T-2 + T0-run vóór prod: een tweede Convex-project of een extra deployment, met welke Clerk-instance? Wat kost dat? Tel ook opnieuw (doorvoer upload, aantallen; [`data-migration-preflight.md`](../conventions/data-migration-preflight.md) §Re-verificatie).
9. **Backup.** Convex Starter heeft alleen handmatige back-ups (max 2). Vaste export-routine na T0 of Pro? Kosten van Pro tegen het budget.
10. **Kosten prod.** Reken Convex (opslag foto's + formaten, bandbreedte voor ~20 leden), Clerk (prod, aantal MAU), Mailjet (limiet per dag) en de AWS-resten (S3 tot T+90, films) uit tegen €15 per maand.

## Risico-assessment

- **security/privacy: hoog** — echte ledendata en foto's naar prod; live sleutels in vier accounts; een review-account van buiten; pre-create van users.
- **ops: hoog** — eenmalige overstap met stille foutmodi (Mailjet zonder gevalideerde afzender, Clerk-instellingen die op dev anders staan, crons die op een lege prod alarm slaan); Apple-review met onzekere doorlooptijd.
- **external deps: hoog** — Apple (app uit de verkoop, nieuwe versie), Clerk prod, Mailjet prod, Convex prod, AWS (schrijfstop, cutover-groep, films). Alle schrijfacties daar doet Wouter zelf.
- **multi-user/concurrency: middel** — leden die rond T0 nog uploaden of uitnodigen; volgorde schrijfstop en export.
- **data/schema-evolutie: hoog** — onomkeerbare import op prod. Pre-flight per [`data-migration-preflight.md`](../conventions/data-migration-preflight.md); generale repetitie is een harde gate vóór de prod-run.
- **ops-runbook-impact:** alles landt in `migratie-status.md` §Cutover stappenplan en [`wp12-data-migratie.md`](../runbooks/wp12-data-migratie.md); env-vars per service in [`external-services.md`](../conventions/external-services.md).

## Aanpak

Setup 2 + 6 + 5: A (spec-criticus, leest de oude backend) → besluiten Wouter → draaiboek en eventuele code (B) → red-team op het draaiboek ("wat als stap N halverwege faalt") → generale repetitie → T-4 weken en verder met Wouter als uitvoerder.

## Cross-refs

- [`migratie-status.md`](../migratie-status.md) §Fase 5 (mechanieken, stappenplan), §Monitoring & backup
- [`migratie-plan-convex.md`](../migratie-plan-convex.md) §Cutover-mechanieken
- [`wp12-data-migratie.md`](../runbooks/wp12-data-migratie.md) (Run 2 — prod), [`wp5-mailjet-empirical-gates.md`](../runbooks/wp5-mailjet-empirical-gates.md), [`wp6-clerk-empirical-gates.md`](../runbooks/wp6-clerk-empirical-gates.md)
- WP12/WP12b (migratie), WP25 (formaten), WP19a (likes), WP21 (films, bucket dicht), WP26 (test-functies), WP29 (`CLERK_SECRET_KEY`), WP15a (sessieduur)
- Oude AWS-code (alleen A): `blob-images-common`, `blob-images-api*`, oude app `clubalmanac-app`

## Acceptance

- Draaiboek met per stap: wie, wat, verwachte uitkomst, en wat te doen bij afwijking. Het punt zonder terugkeer staat erin.
- Red-team op het draaiboek gedaan; bevindingen verwerkt of door Wouter geaccepteerd.
- Generale repetitie groen: volledige run op een aparte omgeving, `verify` groen, inloggen als een gemigreerde test-user toont de juiste groepen.
- Op T0: `verify` groen, alle leden kunnen inloggen (T+1), de films spelen, de bucket is dicht.

---

## Spec-criticus aanvullingen (A, 2026-11-15)

Bronnen: de oude backend en app in `~/Code/v1/` (paden hieronder relatief daaraan), het extract van 2026-11-06, een alleen-lezen telling in AWS op 2026-11-15 (scripts in `scripts/.data/wp31-a/`, gitignored), en de docs van Apple, Clerk, Convex en AWS (links onderaan).

**Telling 2026-11-15** (DynamoDB-scan + S3-lijst, niets geschreven): 3216 items, per soort gelijk aan het extract van 11-06. De laatste nieuwe record is van 2026-01-17: er is tien maanden niets geüpload, uitgenodigd of aangemaakt. 20 users, waarvan 19 echte leden. 0 open uitnodigingen (3 verlopen, uit 2020 en 2023). S3 `blob-images`: 1601 objecten, 5,61 GB. 3 bezoeken in november. Grootste album: 540 foto's (op dev 302).

### Beslissingen voor Wouter

| # | Vraag | Advies |
|---|---|---|
| W1 | Hoe zet je de oude backend op alleen-lezen? | Twee policies, geen code. Op de DynamoDB-tabel een resource policy die alle schrijfacties weigert, behalve voor de rol van de stream-Lambda. Op de bucket een extra statement dat `PutObject` en `DeleteObject` onder `protected/` weigert. Terugdraaien is beide weghalen, binnen minuten. Een feature-flag in `blob-images-common` valt af: dat zijn zes services opnieuw deployen op Node 12, 14 en 18, met een oude toolchain. |
| W2 | Welke herinnering in de oude app? | Een album "Nieuwe app op {datum}" in Blob bibliotheek, naast WhatsApp en mail. Geen cutover-groep: de oude app opent op de laatst bezochte groep (`clubalmanac-app/screens/Navigator.jsx:280-283`), dus een nieuwe groep zie je pas onder Mijn groepen. 18 van de 19 leden zitten in Blob bibliotheek. De transform sluit het album uit (W5). |
| W3 | Apple-review vóór of ná het laden? | Ná. Volgorde: schrijfstop, laden, `verify`, demo-account, indienen met handmatige release, en bij goedkeuring vrijgeven (dat is T0). De oude app is tijdens de review alleen-lezen. Daar merken leden weinig van, want er wordt al tien maanden niets geschreven. Vóór het laden kan alleen met extra code: een lege prod heeft geen groep om de reviewer in uit te nodigen, en `load-records` eist een lege prod. |
| W4 | Hoe logt de reviewer van Apple in? | Inloggen gaat alleen met een code per mail, en die kan de reviewer niet ontvangen. Advies: zet Clerk *Test mode* op prod alleen aan tijdens een review. Maak een demo-account `<naam>+clerk_test@<eigen domein>` (vaste code 424242), dat gewoon lid (geen admin) is van alleen een groep Demo. Clerk raadt test mode op prod af, omdat dan iedereen met een `+clerk_test`-adres een Clerk-account krijgt. In de app komt zo iemand niet zonder uitnodiging (WP19b), en de webmaster-check vergelijkt het adres exact (`convex/lib/auth.ts:54-61`). Dit herhaalt zich bij elke volgende app-update, want die gaat ook door review. **Besluit Wouter 2026-11-16:** demo-account met `+clerk_test` zoals geadviseerd, maar test mode blijft op prod permanent aan. Dan hoeft er bij een update niets om. |
| W5 | Wie en wat gaat niet mee? | Sluit uit: John Appleseed, zijn groep "Test group" (2 albums, 30 foto's, allemaal van hem) en het herinneringsalbum. Zonder uitsluiting stopt de transform op prod: JA krijgt geen Clerk-account, en `transform` eist er een voor elke user. Daar is code voor nodig (tests in deze WP). Alle andere leden gaan mee, ook wie al jaren niet kwam; dat kost niets. Drie groepen zonder albums met één lid (twee van Wouter, één van een ander lid): jouw keuze. **Besluit Wouter 2026-11-16:** die drie ("Familievakantie", "testgroep 2", "blob") gaan ook niet mee, via `excludeGroupIds`. |
| W6 | Waar draait de generale repetitie? | Op prod zelf, een week voor T0, daarna `reset --target prod --yes --all`. Live sleutels, de instellingen van Clerk-prod, de rechten van de deploy-key en de env-vars test je alleen daar; de tooling zelf draaide al vaak op dev. Een aparte omgeving kost ook weinig (minder dan $1), maar test juist die dingen niet. Niemand kan bij prod zolang de app niet vrijgegeven is. Dit wijkt af van de acceptance ("aparte omgeving"). |
| W7 | Mag de T-2-split weg? | Ja, alles op één dag. Uploaden van 5,61 GB duurt bij de laatste meting (5,36 MB/s, 2026-11-13, `scripts/.data/wp19a-b-loadfiles.log`) ongeveer 18 minuten, `formaten` ongeveer 70. Daarmee vervallen de T-2-extract, `prune-storage` en twee weken storage zonder records. |
| W8 | Hoe lang blijft een lid ingelogd? | Op Clerk Hobby (gratis) duurt een sessie op prod maximaal 7 dagen: elk lid logt elke week opnieuw in met een code. Langer kan alleen met Clerk Pro ($25 per maand, $20 bij jaarbetaling), en dat past niet in het budget. Advies: start op Hobby en vraag na een maand of het hindert. De stap "sessieduur kiezen" (T-4) vervalt. Op dev zie je dit niet, want daar is het gratis. **Besluit Wouter 2026-11-16:** Hobby. Wekelijks opnieuw inloggen is vervelend, maar geen $20-25 per maand waard. |
| W9 | Backup? | Geen Convex Pro ($25 per developer per maand). Maak na T0 één volledige export met bestanden als anker. Daarna elke maand een export zonder bestanden en elk kwartaal één met, op de server buiten de repo. Zet één export als test terug in een wegwerp-deployment. S3 `blob-images` blijft staan tot een volledige export aantoonbaar terug te zetten is, minstens tot T+90. **Besluit Wouter 2026-11-16:** automatisch via GitHub (B4), niet met de hand op de server. |
| W10 | Gefaseerde release? | Uit. Anders krijgen automatische updates de nieuwe app pas verspreid over 7 dagen, terwijl de oude dan al niet meer kan schrijven. |
| W11 | Wat als iemand uitnodigt tijdens de stop? | Accepteren en vooraf melden. `blob-images-api-groups/handlersGroup/sendInvite.js:53-104` schrijft en mailt tegelijk: na de stop gaat de mail nog wel weg, maar de uitnodiging bestaat niet. Alle 18 leden van Blob bibliotheek zijn admin, dus iedereen kan uitnodigen. Het alternatief is de SES-verzending in eu-central-1 pauzeren, maar dat raakt misschien ook andere mail uit dat account (niet gecontroleerd). |
| W12 | Mails van de crons vóór T0 | Zet `WEBMASTER_EMAILS` op prod pas na een groene `verify` (niet op T-4). Zonder die var loggen `integrityCheck` en `film link check` in plaats van te mailen (`convex/monitoring.ts:366-368`, `convex/films.ts:252-255`). Een cron per stuk uitzetten kan niet zonder code; dat is het enige knopje dat er is. |

De andere adviezen (W1-W3, W6, W7, W10-W12) neemt Wouter over (2026-11-16).

### Antwoorden op de open vragen

**1. Schrijfstop.**
- *Mechanisme:* zie W1. Policy-tekst en ARN's zoekt Wouter op; de rol van de stream-Lambda is die van service `blob-images-api` (`blob-images-api/serverless.yml:56`). Zonder die uitzondering kan een cascade van een schrijfactie vlak voor de stop halverwege blijven hangen, en dan zit een half verwerkte stand in de extract. De bucket heeft al een policy (lezen gaf `AccessDenied`): voeg een statement toe, vervang hem niet, anders valt de beeldserver `img.clubalmanac.com` misschien om.
- *Waarom ook S3:* draaien in de oude app (`blob-images-api-photos/handlersPhoto/fixPhotoRotation.js:57-82`) doet drie dingen tegelijk: DB bijwerken, nieuw bestand schrijven, oud bestand wissen. Met alleen de tabel dicht wist hij het origineel terwijl de record ernaar blijft wijzen. Uploaden gaat via een presigned PUT (`blob-images-api-user/handlersUpload/getUploadUrl.js`) en een S3-trigger (`createPhoto`), die alleen leest bij het tekenen.
- *Wat een lid merkt:* kijken werkt (groepen, albums, foto's). Elke wijziging geeft een foutmelding. Uitzonderingen:
  - *Upload* toont geen fout: de app controleert de status van de PUT niet (`clubalmanac-app/datastores/images.js:22-27`). De foto verschijnt gewoon nooit.
  - *Naam en profielfoto bovenin* verdwijnen vanaf de dag na de stop. `GET /user` schrijft één keer per dag het bezoek (`blob-images-api-user/libs/dynamodb-lib-user.js:26-44`) en faalt dan. Kijken blijft werken.
  - *Aanmelden* in de oude app kan alleen met een open uitnodiging (`blob-images-api/handlersCognito/preSignup.js`), en die zijn er niet.
  - *Wachtwoord vergeten* blijft werken (alleen Cognito).
- *Terugdraaien:* beide policies weghalen. Oefen het eerst op de dev-tabel `blob-images-photos-dev` en bucket `blob-images-dev`: schrijfactie geweigerd, policy weg, schrijfactie lukt weer.

**2. Herinnering.** Zie W2. Een album is één record `GA<groepId>` met `SK` `A…`, `name`, `photo.url` (een banner onder `public/img/`, eerst via de S3-console geüpload) en `createdAt`. Er hangt geen stream-cascade aan het toevoegen (`blob-images-api/handlersDBstreams/mainStream.js:176-185`), en alle leden van de groep zien het zonder update. De volgorde van albums is niet te sturen: de app sorteert op `sortDate`, maar die hebben maar 4 van de 14 albums (`screens/GroupAlbumsSub.jsx:17`). Controleer na het toevoegen in je eigen oude app waar het album staat. Voor een cutover-groep zou je per lid een membership met een kopie van de groep moeten schrijven, en die is alleen zichtbaar onder Mijn groepen. Buiten de migratie houden: via `excludeAlbumIds` (W5), niet door het album op T0 weg te halen (dat kan na de stop niet meer, en vergeten valt niet op).

**3. Volgorde op T0.** Klopt niet. Het stappenplan en het runbook doen `extract` eerst en de schrijfstop pas aan het eind, en dat breekt invariant 2. Juiste volgorde (met W3 en W7):
1. Leden melden dat de oude app vanaf nu alleen kijkt.
2. Schrijfstop (W1), daarna controle: een wijziging in je eigen oude app faalt, en de dbStream-Lambda heeft 5 minuten geen aanroepen.
3. `extract`, `transform`, `load-files`, `load-records`, `formaten`, `verify`. Daarna `WEBMASTER_EMAILS` zetten (W12), filmlijst vullen en `films:checkLinks`.
4. Inloggen als Wouter met een TestFlight-build tegen prod: de juiste groepen.
5. Demo-groep en demo-account (W4), en de production-build indienen met handmatige release.
6. Bij goedkeuring: *Release This Version* (T0, punt zonder terugkeer). Wacht tot de app echt in de App Store staat (tot 24 uur). Dan pas de leden inlichten en `blob-videos` dichtzetten. Test mode blijft aan (W4).

Terug vóór stap 6: de policies weghalen. Prod blijft dan staan zoals hij is (niemand kan erbij) en gaat bij de volgende poging eerst door `reset`.

**4. Demo-account.** Zie W3 en W4. Na de laad-run maakt Wouter in de app een groep Demo, nodigt het demo-adres uit als lid, logt daarmee in (test mode aan) en zet er een paar eigen, niet-persoonlijke foto's in. `verify` is dan al gedraaid, dus de demo-rijen storen niet. Na T0 telt geen enkel commando nog rijen tegen de bron. Bij een nieuwe `reset` + `load-records` moet de demo-groep opnieuw.

**5. Vrijgave.** Kan. Kies bij de versie in App Store Connect *Manually release this version*. Na goedkeuring is de status *Pending Developer Release*: de versie staat dan niet in de App Store en geen toestel krijgt hem. Na *Release This Version* duurt het tot 24 uur voor hij zichtbaar is. Op toestellen met automatische updates vervangt de nieuwe app de oude, met hetzelfde bundle-ID (1.6.0 → 2.0.0); gefaseerde release uit (W10). Wie de oude app verwijderd heeft, haalt hem opnieuw via de App Store. Tot de release verandert er op toestellen niets: de app is sinds 2026-07-28 uit de verkoop, maar de geïnstalleerde oude app blijft werken. Let op: het EAS-profiel `dev` dient in bij dezelfde app (`app/eas.json`, `ascAppId` in beide). Een dev-build met `pk_test` en dev-Convex kan dus per ongeluk de review in (invariant 13).

**6. Clerk pre-create.**
- *Bron:* `UBbase.email` uit DynamoDB, zoals `scripts/migrate/config.ts` ook doet. Leden kunnen hun adres niet wijzigen in de oude app (`datastores/user.js:171` wijzigt alleen `custom:name`), en `createUser` maakt het adres klein (`handlersUser/createUser.js:37`). Cognito heb ik niet gelezen: geen leesrecht, en het is niet nodig.
- *Telling (extract 11-06):* 0 adressen met hoofdletters of spaties, 0 dubbelen. Wie zich in Cognito aanmeldde maar nooit bevestigde, heeft geen `UBbase` en gaat niet mee. Dat is terecht, want die gebruikte de app nooit.
- *Mail:* gaat niet uit. Een user aanmaken via de Backend API stuurt geen mail, en Convex reageert alleen op `session.created` (`convex/http.ts:166`).
- *Aantal:* 19 Clerk-users (20 min JA), niet 16. De verwijzingen naar 16 users en naar de Invitations API in `scripts/migrate/config.ts:30-33` en het runbook (§B) zijn verouderd.
- *Nieuw risico:* een lid dat zijn oude adres niet meer leest, kan op T0 de code niet ontvangen. Vraag in het bericht van T-3 weken of het adres nog klopt; dat zijn er een paar die sinds 2021-2023 niet kwamen.

**7. Uitnodigingen in de lucht.** Er zijn er 0 open. Ze verlopen na 30 dagen (`blob-images-api-invites/handlersInvite/inviteHelpers.js:31-33`), en de drie in de bron zijn verlopen. Ze gaan mee als `expired`, wat al zo werkt. De link in een oude mail wees naar `clubalmanac.com/invites/…`, en die site verwijst nu naar de app. Wie daar met de code inlogt zonder open uitnodiging, komt niet binnen. Na de stop kan er geen nieuwe uitnodiging bijkomen, op de mail na (W11).

**8. Generale repetitie.** Zie W6. Kosten op prod: `formaten` leest 5,6 GB uit storage, ongeveer $0,75 per run, dus twee keer (repetitie en T0) ongeveer $1,50. Opnieuw geteld: zie de telling bovenaan. Doorvoer: 5,36 MB/s, gemeten 2026-11-13. Gate van de repetitie: de volledige volgorde van vraag 3, stap 2 tot en met 5, met de schrijfstop op de AWS-dev-tabel in plaats van prod. Inloggen als Wouter toont zijn groepen (4, met W5). Het album van 540 foto's opent op prod. `formaten` eindigt met exitcode 0 (zie blokker B1).

**9. Backup.** Zie W9. Convex Starter: alleen handmatige back-ups, hooguit 2 tegelijk, 7 dagen bewaard. Automatisch vraagt Pro. Een export met bestanden leest ongeveer 6 GB en kost ongeveer $0,80 bandbreedte. Een export bevat geen env-vars en geen code: noteer de env-vars van prod (zonder waarden) naast de export.

**10. Kosten prod** (schatting per maand, tarieven Starter van 2026-11-15; de EU-toeslag van 30% uit `migratie-plan-convex.md` §Kosten zat niet op de prijspagina en is erbij opgeteld):

| Post | Schatting |
|---|---|
| Convex opslag (5,61 GB + formaten ~0,5 GB, 1 GB gratis, $0,033/GB) | ~$0,22 |
| Convex bandbreedte (1 GB gratis, $0,132/GB; leden bekijken vooral *klein*; 2-20 GB) | $0,20-3,40 |
| Convex functies, database | binnen het gratis deel |
| Maandelijkse export met bestanden (B4) | ~$0,80 per maand |
| Clerk Hobby (tot 50.000 users) | $0 |
| Mailjet gratis (200 per dag, 6000 per maand) | $0 |
| AWS: `blob-images` tot T+90, `blob-videos` (~19 GB) blijvend, films via S3 binnen 100 GB gratis uitgaand verkeer | ~$0,60 |
| **Totaal** | **~$2-5** |

Clerk Pro (W8) zou er $20-25 bij doen. De Apple Developer-bijdrage (€99 per jaar) bestond al en staat hier buiten.

### Aanvullende invarianten

10. **De schrijfstop dekt tabel én bucket.** Na stap 2 lukt geen enkele schrijfactie meer via de oude app: geen record, geen bestand erbij, geen bestand weg. Controle: een wijziging in de eigen oude app faalt. Een record dat naar een ontbrekend bestand wijst, ziet `load-files` als "staat niet in de bucket", en dat is een stop, geen `--accept-missing-files`.
11. **Elke uitsluiting is benoemd.** Wat niet meegaat, staat bij bron-ID in `prod-config.json` en per ID in het transform-rapport, met het aantal rijen dat erdoor wegvalt. Een ID die niet in het extract staat, stopt de transform (typfout). Een uitgesloten user die oprichter is van een groep die wél meegaat, stopt de transform. Niets verwijst na de transform nog naar iets wat is uitgesloten. `verify` blijft groen, want die telt al tegen wat geladen wordt.
12. **De reviewer ziet alleen Demo.** Het demo-account is lid van één groep zonder ledendata en is geen admin. Na elke review controleer je of het demo-account nog bestaat: de reviewer kan *Account verwijderen* proberen (WP29).
13. **Alleen een production-build gaat de review in.** Die build heeft `pk_live` en de prod-URL. Controle vóór indienen: het buildnummer in App Store Connect hoort bij een build met profiel `production`. Een harde weigering in de build is code voor B (het migratie-plan noemde die al bij "Env-cross-contamination"); dat beslist regie.
14. **Leden horen het pas als ze de app kunnen vinden.** Het bericht van T0 gaat pas weg als de nieuwe versie op een gewoon toestel (geen TestFlight) in de App Store staat.
15. **Punt zonder terugkeer:** *Release This Version*. Daarvoor is alles terug te draaien door de policies weg te halen. Daarna schrijven leden op prod, en terug zou dataverlies betekenen.
16. **Geen leden-data vóór de laad-run op prod.** Rooktests op T-4 (WP5- en WP6-gates, Account verwijderen) laten rijen achter. Vóór de repetitie en vóór T0 gaat prod door `reset` (runbook: "de doel-deployment is niet leeg").

### Edge cases

- **Release in de nacht:** zichtbaarheid kan tot 24 uur duren. Plan de release niet vlak voor een afgesproken tijd.
- **Afgewezen review:** de oude app blijft alleen-lezen tot een nieuwe build goedgekeurd is. Spreek een grens af (advies: twee weken). Daarna de policies weg en later opnieuw, met `reset` op prod.
- **Lid zonder bereikbaar adres:** zie vraag 6. Als het adres van een lid verandert, wordt de Clerk-user met het nieuwe adres aangemaakt, met het oude adres als sleutel in `clerkIdByEmail`. `users.email` blijft dan het oude adres. Of uitnodigingen aan het nieuwe adres dat lid daarna bereiken, is niet gecontroleerd: liever het lid laten inloggen met het oude adres, of na T0 het adres in Convex gelijk trekken (handwerk).
- **`reset` raakt de filmlijst niet** (`films` staat niet onder de FK-controle). Na de repetitie wijst hij naar een gewiste groep. Op T0 is `films:replaceAll` (seedArgs) dus verplicht, niet "als hij uit stond".
- **Oude Clerk-sessies:** testers met een build met `pk_test` op hun toestel. De cutover-build wist de cache-sleutels van de oude key al (stappenplan).
- **Stream-uitzondering te breed:** de rol van `blob-images-api` draait ook `cognitoSync`. Een user aanmaken in de Cognito-console tijdens de stop schrijft dus nog. Doe dat niet.
- **Herinneringsalbum tijdens de review:** dat blijft staan in de oude app. De tekst moet daarom geen vaste datum noemen als de review uitloopt; "binnenkort, je krijgt bericht" is veiliger.

### Blokkers vóór T0 (code, B)

- **B1, `formaten` eindigt op prod met exitcode 1.** De afsluitende telling `photos.formatStatus` (`convex/photos.ts:806-832`) leest in één query de formaten van elke foto. Op dev haalde die bij 1001 foto's de limiet op systeemoperaties (WP19a, `scripts/.data/wp19a-b-formaten.log`). Prod heeft 1544 foto's. Het runbook eist exitcode 0 en houdt anders de app dicht. Een unit-test kan dit niet vangen, want `convex-test` kent de limiet niet. Gate: de repetitie op prod.
- **B2, uitsluitingen in de transform** (W5, invariant 11). `excludeUserIds`, `excludeGroupIds` en `excludeAlbumIds` in `TransformConfig`, gevuld uit `prod-config.json`. Gepind in `tests/migration/wp31Exclusions.test.ts`; het inlezen uit `prod-config.json` niet, want dat bestand staat in de echte werkmap.
- **B4, automatische backup (W9), klaar vóór T+30.** Een GitHub Action draait elke maand (en op verzoek) een volledige export van prod met bestanden en zet die in een eigen S3-bucket in eu-west-1, in een archiefklasse. De laatste 6 exports blijven staan, oudere gaan automatisch weg. Bucket en deploy-rol in CloudFormation, net als `infra/site.yml` (OIDC, alleen vanaf `main`, alleen schrijven in die bucket). De prod-sleutel van Convex staat als geheim in een GitHub-environment die alleen `main` mag gebruiken; die sleutel kan prod ook wijzigen, dus de workflow doet niets anders dan exporteren. Een mislukte run moet opvallen (mail van GitHub bij een rode run). Naast de export: de namen van de env-vars van prod, zonder waarden. Kosten ongeveer $0,80 per maand bandbreedte plus enkele centen opslag. Gate: één run met de hand, en die export terugzetten in een wegwerp-deployment.
- **B3, het album van 540 foto's.** Het albumscherm vraagt per foto de formaten op, net als B1. Op dev was het grootste album 302 foto's. Geen aangetoonde fout, wel een risico: het openen hoort bij de gate van de repetitie.

### Correcties op het stappenplan (voor B, in het draaiboek)

- T-4: `WEBMASTER_EMAILS` verschuift naar na `verify` (W12). "Sessieduur kiezen" vervalt (W8). "`integrityCheck`-cron uitzetten" vervalt (W7, W12).
- T-2: vervalt (W7). De Clerk-pre-create en `prod-config.json` gaan naar vóór de repetitie (T-1 week).
- T-1 week: de herinnering is een album (W2). "App live in App Store" wordt "repetitie op prod" (W6). De review volgt op de laad-run (W3).
- T0: volgorde zoals in vraag 3.
- T+30: "cutover-group uit Convex verwijderen" vervalt, want hij gaat niet mee (W5).

Links: [Lambda-runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html), [DynamoDB resource policy](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/rbac-examples.html), [release-opties App Store Connect](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option), [Clerk test mode](https://clerk.com/docs/guides/development/testing/test-emails-and-phones), [Clerk sessie-opties](https://clerk.com/docs/guides/secure/session-options), [Clerk native sessies (Pro)](https://clerk.com/changelog/2026-11-04-native-session-lifetimes), [Clerk prijzen](https://clerk.com/pricing), [Convex prijzen](https://www.convex.dev/pricing), [Convex backup](https://docs.convex.dev/database/backup-restore).
