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
