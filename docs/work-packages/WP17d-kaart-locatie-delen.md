# WP17d: de kaart, locatie wijzigen en delen

> Draft (regie, 2026-11-12). App-WP met een backend-deel. Uit WP17c (besluit 2026-11-12). Vóór T0.

## Productdoel

Een lid ziet op een kaart waar de foto's van een album zijn gemaakt. Als eigenaar past hij de locatie van zijn foto aan of haalt hij die weg. Hij kan een foto delen met iemand buiten de app, en weet daarbij dat het beeld de app verlaat. Een plek waar een foto is gemaakt, ziet alleen wie die foto mag zien.

## Invarianten (draft)

1. **De kaart volgt de foto-toegang.** De kaart van een album toont alleen foto's met een locatie, en alleen aan wie het album mag zien. Coördinaten verlaten de backend alleen voor foto's waar de caller toegang toe heeft. Er komt een nieuwe read met een whitelist, en de standing rule [Toegangsdefinities](../conventions/work-package-specs.md#toegangsdefinities-verplicht-bij-wps-die-er-een-invoeren) geldt. Nu toont de foto-vorm alleen de plaatsnaam, geen coördinaten.
2. **Precisie: open vraag 1.** Welke precisie andere leden zien, beslist Wouter. De eigenaar ziet altijd de exacte plek van zijn eigen foto.
3. **Locatie wijzigen: alleen de eigenaar.**
   - Een nieuwe plek krijgt ook een nieuwe plaatsnaam (Photon, zoals bij de upload).
   - Weghalen wist de coördinaten én de plaatsnaam.
   - Een foto van een ander, een onbekende en een gewiste foto geven dezelfde weigering, en er verandert niets.
4. **Delen maakt geen openbare link.** Delen geeft het bestand aan het iOS-deelmenu, geen URL. Er ontstaat geen pad waarmee iemand zonder login een beeld krijgt.
5. **Delen alleen met toegang.** Je deelt alleen een foto die je mag zien. Het beeld gaat in het formaat van open vraag 4 en zonder GPS in het bestand.
6. **Geen locatie van het toestel.** De kaart vraagt geen toestemming voor de locatie van de telefoon.
7. **Kosten nul.** Apple Maps (geen sleutel) en Photon (gratis, EU). Geen nieuwe betaalde dienst.

## Scope

- **In scope:**
  - de kaart per album;
  - locatie wijzigen en weghalen in het menu van een eigen foto;
  - delen in het foto-menu;
  - in de backend een read voor de kaart en een mutation voor de locatie;
  - de nieuwe bibliotheken in de app en een nieuwe EAS-build.
- **Bewust niet:**
  - een kaart over alle albums of over Mijn foto's (open vraag 5);
  - delen via een link;
  - locatie bij een video (WP21).

## Risico-assessment

- **security/privacy: hoog.** Exacte coördinaten kunnen iemands huis aanwijzen. Een gedeeld beeld valt buiten elke toegangscontrole. Er komt een nieuwe read die coördinaten geeft.
- **ops: laag.** Photon kan traag zijn of weigeren; dat moet zichtbaar falen, niet stil.
- **external deps: medium.** Er komt een kaartbibliotheek en een deel-bibliotheek in de native build, en Photon voor zoeken en plaatsnamen (met limieten).
- **multi-user/concurrency: laag.** De eigenaar wijzigt de locatie terwijl een ander de kaart open heeft.
- **data/schema-evolutie: laag.** De coördinaten bestaan al (WP12, WP18). Afronden, als dat de keuze wordt, gebeurt bij het lezen en niet in de data.
- **ops-runbook-impact:** geen sleutels. Wel een nieuwe build voor TestFlight.

## Open vragen voor A / Wouter

1. **Precisie voor andere leden.** De exacte plek (zoals v1) of afgerond, bijvoorbeeld op ongeveer 1 km?
2. **Locatie wijzigen: hoe?** Een speld op de kaart verplaatsen, zoeken op een plaatsnaam, of beide? Wat deed v1?
3. **Een melding vóór het delen?** Bijvoorbeeld: "Deze foto verlaat de app." Ja of nee?
4. **Wat deel je?** Het formaat *groot* (1600) of het origineel, één foto of ook een selectie, en alleen je eigen foto's of elke foto die je ziet?
5. **Kaart alleen per album,** of ook per groep of in Mijn foto's? Wat deed v1?

## Cross-refs

- [WP17c](./WP17c-mijn-fotos.md): de splitsing, Mijn foto's, het foto-menu.
- [WP18](./WP18-foto-upload.md): locatie bewaren als aparte headers (vraag 2), Photon, geen EXIF in het bestand.
- [WP17a](./WP17a-fotos-bekijken.md): het beeldpad en de formaten.
- [WP23](./WP23-read-whitelist.md): de veld-whitelist op reads.
- WP1: Photon (EU) voor plaatsnamen.
- Oude code (alleen A): de albumkaart, "locatie wijzigen" en delen in `clubalmanac-app`.

## Sessies

| Stap | Wie | Wat |
|---|---|---|
| 1 | regie | deze draft |
| 2 | A (`wp-a`) | spec-aanvulling (vraag 1–5 met v1 als bron, pariteit per scherm, telling op de prod-export) en RED tests |
| 3 | B (`wp-b`) | implementatie, nieuwe bibliotheken, release-build in de simulator |
| 4 | audit | toetst B aan de spec en de tests |
| 5 | red-team | zoekt coördinaten of beelden zonder toegang: via de kaart-read, na vertrek, met een oude link of een gedeeld bestand, en via de locatie-mutation. Krijgt alleen het productdoel en de diff. Het rapport gaat letterlijk naar Wouter. |
| 6 | regie + Wouter | gate in de simulator tegen dev |

## Acceptance

- Tests: A bepaalt welke.
- Gate op dev (simulator, release-build):
  - de kaart van een album met foto's met en zonder locatie;
  - het tweede lid ziet de precisie van besluit 1, en ziet geen kaart van een album uit een andere groep;
  - locatie wijzigen en weghalen; de plaatsnaam volgt;
  - een foto delen via het deelmenu, zonder GPS in het bestand.

---

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft.)
