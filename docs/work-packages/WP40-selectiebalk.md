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

## Spec-criticus aanvullingen (A vult in)

> A 2026-11-22. Bronnen: deze spec, de huidige app-code (`AlbumScreen`, `MyPhotosScreen`, `PhotoMenu`, `WideSide`, `Motion`, `TabBar`, `stackOptions`, de routes in `src/app/(tabs)`), `docs/design.md`, WP17b en WP17c, en de oude app (`clubalmanac-app`: `PhotoSelectionHeader.jsx`, `PhotoSelectionMenu.jsx`). Labelbreedtes gemeten met de systeemletter (SF Pro) op de server. Niets op een echte iPhone of iPad gezien: dat staat bij de gate.

### Pariteit met de oude app

In de oude app stond de selectie bovenin: "selecteer" rechtsboven op de omslag, dat werd "annuleren", met ernaast het aantal ("3 foto's") en een knop "…" die een menu opende met de acties. Er was geen balk onderin. WP40 zet Annuleren en het aantal weer bovenin, zoals toen. De acties blijven onderin, zoals sinds WP17b. Het menu "…" komt niet terug. Er ontbreekt niets uit de oude app.

### Gemeten

Labelbreedte in SF Pro semibold, in pt:

| | 13 pt | 13 × 1,2 | 15 pt | 15 × 1,2 | 17 × 1,2 |
|---|---|---|---|---|---|
| Naar album | 72 | 85 | 82 | 96 | 107 |
| Uit album | 60 | 71 | 68 | 80 | 89 |
| Verwijderen | 75 | 88 | 85 | 100 | 111 |
| Annuleren | 65 | 76 | 73 | 86 | 96 |
| 120 geselecteerd | 109 | 128 | 123 | 145 | 161 |

Het smalste toestel in gebruik is 375 pt breed (iPhone SE, mini). Min de schermmarges is dat 343 pt, dus 114 pt per knop bij drie knoppen.

### Antwoorden op de open vragen

1. **Kop: in Mijn foto's de bestaande kop, in het album een eigen kopbalk.**
   - *Mijn foto's* heeft de iOS-navigatiebalk (titel "Mijn foto's"). Het is het begin van een tab, dus er is geen terugknop en geen veeggebaar terug. Het aantal past als titel, "Annuleren" rechts. Na de selectie staat de titel weer op "Mijn foto's".
   - *Het album* heeft geen iOS-kop: de route staat op `headerShown: false`. "Groep" is een pil op de omslag, en de titel uit `Stack.Screen` dient alleen als terugknop-tekst op het foto-detail. Er is dus een kop nodig die er alleen in de selectiestand is. Die moet over de inhoud komen zonder de foto's omlaag te duwen, en de foto's mogen niet zichtbaar door de titel heen schuiven. Dat kan de iOS-kop zijn die tijdens de selectie aangaat, of een eigen balk. Aanbeveling: een eigen balk. Zo kan hij infaden zoals de rest (WP33, "Beperk beweging") en schuift er niets mee als hij verschijnt. De titel van `Stack.Screen` blijft de albumnaam (A9).
   - *Terugknop en vegen in het album:* tijdens de selectie is er geen terugknop. Annuleren is de weg terug, zoals in Foto's. Ook het veeggebaar terug doet dan niets, om twee redenen: de linker kolom tegels ligt precies in de veegzone, dus een tik met een klein beetje beweging zou de hele selectie weggooien; en tijdens een actie moet je ook niet kunnen weglopen (invariant 3). Na de selectie werken pil en vegen weer. `AddPhotosScreen` zet het gebaar al uit zolang hij bezig is, dus dit is geen nieuw patroon.
   - *Plaats van Annuleren:* rechtsboven, zoals in Foto's en zoals "Sluiten" op modale schermen (design.md §7).
2. **Omslag inklappen: scrollen, niet uit de lijst halen.** Als je de omslag weghaalt, wordt alles boven het raster in één klap korter. Een lijst die al naar beneden gescrold is, verspringt dan met de hoogte van de omslag (bij een iPhone 15 Pro ruim 300 pt), en bij Annuleren nog een keer de andere kant op. Scrollen verplaatst alleen wat moet: de lijst schuift tot het raster direct onder de kop begint. Wie al verder stond, ziet niets bewegen. Terug uit de selectie gaat de lijst naar de oude plek, maar alleen als je tijdens de selectie zelf niet gescrold hebt. Anders blijft hij staan, zodat je je plek in het raster niet kwijtraakt (A3, A4). Met "Beperk beweging" gaat het zonder animatie. De pil, de titel en de knoppen onder de omslag scrollen gewoon mee en komen terug als je omhoog scrolt.
3. **Balk: icoon met het label eronder, zoals de tabbalk.** Naast elkaar past niet: icoon, tussenruimte, label en marges zijn bij drie knoppen al bij standaardtekst 119 pt per knop, meer dan de 114 pt die er zijn. Onder elkaar past "Verwijderen" ook bij 15 pt × 1,2 (100 pt). Daarom groeit het label hoogstens 1,2× mee, net als de labels in de tabbalk (design.md §3). Bij 15 pt komt de balk op ongeveer 50 pt hoog. In Mijn foto's staan er twee knoppen, elk op de helft van de breedte. Alle knoppen even breed, nooit afgekapt en nooit over twee regels (A6).
4. **Eén component.** De twee `SelectionBar`'s verschillen alleen in "Uit album" (alleen in het album) en de VoiceOver-naam van "Naar album". Al het andere is gelijk: de status, "grijs bij nul of bezig", "Annuleren" en de `BottomPanel`. Aanbeveling: één balk die per scherm weet welke acties hij toont. Titel en knopnamen komen dan uit pure logica, die getest wordt (zie het testcontract). De kop kan niet gedeeld worden, omdat de twee schermen een andere kop hebben (antwoord 1). Wel moet hij er in beide schermen hetzelfde uitzien. Ook de selectie-state (`selecting`, `picked`, `toggle`, `stopSelecting`, bezig, `choosing`) is dubbel. Die samenvoegen mag, maar hoeft niet.
5. **Web (scope, open): niets.** Op het web komt er geen selectiestand, want "Selecteer" staat er niet (`READ_ONLY`). `AlbumScreen` en `MyPhotosScreen` draaien wel op het web. De nieuwe kop en balk mogen het webscherm daarom niet veranderen: geen extra ruimte en geen andere kop (A12).

### Wat in de draft niet klopt of ontbreekt

- **"Bezig…" heeft een plek nodig.** Nu toont de statusregel "Bezig…" tijdens een actie. Dat is WP17b fix-cyclus 1, invariant 15: "de balk laat zien dat hij bezig is". De statusregel verdwijnt, dus die taak gaat naar de titel in de kop (A1).
- **`accessibilityLiveRegion` doet op iOS niets**, het is alleen voor Android. De huidige statusregel wordt dus nu al niet vanzelf voorgelezen. Invariant 5 ("het aantal wordt voorgelezen") vraagt op iOS dat de app het aantal zelf meldt aan VoiceOver, zoals `Notice` dat doet (A7).
- **Een sprong die er nu al is.** Bij "Selecteer" verdwijnt de knoppenrij onder de titel (Selecteer, Kaart, Bewerk album), en na de selectie komt hij terug. Wie tijdens de selectie naar beneden scrolde, ziet bij Annuleren of na een actie alles met de hoogte van die rij omlaag springen. Dat botst met invariant 4 (A5). In Mijn foto's verschuift het raster om dezelfde reden bij elke Selecteer en Annuleren (besluit 3 voor Wouter).
- **Brede layout (liggende iPad).** Daar staat de omslag in de zijkolom, niet in de lijst. Er valt dus niets in te klappen en het raster blijft staan. Een kop over het raster zou de eerste rij bedekken, want het raster heeft daar maar 22 pt ruimte boven. Aanbeveling: aantal en Annuleren bovenin de zijkolom, op de plek van de pil "Groep" (A8).
- **Er is geen icoon voor "Uit album".** `Icon` heeft er geen. `logout` ("exit") betekent uitloggen, dus niet hergebruiken. "Naar album" gebruikt nu de +, het teken van "Toevoegen" in de tabbalk. Een eigen icoon is duidelijker. Dat is aan B, de gate kijkt mee.
- **Het filter in het album (Alle, Foto's, Video's) houdt de selectie vast.** Kies je 3 foto's en schakel je naar "Video's", dan blijven ze gekozen en werkt "Verwijderen" op foto's die je niet ziet. In Mijn foto's stopt de selectie wel bij een wissel van "Alle" naar "Niet in een album". Zo werkt het sinds WP37 en WP17c, en WP40 verandert het niet (invariant 1). Het filter scrolt in de selectiestand wel uit beeld, dus de kans wordt kleiner. Zie besluit 4.
- **Liggende iPhone:** geen statusbalk, maar een kop van 44 pt, de balk van 50 pt en de tabbalk samen laten op een hoogte van 390 pt ongeveer 200 pt over voor het raster. Dat is een gate-check en hangt samen met besluit 1.
- **Bestaande bronscans** die B moet laten staan: `photoMenuPlace.test.ts` en `shareBusy.test.ts` (welke schermen `usePhotoMenu(` en `.hasActions(` gebruiken), `addTexts.test.ts` ("Toevoegen" in `AlbumScreen.tsx`; "Kies foto's" mag niet voorkomen in `AddPhotosScreen*`, `AddPhotosParts`, `lib/addSelection.ts` en `AlbumChoice.tsx`, dus de titel "Kies foto's" hoort daar niet) en `videos.test.ts` (`mediaCountText(` in `AlbumScreen.tsx`).

### A-invarianten

1. **Titel in de kop.** Nul gekozen: "Kies foto's". Eén: "1 geselecteerd". Meer: "3 geselecteerd". Tijdens een actie: "Bezig…", wat er ook gekozen is. Het aantal telt alleen foto's die nog in beeld kunnen zijn. Wist een ander een gekozen foto of haalt die hem uit het album, dan telt hij niet meer mee (zoals nu).
2. **Knoppen.** Album: "Naar album", "Uit album", "Verwijderen", in die volgorde. Mijn foto's: "Naar album", "Verwijderen". Verwijderen is rood en staat als laatste, zoals in het foto-menu. Bij nul en tijdens een actie zijn ze grijs (uit, maar zichtbaar), anders aan. Of ze aan staan hangt alleen af van het aantal en van bezig, nooit van wie de foto's zijn: elke actie geldt per foto, en wat niet mag meldt de app achteraf (WP17b A-keuze 2). "Annuleren" is alleen uit tijdens een actie.
3. **Selecteer in het album.** Het raster scrolt tot het direct onder de kop begint, of zo ver als de lijst kan. Wie al zo ver of verder stond, ziet niets bewegen.
4. **Terug uit de selectie** (Annuleren, of het einde van een actie). Heb je tijdens de selectie niet zelf gescrold, dan gaat de lijst terug naar waar hij stond vóór Selecteer, en is de omslag weer in beeld. Heb je wel gescrold, dan blijft het raster staan.
5. **Geen sprong door de knoppenrij.** Dat de rij met Selecteer, Kaart en Bewerk album verdwijnt en terugkomt, verplaatst de foto's in beeld niet. In het album geldt dat ook na terug uit de selectie, als je naar beneden had gescrold.
6. **De balk.** Eén rij met per knop een icoon en een label, alle knoppen even breed, ongeveer 50 pt hoog, boven de tabbalk (die blijft, zie besluit 1). Op een iPhone van 375 pt passen drie knoppen bij elke tekstgrootte tot en met xxxLarge: het label groeit hoogstens 1,2× mee, wordt niet afgekapt en breekt niet af. Elk tikvlak is minstens 44 × 44 pt. Geen uitlegregel en geen Annuleren in de balk.
7. **VoiceOver.** Knopnamen met het aantal: "Naar album, 3 foto's", "Uit album, 1 foto", "Verwijderen, 3 foto's". Bij nul alleen "Naar album", en VoiceOver zegt "gedimd". Bij elke verandering van de titel (aantal of "Bezig…") meldt de app de nieuwe titel. Filmpjes tellen als foto's, net als in de bevestigingen en meldingen van nu.
8. **Brede layout (liggende iPad, album).** Het raster scrolt niet en verschuift niet. Aantal en Annuleren staan bovenin de zijkolom, op de plek van "Groep". Tijdens de selectie is er ook daar geen terugknop. Gaat het venster tijdens de selectie van smal naar breed of andersom (draaien, Split View), dan blijven de selectie en het aantal staan.
9. **Wat blijft.** Wat de acties doen, de album-keuze (`AlbumChoiceSheet` met `fromAlbumId` in het album), de bevestigingen, de meldingen, de tik op het toestel, het einde van de selectie na een actie, één actie tegelijk, het foto-menu uit tijdens de selectie, de wissel van filter in Mijn foto's die de selectie stopt, en de titel van `Stack.Screen` in het album (de albumnaam, de terugknop-tekst op het foto-detail). Pinnen in `selectionActions.test.ts` en `selectionBusy.test.ts`.
10. **Tijdens een actie** geen tweede actie en geen Annuleren (invariant 3). In het album kun je ook niet terugvegen of terugtikken. De tabbalk blijft werken, zoals nu.
11. **De melding na een actie** komt onderin, op de plek van de balk, zoals nu. Bij "Selecteer" gaat hij weg, zoals nu.
12. **Web.** Geen verandering: geen kop, geen balk, geen extra ruimte.

### Gate-checks (alleen te zien op een echte iPhone of iPad)

- Selecteer in een album met omslag, vanaf bovenaan en vanaf halverwege de omslag: scrolt het rustig naar het raster, staat de eerste rij helemaal onder de kop, en springt er niets? Annuleren zonder te scrollen: is de omslag terug? Annuleren na scrollen: blijft het raster staan? Hetzelfde na "Verwijderen" en "Uit album".
- Een album met weinig foto's (1 rij): wat zie je na Selecteer (besluit 2)?
- De kop in het album en die in Mijn foto's naast elkaar: zelfde hoogte, letter, plaats van Annuleren, licht en donker. Schuiven de foto's netjes onder de kop van het album, en is de statusbalk leesbaar?
- Terugvegen in het album tijdens de selectie doet niets; daarna werkt het weer.
- De balk op een iPhone van 375 pt (of in de simulator) en op de eigen iPhone, bij standaardtekst en bij xxxLarge: drie knoppen op één rij, niets afgekapt, grijs bij nul goed te onderscheiden van aan, licht en donker.
- De iconen: is meteen duidelijk wat "Naar album" en "Uit album" doen?
- VoiceOver: knopnamen met aantal, de titel wordt voorgelezen bij elke tik op een foto en bij "Bezig…", de focus na Selecteer en na Annuleren, de volgorde (kop, raster, balk).
- iPad staand (smal) en liggend (zijkolom): kop, balk, geen terugknop tijdens de selectie, draaien tijdens de selectie.
- iPhone liggend: is er genoeg raster over?
- Mijn foto's: Selecteer en Annuleren zonder verspringen (besluit 3), en de wissel van filter tijdens de selectie.
- "Naar album": het kiesscherm opent en werkt zoals in WP39.

### A-keuzes

- **Titel "Bezig…" tijdens een actie**, in plaats van het aantal met een draaiend wieltje. Het is dezelfde tekst als nu en houdt WP17b invariant 15.
- **Labels in de balk hoogstens 1,2× groter**, zoals de tabbalk. Zonder grens past "Verwijderen" bij xxxLarge niet in 114 pt.
- **Geen "Alles selecteren".** Foto's kent het wel, maar het is een nieuwe actie (scope).

### Besluiten voor Wouter

1. **Tabbalk tijdens de selectie.** Foto's verbergt de tabbalk en zet de actiebalk op zijn plek. Dat scheelt ongeveer 66 pt, een halve rij tegels. Aanbeveling: niet in WP40. Het is een grotere ingreep in de navigatie (de eigen tabbalk), en wisselen van tab tijdens de selectie werkt nu al goed. Kan later.
2. **Album met weinig foto's.** Moet de omslag ook dan uit beeld, met lege ruimte onder de laatste rij? Of scrolt de lijst zo ver als hij kan, en blijft de omslag deels zichtbaar? Aanbeveling: zo ver als hij kan. De foto's staan dan toch allemaal in beeld. De tests gaan hiervan uit.
3. **"Selecteer" in Mijn foto's rechtsboven in de kop**, waar daarna "Annuleren" staat, zoals in Foto's. Dat scheelt een rij en het raster verschuift niet meer bij aan en uit (A5). Aanbeveling: ja. In het album blijft "Selecteer" onder de titel, naast Kaart en Bewerk album.
4. **Filter in het album tijdens de selectie.** Blijft de selectie staan als je van filter wisselt (zoals nu), of stopt hij, zoals in Mijn foto's? Aanbeveling: zoals nu. Het valt buiten "alleen de plek en vorm", en de bevestiging bij Verwijderen noemt het aantal.

### Testcontract (A, vóór de besluiten)

> Namen en vormen zijn A-keuzes, het hoe is aan B. Wijkt een besluit af, dan past A de tests aan voordat B begint.

- **`app/src/lib/selectionBar.ts`** (puur, zonder React of native modules):
  - `selectionHeader({ count, busy })` geeft `{ title, cancelDisabled }` volgens A1 en A2.
  - `selectionButtons({ place: "album" | "mine", count, busy })` geeft per knop `{ action, title, accessibilityLabel, danger, disabled }`, in de volgorde van A2, met de namen van A7. `action` is de `SelectionAction` die de knop start (`addToAlbum` opent eerst het kiesscherm).
  - `enterSelectionScroll({ offset, gridTop, maxOffset })` geeft waar de lijst heen scrolt bij Selecteer, of `null` om hem te laten staan (A3). `gridTop` is de scrollpositie waarbij het raster direct onder de kop begint, `maxOffset` de verste positie die de lijst kan halen.
  - `leaveSelectionScroll({ before, entered, current })` geeft waar de lijst heen gaat bij terug uit de selectie, of `null` (A4). `before` is de positie vóór Selecteer, `entered` waar `enterSelectionScroll` de lijst heen zette (of `null`), `current` de positie nu.
- **Bronscan:** "Tik op foto's om ze te kiezen" staat nergens meer in `src`. `selectionHeader(` en `selectionButtons(` worden in de app-code aangeroepen, buiten `lib`. `AlbumScreen.tsx` en `MyPhotosScreen.tsx` gebruiken die (direct of via een gedeelde component), en geen van beide definieert zelf nog een `SelectionBar` met een eigen statusregel.
- **Pinnen wat blijft** (`app/tests/selectionActions.test.ts`, nu al groen): `useSelectionActions` per actie. Welke mutation met welke argumenten, wanneer een bevestiging met welke titel, welke melding, `onDone` en `onBusyChange`, de tik op het toestel, en niets zonder album, doel, context of keuze.

### Tests per invariant (stand na A)

| Inv. | Test | Niet getest, omdat … |
|---|---|---|
| A1 | `app/tests/selectionBar.test.ts` (`selectionHeader`) | dat een verdwenen foto niet meetelt: schermlogica, audit |
| A2 | `selectionBar.test.ts` (`selectionButtons`, `selectionHeader`) | |
| A3, A4 | `selectionBar.test.ts` (`enterSelectionScroll`, `leaveSelectionScroll`) | het meten van `gridTop` en het scrollen zelf: gate |
| A5 | | layout: gate en audit |
| A6 | `selectionBar.test.ts` (titels) | breedte, 1,2× en 44 pt: gate (zie Gemeten) |
| A7 | `selectionBar.test.ts` (`accessibilityLabel`) | voorlezen en focus: gate |
| A8, A10, A11, A12 | | schermstand en navigatie: gate en audit |
| A9, invariant 1 | `app/tests/selectionActions.test.ts`, `selectionBusy.test.ts`, `photoActions.test.ts`, `myPhotos.test.ts` | dat de knoppen de juiste actie aanroepen: audit |
| invariant 3 | `selectionBusy.test.ts`, `selectionBar.test.ts` (bezig) | |
| bronscan | `app/tests/selectionTexts.test.ts` | |
