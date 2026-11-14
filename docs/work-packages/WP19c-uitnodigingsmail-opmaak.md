# WP19c: uitnodigingsmail met opmaak en groepsfoto

> Draft regie 2026-11-14. Backend-WP (mail), geen app-wijziging. A → B → audit → gate op dev met een echte mail. Eigen branch `wp19c`.

## Besluiten Wouter

1. **Groepsfoto en opmaak in de uitnodigingsmail (2026-11-14).** De oude uitnodigingsmail had opmaak en de groepsfoto. WP5 nam alleen de tekst over; in WP19b zag A de groepsfoto in v1, maar dat werd geen vraag. Wouter: nu oppakken.
2. **De foto zit in de mail zelf, niet achter een link.** Een link naar een beeld werkt voor iedereen die de mail doorgestuurd krijgt en botst met WP19b besluit 1 (geen link, geen token). De App Store-link blijft "later" (WP19b backlog).

## Productdoel

Wie een uitnodiging krijgt, ziet in de mail meteen van welke groep: de groepsfoto bovenaan en een verzorgde opmaak in de stijl van de app. De tekst blijft wat hij nu is (WP19b): geen link, geen token, wel naam, bericht, inlogadres en geldig tot.

## Invarianten

1. **De groepsfoto zit als bijlage in de mail** (inline, met een content-id). Er staat geen URL naar een beeld van Convex in de mail, en geen token.
2. **Alleen een cover die de genodigde in de app ook zou zien.** Dezelfde regel als het beeldpad van WP19b (A-invariant 15): de cover van de groep van de uitnodiging, en alleen als die foto in een album van die groep staat. Anders geen foto in de mail; de mail blijft verder gelijk.
3. **Formaat *klein*** (WP25), nooit het origineel. Ontbreekt *klein*, dan geen foto (niet terugvallen op het origineel).
4. **Geen GPS of andere metadata** in de bijlage (WP17d: wat de backend geeft, bevat geen GPS).
5. **De mail gaat ook zonder foto weg.** Lukt het ophalen van het beeld niet, dan gaat de mail zonder foto; de uitnodiging faalt niet.
6. **Opmaak in de stijl van de app** (`docs/design.md`): kleuren, lettertype-fallback, één kolom, leesbaar in licht en donker. Tekst-versie (`textPart`) blijft compleet zonder beeld.
7. **HTML-veilig** zoals nu: naam, bericht en groepsnaam ge-escaped.

## Edge cases + scope-uitsluitingen

- Groep zonder cover, of cover niet in een album van de groep: mail zonder foto.
- Uitnodiging ingetrokken voordat de mail wegging: geen mail (zoals nu).
- **Buiten scope:** de App Store-link, de andere mails (geaccepteerd, afgewezen, bounce, melden) tenzij A adviseert dezelfde basisopmaak mee te nemen (open vraag 3), en de afmeldmelding van iPhone Mail (vervallen, WP19b).

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

## Werkvolgorde

1. Regie: deze draft.
2. A: oude mail bekijken, open vragen, A-invarianten, RED tests. Stop bij een productvraag.
3. B: implementatie.
4. Audit.
5. Gate op dev: een uitnodiging naar Wouters `+clerk_test`-adres voor Blob bibliotheek (cover in album) en voor een groep zonder geschikte cover. Mail in iPhone Mail en Gmail bekijken, licht en donker.

## Spec-criticus aanvullingen (A vult in)
