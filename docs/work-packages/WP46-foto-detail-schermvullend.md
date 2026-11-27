# WP46: foto-detail schermvullend

> Regie 2026-11-27. Wens van Wouter na de release van 2.0.2. Alleen UI, geen backend. Voor app 2.0.3. A → B → audit → gate op een echte iPhone (dev-build) en de Android-emulator. Eigen branch `wp46` vanaf `main`.

## Productdoel

Op de telefoon ziet een lid een foto of filmpje in het detail zo groot mogelijk. Liggend gebeurt dat meteen, rechtop na één tik. Vegen naar de vorige en volgende foto blijft werken, en Acties zijn met één tik terug.

## Besluiten (Wouter, 2026-11-27)

1. **Alleen de telefoon.** Op de iPad blijft het detail zoals het is, ook liggend met de zijkolom (2.0.1).
2. **Filmpje:** een tik toont of verbergt de kop en de bediening, zoals in de Foto's-app. Afspelen en pauzeren gaan met de afspeelknop, niet met een tik op het beeld.
3. **Klok en batterij** (statusbalk) verdwijnen ook in de schermvullende stand.
4. **Achtergrond** schermvullend altijd zwart, ook in het lichte thema.
5. **Liggend:** de foto begint zonder kop, tabbalk en infoblok. Een tik laat de kop en Acties tijdelijk zien; nog een tik verbergt ze weer.
6. **Webapp doet niet mee.** Alleen de iPhone- en Android-app.

## Gedrag

- **Rechtop, normale stand:** zoals nu (kop met terug en Acties, de foto, het infoblok met eigenaar, datum en albums, de tabbalk).
- **Rechtop, tik op de foto:** schermvullend: alleen de foto op zwart, zonder kop, infoblok, tabbalk en statusbalk. Nog een tik: terug naar de normale stand.
- **Liggend:** altijd schermvullend zoals hierboven; een tik toont de kop met terug en Acties (en bij een filmpje de bediening), nog een tik verbergt die.
- **Draaien:** van rechtop naar liggend gaat naar schermvullend; terug naar rechtop gaat naar de stand van vóór het draaien.
- **Vegen** naar links en rechts werkt in elke stand en houdt de stand vast (schermvullend blijft schermvullend).

## Wat er is

- `app/src/screens/PhotoDetailScreen.tsx` (album) en `app/src/screens/MyPhotoDetailScreen.tsx` (Mijn foto's), met de routes onder `app/src/app/(tabs)`.
- `PhotoMenu` (Acties), het infoblok dat bij vegen vervaagt (WP33), het vaste fotogebied zonder verspringen (WP32), filmpjes afspelen in het detail (WP37).
- De brede indeling met zijkolom voor de iPad (2.0.1), en Android-eigen bediening uit WP42 (terugknop, edge-to-edge).

## Invarianten

1. **Niets verdwijnt voorgoed.** Elke actie die nu in het detail kan (Acties, terug, albums van de foto) is in elke stand met hoogstens één tik bereikbaar.
2. **Geen verspringen** van de foto bij het wisselen van stand, behalve het bedoelde groter worden; geen flits van een andere achtergrond.
3. **Vegen werkt in elke stand**, ook tijdens het wisselen van stand, en de positie in het album blijft gelijk.
4. **Een tik is geen veeg, een veeg is geen tik.** Een korte tik wisselt de stand; vegen, inzoomen (als dat er is) en de afspeelknop wisselen de stand niet.
5. **Terug werkt in elke stand.** De veeg terug (iOS) en de terugknop van het systeem (Android): uit de schermvullende stand eerst terug naar de normale stand, of meteen het scherm uit? A stelt voor, regie beslist.
6. **Statusbalk en tabbalk komen terug** zodra je het detail verlaat, ook via een melding, uitloggen of een foto die verdwijnt.
7. **iPad ongewijzigd** (besluit 1), ook bij draaien.
8. **Toegankelijk:** met VoiceOver/TalkBack blijven kop en Acties bereikbaar; "Beperk beweging" maakt de overgang direct in plaats van geanimeerd.

## Scope

- **In:** foto-detail in album en in Mijn foto's, op iPhone en Android-telefoon, foto's en filmpjes.
- **Bewust niet:** de webapp (besluit 6), de iPad (besluit 1), inzoomen met twee vingers (als dat er nog niet is), de zoom-overgang van tegel naar detail (eigen TBD-regel).

## Open vragen voor A (rapporteren aan regie)

1. Hoe is de app nu ingesteld voor draaien op de telefoon: draaien alle schermen mee, of alleen het detail? Moet draaien beperkt worden tot het detail?
2. Statusbalk en tabbalk verbergen: welke middelen bieden Expo Router en React Native (ook Android edge-to-edge en de navigatiebalk van het systeem)? Wat is het minst springerig?
3. Hoe gaan tik, veeg en de afspeelknop van een filmpje nu samen (gebaren in het detail)? Waar zit het risico op een tik die per ongeluk een veeg wordt of omgekeerd?
4. Invariant 5: wat doet de terugknop van Android en de veeg terug van iOS het best in de schermvullende stand?
5. Raakt dit WP32 (vast fotogebied) of WP33 (vervagen bij vegen) zo dat er een test of gedrag verandert?

## Risico-assessment

- **UI/regressie: medium.** Het detail is gevoelig voor verspringen (WP32) en gebaren; filmpjes en Android delen de code.
- **security/privacy: laag.** Geen nieuwe gegevens of rechten.
- **data: geen.** Geen backend.
- **ops-runbook-impact:** geen. *What's New* van 2.0.3 noemt het; de iPhone-controles staan in [`release-checks.md`](../runbooks/release-checks.md).
- **toegangsdefinitie:** geen nieuwe.

## Gate

Op een echte iPhone (dev-build) en de Android-emulator: rechtop tikken heen en terug, vegen in beide standen, draaien in beide richtingen, een filmpje (tik, afspeelknop, draaien), Acties uit de schermvullende stand, terug (veeg en systeemknop), licht en donker thema, grote letters, "Beperk beweging". De iPad: niets veranderd.

## Cross-refs

- WP17a (foto-detail), WP32 (vast fotogebied), WP33 (vervagen bij vegen), WP37 (filmpjes), WP42 (Android-bediening), iPad-zijkolom (2.0.1).

## Spec-criticus aanvullingen (A vult in)
