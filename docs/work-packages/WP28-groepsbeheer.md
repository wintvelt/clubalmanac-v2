# WP28: Groepsbeheer

> Draft regie 2026-11-08. App-WP met een flink stuk backend. Verplicht vóór T0 (besluit 2026-11-04). A → besluiten Wouter → B → audit → red-team op toegang → TestFlight-gate. Eigen branch `wp28`.

## Productdoel

Een admin richt zijn groep en albums zelf in en beheert zijn leden; een lid kan zelf vertrekken. Wie niet meer bij een groep hoort, ziet daarna niets meer van die groep: geen foto's, geen cover, geen uitnodiging die hem terughaalt.

## Acties (uit WP16 §Beslissingen 2)

| Actie | v1 (wie) | Backend nu | Verschil |
|---|---|---|---|
| Groep maken (naam, omschrijving, cover) | iedereen | `groups.create` | geen cover bij maken |
| Groep wijzigen (naam, omschrijving, datum, cover) | admin | `groups.update` | datum (`sortDate`) nog niet te wijzigen |
| Groep verwijderen | alleen de oprichter | `groups.remove`: elke admin | v1 strenger |
| Album maken (naam, cover) | UI: admin; backend: elk lid | `albums.create`: elk lid | keuze nodig |
| Album wijzigen (naam, datum, cover), album verwijderen | admin | `albums.update`, `albums.remove` | datum nog niet te wijzigen |
| Rol wijzigen (admin, gast) | admin, niet bij de oprichter | `groups.updateMemberRole`: elke admin, ook bij de oprichter | oprichter niet beschermd |
| Oprichter overdragen | alleen de oprichter | ontbreekt | nieuw |
| Lid verwijderen | admin, niet de oprichter | `groups.removeMember` | oprichter niet beschermd |
| Groep verlaten | elk lid behalve de oprichter, alleen als er een andere admin is | `removeMember` op jezelf: altijd; laatste admin → iedereen admin (M2-c) | andere regel |
| Uitnodiging intrekken | admin | — | WP19 |

## Invarianten

1. **Elke beheeractie heeft een rol-gate in de backend**, niet alleen in de UI. Wie de rol niet heeft, krijgt dezelfde weigering als bij een groep of album die niet bestaat (geen bestaans-orakel, zoals WP24).
2. **Altijd een oprichter en minstens één admin** zolang de groep leden heeft, ook bij gelijktijdige acties van twee admins.
3. **Weg is weg.** Wie uit een groep verdwijnt (verwijderd, vertrokken, groep gewist), ziet daarna geen album, foto, cover of lid van die groep meer. Zijn eigen foto's verdwijnen uit de albums van die groep (M1); zijn laatst-gezien gaat weg (M3).
4. **Uitnodigingen vervallen mee** (WP17a-red-team R3). Wie uit een groep verdwijnt, verliest zijn openstaande uitnodigingen voor die groep; een oude uitnodiging haalt hem niet terug.
5. **Cover volgt de foto-toegang.** Een album verwijderen wist ook de groepscover als die foto daarna in geen album van de groep meer staat (zoals AP4, eis 2026-11-07). Een cover kiezen kan alleen met een foto die in een album van die groep staat (WP24).
6. **Datum.** Een admin kan de datum (`sortDate`) van een groep en een album wijzigen; de sortering volgt (WP16 besluit 3).
7. **Geen stille mislukking in de app.** Elke actie meldt in het NL of hij lukte; een weigering noemt de reden.

## Scope

- Backend: de gates en regels per actie (na de besluiten), oprichter overdragen, de cascades van invariant 3–5.
- App: schermen en menu's voor de acties in de tabel, op de plekken die WP16 al heeft (Groep, Leden, albumlijst). Een album kunnen kiezen bij uploaden bestaat al (WP18).
- **Bewust niet:** uitnodigen en intrekken (WP19), account verwijderen (eigen WP), de profielpagina (WP27).

## Open vragen voor A (oude app en backend, rapporteren aan regie)

1. **Pariteit per actie:** wat deed de oude app precies (schermen, bevestigingen, meldingen)? Klopt de tabel hierboven?
2. **Oprichter:** hoe weet de backend nu wie de oprichter is, en wat gebeurt er met die rol bij vertrek (M2-d)? Is er een schema-wijziging of backfill nodig?
3. **Toegangsdefinities** (standing rule): welke publieke paden nemen een groeps-, album- of lid-id aan of schrijven de state waar toegang op leunt? Welke missen een gate of gebruiken een verbodslijst?
4. **Cascades:** dekken M1–M3, AP4 en G3/G4 alle wegen waarop iemand uit een groep verdwijnt? Wat ontbreekt voor invariant 4 en 5?
5. **Splitsen:** is dit één WP, of beter backend (WP28a) en app (WP28b)?

## Besluiten Wouter (2026-11-08, vóór A's advies)

Uitgangspunt: zoals in v1. A checkt in de oude code of v1 het echt zo deed en meldt elke afwijking.

1. **Groep verwijderen:** alleen de oprichter.
2. **Album maken:** alleen een admin.
3. **Oprichter beschermd:** een admin kan de oprichter niet degraderen of verwijderen.
4. **Vertrek van de laatste admin of de oprichter:** iemand neemt de rol van oprichter over, zoals v1 dat regelde. A beschrijft hoe v1 dat precies deed (wie wordt het, of moet de oprichter eerst overdragen).

### Besluiten na A's advies (2026-11-08)

4. **Herzien, zoals v1:** de oprichter kan niet vertrekken; de app zegt dat hij eerst moet overdragen (`FOUNDER_MUST_TRANSFER`). Is hij het enige lid, dan verwijdert hij de groep. Een automatische opvolger komt er alleen bij het verwijderen van zijn account (M2-d).
5. **W5:** album verwijderen alleen door de oprichter. Album wijzigen blijft admin.
6. **W6:** alleen een admin nodigt uit voor een groep, in WP28a. Uitnodigen zelf (schermen, mails) blijft WP19.
7. **W7:** geen mails bij verwijderen, vertrekken, rol en oprichter vóór T0; backlog.
8. **A-keuzes 1–5 bevestigd.**
9. **Splitsen:** WP28a backend (audit en red-team), daarna WP28b app (gate op TestFlight), op dezelfde branch `wp28`.
10. **Rollen op prod blijven zoals ze zijn** (iedereen admin, kernvondst 1). Het echte onderscheid is de oprichter.

## Open vragen voor Wouter (A geeft advies)

1. **Groep verwijderen:** alleen de oprichter (v1) of elke admin (nu)?
2. **Album maken:** elk lid (backend nu) of alleen een admin (UI v1)?
3. **De oprichter beschermen:** mag een admin de oprichter degraderen of verwijderen?
4. **Groep verlaten als laatste admin:** iedereen wordt admin (nu, M2-c), of eerst iemand aanwijzen, of vertrekken weigeren (v1)?

## Risico-assessment

- **security/privacy:** hoog. Toegang tot foto's van leden hangt aan lidmaatschap en rol; standing rule Toegangsdefinities.
- **ops:** middel. Cascades die half blijven hangen zijn onzichtbaar.
- **external deps:** laag.
- **multi-user/concurrency:** middel. Twee admins tegelijk; invariant 2.
- **data/schema:** middel. Mogelijk een oprichterveld en een te wijzigen datum; A bepaalt of er een backfill nodig is.

## Werkwijze

| Stap | Wie | Wat |
|---|---|---|
| 1 | A | Spec-criticus (leest de oude app en backend), pariteit per actie, inventaris toegangsdefinities, advies op de open vragen, RED tests voor backend en app-logica. |
| 2 | Wouter | Besluiten op de open vragen. |
| 3 | B | Impl, en zelf in de simulator kijken of de schermen renderen. |
| 4 | Audit | Op spec, tests en impl. |
| 5 | Red-team | Op toegang: een pad naar foto's, covers of leden van een groep zonder (nog) lid of zonder rol. |
| 6 | Gate | Wouter, TestFlight, dev, met twee accounts. |

## Cross-refs

- [WP16](./WP16-groepen.md) §Beslissingen 2 en 3 (`sortDate`).
- [`cascade-matrix.md`](../cascade-matrix.md): G3, G4, A1, A2, AP4, M1–M3, U8.
- [WP24](./WP24-write-gates.md): write-gates en bestaans-orakels. [WP17a](./WP17a-fotos-bekijken.md) besluit 12 (red-team R3).
- [`work-package-specs.md`](../conventions/work-package-specs.md) §Toegangsdefinities.
- Oude repos (alleen A): `~/Code/v1/clubalmanac-app`, `~/Code/v1/blob-images-api-groups`, `~/Code/v1/blob-images-api-invites`.

## Acceptance

- Tests: invarianten 1–6 in de backend en de app-logica; bestaande suites groen.
- Gate (Wouter, TestFlight, dev, Gatetest, twee accounts): een groep en album maken en wijzigen (ook de datum en de cover); een lid admin maken en terug; een lid verwijderen, waarna hij de groep, de foto's en de cover niet meer ziet en een oude uitnodiging hem niet terugbrengt; oprichter overdragen; groep verlaten; album en groep verwijderen. Wat viel op.

## Spec-criticus aanvullingen (A, 2026-11-08)

Bronnen: oude backend `blob-images-api-groups` op tak `dev` (2023-02; `master` is ouder en mist `sortDate`), de streams in `blob-images-api`, `blob-images-api-invites`, de oude app `clubalmanac-app`. Prod-tellingen uit de lokale extractie van 2026-11-06, alleen aantallen.

### Kernvondsten

1. **Op prod is iedereen admin.** Alle 25 lidmaatschappen in de 6 groepen hebben rol admin. De grootste groep heeft 18 leden, 14 albums en 1459 publicaties. Een gate "admin" is in de bestaande groepen dus een gate "lid". Het enige echte onderscheid is de oprichter. Dat weegt mee bij besluit 1 en 3 en bij W5.
2. **De oprichter is `groups.createdBy`.** De WP12-transform vult hem uit `isFounder` en stopt als die ontbreekt. Op prod is elke oprichter lid en admin. `internalRemoveMember` verhuist hem al (M2-d). `albums.createdBy` is bij de migratie op de oprichter gezet en zegt niets, maar geeft nu wel wijzig- en wisrecht ("maker of admin").
3. **v1 haalde covers en ratings mee weg, langs elke weg.** Elke weggehaalde publicatie liep in v1 via de stream door AP4 (cover) en AP3 (ratings), ook bij lid weg, album weg en groep weg. In v2 doet alleen `albums.removePhoto` dat. M1, `albums.remove`, `groups.remove` en M2-e niet. Gevolg: een cover die wijst naar een foto van een vertrokken lid blijft staan, en invariant 5 faalt bij album verwijderen.
4. **Een uitnodiging haalt iemand terug langs drie wegen.** v1 bewaarde een uitnodiging als lidmaatschap-rij: lid weg is uitnodiging weg. In v2 is het een eigen tabel die niemand opruimt. (a) Een open uitnodiging aan het adres van wie verdwijnt (R3). (b) Een open uitnodiging die hij zelf verstuurde, aan een tweede eigen adres (R3-variant). (c) Een uitnodiging voor een gewiste groep: `invites.accept` en de onboarding (`registerFromSession`) maken dan een lidmaatschap van een groep die niet bestaat.
5. **Elk lid kan een admin uitnodigen.** `invites.create` vraagt alleen lidmaatschap en neemt rol admin aan. Een lid nodigt zijn tweede adres uit als admin en is daarna admin. In v1 nodigde alleen een admin uit. Dit schrijft de rol waar alle beheer-gates op leunen.
6. **Weigeringen zijn gewone `Error`s.** In productie heet elke `Error` "Server Error" (WP15b). De app kan dan geen reden noemen (invariant 7). Verwachte weigeringen moeten een `ConvexError` met een code zijn, zoals `NOT_MEMBER` bij de reads.
7. **Invariant 1 en 7 botsen zoals ze er staan.** "Dezelfde weigering als bij een groep die niet bestaat" voor wie de rol mist, tegenover "een weigering noemt de reden". Een lid weet al dat de groep bestaat; daar lekt een eigen reden niets. Zie A-invariant 2.
8. **v1 kon de datum van een groep niet opslaan.** `updateGroup` leest een veld met een typfout, terwijl het formulier het veld had. Bij albums werkte het. Daarom heeft op prod maar één groep een `sortDate`. Invariant 6 is voor groepen nieuw gedrag.
9. **Groep verwijderen bestond in de v1-app niet.** De knop (alleen voor de oprichter) deed niets: er was geen API-aanroep. Album verwijderen toonde de app alleen aan de oprichter; de backend liet elke admin toe.
10. **v1 kon een cover weghalen, v2 niet.** `groups.update` en `albums.update` kennen geen "geen cover". v1 kon ook een nieuwe foto uit de bibliotheek als cover uploaden, en een albumcover kiezen uit alle foto's van de groep. WP24 staat alleen een foto uit een album van de groep (groepscover) of uit dat album (albumcover) toe. Een nieuwe groep heeft geen albums, dus geen cover bij maken.
11. **`groups.addMember` zet een bestaand account in een groep zonder uitnodiging.** v1 kende dat niet, en de app gebruikt het niet. Wel 20 testbestanden als opzet (75 aanroepen) en één integratietest op dev.
12. **v1 stuurde mails** bij verwijderen, vertrekken, rol wijzigen en oprichter overdragen (aan dat lid), en bij groep opheffen (aan alle leden). v2 stuurt er geen. Zie W7.
13. **Naam verplicht.** Het v1-formulier eiste een naam; `groups.create` en `albums.create` nemen nu een lege naam aan.

### Pariteit per actie

| Actie | Oude app | Oude backend | v2 na advies |
|---|---|---|---|
| Groep maken | Home, knop "Nieuwe groep". Formulier: cover (bibliotheek of camera), naam (verplicht), omschrijving. Fout: "Niet gelukt om groep aan te maken". Daarna naar de nieuwe groep. | iedereen; maker wordt admin en oprichter | Idem zonder cover (vondst 10). Ingang vanuit Mijn groepen, ook in de lege toestand. |
| Groep wijzigen | Tab "Cover" (alleen admin). Cover kiezen uit de groepsfoto's, nieuwe foto, of weghalen; naam, omschrijving, datum. Fout: "Niet gelukt om cover aan te passen". | admin; datum ging verloren (vondst 8) | Admin. Cover uit een album van de groep, of weghalen. Datum werkt. |
| Groep verwijderen | Knop alleen voor de oprichter, zonder werking (vondst 9) | alleen de oprichter | Alleen de oprichter (besluit 1). Bevestiging die zegt wat er gebeurt: alle albums weg voor iedereen, eigen foto's blijven in Mijn foto's (zo stond het in de v1-mail). |
| Album maken | "Nieuw album" onder Albums en bij foto's kiezen, alleen admin. Cover, naam (verplicht). Fout: "Niet gelukt om album te maken". Daarna naar het album. | elk lid (rolcheck stuk) | Admin (besluit 2). "Nieuw album" in het uploadpad (WP18) is geen eis voor T0. |
| Album wijzigen | Potlood in de albumkop, alleen admin. Cover (groepsfoto's of nieuw), titel (verplicht), datum. Fout: "Helaas niet gelukt om aanpassingen op te slaan". | admin | Admin. Cover uit dit album, of weghalen. |
| Album verwijderen | In Album wijzigen, alleen de oprichter. "Weet je het zeker? Het verwijderen van een album is definitief. Alle foto's in dit album zijn dan niet langer zichtbaar voor leden." Daarna naar Albums. | elke admin | W5. |
| Rol wijzigen | Ledenmenu: "Maak admin" / "Maak gast", zonder bevestiging. Melding "Het lid is nu admin/gast". Niet bij jezelf, een gewone admin niet bij de oprichter. | de rolcheck op de caller slaat nooit aan (elk lid kon rollen wijzigen), beschermt de oprichter niet, weigert de eigen rol | Admin, niet bij de oprichter, niet bij jezelf (A-keuze 3). "Lid" in plaats van "gast" (WP16). |
| Oprichter overdragen | Ledenmenu "Maak founder", alleen de oprichter. Bevestiging: het lid wordt ook admin en mag de groep opheffen; jouw oprichterschap vervalt. Melding "Oprichterstatus is succesvol verhuisd". | alleen de oprichter; doel wordt admin en oprichter, oude oprichter blijft admin | Idem. |
| Lid verwijderen | Ledenmenu "Verban uit groep", admin, niet bij de oprichter. Bevestiging: zijn foto's verdwijnen uit de groep, definitief; opnieuw uitnodigen kan, foto's opnieuw toevoegen. Melding "Lid verwijderd". | admin, niet de oprichter | Idem (besluit 3). |
| Groep verlaten | Ledenmenu bij jezelf, niet voor de oprichter. Bevestiging: definitief, je foto's verdwijnen uit de groep. Melding "Je hebt de groep verlaten", naar Mijn groepen, Home-groep vergeten. | oprichter nooit; laatste admin niet | Niet voor de oprichter (besluit 4). Home vergeet de groep (WP16 besluit 4). |

Het ledenmenu toonde alleen de acties die mochten; een lid zonder rechten zag geen menu. Elke fout had een eigen NL-melding (zie invariant 7).

### Vraag 2: de oprichter

De backend kent hem als `groups.createdBy` (vondst 2). Geen schema-wijziging en geen backfill nodig. Bij vertrek of accountverwijdering kiest `internalRemoveMember` nu de admin met de vroegste `joinedAt`, en maakt eerst iedereen admin als er geen admin over is (M2-c, M2-d). Na besluit 3 en 4 kan de oprichter niet meer vertrekken of verwijderd worden; dan blijven M2-c en M2-d alleen voor accountverwijdering (U8). Het veld blijft heten zoals het heet. Betekenis: de huidige oprichter, niet per se de maker. `albums.createdBy` geeft geen rechten meer (A-keuze 2).

### Vraag 3: inventaris toegangsdefinities

Beschermd: het lidmaatschap van een groep, de rol daarin en de oprichter. Daarop leunen alle reads en foto-toegang (WP23) en alle beheer-gates.

**Waar de id's zichtbaar zijn.** Groep-id: `groups.listMine`, `getById`, `getWithCover`, de album- en publicatievormen, `listMembers`, `invites.getByToken`, `invites.listMine`. Lid-id's: `listMembers`, eigenaars in `albums.listPhotos` en `photos.getWithOwner`. Een id ontsluit niets zonder lidmaatschap: elke read geeft `NOT_MEMBER`.

**Publieke paden die zo'n id aannemen of de state schrijven:**

| Pad | Neemt aan / schrijft | Gate nu | Gat | Doel |
|---|---|---|---|---|
| `groups.create` | eigen lidmaatschap (admin) en oprichter | ingelogd | lege naam | naam verplicht |
| `groups.update` | groep-id | admin | geen datum, geen cover weghalen, gewone `Error` | admin, plus datum en cover weghalen |
| `groups.remove` | groep-id | admin | oprichter (besluit 1); uitnodigingen en ratings blijven | besluit 1, volle cascade |
| `groups.addMember` | groep-id, user-id, rol | admin | lidmaatschap zonder instemming, ook als admin; orakel op user-id | uit de publieke API (A-keuze 1) |
| `groups.removeMember` | groep-id, user-id | zelf of admin | oprichter niet beschermd; vertrekregel; covers, ratings, uitnodigingen | besluit 3 en 4, cascade |
| `groups.updateMemberRole` | groep-id, user-id, rol | admin | oprichter niet beschermd; eigen rol | besluit 3, A-keuze 3 |
| nieuw: oprichter overdragen | groep-id, user-id | — | ontbreekt | alleen de oprichter, doel is lid |
| `groups.markAllAlbumsSeen` | groep-id | lid | — | blijft |
| groep-reads (`getById`, `getWithCover`, `listMembers`, `listMine`) | groep-id | lid (`NOT_MEMBER`) | — | blijft |
| `albums.create` | groep-id | lid | admin (besluit 2); lege naam | besluit 2, naam verplicht |
| `albums.update` | album-id | maker of admin | maker; geen datum; geen cover weghalen | admin |
| `albums.remove` | album-id | maker of admin; drie verschillende fouten | orakel; covers en ratings (invariant 5) | W5, cascade |
| `albums.addPhoto`, `/upload` met album | album-id | lid en eigenaar (WP24, WP18) | — | blijft |
| `albums.removePhoto` | album-id, foto-id | lid; toevoeger of admin | orakel (WP24-backlog) | buiten scope |
| album-reads, `albums.markSeen` | album-id | lid | — | blijft |
| `invites.create` | groep-id, rol | lid | rol-escalatie (vondst 5) | W6 |
| `invites.accept` | token → lidmaatschap, rol omhoog | e-mail, status, vervaldatum | groep weg, uitnodiger weg, ex-lid (vondst 4) | A-invariant 4 |
| `/clerk-webhook` → `registerFromSession` | accepteert open uitnodigingen | Svix | dezelfde gaten als `accept` | dezelfde regel |
| `invites.remove`, `decline`, `getByToken`, `listMine` | invite-id, token | afzender of admin; token | een ex-lid kan zijn eigen uitnodiging nog intrekken (onschuldig); de landing toont groepsnaam aan wie het token heeft | blijft |
| `users.deleteSelf` | via `internalRemoveMember` | zelf | uitnodigingen | gedeelde cascade |
| `photos.remove`, `decideFlag` (en de cron) | wist foto en publicaties | eigenaar, webmaster | — (P5) | blijft |
| `_test.*` | lidmaatschappen, uitnodigingen | WP26-geheim | — | blijft |

Geen van de gates is een verbodslijst. De bescherming van de oprichter komt bovenop een toestemmingslijst (admin), en dat is in orde.

### Vraag 4: cascades per manier van verdwijnen

| Manier | Pad | Foto's uit albums (M1) | Covers en ratings (AP3/AP4) | Laatst gezien | Uitnodigingen | Oprichter, admin |
|---|---|---|---|---|---|---|
| Verwijderd door admin | `internalRemoveMember` | ✅ | ❌ | ✅ (M3) | ❌ (a), (b) | M2-c/d ✅ |
| Zelf vertrokken | idem | ✅ | ❌ | ✅ | ❌ | idem |
| Account verwijderd (U8) | `deleteSelf`, eerst foto's dan lidmaatschappen | ✅ (foto's gewist) | ✅ (P4, P5) | ✅ | ❌ (a) blijft; een nieuw account accepteert hem bij de onboarding | ✅ |
| Groep verwijderd | `groups.remove` | n.v.t. | ratings ❌ | ✅ (A2) | ❌ (c) | n.v.t. |
| Laatste lid weg (M2-e) | binnen `internalRemoveMember` | ✅ | ratings ❌ | ✅ | ❌ (c) | n.v.t. |
| Rol kwijt | `updateMemberRole` | — | — | — | zijn admin-uitnodigingen blijven geldig | — |
| Album verwijderd | `albums.remove` | n.v.t. | ❌ (invariant 5) | ✅ (A2) | — | — |

Ontbrekend voor invariant 4: alle drie de wegen uit vondst 4, op elk pad hierboven. Ontbrekend voor invariant 5: AP4 (en AP3) bij M1, album verwijderen en M2-e. `groups.remove` en M2-e wissen dezelfde dingen maar zijn twee kopieën; ze horen hetzelfde te doen.

Wat een ex-lid daarna nog kan: zijn eigen foto's (eigenaar), het openbare profiel van ex-medeleden (WP17a besluit 8), de groepsnaam op een landing waarvan hij het token heeft. Beelden die zijn toestel al had, blijven tot een uur in de HTTP-cache en in de schijfcache van de app; de app toont ze niet meer, want elk scherm geeft `NOT_MEMBER`. Dat is geaccepteerd (WP17a besluit 3).

### Vraag 5: splitsen

Advies: splitsen, op dezelfde branch `wp28`, achter elkaar.
- **WP28a backend**: de gates, oprichter overdragen, de cascades van invariant 3–5, de codes van invariant 7, datum, cover weghalen, naam verplicht, `addMember` en W6. Security hoog: audit en red-team horen hier.
- **WP28b app**: de schermen en menu's uit de pariteitstabel, met A-tests voor de pure logica (welke acties het menu toont per rol, de datum als dag, code naar NL-reden). Gate op TestFlight.

Waarom: de app-B mag geen backend aanraken (work-package-specs §App-WP's), en heeft een vaste API nodig. De red-team gaat alleen over de backend en hoort te lopen voordat de app erop bouwt. En één B voor 12 backend-wijzigingen plus 7 schermen is te veel voor één audit. De pariteitstabel hierboven is de A-input voor WP28b; daar is geen nieuwe A-ronde op de oude app voor nodig.

### Besluiten Wouter 1–4 tegen v1

Besluit 1–3 (oprichter verwijdert de groep, admin maakt albums, oprichter beschermd) zijn wat v1 deed en wat A adviseerde. Op prod is iedereen admin (vondst 1): zonder deze regels kan elk lid van de grote groep alle albums wissen. Afwijkingen van v1 die blijven: v1 kon een groep in de app niet echt verwijderen (vondst 9), en de v1-backend beschermde de oprichter niet bij rol wijzigen (alleen de app deed dat).

**Besluit 4, hoe v1 het deed.** De oprichter kon nooit vertrekken en niet verwijderd worden: de app toonde hem geen "Groep verlaten", en de backend weigerde. Hij moest eerst zelf iemand oprichter maken ("Maak founder"); daarna kon hij als gewone admin weg. Een andere admin kon alleen weg als er nog een admin was, en dat was er altijd, want de oprichter is admin. Een automatische opvolger kwam er alleen als het lidmaatschap van de oprichter op een andere manier verdween (account verwijderd): de eerste gevonden admin werd oprichter, of, als er geen admin over was, werd iedereen admin en het eerste gevonden lid oprichter. "Eerste gevonden" was de volgorde van DynamoDB, niet een datum. v2 kiest daar de vroegste `joinedAt` (M2-c, M2-d), en dat blijft.

**Per besluit (v1-check, voor de tests):**
1. Groep verwijderen door de oprichter: zo deed de v1-backend het. De v1-app had geen werkende knop. Tests: ja.
2. Album maken door een admin: zo deed de v1-app het. De v1-backend wilde het, maar de rolcheck sloeg nooit aan, dus elk lid kon het. Het bedoelde gedrag is duidelijk. Tests: ja.
3. Oprichter beschermd: de v1-app bood geen enkele actie op de oprichter, en de v1-backend weigerde hem te verwijderen. Rol wijzigen weigerde de backend niet. Tests: ja.
4. **Wijkt af van de tekst van het besluit.** v1 liet de oprichter niet vertrekken en gaf bij vertrek de rol aan niemand: hij droeg eerst zelf over. De laatste admin kon niet vertrekken, maar dat kwam niet voor, want de oprichter is admin. Een automatische opvolger kwam alleen bij een verwijderd account. Tests voor vertrek van de oprichter wachten op regie; vertrek van een gewoon lid of admin is wel getest.

Advies, en wat A test zodra regie het bevestigt: de oprichter kan niet vertrekken (`FOUNDER_MUST_TRANSFER`); is hij alleen, dan verwijdert hij de groep. Ieder ander kan altijd vertrekken. M2-c en M2-d blijven alleen voor accountverwijdering.

Extra vragen voor Wouter, uit de vondsten:

- **W5. Album verwijderen: elke admin (nu, v1-backend) of alleen de oprichter (v1-app)?** Advies: alleen de oprichter, om dezelfde reden als besluit 1. Album wijzigen blijft admin.
- **W6. Rol-escalatie via uitnodigen (vondst 5): in WP28a of in WP19?** Advies: in WP28a, als gate: alleen een admin nodigt uit voor een groep (v1). Uitnodigen zelf (schermen, mails) blijft WP19.
- **W7. Mails bij verwijderen, vertrekken, rol en oprichter (v1): terug vóór T0?** Advies: nee. Het lid ziet het in de app (de groep verdwijnt, de rol staat in Leden). Backlog.

### A-invarianten (aanscherping, voor de tests)

1. **De oprichter is altijd lid en admin van zijn groep.** Alleen de oprichter draagt over. Het doel is een ander lid van de groep, wordt admin en oprichter; de oude oprichter blijft admin. Daarmee is er altijd een admin (invariant 2). Alleen accountverwijdering kiest zelf een opvolger.
2. **Weigeringen (vervangt invariant 1 waar ze botsen).** Geen lid, of een onbekende groep, album of doel-lid: één weigering, `ConvexError` met code `NOT_MEMBER`, voor alle beheer-mutations gelijk. Wel lid maar het mag niet: een `ConvexError` met een code die de reden draagt: `NOT_ALLOWED` (rol ontbreekt), `FOUNDER_PROTECTED` (actie op de oprichter), `FOUNDER_MUST_TRANSFER` (oprichter wil vertrekken), `NAME_REQUIRED`. De app zet de code om in een NL-melding.
3. **Een publicatie die verdwijnt, neemt cover en ratings mee, langs elke weg.** Album verwijderen, lid weg, laatste lid weg en groep verwijderen gedragen zich als `albums.removePhoto`: een albumcover die niet meer in dat album staat, gaat weg; een groepscover die in geen album van de groep meer staat, gaat weg; ratings van wie de foto niet meer mag zien, gaan weg en het gemiddelde klopt weer.
4. **Uitnodigingen.** Wie uit een groep verdwijnt (elke manier in de tabel hierboven), houdt geen open uitnodiging aan zijn adres voor die groep. Een uitnodiging werkt alleen als de groep nog bestaat en de uitnodiger op het moment van accepteren nog het recht heeft om uit te nodigen (W6). Dat geldt voor `invites.accept` en voor de onboarding. Een geweigerde uitnodiging maakt geen lidmaatschap.
5. **Naam verplicht.** Een groep of album zonder naam (leeg na trimmen) wordt geweigerd, bij maken en wijzigen.
6. **Gelijktijdig.** Elke regel over oprichter en admins leest de rijen waar hij op rust in dezelfde mutation. Twee admins die elkaar tegelijk iets aandoen, laten de groep nooit zonder oprichter.

### A-keuzes (Wouter bevestigt)

1. `groups.addMember` gaat uit de publieke API. A zet de 20 testbestanden om naar een seed-helper; de integratietest op dev krijgt een `_test`-functie achter het WP26-geheim, of gaat via een uitnodiging.
2. `albums.createdBy` geeft geen rechten meer: wijzigen en verwijderen volgen alleen de rol.
3. Een admin wijzigt zijn eigen rol niet (v1). Wie geen admin meer wil zijn, vraagt een ander, of vertrekt.
4. Cover weghalen kan, bij groep en album, door wie de cover mag zetten.
5. De datum is een dag. De app slaat de gekozen dag op als UTC-middernacht, net als de migratie, zodat `yearOf` overal hetzelfde jaar geeft. Weghalen hoeft niet (kon in v1 ook niet).

### Bestaande tests die door de besluiten omgaan

Na de besluiten wijzigt A deze tests in de RED-ronde: `tests/groups/crud.test.ts` (addMember, removeMember, updateMemberRole, remove door admin), `tests/albums/crud.test.ts` (maker mag wijzigen en wissen, elk lid maakt een album), `tests/memberships/delete.test.ts` (M2-c en M2-d via vertrek van de oprichter of de laatste admin; die lopen dan via accountverwijdering). Plus de opzet in de 20 bestanden van A-keuze 1.

### Risico-aanvulling

- **data/schema: laag** (was middel). Geen nieuw veld, geen backfill: de oprichter staat er al, `sortDate` ook.
- **ops: middel.** Groep verwijderen in de grote groep wist ongeveer 1460 publicaties met hun cover- en rating-checks in één transactie. Dat past ruim, maar B meet het met een seed van die grootte.
- **ops-runbook-impact:** geen nieuwe env-vars of deploy-config.

### RED tests WP28a (A, 2026-11-08)

Gepind op besluit 1–8 en de A-invarianten 1–6, A-keuze 1–5 inbegrepen. Geen tests voor WP28b (app): die volgen na de landing van WP28a.

De API die de tests aannemen:
- `groups.transferFounder({ groupId, userId })`.
- `sortDate` (epoch-ms) als optioneel argument van `groups.update` en `albums.update`.
- `coverPhotoId: null` in `groups.update` en `albums.update` haalt de cover weg (A-keuze 4); weglaten laat hem staan.
- `groups.addMember` bestaat niet meer als publieke functie (A-keuze 1).
- Weigeringen: `ConvexError` met `{ code }`: `NOT_MEMBER`, `NOT_ALLOWED`, `FOUNDER_PROTECTED`, `FOUNDER_MUST_TRANSFER`, `NAME_REQUIRED`. Een admin die zijn eigen rol wil wijzigen krijgt `NOT_ALLOWED`; `invites.create` voor een groep geeft `NOT_MEMBER` of `NOT_ALLOWED` zoals de beheer-mutations.

| Bestand | Wat |
|---|---|
| `tests/groups/_beheer.ts` | Opzet zonder `addMember` of `albums.create`; `expectRefused` (code én state ongewijzigd) |
| `tests/_helpers/membership.ts` | `seedMember`: lidmaatschap direct neerzetten (A-keuze 1); 71 oude `addMember`-aanroepen in 19 bestanden omgezet |
| `tests/groups/beheerGates.test.ts` | Besluit 1, 3 en 4, rol wijzigen en verwijderen, vertrek, oprichter overdragen, opvolging bij accountverwijdering (M2-c, M2-d), A-keuze 3, groepscover weghalen, codes en geen orakel |
| `tests/albums/beheerGates.test.ts` | Besluit 2 en 5, album wijzigen (lid geweigerd, ook als maker), datum (invariant 6), naam verplicht, albumcover weghalen |
| `tests/groups/beheerCascade.test.ts` | Invariant 5 en A-invariant 3: groepscover en ratings na album verwijderen; covers en ratings na verwijderd of vertrokken lid |
| `tests/invites/exLid.test.ts` | Invariant 4: wegen (a), (b), (c), via `accept` en de onboarding; controle dat een geldige uitnodiging werkt |
| `tests/invites/createGate.test.ts` | Besluit 6: alleen een admin nodigt uit voor een groep; de uitnodiger moet bij accepteren nog admin zijn |
| `tests/groups/beheerInventory.test.ts` | Standing rule: de publieke paden met een groep-, album-, lid- of uitnodiging-id (`transferFounder` erbij, `addMember` eruit) |

Aangepast aan de besluiten:
- `tests/albums/crud.test.ts` en `tests/writeGates/cover.test.ts`: een lid maakt geen album; een maker zonder admin-rol wijzigt of verwijdert niet.
- `tests/groups/crud.test.ts`: `addMember` is geen publiek pad; de enige admin is de oprichter.
- `tests/memberships/delete.test.ts`: M2-c, M2-d en M2-e lopen via accountverwijdering, want de oprichter vertrekt niet meer.
- `tests/readWhitelist/coverAccess.test.ts`: de cover van een vertrokken lid wordt gewist.
- `tests/users/registerFromSession.test.ts`: de uitnodiger in de opzet is admin van de groep.
- `tests/integration/images/exMember.test.ts`: lid worden via een uitnodiging van de eigenaar. Die plant een uitnodigingsmail naar het testadres op dev.

Stand: 74 rood in 10 bestanden, alleen de bestanden hierboven; de rest (1792) groen. `tsc` faalt alleen op `transferFounder`, `sortDate` en `coverPhotoId: null`. Tegen een wegwerp-referentie in de scratchpad (gewist na afloop) is de hele suite groen. Elf mutanten vallen om: geen groepscover wissen, uitnodigingen niet laten verlopen, ratings laten staan, oprichter niet beschermen bij rol wijzigen, de uitnodiger niet checken, de oprichter laten vertrekken, elke admin een album laten wissen, een lid laten uitnodigen, de eigen rol laten wijzigen, de uitnodiger alleen als lid checken, cover weghalen negeren.
