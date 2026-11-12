# WP17c: Mijn foto's, toevoegen aan album, en in welke albums een foto staat

> Draft (regie, 2026-11-12). App-WP met een klein backend-deel. Gesplitst uit de oude WP17c (besluit 2026-11-12): de kaart, locatie wijzigen en delen gaan naar WP17d.

## Productdoel

Een lid vindt al zijn eigen foto's op één plek, ook de foto's die in geen album staan, en zet ze in een album van zijn groep. Bij elke foto die hij ziet, ziet hij in welke albums die staat, maar alleen albums die hij zelf mag zien.

## Besluiten Wouter

1. **Eén lijst in Mijn foto's, nieuwste upload eerst** (2026-11-12, A-keuze 1).
2. **Schakelaar "Alle / Niet in een album"** (2026-11-12, A-keuze 2).
3. **"In welke albums" bij elke foto, zonder mini-cover en niet aantikbaar** (2026-11-12, open vraag 3).
4. **De laadgrens vastleggen in een test, niet ombouwen** (2026-11-12, audit S1). Mijn foto's laadt in één query die groeit; rond 2000 foto's met formaten loopt die vast (prod-maximum 456). Een test laadt zoals de app, met 1500 foto's met formaten. Echt bladeren per pagina gaat naar de backlog.

## Invarianten (draft)

1. **Mijn foto's toont alleen je eigen foto's.** Dat zijn alle foto's waarvan jij de eigenaar bent: in een album of in geen album, en ook een geüploade profielfoto (WP18). Nooit de foto van een ander.
2. **Ook voor het grootste account.** Mijn foto's laadt voor het lid met de meeste foto's op prod (456), met marge, binnen de Convex-limieten. De app laadt in één query die groeit en steeds vanaf het begin leest (besluit 4). Die query loopt vast rond 2000 foto's met formaten bij "Alle", en rond 4000 met de schakelaar "Niet in een album". Wie scrolt tot het eind, of de schakelaar aanzet, laadt alles in één keer. Echt bladeren per pagina staat in de backlog.
3. **Toevoegen aan album.** Vanuit een selectie kies je een album uit een groep waar je lid van bent. Per foto geldt de bestaande gate (`albums.addPhoto`, WP24). Wat niet mocht, meldt de app per foto, zoals de selectie in WP17b. Een foto die al in het album staat, is geen fout: hij wordt overgeslagen en verschijnt niet dubbel.
4. **In welke albums staat deze foto.** Het detail van een foto toont de albums (met de groep) waarin hij staat. Je ziet alleen albums uit groepen waar je lid van bent. Van andere albums verraadt de app niets: geen aantal, geen naam en geen "en nog 2".
5. **Alles op één toegangsregel.** De nieuwe read volgt de standing rule [Toegangsdefinities](../conventions/work-package-specs.md#toegangsdefinities-verplicht-bij-wps-die-er-een-invoeren). Hij geeft alleen een whitelist van velden terug, geen `storageId`.
6. **Acties in Mijn foto's** volgen de regels van WP17b: wat je met een eigen foto mag (draaien, verwijderen, als profielfoto), mag hier ook. De bevestigingen zijn dezelfde.

## Scope

- **In scope:**
  - het scherm Mijn foto's (nu een placeholder in de tabbalk), met selectie;
  - "Toevoegen aan album" in de selectie: in Mijn foto's, en in een album als v1 dat had (open vraag 2);
  - "In welke albums" in het foto-detail;
  - in de backend: een gepagineerde read voor je eigen foto's, de read voor de albums van een foto, en wat `addPhoto` nodig heeft voor een selectie.
- **Bewust niet:**
  - de kaart, locatie wijzigen en delen (WP17d);
  - album maken (Groepsbeheer, WP28);
  - melden (WP20);
  - ratings (WP19).

## Risico-assessment

- **security/privacy: medium.** Er komt een nieuwe read die laat zien in welke albums een foto staat. Die mag niets verraden over groepen waar je geen lid van bent. Mijn foto's toont ook foto's die niemand anders ziet.
- **ops: laag.** Geen externe dienst.
- **external deps: laag.** Geen nieuwe bibliotheek.
- **multi-user/concurrency: laag.** Twee leden zetten dezelfde foto tegelijk in een album; een foto wordt gewist terwijl jij hem toevoegt.
- **data/schema-evolutie: laag.** Hooguit een index voor het bladeren op datum.
- **ops-runbook-impact:** geen.

## Open vragen voor A / Wouter

1. **Sortering en groepering in Mijn foto's.** Hoe deed v1 dat: op opnamedatum of op uploaddatum, per maand of per jaar? En was er een filter op "in geen album"?
2. **Toevoegen aan album: waar precies?** Alleen in Mijn foto's, of ook in de selectie binnen een album (een foto van album A ook in album B zetten)? En mag je de foto van een ander toevoegen? `addPhoto` laat dat toe als je foto-toegang hebt (WP24).
3. **"In welke albums": voor elke foto, of alleen voor je eigen foto's?**

## Cross-refs

- [WP17b](./WP17b-foto-acties.md): open vraag 4 en 5, het selectiemenu en de melding per foto.
- [WP18](./WP18-foto-upload.md): de profielfoto is een eigen foto in geen album.
- [WP24](./WP24-write-gates.md): de gate op `albums.addPhoto`.
- [WP17a](./WP17a-fotos-bekijken.md): het beeldpad, `NOT_MEMBER`.
- [`cascade-matrix.md`](../cascade-matrix.md): AP-rijen (publiceren).
- Oude code (alleen A): het scherm "Mijn foto's", de album-keuze en "Publicaties" in het foto-detail in `clubalmanac-app`.

## Sessies

| Stap | Wie | Wat |
|---|---|---|
| 1 | regie | deze draft |
| 2 | A (`wp-a`) | spec-aanvulling (vraag 1–3, de pariteit per scherm, de telling) en RED tests voor de backend en de pure app-logica |
| 3 | B (`wp-b`) | implementatie tot groen, met een release-build in de simulator |
| 4 | audit | toetst B aan de spec en de tests |
| 5 | regie + Wouter | gate in de simulator tegen dev |

## Acceptance

- Tests: A bepaalt welke.
- Gate op dev (simulator, release-build):
  - Mijn foto's als Dev Wouter (473 foto's): laden, bladeren, ook foto's in geen album;
  - een selectie toevoegen aan een album, met een foto die er al in staat;
  - "In welke albums" bij een foto die in een groep staat waar het tweede lid geen lid van is: dat album ziet het tweede lid niet.

---

## Spec-criticus aanvullingen (A, 2026-11-12)

Bronnen: de oude app (`screens/MyPhotos.jsx`, `SelectAlbum.jsx`, `PhotoSelectionMenu.jsx`, `PhotoDetail.jsx`, `AlbumPhotos.jsx`, `components/PhotoMenu.jsx`, `datastores/images.js`), de oude backend (`blob-images-api-photos`: `listAllPhotoPublications`, `listPhotoPublications`; `blob-images-api-groups`: `createAlbumPhoto`; `blob-images-common`: `dbCreate`), de huidige `convex/` en `app/`, en de prod-export (`scripts/wp17c/mijn-fotos-tel.mjs`).

### Kernvondsten

1. **Andermans foto kan niet in een album.** Open vraag 2 gaat ervan uit dat `addPhoto` dat toelaat met foto-toegang. Dat klopt niet: alleen de eigenaar (WP24 A-keuze 1, code `NOT_PHOTO_OWNER`). v1 was even streng (eigenaar, en admin van de groep).
2. **"Staat er al in" is nu een weigering.** `addPhoto` geeft `ALREADY_IN_ALBUM` (WP28) en zet niets dubbel. Invariant 3 vraagt geen backend-wijziging: de app telt die code als "stond er al in", niet als fout. v1 overschreef de rij stil, en de foto telde dan opnieuw als nieuw; v2 doet dat niet.
3. **v1 laadde alles in één keer, per album.** Eén call gaf al je foto's, in secties "Groep - Album" en als laatste "Ongepubliceerde foto's". Een foto in twee albums stond er twee keer in. Bladeren past niet bij die secties (invariant 2). Zie A-keuze 1.
4. **Sorteren op de datum van de foto is lastig te bladeren.** `takenAt` ontbreekt bij 37% van de prod-foto's, komt pas na de upload binnen (`patchMetadata`) en is te wijzigen (`photos.update`). De uploaddatum staat vast. v1 sorteerde ook op upload, oudste eerst.
5. **Het detail vanuit Mijn foto's hoort bij geen album.** Het detail van WP17a swipet door één album. Vanuit Mijn foto's swipet het door je eigen foto's (v1: zo). Het menu kent dan geen album: geen covers en geen "uit album halen".
6. **Gemelde eigen foto's** toonde v1 in Mijn foto's met een markering. Op prod zijn er 0. In 17c staan ze erin zoals elke foto (invariant 1); de markering is WP20.
7. **`photos.listByOwner` blijft liggen.** Hij laadt alles in één keer, en de app gebruikt hem niet. Mijn foto's gebruikt de nieuwe read. Opruimen kan later (backlog).

### Telling op prod (export 2026-11-06)

- 1543 foto's van 16 eigenaren. De grootste heeft **456** foto's, de tweede 354 (Dev Wouter op dev: 473).
- **19 foto's** staan in geen album, bij de grootste eigenaar 5. Geen enkele staat alleen in een gewist album.
- Elke andere foto staat in precies één album. "In welke albums" toont op T0 dus hooguit één regel.
- 0 eigen foto's staan in een album van een groep waar de eigenaar geen lid van is.
- De album-keuze toont hooguit 17 albums (6 groepen).
- 575 foto's hebben geen opnamedatum; 0 zijn gemeld.

### Antwoorden op de open vragen (advies)

1. **Sortering.** v1: per album een sectie, binnen een sectie op uploaddatum (oudste eerst), de foto's zonder album onderaan. Geen filter. Advies: één lijst, nieuwste upload eerst, zonder album-secties (A-keuze 1). De v1-sectie "Ongepubliceerde foto's" wordt een schakelaar "Alle / Niet in een album" (A-keuze 2).
2. **Waar.** v1 had "Toevoegen aan album" in de selectie van Mijn foto's én van een album. Hij stond alleen aan als alle geselecteerde foto's van jou waren. Advies: op beide plekken. Per foto, zoals WP17b: een foto van een ander wordt niet toegevoegd en de melding zegt waarom. Andermans foto: nee (kernvondst 1).
3. **Voor elke foto.** v1 toonde "Publicaties" bij elke foto, ook van een ander, met alleen albums uit je eigen groepen. Advies: zo, voor elke foto. Zonder het mini-coverplaatje van v1 (dat vraagt een tweede toegangsregel), en niet aantikbaar (zoals v1).

### Pariteit per scherm

**Mijn foto's**

| Oude app | Nieuw (17c) |
|---|---|
| Secties per album ("Groep - Album"), dubbel als een foto in twee albums staat | Eén lijst, elke foto één keer (A-keuze 1) |
| Sectie "Ongepubliceerde foto's" onderaan | Schakelaar "Alle / Niet in een album" (A-keuze 2) |
| Alles in één keer geladen | Bladeren (invariant 2) |
| Leeg: "Nog geen foto's hier" | Zo; bij de schakelaar: geen foto's buiten een album |
| Fout: "Niet gelukt om albums op te halen", opnieuw laden | Zo, met de bestaande foutweergave |
| Tik: detail, swipen door je foto's | Zo (kernvondst 5) |
| Lang drukken: foto met menu | Zo. Menu: profielfoto, draaien, verwijderen (A-invariant 13) |
| Selecteren: toevoegen aan album, uit album(s), verwijderen | Toevoegen aan album, verwijderen. Uit album hoort bij het album |
| Markering gemelde foto | WP20 |
| Uitlegschermpjes bij eerste bezoek | Niet |

**Album-keuze** ("Kies album")

| Oude app | Nieuw (17c) |
|---|---|
| Alle albums van je groepen, per groep, lege groepen weg | Zo (A-invariant 12) |
| Huidig album gemarkeerd | Het huidige album staat er niet in |
| "Nieuw album" (admin) | Niet in 17c: album maken staat in Groepsbeheer |
| Voortgang "3/5 foto's toegevoegd aan album" | Na afloop: wat niet mocht, wat er al in stond, wat mislukte (A-invariant 11) |
| Eén fout: "Er ging iets mis", alles stopt | Per foto (WP17b invariant 7) |
| Daarna terug naar waar je vandaan kwam | Zo, selectie leeg |

**"In welke albums"** (foto-detail)

| Oude app | Nieuw (17c) |
|---|---|
| "Publicaties:" met per album "Album - in Groep" | Zo, alleen albums uit je eigen groepen (A-invariant 9) |
| Mini-cover per album | Niet (open vraag 3) |
| Geen albums: niets tonen | Zo |
| Alleen staand, niet aantikbaar | Zo |

### A-keuzes ter bevestiging

De tests staan in een eigen `describe` met "A-keuze n" in de naam.

1. **Nieuwste upload eerst, één lijst.** Volgorde op uploaddatum (`createdAt`), nieuwste eerst. Bij dezelfde datum een vaste volgorde. Geen album-secties.
2. **Schakelaar "Niet in een album".** De read geeft dan alleen je foto's die in geen enkel album staan, ook bladerend.

### Aanvullende invarianten

7. **Mijn foto's kent geen andere eigenaar.** De read neemt geen user-id aan; de eigenaar is altijd de caller. Niet ingelogd of zonder users-rij: weigering.
8. **Bladeren is volledig.** Wie alle pagina's laadt, krijgt elke eigen foto precies één keer, ook met de schakelaar. Een pagina is nooit groter dan gevraagd.
9. **"In welke albums" verraadt niets.**
   - Alleen albums uit groepen waar de caller lid van is, elk album één keer.
   - Per album precies: het album-id, de albumnaam, het groep-id en de groepsnaam.
   - Het antwoord is gelijk, of de foto nu in 0 of in 3 albums van andere groepen staat.
   - Geen foto-toegang, een onbekende en een gewiste foto: dezelfde `NOT_MEMBER` (zoals `photos.getById`).
   - Eigen foto zonder album: een lege lijst.
   - Een publicatie waarvan het album weg is, telt niet.
10. **Na vertrek** staat het album van die groep niet meer in de lijst.
11. **Toevoegen aan album, per foto.** Vooraf mag alleen een eigen foto (zelfde regel als `addPhoto`). `ALREADY_IN_ALBUM` telt als "stond er al in", niet als mislukt. Elke andere weigering (album weg, geen lid meer, foto gewist) telt als mislukt. Na afloop één melding. Alles gelukt: "5 foto's toegevoegd aan het album", net als bij verwijderen (WP17b). Anders zegt de melding hoeveel er niet mochten, al in het album stonden of mislukten.
12. **Album-keuze.** Alleen albums van groepen waar je lid van bent, in de volgorde van Mijn groepen en het groepsscherm. Een groep zonder album valt weg. Het album waar je vandaan komt, staat er niet in.
13. **Menu in Mijn foto's:** profielfoto, draaien, verwijderen. Geen covers en geen "uit album halen".
14. **Ook voor het grootste account** (invariant 2, besluit 4): 1505 eigen foto's met formaten (ruim 3× 456), 1500 in een album en 5 los. De test laadt ze zoals de app: één aanroep vanaf het begin, in beide standen, binnen de Convex-limieten. Bij 2505 foto's loopt "Alle" vast (4096 leesacties per query). Dat is de grens, geen fout; echt bladeren staat in de backlog.

### Toegangsdefinities (standing rule)

- **Mijn foto's (nieuwe read):** neemt geen id aan. Geeft alleen foto-ids van de caller, in de bestaande foto-vorm (geen `storageId`).
- **"In welke albums" (nieuwe read):** neemt een foto-id aan. De poort is foto-toegang (`canAccessPhoto`), en per publicatie een lidmaatschap van die groep: een toestemmingslijst. Hij toont album- en groep-ids die de caller al ziet via zijn groepen.
- **Schrijven:** alleen `albums.addPhoto`, ongewijzigd (WP24, WP28).
- **Inventaris:** beide reads staan in `tests/readWhitelist/inventory.test.ts`, met een return-validator.

### Edge cases

- **Twee leden zetten dezelfde foto tegelijk in hetzelfde album.** Alleen de eigenaar mag dat, dus het gaat om twee toestellen van één lid. Convex voert ze na elkaar uit: de tweede krijgt `ALREADY_IN_ALBUM`.
- **De foto wordt gewist tijdens het toevoegen:** die foto telt als mislukt.
- **Het album wordt gewist terwijl de keuze openstaat:** alle foto's mislukken, één melding.
- **Uploaddatum van gemigreerde foto's is een dag.** Foto's van dezelfde dag staan in een vaste, verder willekeurige volgorde.
- **Een foto net geüpload, nog zonder formaten:** staat in Mijn foto's (beeldpad van WP25).

### Open vragen voor Wouter (met advies)

1. **A-keuze 1: nieuwste upload eerst, één lijst.** Advies: ja.
2. **A-keuze 2: schakelaar "Niet in een album".** Advies: ja; anders zoekt de grootste gebruiker 5 foto's tussen 456.
3. **"In welke albums" bij elke foto, zonder mini-cover.** Advies: ja.

### Tests

| Bestand | Pint |
|---|---|
| `tests/myPhotos/listMine.test.ts` | `photos.listMine`: invariant 1, 7, 8, A-keuze 1 en 2, de foto-vorm |
| `tests/myPhotos/listMineScale.test.ts` | invariant 2 / A-invariant 14 en besluit 4: één aanroep zoals de app, foto's met formaten, beide standen, met `transactionLimits` |
| `tests/myPhotos/listForPhoto.test.ts` | `albums.listForPhoto`: A-invariant 9 en 10 |
| `tests/myPhotos/addSelection.test.ts` | A-invariant 11 tegen de echte `addPhoto` (plan en uitkomst per foto) |
| `tests/readWhitelist/inventory.test.ts` | de twee nieuwe reads |
| `app/tests/myPhotos.test.ts` | `app/src/lib/myPhotos.ts`: menu, album-keuze, uitkomst per foto, de regels "in welke albums" |
| `app/tests/photoActions.test.ts` | `selectionPlan` en `selectionSummary` met `addToAlbum` |

Aangenomen API (B mag de interne vorm kiezen, niet de namen):
- `photos.listMine({ paginationOpts, withoutAlbum? })`, een Convex-pagina met de foto-vorm.
- `albums.listForPhoto({ photoId })` geeft `{ albumId, albumName, groupId, groupName }[]`.
- In de app: `SelectionAction` krijgt `"addToAlbum"`; `selectionSummary` krijgt een optioneel aantal `alreadyIn`. Een nieuwe module `app/src/lib/myPhotos.ts` met `myPhotoActions`, `albumChoices`, `addOutcome` en `photoAlbumLines`.

### Fix-cyclus 1 (A, 2026-11-12)

- **S1 (audit), besluit 4:** `listMineScale` laadt nu zoals de app (één aanroep, foto's met formaten, "Alle" en "Niet in een album"). Groen op de huidige code, dus B hoeft niets te doen. Invariant 2 en A-invariant 14 noemen de grens.
- **N2 (audit):** A-invariant 11 volgt nu de app: ook bij alles gelukt een melding met het aantal.
- **N1 (audit), geaccepteerd:** de koppeling in het scherm (welke mutation bij welke knop, de tellingen naar de melding) heeft geen test. De gate dekt dat.
- **N3 (audit), geaccepteerd:** staat de aangetikte foto niet (meer) in de geladen lijst, dan opent het detail op de eerste foto.
