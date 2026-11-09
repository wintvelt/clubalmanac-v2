# WP22: link in de login-mail

> Draft 2026-11-09 (regie, na verkenning). Eis van Wouter, verplicht vóór T0. Vervangt de reset-WP: er is geen wachtwoord meer. Eerst kiest Wouter een route (§Routes), dan A → B → audit + red-team op het linkpad. Gate op de iPhone via TestFlight, inclusief een verlopen code (WP13-gate 4a). Account verwijderen is apart: WP29.

## Productdoel

Wie op de telefoon inlogt, tikt in de mail op de link, en de app opent en logt in. Zonder app, of op een ander toestel, krijg je de code te zien om over te typen.

## Invarianten (draft)

1. **De code blijft het fundament.** De mail toont de code als leesbare tekst, zoals nu. De link is een extra. Wie de link niet kan gebruiken, kan altijd nog de code typen.
2. **Link opent de app en rondt af.** Op een iPhone met de app opent de link de app, die de code in de lopende login zet en de login afrondt. Geen extra tik (eis Wouter, invariant 19 uit WP13). *A toetst dit tegen "invullen, niet afronden" uit de oude app.*
3. **Alleen de lopende login.** Een code uit een link rondt alleen de login af die op dit toestel loopt. Is er geen lopende login (app herstart, ander e-mailadres, al ingelogd), dan logt de link niemand in en zegt de app in gewone taal wat je kunt doen.
4. **Zonder app of op een ander toestel** toont de link een pagina met de code om over te typen, en verder niets.
5. **Verlopen of al gebruikte code** geeft dezelfde leesbare melding als bij typen, met "Stuur een nieuwe code".
6. **De code lekt niet.** Niet in een server-log, niet in analytics, niet in een foutmelding. Zet de code in de URL na `#`, dan stuurt de browser hem niet naar de server.
7. **Geen nieuwe stille faalwijze.** Komt de mail niet aan, dan is dat zichtbaar (log of alert), niet pas als een lid belt.

## Routes (keuze Wouter)

Uit de verkenning van 2026-11-09 (bronnen onderaan). Clerk stuurt nu de mail met de code; de vraag is hoe er een link in komt.

| | Route | Wat kost het | Risico |
|---|---|---|---|
| **R1** | **Clerk-template aanpassen.** Clerk blijft de mail sturen; in het template komt een link met de code. | Clerk Pro, $25/mnd ($20 bij jaarbetaling). Op een dev-instance kan het gratis, dus de spike kost niets. | Klein. Te checken: of de code als variabele in het template staat (de docs noemen hem niet). |
| **R2** | **Clerk stuurt niet zelf.** "Delivered by Clerk" uit; Clerk stuurt een webhook met de code naar Convex, en Convex mailt via Mailjet met de link. | Waarschijnlijk geen Clerk-plan nodig (niet bevestigd). | De code gaat door onze backend. Mailjet faalt stil bij een fout in de afzender (bekend issue). Als de webhook stuk is, kan niemand inloggen. |
| **R3** | **Clerk's eigen e-maillink** ("magic link") in plaats van een code. | Gratis. | Clerk heeft er geen Expo-gids voor. De link opent een browser, niet de app; de app moet wachten tot je terugkomt. Vervangt de code, dus invariant 1 vervalt. |

**Domein voor de link (alle routes behalve R3).** Een universal link heeft een https-domein nodig met het bestand `/.well-known/apple-app-site-association`. `clubalmanac.com` draait nu op AWS (CloudFront + S3, de oude webapp) en heeft dat bestand niet. Opties: het bestand op die S3 zetten, of een subdomein (bv. `link.clubalmanac.com`) op een andere host. Hangt samen met de webapp-vraag en de AWS-opruiming na T0. iOS haalt het bestand op bij installatie en update, dus het moet goed staan vóór de App Store-build.

**Apple/EAS.** De app krijgt `ios.associatedDomains`. Volgens Expo registreert EAS Build de capability zelf bij Apple. Waarschijnlijk vraagt dat één keer om Wouters Apple-login (`eas credentials` of een interactieve build).

**Regie-advies: R1.** De minste bewegende delen. De code gaat niet door onze backend, en er is geen nieuwe stille faalwijze. Clerk Pro geeft ook een eigen sessieduur, en die moet nog gekozen worden (T-4 weken in `migratie-status.md`, WP15a open vraag 4). Eerst een spike op de dev-instance: staat de code als variabele in het template, en hoe ziet de link eruit in Gmail en Apple Mail.

## Edge cases + scope

- **In scope:**
  - Link in de login-mail.
  - De app vangt de link op.
  - Fallback-pagina met de code.
  - Universal link + domein.
  - Gate 4a (verlopen code).
- **Bewust niet:**
  - Invite-links (WP19). Wel hetzelfde domein en mechanisme kiezen, zodat WP19 het hergebruikt (WP13 open vraag 4).
  - Account verwijderen (WP29).
  - De webapp.

## Risico-assessment

- **security/privacy: hoog.** Een inlogcode in een URL. Een eigen scheme kan door een andere app geclaimd worden. Een link kan op een ander toestel geopend worden, of terwijl iemand al ingelogd is.
- **ops: hoog** bij R2 (Mailjet stil falen, webhook stuk = niemand logt in), **medium** bij R1.
- **external deps: hoog.** Clerk (plan, template), Apple (associated domains, AASA-cache), domein/hosting op AWS.
- **multi-user/concurrency: medium.** Meerdere codes tegelijk, een verlopen code, een link terwijl je ingelogd bent.
- **data/schema-evolutie: laag.** Geen schemawijziging.
- **ops-runbook-impact:**
  - Clerk-template (en eventueel Pro) op dev en prod.
  - Het AASA-bestand en waar het staat.
  - `associatedDomains` in de build.
  - Prod-Clerk krijgt dezelfde template-instelling (cutover-checklist T-4 weken).

## Cross-refs

- [WP13](./WP13-app-scaffold-auth.md): invariant 19, §Mail-links in de oude app, gate 4a.
- [`external-services.md`](../conventions/external-services.md): Clerk en Mailjet.
- [`migratie-plan-convex.md`](../migratie-plan-convex.md) §Clerk e-mail (afzender `accounts.clerk.dev` op free).
- Bronnen verkenning:
  - [Clerk e-mailtemplates](https://clerk.com/docs/guides/customizing-clerk/email-sms-templates)
  - [Clerk pricing](https://clerk.com/pricing)
  - [Clerk e-maillinks](https://clerk.com/docs/custom-flows/email-links)
  - [Expo universal links](https://docs.expo.dev/linking/ios-universal-links/)

## Acceptance

- Tests: A bepaalt, op basis van de invarianten.
- Gate op de iPhone (TestFlight), met een echt mailadres, geen `+clerk_test`:
  - link in de mail → app opent en is ingelogd;
  - verlopen code (4a);
  - link op een toestel zonder app;
  - link terwijl je al ingelogd bent.

---

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft.)
