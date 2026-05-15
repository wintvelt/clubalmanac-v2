# Externe service keuzes

## Geocoding: Photon (Komoot)

Gekozen 2026-05. Geen API key nodig (publieke instance op `photon.komoot.io`). Fair-use voor 16-user volume. URL gebruikt `lang=en` voor internationale leesbaarheid (Georgië/Nepal scenario's). Vervangt MapQuest die wegens revoked keys + paid-only tier niet meer geschikt was.

Endpoint: `https://photon.komoot.io/reverse?lat=<lat>&lon=<lon>&lang=en`
Header: `User-Agent: Clubalmanac/2.0` (fair-use vereiste)

## Email: Mailjet (Frankrijk)

Gekozen 2026-05. EU-based, GDPR-compliant. Free tier 6000/maand voldoende voor 16-user volume. Voor invites + member changes + flag-decide notifications + bounce webhook. Nog niet gebouwd (toekomstig werkpakket).

### Known issues en geaccepteerde trade-offs (2026-05-15)

Tijdens setup en eerste integratie-werk drie fricties geconstateerd. Bewust geaccepteerd of als hard gate in WP5-impl opgenomen.

1. **Mailing list header**: Mailjet voegt op alle tiers een `List-Unsubscribe` header toe aan transactional emails. Niet uitzetbaar. Voor CA's invites/notifications acceptabel — gebruikers verwachten geen opt-out, maar 'm hebben is geen breaker. Andere providers zoals Scaleway TEM bieden 'm niet; bij voldoende frictie heroverwegen.
2. **Silent failure op niet-gevalideerde sender**: Mailjet retourneert `200 OK` op de send-API ook wanneer de from-address niet geverifieerd is. Mail wordt dan niet verstuurd zonder dat de caller dat ziet. **Hard gate voor WP5-impl**: vóór elke send een verified-sender-check via Mailjet's REST API (`/REST/sender` endpoint), of een setup-time-gate die alle gebruikte from-addresses op deployment-start verifieert. Niet vertrouwen op send-response.
3. **Sub-account API key frictie**: Mailjet's "primary + sub-account" key-model gaf onbekende frictie (root cause niet achterhaald). Voor CA: één primary API key gebruiken, geen sub-accounts. Bij meerdere projecten op één account: sender-domain-separation of een aparte account per project — niet sub-accounts.

Bij escalerende blockers op één van deze drie: heroverweeg Scaleway TEM. Pre-onderzoek 2026-05-15 toonde dat Scaleway bounce-webhook nog in beta is + geen HMAC biedt + payload-shape volledig anders (delivery via Topics-and-Events-topic ipv direct POST). Switch is niet 1-op-1 maar wel mogelijk.

## Auth: Clerk

`picked-quail-97.clerk.accounts.dev` is de dev instance. Free tier vanaf `accounts.clerk.dev` voor signup-mails (geen custom email domain — paid feature, niet nodig voor 16 signups).

Webmaster-rol via env-var `WEBMASTER_EMAILS` met case-insensitive match (audit-7 fix).

## Productie-blind-spots

JWT validation roundtrip, Mailjet bounce webhook, Photon connection: deze zijn unit-test alleen via mocks gevalideerd. Echte service-integratie loopt via de [integration-test laag](./integration-tests.md) (`npm run test:integration`, niet in CI), per werkpakket apart. Photon (WP1) is gepind; Convex/Clerk/Mailjet (WP2-4) staan op de planning.

## Waarom deze keuzes

Eerlijke evaluatie tegen 16-user hobby use case. EU-providers waar mogelijk voor GDPR-coherentie. Geen paid services voor functionaliteit die gratis kan.
