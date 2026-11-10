# WP29: account verwijderen

> Draft 2026-11-10 (regie). Verplicht vóór de App Store-indiening: Apple eist dat een account in de app te verwijderen is. A → B → audit + red-team, gate op dev. Eigen branch `wp29`.

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
3. **Alles weg.** Als alle stappen klaar zijn, bevat geen document in een tabel nog zijn id, zijn Clerk-subject of zijn e-mailadres. Zijn beelden (origineel, *klein*, *groot*, een losse profielfoto) zijn uit storage. De integriteitscheck is schoon.
4. **Wat van anderen is, blijft en klopt.**
   - Groepen: M2-c, M2-d en M2-e zoals nu.
   - Een album dat hij maakte in een groep die blijft: maker wordt de oprichter van de groep (na de opvolging).
   - Een publicatie van andermans foto die hij toevoegde: blijft staan, toegevoegd door de eigenaar van de foto.
   - Ratings: zijn ratings weg; aantal en gemiddelde op elke foto kloppen.
   - Features: zijn features gaan weg met hun upvotes; zijn upvotes op andere features gaan weg en de teller klopt.
   - Uitnodigingen: alle uitnodigingen die hij verstuurde, en alle aan zijn adres (genormaliseerd), welke status ook.
   - Gemelde foto's van een ander: `flaggedBy` weg, de melding blijft (U10).
5. **Wat tussendoor binnenkomt, gaat mee.** Een foto, rating of publicatie van hem die na stap 1 nog in de database komt, is aan het eind ook weg.
6. **Clerk.** Precies één geslaagde `DELETE https://api.clerk.com/v1/users/<subject>` met `Authorization: Bearer <CLERK_SECRET_KEY>`. 404 telt als gelukt. Een mislukte poging wordt herhaald; het aantal pogingen is begrensd en ze liggen over minstens een uur.
7. **Clerk mislukt blijvend, of de sleutel ontbreekt.**
   - De Convex-data is toch weg (A-invariant 3, behalve de users-rij).
   - Eén mail aan `WEBMASTER_EMAILS` met de Clerk-subject, zonder het e-mailadres.
   - De users-rij blijft en houdt de login tegen (A-invariant 2).
   - De integriteitscheck meldt de rij als hij langer dan een uur wordt verwijderd; jonger niet.
   - De internal mutation `users.retryAccountDeletion({ userId })` start het opnieuw. Voor een account dat niet wordt verwijderd doet hij niets.
8. **Op schaal.** Met `transactionLimits` lukt het voor een lid met 1600 eigen foto's (meer dan alle foto's op prod), elk gerated door 17 anderen, dat 1600 foto's van een ander ratede die elk 18 ratings hebben, oprichter is van een groep van 18 leden en het laatste lid van een groep met 1500 publicaties.
9. **Geen mail bij succes.** Geen mail aan het lid of de webmaster als alles lukt (zoals WP28 W7).

### A-keuzes

1. **Features gaan mee.** Ook een feature-verzoek waar anderen op stemden: het staat op zijn naam en de rij moet naar een bestaande user wijzen. Een probleemmelding bevat zijn tekst.
2. **Uitnodigingen aan zijn adres gaan mee, ook open.** Het adres is persoonsgegeven. Wie hem terug wil, nodigt opnieuw uit.
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

De info-tekst over gegevens (`app/src/content/infoTexts.ts`, "Tot dat in de app kan, stuur je een mail") wordt bijgewerkt. Geen A-tests voor het scherm (geen pure logica van betekenis).

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

Stand: 20 rood in 2 bestanden, alleen nieuwe tests; de rest groen (2255); `tsc` schoon; de app is niet geraakt. De schaaltest faalt nu op de leesgrens in `recomputeRatingAggregate` vanuit `deleteSelf` en duurt ±40 s. Niet getoetst tegen een wegwerp-referentie-implementatie.
