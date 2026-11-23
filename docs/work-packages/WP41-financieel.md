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

Er komt geen intern id van een lid uit het clubboek in. Indexen: `by_group` en `by_group_key`. A legt de precieze validator vast: getypt, zonder `v.any()`, met een grens op het aantal deelnemers, onderdelen en regels en op de lengte van teksten.

### Lezen (publieke queries, met een veld-whitelist zoals in WP23)

- `settlements.listByGroup({ groupId })`: de tijdlijn. Per afrekening: id, naam, periode, startdatum, aantal deelnemers en aantal nog open. Ook de bron voor besluit 8.
- `settlements.get({ settlementId })`: de hele afrekening voor het overzicht, de tabel en de deelnemer. Zonder `groupId`-lek naar wie geen lid is (invariant 1).

### Schrijven (alleen het clubboek)

- `POST /settlements`: de header `Authorization: Bearer <geheim>`, en als body de afrekening in de vorm hierboven, met `key`. Het antwoord is 200 met het aantal deelnemers, of één weigering.
- `DELETE /settlements?key=…`: haalt die afrekening weg. Bestaat de sleutel niet, dan is het antwoord hetzelfde als na weghalen.
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
- Het clubboek heeft geen git. Wie het bouwt, maakt eerst een kopie van de bestanden die hij raakt, en schrijft tests in `boek/tests.py`.

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

(Leeg in draft.)
