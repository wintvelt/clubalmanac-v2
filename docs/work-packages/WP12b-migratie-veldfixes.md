# WP12b: Migratie-veldfixes — albumcovers, bezoek, bewuste drops

> Draft regie 2026-11-07. Fix op de WP12-tooling, uit de TestFlight-gate van WP17a/WP25 (albumcovers ontbreken) en de veldaudit van A die daarop volgde. A → B → audit. Eigen branch `wp12b`. Vóór T0.

## Productdoel

Na de migratie ziet een lid elk album met de cover die het in de oude app had, en verdwijnt er geen gegeven uit v1 zonder dat dat ergens als bewuste keuze staat.

## Aanleiding

- **Albumcovers.** `scripts/migrate/transform.ts` zet `coverPhotoId` van elk album op leeg. De bron heeft hem als `photoId` op het album-item (`GA`), hetzelfde formaat als bij een groep. Op prod hebben alle 17 albums een cover, en alle 17 foto's bestaan. `verify` telt alleen rijen en zag het daarom niet.
- **Veldaudit (A, 2026-11-07).** Elk attribuut dat de oude backend schrijft is naast de transform gelegd, plus een telling op de prod-extract (`scripts/.data/veld-tel.mjs`, op Wouters laptop). Uitkomst:
  - Gemelde foto's: 0 op prod. De FL1-cron van v2 wist een gemelde foto na de verwijderdatum, v1 deed dat nooit. Met 0 nu is een check op T0 genoeg.
  - Verouderde avatar-sleutel na draaien in v1, coördinaten of likes van een ander type: 0 op prod.
  - Uitnodigingen: geen meer geldig, dus de tekst die wegvalt maakt niet uit.
  - `visitDateLast` (20 users) landt in `users.lastVisitAt`, dat sinds WP15b niemand leest. Het bezoek staat in v2 in `userVisits`.
  - 9 users hebben als `photoUrl` een standaardfoto buiten `protected/`.
  - Zonder melding gedropt, zonder functie na de migratie: `invitation.message` en `user.name` op uitnodigingen, `deletedFlagged`, `inviteId`, `visitDatePrev`, `cognitoId`, `invitation` op actieve leden en `prevRating`.

## Besluiten Wouter (2026-11-07)

1. Albumcovers worden overgenomen.
2. Het bezoek wordt een rij in `userVisits`. Het is alleen intern te lezen (WP15b), maar daar bewaart v2 het.
3. Eigen branch, na de merge van WP25.
4. **Covers zonder publicatie (A3):** voorstel A. Een cover komt mee zodra de foto gemigreerd wordt; staat hij in geen album van de groep, dan een waarschuwing in het transform-rapport, geen drop. Telling prod: alle 17 albumcovers staan in hun eigen album; 3 van de 4 groepscovers staan in geen album van de groep, dus die ziet in v2 alleen de eigenaar. Dat de leden ze ook zien, regelt WP27 (besluit 2026-11-07), niet deze WP.
5. **Standaardfoto (A1):** het oude bestand houden, als los beeld gedeeld per bestand. Niets bouwen.

## Invarianten

1. Een album krijgt de cover uit de bron (`GA.photoId`) zodra die foto gemigreerd wordt. Waar de foto staat, maakt voor de migratie niet uit (besluit 4). Staat hij niet in dat album, dan komt hij mee met een waarschuwing in het transform-rapport die album en foto noemt. Wordt de foto niet gemigreerd (bestaat niet, of valt buiten de dev-seed), dan blijft de cover leeg, met een melding die album en foto noemt. Een cover in het eigen album geeft geen waarschuwing.
2. Een groepscover volgt dezelfde regel: hij komt mee zodra de foto gemigreerd wordt. Staat de foto in geen album van die groep, dan een waarschuwing die groep en foto noemt; in v2 ziet alleen de eigenaar zo'n cover (WP23 invariant 10), en na T0 kiest een admin een nieuwe (WP17b). De publicatie-eis van WP24 invariant 2 geldt voor nieuwe covers, niet voor de migratie. Een cover in een album van de groep geeft geen waarschuwing.
3. Elke gemigreerde user met een `visitDateLast` krijgt één `userVisits`-rij met die tijd. `users.lastVisitAt` vult de transform niet meer.
4. Een standaard-profielfoto buiten `protected/` landt als los beeld, één storage-object per bestand, gedeeld door de users die hem hebben (besluit 5). Zo werkt de keten al; niets bouwen. Zie A1.
5. Elk bronattribuut dat niet meegaat, staat als bewuste drop in de WP12-spec, met de reden.
6. `verify` vangt een ontbrekende cover. Een album- of groepscover die in de bron staat en waarvan de foto gemigreerd wordt, maar die in Convex leeg is, is een bevinding. Een cover die alleen een waarschuwing kreeg (invariant 1 en 2) is geen bevinding. Zie A4.

## Edge cases + scope-uitsluitingen

- **In scope:** `transform.ts`, `load-records` en `verify` waar nodig (`userVisits` staat nog niet in `TABLE_ORDER`), het runbook en de WP12-spec. Dev opnieuw laden en `verify` groen.
- **Runbook T0:** `node scripts/.data/veld-tel.mjs` op de verse extract. Staat er een gemelde foto met een verlopen verwijderdatum, dan beslist Wouter vóór `load-records`.
- **Bewust niet:** `users.lastVisitAt` uit het schema halen (backlog), de FL1-cron aanpassen, uitnodigingen met tekst migreren.

## Open vragen

Geen. Vraag 1 (standaardfoto) is besluit 5, vraag 2 (welke v1-versie draait) is beantwoord in A2.

## Risico-assessment

- **security/privacy:** laag — dezelfde data, geen nieuw pad naar buiten. Een cover volgt al de foto-toegang (WP17a).
- **ops:** midden — de T0-keten verandert (transform, load-records, verify). `verify` moet dit soort gat voortaan vangen.
- **external deps:** laag — alleen de extract, die al bestaat.
- **multi-user/concurrency:** laag — batch vóór de app opengaat.
- **data/schema-evolutie:** midden — geen schemawijziging, wel een nieuwe tabel in de migratie en een herlaad van dev. Preview op dev: transform, `reset`, `load-records`, `formaten`, `verify`.

## Werkwijze

| Stap | Wie | Wat |
|---|---|---|
| 1 | A | Spec-criticus, open vraag 1 en 2, RED tests op de transform en `verify`. |
| 2 | B | Impl, runbook, dev opnieuw laden (Wouter draait de commando's). |
| 3 | Audit | Op spec, tests en impl. |
| 4 | Gate | Wouter: in de app hebben de albums op dev een cover. `verify` groen. |

## Cross-refs

- [WP12](./WP12-data-migratie-tooling.md): tabelvolgorde, stap 7 (covers), lijst van drops.
- [WP15b](./WP15b-profiel-instellingen-info.md): `userVisits`.
- [WP24](./WP24-write-gates.md) invariant 2: een cover staat in het album of de groep.
- [WP25](./WP25-fotoformaten.md): `formaten` na `load-records`.
- Runbook: [`wp12-data-migratie.md`](../runbooks/wp12-data-migratie.md).
- Oude code (alleen A): `~/Code/v1/`, ook de branches `dev`, `hotfix` en `hotfixes`.

## Acceptance

- Tests: invarianten 1–3 en 6 op de transform en `verify`. Root-tests en typecheck groen.
- Dev opnieuw geladen: elk album uit de seed met een cover in de bron heeft er een, `verify` groen. Let op: `reset` wist ook de testgroep Gatetest (WP16); die moet daarna opnieuw, voor de gate van WP17b.
- WP12-spec heeft de lijst van bewuste drops; het runbook heeft de T0-check.

---

## Spec-criticus aanvullingen (A vult in)

> A, 2026-11-07. Gelezen: v1 op `master` én op de nieuwste branches (zie open vraag 2), de transform, `load-files`, `load-records`, `verify`, `convex/migration.ts`, `convex/monitoring.ts`, de profielfoto-paden (`convex/images.ts`, `convex/lib/profilePhoto.ts`, `convex/lib/photoAccess.ts`) en WP24 A-keuze 2.

### A1. Open vraag 1 — standaardfoto: de keten werkt al, voorstel is niets veranderen

- **Wat de keten nu doet.** De transform neemt `public/img/knorren/knorN.jpg` over als `profilePhotoStorageKey`. `load-files` haalt hem uit dezelfde bucket als de foto's en maakt er per sleutel één storage-object van; users met dezelfde standaardfoto delen dat object (`storage-map.json` is per S3-sleutel). Geen kopie per user, geen fout. Ontbreekt het bestand in de bucket, dan meldt `load-files` dat als ontbrekend bestand, zoals elke andere foto.
- **Wat de oude app deed.** Hetzelfde bestand tonen: `makeImageUrl` behandelt `public/` net als `protected/` en haalt het via de beeld-proxy uit de bucket. Een lid zag dus de knor.
- **Wat v2 ermee doet.** Een gedeeld object zonder foto-rij is een "los beeld", en daar is v2 al op gebouwd: het profielpad serveert het origineel (`profileImageInFormat`, `fallback: true`, er zijn geen formaten), `canUseStorage` laat de user zijn huidige losse beeld opnieuw meesturen (WP24 invariant 8), en WP10 telt het als verwezen zolang één user het draagt. Op dev staat al zo'n user (WP17a: "één een los beeld").
- **Voorstel:** het oude bestand houden, geen eigen standaardbeeld. Het is pariteit met v1, het werkt nu al, en een eigen standaardbeeld is een productkeuze voor een app-WP, geen migratiefix. Invariant 4 wordt daarmee: "landt als los beeld, gedeeld per bestand"; er hoeft niets gebouwd te worden.
- **Randje, geen blocker.** Kiest de laatste user van een knor een andere profielfoto of verwijdert hij zijn account, dan hangt het object aan niets meer en meldt WP10 het de volgende ochtend als wees. Dat geldt voor elk los beeld; opruimen kan met `prune-storage` of een handmatige delete. Geen test, wel genoemd.

### A2. Open vraag 2 — welke v1-versie draait

Commitdata per repo (laatste commit per branch). De uitgecheckte branch is `master`, behalve bij features (`dev`).

| Repo | `master` | Nieuwste andere branch |
|---|---|---|
| blob-images-api | 2020-11-04 | `dev` 2023-02-05 |
| blob-images-api-features | 2022-09-17 | `dev` 2023-01-24 |
| blob-images-api-groups | 2023-01-02 | `dev` 2023-02-10 |
| blob-images-api-invites | 2020-11-01 | `dev` 2020-11-03 |
| blob-images-api-photos | 2023-08-27 | `hotfix` 2023-12-18 |
| blob-images-api-user | 2022-10-17 | `hotfixes` 2023-02-05 |
| blob-images-common | 2023-12-18 | — |

Een Lambda met `LastModified` na de datum van de nieuwste branch draait die branch (of iets nieuwers dat niet in de repo staat); vóór de `master`-datum draait iets ouders. Wat de branches op schrijfpaden verschillen: `groups/dev` schrijft `sortDate` op een album (`updateAlbum`), `api/dev` accepteert bij aanmelding automatisch de uitnodiging, `user/hotfixes` zet een tijd vóór de bestandsnaam en heeft `listInvites`. **Geen van die verschillen verandert de betekenis van een attribuut dat de transform leest.** De mapping hangt af van wat er in de data staat, en dat heeft de telling gemeten. Raakt de `LastModified`-vergelijking dit toch, dan alleen als er een Lambda blijkt te draaien die in geen enkele branch staat; dan meldt A dat.

**Uitkomst (2026-11-07).** Photos draait `hotfix` (laatste deploy 2023-12-18, de dag van die tip); dat is wat de veldaudit las. Voor de andere vijf services, `master` naast de nieuwere branch:

| Service | Verschil op schrijfpaden | Raakt een veld of de mapping? |
|---|---|---|
| user (`hotfixes`) | `listInvites` (alleen lezen); upload zet een tijd vóór de bestandsnaam | Nee. Alleen de vorm van de S3-sleutel; transform en `load-files` nemen `PO.url` zoals hij is. |
| groups (`dev`) | `updateAlbum` schrijft `GA.sortDate`; cover-upload weigert een gemelde foto | Eén veld: `GA.sortDate`. De transform leest het al en laat het weg als het ontbreekt; de app valt dan terug op `createdAt`, net als v1. De extract laat zien of het gevuld is (telscript: "GA met sortDate"). |
| features (`dev`) | probleem-melding per mail | Nee, schrijft niets in DynamoDB. |
| api (`dev`) | stream accepteert de uitnodiging bij aanmelding (via `UPstats.inviteId`) | Nee. Schrijft dezelfde `UM`-velden als een handmatige acceptatie. |
| invites (`dev`) | alleen `serverless.yml` | Nee. |

Open vraag 2 is daarmee beantwoord: welke branch er ook draait, de mapping blijft gelijk. Wouter hoeft geen deploydata meer op te zoeken.

### A3. Invarianten 1 en 2 kloppen niet met de bron — besluit Wouter nodig

- **Groepscover zonder publicatie bestaat in v1.** De upload-actie `groupcover` (`blob-images-api-photos/handlersPhoto/createPhoto.js:140-158`) maakt een foto en zet hem als groepscover zonder albumfoto. `createGroup`/`updateGroup` accepteren elke foto waar de admin toegang toe heeft, ook een eigen foto in geen enkel album. v1 toonde de cover aan elk lid (een kopie op de groep).
- **Albumcover uit een ander album.** `updateAlbum` accepteert ook een foto uit een ander album van de groep; alleen de upload-actie `albumcover` zet hem in het eigen album.
- **Wat v2 daarmee doet.** Een cover is zichtbaar voor wie foto-toegang heeft (WP23 invariant 10). Een albumcover uit een ander album van dezelfde groep ziet dus elk lid; een groepscover die nergens in de groep staat ziet alleen de eigenaar, de rest krijgt `cover: null`. WP24 A-keuze 2 zegt voor bestaande covers: "blijven staan, ook als ze niet meer aan de regel voldoen".
- **Gevolg van de draft.** Invariant 1 ("in dat album") gooit een albumcover weg die elk lid in v2 gewoon zou zien. Invariant 2 gooit een groepscover weg die de eigenaar nog zou zien; de andere leden zien hem hoe dan ook niet meer. En elke bewuste drop maakt `verify` rood (invariant 6, "elk verschil is een bevinding"), dus T0 wordt dan nooit groen zonder acceptatie-mechanisme.
- **Voorstel A:** een cover komt mee zodra de foto gemigreerd wordt, zonder publicatie-eis (zoals de groepscover nu al werkt, en in lijn met WP24 "bestaande covers blijven staan"). Een cover die niet in een album van de groep staat krijgt een waarschuwing in het transform-rapport ("alleen de eigenaar ziet hem"), geen drop. Dan is `verify` groen te krijgen en verdwijnt er niets.
- **Eerst tellen.** Het telscript telt nu per cover waar de foto staat (zie A7). Zijn de afwijkende aantallen 0, dan is de keuze theoretisch en vallen draft en voorstel samen.
- **Besloten (besluit 4):** voorstel A. Invariant 1 en 2 zijn daarop herschreven; beide gevallen zijn gepind.

### A4. Invariant 6 — `verify` haalt zijn verwachting uit de bron

- Het gat zat in de transform. Een `verify` die de records naast de deployment legt, was op 2026-11-07 ook groen geweest: records zonder cover, deployment zonder cover. De verwachting komt dus uit `dynamo-extract.json`, de laag vóór de transform (ab-audit-workflow §verificatiestap).
- **Verwacht:** het aantal groepen en albums dat geladen wordt én in de bron een cover heeft waarvan de foto ook geladen wordt. Een cover naar een niet-bestaande foto of een foto buiten de dev-seed telt niet mee; die wist de transform al met een melding.
- **Gevonden:** het aantal groepen en albums met een cover in de deployment. De deployment kent geen bron-sleutels, dus een telling per tabel. Die vangt de klasse "cover valt weg"; een cover naar de verkeerde foto vangt hij niet. Contract voor het harnas: `internal.migration.coverCounts` geeft `{ groups, albums }`.
- **Zonder extract** kan `verify` dit niet controleren en is hij niet groen; de melding noemt het bestand. Op T0 en bij de dev-seed staat het extract er altijd.
- Elk verschil is een bevinding, met de tabel en "cover" in de melding.

### A5. `userVisits` moet in de bewaakte set van WP10

- `reset`, de leeg-preconditie van `load-records` en de telling van `verify` werken op `MONITORED_TABLES` uit `convex/monitoring.ts` (WP12 fix-cyclus 2). `userVisits` zit daar niet in. Gevolg vandaag al: na een `reset` blijven op dev de `userVisits`-rijen uit app-gebruik staan, met een `userId` naar een user die niet meer bestaat; niemand ziet het. Met WP12b erbij wordt het erger: na `reset` plus `load-records` staan de gemigreerde bezoeken naast de wezen van vóór de reset, en `verify` telt de tabel niet.
- **Aanvulling:** WP10 bewaakt `userVisits.userId → users` (verplicht). Daarmee valt de tabel vanzelf onder `reset`, de preconditie en de telling, en meldt de dagelijkse scan een wees. `userVisits` komt in de laadvolgorde na `users`. Dit raakt `convex/monitoring.ts` (WP10) en `convex/migration.ts` (de laad-tabellen); valt binnen "load-records en verify waar nodig".

### A6. Invariant 3 en 5 — preciseringen

- **Invariant 3.** Een bezoek is een kalenderdag en wordt UTC-middernacht, zoals elke andere v1-datum. Lege string = geen bezoek. Dev: alleen chosen users. Precies één rij per user. Elke rij draagt een eigen `sourceKey`.
- **Invariant 5 — de bewuste drops met reden**, voor de lijst in de WP12-spec:

| Bronattribuut | Reden |
|---|---|
| `UM` (uitnodiging) `invitation.message`, `user.name` | Geen geldige uitnodigingen meer op prod (telling); v2 heeft er geen veld voor; tokens worden toch vernieuwd. |
| `UM` (lid) `invitation` | Wie iemand uitnodigde; v1 toonde het niet in de ledenlijst. |
| `UPstats.deletedFlagged` | Teller van afgewezen bezwaren; v1 schreef hem en las hem nergens. |
| `UPstats.inviteId` | Alleen voor het automatisch accepteren bij aanmelding; alle users bestaan al. |
| `UPstats.photoCount` | Wordt herteld uit de foto's (WP12). |
| `UVvisit.visitDatePrev` | "Laatste bezoek" op het v1-profiel; WP15b maakt het bezoek bewust onzichtbaar. |
| `UVvisit.cognitoId`; `RK` (elk item); `datePK`, `dateSK` (`PO`, `GP`); `PO.flagged` | Cognito- en indexvelden; geen betekenis in v2. |
| `UF.prevRating`, `PO.rating` | Hulpveld en afgeleid aggregaat; likes worden herteld. |
| `user`, `group`, `photo` (kopieën op `UM`, `GA`, `GP`, `PO`, `NFfeature`) en het `USER`-record | Gedenormaliseerde kopieën; de bron is het basisrecord. |
| `GA.photo`, `GBbase.photo` | Kopie van de cover-foto; de cover gaat via `photoId`. |
| `UBbase.photoId` | v2 koppelt de profielfoto aan het beeld, niet aan een foto-id. Telling: 0 verouderde sleutels. |

### A7. Telscript uitgebreid

`scripts/.data/veld-tel.mjs` telt nu ook, per albumcover die resolvet: in dat album / in een ander album van de groep / in geen album van de groep; en per groepscover: in een album van die groep / nergens, en daarvan hoeveel van de founder zijn (de upload-route). Alleen tellingen, geen waarden. Voor Wouter, als hij het nog eens draait:

```bash
node scripts/.data/veld-tel.mjs
```

### A8. RED tests

| Bestand | Wat |
|---|---|
| `tests/migration/wp12bTransform.test.ts` | Invariant 1 en 2 (cover in het eigen album komt mee op prod en dev, zonder waarschuwing; cover uit een ander album, cover in geen album en groepscover zonder publicatie in de groep: mee, met waarschuwing die rij en foto noemt; cover naar een niet-bestaande of weggefilterde foto: leeg plus melding; elke cover resolvet) en invariant 3 (rijen, datum, dev-filter, lege string, `users.lastVisitAt` leeg, FK en `sourceKey`). |
| `tests/migration/wp12bVerify.test.ts` | Invariant 6: groen als alles klopt (ook met covers die terecht wegvielen, en met covers die alleen een waarschuwing kregen); niet groen bij een ontbrekende album- of groepscover, bij het oorspronkelijke gat (transform zonder albumcovers), en zonder extract. |
| `tests/migration/migrationFunctions.test.ts` | `insertRows` op `userVisits`, een wees-`userVisits` is drift, `coverCounts` telt alleen rijen met een cover. |
| `tests/migration/fkOracle.ts` | `userVisits.userId → users` in de oracle; daardoor rood in `sharedLists.test.ts` en de tel- en leeg-lussen van `migrationFunctions.test.ts` (A5). |
| Harnas | `buildExtractWithCovers` (fixture), `buildExtractFile`, `buildRecordsFile(target, items)`, nep-`coverCounts`; `verifyAndReset` en `pruneStorage` zetten het extract standaard in de werkmap. |

29 rood, allemaal om de bedoelde reden; de rest van de suite (1344) en de typecheck zijn groen.

### Nog bij Wouter

Niets. Besluit 4 en 5 zijn verwerkt in invariant 1, 2 en 4.
