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
6. **Een standaard-knor blijft** (2026-11-11, A-keuze 1). Een los beeld zonder foto blijft zichtbaar; dat geldt voor 9 van de 20 prod-users.
7. **Toegang kwijt wist de koppeling** (2026-11-11, red-team punt 1). Een foto die de eigenaar terugtrok, wordt niet vanzelf weer openbaar. Dit vervangt "toegang terug, foto terug" (A-advies vraag 1).
8. **Een gemelde foto wordt geen profielfoto** (2026-11-11, red-team punt 2). Kiezen wordt geweigerd, en zolang de melding loopt is hij niet te zien.

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

## Spec-criticus aanvullingen (A, 2026-11-11)

Bronnen: v1 `blob-images-api-user` (`updateUser.js`, `getPhotoById`), de streams `photoDelToCover` en `memberDelToAlbumPhoto` in `blob-images-api`, en `Profile.jsx`, `ProfileEditForm.jsx` en `PhotoMenu.jsx` in de oude app. De huidige `convex/users.ts`, `convex/images.ts` en `convex/lib/profilePhoto.ts`. Telling: `scripts/wp27/profiel-tel.mjs` op het prod-extract van 2026-11-06.

### Kernvondsten

1. **v1 keek alleen bij het kiezen naar de toegang.** `updateUser` nam een foto als de user de eigenaar was of lid van een groep waarin de foto in een album stond. Daarna keek v1 nooit meer. Na vertrek of na uit album halen bleef de profielfoto staan. Alleen het wissen van de foto haalde hem weg. Besluit 4 is dus strenger dan v1.
2. **v1 bood "Profielfoto" in het foto-menu aan iedereen**, ook bij de foto van een ander. Er kwam geen melding vooraf, alleen "Je profielfoto is aangepast" na afloop.
3. **9 van de 20 prod-users hebben een standaard-knor als profielfoto.** Dat zijn 7 verschillende plaatjes en geen foto's. Een strikte regel ("alleen een beeld met toegang tot een foto") geeft hun vanaf T0 de letter. Zie A-keuze 1.
4. **De toegangscheck moet op drie plekken tegelijk.** Het gaat om het profielpad (`profileImage`), het profielpad met een formaat (`profileImageInFormat`) en de avatar-velden in elke user-vorm (`profileVersion`, `profileHasFormats`, `profileOrientation`). Mist er één, dan verraadt de vorm een verborgen foto (een versie die niet "0" is, met een letter in beeld), of geeft het formaat-pad toch de bytes.
5. **Bestaande tests pinden "alleen een eigen foto"** (WP17b invariant 12). Ze zijn aangepast: `tests/users/setProfilePhoto.test.ts`, `app/tests/photoActions.test.ts`, en drie gevallen in `tests/photoFormats/profileOrientation.test.ts` waar de rij van een ander nu in een gedeeld album staat.

### Advies open vraag 1: de koppeling blijft staan

**Advies: de koppeling niet wissen. De backend kijkt bij elke keer lezen of de toegang er nog is.**

- **Eén plek in plaats van zes cascades.** Toegang valt weg via lid verwijderen, vertrekken (ook M1: de foto's van de eigenaar gaan uit de albums), uit album halen, album wissen, groep wissen, foto wissen en account verwijderen. Vergeet een cascade er één, dan lekt het beeld. Een check bij het lezen kan niets vergeten.
- **Toegang terug, foto terug.** Dat staat zo in het productdoel.
- **Geen race.** Elke lezing ziet de stand van dat moment.
- **Kosten:** nul. Wel wat meer lezen per avatar (lidmaatschap en albums van één foto). Met 16 users merk je dat niet.
- Wissen van de foto blijft de koppeling wissen (P5, zoals v1).

### Advies open vraag 2: de foto van een ander kies je alleen in het foto-menu

**Advies: alleen via "Als profielfoto" in het foto-menu.** Het menu op Profiel houdt uploaden (WP18) en weghalen. Zo werkte v1 ook. Een kiezer over al je foto's hoort bij WP17c.

### Advies open vraag 3: de tekst van de melding

- **Eigen foto** (zoals nu): *"Je profielfoto is voor iedereen te zien, ook buiten de groep."*
- **Foto van een ander:** *"Deze foto is van Bob. Als profielfoto is hij voor iedereen te zien, ook buiten de groep. Bob krijgt daar geen bericht van."*
  - Zonder naam: "een ander lid".
  - De laatste zin volgt uit besluit 5, zodat het lid zelf kan beslissen of hij het vraagt.

### Telling op prod (extract 2026-11-06, 20 users)

| Profielfoto | Users | Vanaf T0 |
|---|---|---|
| geen | 1 | letter |
| standaard-knor (7 plaatjes, geen foto) | 9 | knor (A-keuze 1) |
| eigen foto | 9 | foto |
| foto van een ander, in een album van een gedeelde groep | 1 | foto (invariant 7) |
| foto van een ander, zonder toegang | 0 | — |

Bij alle 10 foto's wijst de v1-`photoId` naar precies die foto, en geen beeld zit onder meer dan één foto. Een verwijzing naar de foto zou dus netjes over te zetten zijn, maar de knorren hebben geen foto. **Advies: de verwijzing blijft het beeld.** Er verandert niets aan het schema, aan de WP12-transform, aan dev en aan de runbook. Zie A-keuze 2.

### A-invarianten (aanvulling op de draft)

1. **Eén regel voor alles wat een avatar toont.** Het profielpad, het profielpad met een formaat (ook over http) en de avatar-velden volgen dezelfde regel. De uitkomst hangt niet af van wie kijkt: uitgelogd, een medelid en iemand buiten de groep zien hetzelfde.
2. **Verborgen is hetzelfde als geen.** Is de toegang weg, dan is alles gelijk aan een user zonder profielfoto: hetzelfde 404-antwoord, `profileVersion` "0", `profileHasFormats` false, geen `profileOrientation`. Zo is er geen orakel tussen "geen foto" en "verborgen foto".
3. **Toegang terug, beeld terug.** Het beeld komt terug met dezelfde `profileVersion` als ervoor.
4. **Toegang via een andere groep telt.** Gaat een lid uit groep A, maar staat de foto ook in een album van groep B waar hij lid van is, dan blijft het beeld.
5. **Een eigen foto blijft altijd**, ook in geen album en zonder groep (de eigenaar heeft altijd toegang).
6. **Hoe de koppeling is gezet, maakt niet uit.** Gemigreerd, via `setProfilePhoto` of via `updateProfile`: dezelfde regel.
7. **Geen terugval.** Verborgen betekent de letter, nooit de vorige profielfoto of een andere foto.
8. **`setProfilePhoto` weigert met één uitkomst en verandert dan niets.** Dat geldt voor:
   - een foto zonder toegang;
   - een foto van een ander die in geen album staat;
   - een onbekend id en een gewist id;
   - uitgelogd.
9. **`updateProfile` met een beeld blijft alleen voor een eigen beeld** (WP24 invariant 8). De app kent geen beeld-ids. De foto van een ander gaat alleen via `setProfilePhoto` op foto-id.
10. **App:**
    - "Als profielfoto" staat bij elke foto in een album, voor elke rol.
    - Bij de foto van een ander noemt de melding de eigenaar (vraag 3).
    - Het menu op Profiel heeft "uploaden" en, als er een beeld is, "weghalen" (vraag 2).
    - "Bewaar" verschijnt pas als de naam anders is dan de bewaarde naam. Spaties aan het begin of eind tellen niet mee, zoals in de backend (WP15b).

### A-keuzes

1. **Een los beeld blijft zichtbaar.** Een beeld zonder foto (de knorren, of een ander los gemigreerd beeld) is van niemand, dus is er geen toegang die wegvalt. Nieuwe losse koppelingen kunnen niet ontstaan: `setProfilePhoto` en `updateProfile` nemen alleen een beeld met een foto, en een gewiste foto wist de koppeling (P5). *Wouter beslist.* Het alternatief is dat 9 users vanaf T0 de letter krijgen.
2. **Toegang tot minstens één foto met dat beeld is genoeg.** In v2 ontstaan geen twee foto's met hetzelfde beeld (alleen een upload maakt een foto, met een nieuw beeld), en op prod is het er 0 keer. Dit vraagt geen schema-wijziging.
3. **Een verborgen koppeling geeft op Profiel geen "weghalen".** Het lid ziet de letter. Een nieuwe upload vervangt de koppeling. Krijgt hij de toegang terug, dan is de foto er weer (vraag 1).

### Scherm Profiel (pariteit)

| v1 | v2 (besluit 1) |
|---|---|
| Lijst: e-mailadres, laatste bezoek, webmaster-label | Foto gecentreerd bovenaan met een menu, de naam één keer (bewerkbaar), het e-mailadres alleen te lezen met de zin over inloggen |
| Apart scherm "Profiel bewerken": foto (bibliotheek of camera, of weghalen), naam, knop "Naam en foto opslaan" | Op Profiel zelf. "Bewaar" alleen na een wijziging. Geen camera (scope). Een melding bij het onderdeel, geen pop-up |
| Rijen: Mijn groepen, Uitnodigingen, Meldingen, Wachtwoord | Niet op Profiel. Wachtwoord bestaat niet (Clerk-code). Groepen en uitnodigingen staan elders in de app |
| Uitloggen | Instellingen (WP15b), niet op Profiel |
| Account verwijderen (rood) | Gevaarlijke rij in een eigen blok (WP29) |
| Foto-menu "Profielfoto" voor iedereen, zonder melding | "Als profielfoto" bij elke foto in een album, met de melding (vraag 3) |

"Laatste bezoek" en het webmaster-label staan in v2 niet op Profiel. Dat is buiten WP27 gelaten.

### Tests (RED)

- `tests/users/profileAccess.test.ts` (nieuw): de toegangsregel, na elke manier van toegang verliezen, met terugkomst, een andere groep, een eigen foto, een knor, een gemigreerde foto en het http-pad.
- `tests/users/setProfilePhoto.test.ts`: herschreven op invariant 8.
- `tests/photoFormats/profileOrientation.test.ts`: drie gevallen geven Owen toegang tot de rij van een ander (wat ze pinnen, blijft gelijk).
- `app/tests/photoActions.test.ts`: "Als profielfoto" voor elke rol.
- `app/tests/profileEdit.test.ts` (nieuw, module `app/src/lib/profileEdit.ts`): naam gewijzigd, de melding en het menu op Profiel.

### Voor de red-team

Het beeld verdwijnt voor iedereen. Een buitenstaander ziet dus dat een lid de toegang kwijt is. Dat volgt uit besluit 3 en 4 samen, en zegt niet welke groep. Er is geen orakel tussen "geen foto" en "verborgen" (invariant 2).
