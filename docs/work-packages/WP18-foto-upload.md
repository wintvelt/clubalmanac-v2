# WP18: Foto's uploaden, en een profielfoto uploaden of verwijderen

> Draft regie 2026-11-08. App-WP (zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4)), met een stuk backend. De upload zelf bestaat al: `POST /upload` in `convex/http.ts`, met een reservering per upload-id tegen dubbele foto's ([`migratie-plan-convex.md`](../migratie-plan-convex.md) §upload). Na de upload maakt de backend de formaten ([WP25](./WP25-fotoformaten.md)) en leest de metadata. Het zwaartepunt ligt in de app. A → B → audit → red-team op de upload-keten → TestFlight-gate. Eigen branch `wp18`.

## Productdoel

Een lid zet foto's van zijn iPhone in een album van zijn groep. Ze staan rechtop, met hun datum, en de andere leden zien ze. Mislukt er iets, dan ziet hij welke foto's, en kan hij die opnieuw proberen zonder dat er een foto dubbel komt. Daarnaast kan hij een eigen profielfoto uploaden of zijn profielfoto weghalen.

## Besluiten Wouter (2026-11-08, op A's advies)

1. **Profielfoto is een gewone eigen foto** (upload zonder album, dan `users.setProfilePhoto`). Weghalen haalt alleen de koppeling weg.
2. **Locatie bewaren**, als aparte headers naast de opnamedatum.
3. **Achtergrond:** na terugkeer noemt de app wat niet lukte, en de user probeert opnieuw. Het scherm blijft wakker tijdens een ronde. Een ronde onthouden over een herstart heen hoeft niet.
4. **A-keuzes 1–4 bevestigd:** upload en album in één verzoek, de opnamedatum als header, elke foto JPEG met langste zijde hooguit 4032 zonder EXIF, grens 15 MiB.

## Invarianten

1. **Geen dubbele foto's.** Eén keuze van één foto levert hoogstens één foto in de backend en hoogstens één keer in het album, ook na opnieuw proberen, een weggevallen netwerk of een dubbele tik.
2. **Geen stille mislukking.** Na een upload-ronde weet de user per foto of hij in het album staat. Wat niet lukte, noemt de app met aantal en reden in het NL, en hij kan het opnieuw proberen. "Klaar" betekent: in het album, niet alleen geüpload.
3. **Rechtop.** Een foto staat in raster, detail en cover zoals hij op de iPhone stond, ook een staande HEIC rechtstreeks uit de camera (uit de gate van WP25).
4. **Datum en locatie.** De datum waarop de foto is gemaakt blijft bewaard (de sortering en de jaar-indeling hangen eraan). Voor de locatie: zie open vraag 2.
5. **Alleen in een album waar je lid bent.** De keuze toont alleen albums van eigen groepen; de backend weigert de rest (bestaande gate van `albums.addPhoto`).
6. **Alleen beelden.** Geen video (zoals v1). De backend neemt geen ander bestandstype of een te groot bestand aan, ook niet van een client die de app omzeilt.
7. **Fotolimiet.** Bereikt de user zijn limiet, dan zegt de app dat in het NL, en de foto's die al binnen waren blijven staan.
8. **De andere leden zien de nieuwe foto's** live, en de teller van het album (ongelezen) loopt op. Na openen staat hij weer op nul (uit de gate van WP17a).
9. **Profielfoto uploaden.** Na het kiezen ziet de user eerst dat een profielfoto voor iedereen te zien is (zoals WP17b invariant 6). Daarna staat de nieuwe avatar overal (WP17b fix-cyclus 1: `profileVersion`).
10. **Profielfoto weghalen.** Daarna toont de app overal de letter, en de backend geeft geen beeld meer voor die user. Of het beeld zelf weggaat: zie open vraag 1.
11. **Toestemming.** Weigert de user toegang tot zijn foto's, dan legt de app uit waarom en geeft een link naar Instellingen (zoals v1).

## Edge cases + scope-uitsluitingen

- **In scope:**
  - Uploaden vanuit een album (de knop "+" met dat album als bestemming) en vanuit de tab Nieuwe foto's (album kiezen). WP15a liet de route open voor die context.
  - Meerdere foto's in één keer kiezen, met een teller voor klaar en mislukt, en daarna "naar album" of "meer foto's".
  - HEIC omzetten naar JPEG in de app (WP25: HEIC decoderen in de backend loopt boven het geheugen).
  - Profielfoto uploaden en weghalen vanuit Profiel.
- **Te bepalen door A en Wouter:**
  - De app gaat naar de achtergrond of wordt gesloten tijdens een reeks: wat gebeurt er met de rest? Zie open vraag 3.
  - Een foto is geüpload maar het toevoegen aan het album mislukt: het opnieuw proberen moet de bestaande foto in het album zetten, niet een tweede uploaden (invariant 1).
  - Draaien vóór de formaten (WP25 §Edge cases, WP17b besluit 6): met uploaden ontstaat het venster echt. Als de app JPEG uploadt zonder stand-tag, verdwijnt het risico misschien vanzelf. A beoordeelt.
  - Na draaien betekenen `width` en `height` iets anders dan na de formaten (WP17b-A, backlog-kandidaat). A beoordeelt of WP18 het raakt.
- **Bewust niet:**
  - Een nieuw album maken in de album-keuze (Groepsbeheer). Mijn foto's en "ongepubliceerde foto's" (WP17c). Video (WP21). Uploaden in de webapp (Track B).

## Open vragen voor A (oude app en backend, rapporteren aan regie)

- Hoe deed v1 de upload: kiezen, omzetten, verkleinen, volgorde, opnieuw proberen, wat bij de achtergrond? Wat zag de user bij een fout?
- Wat bewaarde v1 van de EXIF: datum, locatie, stand? Werd de locatie getoond aan andere leden?
- Hoe werkte de profielfoto in v1: een apart beeld (niet in een album), of een foto uit de eigen foto's? Wat gebeurde er bij weghalen met het beeld?
- Welke fotolimiet had v1, en wat zag de user als die vol was?
- Wat vangt de huidige `POST /upload` al af (auth, upload-id, limiet), en wat niet (type, grootte, Convex' maximum per verzoek)?

## Open vragen voor Wouter (A geeft advies)

1. **Profielfoto: apart beeld of gewone foto?** Een geüploade profielfoto als gewone eigen foto (dan telt hij mee voor de limiet en staat hij later in Mijn foto's), of als apart beeld dat alleen avatar is. En bij weghalen: het beeld wissen, of alleen de koppeling.
2. **Locatie uit de foto.** Bewaren (nodig voor de kaart in WP17c, maar dan zien leden waar een foto is gemaakt) of weglaten. Omzetten naar JPEG in de app kan de EXIF kwijtraken; dan is bewaren een keuze die code vraagt.
3. **Achtergrond.** Moet een reeks doorgaan als de app naar de achtergrond gaat, of is "de app noemt na terugkeer wat niet lukte, en je probeert opnieuw" genoeg?

## Risico-assessment

- **security/privacy:** medium — `POST /upload` is een publiek pad dat bestanden aanneemt: type, grootte en het recht op het album zijn gates. Een profielfoto is openbaar. De locatie in een foto is privacy-gevoelig (vraag 2). Toegangsdefinities (work-package-specs): komt er een nieuw pad voor de profielfoto, dan geldt de standing rule.
- **ops:** hoog — stil falen is mogelijk: een reeks breekt af als iOS de app stopt; de upload lukt maar het album-koppelen of de formaten niet; het netwerk valt weg tussen versturen en antwoord. Daarom een red-team op de keten.
- **external deps:** medium — nieuwe native onderdelen in de app (fotokiezer, omzetten en verkleinen), dus een nieuwe EAS-build; de iOS-toestemming voor foto's; het maximum van Convex per HTTP-verzoek.
- **multi-user/concurrency:** medium — opnieuw proberen terwijl de eerste poging nog loopt (de reservering geeft 409), de limiet bij gelijktijdige uploads, en de teller bij andere leden.
- **data/schema-evolutie:** laag — hooguit een veld of pad voor de profielfoto (vraag 1). Bestaande data verandert niet.
- **ops-runbook-impact:** geen nieuwe env-vars verwacht. Nieuwe native modules en de toestemmingstekst voor de fotobibliotheek (`app.json`) gaan mee in de EAS-build; B noemt ze in de closeout.

## Werkwijze

| Stap | Wie | Wat |
|---|---|---|
| 1 | A | Spec-criticus (leest de oude app en backend), pariteit-checklist, advies op de open vragen, RED tests voor logica (upload-ids, opnieuw proberen, telling, backend-gates). |
| 2 | Wouter | Besluiten op de open vragen. |
| 3 | B | Impl, en zelf in de simulator kijken of de schermen renderen. |
| 4 | Audit | Op spec, tests en impl. |
| 5 | Red-team | Op de upload-keten: dubbel, half, stil falen, een client die de app omzeilt. |
| 6 | Gate | Wouter, TestFlight, dev. |

## Cross-refs

- [`migratie-plan-convex.md`](../migratie-plan-convex.md) §upload: `POST /upload`, reserveringspatroon, `uploadIdempotency`.
- [`cascade-matrix.md`](../cascade-matrix.md): UI1 (opruimen van reserveringen), P3–P5.
- [WP25](./WP25-fotoformaten.md): formaten na de upload, te grote HEIC, edge case draaien vóór de formaten.
- [WP17a](./WP17a-fotos-bekijken.md): beeldpad, profielfoto openbaar en alleen een eigen beeld (invariant 16), de geschrapte teller-gate.
- [WP17b](./WP17b-foto-acties.md): `setProfilePhoto`, `profileVersion`, besluit 6.
- [WP13](./WP13-app-scaffold-auth.md) §pariteit: "Nieuwe foto's". [WP15a](./WP15a-navigatie-subscriptions.md): de "+"-route.
- Oude app en backend (alleen A): `~/Code/v1/clubalmanac-app`, `~/Code/v1/blob-images-api-photos`, `~/Code/v1/blob-images-api-user`.

## Acceptance

- Tests: invarianten 1, 2, 5, 6, 7 en 10 waar ze in backend of app-logica te pinnen zijn; bestaande suites groen.
- Gate (Wouter, TestFlight, dev, Gatetest):
  - Drie foto's uploaden in "Gatetest nu", waaronder een staande HEIC rechtstreeks uit de camera: rechtop, met de goede datum.
  - Een reeks met het netwerk halverwege uit (vliegtuigmodus): de app noemt wat niet lukte; opnieuw proberen geeft geen dubbele foto's.
  - Met een tweede account: de teller van het album loopt op en staat na openen op nul.
  - Profielfoto uploaden (met de melding) en weghalen: de avatar volgt overal.
  - Toestemming eerst weigeren: uitleg en link naar Instellingen.
  - Wat viel op.

---

## Spec-criticus aanvullingen (A, 2026-11-08)

Bronnen: de oude app (`screens/Add.jsx`, `SelectAlbum.jsx`, `components/ProfileEditForm.jsx`, `fields/PhotoField.jsx`, `datastores/images.js`, `lib/images.js`, `PhotoDetail.jsx`, `AlbumMap.jsx`), de oude backend (`blob-images-api-user`: `getUploadUrl`, `updateUser`; `blob-images-api-photos`: `createPhoto`), en de huidige `convex/` (`http.ts` `/upload`, `uploads.ts`, `photos.ts`, `photoMetadata.ts`, `albums.addPhoto`, `users.ts`) en `app/`.

### Kernvondsten

1. **De app kan geen profielfoto weghalen.** `users.updateProfile` slaat een ontbrekend veld over en kan het beeld dus niet leegmaken. Er is geen ander pad. Invariant 10 vraagt een nieuwe mutation (A-invariant 16).
2. **Opnieuw proberen na een gelukte upload kan "limiet bereikt" geven.** `/upload` toetst de limiet vóór het opzoeken van de upload-id. Een user op 999 van 1000 uploadt de laatste foto; het antwoord gaat verloren; de herhaling met dezelfde id krijgt 403 in plaats van de bestaande foto. De app meldt een limiet en de foto staat niet in het album (invariant 1 en 2). A-invariant 12.
3. **Een afgebroken verzoek blokkeert een herhaling 30 minuten.** `/upload` leest de body pas na de reservering, buiten de opruiming. Breekt de verbinding tijdens het versturen af, dan blijft de reservering `in_progress` en krijgt elke herhaling 409 tot de cron (UI1). Juist de vliegtuigmodus-gate raakt dit. A-invariant 13.
4. **`/upload` neemt elk bestand aan.** Geen controle op type of grootte; alleen het platform weigert boven ~20 MiB, met een fout die de app niet herkent (migratie-plan §upload). Een video met `Content-Type: image/jpeg` wordt een foto zonder formaten. A-invariant 14.
5. **Twee stappen geven een halve toestand die de app niet herkent.** Met upload en daarna `albums.addPhoto` kan een foto bestaan zonder album. Gaat het antwoord van `addPhoto` verloren, dan weigert de herhaling met "Foto zit al in dit album". Die gewone `Error` heet in productie "Server Error", dus de app ziet een fout waar het gelukt is. Wordt de app gesloten tussen de stappen, dan staat de foto in geen album en ziet de user hem nergens (Mijn foto's is WP17c). Zie A-keuze 1.
6. **Omzetten in de app wist de EXIF.** `expo-image-manipulator` schrijft geen metadata mee. Zonder EXIF vindt `extractMetadata` geen datum (de sortering en jaar-indeling vallen weg, invariant 4) en geen locatie. Voor HEIC leest de backend nu al niets (`extractMetadata` slaat HEIC over). v1 stuurde datum en GPS uit de kiezer als aparte headers mee (`lib/images.js`). Zie A-keuze 2 en vraag 2.
7. **Toestemming is met de systeemkiezer meestal niet nodig.** Op iOS opent `launchImageLibraryAsync` de systeemkiezer zonder toestemming; de app krijgt alleen de gekozen foto's. iOS vraagt wel toestemming als de app het originele bestand opvraagt (bijvoorbeeld HEIC als origineel). v1 vroeg altijd toestemming en blokkeerde het scherm zonder. Invariant 11 geldt alleen als B een pad kiest dat toestemming vraagt. Dan moet de gate-stap "eerst weigeren" ook echt een weigering kunnen geven. Anders vervalt die gate-stap.
8. **v1 meldde een mislukking niet echt.** Alle foto's tegelijk, daarna "3/5 foto's verwerkt, 2 fouten" en toch "✅ toegevoegd aan album". Geen namen, geen reden, geen opnieuw proberen. Invariant 2 is strenger, bewust.

### Antwoorden op de open vragen voor A

**Upload in v1.** Het scherm "Nieuwe foto's" vroeg bij openen toestemming en opende daarna meteen de kiezer: meerdere foto's, alleen beelden, kwaliteit 1, met EXIF. De bytes gingen ongewijzigd naar S3 (geen omzetten of verkleinen). Album, datum en GPS gingen als S3-metadata mee. Een S3-trigger maakte de foto en zette hem in het album als de user lid was; een niet-lid kreeg stil een foto zonder album. Alle foto's tegelijk, zonder upload-id; opnieuw proberen bestond niet. Op de achtergrond gebeurde niets bijzonders: wat brak, telde als fout.

**EXIF in v1.** Uit de kiezer: `DateTimeOriginal` (alleen de datum bewaard), GPS-breedte en -lengte, en daaruit een adres. De stand werd niet bewaard. Leden zagen het adres in het detail en de foto op de albumkaart. De eigenaar kon de locatie aanpassen. v2 toont nu `locationLabel` in het detail aan elk lid met toegang.

**Profielfoto in v1.** Een gewone eigen foto: dezelfde upload (`action: usercover`), een foto-rij bij de eigenaar, telde mee voor de limiet, en daarna werd die foto de profielfoto. De kiezer liet bijsnijden toe; een camera-knop kon ook. Weghalen zette alleen de koppeling leeg (`updateUser` met `photoId: null`); de foto bleef.

**Fotolimiet in v1.** Eén getal voor iedereen (`maxUserPhotos`, env-var), getoetst bij het aanvragen van de upload-url, met een kleine telfout (`>` in plaats van `>=`). De app zei er niets over: de upload telde gewoon als fout. v2: `photoLimit` per user, standaard 1000. De melding in het NL is nieuw (invariant 7).

**Wat `/upload` nu afvangt.** Wel: inloggen (401), een lege upload-id (400), de limiet (403, ook in de transactie), een tweede verzoek met dezelfde id (de bestaande foto, of 409 als het eerste nog loopt), de upload-id per user. Niet: type, grootte, album, en de gevallen uit kernvondst 2 en 3. Het platform weigert boven ~20 MiB vóór de handler.

### A-keuzes ter bevestiging

De tests staan in een eigen `describe` met "A-keuze n" in de naam.

1. **Upload en album in één verzoek.** `/upload` neemt een optioneel album (header `X-Album-Id`). Met album komen de foto en zijn plek in het album in één transactie, of geen van beide. "Klaar" (invariant 2) is dan gewoon een 200. Een herhaling met dezelfde upload-id geeft de bestaande foto en zet hem niet nog eens in het album. Zonder album (de profielfoto) blijft het zoals nu. Dit sluit kernvondst 5 en is v1-pariteit (v1 koppelde ook in de backend). Het alternatief is twee stappen, met een `addPhoto` die "staat er al in" herkenbaar maakt én een app die halve foto's onthoudt over een herstart heen. Dat is meer code en meer stil falen.
2. **De opnamedatum als header.** De app stuurt `DateTimeOriginal` uit de kiezer letterlijk mee (header `X-Taken-At`, EXIF-vorm `JJJJ:MM:DD UU:MM:SS`). De backend leest hem zoals `exif-parser` een EXIF-datum leest (de klokwaarde als UTC), zodat een JPEG met EXIF en een header dezelfde `takenAt` geven. Draagt het bestand zelf een datum, dan wint die. Een header die geen echte datum is, telt niet en is geen fout. v1 deed hetzelfde.
3. **De app zet elke foto om, ook een JPEG.** Eén pad: JPEG, langste zijde hooguit 4032 (een iPhone-foto van 12 MP blijft heel, 24 en 48 MP worden kleiner), nooit groter maken, verhouding gelijk. Het resultaat draagt geen EXIF, dus geen GPS en geen stand-tag in de bytes. Daarmee is het venster "draaien vóór de formaten" voor app-uploads dicht, als de pixels rechtop staan. B controleert in de simulator dat een staande HEIC als staande JPEG zonder tag ≠ 1 aankomt; anders werkt WP25 de tag nog af en blijft het venster open.
4. **Grens 15 MiB.** Boven 15 MiB weigert `/upload` met een eigen antwoord. Een omgezette foto van 4032 is een paar MB; de grens raakt alleen een client die de app omzeilt.

### Aanvullende invarianten

12. **Een herhaling geeft de bestaande foto, ook op de limiet.** Een upload-id waarvan de foto al gemaakt is, geeft die foto terug, ook als de user nu op of over zijn limiet zit. Geen tweede foto, geen tweede telling.
13. **Een afgebroken verzoek laat geen reservering achter.** Breekt het lezen van de body af, dan kan dezelfde upload-id meteen opnieuw (geen 409 tot de cron). Er blijft geen foto, geen beeld en geen telling achter.
14. **Alleen beelden, niet te groot** (invariant 6). `/upload` kijkt naar de bytes, niet naar `Content-Type`: alleen JPEG, PNG en HEIC (waar WP25 formaten van maakt). Anders 415. Boven 15 MiB 413. In beide gevallen: geen reservering, geen beeld in storage, geen foto, telling gelijk. Dezelfde upload-id kan daarna met een goed bestand.
15. **Album: alleen als lid, één antwoord.** Met `X-Album-Id` toetst `/upload` het lidmaatschap van de groep van dat album vóór reservering en opslag, en opnieuw in de transactie. Een album van een groep zonder lidmaatschap, een onbekend album, een gewist album en een misvormd id geven hetzelfde antwoord (404, geen bestaans-orakel) en laten niets achter. Als lid zet de upload de foto in het album met de uploader als toevoeger; de andere leden zien de teller oplopen (invariant 8).
16. **Profielfoto weghalen.** Een nieuwe mutation `users.removeProfilePhoto` (geen argumenten) haalt de koppeling weg. Daarna is `profileVersion` "0", geeft het profielpad geen beeld meer en toont de app de letter. Zonder profielfoto doet hij niets en geeft hij geen fout. Uitgelogd: geweigerd. Of het beeld zelf weggaat: vraag 1 (de tests volgen het advies).
17. **Datum blijft** (invariant 4). Een app-upload van een foto met een opnamedatum krijgt die als `takenAt`, ook na omzetten (A-keuze 2).
18. **De app noemt per foto wat er gebeurde.** Per gekozen foto één upload-id, die bij opnieuw proberen gelijk blijft. Een tweede keuze van dezelfde foto (een nieuwe ronde) krijgt een nieuwe id. Na een ronde: hoeveel in het album, hoeveel mislukt, per reden met aantal. Opnieuw proberen stuurt alleen de mislukte foto's waar opnieuw proberen zin heeft (geen netwerk, nog bezig, uitgelogd, een serverfout). Een volle limiet, een te groot of verkeerd bestand en een album zonder toegang blijven mislukt met hun reden. Na "limiet" start de app de wachtende foto's niet meer; ze tellen als mislukt met dezelfde reden.
19. **Toegangsdefinitie** (standing rule). `/upload` wordt het tweede publieke pad dat een album-id aanneemt en in `albumPhotos` schrijft, naast `albums.addPhoto`. Zichtbaar wordt het album-id alleen in reads die al achter het lidmaatschap staan. De gate is een toestemmingslijst (lid van de groep van dat album).

### Pariteit-checklist

**Foto's toevoegen** (modaal "Foto's toevoegen", via de "+" of vanuit een album)

| Oude app | Nieuw (WP18) |
|---|---|
| Kiezer opent meteen bij binnenkomen | Zo |
| Toestemming vragen, anders "⚠️ Toestemming nodig" en "Instellingen openen →" | Alleen als B's pad toestemming vraagt (kernvondst 7) |
| Meerdere foto's, alleen beelden, geen bijsnijden | Zo (geen video, invariant 6) |
| Teller "n foto's geselecteerd", de eerste 7 als duimnagel en "+ n" | Zo; opnieuw kiezen vervangt de keuze |
| Album vooraf ingevuld vanuit het album of de huidige route | Zo |
| "Kies album": per groep de albums, met "Nieuw album" voor een admin | Per eigen groep de albums. "Nieuw album" niet (Groepsbeheer). |
| Knop "Foto's uploaden" grijs zonder foto of album | Zo |
| Tijdens de ronde album en keuze vast | Zo; een tweede tik start niets |
| Alles tegelijk | Een paar tegelijk; B kiest hoeveel |
| "3/5 foto's verwerkt, 2 fouten", toch "✅ toegevoegd" | Per reden met aantal, "opnieuw proberen" (invariant 2, A-invariant 18) |
| Daarna "ga naar album" en "Meer foto's" | Zo |

**Profielfoto** (Profiel)

| Oude app | Nieuw (WP18) |
|---|---|
| Kiezen uit de bibliotheek, met bijsnijden | Zo, eerst de melding dat een profielfoto voor iedereen te zien is (invariant 9) |
| Camera-knop | Niet in scope (zie hieronder) |
| Weghalen (kruisje), dan "Naam en foto opslaan" | Een eigen actie "weghalen", met de letter erna (invariant 10) |
| "Niet gelukt om profielwijziging op te slaan" | Eén NL-melding, niets veranderd |

### Edge cases

- **Vliegtuigmodus midden in een ronde:** het lopende verzoek faalt (netwerk) of komt nooit terug. Opnieuw proberen met dezelfde id geeft de foto als hij er al was (A-invariant 12), of uploadt hem (13).
- **Opnieuw proberen terwijl het eerste verzoek nog loopt:** 409, de app telt hem als "nog bezig" en laat opnieuw proberen toe.
- **Album verdwijnt of de user is geen lid meer tijdens een ronde:** de rest faalt met "album niet beschikbaar" en blijft mislukt. Wat al binnen was, gaat met het album mee (bestaande cascades).
- **Limiet halverwege:** de foto's die binnen waren blijven; de rest is "limiet" (invariant 7, A-invariant 18).
- **De app wordt gesloten tijdens een ronde:** met A-keuze 1 staat elke foto die binnenkwam in het album; de rest is er niet. De ronde zelf is weg. Kiest de user dezelfde foto's opnieuw, dan is dat een nieuwe keuze en kunnen er dubbele foto's komen. Zie vraag 3.
- **Draaien vóór de formaten:** voor app-uploads dicht als A-keuze 3 klopt; voor een client die de app omzeilt blijft WP25 §Edge cases.
- **`width`/`height` na draaien** (backlog uit WP17b): WP18 raakt het niet. Een JPEG zonder tag heeft rechtop-maten bij `extractMetadata` en bij de formaten.
- **Een retry met dezelfde id maar een ander album:** kan in de app niet (album vast). De backend geeft de bestaande foto en verplaatst niets.

**Bewust niet:** camera (v1 alleen bij profiel en covers; voor WP18 niet gevraagd), covers uploaden (Groepsbeheer), de ronde bewaren over een herstart heen (vraag 3).

### Open vragen voor Wouter (met advies)

1. **Profielfoto: apart beeld of gewone foto?** Advies: **gewone eigen foto, en weghalen haalt alleen de koppeling weg.** Dat is v1-pariteit. Het gebruikt `/upload` zonder album en daarna `users.setProfilePhoto`, dus geen nieuw pad en geen nieuwe toegangsregel. De foto telt mee voor de limiet (1000, nu niet aan de orde) en staat later in Mijn foto's (WP17c), waar de user hem kan wissen; dan gaat de profielfoto mee (WP17b A-keuze 1). Een apart beeld vraagt een eigen opslag, een eigen opruiming en een eigen toegangsregel.
2. **Locatie bewaren of weglaten?** v1 bewaarde hem en toonde leden het adres en de kaart. Met A-keuze 3 gaat er geen GPS in de bytes mee; bewaren kost twee extra headers (breedte, lengte) en de bestaande plaatsnaam-stap. Advies: **bewaren, als aparte headers**. De groepen zijn klein en kennen het uit v1, en de kaart in WP17c heeft het nodig. Weglaten kan ook: dan doet de app niets extra. Let op: een client die de app omzeilt en een JPEG met GPS stuurt, houdt die GPS in het origineel. Een lid krijgt het origineel alleen zolang er geen formaten zijn (WP17a terugval).
3. **Achtergrond.** Advies: **na terugkeer noemen wat niet lukte, en opnieuw proberen is genoeg.** Met A-keuze 1 en 12 ontstaat er geen halve of dubbele foto. Houd het scherm wakker tijdens een ronde, dan gaat de telefoon niet vanzelf op slot. Een ronde die door een herstart wegvalt, onthoudt de app niet; de user ziet in het album wat er staat.

### Tests

| Bestand | Pint |
|---|---|
| `tests/http/uploadGates.test.ts` | A-invariant 12 (herhaling op de limiet), 13 (afgebroken body), 14 (type op bytes, grens 15 MiB via `MAX_UPLOAD_BYTES` in `convex/lib/constants.ts`) |
| `tests/http/uploadAlbum.test.ts` | A-keuze 1, A-invariant 15 en invariant 8: in het album in één keer, herhaling zonder tweede plek, één antwoord bij geen toegang, niets achter, teller bij een ander lid |
| `tests/http/uploadTakenAt.test.ts` | A-keuze 2, A-invariant 17; plus vraag 2 volgens het advies (breedte en lengte als header). Bij "weglaten" vervalt die `describe`. |
| `tests/users/removeProfilePhoto.test.ts` | A-invariant 16, met vraag 1 volgens het advies (de foto blijft) |
| `app/tests/upload.test.ts` | Pure logica in `app/src/lib/upload.ts`: upload-ids (A-invariant 18), het antwoord van `/upload` als uitkomst met reden, opnieuw proberen, limiet stopt de rest, de telling, de maat na omzetten (A-keuze 3) |

`tests/photoFormats/backfill.test.ts` stuurde tekst als foto; die test stuurt nu JPEG-bytes (A-invariant 14), zelfde bedoeling. Geen UI-tests. Kiezer, omzetten, toestemming en schermen toetst de gate.
