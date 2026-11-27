# WP45: voorbeelden van de declaratie-routes (verzonnen)

Alle namen, bedragen, datums en ids zijn verzonnen. Nooit echte gegevens hier
neerzetten.

Het contract tussen Convex en het clubboek (WP45-spec §A5–A8). Een id is een
ondoorzichtige tekst: het clubboek bewaart en stuurt hem terug, en leest er
niets uit. Ook `revision` is ondoorzichtig: alleen terugsturen (A1.3).

Eén groep, twee leden (Berk en Joris), vijf declaraties en één concept van
Joris dat het clubboek nooit ziet:

| id (eind) | van | status | revision |
|---|---|---|---|
| `…t03` | Berk | `adjusted` (€ 87,35 → € 75,00, toelichting met regeleinde) | 3 |
| `…t04` | Joris | `withdrawn` na `processed` (het besluit blijft staan) | 4 |
| `…t02` | Joris | `processed` | 3 |
| `…t05` | Berk | `rejected` (met toelichting) | 3 |
| `…t01` | Berk | `submitted` | 2 |

De bestanden, in deze volgorde uitgevoerd op 2026-11-27 12:00 (Nederland):

- `claims.response.json`: `GET /claims`, oudste `submittedAt` eerst.
- `decision.request.json` → `decision.response.json`: `…t01` verwerkt.
- `decision.changed.request.json` → `decision.changed.response.json`: daarna
  een ander besluit met de oude `revision`: 409 `changed` met de stand nu.
- `decision.withdrawn.request.json` → `decision.withdrawn.response.json`: een
  besluit op een ingetrokken declaratie: 409 `withdrawn`.
- `purge.request.json` → `purge.response.json`: `…t04` en `…t02` weg, `…t05`
  overgeslagen (verouderde `revision`).
- `errors.json`: de bodies van 403, 404 en 413 (precies), en de vorm van 400
  (de `reason` is een voorbeeld; alleen de vorm ligt vast).

`tests/expenseClaims/contract.test.ts` bouwt deze toestand na en controleert
dat de routes precies deze antwoorden geven (met de echte ids in plaats van
deze).
