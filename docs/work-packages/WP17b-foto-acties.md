# WP17b: Acties op foto's — menu, draaien, verwijderen, uit album, als cover of profielfoto

> Draft regie 2026-11-07. App-WP (zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4)). Bouwt op [WP17a](./WP17a-fotos-bekijken.md). De backend-mutations met hun gates bestaan al ([WP8](./WP8-photo-rotation.md), [WP24](./WP24-write-gates.md)); het zwaartepunt ligt in de app. WP17 is opnieuw gesplitst (besluit Wouter 2026-11-07): Mijn foto's, de kaart, de locatie en delen gaan naar WP17c. A → B → audit, TestFlight-gate.

## Productdoel

Een lid doet met een foto wat in v1 kon: draaien en spiegelen, uit een album halen, verwijderen, en als album- of groepscover of als profielfoto instellen. Hij ziet alleen de acties die hij mag, het resultaat is meteen overal te zien, en niets verdwijnt per ongeluk.

## Invarianten

1. **Je ziet alleen wat je mag, en de backend beslist.** Het menu toont per foto alleen de acties die de user mag (eigenaar, admin van de groep, volgens de regels van WP8 en WP24). Het menu is gemak, geen gate: een actie die de backend weigert, geeft een NL-melding en verandert niets.
2. **Verwijderen vraagt eerst, en zegt wat er weggaat.** Na bevestiging is de foto overal weg: uit elk album, met zijn likes, en als cover gewist (cascade P3–P5). Een scherm dat de foto nog toont (raster, detail, een cover), crasht niet en laat hem verdwijnen.
3. **Uit album halen raakt alleen dat album.** De foto blijft bij de eigenaar en in de andere albums. Was hij de cover van dat album, dan is de cover weg; was hij de groepscover en staat hij nergens meer in de groep, dan ook die (AP4).
4. **Draaien en spiegelen zie je meteen, overal.** Raster, detail, covers en profielfoto tonen na de actie de nieuwe stand, zonder oude stand uit de cache (WP25 invariant 26). Twee keer een kwartslag is een halve slag (delta, WP8).
5. **Een cover kies je uit de groep.** Als albumcover alleen een foto uit dat album, als groepscover alleen een foto uit een album van die groep (WP24 A-keuze 2). Daarna ziet elk lid de nieuwe cover, in de tegels en bovenaan, zonder oude cover uit de cache.
6. **Profielfoto: alleen een eigen foto, en de user weet dat hij openbaar wordt.** Vóór het instellen zegt de app dat een profielfoto voor iedereen zichtbaar is, ook buiten de groep (WP17a besluit 8 en 10).
7. **Selecteren en dan één actie.** In het selectiemenu geldt elke actie per foto, met dezelfde gates. Lukt het voor een deel niet, dan zegt de app hoeveel en waarom, en blijft de rest gedaan.
8. **Wat een ander doet, zie je ook.** Haalt een admin een foto weg terwijl jij hem bekijkt, dan verdwijnt hij, en het detail toont een nette melding (live, WP15a).
9. **WP13 tot en met WP17a blijven werken**, met alleen A's bewuste aanpassingen aan bestaande tests.

## Edge cases + scope-uitsluitingen

- **In scope:** foto-menu in het detail en in het raster (lang drukken of een knop, pariteit door A), selectiemenu, de vijf acties hierboven, de meldingen.
- **Draaien vóór de formaten** (seconden na een upload): geaccepteerd in WP25 (§Edge cases): de foto kan scheef komen te staan en de user draait opnieuw. Upload komt pas in WP18; A beoordeelt of 17b hier iets moet doen.
- **De 3 gemigreerde groepscovers zonder album** (WP12b besluit 4): na T0 kiest een admin een nieuwe cover met deze WP. Geen eigen code nodig.
- **Gatetest** (WP16) is weg door de `reset` van WP12b. Regie maakt hem opnieuw vóór de gate.
- **Bewust niet:** Mijn foto's, kaart, locatie wijzigen, delen (→ WP17c). Uploaden (WP18). Album maken, wijzigen of verwijderen (Groepsbeheer). Melden (WP20). Ratings (WP19).

## Open vragen voor A (oude app en backend, rapporteren aan regie)

1. **Pariteit per actie:** wie mocht wat in v1 (eigenaar, admin, elk lid)? Wijkt v2 af (WP8, WP24), dan rapporteren; Wouter beslist. Op prod is elk lid admin (25 van 25, veldaudit WP12b), dus "admin" betekent daar iedereen.
2. **Menu en selectie:** waar zat het menu, welke acties zaten in het selectiemenu, en vroeg v1 om bevestiging bij verwijderen of uit album halen?
3. **Verwijderen door een admin:** mocht een admin de foto van een ander verwijderen, of alleen uit het album halen?
4. **Ontbreekt er een backend-functie of -vorm** voor een scherm (bijvoorbeeld een cover wissen: WP24 §Bewust niet zegt dat dat nu niet kan), noem hem; A schrijft er tests voor, B bouwt hem.
5. **Bestaans-orakels in `photos.rotate`, `update` en `remove`** (WP24 open vraag 4): nog open? Zo ja, hoort het hier of apart?

## Risico-assessment

- **security/privacy:** medium — de gates bestaan, maar de app moet ze niet ruimer laten lijken. Profielfoto maakt een beeld openbaar.
- **ops:** medium — verwijderen is onomkeerbaar en cascadeert.
- **external deps:** laag — geen nieuwe bibliotheek verwacht (delen en kaart zitten in WP17c).
- **multi-user/concurrency:** medium — twee admins tegelijk op een cover, een foto die verdwijnt terwijl het menu open staat, draaien door eigenaar en admin tegelijk (laatste wint, WP8).
- **data/schema-evolutie:** laag — geen schemawijziging verwacht.

## Werkwijze

| Stap | Wie | Wat |
|---|---|---|
| 1 | A | Spec-criticus (leest de oude app), open vragen, RED tests. |
| 2 | Wouter | Besluiten op A's vragen. |
| 3 | B | Impl. |
| 4 | Audit | Op spec, tests en impl. Red-team alleen als A een nieuw schrijfpad of een ruimere gate vindt. |
| 5 | Gate | Wouter, TestFlight, met Gatetest opnieuw op dev. |

## Cross-refs

- [WP8](./WP8-photo-rotation.md): rotate, delta, eigenaar of admin, §Frontend-contract.
- [WP24](./WP24-write-gates.md): gates op cover en `albums.addPhoto`, A-keuze 2, open vraag 4.
- [WP17a](./WP17a-fotos-bekijken.md): beeldpad, besluit 8 en 10, invariant 16.
- [WP25](./WP25-fotoformaten.md): cache-sleutel met formaat en stand (invariant 26), draaien vóór de formaten.
- [`cascade-matrix.md`](../cascade-matrix.md): P3–P5, AP4.
- Oude app (alleen A): `~/Code/v1/clubalmanac-app`.

## Acceptance

- Tests: invarianten 1–8 waar ze in de app of backend te pinnen zijn; bestaande suites groen.
- Gate (Wouter, TestFlight, dev): elke actie één keer, als eigenaar en als admin van andermans foto. Verwijderen en uit album halen met een cover; draaien zichtbaar in raster, detail en cover; profielfoto met de melding; selectiemenu met een deel dat niet mag.

---

## Spec-criticus aanvullingen (A vult in)
