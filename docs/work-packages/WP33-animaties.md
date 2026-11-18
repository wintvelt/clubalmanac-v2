# WP33: Subtiele animaties

App-WP (lichtere variant, [`work-package-specs.md`](../conventions/work-package-specs.md) §App-WP's). Vóór de cutover-build (besluit Wouter 2026-11-18: nu, alle 7 voorstellen).

## Productdoel

De app voelt levendig en verzorgd zoals de oude app, met beweging die de user helpt zien wat er gebeurt. Nooit opvallend, nooit trager, en uit voor wie "Beperk beweging" aan heeft.

Achtergrond: de oude app had een bewegende groepskop, tegels en knoppen die reageerden op indrukken, en een informatieblok dat vervaagde bij swipen. v2 heeft alleen een fade van 150 ms bij het laden van foto's. Inventaris van v1: regie 2026-11-18 (`components/GroupHeaderNew.jsx`, `screens/Group.jsx`, `components/GroupCard.jsx`, `AlbumCard.jsx`, `fields/Button*.jsx`, `screens/PhotoDetail.jsx`); A controleert en vult aan.

## Invarianten

### A. Kop bij scrollen (groepspagina en album)

1. **Omhoog scrollen:** de kop met de cover schuift langzamer dan de inhoud eronder (parallax). De coverfoto zoomt daarbij uit, van licht ingezoomd (rond 1,15×) naar 1×. Naam en tekst in de kop vervagen en krimpen licht, en zijn weg voordat ze onder de navigatie of de statusbalk komen. Rustiger dan v1 (dat zoomde van 2×).
2. **Bovenaan verder naar beneden trekken:** de cover rekt mee en blijft aan de bovenkant vast. Er verschijnt geen lege rand boven de cover.
3. **Zonder cover** (verloop met letter): dezelfde beweging, zonder zoom.
4. Scrollen blijft vrij: de kop klikt niet vanzelf open of dicht (v1 deed dat wel; niet overgenomen).

### B. Indrukken

5. **Tegels** (groep op *Mijn groepen*, album op de groepspagina): bij indrukken zoomt de cover licht in binnen het kader, terug bij loslaten of annuleren. Kader en tekst blijven staan.
6. **Knoppen** krimpen licht bij indrukken (de iOS-manier) en veren terug bij loslaten. Dit geldt voor alle knoppen met een eigen stijl in de app. De bestaande feedback (doorzichtiger, achtergrond bij lijstrijen) mag blijven of vervangen worden, maar er komt geen dubbel effect dat onrustig oogt.

### C. Foto-detail

7. Tijdens links-rechts swipen vervaagt het informatieblok mee met de swipe, en is na de swipe weer volledig zichtbaar met de gegevens van de nieuwe foto. Het fotogebied blijft vast (WP32 invariant 9 blijft gelden).

### D. Verschijnen

8. **Meldingen** (fout, info, gelukt) faden kort in in plaats van ineens te verschijnen. WP32 C5 blijft gelden: een melding die verschijnt terwijl het toetsenbord open is, komt in beeld.
9. **Tegels en lijst-items** faden kort in als hun gegevens binnenkomen. Niet opnieuw bij terugscrollen, bij het hergebruiken van een rij of bij een live update van dezelfde gegevens.

### E. Haptics

10. Een lichte tik op het toestel bij:
    - een tik op de Home-knop die naar een ander scherm gaat;
    - een gelukte verzending (uitnodiging, foto's toegevoegd);
    - een bevestigde verwijdering.

    Geen tik bij fouten, bij gewoon navigeren of bij elke knop. A inventariseert de plekken; twijfelgevallen gaan naar regie. iOS-instellingen voor trillen gaan altijd voor.

### F. Overal

11. **"Beperk beweging"** (iOS Toegankelijkheid) aan: geen parallax, zoom, stretch, schaal of fade uit dit WP. Alles staat dan direct in de eindstand. Haptics blijven.
12. **Nooit trager:** een animatie houdt geen tik, navigatie of invoer op. Scrollen blijft vloeiend, ook op de kleinste iPhone. Duur kort (indrukken ±100 ms, verschijnen ±200 ms).
13. **Menu's blijven de standaardmenu's van iOS** (die animeren zelf en werken met VoiceOver). Het v1-fotomenu wordt niet nagebouwd.
14. **VoiceOver** leest en bedient alles zoals nu: animaties veranderen geen labels, volgorde of focus.

## Edge cases + scope-uitsluitingen

- **In scope**: donkere modus, grote tekst (de kop groeit mee, WP17a), landschap op iPad (kop beweegt hetzelfde, of staat stil als dat rustiger is: B kiest en meldt).
- **Bewust niet**:
  - het v1-fotomenu en het landschap-navigatiemenu (invariant 13);
  - draaiende camera-knoppen, 3D-flip bij bewerken en het glanslicht in de laadbalk uit v1;
  - pull-to-refresh (de gegevens zijn live);
  - schermovergangen: de standaard van iOS blijft;
  - backend-wijzigingen. Blijkt er toch een nodig: stop en meld aan regie.

## Risico-assessment

- **security/privacy**: geen.
- **ops**: laag. Wel een nieuwe native module voor haptics; die zit pas in een nieuwe build (die komt er toch).
- **external deps**: laag. Eén nieuwe dependency voor haptics, in de versie die bij de Expo-SDK hoort ([`WP30-afhankelijkheden.md`](./WP30-afhankelijkheden.md)). Reanimated en gesture-handler zitten er al in.
- **multi-user/concurrency**: geen.
- **data/schema-evolutie**: geen.
- **ops-runbook-impact**: geen env-vars of dashboard-config. Na deze WP de cutover-build (draaiboek T-4, *Cutover-build*). Er zijn deze maand nog 2 EAS-builds: één testbuild tegen dev en de cutover-build.

## Cross-refs

- Groepspagina en kop: `app/src/screens/GroupScreen.tsx`, `GroupParts.tsx`; album: `app/src/screens/AlbumScreen.tsx`; foto-detail: `PhotoDetailScreen.tsx`, `MyPhotoDetailScreen.tsx`; knoppen en meldingen: `app/src/components/`.
- WP32 (fotogebied, toetsenbord): [`WP32-thuisgroep-ui-fixes.md`](./WP32-thuisgroep-ui-fixes.md).
- Design: `docs/design.md`.

## Acceptance — hoe weten we dat het klaar is

- Tests (pure logica, A kiest de grens): bijvoorbeeld het verloop van de kop als functie van de scrollpositie, en dat "Beperk beweging" elke animatie op de eindstand zet.
- B kijkt in de iOS-simulator: elke invariant, ook met "Beperk beweging" aan, met grote tekst en in donkere modus.
- Empirische gate (Wouter, TestFlight-build tegen dev): dezelfde punten op een toestel, de haptics, en of het geheel subtiel genoeg is.

---

## Spec-criticus aanvullingen (A vult in)

Bronnen: de oude app (`components/GroupHeaderNew.jsx`, `screens/Group.jsx`, `screens/AlbumPhotos.jsx`, `components/GroupCard.jsx`, `AlbumCard.jsx`, `MovieCard.jsx`, `PhotoCard.jsx`, `fields/Button*.jsx`, `screens/PhotoDetail.jsx`, `ErrorModal.jsx`) en de huidige `app/`.

### Pariteit oude app

| Oud | WP33 |
|---|---|
| Groepskop: zakt met halve snelheid weg, cover zoomt van 2× naar 1×, tekst vervaagt en krimpt naar 0,8 | Invariant 1, rustiger (zoom rond 1,15×) |
| Groepskop klikt na het scrollen open of dicht | Niet (invariant 4) |
| Groepskop liggend: smalle vaste balk, beweegt niet | Landschap: B kiest (scope) |
| Album: cover scrolt gewoon mee, geen parallax; na 96 pt verschijnt een balk | Album krijgt dezelfde kop-beweging als de groep (nieuw) |
| Tegels groep, album en film: cover zoomt naar 1,1× in 300 ms bij indrukken | De tegel krimpt en de cover zoomt erin, ook de filmkaart (B1, besluit 5) |
| Fototegel in het raster: geen indruk-animatie | Krimpt en wordt donkerder (B2, besluit 5): nieuw |
| Knoppen: *groeien* naar 1,05× in 100 ms | Krimpen (invariant 6): bewuste afwijking |
| Foto-detail: informatieblok vervaagt naar 0 halverwege de swipe; de gegevens wisselen precies daar | Invariant 7 en C1 |
| Meldingen: een modaal zonder animatie | Invariant 8 (meldingen staan in v2 in het scherm) |
| Lijsten faden niet in; geen haptics | Nieuw (invarianten 9 en 10) |

### Wat v2 anders heeft dan v1 (gevolgen voor de spec)

- **Geen tekst in de kop.** In v2 staan naam, omschrijving en jaar *onder* de kop, in de inhoud. In de kop zitten alleen de cover, of zonder cover de letter-tegel, en op het album de terugknop-pil. "Naam en tekst in de kop" (invariant 1) betekent dus: de letter-tegel en de pil. Wat onder de kop staat, scrolt gewoon mee.
- **Geen navigatiebalk** op Groep en Album. "Onder de navigatie" (invariant 1) is daar alleen de statusbalk.
- **Tegels zijn rijen.** *Mijn groepen*, de albums op de groepspagina en de films zijn kaarten met een kleine cover links, tekst en een pijl. De kaart licht nu op bij indrukken.
- **Het foto-detail wisselt de gegevens pas als de swipe stilstaat.** Ook de titel in de navigatiebalk (de datum) wisselt dan.
- **Meldingen** zijn één component (`Notice`), soort fout of gelukt. Een aparte soort "info" bestaat niet. De melding onder een foto na een actie is ook een `Notice`.

### Kop (A)

- **A1. Wat er beweegt.** De cover (of het verloop zonder cover) beweegt langzamer omhoog dan de inhoud, maar beweegt wel: de kop blijft niet stilstaan. De inhoud onder de kop schuift óver de kop: nooit staat tekst van de inhoud op de foto, en tussen kop en inhoud valt geen gat.
- **A2. Weg vóór de statusbalk.** De letter-tegel en de pil volgen de kop. Elk zichtbaar deel is volledig vervaagd voordat de bovenkant ervan onder de statusbalk komt. De pil zit vlak onder de statusbalk en vervaagt dus al na een paar punten scrollen. Dat is de bedoeling.
- **A3. Een onzichtbare knop doet niets onverwachts.** Een tik op een plek waar de pil vervaagd is, gaat niet terug. VoiceOver bedient de pil zoals nu (invariant 14).
- **A4. Trekken.** Bovenaan omlaag trekken: de cover blijft aan de bovenkant van het scherm vast en wordt hoger, tot aan de inhoud. De letter-tegel en de pil vervagen niet en krimpen niet.
- **A5. Grote tekst.** De kop wordt hoger (gemeten, WP17a). Alle regels hierboven gelden voor die gemeten hoogte.
- **A6. Ook de andere toestanden.** De kop van "geen lid", "laden lukt niet", "Bezig…" en het laden van het album beweegt mee zoals de kop zonder cover. Een cover die niet laadt (verloop met letter als terugval) gedraagt zich als "zonder cover": geen zoom.
- Andere koppen (inloggen, de uitnodiging met cover) bewegen niet: niet in scope.

### Indrukken (B)

- **B1. Tegels met een cover (invariant 5, besluit 5)**: de groepskaart op *Mijn groepen*, de albumrij op de groepspagina en de filmkaart. De hele kaart krimpt en wordt iets donkerder; de kleine cover zoomt daarbinnen in, binnen zijn afgeronde vak. Een letter-tegel zonder cover zoomt net zo. Het donkerder worden vervangt het oplichten van de kaart van nu: geen dubbel effect.
- **B2. Foto-tegels (besluit 5)**: de tegels in het fotoraster van het album en van *Mijn foto's* (de enige foto-tegels waarop je tikt). De hele tegel krimpt en wordt iets donkerder, zonder zoom erin. Dat vervangt het doorzichtiger worden van nu. Ook tijdens selecteren en bij lang drukken (de tegel veert terug bij loslaten, ook als het menu opent). "Opnieuw laden" op een foto-tegel in het raster reageert als de tegel. Niet: foto's op de kaart, de duimpjes bij Toevoegen, gemelde foto's, covers in een kop (geen tegels, of niet om op te tikken).
- **B3. Knoppen (invariant 6, besluit 5).** Inventaris:

| Krimpen | Blijft zoals nu (alleen dimmen of oplichten) |
|---|---|
| `Button` (hoofdknop en tweede knop), `SmallButton`, de terugknop-pil, de stemknop bij een idee, de +-knop in de tabbalk | Tekstknoppen: `LinkButton`, "Sluiten" en "Annuleren" in een modaal, "Acties" in de navigatiebalk |
| | Lijstrijen: `ListRow`, leden, uitnodigingen, de albumkeuze bij Toevoegen |
| | De gewone tabs in de tabbalk en `SegmentedTabs` (iOS schaalt die ook niet) |
| | "Opnieuw laden" buiten het raster, de zoombare foto in het detail |

  Knoppen worden niet donkerder: alleen krimpen, zoals iOS. Met "Beperk beweging" dimmen ze zoals nu.
- **B4. Uit, bezig, geannuleerd.** Een uitgeschakelde of bezige knop krimpt niet. Begint de user te scrollen met de vinger op een tegel of knop, dan veert die terug en gebeurt er niets. Komt de user terug op een scherm, dan staat geen tegel of knop nog half ingedrukt.
- **B5. Nooit later.** De actie gebeurt bij loslaten, zoals nu. Een tik wacht niet tot een animatie klaar is.
- **B6. Een snelle tik is zichtbaar (besluit 5).** Indrukken gaat in en terug in samen rond 150 ms. Laat de vinger los voordat de tegel of knop helemaal ingedrukt is, dan gaat hij eerst door tot de eindstand en veert dan terug. Wie langer drukt, ziet hem pas terugveren bij loslaten. Het donkerder worden loopt mee met de schaal. Opent de tik een ander scherm, dan speelt de animatie gewoon af onder de overgang; komt de user terug, dan staat er niets half ingedrukt (B4).
- **B7. Maten (A kiest de grens, zie de tests).** Knoppen en tegels krimpen tot tussen 0,92 en 0,96. De cover in een tegel zoomt tot tussen 1,1 en 1,2 (nu 1,06). Een tegel wordt donkerder met een donkere laag van 8 tot 20 % dekking. In plus terug samen 120 tot 200 ms.

### Foto-detail (C)

- **C1. Gegevens wisselen als het blok onzichtbaar is.** Tijdens het swipen toont het informatieblok nooit zichtbaar gegevens van een foto die niet (bijna) in beeld is. Het blok is helemaal vervaagd op het moment dat de gegevens wisselen. Na de swipe komt het blok terug met de nieuwe gegevens, zonder sprong van onzichtbaar naar zichtbaar. Zo deed v1 het ook: de gegevens wisselden halverwege, waar het blok onzichtbaar was.
- **C2. Swipe teruggedraaid.** Laat de user de foto terugveren, dan komt het blok terug zoals het was (of, als het halverwege al gewisseld was, wisselt het onzichtbaar terug).
- **C3. Eerste en laatste foto.** Voorbij de rand trekken (geen volgende foto) laat het blok staan.
- **C4. Wat er verder wisselt.** De titel (datum) in de navigatiebalk en het menu "Acties" mogen wisselen als de swipe stilstaat, zoals nu. B meldt het als titel en blok merkbaar uit de pas lopen.
- **C5. Beide detailschermen**: album en *Mijn foto's*. De melding na een actie onder de foto verdwijnt na een swipe, zoals nu. Het fotogebied verandert niet (WP32 invariant 9): vervagen verandert de maat van het blok niet.

### Verschijnen (D)

- **D1. Alleen doorzichtigheid.** Meldingen, tegels en rijen faden in zonder te verschuiven of te groeien. Plek en maat staan meteen goed. Anders meet de toetsenbord-logica van WP32 een tussenstand en komt de melding niet in beeld (invariant 8, WP32 C5).
- **D2. Welke meldingen.** Elke `Notice`: fouten en "gelukt", ook de melding onder een foto, de fout bij laden met "Opnieuw" en "geen lid". Verdwijnt een melding en komt hij na een nieuwe poging terug (ook met dezelfde tekst), dan fadet hij opnieuw in. Verandert de tekst terwijl hij in beeld blijft, dan fadet hij niet opnieuw. VoiceOver leest hem meteen voor, niet pas na de fade.
- **D3. Welke lijsten.** *Mijn groepen*, de albums, leden en films van een groep, uitnodigingen (ontvangen en verstuurd), ideeën en problemen, gemelde foto's. Niet: het fotoraster in het album en in *Mijn foto's*. Daar fadet elke foto al in (150 ms) en het raster kan honderden tegels hebben (vloeiend op de kleinste iPhone, invariant 12).
- **D4. Wat "binnenkomen" is.** Een tegel of rij fadet in als zijn gegevens binnenkomen terwijl het scherm openstaat: na het laden, of een nieuw item via een live update (een nieuw album van een ander lid). Niet: een item dat er al was en alleen verandert (andere naam, teller), een item dat al getoond werd bij het openen van het scherm, terugscrollen, of een rij die opnieuw wordt gebruikt. Hoe B dat bijhoudt: zie de tests (`newlyArrived`).
- **D5. De cover in een tegel** heeft een eigen query en eigen fade. Dat mag na de fade van de kaart komen. Geen tweede fade van de kaart als de cover binnenkomt.

### Haptics (E): inventaris

Regel: een tik precies wanneer de groene melding of de bestemming verschijnt, nooit bij een rode. Niet bij het bevestigen zelf (de actie kan nog mislukken). De tik houdt niets op: de app wacht er niet op.

| Plek | Tik |
|---|---|
| Home-knop met een bestemming (WP32 `homeButton`, doel niet "geen"). Op *Mijn groepen* zelf doet Home niets: geen tik | ja |
| Uitnodiging(en) versturen: de groene melding "… verstuurd" verschijnt, ook als andere rijen mislukten | ja |
| Foto's toevoegen: de groene melding "… toegevoegd aan …" (alle foto's in het album). Deels mislukt: alleen de rode melding, geen tik. Daarna "Opnieuw" en alles gelukt: tik | ja |
| Foto verwijderen (menu en selectie; deels mislukt: geen tik), album verwijderen, groep verwijderen | ja |
| Account verwijderen: als het scherm "Je account is verwijderd" verschijnt | ja |
| Webmaster: gemelde foto verwijderen, idee of probleem verwijderen | ja |
| Twijfel, met een rode bevestigingsknop: uit het album halen, lid uit de groep halen, groep verlaten, uitnodiging intrekken, uitnodiging afwijzen, cover weghalen, profielfoto weghalen, locatie weghalen, foto melden | vraag 2 |
| Twijfel, een verzending zonder bevestiging: idee of probleem doorgeven, bezwaar maken | vraag 3 |
| Al het andere (opslaan, inloggen, delen, groep of album maken, accepteren, gewone tabs, fouten) | nee |

- **E1. Toestellen zonder haptics** (iPad, de simulator) of met trillen uit in iOS: niets, geen fout, geen melding. B kan de tik niet in de simulator controleren; dat doet Wouter op het toestel.

### Overal (F)

- **F1. "Beperk beweging" live.** Zet de user het aan of uit terwijl de app openstaat, dan geldt het meteen of uiterlijk zodra hij terug is in de app. Geen herstart nodig. Let op: niet elke manier om de instelling te lezen geeft een wijziging door.
- **F2. Eindstand bij "Beperk beweging"** is het gedrag van nu: de kop scrolt gewoon mee, de cover op 1×, de letter-tegel en de pil zonder vervagen. Knoppen en tegels zonder schaal en zonder wachten op de eindstand. Knoppen dimmen zoals nu; tegels worden net zo donkerder als zonder "Beperk beweging", meteen. Meldingen, tegels en rijen meteen zichtbaar. Het informatieblok blijft zichtbaar tijdens het swipen. De bestaande fade van 150 ms bij het laden van een foto valt buiten dit WP en blijft.
- **F3. Vloeiend.** De kop volgt het scrollen elk frame, ook op de kleinste iPhone. Een kop die achterloopt of schokt telt als "trager" (invariant 12). Dat geldt ook voor het vervagen van het informatieblok.
- **F4. Dezelfde maten overal.** Eén schaal voor knoppen, één voor tegels, één zoom voor de cover, één donkerte voor tegels, één duur voor indrukken en één voor verschijnen. Alle animaties uit dit WP halen hun waarden uit één plek, ook de uitzondering bij "Beperk beweging". Zo regelen de tests het in één keer.

### Tests (A kiest de grens)

`app/tests/motion.test.ts`, voor een nieuwe `app/src/lib/motion.ts`. Pure functies, geen React Native:
- de kop als functie van de scrollpositie, de gemeten hoogte en de statusbalk: waar de cover staat, hoe hoog en hoe ver ingezoomd (A1, A4, A5, invarianten 1–3);
- vervagen en krimpen van een element in de kop (A2, A4);
- de doorzichtigheid van het informatieblok tijdens het swipen (invariant 7, C1–C3);
- de waarden voor indrukken en verschijnen (invarianten 5, 6, 8, 9 en 12, F4, besluit 5);
- het terugveren na een snelle tik (B6);
- "Beperk beweging" zet alles op de eindstand (invariant 11, F2);
- welke items nieuw binnenkomen (D4).

Niet getest (simulator en toestel): de plekken van de haptics, welke knoppen krimpen, VoiceOver, en of het geheel subtiel genoeg is.

### Open vragen aan regie

1. **Trekken met "Beperk beweging".** Invariant 11 zegt "geen stretch", invariant 2 "geen lege rand boven de cover". Met "Beperk beweging" aan en zonder stretch ziet de user bij trekken weer de lege band van nu. Advies: de stretch blijft ook dan. Hij volgt de vinger en is geen animatie (Apple zet bij "Beperk beweging" vooral parallax, zoom en schuiven uit). De tests volgen het advies, in een eigen `describe`.
2. **Tik bij de twijfel-verwijderingen** (tabel E). (a) Bij elke actie met een rode bevestigingsknop die lukt. (b) Alleen als er echt iets weg is (de rijen "ja"). Advies: (a). Eén regel die de user kan voelen: rood bevestigd, tik.
3. **Tik bij een andere verzending** (idee of probleem doorgeven, bezwaar). Advies: nee. Invariant 10 noemt alleen uitnodigingen en foto's, en zo blijft de tik zeldzaam.

### Besluiten Wouter 2026-11-18 (regie)

1. **Stretch blijft bij "Beperk beweging"**: hij volgt de vinger en is geen animatie (advies A).
2. **Tik bij elke gelukte actie met een rode bevestigingsknop** (optie a).
3. **Geen tik bij andere verzendingen** (idee, probleem, bezwaar).
4. **Na de audit:** B fixt (1) dat de terugpil op Album met VoiceOver aan niet vervaagt (invariant 14), en (2) dat de eerste swipe in het foto-detail rekent vanaf de echte startpositie (C1). (3) Bij "cover weghalen" geen tik: die actie heeft geen rode knop (besluit 2).
5. **Na de gate (2026-11-18): indrukken te zwak.** Op het toestel was bij knoppen en tegels geen animatie te zien, en foto-tegels hadden er geen. Aangepast (wijzigt invariant 5 en 6):
   - **Alle tegels**, ook foto-tegels in een album en in *Mijn foto's*: de hele tegel krimpt duidelijk (rond 0,94×) en wordt iets donkerder. Bij groeps- en albumtegels zoomt de cover daarbinnen duidelijker in dan nu.
   - **Knoppen** krimpen duidelijker (rond 0,94×).
   - **Een snelle tik speelt de animatie altijd zichtbaar af** (in en terug, rond 150 ms), ook als de vinger al los is voordat de eindstand bereikt is. De actie of navigatie wacht daar niet op (invariant 12 blijft).
   - "Beperk beweging": zoals nu (geen schaal, wel dimmen).
