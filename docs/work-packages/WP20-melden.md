# WP20: melden — foto's, ideeën en problemen

> Regie 2026-11-14. App-WP met een stuk backend. A → besluiten Wouter → B → audit → red-team op het beeldpad → gate in de simulator (dev). Eigen branch `wp20`. Na WP19c en WP30, vóór T0.

## Productdoel

Een lid meldt een ongepaste foto van een ander, geeft een idee of een probleem door en stemt op ideeën van anderen. Wie een foto heeft die gemeld is, weet dat op tijd en kan bezwaar maken. De webmaster ziet de meldingen en beslist erover in de app. Niemand anders ziet wie wat meldde.

## Wat er al is

De backend is er grotendeels (WP4, WP5, WP23, WP24). De app heeft nog niets.

| Onderdeel | Backend nu | Gat dat regie ziet |
|---|---|---|
| Foto melden | `photos.flag` (foto-toegang, niet je eigen foto, stil als al gemeld, 14 dagen tot wissen) | — |
| Eigen gemelde foto's, bezwaar | `photos.listMyFlagged`, `photos.appeal` | De eigenaar hoort niets bij een melding; zonder bezwaar wist de cron de foto na 14 dagen (FL1). |
| Webmaster: wachtrij en beslissen | `photos.listAllFlagged`, `photos.decideFlag` (alleen na bezwaar; mail bij afwijzen, FL2) | De webmaster kan een melding zonder bezwaar niet afwijzen. |
| Idee of probleem doorgeven | `features.create` (probleem: mail naar `WEBMASTER_EMAILS`) | Geen controle op titel en omschrijving (lengte, lege of onzichtbare tekens, zoals WP15b). |
| Ideeën zien en stemmen | `features.list`, `upvote`, `removeUpvote`, `hasUpvoted` | Of jij gestemd hebt, is één query per idee. |
| Webmaster: status van een idee | `features.update` (titel, omschrijving), `features.remove` | De status kan nergens gezet worden. |
| Weten of je webmaster bent | alleen intern (`isWebmaster`) | De app kan de webmaster-schermen niet tonen of verbergen. |

## Invarianten

1. **De melder blijft anoniem.** Alleen de webmaster ziet wie meldde en waarom (WP23, invariant 9). De eigenaar, andere leden en de melder zelf zien dat niet via een read, een fout of een mail.
2. **Een gemelde foto verdwijnt nooit ongemerkt.** De eigenaar weet het binnen de termijn, ziet tot wanneer, en kan bezwaar maken zolang dat mag.
3. **Webmaster-acties alleen voor de webmaster, in de backend.** De app verbergt de schermen voor anderen, maar de gate zit in de backend. Een niet-webmaster krijgt bij elke webmaster-actie dezelfde weigering, zonder te verraden of iets bestaat.
4. **Melden lekt niets.** Een melding op een foto die je niet mag zien geeft dezelfde fout als een foto die niet bestaat (WP24). Of een foto al gemeld is, hoort de melder niet.
5. **Een probleem ziet alleen wie het meldde en de webmaster.** Ideeën zijn voor alle leden zichtbaar, zonder de naam van de indiener (WP23, A-keuze 5).
6. **Stemmen klopt.** Eén stem per lid per idee; `upvoteCount` gelijk aan het aantal stemmen, ook bij snel twee keer tikken (cascade-matrix patroon 2).
7. **Geen stille mislukking in de app.** Elke actie meldt in het NL of hij lukte; een weigering noemt de reden.
8. **Een gemelde foto blijft in het album staan, zonder markering** (WP17a besluit 4), tenzij Wouter dat hieronder anders beslist.

## Scope

- **App:** melden in het foto-menu (andermans foto); een scherm met je eigen gemelde foto's en bezwaar; ideeën en problemen doorgeven, de ideeënlijst met stemmen; voor de webmaster een wachtrij met gemelde foto's en een lijst met ideeën en problemen waarin hij beslist of de status zet.
- **Backend:** de gaten uit de tabel, na de besluiten. Toegangsdefinities volgens de standing rule waar een gate verandert.
- **Bewust niet:** een webapp-beheerscherm; pushmeldingen (de app heeft er geen); een melding op een album, groep of lid; stemscores uit v1 terugzetten (WP12: gaan bewust verloren).

## Open vragen voor A (oude app en backend, rapporteren aan regie)

1. **Pariteit per scherm:** wat deed de oude app precies bij melden (reden verplicht? keuzelijst of vrije tekst? bevestiging?), bij "Ongepast" (`Inappropriate.jsx`), in de webmaster-wachtrij (`InappropriateAdmin.jsx`) en bij ideeën en problemen? Waar zaten die schermen?
2. **Eigenaar op de hoogte:** kreeg de eigenaar in v1 een mail of een melding in de app toen zijn foto gemeld werd? Wat zag hij, en waar?
3. **Webmaster zonder bezwaar:** kon de webmaster in v1 een melding afwijzen of goedkeuren zonder dat de eigenaar bezwaar maakte?
4. **Status van ideeën:** hoe zette de webmaster in v1 de status, en zag een lid die status?
5. **Probleem melden:** stuurde v1 meer mee dan titel en omschrijving (app-versie, toestel, scherm)?
6. **Toegangsdefinities:** welke publieke paden nemen een foto- of idee-id aan, of schrijven de flag-velden en `upvoteCount`? Klopt elke gate, en is het een toestemmingslijst?
7. **Mails:** welke mails horen bij deze flows (melding aan eigenaar, besluit, probleem), van welke sender, en sluiten ze aan op WP19c (opmaak, geen tracking)?

## Vragen voor Wouter (vóór B)

1. **Eigenaar bij een melding.** Advies regie: een mail aan de eigenaar bij een melding, met de datum waarop de foto verdwijnt en waar hij bezwaar maakt. Zonder bericht verdwijnt de foto ongemerkt (invariant 2). De naam van de melder staat er niet in.
2. **Webmaster zonder bezwaar.** Advies regie: de webmaster kan een melding ook zonder bezwaar afwijzen (foto blijft) of de foto meteen laten verwijderen. A meldt eerst wat v1 deed.
3. **Plek in de app.** Advies regie: melden in het foto-menu; je gemelde foto's in Profiel (naast Uitnodigingen, alleen zichtbaar als er iets is); ideeën en problemen in Instellingen; de webmaster-schermen ook in Instellingen, alleen voor de webmaster.

### Besluiten Wouter (2026-11-14, na A's advies)

Alle adviezen overgenomen.

1. **Mail aan de eigenaar bij een melding,** met de datum waarop de foto verdwijnt (A-invariant 10).
2. **De webmaster beslist ook zonder bezwaar:** goedkeuren (melding weg) of de foto meteen verwijderen, met een mail aan de eigenaar (A-invarianten 11–13).
3. **De webmaster ziet het beeld van een gemelde foto,** alleen zolang die gemeld is (A-invariant 9). Nieuw leespad voor beeldbytes, dus na de audit een red-team op deze uitzondering.
4. **Plek, zoals v1:** melden in het foto-menu; je eigen gemelde foto's en de wachtrij van de webmaster in Profiel, alleen zichtbaar als er iets is; ideeën en problemen in Instellingen. Dit vervangt vraag 3 hierboven.
5. **Probleem melden zonder account:** geen nieuw schrijfpad zonder login. De contactlink op de Info-pagina's (`CONTACT_MAILTO`, ook uitgelogd) is de weg; B zorgt dat die vindbaar is als "probleem melden".

### Besluiten na de audit (2026-11-14)

6. **Fix-cyclus 1** (A test, B impl), uit de audit:
   - **S1, de datum klopt altijd.** De datum die mail en app noemen ("na <datum>") is een dag waarop de foto de hele dag (NL-tijd) nog bestaat en bezwaar nog kan; de foto verdwijnt pas bij de eerste opruimronde daarna. Ook bij een melding of afwijzing tussen 00:00 en 03:00 UTC. A test met een klok in dat venster en kiest met B het mechanisme.
   - **S2, Profiel leest alleen gemelde foto's.** `listMyFlagged` en `listAllFlagged` lezen niet meer alle foto's, alleen de gemelde. Gedrag gelijk.
   - **N1:** "Bezig…" pas na de bevestiging, op de knop die je koos.
   - **N3:** geen mail aan een eigenaar wiens account wordt verwijderd.
   - S3 (migratieplan) doet regie in de closeout.
7. **N2: de webmaster mag over een melding van zijn eigen foto beslissen.** Geen wijziging; als eigenaar kan hij die foto toch al verwijderen.
8. **Red-team op het beeldpad** (besluit 3) na fix-cyclus 1, inclusief N5 (het beeld in de cache van de webmaster na goedkeuren).

## Risico-assessment

- **security/privacy: middel.** Melder-identiteit en reden mogen alleen naar de webmaster; webmaster-gates; een probleemmelding kan persoonlijke tekst bevatten. De bestaande reads hebben al een whitelist (WP23). Geen red-team, tenzij A een nieuw leespad voor melder of reden voorstelt.
- **ops: middel.** De cron wist echt foto's; een gemiste melding is dataverlies voor de eigenaar. Mails naar de webmaster en de eigenaar via Mailjet, met de bekende stille fout bij een niet-geverifieerde sender.
- **external deps: laag.** Mailjet, zoals WP5 en WP19c.
- **multi-user/concurrency: laag.** Twee meldingen tegelijk, stemmen tegelijk: één transactie per mutation.
- **data/schema-evolutie: laag.** Hoogstens een optioneel veld (bijv. wanneer de eigenaar bericht kreeg). Gemigreerde meldingen uit v1 hebben datums op dag-niveau en geen reden (WP12); de schermen moeten daarmee overweg.
- **ops-runbook-impact:** geen nieuwe env-vars verwacht. `WEBMASTER_EMAILS` staat al in de T0-checklist; als er een nieuwe mail of sender bijkomt, B werkt [`external-services.md`](../conventions/external-services.md) bij.

## Cross-refs

- cascade-matrix: FL1, FL2, U10, U15, patroon 2 (`upvoteCount`).
- [`migratie-plan-convex.md`](../migratie-plan-convex.md) §Photo flagging, §Webmaster-rol.
- WP4 (flagging-backend), WP5 (mails), WP12 (wat er uit v1 meekomt), WP17a besluit 4 en vraag 9 (`by_flagged`), WP23 (whitelist), WP24 (foto-toegang bij `flag`), WP19c (mailopmaak, geen tracking).
- Oude app (alleen A): `Inappropriate.jsx`, `InappropriateAdmin.jsx`, `PhotoMenu.jsx`, `HelperFlaggedPhotoModal`, de schermen voor ideeën en problemen. Oude backend (alleen A): `blob-images-api-photos` (`flagPhoto.js`, `flagPhotoAppeal.js`, `flagPhotoDecide.js`), `blob-images-api-features`.

## Acceptance

- Tests voor de backend-wijzigingen en de invarianten 1–6; de bestaande flag- en feature-tests blijven groen.
- App: B kijkt zelf in de simulator vóór "klaar".
- **Gate (regie, dev, simulator):** als dev Wouter een foto van een ander lid melden; als die eigenaar het bericht zien en bezwaar maken; als webmaster beslissen, inclusief de mail bij afwijzen; een idee doorgeven en erop stemmen als een ander lid; een probleem doorgeven en de mail aan de webmaster zien; een niet-webmaster ziet geen webmaster-schermen en krijgt een weigering via `npx convex run`. Mails alleen naar `+clerk_test`-adressen.

---

## Spec-criticus aanvullingen (A vult in)

> A, 2026-11-14. Bronnen: v1-backend `blob-images-api-photos` (`flagPhoto.js`, `flagPhotoAppeal.js`, `flagPhotoDecide.js`, `listFlagged.js`, `listAllFlagged.js`), `blob-images-api-features` (`handlers/*`, `handlersProblem/*`), oude app (`PhotoMenu.jsx`, `PhotoSelectionMenu.jsx`, `Inappropriate.jsx`, `InappropriateAdmin.jsx`, `Profile.jsx`, `MyPhotos.jsx`, `HelperFlaggedPhotoModal.jsx`, `Problem.jsx`, `Info.jsx`, `InfoProtected.jsx`, `datastores/images.js`, `datastores/problem.js`), en de prod-extract van 2026-11-07 (`scripts/.data/dynamo-extract.json`).

### Kernvondsten

1. **v1 wiste een gemelde foto nooit.** `flaggedDeleteDate` werd gezet, maar geen enkele v1-repo heeft een cron of geplande functie. De teksten in de app ("worden deze foto's verwijderd") klopten dus niet. v2 wist echt (FL1). Daarom weegt invariant 2 zwaarder dan in v1: in v1 kostte een gemiste melding niets.
2. **De webmaster kan het beeld van een gemelde foto niet zien.** Het beeldpad (`images.photoImage`, `photoImageInFormat`) geeft alleen beeld bij foto-toegang, zonder webmaster-uitzondering (WP23). De webmaster zit niet in elke groep, dus de wachtrij toont lege vakken. In v1 bouwde de app de URL zelf en zag de webmaster elke foto. Zonder beeld kan hij niet beslissen. Zie A-invariant 9. Dit is een nieuw leespad (beeld, niet melder of reden).
3. **Een probleem melden kon in v1 ook uitgelogd** (Info → "Probleem melden", ook op het inlogscherm). Juist wie niet kan inloggen, heeft een probleem. In v2 vereist `features.create` een account. Zie vraag aan regie 1.
4. **Prod heeft nu geen gemelde foto's** (extract 2026-11-07: 0 van 3216 items). De transform stopt bij gemelde foto's met een verwijderdatum, tenzij `--accept-flagged-deletion` (WP12). Geen extra werk voor T0, wel een check: de extract van T0 opnieuw tellen.
5. **Prod heeft 4 ideeën** (3 `completed` met een webmaster-notitie, 1 `submitted`). De notitie gaat verloren (WP12). De iPhone-app had geen ideeënscherm; de ideeën zaten alleen in de backend (en waarschijnlijk in de webapp, die niet in `~/Code/v1` staat).

### Antwoorden op de open vragen

**1. Pariteit per scherm (oude app).**

- **Melden** (foto-menu `PhotoMenu.jsx`, alleen bij andermans foto, rood, als laatste: "Meld als ongepast"):
  - Geen reden, geen keuzelijst.
  - Bevestiging: "Als je deze foto meldt als ongepast, krijgt de foto-eigenaar hiervan bericht, uiteraard zonder jouw naam", knoppen Annuleren en Melden (rood).
  - Gelukt: "Je melding over ongepaste content is doorgegeven." en terug. Mislukt: "Helaas, niet gelukt melding door te geven".
  - Ook in de selectie (`PhotoSelectionMenu.jsx`), alleen als er geen eigen foto in zit, met dezelfde bevestiging.
- **"Ongepast"** (`Inappropriate.jsx`, scherm "Meldingen over jouw foto's"):
  - Bereikbaar vanuit Profiel, item "Meldingen ongepaste foto's", alleen zichtbaar als er een gemelde foto is, met een oranje stip.
  - Uitleg bovenaan: meldingen van andere gebruikers; zonder actie wordt de foto verwijderd; met bezwaar beoordelen moderatoren de foto.
  - Per foto: miniatuur, "gemeld op", "bezwaar gemaakt op", "bezwaar afgewezen op", "gepland te wissen op" (elk alleen als de datum er is).
  - Knoppen: "bezwaar" (alleen zolang er geen bezwaar is) en "verwijder" (bevestiging: de foto verdwijnt definitief uit alle albums).
  - Gelukt: "Je bezwaar is doorgegeven" of "De foto is verwijderd". Leeg: "Geen meldingen over jouw foto's".
  - In Mijn foto's: een vlag linksboven op een eigen gemelde foto (drie varianten: gemeld, bezwaar, afgewezen), met een eenmalige uitleg. In een album: geen markering.
- **Webmaster-wachtrij** (`InappropriateAdmin.jsx`, "Beoordeel meldingen"):
  - In Profiel, alleen voor de webmaster en alleen als er meldingen zijn. Profiel toonde ook een label "webmaster".
  - Alle gemelde foto's; eerst die met een bezwaar zonder besluit.
  - Per foto: dezelfde datums, of "(nog) geen bezwaar gemaakt". Geen melder, geen eigenaar, geen reden.
  - Knoppen 👎 en ✅, alleen bij een bezwaar zonder besluit. Geen vraag vooraf; achteraf "Je besluit om het bezwaar goed te keuren / af te wijzen is doorgegeven".
- **Probleem** (`Problem.jsx`, Info → "Probleem melden", ingelogd en uitgelogd):
  - Velden: e-mail en naam (optioneel, vooraf ingevuld), omschrijving (verplicht, meerregelig), vinkje "Akkoord om logbestand te delen met ontwikkelaar". Geen titel.
  - Daaronder het logbestand van de app, met herladen en wissen.
  - Gelukt: "Je melding is verzonden", omschrijving leeg, log gewist. Mislukt: "Het is niet gelukt je melding te verzenden".
- **Ideeën:** geen scherm in de iPhone-app.

**2. Eigenaar op de hoogte (v1):** geen mail en geen pushmelding. De eigenaar zag het alleen als hij zelf keek: het item in Profiel met de oranje stip, en de vlag op de foto in Mijn foto's. De bevestiging bij melden beloofde "krijgt de foto-eigenaar hiervan bericht"; dat bericht was dat item.

**3. Webmaster zonder bezwaar (v1):** nee. `flagPhotoDecide.js` weigerde zonder bezwaar ("photo not appealed") en de app toonde de knoppen alleen bij een bezwaar. Volgens de uitleg in de wachtrij verdween de foto "vanzelf op de geplande datum", wat in werkelijkheid nooit gebeurde (kernvondst 1).

**4. Status van ideeën (v1):** de webmaster zette via `PUT /features/{id}` de status (`submitted`, `in progress`, `completed`), een notitie (`comment`) en zelfs het aantal stemmen. Elke ingelogde gebruiker kreeg status en notitie in de lijst. Een scherm daarvoor zat niet in de iPhone-app. Stemmen in v1: anoniem, één teller (begon op 10), niet op je eigen idee, met een maximum.

**5. Probleem melden (v1):** naam, e-mail, omschrijving en, met het vinkje, het logbestand van de app. Geen titel, geen app-versie of toestel apart (het logbestand kon dat bevatten). De mail ging naar de webmaster, ook voor iemand zonder account.

**6. Toegangsdefinities.** Zie §Toegangsdefinities hieronder. Alle bestaande gates zijn toestemmingslijsten, met één orakel: `photos.appeal` onderscheidt "bestaat niet" van "niet jouw foto" (A-invariant 8).

**7. Mails.**

| Mail | v1 | v2 nu | Na WP20 |
|---|---|---|---|
| Melding aan eigenaar | geen | geen | besluit 1: nieuw, van `info@`, kaal |
| Besluit, goedgekeurd | aan eigenaar, met opmaak en foto | geen (FL2) | geen |
| Besluit, afgewezen | aan eigenaar, met opmaak en foto | `info@`, kaal, "binnenkort" | met de datum (A-invariant 6) |
| Foto meteen verwijderd | bestond niet | bestond niet | besluit 2: nieuw, `info@`, kaal |
| Probleem | aan webmaster, ook zonder account | `info@` → `WEBMASTER_EMAILS` | ongewijzigd |

Afzender in v1 was `wouter@clubalmanac.com`. In v2 alles van `info@` (staat al in `MAILJET_VERIFIED_SENDERS`). WP19c: tracking staat voor elke mail uit; de gedeelde opmaak is alleen voor de uitnodiging gebouwd. A-keuze 5: de nieuwe mails zijn kaal, zoals de mail bij afwijzen; de schil voor andere mails aan leden blijft een follow-up.

### Wat v1 deed bij de vragen voor Wouter

1. **Eigenaar bij een melding:** v1 stuurde niets; de eigenaar zag een item met oranje stip in Profiel en een vlag in Mijn foto's. Omdat v1 nooit wiste, kostte dat niets. In v2 wist de cron na 14 dagen echt.
2. **Webmaster zonder bezwaar:** v1 kon dat niet, in backend en app. Wel kon de eigenaar zijn gemelde foto zelf verwijderen.
3. **Plek in de app:** melden zat in het foto-menu (en in de selectie). De gemelde foto's van de eigenaar en de wachtrij van de webmaster zaten allebei in Profiel, alleen zichtbaar als er iets was. Probleem melden zat in Info (in v2: Instellingen). Ideeën hadden geen plek.

### A-invarianten

Bestaande invarianten 1–8 blijven. A-invarianten 1–9 gelden los van de besluiten; 10–13 volgen het advies van regie bij besluit 1 en 2.

**Ideeën en problemen**

1. **Titel en omschrijving worden gecontroleerd** bij `features.create` en `features.update`, met dezelfde regel voor tekens als namen (WP15b, WP28: geen controle- of onzichtbare tekens, geen tekens die de leesrichting omdraaien; emoji met ZWJ mag).
   - Titel: getrimd, 1–100 tekens (code points), één regel. Fout: `ConvexError` met `code` `TITLE_REQUIRED`, `TITLE_TOO_LONG` of `TITLE_INVALID`.
   - Omschrijving: getrimd, 0–2000 tekens; regeleinden (`\n`) mogen. Fout: `DESCRIPTION_TOO_LONG` of `DESCRIPTION_INVALID`.
   - Bewaard wordt de getrimde tekst. Een geweigerde `create` schrijft niets en stuurt geen mail.
2. **De webmaster zet de status** met een nieuwe mutation `features.setStatus({ featureId, status })`, voor ideeën en problemen. Alleen de status verandert. Een niet-webmaster krijgt dezelfde weigering voor een bestaand en een onbekend id, zonder iets te wijzigen.
3. **Jouw stemmen in één query:** `features.listMyUpvotes` geeft de ids van de features waarop de caller stemde. Alleen de eigen stemmen, nooit die van een ander; zonder account een fout, zoals `list`. De vorm van `list` blijft (WP23).
4. **Stemmen klopt bij snel twee keer tikken:** twee `upvote`'s tegelijk geven één stem en `upvoteCount` 1 (invariant 6). Stemmen op een probleem blijft zoals WP24 A-keuze 6.

**Webmaster**

5. **De app weet of je webmaster bent** via een nieuwe query `users.isWebmaster`, die een boolean geeft. Hij gooit nooit: `false` zonder identity, zonder users-rij, of voor een account dat wordt verwijderd. Dezelfde regel als `isWebmaster` in `lib/auth`.

**Gemelde foto's**

6. **De mail bij afwijzen noemt de datum** waarop de foto verdwijnt (de nieuwe `flaggedDeleteDate`), zodat de eigenaar weet tot wanneer (invariant 2). Geen melder, geen reden.
7. **De reden bij melden is begrensd:** hoogstens 500 tekens, anders `ConvexError` `REASON_TOO_LONG` en geen melding. Een lege reden na trimmen wordt niet bewaard. De app vraagt geen reden (A-keuze 1); de grens is voor de publieke API.
8. **Bezwaar lekt niet:** `photos.appeal` op een foto van een ander geeft dezelfde fout als op een onbekend id, met of zonder foto-toegang, en wijzigt niets.
9. **De webmaster ziet het beeld van een gemelde foto.** Het beeldpad (`photoImage` en `photoImageInFormat`) geeft de webmaster het beeld van een foto zolang die gemeld is (`flaggedAt` gezet), ook zonder lidmaatschap. Na goedkeuren (velden gewist) niet meer. Een niet-webmaster zonder toegang krijgt het niet, ook niet als de foto gemeld is. Een identity met het webmaster-adres zonder users-rij ook niet. Alleen het beeld; geen andere read krijgt een webmaster-uitzondering.

**Besluit 1, advies regie: de eigenaar krijgt een mail**

10. Bij de eerste melding gaat er een mail naar de eigenaar, van `info@`. Hij noemt de datum waarop de foto verdwijnt en dat je in de app bezwaar maakt. Geen naam of adres van de melder, geen reden. Een tweede melding op dezelfde foto stuurt niets (invariant 4). Een geweigerde melding stuurt niets. Lukt de mail niet, dan blijft de melding staan.

**Besluit 2, advies regie: de webmaster beslist ook zonder bezwaar**

11. `photos.decideFlag` met `approve: true` mag ook zonder bezwaar: alle flag-velden gewist, geen mail (zoals FL2). `approve: false` zonder bezwaar blijft geweigerd; daarvoor is A-invariant 12.
12. Een nieuwe mutation `photos.removeFlagged({ photoId })` verwijdert een gemelde foto meteen, in elke fase (gemeld, bezwaar, afgewezen), met dezelfde cascade als de cron (`internalRemovePhoto`). Alleen de webmaster; een niet-webmaster krijgt dezelfde weigering voor een bestaand en een onbekend id. Een foto die niet gemeld is, weigert hij: dit is geen algemene wis-knop.
13. Bij `removeFlagged` krijgt de eigenaar een mail dat zijn gemelde foto is verwijderd, van `info@`, zonder melder of reden. De foto is dan al weg: de mail mag niet afhangen van de foto-rij.

### A-keuzes

1. **Geen reden in de app,** zoals v1. De webmaster ziet de foto zelf.
2. **Melden alleen in het foto-menu,** niet in de selectie (v1 had dat wel). Kan later.
3. **De wachtrij toont geen melder,** zoals v1. `listAllFlagged` geeft `flaggedBy` en `flagReason` wel (invariant 1); de app laat ze weg. Zo is er geen nieuw leespad voor de naam van de melder.
4. **Stemmen op je eigen idee mag** (v2 nu; v1 niet, maar daar begon een idee op 10). Geen maximum.
5. **De nieuwe mails zijn kaal,** zoals de mail bij afwijzen. De gedeelde opmaak van WP19c blijft een follow-up.
6. **Statusnamen in de app:** open "Nieuw", planned "Gepland", inProgress "Mee bezig", done "Klaar", rejected "Afgewezen". Een lid ziet de status bij elk idee.
7. **Volgorde:** ideeën op aantal stemmen, dan nieuwste eerst (v1 sorteerde op stemmen). Problemen nieuwste eerst. Wachtrij: eerst een bezwaar zonder besluit, dan op datum van melden.
8. **De eigenaar kan zijn gemelde foto zelf verwijderen** vanuit zijn lijst, met bevestiging (v1 had dat; `photos.remove` bestaat).

### Pariteit-checklist voor B (app)

Waar het iets staat, volgt besluit 3. Alles in het NL, met een melding bij gelukt en mislukt (invariant 7), en de reden bij een weigering.

- [ ] Foto-menu, andermans foto: "Melden als ongepast", rood, als laatste. Bevestiging met "zonder jouw naam". Daarna "Je melding is doorgegeven", ook als de foto al gemeld was.
- [ ] Gemelde foto's (eigenaar): alleen te zien als er een is. Per foto miniatuur (*klein*), gemeld op, bezwaar op, afgewezen op, verwijderd op. Datums op dag-niveau (gemigreerde meldingen hebben geen tijd en soms geen verwijderdatum). Knop bezwaar zolang dat mag; knop verwijderen met bevestiging. Uitleg: zonder bezwaar verdwijnt de foto op die datum.
- [ ] Wachtrij (webmaster): alleen voor de webmaster (`users.isWebmaster`). Per foto miniatuur (A-invariant 9), datums, de fase. Knoppen per fase volgens besluit 2. Geen melder, geen reden (A-keuze 3).
- [ ] Idee of probleem doorgeven: keuze idee of probleem, titel, omschrijving. De fout uit de backend bij de velden (codes A-invariant 1). Na een probleem: "We hebben je melding doorgestuurd".
- [ ] Ideeënlijst: titel, omschrijving, status (A-keuze 6), aantal stemmen, of jij stemde (`listMyUpvotes`), stemmen en terugnemen. Je eigen problemen in een eigen lijst, zonder stemknop.
- [ ] Webmaster bij ideeën en problemen: status zetten (`setStatus`), en verwijderen met bevestiging.
- [ ] Een niet-webmaster ziet geen webmaster-schermen en geen knoppen ervoor; een directe route geeft een nette weigering.

### Toegangsdefinities (vraag 6)

Publieke paden die een foto-id of feature-id aannemen, of flag-velden of `upvoteCount` schrijven:

| Pad | Gate | Toestemmingslijst? |
|---|---|---|
| `photos.flag` | foto-toegang (`requirePhotoAccess`), niet eigen foto | ja (WP24) |
| `photos.appeal` | eigenaar | ja, maar met orakel → A-invariant 8 |
| `photos.decideFlag` | webmaster eerst | ja |
| `photos.removeFlagged` (nieuw) | webmaster eerst, dan gemeld | ja |
| `photos.listMyFlagged` / `listAllFlagged` | eigen foto's / webmaster | ja |
| beeldpad `/beeld/…` | foto-toegang, plus A-invariant 9 | ja: webmaster alleen bij `flaggedAt` |
| `features.update`, `remove`, `setStatus` (nieuw) | webmaster eerst | ja |
| `features.upvote`, `removeUpvote` | zichtbaar voor caller (`canSee`) | ja (WP24) |
| `features.getById`, `list`, `hasUpvoted`, `listMyUpvotes` (nieuw) | ingelogd, `canSee`, eigen stemmen | ja |

Andere schrijvers van flag-velden en `upvoteCount` zijn intern: de cron (FL1), accountverwijdering (U10, U15). De inventaristest van publieke queries (`tests/readWhitelist/inventory.test.ts`) krijgt `features:listMyUpvotes` en `users:isWebmaster`.

### Ops

- Geen nieuwe env-vars. Nieuwe mails van `info@`, dat al geverifieerd is. B zet de nieuwe mails in de mailtabel van [`external-services.md`](../conventions/external-services.md).
- **T0-check:** de extract van T0 tellen op gemelde foto's (kernvondst 4). Bij gemelde foto's met een verwijderdatum stopt de transform; dan beslist Wouter.

### Vragen aan regie

1. **Probleem melden zonder account** (kernvondst 3). Advies: de Info-pagina's (ook uitgelogd) noemen een mailadres voor problemen; geen nieuw publiek schrijfpad zonder auth. Buiten de scope van B tenzij regie het anders wil.

### Tests (stand na A)

Backend: 55 rood, 2676 groen, 1 overgeslagen. App: 5 rood plus 2 bestanden die nog niet laden (de modules `lib/flags`, `lib/features` ontbreken), 1342 groen. Alle rode tests falen om de juiste reden: een functie of module ontbreekt, er komt geen code of mail, de tekst is niet getrimd, of de datum staat niet in de mail.

- Los van de besluiten: `tests/features/validation.test.ts` (1), `setStatus.test.ts` (2), `listMyUpvotes.test.ts` (3, 4), `tests/users/isWebmasterQuery.test.ts` (5), `tests/photos/denyMailDate.test.ts` (6), `flagReason.test.ts` (7), `tests/writeGates/appealOracle.test.ts` (8), `tests/images/webmasterFlagged.test.ts` (9); de inventaris in `tests/readWhitelist/inventory.test.ts`; "flag" in `tests/photoActions/menuMatchesBackend.test.ts`.
- Besluit 1: `tests/photos/flagOwnerMail.test.ts` (10). Besluit 2: `tests/photos/webmasterWithoutAppeal.test.ts` (11–13) en de laatste guard in `decideFlag.test.ts` (nu `approve: false`). Valt een besluit anders uit, dan past A die bestanden aan.
- App: `app/tests/photoActions.test.ts` (melden), `flags.test.ts`, `features.test.ts`.
- Gedeelde opzet voor de mails: `tests/photos/_wp20.ts` (vaste klok 12:00 UTC, nep-Mailjet, datum-orakel los van de templates).
- Typecheck: backend 2 fouten en app 7, allemaal `"flag"` buiten `PhotoAction` of een ontbrekende module. Ze verdwijnen met B's werk.

### Voor B

- Backend: `features.setStatus`, `features.listMyUpvotes`, `users.isWebmaster`, de controle in `features.create`/`update` (codes A-invariant 1), de grens op de reden, `appeal` zonder orakel, het beeld voor de webmaster, de datum in de mail bij afwijzen. Na de besluiten: de mail bij melden, `decideFlag` zonder bezwaar, `photos.removeFlagged` met mail.
- App: `photoActions` krijgt de actie `"flag"` (alleen andermans foto, als laatste, label "Melden als ongepast"). Nieuwe pure module `app/src/lib/flags.ts` voor de fase van een eigen melding, en `app/src/lib/features.ts` voor statusnamen en foutteksten (zie `app/tests/flags.test.ts`, `app/tests/features.test.ts`).
- Doc: mailtabel in `external-services.md`; cascade-matrix FL2 (approve zonder bezwaar, `removeFlagged`) als besluit 2 doorgaat.

### Fix-cyclus 1 (A, besluit 6)

**S1, de datum.** Het probleem: de cron wist om 03:00 UTC alles met `flaggedDeleteDate <= now`. Een melding om 01:00 UTC krijgt als verwijderdatum 28 november 01:00 UTC; de mail noemt "na 28-11", maar de ronde van 28 november om 04:00 NL wist de foto al. Hetzelfde voor afwijzen (+7 dagen) en voor de dag in de app ("Wordt verwijderd na …", eigenaar en wachtrij). Een gemigreerde datum (middernacht UTC) heeft het ook.

A-keuze 9 (mechanisme): **de genoemde dag is de kalenderdag vóór de eerste opruimronde op of na `flaggedDeleteDate`.**
- De eerste ronde is de eerste 03:00 UTC op of na de verwijderdatum (precies 03:00 telt mee, want `<=`).
- 03:00 UTC is 04:00 (winter) of 05:00 (zomer) in NL, dus dezelfde kalenderdag in UTC en NL. De dag ervoor bestaat de foto in NL-tijd de hele dag, en bezwaar kan dan ook.
- De opgeslagen datum, de termijnen (14 en 7 dagen) en de cron blijven zoals ze zijn. Geen schema-wijziging, geen migratie.
- Dezelfde regel in de mail (melden, afwijzen) en in de app. De backend en de app delen geen code; elk heeft de regel zelf. De app-functie is `removalDay(deleteAt)` in `app/src/lib/flags.ts`, met de dag als "27 november 2026" (de vorm van `flagDay`).
- De regel hangt aan het uur van de cron. `tests/crons/registration.test.ts` pint 03:00 UTC; wie het uur verandert, moet ook deze regel aanpassen. B zet dat bij de cron in een commentaar.

**S2, alleen gemelde foto's lezen.** `listMyFlagged` en `listAllFlagged` lezen alleen rijen met `flaggedAt`, niet alle foto's van de eigenaar of de hele tabel. Gedrag gelijk, ook voor gemigreerde meldingen (`flaggedAt` op middernacht UTC, jaren terug). convex-test ziet niet hoeveel rijen een query leest: de tests pinnen het gedrag, de audit toetst het lezen in de code. Een nieuwe index mag; `by_flagged` is niet sparse (WP17a vraag 9), dus de query heeft een ondergrens nodig.

**N3, geen mail aan wie wordt verwijderd.** Bij melden, afwijzen en `removeFlagged` gaat er geen mail naar een eigenaar wiens account wordt verwijderd (`users.deletion`, WP29). De controle telt op het moment van versturen, dus ook als het verwijderen begint nadat de mutation de mail heeft ingepland. Wat de mutations verder doen, verandert niet.

**N1** is UI ("Bezig…" pas na de bevestiging, op de knop die je koos): geen test, B kijkt in de simulator.

**Tests (stand na A, fix-cyclus 1):**
- `tests/photos/flagDateWindow.test.ts` (S1, backend): melden om 00:10, 01:00 en 02:59 UTC en afwijzen om 02:30 UTC noemen de dag ervoor; daarna draait de cron op de genoemde dag (de foto blijft) en de dag erna (weg). Controles om 12:00 en 23:30 UTC. 4 rood, 3 groen.
- `app/tests/flags.test.ts` (S1, app): `removalDay`, 10 gevallen met de hand (winter, zomer, precies 03:00, middernacht, jaarwissel). 10 rood: de functie bestaat nog niet.
- `tests/photos/listFlaggedSame.test.ts` (S2): het gedrag, groen. Het lezen toetst de audit.
- `tests/photos/flagNoMailDeleting.test.ts` (N3): 6 rood, 3 controles groen.
