# WP35: webapp, bekijken

> Regie 2026-11-20. Eerste WP van Fase 4 Track B. App-WP met een stuk backend en nieuwe hosting. A → besluiten Wouter → B → audit → red-team op de toegang tot beelden vanuit de browser → gate in een echte browser (dev), daarna prod. Eigen branch `wp35`. Acties (uploaden, beheer, melden) volgen in een eigen WP.

## Productdoel

Een lid zonder iPhone, bijvoorbeeld op een Android-telefoon van de zaak, opent `app.clubalmanac.com` in de browser, logt in met zijn e-mailadres en een code, en ziet zijn groepen, albums, foto's en (in Blob bibliotheek) de films, net als in de iPhone-app. Wijzigen kan op het web nog niet. Wie geen toegang heeft, ziet niets, ook niet met een link die iemand doorstuurt.

## Besluiten (Wouter, 2026-11-20)

1. **Expo Web**: dezelfde code als de iPhone-app (`app/`), geen aparte webapp.
2. **Eerst bekijken.** Uploaden, groepsbeheer, melden en de andere acties komen in een volgende WP.
3. **Adres `app.clubalmanac.com`.** `clubalmanac.com` blijft zoals hij is, met de privacyverklaring waar App Store Connect naar linkt.
4. Kosten: ruim binnen €15 per maand (de hosting op AWS bestaat al, Clerk blijft gratis).
5. **Kaart op het web met OpenStreetMap** (bijvoorbeeld Leaflet), met dezelfde punten als de iPhone-kaart; tikken op een punt opent de foto. Alleen bekijken, met de bronvermelding die OpenStreetMap vraagt. Geen betaalde kaartdienst.
6. **Uitnodigingen op het web:** een bestaand lid accepteert of wijst een uitnodiging af in Profiel, zoals in de app. Een nieuw lid logt op het web in met het uitgenodigde adres en is dan meteen lid (WP19b, ongewijzigd).
7. **De uitnodigingsmail** krijgt naast de App Store-knop een regel voor wie geen iPhone heeft, met een link naar `app.clubalmanac.com`.

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
7. **Alleen lezen, op uitnodigingen na.** Behalve een uitnodiging accepteren of afwijzen staat op het web geen knop die iets wijzigt of die op het web niet werkt. Wat ontbreekt, is weg, geen knop met een foutmelding.
8. **Geen stille mislukking.** Een beeld of film die niet laadt, geeft een nette tegel of een NL-melding met opnieuw proberen, zoals in de app.
9. **Telefoon eerst.** Het werkt op een telefoonbreedte in Chrome op Android en in Safari, en ook op een laptop.
10. **Een nieuwe versie komt aan.** Na een deploy krijgt de browser de nieuwe versie, en blijft er geen oude versie in de cache hangen.

## Scope

- **In:** de web-build van de app; inloggen en uitloggen; Mijn groepen; Groep (albums per jaar, leden); album (raster, ongelezen-tellers); foto-detail met bladeren; Mijn foto's; Profiel (bekijken, uitloggen, uitnodigingen accepteren of afwijzen); de albumkaart (OpenStreetMap); de films; de info-pagina's; licht en donker. De web-link in de uitnodigingsmail. Hosting op `app.clubalmanac.com` met een deploy vanaf `main`, en een manier om de web-build lokaal tegen dev te draaien voor de gate.
- **Bewust niet:** uploaden en alle andere acties (foto-menu, selectie, draaien, verwijderen, covers, profielfoto, naam wijzigen); groepsbeheer en uitnodigen; melden, ideeën en problemen; account verwijderen; delen; een installeerbare webapp (PWA) of meldingen; de Android-app; locaties wijzigen.

## Open vragen voor A (rapporteren aan regie)

1. **Beelden in de browser.** Een `<img>` stuurt geen `Authorization`-header mee. Welke route houdt invariant 1 tot en met 3 overeind: de web-app haalt elk beeld met de header op en toont het uit het geheugen, of de backend geeft per verzoek een korte, ondertekende beeldlink, of iets anders? Weeg mee: invariant 2 (doorsturen), invariant 5 (gedeelde computer), het geheugen bij een album van 540 foto's, en de Convex-bandbreedte.
2. **CORS.** Welke paden hebben CORS nodig (beelden, `/upload` niet in deze WP), welke origins, en hoe staan de toegestane origins per deployment ingesteld (fail-loud als ze ontbreken)?
3. **Clerk in de browser.** Wat moet er in Clerk dev en prod veranderen (toegestane origins, domein, `authorizedParties` of iets vergelijkbaars in [`convex/auth.config.ts`](../../convex/auth.config.ts)), waar bewaart Clerk de sessie op het web, en hoe lang blijft iemand ingelogd?
4. **Inventaris.** Welke schermen en modules starten niet op het web of crashen? Per stuk: verbergen, een web-variant, of niets doen. Het iOS-actiemenu zit ook in schermen die alleen-lezen wel nodig hebben (bijvoorbeeld Profiel)?
5. **Films.** Speelt een ondertekende S3-link in de browser, inclusief spoelen, zonder CORS-wijziging op `blob-videos`?
6. **Kaart** (besluit 5). Welke bibliotheek en welke tegels, binnen het gebruiksbeleid van OpenStreetMap? Weegt de web-variant van het kaartscherm iets mee in de iOS-code?
7. **Uitnodigingen** (besluit 6 en 7). Werkt het aanmelden van een nieuw lid via Clerk op het web zoals in de app? Wat moet er in de mail (HTML en tekst, licht en donker) en komt het adres uit een env-var per deployment?
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
- **Gate door Wouter, eerst dev, in een echte browser** (laptop en telefoon, Android als het kan): inloggen met een code; groepen, albums en het album van 540 foto's (scrollen zonder fout); foto-detail en bladeren; Mijn foto's; Profiel; een film afspelen en spoelen; de albumkaart; een uitnodiging accepteren; een nieuw lid (wegwerpadres) aanmelden via de link in de mail; uitloggen en als een ander inloggen (geen beelden van de vorige); een beeldlink kopiëren naar een privévenster (werkt niet). Daarna een iOS-build in de simulator: niets veranderd.
- **Daarna prod:** deploy naar `app.clubalmanac.com`, dezelfde korte ronde, en `clubalmanac.com/privacy/nl` werkt nog.

---

## Spec-criticus aanvullingen (A vult in)

> A 2026-11-20. Bronnen: de nieuwe app (`app/`), `convex/http.ts`, de geïnstalleerde pakketten in `app/node_modules` (expo-image 58.0.18, @clerk/expo 4.16.1, expo-video 58.0.14, expo-secure-store 58.0.3), WP17a, WP19b/c, WP21, WP25, `infra/site.yml`. Oude code is hier geen bron (pariteit met de iPhone-app).

### Wat niet klopt of ontbreekt in de draft

1. **Invariant 3 botst met WP17a besluit 8.** Een profielfoto is nu al openbaar (`/beeld/profiel/<userId>`, ook uitgelogd). Advies: invariant 3 wordt *"geen nieuw openbaar beeld"*; de profielfoto blijft zoals hij is. Op het web toont een gewone `<img>` hem zonder CORS en zonder token. **Besluit Wouter (B2).**
2. **De webapp start nu niet.** `react-native-web` en `@expo/metro-runtime` staan niet in `app/package.json`, en `app.json` heeft geen `web`-blok. B voegt ze toe met `npx expo install` (versies passend bij SDK 58).
3. **Inloggen en uitloggen breken op het web.** `expo-secure-store` heeft op het web geen implementatie (de module is `{}`). `deviceClerkStorage` roept hem aan bij elke login (`resume`) en bij uitloggen (`wipe`). Gevolg: de login loopt vast, en na uitloggen staat "wissen mislukt". Op het web bewaart Clerk de sessie zelf in cookies; `tokenCache` en `__experimental_resourceCache` gebruikt `@clerk/expo` daar niet. Zie A-invariant W6.
4. **`Alert.alert` doet op het web niets** (react-native-web). De bevestigingen in `InvitesScreens` (uitnodiging afwijzen), `ProfileScreen` en `GroupScreen` wachten dan op een antwoord dat nooit komt: een stille mislukking (invariant 8). Afwijzen zit in scope.
5. **De Convex-client (`.convex.cloud`) laat elke origin toe.** Invariant 4 kan alleen voor de eigen http-paden (`.convex.site`) gelden. Wat de queries beschermt, is het Clerk-token, net als nu. Geen gat, wel goed om te weten bij de red-team.
6. **Een foto-URL in de browser hoort bij een id, niet bij een token.** De adressen van de webapp (bv. `/groep/<id>/album/<id>/foto/<id>`) belanden in de geschiedenis. Ze bevatten alleen id's, en elke read checkt de toegang. Een pagina-link in een privévenster geeft het inlogscherm.
7. **Kaart en privacy.** De kaarttegels komen van de servers van OpenStreetMap. Uit de gevraagde tegels is af te leiden waar de foto's ongeveer liggen, net zoals Apple dat nu met Apple Maps kan. Advies: één zin erbij in de privacyverklaring. **Besluit Wouter (B4).**
8. **De bestaande mail-tests zeggen "de App Store-link is de enige link".** Met besluit 7 komt er een tweede vaste link bij. A past de helpers aan (zonder de nieuwe env-var blijft alles zoals het was) en pint de web-link in een eigen testbestand.

### Vraag 1: beelden in de browser

Drie routes bekeken.

| | A. Ophalen met de header, tonen uit het geheugen | B. Korte ondertekende beeldlink | C. Cookie of service worker |
|---|---|---|---|
| Invariant 1 (toegang per verzoek) | Ongewijzigd: hetzelfde pad, dezelfde check | Lidmaatschap per verzoek wel (user-id in de handtekening), login niet: na uitloggen werkt de link nog tot hij verloopt | Cookie: `.convex.site` is een ander domein, Safari blokkeert die cookie. Een eigen domein voor Convex vraagt Pro. Service worker: kan, maar complex en lastig met invariant 10 |
| Invariant 2 (doorsturen) | Werkt nergens: de URL zonder header geeft 401, een `blob:`-link alleen in dat tabblad | Werkt bij een ander tot de link verloopt | — |
| Invariant 5 (gedeelde computer) | Niets op schijf (ophalen met `no-store`); het geheugen is weg bij uitloggen en herladen | Beelden in de schijfcache van de browser, onder een link die de app de volgende user niet geeft | — |
| Geheugen (album van 540) | *klein* is gemiddeld 35 kB: alles samen ~19 MB. Met een grens (A-invariant W3) blijft het ~10 MB | Regelt de browser zelf | — |
| Bandbreedte Convex | Elke nieuwe pagina-lading haalt de beelden opnieuw. 540 × 35 kB ≈ 19 MB per keer; 50 keer per maand ≈ 1 GB ≈ $0,13 | De browser cachet per link; minder verkeer | — |
| Nieuw in de backend | CORS op twee paden (met preflight per beeld, zie hieronder) | Een geheim per deployment, ondertekenen en controleren, een nieuw pad of parameter, verlooptijd. Niet in een gecachete query (`Date.now()`) | — |

**Advies: route A.** Hij laat de toegangsregel ongemoeid, zet geen bruikbaar geheim in een URL (ook niet kort), en er is geen nieuw geheim om te beheren of te red-teamen. De kosten (geheugen, bandbreedte) zijn klein bij ~20 leden. Route B is de terugval als het album van 540 in de gate te traag laadt. **Besluit Wouter (B1).**

Wat route A vraagt (gedrag, de vorm is aan B):
- **Niet de ingebouwde header-route van expo-image gebruiken.** `expo-image` haalt op het web een bron met `headers` al op met `fetch` en toont hem als `blob:`-URL (`build/web/hooks.js`, `useHeaders`). Maar: (a) hij haalt opnieuw op bij elk nieuw `source`-object, en `useTokenImageLoad` maakt er elke render een; (b) hij geeft de `blob:`-URL nooit vrij als het beeld verdwijnt, dus het geheugen groeit bij scrollen door 540 foto's; (c) hij haalt op met `cache: 'default'`, dus de bytes belanden op schijf. B maakt een web-variant van de beeldbron (bv. een `.web.tsx` naast `src/data/images.tsx`); het iOS-bestand blijft zoals het is (invariant 6).
- **Preflight.** De `Authorization`-header maakt elk beeldverzoek "niet eenvoudig": de browser vraagt eerst `OPTIONS`. Die preflight onthoudt de browser per URL, dus elk beeld kost de eerste keer twee verzoeken (twee function calls, bij ~20 leden ruim binnen de gratis laag). Is dat in de gate merkbaar traag, dan is de terugval route B, niet het token in de URL.
- **Een 401 is op het web te zien.** `fetch` geeft de status, dus de bestaande herhaling met een vers token (`src/lib/imageRetry.ts`, WP17a invariant 18) werkt gewoon. Daarvoor moet ook een 401 of 404 de CORS-header dragen (W1).

### Vraag 2: CORS

- **Paden:** `GET` en `OPTIONS` op `/beeld/foto/*` en `/beeld/uitnodiging/*`. Niet op `/beeld/profiel/*` (een `<img>` heeft geen CORS nodig), niet op `/upload` (niet in deze WP: zonder `OPTIONS` kan een browser niet uploaden), niet op de webhooks en `/_test/whoami`.
- **Origins per deployment** in een nieuwe env-var `CLUBALMANAC_WEB_ORIGINS`, komma-gescheiden. Prod: `https://app.clubalmanac.com`. Dev: `http://localhost:8081` (Expo web-dev). Alleen een exacte origin telt (schema, host, poort; geen pad, geen `/` aan het eind, geen `*`). Op prod (`CLUBALMANAC_STAGE=prod`) telt alleen `https://`.
- **Fail-loud zonder de iPhone te raken.** Ontbreekt de variabele, of staat er niets geldigs in, dan krijgt een verzoek uit de browser geen CORS-header (de browser blokkeert het), weigert de preflight, en logt de backend een fout met de naam van de variabele. Een verzoek zonder `Origin` (de iPhone-app) verandert niet.
- **Nooit `Access-Control-Allow-Credentials`**: er gaan geen cookies mee, alleen de header.

### Vraag 3: Clerk in de browser

- Op het web draait `@clerk/expo` als gewone Clerk in de browser (`standardBrowser`). De sessie staat in cookies van Clerk: op prod het `__client`-cookie op het Clerk-domein en een kort `__session`-token op `app.clubalmanac.com`; op dev de dev-browser van `picked-quail-97`. Uitloggen (`signOut`) haalt ze weg.
- **Hoe lang:** zoals de app, hooguit 7 dagen (Clerk Hobby, W8). Een tabblad sluiten logt niet uit. Op een gedeelde computer blijft de vorige ingelogd tot hij uitlogt. **Besluit Wouter (B5)**: accepteren, of op het web een korte regel op het inlogscherm ("Op een gedeelde computer: log uit als je klaar bent").
- **Convex:** `convex/auth.config.ts` blijft gelijk. Convex checkt issuer en `applicationID`; het token uit de browser heeft dezelfde issuer en dezelfde JWT-template `convex`. Een `authorizedParties`-check bestaat in Convex niet en is niet nodig.
- **Clerk-dashboard:** dev staat localhost toe. Prod: `app.clubalmanac.com` is een subdomein van het domein van de prod-instance; A verwacht geen satellite-domein. B controleert in het dashboard (Domains) of er iets aan moet en zet het in het runbook; de gate bewijst het. Bot sign-up protection blijft uit (WP19b besluit 3): met hem aan vraagt Clerk op het web een captcha-element dat de app niet heeft.

### Vraag 4: inventaris

| Onderdeel | Waar | Op het web | Wat |
|---|---|---|---|
| `expo-secure-store` | `deviceClerkStorage`, `lastGroup` | Geen implementatie: login en uitloggen breken | Web-variant: Clerk zonder eigen opslag; de thuisgroep alleen in het geheugen (niets in de browser bewaard) |
| `Alert.alert` (bevestigen) | Invites, Profiel, Groep | Doet niets, belofte blijft hangen | Web-variant van de bevestiging (bv. `window.confirm`), in elk geval voor afwijzen en uitloggen |
| `ActionSheetIOS` | PhotoMenu, Groep, Profiel (profielfoto), Locatie, Melden, Ideeën | Bestaat niet | De knoppen die het openen zijn acties: weg op het web (invariant 7) |
| `react-native-maps` | `AlbumMapScreen`, `LocationScreen` | Geen web; de import breekt de bundel | Web-variant van het kaartscherm (vraag 6); Locatie is buiten scope |
| Datumkiezer | `GroupAdminScreens` | Geen web | Buiten scope; de import mag de bundel niet breken |
| Delen (`expo-file-system`, `expo-sharing`) | `share.ts` | Deels | Buiten scope: knop weg |
| `expo-image-picker`, `expo-keep-awake` | Toevoegen, Profiel | Werkt deels | Buiten scope: knoppen weg |
| `Linking.openSettings` | Profiel | Bestaat niet | Hoort bij de profielfoto: weg |
| `expo-network` | `online.tsx` | Werkt via `navigator.onLine` | Niets; gate checkt de offline-melding |
| Haptics | `haptics.ts` | Dynamische import met `catch` | Niets |
| `expo-video`, reanimated, gesture-handler, svg | diverse | Werkt | Niets (expo-video: zie vraag 5) |
| Uitlog-wis | `wipeImageCache` | `clearMemoryCache`/`clearDiskCache` geven op het web `false` | De web-wis leegt het eigen beeldgeheugen (W3) |
| Routes buiten scope | `toevoegen`, `nieuwe-groep`, `bewerken`, `nieuw-album`, `nieuwe-uitnodiging`, `draaien`, `locatie`, `ideeen`, `doorgeven` | Zijn via de adresbalk te openen | Een nette NL-pagina zonder actie, geen crash (W8) |

Het actiemenu op Profiel hoort alleen bij de profielfoto; Uitloggen en Uitnodigingen gebruiken het niet. Alleen-lezen heeft het actiemenu dus nergens nodig.

### Vraag 5: films

Ja, zonder CORS-wijziging op `blob-videos`. Een `<video>` zonder `crossOrigin` laadt een andere origin zonder CORS, en spoelen gaat met range-verzoeken op dezelfde ondertekende link (de handtekening dekt de `Range`-header niet). Voorwaarden: geen `crossOrigin` zetten en `useAudioNodePlayback` uit laten (expo-video koppelt dan de video aan een AudioContext, en zonder CORS blijft het geluid stil). Alle tien films zijn H.264/AAC in MP4/M4V (WP21): Chrome en Safari spelen dat. De drie films zonder `faststart` starten trager. **Bekend:** op het web kan iemand met "Videoadres kopiëren" de link doorsturen; die werkt 3 uur (WP21 besluit 2, al geaccepteerd).

### Vraag 6: kaart

Leaflet (met `react-leaflet` of rechtstreeks), alleen in de web-variant van het kaartscherm, zodat het iOS-scherm en `react-native-maps` ongewijzigd blijven. Tegels van `tile.openstreetmap.org`: binnen het gebruiksbeleid bij dit volume, mits de bronvermelding "© OpenStreetMap-bijdragers" zichtbaar is met een link, de browser een `Referer` meestuurt (dus geen `Referrer-Policy: no-referrer` op de hosting; `strict-origin-when-cross-origin` volstaat), en er niets vooraf of in bulk geladen wordt. Dezelfde punten als iOS: de web-variant gebruikt dezelfde query en dezelfde pure logica; tikken op een punt opent de foto. Geen sleutel, geen kosten.

### Vraag 7: uitnodigingen

- **Aanmelden op het web** gaat via dezelfde Clerk-flow (`useEmailCodeLogin`, sign-in-or-up). De backend (WP19b) ziet geen verschil: de Clerk-webhook maakt de users-rij en zet het lidmaatschap. De gate bewijst het met een wegwerpadres.
- **De mail:** een regel onder de App Store-knop, in HTML en tekst, alleen in de uitnodiging (niet in accepted, declined, bounced). Voorstel tekst: *"Geen iPhone? Open Clubalmanac in je browser: app.clubalmanac.com"*, met de link. Licht en donker volgen de bestaande klassen van de mail-schil.
- **Het adres** komt uit een nieuwe env-var `CLUBALMANAC_WEB_URL` (niet het vervallen `CLUBALMANAC_APP_URL`, dat kan nog op een deployment staan). Geldig is alleen een `https://`-origin zonder pad of query. Ontbreekt hij of is hij ongeldig, dan gaat de mail zonder die regel en logt de action een fout met de naam (zoals de App Store-ID, WP19c). Op dev blijft hij leeg: er is geen gehoste dev-webapp.
- Nog steeds geen token en geen persoonlijke link (WP19b besluit 1): het is één vast adres.

### Vraag 8: hosting

Een nieuwe CloudFormation-stack `infra/webapp.yml`, naast `site.yml`, met:
- **Bucket** `clubalmanac-webapp`, privé, alleen leesbaar voor de nieuwe distributie (OAC), versies 30 dagen.
- **Distributie** met alternate domain `app.clubalmanac.com`. Het **certificaat** moet in `us-east-1` staan (eis van CloudFront); de stack draait in `eu-west-1`. Dus: of Wouter vraagt het certificaat met de hand aan in ACM `us-east-1` (DNS-validatie in Route 53) en geeft het ARN als parameter, of een tweede mini-stack in `us-east-1`. Advies: met de hand, één keer.
- **DNS:** een alias-record `app.clubalmanac.com` (A en AAAA) naar de distributie, in de stack met de hosted-zone-ID als parameter.
- **Herladen op een diep adres:** een CloudFront Function die een pad zonder bestandsextensie naar `/index.html` stuurt. Geen eigen foutpagina's die een ontbrekend bestand als 200 teruggeven.
- **Nieuwe versie komt aan (invariant 10):** `index.html` met `Cache-Control: no-cache`; de bundels (`/_expo/static/…`, met hash in de naam) lang en `immutable`. De deploy zet eerst de bundels, dan `index.html`, en leegt daarna `/index.html`. Oude bundels blijven een paar dagen staan, zodat een open tabblad niet breekt.
- **Headers** via een response-headers-policy: HSTS, `nosniff`, `frame-ancestors 'none'` (of `X-Frame-Options: DENY`), `Referrer-Policy: strict-origin-when-cross-origin`, `X-Robots-Tag: noindex`.
- **Deploy-rol** via OIDC, alleen vanaf `main`, alleen deze bucket en deze distributie; de bestaande OIDC-provider (parameter, zoals `site.yml`). Geen AWS-sleutels in GitHub. De build krijgt de publieke `EXPO_PUBLIC_CONVEX_URL` en `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` van prod als GitHub-variabelen.
- **Wanneer deployen.** De Convex-backend van prod zet Wouter met de hand. Een automatische web-deploy bij elke merge kan voorlopen op prod-Convex en dan stil breken. Advies: de workflow alleen met de hand starten (*Run workflow* op `main`), na de Convex-deploy. **Besluit Wouter (B3).**
- **Lokaal tegen dev voor de gate:** `npx expo start --web` in `app/` met `.env.local` (dev-waarden), op `http://localhost:8081`, de origin die op dev in `CLUBALMANAC_WEB_ORIGINS` staat.
- `clubalmanac.com` en zijn distributie worden niet aangeraakt.

### A-invarianten

**W1. CORS alleen voor de eigen origins, en ook op een weigering.**
- Een preflight (`OPTIONS`) op `/beeld/foto/*` of `/beeld/uitnodiging/*` van een toegestane origin geeft 204 met `Access-Control-Allow-Origin` gelijk aan die origin, `Access-Control-Allow-Methods` met `GET` en geen schrijvende methode, `Access-Control-Allow-Headers` met `Authorization`, een `Access-Control-Max-Age` en `Vary: Origin`. Nooit `*`, nooit `Allow-Credentials`.
- Van elke andere origin (een ander domein, `http://` in plaats van `https://`, een domein dat met het eigen begint, `null`): 403 zonder `Access-Control-Allow-Origin`.
- Een `GET` van een toegestane origin draagt die header bij élk antwoord: 200, 400, 401 en 404. De toegang verandert niet: lid 200, uitgelogd 401, niet-lid, ex-lid, onbekend en misvormd één en hetzelfde 404. `Vary` bevat `Origin` en `Authorization`.
- Een `GET` van een andere origin, of zonder `Origin` (de iPhone): geen `Access-Control-Allow-Origin`, verder hetzelfde antwoord als nu.

**W2. `CLUBALMANAC_WEB_ORIGINS`, fail-loud.** Komma-gescheiden exacte origins. Ontbreekt hij, is hij leeg, of is een waarde geen exacte origin (`*`, met pad, met `/` aan het eind, zonder schema), dan telt die waarde niet, en logt de backend bij een verzoek uit de browser een fout met de naam van de variabele. Op prod tellen alleen `https://`-origins. De iPhone merkt er niets van.

**W3. Geen token in een URL, niets op schijf, begrensd geheugen.**
- Geen beeld-URL van de app bevat het token of een ander geheim. Een `?token=…` of iets dergelijks op het beeldpad zonder header geeft 401.
- Op het web haalt de app een foto of uitnodigingscover op met de header en zonder de HTTP-cache (`no-store`), en houdt hem in een eigen geheugen met een grens. Bij de grens gaat het langst niet gebruikte beeld eruit, en wordt zijn `blob:`-URL vrijgegeven. De sleutel bevat de user, zodat een volgende user op dezelfde browser nooit een beeld van de vorige krijgt, ook niet als het wissen mislukte. Uitloggen leegt het geheugen en geeft alle URL's vrij.

**W4. Web-link in de uitnodigingsmail** (besluit 7): zie vraag 7. Met een geldige `CLUBALMANAC_WEB_URL` staat precies dat adres in HTML en tekst van de uitnodiging, naast de App Store-link; niet in de andere mails; zonder token of invite-id. Zonder geldige waarde: geen web-link, de mail gaat, een fout in de log met de naam.

**W5. Alleen lezen op het web.** Geen knop of menu dat iets wijzigt, behalve een uitnodiging accepteren of afwijzen en uitloggen. Een route buiten scope geeft via de adresbalk een NL-pagina zonder actie, geen crash en geen lege pagina.

**W6. Inloggen en uitloggen op het web.** Zonder `expo-secure-store`. Uitloggen beëindigt de Clerk-sessie in die browser, leegt het beeldgeheugen (W3) en toont het inlogscherm; geen "wissen mislukt". Een volgende login op dezelfde browser ziet niets van de vorige user, ook niet de thuisgroep (die blijft op het web alleen in het geheugen).

**W7. Bevestigen werkt op het web.** Elke bevestiging in scope (uitnodiging afwijzen, uitloggen als die bevestigt) toont op het web een vraag en gaat door of stopt; hij blijft nooit hangen.

**W8. iOS gelijk.** Web-varianten staan in eigen bestanden of achter een platformcheck; het iOS-gedrag en de iOS-bestanden van beeld, kaart en opslag blijven gelijk. De hele testsuite (root en `app/`) blijft groen, en de bestaande beeld-, toegang- en mailtests veranderen alleen waar deze spec het zegt.

### Tests (A)

| Bestand | Wat |
|---|---|
| `tests/http/webCors.test.ts` (nieuw) | W1, W2: preflight en `GET` op foto en uitnodiging, toegestane en andere origins, weigeringen met de header, ex-lid, iPhone zonder `Origin` ongewijzigd, env ontbreekt of ongeldig (log met de naam), prod alleen `https`; W3: token in de query geeft 401 |
| `tests/images/httpRoute.test.ts` (aangepast) | Routelijst: plus `OPTIONS` op de twee beeldpaden, niet op profiel, `/upload` en de rest |
| `tests/invites/inviteMailWeb.test.ts` (nieuw) | W4 |
| `tests/invites/_wp19c.ts`, `inviteMailNoLink.test.ts` (aangepast) | Zetten `CLUBALMANAC_WEB_URL` uit, zodat "alleen de App Store-link" en "geen link" blijven gelden |
| `app/tests/webImageMemory.test.ts` (nieuw) | W3: het begrensde geheugen (nieuwe pure module `app/src/lib/imageMemory.ts`) en de sleutel per user; de beeld-URL's zonder token |

Niet in unit-tests (gate): W5, W6, W7, de kaart, de films, de hosting, invariant 9 en 10.

### Besluiten voor Wouter

- **B1.** Beelden in de browser: route A (ophalen met de header, tonen uit het geheugen; advies) of route B (korte ondertekende link, met welke duur)?
- **B2.** Invariant 3: de profielfoto blijft openbaar zoals in WP17a besluit 8 (advies), of moet hij op het web achter de login?
- **B3.** Web-deploy: alleen met de hand vanaf `main`, na de Convex-deploy (advies), of automatisch bij elke merge zoals `clubalmanac.com`?
- **B4.** Privacyverklaring: een zin over de kaart van OpenStreetMap (en de cookies van Clerk op het web) erbij (advies)?
- **B5.** Gedeelde computer: alleen de 7 dagen van Clerk accepteren, of ook een regel op het inlogscherm van het web (advies)?
- Tekst van de mailregel (vraag 7): het voorstel, of een eigen tekst.

### Besluiten Wouter na A (2026-11-20)

Alle adviezen van A overgenomen:

- **B1:** route A. Beelden op het web met de header ophalen en uit een begrensd geheugen tonen (W3). Terugval naar een korte ondertekende link alleen als het album van 540 in de gate te traag laadt; dat is dan een nieuw besluit.
- **B2:** invariant 3 wordt *"geen nieuw openbaar beeld"*. De profielfoto blijft openbaar (WP17a besluit 8).
- **B3:** de web-deploy start met de hand (*Run workflow* op `main`), na de Convex-deploy.
- **B4:** de privacyverklaring krijgt een zin over de kaart van OpenStreetMap en de inlogcookies van Clerk op het web. Daarna `node scripts/site/build.mjs` en `site/` meecommitten ([`site/README.md`](../../site/README.md)).
- **B5:** het inlogscherm op het web krijgt de regel *"Op een gedeelde computer: log uit als je klaar bent."* Sessieduur blijft 7 dagen (Clerk).
- **Mailregel:** *"Geen iPhone? Open Clubalmanac in je browser: app.clubalmanac.com"*, met de link.
- **Certificaat:** Wouter vraagt het met de hand aan in ACM `us-east-1` en geeft het ARN als parameter aan `infra/webapp.yml`.
