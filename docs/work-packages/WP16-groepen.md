# WP16: Groepen — overzicht en detail, met live ongelezen-tellers

> Regie-draft 2026-11-04. App-WP (zie [`work-package-specs.md` §App-WP's](../conventions/work-package-specs.md#app-wps-fase-4)), met een mogelijk backend-deel. Eigen sessie per rol. Bouwt op [WP15a](./WP15a-navigatie-subscriptions.md) en [WP15b](./WP15b-profiel-instellingen-info.md).

## Productdoel

Een ingelogde user ziet op Mijn groepen al zijn groepen. In een groep ziet hij de albums, met per album hoeveel foto's van anderen nieuw zijn voor hem, en de leden. Voegt een ander lid een foto toe, dan ziet hij de teller meteen oplopen, zonder te verversen. Home opent de groep waar hij het laatst was.

## Invarianten

1. **Een teller telt wat de backend telt.** Het getal per album komt uit `albums.listByGroupWithUnread`: foto's van anderen, toegevoegd na het laatste bezoek aan dat album (zie [`migratie-plan-convex.md`](../migratie-plan-convex.md) §Unread-count). De app rekent niet zelf en verbergt niets.
2. **Een teller loopt live mee, en alleen voor het scherm in beeld.** Een nieuwe foto in een album van de open groep verhoogt de teller binnen enkele seconden. Een andere tab of de achtergrond: de query loopt niet (WP15a invariant 5, via `useLiveQuery`).
3. **Een album is pas gelezen als de user de foto's zag.** WP16 roept `albums.markSeen` niet aan: het albumscherm met de foto's is WP17. Tikken op een album leidt naar het WP17-pad, met de leeg-toestand van WP15a. De enige manier om in WP16 tellers op nul te zetten is een expliciete actie van de user ("Markeer alles gelezen", als die in scope komt). Richting: liever een teller te veel dan een foto die de user nooit te zien krijgt.
4. **Je ziet alleen groepen waar je lid van bent, en van leden alleen naam, profielfoto en rol.** Dat bewaakt de backend (WP23-whitelist, `requireMember`), niet het scherm.
5. **Wie geen lid meer is, ziet dat netjes.** Word je uit een groep gehaald terwijl je hem open hebt, of opent een link of Home een groep waar je geen lid meer van bent, dan crasht de app niet en toont hij geen oude inhoud. Je ziet een NL-melding en een weg naar Mijn groepen.
6. **Home onthoudt de laatst bezochte groep per user.** Na uitloggen en inloggen als een ander krijgt die user niet de groep van de vorige (zoals WP15b invariant 12). Bestaat de groep niet meer, of ben je geen lid meer: Mijn groepen.
7. **Een cover toont de foto rechtop.** Groeps- en albumcovers volgen `photos.exifOrientation`, niet de EXIF-tag in het bestand ([WP8](./WP8-photo-rotation.md) §Frontend-contract).
8. **WP13, WP15a en WP15b blijven werken.** De bestaande tests blijven groen, met alleen A's bewuste aanpassingen. Schermen gebruiken alleen tokens en componenten uit `app/src/theme` en `app/src/components`, en volgen [`design.md`](../design.md) §3 (grote tekst: groepstabs 2×2, albumnamen nooit afgekapt), §6 (toestanden) en §7 (stack, terugknop-pil op de cover).

## Edge cases + scope-uitsluitingen

**In scope:**
- Mijn groepen: lijst met groepsnaam, cover en je rol; leeg-toestand voor een user zonder groepen
- Groep: kop met cover en terugknop-pil, groepstabs (design.md §7), tab Albums met albums per jaar (jaartallen in Literata) en de teller per album, tab Leden
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
  - Covers laden beelden uit Convex-storage. Laadprestatie van rasters is WP17; hier gaat het om een handvol covers.
- **external deps: laag.** Geen nieuwe dienst.
- **multi-user/concurrency: medium.**
  - Tellers hangen af van wat andere leden doen.
  - Lidmaatschap kan verdwijnen terwijl het scherm open is (invariant 5).
  - "Markeer alles gelezen" terwijl een ander een foto toevoegt: een foto die net vóór `now` landt, geldt als gelezen. Acceptabel als de actie bewust is.
- **data/schema-evolutie: laag.**
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
- Oude app (alleen A): `/Users/wintvelt/Documents/DEV/DEV/clubalmanac-app`, schermen Mijn groepen, Groep (Albums, Leden) en Home

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
  8. Mijn groepen en Groep bij de grootste tekst, in licht en donker: groepstabs 2×2, albumnamen niet afgekapt.
  9. Ruimte voor bevindingen buiten deze stappen
