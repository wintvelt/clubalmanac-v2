# WP19a: ratings schrappen

> Draft regie 2026-11-13. Backend-WP met een kleine app-wijziging. A → B → audit → gate op dev. Eigen branch `wp19a`. WP19 is gesplitst: WP19a (dit) en WP19b (uitnodigen en aanmelden).

## Besluiten Wouter

1. **Ratings schrappen (2026-11-13).** Redenen:
   - De oude app had geen scherm voor ratings (WP13, open vraag 1).
   - In v1 waren ratings likes (0 of 1), geen score (WP12, valkuil 4).
   - Op prod staan er 6.

   Daarmee vervallen de backlog-punten uit WP28 (besluit 11 en 13): de leesgrens bij vertrek, groep verwijderen en account verwijderen met veel ratings, en audit K3.

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
6. **App.** Account verwijderen noemt geen ratings meer. Verder verandert er niets zichtbaars.
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

(Leeg in draft.)
