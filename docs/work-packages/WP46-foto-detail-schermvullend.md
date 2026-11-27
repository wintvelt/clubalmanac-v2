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

> A 2026-11-27. Bronnen: deze spec, de huidige app-code (`PhotoDetailScreen`, `MyPhotoDetailScreen`, `VideoPlayer`, `Motion`, `TabBar`, `tabBarState`, `SelectionBar` (`useHideTabBar`), `stackOptions`, `useAndroidBack`, `App.tsx`, `app.json`, de stacks onder `src/app/(tabs)`), `expo-video` 58.0.14 (de typen van `VideoView`), WP17a, WP21, WP32, WP33, WP37, WP40 en WP42, en de oude app (`clubalmanac-app`: `screens/PhotoDetail.jsx`, `app.json`). Niets op een toestel gezien: dat staat bij de gate.

### Pariteit met de oude app

In de oude app gaf een tik op de foto een donkergrijs vlak (geen zwart) met alleen de foto, waarin je kon knijpen om te zoomen; een tik ging terug. In die stand kon je **niet** vegen. De tabbalk, de statusbalk en de ronde knop "…" rechtsboven bleven altijd staan. Liggend stond het infoblok (datum, eigenaar, plaats) doorzichtig over de onderkant van de foto, zonder albums. De app draaide mee op elk scherm.

WP46 wijkt bewust af: vegen werkt in elke stand, de achtergrond is zwart, statusbalk en tabbalk gaan weg, en liggend is meteen schermvullend. Er ontbreekt niets uit de oude app, op één punt na: liggend zag je in de oude app de eigenaar en de plaats. Zie besluit A3.

### Antwoorden op de open vragen

1. **Draaien: alle schermen draaien mee.** `app.json` staat op `"orientation": "default"`, en er is geen module om de stand per scherm vast te zetten (`expo-screen-orientation` zit niet in de app). Op de iPhone en op Android draaien Groep, Album, Mijn foto's, de instellingen en het toevoegscherm dus nu al mee; WP40 telde de liggende iPhone al mee. Draaien beperken tot het detail vraagt zo'n module, een nieuwe dev-build, en het mag de iPad niet raken (die draait altijd, ook in Split View). Advies: niet in dit WP. Wie in het detail liggend draait en teruggaat, ziet het album liggend, zoals nu. Wil Wouter dat anders, dan een eigen WP (besluit A9).
2. **Statusbalk, kop en tabbalk verbergen.**
   - *Statusbalk:* `expo-status-bar` zit al in de app (één `StatusBar` voor de hele app in `App.tsx`) en kan hem op iOS en Android verbergen, met of zonder overgang. De native stack (`react-native-screens`) heeft ook een eigen optie per scherm. Twee eigenaars van de statusbalk vechten erom wie wint na het wisselen van scherm, dus één weg kiezen (aan B). Liggend verbergt iOS de statusbalk op de iPhone al zelf; Android niet.
   - *Android, edge-to-edge:* in Expo 58 loopt het scherm op Android altijd onder de statusbalk en de navigatiebalk door. De statusbalk verbergen verandert de indeling daar dus niet. De navigatiebalk van het systeem (de streep van het veeggebaar, of de drie knoppen) verbergen kan alleen met een extra native module (`expo-navigation-bar`, zit niet in de app). Advies: die blijft staan, want bij drie knoppen zit daar de terugknop (besluit A6).
   - *iPhone met een thuisknop (SE):* daar wordt de bovenrand van het veilige gebied 0 als de statusbalk weggaat (was 20 pt). Hangt het fotogebied van dat veilige gebied af, dan schuift de foto daar 20 pt. Op een iPhone met Dynamic Island of inkeping blijft die rand staan. Gate-check op de SE (simulator).
   - *Kop:* de kop van de native stack aan- en uitzetten maakt het vlak van het scherm hoger of lager. Het fotogebied meet zich aan dat vlak (WP32, `PhotoDetailLayout`), dus de lijst met foto's krijgt een nieuwe maat en tekent opnieuw. Dat is het grootste risico op verspringen en flitsen. Liggend mag de kop alleen over de foto komen, zonder dat de foto beweegt (A-invariant 4). Rechtop gaat de foto in één beweging van het normale vak naar het hele scherm.
   - *Tabbalk:* WP40 heeft al een weg om de tabbalk weg te halen: de optie van de navigator op de tab in beeld, die de eigen `TabBar` volgt. Hij zakt dan weg (direct bij "Beperk beweging"), neemt geen ruimte meer in, en komt meteen helemaal terug als het scherm verdwijnt of uit beeld gaat (WP40 G3, G4, H6). Dat dekt een groot deel van invariant 6. Hergebruik is aan B.
   - *Minst springerig:* alles van één wissel (kop, tabbalk, statusbalk, infoblok, achtergrond) in één keer, niet na elkaar, en het fotogebied rekent niet mee met dingen die over de foto heen liggen.
3. **Tik, veeg en afspeelknop nu.**
   - *Foto:* een `ScrollView` per foto (knijpen tot 3×, alleen op iOS) met daarin een `Pressable`. De app telt zelf dubbeltikken: twee tikken binnen 280 ms wisselen tussen 1× en 2,5×. Een enkele tik doet nu niets. Vegen is een horizontale lijst met hele pagina's. Een veeg neemt de aanraking over, dus dan komt er geen tik. Het risico: een enkele tik die meteen de stand wisselt, wisselt bij een dubbeltik twee keer (flits) of wisselt en zoomt. De enkele tik moet daarom wachten tot er geen tweede komt (A-invariant 6).
   - *Android zoomt niet.* Knijpen en de zoom van dubbeltikken (`zoomScale`) van de `ScrollView` bestaan alleen op iOS. Op Android doet een dubbeltik nu niets. Dan hoeft een tik daar ook niet te wachten. Zoom op Android blijft buiten dit WP.
   - *Filmpje, poster:* de hele poster is één knop die het filmpje start (WP37). Besluit 2 maakt alleen de afspeelknop de knop; een tik ernaast wisselt de stand.
   - *Filmpje, speelt:* de native speler (`VideoView` met `nativeControls`) vangt elke tik zelf af en toont of verbergt zijn eigen bediening. De app krijgt daar geen bericht van: `expo-video` 58.0.14 heeft geen gebeurtenis voor "bediening zichtbaar". Een tik op een spelend filmpje bereikt de app dus niet, en de kop kan niet met de native bediening mee. Besluit 2 is met de native bediening niet te halen (besluit A2). Ook heeft die bediening een eigen knop voor volledig scherm (`fullscreenOptions.enable`), die met dit WP dubbel wordt.
   - *Terugvegen en spoelen:* bij de clubfilms staat het terugvegen uit, omdat de tijdbalk aan de linkerrand begint en het veeggebaar het spoelen won (WP21, `filmScreenOptions`). Een filmpje dat schermvullend speelt heeft hetzelfde probleem.
   - *Knijpen:* twee vingers die loslaten kunnen een `Pressable` een tik geven. Gate-check.
4. **Terug in de schermvullende stand: meteen het scherm uit, op beide toestellen.** Op iOS is het veeggebaar terug van de native stack niet half op te vangen: uitzetten maakt het dood, en dan werkt terug niet in elke stand. Op Android kan het wel (`useAndroidBack`, WP42), maar dan doet terug op de twee toestellen iets anders. Wie terugveegt of op terug drukt, wil weg. De normale stand is altijd één tik verderop. Bij het verlaten komen statusbalk en tabbalk terug (invariant 6). Besluit A1.
5. **WP32 en WP33: geen test verandert, één regel wel.**
   - *WP32 B3* ("het fotogebied verandert alleen bij draaien, venstermaat of tekstgrootte") krijgt er de stand bij. Binnen een stand blijft alles zoals het was: niet per foto, niet bij laden, niet door een melding. `photoInfoHeight` blijft gelijk; er is geen test op.
   - *WP33* (het infoblok vervaagt met de veeg): schermvullend is er geen blok, dus niets om te vervagen. Terug in de normale stand staat in het blok de foto in beeld, ook na vegen in de schermvullende stand. Het komt er meteen helemaal, zonder halve doorzichtigheid van de laatste veeg. `motion.test.ts` (`infoOpacity`) verandert niet.
   - *WP37:* een tik naast de afspeelknop start geen filmpje meer (besluit 2). Voor VoiceOver en TalkBack blijft "Afspelen" één knop met de naam van het filmpje.

### Wat in de draft niet klopt of ontbreekt

- **Zoomen bestaat al.** De scope sluit "inzoomen met twee vingers (als dat er nog niet is)" uit. Op iOS kan het al: knijpen en dubbeltikken (WP17a). Dat moet blijven werken, in elke stand. Op Android is er geen zoom, en dat blijft zo.
- **Invariant 1 botst met besluit 5.** Liggend toont een tik alleen de kop met Acties. Eigenaar, plaats en albums zie je dan pas na terugdraaien, niet met één tik. Zie besluit A3.
- **"Tijdelijk" in besluit 5.** Verdwijnt de kop vanzelf na een paar seconden, of alleen bij een tweede tik? Zie besluit A4.
- **De melding na een actie** (verwijderd, gedraaid, "Delen…", een fout) staat nu in het blok onder de foto. Schermvullend is dat blok weg. Na Acties uit de liggende stand zou je niet zien of het lukte. Zie A-invariant 9.
- **"Via een melding" (invariant 6):** de app heeft geen pushmeldingen. Wat het detail ongewild verlaat is een link uit een mail (deep link), uitloggen of een sessie die elders eindigt (de guards sluiten alles), de laatste foto die verdwijnt (terug naar het album), en een tab wisselen (alleen in de normale stand). Ook de app naar de achtergrond en terug hoort erbij.
- **Herverbinden (bestaand, niet van WP46).** In de stand "reconnecting" toont het detail een leeg scherm, en het hele detail verdwijnt. Daarna begint het opnieuw bij de foto waarop je het opende, niet bij de foto waar je naartoe veegde. Dat zit er sinds WP17a in. Schermvullend telt hier mee: dat lege scherm heeft de gewone achtergrond (wit in het licht), en de stand begint opnieuw. Voor regie: eigen regel, buiten WP46.
- **Android-tablets.** Besluit 1 noemt alleen de iPad. Android heeft geen tablet-indeling (WP42, scope). Zie besluit A5.
- **De drie knoppen van Android op zwart.** In het lichte thema zijn de knoppen van de navigatiebalk donker. Op een zwarte achtergrond kunnen ze wegvallen, en daar zit terug. Gate-check met navigatie met drie knoppen.
- **Draaien laat de hoeken zien.** Tijdens het draaien tekent iOS de achtergrond van het venster in de hoeken. Is die wit (licht thema), dan flitst er wit om een zwart scherm (invariant 2). Gate-check.
- **De inkeping en het Dynamic Island.** Schermvullend vult het zwart alles. Een stuk foto onder de inkeping of het eiland is weg. Zie A-invariant 3.
- **Bestaande bronscans** die B moet laten staan: `photoMenuPlace.test.ts` (welke bestanden `usePhotoMenu(` gebruiken: `AlbumScreen`, `MyPhotoDetailScreen`, `MyPhotosScreen`, `PhotoDetailScreen`; elk roept `.hasActions(` aan) en `actionRetry.test.ts` (`components/VideoPlayer.tsx` roept `api.videos.playUrl` alleen via `withOneRetry` aan).

### A-invarianten

1. **Wie mag schermvullend.** Alleen de iPhone- en de Android-app (besluiten 1 en 6). Op de iPad is het detail altijd zoals nu, ook in een smal venster (Split View, Stage Manager) en ook liggend: de iPad telt als iPad, niet naar de maat van het venster. Op het web niets.
2. **De standen.**
   - *Rechtop, normaal:* kop (terug, de datum als titel, Acties), foto, infoblok, tabbalk, statusbalk, de gewone achtergrond.
   - *Rechtop, schermvullend:* alleen de foto op zwart. Geen kop, infoblok, tabbalk of statusbalk.
   - *Liggend, zonder kop:* zoals rechtop schermvullend.
   - *Liggend, met kop:* daarbovenop de kop met terug, de titel en Acties. Geen infoblok, tabbalk of statusbalk; de achtergrond blijft zwart.
   - Een tik op een foto wisselt rechtop tussen normaal en schermvullend, en liggend tussen zonder en met kop. Een tik op een filmpje wisselt de stand niet (besluit 7, A-invariant 12).
3. **De foto past in het veilige gebied.** Schermvullend vult het zwart het hele scherm, ook achter de inkeping, het Dynamic Island, de thuisbalk en de balken van Android. De foto (en een poster of filmpje) past binnen het veilige gebied, dus er valt geen stuk achter de inkeping. De kop, als die er is, staat ook binnen dat gebied.
4. **Wat beweegt.** Rechtop groeit de foto bij schermvullend naar het hele scherm en krimpt terug bij normaal, in één beweging. Liggend komt de kop over de foto en gaat hij weg zonder dat de foto beweegt of van maat verandert. Geen tussenstap waarin de foto even een andere maat heeft. Geen flits van een andere achtergrond, ook niet bij draaien of in het lichte thema. Met "Beperk beweging" gaat elke wissel direct.
5. **Draaien.** Naar liggend: zonder kop, wat de stand rechtop ook was. Terug naar rechtop: de stand van rechtop van vóór het draaien. Was je liggend begonnen (het detail geopend met het toestel liggend), dan is dat normaal. Draaien van liggend naar het andere liggend (180°) verandert niets, ook niet of de kop er is. De stand onthoudt de app alleen zolang het detail open is; een volgende keer begint het detail weer rechtop normaal, of liggend zonder kop.
6. **Een tik is een tik.** Een korte tik op een foto wisselt de stand. Niet: een veeg, een dubbeltik (die zoomt, op iOS), knijpen, een tik op een knop (terug, Acties, sluiten van een melding, opnieuw proberen), een tik die een lopende veeg stopt, en elke tik op een filmpje (besluit 7). Waar een dubbeltik zoomt, wacht de enkele tik tot er geen tweede meer kan komen. Hoogstens ongeveer 300 ms, zodat het nog direct voelt. Waar niets zoomt (een foto op Android), wisselt de tik meteen.
7. **Vegen** werkt in elke stand en houdt de stand vast, ook vegen vlak na een tik of tijdens het draaien. De foto in beeld blijft dezelfde bij elke wissel van stand en bij draaien. Veeg je naar een filmpje, dan blijft de stand zoals hij was, ook schermvullend; veeg je verder naar een foto, dan wisselt een tik weer de stand (besluit 7). Een filmpje dat weg-geveegd wordt, stopt, zoals nu (WP37).
8. **Niets kwijt.** Terug werkt in elke stand, met het veeggebaar of de systeemknop (besluit A1), en op een foto ook met hoogstens één tik via de kop. Acties is op een foto in elke stand met hoogstens één tik bereikbaar (rechtop schermvullend: tik naar normaal; liggend: tik voor de kop). Acties openen kan alleen als de kop er is. Op een filmpje in een stand zonder kop komt de kop terug door naar een foto te vegen of door te draaien naar een stand met kop (besluit 7, randgeval). Eigenaar, plaats en albums zie je rechtop in de normale stand (besluit A3). Een menu, een bevestiging of het deelscherm dat openstaat, houdt de stand vast tot het dicht is; ze sluiten verandert de stand niet.
9. **De melding na een actie** ("Delen…", gelukt, een fout met opnieuw proberen) is in elke stand te zien, ook liggend en schermvullend. Ze sluiten wisselt de stand niet. Na vegen naar een andere foto gaat ze weg, zoals nu.
10. **Verwijderen en verdwijnen.** Haal je de foto in beeld weg (Acties) of verdwijnt hij door een ander, dan komt de volgende foto in dezelfde stand. Was het de laatste, dan gaat het detail terug naar het album, en de statusbalk en tabbalk staan er weer.
11. **Verlaten en terugkomen.** Zodra het detail niet meer in beeld is (terug, Draaien of Locatie wijzigen uit Acties, een tab, een link uit een mail, uitloggen, de sessie die elders eindigt), staan de statusbalk en de tabbalk er meteen weer, op dat volgende scherm. Komt het detail weer in beeld (terug van Draaien, de app terug uit de achtergrond), dan staat het in de stand waarin je het verliet, met de statusbalk zoals die stand vraagt. Is het toestel intussen gedraaid, dan geldt A-invariant 5.
12. **Filmpje (besluit 7).** De native speler blijft zoals nu: een tik op de poster start het filmpje (WP37), een tik op een spelend filmpje doet wat de speler zelf doet, en zijn knop voor volledig scherm blijft, ook op de telefoon. Geen eigen bediening. Een tik op een filmpje wisselt in geen enkele stand de stand. Het filmpje staat in de stand waarin je erheen veegde, en past binnen het vak van die stand (A-invariant 3). Komt de speler terug uit zijn eigen volledig scherm, dan staat het detail in dezelfde stand als ervoor, met de statusbalk en tabbalk zoals die stand vraagt.
13. **Terug (besluit A1).** Het veeggebaar van iOS en de terugknop of het terugveeg-gebaar van Android verlaten het detail meteen, uit elke stand en ook op een filmpje.
14. **VoiceOver en TalkBack.** Staat een schermlezer aan, dan zijn terug en Acties altijd te vinden, zonder dat je eerst iets moet aantikken. Besluit A7: rechtop blijft het detail normaal, liggend staat de kop er altijd. Het label van de foto zegt niet meer dat je kunt dubbeltikken om te zoomen als dat met de schermlezer niet werkt.
15. **Grote letters** veranderen alleen de normale stand (het infoblok, WP32). Schermvullend staat er geen tekst, alleen de titel in de kop.
16. **Thema.** In het lichte en het donkere thema is schermvullend hetzelfde zwart. Terug naar normaal heeft de gewone achtergrond van het thema.

### Gate-checks (alleen te zien op een toestel)

- Rechtop tik heen en terug, tien keer snel achter elkaar: geen flits, geen stand die achterblijft.
- Dubbeltik zoomt en wisselt de stand niet (iPhone). Knijpen en loslaten wisselt de stand niet.
- Vegen in elke stand, ook direct na een tik. Een veeg die net te kort is: de foto veert terug en de stand blijft.
- Draaien in beide richtingen, ook 180° liggend, en met de draaivergrendeling aan (dan alleen de tik).
- iPhone SE (simulator): de foto springt niet 20 pt als de statusbalk weggaat.
- Draaien in het lichte thema: geen witte hoeken.
- Liggend: kop aan en uit, de foto beweegt niet. Acties, Draaien, en terug: dezelfde stand.
- Een filmpje (besluit 7): tik op de poster speelt af en wisselt de stand niet; tik tijdens het spelen doet wat de speler zelf doet, zonder dat de kop of de statusbalk verandert. Vanuit rechtop schermvullend en liggend zonder kop naar een filmpje vegen en weer naar een foto: de stand blijft, en op de foto werkt de tik weer. Het volledig scherm van de speler in en uit, ook na draaien: het detail staat daarna in dezelfde stand. Spoelen vanaf links en weg-vegen: zoals nu.
- Android-emulator met gebaren en met drie knoppen: terug uit elke stand, en de knoppen zijn zichtbaar op zwart.
- VoiceOver en TalkBack: terug en Acties in elke stand. "Beperk beweging": alles direct.
- De iPad, ook Split View en liggend: niets veranderd.
- Een link uit een mail openen terwijl het detail schermvullend is: statusbalk en tabbalk staan er weer.

### Besluiten voor regie en Wouter

- **A1. Terug in de schermvullende stand.** (a) Meteen het detail uit, op iOS en Android. (b) Op Android eerst naar normaal, op iOS meteen uit. Advies: **(a)**. Eén regel voor beide toestellen; iOS kan (b) niet zonder het veeggebaar dood te maken; de normale stand is één tik.
- **A2. De bediening van een filmpje (besluit 2).** De native speler laat de app niet weten wanneer hij zijn bediening toont, en vangt elke tik zelf. (a) Eigen bediening: afspelen en pauzeren, een tijdbalk om te spoelen, de tijd; die komt en gaat met de kop. De knop voor volledig scherm van de native speler vervalt op de telefoon. (b) De native bediening houden: een tik op een spelend filmpje toont alleen die bediening, de kop blijft weg. Dan zijn terug en Acties liggend tijdens het spelen niet met één tik te bereiken (A-invariant 8). Advies: **(a)**. Dat is het meeste werk van dit WP (spoelen, voorlezen, Android). Wil regie 2.0.3 eerder, dan kan het filmpje naar een WP46b, en blijft het filmpje tot dan in de normale stand spelen zoals nu.
- **A3. Infoblok liggend.** (a) Liggend alleen de kop met de datum als titel (besluit 5). Eigenaar, plaats en albums zie je rechtop. Invariant 1 wordt dan: terug en Acties met één tik, de rest door terug te draaien. (b) Liggend met de kop ook een korte regel over de foto (eigenaar, plaats), zoals in de oude app. Advies: **(a)**.
- **A4. "Tijdelijk" in besluit 5.** (a) De kop blijft tot de volgende tik. (b) Hij gaat na een paar seconden zonder aanraking vanzelf weg. Advies: **(a)** voor foto's. Bij een spelend filmpje doet de Foto's-app (b); dat is een gate-vraag als A2 (a) wordt.
- **A5. Android-tablet.** (a) Telt als telefoon (Android heeft geen tablet-indeling, WP42). (b) Zoals de iPad: niets veranderd. Advies: **(a)**. Er is geen tablet-indeling om te beschermen, en de maat van het scherm raden is foutgevoelig.
- **A6. Navigatiebalk van Android en de thuisbalk van de iPhone.** Besluit 3 noemt alleen klok en batterij. Advies: beide blijven staan. Op Android zit daar met drie knoppen de terugknop, en verbergen vraagt een extra native module.
- **A7. Schermlezer.** Advies: met VoiceOver of TalkBack aan, blijft rechtop het detail normaal en staat liggend de kop er altijd (A-invariant 14).
- **A8. De knop voor volledig scherm van de native speler.** Hoort bij A2. Op de iPad blijft hij (besluit 1).
- **A9. Draaien beperken tot het detail.** Advies: niet in WP46 (antwoord 1).

### Besluiten na A (Wouter en regie, 2026-11-27)

- **Besluit 7 (vervangt besluit 2 en A2, A4 voor filmpjes, A8): filmpjes houden de native speler.** Een tik op een filmpje verandert de stand niet; de speler doet met een tik wat hij nu doet, en zijn eigen knop voor volledig scherm blijft (ook op de telefoon). Geen eigen bediening. Veeg je vanuit een stand naar een filmpje, dan blijft de stand zoals hij is (geen sprong); terug (veeg of systeemknop) werkt altijd, en vegen naar een foto maakt de tik weer bruikbaar. Wouter: "standaard speler heeft al een full screen optie"; foto schermvullend en dan naar een filmpje vegen is een randgeval.
- **A1:** (a), terug gaat in elke stand meteen het detail uit.
- **A3:** (a), liggend alleen de kop; invariant 1 wordt: terug en Acties met één tik (bij een foto), de rest door terug te draaien.
- **A4:** (a) voor foto's: de kop blijft tot de volgende tik.
- **A5:** (a), een Android-tablet telt als telefoon.
- **A6:** de navigatiebalk van Android en de thuisbalk van de iPhone blijven staan.
- **A7:** zoals geadviseerd (schermlezer aan: rechtop normaal, liggend de kop altijd).
- **A9:** niet in WP46.
- **Buiten WP46:** na herverbinden begint het detail opnieuw bij de foto waarop je het opende (sinds WP17a). Eigen TBD-regel.

### Testcontract (A, na de besluiten)

> Namen en vormen zijn A-keuzes, het hoe is aan B. Aangepast aan besluit 7 en de besluiten A1 tot A9.

- **`app/src/lib/photoDetailStand.ts`** (puur, zonder React of native modules):
  - `fullscreenAllowed({ os, isPad })`: mag dit toestel schermvullend (A1, besluit A5).
  - `orientationOf({ width, height })`: `"portrait"` of `"landscape"`; liggend als het venster breder is dan hoog, vierkant telt als rechtop.
  - `initialStand(orientation)`, `nextStand(stand, event)` met `event` een tik (`{ type: "tap" }`) of een andere stand van het toestel (`{ type: "rotate", orientation }`). De stand zelf is een waarde die alleen via deze functies verandert (A2, A5).
  - `standView(stand, { fullscreenAllowed, screenReader })`: `{ header, info, tabBar, statusBar, black }`, wat er te zien is (A1, A2, A14 met besluit A7, A16).
  - `tapIntent({ lastTapAt, now, target })` en `DOUBLE_TAP_MS`: wat een tik doet. `target` is waar de tik op valt: `"zoomable"` (een foto die met dubbeltikken zoomt, iOS), `"photo"` (een foto die niet zoomt, Android) of `"video"` (een filmpje, poster of spelend). Uitkomst: `"zoom"` (de tweede tik van een dubbeltik), `"wait"` (de stand pas wisselen als er binnen `DOUBLE_TAP_MS` geen tweede tik komt), `"stand"` (meteen wisselen) of `"none"` (niets aan de stand: een filmpje, besluit 7). `lastTapAt` is de tijd van een vorige tik die nog wacht, of `null` (A6, A12).
- **Bronscan:** `nextStand(`, `standView(` en `fullscreenAllowed(` worden in de app-code aangeroepen, buiten `src/lib`.

### Tests per invariant (stand na A)

| Inv. | Test | Niet getest, omdat … |
|---|---|---|
| A1 | `app/tests/photoDetailStand.test.ts` (`fullscreenAllowed`, `standView`; Android-tablet volgens besluit A5) | Split View op de iPad: gate |
| A2 | `photoDetailStand.test.ts` (`nextStand`, `standView`) | |
| A3 | | indeling en veilig gebied: gate |
| A4 | | beweging en flitsen: gate |
| A5 | `photoDetailStand.test.ts` (`orientationOf`, `initialStand`, `nextStand`) | |
| A6 | `photoDetailStand.test.ts` (`tapIntent`) | veeg, knijpen, knoppen: schermlogica, audit en gate |
| A7 | | lijst en positie: schermlogica, audit en gate |
| A8–A11 | | schermlogica (focus, menu's, navigatie): audit en gate |
| A12 | `photoDetailStand.test.ts` (`tapIntent` met `target: "video"` geeft `"none"`) | de native speler, zijn volledig scherm, de stand na vegen naar een filmpje: audit en gate |
| A13 | | navigatie: gate |
| A14 | `photoDetailStand.test.ts` (`standView` met `screenReader`, besluit A7) | voorlezen: gate |
| A15 | | gate |
| A16 | `photoDetailStand.test.ts` (`black`) | de kleur zelf: gate |
| bron | `photoDetailStand.test.ts` (bronscan) | |
