# WP17c: Mijn foto's, toevoegen aan album, en in welke albums een foto staat

> Draft (regie, 2026-11-12). App-WP met een klein backend-deel. Gesplitst uit de oude WP17c (besluit 2026-11-12): de kaart, locatie wijzigen en delen gaan naar WP17d.

## Productdoel

Een lid vindt al zijn eigen foto's op één plek, ook de foto's die in geen album staan, en zet ze in een album van zijn groep. Bij elke foto die hij ziet, ziet hij in welke albums die staat, maar alleen albums die hij zelf mag zien.

## Invarianten (draft)

1. **Mijn foto's toont alleen je eigen foto's.** Dat zijn alle foto's waarvan jij de eigenaar bent: in een album of in geen album, en ook een geüploade profielfoto (WP18). Nooit de foto van een ander.
2. **Ook voor het grootste account.** Mijn foto's laadt en bladert voor het lid met de meeste foto's op prod, met marge, binnen de Convex-limieten. Er wordt niet alles in één keer geladen. A telt op de prod-export hoeveel foto's dat lid heeft.
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

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft.)
