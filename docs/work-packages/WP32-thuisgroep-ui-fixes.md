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
   | elders (album, foto, andere groep, overige schermen onder Home) | huisje | naar de thuisgroep, of zonder thuisgroep naar *Mijn groepen* |

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
- B kijkt in de iOS-simulator: inloggen met één en met meerdere groepen, de Home-knop in alle drie de situaties, bladeren door een album met en zonder omschrijvingen, en elk scherm met een tekstveld met het toetsenbord open.
- Empirische gate (Wouter, TestFlight-build tegen dev): dezelfde punten op een toestel, plus een account met drie groepen (thuisgroep wisselen, uit de thuisgroep gezet worden).

---

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft. A commit edits hier.)
