# WP19a: ratings schrappen

> Draft regie 2026-11-13. Backend-WP met een kleine app-wijziging. A → B → audit → gate op dev. Eigen branch `wp19a`. WP19 is gesplitst: WP19a (dit) en WP19b (uitnodigen en aanmelden).

## Besluiten Wouter

1. **Ratings schrappen (2026-11-13).** Redenen:
   - De oude app had geen scherm voor ratings (WP13, open vraag 1).
   - In v1 waren ratings likes (0 of 1), geen score (WP12, valkuil 4).
   - Op prod staan er 6.

   Daarmee vervallen de backlog-punten uit WP28 (besluit 11 en 13): de leesgrens bij vertrek, groep verwijderen en account verwijderen met veel ratings, en audit K3.

2. **Schrappen blijft (2026-11-13, na A's stop op vraag 1).**
   - De oude webapp had een like-knop en een teller "+N"; de iPhone-app niet.
   - De bron telt 12 likes van 4 leden. De laatste is van 2022-12.
   - Bij T0 verdwijnen ze. De nieuwe webapp (Track B) krijgt geen likes.
   - A's dev-volgorde (vraag 3) is akkoord.

3. **Fix-cyclus 1 (2026-11-13, na de audit).** Er waren geen blockers.
   - Should-fix 1: de bevestiging bij foto verwijderen noemt nog likes. Invariant 6 is nu ruimer.
   - A breidt de app-scan uit naar "like" en "likes" (`app/src`), en laat de telling-test in `transform.test.ts` alleen het getal vóór "like(s) geschrapt" lezen (audit-punt 4).
   - B haalt de tekst weg.
   - Regie checkt het resultaat; er volgt geen nieuwe audit.
   - Verouderde docs (audit-punt 2) gaan mee in de closeout.

## Productdoel

Er bestaan geen ratings meer: een lid kan er geen geven en ziet er geen. Vertrekken, een lid verwijderen, een groep of album verwijderen en je account verwijderen hangen niet meer af van hoeveel ratings er ooit gegeven zijn.

## Invarianten

1. **Geen publieke ingang.** Geen publieke query, mutation, action of httpAction neemt of geeft een rating. Dat geldt ook voor het gemiddelde of het aantal in een geneste foto-vorm (album, detail, Mijn foto's, covers). De inventaristest van WP23 legt dat vast.
2. **Geen opslag.** Het schema heeft geen tabel `ratings` en geen rating-velden op een foto.
3. **Cascades blijven verder gelijk.** De volgende paden doen niets meer met ratings en blijven verder precies zoals ze waren:
   - vertrekken en een lid verwijderen;
   - een groep of album verwijderen;
   - een foto uit een album halen;
   - een foto verwijderen;
   - een account verwijderen (alle stappen).

   De bestaande tests van die paden blijven groen. Alleen asserties over ratings vallen weg.
4. **Migratie: bewuste drop.**
   - De transform neemt geen ratings meer over. Hij meldt het aantal geschrapte likes in zijn uitvoer, net als de andere verliezen.
   - `inspect`, `load-records`, `verify` en `reset` kennen geen ratings-tabel meer.
   - Een extract met likes laadt zonder fout.
5. **Integriteitscheck.** De dagelijkse check controleert geen rating-aggregaat en geen rating-verwijzingen meer. De andere categorieën blijven ongewijzigd en op dev schoon.
6. **App.** Geen tekst in de app noemt nog ratings of likes. Dat geldt voor Account verwijderen, voor de bevestiging bij foto verwijderen en voor elke andere tekst (fix-cyclus 1). Verder verandert er niets zichtbaars.
7. **Dev blijft bruikbaar.** Na de wijziging is dev herladen of schoongemaakt, en `verify dev` is groen.

## Edge cases + scope-uitsluitingen

- **In scope:**
  - alles in `convex/`, `scripts/migrate/`, `tests/` en `app/` dat ratings kent;
  - de rijen in de cascade-matrix (R1, P4, U6, A1, AP3, M1, M5, G4, MON1 2b);
  - de volgorde van de schemawijziging op dev.
- **Bewust niet:**
  - Uitnodigen en aanmelden: WP19b.
  - De grens van zo'n 4000 publicaties per groep bij vertrekken en groep verwijderen. Die staat los van ratings en blijft in de backlog; de grootste groep op prod heeft er 1459.
  - Features en upvotes (`features.upvoteCount`): blijven zoals ze zijn.

## Risico-assessment

- **security/privacy: laag.** Er verdwijnen ingangen en er komen er geen bij. Wel controleren dat geen pad meer naar de tabel of de velden verwijst.
- **ops: laag.** Er is nog geen prod-deployment (die komt op T-4 weken), dus alleen dev wordt geraakt.
- **external deps: laag.** Geen.
- **multi-user/concurrency: laag.** Er vallen alleen schrijfacties weg.
- **data/schema-evolutie: medium.**
  - Een tabel en twee foto-velden gaan weg.
  - Convex weigert een schema-push als een bestaande rij er niet aan voldoet. Elke foto op dev heeft `ratingCount`, dus de volgorde op dev moet expliciet zijn (A schrijft die).
  - Bij T0 vallen de likes uit de AWS-bron weg. Dat is onomkeerbaar in Convex; de AWS-bron blijft bestaan tot T+30.
  - Pre-flight, zie [`data-migration-preflight.md`](../conventions/data-migration-preflight.md):
    - een tag `pre-wp19a` door regie;
    - de telling van likes in de laatste extract, door A.

    Een prod-export is niet nodig, want er is nog geen prod-deployment.
- **ops-runbook-impact:** geen nieuwe env-vars of config. Het cutover-stappenplan krijgt bij `load-records` een regel: "het aantal geschrapte likes staat in de transform-uitvoer". B voegt die toe.

## Cross-refs

- WP13 open vraag 1; WP12 valkuil 4 (likes 0/1); WP28 besluit 11 en 13, vondsten 1–4; WP23 inventaristest; WP24 (rating-write-gate, valt weg).
- cascade-matrix: R1, P4, U6, A1, AP3, M1, M5, G4, MON1 (2b).
- Oude code (alleen A): `blob-images-api-photos` (ratings), de oude app op een like-knop of -teller.

## Open vragen voor A

1. Had de oude app ergens een like-knop of een teller, ook in een oudere versie? Zo ja: stop en meld het. Dan beslist Wouter opnieuw.
2. Hoeveel likes staan er in de laatste extract, van hoeveel users en op hoeveel foto's?
3. Wat is de volgorde op dev: schema eerst optioneel, dan opruimen, dan weg? Of dev leegmaken, deployen en herladen? Kies, met de reden.
4. Kent nog iets anders de ratings: een e-mail, een `_test`-functie, een integratietest of een monitoring-mail?

## Acceptance

- Tests: suite en typecheck groen (backend en app). De inventaristest kent geen rating-ingang meer. De cascade-tests van invariant 3 draaien zonder rating-asserties en met hetzelfde gedrag.
- Dev: geherladen of schoongemaakt, `verify dev` groen, en de integriteitscheck schoon.
- Gate (regie, simulator op dev): een album, het foto-detail en Mijn foto's laden. De tekst bij Account verwijderen noemt geen ratings meer.

## Werkvolgorde

| # | Rol | Wat |
|---|---|---|
| 1 | regie | deze draft, branch `wp19a`, tag `pre-wp19a` |
| 2 | A (`wp-a`) | open vragen 1–4, aanvulling hieronder, RED tests (inventaris, schema, transform-drop, cascades zonder ratings) |
| 3 | B (`wp-b`) | schrappen tot groen, cascade-matrix en cutover-regel bijwerken, dev volgens A's volgorde |
| 4 | audit (`wp-audit`) | rapport in chat |
| 5 | regie | gate op dev |

Geen red-team: deze WP haalt alleen ingangen weg en voegt geen toegangspad toe.

---

## Spec-criticus aanvullingen (A vult in)

> A, 2026-11-13. Vraag 1 was een stop; na besluit 2 volgen de tests (§Tests).

### Vraag 1: like-knop of teller in een oude client — ja, in de oude webapp

- **iPhone-app** (`clubalmanac-app`, alle 125 commits sinds 2022-12-09): geen knop, geen teller. De app roept `/photos/{id}/rating` nooit aan.
- **Oude webapp** (`blob-images-frontend`, 2020-04 tot 2023-02; de Android-fallback uit Track B): wel.
  - Op de fotopagina een duim omhoog en een duim omlaag met je eigen stand (+1 of 0). De backend houdt de waarde op 0 of 1, dus de duim omlaag haalt alleen je like weg.
  - Een teller "+N" op elke fotokaart in de lijsten en op de fotopagina, voor elk lid zichtbaar.
  - `blob-images-frontend-NEW` (2022-10) is een lege start zonder ratings.
- **Gebruik:** de laatste like is van 2022-12-21. Sinds de iPhone-app is er geen like meer gegeven.
- **Wat dit met besluit 1 doet:** reden 1 klopt alleen voor de iPhone-app. Reden 2 klopt. Reden 3: in de bron staan er 12, niet 6 (zie vraag 2).

### Vraag 2: likes in de laatste extract (2026-11-06)

- 13 like-records: 12 met waarde 1 en 1 zonder waarde (ingetrokken, de transform slaat die over).
- **12 likes van 4 users op 12 foto's.** Elke foto en elke user bestaat in de bron.
- Per maand: 2020-11: 4, 2021-09: 1, 2022-08: 6, 2022-12: 1.
- De 6 uit besluit 1 is de dev-subset: 1 user op 6 foto's. De andere 6 vallen buiten de users die voor dev gekozen zijn. Op T0 zou de transform er 12 laden; na WP19a meldt hij er 12 als geschrapt.

### Vraag 3: volgorde op dev — dev leegmaken, deployen en herladen

Volgorde, met de gewone migrate-commando's ([runbook](../runbooks/wp12-data-migratie.md)):

1. `reset --target dev --yes`, **met de oude code nog op dev**. De oude migratiefuncties kennen de ratings-tabel; daarna zijn `photos` en `ratings` leeg.
2. Deploy de nieuwe code naar dev. Met lege tabellen accepteert Convex het schema zonder `ratings` en zonder de rating-velden.
3. `transform --target dev` met de nieuwe transform (het extract van 2026-11-06 staat er nog). De uitvoer meldt 6 geschrapte likes.
4. `load-records`, `formaten` (ongeveer 45 minuten, op de achtergrond), `verify`.
5. De integriteitscheck één keer draaien: schoon.

Waarom zo:
- Dit is de bestaande route bij elke schemawijziging in fase 4, met geteste tooling en `verify` als controle.
- Het test meteen invariant 4 op echte data: een extract met likes laadt zonder fout.
- De andere route (schema eerst optioneel, opruimen, dan weg) vraagt twee deploys en een opruimfunctie die alleen voor dev bestaat en daarna weer weg moet.

Let op:
- Wie de nieuwe code naar dev deployt vóór stap 1, krijgt een weigering: elke foto heeft `ratingCount`. Dat is veilig, maar dev blijft dan op de oude code tot de reset.
- `reset` wist ook wat met de hand op dev staat, zoals de testgroep Gatetest. Die moet opnieuw vóór de gate.

### Vraag 4: wat kent de ratings nog meer

- **E-mail:** nee. `lib/emailTemplates.ts` noemt ratings alleen in een commentaar.
- **Monitoring-mail:** indirect. De drift-mail toont de regels van de scan. Twee onderdelen gaan weg: de controle van het rating-aggregaat (2b) en de twee rating-verwijzingen in `MONITORED_FKS`. Die lijst bepaalt ook wat `reset`, de leeg-check van `load-records` en `verify` tellen. `verify` gebruikt dezelfde scan.
- **`_test`-functies en `/_test/whoami`:** nee.
- **Integratietests** (`tests/integration`): nee.
- **Wel, en nog niet in de spec genoemd:**
  - `inspect` heeft een kolom met gegeven likes per user;
  - `scripts/migrate/types.ts` (tabellenlijst en verwijzingen), en `loadRecords.ts` (meldt meegevallen likes en herrekent `ratingCount`);
  - de test-oracles `tests/migration/fkOracle.ts` en `sharedLists.test.ts`;
  - `ratings:listForPhoto` in de WP23-inventaris; `upsert` en `remove` in WP24 (`tests/writeGates/rating.test.ts`);
  - de nieuwe webapp (Track B, live op T-1 week) moet ook geen ratings krijgen.

### A-invarianten (aanvulling op invariant 1–6)

1. **Ook de plekken uit vraag 4 kennen geen ratings meer:** de likes-kolom in `inspect`, de tabellenlijst en verwijzingen in `scripts/migrate/types.ts`, en `loadRecords.ts` (de melding bij `--accept-missing-files` noemt geen likes meer en herrekent geen rating-velden).
2. **De transform meldt de drop in één regel.** Die regel bevat de woorden "like" en "geschrapt" en het aantal. Het aantal is: actieve likes (waarde 1) op een foto én van een user die allebei geladen worden. Een ingetrokken like of een record zonder waarde telt niet. Op het extract van 2026-11-06 is dat 12 voor prod en 6 voor dev.
3. **Geen code in `convex/` noemt nog een rating.** Commentaar telt niet; een tabelnaam in een string wel. Dit dekt "geen pad verwijst nog naar de tabel of de velden".
4. **Een nieuwe foto heeft geen rating-velden** (upload en `photos.create`).
5. **App:** geen bestand in `app/` noemt nog een rating, ook de uitleg bij Account verwijderen niet. Die noemt nog wel de lidmaatschappen.

### Tests

Nieuw:
- `tests/ratingsGone/noRatings.test.ts`: schema zonder tabel en velden, geen module `ratings`, geen functie met een rating in naam, args of returns (ook genest), en de bronscan van A-invariant 3.
- `tests/migration/transform.test.ts` §WP19a: geen tabel `ratings` in de uitvoer, geen rating-veld op een foto, de drop-regel op prod en dev, ingetrokken likes tellen niet. Het verwachte aantal komt uit de fixture, niet uit een vast getal. De fixture kreeg een like op een foto die dev niet laadt, en een record zonder waarde.
- `tests/migration/inspectNoLikes.test.ts`: `inspect` draait op een extract met likes en noemt ze niet.
- `app/tests/noRatings.test.ts`: A-invariant 5.

Aangepast (de rest van het gedrag blijft gelijk):
- de oracles `fkOracle.ts` (dus `sharedLists.test.ts` en de nep-deployment), de WP23-inventaris, de melding in `loadRecords.test.ts`;
- de integriteitscheck: de 2b-tests op het rating-aggregaat zijn vervangen door "een foto zonder rating-velden is schoon";
- de cascade-tests van invariant 3: rating-seeds en -asserties zijn weg; `fixScale` test nu vertrek en account weg in een groep met 3000 publicaties zonder ratings;
- `ratingCount: 0` is uit alle foto-inserts in tests gehaald, en `photos/crud` en `http/upload` controleren dat een nieuwe foto het veld niet heeft.

Verwijderd, want ze testen alleen ratings: `tests/ratings/*`, `tests/readWhitelist/ratings.test.ts`, `tests/writeGates/rating.test.ts`, `tests/groups/fixRatings.test.ts`.

Rood tot B klaar is: bijna alle foto-tests, omdat het schema `ratingCount` nog eist. Typecheck: alleen die fout. Een wegwerp-referentie (niet gecommit) maakt alles groen.

### Voor B

- Cutover-regel bij `load-records`: "de transform meldt het aantal geschrapte likes (op T0 12)".
- Cascade-matrix: R1, P4, U6, AP3 en de rating-delen van A1, M1, M5, G4 en MON1 (2b) vallen weg.
- Dev volgens vraag 3. Stap 3 meldt 6 geschrapte likes.
