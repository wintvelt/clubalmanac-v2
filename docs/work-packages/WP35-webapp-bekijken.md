# WP35: webapp, bekijken

> Regie 2026-11-20. Eerste WP van Fase 4 Track B. App-WP met een stuk backend en nieuwe hosting. A → besluiten Wouter → B → audit → red-team op de toegang tot beelden vanuit de browser → gate in een echte browser (dev), daarna prod. Eigen branch `wp35`. Acties (uploaden, beheer, melden) volgen in een eigen WP.

## Productdoel

Een lid zonder iPhone, bijvoorbeeld op een Android-telefoon van de zaak, opent `app.clubalmanac.com` in de browser, logt in met zijn e-mailadres en een code, en ziet zijn groepen, albums, foto's en (in Blob bibliotheek) de films, net als in de iPhone-app. Wijzigen kan op het web nog niet. Wie geen toegang heeft, ziet niets, ook niet met een link die iemand doorstuurt.

## Besluiten (Wouter, 2026-11-20)

1. **Expo Web**: dezelfde code als de iPhone-app (`app/`), geen aparte webapp.
2. **Eerst bekijken.** Uploaden, groepsbeheer, melden en de andere acties komen in een volgende WP.
3. **Adres `app.clubalmanac.com`.** `clubalmanac.com` blijft zoals hij is, met de privacyverklaring waar App Store Connect naar linkt.
4. Kosten: ruim binnen €15 per maand (de hosting op AWS bestaat al, Clerk blijft gratis).

## Wat er is

- De app in `app/` (Expo Router, `expo-image`, Clerk, Convex) wordt alleen voor iOS gebouwd. Op het web is hij nooit gestart.
- Beelden (foto's, formaten, profielfoto's, uitnodigingskaart) komen van de beeldpaden in [`convex/http.ts`](../../convex/http.ts) (`/beeld/foto/`, `/beeld/profiel/`, `/beeld/uitnodiging/`). Die checken bij elk verzoek de login. De app stuurt het Clerk-token mee in de `Authorization`-header ([`app/src/data/images.tsx`](../../app/src/data/images.tsx)). De paden geven geen CORS-headers.
- Onderdelen die op het web niet of anders werken (inventaris regie, A maakt hem volledig): het iOS-actiemenu (`ActionSheetIOS`, vijf schermen), de kaart (`react-native-maps`, Apple Maps), de token-opslag van Clerk (`expo-secure-store`), de datumkiezer, delen (`expo-file-system`, `expo-sharing`), haptics en de toetsenbordafhandeling.
- `clubalmanac.com` draait op CloudFront met S3-bucket `clubalmanac-site` ([`site/README.md`](../../site/README.md), [`infra/site.yml`](../../infra/site.yml)), met een GitHub Action die vanaf `main` deployt.
- De films komen als ondertekende S3-link van 3 uur uit de backend (WP21).

## Invarianten

1. **Toegang zit in de backend, ook vanuit de browser.** Elke read en elk beeld checkt per verzoek de login en het lidmaatschap, net als nu (WP17a, WP23, WP24). De weigering is gelijk voor "bestaat niet" en "mag niet".
2. **Geen login-token in een URL.** Een token belandt anders in de browsergeschiedenis, in logs en bij doorsturen. Een beeldlink die iemand kopieert of doorstuurt, werkt bij een ander niet, of hooguit kort (de duur is een besluit, zie vraag 1).
3. **Geen openbaar beeld.** Er komt geen vaste, openbare URL naar een origineel, een formaat of een profielfoto, ook niet via CloudFront.
4. **Alleen de eigen webadressen.** De backend staat verzoeken uit de browser alleen toe vanaf `app.clubalmanac.com` (prod) en het lokale dev-adres (dev), niet vanaf elk domein.
5. **Inloggen zoals in de app**: e-mail en code, zonder wachtwoord. Uitloggen haalt in die browser de sessie weg, en een volgende gebruiker op dezelfde computer ziet geen beelden van de vorige.
6. **De iPhone-app verandert niet.** Elke aanpassing in gedeelde code laat iOS hetzelfde doen en eruitzien. De hele testsuite blijft groen.
7. **Alleen lezen.** Op het web staat geen knop die iets wijzigt of die op het web niet werkt. Wat ontbreekt, is weg, geen knop met een foutmelding.
8. **Geen stille mislukking.** Een beeld of film die niet laadt, geeft een nette tegel of een NL-melding met opnieuw proberen, zoals in de app.
9. **Telefoon eerst.** Het werkt op een telefoonbreedte in Chrome op Android en in Safari, en ook op een laptop.
10. **Een nieuwe versie komt aan.** Na een deploy krijgt de browser de nieuwe versie, en blijft er geen oude versie in de cache hangen.

## Scope

- **In:** de web-build van de app; inloggen en uitloggen; Mijn groepen; Groep (albums per jaar, leden); album (raster, ongelezen-tellers); foto-detail met bladeren; Mijn foto's; Profiel (bekijken, uitloggen); de films; de info-pagina's; licht en donker. Hosting op `app.clubalmanac.com` met een deploy vanaf `main`, en een manier om de web-build lokaal tegen dev te draaien voor de gate.
- **Bewust niet:** uploaden en alle andere acties (foto-menu, selectie, draaien, verwijderen, covers, profielfoto, naam wijzigen); groepsbeheer en uitnodigen; melden, ideeën en problemen; account verwijderen; delen; een installeerbare webapp (PWA) of meldingen; de Android-app. De kaart: zie vraag 6.

## Open vragen voor A (rapporteren aan regie)

1. **Beelden in de browser.** Een `<img>` stuurt geen `Authorization`-header mee. Welke route houdt invariant 1 tot en met 3 overeind: de web-app haalt elk beeld met de header op en toont het uit het geheugen, of de backend geeft per verzoek een korte, ondertekende beeldlink, of iets anders? Weeg mee: invariant 2 (doorsturen), invariant 5 (gedeelde computer), het geheugen bij een album van 540 foto's, en de Convex-bandbreedte.
2. **CORS.** Welke paden hebben CORS nodig (beelden, `/upload` niet in deze WP), welke origins, en hoe staan de toegestane origins per deployment ingesteld (fail-loud als ze ontbreken)?
3. **Clerk in de browser.** Wat moet er in Clerk dev en prod veranderen (toegestane origins, domein, `authorizedParties` of iets vergelijkbaars in [`convex/auth.config.ts`](../../convex/auth.config.ts)), waar bewaart Clerk de sessie op het web, en hoe lang blijft iemand ingelogd?
4. **Inventaris.** Welke schermen en modules starten niet op het web of crashen? Per stuk: verbergen, een web-variant, of niets doen. Het iOS-actiemenu zit ook in schermen die alleen-lezen wel nodig hebben (bijvoorbeeld Profiel)?
5. **Films.** Speelt een ondertekende S3-link in de browser, inclusief spoelen, zonder CORS-wijziging op `blob-videos`?
6. **Kaart.** De albumkaart gebruikt Apple Maps, en die werkt niet in de browser. Verbergen op het web, of een gratis OpenStreetMap-kaart? Besluit voor Wouter; regie stelt verbergen voor.
7. **Uitnodigingen.** Een bestaand lid accepteert een uitnodiging in Profiel (WP19b). Hoort dat bij "alleen lezen", of mag het op het web? Besluit voor Wouter.
8. **Hosting.** Wat is nodig voor `app.clubalmanac.com` (CloudFront-distributie, certificaat, DNS in Route 53, routes die bij een herlaad naar de app terugvallen, korte cache op het startbestand)? Liefst als CloudFormation zoals [`infra/site.yml`](../../infra/site.yml), met een deploy-rol zonder AWS-sleutels in GitHub. Wouter maakt de stack zelf aan.

A rapporteert ook wat hier ontbreekt of niet klopt. Oude code is hier nauwelijks bron: het gaat om pariteit met de nieuwe iPhone-app.

## Risico-assessment

- **security/privacy: hoog.** Privéfoto's via een nieuw kanaal (de browser). De beeldpaden veranderen of krijgen een nieuwe vorm, er komt CORS bij, en de Clerk-sessie leeft in een browser die gedeeld kan zijn. Red-team op de toegang tot beelden en op doorgestuurde links.
- **ops: medium.** Een nieuwe distributie en deploy naast `clubalmanac.com`. Een oude versie in de cache of een verkeerd ingestelde origin laat de webapp stil kapotgaan. De privacypagina mag niet geraakt worden.
- **external deps: medium.** Clerk op het web (domein, origins), CloudFront, certificaat en DNS, en Expo Web met `react-native-web`.
- **multi-user/concurrency: laag.** Dezelfde backend, alleen lezen.
- **data/schema-evolutie: laag.** Naar verwachting geen schemawijziging.
- **ops-runbook-impact:** de toegestane web-origins per deployment (env-var, fail-loud), Clerk-instellingen voor het web (dev en prod), de hosting (stack, GitHub-variabelen voor de deploy) en de publieke env-vars van de web-build. Een runbook voor de eenmalige opzet (zoals [`site/README.md`](../../site/README.md)) en entries in [`external-services.md`](../conventions/external-services.md). B levert ze mee, audit toetst.

## Cross-refs

- migratie-status: Fase 4 Track B (besluit 2026-11-15).
- WP17a (beeldpad en toegang), WP23 (veld-whitelist), WP24 (gates), WP21 (films), WP19b (uitnodigingen).
- [`site/README.md`](../../site/README.md) en [`infra/site.yml`](../../infra/site.yml) (bestaande hosting).
- [`design.md`](../design.md) (stijl en thema).

## Acceptance

- **Tests:** beelden vanuit de browser met en zonder geldige login, als lid, ex-lid en niet-lid (dezelfde weigering); CORS alleen voor de toegestane origins; geen token in een URL; fail-loud bij ontbrekende origins; de bestaande toegangstests blijven groen; de hele suite groen.
- **Gate door Wouter, eerst dev, in een echte browser** (laptop en telefoon, Android als het kan): inloggen met een code; groepen, albums en het album van 540 foto's (scrollen zonder fout); foto-detail en bladeren; Mijn foto's; Profiel; een film afspelen en spoelen; uitloggen en als een ander inloggen (geen beelden van de vorige); een beeldlink kopiëren naar een privévenster (werkt niet). Daarna een iOS-build in de simulator: niets veranderd.
- **Daarna prod:** deploy naar `app.clubalmanac.com`, dezelfde korte ronde, en `clubalmanac.com/privacy/nl` werkt nog.

---

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft. A commit edits hier.)
