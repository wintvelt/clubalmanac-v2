# WP29: account verwijderen

> Landed 2026-11-10: A → B → audit + red-team, drie fix-cycli, gate op dev groen (simulator, release-build). Verplicht vóór de App Store-indiening: Apple eist dat een account in de app te verwijderen is.

## Gate (dev, 2026-11-10)

- Dev Anna (191 foto's, laatste lid van een eigen groep, lid van twee andere): data, beelden en de eigen groep weg; de andere groepen werken.
- De eerste Clerk-poging gaf op: `CLERK_SECRET_KEY` was leeg gezet. De rij bleef en hield de login tegen. Na het zetten van de sleutel maakte `users:retryAccountDeletion` het af.
- Dev Bram (354 foto's): in één keer weg, ook bij Clerk. Het inlogscherm toont "Je account is verwijderd."; de knop blijft boven het toetsenbord.
- Daarna: integriteitscheck schoon (op de bekende foto zonder formaten na), opnieuw inloggen faalt.
- Niet in de gate: ratings (de app heeft nog geen rate-knop; wel in de tests). De webmaster-mail ging naar Mailjet; `WEBMASTER_EMAILS` op dev is een testadres.
- Het vastlopen bij een groep met veel publicaties van niet-leden is niet gefixt: op de prod-export heeft geen groep zulke publicaties, en in v2 kan het niet ontstaan.

## Productdoel

Een lid verwijdert in de app zijn eigen account. Daarna is hij nergens meer te vinden: geen foto's, geen lidmaatschappen, geen ratings, en ook geen login. Wie later met hetzelfde e-mailadres inlogt, begint als nieuw.

## Invarianten (draft)

1. **Alleen jezelf.** Alleen het ingelogde lid kan zijn eigen account verwijderen.
2. **Bewust bevestigd.** De app legt uit wat er weggaat (definitief, foto's en lidmaatschappen) en vraagt een bevestiging. Er is geen wachtwoord meer, dus de bevestiging is iets anders (open vraag 1).
3. **Alles weg, niets half.** Na afloop staat er niets meer van het lid in een tabel of in storage, en de integriteitscheck (WP10) blijft schoon. Mislukt een stap, dan gaat het verder of is het opnieuw te starten; een half gewist account blijft niet stil achter.
4. **Ook de login weg.** De Clerk-user is verwijderd. Lukt dat niet, dan is dat zichtbaar (melding aan de webmaster) en wordt het opnieuw geprobeerd. Een volgende login mag niet stil op een leeg account uitkomen.
5. **Groepen blijven werken.** Was het lid oprichter of de enige admin, dan krijgt de groep een opvolger (M2-c, M2-d, WP28). Was hij het laatste lid, dan gaat de groep weg (M2-e). Andere leden zien geen kapotte covers, tellers of gemiddelden.
6. **Ook bij veel data.** Het werkt voor het grootste account op prod, met marge, binnen de Convex-limieten (4096 db-aanroepen, 32.000 gescande documenten per transactie). Tests draaien met `transactionLimits` en realistische data (les WP28).
7. **Na afloop uitgelogd.** De app logt uit en toont het inlogscherm met een korte bevestiging.

## Scope

- **In scope:**
  - de backend: `users.deleteSelf` in stappen en de Clerk-user verwijderen;
  - het scherm in de app: uitleg, bevestiging, uitloggen;
  - de ratings-cascades op schaal, voor zover account verwijderen ze raakt (WP28 besluit 13).
- **Bewust niet:**
  - een account door de webmaster laten verwijderen;
  - de opbouw van de profielpagina (WP27).

## Risico-assessment

- **security/privacy: hoog.** Onomkeerbaar. Convex krijgt de geheime sleutel van Clerk (`CLERK_SECRET_KEY`, alleen in de env).
- **ops: hoog.** Twee systemen. Een stap die faalt kan een half account of een login zonder data achterlaten.
- **external deps: medium.** De Clerk Backend API (user verwijderen kan op het gratis plan).
- **multi-user/concurrency: medium.** Een upload of rating terwijl het wissen loopt; de opvolging in een groep.
- **data/schema-evolutie: hoog.** Onomkeerbaar wissen in stappen over veel tabellen.
- **ops-runbook-impact:** `CLERK_SECRET_KEY` op dev en prod (Wouter zet hem). Komt in `external-services.md` en in de cutover-checklist.

## Open vragen voor A / Wouter

1. **Bevestiging zonder wachtwoord.** Bijvoorbeeld een nieuwe code per mail (zoals de login, gratis), of iets intypen. A adviseert.
2. **Volgorde Convex en Clerk,** en wat er gebeurt als de tweede mislukt.

## Cross-refs

- [`cascade-matrix.md`](../cascade-matrix.md): U6–U11, P3–P5, P9, M2.
- [WP28](./WP28-groepsbeheer.md): besluit 13 (ratings op schaal), M2-c/d/e.
- [WP18](./WP18-foto-upload.md): reserveringen (A-invariant 22), de leesgrens bij veel uploads.
- [WP13](./WP13-app-scaffold-auth.md) §schermen: het oude scherm "Account verwijderen".

## Acceptance

- Tests: A bepaalt, met `transactionLimits` en realistische data.
- Gate op dev:
  - een wegwerp-account met foto's, ratings, groepen (ook als oprichter) verwijderen;
  - daarna de integriteitscheck schoon;
  - in Clerk is de user weg;
  - opnieuw inloggen met dat adres begint als nieuw.

---

## Spec-criticus aanvullingen (A, 2026-11-10)

Bronnen: v1 `blob-images-api-user/handlersUser/deleteUser.js`, de streams `userDelTo*` in `blob-images-api`, het scherm `ProfileDelete.jsx` in de oude app. De huidige `users.deleteSelf`, de integriteitscheck (`MONITORED_FKS`) en convex-test 0.0.50 (`transactionLimits`).

### Kernvondsten

1. **v1 deed het in dezelfde volgorde, zonder vangnet.** Eerst de user-rij weg (de streams ruimden de rest asynchroon op), dan de Cognito-user. Mislukte Cognito, dan kreeg het lid "niet gelukt" te zien terwijl zijn data al weg was. Geen herhaling, geen melding.
2. **v1 vroeg het wachtwoord** en liet het lid met dat wachtwoord opnieuw inloggen als controle. De uitleg in v1: definitief, lidmaatschappen weg, alle foto's weg, niet meer inloggen, iemand moet je opnieuw uitnodigen.
3. **De huidige `deleteSelf` past niet bij veel foto's.** Hij plant per foto een opruimactie voor storage; Convex staat er 1000 per transactie toe. Een lid met meer dan 1000 eigen foto's kan zijn account nu niet verwijderen. Prod heeft ongeveer 1560 foto's. Daarnaast leest elke foto alle groepen, albums en users (P5) en herleest het aggregaat alle ratings per foto (WP28 besluit 13). In één transactie gaat dat al bij een paar honderd foto's over de 32.000 gelezen documenten.
4. **`deleteSelf` laat verwijzingen achter die de integriteitscheck meldt.** Niet opgeruimd: albums die hij maakte in een groep die blijft (`albums.createdBy`), uitnodigingen die hij verstuurde (`invites.invitedBy`), zijn features en upvotes (`features.submittedBy`, `featureUpvotes.userId`, `features.upvoteCount`), een gemigreerde publicatie van andermans foto die hij toevoegde (`albumPhotos.addedBy`), en een gemigreerde profielfoto die geen eigen foto is (wees-blob). Uitnodigingen aan zijn adres (zijn e-mailadres) blijven ook staan.
5. **Inloggen kan alleen met een bestaande Clerk-user.** De app kent alleen inloggen, geen registreren (Sign-up uit of invite-only). Na het verwijderen is het adres dus onbekend: inloggen lukt pas weer als iemand hem opnieuw uitnodigt (zoals v1). "Begint als nieuw" in de gate betekent: na een nieuwe uitnodiging een lege users-rij, zonder iets van vroeger.
6. **Een tweede login landt nu stil op een leeg account.** Bestaat de Clerk-user nog (Clerk mislukt, of een tweede toestel), dan maakt de webhook bij de volgende sessie een nieuwe, lege users-rij (`registerFromSession`).
7. **Clerk-user verwijderen kan op het gratis plan:** de Backend API, `DELETE /v1/users/{id}`, met de geheime sleutel. Daarna is elke Clerk-sessie van die user ongeldig; de app op een ander toestel valt binnen een minuut terug naar uitgelogd. Rate limit ruim (100 per 10 s). Geen kosten.

### Advies open vraag 1: bevestigen zonder wachtwoord

**Advies: een woord intypen, geen code per mail.** Het scherm legt uit wat er weggaat (zoals v1) en vraagt het lid `verwijder` in te typen. Pas dan wordt de knop actief.

- Een code per mail beschermt alleen tegen iemand met een ontgrendelde telefoon. Die telefoon heeft meestal ook de Mail-app; de code komt dan op hetzelfde toestel.
- Een eigen code vraagt een nieuw backend-pad (code maken, mailen, controleren, verlopen) of Clerk-reverificatie. Voor die laatste moet Convex een extra claim uit het token controleren; dat is niet uitgezocht en niet nodig.
- Clerk-dev mailt niet naar Apple-adressen (WP22). Een code-stap kan de gate en de review van Apple blokkeren.
- Apple eist alleen dat verwijderen in de app te starten is; een bevestigingsstap mag.
- Kosten: nul.

### Advies open vraag 2: volgorde Convex en Clerk

**Advies: eerst het account in één kleine stap afsluiten, dan Convex en Clerk los van elkaar, elk met herhaling.**

1. **Afsluiten (direct, één kleine transactie).** Het account staat vanaf dan als "wordt verwijderd". Het lid is voor elke publieke functie niet meer ingelogd: `users.current` is `null`, elke mutation en elke upload weigert. Een nieuwe sessie met dezelfde Clerk-user maakt geen nieuwe rij. Het lid ziet meteen "verwijderd" en de app logt uit.
2. **Convex opruimen in stappen.** Elke stap ruim binnen de limieten, stap na stap via de scheduler, tot er niets meer van hem is. Wat tussendoor nog binnenkwam (een upload die net klaar was), gaat mee.
3. **Clerk-user verwijderen**, meteen na stap 1 en los van stap 2. "Bestaat niet" (404) telt als gelukt. Mislukt het, dan opnieuw, verspreid over minstens een uur. Na de laatste poging een mail aan de webmaster.
4. **De users-rij gaat als laatste weg**, als stap 2 én 3 klaar zijn. Tot dan houdt hij elke login tegen.

Waarom:
- **Geen stil leeg account.** Stap 1 sluit het af; daarna maakt de volgorde van Convex en Clerk niet meer uit voor vondst 6.
- **Clerk mag de data niet ophouden.** Een storing bij Clerk laat de foto's niet staan; die zijn binnen minuten weg.
- **Convex mag Clerk niet ophouden.** Clerk direct na stap 1 sluit de login zo snel mogelijk.
- **Mislukt Clerk blijvend** (sleutel ontbreekt of is fout): de webmaster krijgt een mail, de integriteitscheck meldt de rij elke dag tot hij weg is, en de webmaster start het opnieuw met één commando.
- Alternatief "eerst Clerk, dan Convex": bij een Clerk-storing gebeurt niets en ziet het lid een fout; netjes, maar het lid moet zelf opnieuw. En valt Convex na Clerk weg, dan blijft data zonder login achter. Afgewezen.
- Kosten: nul. Geen nieuwe dienst; Mailjet en de scheduler bestaan al.

### A-invarianten

1. **Direct afgesloten.** Na `users.deleteSelf` (zelfde naam, geen argumenten) geeft `users.current` voor dit lid `null`. Mutations en `POST /upload` weigeren. Nog een keer `deleteSelf` geeft geen fout en start niets dubbel.
2. **Geen nieuwe rij tijdens het verwijderen.** Een sessie van dezelfde Clerk-user (webhook, `registerFromSession`) maakt geen users-rij zolang het account wordt verwijderd.
3. **Alles weg.** Als alle stappen klaar zijn, bevat geen document in een tabel nog zijn id, zijn Clerk-subject of zijn e-mailadres. Zijn beelden (origineel, *klein*, *groot*, een losse profielfoto) zijn uit storage. De integriteitscheck is schoon. Wel mag er een onherleidbare markering van zijn Clerk-subject staan (fix 1b): een hash, zonder id of adres.
4. **Wat van anderen is, blijft en klopt.**
   - Groepen: M2-c, M2-d en M2-e zoals nu.
   - Een album dat hij maakte in een groep die blijft: maker wordt de oprichter van de groep (na de opvolging).
   - Een publicatie van andermans foto die hij toevoegde: blijft staan, toegevoegd door de eigenaar van de foto.
   - Ratings: zijn ratings weg; aantal en gemiddelde op elke foto kloppen.
   - Features: zijn features gaan weg met hun upvotes; zijn upvotes op andere features gaan weg en de teller klopt.
   - Uitnodigingen: alle uitnodigingen die hij verstuurde, en alle aan zijn adres (genormaliseerd), welke status ook.
   - Gemelde foto's van een ander: `flaggedBy` weg, de melding blijft (U10).
5. **Wat tussendoor binnenkomt, gaat mee.** Een foto, rating of publicatie van hem die na stap 1 nog in de database komt, is aan het eind ook weg.
6. **Clerk.** Precies één geslaagde `DELETE https://api.clerk.com/v1/users/<subject>` met `Authorization: Bearer <CLERK_SECRET_KEY>`, alleen met een sleutel die bij de omgeving past (fix 1a). 404 telt als gelukt. Elke aanroep heeft een timeout (fix 5). Een mislukte poging wordt herhaald; het aantal pogingen is begrensd en ze liggen over minstens een uur. Er loopt hooguit één reeks pogingen (fix 3).
7. **Clerk mislukt blijvend, of de sleutel ontbreekt of past niet bij de omgeving.**
   - De Convex-data is toch weg (A-invariant 3, behalve de users-rij).
   - Eén mail aan `WEBMASTER_EMAILS` met de Clerk-subject, zonder het e-mailadres en zonder de sleutel. Hij zegt alleen dat de Convex-data weg is als dat op dat moment zo is (fix 6).
   - De users-rij blijft en houdt de login tegen (A-invariant 2).
   - De integriteitscheck meldt de rij als hij langer dan een uur wordt verwijderd; jonger niet.
   - De internal mutation `users.retryAccountDeletion({ userId })` start het opnieuw. Voor een account dat niet wordt verwijderd doet hij niets. Loopt er nog een reeks Clerk-pogingen, dan komt er geen tweede bij en geen tweede mail (fix 3).
8. **Op schaal.** Met `transactionLimits` lukt het voor een lid met 1600 eigen foto's (meer dan alle foto's op prod), elk gerated door 17 anderen, dat 1600 foto's van een ander ratede die elk 18 ratings hebben, oprichter is van een groep van 18 leden en het laatste lid van een groep met 1500 publicaties.
9. **Geen mail bij succes.** Geen mail aan het lid of de webmaster als alles lukt (zoals WP28 W7).

### A-keuzes

1. **Features gaan mee.** Ook een feature-verzoek waar anderen op stemden: het staat op zijn naam en de rij moet naar een bestaande user wijzen. Een probleemmelding bevat zijn tekst.
2. **Uitnodigingen aan zijn adres gaan mee, ook open.** Het adres is persoonsgegeven. Wie hem terug wil, nodigt opnieuw uit, als het verwijderen klaar is; tijdens het verwijderen weigert dat (fix 8).
3. **Een ander toestel tijdens het verwijderen** ziet heel even het scherm "geen account" (`noUserRow`) tot Clerk de sessie beëindigt. Geaccepteerd: dat duurt normaal seconden.
4. **Anderen zien hem tijdens het opruimen nog** (naam, foto's), tot de stap die het betreffende deel opruimt. Normaal minuten. Geaccepteerd.
5. **Bestaande tests op de oude, synchrone vorm** zijn aangepast: ze laten eerst alle geplande stappen lopen (`tests/_helpers/deleteAccount.ts`), met Clerk gestubd. Wat ze pinnen blijft gelijk.

### Scherm in de app (pariteit)

| v1 | v2 |
|---|---|
| Profiel → Account verwijderen | idem, als gevaarlijke rij in een eigen blok (bestaat in `ListRow`) |
| Uitleg: definitief, lidmaatschappen weg, foto's weg, niet meer inloggen, opnieuw uitnodigen | idem, plus: ratings weg; ben je oprichter, dan neemt een ander lid het over; ben je het laatste lid, dan verdwijnt de groep |
| Wachtwoord invoeren | `verwijder` intypen (advies vraag 1); de knop is pas dan actief |
| Melding "Je account is verwijderd", uitloggen | uitloggen, inlogscherm met de melding (invariant 7) |
| Melding bij een fout | idem; de app blijft ingelogd en er is niets gewist |

De info-tekst over gegevens (`app/src/content/infoTexts.ts`, "Tot dat in de app kan, stuur je een mail") wordt bijgewerkt. A-tests voor het scherm en de melding: zie §Fix-cyclus 3 (gate).

### Ops-runbook-impact (aanvulling)

- `CLERK_SECRET_KEY` (`sk_test_…` op dev, `sk_live_…` op prod) in de Convex env, met een regel in `external-services.md`: wat er gebeurt als hij ontbreekt (A-invariant 7) en het commando voor `retryAccountDeletion`.
- Cutover-checklist: sleutel op prod zetten vóór de App Store-build.
- Cascade-matrix: U6–U11 bijwerken (stappen, nieuwe rijen voor albums, features, uitnodigingen, Clerk).

### RED tests

| Bestand | Wat |
|---|---|
| `tests/users/deleteAccount.test.ts` | A-invariant 1–7 en 9: afsluiten, webhook, alles weg met een generieke scan en de integriteitscheck, opvolging, tussendoor binnengekomen data, Clerk (aanroep, 404, herhalen, blijvend mislukt, sleutel ontbreekt, opnieuw starten) |
| `tests/users/deleteAccountScale.test.ts` | A-invariant 8, met `transactionLimits` |
| `tests/_helpers/deleteAccount.ts` | helper: `deleteSelf` plus alle geplande stappen, Clerk gestubd |
| bestaande tests met `deleteSelf` (13 bestanden) | via de helper (A-keuze 5) |
| `tests/http/uploadReservationReads.test.ts` | de leesmeting op de handler van `deleteSelf` vervangen door een run met `transactionLimits` (400 foto's × 500 reserveringen) |

## Fix-cyclus 1 (A, 2026-11-10)

Bevindingen van audit en red-team op B's eerste implementatie (`c43741a`). Wouter akkoord.

### Besluiten

1. **Een sleutel van de verkeerde Clerk-omgeving** gaf 404, en dat telde als gelukt: de rij ging weg, de Clerk-user bleef, en de volgende login maakte stil een leeg account. Beide fixes:
   - **a. De sleutel moet bij de omgeving passen.** `CLUBALMANAC_STAGE=prod` vraagt `sk_live_`, `dev` vraagt `sk_test_`. Een ontbrekende of andere stage is ook een sleutelprobleem (fix-cyclus 2). Past hij niet, dan zoals "sleutel ontbreekt": geen aanroep naar Clerk, één mail aan de webmaster met de reden (zonder de sleutel), de rij blijft, en na herstel maakt `retryAccountDeletion` het af. 404 blijft gelukt: een tweede poging na een geslaagde `DELETE` geeft ook 404.
   - **b. Een verwijderde Clerk-user maakt nooit meer een users-rij.** Bij het afsluiten wordt een markering van zijn Clerk-subject bewaard: een SHA-256-hash, met de tijd, zonder id of adres. Hij blijft staan (Clerk hergebruikt geen ids; een paar rijen per jaar). `registerFromSession` maakt voor zo'n subject geen rij, en de webhook geeft 200, anders herhaalt Svix dagenlang. Een andere Clerk-user met hetzelfde adres begint gewoon als nieuw.
   - Een hash en niet de ruwe subject: zolang de Clerk-user bestaat, leidt de subject via Clerk naar de persoon. De hash volstaat om te vergelijken, en de generieke scan van A-invariant 3 blijft geldig.
   - Wat a niet vangt (een `sk_test_` van een andere dev-omgeving): de Clerk-user blijft, en wie daarmee inlogt, ziet "Je account is nog niet klaar", geen leeg account. Geaccepteerd: alleen op dev, en runbook-punt 9a checkt prod.
2. **Een late of herhaalde `session.created` ná afloop** maakte een spookrij met zijn adres en naam. Gedekt door 1b.
3. **`retryAccountDeletion` terwijl de Clerk-pogingen nog lopen** startte een tweede reeks, met bij blijvend falen twee mails. Nu loopt er hooguit één reeks: een retry start er geen tweede naast, en een poging nadat Clerk al gelukt is, doet niets. Een reeks die niet meer loopt (bv. na een crash), start hij wel opnieuw; bv. met een volgnummer per reeks, waarbij een poging van een oude reeks stopt.
4. **Een retry gooide een intussen verstuurde nieuwe uitnodiging aan zijn adres weg.** Juist is: tijdens het verwijderen kan niemand hem uitnodigen (punt 8). Alles wat bij een retry aan zijn adres staat, is dan van vóór het afsluiten en hoort weg (A-keuze 2). Als het verwijderen klaar is, kan iedereen hem weer uitnodigen.
   - Afgewezen: uitnodigingen van na het afsluiten laten staan. Dan gaat er een mail naar iemand die net gevraagd heeft om verwijderd te worden. Die uitnodiging werkt bovendien pas als het verwijderen klaar is: tot dan faalt het aanmelden op "Email is al in gebruik".
5. **Een Clerk-aanroep die nooit antwoordt** stopte de herhaling zonder mail. Nu heeft elke aanroep een timeout van hooguit 30 s. Een timeout telt als mislukte poging: opnieuw proberen, en na de laatste poging de mail. De timeout moet op `setTimeout` lopen (bv. met `AbortController`). `AbortSignal.timeout` loopt in vitest op de echte klok, en dan hangt de test (gecheckt).
6. **De mail aan de webmaster zei altijd "De data in Convex is weg"**, ook als het opruimen nog liep (bij een ontbrekende sleutel komt de mail al bij de eerste poging) of vastzat. Nu staat die zin er alleen in als het opruimen op dat moment klaar is. Anders bv. "Het opruimen in Convex loopt nog. Loopt het vast, dan meldt de integriteitscheck het."
7. **Lukt het uitloggen na het verwijderen niet** (`signOutAndWipe` geeft `false`), dan bleef het lid op "Je account is nog niet klaar" staan. Nu toont de poort "Je account is verwijderd", met de melding "Uitloggen lukte niet. Probeer het opnieuw." en de knop Uitloggen. Welk scherm, kiest een pure functie: `noUserRowView({ deleting, deleted }): "loading" | "accountDeleted" | "notReady"` in `app/src/lib/noUserRowView.ts`, met de twee vlaggen uit `app/src/data/accountDeletion.ts`.
8. **Een admin kon het lid uitnodigen terwijl zijn account werd verwijderd**, en dan ging er nog een mail naar zijn adres. Nu weigert `invites.create` een adres dat bij een account hoort dat wordt verwijderd, met of zonder groep. Met groep ná de admin-check en vóór de check op "al lid" (fix-cyclus 2). De melding bevat "wordt verwijderd", bv. "Dit adres hoort bij een account dat wordt verwijderd. Probeer het later opnieuw."
   - Vergelijk op het genormaliseerde adres. Een gemigreerde users-rij kan hoofdletters hebben; bv. het adres bij het afsluiten normaliseren.
   - De admin leert zo dat het adres bij een account hoort dat wordt verwijderd. Geaccepteerd: hij ziet nu ook al "al lid van de groep".
9. **Runbook.** Voor B, in `external-services.md` en de cutover-checklist:
   - a. Na het zetten van `sk_live_` op prod: één keer een wegwerp-account uitnodigen, in de app Account verwijderen, en in het Clerk-dashboard van de prod-omgeving checken dat de user weg is.
   - b. Heeft de webmaster na de mail de Clerk-user zelf in het dashboard verwijderd, dan toch altijd `retryAccountDeletion` draaien. Anders blijft de users-rij staan, en faalt het aanmelden na een nieuwe uitnodiging op "Email is al in gebruik".
   - c. In de rij van `CLERK_SECRET_KEY`: een sleutel die niet bij de omgeving past, geeft hetzelfde als een ontbrekende sleutel (1a).
10. **Voor B:** `convex/_generated/api.d.ts` is met de hand bijgewerkt; draai `npx convex codegen`.

Niet in deze cyclus: de M2-e-stap die bij een groep met veel gemigreerde publicaties van niet-leden op 4096 index-reads kan vastlopen (`convex/lib/unpublish.ts`). Regie meet dat eerst op dev-data.

### RED tests

| Bestand | Wat |
|---|---|
| `tests/users/deleteAccount.test.ts` §fix 1a | vier combinaties van omgeving en sleutel: geen aanroep, één mail zonder de sleutel, rij blijft; prod met `sk_live_` werkt; retry na herstel van de sleutel |
| idem §fix 1b en 2 | na 404 maakt dezelfde Clerk-user geen rij; een late `session.created` via de webhook: 200, geen rij, geen sporen; tijdens het verwijderen: 200, geen tweede rij; een andere Clerk-user blijft welkom |
| idem §fix 3 | een retry tijdens lopende pogingen: bij herstel precies één aanroep erna; bij blijvend falen één mail en niets meer gepland |
| idem §fix 4 en 8 | uitnodigen tijdens het verwijderen geweigerd (met en zonder groep, andere schrijfwijze, direct na het afsluiten), geen mail; na retry kan Olga hem weer uitnodigen en blijft die uitnodiging staan |
| idem §fix 5 | een Clerk die nooit antwoordt: elke aanroep met een signal, begrensd aantal, één mail |
| idem §fix 6 | de mail zegt alleen "Convex is weg" als dat op het moment van de mail zo is (sleutel ontbreekt, past niet, Clerk blijft falen) |
| `app/tests/noUserRowView.test.ts` | punt 7 |

Gewijzigd in het bestaande testbestand: de fetch-stub noteert of een Clerk-aanroep een signal heeft en kan Clerk laten hangen. De env zet ook de afzender van uitnodigingen, `CLUBALMANAC_APP_URL` en het webhook-secret.

In fix 6 met "Clerk blijft falen" komt de mail vóór het einde van het opruimen. Dat komt door de test, niet door de code: `runAllTimers` loopt de wachttijden van Clerk af, terwijl het opruimen stap voor stap gaat. De test checkt alleen of de mail klopt met de stand.

Stand: 16 rood in `deleteAccount.test.ts` en 1 rood testbestand in de app (de module bestaat nog niet), allemaal nieuw en om de bedoelde reden. Verder alles groen: backend 2278, app 1198. `tsc` is schoon in de root; in de app faalt hij alleen op de nog ontbrekende `noUserRowView`. Niet getoetst tegen een wegwerp-referentie.

## Fix-cyclus 2 (A, 2026-11-10)

Twee gaten uit de red-team-hercheck van B's fix-cyclus 1 (`f20c4d7`). Wouter akkoord.

1. **Een ontbrekende of onbekende stage is een sleutelprobleem.** Alleen `prod` (vraagt `sk_live_`) en `dev` (vraagt `sk_test_`) zijn bekend, exact zo geschreven. Een ontbrekende, lege of andere stage (bv. `staging`, `Prod`) gaat zoals een ontbrekende sleutel: geen aanroep naar Clerk, één mail aan de webmaster, de rij blijft. De mail noemt `CLUBALMANAC_STAGE` als reden. Na het zetten van de stage maakt `retryAccountDeletion` het af.
   - Waarom: zonder stage op prod vond de check een `sk_test_` goed. Clerk gaf 404, dat telde als gelukt, er ging geen mail uit, en de Clerk-user bleef. Het lid zag daarna voor altijd "Je account is nog niet klaar".
2. **Geen e-mail-orakel in `invites.create`.** De check "dit adres hoort bij een account dat wordt verwijderd" komt bij een groep ná `requireAdminForWrite`. Een niet-lid of een lid zonder admin-rol krijgt voor zijn adres dezelfde fout als voor elk ander adres (`NOT_MEMBER`, `NOT_ALLOWED`), zoals WP23 en WP24 dat voor bestaans-orakels vragen. Een admin krijgt "wordt verwijderd", ook als het lid nog lid van de groep is (de check staat vóór "al lid").
   - Geaccepteerd: een uitnodiging zonder groep mag elke ingelogde user maken. Daar blijft de melding een orakel, net als de bestaande "Er staat al een open invite voor dit emailadres". Alleen voor ingelogde leden, zonder bijwerking.

### RED tests

| Bestand | Wat |
|---|---|
| `tests/users/deleteAccount.test.ts` §fix-cyclus 2, punt 1 | stage ontbreekt, is leeg, `staging` of `Prod`, met Clerk op 404: geen aanroep, één mail die `CLUBALMANAC_STAGE` noemt, rij blijft; retry na het zetten van de stage |
| idem, punt 2 | niet-lid en lid zonder admin-rol: dezelfde fout voor zijn adres als voor een ander; een admin hoort "wordt verwijderd", ook als het lid nog lid is |
| `tests/_helpers/deleteAccount.ts`, `tests/users/deleteAccountScale.test.ts` | zetten `CLUBALMANAC_STAGE=dev` als hij ontbreekt; wat ze pinnen blijft gelijk |

Stand: 7 rood, allemaal nieuw en om de bedoelde reden; de rest groen (2295, ook de schaaltest); `tsc` schoon. Niet getoetst tegen een wegwerp-referentie.

## Fix-cyclus 3 (gate) (A, 2026-11-10)

Twee app-punten uit de gate op dev (simulator, release-build). Wouter akkoord. De rest van de gate was groen.

### Besluiten

1. **"Je account is verwijderd." hoort bij de app-sessie, niet bij één exemplaar van het inlogscherm** (invariant 7).
   - Gate: na het verwijderen logde de app uit en toonde het inlogscherm, maar zonder de melding.
   - Oorzaak (aannemelijk, niet bewezen op het toestel): `AccountDeletedNotice` zet de vlag op `false` als het scherm wordt weggehaald. Rond het uitloggen haalt de app het inlogscherm weg en zet het opnieuw neer: de poort toont eerst "Laden…" zonder navigator, de guards wisselen, en de poort doet `router.replace("/inloggen")`. Het eerste exemplaar wist de vlag, het tweede toont niets. Een dev-build met StrictMode doet hetzelfde.
   - Invariant: weghalen en opnieuw neerzetten verandert niets aan de melding. Hij eindigt alleen als het lid een nieuwe login begint: de tik op "Stuur code" of de return-toets in het e-mailveld. Dat doet `LoginScreen` zelf, vóór `login.sendCode` (de test vervangt `useEmailCodeLogin` door een nep). Ook een herstart van de app wist hem, want hij staat alleen in het geheugen. Tussen de tabs Inloggen en Info blijft hij staan.
   - Waarom bij "Stuur code": anders staat "Je account is verwijderd" boven een login met een ander adres.
2. **De knop onder het toetsenbord.**
   - Gate: na het intypen lag de knop onder het toetsenbord. Bovendien verwijderde de return-toets ("Gereed") het account direct (`onSubmitEditing` riep `onDelete` aan), zonder dat de knop in beeld was.
   - Invariant a (unit): alleen de tik op de knop verwijdert. De return-toets in het bevestigingsveld sluit het toetsenbord en doet verder niets.
   - Invariant b (gate): met het toetsenbord open en het woord ingetypt staat de knop helemaal boven het toetsenbord, zonder wegtikken. Dat geldt op de kleinste ondersteunde iPhone (SE, 4,7 inch) bij standaardtekstgrootte. Bij de grootste tekstgrootte is de knop met het toetsenbord open bereikbaar door te scrollen.
   - Waarschijnlijk telt `KeyboardAvoidingView` in `Screen` de navigatiebalk niet mee (`underHeader`), en scrolt de lijst niet mee naar de knop. Een oplossing in `Screen` geldt voor elk formulier; de gate kijkt dan ook naar Inloggen en een ander formulier onder een navigatiebalk.

### RED tests

| Bestand | Wat |
|---|---|
| `app/tests/accountDeletedNotice.test.ts` | punt 1: na verwijderen staat de melding op het inlogscherm; na weghalen en opnieuw neerzetten nog steeds; de tik op "Stuur code" en de return-toets in het e-mailveld beëindigen hem, ook na opnieuw neerzetten |
| `app/tests/deleteAccountKeyboard.test.ts` | punt 2a: de return-toets verwijdert niet en houdt het veld niet vast; de knop verwijdert wel, één keer |
| `app/tests/support/hookRuntime.ts` | `useSyncExternalStore` en `unmount()` erbij (draait de cleanups); bestaande tests ongewijzigd |

### Gate (release-build)

- Verwijderen: het inlogscherm toont "Je account is verwijderd."; na Info en terug staat hij er nog; na "Stuur code" is hij weg.
- Verwijderscherm: na het intypen staat de knop boven het toetsenbord (SE; bij de grootste tekst door te scrollen). De return-toets sluit het toetsenbord en verwijdert niets.
- Inloggen en een ander formulier onder een navigatiebalk: velden en knoppen niet onder het toetsenbord.

Stand: 4 rood, allemaal nieuw en om de bedoelde reden; de rest groen (app 1205); app-`tsc` schoon. Getoetst tegen een wegwerp-referentie (vlag niet wissen bij weghalen, wel bij "Stuur code"; geen `onSubmitEditing` op het bevestigingsveld): alle 8 groen. Punt 2b is niet als unit-test te pinnen.
