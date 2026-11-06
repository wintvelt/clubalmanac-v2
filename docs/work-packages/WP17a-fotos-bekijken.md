# WP17a: Foto's bekijken — albumscherm, foto-detail en het beeldpad

> Landed 2026-11-06 (A → B → audit, red-team, drie fix-cycli; zie §Closeout). Draft regie 2026-11-06. App-WP (zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4)), met een backend-deel. Eigen sessie per rol, plus een red-team op het beeldpad omdat security/privacy hoog is. Bouwt op [WP16](./WP16-groepen.md), [WP23](./WP23-read-whitelist.md) en [WP24](./WP24-write-gates.md). WP17 is gesplitst (besluit Wouter 2026-11-06): 17a is alleen bekijken, de acties op foto's komen in WP17b.

## Productdoel

Een lid opent een album en ziet de foto's rechtop, en snel genoeg om erdoor te bladeren. Groeps- en albumcovers en profielfoto's verschijnen op de plekken waar WP16 nu een letter toont. Niemand zonder toegang tot een foto krijgt het beeld te zien: niet wie uitgelogd is, niet wie geen lid is, niet een ex-lid, en ook niet iemand die alleen een id of een oude link heeft. Een profielfoto is openbaar (besluit 8).

## Besluiten Wouter 2026-11-06 (op A's open vragen)

1. **Beeldpad: vorm B.** Een httpAction die bij elk verzoek de login en de foto-toegang checkt. Geen `getUrl` naar de client.
2. **Verkleinde versies: eigen WP ([WP25](./README.md)).** Het begint met een spike: kan Convex verkleinen, hoeveel originelen zijn HEIC. WP25 is af vóór de gate van 17a; B van 17a hoeft er niet op te wachten. Het beeldpad van 17a neemt een formaat aan (*klein*, *groot*) en geeft het origineel zolang dat formaat er niet is. Vraag 9 (wat `exifOrientation` betekent) gaat mee naar WP25.
3. **Cache op het toestel:** gewist bij uitloggen. Wat een ex-lid al in de cache heeft, accepteren we.
4. **Gemelde foto's:** zoals v1, gewoon in het album, zonder markering.
6. **Album gelezen:** zoals A adviseert, bij openen met minstens één geladen foto, en opnieuw bij een foto die erbij komt terwijl het scherm open is.
8. **Een profielfoto is openbaar, ook uitgelogd.** Je ziet hem zonder gedeelde groep en zonder toegang tot de foto erachter. Gevolgen:
   - Het beeldpad voor een profielfoto checkt geen login en geen groep. Het geeft alleen het beeld dat op dat moment de profielfoto is; een oud of ander beeld nooit.
   - Een foto als profielfoto instellen maakt dat beeld openbaar. De gate op `users.updateProfile` is daarmee de enige drempel: alleen een eigen beeld (besluit 10, invariant 16). WP17b ("als profielfoto instellen") laat de user dat weten.
   - WP24 heraudit N2 (`groups.addMember` zonder instemming geeft het profielbeeld prijs) is geen lek meer. Kernvondst 7 (invite-landing) ook niet: de landing mag de profielfoto van de afzender tonen (WP19), via het user-id, nog steeds zonder `storageId` (invariant 10).
   - De telling voor vraag 8 vervalt.
9. **Audit S1 (fix-cyclus 1): een pad met kapotte procent-codering geeft 520, en dat accepteren we.** Convex weigert zo'n pad al vóór onze httpAction, ook bij routes die niet bestaan (gemeten op dev met `d4354e8`). Het is voor elk pad hetzelfde antwoord, zonder bytes, dus het verraadt niets.
10. **Red-team R1: als profielfoto alleen een eigen foto of een eigen upload.** Met besluit 8 maakt een profielfoto het beeld openbaar. Dan mag niemand het beeld van een ander lid als profielfoto zetten, ook niet als hij die foto mag zien. Fix in fix-cyclus 2 (A→B).
11. **Red-team R2 (`_test`-functies zijn publiek op dev):** niet in 17a. Wordt een eigen WP26 vóór T0.
12. **Red-team R3 (een openstaande uitnodiging haalt een verwijderd lid terug):** niet in 17a. Wordt een eis in het Groepsbeheer-WP: wie uit een groep verdwijnt, verliest ook de openstaande uitnodigingen voor die groep.

## Invarianten

1. **Het beeld van een foto volgt de foto-toegang.** Bytes van een albumfoto of cover krijgt alleen wie er foto-toegang toe heeft (`canAccessPhoto`, WP23). Een id, een `storageId` of een URL alleen is nooit genoeg. Profielfoto's: invariant 3.
2. **Wie de toegang verliest, verliest het beeld.** Na vertrek uit een groep, verwijdering uit een album of verwijdering van de foto levert een eerder verkregen link of id het beeld niet meer op, bij het volgende verzoek (besluit 1). De cache op het toestel valt hier buiten (besluit 3).
3. **Een profielfoto is openbaar, en alleen de profielfoto.** Iedereen, ook uitgelogd, krijgt via het user-id het beeld dat nu de profielfoto van die user is (besluit 8). Een vorige profielfoto, of een ander beeld van die user, levert het pad nooit op. Geen profielfoto: hetzelfde antwoord als een onbekend user-id.
4. **Elk beeld staat rechtop, en wordt precies één keer gedraaid.** Raster, detail, covers en profielfoto's volgen `photos.exifOrientation` uit Convex, niet de EXIF-tag in het bestand ([WP8](./WP8-photo-rotation.md) §Frontend-contract). Een foto waarvan het bestand zelf een andere oriëntatie draagt dan de DB, toont de DB-stand. Volledig te halen met de formaten uit WP25 (kernvondst 4).
5. **Een album openen downloadt niet elke foto op volle grootte.** Een album van 50 foto's opent in een paar seconden op 4G en kost geen honderden MB. Meetpunt (regie-voorstel): de eerste rij is binnen 3 seconden zichtbaar op 4G. Te halen met WP25.
6. **Een album is gelezen zodra de user de foto's zag.** Het openen van het albumscherm, met foto's in beeld, zet de teller van dat album in Groep op nul ([WP16](./WP16-groepen.md) invariant 3). Laden of een fout telt niet als gezien.
7. **Wie geen lid meer is, ziet dat netjes, ook in een album of op een foto.** De album- en foto-reads geven `NOT_MEMBER` (WP16 audit N3), en de app toont dezelfde NL-melding en weg naar Mijn groepen als in WP16 invariant 5. Geen crash en geen oude inhoud.
8. **Live alleen voor het scherm in beeld.** Album- en foto-reads lopen via `useLiveQuery` (WP15a invariant 5). Op een andere tab of in de achtergrond loopt geen query.
9. **WP13 tot en met WP16 blijven werken.** De bestaande tests blijven groen, met alleen A's bewuste aanpassingen. Schermen gebruiken tokens en componenten uit `app/src/theme` en `app/src/components`, en volgen [`design.md`](../design.md) (grote tekst, toestanden, terugknop-pil).

**Toegangsdefinities.** Deze WP introduceert de toegang tot beeldbytes, dus de standing rule [Toegangsdefinities](../conventions/work-package-specs.md#toegangsdefinities-verplicht-bij-wps-die-er-een-invoeren) geldt. Regie kent deze plekken waar een foto-id of `storageId` zichtbaar wordt: de foto-vorm (`photos.getById`, `getWithOwner`, `listByOwner`, `albums.listPhotos`, `listMyFlagged`), de geneste covers (`groups.getWithCover`, `albums.getWithCover`), de profielfoto in `publicProfile` en de httpAction `/upload`. A maakt de lijst compleet, met een inventaristest.

## Edge cases + scope-uitsluitingen

**In scope:**
- Albumscherm: raster met de cover bovenaan, markering voor nieuwe en eigen foto's (pariteit door A), `markSeen`
- Foto-detail: swipen door het album, zoomen, eigenaar en datum
- Covers in Mijn groepen, Groep en de albumlijst; profielfoto's in Leden en Profiel
- Het beeldpad in de backend, met `NOT_MEMBER` op de album- en foto-reads
- `storageId` uit de foto-vorm, als het beeldpad hem overbodig maakt (WP24 vervolg)
- Laadmeting op dev; zie open vraag 2
- `by_flagged` op de echte dev-deployment: is de index daar sparse? Zo ja, het JS-filter in `listMyFlagged` en `listAllFlagged` weghalen ([`migratie-plan-convex.md`](../migratie-plan-convex.md) §Photo flagging)

**Te beslissen door A (spec-criticus, leest de oude app), daarna door Wouter:**
1. **Wat een storage-URL is.** Hoe lang is een URL van Convex-storage geldig? Werkt hij zonder auth? Kun je hem doorsturen, en wat doet een cache ermee? Uit de Convex-docs plus een meting op dev, niet uit aanname. Daaruit volgt hoe invariant 1 en 2 houdbaar zijn, en de maximale vertraging bij invariant 2. Regie heeft geen voorkeur voor de vorm.
2. **Verkleinde versies.** Het schema heeft één `storageId` per foto. Gemiddeld is dat ~3,5 MB (5,6 GB over 1601 objecten, WP12). Had de oude app of backend verkleinde versies, en hoe? Telling vóór het besluit (les WP16): grootte per foto op dev en een meting van een album op 4G. Zijn verkleinde versies nodig, dan raakt dat de upload (WP18), de 1601 bestaande foto's en de WP12-transform. Data/schema gaat dan naar medium, met een pre-flight volgens [`data-migration-preflight.md`](../conventions/data-migration-preflight.md).
3. **Cache op het toestel.** Een ex-lid heeft beelden mogelijk nog in de cache. Accepteren, wissen bij uitloggen (WP15a wist al lokaal), of meer? Wouter beslist.
4. **Gemelde foto's.** Wat zag een lid, en wat zag de eigenaar, van een gemelde foto in het album? Melden zelf is WP20.
5. **Pariteit per scherm.** Wat toonden het albumraster en het foto-detail in de oude app (markeringen, eigenaar, datum, "staat in deze albums", kaart-knop)? Wat valt in 17a, wat in 17b?
6. **Wanneer telt een album als gezien.** Bij openen, of pas na scrollen? Wat deed de oude app (`seenPics`, WP12)?
7. Vraagt een scherm een backend-functie die er niet is, of een andere vorm: noem hem. A schrijft er tests voor, B bouwt hem.

**Bewust niet (→ WP17b):** foto-menu en selectiemenu, draaien en spiegelen, verwijderen, uit album halen, delen, als cover of profielfoto instellen, locatie wijzigen, Mijn foto's, de kaart.

**Bewust niet (elders):**
- Album maken en wijzigen: Groepsbeheer-WP
- Uploaden, ook van een profielfoto: WP18
- Ratings tonen en geven: WP19
- Melden: WP20
- Video's: WP21
- Overstap naar R2 of een CDN: eigen WP, alleen als de meting van open vraag 2 tegenvalt

## Risico-assessment

- **security/privacy: hoog.**
  - Voor het eerst verlaten beeldbytes de backend. Hoe sterk invariant 1 en 2 zijn, hangt af van wat een storage-URL is (open vraag 1).
  - WP24 heraudit N2: via `groups.addMember` zonder instemming krijgt een aanvaller het profielbeeld-id van het slachtoffer. Vanaf deze WP levert dat bytes op.
  - Daarom de red-team op het beeldpad (§Werkwijze).
- **ops: medium.**
  - Convex-storage heeft geen CDN, en de foto's zijn groot. De laadtijd voor 50+-users op 4G is nooit gemeten (de check uit fase 3 schoof hierheen).
  - Een beeld dat niet laadt, geeft een leeg vlak en geen melding: half stil. Een lege tegel heeft een toestand uit design.md §6.
- **external deps: medium.** Het gedrag van Convex-storage-URL's (geldigheid, caching) en van de beeldcache op het toestel zijn aannames, en de privacy-invariant leunt erop.
- **multi-user/concurrency: medium.**
  - `markSeen` zet de teller van WP16 live op nul, ook op een tweede toestel van dezelfde user.
  - Een foto kan verdwijnen, of een lidmaatschap vervallen, terwijl het album of de foto open staat (invariant 7).
- **data/schema-evolutie: laag, medium bij verkleinde versies.** Zonder open vraag 2 verandert alleen de return-vorm (`storageId` eruit), geen schema of backfill.
- **ops-runbook-impact:** nog onbekend; hangt af van open vraag 1 en 2. Een eigen beeldpad met config of een CDN landt in `external-services.md` en het cutover-stappenplan. B voegt in `external-services.md` §Convex in elk geval een regel toe: hoe je in het dashboard het beeldverkeer en de bandbreedte van een album ziet.

## Werkwijze

| Stap | Rol | Output |
|---|---|---|
| 1 | regie | dit doc |
| 2 | A (`wp-a`), eigen sessie | spec-aanvulling (open vragen 1–7, pariteit-checklist per scherm, inventaris van de beeld-paden) en RED tests voor de backend (beeldpad, `NOT_MEMBER`, profielfoto na vertrek, inventaristest) en voor pure logica |
| 3 | Wouter + regie | besluiten op A's open vragen, vooral 1, 2 en 3 |
| 4 | B (`wp-b`), eigen sessie | impl tot groen, simulator-check in licht en donker en bij de grootste tekst, runbook-regel |
| 5 | audit (`wp-audit`), eigen sessie | rapport in chat |
| 6 | red-team, eigen sessie | zoekt actief een pad naar beeldbytes zonder foto-toegang: met een id, een `storageId`, een oude URL, als ex-lid of uitgelogd, en via het openbare profielpad een ander beeld dan de actuele profielfoto. Krijgt alleen het productdoel en de diff. Rapport verbatim naar Wouter. |
| 7 | Wouter | gate |

## Cross-refs

- [WP16](./WP16-groepen.md): albumpad, tellers, `NOT_MEMBER`, testgroep "Gatetest" op dev, backlog N3
- [WP23](./WP23-read-whitelist.md): `canAccessPhoto`, foto-vorm, `publicProfile`
- [WP24](./WP24-write-gates.md): invariant 8 (beeld via `storageId`), N4, heraudit N2, `storageId` uit de foto-vorm
- [WP8](./WP8-photo-rotation.md): `exifOrientation`, §Frontend-contract
- [WP12](./WP12-data-migratie-tooling.md): `seenPics`, storage-map, grootte van de dataset
- [WP15a](./WP15a-navigatie-subscriptions.md): `useLiveQuery`, lokaal wissen bij uitloggen
- [`migratie-plan-convex.md`](../migratie-plan-convex.md) §File Storage (performance, R2 als uitweg), §Photo flagging (TODO `by_flagged`)
- [`cascade-matrix.md`](../cascade-matrix.md): rijen voor foto verwijderen, lid verwijderen, album verwijderen (A noemt de exacte rijen)
- [`design.md`](../design.md): toestanden, grote tekst, terugknop-pil
- Oude app (alleen A): `~/Code/v1/clubalmanac-app`, schermen Foto's (album), Foto detail, en de beeldcomponenten

## Acceptance

- Root en app: typecheck en tests groen op Node 24, ook in CI.
- Audit en red-team: geen open blockers.
- **Empirische gate (Wouter, TestFlight-build, met het Convex-dashboard open):**
  1. Open "Gatetest nu": de drie foto's staan rechtop, de cover bovenaan. Swipe en zoom in het detail.
  2. De teller van het album in Groep staat na het openen op nul.
  3. Covers in Mijn groepen en Groep, profielfoto's in Leden.
  4. Laadtijd op 4G (wifi uit) van een groot album op dev: binnen het meetpunt van open vraag 2.
  5. Haal jezelf in het dashboard uit de groep terwijl een foto open staat: NL-melding, weg naar Mijn groepen.
  6. Ex-lid: een eerder verkregen link of id levert het beeld niet meer op, bij het volgende verzoek (besluit 1). Zo test je het (A, fix-cyclus 1):
     - Draai `npm run test:integration -- tests/integration/images/exMember.test.ts`. Nodig in `.env.integration`: `CONVEX_URL` (dev), `CLERK_SECRET_KEY`, `CLERK_TEST_USER_WEBMASTER_EMAIL` en `CLERK_TEST_USER_REGULAR_EMAIL` (WP4-setup). De test maakt een wegwerp-groep met een foto. Hij haalt die foto als lid op (200, dezelfde bytes), laat het lid vertrekken, en vraagt dezelfde URL opnieuw met een geldig token (404) en zonder token (401). Daarna ruimt hij op. "Gatetest" blijft ongemoeid.
     - In het dashboard (Logs, filter `/beeld/foto/`) zie je de drie verzoeken, met 200, 404 en 401.
     - In de app: wat al op het toestel stond, mag nog te zien zijn tot het uitloggen (besluit 3). Na uitloggen en inloggen als een ander op hetzelfde toestel verschijnt het beeld niet meer.
  7. Dashboard: op een andere tab loopt geen album- of foto-query.
  8. Albumscherm en detail bij de grootste tekst, in licht en donker.
  9. Ruimte voor bevindingen buiten deze stappen

---

## Spec-criticus aanvullingen (A, 2026-11-06)

Bronnen: de oude app (`screens/AlbumPhotos.jsx`, `PhotoDetail.jsx`, `GroupMembersSub.jsx`, `components/PhotoCard.jsx`, `AlbumPhotosHeader.jsx`, `AlbumCard.jsx`, `GroupCard.jsx`, `GroupHeader*.jsx`, `PersonalHeader.jsx`, `Image.jsx`, `lib/image-helper.js`, `datastores/album.js`, `images.js`), de oude backend (`blob-images-api-groups`: `listAlbumPhotos.js`, `getAlbum.js`, `lib-newPics.js`; `blob-images-api`: `userChangeToMembership.js`; `blob-images-api-photos`: `listPhotoPublications.js`, `fixPhotoRotation.js`, `flagPhoto.js`), de WP12-transform, de Convex-docs ([Serving Files](https://docs.convex.dev/file-storage/serve-files), [Types](https://docs.convex.dev/database/types)), en de huidige `convex/` en `app/`.

### Kernvondsten

1. **Een storage-URL is een bearer-link zonder vervaldatum.** De Convex-docs: wie de URL van `storage.getUrl` heeft, haalt het bestand op zonder verdere auth. Je kunt hem doorsturen, en intrekken kan alleen door het bestand te wissen. Voor toegang per verzoek wijzen de docs naar een httpAction die zelf auth en toegang checkt (antwoord tot 100 MiB). Met `getUrl` is invariant 2 dus niet te halen: een ex-lid houdt een werkende link tot de foto weg is.
2. **De oude app toonde nooit het origineel, en had geen toegang op het beeld.** Elk beeld liep via een image handler (`img.clubalmanac.com`) die op verzoek verkleinde: 512 px in het raster, 256 px op kaarten en in Leden, 96 px als avatar, 1900 px in koppen, en hooguit 1200 px in het detail, ook bij zoomen. De URL was de S3-sleutel in base64, zonder token. Wie een sleutel kende, kreeg het beeld. WP17a is dus strenger dan v1, bewust.
3. **Volle grootte haalt invariant 5 niet.** Rekensom met het WP12-gemiddelde van 3,5 MB: een album van 50 foto's is 175 MB. Op 4G (20 Mbit/s, ruwe schatting) is dat 70 seconden, de eerste rij van drie tegels 4 seconden, en het eerste scherm (cover plus 15 tegels) ruim 20 seconden. Een tegel van 512 px is 30 tot 80 kB.
4. **De oriëntatie kan dubbel draaien.** iOS (en elke gangbare beeldbibliotheek in React Native) past bij het decoderen de EXIF-tag uit het bestand zelf toe. De app past daarna `exifOrientation` uit de DB toe (WP8). Een nieuwe upload krijgt `exifOrientation` = de tag uit het bestand (WP7 `extractMetadata`), dus zo'n foto draait twee keer. Gemigreerde foto's hebben geen `exifOrientation` (WP12: "de oude app roteerde de bytes zelf"). Dat klopt voor foto's die v1 met Jimp draaide, maar niet per se voor foto's die nooit gedraaid zijn: een iPhone-JPEG draagt vaak tag 6. Hoeveel dat er zijn, is niet geteld. Zie open vraag 9.
5. **"Nieuw" werkte in v1 anders dan in v2.** v1 zette een foto op "gezien" bij het eerste bezoek aan de app op een volgende dag, niet bij het openen van het album (`userChangeToMembership.js`). Een nieuwe foto hield zijn oranje hoekje dus de hele dag. v2 kiest bij het openen van het album (`markSeen`, WP16 invariant 3). Gevolg: zodra `markSeen` loopt, maakt de live query alle foto's "niet nieuw", terwijl de user er nog naar kijkt. Zie invariant 12.
6. **Een foto wissen wist ook een profielfoto die dat beeld gebruikt.** `internalRemovePhoto` plant het wissen van `storageId`, ook als een user dat beeld als profielfoto heeft (gemigreerde profielfoto's delen hun beeld met een foto). De profielfoto wijst daarna naar niets. Voor 17a: zo'n profielfoto toont de letter (invariant 14). De cascade zelf: backlog (cascade-matrix P5 noemt het al als `[GAP]`).
7. **De invite-landing geeft het profielbeeld-id van de afzender aan een anonieme houder van het token** (`invites.getByToken`, `landingInviterFields`). Met een beeldpad op `storageId` zou dat bytes opleveren zonder login. Invariant 10 haalt het id weg; met besluit 8 toont de landing (WP19) de profielfoto via het user-id van de afzender.
8. **De album-reads geven nog een gewone `Error`** (WP16 backlog N3), en `photos.getById`/`getWithOwner` ook. Het detail heeft eigenaar en "nieuw" per foto nodig, en die staan niet in `albums.listPhotos`.
9. **`by_flagged` is niet sparse.** In Convex staan documenten zonder het veld gewoon in de index (`undefined < null < alle andere waarden`, docs Types). Het JS-filter in `listMyFlagged` en `listAllFlagged` blijft dus nodig, of de query krijgt een ondergrens. Geen meting op dev nodig: dit is gedocumenteerd gedrag, en de huidige code is correct. Buiten 17a.

### Beslissingen op "Te beslissen door A" (advies; Wouter beslist)

**1. Wat een storage-URL is, en hoe het beeld de toegang volgt.** Feiten uit de docs: zie kernvondst 1. De meting op dev (geldigheid na wissen, of de URL stabiel is, welke cache-headers) staat in `tests/integration/convex/storageUrl.test.ts`; Wouter draait hem (§Meting op dev).

| Vorm | Invariant 2: hoe snel weg | Kosten en gedoe |
|---|---|---|
| A. `getUrl` in de reads | Nooit, tot de foto gewist is | Simpelst. Een link is te delen en blijft werken. |
| B. httpAction die per verzoek de Clerk-token en de toegang checkt | Direct, op de cache op het toestel na (vraag 3) | Eén action per beeld. Token in de header van het beeldverzoek. Cache op het toestel per URL. |
| C. httpAction met een ondertekende URL met vervaltijd, uitgegeven door een read na de toegangscheck | Binnen de vervaltijd (bijvoorbeeld een uur) | Een geheim als env-var (runbook). De URL wisselt bij elke ondertekening, dus de cache moet daar tegen kunnen. |
| D. R2 met presigned URL's (`@convex-dev/r2`) | Binnen de vervaltijd | CDN, geen egress. Eigen WP (spec: alleen als de meting tegenvalt). |

**Advies: B.** Het beeld volgt dan letterlijk de foto-toegang, bij elk verzoek, zonder geheim en zonder vervaltijd om over na te denken. Met verkleinde versies (vraag 2) zijn de verzoeken klein. De client vraagt een beeld op met een foto-id of een user-id, nooit met een `storageId` (invariant 10). Een beeld zonder toegang, een onbekend id en een gewist beeld geven precies hetzelfde antwoord (geen orakel). Uitgelogd: 401.

**2. Verkleinde versies.** *Input Wouter (2026-11-06, via regie):* er komt zeker een thumbnail-oplossing. De aparte image-service van v1, waarbij de app het formaat bij de aanroep meegaf, vindt hij "niet ideaal". Hoe en waar de verkleining in de nieuwe architectuur komt, beslist hij nog. Hieronder de feiten en de opties.

*Hoe v1 het deed.*
- Een aparte dienst op `img.clubalmanac.com`, buiten de v1-repo's. Het aanroep-formaat is dat van AWS' Serverless Image Handler: base64 van `{ bucket, key, edits: { resize: { width, height, fit: "cover" } } }`. Een Lambda verkleinde op verzoek uit het origineel in S3, met CloudFront ervoor. De cache-instellingen staan niet in de repo's; in de AWS-console (CloudFormation) zijn ze terug te vinden.
- De app (`lib/image-helper.js`) bouwde de URL zelf uit de S3-sleutel en een breedte. Formaten per plek: 64 px (lijst gemelde foto's), 96×96 (avatar Profiel), 128 (publicaties), 256 (kaarten groep en album, Leden, uitnodigingen), 512 (raster), 600 (bewerkformulieren), 800 (foto-menu), min(1200, schermbreedte × 2,5) (detail en zoom), 1900 (koppen, achtergrond Profiel).
- Cache op het toestel: `react-native-fast-image`, per URL. De URL hing alleen af van sleutel en formaat, dus hij bleef eindeloos geldig. Draaien in v1 schreef een nieuw bestand met een nieuwe sleutel, en dus een nieuwe URL.
- De backend gebruikte dezelfde dienst in mails: de cover van de groep (600×200) in de uitnodiging, plus logo en handtekening. Een mailclient kan geen token meesturen, dus dat kon alleen omdat de dienst open was. v2 heeft geen beelden in mails (WP5). Wie dat later terug wil, heeft een open of ondertekende URL nodig: vorm B dekt het niet.
- Het origineel ging nooit naar de app.

*Opties voor v2.*

| | Hoe | Upload (WP18) | 1601 bestaande foto's | WP12-tooling | Beeldpad (vraag 1) | Risico |
|---|---|---|---|---|---|---|
| **A. Bij upload, op de server** | Na de upload maakt een Node-action vaste formaten (bijvoorbeeld *klein* ~512 px, *groot* ~1600 px) en bewaart ze in Convex-storage. Optionele velden op `photos`. | De bestaande pijplijn na `/upload` (naast `extractMetadata`) krijgt een stap. | Backfill-action op dev en na de T0-load op prod, in batches, met tellingen (pre-flight). | Transform ongewijzigd. Load of runbook krijgt een stap erna. `verify`, `storageInventory`, `prune-storage` en `reset` moeten de formaten kennen. | Geeft het gevraagde formaat, anders het origineel. | Een beeldbibliotheek met native code in de Convex Node-runtime (spike). HEIC. |
| **B. Op aanvraag, op de server, daarna bewaard** | Het eerste verzoek om (foto, formaat) maakt het formaat in de httpAction en bewaart het. Volgende verzoeken krijgen het bewaarde. | Ongewijzigd (eventueel vooraf opwarmen). | Geen backfill. Het eerste openen van een oud album is traag (verkleinen van 3,5 MB per foto). | Ongewijzigd, op de storage-checks na (zoals A). | Maakt, bewaart en serveert. Twee gelijktijdige verzoeken mogen niet twee keer bewaren. | Als A, plus wachttijd bij de eerste kijker en zwaardere httpActions. |
| **C. Op het toestel bij upload** | De app verkleint voor de upload (bijvoorbeeld `expo-image-manipulator`) en stuurt origineel en formaten mee. | Upload met meerdere bestanden, idempotentie per set. | Offline: de WP12-tooling verkleint lokaal uit de S3-extract (Node met een beeldbibliotheek op Wouters machine) en laadt de formaten mee. | Transform en `load-files` krijgen de formaten. `verify` telt ze. | Als A | Geen native code in Convex. Wel: een client kan een formaat sturen dat niet bij het origineel past (melden, WP20). Twee bronnen van verkleining (app en tooling). |
| **D. Externe beelddienst** (Cloudflare Images, of R2 met transformaties) | Zoals v1: het formaat in de URL, verkleind en gecachet aan de rand. Ondertekende URL's met vervaltijd. | Upload naar de dienst. | Migratie van alle bestanden naar de dienst. | `load-files` naar de dienst | Vorm C of D van vraag 1. Invariant 2 binnen de vervaltijd. | Nieuwe externe dienst, geheimen, runbook; dit is wat Wouter "niet ideaal" noemt. |

Voor alle opties geldt:
- De storage-orphancheck van WP10 (`photos.storageId` ∪ profielfoto's) ziet een formaat als wees, tot hij ze kent (A, B, C).
- De opruiming na wissen (U7) neemt de formaten mee.
- Formaten worden gemaakt uit de ruwe pixels, zonder EXIF. Daarmee is vraag 9 opgelost.
- De opslag groeit met minder dan 10%.
- Een foto zonder formaat toont het origineel: traag, maar nooit leeg.
- Draaien (WP8) blijft alleen een DB-waarde: de formaten hoeven niet opnieuw.

*Past het in 17a?* A's advies: **een eigen WP, vóór de gate van 17a, niet per se vóór B van 17a.**
- Het raakt upload, schema, de WP12-tooling, monitoring en cascade, met een data-actie op 1601 foto's: een ander risicoprofiel (data/schema medium) dan 17a (beeldtoegang, security hoog, red-team). Samen wordt het een WP die de red-team niet meer overziet.
- Wat er eerst moet: een spike. Kan de Convex Node-runtime verkleinen (A en B)? Hoeveel originelen zijn HEIC (telling)? Die uitkomst bepaalt mee of A, B of C overblijft.
- Het contract tussen de twee WP's: het beeldpad van 17a neemt een formaat aan (*klein* of *groot*) en geeft het origineel zolang het formaat er niet is. Dan kan 17a-B bouwen en testen zonder op het formaten-WP te wachten. Gate-stap 4 (laadtijd op 4G) wacht wel op het formaten-WP.
- Meetpunt invariant 5: regie's voorstel (eerste rij binnen 3 seconden op 4G) is met *klein* ruim haalbaar, met het origineel niet (kernvondst 3).

**3. Cache op het toestel.** Advies: een diskcache, gewist bij uitloggen, net als de Clerk-opslag (WP15a). Dat is meer dan nice-to-have: bij vorm B is de cache-sleutel de URL, niet de user. Zonder wissen ziet de volgende user op hetzelfde toestel de beelden van de vorige. Wat een ex-lid in zijn cache heeft, accepteren: hij zag het eerder met recht, net als een screenshot.

**4. Gemelde foto's.** v1: een gemelde foto bleef voor iedereen gewoon in het album staan, zonder markering (de code voor de vlag in het raster stond uit: "do not show flagged in albums for now"). De eigenaar zag hem in "Ongepast", de webmaster in de wachtrij. Na 14 dagen zonder bezwaar verdween hij. Advies: zo laten. De foto-vorm heeft geen flag-velden (WP23), dus het album toont niets bijzonders. Iets anders hoort bij WP20.

**5. Pariteit per scherm:** zie de checklist hieronder. Naar 17b: selecteren, het foto-menu (lang drukken, "…"), delen, de kaart-knop, en "Publicaties" (zie vraag 7).

**6. Wanneer telt een album als gezien.** v1: zie kernvondst 5. Advies, binnen WP16 invariant 3 ("pas als de user de foto's zag"):
- `markSeen` zodra het albumscherm in beeld is en de lijst geladen is met minstens één foto. Laden, een fout of een leeg album: geen aanroep.
- Komt er een foto bij terwijl het scherm in beeld is, dan opnieuw `markSeen`: de user ziet hem verschijnen.
- Alleen openen telt, niet scrollen. Een album van 100 foto's helemaal moeten doorscrollen om de teller op nul te krijgen, kende v1 ook niet.

**7. Backend-functies die een scherm mist:**

| Functie | Wat | Waarom | Tests |
|---|---|---|---|
| Album- en foto-reads: `albums.getById`, `getWithGroup`, `getWithCover`, `listPhotos`, `photos.getById`, `getWithOwner` | Geen toegang, of het album of de foto bestaat niet: `ConvexError` met code `NOT_MEMBER`, voor beide gevallen gelijk | Invariant 7, WP16 N3 | `tests/images/notMember.test.ts` |
| `albums.listPhotos` | Per foto ook `owner` (publiek profiel) en `isNew` voor de caller. `isNew` volgt dezelfde definitie als de teller: van een ander, toegevoegd na het laatste bezoek. | Detail toont de eigenaar; het raster de markering. Eén definitie van nieuw (invariant 11). | `tests/albums/listPhotosNew.test.ts`, `tests/readWhitelist/albums.test.ts` (vorm aangepast) |
| Toegangsregel voor het beeld: `internal.images.photoImage({ photoId })` en `internal.images.profileImage({ userId })` | Foto: het beeld als de caller foto-toegang heeft, anders `null`. Profiel: de actuele profielfoto voor iedereen, ook uitgelogd (besluit 8), anders `null`. | Invariant 1, 2, 3 | `tests/images/access.test.ts` |
| Beeldpad (besluit 1): `GET /beeld/foto/<photoId>` en `GET /beeld/profiel/<userId>`, beide met `?formaat=klein\|groot` | Bytes als de regel hierboven een beeld geeft, anders één en dezelfde 404. Foto: uitgelogd 401, `Cache-Control: private`. Profiel: openbaar. Formaat (besluit 2): zonder `formaat` het origineel; zolang een formaat er niet is (WP25) ook het origineel; een onbekende waarde 400, voor iedereen gelijk. Het formaat verandert niets aan de toegang. | Besluit 1, 2, 8 | `tests/images/httpRoute.test.ts` |
| Foto-, profiel- en landing-vormen | Geen `storageId` en geen `profilePhotoStorageId` meer in een publieke response | Invariant 10 | `tests/images/noStorageIds.test.ts`, `tests/readWhitelist/_world.ts` (vorm aangepast) |

"Publicaties" (in welke albums staat deze foto, alleen in groepen van de kijker) vraagt een nieuwe read met een eigen toegangsregel. Advies: naar 17b.

**8 (nieuw). Een profielfoto die een foto is.** A adviseerde de profielfoto af te schermen als hij het beeld is van een foto zonder toegang. Besluit 8 (Wouter) wijkt af: een profielfoto is openbaar. Zie §Besluiten Wouter.

**9 (nieuw). Wat `exifOrientation` betekent.** Zie kernvondst 4. Advies: `exifOrientation` is de draaiing ten opzichte van de ruwe pixels, zoals WP8 het bedoelt, en de app krijgt nooit bytes waarin een decoder nog een tag kan toepassen. Met de verkleinde versies van vraag 2 is dat vanzelf zo: ze worden gemaakt uit de ruwe pixels, zonder EXIF. Wie de formaten voor de bestaande foto's maakt (backfill bij optie A, WP12-tooling bij C, het eerste verzoek bij B), zet voor gemigreerde foto's zonder `exifOrientation` de tag uit het bestand in de DB. Zonder verkleinde versies is invariant 4 niet te halen zonder de tag uit het bestand apart op te slaan. Telling: hoeveel bestanden een tag ongelijk aan 1 dragen. Dat vraagt de bytes; de preview-run van die stap kan het tellen.

**10 (nieuw, fix-cyclus 2). Gemigreerde profielfoto's die de foto van een ander zijn.** v1 liet een profielfoto zetten op elke foto met foto-toegang (`blob-images-api-user`, `getPhotoById`: eigen foto, of een foto in een groep van de user). De WP12-transform neemt die profielfoto over (`photoUrl` → `profilePhotoStorageKey`). Op prod kan een user dus vanaf T0 een profielfoto hebben die de foto van een ander lid is, en met besluit 8 is die openbaar. Invariant 16 dekt alleen nieuwe keuzes. Op dev komt het niet voor (3 users: twee een eigen foto, één een los beeld). Telling op prod: zie §Meting op dev, punt 4. Opties, als de telling niet nul is:
- (a) Accepteren. In v1 zag elk groepslid die profielfoto al, en het beeld was zonder login op te halen met de sleutel (kernvondst 2).
- (b) In de WP12-transform zo'n profielfoto niet overnemen; de user ziet bij T0 de letter en kiest opnieuw.

Advies: (b). De reden van besluit 10 geldt hier ook, en het openbare pad (op user-id, te vinden via ledenlijst en invite-landing) is ruimer dan een groepslid in v1. Het raakt WP12, niet 17a.

### Inventaris beeld-paden (standing rule Toegangsdefinities)

**Waar een beeld-id zichtbaar wordt** (nu; invariant 10 haalt elk `storageId` uit publieke responses):

| Pad | Id | Na 17a |
|---|---|---|
| Foto-vorm: `photos.getById`, `getWithOwner`, `listByOwner`, `listMyFlagged`, `listAllFlagged`, `albums.listPhotos` | `_id` (foto), `storageId` | Alleen het foto-id |
| Geneste covers: `groups.getWithCover`, `albums.getWithCover` | idem, plus `coverPhotoId` | Alleen foto-ids. `coverPhotoId` zonder toegang blijft zichtbaar (WP23), ontsluit niets: het beeld volgt de foto-toegang. |
| Groep- en albumvorm (`listMine`, `listByGroup`, `listByGroupWithUnread`, `getById`, `getWithGroup`) | `coverPhotoId` | idem |
| `publicProfile`: `users.getById`, `groups.listMembers`, `photos.getWithOwner` (owner), `albums.listPhotos` (owner, nieuw) | `profilePhotoStorageId` | Weg. Het beeld via het user-id. |
| `ownProfile`: `users.current`, `users.profile` | `profilePhotoStorageId` | Weg. Het eigen beeld via het eigen user-id. |
| `invites.getByToken` (anoniem) | `inviter.profilePhotoStorageId` | Weg. In de plaats: `inviter._id`, zodat de landing (WP19) de profielfoto via het openbare profielpad toont (besluit 8). Herziet de uitsluiting van `_id` uit WP23/audit-8. |
| `ratings.listForPhoto` | foto-id | Ongewijzigd |
| `POST /upload` | foto-id van de eigen upload | Ongewijzigd |
| `_test:storageUpload`, `_test:storageDownloadUrl` | `storageId`, URL | Alleen met `INTEGRATION_TEST_ENABLED` (dev). Buiten scope, zoals in WP23. |

**Publieke paden die een beeld-id aannemen, of de staat schrijven waar de beeldtoegang op leunt:**

| Pad | Neemt aan / schrijft | Gate |
|---|---|---|
| Beeldpad (besluit 1) | foto-id, user-id, formaat | Foto: `images.photoImage` (toestemmingslijst: eigenaar, of lid van een groep met de foto in een album). Profiel: openbaar, alleen het beeld dat nu de profielfoto is (besluit 8). |
| `users.updateProfile` | `storageId` | Alleen een eigen beeld (invariant 16, besluit 10; scherpt WP24 invariant 8 aan). Na 17a kent de client geen `storageId` meer: "als profielfoto instellen" (17b) heeft een variant op foto-id nodig, met dezelfde regel: alleen een eigen foto. |
| `photos.update`, `remove`, `rotate`, `flag`, `appeal`, `decideFlag`; `ratings.upsert`, `remove`; `albums.addPhoto`, `removePhoto`; `groups.update`, `albums.update` (cover) | foto-id | WP24, ongewijzigd. Geen ervan geeft bytes. |
| `groups.addMember`, `removeMember`, `create`, `remove`; `invites.accept`; `users.deleteSelf`; Clerk-webhook (`registerFromSession`) | lidmaatschappen | WP24. `groups.addMember` zonder instemming geeft voor het beeld niets meer prijs: een profielfoto is openbaar (besluit 8), en een foto volgt de foto-toegang. Het gat zelf blijft voor het beheer-WP. |
| `albums.addPhoto`, `removePhoto`, `remove`; `groups.remove`; `photos.remove` | `albumPhotos` | WP24, ongewijzigd |
| `POST /upload` | nieuwe foto van de caller | Ongewijzigd |

De inventaristests: `tests/images/noStorageIds.test.ts` (geen `_storage`-id in een return-validator van een publieke query), `tests/writeGates/storageReuse.test.ts` (publieke paden met een `_storage`-id als argument, WP24), en bij vorm B de routelijst in `tests/images/httpRoute.test.ts`.

### Pariteit-checklist per scherm

**Album** (`/groep/<groupId>/album/<albumId>`)

| Oude app | Nieuw (17a) |
|---|---|
| Cover over de volle breedte (1900 px), daaronder naam, jaar en "N foto's" | Cover (*groot*), naam, jaar (`sortDate`, anders `createdAt`), "N foto's". Terugknop-pil naar de groep. Geen cover: het vlak met de letter (WP16). |
| Raster, 3 kolommen staand, 4 liggend, 5 tot 6 op iPad; vierkante tegels, bijgesneden | Zo, met *klein* |
| Volgorde: datum van de foto (EXIF, anders upload), nieuwste eerst; bij gelijke datum nieuw eerst | Zo: `takenAt`, anders `createdAt`; dan nieuw eerst; dan id |
| Oranje hoekje op een nieuwe foto | Ja, uit `isNew`, en het blijft staan zolang het scherm open is (invariant 12). VoiceOver: "nieuw". |
| Persoon-icoon op een eigen foto | Ja. VoiceOver: "jouw foto". |
| Vlag op een gemelde foto | Stond uit in v1. Niet (vraag 4). |
| Tegel die nog laadt: grijs vlak met beeld-icoon | Zo. Laadt het niet: een rustige fout-toestand op de tegel, geen leeg vlak (design.md §6). |
| Tik: detail | Ja |
| Lang drukken: foto-menu; selectiemodus; kaart-knop; bewerk-knop (admin) | 17b; bewerken: beheer-WP |
| Leeg: "Nog geen foto's hier" | Leeg-toestand zonder verwijzing naar uploaden (WP18) |
| Fout met "opnieuw laden"; hulp-modals | Fout met "Opnieuw"; hulp-modals vervallen (design.md §6) |

**Foto-detail** (`/groep/<groupId>/album/<albumId>/foto/<photoId>`)

| Oude app | Nieuw (17a) |
|---|---|
| Swipen door het album, in de volgorde van het raster; de lijst geknipt op 20 voor en na (prestatie) | Swipen door hetzelfde album, zelfde volgorde. Hoe B het licht houdt, kiest B. |
| Beeld passend in het scherm (hooguit 1200 px) | *groot*, passend |
| Tik: zoom tot 2,5×, nog een tik terug | Zoomen (knijpen en dubbeltik), tot zeker 2,5× |
| Datum (EXIF, anders upload), als ruwe tekst | Datum van de foto in het Nederlands, zonder tijd (invariant 15) |
| Avatar en naam van de eigenaar | Ja (avatar via het beeldpad, anders de letter) |
| Plaats (`exifAddress`) | `locationLabel`, als die er is |
| "Publicaties": albums met de foto in groepen van de kijker | 17b (vraag 7) |
| Menu "…" (draaien, delen, melden, als cover, verwijderen) | 17b |
| Info verdwijnt half tijdens het swipen | Niet nodig |

**Covers en profielfoto's elders**

| Plek | Oude app | Nieuw (17a) |
|---|---|---|
| Mijn groepen, kaart per groep | Cover 256 px | Cover (*klein*), anders de letter |
| Groep, kop | Cover 1900 px | Cover (*groot*), anders de letter |
| Groep → Albums, tegel per album | Cover 256 px | Cover (*klein*), anders de letter |
| Groep → Leden | Profielfoto 256 px, rond | Profielfoto (*klein*), rond; anders de letter (invariant 14) |
| Profiel | Avatar 96 px, plus de profielfoto als achtergrond (1900 px) | Avatar (*klein*). De achtergrond: B kiest, binnen design.md. |

### Aanvullende invarianten

10. **Geen `storageId` in een publieke response.** De client vraagt een beeld op met een foto-id of een user-id. Een `storageId` bereikt de client nergens meer, ook niet anoniem via de invite-landing.
11. **Eén definitie van nieuw.** `isNew` in `albums.listPhotos` is waar voor precies de foto's die de teller van dat album telt: van een ander, toegevoegd na het laatste bezoek (of na `max(album.createdAt, joinedAt)` zonder bezoek). Het aantal `isNew` is gelijk aan de teller.
12. **Een markering blijft staan zolang het scherm open is.** Een foto die nieuw was toen het album openging, of die erbij kwam terwijl het open was, houdt zijn markering tot de user het scherm verlaat. `markSeen` haalt hem niet live weg.
13. **Zonder toegang, onbekend of gewist: één antwoord.** Het beeldpad geeft voor een foto zonder toegang, een onbekend id en een gewist beeld hetzelfde antwoord. Uitgelogd geeft 401 en nooit bytes.
14. **Een profielfoto die er niet is, ziet eruit als geen profielfoto.** Geen profielfoto, een gewist beeld en een onbekend user-id geven hetzelfde antwoord, en de app toont de letter, zonder fout-toestand.
15. **De datum van een foto is de datum op de klok van de camera** (regie-besluit, fix-cyclus 1, S3). `takenAt` is de kloktijd van de camera, opgeslagen alsof het UTC is: zo schrijft `exif-parser` hem (WP7), en zo landt de kalenderdag van v1 (`exifDate`, `YYYY-MM-DD`) via de WP12-transform op UTC-middernacht. De app toont de UTC-kalenderdag van `takenAt`, zonder omrekening: een avondfoto van 22:30 blijft op die dag. Zonder `takenAt` is `createdAt` de datum: een echt tijdstip, dus de dag in Nederlandse tijd.
16. **Als profielfoto alleen een eigen beeld** (besluit 10, fix-cyclus 2). Een profielfoto is openbaar (besluit 8), dus `users.updateProfile` zet `profilePhotoStorageId` alleen op:
    - het beeld van een foto waarvan de caller de eigenaar is. Een eigen upload valt hieronder: `POST /upload` maakt een eigen foto-rij. Een beeld dat aan foto's van twee eigenaren hangt, mag elk van beide eigenaren gebruiken;
    - de eigen huidige profielfoto (opnieuw zetten maakt niets nieuw openbaar).

    Foto-toegang tot de foto van een ander is niet genoeg, ook niet als groepsgenoot, admin of webmaster. Geweigerd geeft dezelfde uitkomst als een onbekend beeld en verandert niets, ook de naam in dezelfde aanroep niet. Het profielpad van de caller geeft daarna nog steeds zijn oude profielfoto. Dit vervangt de tak "foto met foto-toegang" van WP24 invariant 8.
17. **Het type van een beeld** (fix-cyclus 3, N-S2). Beide beeldpaden sturen de opgeslagen bytes ongewijzigd, met `X-Content-Type-Options: nosniff`. `Content-Type`:
    - opgeslagen als rasterbeeld (`image/jpeg`, `png`, `webp`, `heic`, `heif`, `gif`): dat type;
    - anders (`application/octet-stream`, geen type, of een ander type): JPEG, PNG, WebP of HEIC uit de eerste bytes. Onbekende bytes: 200 met `application/octet-stream`.

    Nooit een ander opgeslagen type. `/upload` neemt elk type aan, dus een eigen upload als `text/html` of `image/svg+xml` zou als profielfoto op het openbare profielpad in een browser draaien.
18. **Een beeld dat niet laadt, probeert het één keer opnieuw, met een vers token** (fix-cyclus 3, N-S1). Een verlopen token geeft 401. Na een fout haalt het beeld een vers token (Clerk `skipCache`) en wacht daarop: er gaat geen verzoek meer uit met het oude token. Lukt ook die poging niet, of komt er geen token, dan valt het terug: de fout-tegel, of de letter op een cover. Een laat token of een late fout van een eerdere poging verandert niets. "Opnieuw" op de fout-tegel begint zo'n reeks opnieuw, ook met een vers token.

### Edge cases

- **Foto gewist terwijl het detail open is:** de foto verdwijnt uit de lijst; het detail gaat naar de volgende, of terug naar het album als het de laatste was. Geen crash.
- **Foto uit het album gehaald (17b, of M1 bij vertrek van de eigenaar) terwijl hij open is:** hetzelfde.
- **Lid verwijderd terwijl album of detail open is:** `NOT_MEMBER`, de melding van WP16 invariant 9. Beelden die nog laden, krijgen 404 en blijven niet hangen.
- **Album gewist terwijl het open is:** `NOT_MEMBER` (zelfde antwoord als geen lid).
- **Twee toestellen van dezelfde user:** `markSeen` op het ene zet de teller op het andere live op nul. De markeringen op het open albumscherm van het andere toestel blijven staan (invariant 12).
- **Een foto die in twee albums van dezelfde groep staat:** in beide albums, en "nieuw" per album.
- **Foto van een ex-lid** (M1 haalt zijn foto's weg bij vertrek): verdwijnt live uit het album.
- **Foto zonder `takenAt`:** sorteert op `createdAt`, en het detail toont die datum.
- **Profielfoto waarvan het beeld gewist is** (kernvondst 6): de letter.
- **Uitloggen en inloggen als een ander op hetzelfde toestel:** geen beeld van de vorige user uit de cache (vraag 3).
- **Een verzonnen of misvormd id in het beeldpad:** hetzelfde antwoord als geen toegang, geen 500. Uitzondering: bij kapotte procent-codering antwoordt Convex zelf met 520 (besluit 9).
- **Een groot album (100+ foto's):** het raster laadt alleen wat in beeld komt; het detail laadt de buren, niet het hele album.

**Cascade-matrix.** Foto wissen: P3, P5, U7 (en kernvondst 6). Lid weg: M1, M3. Album of groep weg: A1, A2, G4. Uit een album: AP3, AP4. Met vorm B is geen nieuwe rij nodig: elk beeldverzoek leest de actuele staat. Met verkleinde versies wist de storage-cleanup van P/U7 ook de formaten: een nieuwe cel in U7.

### Meting op dev (Wouter)

1. **Storage-URL** (vraag 1): `npm run test:integration -- tests/integration/convex/storageUrl.test.ts` (vereist `.env.integration` met de dev-URL en `INTEGRATION_TEST_ENABLED=true` op dev, zoals WP2). De test pint wat de docs beloven (zonder auth op te halen; na wissen weg) en print de headers en of de URL stabiel is.
2. **Tellingen** (input voor WP25: formaten en vraag 9): de dev-tabellen exporteren naar `scripts/.data/wp17a/` en `node scripts/wp17a/tel.mjs` draaien. Het script geeft: grootte per beeld (mediaan, p90, max, totaal), het `contentType` van de beelden (hoeveel HEIC, voor de spike), de grootste albums in MB, en `exifOrientation` per waarde. De telling voor vraag 8 vervalt (besluit 8). Uitkomst op dev (2026-11-06): 1001 foto's, 1002 storage-objecten, 2,98 GB; per beeld gemiddeld 2,98 MB, mediaan 2,47, p90 6,26, max 20,06 MB. `contentType`: 558 `image/jpeg`, 444 `application/octet-stream`, geen HEIC. Grootste album: 302 foto's, 1,06 GB (~445 s op 20 Mbit/s). `exifOrientation` leeg op alle 1001. Geen gemelde foto's.
3. **Laadtijd op 4G:** bij de gate (stap 4), met de build van B en de formaten van WP25.
4. **Profielfoto's van een ander** (vraag 10, prod): op Wouters laptop (de server heeft geen AWS-sleutels) `node scripts/wp17a/profiel.mjs scripts/.data/dynamo-extract.json`. Het script leest alleen het ruwe extract (vers: `npm run migrate -- extract`, alleen lezen op AWS) en telt per user of de profielfoto een eigen foto is, de foto van een ander, een standaardbeeld of een los beeld.

### Tests

| Bestand | Pint |
|---|---|
| `tests/images/access.test.ts` | Invariant 1, 2, 3, 13 en 14: de foto volgt de foto-toegang, ook na vertrek, na uit het album halen en na wissen; de profielfoto is openbaar en altijd de actuele (besluit 8); de foto van een ander wordt niet openbaar via een profielfoto (invariant 16) |
| `tests/images/notMember.test.ts` | Invariant 7: `NOT_MEMBER` op de album- en foto-reads, gelijk voor geen toegang en onbekend, ook na verwijderen terwijl je kijkt |
| `tests/images/noStorageIds.test.ts` | Invariant 10: geen `_storage`-id in een return-validator van een publieke query |
| `tests/albums/listPhotosNew.test.ts` | Invariant 11: `isNew` en `owner` in `listPhotos`, dezelfde definitie als de teller, `markSeen` |
| `tests/readWhitelist/_world.ts`, `albums.test.ts`, `users.test.ts`, `invites.test.ts`, `tests/invites/publicGet.test.ts` (A paste aan) | De vormen zonder `storageId`; `listPhotos` met `owner` en `isNew`; de landing met `inviter._id` (besluit 8) |
| `tests/writeGates/storageReuse.test.ts` (A paste aan) | Invariant 16: als profielfoto alleen een eigen beeld; de foto van een ander met foto-toegang, ook bij twee eigenaren, wordt geweigerd met dezelfde uitkomst als een onbekend beeld |
| `tests/images/httpRoute.test.ts` | Besluit 1, 2 en 8: foto-pad met 401, één 404 en `private`; profielpad openbaar en actueel, met `no-cache`, en na een geweigerde poging met de foto van een ander geen bytes van die foto (invariant 16); het formaat-contract (*klein*/*groot*, terugval op het origineel, 400 bij een onbekende waarde); het `Content-Type` uit opgeslagen type of eerste bytes, nooit een ander opgeslagen type (invariant 17); de routelijst |
| `tests/integration/convex/storageUrl.test.ts` | Meting vraag 1 (niet in CI) |
| `app/tests/photos.test.ts` | Pure logica: de volgorde in het album, de datum van een foto (invariant 15), de draaiing per `exifOrientation` en de transform die React Native echt toepast (beide tegen een onafhankelijke afleiding uit de EXIF-definitie en de RN-bron), de markeringen die blijven staan (invariant 12), wanneer `markSeen` loopt (vraag 6) |
| `app/tests/imageCache.test.ts` | Besluit 3: lokaal wissen leegt geheugen en schijf van de beeldcache, ook als dat half mislukt. Invariant 3: een beeld met een profielbron heeft geen cache. |
| `app/tests/imageRetry.test.ts` | Invariant 18: na een fout één nieuwe poging met een vers token, geen verzoek met het oude, daarna terugvallen; de app gebruikt `src/lib/imageRetry.ts` |
| `app/tests/photoLoad.test.ts`, `photoImage.test.ts` | Invariant 18 in de app: `usePhotoLoad` met een nagebootste Clerk (`skipCache` bij de herhaling, nooit een bron met het oude of een laat token, `retry`); `PhotoImage` met key per poging, `onError` en "Opnieuw". Een kleine hook-runtime vervangt React (`app/tests/support/hookRuntime.ts`) |
| `tests/integration/images/exMember.test.ts` | Gate-stap 6 (invariant 2) op dev, met echte tokens (niet in CI) |
| `app/tests/groupRoutes.test.ts` (A vult aan) | Het pad en het routebestand van het foto-detail |

De pure logica staat in de app-tests als functies in `app/src/lib/photos.ts` en `app/src/lib/groupRoutes.ts`. B kiest de vorm van de schermen zelf. Ronde 2 (A, na de besluiten): de tests volgen besluit 1, 2 en 8. De keuze van het formaat zelf (welk bestand bij *klein* of *groot*) pint WP25.

## Closeout (regie, 2026-11-06)

- **Audit en red-team:** audit vond 1 blocker (B1, `Blob.slice` in de Convex-runtime) en 6 should-fixes; red-team vond R1–R3. Fix-cyclus 1 (B1, S1–S6), 2 (R1, invariant 16) en 3 (heraudit N-S1 en N-S2, invariant 17 en 18, plus tests op de aansluiting van de retry). Heraudit en red-team-hercheck: geen blocker. R2 → WP26, R3 → Groepsbeheer.
- **Op dev gezien:** octet-stream-albums laden in de echte runtime (B1); laatste deploy `1af3f61`.
- **Open voor de gate (Wouter, TestFlight, na WP25):** stap 1 en 4 (formaten, laadtijd), stap 6 (ex-lid), iOS `Cache.db` na uitloggen (red-team N2), geen 429's van Clerk als een heel album tegelijk een vers token vraagt.
- **Open, buiten 17a:** vraag 10 (gemigreerde profielfoto's van een ander): telling op Wouters laptop, besluit gaat naar WP12.
- **Backlog:** één live query per cover (N2); oude avatar na wisselen van profielfoto tot de cache verloopt (N4); geen CORS op de beeldpaden voor de webapp (N6, bij het webapp-WP).
