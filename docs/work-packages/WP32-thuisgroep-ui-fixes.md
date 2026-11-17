# WP32: Thuisgroep en UI-fixes vóór T0

App-WP (lichtere variant, [`work-package-specs.md`](../conventions/work-package-specs.md) §App-WP's). Eén cutover-build na deze WP; daarom vóór T0.

## Productdoel

Een lid komt na het inloggen en met de Home-knop direct in de groep waar hij meestal zit, en de app verspringt niet bij het bladeren door foto's of bij het typen.

Achtergrond: de meeste leden zitten in één groep, of altijd in dezelfde. De twee UI-fouten kwamen uit de generale repetitie van 2026-11-17 (cutover-build 62).

## Invarianten

### A. Thuisgroep (besluiten Wouter 2026-11-17)

1. **Thuisgroep** = de groep die de user het laatst bezocht, mits hij er nog lid van is; anders, als hij in precies één groep zit, die groep; anders geen.
2. **Bezoeken** = de groepspagina openen, of een scherm binnen die groep (album, foto). Een uitnodiging accepteren en daarna in de nieuwe groep landen telt ook.
3. **Opslag alleen in de app**, op het toestel, per user (sleutel op de identiteit van de ingelogde user). Geen nieuw veld in de database, geen extra serververkeer. Een ander account op hetzelfde toestel (bijvoorbeeld het demo-account) ziet nooit de thuisgroep van een ander. *Account verwijderen* wist de opgeslagen waarde van die user.
4. **Lidmaatschap is leidend:** een opgeslagen groep waarvan de user geen lid (meer) is, telt niet. Dat blijkt uit de groepenlijst die de app toch al ophaalt.
5. **Na inloggen:** met thuisgroep naar die groepspagina; zonder naar *Mijn groepen*. Dus: één groep → die groep; meerdere groepen en nog nooit een bezocht → *Mijn groepen*.
6. **De Home-knop** (tab):

   | Waar de user is | Icoon | Tik |
   |---|---|---|
   | de groepspagina van de thuisgroep | groepen (Ionicons `people`) | naar *Mijn groepen* |
   | *Mijn groepen* | huisje, actief | doet niets |
   | album, foto of ander scherm binnen een groep | huisje | naar de groepspagina van de thuisgroep (dat is die groep, besluit 2) |
   | een andere tab (*Mijn foto's*, Profiel, Instellingen) die de user opende vanaf *Mijn groepen* | huisje | terug naar *Mijn groepen* (besluit 1) |
   | een andere tab, in alle andere gevallen | huisje | naar de thuisgroep, of zonder thuisgroep naar *Mijn groepen* |

   Het toegankelijkheidslabel volgt de bestemming ("Mijn groepen" of de naam van de thuisgroep).
7. **De terug-naar-*Mijn groepen*-knop op de groepspagina vervalt.** *Mijn groepen* bereik je via de Home-knop.
8. **Verlaten of verwijderd uit de thuisgroep:** de thuisgroep valt terug volgens invariant 1. De app toont nooit een groepspagina waar de user geen lid van is.

### B. Foto's bladeren (repetitie-bevinding 1)

9. Bij links-rechts bladeren door foto's verandert de grootte van het fotogebied niet per foto. De hoogte van het informatieblok (datum, omschrijving, wie plaatste) mag de foto niet laten verspringen.
10. Tijdens het laden geeft de foto niet de indruk schermvullend te zijn om daarna te krimpen: wat er tijdens het laden staat, heeft dezelfde omvang en plaats als de geladen foto, of is neutraal (geen grijs vlak over het hele gebied).

### C. Toetsenbord (repetitie-bevinding 2)

11. Op elk scherm met een tekstveld bedekt het toetsenbord nooit het veld waarin getypt wordt, en ook niet de knop waarmee het formulier verstuurd wordt. Gezien op: *Uitnodigen* (knop "Uitnodiging versturen") en het inlogscherm (knop "Stuur code"). A inventariseert alle schermen met een tekstveld.

## Edge cases + scope-uitsluitingen

- **In scope**:
  - een user zonder groepen: na inloggen het bestaande scherm (uitnodiging nodig, of lege *Mijn groepen*); Home doet wat het nu doet;
  - de thuisgroep wordt verwijderd door een admin terwijl de app openstaat: invariant 8;
  - uitloggen laat de opgeslagen thuisgroep staan (dezelfde user heeft er bij het volgende inloggen weer wat aan);
  - de update van de oude app naar 2.0.0 op T0: er is nog geen thuisgroep; leden met één groep komen meteen in hun groep.
- **Bewust niet**:
  - synchroniseren van de thuisgroep tussen toestellen (besluit a: alleen lokaal);
  - een instelling om de thuisgroep handmatig te kiezen;
  - backend-wijzigingen. Blijkt er toch een nodig: stop en meld aan regie.

## Risico-assessment

- **security/privacy**: laag — lokaal staat alleen een groeps-ID per user, geen persoonsgegevens; invariant 3 en 4 voorkomen dat een ander account of een ex-lid een groep te zien krijgt (de backend weigert dat bovendien al).
- **ops**: laag — geen nieuwe diensten of crons.
- **external deps**: geen.
- **multi-user/concurrency**: laag — meerdere accounts op één toestel: invariant 3.
- **data/schema-evolutie**: laag — geen schema-wijziging, geen migratie.
- **ops-runbook-impact**: geen env-vars of dashboard-config. Wel: na deze WP een nieuwe cutover-build (draaiboek T-4, *Cutover-build*); build 62 vervalt.

## Cross-refs

- Draaiboek: [`wp31-cutover-draaiboek.md`](../runbooks/wp31-cutover-draaiboek.md) §Generale repetitie, uitslag 2026-11-17.
- Groepspagina, *Mijn groepen*, tabs: `app/src/app/(tabs)/`; foto-detail: `app/src/screens/PhotoDetailScreen.tsx`, `app/src/components/Photo.tsx`.
- Design: `docs/design.md` (iconen §5).

## Acceptance — hoe weten we dat het klaar is

- Tests (pure logica): de bepaling van de thuisgroep (invariant 1, 4, 5, 8) en de bestemming en het icoon van de Home-knop (invariant 6), per user (invariant 3).
- B kijkt in de iOS-simulator: inloggen met één en met meerdere groepen, de Home-knop in alle drie de situaties, bladeren door een album met en zonder omschrijvingen, en elk scherm met een tekstveld met het toetsenbord open, in de toestanden van C5.
- Empirische gate (Wouter, TestFlight-build tegen dev): dezelfde punten op een toestel, plus een account met drie groepen (thuisgroep wisselen, uit de thuisgroep gezet worden).

---

## Spec-criticus aanvullingen (A vult in)

Bronnen: de oude app (`components/nav/TabBar.jsx`, `screens/PhotoDetail.jsx`), WP16 (§Routes, beslissing 4, invariant 6 en 12) en de huidige `app/`.

### Wat er al is (WP16)

De app onthoudt al een "laatst bezochte groep" (`src/data/lastGroup.ts`) en springt na inloggen of een koude start één keer naar die groep (`MyGroupsScreen`, `src/lib/homeDecision.ts`). WP32 verschilt op vijf punten:

- **Eén waarde voor het hele toestel.** Logt user B in, dan overschrijft zijn bezoek de groep van A; logt A daarna weer in, dan is die weg. Invariant 3 vraagt een waarde per user.
- **Geen terugval op de enige groep** (invariant 1). Daardoor wacht de keuze na inloggen nu niet op de groepenlijst als er niets is opgeslagen. Met de terugval moet hij dat wel: tot de lijst er is, weet de app niet of je in precies één groep zit (geen flits van *Mijn groepen*).
- **Alleen de groepspagina telt als bezoek**, niet album, foto of film (invariant 2).
- **De Home-knop** gaat nu naar de wortel van de stack, net als elke andere tab (WP16 §Routes). De tabel van invariant 6 vervangt dat.
- **Account verwijderen** laat de opgeslagen waarde staan.

### Pariteit oude app

| Oud | WP32 |
|---|---|
| Home-knop gaat altijd naar de Home-groep (album-overzicht), vanaf elke tab | Tabel invariant 6 en besluit 1 |
| Altijd een huisje; actief als je op het Home-scherm bent | Huisje, en `people` op de groepspagina van de thuisgroep |
| Home-groep gezet door een tik op een groep in *Mijn groepen*; gewist via Instellingen en bij verlaten | Gezet door een bezoek (invariant 2); geen instelling (scope) |
| Foto-detail: vaste verdeling, de foto ¾ en het informatieblok ¼ van het scherm; het blok vervaagt tijdens het bladeren | Invariant 9 (gedrag, geen layout overnemen) |

### Thuisgroep (A)

- **A1. Wanneer telt een bezoek.** Elk scherm onder de groep in de Home-stack: de groepspagina, album, foto, kaart, locatie, film, draaien, bewerken, nieuw album, uitnodigen. Alleen als het scherm de inhoud van de groep echt toont: een groep waar de user geen lid van is (deep link, `NOT_MEMBER`) of die nog laadt, telt niet en overschrijft niets. Geen bezoek: *Mijn foto's* (ook het detail van een foto die in een album van de groep staat), *Toevoegen* met een album, een uitnodiging zien of afwijzen. Accepteren telt via het landen op de groepspagina.
- **A2. Wanneer kiest de app na inloggen.** Zoals WP16 invariant 12: één keer per sessie, bij inloggen én bij een koude start met een bestaande sessie. Tot de opgeslagen waarde gelezen is én de groepenlijst er is: laden, geen flits van *Mijn groepen* of van een groep. Opent een deep link een ander scherm, dan kiest de app niets.
- **A3. Bestemming "naar de thuisgroep".** De Home-stack wordt *Mijn groepen* met daarop de groepspagina van de thuisgroep. Wat erboven lag (album, foto, een andere groep) gaat weg. Terug vanaf de thuisgroep is dan *Mijn groepen*. "Naar *Mijn groepen*" laat alleen *Mijn groepen* over. Nooit twee keer dezelfde groep in de stack.
- **A4. Thuisgroep nog onbekend** (opgeslagen waarde niet gelezen, of de groepenlijst laadt nog, of laden mislukt): de Home-knop gaat nooit naar een groep. Hij gedraagt zich als "geen thuisgroep".
- **A5. Opslag per user.** De sleutel hoort bij de Clerk-user-id. Twee users op één toestel hebben elk hun eigen waarde, ook na elkaars bezoeken. Een id met tekens die het toestel-geheugen niet als sleutel aanneemt, mag niet stil mislukken of samenvallen met een ander id. Lezen of schrijven dat faalt, ziet de user niet: dan "geen opgeslagen waarde". De oude toestel-brede waarde van WP16 (alleen in testbuilds, nooit op prod) mag genegeerd, opgeruimd of voor dezelfde user overgenomen worden. Een andere user krijgt hem nooit.
- **A6. Account verwijderen** wist de waarde van die user pas als het verwijderen gelukt is. Mislukt het, dan blijft hij staan. Een andere user op het toestel houdt de zijne. Uitloggen wist niets (scope).
- **A7. Toegankelijkheidslabel.** Het zichtbare label onder het icoon blijft "Home". Het VoiceOver-label bevat "Home" (dan werkt "tik Home" met Spraakbediening) en de bestemming: "Mijn groepen" of de naam van de thuisgroep. Op *Mijn groepen* noemt het "Mijn groepen".
- **A8. Terugknop weg (invariant 7).** De pil verdwijnt van de groepspagina in alle toestanden. De meldingen "geen lid" en "laden lukt niet" houden hun knop "Naar Mijn groepen" in de inhoud (invariant 8). Terugvegen vanaf de linkerrand blijft werken.
- **A9. "Vanaf *Mijn groepen* rechtstreeks naar die tab" (besluit 1).** Telt alleen de tab-wissel: stond de user op *Mijn groepen* op het moment dat hij een andere tab koos, dan brengt Home hem vanaf die tab terug naar *Mijn groepen*. Ook als hij binnen die tab dieper ging (Profiel → Uitnodigingen). Van daar naar nog een andere tab (*Mijn groepen* → Profiel → Instellingen) is niet meer rechtstreeks: dan de thuisgroep. *Toevoegen* openen en sluiten is geen tab-wissel. Na een koude start of een deep link op een andere tab is de herkomst onbekend: dan de thuisgroep.
- **A10. "Meteen" (besluit 2).** Zodra een groepspagina de groep toont, is hij de thuisgroep. De Home-knop toont op diezelfde pagina meteen `people`, zonder te wachten op het schrijven naar het toestel. Mislukt dat schrijven, dan blijft de groep voor de rest van deze app-sessie toch de thuisgroep. Een bezoek als een andere user verandert niets voor de vorige.

### Foto's bladeren (B)

- **B1. Beide foto-details.** Album (`PhotoDetailScreen`) en *Mijn foto's* (`MyPhotoDetailScreen`) hebben dezelfde opbouw en dezelfde fout.
- **B2. Wat er nu varieert.** Een omschrijving per foto bestaat niet in v2. Het informatieblok toont: wie plaatste, datum · plaats (de plaats kan ontbreken of over twee regels lopen), en "In album(s):" met nul of meer regels. Die albumregels laden per foto apart en komen dus ná het tonen van de foto. Zo verspringt het fotogebied ook bij één foto, zonder te bladeren. Ook de melding na een actie (delen, draaien) staat tussen foto en blok.
- **B3. Regel.** Het fotogebied verandert alleen bij het draaien van het toestel, een andere venstermaat of een andere tekstgrootte. Niet per foto, niet bij het laden van de albumregels, niet door de melding na een actie. Bij de grootste tekstgrootte, of met veel albums, blijft alle informatie leesbaar of bereikbaar. Er valt niets weg.
- **B4. Tijdens het laden (invariant 10).** Nu staat er een grijs vlak over het hele gebied, en daarna verschijnt de foto passend (kleiner). De response heeft `width` en `height` (optioneel; de opgeslagen pixels, vóór de EXIF-draaiing). Alle gemigreerde foto's en alle HEIC-uploads missen ze (`scripts/migrate/transform.ts`, `convex/photoMetadata.ts`), dus op prod bijna elke foto. De neutrale laad-toestand is daarom de gewone. De vorm van de foto mag alleen als `width` en `height` er zijn, met een kwartslag-draaiing meegerekend. Geen backend-wijziging. Alleen het foto-detail: tegels en covers vullen hun vak en houden hun grijze laad-toestand.

### Toetsenbord (C)

Inventaris van de schermen met een tekstveld, met de toestanden die het formulier langer maken (aanvulling Wouter 2026-11-17: het gaat vooral mis als er óók een melding staat):

| Scherm | Waar | Velden | Knop | Meldingen en extra blokken |
|---|---|---|---|---|
| Inloggen, stap e-mail | uitgelogd, wash-kop, tabbalk eronder | E-mailadres | "Stuur code" | boven: "Je account is verwijderd." (groen); "inloggegevens konden niet worden gewist" (rood) met "Opnieuw wissen" en eventueel "Wissen lukt nog steeds niet." Onder de knop: fout na versturen (ongeldig adres, te vaak, algemeen) |
| Inloggen, stap code | idem | Code | "Log in" | dezelfde meldingen boven; onder: fout bij de code (verkeerd, verlopen, te veel pogingen), melding na "Stuur een nieuwe code" of "Ander e-mailadres", plus die twee links |
| Uitnodigen | modaal | per rij Naam + E-mailadres, Bericht (meerregelig) | "Uitnodiging(en) versturen" | meerdere rijen ("Nog iemand uitnodigen"), een fout per rij, "… verstuurd" (groen) na een deels gelukte verzending, een lang bericht |
| Nieuwe groep | modaal | Naam, Omschrijving (meerregelig) | "Groep maken" | fout bij de naam, algemene fout |
| Nieuw album | modaal | Naam | "Album maken" | fout bij de naam, algemene fout |
| Bewerk groep | stack | Naam, Omschrijving (meerregelig), met cover en datum ertussen | "Bewaar" | melding bij de cover, fout bij naam of datum, algemene fout, "Opgeslagen" |
| Bewerk album | stack | Naam, met cover en datum | "Bewaar" | idem, zonder omschrijving |
| Profiel | tab | Naam | "Bewaar" | fout, of "Je naam is opgeslagen." |
| Account verwijderen | Profiel | bevestigingswoord | "Account verwijderen" | fout na mislukken (WP29 fix-cyclus 3 loste alleen de lege toestand op) |
| Idee / probleem doorgeven | Instellingen | Titel, Omschrijving (meerregelig) | "Idee doorgeven" / "Probleem melden" | fout bij titel, fout bij omschrijving, algemene fout of succes |

- **C1. Lange formulieren.** Bij Uitnodigen met meer rijen en bij Bewerk groep past niet alles boven het toetsenbord. Daar geldt: het veld waarin getypt wordt staat in beeld, en de knop is te bereiken door te scrollen terwijl het toetsenbord open is. Typt de user in het laatste veld vóór de knop, dan staan veld en knop allebei in beeld (zoals Inloggen, Nieuw album en Profiel).
- **C2. Meerregelig.** Groeit een meerregelig veld tijdens het typen, dan blijft de regel met de cursor boven het toetsenbord.
- **C3. Waar het toetsenbord meet.** Een modaal scherm en een scherm met een tabbalk eronder liggen elk anders ten opzichte van het toetsenbord dan een gewoon scherm in de stack. Beide kwamen uit de repetitie. Kijk elk scherm na op de kleinste iPhone die de app ondersteunt en met de grootste tekstgrootte.
- **C4. Return-toets.** Het gedrag van de return-toets verandert niet in deze WP.
- **C5. Met meldingen (eis voor B's simulator-check).** Invariant 11 geldt in elke toestand uit de laatste kolom, niet alleen in de lege begintoestand: elke melding die er kan staan, ook meerdere tegelijk, elke fout en elk extra blok. Een melding die verschijnt doordat de user op de knop tikt terwijl het toetsenbord open is (fout na versturen), staat ook in beeld. B kijkt per scherm minstens de lege toestand na, en de toestand met de meeste meldingen of blokken boven het veld. Inloggen dus met "Je account is verwijderd." erboven, en Uitnodigen met drie rijen, een fout per rij en een bericht. B noemt in zijn rapport per scherm welke toestanden hij zag.

### Open vragen aan regie (beantwoord, zie §Besluiten Wouter 2026-11-17)

1. **Home-knop vanaf een andere tab** (*Mijn foto's*, Profiel, Instellingen). (a) Naar de thuisgroep, zoals de rij "elders" en zoals de oude app. (b) De Home-tab openen zoals je hem verliet, zoals nu. Advies: (a). Dat past bij het productdoel "met de Home-knop direct in de groep". Nadeel: een open album op Home ben je kwijt. De tests volgen (a).
2. **Wanneer wordt een bezochte groep de thuisgroep?** (a) Meteen: open je groep X, dan is X direct de thuisgroep en toont de knop daar `people`. De rij "andere groep" komt dan bijna niet meer voor. (b) Bij de volgende start: de thuisgroep ligt vast vanaf inloggen of een koude start, en een bezoek telt pas bij de volgende keer. Verlaten of eruit gezet worden telt wel meteen (invariant 8). In X brengt de Home-knop je dan naar je vaste groep. Advies: (b). De tabel noemt "andere groep" als gewone plek, en de knop blijft binnen een sessie voorspelbaar. Invariant 1 kan met beide. De pure tests hangen er niet van af, alleen het doorgeven van de waarde.

### Besluiten Wouter 2026-11-17 (regie)

1. **Home vanaf een andere tab:** ging de user vanaf *Mijn groepen* rechtstreeks naar die tab, dan brengt Home hem terug naar *Mijn groepen*. In alle andere gevallen doet Home wat Home hoort te doen: met thuisgroep naar de thuisgroep, zonder naar *Mijn groepen*. Dat geldt ook voor de terug-beweging vanaf zo'n tab.
2. **Een bezochte groep is meteen en blijvend de thuisgroep** (vraag 2, optie a). Op elke groepspagina die de user bezoekt, staat dus het `people`-icoon en brengt Home hem naar *Mijn groepen*; vanaf een album of foto in die groep brengt Home hem naar die groepspagina. De tabel van invariant 6 is daarop aangepast.

3. **"Rechtstreeks" strikt (A9, optie a):** alleen een directe wissel van *Mijn groepen* naar een andere tab brengt de user met Home terug naar *Mijn groepen*; via meer tabs gaat Home naar de thuisgroep. Reden: de meeste leden komen nooit op *Mijn groepen*; zij gebruiken de app als lid of admin van één groep.
