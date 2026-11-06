# WP17a: Foto's bekijken — albumscherm, foto-detail en het beeldpad

> Draft regie 2026-11-06. App-WP (zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4)), met een backend-deel. Eigen sessie per rol, plus een red-team op het beeldpad omdat security/privacy hoog is. Bouwt op [WP16](./WP16-groepen.md), [WP23](./WP23-read-whitelist.md) en [WP24](./WP24-write-gates.md). WP17 is gesplitst (besluit Wouter 2026-11-06): 17a is alleen bekijken, de acties op foto's komen in WP17b.

## Productdoel

Een lid opent een album en ziet de foto's rechtop, en snel genoeg om erdoor te bladeren. Groeps- en albumcovers en profielfoto's verschijnen op de plekken waar WP16 nu een letter toont. Niemand zonder toegang tot een foto krijgt het beeld te zien: niet wie uitgelogd is, niet wie geen lid is, niet een ex-lid, en ook niet iemand die alleen een id of een oude link heeft.

## Invarianten

1. **Het beeld volgt de foto-toegang.** Bytes van een foto krijgt alleen wie er foto-toegang toe heeft (`canAccessPhoto`, WP23). Een id, een `storageId` of een URL alleen is nooit genoeg. Dit geldt voor elk beeld: albumfoto's, covers en profielfoto's.
2. **Wie de toegang verliest, verliest het beeld.** Na vertrek uit een groep, verwijdering uit een album of verwijdering van de foto levert een eerder verkregen link of id het beeld niet meer op. Hoe snel dat moet, is open vraag 1. Of een cache op het toestel van het ex-lid hieronder valt, is open vraag 3.
3. **Een profielfoto lekt geen foto.** Je ziet de profielfoto van iemand met wie je een groep deelt, en van niemand anders. Na vertrek uit de groep zie je hem niet meer (WP24 N4). Een profielfoto die een foto is waar de kijker geen toegang toe heeft, geeft die foto niet prijs (WP24 heraudit N2, via `groups.addMember` zonder instemming).
4. **Elk beeld staat rechtop, en wordt precies één keer gedraaid.** Raster, detail, covers en profielfoto's volgen `photos.exifOrientation` uit Convex, niet de EXIF-tag in het bestand ([WP8](./WP8-photo-rotation.md) §Frontend-contract). Een foto waarvan het bestand zelf een andere oriëntatie draagt dan de DB, toont de DB-stand.
5. **Een album openen downloadt niet elke foto op volle grootte.** Een album van 50 foto's opent in een paar seconden op 4G en kost geen honderden MB. Het meetpunt legt Wouter vast bij open vraag 2; regie stelt voor: de eerste rij is binnen 3 seconden zichtbaar op 4G.
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
| 6 | red-team, eigen sessie | zoekt actief een pad naar beeldbytes zonder foto-toegang: met een id, een `storageId`, een oude URL, een profielfoto, als ex-lid of uitgelogd. Krijgt alleen het productdoel en de diff. Rapport verbatim naar Wouter. |
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
  6. Ex-lid: een eerder verkregen link of id levert het beeld niet meer op, binnen de tijd van open vraag 1. Hoe je dit test, schrijft A uit.
  7. Dashboard: op een andere tab loopt geen album- of foto-query.
  8. Albumscherm en detail bij de grootste tekst, in licht en donker.
  9. Ruimte voor bevindingen buiten deze stappen

---

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft.)
