# WP16: Groepen — overzicht en detail, met live ongelezen-tellers

> ✅ Afgerond 2026-11-04 (gate build 47, hercheck build 48). App-WP (zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4)), met een backend-deel. Eigen sessie per rol. Bouwt op [WP15a](./WP15a-navigatie-subscriptions.md) en [WP15b](./WP15b-profiel-instellingen-info.md).

## Productdoel

Een ingelogde user ziet op Mijn groepen al zijn groepen. In een groep ziet hij de albums, met per album hoeveel foto's van anderen nieuw zijn voor hem, en de leden. Voegt een ander lid een foto toe, dan ziet hij de teller meteen oplopen, zonder te verversen. Home opent de groep waar hij het laatst was.

## Invarianten

1. **Een teller telt wat de backend telt.** Het getal per album komt uit `albums.listByGroupWithUnread`: foto's van anderen, toegevoegd na het laatste bezoek aan dat album (zie [`migratie-plan-convex.md`](../migratie-plan-convex.md) §Unread-count). De app rekent niet zelf en verbergt niets.
2. **Een teller loopt live mee, en alleen voor het scherm in beeld.** Een nieuwe foto in een album van de open groep verhoogt de teller binnen enkele seconden. Een andere tab of de achtergrond: de query loopt niet (WP15a invariant 5, via `useLiveQuery`).
3. **Een album is pas gelezen als de user de foto's zag.** WP16 roept `albums.markSeen` niet aan: het albumscherm met de foto's is WP17. Tikken op een album leidt naar het WP17-pad, met de leeg-toestand van WP15a. De enige manier om in WP16 tellers op nul te zetten is een expliciete actie van de user ("Markeer alles gelezen", als die in scope komt). Richting: liever een teller te veel dan een foto die de user nooit te zien krijgt.
4. **Je ziet alleen groepen waar je lid van bent, en van leden alleen naam, profielfoto en rol.** Dat bewaakt de backend (WP23-whitelist, `requireMember`), niet het scherm.
5. **Wie geen lid meer is, ziet dat netjes.** Word je uit een groep gehaald terwijl je hem open hebt, of opent een link of Home een groep waar je geen lid meer van bent, dan crasht de app niet en toont hij geen oude inhoud. Je ziet een NL-melding en een weg naar Mijn groepen.
6. **Home onthoudt de laatst bezochte groep per user.** Na uitloggen en inloggen als een ander krijgt die user niet de groep van de vorige (zoals WP15b invariant 12). Bestaat de groep niet meer, of ben je geen lid meer: Mijn groepen.
7. **Een cover toont de foto rechtop.** Groeps- en albumcovers volgen `photos.exifOrientation`, niet de EXIF-tag in het bestand ([WP8](./WP8-photo-rotation.md) §Frontend-contract). **→ Verschoven naar WP17 (besluit 2).** WP16 toont geen beeld.
8. **WP13, WP15a en WP15b blijven werken.** De bestaande tests blijven groen, met alleen A's bewuste aanpassingen. Schermen gebruiken alleen tokens en componenten uit `app/src/theme` en `app/src/components`, en volgen [`design.md`](../design.md) §3 (grote tekst: groepstabs 2×2, albumnamen nooit afgekapt; *de 2×2 schuift naar WP18/WP19 (besluit 5): in WP16 kappen de twee tabs niet af*), §6 (toestanden) en §7 (stack, terugknop-pil op de cover).

## Edge cases + scope-uitsluitingen

**In scope:**
- Mijn groepen: lijst met groepsnaam, cover (*WP17, besluit 2*) en je rol; leeg-toestand voor een user zonder groepen
- Groep: kop met cover (*WP17, besluit 2*) en terugknop-pil, groepstabs (design.md §7; *alleen Albums en Leden, besluit 5*), tab Albums met albums per jaar (jaartallen in Literata) en de teller per album, tab Leden
- Home = laatst bezochte groep, anders Mijn groepen
- Toestanden laden, leeg, fout en `reconnecting` op elk scherm
- Routes voor Mijn groepen, Groep en het albumpad dat WP17 vult

**Te beslissen door A (spec-criticus, leest de oude app), daarna door Wouter:**
- Pariteit per scherm: wat toonde de oude app op Mijn groepen, in Groep → Albums en in Groep → Leden? Had Mijn groepen een teller per groep? Een teller per groep vraagt een nieuwe query over alle groepen, met meer live werk.
- Groepsbeheer: welke acties had de oude app (groep aanmaken of wijzigen, lid verwijderen, rol wijzigen, groep verlaten, album aanmaken of wijzigen), en wie mocht wat? Regie-advies: WP16 alleen lezen, beheer in een eigen WP. Wouter beslist.
- "Markeer alles gelezen" (`groups.markAllAlbumsSeen` bestaat): had de oude app iets vergelijkbaars, en waar staat het?
- Waar de laatst bezochte groep staat: op het toestel (per user) of in de backend. De oude app had een instelling "Home-groep wissen" (WP15b). Wat deed die?
- De groepstabs Cover en Uitnodigen: tonen als leeg-toestand ("Komt in een volgende versie"), of weglaten tot WP18 en WP19? Met vier tabs is de 2×2-weergave bij grote tekst te testen.
- Vraagt een scherm een backend-functie die er niet is, of een andere vorm: noem hem. A schrijft er tests voor, B bouwt hem (zoals in WP15b).

**Bewust niet:**
- Albumscherm met foto's, foto-detail en `markSeen`: WP17
- Covers wijzigen, foto's uploaden: WP18
- Uitnodigen en uitnodigingen accepteren: WP19
- Foto's melden: WP20
- Push-meldingen bij nieuwe foto's

## Risico-assessment

- **security/privacy: medium.**
  - De ledenlijst toont andere users. De vorm is vastgelegd in WP23 (`publicProfile`, `listMembers`): nooit e-mail of Clerk-subject.
  - Komt beheer in scope, dan raakt dit de rollen per groep. Dan geldt de standing rule [Toegangsdefinities](../conventions/work-package-specs.md) en heroverweegt regie de setup.
- **ops: medium.**
  - `albums.listByGroupWithUnread` draait opnieuw bij elke wijziging in iets wat hij las: elk album van de groep, elke koppeling van een nieuwe foto, elke foto in die set, en je eigen `albumLastSeen`-rijen. Met ~50–100 foto's per album is dat licht, maar een teller op Mijn groepen over alle groepen vermenigvuldigt het.
  - Een fout getal faalt stil: niemand ziet het als fout. Het dashboard is het bewijs bij de gate.
  - ~~Covers laden beelden uit Convex-storage.~~ *Vervalt: geen beelden in WP16 (besluit 2).*
- **external deps: laag.** Geen nieuwe dienst.
- **multi-user/concurrency: medium.**
  - Tellers hangen af van wat andere leden doen.
  - Lidmaatschap kan verdwijnen terwijl het scherm open is (invariant 5).
  - "Markeer alles gelezen" terwijl een ander een foto toevoegt: een foto die net vóór `now` landt, geldt als gelezen. Acceptabel als de actie bewust is.
- **data/schema-evolutie: ~~laag~~ medium (besluit 3).** Zie §sortDate.
  - Geen schemawijziging verwacht. Een veld voor de laatst bezochte groep in de backend zou additief en optioneel zijn.
  - De gemigreerde `albumLastSeen`-rijen (WP12) worden hier voor het eerst aan users getoond. De gate kijkt of de tellers op dev geloofwaardig zijn.
- **ops-runbook-impact:** geen env-vars. B voegt in `external-services.md` §Convex een regel toe: hoe je in het dashboard ziet dat `albums:listByGroupWithUnread` alleen loopt voor de open groep, en wat een nieuwe foto doet.

## Werkwijze

| Stap | Rol | Output |
|---|---|---|
| 1 | regie | dit doc |
| 2 | A (`wp-a`), eigen sessie | spec-aanvulling (beslispunten hierboven, pariteit-checklist per scherm, routes) en RED tests voor pure logica (bijvoorbeeld albums per jaar, de keuze van Home, de tekst bij een verloren lidmaatschap) en voor eventuele nieuwe backend-functies |
| 3 | Wouter + regie | besluiten op A's open vragen, vooral de scope van beheer |
| 4 | B (`wp-b`), eigen sessie | impl tot groen, simulator-check in licht en donker en bij de grootste tekst, runbook-regel |
| 5 | audit (`wp-audit`), eigen sessie | rapport in chat |
| 6 | Wouter | gate |

Er is geen red-team: geen enkele dimensie is hoog. Komt beheer in scope, of vindt de audit iets in de toegang tot groepen, dan beslist regie opnieuw.

## Cross-refs

- [WP15a](./WP15a-navigatie-subscriptions.md): `useLiveQuery`, routes, leeg-toestand, Home op `/`
- [WP15b](./WP15b-profiel-instellingen-info.md): bezoek niet doorgeven aan de volgende user, "Home-groep wissen"
- [WP23](./WP23-read-whitelist.md): `publicProfile`, `listMembers`
- [WP8](./WP8-photo-rotation.md): `exifOrientation`
- [WP12](./WP12-data-migratie-tooling.md) §`seenPics` is een ongelezen-wachtrij: hoe de gemigreerde `albumLastSeen` is afgeleid
- [`migratie-plan-convex.md`](../migratie-plan-convex.md) §Unread-count per album per user
- [`cascade-matrix.md`](../cascade-matrix.md) AP1, AP2, A2, M3
- [`design.md`](../design.md) §3, §4, §5, §6, §7, §10
- Oude app (alleen A): `~/Code/v1/clubalmanac-app`, schermen Mijn groepen, Groep (Albums, Leden) en Home

## Acceptance

- Root en app: typecheck en tests groen op Node 24, ook in CI. Bestaande tests blijven groen, met alleen A's bewuste aanpassingen.
- Audit: geen open blockers.
- **Empirische gate (Wouter, TestFlight-build, met het Convex-dashboard open):**
  1. Mijn groepen toont je groepen. Een groep opent op Albums, met jaartallen en tellers. De terugknop-pil brengt je terug.
  2. Leden: naam, profielfoto en rol, geen e-mailadres.
  3. Dashboard, live teller: voeg als een ander lid een foto toe aan een album van de open groep. De teller gaat binnen enkele seconden omhoog.
  4. Dashboard, tabwissel: wissel naar een andere tab. `albums:listByGroupWithUnread` loopt niet meer, ook niet bij een nieuwe foto. Terug in de groep: één uitvoering en de juiste teller.
  5. Tik op een album: het WP17-pad opent, en de teller blijft staan.
  6. Home: sluit Clubalmanac op je iPhone en open hem opnieuw. Home opent de laatst bezochte groep. Log uit en in als dev2: Home opent niet de groep van dev1.
  7. Haal jezelf in het dashboard uit de open groep: een NL-melding en een weg naar Mijn groepen, geen crash.
  8. Mijn groepen en Groep bij de grootste tekst, in licht en donker: ~~groepstabs 2×2~~ de twee groepstabs en de albumnamen niet afgekapt (besluit 5).
  9. Ruimte voor bevindingen buiten deze stappen

---

## Spec-criticus aanvullingen (A, 2026-11-04)

Bronnen: de oude app (`screens/Home.jsx`, `Group.jsx`, `GroupAlbumsSub.jsx`, `GroupMembersSub.jsx`, `InfoProtected.jsx`, `EditGroupSub.jsx`, `EditAlbum.jsx`, `NewGroup.jsx`, `NewAlbum.jsx`, `components/GroupCard.jsx`, `AlbumCard.jsx`, `GroupHeaderNew.jsx`, `nav/TabBar.jsx`, `datastores/user.js`, `group.js`), de oude backend (`blob-images-api-groups`: `listGroups.js`, `getGroup.js`, `listMembers.js`, `listAlbums.js`, `createAlbum.js`, `updateAlbum.js`, `deleteAlbum.js`, `updateGroup.js`, `deleteGroup.js`), de WP12-transform, en de huidige `convex/` en `app/`.

### Kernvondsten

1. **De app kan nog geen beeld tonen.** Geen publieke functie geeft een URL voor een `storageId`. Volgens WP23 komt `getUrl` met WP17. Besluit 2: beelden en invariant 7 naar WP17.
2. **Een gewone `Error` uit een query laat het scherm crashen.** `useQuery` van Convex gooit de fout tijdens het renderen, en de app heeft geen error boundary. In productie is de tekst bovendien "Server Error" (WP15b). Een lid dat uit de open groep verdwijnt, crasht dus nu de app (invariant 5). De groep-reads geven daarom een `ConvexError` met code `NOT_MEMBER`, en de app vangt die op zonder te crashen (invariant 9).
3. **De oude app sorteerde op een datum die de migratie niet meeneemt.** Groepen en albums hadden een `sortDate`: een datum die een admin zelf kon kiezen, met `createdAt` als terugval. Daarop sorteerde de oude app (nieuwste eerst), en daar kwam "Sinds 2019" en "Opgericht 2019" vandaan. De WP12-transform neemt `sortDate` niet mee. Besluit 3: de datum gaat mee, zie §sortDate.
4. **De oude app had een teller per groep.** Op Mijn groepen stond per groep een oranje getal: alle nieuwe foto's over alle albums. Besluit 4: ja.
5. **"Markeer alles gelezen" bestond niet.** De oude app had niets vergelijkbaars. `groups.markAllAlbumsSeen` blijft daarom buiten WP16.

### Beslissingen op "Te beslissen door A"

**1. Pariteit:** zie de checklist per scherm hieronder.

**2. Groepsbeheer:** dit had de oude app. Besluit 1: niet in WP16, wel een eigen WP vóór T0.

| Actie (oude app) | Wie (oude backend + UI) | Nieuwe backend nu | Verschil |
|---|---|---|---|
| Nieuwe groep (naam, omschrijving, cover) | iedereen | `groups.create` | Geen cover bij aanmaken |
| Groep bewerken: naam, omschrijving, datum, cover (tab Cover) | admin | `groups.update` (admin) | Datum bewerken: beheer-WP (besluit 3) |
| Groep verwijderen | alleen de oprichter | `groups.remove`: elke admin | Strenger in v1 |
| Nieuw album (naam, cover) | UI: alleen admin; backend: elk lid (bug in de rolcheck) | `albums.create`: elk lid | Keuze nodig |
| Album bewerken: naam, datum, cover; album verwijderen | admin | `albums.update`, `albums.remove` | Datum bewerken: beheer-WP (besluit 3) |
| Rol wijzigen ("Maak admin", "Maak gast") | admin; een gewone admin niet bij de oprichter | `groups.updateMemberRole`: elke admin, ook bij de oprichter; de laatste admin blijft | Oprichter niet beschermd |
| Oprichter overdragen ("Maak founder") | alleen de oprichter | geen mutation | Ontbreekt |
| Lid verwijderen ("Verban uit groep") | admin; niet de oprichter | `groups.removeMember` (admin) | Oprichter niet beschermd |
| Groep verlaten | elk lid behalve de oprichter, en alleen als er een andere admin is | `groups.removeMember` op jezelf: altijd; de laatste admin promoveert de rest (M2-c) | Andere regel |
| Uitnodiging intrekken | admin | WP19 | — |

Een beheer-WP raakt rollen per groep. Daar geldt de standing rule Toegangsdefinities, en daar hoort ook `groups.addMember` zonder instemming (WP24-closeout).

**3. "Markeer alles gelezen":** niet in WP16. De oude app had het niet, en invariant 3 zegt "liever een teller te veel". De mutation blijft bestaan.

**4. Waar de laatst bezochte groep staat: op het toestel, per user.** De oude app bewaarde de Home-groep lokaal, onder de Cognito-sub van de user. Hij werd gezet bij een tik op een groep in Mijn groepen, en gewist bij "Home-groep wissen" (Instellingen) en bij groep verlaten.

| Onderdeel | Besluit |
|---|---|
| Plek | Op het toestel, per user. Geen backend-veld: geen schrijfactie per groepsbezoek, en Home weet het al bij een koude start zonder netwerk. Een tweede toestel heeft zijn eigen Home. |
| Zetten | Zodra het Groep-scherm de groep echt toont (de user is lid). Hoe de user er kwam, maakt niet uit. |
| Wissen | Bij `NOT_MEMBER` voor die groep, en als Home ziet dat de groep niet meer in je groepen staat. |
| Andere user | Een opgeslagen groep van user A geeft user B niets (invariant 6). Een onleesbare opgeslagen waarde geeft ook niets. |
| "Home-groep wissen" | Vervalt. Home ruimt zichzelf op, en de terugknop-pil leidt altijd naar Mijn groepen. |

**5. Groepstabs Cover en Uitnodigen:** in de oude app zagen alleen admins die tabs. Een gewoon lid zag alleen Albums en Leden. Besluit 5: weglaten tot WP18 en WP19.

**6. Backend-functies die een scherm mist:**

| Functie | Wat | Waarom | Tests |
|---|---|---|---|
| Groep-reads: `groups.getById`, `groups.getWithCover`, `groups.listMembers`, `albums.listByGroup`, `albums.listByGroupWithUnread` | Geen lid, of de groep bestaat niet: een `ConvexError` met code `NOT_MEMBER`. Beide gevallen geven precies dezelfde fout (geen bestaans-orakel, WP23). | Invariant 5 en 9 | `tests/groups/notMember.test.ts` |
| `groups.listMine` | Per groep ook `unreadCount`: de som van de tellers van `albums.listByGroupWithUnread` voor die groep | Teller per groep (besluit 4) | `tests/groups/listMineUnread.test.ts`, `tests/readWhitelist/groups.test.ts` (vorm aangepast) |

Een eigen rol op het Groep-scherm is niet nodig zolang er geen admin-tabs of beheer in WP16 zitten. `groups.listMine` geeft de rol al.

### Routes

Alles staat in de stack van de Home-tab, dus achter de bestaande `Protected` van `(tabs)`. Geen nieuwe publieke paden.

| Scherm | Pad | Titel / terug |
|---|---|---|
| Mijn groepen | `/` (wortel van de Home-stack) | Grote titel "Mijn groepen" |
| Groep (Albums of Leden) | `/groep/<groupId>` | Terugknop-pil "‹ Mijn groepen" op de cover |
| Album (WP17 vult het) | `/groep/<groupId>/album/<albumId>` | Terug naar de groep. In WP16 de leeg-toestand van WP15a. |

- De groepstabs (Albums, Leden) wisselen binnen het scherm, zonder eigen route. Een tabwissel komt dus niet op de stack, en de terugknop gaat altijd naar Mijn groepen. Een groep opent op Albums.
- Alleen de zichtbare groepstab heeft een live query. Op Leden loopt `albums.listByGroupWithUnread` niet.
- **Home.** Bij een koude start en na inloggen bepaalt de app één keer de Home-stack: Mijn groepen, met daarop de laatst bezochte groep als die er is en je er lid van bent. Daarna gedraagt de Home-tab zich als elke tab: hij houdt zijn stack, en nog eens tikken op de actieve tab gaat naar de wortel (Mijn groepen). De oude app sprong bij elke tik op Home naar de Home-groep. Dat vervalt: wie op Mijn groepen staat, blijft daar.
- Mijn groepen zelf start Home nooit opnieuw. Terug naar Mijn groepen is terug naar Mijn groepen.

### Pariteit-checklist per scherm

**Mijn groepen** (`/`)

| Oude app | Nieuw (16) |
|---|---|
| Groepen als tegels met cover, naam, "Sinds <jaar> · N leden" | Per groep: een vlak in het verloop met de eerste letter (besluit 2), naam, "Sinds <jaar>" en je rol. Geen aantal leden: dat kostte een query per groep. Het staat op Leden. |
| Oranje teller per groep (nieuwe foto's over alle albums) | Ja (besluit 4). 0 geeft geen teller. |
| Sortering: datum van de groep (`sortDate`, anders `createdAt`), nieuwste eerst | `sortDate`, anders `createdAt`, nieuwste eerst; bij gelijke datum op naam (besluit 3) |
| Uitnodigingen (status "invite") weggefilterd | Niet van toepassing: `listMine` geeft alleen lidmaatschappen |
| Knop "Nieuwe groep" | Beheer-WP (besluit 1) |
| Leeg: "Je bent nergens lid. Maak anders je eigen groep." | Leeg-toestand (design.md §6). De zin verwijst niet naar "groep maken" zolang dat er niet is. |
| Fout: "opnieuw laden" | Fout met "Opnieuw" (design.md §6) |
| Tik op een groep zet de Home-groep | Openen van een groep zet de laatst bezochte groep (beslissing 4) |
| Hulp-modal | Vervalt (design.md §6) |

**Groep, kop**

| Oude app | Nieuw (16) |
|---|---|
| Cover over de volle breedte, naam, omschrijving | Een vlak in het verloop met de eerste letter (besluit 2), naam, omschrijving, terugknop-pil (design.md §7) |
| "Opgericht <jaar> · N leden" (aantal incl. uitnodigingen) | "Opgericht <jaar>". Het aantal leden staat op Leden. |
| Tabs: Albums, Leden; voor admins ook Cover en Uitnodigen; Films bij twee vaste groepen | Albums en Leden. Cover en Uitnodigen: WP18 en WP19 (besluit 5). Films vervalt (was hard gecodeerd voor twee groepen). |

**Groep → Albums**

| Oude app | Nieuw (16) |
|---|---|
| Tegels in een raster, nieuwste eerst, met "Sinds <jaar>" | Albums per jaar, met het jaartal als kop (design.md C+). Jaar en volgorde volgen `sortDate`, anders `createdAt` (besluit 3). Jaren nieuwste eerst. Binnen een jaar nieuwste eerst, bij gelijke datum op naam. |
| Cover per album | Een vlak in het verloop met de eerste letter; de cover komt met WP17 (besluit 2) |
| Oranje teller per album (nieuwe foto's) | De teller uit `albums.listByGroupWithUnread`, live (invariant 1 en 2). 0 geeft geen teller. VoiceOver leest "3 nieuwe foto's". |
| Albumnaam op de tegel | Nooit afgekapt (design.md §3) |
| Knop "Nieuw album" (alleen admin) | Beheer-WP (besluit 1) |
| Leeg: "Nog geen albums hier" | Leeg-toestand, zonder verwijzing naar "album maken" |
| Tik: albumscherm, terug met de groepsnaam | Tik: het WP17-pad, teller blijft staan (invariant 3) |

**Groep → Leden**

| Oude app | Nieuw (16) |
|---|---|
| Secties Admins, Gasten, Uitgenodigd | Secties Admins en Leden. Uitnodigingen: WP19. |
| Per sectie op naam (hoofdletters tellen niet) | Zo, Nederlandse sortering |
| Per lid: profielfoto, naam, "lid sinds <jaar>" | Naam, de eerste letter in plaats van de profielfoto (WP17, besluit 2), rol via de sectie, "Lid sinds <jaar>" |
| Labels "Eigenaar" (oprichter) en "Me" | Labels "Oprichter" en "Jij" |
| E-mailadres bij een uitnodiging | Vervalt: nooit een e-mailadres (invariant 4) |
| Menu per lid (rol, verbannen, verlaten, oprichter) | Beheer-WP (besluit 1) |
| "Groep zonder leden. Dit kan eigenlijk niet." | Kan niet voorkomen: jij bent er zelf. Geen eigen tekst. |

Een lid zonder naam (gemigreerd, of zonder naam in Clerk) staat onderaan zijn sectie, met een neutrale tekst in plaats van de naam. Een lidmaatschap zonder user-rij (hoort niet te bestaan) ook.

De rol "member" heette in de oude app "gast". Nieuw: "lid". "Gast" klinkt tijdelijk, en de rol is dat niet.

**Home**

| Oude app | Nieuw (16) |
|---|---|
| Home = Home-groep (Albums) als die gezet is, anders Mijn groepen | Zo, met de regels van beslissing 4 en §Routes |
| Home-groep van een groep waar je geen lid meer van bent: scherm met fout | Mijn groepen, en de onthouden groep wordt gewist (invariant 6) |
| Instellingen: "Home groep" met de naam en een prullenbak | Vervalt (beslissing 4) |

### Aanvullende invarianten

9. **Geen lid meer geeft een herkenbare fout, en de app vangt hem op.** De groep-reads geven bij geen lid en bij een onbekende groep precies dezelfde `ConvexError` met code `NOT_MEMBER`. De app herkent hem aan de code, nooit aan de tekst. Hij crasht niet, toont geen oude inhoud van de groep, en toont een NL-melding met een knop naar Mijn groepen. Elke andere fout geeft de gewone fout-toestand met "Opnieuw".
10. **De teller per groep is de som van de tellers per album.** Hetzelfde getal als de albums van die groep samen. De app telt niet zelf op.
11. **Een jaar is een kalenderjaar in Nederlandse tijd, van `sortDate` als die er is, anders van `createdAt`.** Een album dat op 1 januari om 00:30 (NL) is aangemaakt, staat onder het nieuwe jaar, ook al is het in UTC nog 31 december. Dat geldt ook voor "Sinds <jaar>" en "Opgericht <jaar>" (met `sortDate`), en voor "Lid sinds <jaar>" (met `joinedAt`).
12. **Home kiest één keer per sessie.** Tot bekend is welke groepen je hebt, toont Home een laad-toestand, geen flits van Mijn groepen of van een oude groep.

### Edge cases

- **Uit de groep gehaald op Leden of Albums:** binnen enkele seconden de melding van invariant 9, en de onthouden groep is gewist.
- **De groep is verwijderd terwijl hij open is:** hetzelfde als uit de groep gehaald.
- **Je bent het laatste lid en wordt verwijderd:** de groep verdwijnt (M2-e). Hetzelfde als hierboven.
- **Een album zonder foto's, of zonder nieuwe:** geen teller.
- **Een groep zonder albums:** de leeg-toestand op Albums. Leden werkt gewoon.
- **Een lange album- of groepsnaam bij de grootste tekst:** breekt over regels, wordt niet afgekapt.
- **Een getal van drie cijfers:** volledig getoond, geen "99+" (invariant 1: de app verbergt niets).
- **Een ander lid beoordeelt een foto:** `listByGroupWithUnread` leest elke nieuwe foto, dus de rating-update in de foto-rij laat hem opnieuw draaien. Het getal blijft gelijk. Zie de runbook-regel.
- **Uitloggen en inloggen als een ander op hetzelfde toestel:** Home toont de groep van de nieuwe user of Mijn groepen, nooit die van de vorige.
- **Een groep openen via een oude of verzonnen id (deep link, WP22):** een id die geen Convex-id is, geeft een validatiefout en dus de gewone fout-toestand. Een geldige id van een groep zonder lidmaatschap geeft de melding van invariant 9.

### Tests

| Bestand | Pint |
|---|---|
| `tests/groups/notMember.test.ts` | Invariant 5 en 9: `NOT_MEMBER` bij geen lid en bij een onbekende groep, gelijk voor beide; ook na verwijderen terwijl je kijkt, en na het verwijderen van de groep |
| `tests/groups/listMineUnread.test.ts` | Invariant 10: `unreadCount` per groep = som van de albumtellers; eigen foto's tellen niet; een andere user ziet zijn eigen getal; groepen zonder albums geven 0 |
| `tests/readWhitelist/groups.test.ts` (A paste aan) | De vorm van `listMine`: groep-velden, rol en `unreadCount` |
| `tests/readWhitelist/_world.ts` (A paste aan) | `sortDate` in de groep- en albumvorm, en gevuld in de seed |
| `tests/migration/sortDate.test.ts` | De transform neemt `sortDate` mee (§sortDate) |
| `tests/albums/sortDateUnread.test.ts` | `sortDate` telt niet mee in de tellers |
| `app/tests/groups.test.ts` | Het jaar (`displayYear`, `sortDate` voor `createdAt`), albums per jaar (invariant 11), de volgorde van Mijn groepen, de secties van Leden, het tellerlabel, de foutklasse (invariant 9), Home (invariant 6 en 12) en het geheugen per user |
| `app/tests/groupRoutes.test.ts` | De paden, en de routebestanden voor Groep en Album bestaan onder de Home-stack, zijn afgeschermd, en zijn niet publiek |

De pure logica staat in de app-tests als functies in `app/src/lib/groups.ts` en `app/src/lib/groupRoutes.ts`. B kiest de vorm van de schermen zelf.

### Regie-besluiten (2026-11-04)

| # | Vraag van A | Besluit |
|---|---|---|
| 1 | Groepsbeheer in WP16? | Nee (Wouter). WP16 alleen lezen. Beheer krijgt een eigen WP vóór T0, met de standing rule Toegangsdefinities. |
| 2 | Covers en profielfoto's? | Naar WP17 (Wouter), samen met het beeldpad. WP16 toont een vlak in het verloop met de eerste letter. Invariant 7 verhuist naar WP17. |
| 3 | `sortDate`? | Meenemen (Wouter). Albums en groepen krijgen een optioneel veld, de WP12-transform neemt het mee, en jaar en volgorde volgen `sortDate`, anders `createdAt`. Datum bewerken hoort bij het beheer-WP. Data/schema-evolutie gaat naar medium: zie A's aanvulling hieronder. |
| 4 | Teller per groep? | Ja (Wouter), via `unreadCount` in `groups.listMine`. |
| 5 | Tabs Cover en Uitnodigen? | Weglaten tot WP18 en WP19 (regie, volgt uit 1). De 2×2-check bij grote tekst schuift mee. Gate-stap 8 checkt alleen dat de twee tabs en de albumnamen niet afkappen. |

### sortDate (A, ronde 2, na besluit 3)

**Bron in AWS.**

| | Groep | Album |
|---|---|---|
| Record | `PK = GBbase`, `SK = <groupId>` | `PK = GA<groupId>`, `SK = <albumId>` |
| Veld | `sortDate` (top-level). Kopieën in `membership.group` tellen niet: de transform leest alleen het `GBbase`-record. | `sortDate` (top-level) |
| Formaat | Kalenderdag `YYYY-MM-DD`, als string. De app schreef `toISOString().slice(0, 10)` van de datumkiezer. | Zelfde |
| Wie zette het | Een admin, via "Groep bewerken" (tab Cover). Bij aanmaken nooit. | Een admin, via "Album bewerken". Bij aanmaken nooit. |
| Gebruik in v1 | Sortering van Mijn groepen (nieuwste eerst), "Sinds <jaar>", "Opgericht <jaar>" | Sortering van de albums (nieuwste eerst), "Sinds <jaar>" |
| Terugval in v1 | `sortDate \|\| createdAt` | Zelfde |

Let op: het bewerkformulier vulde het datumveld vooraf met `sortDate || createdAt`. Wie een groep of album opsloeg om de naam te wijzigen, schreef dus ook `sortDate = createdAt`. Een `sortDate` die gelijk is aan `createdAt` is daarom gewoon, en onschuldig.

**Het veld.**

| Onderdeel | Besluit |
|---|---|
| Schema | `groups.sortDate` en `albums.sortDate`: `v.optional(v.number())`, epoch-ms. Additief, geen index nodig: de app sorteert de handvol groepen en albums zelf. |
| Vorm (WP23) | `sortDate` komt in `groupFields` en `albumFields`. Elke read met een groep- of albumvorm geeft hem dus mee: `groups.getById`, `getWithCover`, `listMine`, `albums.getById`, `getWithGroup`, `getWithCover`, `listByGroup`, `listByGroupWithUnread`. Alleen als hij gevuld is. |
| Schrijven | Geen publieke mutation zet `sortDate` in WP16. Bewerken hoort bij het beheer-WP (besluit 3). |
| Teller | `sortDate` telt niet mee in "nieuw". De terugval van de teller blijft `max(album.createdAt, membership.joinedAt)`. |

**WP12-transform.**

- `GBbase.sortDate` wordt `groups.sortDate`, `GA….sortDate` wordt `albums.sortDate`.
- Zelfde regel als `createdAt` (WP12 correctie 1): een kalenderdag wordt epoch-ms op UTC-middernacht van die dag.
- Geen bron of een lege string: geen veld. De transform kopieert `createdAt` niet: de terugval doet de app.
- Een onbruikbare waarde (geen string, geen geldige datum): geen veld, een waarschuwing met het bron-id en het woord `sortDate`, en de run gaat door. Een datum is cosmetisch; een run stoppen is daarvoor te zwaar.
- `createdAt` blijft de eigen aanmaakdatum.

**Jaar en volgorde in de app.** De datum van een groep of album is `sortDate`, anders `createdAt`. Het jaar is het kalenderjaar van die datum in Nederlandse tijd (invariant 11). Een gemigreerde dag staat op UTC-middernacht, en dat is in Nederland 01:00 of 02:00 op dezelfde dag: het jaar klopt dus ook op 1 januari. Volgorde: nieuwste datum eerst, dan naam, dan id.

**Getallen.** Geteld op de prod-extract van 2026-11-04, bij de herlaadbeurt.

| | Totaal | Met `sortDate` | In een ander jaar dan `createdAt` | Onleesbaar |
|---|---|---|---|---|
| Groepen (prod, 2026-11-04) | 6 | 1 | 0 | 0 |
| Albums (prod, 2026-11-04) | 17 | 4 | 1 | 0 |

**Migratie op dev (2026-11-04).** Dev is opnieuw geladen met de WP12-tooling ([runbook](../runbooks/wp12-data-migratie.md)): export als anker, deploy, extract (`AWS_PROFILE=clubalmanac`), transform, load-files, reset, `userVisits` leeg, load-records, verify. Verify groen, de aantallen gelijk aan de WP12-baseline, en `sortDate` op 4 albums en 1 groep. Een backfill kan niet: de koppeling van AWS-id naar Convex-id wordt niet bewaard. Prod heeft niets extra's nodig: de T0-run gebruikt de nieuwe transform vanzelf. Vondst: `reset` kent `userVisits` niet (backlog in [`migratie-status.md`](../migratie-status.md)).

**Testgroep op dev.** "Gatetest" blijft op dev staan, voor WP17 en later: dev1 is admin, de users-rij `dev-2@…` is lid, met de albums "Gatetest nu" (drie foto's van `dev-2@…`) en "Gatetest 2019" (`sortDate` in 2019). Een rij toevoegen in het dashboard: Data → tabel → Add, met een JSON-lijst (`[{…}]`). Let op: Clerk-account dev2 hoort bij de users-rij `dev-3@clubalmanac.test`, en dev3 bij `dev-2@…`.

## Verloop

A (drie rondes) → regie-besluiten → B → audit (geen blockers, één should-fix) → twee fix-cycli (alleen B) → gate → hercheck.

| Cyclus | F | Kern | Bron |
|---|---|---|---|
| 1 | S1 | Na `reconnecting`, of na "Opnieuw" in de foutgrens, sprong Mijn groepen alsnog naar de laatst bezochte groep. De keuze van Home staat nu buiten het scherm (`app/src/lib/homeDecision.ts`, met test), één keer per sessie. | audit |
| 1 | N4 | Runbook-regel: `users:profile` binnen Groep alleen op Leden. | audit |
| 2 | F1 | De +-knop (sinds WP15a) was in licht geen ronde cirkel: het verloop rekende met de volle maat binnen de rand, en de effen achtergrond kwam erachter tevoorschijn. | gate build 47 |

## Gate-uitslag

**Build 47 (2026-11-04),** met het dashboard als bewijs:
- Mijn groepen met teller per groep, Albums per jaar (ook 2019 via `sortDate`), Leden zonder e-mailadres, het albumpad zonder `markSeen`: ✅;
- live teller: een foto van een ander lid gaf binnen seconden 1 → 2; op een andere tab geen `albums:listByGroupWithUnread`, terug op Home één uitvoering en 3: ✅;
- Home na een koude start: de laatste groep, zonder flits; vliegtuigmodus op Mijn groepen springt niet (6b); een andere user krijgt de groep niet: ✅;
- uit de open groep gehaald: NL-melding, geen oude albums, Home daarna Mijn groepen; ook met Profiel in beeld (7b, N1 trad niet op): ✅;
- grootste tekst, licht en donker: ✅, op de +-knop na (F1).

**Build 48 (2026-11-04), op `0f08958`:** F1 ✅.

## Backlog (kan-punten)

- Word je uit een groep gehaald terwijl Groep niet in beeld is, dan kan de terugkeer even de oude inhoud tonen, tot `NOT_MEMBER` binnenkomt (audit N1, uit het WP15a-ontwerp). Niet gezien bij de gate.
- Een verzonnen groep-id geeft "Controleer je verbinding" met "Opnieuw", dat nooit lukt (audit N2). Naar WP22.
- De album-reads geven nog een gewone `Error`, geen `NOT_MEMBER` (audit N3). Voorwaarde voor WP17.
- Op Groep, en op het inlogscherm, scrolt de inhoud onder een statusbalk zonder achtergrond door (B).
- De transform nummert de nep-adressen `dev-N@clubalmanac.test` niet in de volgorde van de Clerk-accounts, wat verwarrend is bij een gate.
