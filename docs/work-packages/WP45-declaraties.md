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

> A, 2026-11-27. Geen oude code (nieuw onderwerp). Bronnen: de spec van het clubboek (`~/clubboek/docs/WP-declaraties.md`), WP41 (§A4, §A5, §A7, §A8, F1), `convex/settlements.ts`, `convex/groups.ts`, `convex/accountDeletion.ts`, `convex/monitoring.ts`, `convex/migration.ts`. Namen van functies, codes en velden hieronder zijn A-keuzes; het hoe is aan B.

### A1. Blinde vlekken

1. **Rotatie en "ontbreekt er een".** Moet de tweede waarde altijd gezet zijn? Dan kan een rotatie nooit afgerond worden. Gelezen als: het huidige geheim en `CLAIMS_GROUP_ID` zijn verplicht, de `_PREVIOUS`-waarden niet (A-keuze 1).
2. **Lees-geheim gelijk aan purge-geheim.** Dan is "los van elkaar" alleen schijn: wie mag lezen, mag ook opruimen. Fail-closed (A-keuze 2).
3. **`revision` van een verzonden declaratie is minstens 2.** Concept bewaren is 1, verzenden +1 (invariant 6). Het voorbeeld in de spec van het clubboek toont `submitted` met `revision: 1`. Voor het clubboek is `revision` ondoorzichtig: alleen terugsturen, nooit vergelijken met een vast getal.
4. **Volgorde 400 en 404.** De spec van het clubboek zet 404 vóór 400, maar zonder een geldige body valt er niets op te zoeken. Controles die de declaratie niet nodig hebben gaan eerst; de controle op het bedrag (`processed` = gedeclareerd, `adjusted` ≠) pas na 404 en 409 `withdrawn` (§A7).
5. **Een andere groep dan `CLAIMS_GROUP_ID`.** Besluit 1 zegt "de backend weigert", niet hoe. Een eigen code, zodat de app het kan melden, maar pas ná de lidmaatschapscontrole: wie geen lid is krijgt altijd `NOT_MEMBER`, zodat niemand zo leert welke groep declaraties heeft (§A2).
6. **`CLAIMS_GROUP_ID` gaat naar een andere groep.** Declaraties in de oude groep bestaan dan niet meer voor de routes (404, `skipped`, niet in `GET`), en ook het lid ziet ze niet meer (`CLAIMS_DISABLED`). Ze blijven in de tabel tot de groep weg is.
7. **Een lid dat terugkomt.** Besluit 3 zegt wat er bij vertrek gebeurt, niet bij terugkomen. De toegang leunt op het lidmaatschap: wie terugkomt, ziet zijn verzonden declaraties weer en kan ze weer intrekken. Zie open vraag 1.
8. **Regeleinde uit een browser.** Een `<textarea>` stuurt `\r\n`. Besluit 9 staat "een regeleinde" toe; zonder afspraak geeft elke toelichting met een enter een 400 (A-keuze 6).
9. **Groei van `GET /claims`.** Ingetrokken declaraties blijven staan tot het clubboek opruimt. Eén lid kan zo 20 per dag laten groeien (verzenden, intrekken). Bij 16 leden is dat ruim binnen de leesgrens van één query, zolang het clubboek na de jaarafsluiting opruimt. Geen extra grens nu; wel een punt voor het runbook.
10. **Verdwijnen zonder opruimen.** Account weg (besluit 4) en groep weg halen declaraties weg zonder dat het clubboek ze opruimde. Ze verdwijnen dan uit `GET`, ook al verwerkt. Het clubboek moet een verdwenen declaratie niet lezen als "ingetrokken" of "fout"; zijn boeking blijft staan. Hoort in de spec van het clubboek (B zet het in het runbook).
11. **Migratie-reset.** `expenseClaims` valt via MON1 onder de reset van de migratie-tooling: een reset leegt de declaraties, de import vult ze niet. Daarna eerst `CLAIMS_GROUP_ID` bijwerken (draft §Risico).
12. **De naam voor het clubboek.** `member.name` is de profielnaam nu, niet die bij verzenden. Ontbreekt de users-rij (drift; MON1 meldt dat), dan geeft `GET` toch 200, met een lege naam.
13. **Tijdstippen.** In de app zijn tijdstippen ms-getallen (zoals elders in Convex); in het contract met het clubboek ISO 8601 in UTC (A-keuze 8).
14. **Kruisen van besluit en intrekken.** Beide volgordes zijn geldig: eerst intrekken geeft het besluit een 409 `withdrawn`; eerst het besluit laat intrekken het besluit staan (invariant 5).
15. **Verzenden telt mee, ook na intrekken.** Anders omzeilt verzenden-intrekken-verzenden de daggrens. Een declaratie die het clubboek opruimt, mag uit de telling verdwijnen (niet getest).

### A2. De functies van het lid

Publieke functies in `convex/expenseClaims.ts`. Geen ervan neemt een `memberId`, `userId` of `status` aan.

| Functie | Args | Antwoord |
|---|---|---|
| `saveDraft` (mutation) | `{ groupId, claimId?, title, expenseDate, amountCents }` | het id van het concept |
| `deleteDraft` (mutation) | `{ claimId }` | `null` |
| `submit` (mutation) | `{ claimId }` | `null` |
| `withdraw` (mutation) | `{ claimId }` | `null` |
| `listMine` (query) | `{ groupId }` | lijst, zie onder |

Volgorde van de controles; de eerste die faalt bepaalt de fout (ConvexError `{ code }`), en er verandert niets:

1. Ingelogd, met een users-rij (anders een fout, geen gegevens).
2. Lid van de groep. Bij `claimId`: de declaratie bestaat, is van de caller, hoort bij een groep waar hij nu lid van is, en (bij `saveDraft`) bij de meegegeven `groupId`. Anders `NOT_MEMBER`, voor elke oorzaak dezelfde: een onbekende of opgeruimde declaratie, die van een ander (ook voor een admin of de webmaster), een declaratie in een groep die hij verliet, een onbekende groep.
3. De groep is die van `CLAIMS_GROUP_ID`. Anders `CLAIMS_DISABLED`, ook als `CLAIMS_GROUP_ID` ontbreekt of geen groep is.
4. De status laat de handeling toe. Anders `WRONG_STATUS`:
   - `saveDraft` met `claimId` en `deleteDraft`: alleen `draft`;
   - `submit`: alleen `draft`;
   - `withdraw`: `submitted`, `processed`, `adjusted`, `rejected`.
5. De invoer (`saveDraft`; §A3): `TITLE_INVALID`, `DATE_INVALID`, `AMOUNT_INVALID`.
6. De grens (§A4): `DRAFT_LIMIT` (nieuw concept), `SUBMITTED_LIMIT` en `DAILY_SUBMIT_LIMIT` (verzenden).

Wat er verandert:
- `saveDraft` zonder `claimId`: een nieuw concept, `revision` 1, `memberId` de caller, de andere velden leeg. Met `claimId`: de drie velden vervangen, `revision` +1.
- `deleteDraft`: het concept is weg.
- `submit`: `submitted`, `submittedAt` nu, `revision` +1. Wat in het concept staat, gaat zo naar het clubboek.
- `withdraw`: `withdrawn`, `withdrawnAt` nu, `revision` +1. `processedCents`, `note` en `decidedAt` blijven staan.

`listMine({ groupId })`: de eigen declaraties van de caller in die groep, alle statussen, nieuwste eerst (op aanmaak). Per declaratie precies: `_id`, `title`, `expenseDate`, `amountCents`, `status`, `submittedAt`, `processedCents`, `note`, `decidedAt`, `withdrawnAt`. Tijdstippen in ms, `null` als ze er niet zijn. Niet: `groupId`, `memberId`, `revision`, `_creationTime`. Controles 1–3 als hierboven (uitgelogd: geen gegevens). Return-validator zonder `any` of `record` (WP23).

### A3. Invoerregels

| Veld | Regel |
|---|---|
| `title` | witruimte aan begin en eind gaat eraf; daarna 1 tot 80 tekens (codepunten, een emoji telt als één). Well-formed Unicode; geen control-tekens (U+0000–U+001F, U+007F–U+009F, dus ook geen regeleinde of tab), geen U+2028/U+2029, geen bidi-tekens (U+202A–U+202E, U+2066–U+2069) |
| `expenseDate` | `jjjj-mm-dd`, een echte datum, vanaf 2000-01-01, niet na vandaag in Nederland (`Europe/Amsterdam`, zomer- en wintertijd) |
| `amountCents` | geheel getal van 1 tot 1 000 000 |
| `processedCents` (route) | geheel getal van 1 tot 1 000 000, of `null` bij `rejected` |
| `note` (route) | tekst of `null`. `\r\n` wordt `\n`; witruimte aan begin en eind gaat eraf; leeg wordt `null`. Daarna ten hoogste 300 tekens (codepunten). Alleen `\n` als regeleinde; verder dezelfde verboden tekens als `title` (ook een losse `\r` en een tab) |
| `revision` (route) | geheel getal ≥ 1 |

Besluit 5: dezelfde regels bij elk concept, ook bij wijzigen. Verzenden controleert daarna alleen de grenzen.

### A4. Grenzen voor het lid

Alle drie per lid per groep (besluit 7), gemeten bij de handeling:
- **20 concepten.** Een 21e nieuw concept: `DRAFT_LIMIT`. Een bestaand concept wijzigen mag altijd.
- **20 `submitted`.** Verzenden bij 20: `SUBMITTED_LIMIT`. Een besluit of intrekken maakt plek.
- **20 keer verzenden in de laatste 24 uur.** Elk verzenden telt, ook als die declaratie daarna is ingetrokken of besloten. Bij 20: `DAILY_SUBMIT_LIMIT`. Een verzending van meer dan 24 uur geleden telt niet meer.

### A5. Toegang tot de routes

Twee soorten geheim, elk in de header `X-Clubboek-Secret`:
- **lezen en besluiten** (`GET /claims`, `POST /claims/decision`): `CLAIMS_SECRET` of `CLAIMS_SECRET_PREVIOUS`;
- **opruimen** (`POST /claims/purge`): `CLAIMS_PURGE_SECRET` of `CLAIMS_PURGE_SECRET_PREVIOUS`.

Toegang is er alleen als alles klopt; anders de weigering. Oorzaken:
- het huidige geheim van die soort ontbreekt of is korter dan 32 tekens. Dan telt ook een `_PREVIOUS` niet (fail-closed);
- `CLAIMS_GROUP_ID` ontbreekt, is geen id van een groep, of de groep bestaat niet (meer);
- geen header, een lege header, een fout geheim, een begin of een verlenging ervan, `Bearer ` ervoor, een geheim alleen in `Authorization` (ook het juiste, WP41 F1);
- het geheim van de andere soort, of een `FINANCE_SECRET`;
- bij opruimen: een purge-geheim dat gelijk is aan `CLAIMS_SECRET` of `CLAIMS_SECRET_PREVIOUS` (A-keuze 2).

Een `_PREVIOUS` die ontbreekt of korter is dan 32 tekens telt niet; het huidige geheim werkt dan gewoon. Vergelijken in constante tijd met `constantTimeEqual` uit `lib/constantTime.ts`, tegen beide waarden van de soort, zonder vroeg te stoppen.

**De weigering**: status 403, body `{ "v": 1, "error": "forbidden" }`, byte voor byte gelijk voor elke oorzaak en op alle drie de routes. Bij een weigering wordt de body niet beoordeeld (ook een te grote of kapotte body: 403) en verandert er niets. Het geheim, de header en de body komen niet in een antwoord, fout of log; de namen van de env-vars ook niet in een antwoord.

Geen CORS: geen `Access-Control-*`-headers, geen `OPTIONS`. Alleen `GET /claims`, `POST /claims/decision` en `POST /claims/purge`; andere methodes geven geen gegevens.

### A6. `GET /claims`

Na de toegang, in één interne query. Query-parameters doen niets (ook een `groupId` niet). 200:

```json
{ "v": 1, "claims": [ { "id": "…", "member": { "id": "…", "name": "Berk" }, "title": "Bier borrel",
  "expenseDate": "2026-11-26", "amountCents": 4250, "status": "submitted", "submittedAt": "2026-11-26T19:04:05.000Z",
  "processedCents": null, "note": null, "decidedAt": null, "withdrawnAt": null, "revision": 2 } ] }
```

- Alle declaraties van de groep van `CLAIMS_GROUP_ID` behalve `draft`, oudste `submittedAt` eerst.
- Per declaratie precies deze velden. `member.id` is het id van de gebruiker; `member.name` zijn profielnaam nu, `""` zonder naam of zonder users-rij.
- Tijdstippen als ISO 8601 in UTC met milliseconden (`Date.toISOString()`), of `null`.
- Geen declaraties: `{ "v": 1, "claims": [] }`.

### A7. `POST /claims/decision`

Body: precies `{ id, status, processedCents, note, revision }`, elk veld aanwezig (`null` mag waar §A3 het zegt). Volgorde:

1. Toegang (§A5): 403.
2. Body groter dan 8 KiB (8192 bytes): 413 `{ "v": 1, "error": "too_large" }`. Te groot én kapot: 413.
3. De vorm: geen JSON, geen object, een ontbrekend of onbekend veld (ook `groupId`), `id` geen tekst, `status` niet `processed`/`adjusted`/`rejected`, §A3 niet gehaald, `processedCents` `null` bij `processed` of `adjusted`, een getal bij `rejected`: 400 `{ "v": 1, "error": "invalid", "reason": "<pad>: <korte reden>" }`. De reden noemt nooit een waarde uit de body.
4. Een `id` dat geen declaratie van de groep is (onbekend, opgeruimd, een id van een andere tabel, geen id, een andere groep) of een `draft`: 404 `{ "v": 1, "error": "not_found" }`, byte voor byte gelijk.
5. `withdrawn`: 409 `{ "v": 1, "error": "withdrawn", "claim": <de declaratie> }`, ook met de juiste `revision` en hetzelfde besluit.
6. Het bedrag tegen de declaratie: `processed` met `processedCents` ≠ `amountCents`, of `adjusted` met `processedCents` = `amountCents`: 400.
7. Staat dit besluit er al precies zo (zelfde status, `processedCents` en `note` na §A3): 200 `{ "v": 1, "ok": true, "revision": <huidige> }`, ook bij een andere `revision`. Er verandert niets, ook `decidedAt` niet.
8. `revision` wijkt af (lager of hoger): 409 `{ "v": 1, "error": "changed", "claim": <de declaratie> }`.
9. Opslaan: `status`, `processedCents`, `note`, `decidedAt` nu, `revision` +1. 200 `{ "v": 1, "ok": true, "revision": <nieuwe> }`.

`<de declaratie>` heeft de vorm van één element uit `GET /claims`, met de stand op dat moment. Een besluit herziet ook een eerder besluit; bij `rejected` wordt `processedCents` `null`. Een declaratie van een lid dat de groep verliet, kan het clubboek nog besluiten. Bij elke 4xx verandert er niets.

### A8. `POST /claims/purge`

Body: precies `{ claims: [{ id, revision }] }`, 0 tot 200 elementen, elk `id` tekst en hooguit één keer in de lijst, `revision` als §A3. Volgorde: 403, 413 boven 32 KiB (32 768 bytes), 400 voor de vorm (ook bij meer dan 200 of een dubbel id), dan in één interne mutation:
- weg: een declaratie van de groep in `processed`, `adjusted`, `rejected` of `withdrawn` (besluit 8; ook ingetrokken zonder besluit) met precies die `revision`;
- `skipped`: al het andere (`draft`, `submitted`, een andere `revision`, onbekend, al weg, een andere groep, geen id).

200 `{ "v": 1, "ok": true, "deleted": [ids], "skipped": [ids] }`, elk in de volgorde van het verzoek, met het `id` zoals het binnenkwam. Opgeruimde declaraties verdwijnen uit `GET /claims` en `listMine`.

### A9. Grenzen

| Wat | Grens |
|---|---|
| Body `POST /claims/decision` | 8 KiB |
| Body `POST /claims/purge` | 32 KiB |
| Elementen in één purge | 200 |
| `title` | 1 tot 80 tekens |
| `note` | 0 tot 300 tekens |
| Bedragen | 1 tot 1 000 000 centen |
| Per lid per groep | 20 concepten, 20 `submitted`, 20 keer verzenden per 24 uur |
| Geheim | minstens 32 tekens |

### A10. Toegangsdefinitie (work-package-specs §Toegangsdefinities)

Beschermd object: een declaratie. Toestemmingslijst: het lid zelf (`memberId`), zolang hij lid is van de groep van de declaratie en die groep `CLAIMS_GROUP_ID` is; het clubboek met het geheim, alleen voor de groep van `CLAIMS_GROUP_ID` en nooit een `draft`.

- **Waar het id zichtbaar wordt**: `listMine` (alleen eigen), `GET /claims`, de 409-bodies en het antwoord van purge. Nergens anders.
- **Publieke functies die een `expenseClaims`-id aannemen**: `saveDraft` (optioneel), `deleteDraft`, `submit`, `withdraw`. Elk met de gate van §A2. Een `groupId` voor dit doel: `saveDraft` en `listMine`.
- **HTTP-paden met een `expenseClaims`-id**: `POST /claims/decision` en `POST /claims/purge`, achter het geheim.
- **Wat de toegang draagt**: `memberships`, `expenseClaims.memberId` (alleen uit de sessie) en de env-vars. Geen nieuwe state waar de toegang op leunt.
- **Schrijven door het clubboek**: geen publieke functie schrijft een besluit of ruimt op; alleen de routes, via interne functies.
- **Inventaristest**: `tests/expenseClaims/inventory.test.ts`; `tests/readWhitelist/inventory.test.ts` kent `expenseClaims:listMine`.

### A11. Cascade, MON1 en migratie-tooling

- **G7** (groep weg): alle declaraties van de groep weg, in `deleteGroupCascade`, dus ook bij M2-e. Andere groepen blijven.
- **M6** (uit de groep, besluit 3): in `internalRemoveMember` gaan zijn concepten in die groep weg; de rest blijft voor het clubboek. Geldt voor zelf vertrekken, eruit gezet worden en de fase lidmaatschappen van account verwijderen.
- **U19** (account weg, besluit 4): al zijn declaraties weg, elke status, elke groep. Declaraties van anderen blijven.
- **MON1**: `expenseClaims.groupId` → `groups` en `expenseClaims.memberId` → `users`, beide verplicht, in `MONITORED_FKS`. Gevolg (zoals WP41): de migratie-tooling telt en leegt de tabel; de import vult hem niet.
- B zet de drie rijen in `docs/cascade-matrix.md`.

### A12. Wat B bouwt (namen en signatures; het hoe is aan B)

- schema: tabel `expenseClaims` met de velden van de draft. `groupId: v.id("groups")`, `memberId: v.id("users")`, tijdstippen in ms. Indexen naar keuze (voor de lijst van een lid in een groep, de grenzen, de niet-concepten van een groep, en de declaraties van een gebruiker bij account weg). Geen `v.any()`, geen `v.record()`.
- `convex/expenseClaims.ts`: de vijf publieke functies van §A2; interne functies voor de drie routes (één per route: een query voor `GET`, een mutation voor besluit en opruimen); de route-handlers.
- `convex/http.ts`: `GET /claims`, `POST /claims/decision`, `POST /claims/purge`.
- `deleteGroupCascade`, `internalRemoveMember`, een fase in `convex/accountDeletion.ts`, `MONITORED_FKS` (§A11).
- Runbook `external-services.md`, sectie "Clubboek → Declaraties (WP45)": de vijf env-vars, roteren in stappen (de oude waarde naar `_PREVIOUS`, de nieuwe in het huidige geheim, het clubboek bijwerken, dan `_PREVIOUS` weghalen), purge-geheim nooit gelijk aan het lees-geheim, na een reset of op T0 eerst `CLAIMS_GROUP_ID`, en A1.9 en A1.10.

### A13. Waar de tests staan

- `tests/expenseClaims/_claims.ts`: gedeelde opzet (verzonnen geheimen, wereld, routes).
- `member.test.ts`: §A2 (overgangen, `revision`, één weigering, `CLAIMS_DISABLED`, `WRONG_STATUS`, `listMine`).
- `validation.test.ts`: §A3 voor het lid (titel, datum met tijdzone, bedrag).
- `limits.test.ts`: §A4.
- `access.test.ts`: §A5 (elke weigering op elke route, rotatie, purge los van lezen, geen lek, geen CORS).
- `get.test.ts`, `decision.test.ts`, `purge.test.ts`: §A6, §A7, §A8.
- `cascade.test.ts`, `integrity.test.ts`: §A11.
- `inventory.test.ts`: §A10, de routes en het schema.
- `contract.test.ts` met `tests/fixtures/wp45/` (README daar): de voorbeelden met verzonnen gegevens zijn precies wat de routes geven.
- Aangepast: `tests/readWhitelist/inventory.test.ts` en `tests/migration/fkOracle.ts`.

### A-keuzes

1. `CLAIMS_SECRET_PREVIOUS` en `CLAIMS_PURGE_SECRET_PREVIOUS` zijn optioneel. Het huidige geheim van de soort en `CLAIMS_GROUP_ID` zijn verplicht; zonder huidig geheim telt de vorige ook niet.
2. Is een purge-geheim gelijk aan een lees-geheim, dan weigert `POST /claims/purge` (403). Lezen en besluiten werken dan gewoon.
3. Foutcodes voor het lid: `NOT_MEMBER`, `CLAIMS_DISABLED`, `WRONG_STATUS`, `TITLE_INVALID`, `DATE_INVALID`, `AMOUNT_INVALID`, `DRAFT_LIMIT`, `SUBMITTED_LIMIT`, `DAILY_SUBMIT_LIMIT`. Opnieuw verzenden of intrekken van iets dat al zo staat: `WRONG_STATUS`, niets verandert.
4. Antwoorden van de routes: zie §A5–A8. Elke JSON-body, ook bij een fout, heeft `"v": 1` en bij een fout `error`.
5. Volgorde van de besluit-route zoals §A7 (vorm vóór 404; bedrag-tegen-declaratie ná 409 `withdrawn`).
6. `note`: `\r\n` wordt `\n`, rand-witruimte eraf, leeg wordt `null`; hetzelfde besluit vergelijkt na die stap.
7. `title`: rand-witruimte eraf, dan 1–80 codepunten. Lengtes overal in codepunten.
8. Tijdstippen: ms in `listMine`, ISO 8601 UTC in de routes.
9. Grenzen van §A9 (bodies, 200 per purge).
10. `listMine`: nieuwste eerst op aanmaak, zonder `revision`. `GET /claims`: oudste `submittedAt` eerst.
11. Purge: `deleted` en `skipped` zijn lijsten van ids (niet aantallen), in de volgorde van het verzoek; een lege lijst mag; een dubbel id is 400.
12. Een 409 bevat altijd de declaratie zoals hij nu is, ook bij `withdrawn`.
13. Wie terugkomt in de groep, ziet zijn verzonden declaraties weer (open vraag 1).
14. Elke geslaagde `saveDraft` op een bestaand concept verhoogt `revision`, ook zonder verschil.

### Open vragen voor Wouter

1. **Een lid komt terug in de groep.** Ziet hij zijn oude verzonden declaraties weer, en kan hij ze weer intrekken? *Advies: ja* (A-keuze 13): het zijn de zijne, en er hoeft niets extra bewaard te worden. De tests gaan hiervan uit (`cascade.test.ts`, één test).

**Besluit Wouter (2026-11-27) op open vraag 1:** ja. Wie terugkomt, ziet zijn verzonden declaraties weer en kan ze weer intrekken (A-keuze 13). Regie aanvaardt A-keuzes 1–14.

## Fix-cyclus 1 (regie en Wouter, 2026-11-27)

Na audit (geen blocker, 3 should-fix) en red-team (geen toegangsgat; 2 zou, 3 nice) op `7789a4e`. A legt vast, B bouwt.

- **F1. Maximum per lid (besluit Wouter).** Per lid per groep ten hoogste 200 declaraties die geen concept zijn en nog niet zijn opgeruimd (elke status behalve `draft`). Bij 200 weigert verzenden met een eigen foutcode, en er verandert niets. Een concept telt niet (daarvoor blijft de grens van 20). Zo blijven `GET /claims`, G7 en MON1 altijd binnen de grenzen van één Convex-functie (red-team 1, audit S3/N1).
- **F2. Naam per lid één keer.** `GET /claims` leest de naam van elk lid één keer, niet per declaratie (audit S3, red-team 1). Schaaltests met `transactionLimits` op de maximale last (16 leden × 200, plus concepten): `GET /claims` 200, de groep verwijderen lukt, en MON1 lukt. Haalt MON1 dat niet door de bestaande opzet (een `db.get` per rij per FK), dan maakt B de controle voor `expenseClaims` zuiniger; faalt MON1 al op bestaande tabellen, dan meldt B dat (buiten WP45).
- **F3. Tekens (besluit regie).** Titel en toelichting volgen de regel die de app al heeft voor namen (`convex/lib/names.ts`: ook Cf, Default_Ignorable en de braille-blanco). In de toelichting blijft een regeleinde toegestaan. Een titel of toelichting van alleen onzichtbare tekens is ongeldig (red-team 2). Stelt §A3 bij.
- **F4. Geen gedeeld geheim met de afrekeningen (besluit regie).** Is een declaratie-geheim (huidig of vorig, van welke soort ook) gelijk aan `FINANCE_SECRET`, dan weigert die route, zoals bij A-keuze 2 (red-team 3).
- **F5. Zomer- en wintertijd in de tests.** Tests rond beide omschakelingen, met de voorbeelden uit de audit (S1).
- **F6. Runbook en commentaar (B).** In `external-services.md`: zonder `CLAIMS_SECRET` weigeren `GET /claims` en `POST /claims/decision`, opruimen werkt dan nog met zijn eigen geheim (audit S2); de geheimen verschillen ook van `FINANCE_SECRET` (F4); het maximum van 200 en dat opruimen het weer vrijmaakt (F1). In `claimShape.ts` één zin: de zomertijdregel volgt de EU-regel en moet mee als die verandert (audit N4).

Niet in deze ronde: formula-injectie bij een export naar een spreadsheet hoort bij de kant van het clubboek (red-team 5).
