# WP17b: Acties op foto's — menu, draaien, verwijderen, uit album, als cover of profielfoto

> Draft regie 2026-11-07. App-WP (zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4)). Bouwt op [WP17a](./WP17a-fotos-bekijken.md). De backend-mutations met hun gates bestaan al ([WP8](./WP8-photo-rotation.md), [WP24](./WP24-write-gates.md)); het zwaartepunt ligt in de app. WP17 is opnieuw gesplitst (besluit Wouter 2026-11-07): Mijn foto's, de kaart, de locatie en delen gaan naar WP17c. A → B → audit, TestFlight-gate.

## Productdoel

Een lid doet met een foto wat in v1 kon: draaien en spiegelen, uit een album halen, verwijderen, en als album- of groepscover of als profielfoto instellen. Hij ziet alleen de acties die hij mag, het resultaat is meteen overal te zien, en niets verdwijnt per ongeluk.

## Besluiten Wouter (2026-11-07, op A's vragen)

1. **Een foto wissen wist ook de profielfoto** van elke user die dat beeld als profielfoto heeft (A-keuze 1), zoals v1.
2. **Een actie in de selectie geldt per foto** (A-keuze 2): wat mag, gebeurt; wat niet mag, meldt de app met aantal en reden.
3. **Bevestiging bij uit album halen alleen bij de foto van een ander**: die kan een admin niet terugzetten. Verwijderen vraagt altijd bevestiging (invariant 2).
4. **"Publicaties" in het detail** (in welke albums staat deze foto) → WP17c.
5. **Toevoegen aan album in het selectiemenu** → WP17c, met Mijn foto's.
6. **Draaien vóór de formaten:** geen code in 17b. Het risico ontstaat met uploaden; WP18 kijkt opnieuw.
7. **Albumcover door het lid dat het album maakte** (ruimer dan v1): zo laten; op prod is iedereen admin.

## Invarianten

1. **Je ziet alleen wat je mag, en de backend beslist.** Het menu toont per foto alleen de acties die de user mag (eigenaar, admin van de groep, volgens de regels van WP8 en WP24). Het menu is gemak, geen gate: een actie die de backend weigert, geeft een NL-melding en verandert niets.
2. **Verwijderen vraagt eerst, en zegt wat er weggaat.** Na bevestiging is de foto overal weg: uit elk album, met zijn likes, en als cover gewist (cascade P3–P5). Een scherm dat de foto nog toont (raster, detail, een cover), crasht niet en laat hem verdwijnen.
3. **Uit album halen raakt alleen dat album.** De foto blijft bij de eigenaar en in de andere albums. Was hij de cover van dat album, dan is de cover weg; was hij de groepscover en staat hij nergens meer in de groep, dan ook die (AP4).
4. **Draaien en spiegelen zie je meteen, overal.** Raster, detail, covers en profielfoto tonen na de actie de nieuwe stand, zonder oude stand uit de cache (WP25 invariant 26). Twee keer een kwartslag is een halve slag (delta, WP8).
5. **Een cover kies je uit de groep.** Als albumcover alleen een foto uit dat album, als groepscover alleen een foto uit een album van die groep (WP24 A-keuze 2). Daarna ziet elk lid de nieuwe cover, in de tegels en bovenaan, zonder oude cover uit de cache.
6. **Profielfoto: alleen een eigen foto, en de user weet dat hij openbaar wordt.** Vóór het instellen zegt de app dat een profielfoto voor iedereen zichtbaar is, ook buiten de groep (WP17a besluit 8 en 10).
7. **Selecteren en dan één actie.** In het selectiemenu geldt elke actie per foto, met dezelfde gates. Lukt het voor een deel niet, dan zegt de app hoeveel en waarom, en blijft de rest gedaan.
8. **Wat een ander doet, zie je ook.** Haalt een admin een foto weg terwijl jij hem bekijkt, dan verdwijnt hij, en het detail toont een nette melding (live, WP15a).
9. **WP13 tot en met WP17a blijven werken**, met alleen A's bewuste aanpassingen aan bestaande tests.

## Edge cases + scope-uitsluitingen

- **In scope:** foto-menu in het detail en in het raster (lang drukken of een knop, pariteit door A), selectiemenu, de vijf acties hierboven, de meldingen.
- **Draaien vóór de formaten** (seconden na een upload): geaccepteerd in WP25 (§Edge cases): de foto kan scheef komen te staan en de user draait opnieuw. Upload komt pas in WP18; A beoordeelt of 17b hier iets moet doen.
- **De 3 gemigreerde groepscovers zonder album** (WP12b besluit 4): na T0 kiest een admin een nieuwe cover met deze WP. Geen eigen code nodig.
- **Gatetest** (WP16) is weg door de `reset` van WP12b. Regie maakt hem opnieuw vóór de gate.
- **Bewust niet:** Mijn foto's, kaart, locatie wijzigen, delen (→ WP17c). Uploaden (WP18). Album maken, wijzigen of verwijderen (Groepsbeheer). Melden (WP20). Ratings (WP19).

## Open vragen voor A (oude app en backend, rapporteren aan regie)

1. **Pariteit per actie:** wie mocht wat in v1 (eigenaar, admin, elk lid)? Wijkt v2 af (WP8, WP24), dan rapporteren; Wouter beslist. Op prod is elk lid admin (25 van 25, veldaudit WP12b), dus "admin" betekent daar iedereen.
2. **Menu en selectie:** waar zat het menu, welke acties zaten in het selectiemenu, en vroeg v1 om bevestiging bij verwijderen of uit album halen?
3. **Verwijderen door een admin:** mocht een admin de foto van een ander verwijderen, of alleen uit het album halen?
4. **Ontbreekt er een backend-functie of -vorm** voor een scherm (bijvoorbeeld een cover wissen: WP24 §Bewust niet zegt dat dat nu niet kan), noem hem; A schrijft er tests voor, B bouwt hem.
5. **Bestaans-orakels in `photos.rotate`, `update` en `remove`** (WP24 open vraag 4): nog open? Zo ja, hoort het hier of apart?

## Risico-assessment

- **security/privacy:** medium — de gates bestaan, maar de app moet ze niet ruimer laten lijken. Profielfoto maakt een beeld openbaar.
- **ops:** medium — verwijderen is onomkeerbaar en cascadeert.
- **external deps:** laag — geen nieuwe bibliotheek verwacht (delen en kaart zitten in WP17c).
- **multi-user/concurrency:** medium — twee admins tegelijk op een cover, een foto die verdwijnt terwijl het menu open staat, draaien door eigenaar en admin tegelijk (laatste wint, WP8).
- **data/schema-evolutie:** laag — geen schemawijziging verwacht.

## Werkwijze

| Stap | Wie | Wat |
|---|---|---|
| 1 | A | Spec-criticus (leest de oude app), open vragen, RED tests. |
| 2 | Wouter | Besluiten op A's vragen. |
| 3 | B | Impl. |
| 4 | Audit | Op spec, tests en impl. Red-team alleen als A een nieuw schrijfpad of een ruimere gate vindt. |
| 5 | Gate | Wouter, TestFlight, met Gatetest opnieuw op dev. |

## Cross-refs

- [WP8](./WP8-photo-rotation.md): rotate, delta, eigenaar of admin, §Frontend-contract.
- [WP24](./WP24-write-gates.md): gates op cover en `albums.addPhoto`, A-keuze 2, open vraag 4.
- [WP17a](./WP17a-fotos-bekijken.md): beeldpad, besluit 8 en 10, invariant 16.
- [WP25](./WP25-fotoformaten.md): cache-sleutel met formaat en stand (invariant 26), draaien vóór de formaten.
- [`cascade-matrix.md`](../cascade-matrix.md): P3–P5, AP4.
- Oude app (alleen A): `~/Code/v1/clubalmanac-app`.

## Acceptance

- Tests: invarianten 1–8 waar ze in de app of backend te pinnen zijn; bestaande suites groen.
- Gate (Wouter, TestFlight, dev): elke actie één keer, als eigenaar en als admin van andermans foto. Verwijderen en uit album halen met een cover; draaien zichtbaar in raster, detail en cover; profielfoto met de melding; selectiemenu met een deel dat niet mag.

---

## Spec-criticus aanvullingen (A, 2026-11-07)

Bronnen: de oude app (`components/PhotoMenu.jsx`, `PhotoSelectionHeader.jsx`, `screens/PhotoModal.jsx`, `PhotoDetail.jsx`, `PhotoEdit.jsx`, `PhotoSelectionMenu.jsx`, `AlbumPhotos.jsx`, `datastores/`), de oude backend (`blob-images-api-photos` op `hotfix`: `deletePhoto`, `fixPhotoRotation`, `libs/dynamodb-lib-single`; `blob-images-api-groups` op `dev`: `deleteAlbumPhoto`, `updateAlbum`, `updateGroup`; `blob-images-api-user` op `hotfixes`: `updateUser`; `blob-images-api`: `photoDelToCover`), en de huidige `convex/` en `app/`.

### Kernvondsten

1. **De app kan nu geen profielfoto zetten.** `users.updateProfile` neemt een `storageId`, en sinds WP17a invariant 10 kent de client geen `storageId` meer. Er is een pad op foto-id nodig (WP17a §Inventaris zag dat al). Zie vraag 4.
2. **Een foto wissen laat een profielfoto achter die naar niets wijst.** v1 wiste bij het wissen van een foto ook de profielfoto van elke user die die foto had (`photoDelToCover`, ook op `UBbase`). v2 wist het beeld (U7), maar laat `profilePhotoStorageId` staan (P5, `[GAP]`). Tot nu kon de app niets wissen; met 17b wel. Een lid dat de foto wist die zijn profielfoto is, ziet de letter (WP17a invariant 14), maar de rij wijst naar een gewist beeld. Dat geldt ook voor de gemigreerde profielfoto die de foto van een ander is (WP17a besluit 13). Zie A-keuze 1.
3. **De rol van de caller staat in geen read van het albumscherm.** Het menu heeft hem nodig (draaien, uit album, covers). `groups.listMine` geeft hem per groep, de album-reads niet. Het maker-veld van het album en `addedBy` staan er wel. B kiest de bron van de rol.
4. **v1 draaide in een eigen scherm en bewaarde één keer.** Links, rechts en spiegelen als voorbeeld, "opslaan" alleen als er iets veranderde, dan één aanroep. v1 stuurde de hoek tegen de klok in (Jimp). `photos.rotate` neemt hem met de klok mee, eerst spiegelen en dan draaien, op het beeld zoals de user het ziet (WP8). Wie de v1-omrekening overneemt, draait de verkeerde kant op.
5. **v1 vroeg geen bevestiging bij één foto verwijderen.** Alleen bij verwijderen in het selectiemenu ("definitief, ook uit alle albums en groepen") en bij melden. Uit album halen nooit. Invariant 2 is strenger dan v1, bewust.
6. **In het v1-detail zag een admin minder.** Daar stond de admin-vlag vast op false: geen albumcover of groepscover, en draaien alleen op een eigen foto. Die kon alleen via lang drukken in het raster. Niet overnemen.
7. **Draaien vóór de formaten** (WP25 §Edge cases). Het gaat alleen mis als het bestand een tag ongelijk aan 1 draagt én de user draait vóór `attachFormats`. Met 17b kan dat alleen bij een afgetekende foto die later toch formaten krijgt (`--unaccept`), en na WP18 in de seconden na een upload. Zie vraag 6.
8. **Breedte en hoogte na draaien** (buiten 17b). WP8 wisselt `width` en `height` bij een kwartslag; WP25 zet ze als de maten van de pixels vóór de draaiing. Na draaien betekent het veld iets anders dan na de formaten. De app gebruikt ze nu niet: de vorm komt uit het vak en `exifOrientation`. Voor de backlog.
9. **Twee keer tegelijk draaien is geen "laatste wint".** Convex voert de twee mutations na elkaar uit, en elk past zijn delta toe op de stand van dat moment. Beide draaiingen komen er dus op (correctie op §Risico). Wie als tweede bewaart, ziet een andere stand dan zijn voorbeeld. Geaccepteerd.

### Antwoorden op de open vragen

**1. Pariteit per actie.**

| Actie | v1 menu | v1 backend | v2 backend | Verschil |
|---|---|---|---|---|
| Draaien, spiegelen | eigenaar of admin (lang drukken), eigenaar (detail) | elk lid met foto-toegang | eigenaar, of admin van een groep met de foto in een album (WP8) | gelijk aan het v1-menu |
| Uit album | eigenaar (menu), admin (selectie) | eigenaar of admin | wie hem toevoegde, of admin | gelijk: alleen de eigenaar voegt toe (WP24 A-keuze 1) |
| Verwijderen | eigenaar | eigenaar | eigenaar | gelijk |
| Albumcover | admin | admin, foto-toegang | maker van het album of admin, foto in dat album | v2 ruimer: ook een lid dat het album maakte |
| Groepscover | admin | admin, foto-toegang | admin, foto in een album van de groep | gelijk |
| Profielfoto | iedereen, elke zichtbare foto | foto-toegang | alleen een eigen foto (WP17a besluit 10) | v2 strenger, bewust |
| Delen, locatie | | | | WP17c |
| Melden | niet-eigenaar | | | WP20 |

Op prod is iedereen admin. Daar maken alleen "verwijderen" (eigenaar) en "profielfoto" (eigen foto) verschil. Advies: de v2-backend volgen.

**2. Menu en selectie in v1.**
- Detail: een knop "…" rechtsboven opent het menu.
- Raster: lang drukken toont de foto met het menu eronder; een tik op de foto gaat naar het detail.
- Selectie: "selecteer" in de kop van het album, dan vinkjes, een teller en "…". Daarin: toevoegen aan album, uit album, overal verwijderen, melden. Een actie die niet voor álle geselecteerde foto's mocht, stond grijs.
- Bevestiging: zie kernvondst 5. Na een actie een korte melding, dan terug.

**3. Verwijderen door een admin:** nee. In v1 verwijderde alleen de eigenaar een foto; een admin kon hem uit het album halen. v2 is gelijk.

**4. Ontbrekende backend:**
- **Profielfoto op foto-id** (kernvondst 1): `users.setProfilePhoto({ photoId })`, invariant 12. A schrijft de tests, B bouwt hem.
- **Profielfoto vervalt als de foto gewist wordt:** A-keuze 1.
- **Een cover wissen:** niet nodig. Het v1-foto-menu wiste nooit een cover; dat zat in groep en album bewerken (Groepsbeheer).
- **De rol:** kernvondst 3, geen nieuwe functie nodig.

**5. Bestaans-orakels in `rotate`, `update` en `remove`:** nog open (backlog). 17b verandert niet wie een id kent: het menu staat op foto's die de user al ziet. Advies: apart laten. De app hoeft de reden van een weigering niet uit de fout te halen; een gewone `Error` heet in productie toch "Server Error". Wat niet mag, weet de app vooraf (invariant 10), dus een weigering is een race en krijgt één algemene melding.

### A-keuzes ter bevestiging

De tests staan in een eigen `describe` met "A-keuze n" in de naam.

1. **Een foto wissen wist ook elke profielfoto die dat beeld is** (v1-pariteit, kernvondst 2). In dezelfde transactie, voor elke user. Andere profielfoto's blijven. Geldt voor elk pad dat een foto wist: `photos.remove`, `users.deleteSelf` (U7) en de cron van FL1. Sluit de `[GAP]` in P5.
2. **Selectie per foto, niet alles of niets.** v1 zette een actie grijs als hij niet voor alle foto's mocht. Invariant 7 doet hem voor de foto's waar het mag, en zegt hoeveel niet en waarom. A volgt invariant 7: de app bepaalt vooraf met de regel van het menu welke foto's mogen, stuurt alleen die, en telt wat daarna nog faalt apart.

### Aanvullende invarianten

10. **Het menu is nooit ruimer dan de backend.** Toont het menu een actie op een foto, dan slaagt de mutation voor die user. Staat de foto alleen in dit album, dan geldt ook het omgekeerde: wat de backend toelaat, toont het menu. Staat de foto ook in een andere groep waar de user admin is, dan mag het menu strenger zijn (draaien).
11. **Draaien bewaart één keer, en het voorbeeld klopt.** Links, rechts en spiegelen in het draaischerm worden samen één `photos.rotate`. Na bewaren staat de foto precies zoals het voorbeeld. Komt het voorbeeld uit op de begintoestand, dan valt er niets te bewaren.
12. **Profielfoto op foto-id.** `users.setProfilePhoto({ photoId })` zet de profielfoto op het beeld van die foto, als de caller de eigenaar is (WP17a invariant 16). Een foto van een ander (ook met toegang), een onbekend en een gewist id geven dezelfde weigering en veranderen niets. Daarna volgt de avatar de stand van die foto, ook na draaien.

### Pariteit-checklist

**Foto-menu** (detail: knop "…"; raster: lang drukken)

| Oude app | Nieuw (17b) |
|---|---|
| Albumcover, Groepscover (admin) | Volgens invariant 10, in het detail en in het raster. Daarna een korte melding. |
| Profielfoto (iedereen) | Alleen op een eigen foto. Eerst de melding dat een profielfoto voor iedereen te zien is, ook buiten de groep (invariant 6), met annuleren. |
| Verwijder uit album (eigenaar) | Wie hem toevoegde, of admin. Bevestiging: vraag 3. |
| Draaien (eigenaar of admin) | Opent het draaischerm (invariant 11). |
| Locatie, Delen | WP17c |
| Meld als ongepast | WP20 |
| Verwijder overal (eigenaar, rood, onderaan) | Zo, met een bevestiging die zegt wat er weggaat: uit elk album, met de likes, als cover en als profielfoto. |
| Na een actie een melding, dan terug | Korte melding. Na verwijderen of uit album gaat het detail naar de volgende foto (WP17a). |
| Mislukt: "Helaas, niet gelukt" | Eén NL-melding, niets veranderd. |

**Draaischerm**

| Oude app | Nieuw (17b) |
|---|---|
| Foto groot; knoppen links, spiegelen, rechts | Zo |
| "opslaan" grijs zolang er niets verandert | Zo (invariant 11) |
| Voortgang "dit duurt even" (de server draaide pixels) | Niet nodig: één mutation |
| Na opslaan terug | Zo |

**Selectie** (albumscherm)

| Oude app | Nieuw (17b) |
|---|---|
| "selecteer" in de kop, vinkjes, teller | Zo |
| "…": toevoegen aan album, uit album, overal verwijderen, melden | Uit album en verwijderen. Toevoegen aan album: vraag 5. Melden: WP20. |
| Grijs als het niet voor alle foto's mag | Per foto (A-keuze 2) |
| Verwijderen met bevestiging | Zo, met het aantal |
| Voortgang "3/5 foto's verwijderd" | Na afloop: hoeveel niet, en waarom (invariant 7) |

### Edge cases

- **Menu open, en de foto verdwijnt** (een ander wist hem of haalt hem uit het album): het menu sluit; het detail volgt WP17a.
- **De rol verandert terwijl het menu open is:** het menu volgt de live rol. Een actie die toch geweigerd wordt, geeft de algemene melding.
- **Twee admins zetten tegelijk een cover:** de laatste wint, iedereen ziet live de laatste.
- **Profielfoto die zelf een foto is, en die foto draait:** de avatar draait mee (invariant 12, WP25 invariant 26).
- **Profielfoto, daarna de foto uit alle albums:** de profielfoto blijft. Het is een eigen beeld, en openbaar.
- **Groepscover, daarna de foto uit het laatste album van de groep:** AP4 wist de cover (bestaand).

### Open vragen voor Wouter (met advies)

1. **A-keuze 1: een foto wissen wist ook de profielfoto.** Advies: ja, v1-pariteit.
2. **A-keuze 2: selectie per foto.** Advies: ja, zoals invariant 7.
3. **Bevestiging bij uit album halen?** v1 vroeg niets. Haalt een admin de foto van een ander weg, dan kan hij hem niet terugzetten: dat kan alleen de eigenaar, en pas met WP17c. Advies: bevestiging bij een foto van een ander, niet bij een eigen foto.
4. **"Publicaties" in het detail** (in welke albums staat deze foto). WP17a schoof het naar 17b; deze draft noemt het niet. Het vraagt een nieuwe read met een eigen toegangsregel. Advies: naar WP17c.
5. **Toevoegen aan album in het selectiemenu.** v1 had het; deze draft noemt het niet. `albums.addPhoto` bestaat. Advies: naar WP17c, samen met Mijn foto's, waar v1 hetzelfde scherm "kies album" gebruikte.
6. **Draaien vóór de formaten** (kernvondst 7). Advies: geen code in 17b. WP18 kijkt opnieuw, want daar ontstaat het venster.
7. **Albumcover door een lid dat het album maakte** (v2 ruimer dan v1). Advies: zo laten; op prod is iedereen admin.

### Tests

| Bestand | Pint |
|---|---|
| `app/tests/photoActions.test.ts` | Pure logica in `app/src/lib/photoActions.ts`: het menu per rol, eigenaar, toevoeger en albummaker (invariant 1 en 10, orakel met de hand); de selectie (invariant 7, A-keuze 2); de draaiknoppen als één `photos.rotate` en de stand van het voorbeeld (invariant 11), tegen een orakel op een pixelrooster uit de EXIF-definitie |
| `tests/photoActions/menuMatchesBackend.test.ts` | Invariant 10: per rol en per actie toont het menu hem precies als de mutation slaagt; strenger mag bij een foto in een tweede groep. Invariant 11: de stand na `photos.rotate` is de stand van het voorbeeld. |
| `tests/users/setProfilePhoto.test.ts` | Invariant 12 |
| `tests/photos/deleteClearsProfile.test.ts` | A-keuze 1, via `photos.remove`, `users.deleteSelf` en de FL1-cron |

Geen UI-tests (app-WP). De schermen, de meldingen en de bevestigingen toetst de gate.

---

## Fix-cyclus 1 (A, 2026-11-08)

Twee bevindingen uit de audit, met akkoord van Wouter. N1–N3 en N5 blijven liggen.

### B1 (blocker): de avatar ververst niet na een nieuwe profielfoto

**Oorzaak.** De profiel-URL is per user altijd gelijk (`/beeld/profiel/<userId>`), en de avatar bouwt alleen opnieuw op als de stand of `hasFormats` wisselt. Kiest een user een nieuwe profielfoto met dezelfde stand en hetzelfde formaat-vlag, dan blijft overal het oude beeld staan: in het detail, op Profiel, in de ledenlijst en bij andere leden. Stond de avatar op de letter (een fout eerder), dan blijft die staan. Hetzelfde gebeurt bij "geen profielfoto" naar een foto zonder stand en zonder formaten, en bij een gewiste profielfoto zonder stand en zonder formaten: de user-vorm verandert dan helemaal niet.

**13. Een nieuw beeld laadt overal opnieuw, zonder beeld-id.**
- Elke user-vorm met een avatar (de zeven responses van WP25 invariant 19) krijgt `profileVersion`: een string, altijd aanwezig, ook zonder profielfoto.
- Hij is ondoorzichtig: er staat geen beeld-id, foto-id of formaat-id in, ook niet als deel ervan (WP17a invariant 10).
- Voor één user is hij op hetzelfde moment in elke response gelijk.
- Hij verandert als het beeld achter de avatar verandert: een ander beeld, of geen beeld meer.
- Hij blijft gelijk als er aan het beeld niets verandert. Dat geldt ook bij een andere naam, en bij een nieuwe profielfoto van een ander.
- Bij draaien mag hij veranderen; de stand wisselt dan al.
- Hoe B hem maakt, is vrij. Een teller, een tijdstip of een hash van het beeld-id mag allemaal, zolang het id er niet uit terug te halen is.

**14. De avatar volgt `profileVersion`, op de hele avatar.**
- `ProfileAvatar` krijgt `version`, van hetzelfde object als de stand: `version={X.profileVersion}` naast `exifOrientation={X.profileOrientation}`.
- Wisselt de versie, dan laadt het beeld opnieuw (een nieuw beeld-element of een andere bron).
- Stond de avatar op de letter na een fout, dan probeert hij het nieuwe beeld weer.
- Zelfde versie: geen herlaad, en na een fout blijft de letter staan (geen lus).

### S1 (should-fix): de selectiebalk blokkeert niet tijdens een actie

**Oorzaak.** `useSelectionActions` start bij elke tik opnieuw. Een dubbele tik op "Uit album" stuurt elke foto twee keer. De tweede ronde faalt, en de melding zegt dan dat het mislukte.

**15. Eén selectie-actie tegelijk.**
- Zolang een selectie-actie loopt (van de eerste mutation tot de melding), doet een nieuwe aanroep niets: geen mutation, geen melding.
- Dat geldt ook vóór de volgende render. Een tweede tik op de oude functie wordt dus ook genegeerd. Een vlag in state alleen is dan niet genoeg.
- Na de melding kan een nieuwe actie.
- Annuleert de user de bevestiging, dan loopt er niets, en kan het meteen opnieuw.
- De balk laat zien dat hij bezig is. Dat staat op de checklist en wordt getoetst bij de gate.

### Aanpassingen aan bestaande tests

- `tests/readWhitelist/_world.ts`: `profileVersion` in `SHAPE.publicProfile`, `ownProfile` en `landingInviter`.
- `tests/invites/publicGet.test.ts`: `profileVersion` in de allow-list van de afzender.

### Tests

| Bestand | Pint |
|---|---|
| `tests/users/profileVersion.test.ts` | Invariant 13 |
| `app/tests/profileAvatarVersion.test.ts` | Invariant 14, met een kleine reconciler: een andere key is een nieuw component met nieuwe state, zoals in React |
| `app/tests/selectionBusy.test.ts` | Invariant 15 |
