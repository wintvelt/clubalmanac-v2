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

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft.)
