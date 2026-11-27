# WP45: Declaraties (backend)

> Draft van regie, 2026-11-27. Leidend: `~/clubboek/docs/WP-declaraties.md` (alleen lezen). Patroon: [WP41](./WP41-financieel.md). A vult onderaan aan.

## Productdoel

Een lid meldt in zijn groep een voorschot (titel, datum, bedrag) en ziet de status van alleen zijn eigen declaraties. De penningmeester haalt ze in het clubboek op en verwerkt of wijst ze af. Deze ronde: alleen de backend in Convex.

## Scope

- **In**: de tabel `expenseClaims`, de functies voor het lid, `GET /claims`, `POST /claims/decision` en `POST /claims/purge`, de cascade, MON1, de migratie-tooling, tests en de runbook-entry.
- **Niet**: schermen in de app, de kant van het clubboek, en wat de spec buiten scope zet (foto, berichten, stand tonen, push, terugbetaling volgen, declaraties van de penningmeester zelf).

## Statussen en overgangen

| status | wie zet hem | vanuit |
|---|---|---|
| `draft` | lid (opslaan, wijzigen, weggooien) | nieuw, `draft` |
| `submitted` | lid (verzenden) | `draft` |
| `processed`, `adjusted`, `rejected` | clubboek (besluit, ook herzien) | `submitted`, `processed`, `adjusted`, `rejected` |
| `withdrawn` | lid (intrekken), definitief | alles behalve `draft` en `withdrawn` |

Er is geen andere overgang. Het clubboek ziet en raakt een `draft` nooit.

## Invarianten

1. `memberId` is de gebruiker van de sessie, nooit een veld uit de invoer.
2. Elke functie van het lid controleert: ingelogd, nu lid van de groep, eigenaar van de declaratie, en de declaratie hoort bij die groep. Een declaratie van een ander, een onbekend id of een id na vertrek geeft één en dezelfde weigering, zoals `NOT_MEMBER` bij albums.
3. Een lid ziet alleen zijn eigen declaraties, met een veld-whitelist (WP23).
4. Na verzenden verandert het lid niets meer, behalve intrekken.
5. Intrekken na een besluit laat `processedCents`, `note` en `decidedAt` staan: het clubboek moet de boeking kunnen terugdraaien.
6. `revision` begint op 1 en gaat bij elke wijziging één omhoog: concept bewaren, verzenden, besluit, intrekken.
7. Bedragen zijn hele centen van 1 tot 1.000.000. `processed`: `processedCents` = `amountCents`. `adjusted`: een ander bedrag. `rejected`: `processedCents` is null.
8. Per lid ten hoogste 20 `submitted`, 20 keer verzenden per dag en 20 concepten. Bij de grens een weigering, en er verandert niets.
9. Schrijven vanuit het clubboek kan alleen via de drie routes met een geheim. Geen publieke functie schrijft een besluit of ruimt op.
10. De groep van de routes staat op de deployment, niet in het verzoek. Een declaratie van een andere groep bestaat voor de route niet (404, of `skipped` bij opruimen).
11. Toegang tot een route: eerst het geheim, vóór de body. Eén weigering voor elke oorzaak, in constante tijd vergeleken (`lib/constantTime.ts`). Het geheim komt nooit in een antwoord, fout of log. Tijdens rotatie gelden twee geheimen.
12. Elke route doet zijn werk in één interne functie (atomair).
13. Groep weg → haar declaraties weg.

## Gegevens en functies

**Tabel `expenseClaims`**: de velden uit de spec (`groupId`, `memberId`, `title`, `expenseDate`, `amountCents`, `status`, `submittedAt`, `processedCents`, `note`, `decidedAt`, `withdrawnAt`, `revision`). Indexen kiest B; nodig voor: de lijst van een lid in een groep, de limieten, en alles behalve `draft` van een groep.

**Functies voor het lid** (namen zijn een voorstel, A legt vast):
- `expenseClaims.saveDraft`: nieuw concept, of een bestaand concept wijzigen.
- `expenseClaims.deleteDraft`: concept weggooien.
- `expenseClaims.submit`: concept verzenden.
- `expenseClaims.withdraw`: intrekken.
- `expenseClaims.listMine({ groupId })`: de eigen declaraties in die groep.

**Routes**: zoals de spec, met de afwijkingen hieronder. Elk JSON-antwoord bevat `"v": 1`.

**Env-vars per deployment**: `CLAIMS_SECRET` en `CLAIMS_PURGE_SECRET`, elk met een tweede waarde voor rotatie (`CLAIMS_SECRET_PREVIOUS`, `CLAIMS_PURGE_SECRET_PREVIOUS`), en `CLAIMS_GROUP_ID`. Ontbreekt er een, dan weigert de route (fail-closed). Los van `FINANCE_*`.

## Afwijkingen van de spec (WP41 volgt)

1. **Fout geheim: 403, niet 401.** Eén body voor elke oorzaak, zoals `/settlements`.
2. **Alleen `X-Clubboek-Secret`.** Een geheim in `Authorization` telt niet, ook het juiste niet (WP41 F1).
3. **Een geheim korter dan 32 tekens telt als geen geheim** (WP41 A-keuze 3).
4. **De groep staat op de deployment** (`CLAIMS_GROUP_ID`), zoals `FINANCE_GROUP_ID`. Bestaat die groep niet (meer): de weigering.
5. **`GET /claims` in één interne query**, niet een mutation: hij leest alleen, en een query is net zo atomair.

## Besluiten (Wouter, 2026-11-27)

Alle negen zoals geadviseerd; ook de vijf afwijkingen hierboven aanvaard.

1. **In welke groep kan een lid declareren?** De spec zegt het niet; het geheim hoort bij één groep. *Besluit*: alleen in de groep van `CLAIMS_GROUP_ID`; in een andere groep weigert de backend, anders melden leden iets wat niemand ophaalt. De app krijgt later een query of de groep declaraties heeft (voor "plek in de app").
2. **Wie is het lid voor het clubboek?** *Besluit*: `member.id` is het id van de gebruiker in de app, `member.name` zijn huidige profielnaam (leeg als hij die niet heeft). Het clubboek koppelt dat zelf aan zijn ledenlijst.
3. **Lid gaat uit de groep.** *Besluit*: verzonden declaraties blijven voor het clubboek; het lid ziet ze niet meer en kan niet meer intrekken; zijn concepten gaan weg.
4. **Lid verwijdert zijn account.** Een blijvende declaratie wijst dan naar een gebruiker die niet meer bestaat (MON1). *Besluit*: al zijn declaraties gaan mee weg, net als de rest van zijn gegevens. Wat het clubboek al boekte, blijft daar staan.
5. **Moet een concept al compleet en geldig zijn?** *Besluit*: ja, dezelfde controles als bij verzenden. Half ingevuld bewaart de app zelf.
6. **Datum.** *Besluit*: "niet in de toekomst" naar de datum in Nederland; als ondergrens alleen een echte datum vanaf 2000-01-01.
7. **"20 keer verzenden per dag" en "per lid".** *Besluit*: de laatste 24 uur, per lid per groep.
8. **Wat is "afgehandeld" bij opruimen?** *Besluit*: `processed`, `adjusted`, `rejected` en `withdrawn`. Nooit `submitted`.
9. **Toelichting van de penningmeester.** *Besluit*: geen stuurtekens, wel een regeleinde; een lege tekst wordt null.

## Risico-assessment

- **security/privacy: hoog.** Een nieuwe schrijfweg van buiten met twee geheimen en rotatie, en geldzaken per lid. Toegangsdefinitie volgens [`work-package-specs.md` §Toegangsdefinities](../conventions/work-package-specs.md), met een inventaristest van de publieke paden die een `expenseClaims`-id aannemen. Red-team op de routes en de functies van het lid.
- **multi-user/concurrency: medium.** Een besluit en intrekken kunnen kruisen; `revision` vangt dat (409).
- **ops: medium.** Vijf env-vars per deployment, en rotatie.
- **data/schema-evolutie: laag.** Een nieuwe, lege tabel. Wel een contract met het clubboek: A pint het met voorbeelden met verzonnen gegevens.
- **external deps: laag.** Alleen het eigen clubboek.
- **ops-runbook-impact**: sectie "Clubboek → Declaraties (WP45)" in [`external-services.md`](../conventions/external-services.md): de env-vars, roteren in stappen, en na een migratie-reset of op T0 eerst `CLAIMS_GROUP_ID` bijwerken. B levert de entry.
- **kosten: € 0.**

## Cross-refs

- cascade-matrix: nieuwe rij G7 (groep weg → declaraties weg), een U-rij (account weg → declaraties weg, besluit 4) en een M-rij (uit de groep → concepten weg, besluit 3).
- WP10 (MON1): FK's `expenseClaims.groupId` en `expenseClaims.memberId`. De migratie-tooling telt en leegt de tabel, de import vult hem niet (zoals `settlements`).
- WP23: whitelist op `listMine`. WP41: geheim, één weigering, constante tijd, geen CORS.
- Oude AWS-code: niet van toepassing.

## Aanpak

1. Eigen worktree `~/Code/clubalmanac-v2-wp45`, branch `wp45` vanaf `main`.
2. Wouter besliste de open vragen (2026-11-27).
3. A: spec-criticus en RED tests (`tests/expenseClaims/`), met voorbeelden voor het contract. A leest de spec van het clubboek en WP41, geen oude code.
4. B bouwt tot alles groen is. Audit, dan red-team. Fix-cycli tot groen.
5. Gate op dev: Wouter zet de env-vars; regie geeft de `curl`-commando's voor de drie routes, en een declaratie via de functierunner van het dashboard. De gate op schermen volgt in de app-WP.
6. Regie pusht en maakt de PR.

## Acceptance

- Tests: de overgangen, de limieten, de controles op invoer, de whitelist, elke weigering, de drie routes met hun statussen, rotatie, geen lek van het geheim, cascade, MON1 en de inventaris.
- Gate dev zoals hierboven.

---

## Spec-criticus aanvullingen (A vult in)
