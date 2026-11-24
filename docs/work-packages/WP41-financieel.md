# WP41: Financieel (Geld)

> Draft van regie, 2026-11-23. A vult onderaan aan.

## Productdoel

Een lid opent in zijn groep de tab **Geld** en ziet per afrekening uit het clubboek (nu alleen "Lustrum Nepal") de totalen, wat elke deelnemer nog betaalt of terugkrijgt, de hele tabel en per deelnemer waarom. Wouter zet een afrekening met één knop in het clubboek in de app.

Ontwerp: [`WP41-mockup.html`](./WP41-mockup.html), goedgekeurd door Wouter op 2026-11-23. De namen en bedragen daarin zijn verzonnen.

## Besluiten (Wouter, 2026-11-23)

1. De tab heet **Geld**: "Financieel" past niet als vierde tab op een iPhone.
2. Elk groepslid ziet de hele afrekening: alle deelnemers en alle bedragen.
3. Er is geen koppeling tussen een lid in het clubboek en een gebruiker in de app. De app schrijft daarom in de derde persoon: "Maarten betaalt nog", niet "Je betaalt nog".
4. Het clubboek blijft dicht (alleen 127.0.0.1). Het clubboek stuurt, Convex haalt nooit iets op.
5. In de app pas je niets aan. Opnieuw sturen vervangt de afrekening.
6. Op de schermen staat geen uitlegtekst: alleen titels, bedragen en de knoppen om verder te gaan.

## Invarianten

1. Alleen een lid van de groep leest de afrekeningen van die groep. Wie geen lid is, of een onbekend id geeft, krijgt dezelfde weigering `NOT_MEMBER`, zoals bij albums. Zo verraadt de weigering niet of een afrekening bestaat.
2. Schrijven en weghalen kan alleen met het geheim van het clubboek, via één HTTP-route. Een functie die een gebruiker in de app kan aanroepen, schrijft nooit in de afrekeningen.
3. Het geheim hoort bij één groep, en die groep staat op de deployment, niet in het verzoek. Lekt het geheim, dan kan iemand alleen die groep beschrijven.
4. Het geheim wordt vergeleken in constante tijd. Er is één weigering voor elke oorzaak: geen geheim op de deployment, geen groep op de deployment, een fout geheim of een ontbrekend geheim. Het geheim komt nooit in een antwoord, een fout of een log.
5. Een afrekening heeft een vaste sleutel: het id van het evenement in het clubboek. Opnieuw sturen met dezelfde sleutel vervangt de afrekening (upsert), dus er komt nooit een dubbele regel in de tijdlijn.
6. Bedragen zijn hele centen (gehele getallen), geen kommagetallen. Een datum is een ISO-datum (`jjjj-mm-dd`). Elk verzoek wordt in zijn geheel gecontroleerd op vorm en grootte. Bij een fout wordt er niets geschreven.
7. In de app is een bedrag hetzelfde als in het clubboek: dezelfde som, hetzelfde teken, op de cent.
8. De tab Geld staat er alleen als de groep minstens één afrekening heeft, net als de tab Films.
9. Wordt de groep verwijderd, dan verdwijnen de afrekeningen mee. Daarna wijst niets meer naar die groep.

## Gegevens en functies

### De tabel `settlements`

Eén rij per afrekening. De velden:

- `groupId`
- `key`: het id van het evenement in het clubboek, als tekst
- de kop van de afrekening: de naam, de periode als tekst, de startdatum (voor het jaar en de volgorde in de tijdlijn), de afrekendatum, de datum van de versie ("Stand van") en of het een lustrum is
- `parts`: per onderdeel de naam, de kosten, het aantal deelnemers en de prijs per persoon (die kan leeg zijn)
- `rows`: per deelnemer:
  - de korte naam
  - kosten, bijdrage uit clubkas, uit spaarpot, spaarpot vóór en na, voorgeschoten, afrekening (positief: betaalt bij; negatief: krijgt terug), nog open, en of het afgerond is
  - `cells`: één cel per onderdeel; een cel kan leeg zijn
  - de regels van zijn kosten, met een grondslag als tekst
  - zijn betalingen
  - zijn spaarpot: regels met een datum, een omschrijving en een bedrag, en waar het om maandinleg gaat de maanden
- de totalen, zoals de voettekst van de tabel in het clubboek
- `receivedAt`

Er komt geen intern id van een lid uit het clubboek in. Indexen: `by_group` en `by_group_key`. A legt de precieze validator vast: getypt, zonder `v.any()`, met een grens op het aantal deelnemers, onderdelen en regels en op de lengte van teksten. De vorm staat in §A2 (het verzoek), de grenzen in §A3.

### Lezen (publieke queries, met een veld-whitelist zoals in WP23)

- `settlements.listByGroup({ groupId })`: de tijdlijn. Per afrekening: id, naam, periode, startdatum, aantal deelnemers en aantal nog open. Ook de bron voor besluit 8.
- `settlements.get({ settlementId })`: de hele afrekening voor het overzicht, de tabel en de deelnemer. Zonder `groupId`-lek naar wie geen lid is (invariant 1).

### Schrijven (alleen het clubboek)

- `POST /settlements`: de header `X-Clubboek-Secret: <geheim>` (fix-cyclus 1, besluit F1), en als body de afrekening in de vorm hierboven, met `key`. Het antwoord is 200 met het aantal deelnemers, of één weigering. Statussen en volgorde van de controles: §A4.
- `DELETE /settlements?key=…`: haalt die afrekening weg. Bestaat de sleutel niet, dan is het antwoord hetzelfde als na weghalen. Precies: §A5.
- Beide routes roepen een interne mutation aan. Er zit een grens op de grootte van de body. Geen CORS: deze routes zijn niet voor een browser.
- De vergelijking in constante tijd komt uit `lib/testGate.ts` en gaat naar een gedeelde helper. Gedrag van WP26 verandert niet.

## Schermen (app en webapp, dezelfde Expo-code)

1. **Groep → Geld**: een vierde tab na Leden, alleen bij besluit 8. In de tab staat de tijdlijn per jaar, met dezelfde jaarkop als de albums. Per afrekening een kaart met een tegel, de naam, de periode met het aantal deelnemers, en een label "x van y nog open" of "Afgerond". Tik op de kaart en het overzicht opent.
2. **Afrekening**:
   - bovenaan de naam, de periode en "Stand van <datum>";
   - de tegels Totale kosten (met het bedrag per persoon), Uit spaarpotten (alleen bij een lustrum), Bijdrage uit clubkas (alleen als die er is) en Nog te betalen;
   - de lijst Deelnemers: per regel de naam, de status ("Afgerond", "Nog € x", "Krijgt nog € x") en rechts de afrekening. Rood is bijbetalen, groen is terugkrijgen, grijs is afgerond;
   - de lijst Per onderdeel;
   - onderaan de knop "Bekijk de hele tabel".
3. **De hele tabel**: dezelfde kolommen als in het clubboek. De namen blijven staan en de rest veegt opzij. Onderaan staat een totaalrij. Kolommen zonder inhoud (clubkas, voorgeschoten) verdwijnen, zoals in het clubboek.
4. **Eén deelnemer**: de naam en de uitkomst in één regel ("Betaalt nog € x", "Krijgt nog € x terug", "Afgerond", of "Zijn deel komt helemaal uit zijn spaarpot"). Daaronder drie blokken: 1. Kosten, 2. Spaarpot (alleen bij een lustrum; de maandinleg ingeklapt in één regel) en 3. Afrekening, met de betalingen.

Verder:
- Routes onder de groep, zoals album en film.
- Een breed scherm (web, iPad liggend) gebruikt `WideSplit`, net als Groep. Daar staat de hele tabel zonder vegen.
- De teksten volgen de lettergrootte van iOS. Een bedrag breekt nooit midden in een getal.
- De opmaak van bedragen in het Nederlands (`€ 1.234,56`) zit in pure logica, met tests.
- Op het web werkt alles, want er valt niets te wijzigen.

## De knop in het clubboek

- Op de overzichtspagina van een evenement (`evenement_overzicht.html`), naast "Publiceren": de knop **Zet in de app**.
- De knop stuurt de gekozen gepubliceerde versie, nooit het concept. Bij "Concept" is de knop uit.
- Ernaast staat een kleine knop **Haal uit de app**.
- Het clubboek zet de versie om naar de vorm van invariant 6: Decimal naar centen, het interne id van een lid weg.
- Na het sturen een melding met de uitkomst ("In de app gezet: versie van 21-11-2026", of de fout), zoals bij Publiceren.
- De instellingen staan in een lokaal bestand naast het clubboek: de URL van de Convex-site en het geheim. Wouter vult ze zelf in. Ze staan niet in de code.
- **Stand naast de knop (besluit Wouter 2026-11-24):** het clubboek onthoudt na een gelukte verzending welke versie het stuurde en wanneer, en toont dat naast de knop: "In de app: versie van 21-11-2026, gezet op 24-11-2026", met " · er is een nieuwere versie" erachter als er later gepubliceerd is, of "Niet in de app" (nog nooit gestuurd, of weggehaald). Alleen lokaal in het clubboek; Convex wordt er niet voor gevraagd.
- **Publiceren en Zet in de app blijven twee knoppen** (besluit Wouter 2026-11-24): publiceren blijft lokaal.
- Het clubboek heeft sinds 2026-11-24 git (eigen repo). B bouwt in een eigen worktree (`~/clubboek-wp41`, branch `app-knop` vanaf `main`), zodat het draaiende clubboek ongemoeid blijft, en schrijft tests in `boek/tests.py`.

## Edge cases en scope

- **In scope**: de tabel, de twee queries, de twee routes, de cascade bij het verwijderen van een groep, de controle in MON1 (WP10) op `settlements.groupId`, de vier schermen, de knop in het clubboek en de runbook-entry.
- **Bewust niet**:
  - een koppeling tussen een lid en een gebruiker, en een "jij"-weergave (besluit 3);
  - betalen vanuit de app;
  - meldingen bij een nieuwe afrekening;
  - meerdere versies in de app bewaren (alleen de laatste);
  - andere evenementen dan het lustrum: die werken als de vorm past, maar ze worden nu niet apart getest.
- Een afrekening met nul deelnemers wordt geweigerd.
- Iemand die uit de groep gaat, verliest meteen de toegang (de live query weigert).
- Zie je de afrekening terwijl hij opnieuw binnenkomt, dan ververst het scherm live. Zonder flits naar laden.

## Risico-assessment

- **security/privacy: hoog.** Er komt een nieuwe schrijfweg van buiten met een geheim, en wie lid is ziet de bedragen en spaarpotten van iedereen. Toegangsdefinitie volgens [`work-package-specs.md` §Toegangsdefinities](../conventions/work-package-specs.md), met een inventaristest van de publieke paden die een `settlements`-id aannemen. Red-team op de twee routes en de twee reads.
- **ops: medium.** Er komen twee env-vars per deployment, plus een lokaal configuratiebestand van het clubboek.
- **external deps: laag.** Alleen het eigen clubboek, en dat stuurt naar buiten.
- **multi-user/concurrency: laag.** Er is één schrijver, en een upsert per sleutel.
- **data/schema-evolutie: laag.** Het is een nieuwe, lege tabel; er hoeft niets gemigreerd te worden. Wel is de vorm van het verzoek een contract tussen twee codebases. A pint die met een voorbeeld vol verzonnen gegevens.
- **ops-runbook-impact**: een nieuwe sectie "Clubboek → Geld (WP41)" in [`external-services.md`](../conventions/external-services.md):
  - `FINANCE_SECRET`: 32 bytes hex, per deployment een eigen waarde.
  - `FINANCE_GROUP_ID`: het id van de groep op die deployment.
  - Ontbreekt een van de twee, dan weigert de route (fail-closed, geen standaardwaarde).
  - Verder in die sectie: roteren, en waar de waarden in het clubboek staan.
- **kosten: € 0.** Het past in het huidige Convex-plan.

## Cross-refs

- cascade-matrix: een nieuwe rij G6 (groep weg → afrekeningen weg) in `deleteGroupCascade`
- WP10 (MON1): een FK-controle op `settlements.groupId`
- WP23: de veld-whitelist op de reads
- WP26: het patroon voor het geheim (vergelijken in constante tijd, één weigering)
- WP21 en WP38: de tab Films als voorbeeld voor een tab die alleen bij inhoud verschijnt
- Clubboek (buiten de repo, alleen-lezen voor A): `~/clubboek/boek/services/evenementen.py` (`overzicht`, `publiceer`, `_uit_data`), `views_evenementen.py` (`overzicht`, `overzicht_lid`) en de templates `evenement_overzicht.html` en `evenement_lid.html`
- Oude AWS-code: niet van toepassing; dit is nieuw

## Acceptance

- **Tests backend:**
  - lezen: lid ja, geen lid of onbekend id `NOT_MEMBER`, en de whitelist;
  - schrijven: elk weigerpad geeft dezelfde weigering, een upsert per sleutel, weghalen, de vorm- en groottegrenzen, en geen lek van het geheim;
  - de cascade, MON1 en de inventaristest.
- **Tests app:** de pure logica: de opmaak van bedragen, de tijdlijn per jaar, de status per deelnemer en welke kolommen te zien zijn.
- **Tests clubboek:** de omzetting van een gepubliceerde versie naar het verzoek (centen, geen id), en de knop die uit staat bij het concept.
- **Gate (Wouter, op dev):**
  - in het clubboek op Zet in de app drukken, met dev als doel;
  - in de simulator en de webapp alle vier de schermen;
  - de bedragen vergelijken met de overzichtspagina van het clubboek;
  - een account dat geen lid is, ziet geen tab en krijgt geen gegevens;
  - opnieuw sturen vervangt de afrekening;
  - Haal uit de app laat de tab verdwijnen.
- **Prod:** pas na de gate, via de normale release. Regie deployt nooit naar prod.

---

## Spec-criticus aanvullingen (A vult in)

> A, 2026-11-24. Er is geen oude AWS-code voor dit onderwerp. De bron is het clubboek: `overzicht()`, `publiceer()`, `_als_data()` en `spaarpot_opbouw()` in `boek/services/evenementen.py`, de views `overzicht` en `overzicht_lid`, en de twee templates. Namen van velden, functies en modules hieronder zijn A-keuzes; hoe B ze bouwt is aan B.

### A1. Wat het clubboek echt oplevert (en wat dat betekent)

Een gepubliceerde versie (`Publicatie.data`) is `overzicht(ev)` door de JSON-encoder van Django gehaald. Wat dat inhoudt voor het contract:

- **Bedragen zijn tekst met een Decimal erin**, niet altijd op de cent. De meeste rijwaarden zijn al op centen afgerond (`r2`). Drie soorten niet: `cellen` en `delen[].bedrag` (zonder "centen verdelen" is een deel `aantal × prijs`, onafgerond) en `onderdelen[].prijs` (altijd `kosten / n`, bv. `"33.33333333333333333333333333"`). Er komt ook `"-0.00"` voor: `bij` van iemand wiens deel precies uit zijn spaarpot komt.
- **Het clubboek toont een bedrag via het filter `euro`**: `Decimal.quantize(0.01)` met de standaardcontext, dus *half-even* (`0,125` wordt `0,12`). Invariant 7 betekent daarom: elk bedrag in het verzoek is het bedrag uit de versie, op dezelfde manier op centen afgerond als het clubboek het toont. De omzetting naar centen gebeurt in het clubboek, één keer, per waarde; de app en Convex ronden niets meer af.
- **Tekens zijn niet overal gelijk.** In `overzicht()` is `kosten` positief, maar `cellen` zijn negatief (`-eigen deel`). In het contract is een kost altijd positief (A-keuze 1): het clubboek draait het teken van een cel om. `bij` > 0 is bijbetalen, < 0 is terugkrijgen; dat blijft zo (`balance`). `nog` is nooit negatief.
- **Totalen zijn sommen van de rijwaarden**, en die zijn op de cent. Zo staan ze in de voettekst. Uitzondering: de voettekst per onderdeel is de kosten van het onderdeel (`onderdelen[].kosten`), niet de som van de cellen. Die twee verschillen met een cent als de delen niet op centen verdeeld zijn (zie de fixture `weekend`).
- **Niet in `overzicht()`**: de startdatum van het evenement en de datum van de versie. Die komen van `Publicatie.evenement.startdatum` en `Publicatie.datum`. De sleutel is `str(Evenement.pk)`.
- **Afgeleid, dus niet meesturen**: `afgerond` (in `overzicht()` precies `nog == 0`, want elke rij doet mee), `betaald` (som van de betalingen), `terug` (`-bij` als `bij` < 0), `n`, `n_open`, `met_club`, `met_voorgeschoten`, `onderdelen_totaal` (in geen template gebruikt). Minder velden is minder kans dat twee bronnen elkaar tegenspreken.
- **Privé, dus nooit meesturen**: `lid_id`. De korte naam (`Lid.naam`) is in het clubboek uniek; die is de sleutel van een deelnemer in de app.

### A2. Het verzoek (`POST /settlements`), het contract

Een JSON-object. Elk veld is verplicht aanwezig; "of null" betekent dat `null` mag, niet dat het veld mag ontbreken. Een veld dat hier niet staat, waar dan ook in het object, maakt het verzoek ongeldig (zo kan een vergeten `lid_id` nooit binnenkomen). Bedragen zijn hele centen (JSON-getal zonder breuk). Datums zijn `jjjj-mm-dd` en bestaan echt.

| Veld | Type | Uit het clubboek |
|---|---|---|
| `key` | tekst | `str(Evenement.pk)` |
| `name` | tekst | `naam` |
| `period` | tekst (mag leeg) | `periode`, ongewijzigd ("12 t/m 26 oktober 2026") |
| `startDate` | datum | `Evenement.startdatum` (niet in `overzicht()`) |
| `settledOn` | datum of null | `afrekendatum` |
| `publishedOn` | datum | `Publicatie.datum`: "Stand van" |
| `lustrum` | boolean | `lustrum` |
| `costPerPerson` | centen of null | `kosten_pp` |
| `parts[]` | lijst | `onderdelen`, in dezelfde volgorde |
| `parts[].name` | tekst | `naam` |
| `parts[].costs` | centen | `kosten` |
| `parts[].count` | geheel getal ≥ 0 | `n` (deelnemers met een deel) |
| `parts[].pricePerPerson` | centen of null | `prijs` (alleen bij een vinkje-onderdeel, anders null) |
| `rows[]` | lijst | `rijen`, in dezelfde volgorde |
| `rows[].name` | tekst, uniek binnen het verzoek | `lid` |
| `rows[].costs` | centen | `kosten` |
| `rows[].club` | centen | `club` |
| `rows[].fromPot` | centen | `uit_pot` (0 als het geen lustrum is) |
| `rows[].potBefore` | centen of null | `pot` (null als het geen lustrum is) |
| `rows[].potAfter` | centen of null | `pot_na` (null als het geen lustrum is) |
| `rows[].advanced` | centen | `voorgeschoten` |
| `rows[].balance` | centen | `bij`: > 0 betaalt bij, < 0 krijgt terug |
| `rows[].open` | centen ≥ 0 | `nog` |
| `rows[].cells[]` | centen of null, één per onderdeel | `cellen`, **met het teken omgedraaid** |
| `rows[].lines[]` | lijst | `delen` |
| `rows[].lines[].part` | tekst | `onderdeel` |
| `rows[].lines[].amount` | centen | `bedrag` |
| `rows[].lines[].basis` | tekst (mag leeg) | `grondslag` ("14 nacht x 38,50") |
| `rows[].payments[]` | lijst | `betalingen` |
| `rows[].payments[].date` / `.amount` | datum / centen | `datum` / `bedrag`: wat de deelnemer aan de club betaalde voor zijn naheffing, groter dan 0 (G3). Alleen bij `balance` > 0; anders leeg (F3). Samenhang met `open`: G2 |
| `rows[].savings[]` | lijst (leeg als het geen lustrum is) | `spaarpot` |
| `rows[].savings[].date` / `.description` / `.amount` | datum / tekst / centen | `datum` / `omschrijving` / `bedrag` |
| `rows[].savings[].months` | lijst van `{date, amount}` of null | `maanden` (alleen bij de maandinleg) |
| `totals` | object | `totaal` |
| `totals.costs`, `.club`, `.fromPot`, `.advanced`, `.balance`, `.open` | centen | `kosten`, `club`, `uit_pot`, `voorgeschoten`, `bij`, `nog` |
| `totals.potBefore`, `.potAfter` | centen of null | `pot`, `pot_na` (null als het geen lustrum is) |

Samenhang die Convex controleert (anders is het verzoek ongeldig):
- `rows[].cells` heeft precies zoveel plekken als `parts`.
- Bij `lustrum: true` zijn `potBefore` en `potAfter` in elke rij en in `totals` een bedrag; bij `false` zijn ze null en is `savings` leeg.
- Elk totaal in `totals` is precies de som van dat veld over de rijen. Dat geldt in het clubboek altijd (A1), dus een afwijking is een fout in de omzetting en geen afronding.
- Minstens één deelnemer (draft: nul deelnemers wordt geweigerd).
- `payments` is leeg tenzij `balance` > 0. Het clubboek vult `betalingen` alleen voor wie moet bijbetalen (`afgerond()`: `betalingen` alleen als `saldo` < 0). Wat de club aan iemand die terugkrijgt al uitbetaalde of verrekende, staat alleen in een lagere `open`; de app toont het verschil als één regel (F3, `paymentLines`).
- Tekst (F2), elk tekstveld: well-formed Unicode (geen losse surrogaathelft), geen control-tekens (U+0000–U+001F, U+007F–U+009F, dus ook geen nul-byte, tab of regeleinde) en geen bidi-override- of isolate-tekens (U+202A–U+202E, U+2066–U+2069).
- Naam van een deelnemer (F2), bovendien: niet leeg, geen witruimte aan begin of eind, niet alleen punten (`.`, `..`, `...`), geen `%` en geen `/` (de naam staat in de app-route). Uniek binnen het verzoek na NFC-normalisatie en zonder onderscheid tussen hoofd- en kleine letters (A-keuze 12: "Bram" en "bram" mogen niet allebei).

**Voorbeelden met verzonnen gegevens** staan in `tests/fixtures/wp41/` (zie de README daar): `lustrum` (8 deelnemers, 5 onderdelen, spaarpotten, één deelnemer helemaal uit zijn spaarpot met `bij = "-0.00"`, een prijs met een eindeloze breuk) en `weekend` (geen lustrum, clubbijdrage, voorgeschoten, iemand die terugkrijgt, delen niet op centen verdeeld). Per voorbeeld de versie zoals het clubboek hem bewaart (`*.publicatie.json`, met `lid_id`, Decimal als tekst) en het verzoek dat eruit moet komen (`*.request.json`). Die paren zijn het contract tussen de twee codebases.

### A3. Grenzen (A-keuze 2)

Groot genoeg voor een lustrum met marge; het voorbeeld-lustrum is compact ±9 KB.

| Wat | Grens |
|---|---|
| Body | ten hoogste 128 KiB (131 072 bytes), gemeten op de bytes, niet op de structuur |
| `key` | 1 tot 64 tekens, alleen `A–Z a–z 0–9 _ -` |
| Elke andere tekst | ten hoogste 200 tekens; `name` van de afrekening, onderdeel en deelnemer niet leeg |
| Deelnemers (`rows`) | 1 tot 100 |
| Onderdelen (`parts`) | 0 tot 50 (een evenement "club betaalt alles" heeft er geen) |
| `lines`, `payments` per deelnemer | elk ten hoogste 50 |
| `savings` per deelnemer | ten hoogste 100; `months` per regel ten hoogste 60 |
| Bedrag | geheel getal, absoluut ten hoogste 1 000 000 000 centen (€ 10 miljoen) |
| `count` | geheel getal van 0 tot 1000 |
| Afrekeningen per groep | ten hoogste 40. Een nieuwe sleutel bij 40 wordt geweigerd; een bestaande vervangen mag altijd |

Waarom de laatste: de tijdlijn leest de afrekeningen van een groep in één query. Een verzoek van 128 KiB wordt opgeslagen als een document van ongeveer 173 KB (gemeten door de red-team; getallen kosten in Convex meer ruimte dan in JSON). 40 stuks is dan ongeveer 6,6 MiB, onder de leesgrens van 16 MiB van één Convex-functie, en elk document blijft ruim onder 1 MiB. Samenvattingsvelden apart opslaan is niet nodig (F6).

### A4. `POST /settlements`: antwoorden en volgorde

1. **Eerst het geheim.** Zonder geldige toegang is het antwoord altijd dezelfde weigering: status 403, met precies dezelfde body voor elke oorzaak. Oorzaken: geen `FINANCE_SECRET` op de deployment, een `FINANCE_SECRET` korter dan 32 tekens (A-keuze 3: fail-closed op een zwak geheim), geen of een ongeldige `FINANCE_GROUP_ID`, een `FINANCE_GROUP_ID` waarvan de groep niet (meer) bestaat, geen header `X-Clubboek-Secret`, een fout geheim, een geheim dat alleen het begin of een verlengde vorm is, een geheim met `Bearer ` ervoor, en een geheim dat alleen in `Authorization` staat (ook het juiste; F1). Bij een weigering wordt de body niet beoordeeld: ook een te grote of kapotte body geeft dan 403.
2. **Dan de grootte**: groter dan 128 KiB geeft 413.
3. **Dan de vorm** (A2, A3): ongeldig geeft 400 met `{ "error": "<korte reden>" }`. De reden mag het pad van het veld noemen (`rows[3].cells`), nooit een waarde uit de body. Bij een onbekend veld is de reden `<pad>: onbekend veld`, zonder de naam van dat veld (F9). Een body die te groot én kapot is, geeft 413 (F4).
4. **Dan schrijven**, in één mutation: de rij met dezelfde `groupId` en `key` wordt vervangen, anders komt er een nieuwe. Het antwoord is 200 met `{ "participants": <aantal deelnemers> }`.

Verder:
- Bij elke 4xx wordt er niets geschreven; een bestaande afrekening met die sleutel blijft precies zoals hij was.
- **Vervangen houdt het `_id`** (A-invariant 4). Een open scherm met die afrekening ververst dan live in plaats van "geen toegang" te tonen (draft: "zonder flits naar laden"). Alles van de oude versie is weg: een deelnemer die niet meer in de nieuwe staat, staat niet meer in de app.
- De groep komt alleen uit `FINANCE_GROUP_ID`. Een veld `groupId` in de body is een onbekend veld (400).
- Het geheim, de header en de body komen niet in een log, antwoord of fout.
- Geen CORS: geen `Access-Control-*`-headers, geen OPTIONS-route. Andere methodes dan POST en DELETE op `/settlements` geven geen gegevens.

### A5. `DELETE /settlements?key=…`

- Toegang precies als A4.1 (zelfde weigering, ook bij een missende groep).
- `key` ontbreekt of is ongeldig (A3): 400.
- Anders: haalt de afrekening met die sleutel in de groep van `FINANCE_GROUP_ID` weg, en antwoordt 200. Het antwoord is byte voor byte hetzelfde of er iets was of niet (draft). Een afrekening met dezelfde sleutel in een andere groep blijft.
- Was het de laatste afrekening van de groep, dan verdwijnt de tab Geld (invariant 8 via de live query).

### A6. Lezen

- `settlements.listByGroup({ groupId })`: per afrekening precies `_id`, `name`, `period`, `startDate`, `participantCount` (aantal rijen) en `openCount` (rijen met `open` > 0, zoals `n_open` in het clubboek). Volgorde: nieuwste `startDate` eerst, bij gelijke datum op naam (A-keuze 4). Een lid van een groep zonder afrekeningen krijgt `[]`.
- `settlements.get({ settlementId })`: precies `_id`, `name`, `period`, `startDate`, `settledOn`, `publishedOn`, `lustrum`, `costPerPerson`, `parts`, `rows`, `totals`, in de vorm van A2. Niet: `key`, `groupId`, `receivedAt`, `_creationTime`.
- Beide: geen lid, onbekende groep, gewiste of onbekende afrekening, uitgelogd: de ConvexError `NOT_MEMBER` (uitgelogd: in elk geval geen gegevens). Ook de webmaster heeft geen toegang buiten zijn groepen (WP23). Wie uit de groep gaat, krijgt bij de volgende uitvoering dezelfde fout.
- Beide declareren een return-validator zonder `any` of `record` (WP23-inventaris).

### A7. Toegangsdefinitie (work-package-specs §Toegangsdefinities)

Beschermd object: een afrekening. Toestemmingslijst: lid van de groep van de afrekening.

- **Waar het id zichtbaar wordt**: alleen in `listByGroup` (voor leden) en in de app-route van het overzicht, de tabel en de deelnemer. Nergens anders: geen mail, geen andere query, niet in het antwoord van de HTTP-route.
- **Publieke paden die een `settlements`-id aannemen**: alleen `settlements.get`. Een publiek pad met een `groupId` voor dit doel: alleen `settlements.listByGroup`.
- **Wat de toegang draagt**: lidmaatschap (`memberships`), dat bestaande gates al bewaken. Er komt geen state bij waar de leestoegang op leunt.
- **Schrijven**: geen publieke mutation of action in de module `settlements`. Schrijven en weghalen gaan alleen via de twee HTTP-routes naar interne mutations.
- **Inventaristest**: `tests/settlements/inventory.test.ts` legt dit vast, en `tests/readWhitelist/inventory.test.ts` kent de twee nieuwe queries.

### A8. Gedeelde vergelijking in constante tijd

`convex/lib/constantTime.ts` exporteert `constantTimeEqual(provided: string, expected: string): boolean`. Er is maar één definitie in `convex/`; `lib/testGate.ts` gebruikt hem, net als de gate van de nieuwe routes. Gedrag van WP26 blijft gelijk (de bestaande tests in `tests/testGate/` blijven groen).

### A9. Cascade, integriteit en migratie-tooling

- **G6** (nieuwe rij in de cascade-matrix): groep weg → haar afrekeningen weg, in `deleteGroupCascade`. Dus ook bij M2-e (het laatste lid verwijdert zijn account). Afrekeningen van andere groepen blijven.
- Account verwijderen (U-rijen) raakt de afrekeningen niet: er is geen koppeling met een gebruiker (besluit 3). Een naam blijft staan zolang het clubboek hem stuurt.
- **MON1**: `settlements.groupId` is een verplichte FK in `MONITORED_FKS`. Gevolg van de bestaande opzet (zoals WP38): de migratie-tooling telt en leegt `settlements` bij een reset, en de import vult hem niet (`NOT_LOADED_BY_IMPORT`). Na een reset stuurt Wouter de afrekening opnieuw.

### A10. Wat B bouwt (namen en signatures; het hoe is aan B)

Backend:
- schema: tabel `settlements` met de velden van A2 (ook `key`), plus `groupId: v.id("groups")` en `receivedAt` (ms). Indexen `by_group` (`groupId`) en `by_group_key` (`groupId`, `key`). Geen `v.any()`.
- `convex/settlements.ts`: publieke queries `listByGroup` en `get` (A6); interne mutations voor vervangen en weghalen.
- `convex/http.ts`: `POST /settlements` en `DELETE /settlements` (A4, A5).
- `convex/lib/constantTime.ts` (A8).
- `deleteGroupCascade` (A9), `MONITORED_FKS` (A9).

App (`app/src/lib/settlements.ts`, pure logica):
- `formatEuro(cents: number): string`: `€ 1.234,56`, met een harde spatie (U+00A0) na het euroteken en een minteken (U+2212) vóór het euroteken bij een negatief bedrag (`−€ 1.400,00`, zoals de mockup). Geen gewone spatie, zodat een bedrag niet breekt.
- `formatCell(cents: number | null): string`: voor de tabel, zonder euroteken (`912,40`); leeg bij null of 0, zoals `euro_leeg` in het clubboek.
- `balanceLabel(balance: number): string` en `balanceCell(balance: number): string`: de afrekening rechts in de lijst (`−€ 302,34` bijbetalen, `+€ 130,00` terugkrijgen, `—` bij 0) en in de tabel (`−302,34`, `+130,00`, leeg).
- `settlementsByYear<S extends { startDate: string }>(items: readonly S[]): { year: number; settlements: S[] }[]`: groepeert opeenvolgende afrekeningen per jaar van `startDate`, in de volgorde van de backend.
- `timelineLabel(item: { participantCount: number; openCount: number }): string`: `3 van 8 nog open`, of `Afgerond`.
- `participantStatus(row): { kind: "done" | "pays" | "receives"; label: string }`: `Afgerond`, `Nog € x`, `Krijgt nog € x` (x = `open`). Grijs, rood, groen.
- `participantOutcome(row, lustrum: boolean): string`: `Betaalt nog € x`, `Krijgt nog € x terug`, `Zijn deel komt helemaal uit zijn spaarpot` (lustrum, `balance` 0 en `fromPot` > 0), anders `Afgerond`. Leest van de rij alleen `balance`, `open` en `fromPot`.
- `visibleColumns(settlement): ColumnKey[]`: de vaste kolommen na de onderdelen, in de volgorde van het clubboek: `costs`, `club` (alleen als `totals.club` ≠ 0), `fromPot` en `potAfter` (alleen bij een lustrum), `advanced` (alleen als `totals.advanced` ≠ 0), `balance`, `status`.
- `stillToPay(rows): { cents: number; count: number }`: de tegel "Nog te betalen" (A-keuze 5).
- `paymentLines(row: Pick<SettlementRow, "balance" | "open" | "payments">): { label: string; cents: number }[]` (F3): de regels van blok 3, Afrekening. Een bedrag dat eraf gaat is negatief; de regels tellen op tot de laatste. `balance` > 0: `Bijbetalen` (balance), per betaling `Betaald op d-m-jjjj` (−bedrag), dan `Nog te betalen` of `Afgerond` (open). `balance` < 0: `Terugkrijgen` (−balance), als er al iets af is `Uitbetaald of verrekend` (−(−balance − open)), dan `Nog terug te krijgen` of `Afgerond` (open). `balance` 0: geen regels. De datum zoals het clubboek hem toont: zonder voorloopnul (`18-6-2026`, A-keuze 13).
- De lib-functies nemen alleen getypte vormen (`Settlement`, `SettlementRow` of een `Pick` daarvan), geen losse JSON (F5). De tests casten de voorbeelden naar die types.
- Grote tekst (F7): bij `fontScale` ≥ 1,2 (`LARGE_TEXT_SCALE`, zoals in `Notice` en `SegmentedTabs`) staan de halve tegels van het overzicht onder elkaar, elk over de hele breedte. Geen test (geen pure logica); simulator-gate.
- `groupHasSettlements(list: readonly unknown[] | undefined): boolean`: zolang de lijst laadt: nee (geen tab die weer verdwijnt).
- `groupTabs(opts: { hasFilms: boolean; hasSettlements: boolean }): { key: "albums" | "films" | "leden" | "geld"; title: string }[]`: Albums, (Films), Leden, (Geld).
- In `app/src/lib/groupRoutes.ts`: `settlementPath(groupId, settlementId)` → `/groep/<g>/geld/<id>`, `settlementTablePath(...)` → `…/tabel`, `participantPath(groupId, settlementId, name)` → `…/deelnemer/<naam>`, elk deel URL-gecodeerd. De deelnemer zit op naam in de route (uniek, A2), zodat hij na opnieuw sturen dezelfde blijft. Staat de naam niet (meer) in de afrekening, dan toont het scherm geen gegevens van een ander.
- De routebestanden staan in de Home-stack onder `groep/[groupId]/geld/[settlementId]/` en zijn niet publiek.
- De app rekent geen totalen, afrondingen of tekens uit het clubboek na: tegels en voettekst komen uit `totals`, `costPerPerson` en `parts[].costs`. Alleen afgeleid: tellingen, `stillToPay`, en `terug = -balance`.

### A11. Tests voor het clubboek (B schrijft ze in `boek/tests.py`; A raakt het clubboek niet aan)

Voorstel voor namen: `boek/services/app_geld.py` met `verzoek(p: Publicatie) -> dict` (alleen omzetten, geen netwerk), en een functie per knop die verstuurt en een melding teruggeeft. Instellingen in `data/app_geld.json` (map `data/` staat in `.gitignore`; bestand alleen leesbaar voor de eigenaar), met de site-URL en het geheim. Netwerk met de standaardbibliotheek; geen nieuwe afhankelijkheid.

1. `verzoek` op een kopie van `tests/fixtures/wp41/lustrum.publicatie.json` en `weekend.publicatie.json` (als `Publicatie` met een `Evenement` met die `pk` en `startdatum`) geeft precies het bijbehorende `*.request.json`.
2. Nergens in de uitkomst `lid_id`, en geen sleutel buiten A2 (recursief nagelopen).
3. Afronding per waarde half-even: `"0.125"` → 12, `"0.135"` → 14, `"-0.00"` → 0, `"33.33333333333333333333333333"` → 3333.
4. Een cel `"-912.40"` wordt 91240; een lege cel blijft null.
5. De knop stuurt de gekozen gepubliceerde versie, opnieuw gelezen uit de database op evenement en datum. Bij `concept` of zonder versies wordt er niets verstuurd (netwerk gemockt, niet aangeroepen), en in de template is de knop uit.
6. Geen of onvolledige instellingen: een melding, niets verstuurd.
7. Antwoord 200: melding `In de app gezet: versie van 21-11-2026`. Antwoord 403, 400, 413 of een netwerkfout: een melding met de status of de fout, geen foutpagina. Het geheim staat in geen enkele melding.
8. Geen startdatum op het evenement: melding, niets verstuurd.
9. Het verzoek: `POST <site>/settlements`, `X-Clubboek-Secret: <geheim>`, `Content-Type: application/json`, geen `Authorization`-header (F1). Haal uit de app: `DELETE <site>/settlements?key=<pk>`, met dezelfde header.

10. Stand naast de knop: na een 200 bewaart het clubboek evenement, versiedatum en tijdstip; de pagina toont "In de app: versie van …, gezet op …". Na een nieuwere publicatie: "Er is een nieuwere versie dan in de app". Na Haal uit de app (200) of zonder verzending: "Niet in de app". Bij een fout verandert de bewaarde stand niet.

### A12. Waar de RED tests staan

- `tests/settlements/http.test.ts`: A4 en A5 (weigeringen, geheim aan de groep, vervangen met behoud van id, weghalen, geen lek, geen CORS).
- `tests/settlements/validation.test.ts`: A2 en A3 (elke vormfout en grens: 400 of 413, niets geschreven).
- `tests/settlements/reads.test.ts`: A6 (NOT_MEMBER, whitelist, tijdlijn, toegang kwijt, live vervangen).
- `tests/settlements/cascade.test.ts`, `integrity.test.ts`: A9.
- `tests/settlements/inventory.test.ts`: A7, A8 en het schema.
- `tests/settlements/constantTime.test.ts`: A8, de gedeelde vergelijking in constante tijd.
- `tests/settlements/fixtures.test.ts`: de voorbeelden zelf kloppen (sommen, samenhang). Groen; een vangnet voor wie ze aanpast.
- Aangepast: `tests/readWhitelist/inventory.test.ts` (twee queries erbij) en `tests/migration/fkOracle.ts` (`settlements.groupId`). Daardoor zijn `tests/readWhitelist/inventory.test.ts`, `tests/migration/sharedLists.test.ts` en `tests/migration/migrationFunctions.test.ts` rood tot B de queries en de FK toevoegt.
- `app/tests/settlements.test.ts`: A10 app.

### A-invarianten (aanvulling op de draft)

1. Elk bedrag in het verzoek is het bedrag uit de gepubliceerde versie, op centen afgerond zoals het clubboek het toont (half-even). Convex en de app ronden niets meer af en rekenen geen totalen na.
2. In het contract is een kost positief; `balance` > 0 is bijbetalen. Het clubboek draait alleen het teken van de cellen om.
3. Een verzoek met een veld buiten A2 wordt geweigerd. Zo komt een intern id van een lid nooit binnen, ook niet per ongeluk.
4. Opnieuw sturen met dezelfde sleutel houdt het `_id` van de afrekening.
5. Zonder geldige toegang beoordeelt de route niets van het verzoek: één weigering, wat de body ook is.
6. Elk totaal is de som van zijn rijen; anders is het verzoek ongeldig.
7. Ten hoogste 40 afrekeningen per groep, zodat de tijdlijn in één query past.
8. De deelnemer in de app-route is zijn naam; namen zijn uniek per afrekening.

### A-keuzes

1. Kosten positief in het contract (cellen omgedraaid), zie A1.
2. De grenzen van A3.
3. `FINANCE_SECRET` korter dan 32 tekens telt als "geen geheim" (fail-closed). De runbook-waarde is 64 hex-tekens.
4. Tijdlijn: nieuwste startdatum eerst, bij gelijke datum op naam.
5. De tegel "Nog te betalen" is de som van `open` van wie bijbetaalt, met dat aantal deelnemers (mockup). Het clubboek toont "Nog openstaand": de som van `open` van iedereen, ook wat de club nog terugbetaalt. Zie vraag 1.
6. In de tabel en de tegels staan kosten zonder minteken (mockup); het clubboek toont ze negatief. De kolom Afrekening heeft wel `−` en `+`, zoals het clubboek. Zie vraag 2.
7. De voettekst van Afrekening is `totals.balance`: netto, zoals het clubboek (de mockup telde alleen bijbetalers).
8. De periode is overal de tekst uit het clubboek ("12 t/m 26 oktober 2026"), ook op de kaart in de tijdlijn. De app maakt zelf geen datumtekst.
9. Een onderdeel per aantal (nachten) heeft geen prijs per persoon in `overzicht()`. De lijst Per onderdeel toont dan alleen het aantal deelnemers; de prijs per nacht staat in de grondslag op het scherm van de deelnemer ("14 nacht x 38,50"). Zie vraag 3.
10. `startDate` is verplicht. Heeft het evenement geen startdatum, dan geeft de knop een melding en stuurt niets.
11. Bij een vormfout noemt de 400 het pad van het veld, zodat Wouter in het clubboek ziet wat er mis is. Bijgesteld in F9: bij een onbekend veld alleen `<pad>: onbekend veld`, niet de naam van het veld (die komt uit de body).
12. Namen van deelnemers zijn uniek zonder onderscheid tussen hoofd- en kleine letters (na NFC). Twee rijen "Bram" en "bram" zijn in de app niet uit elkaar te houden.
13. Datums in blok 3 zonder voorloopnul (`18-6-2026`), zoals de deelnemerspagina van het clubboek (`j-n-Y`).

### Besluiten op de open vragen (Wouter, 2026-11-24)

Alle vier zoals A koos:
1. De tegel heet **Nog te betalen** en telt alleen wat deelnemers nog moeten bijbetalen (A-keuze 5).
2. Kosten staan in de app **zonder minteken**. Alleen de afrekening krijgt − (bijbetalen) of + (terugkrijgen) (A-keuze 6).
3. **Geen prijs per nacht** bij een onderdeel dat per aantal telt (A-keuze 9). De mockup wijkt hier af; de spec geldt.
4. Een migratie-reset vóór T0 **leegt de afrekeningen**. Daarna stuurt Wouter ze opnieuw (A9).

## Fix-cyclus 1 (regie en Wouter, 2026-11-24)

Na audit (3 should-fix) en red-team (geen toegangsgat; 3 zou, 4 nice) op `547ab00` en `84fbef3`. A legt vast, B bouwt.

- **F1. Geheim in een eigen header.** Het clubboek stuurt `X-Clubboek-Secret: <geheim>`, niet `Authorization: Bearer`: Convex probeert een Bearer-token als JWT te lezen, en dat valt in convex-test niet te testen. Alleen `Authorization` (ook met het juiste geheim) is een weigering (403). Verder gelijk: constante tijd, minstens 32 tekens, één weigering (§A4.1, §A5, §A11.9).
- **F2. Teksten.** 400 bij een tekst die geen well-formed Unicode is, of die control- of bidi-override/isolate-tekens bevat. Namen van deelnemers bovendien: niet leeg, geen witruimte aan begin of eind, niet alleen punten, geen `%` of `/`, uniek na NFC en zonder onderscheid tussen hoofd- en kleine letters (§A2, A-keuze 12).
- **F3. Betalingen.** `payments[].amount` is positief: wat de deelnemer betaalde. Het clubboek geeft alleen betalingen bij wie moet bijbetalen; wie terugkrijgt heeft er nooit, ook als de club al uitbetaalde (dan is alleen `open` lager). Convex weigert `payments` bij `balance` ≤ 0. Het voorbeeld `weekend` heeft daarom Ruud: schoot € 200 voor, deed verder niet mee, kreeg € 150 uitbetaald, `open` € 50, geen betalingen. De app toont het verschil als regel `Uitbetaald of verrekend` (`paymentLines`, §A10).
- **F4. 413 vóór 400.** Een body die te groot én kapot is, geeft 413.
- **F5. Getypte app-logica.** De app-tests casten de voorbeelden naar `Settlement` en `SettlementRow`; de lib neemt geen losse JSON meer.
- **F6. Leesgrens.** Rekensom in §A3 bijgewerkt (±173 KB per maximaal document, 40 stuks ±6,6 MiB). Geen samenvattingsvelden.
- **F7. Grote tekst.** Halve tegels onder elkaar bij `fontScale` ≥ 1,2 (§A10).
- **F8. Runbook (B-taak).** In `external-services.md`, sectie Clubboek → Geld: na een migratie-reset of import, en op T0, eerst `FINANCE_GROUP_ID` op het nieuwe id van de groep zetten, dán opnieuw sturen (een oude waarde wijst naar een groep die niet meer bestaat: elke poging geeft 403). Staat T0 nog open in het draaiboek van WP31, dan daar dezelfde stap.
- **F9. Onbekend veld.** De 400 zegt `<pad>: onbekend veld`, zonder de veldnaam (A-keuze 11 bijgesteld).

Tests: `tests/settlements/http.test.ts` (F1), `validation.test.ts` (F2, F3, F4, F9), `reads.test.ts` en `fixtures.test.ts` (het nieuwe voorbeeld), `app/tests/settlements.test.ts` (F3, F5).

## Fix-cyclus 2 (regie en Wouter, 2026-11-24)

Heraudit en red-team-hercheck op `01768d8` groen; drie nice-punten gaan mee. A legt vast, B bouwt.

- **G1. Namen van deelnemers, strenger.** Bovenop F2 wordt een naam geweigerd (400) als hij bevat:
  - een onzichtbaar of opmaakteken (Unicode-categorie Cf), onder meer U+00AD, U+061C, U+200B–U+200F, U+2060, U+FEFF en de tag-tekens U+E0000–U+E007F;
  - U+2028 of U+2029;
  - geen enkel zichtbaar teken: er moet minstens één letter of cijfer in staan dat geen opvulteken is (U+115F, U+1160, U+3164, U+FFA0 tellen niet; U+2800 is geen letter). Een naam van alleen leestekens of een emoji wordt dus ook geweigerd.

  Uniek wordt bepaald na **NFKC** (in plaats van NFC) en zonder onderscheid tussen hoofd- en kleine letters: "Ｂｒａｍ" botst met "Bram", "Soﬁe" met "sofie".
  **Besluit:** gelijkende tekens uit andere schriften (Cyrillische В naast Latijnse B) laten we door. Het clubboek is de enige schrijver en de namen komen uit één ledenlijst.
- **A-keuze 14.** U+2028 en U+2029 zijn in **elk** tekstveld verboden: het zijn regeleinden, net als de control-tekens van F2. De rest van Cf geldt **alleen voor namen van deelnemers**: die staan in de route en worden vergeleken. In de andere teksten mogen bijvoorbeeld een zachte afbreking of de ZWJ in een emoji (👨‍👩‍👧) gewoon blijven. De bidi-tekens van F2 blijven overal verboden. De bestaande voorbeelden voldoen.
- **G2. Samenhang per deelnemer** (anders 400 met het pad van de rij, bv. `rows[4]…`):
  - `open` ≤ |`balance`|;
  - bij `balance` = 0 is `open` 0;
  - bij `balance` > 0 is `open` = max(0, `balance` − som(`payments`)) (fix-cyclus 3).

  Beide voorbeelden halen dit.
  Bijgesteld in fix-cyclus 3: een overbetaling mag (zie daar).
- **G3. Betalingen strikt positief.** `payments[].amount` > 0. Een bedrag van 0 of lager geeft 400.

Tests: `tests/settlements/validation.test.ts` (G1–G3) en `fixtures.test.ts` (G2 op de voorbeelden).

## Fix-cyclus 3 (besluit Wouter, 2026-11-24)

Een overbetaling leidt nooit tot een weigering. Wie € 105 betaalt op € 100 naheffing, heeft "€ 100 betaald" en is afgerond. Het teveel valt buiten de afrekening. Zo doet het clubboek het ook (`afgerond()`: `nog = max(0, -s - b)`, uitleg `betaald via Debiteuren min(b, -s)`).

- **H1. G2 bijgesteld.** Bij `balance` > 0: `open` = max(0, `balance` − som(`payments`)). De andere regels blijven: `open` ≤ |`balance`|, en bij `balance` 0 is `open` 0. Overbetaald met toch iets open blijft een 400.
- **H2. `paymentLines`, A-keuze 15.** Het getoonde betaalde totaal is hoogstens de naheffing.
  - De betalingen gaan in hun volgorde mee tot de naheffing vol is.
  - De betaling die eroverheen gaat, staat er alleen met wat er nog over was.
  - Latere betalingen vallen weg.
  - Zo tellen de regels nog steeds op tot de laatste (`Afgerond`, 0), en staat het teveel nergens.
  - Voorbeeld: € 60 + € 50 + € 20 op € 100 geeft `Betaald op …` −60 en −40, dan `Afgerond`.
- **H3. Tests.** `validation.test.ts`: overbetaling in één en in twee keer wordt aangenomen (200). `app/tests/settlements.test.ts`: overbetaling in één keer, over meer betalingen, en op een deelnemer uit het voorbeeld. De voorbeeldbestanden zelf blijven ongewijzigd.
