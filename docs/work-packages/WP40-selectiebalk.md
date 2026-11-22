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
- **Liggende iPhone:** geen statusbalk, maar een kop van 44 pt, de balk van 50 pt en de tabbalk samen laten op een hoogte van 390 pt ongeveer 200 pt over voor het raster. Dat is een gate-check. Sinds gate ronde 1 is de tabbalk weg tijdens de selectie, dus er blijft meer over (G2).
- **Bestaande bronscans** die B moet laten staan: `photoMenuPlace.test.ts` en `shareBusy.test.ts` (welke schermen `usePhotoMenu(` en `.hasActions(` gebruiken), `addTexts.test.ts` ("Toevoegen" in `AlbumScreen.tsx`; "Kies foto's" mag niet voorkomen in `AddPhotosScreen*`, `AddPhotosParts`, `lib/addSelection.ts` en `AlbumChoice.tsx`, dus de titel "Kies foto's" hoort daar niet) en `videos.test.ts` (`mediaCountText(` in `AlbumScreen.tsx`).

### A-invarianten

1. **Titel in de kop.** Nul gekozen: "Kies foto's". Eén: "1 geselecteerd". Meer: "3 geselecteerd". Tijdens een actie: "Bezig…", wat er ook gekozen is. Het aantal telt alleen foto's die nog in beeld kunnen zijn. Wist een ander een gekozen foto of haalt die hem uit het album, dan telt hij niet meer mee (zoals nu).
2. **Knoppen.** Album: "Naar album", "Uit album", "Verwijderen", in die volgorde. Mijn foto's: "Naar album", "Verwijderen". Verwijderen is rood en staat als laatste, zoals in het foto-menu. Bij nul en tijdens een actie zijn ze grijs (uit, maar zichtbaar), anders aan. Of ze aan staan hangt alleen af van het aantal en van bezig, nooit van wie de foto's zijn: elke actie geldt per foto, en wat niet mag meldt de app achteraf (WP17b A-keuze 2). "Annuleren" is alleen uit tijdens een actie.
3. **Selecteer in het album.** Het raster scrolt tot het direct onder de kop begint, of zo ver als de lijst kan. Wie al zo ver of verder stond, ziet niets bewegen.
4. **Terug uit de selectie** (Annuleren, of het einde van een actie). Heb je tijdens de selectie niet zelf gescrold, dan gaat de lijst terug naar waar hij stond vóór Selecteer, en is de omslag weer in beeld. Heb je wel gescrold, dan blijft het raster staan.
5. **Geen sprong door de knoppenrij.** Dat de rij met Selecteer, Kaart en Bewerk album verdwijnt en terugkomt, verplaatst de foto's in beeld niet. In het album geldt dat ook na terug uit de selectie, als je naar beneden had gescrold.
6. **De balk.** Eén rij met per knop een icoon en een label, alle knoppen even breed, ongeveer 50 pt hoog. Sinds gate ronde 1 staat hij op de plek van de tabbalk, boven de thuisbalk (G1). Op een iPhone van 375 pt passen drie knoppen bij elke tekstgrootte tot en met xxxLarge: het label groeit hoogstens 1,2× mee, wordt niet afgekapt en breekt niet af. Elk tikvlak is minstens 44 × 44 pt. Geen uitlegregel en geen Annuleren in de balk.
7. **VoiceOver.** Knopnamen met het aantal: "Naar album, 3 foto's", "Uit album, 1 foto", "Verwijderen, 3 foto's". Bij nul alleen "Naar album", en VoiceOver zegt "gedimd". Bij elke verandering van de titel (aantal of "Bezig…") meldt de app de nieuwe titel. Filmpjes tellen als foto's, net als in de bevestigingen en meldingen van nu.
8. **Brede layout (liggende iPad, album).** Het raster scrolt niet en verschuift niet. Aantal en Annuleren staan bovenin de zijkolom, op de plek van "Groep". Tijdens de selectie is er ook daar geen terugknop. Gaat het venster tijdens de selectie van smal naar breed of andersom (draaien, Split View), dan blijven de selectie en het aantal staan.
9. **Wat blijft.** Wat de acties doen, de album-keuze (`AlbumChoiceSheet` met `fromAlbumId` in het album), de bevestigingen, de meldingen, de tik op het toestel, het einde van de selectie na een actie, één actie tegelijk, het foto-menu uit tijdens de selectie, de wissel van filter in Mijn foto's die de selectie stopt, en de titel van `Stack.Screen` in het album (de albumnaam, de terugknop-tekst op het foto-detail). Pinnen in `selectionActions.test.ts` en `selectionBusy.test.ts`.
10. **Tijdens een actie** geen tweede actie en geen Annuleren (invariant 3). In het album kun je ook niet terugvegen of terugtikken. De tabbalk is er niet, dus je kunt ook geen tab wisselen (gate ronde 1).
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

1. **Tabbalk tijdens de selectie.** Foto's verbergt de tabbalk en zet de actiebalk op zijn plek. Dat scheelt ongeveer 66 pt, een halve rij tegels. Herzien in gate ronde 1: de tabbalk is weg tijdens de selectie.
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

## Besluiten Wouter na A (2026-11-22)

Alle vier aanbevelingen van A (§Besluiten voor Wouter) zijn akkoord: de tabbalk blijft staan; bij weinig foto's zo ver scrollen als kan (omslag mag deels zichtbaar blijven); "Selecteer" in Mijn foto's rechtsboven in de kop; het filter in het album blijft zoals nu. De RED tests van A gelden ongewijzigd.

## Gate ronde 1: iPhone (Wouter, 2026-11-22)

Build `wp40-dev2`. Kop met aantal en Annuleren, inklappen van de omslag en de slanke balk: beter. Bevinding: de verhoogde + van de tabbalk steekt in de middelste knop van de balk ("Uit album").

**Besluit Wouter (herziet besluit 1 na A):** tijdens de selectie is de tabbalk weg, zoals in de Foto's-app; de selectiebalk staat op die plek, boven de thuisbalk. Na Annuleren (of na een actie die de selectie beëindigt) komt de tabbalk terug. Geldt in het album en in Mijn foto's, ook op de iPad.

## Gate ronde 1: A-aanvullingen (A vult in)

> A 2026-11-22. Bronnen: het besluit hierboven, de code van B (`da0c81f`, `eba2a03`: `SelectionBar.tsx`, `AlbumScreen.tsx`, `MyPhotosScreen.tsx`), `navigation/TabBar.tsx`, de tabs-layout en `AlbumChoice.tsx`.

### Wat de code nu doet

- De tabbalk is een eigen component op de JS-tabs (`TabBar.tsx`). Hij leest alleen `state`, `emitter`, `navigateToTab` en `insets`. Op de opties van de schermen let hij niet: een tab-optie om hem te verbergen werkt dus nog niet.
- De tabs-layout zet de tabbalk onder de schermen. Valt hij weg, dan worden de schermen onderaan langer. De bovenkant blijft waar hij is.
- De `SelectionBar` van B houdt geen rekening met de thuisbalk, want hij stond tot nu toe boven de tabbalk. Op de plek van de tabbalk zouden de knoppen dan over de thuisbalk vallen.
- Het kiesscherm "Naar album" is een `Modal` (pageSheet). Het scherm eronder blijft dan in beeld voor de navigatie, net als bij een bevestiging en het actiemenu.
- Het album en Mijn foto's halen hun inhoud weg bij "reconnecting" en bij een leesfout (een `Screen` met de melding). Gebeurt dat tijdens de selectie, dan is de selectie weg. B zet in dat geval het terugvegen al terug; voor de tabbalk is dezelfde zorg nodig.

### A-invarianten (gate ronde 1)

G1. **Tabbalk weg tijdens de selectie.** Zolang het album of Mijn foto's in de selectiestand in beeld is, is er geen tabbalk en ook geen +. De selectiebalk staat op die plek, onderaan het scherm. Zijn knoppen staan boven de thuisbalk, en zijn achtergrond loopt door tot de onderrand. Op een iPhone met thuisknop (geen thuisbalk) staat hij gewoon onderaan. Op elk ander scherm, en zodra de selectie stopt, is de tabbalk er weer. Dat geldt na Annuleren, na een actie, of als de inhoud wegvalt (G4).

G2. **Niets verspringt.** De bovenkant van de lijst en van het raster blijft staan als de tabbalk weggaat of terugkomt. Alleen het zichtbare deel onderaan wordt groter of kleiner. Tabbalk en selectiebalk wisselen zonder moment met allebei naast elkaar of met geen van beide (sinds gate ronde 2 met een korte beweging, H1–H5). Bij terug uit de selectie staat een melding (na een actie) boven de tabbalk, nooit eerst op de plek van de selectiebalk (H4). Het scrollen naar het raster bij Selecteer (A3) rekent met de hoogte zonder tabbalk. In een album met weinig foto's schiet de lijst dus niet voorbij zijn einde.

G3. **Uit beeld = selectie gestopt** (A-keuze). Zonder tabbalk kun je niet van tab wisselen. Opent een link toch een ander scherm (een uitnodiging, een foto, een andere tab), dan stopt de selectie, en het nieuwe scherm heeft gewoon een tabbalk. Kom je terug, dan is er geen selectie meer en is de tabbalk er. Loopt er nog een actie, dan maakt die zijn ronde af en staat de melding er als je terugkomt (zoals nu). Het kiesscherm, een bevestiging, het actiemenu en de app op de achtergrond halen het scherm niet uit beeld: daar blijven de selectie en de verborgen tabbalk staan.

G4. **De inhoud valt weg.** Gaat de app naar "reconnecting", komt er een leesfout, of verdwijnt het album (verwijderd, geen lid meer), dan is de selectie weg en is de tabbalk er meteen. Je moet altijd weg kunnen.

G5. **Tijdens een actie** blijft de tabbalk weg tot de ronde klaar is. Pas dan komt hij terug, samen met de melding. Zo kun je midden in een ronde ook geen tab wisselen.

G6. **iPad.** Op de iPad geldt hetzelfde, staand en liggend. In de brede layout loopt de selectiebalk over de volle breedte, met de knoppen in het midden zoals de tabbalk (hoogstens 640 pt breed). Draaien en Split View tijdens de selectie: de tabbalk blijft weg en de selectie blijft staan (A8).

G7. **VoiceOver.** In de selectiestand zijn de tabs er niet. Vegen gaat langs de kop, het raster en de balk, en komt nooit op een tab of op de +. Na Annuleren zijn de tabs er weer, in de gewone volgorde, en gaat de focus naar "Selecteer" (zoals B al doet). Na een actie leest VoiceOver de melding, zoals nu.

G8. **Uitgelogd en web.** De uitgelogde tabbalk (Inloggen, Info) en het web veranderen niet. Op het web komt er geen selectiestand.

### Gate-checks (ronde 2)

- Album en Mijn foto's, iPhone met thuisbalk: na Selecteer geen tabbalk en geen +, de balk netjes boven de thuisbalk, en het raster springt niet. Na Annuleren en na Verwijderen komt de tabbalk terug, eventueel met de melding erboven, zonder flits.
- Selecteer in een album dat helemaal naar beneden gescrold is, en in een album met één rij: schiet er iets voorbij of verspringt er iets?
- Tijdens "Bezig…" blijft de tabbalk weg; daarna komt hij terug met de melding.
- iPad staand en liggend (zijkolom): tabbalk weg, de balk over de volle breedte, knoppen in het midden; draaien tijdens de selectie.
- VoiceOver: geen tabs tijdens de selectie, na Annuleren weer wel.
- Vliegtuigmodus aan tijdens de selectie (reconnecting): de tabbalk komt terug.
- Een link (bijvoorbeeld een uitnodiging) openen tijdens de selectie: het andere scherm heeft een tabbalk; terug in het album is de selectie weg.
- Annuleren snel na Selecteer, en Selecteer snel na Annuleren: geen tabbalk die blijft hangen of wegblijft.

### A-keuzes

- **De eigen tabbalk volgt de gewone optie van de navigator** (`tabBarStyle` met `display: "none"` op de tab in beeld), zoals de standaard-tabbalk van React Navigation. Alleen de tab in beeld telt. Wie die optie zet en weer weghaalt, is aan B.
- **Uit beeld stopt de selectie** (G3). Dat is eenvoudiger en veiliger dan de selectie bewaren met een tabbalk die per scherm moet wisselen. In de praktijk gebeurt het alleen via een link.

### Testcontract (gate ronde 1)

- **`app/tests/selectionTabBar.test.ts`** (nieuw):
  - G1: als de tab in beeld `tabBarStyle: { display: "none" }` heeft, is geen tab en geen + van de eigen `TabBar` aan te tikken of voor VoiceOver te vinden (sinds gate ronde 2 mag hij dan nog wegzakken, H6). Met die optie op een andere tab, met een andere stijl, of zonder optie werkt hij.
  - G2-bronscan: `AlbumScreen.tsx` en `MyPhotosScreen.tsx` zetten `tabBarStyle`, zelf of via een module die ze importeren.
- De bestaande tests van WP40 blijven gelden. Geen enkele test zei dat de tabbalk blijft.

### Tests (gate ronde 1)

| Inv. | Test | Niet getest, omdat … |
|---|---|---|
| G1 | `selectionTabBar.test.ts` (TabBar volgt de optie; de schermen zetten hem) | de thuisbalk onder de knoppen: gate |
| G2, G5, G6, G7 | | layout, timing en VoiceOver: gate en audit |
| G3, G4 | | navigatie en unmount: audit en gate |
| G8 | `selectionTabBar.test.ts` (zonder optie staat hij er) | |

## Gate ronde 2: iPhone (Wouter, 2026-11-22)

Build `wp40-dev3`. De tabbalk is weg tijdens de selectie en de balk staat goed boven de thuisbalk: werkt. Wens: een beetje animatie.

**Besluit Wouter:** drie animaties, alle drie subtiel en in de stijl van WP33 (maten in `src/lib/motion.ts`, "Beperk beweging" aan = meteen de eindstand, zonder beweging).

1. **Wissel onderin.** Bij Selecteer zakt de tabbalk weg en schuift de selectiebalk omhoog op zijn plek. Bij Annuleren of na een actie gaat het andersom. Samen ongeveer een kwart seconde. Dit herziet in G2 alleen "in één keer": er blijft geen moment met allebei de balken naast elkaar of met een leeg gat, en de bovenkant van het raster verspringt nog steeds niet.
2. **Vinkje op de foto.** Bij aantikken verschijnt het vinkje met een kleine veer, en de geselecteerde foto krimpt een beetje (zoals de Foto's-app). Uitzetten gaat terug, ook vloeiend.
3. **Kop bovenin.** Het aantal ("3 geselecteerd") wisselt soepel bij elke tik in plaats van te springen.

Scope: album en Mijn foto's, iPhone en iPad. Web en de uitgelogde tabbalk veranderen niet. Geen haptics erbij.

## Gate ronde 2: A-aanvullingen (A vult in)

> A 2026-11-22. Bronnen: het besluit hierboven, WP33 (`lib/motion.ts`, `components/Motion.tsx`), de code van B (`f7c9f7a`: `SelectionBar.tsx`, `AlbumScreen.tsx`, `MyPhotosScreen.tsx`, `TabBar.tsx`) en de standaard-tabbalk van React Navigation (verbergen bij het toetsenbord).

### Wat de code nu doet

- De eigen `TabBar` geeft niets terug zodra de tab in beeld `display: "none"` heeft. Er is dan niets om weg te laten zakken. Om te zakken moet hij nog even blijven staan, zonder ruimte in te nemen, zodat het raster er meteen onder doorloopt. Zo doet React Navigation het bij het toetsenbord. De test van G1 vroeg "niets of `display: none`"; die is versoepeld (H6).
- De selectiebalk staat in het scherm en is weg zodra de selectie stopt. Om weg te zakken moet hij nog even blijven staan.
- Het vinkje (`SelectMark`) is een vast icoon: een lege cirkel of een vinkje, met een rand van 3 pt om de gekozen tegel. De tegel krimpt al bij indrukken (WP33 B2).
- In Mijn foto's is de titel de gewone iOS-titel. Die wisselt zonder animatie. Voor een zachte wissel is een eigen titel in de iOS-kop nodig. In het album en de zijkolom tekent de app de titel al zelf.

### A-invarianten (gate ronde 2)

**Wissel onderin**

H1. **De beweging.** Bij Selecteer zakt de tabbalk, met de +, helemaal uit beeld, en schuift de selectiebalk vanaf de onderrand omhoog naar zijn plek. Bij terug uit de selectie (Annuleren, of na een actie) gaat het andersom. Beide balken bewegen alleen recht omhoog of omlaag, in de strook onderaan (de plek van de tabbalk). Samen duurt het 200 tot 300 ms. De balk die weggaat, begint meteen bij de tik.

H2. **Geen gat, niet naast elkaar.** De nieuwe balk begint te komen voordat de oude weg is. De oude is weg uiterlijk als de nieuwe staat. De selectiebalk staat nooit boven de tabbalk. Waar de balken elkaar overlappen, ligt de selectiebalk bovenop: de + of een tab staat nooit over een knop van de selectiebalk. Wat onder een balk vandaan komt, is het scherm zelf: het raster, of de achtergrond waar het raster ophoudt. Je ziet nooit een lege strook waar de foto's afgesneden zijn. De bovenkant van het raster verspringt niet (G2).

H3. **Wat weggaat, doet niets meer.** Een balk die wegzakt, reageert niet op tikken: geen tab en geen + bij Selecteer, geen knop van de selectiebalk bij terug. VoiceOver slaat hem over. De balk die komt, werkt meteen, ook terwijl hij nog schuift (WP33 invariant 12).

H4. **De melding na een actie** staat, zodra hij te zien is, op zijn plek boven de tabbalk. Hij schuift niet mee en verspringt niet. Hij verschijnt uiterlijk als de wissel klaar is en fadet in zoals elke melding (WP33 D1). VoiceOver leest hem zoals nu.

H5. **Snel na elkaar.** Tik je Annuleren terwijl de balken nog wisselen (of Selecteer terwijl ze terugwisselen), dan keren ze om vanaf waar ze zijn. Er is geen sprong, en ze eindigen in de stand die bij de selectie hoort. Een tabbalk blijft nooit half hangen. Hij blijft nooit weg na de selectie en komt nooit terug tijdens de selectie. Tijdens een actie blijft hij weg tot de ronde klaar is (G5).

H6. **Weg zonder wissel.** Valt de inhoud weg (G4) of gaat het scherm uit beeld (G3), ook midden in een wissel? Dan staat de tabbalk er meteen en helemaal, op elk scherm. Er is nooit een halve of onzichtbare tabbalk. Voor de eigen `TabBar` betekent dat het volgende. Met de verberg-optie op de tab in beeld mag hij nog wegzakken, maar is hij niet aan te tikken en niet voor VoiceOver. Gaat de optie weg, ook in hetzelfde scherm, dan werkt hij weer helemaal.

H7. **iPad, liggend, draaien.** Op de iPad en liggend gaat de wissel net zo, en in de brede layout over de volle breedte (G6). Draai je tijdens de wissel, dan eindigt hij goed.

**Vinkje**

H8. **Aantikken.** Het vinkje groeit vanuit klein, schiet een klein beetje voorbij en staat binnen een halve seconde stil (een kleine veer). De hele tegel krimpt een beetje, met alles erop: het vinkje, "nieuw", het filmteken, het teken voor je eigen foto en de rand. Hij blijft klein zolang hij gekozen is. Zet je hem uit, dan gaat het vinkje weg, komt de lege cirkel terug en groeit de tegel terug naar zijn maat. Dat gaat vloeiend, zonder veer.

H9. **Het raster blijft staan.** Het krimpen is alleen te zien: de tegel houdt zijn plek, en buren en rijen schuiven niet. Een tik op het zichtbare deel van een gekozen tegel zet hem uit. Indrukken (WP33 B2) blijft. De tegel krimpt bij indrukken en gaat dan naar zijn stand, gekozen of niet, zonder dubbele sprong of zichtbaar heen en weer.

H10. **Alleen een tik speelt de animatie.** Een gekozen tegel die opnieuw getekend wordt, staat meteen klein met vinkje, zonder veer. Dat geldt als hij in beeld scrolt, als de lijst hem hergebruikt, bij een live update, bij een wissel van filter en bij een ander aantal kolommen. Bij Selecteer krijgen alle tegels meteen de lege cirkel, zoals nu.

H11. **Einde van de selectie en snel tikken.** Na Annuleren, na Naar album of na een mislukte actie groeien gekozen tegels die blijven staan vloeiend terug, zoals bij uitzetten. Geen tegel blijft klein. Wat weg is, gaat weg zoals nu. Elke tik telt meteen, ook midden in de veer (WP33 B5). De animatie volgt de laatste stand en loopt niet achter.

**Kop**

H12. **Het aantal wisselt zacht.** Bij elke nieuwe titel ("Kies foto's", "3 geselecteerd", "Bezig…") vervaagt de oude en verschijnt de nieuwe: kort overvloeien, zonder schuiven of rollen. Dat geldt in het album, in de zijkolom en in Mijn foto's. Annuleren staat stil.

H13. **Niet achter, niet anders.** Na de laatste tik staat binnen de duur het goede aantal er. Bij snel tikken blijft er geen oude titel half staan. VoiceOver hoort de nieuwe titel meteen (A7), niet pas na de animatie. In Mijn foto's ziet de titel eruit als de gewone iOS-titel (letter, grootte, plaats, licht en donker), en VoiceOver leest hem als kop.

**Overal**

H14. **Beperk beweging.** Niets schuift, veert, krimpt of vloeit over: alles staat meteen in de eindstand, en de instelling geldt live (WP33 F1). De balken wisselen in één keer, zoals in gate ronde 1, en de titel wisselt meteen. Een gekozen tegel staat meteen klein met vinkje (A-keuze, vraag 2).

H15. **Eén plek voor de maten.** Alle maten en duren van deze drie animaties staan in `src/lib/motion.ts`, als pure functies die "Beperk beweging" meekrijgen (dan duur 0). De tabbalk en de selectiebalk gebruiken dezelfde wissel. Het album en Mijn foto's gebruiken hetzelfde vinkje en dezelfde titel. Op het web en bij de uitgelogde tabbalk verandert niets. Er komen geen haptics bij.

### Gate-checks (ronde 3)

- Selecteer en Annuleren in het album en in Mijn foto's, iPhone met thuisbalk: zakt de tabbalk (met de +) netjes weg en schuift de balk omhoog? Is er geen gat, en steekt de + nergens in een knop? Blijft het raster staan? Na Verwijderen: komt de melding rustig, zonder te verspringen?
- Annuleren snel na Selecteer, en Selecteer snel na Annuleren: keert het soepel om, en blijft er geen tabbalk hangen?
- Een tab of de + aantikken terwijl hij wegzakt: gebeurt er niets?
- Vinkje: is de veer klein genoeg, en is het krimpen duidelijk maar rustig, ook met de rand van 3 pt? Gaat uitzetten vloeiend? Snel achter elkaar tikken, en een gekozen tegel die in en uit beeld scrolt: geen herhaalde veer?
- Titel: wisselt het aantal zacht bij snel tikken, zonder achter te lopen? Zien de koppen van Mijn foto's en het album er nog hetzelfde uit?
- Beperk beweging aan: alles meteen, geen beweging.
- iPad staand en liggend, en draaien tijdens de wissel.
- VoiceOver: geen tabs tijdens de selectie, de titel wordt meteen voorgelezen, en de melding na een actie ook.

### A-keuzes

- **De balken wisselen tegelijk** (of de nieuwe iets later), en de selectiebalk ligt bovenop. Na elkaar zou een moment zonder balk geven.
- **Een veer alleen voor het vinkje.** De tegel krimpt en groeit zonder veer: een tegel die op en neer veert, oogt onrustig in een raster.
- **Bij Beperk beweging staat een gekozen tegel klein.** Klein is de eindstand en geen beweging (vraag 2).
- **De titel vloeit over** en rolt geen cijfers. Overvloeien is het rustigst (vraag 1).
- **De kop van het album** fadet in bij Selecteer en is meteen weg bij Annuleren, zoals nu. Dat valt buiten het besluit.

### Open vragen voor regie

1. **Titel:** overvloeien (A) of rollende cijfers, zoals iOS die soms gebruikt? Rollen is drukker en alleen voor de cijfers lastig te bouwen. Advies: overvloeien.
2. **Beperk beweging en het vinkje:** de gekozen tegel klein (eindstand, A) of op ware grootte? Advies: klein. Zo zie je ook zonder animatie wat gekozen is.
3. **De rand van 3 pt** om een gekozen tegel blijft, ook nu de tegel krimpt. Weghalen is een vormkeuze buiten het besluit. De gate kijkt of het samen goed oogt.

### Testcontract (gate ronde 2)

> Namen en vormen zijn A-keuzes, het hoe is aan B. Tijden in ms.

- **`app/src/lib/motion.ts`**, drie nieuwe pure functies. Met `reduceMotion` aan is elke duur 0.
  - `barSwap(reduceMotion)` geeft `{ leaving: { delay, duration }, arriving: { delay, duration } }`: de balk die weggaat en de balk die komt, in beide richtingen hetzelfde (H1, H2, H14).
  - `selectFeedback(reduceMotion)` geeft `{ tileScale, tileDuration, markFromScale, markSpring, markOutDuration }`. Dat zijn de schaal van een gekozen tegel en de duur van krimpen en terug, de beginschaal van het vinkje, de veer van het vinkje als `{ damping, stiffness, mass }` (zoals `withSpring` van Reanimated, of `null` voor meteen), en de duur van het vinkje bij uitzetten (H8, H14).
  - `titleChange(reduceMotion)` geeft `{ duration }`, het overvloeien van de titel (H12, H14).
- **Bronscan:** `barSwap(` wordt gebruikt vanuit de tabbalk en vanuit beide schermen. `selectFeedback(` en `titleChange(` worden gebruikt vanuit beide schermen (H15).
- **`selectionTabBar.test.ts`** (versoepeld, H6): met de optie is geen tab en geen + aan te tikken of voor VoiceOver te vinden. Zonder de optie werkt alles, ook nadat de optie in hetzelfde scherm weer weg is, of na snel aan en uit. De test heeft nep-versies van Reanimated, worklets en safe-area, zodat de tabbalk een animatie mag krijgen. Breekt een nieuwe import van B de test toch, dan meldt B dat en past A de nep-modules aan.

### Tests (gate ronde 2)

| Inv. | Test | Niet getest, omdat … |
|---|---|---|
| H1, H2 | `app/tests/selectionMotion.test.ts` (`barSwap`) | richting, strook, bovenop en geen afgesneden raster: gate en audit |
| H3, H6 | `selectionTabBar.test.ts` | de selectiebalk die wegzakt: audit en gate |
| H4, H5, H7 | | timing en layout: gate en audit |
| H8 | `selectionMotion.test.ts` (`selectFeedback`, de veer doorgerekend) | hoe het oogt: gate |
| H9–H11 | | hergebruik, filter, indrukken samen: audit en gate |
| H12, H13 | `selectionMotion.test.ts` (`titleChange`) | voorlezen en de iOS-titel: gate |
| H14 | `selectionMotion.test.ts` (alle drie) | live wisselen: gate |
| H15 | `selectionMotion.test.ts` (bronscan) | web en uitgelogd: G8-test in `selectionTabBar.test.ts` |

### Regie op de open vragen van A (2026-11-22)

1. Titel: overvloeien, geen rollende cijfers.
2. "Beperk beweging": een gekozen tegel staat meteen klein (de eindstand).
3. De rand van 3 pt blijft; de gate kijkt of rand plus krimpen samen goed oogt.
