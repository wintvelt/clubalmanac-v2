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

## Invarianten

1. Een album krijgt de cover uit de bron als die foto gemigreerd wordt én in dat album staat. Anders blijft de cover leeg, met een melding en een telling, net als bij groepen.
2. Een groepscover volgt dezelfde regel: de foto moet in een album van die groep staan (WP24 invariant 2). Nu checkt de transform alleen of de foto bestaat.
3. Elke gemigreerde user met een `visitDateLast` krijgt één `userVisits`-rij met die tijd. `users.lastVisitAt` vult de transform niet meer.
4. Een standaard-profielfoto buiten `protected/` landt op de manier die WP17a en WP23 voor een profielfoto verwachten, of valt bewust weg. A zoekt uit wat er nu gebeurt; zie Open vragen.
5. Elk bronattribuut dat niet meegaat, staat als bewuste drop in de WP12-spec, met de reden.
6. `verify` vangt een ontbrekende cover. Een album- of groepscover die in de bron staat en resolvet, maar in Convex leeg is, is een bevinding.

## Edge cases + scope-uitsluitingen

- **In scope:** `transform.ts`, `load-records` en `verify` waar nodig (`userVisits` staat nog niet in `TABLE_ORDER`), het runbook en de WP12-spec. Dev opnieuw laden en `verify` groen.
- **Runbook T0:** `node scripts/.data/veld-tel.mjs` op de verse extract. Staat er een gemelde foto met een verlopen verwijderdatum, dan beslist Wouter vóór `load-records`.
- **Bewust niet:** `users.lastVisitAt` uit het schema halen (backlog), de FL1-cron aanpassen, uitnodigingen met tekst migreren.

## Open vragen

1. **Standaardfoto (A).** Wat doet de keten nu met een `photoUrl` buiten `protected/`? Wordt het één gedeeld bestand, een kopie per user, of een fout? En wat wil v2: een eigen standaardbeeld in de app, of het oude bestand?
2. **Welke v1-versie draait op prod (Wouter + A).** De uitgecheckte `master` is niet de nieuwste: die staat op `origin/dev` (api, groups, invites), `origin/hotfix` (photos) en `origin/hotfixes` (user). Wouter haalt de deploydata van de Lambda's op; A legt ze naast de branches. Wijkt de gedeployde versie af van wat WP12 las, dan meldt A of dat de mapping raakt.

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
