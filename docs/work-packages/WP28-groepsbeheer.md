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
