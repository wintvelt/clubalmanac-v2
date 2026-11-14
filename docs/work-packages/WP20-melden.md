# WP20: melden — foto's, ideeën en problemen

> Regie 2026-11-14. App-WP met een stuk backend. A → besluiten Wouter → B → audit → gate in de simulator (dev). Eigen branch `wp20`. Na WP19c en WP30, vóór T0.

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

(Leeg in draft.)
