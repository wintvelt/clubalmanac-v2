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

## Spec-criticus aanvullingen (A vult in)
