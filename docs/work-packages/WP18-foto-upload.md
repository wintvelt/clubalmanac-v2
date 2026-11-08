# WP18: Foto's uploaden, en een profielfoto uploaden of verwijderen

> Draft regie 2026-11-08. App-WP (zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4)), met een stuk backend. De upload zelf bestaat al: `POST /upload` in `convex/http.ts`, met een reservering per upload-id tegen dubbele foto's ([`migratie-plan-convex.md`](../migratie-plan-convex.md) §upload). Na de upload maakt de backend de formaten ([WP25](./WP25-fotoformaten.md)) en leest de metadata. Het zwaartepunt ligt in de app. A → B → audit → red-team op de upload-keten → TestFlight-gate. Eigen branch `wp18`.

## Productdoel

Een lid zet foto's van zijn iPhone in een album van zijn groep. Ze staan rechtop, met hun datum, en de andere leden zien ze. Mislukt er iets, dan ziet hij welke foto's, en kan hij die opnieuw proberen zonder dat er een foto dubbel komt. Daarnaast kan hij een eigen profielfoto uploaden of zijn profielfoto weghalen.

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

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft.)
