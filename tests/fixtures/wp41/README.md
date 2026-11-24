# WP41: voorbeelden van een afrekening (verzonnen)

Alle namen, bedragen en datums zijn verzonnen. Nooit echte gegevens uit het
clubboek hier neerzetten.

Per voorbeeld twee bestanden:

- `<naam>.publicatie.json`: een gepubliceerde versie zoals het clubboek hem
  bewaart. `publicatie.data` heeft de vorm van `_als_data(overzicht(ev))`
  (Decimal als tekst, datum als `jjjj-mm-dd`, met `lid_id`). Daarnaast de twee
  dingen die niet in `overzicht()` zitten: `evenement.pk` (de sleutel) en
  `evenement.startdatum`, en `publicatie.datum` ("Stand van").
- `<naam>.request.json`: het verzoek dat het clubboek daarvan maakt voor
  `POST /settlements` (contract: WP41-spec §A2).

De voorbeelden:

- `lustrum`: "Lustrum Nepal", 8 deelnemers, 5 onderdelen, spaarpotten.
  Joris betaalt alles uit zijn spaarpot (`bij` is `"-0.00"`), Rafting heeft een
  prijs met een eindeloze breuk (op centen verdeeld), Sander betaalde in twee
  keer, drie deelnemers moeten nog betalen.
- `weekend`: "Clubweekend Ardennen", geen lustrum, 5 deelnemers, clubbijdrage,
  Daan schoot de boodschappen voor en krijgt terug, Kano is niet op centen
  verdeeld (cel `"-33.33333333333333333333333333"`, de rijen tellen een cent
  minder op dan de onderdelen).

`tests/settlements/fixtures.test.ts` controleert dat de paren bij elkaar
passen. De tests van de knop in het clubboek (spec §A11) gebruiken een kopie
van deze bestanden.
