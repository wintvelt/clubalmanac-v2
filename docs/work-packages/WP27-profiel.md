# WP27: Profiel — opbouw, en een profielfoto uit elke foto

> Draft (regie, 2026-11-11). Vóór T0. Uit de WP18-gate; richting akkoord 2026-11-08.

## Productdoel

Een lid ziet op Profiel in één oogopslag zijn foto, zijn naam en zijn e-mailadres, en past ze aan op de plek waar ze staan. Als profielfoto kiest hij elke foto die hij mag zien, zoals in v1. Iedereen ziet die profielfoto zolang hij zelf toegang tot die foto heeft. Daarna ziet iedereen zijn letter.

## Besluiten Wouter

1. **Opbouw (2026-11-08):** de foto staat gecentreerd bovenaan, met een menu. De naam staat er één keer en is bewerkbaar; "Bewaar" verschijnt pas na een wijziging. Het e-mailadres is alleen te lezen. Een melding staat bij het onderdeel. Dit is hetzelfde uitgangspunt als de bewerkschermen van WP28.
2. **Elke foto met toegang kan profielfoto worden (2026-11-08).** Dit draait WP17a besluit 10 en WP17b invariant 12 (alleen een eigen foto) terug. Zo werkte het ook in v1.
3. **De profielfoto blijft openbaar** (WP17a besluit 8): ook voor wie is uitgelogd en voor wie buiten de groep staat.
4. **Wie de toegang tot de foto kwijt is, krijgt de letter.**
5. **De eigenaar van de foto hoort het niet** (2026-11-11), net als in v1.

## Invarianten (draft)

1. **Kiezen met toegang.** `users.setProfilePhoto` neemt elke foto waar de caller foto-toegang toe heeft (`canAccessPhoto`). Zonder toegang, bij een onbekend id en bij een gewiste foto komt dezelfde weigering en verandert er niets. Zo is er geen bestaans-orakel.
2. **Eerst de melding.** Vóór het instellen zegt de app dat een profielfoto voor iedereen te zien is, ook buiten de groep. Bij de foto van een ander geldt dat ook voor die foto (de tekst: open vraag 3).
3. **Geen toegang meer, dan geen beeld, en dat regelt de backend.** Zodra de user geen foto-toegang meer heeft, geeft het openbare profielpad geen beeld meer en ziet iedereen de letter. Een filter in de app is niet genoeg. Toegang verlies je zo:
   - je bent geen lid meer van de groep;
   - de foto gaat uit het album;
   - het album of de groep wordt verwijderd;
   - de foto wordt gewist;
   - de eigenaar verwijdert zijn account.
4. **Alleen de actuele profielfoto.** Het openbare pad geeft nooit een vorig beeld en nooit een andere foto van de eigenaar (WP17a invariant 3). Het verraadt ook niet in welke groep de foto staat.
5. **De avatar ververst overal.** `profileVersion` verandert als het beeld wegvalt of terugkomt, niet alleen bij een nieuwe keuze (WP17b B1).
6. **Opbouw van de pagina** (besluit 1):
   - de naamvalidatie blijft die van WP15b;
   - een fout staat onder het veld;
   - onder het e-mailadres staat de zin dat je met dit adres inlogt;
   - "Account verwijderen" blijft een gevaarlijke rij in een eigen blok (WP29);
   - het werkt bij de grootste tekst, licht en donker (design.md).
7. **Gemigreerde profielfoto's vallen onder dezelfde regel.** Op prod heeft 1 user de foto van een ander lid (WP17a besluit 13). Is de toegang weg, dan krijgt ook hij de letter.

## Scope

- **In scope:**
  - de pagina Profiel, met het menu bij de foto (uploaden uit WP18, weghalen, en eventueel kiezen: open vraag 2);
  - "Als profielfoto" in het foto-menu, ook bij de foto van een ander;
  - in de backend: `setProfilePhoto` met toegang, de toegangscheck op het openbare profielpad, en `profileVersion`.
- **Bewust niet:**
  - Mijn foto's en een kiezer over al je foto's (WP17c);
  - de camera;
  - het e-mailadres wijzigen (dat hoort bij Clerk);
  - covers.

## Risico-assessment

- **security/privacy: hoog.** Het openbare pad zonder login toont nu ook beelden van andere leden. Daar zit de check of de toegang er nog is. Dit krijgt een red-team.
- **ops: laag.** Geen externe dienst, geen cron.
- **external deps: laag.** Geen nieuwe bibliotheek.
- **multi-user/concurrency: medium.** De toegang valt weg via andere flows: lid verwijderen en groep verlaten (WP28), uit album halen en wissen (WP17b), en account verwijderen (WP29).
- **data/schema-evolutie: laag tot medium.** De toegangscheck vraagt misschien dat de profielfoto naar een foto wijst in plaats van naar een beeld. Dan raakt het de WP12-transform, de losse gemigreerde profielfoto's en dev. A stelt dat vast, met een telling op de prod-export.
- **ops-runbook-impact:** geen, tenzij de transform verandert (dan de runbook van WP12).

## Open vragen voor A / Wouter

1. **Toegang kwijt: blijft de koppeling staan?** Krijgt het lid de toegang terug, dan komt de foto terug. Het alternatief is de koppeling wissen, als cascade in elke flow die toegang wegneemt. A adviseert, op grond van v1 en de cascade-matrix.
2. **Waar kies je de foto van een ander?** Alleen via het foto-menu ("Als profielfoto"), of ook vanuit het menu op Profiel?
3. **De tekst van de melding** bij de foto van een ander.

## Cross-refs

- [WP17a](./WP17a-fotos-bekijken.md): besluit 8, 10 en 13, invariant 3 en 16, en het beeldpad `/beeld/profiel/<userId>`.
- [WP17b](./WP17b-foto-acties.md): invariant 6 en 12, A-keuze 1, `profileVersion` (B1).
- [WP18](./WP18-foto-upload.md): profielfoto uploaden en weghalen (invariant 9, 10, 16, 21).
- [WP15b](./WP15b-profiel-instellingen-info.md): de naamvalidatie, `users.profile`.
- [WP28](./WP28-groepsbeheer.md): de bewerk-opbouw, lid verwijderen, groep verlaten.
- [`cascade-matrix.md`](../cascade-matrix.md): P5, U7, M2.
- Oude code (alleen A): `blob-images-api-user` (`getPhotoById`, `updateUser`), en het scherm Profiel in `clubalmanac-app`.

## Sessies

| Stap | Wie | Wat |
|---|---|---|
| 1 | regie | deze draft |
| 2 | A (`wp-a`) | spec-aanvulling (vraag 1 t/m 3, de pariteit van het scherm, de telling) en RED tests voor de backend en de pure app-logica |
| 3 | B (`wp-b`) | implementatie tot groen |
| 4 | audit | toetst B tegen spec en tests |
| 5 | red-team | zoekt een beeld via het openbare profielpad terwijl de user er geen toegang meer toe heeft: na vertrek, na uit album, na wissen, in een race en met een oud beeld. Zoekt ook een orakel voor toegang of groep. Krijgt alleen het productdoel en de diff. Het rapport gaat verbatim naar Wouter. |
| 6 | regie + Wouter | gate in de simulator tegen dev |

## Acceptance

- Tests: A bepaalt welke.
- Gate op dev (simulator, release-build):
  - Profiel: de opbouw volgens besluit 1, bij de grootste tekst, licht en donker;
  - de foto van een ander lid als profielfoto, met de melding; een ander lid en een uitgelogde user zien hem;
  - die foto uit het album halen: iedereen ziet de letter;
  - het lid uit de groep halen: iedereen ziet de letter;
  - eigen upload en weghalen werken nog (WP18).

---

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft.)
