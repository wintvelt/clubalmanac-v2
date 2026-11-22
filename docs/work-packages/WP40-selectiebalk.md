# WP40: selectiebalk in album en Mijn foto's

> Regie 2026-11-22. Uit de gate van [WP39](./WP39-toevoegscherm.md). Alleen UI, geen backend. Liefst nog in app 2.0.2. A → B → audit → gate op een echte iPhone (dev-build). Eigen branch `wp40` (vanaf `wp39`).

## Productdoel

Na een tik op "Selecteer" in een album of in Mijn foto's verschijnt onderin een grote balk met twee rijen knoppen ("Naar album", "Uit album", "Verwijderen", "Annuleren") en de tekst "Tik op foto's om ze te kiezen". Samen met de grote omslag van het album blijft er weinig ruimte over om foto's aan te tikken. Na WP40 zie je in de selectiestand zo veel mogelijk foto's, en zijn de acties compact en duidelijk, zoals in de Foto's-app van iOS.

## Besluiten (Wouter, 2026-11-22)

1. **Slanke balk onderin, één rij:** kleine knoppen met icoon en kort label (Naar album, Uit album, Verwijderen), één regel van ongeveer 50 pt. Grijs zolang er niets gekozen is.
2. **Annuleren en het aantal bovenin:** "Annuleren" in de kop, het aantal ("3 geselecteerd", of "Kies foto's" bij nul) als titel. Geen "Annuleren" en geen uitlegregel meer onderin.
3. **Omslag inklappen:** bij "Selecteer" schuift het scherm naar de foto's; de grote omslag (album) staat dan niet meer in beeld.

Bewust niet in WP40: vegen om meerdere foto's in één keer te kiezen (later, eigen WP als Wouter het wil).

## Wat er is

- `app/src/screens/AlbumScreen.tsx`: `selecting`, `picked`, `SelectionBar` (WP17b, WP17c), het foto-raster met vinkjes, de omslag bovenaan, "Selecteer" onder de titel.
- `app/src/screens/MyPhotosScreen.tsx`: dezelfde selectiestand en balk, met "Alle" en "Niet in een album".
- `AlbumChoiceSheet` (WP17c, uitgebreid in WP39) voor "Naar album".
- Web: dezelfde schermen in de webapp (WP35/36); foto-acties zitten daar bewust niet in.

## Invarianten

1. **Acties ongewijzigd.** Wat elke actie doet, de bevestigingen, foutmeldingen en wie wat mag (eigenaar, admin) blijven zoals in WP17b/WP17c. Alleen de plaats en vorm veranderen.
2. **Nul gekozen:** acties uit (grijs), niet verborgen; "Annuleren" werkt altijd.
3. **Tijdens een actie** (bezig) geen tweede actie en geen Annuleren, zoals nu.
4. **Geen sprong in de inhoud** bij aan- en uitzetten van de selectiestand behalve het bedoelde inklappen van de omslag; terug uit de selectiestand komt de omslag weer.
5. **Toegankelijk:** elke knop een naam ("Naar album, 3 foto's"), tikvlak minstens 44 pt, het aantal wordt voorgelezen bij wijzigen.
6. **iPad en liggend:** de balk en kop werken ook in de brede layout met zijkolom (2.0.1).

## Scope

- **In:** AlbumScreen en MyPhotosScreen op iOS (iPhone en iPad).
- **Open (A adviseert):** het web; die heeft geen foto-acties, dus waarschijnlijk niets.
- **Bewust niet:** vegen om te kiezen; nieuwe acties.

## Open vragen voor A (rapporteren aan regie)

1. Kop in de selectiestand: past "Annuleren" en het aantal in de bestaande kop (`Stack.Screen`-opties, de terugknop "Groep"), of is een eigen kopbalk nodig? Wat gebeurt er met de terugknop en het veeggebaar terug tijdens de selectie?
2. Omslag inklappen: scrollen naar het begin van het raster, of de omslag echt uit de lijst halen? Wat is het minst springerig, ook als je al ver gescrold had?
3. Balk: icoon met label eronder (zoals een tabbalk) of naast elkaar? Hoe passen drie (album) of twee (Mijn foto's) knoppen op een smalle iPhone met grote tekst?
4. Welke delen van `SelectionBar` zijn gedeeld tussen de twee schermen, en kan dat één component worden?

## Risico-assessment

- **UI/regressie: medium.** Foto's verwijderen en uit album halen hangen eraan; invariant 1.
- **data: geen.** Geen backend.
- **ops-runbook-impact:** geen. What's New van 2.0.2 noemt het.
- **toegangsdefinitie:** geen nieuwe.

## Cross-refs

- WP17b (selectiemenu), WP17c (Mijn foto's, naar album), WP39 (kiesscherm, grijze knoppen), iPad-zijkolom (2.0.1).
