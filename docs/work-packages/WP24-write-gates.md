# WP24: Write-gates op foto-toegang

## Productdoel

Een clublid kan een foto alleen in een album zetten, als cover kiezen, melden of beoordelen als die de foto al mag zien. Wie ooit een photo-id zag, krijgt via een mutation geen toegang terug.

## Aanleiding

WP23 gaf elke publieke read auth en een veld-whitelist. Foto-toegang (`convex/lib/photoAccess.ts`) leunt op state die mutations schrijven: `albumPhotos` en `coverPhotoId`. Die mutations checken zelf geen foto-toegang. Aanval: een account maakt een eigen groep, zet een bekend photo-id in een eigen album, en leest de foto weer. Vanaf WP17 levert `getUrl` dan de beeldbytes. Zie WP23 §Audit-ronde 1 en §Closeout, en `audit-track-record.md` §Recurring-pattern-kandidaten (read-gate zonder write-gate). Besluit Wouter 2026-11-02: eigen WP, af vóór WP17.

## Begrippen

Zoals in WP23 §Begrippen. Kort:

| Term | Betekenis |
|---|---|
| ingelogd | Clerk-identity én users-rij |
| lid | ingelogd én membership in de groep |
| foto-toegang | ingelogd én (eigenaar, óf lid van een groep waarin de foto in een album staat). Eén definitie: `canAccessPhoto` |

## Invarianten

1. **Geen toegang via schrijven.** Na elke publieke mutation geldt: wie vóór de mutation geen foto-toegang had, heeft die erna ook niet. Geen enkele mutation maakt een foto zichtbaar voor de caller of diens groepen zonder dat de caller al foto-toegang had.
2. **Write-gate per mutation.** Deze mutations vereisen foto-toegang van de caller tot de foto die ze raken, bovenop hun bestaande rol-check:
   - `albums.addPhoto`
   - `groups.update` en `albums.update`, als `coverPhotoId` wordt gezet
   - `photos.flag`
   - `ratings.upsert`
3. **Geen bestaans-orakel in mutations.** "Bestaat niet" en "bestaat, maar geen toegang" geven dezelfde uitkomst (zelfde error-tekst). Dit geldt voor het photo-id in de mutations van invariant 2, het album-id in `albums.markSeen`, en het feature-id in `features.upvote` en `features.removeUpvote`.
4. **Verborgen problemen blijven verborgen.** Een `problem` van een ander (WP23 A-keuze 5) gedraagt zich in `features.upvote`/`removeUpvote` als een onbekend id. De `upvoteCount` van zo'n probleem verandert niet door een ander dan indiener of webmaster.
5. **Webmaster-check dwingt de users-rij zelf af.** `isWebmaster` geeft `false` voor een identity met een webmaster-email maar zonder users-rij, ook als de aanroeper dat niet vooraf checkt.
6. **Geen webmaster-bypass.** Ook de webmaster heeft voor de mutations uit invariant 2 gewone foto-toegang nodig (lijn van WP23).
7. **Bestaand gedrag met toegang verandert niet.** Wie toegang heeft, kan wat die nu kan. Bestaande rol-checks (admin, creator, eigenaar-kan-eigen-foto-niet-melden) blijven.

## Edge cases + scope-uitsluitingen

- **In scope**:
  - De mutations uit invariant 2-4, plus `isWebmaster`.
  - Cover-pad via de mutation (WP23-closeout): een admin probeert een photo-id zonder toegang als cover te zetten via `groups.update` en `albums.update`. De cover-read blijft dan dicht, en de mutation weigert.
  - Een foto in een album zetten mag alleen de eigenaar (A-keuze 1). Een cover staat in dát album of in een album van díe groep (A-keuze 2).
  - Lid verlaat een groep: mag daarna die foto's niet meer toevoegen, als cover zetten, melden of beoordelen (behalve eigen foto's).
  - Een eigen foto die in geen album staat: de eigenaar mag hem toevoegen en beoordelen, niet als cover zetten (A-keuze 2).
  - Het beeld (`storageId`) valt ook onder invariant 1 (A-keuze 5).
- **Open vragen voor A (toetsen tegen oude code, rapporteren aan regie)**:
  1. Mocht in de oude app iedereen met toegang een foto in een album zetten, of alleen de eigenaar? Was het strenger, rapporteer dan; regie legt het voor aan Wouter.
  2. Moet een cover een foto zijn die in dát album (album-cover) of in een album van díe groep (groep-cover) staat? De cascades AP4 (cover wissen als de publicatie verdwijnt) gaan daar al van uit. Zo ja, dan is dat strenger dan foto-toegang en volgt foto-toegang eruit.
  3. Mocht de eigenaar de eigen foto beoordelen?
  4. Andere publieke mutations met een bestaans-orakel op een id (bv. `photos.rotate`/`update`/`remove`/`appeal`, `groups.*`). Inventariseer; regie beslist of ze meegaan.
- **Bewust niet**:
  - Reads: die zijn in WP23 afgedekt.
  - Een cover wissen via `update` (kan nu niet, `undefined` betekent "niet wijzigen"). Hoort bij WP16/WP17 als een scherm het nodig heeft.
  - `pick` dat een `any`-rij stil accepteert (WP23-nit, geen gat vandaag).
  - Validatie van rating-waarden en flag-reden-lengte. Melden als A het ziet, niet meenemen.
  - Internal mutations en de migratie (`convex/migration.ts`): die schrijven geen user-input.

## Risico-assessment

- **security/privacy**: hoog — auth-grens op schrijfpaden die de read-toegang van WP23 bepalen. Setup 2 + adversarial houding in audit, met mutatie-check per gate.
- **ops**: laag — geen externe calls, geen nieuwe failure-modes. Te streng = knop faalt (zichtbaar), te ruim = lek (in tests zichtbaar).
- **external deps**: laag — geen.
- **multi-user/concurrency**: laag — Convex-mutations zijn transactioneel; check en schrijf in één transactie.
- **data/schema-evolutie**: laag — geen schema-wijziging. Wel: bestaande data kan albumPhotos of covers bevatten die de nieuwe gate niet zou toelaten (migratie uit v1). Geen backfill; de read-gate van WP23 houdt die dicht. A noteert of v1-data dit kan bevatten.
- **ops-runbook-impact**: geen nieuwe env-vars of deploy-config. Doc-deliverable: `docs/migratie-plan-convex.md` §RBAC krijgt een regel "writes die foto-toegang bepalen, checken foto-toegang, zie WP24" (B co-commit).

## Cross-refs

- WP23 (`docs/work-packages/WP23-read-whitelist.md`): §Begrippen, invariant 4 en 10, §Audit-ronde 1, §Closeout.
- `convex/lib/photoAccess.ts`: de ene definitie van foto-toegang.
- cascade-matrix: AP3 (ratings opruimen bij toegangsverlies), AP4 (covers wissen), FL2 (flag).
- WP17 (foto's bekijken) wacht op deze WP.
- oude code (alleen A): `blob-images-api-photos` (flag, rating), `blob-images-api-groups` (album-foto toevoegen, covers), `blob-images-api-features` (upvote), oude app `clubalmanac-app` (wie kon wat toevoegen, als cover kiezen, melden).

## Acceptance

- Tests per mutation uit invariant 2: niet-ingelogd, ingelogd zonder foto-toegang, met toegang. Zonder toegang: de mutation faalt én de state is ongewijzigd (geen albumPhoto, geen cover, geen flag-velden, geen rating, geen aggregaat-wijziging).
- Minstens één end-to-end aanvalstest: aanvaller met eigen groep en een bekend photo-id probeert elk pad, en kan de foto daarna via geen enkele read lezen.
- Orakel-tests: zelfde caller, onbekend id tegenover bestaand id zonder toegang, geeft een identieke uitkomst.
- `isWebmaster`: identity met webmaster-email zonder users-rij geeft `false`.
- Volledige unit-suite groen, `npx tsc` schoon (convex + app).
- Audit: mutatie-check per nieuwe gate (zet de gate uit, er valt een test om).

## Kickoff (regie, 2026-11-02)

- **Productdoel**: zie boven.
- **Risico**: security hoog, rest laag.
- **Setup**: 2 (spec-criticus A) + B + audit met adversarial opdracht en verplichte mutatie-check per gate.
- **Uitvoering**: rollen als sub-agent (Agent-tool) vanuit deze regie-sessie, zoals WP23. Deze sessie is door een andere sessie gestart en kan geen rol-sessies starten. Afwijking van de default "eigen sessie per rol" bij hoog risico; gecompenseerd door regie-review na elke rol en verbatim-quotes van audit-findings in de closeout. Go-ahead: besluit Wouter 2026-11-02 (eigen WP24, af vóór WP17) plus de opdracht van de startende sessie.
- **Werkboom**: WP15a-sessies werken tegelijk in dezelfde checkout (`app/`). Elke rol commit met pathspec.

---

## Spec-criticus aanvullingen (A)

Bronnen (alleen A): `blob-images-api-groups` (createAlbumPhoto, createAlbum, updateAlbum, updateGroup, `libs/dynamodb-lib-single`), `blob-images-api-photos` (createPhoto met upload-acties, flagPhoto, updateRating, getRating), `blob-images-api-user` (updateUser), `blob-images-api` (streams groupPhotoDelToCover, memberDelToAlbumPhoto, ratingChangeToPhoto), oude app `clubalmanac-app` (PhotoSelectionMenu, SelectAlbum, PhotoMenu, SelectGroupPhoto, EditGroup/EditAlbum), `scripts/migrate/transform.ts`.

### Wat de oude code deed

- **Foto in een album zetten**: alleen de eigenaar. De API zocht de foto op (photo-id, caller) en die sleutel bestaat alleen voor de eigenaar. Het menu "Toevoegen aan album" stond alleen aan als alle geselecteerde foto's van de caller waren. Uploaden naar een album kon elk lid, met een eigen nieuwe foto. Een bestaande foto toevoegen eiste in de API daarnaast groep-admin.
- **Covers**: de API eiste groep-admin en foto-toegang (eigenaar, of lid van een groep met een publicatie van de foto, in welke groep dan ook). Zonder toegang negeerde de API de cover stil. De app bood alleen foto's uit dát album (album-cover) of uit de albums van díe groep (groep-cover), plus "nieuwe foto uploaden als cover". Die upload maakte bij een groep-cover géén publicatie aan.
- **Melden**: foto-toegang vereist, eigen foto niet. Een al gemelde foto gaf stil de foto terug.
- **Beoordelen**: bedoeld als foto-toegang, maar de check miste een `await` en liet dus alles door. Een stream telde een rating zonder toegang als 0 mee. Niets hield de eigenaar tegen. Een rating was 0 of 1 (like).
- **Profielfoto**: elke foto met foto-toegang.
- **Lid vertrekt**: de publicaties van zijn foto's in die groep verdwenen, en een stream wiste daarbij de covers (album-cover altijd, groep-cover bij de laatste publicatie in de groep).

### Antwoorden op de open vragen

1. **Strenger.** Alleen de eigenaar kon een foto in een album zetten (API en UI). Zie A-keuze 1.
2. **In de API niet, in de app wel.** De API accepteerde elke foto met foto-toegang, ook uit een andere groep. De app bood alleen foto's uit dat album of uit die groep, plus een upload als groep-cover zonder publicatie. Zie A-keuze 2.
3. **Ja.** Niets in de oude code hield de eigenaar tegen. De draft klopt.
4. **Inventaris bestaans-orakels in andere publieke mutations.** Regie beslist:
   - `photos.update`, `remove`, `rotate`, `appeal`: "Foto bestaat niet" tegenover "Alleen eigenaar ..." op het photo-id. Lekt alleen bestaan, geeft geen toegang.
   - `albums.update`, `remove`, `addPhoto`, `removePhoto`, `markSeen`: "Album bestaat niet" tegenover "Geen lid van deze groep" op het album-id. `markSeen` staat al in invariant 3; voor `addPhoto` en `update` zie A-keuze 3. `remove` en `removePhoto` blijven over.
   - `groups.*`: geen orakel op het groep-id (eerst de lid- of admin-check, één error).
   - `groups.addMember`: "User bestaat niet" tegenover "User is al lid" op het user-id. Iedereen kan een groep maken en is daar admin, dus voor iedereen bruikbaar. Zie ook §Buiten scope.
   - `invites.remove`: "Invite bestaat niet" tegenover "Geaccepteerde invite ..." tegenover "Geen rechten" op het invite-id. De status lekt vóór de rechten-check.
   - `invites.create`: "Deze gebruiker is al lid van de groep" laat een lid testen of een email-adres bij een groepslid hoort. De ledenlijst toont geen email (WP23).
   - `invites.accept`/`decline`: de token is het geheim, geen orakel van belang.
   - `ratings.remove`, `features.update`/`remove`, `photos.decideFlag`: geen orakel van belang (stil, of webmaster-only).

### A-keuzes ter bevestiging

Keuzes 1, 2, 5 en 6 zijn strenger dan de draft. Ze respecteren invariant 1, en de tests pinnen ze. De tests staan in een eigen `describe` met "A-keuze n" in de naam, zodat regie ze makkelijk kan terugdraaien.

1. **`albums.addPhoto`: alleen de eigenaar van de foto.** Dat is v1-pariteit. Wie een foto publiceert, bepaalt de eigenaar: een ander lid kan andermans foto niet in een groep zetten waar de eigenaar geen lid van is. Dit vervangt de draft-edge-case "foto in twee groepen, caller lid van één: toevoegen aan een andere eigen groep mag". Dat mag nu alleen de eigenaar. Een niet-eigenaar met toegang en een onbekend of ontoegankelijk id geven dezelfde uitkomst. De rol-check (lid) blijft (invariant 7). v1 eiste admin voor een bestaande foto, maar liet elk lid uploaden naar een album; v2 heeft die twee paden samengevoegd.
2. **Cover: album-cover staat in dát album, groep-cover in een album van díe groep.** Dat is v1-UI-pariteit en sluit aan op AP4 (cover wissen bij de laatste publicatie). Alleen zo ziet elk lid de cover: met WP23 invariant 10 ziet een lid zonder foto-toegang `cover: null`. Foto-toegang van de caller volgt eruit. Dit vervangt de draft-edge-case "eigen foto in geen album: als cover zetten". Dat kan nu niet. Een groep-cover via "nieuwe foto uploaden" vereist dus eerst een publicatie in die groep (WP16/WP18). Bestaande covers blijven staan: een update zonder `coverPhotoId` slaagt, ook als de huidige cover niet meer aan de regel voldoet.
3. **Album-id-orakel ook in `albums.addPhoto` en `albums.update`.** Dat zijn de mutations uit invariant 2 met een album-id. Een onbekend album en een album van een groep waar de caller geen lid van is, geven dezelfde uitkomst, zoals `markSeen` (invariant 3) en de album-reads (WP23).
4. **Al gemelde foto zonder toegang.** `photos.flag` op een al gemelde foto geeft zonder toegang dezelfde uitkomst als een onbekend id. Het stille "al gemeld" blijft alleen voor wie toegang heeft. Anders lekt de meld-status.
5. **Invariant 1 geldt ook voor het beeld (storage-blob), niet alleen voor de foto-rij.** De foto-vorm bevat `storageId`, dus een ex-lid kent de `storageId` van foto's die hij ooit zag. Twee paden geven het beeld terug:
   - `photos.create` is publiek (bedoeld als test-fixture) en accepteert elke `storageId`. Een ex-lid maakt een eigen foto-rij op het beeld van een ander, is daarvan eigenaar, en kan hem lezen en publiceren. Dat omzeilt ook A-keuze 1.
   - `users.updateProfile` accepteert elke `profilePhotoStorageId`. Een ex-lid zet het beeld als eigen profielfoto. Groepsgenoten zien het dan, en zodra profielfoto's een URL krijgen, ziet de caller het zelf ook.

   Voorstel: geen publieke mutation koppelt een `storageId` die al bij een foto van een ander hoort aan een nieuwe foto-rij. Een profielfoto mag geen beeld zijn van een foto waar de caller geen foto-toegang toe heeft (v1-pariteit: profielfoto = foto met toegang). `photos.create` intern maken zou ook dichten, maar veel bestaande tests gebruiken hem als fixture; dat vraagt dan een A-cyclus. Tests: `tests/writeGates/storageReuse.test.ts`. Regie kan dat bestand schrappen als dit naar een eigen WP gaat.
6. **Upvote door de webmaster op andermans probleem mag** (de draft, invariant 4). Gepind als controle, geen wijziging.

### Aanvullende edge cases (gepind in RED-tests)

- Een mislukte mutation laat álle state ongewijzigd, ook velden die op zich mochten. Voorbeeld: `groups.update` met een geldige nieuwe naam en een verboden cover. De naam blijft dan ook oud.
- `groups.update`/`albums.update` zonder `coverPhotoId` slagen, ook als de huidige cover niet meer aan A-keuze 2 voldoet (bv. na vertrek van de eigenaar). Een stale cover blokkeert geen naamswijziging.
- Lid vertrekt: daarna zijn melden en beoordelen van die foto's dicht. Een rating van vóór het vertrek blijft staan (zie §Buiten scope), maar is niet meer te wijzigen.
- Eigen foto in geen album: de eigenaar mag hem in een album zetten en beoordelen (vraag 3). Cover zetten kan niet (A-keuze 2).
- Webmaster zonder lidmaatschap, met een eigen groep: weigering op elk pad uit invariant 2, net als bij elk ander account.
- `features.removeUpvote` op een verborgen probleem waar de caller tóch een upvote-rij op heeft (legacy of migratie): gedraagt zich als onbekend id, `upvoteCount` en de rij blijven.
- Het bestaans-orakel geldt ook ten opzichte van het "al gedaan"-pad: een al gemelde foto (A-keuze 4), en een foto die al in het album staat, als de caller geen eigenaar is.

### v1-data (risico data/schema-evolutie)

- **Covers**: ja. Covers via "upload als groep-cover" staan in geen album van die groep. Covers via foto-toegang kunnen uit een andere groep komen. De migratie checkt alleen of de foto bestaat. Geen backfill: de WP23-read-gate geeft `cover: null` aan wie geen toegang heeft. Bestaande covers blokkeren geen update (edge case hierboven).
- **albumPhotos**: nee. In v1 voegde alleen de eigenaar toe, dus `addedBy` = eigenaar (transform) klopt, en alle v1-publicaties voldoen aan A-keuze 1.

### Buiten scope, wel gezien (voor regie)

- **`groups.addMember` voegt een bestaand account toe zonder uitnodiging of instemming.** Iedereen kan een groep maken en daarin een willekeurig user-id zetten. Het slachtoffer zit dan in een groep van de aanvaller: de aanvaller ziet het publiek profiel (`users.getById`), het slachtoffer krijgt ongevraagd een groep met albums in de app. Het geeft de aanvaller geen foto-toegang tot foto's van het slachtoffer. v1 kende alleen uitnodigingen. Kandidaat voor WP16/WP19.
- **M1 wist geen covers.** `internalRemoveMember` haalt de publicaties weg maar laat `coverPhotoId` staan; v1 wiste ze via de stream. De WP23-read-gate verbergt het, maar de rij is inconsistent met AP4. Kandidaat voor de cascade-matrix.
- **Ratings van een vertrokken lid blijven in het aggregaat.** AP3 draait alleen bij `albums.removePhoto`, niet bij vertrek (M1). v1 telde ze via de stream als 0.
- **`storageId` in de foto-vorm.** Als WP17 de URL via het photo-id levert, kan `storageId` uit de foto-vorm. Dan valt A-keuze 5 grotendeels weg.
- **Validatie**: `ratings.upsert` accepteert elk getal (v1: 0 of 1). `photos.flag` accepteert een reden van elke lengte.
- **Rol bij `addPhoto`**: v1 eiste admin voor een bestaande foto, v2 eist lid. Invariant 7 laat het zo. Melden, niet wijzigen.

### Regie-besluiten na A (2026-11-02)

- **A-keuzes 1-4 en 6: aangenomen.** Ze zijn v1-pariteit en respecteren invariant 1. Draft-edge-cases hierboven zijn erop aangepast.
- **A-keuze 5 (beeld via `storageId`): aangenomen, in deze WP.** Zonder deze gate omzeilt een ex-lid A-keuze 1 en invariant 1 via het beeld, en dat is precies wat WP17 met `getUrl` blootlegt. `tests/writeGates/storageReuse.test.ts` blijft staan. B kiest de vorm zolang de bestaande fixtures blijven werken.
- **Orakel-inventaris (vraag 4): niet in deze WP.** Ze lekken alleen bestaan, geen toegang. Gaan naar de backlog in `audit-track-record.md`: `photos.update`/`remove`/`rotate`/`appeal`, `albums.remove`/`removePhoto`, `groups.addMember`, `invites.remove`, `invites.create`.
- **Buiten scope (A): naar de closeout als vervolg.** `groups.addMember` zonder instemming (kandidaat WP16/WP19), M1 wist geen covers en laat ratings in het aggregaat (cascade-matrix), `storageId` uit de foto-vorm (WP17), rating-validatie.

### Test-strategie

- Nieuwe map `tests/writeGates/`. Die hergebruikt de seed-wereld van `tests/readWhitelist/_world.ts`.
- Per gate: niet-ingelogd, identity zonder users-rij, ingelogd zonder toegang, met toegang. Zonder toegang: de mutation faalt én een snapshot van de geraakte rijen (albumPhotos, cover, flag-velden, ratings, aggregaat, upvotes) is gelijk aan vóór de call.
- Orakel: zelfde caller, onbekend id (insert + delete) tegenover bestaand id zonder toegang. De uitkomst is identiek, en de test schrijft de error-tekst niet voor.
- Aanvalstest: een vers account met een eigen groep en album probeert elk pad op een gepubliceerde foto en op een ongepubliceerde foto. Daarna leest geen enkele publieke read de foto of zijn `storageId`, en de state is ongewijzigd.
- `isWebmaster` wordt direct getest met een identity met webmaster-email zonder users-rij.
- Bestaande tests die als opzet een foto zonder toegang melden of beoordelen, of een cover buiten het album zetten, krijgen eerst toegang (`tests/_helpers/access.ts`, of de foto in het album). Cascade-tests waarvan de opzet niet meer via een mutation kan (M1 cross-owner, P5-covers), seeden de rij direct. De bedoeling van zo'n test blijft gelijk.

---

## Audit-ronde 1 → fix-cyclus (regie, 2026-11-02)

Audit: geen blockers, 18 van 20 mutanten gevangen. Eén should-fix, S1, verbatim:

> "De beeld-gate werkt met een verbodslijst. Elk beeld zonder foto-rij is vrij over te nemen, ook andermans profielbeeld."

Profielbeeld-ids staan in het publiek profiel (`groups.listMembers`, `users.getById`) en in de invite-landing. Gemigreerde v1-profielfoto's hebben geen foto-rij. Een ex-lid kan zo met `photos.create` eigenaar worden van andermans profielbeeld, of het als eigen profielfoto zetten. Dat valt onder het productdoel, dus het gaat mee in deze WP.

**Invariant 8 (vervangt A-keuze 5).** Een publieke mutation koppelt een beeld (`storageId`) alleen aan de caller als dat beeld al van de caller is of door de caller gezien mag worden: het beeld van een eigen foto of van een foto met foto-toegang, of de eigen huidige profielfoto. Elk ander beeld wordt geweigerd: dat van een foto zonder toegang, andermans profielbeeld, en een los beeld dat nergens aan hangt. Onbekend en verboden beeld geven dezelfde uitkomst.
- Gevolg: een vers beeld als profielfoto kan pas via een upload-pad dat de herkomst vastlegt. Dat ontwerpt WP18 (profielfoto uploaden). Tot dan kiest een user een eigen of toegankelijke foto (v1-pariteit). De app gebruikt dit pad nog niet.
- `photos.create` wordt geen publieke mutation meer. In productie loopt een upload via `POST /upload` en `createFromUploadInternal`; `photos.create` is alleen een test-fixture. De fixtures gaan over op een interne variant (A).

**Verder in deze cyclus:**
- **Tests (A)**:
  - invariant 8, inclusief andermans profielbeeld en een los beeld; de test "een nieuw geüpload beeld als profielfoto mag" draait om;
  - een beeld dat aan foto's van twee eigenaren hangt (audit N1);
  - fixtures van `api.photos.create` naar de interne variant;
  - `convexTest` krijgt de modules expliciet mee, zodat tests altijd de `convex/`-map naast zichzelf gebruiken (audit R1: een kopie met gesymlinkte `node_modules` gaf een vals-groene mutatie-check).
- **Impl (B)**: invariant 8 en `photos.create` intern.

**Besluiten op de overige audit-punten:**
- **N2 `ratings.remove` zonder toegangscheck: zo laten.** Een ex-lid mag zijn eigen rating intrekken; dat geeft geen toegang en geen orakel. A's edge case "niet meer te wijzigen" geldt voor `upsert`.
- **N3 orakel op het beeld-id**: valt onder invariant 8 (één uitkomst).
- **N4 profielfoto blijft na vertrek staan**: naar WP17, samen met `storageId` uit de foto-vorm.
- **N5 mogelijk flaky `tests/http/upload.test.ts`**: naar de backlog.
