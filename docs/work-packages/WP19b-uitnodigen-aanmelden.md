# WP19b: uitnodigen en aanmelden

> Draft regie 2026-11-13. App + backend. A → B → audit → gate op dev (simulator + een echte mail). Eigen branch `wp19b`.

## Besluiten Wouter

1. **Geen link in de uitnodigingsmail (2026-11-13).** Er is nog geen webapp, en een app-link werkt alleen als de app al op het toestel staat. De mail zegt: installeer de app en log in met dit e-mailadres. Na het inloggen ziet de genodigde de uitnodiging in de app. Dit sluit WP13 vraag 4.

## Productdoel

Een admin nodigt iemand uit met een e-mailadres. De genodigde krijgt een mail zonder link, logt in de app in met een code op dat adres en ziet daar de uitnodiging. Bij een nieuw lid gaat het accepteren vanzelf bij de eerste keer inloggen. Een bestaand lid kiest zelf: accepteren (en dan zit hij in de groep) of afwijzen. Wie geen open uitnodiging heeft, krijgt geen account.

## Invarianten

1. **Uitnodigen is voor de admin van de groep.** Alleen een admin nodigt uit voor een groep (zoals nu, WP28 besluit 6). Een adres dat al lid is, of al een open uitnodiging voor die groep heeft, wordt geweigerd. De melding is gewoon Nederlands en zegt welk adres het is.
2. **De mail bevat geen link en geen token.** Wel: wie uitnodigt, voor welke groep, het e-mailadres waarmee je moet inloggen, en tot wanneer de uitnodiging geldt. Het token verlaat de backend niet meer.
3. **Aanmelden met een code.** Een nieuw adres kan in de app een account maken: e-mail invullen, code uit de mail, klaar. Geen wachtwoord (zoals WP22). Het inlogscherm maakt zelf uit of het om inloggen of aanmelden gaat; de gebruiker hoeft niet te kiezen.
4. **Geen account zonder open uitnodiging.** Dat geldt aan de serverkant. Een sessie van een adres zonder open, geldige uitnodiging maakt geen users-rij, en de app zegt dan duidelijk dat je eerst een uitnodiging nodig hebt. De app vraagt nergens anoniem of een adres een uitnodiging heeft: geen e-mail-orakel (WP23).
5. **Eerste keer inloggen accepteert alles wat open staat.** Zoals nu in de onboarding: alle open, geldige uitnodigingen voor dat adres. Daarna opent de app op een groep van de nieuwe uitnodigingen.
6. **Een bestaand lid ziet zijn ontvangen uitnodigingen.** Een nieuwe read geeft alleen de open, niet verlopen uitnodigingen voor het eigen adres. Per uitnodiging: groep (naam, cover), wie uitnodigt (naam, profielfoto via het openbare profielpad), tot wanneer, als admin of niet. Geen token, geen e-mailadres van een ander. Veld-whitelist zoals WP23.
7. **Accepteren en afwijzen zonder token.** De app werkt met de uitnodiging uit de read van invariant 6. Alleen de genodigde zelf kan accepteren of afwijzen. Na accepteren staat de groep in Mijn groepen; na afwijzen verdwijnt de uitnodiging uit de lijst. De mail aan de afzender (geaccepteerd of afgewezen) blijft.
8. **Geen anonieme ingang over uitnodigingen.** Wat alleen voor de link bestond (de landing zonder login), verdwijnt of wordt afgeschermd.

## Edge cases + scope-uitsluitingen

- Verlopen uitnodiging, groep inmiddels verwijderd, of afzender geen admin meer: niet accepteerbaar (WP28 A-invariant 4). Toon dat als "niet meer geldig", niet als fout.
- Uitgenodigd met een ander adres dan waarmee je inlogt: de uitnodiging verschijnt niet. De mail noemt daarom het adres.
- Account in verwijdering: geen uitnodiging (WP29 fix 8, blijft).
- **Buiten scope:** de webapp en Android (Track B), app-distributie (App Store of TestFlight, fase 5), een "Uitnodiging"-tab in de uitgelogde tabbalk met code invoeren (geen code meer), herinneringsmails.

## Risico-assessment

- **Security/privacy: hoog.** Wie een account krijgt verandert (invariant 4). Een nieuwe read met andermans gegevens (invariant 6). Een fout hier geeft een vreemde toegang of lekt adressen.
- **Ops: medium.** Mailjet faalt stil bij een niet-gevalideerde afzender (known issue). Een mail die niet aankomt, ziet niemand.
- **Externe deps: medium.** Clerk sign-up met code in Expo (gratis plan); Mailjet.
- **Multi-user/concurrency: laag-medium.** Accepteren terwijl de groep wordt verwijderd of de afzender vertrekt; twee keer tikken op accepteren.
- **Data/schema: laag.** Hooguit een veld erbij of weg (bijv. een bericht bij de uitnodiging). Bestaande invites op prod blijven geldig.

## Cross-refs

- WP6 (onboarding via `session.created`), WP9 (verlopen), WP5 (Mailjet), WP13 (schermen-tabel: Uitnodigen, Uitnodigingen, Aanmelden), WP22 (code-login), WP23 (whitelist, geen orakel), WP28 (admin-regels), WP29 (account verwijderen).
- `cascade-matrix.md`: invites-rijen.

## Open vragen voor A

1. **Uitnodigen in de oude app:** welke velden (naam, e-mail, als admin, bericht)? Bewaarde de backend de naam of het bericht, en kwam het bericht in de mail?
2. **Openstaande uitnodigingen van een groep:** kon een admin die zien en intrekken? Zo ja: hoort dat in WP19b.
3. **Uitnodiging zonder groep:** `invites.create` kan dat nu. Gebruikte een oude client het? Zo niet: schrappen of laten?
4. **WP6 Gate 3 (zero-invite fallback):** waarom maakt de onboarding nu een users-rij zonder uitnodiging? Wat breekt er als invariant 4 dat verbiedt (prod-pre-create, tests, runbook)?
5. **Wat vervalt zonder link:** `getByToken`, `buildInviteUrl`, `CLUBALMANAC_APP_URL`, het token als argument. Wat kan weg, wat moet blijven?
6. **Clerk sign-up met code in Expo:** check de actuele Clerk-docs. Hoe ziet de app het verschil tussen inloggen en aanmelden zonder dat hij lekt of een adres bestaat?

## Werkvolgorde

1. Regie: deze draft.
2. A: spec-criticus (oude app + backend: uitnodigen, uitnodigingen, aanmelden), open vragen beantwoorden, RED tests. Stop bij een vraag die een productkeuze is.
3. B: implementatie.
4. Audit.
5. Gate op dev: admin nodigt een nieuw adres uit, de mail komt aan zonder link, aanmelden met code, de groep staat er. Daarna een bestaand lid uitnodigen en in de app accepteren en afwijzen. Een adres zonder uitnodiging krijgt geen account.

## Spec-criticus aanvullingen (A, 2026-11-13)

Bronnen: v1 `blob-images-api-groups` (`sendInvite`, `listMembers`, `deleteMembership`, mails `invite` en `uninvite`), `blob-images-api-invites`, `blob-images-api/handlersCognito/preSignup.js`, de oude app (`GroupInviteSub`, `Invites`, `Invited`, `LoginSignup`, `datastores/invite.js`). Huidig: `convex/invites.ts`, `users.registerFromSession`, `/clerk-webhook`, `lib/emailTemplates.ts`, `app/src/auth/useEmailCodeLogin.ts`. Clerk: `@clerk/expo` 4.14.1 en de docs (sign-in-or-up).

### Kernvondsten

1. **v1 liet alleen aanmelden met een uitnodiging**, in Cognito's pre-signup (de webmaster mocht zonder). v2 laat nu iedereen met een Clerk-account binnen: `registerFromSession` maakt altijd een rij.
2. **Clerk-dev staat op "sign-up uit of invite-only"** (`external-services.md`). Aanmelden in de app werkt pas als sign-up aan staat. Dat is een dashboard-actie voor Wouter.
3. **Een nieuw lid heeft geen naam.** Aanmelden met alleen een code geeft Clerk geen voor- en achternaam. v1 vroeg de naam bij het aanmelden. Zonder naam toont v2 overal het e-mailadres (mail "geaccepteerd", ledenlijst).
4. **Het token zit nog op vijf plekken:** de return van `invites.create`, `getByToken`, de argumenten van `accept` en `decline`, en de mail (link plus "plak deze code"). `getInviteForEmail` geeft het door aan de mail.

### Antwoorden open vragen

1. **Velden in de oude app:** naam, e-mail en "als admin" (aan of uit) per genodigde, op een verzendlijst. Eén bericht voor de hele lijst, verplicht. De backend bewaarde naam en bericht bij de uitnodiging. De mail begon met "Hi {naam}", bevatte het bericht en de groepsfoto, en "geldig tot". v2 bewaart naam en bericht niet; de mailtemplate kent het bericht al. **Productvraag V1 en V2.**
2. **Openstaande uitnodigingen van een groep:** ja. De ledenlijst had een sectie "uitgenodigd" (alleen admins zagen het menu). Een admin kon intrekken, met bevestiging; de genodigde kreeg dan een mail. WP28 wijst "Uitnodiging intrekken" toe aan WP19. `invites.remove` bestaat al (afzender of admin); een read van de open uitnodigingen van een groep niet. **Productvraag V3.**
3. **Uitnodiging zonder groep:** v1 kende die niet (alleen `/groups/{id}/invite`), en de v2-app gebruikt hem niet. Advies: schrappen. `invites.create` vraagt dan altijd een groep. Bestaande rijen zonder groep zijn er op prod niet (v1 had ze niet). A-keuze 1.
4. **Zero-invite fallback (WP6 Gate 3):** WP6 koos "rij zonder lidmaatschap" omdat de pre-signup-gate niet gebouwd werd, en voor de webmaster bij een lege deployment. Wat breekt met invariant 4:
   - Tests: `registerFromSession.test.ts` pint "zero-invite", "verlopen invite" en "webmaster-bypass" op een rij. A past ze aan.
   - Runbook: `wp6-clerk-empirical-gates.md` Gate 3 en de T-4-weken-stap in `migratie-status.md` ("zero-invite-fallback") draaien om: geen rij.
   - Prod: niets. Alle 16 prod-users krijgen hun rij uit de data-import (WP12), dus `registerFromSession` is voor hen een no-op.
   - Een lege deployment: de eerste user komt uit de import of een internal mutation, niet uit een sessie. Advies: geen uitzondering voor de webmaster. A-keuze 2.
5. **Wat vervalt zonder link:**
   - Weg: `getByToken` (invariant 8), `buildInviteUrl`, `CLUBALMANAC_APP_URL` (env-var, tests, runbooks), het token in de mail, in de return van `create` en in `getInviteForEmail`.
   - Anders: `accept` en `decline` nemen het id van de uitnodiging uit de nieuwe read (invariant 7).
   - Blijft: het veld `token` en de index in het schema (bestaande rijen); geen publiek pad leest of schrijft hem.
6. **Clerk aanmelden met code in Expo:** Clerk heeft een "sign-in-or-up"-flow: `signIn.create({ identifier, signUpIfMissing: true })`. Clerk stuurt altijd een code, ook voor een onbekend adres. Pas na de juiste code zegt Clerk "bestaat niet" (fout `sign_up_if_missing_transfer`); de app maakt dan het account met `signUp.create({ transfer: true })` en `finalize()`. De gebruiker ziet bij een bekend en een onbekend adres hetzelfde: e-mail, code, klaar. Het werkt met de enumeratie-bescherming aan, en zit in de geïnstalleerde versie. Nodig in het Clerk-dashboard (dev nu, prod in fase 5): sign-up aan, geen verplichte naamvelden. Bot-bescherming bij aanmelden checken bij de gate: die vraagt in deze flow een captcha. Bronnen: Clerk-docs "Sign-in-or-up custom flow", changelog 2026-08-04.

### Productvragen voor Wouter (A stopt hier)

- **V1. Naam en bericht bij uitnodigen?** Advies: zoals v1 per genodigde naam, e-mail en "als admin". Eén bericht voor de verzendlijst, maar optioneel (v1: verplicht). Het bericht komt in de mail en bij de ontvangen uitnodiging; de naam in de aanhef van de mail en in de lijst open uitnodigingen.
- **V2. Welke naam krijgt een nieuw lid?** Clerk geeft er geen. Advies: de naam uit de uitnodiging (bij meer uitnodigingen de nieuwste). Het lid past hem aan in Profiel. Geen extra scherm.
- **V3. Open uitnodigingen zien en intrekken in WP19b?** Advies: ja, in Leden een blok "Uitgenodigd" voor admins, met intrekken na bevestiging. Geen mail aan de genodigde bij intrekken (v1 deed dat wel).
- **V4. Cover bij een ontvangen uitnodiging?** De genodigde is nog geen lid en heeft dus geen toegang tot de foto. Een cover tonen vraagt een nieuwe uitzondering op de foto-toegang. Advies: geen cover, de lettertegel van de groep.

### A-invarianten

Gelden ongeacht de antwoorden op V1–V4.

1. **Geen rij zonder open uitnodiging.** `registerFromSession` maakt alleen een users-rij als er voor het geverifieerde adres minstens één uitnodiging is die nu accepteerbaar is: status open, niet verlopen, groep bestaat, uitnodiger nog admin (zelfde regel als `accept`). Anders: geen rij, geen lidmaatschap, geen wijziging aan een uitnodiging. Geen uitzondering voor de webmaster. De webhook geeft 200 (geen herhaling door Svix). Een bestaande rij (opnieuw inloggen) blijft een no-op, zoals nu.
2. **Alsnog uitgenodigd.** Wordt iemand na een geweigerde sessie uitgenodigd, dan maakt zijn volgende sessie het account. Er blijft niets van de geweigerde sessie in Convex.
3. **De app weet waarom er geen account is.** Een read voor de ingelogde caller zegt: account, wachten (er is een accepteerbare uitnodiging, de rij komt nog) of geen uitnodiging. Hij kijkt alleen naar het eigen geverifieerde adres uit de sessie. Anoniem geeft hij niets. Een account dat wordt verwijderd telt als account (de app kent dat geval al).
4. **De uitnodigingsmail bevat geen link en geen token.** Wel: wie uitnodigt, de groep, het adres waarmee je inlogt, tot wanneer, en dat je de app installeert en met dat adres inlogt. Hij gaat ook weg als `CLUBALMANAC_APP_URL` niet bestaat. De mails aan de afzender (geaccepteerd, afgewezen, onbestelbaar) blijven zoals ze zijn.
5. **Geen token buiten de backend.** Geen publieke query, mutation of httpAction neemt een token aan of geeft er een terug. `getByToken` bestaat niet meer. `create` geeft alleen het id.
6. **Ontvangen uitnodigingen.** Een nieuwe read geeft de caller zijn uitnodigingen die nu accepteerbaar zijn: open, niet verlopen, groep bestaat, uitnodiger nog admin, voor zijn adres (genormaliseerd). Nieuwste eerst. Per uitnodiging alleen: id, rol, geldig tot, groep (`_id`, naam), uitnodiger (`_id`, naam, avatar-velden zoals `getById`). Geen token, geen e-mailadres, geen `invitedBy`, geen tijden van anderen. Zonder rij of anoniem: lege lijst.
7. **Accepteren en afwijzen op id.** `accept` en `decline` nemen het id uit invariant 6. Is het id nu geen accepteerbare uitnodiging voor het adres van de caller, dan één weigering, `INVITE_INVALID`: van een ander adres, onbekend, ingetrokken (gewist), verlopen, al beantwoord, groep weg, uitnodiger geen admin. Zo verraadt hij niet of een id bestaat. Twee keer accepteren: de tweede weigert en maakt geen tweede lidmaatschap. Uitzondering: een eigen, al afgewezen uitnodiging nog eens afwijzen geeft geen fout. `accept` geeft de `groupId` terug (WP28 H2).
8. **Uitnodigen.** Alleen een admin (WP28 W6). Altijd met een groep. Een adres dat lid is of al een open uitnodiging voor die groep heeft: geweigerd, met een Nederlandse melding die het adres noemt. Een verlopen uitnodiging blokkeert niet.
9. **Inventaris.** De publieke paden die een invite-id aannemen staan vast in een test: `accept`, `decline`, `remove`. Elk met een gate: genodigde (op adres) of afzender of admin van de groep.

### A-keuzes

1. **Geen uitnodiging zonder groep** (vraag 3). De tests op een uitnodiging zonder groep (create, accept, onboarding) vervallen.
2. **Geen webmaster-uitzondering** (vraag 4). Advies aan regie: de runbooks van WP6 bijwerken in B's commit.
3. **Geen "opnieuw proberen" voor een geweigerde sessie.** Wie later wordt uitgenodigd, logt uit en opnieuw in. Het scherm "geen uitnodiging" zegt dat. Een frontend-pad om het account te maken komt er niet (WP6: onboarding alleen via de webhook).

### Scherm in de app (pariteit)

| v1 | v2 |
|---|---|
| Inloggen en Aanmelden apart, met "ik heb een uitnodiging" | één inlogscherm: e-mail, code, klaar. De app kiest zelf inloggen of aanmelden (vraag 6) |
| Aanmelden: code, naam, e-mail, wachtwoord, opt-in | geen apart scherm (V2 bepaalt de naam) |
| — | ingelogd zonder account en zonder uitnodiging: "Je hebt eerst een uitnodiging nodig", met uitloggen (A-invariant 3, A-keuze 3) |
| Uitnodigingen: lijst + "code invoeren" | Profiel → Uitnodigingen: lijst uit A-invariant 6, zonder code. Leeg: "Geen uitnodigingen" |
| Uitgenodigd: aan, op, van, bericht, groepsfoto; Accepteren, Afwijzen | idem zonder "aan/op" en met V1/V4. Accepteren → naar de groep. Afwijzen → weg uit de lijst. Niet meer geldig → "Deze uitnodiging is niet meer geldig", geen fout |
| Groep → Uitnodigen: verzendlijst, bericht | idem (V1). Weigering per adres zichtbaar |
| Leden: sectie uitgenodigd, intrekken | V3 |

### Ops-runbook-impact (aanvulling)

- Clerk-dashboard dev nu, prod in fase 5: sign-up aan, geen verplichte naamvelden, bot-bescherming checken. In `external-services.md` de regel "Sign-up uit of invite-only" vervangen.
- `CLUBALMANAC_APP_URL` weg: uit `external-services.md`, `wp5-mailjet-empirical-gates.md` en de Convex env van dev (Wouter, na de merge).
- `wp6-clerk-empirical-gates.md` Gate 3 en de T-4-weken-stap in `migratie-status.md`: zonder uitnodiging geen rij.
- Cascade-matrix S1: "Webmaster cold-start zonder invite acceptabel" eruit.

### Voor B

Namen die de tests gebruiken. Gedrag staat in de A-invarianten.

- `internal.users.registerFromSession({ subject, email, name? })` → `Id<"users"> | null`. `null` = geweigerd (A-invariant 1).
- `api.users.signupState()` → `"account" | "waiting" | "noInvite" | null` (A-invariant 3). `null` zonder identity.
- `api.invites.listReceived()` → lijst (A-invariant 6), vorm in `lib/shapes.ts`.
- `api.invites.accept({ inviteId })` → `{ groupId }`; `api.invites.decline({ inviteId })` → `null`.
- `api.invites.create({ email, groupId, role? })` → `{ inviteId }` (velden uit V1 komen erbij).
- `inviteTemplate` zonder `inviteUrl` en `token`, met het adres van de genodigde.
- App: de pure beslissing "welk scherm zonder rij" breidt `noUserRowView` uit met `noInvite`.

### RED tests

Volgen na de besluiten over V1–V4. De migratie van `{ token }` naar `{ inviteId }` raakt ongeveer 20 testbestanden; A doet dat via een helper, zoals WP29 A-keuze 5.
