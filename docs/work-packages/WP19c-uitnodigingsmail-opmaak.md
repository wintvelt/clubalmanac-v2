# WP19c: uitnodigingsmail met opmaak en groepsfoto

> Draft regie 2026-11-14. Backend-WP (mail), plus één app-wijziging (besluit 4: cover op de uitnodigingskaart rechtop). A → B → audit → gate op dev met een echte mail en de kaart in de app. Eigen branch `wp19c`.

## Besluiten Wouter

1. **Groepsfoto en opmaak in de uitnodigingsmail (2026-11-14).** De oude uitnodigingsmail had opmaak en de groepsfoto. WP5 nam alleen de tekst over; in WP19b zag A de groepsfoto in v1, maar dat werd geen vraag. Wouter: nu oppakken.
2. **De foto zit in de mail zelf, niet achter een link.** Een link naar een beeld werkt voor iedereen die de mail doorgestuurd krijgt en botst met WP19b besluit 1 (geen link, geen token). 
3. **De App Store-link gaat mee (2026-11-14).** Een vaste link naar de app in de App Store, voor iPhone. Geen persoonlijke link en geen token, dus geen botsing met WP19b besluit 1. De Apple ID van de app is `1663038609` (Wouter, 2026-11-14; openbaar, geen geheim). De link is `https://apps.apple.com/app/id1663038609`.
4. **De cover op de uitnodigingskaart in de app staat ook rechtop (2026-11-14, na A).** A vond dat de kaart uit WP19b (`InviteCover`) de cover zonder `exifOrientation` toont, zodat een gedraaide foto op zijn kant ligt. Wouter: meenemen in WP19c.
5. **De groepsfoto staat één keer in de mail, ook in iPhone Mail (2026-11-14, na de gate).** Bij de gate toonde iPhone Mail de foto twee keer: in de tekst en nog eens onderaan. De ruwe mail is `multipart/mixed` met `multipart/alternative` (tekst + HTML) en daarnaast de foto. Zo bouwt Mailjet's Send API v3.1 een mail met `InlinedAttachments`. Gmail kijkt erdoorheen, Apple Mail niet. De foto hoort met de HTML samen in een `multipart/related` te zitten. Wouter: oplossen in WP19c. Richting: de mail zelf opbouwen en via Mailjet's SMTP-ingang versturen (`in-v3.mailjet.com`, met dezelfde API-key en -secret, dus geen nieuwe env-vars). Wat er blijft: één entrypoint `sendInviteEmail`, de sender-check, de fail-loud bij ontbrekende credentials, de Mailjet-events (bounce) en de terugval zonder foto. Geldt voor alle mails die via `lib/mailjet.ts` gaan, of alleen de uitnodiging: aan A.
6. **Mailjet volgt de ontvanger niet (2026-11-14, na de gate).** De gate-mail bevatte een meetpixel van Mailjet (`mjt.lu/oo/…`) en alle links liepen via `mjt.lu/lnk/…`. Dat staat aan op het Mailjet-account. Wouter: uit, voor elke mail die we versturen. De App Store-link gaat dus rechtstreeks naar `apps.apple.com`. Hoe (per bericht of in het dashboard): aan A; per bericht heeft de voorkeur, dan staat het in de code en niet alleen in een instelling.

## Productdoel

Wie een uitnodiging krijgt, ziet in de mail meteen van welke groep: de groepsfoto bovenaan en een verzorgde opmaak in de stijl van de app. De tekst blijft wat hij nu is (WP19b): geen persoonlijke link, geen token, wel naam, bericht, inlogadres en geldig tot. Nieuw is één vaste link naar de app in de App Store.

## Invarianten

1. **De groepsfoto zit als bijlage in de mail** (inline, met een content-id). Er staat geen URL naar een beeld van Convex in de mail, en geen token.
2. **Alleen een cover die de genodigde in de app ook zou zien.** Dezelfde regel als het beeldpad van WP19b (A-invariant 15): de cover van de groep van de uitnodiging, en alleen als die foto in een album van die groep staat. Anders geen foto in de mail; de mail blijft verder gelijk.
3. **Formaat *klein*** (WP25), nooit het origineel. Ontbreekt *klein*, dan geen foto (niet terugvallen op het origineel).
4. **Geen GPS of andere metadata** in de bijlage (WP17d: wat de backend geeft, bevat geen GPS).
5. **De mail gaat ook zonder foto weg.** Lukt het ophalen van het beeld niet, dan gaat de mail zonder foto; de uitnodiging faalt niet.
6. **Opmaak in de stijl van de app** (`docs/design.md`): kleuren, lettertype-fallback, één kolom, leesbaar in licht en donker. Tekst-versie (`textPart`) blijft compleet zonder beeld.
7. **HTML-veilig** zoals nu: naam, bericht en groepsnaam ge-escaped.
8. **App Store-link.** De mail bevat een vaste link naar de app in de App Store (`https://apps.apple.com/app/id<Apple ID>`), met de tekst dat die voor een iPhone is. Geen andere links. De link werkt pas als de app bij T0 weer te koop is; tot dan toont Apple "niet beschikbaar". Waar de Apple ID staat (constante of env-var) is aan A en B; ontbreekt hij, dan gaat de mail zonder link weg en niet stil fout.

## Edge cases + scope-uitsluitingen

- Groep zonder cover, of cover niet in een album van de groep: mail zonder foto.
- Uitnodiging ingetrokken voordat de mail wegging: geen mail (zoals nu).
- **Buiten scope:** de andere mails (geaccepteerd, afgewezen, bounce, melden) tenzij A adviseert dezelfde basisopmaak mee te nemen (open vraag 3), en de afmeldmelding van iPhone Mail (vervallen, WP19b).

## Risico-assessment

- **Security/privacy: medium.** Een groepsfoto gaat naar een adres dat de admin intypt. Dat deed v1 ook; de regel van invariant 2 houdt het smal. Geen openbare URL.
- **Ops: medium.** Mailjet faalt stil (known issue); grotere mails, spamfilters. Grootte bewaken.
- **Externe deps: laag-medium.** Mailjet inline-bijlagen in Send API v3.1.
- **Multi-user/concurrency: laag.**
- **Data/schema: geen.**

## Open vragen voor A

1. **Hoe zag de oude uitnodigingsmail eruit?** Opmaak, plaats en grootte van de groepsfoto, en hoe v1 de foto meestuurde (bijlage of link).
2. **Mailjet inline-bijlage:** veldnamen en grenzen in Send API v3.1 (check de actuele docs). Hoe groot wordt een mail met *klein*?
3. **Basisopmaak voor alle mails?** Advies: één gedeelde HTML-schil voor alle mails van Mailjet, of alleen de uitnodiging?
4. **App Store-link:** had de oude mail een link naar de App Store of naar een store-pagina? Zo ja, welke tekst.

## Werkvolgorde

1. Regie: deze draft.
2. A: oude mail bekijken, open vragen, A-invarianten, RED tests. Stop bij een productvraag.
3. B: implementatie.
4. Audit.
5. Gate op dev: een uitnodiging naar Wouters `+clerk_test`-adres voor Blob bibliotheek (cover in album) en voor een groep zonder geschikte cover. Mail in iPhone Mail en Gmail bekijken, licht en donker. In Gmail donker letten op de oranje knop en de grijze berichtstreep: Gmail kleurt zelf om. Daarna in de app (simulator), als genodigde in Profiel → Uitnodigingen: staat de cover op de kaart rechtop, voor een groep met cover in stand 6 en een groep met cover zonder stand?

## Spec-criticus aanvullingen (A, 2026-11-14)

Bronnen: v1 `blob-images-api-groups/handlersGroup/sendInvite.js`, `emails/invite.js`, `blob-images-common/core/email.js` en `core/ses.js`. Huidig: `convex/invites.ts` (`sendInviteEmail`), `lib/emailTemplates.ts`, `lib/mailjet.ts`, `images.ts` (`inviteCoverInFormat`), `photoFormats.ts`, `docs/design.md`, `app/src/screens/InvitesScreens.tsx` en `GroupParts.tsx`. Mailjet: dev.mailjet.com, "Send with attached files" (v3.1).

### Kernvondsten

1. **v1 stuurde de foto als openbare URL**, niet als bijlage: `img.clubalmanac.com/<base64 van bucket+key>`, bijgesneden tot 640×200. Wie de mail had, had de foto, ook doorgestuurd. Besluit 2 sluit dat uit.
2. ***Klein* staat niet rechtop.** Een formaat bevat de ruwe pixels zonder oriëntatie-tag (WP25 invariant 18). De app draait met `photos.exifOrientation`, ook na draaien (WP8). Een mailclient weet dat niet. Zonder ingreep staat een cover met stand 6 in de mail op zijn kant.
3. **Hetzelfde zit in WP19b, in de app.** `InviteCover` (Profiel → Uitnodigingen) toont *klein* zonder stand; `listReceived` geeft geen stand mee. Leden zien de cover wel rechtop (`GroupParts`). Besluit 4: in scope, A-invariant 12.
4. **De test "geen link" van WP19b blijft waar zonder Apple ID.** Met de App Store-link wordt de regel: geen link, behalve die ene.
5. **`app/eas.json` heeft al een `ascAppId`:** `1663038609`. Wouter bevestigt dat dit de Apple ID voor de link is (besluit 3).

### Antwoorden open vragen

1. **De oude mail.** HTML in tabellen en divs, met deze opbouw:
   - een paarse achtergrond (`#312e81`) met een wit vlak van max 635 px en Verdana;
   - bovenaan het logo als beeld (gehost);
   - daaronder de groepsfoto over de volle breedte, 640×200 bijgesneden, met een link naar de uitnodiging;
   - "Hi {naam}" groot en vet, dan "{afzender} nodigt je uit om lid te worden van **{groep}**", het bericht tussen twee sierstreepjes (beeld), en een oranje knop "Bekijk uitnodiging" met de link er nog eens onder als tekst;
   - "geldig tot", "We zien je graag terug", een handtekening als beeld;
   - een voet met © en links naar "over ons", privacy en voorwaarden.

   Zonder groepsfoto stond er een uitnodigingsicoon. De tekstversie was drie regels met de link. Alle beelden waren URL's; er was geen bijlage.
2. **Mailjet v3.1.**
   - Het veld is `InlinedAttachments: [{ ContentType, Filename, ContentID, Base64Content }]`.
   - In de HTML staat `<img src="cid:<ContentID>">`. `ContentID` is optioneel; zonder werkt `cid:<Filename>`. Mailjet controleert niet of hij uniek is.
   - Grens: bijlagen samen niet boven 15 MB.
   - Grootte met *klein*: gemiddeld 35 kB, max 71 kB (WP25-meting); in base64 ongeveer 47 kB, max 95 kB. De HTML blijft ver onder de 102 kB waarboven Gmail de mail afkapt; een bijlage telt daar niet mee.
3. **Basisopmaak voor alle mails.** Advies: één gedeelde HTML-schil (A-invariant 6), maar in WP19c alleen voor de uitnodiging, zoals de draft zegt.
   - De andere mails naar leden (geaccepteerd, afgewezen, bounce, melding afgewezen) kunnen hem later in één kleine stap krijgen.
   - Mails naar de webmaster (probleem, monitor, account verwijderen) blijven kale tekst.
   - Geen productvraag: de scope blijft zoals hij is.
4. **App Store-link in v1:** nee. Er stond nergens een link naar een store, in geen enkele mail en niet in de backend-repos. De enige link was de knop "Bekijk uitnodiging" naar de webapp. De tekst voor de nieuwe link is een A-keuze (A-invariant 9).

### A-invarianten

Aanvulling op invariant 1–8 hierboven. Het entrypoint blijft `internal.invites.sendInviteEmail({ kind, inviteId })`.

1. **Precies één bijlage, alleen in de uitnodiging.** Met foto bevat het bericht één `InlinedAttachments`-item: `image/jpeg`, met een `ContentID`. De HTML verwijst er precies één keer naar met `cid:`. Zonder foto is er geen bijlage, geen `<img>` en geen `cid:`. Er komt nooit een gewone `Attachments`-bijlage. De mails "geaccepteerd", "afgewezen" en "bounce" krijgen nooit een bijlage, ook niet als de groep een cover heeft.
2. **Niets verwijst naar de foto of de opslag.**
   - Geen foto-id, storage-id of token in de mail of in de bestandsnaam.
   - Geen `convex.cloud`, `convex.site` of `/beeld/`.
   - De bestandsnaam is vast (bv. `groepsfoto.jpg`), zonder groepsnaam.
3. **Welke foto (invariant 2 en 3).** Alleen de cover van de groep van de uitnodiging, en alleen als die foto in een album van die groep staat. Dan *klein*. In deze gevallen is er geen foto:
   - de groep heeft geen cover;
   - de cover staat alleen in een album van een andere groep, of in geen album;
   - de foto heeft geen formaten;
   - het object van *klein* is weg.

   Nooit het origineel en nooit *groot*.
4. **Rechtop.** De bijlage toont de foto zoals een lid hem in de app ziet: `exifOrientation` (1–8, of leeg) is in de pixels toegepast. De bijlage bevat geen oriëntatie-tag, dus een mailclient draait niet nog een keer.
5. **Alleen pixels (invariant 4).** De bijlage is een JPEG die te decoderen is, zonder APP1 (EXIF of XMP), zonder GPS en zonder IPTC. Dat geldt ook als *klein* er tegen de regels in wel metadata in had.
6. **Grootte.** De bijlage is hoogstens 200 kB (ruim boven de gemeten max van 71 kB). Is hij groter, dan gaat de mail zonder foto. De breedte is hoogstens 512 px, en de foto wordt nooit vergroot. In de HTML staat `width` gelijk aan die breedte, met `max-width:100%`.
7. **De mail gaat altijd (invariant 5).** Kan *klein* niet gelezen of verwerkt worden (geen beeld, kapotte bytes), dan gaat de mail zonder foto, met dezelfde tekst. Er komt geen fout uit de action, en er gaat precies één mail weg.
8. **Opmaak (invariant 6).**
   - Een volledig HTML-document met `lang="nl"`, utf-8 en viewport.
   - Licht en donker: `<meta name="color-scheme" content="light dark">`, en een `@media (prefers-color-scheme: dark)`-blok met de donkere tokens.
   - De tokens uit design.md §2: `bg`, `surface`, `text`, `muted`, `cta` en `onCta`, licht en donker.
   - De systeemletter (`-apple-system` met een sans-serif als terugval). Geen webfont, `<link>`, `<script>`, `@import` of `url(`.
   - Eén kolom, max 560–640 px breed. Elk `<img>` is een `cid:`.
   - De HTML blijft onder 100 kB, ook met een bericht van 1000 tekens.
9. **App Store-link (invariant 8).**
   - De bron is de env-var `CLUBALMANAC_APP_STORE_ID`. Hij geldt alleen als hij uit 6 tot 12 cijfers bestaat.
   - Met een geldige ID staat de URL `https://apps.apple.com/app/id<ID>` in HTML en tekst. In de HTML is dat de enige `<a href>` en de enige http(s)-URL, als knop in `cta`. De tekst zegt dat hij voor een iPhone is.
   - Zonder ID, met een lege of een ongeldige ID: de mail gaat zonder link en zonder `<a>`. Er komt een `console.error` met de naam van de env-var, en geen exception.
   - De andere mails krijgen de link niet.
10. **De tekstversie is compleet.** Zij bevat dezelfde inhoud als de HTML: aanhef, afzender, groep, bericht, inlogadres, geldig tot en de App Store-URL (als die er is). Geen `cid:`, geen HTML-tags en geen verwijzing naar een beeld.
11. **HTML-veilig (invariant 7)**, ook in attributen: groepsnaam, afzender, genodigde en bericht zijn ge-escaped, ook in de `alt` van de foto (`Groepsfoto van {groep}`). Regeleinden in het bericht worden `<br>` in de HTML.
12. **De cover op de uitnodigingskaart staat rechtop (besluit 4).**
    - `invites.listReceived` geeft bij de groep `coverOrientation`: de `exifOrientation` van de cover (1–8). Dezelfde rij en dezelfde waarde die een lid krijgt.
    - Alleen als `hasCover` true is en de cover een stand heeft. Anders ontbreekt het veld. Een cover die niet in een album van de groep staat, verraadt zo ook zijn stand niet.
    - De whitelist groeit met precies dit ene veld. Er gaat geen foto-id, storage-id, maat, datum, plek of `hasFormats` mee naar buiten (WP19b A-invariant 15).
    - Draait een lid de cover (WP8), dan volgt `listReceived` reactief.
    - In de app draait de kaart (`InviteCover`) het beeld met die stand, met dezelfde transform als `PhotoImage` (`orientationTransform`). Zonder stand, of met stand 1, draait hij niet. Het beeld blijft alleen in het geheugen (WP19b A-invariant 15).
    - Rest-risico, hetzelfde als elders in de app: een cover zonder formaten komt als origineel met de tag in het bestand. Op prod hebben alle foto's na de backfill formaten (WP25).

### A-keuzes

1. **De foto staat bovenaan, heel en niet bijgesneden.** v1 sneed bij tot 640×200, maar dan valt bij een staande foto het belangrijkste weg. *Klein* is max 512 px; hij staat op zijn eigen breedte, met afronding 16 (design.md §4, groepsfoto).
2. **Geen logo en geen andere beelden.** Bovenaan staat "Clubalmanac" als tekst. Een tweede bijlage voor het logo maakt de mail groter, en een gehost logo is een URL. De handtekening is tekst, zoals nu.
3. **Geen voet met links.** "Over ons", privacy en voorwaarden van v1 vervallen: er mag maar één link in.
4. **Env-var in plaats van constante.** Invariant 8 kent een ontbrekende ID, en dat kan dan ook echt. Dev en prod krijgen dezelfde waarde, `1663038609`. Nadeel: één env-var extra op prod (§Ops). Omdat de ID openbaar is, kan een constante ook; dan vervalt het geval "ontbreekt".
5. **Tekst van de link:** "Heb je een iPhone? Installeer Clubalmanac uit de App Store." met de knop "Naar de App Store". Wouter ziet hem bij de gate.

### Ops-runbook-impact

- **Wouter, na de merge:** `npx convex env set CLUBALMANAC_APP_STORE_ID 1663038609` op dev. Op prod met `--prod`, vóór T0 in de lijst met prod env-vars van `migratie-status.md`.
- **B's commit:** de env-var in de tabel van `external-services.md` (Mailjet-sectie), met wat er gebeurt als hij ontbreekt.
- **Gate:** zie §Werkvolgorde stap 5. Extra:
  - een cover met stand 6 (rechtop in de mail?);
  - één mail zonder env-var (geen link, wel een log).

### Voor B

Namen die de tests gebruiken. Het gedrag staat in de A-invarianten.

- Besluit 5 en 6: zie §Besluit 5 en 6 (A) hieronder. `inlinedAttachments` op de Send API is daarna niet meer nodig; de tests pinnen het niet.
- `internal.invites.sendInviteEmail({ kind, inviteId })` blijft het entrypoint. De cover-regel is dezelfde als in `images.inviteCoverInFormat`, maar zonder identity: de action heeft geen caller.
- Rechtop zetten en metadata weghalen vraagt een beeldbibliotheek. sharp staat al in de Node-runtime (WP25, `externalPackages`). Waar dat draait, is aan B. Een tweede (Node-)action mag, als `sendInviteEmail` het entrypoint blijft.
- De env-var heet `CLUBALMANAC_APP_STORE_ID`.
- De vorm van `inviteTemplate` en van de schil is aan B. De tests lezen alleen de Mailjet-payload.
- **Besluit 4, backend:** `receivedGroupFields`/`inviteReceived` (`lib/shapes.ts`): `group` krijgt `coverOrientation: v.optional(v.number())`.
- **Besluit 4, app:** `InviteCover` verhuist naar `app/src/components/InviteCover.tsx`. Daar exporteert hij `InviteCover({ inviteId: string; name: string; exifOrientation?: number })`, met `useInviteCoverLoad` uit `../data/images` zoals nu. `InvitesScreens.tsx` geeft `exifOrientation={… coverOrientation}` door. De draaiing gaat via `orientationTransform` uit `lib/photos`; de vorm van het vak is aan B.

### RED tests

Stand bij A's commit: backend 29 rood, 2587 groen, 1 overgeslagen. De rode tests falen om de juiste reden: er is geen bijlage, geen opmaak, geen link en geen log. De gevallen zonder foto en met kapotte bytes zijn al groen; zij pinnen wat moet blijven. `npm run typecheck` heeft één fout, `inlinedAttachments` op `MailjetMessage`, tot B die toevoegt. Opzet in `tests/invites/_wp19c.ts`.

Na besluit 4: backend 36 rood (29 + 7 voor A-invariant 12), 2589 groen. App 8 rood, 1336 groen. De rode tests falen omdat `coverOrientation` ontbreekt en `components/InviteCover.tsx` nog niet bestaat. De app-typecheck heeft daardoor één fout (de module). Tegen een tijdelijke minimale component (niet gecommit) worden de 6 render-tests groen; de harness werkt dus. De tests gebruiken de echte Apple ID, `1663038609`.

| Bestand | Wat |
|---|---|
| `tests/invites/inviteMailPhoto.test.ts` (Node, echte sharp) | A-invariant 1–7: bijlage en `cid:`, welke foto (5 gevallen zonder foto), *klein* en niet het origineel, rechtop (stand 1, 3, 6, 8, leeg), geen metadata of GPS, grootte en breedte, kapotte bytes, de andere mails zonder bijlage |
| `tests/invites/inviteMailLayout.test.ts` | A-invariant 8, 10, 11: document, licht en donker, tokens, letter, geen externe bronnen, één kolom, grootte, tekstversie, escaping, regeleinden |
| `tests/invites/inviteMailAppStore.test.ts` | A-invariant 9: de link `https://apps.apple.com/app/id1663038609`, de enige link, iPhone; zonder, leeg of ongeldig: geen link, wel een log; niet in de andere mails |
| `tests/email/mailjetClient.test.ts` | Send API: geen bijlage-sleutels; `TrackOpens`/`TrackClicks` "disabled" (besluit 6) |
| `tests/invites/inviteMailNoLink.test.ts` | aangepast: de env-var staat uit, dus "geen link" blijft gelden |
| `tests/invites/listReceivedOrientation.test.ts` | A-invariant 12: `coverOrientation` met en zonder stand, niet bij een cover buiten het album of zonder cover, reactief na draaien, geen foto-velden |
| `tests/readWhitelist/_world.ts`, `invites.test.ts`; `tests/invites/listReceived.test.ts` | WP23-whitelist: `receivedGroup` met `coverOrientation` (pBob heeft stand 6) |
| `app/tests/inviteCover.test.ts` | A-invariant 12, app: dezelfde transform als `PhotoImage` voor stand 2, 3, 6 en 8; geen draaiing zonder stand; `InvitesScreens` geeft `coverOrientation` door |

### Besluit 5 en 6 (A, 2026-11-14, na de gate)

Bronnen: de gate-mail (`scripts/.data/wp19c-mail1.eml`); Mailjet `smtp-relay/configuration`, `smtp-relay/custom-headers`, `send-api-v31/send-api-errors` en `add-email-headers`; `convex/http.ts` en `invites.handleBounce`.

**Vondsten**

- **De gate-mail** is `multipart/mixed` [`multipart/alternative` [tekst, HTML], `image/jpeg`]. Apple Mail toont een deel naast de alternative als bijlage onderaan: de foto twee keer. De Send API v3.1 neemt geen eigen MIME aan; de SMTP-ingang wel.
- **Tracking kan per bericht uit.**
  - Send API v3.1: `TrackOpens` en `TrackClicks` met `"disabled"`.
  - SMTP: `X-Mailjet-TrackOpen: 0` en `X-Mailjet-TrackClick: 0`. Volgens de docs gaat dat boven de instelling van het account.
  - Het staat dus in de code; het dashboard hoeft niet.
- **De bounce-koppeling verandert niet.** We gebruiken geen `CustomID` of `EventPayload`.
  - `handleBounce` zoekt op het adres van de ontvanger (`email` in het event) en ontdubbelt op `MessageID`.
  - De Event API geldt per account, voor de Send API en SMTP gelijk. Mailjet zet bij SMTP zijn eigen Return-Path (in de gate-mail `…bnc3.mailjet.com`), dus de bounce komt via Mailjet bij ons.
  - `X-MJ-CustomID` met een id zou alleen een id in de mail brengen (A-invariant 2).
- **Afmeldlink van Mailjet.** Mailjet zet zelf een `List-Unsubscribe` met een `mjt.lu`-link in de kop. Dat is geen tracking, maar wie erop klikt, krijgt van Mailjet geen mail meer. De volgende mail aan dat adres wordt `blocked`, en `handleBounce` zet de uitnodiging dan op verlopen. Buiten scope: geaccepteerd known issue 1 in `external-services.md` (Mailjet), Wouter 2026-11-14 ("afmeld gedoe laat maar zitten").

**A-keuzes**

6. **Alleen een mail met inline-foto gaat via SMTP**, in de praktijk de uitnodiging met groepsfoto. Al het andere blijft op de Send API, ook de uitnodiging zonder foto.
   - Alleen die mail heeft een `multipart/related` nodig.
   - SMTP vanuit Convex is nog niet bewezen (zie risico), en zo staan de andere mails daar los van.
   - Tracking gaat op beide wegen uit, voor elke mail.
7. **Terugval: als SMTP faalt** (verbinding, login, time-out of weigering), gaat dezelfde uitnodiging zonder foto via de Send API, met een `console.error` die SMTP noemt.
   - Geen terugval bij ontbrekende credentials of een niet-geverifieerde sender: die gooien zoals nu, vóór elke verzending.
   - Rest-risico: een time-out nadat Mailjet de mail al aannam, geeft twee mails (met en zonder foto). Klein en onschadelijk.
8. **De MIME:** `multipart/alternative` [`text/plain`, `multipart/related` [`text/html`, `image/jpeg`]]. Dat bouwt nodemailer zelf met `attachments: [{ cid }]`.
9. **nodemailer als SMTP-client.** Gangbaar en puur JS. De tests mocken `createTransport` en laten nodemailer's eigen `streamTransport` de MIME bouwen (`tests/invites/_smtp.ts`). Of B de MIME zelf bouwt (`raw`) of nodemailer laat bouwen, maakt voor de tests niet uit.

**A-invarianten 13–18**

13. **SMTP:** host `in-v3.mailjet.com`, poort 587, `secure: false` met `requireTLS: true`, anders gaan key en secret onversleuteld over de lijn.
    - Login: `MAILJET_API_KEY` en `MAILJET_API_SECRET`. Geen nieuwe env-vars.
    - `connectionTimeout`, `greetingTimeout` en `socketTimeout` elk hoogstens 30 s, zodat de terugval binnen de action valt.
    - Envelop van `invites@`, alleen aan de genodigde; geen Cc of Bcc.
14. **De MIME** zoals A-keuze 8.
    - Nergens `multipart/mixed`, en precies één beeld: inline, base64, `Content-ID: <groepsfoto>`, en de HTML verwijst er één keer naar.
    - Tekst en HTML in UTF-8.
    - A-invariant 1–11 gelden voor beide wegen (`mailFor` in `_wp19c.ts` leest API en SMTP in dezelfde vorm).
15. **Geen tracking:**
    - SMTP: de twee `X-Mailjet-Track…`-koppen op `0`.
    - Send API: `TrackOpens` en `TrackClicks` op `"disabled"` bij elk bericht, ook naar `info@`.
    - Geen `X-MJ-CustomID` of `X-MJ-EventPayload`, en geen id, token of Convex-host in de ruwe mail.
16. **Zonder foto:** de Send API, zonder bijlage. Faalt SMTP: de terugval van A-keuze 7.
17. **Sender-check en credentials vóór elke verzending, ook op SMTP.** Ontbreekt er iets, dan `MAILJET_CREDS_MISSING` of `UNVERIFIED_SENDER`, er gaat niets weg en er is geen terugval.
18. **De bounce blijft gekoppeld:** een `bounce`-event met het adres van de genodigde en een `MessageID` zet de uitnodiging op verlopen. `http.ts` en `handleBounce` veranderen niet.

**Convex en SMTP**

- **Waar het draait:** SMTP vraagt `node:net`/`tls`, dus een `"use node"`-module. `lib/mailjet.ts` wordt ook geïmporteerd door bestanden zonder Node (`invites`, `features`, `monitoring`, `accountDeletion`). Daarom mag nodemailer daar niet in; het SMTP-deel komt in een eigen Node-module, met een Node-action zoals `inviteMail.coverAttachment`. De sender-check en de credentials-check delen ze.
- **Pakketten:** `nodemailer` in `package.json` (met `@types/nodemailer` voor dev), en in `convex.json` bij `node.externalPackages`. Op het Convex-forum meldt men fouten met een gebundelde nodemailer; extern installeren voorkomt dat.
- **Poort:** 587 met STARTTLS. Mailjet kent ook 25, 80, 465, 588 en 2525.
- **Risico: niet bewezen dat de Node-runtime van Convex uitgaand verkeer op poort 587 toelaat.** Ik vond geen officiële Convex-doc; op het forum werkt het bij de een wel en bij de ander niet, zonder duidelijke oorzaak.
  - **Voorstel:** de gate op dev is de proef: één echte uitnodiging met foto.
  - Werkt het niet, dan gaan uitnodigingen dankzij A-keuze 7 gewoon, zonder foto en met een fout in de log. Dan beslist Wouter: een andere poort (2525, 465), de mail zonder foto laten, of een andere provider. De gate van 2026-11-14 bewees dat poort 587 werkt.

**Ops en gate**

- Geen nieuwe env-vars. B's commit: in `external-services.md` (Mailjet) de SMTP-ingang, de terugval en dat tracking per bericht uit staat.
- **Gate, extra:**
  - in iPhone Mail staat de foto één keer;
  - in de ruwe mail: `multipart/alternative` bovenaan, geen `mjt.lu/oo/` en geen `mjt.lu/lnk/`, en de App Store-link rechtstreeks;
  - een mail zonder foto (groep zonder cover) komt nog steeds aan;
  - in de Convex-logs geen SMTP-fout.

**RED tests (besluit 5 en 6)**

| Bestand | Wat |
|---|---|
| `tests/invites/inviteMailSmtp.test.ts` (Node, nep-nodemailer, echte sharp) | A-invariant 13–18 |
| `tests/invites/_smtp.ts` | de nep-nodemailer met echte MIME, een MIME-lezer |
| `tests/invites/_wp19c.ts` | `mailFor` leest API en SMTP; `transport`, `raw`, `mime`, `envelope` |
| `inviteMailPhoto`, `-Layout`, `-AppStore`, `-NoLink` | mocken nodemailer (nooit echt naar Mailjet) |
| `tests/email/mailjetClient.test.ts` | tracking uit op de Send API; de test van `InlinedAttachments` is weg |

## Gate (dev, 2026-11-14)

Groen. Mails naar Wouters `+clerk_test`-adres, in iPhone Mail en Gmail bekeken; ruwe mail gelezen.

- **Ronde 1 (Send API met `InlinedAttachments`):** opmaak, foto, bericht over twee regels en App Store-knop goed, in licht en donker. Groep zonder geschikte cover: mail zonder foto. Maar iPhone Mail toonde de foto twee keer (`multipart/mixed`), en Mailjet zette een meetpixel en click-tracking in de mail. Daaruit besluit 5 en 6.
- **Ronde 2 (SMTP):** poort 587 werkt vanuit Convex. De mail met foto is `multipart/alternative` [tekst, `multipart/related` [HTML, foto]], de foto staat één keer in iPhone Mail. Geen `mjt.lu/oo/` of `mjt.lu/lnk/`; de App Store-link gaat rechtstreeks. De mail zonder foto (Send API) is ook zonder tracking.
- **App (simulator, als genodigde):** de kaart in Profiel → Uitnodigingen toont de cover rechtop, zonder stand en in stand 6; zonder geschikte cover de letter.
- **Niet getoetst:** een mail zonder `CLUBALMANAC_APP_STORE_ID` (de tests dekken het; het weghalen en terugzetten op dev was het niet waard).
- **Bijvangst:** wisselt een admin de groepscover terwijl de genodigde het scherm open heeft, dan draait de app het oude beeld met de nieuwe stand tot het scherm opnieuw opent. Het beeldpad per uitnodiging blijft gelijk. Backlog.

### Follow-up (buiten scope)

- **De gedeelde schil voor de andere mails aan leden** (vraag 3).
- **Cover op de uitnodigingskaart ververst niet bij een nieuwe cover** zolang het scherm open is (zie Gate). Klein; de oplossing is het beeld opnieuw laden als de foto of stand wijzigt.
