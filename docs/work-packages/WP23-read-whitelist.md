# WP23: Auth + veld-whitelist op publieke reads

## Productdoel

Een clublid ziet via de app alleen gegevens van groepen, albums en foto's van groepen waar die lid van is, en van andere leden nooit meer dan naam en profielfoto. Wie de deployment-URL heeft maar niet is ingelogd, krijgt niets — behalve de invite-landingspagina via een geldig token.

## Aanleiding

Bij de WP15-kickoff zag regie dat `users.getById` een publieke `query` is zonder auth-check die de hele users-rij teruggeeft, inclusief `email` en `subject`. Een inventaris van alle publieke queries in `convex/` laat meer van hetzelfde zien (tabel hieronder). Niets hiervan is live op prod (cutover = fase 5). De app gebruikt nu alleen `users.current`; WP15-WP17 gaan de andere reads gebruiken. Daarom nu, vóór de schermen erop leunen.

Regel (phase-kickoff-skill): **PII gaat via een backend-whitelist, niet via een UI-filter of blacklist.** Een spread (`{ ...row }`) telt als lek, ook als vandaag geen gevoelig veld in de rij staat: een veld dat later aan het schema wordt toegevoegd, lekt dan automatisch mee.

## Begrippen

| Term | Betekenis |
|---|---|
| ingelogd | Clerk-identity aanwezig én users-rij bestaat (huidige `requireCurrentUser`) |
| lid | ingelogd én membership in de betreffende groep (huidige `requireMember`) |
| foto-toegang | ingelogd én (eigenaar van de foto, óf lid van een groep waarin de foto in een album staat) |
| webmaster | huidige `requireWebmaster` |
| publiek profiel | wat een ander lid van een user mag zien: id, naam, profielfoto-verwijzing. Geen email, geen Clerk-subject, geen tellers, geen bezoek- of aanmaaktijden. Precedent: inviter-vorm in `invites.getByToken` (audit-8) |
| eigen profiel | wat de user van zichzelf ziet. Mag email bevatten (HomeScreen toont het). Geen Clerk-subject: de client heeft dat niet nodig |

## Invarianten

1. Geen enkele publieke query geeft `users.email` of `users.subject` van een ánder dan de caller terug. Uitzonderingen alleen expliciet in de tabel hieronder.
2. Elke publieke query-response is een whitelist: de set velden ligt vast in de code, per tabel-vorm. Een nieuw schema-veld verschijnt niet in een response zonder bewuste code-wijziging. Structureel afdwingen (bv. Convex `returns`-validator, zodat een te brede response fail-loud is) heeft de voorkeur boven alleen een test op de huidige velden.
3. Elke publieke query behalve `invites.getByToken` en `smoke.ping` vereist minstens "ingelogd". Niet-ingelogd gedrag is consistent met de bestaande queries met auth (`requireCurrentUser` throwt; queries die nu `null`/`[]` geven bij geen identity, zoals `users.current` en `groups.listMine`, houden dat gedrag — de app leunt op `current === null`).
4. Geen bestaans-orakel: "bestaat niet" en "bestaat, maar geen toegang" zijn voor de caller niet van elkaar te onderscheiden (zelfde error of zelfde lege uitkomst).
5. Geneste docs volgen dezelfde regel: een user in een foto, groep-ledenlijst of rating is een publiek profiel; een foto in een album/groep-cover is de foto-vorm, geen volle rij.
6. Bestaande autorisatie in mutations verandert niet. Deze WP raakt alleen reads.

## Per query: auth + output

Regie-draft. A toetst tegen de oude app (welke schermen tonen wat aan wie) en scherpt aan in §Spec-criticus. "Huidig" = situatie op `ae53be2`.

| Query | Huidig | Auth (doel) | Output (doel) |
|---|---|---|---|
| `users.getById` | geen auth, volle rij | ingelogd én (zichzelf óf deelt minstens één groep met target) | publiek profiel, ook voor zichzelf (A-keuze 9) |
| `users.current` | eigen volle rij incl. `subject` | ongewijzigd (`null` zonder identity/rij) | eigen profiel |
| `groups.getById` | geen auth, volle rij | lid | groep-vorm |
| `groups.getWithCover` | lid, groep-spread + volle foto | lid | groep-vorm + cover als foto-vorm |
| `groups.listMine` | eigen, groep-spread | ongewijzigd | groep-vorm + eigen rol |
| `groups.listMembers` | lid, **volle user-rij per lid** | lid | membership-velden + publiek profiel. Bron voor WP16-ledenlijst |
| `albums.getById` / `listByGroup` / `listByGroupWithUnread` | lid, album-spread | lid | album-vorm (+ `unreadCount`) |
| `albums.getWithGroup` | lid, album + volle groep | lid | album-vorm + groep-vorm |
| `albums.getWithCover` | lid, album + volle foto | lid | album-vorm + foto-vorm |
| `albums.listPhotos` | lid, albumPhoto + volle foto | lid | albumPhoto-velden + foto-vorm |
| `photos.getById` | geen auth, volle rij | foto-toegang | foto-vorm |
| `photos.getWithOwner` | geen auth, foto + **volle owner-rij** | foto-toegang | foto-vorm + owner als publiek profiel |
| `photos.listByOwner` | geen auth | ingelogd; alleen eigen foto's, andere `ownerId` geeft geen data | foto-vorm |
| `photos.listMyFlagged` | eigen, volle rij | ongewijzigd | foto-vorm + flag-velden die de eigenaar nodig heeft voor bezwaar |
| `photos.listAllFlagged` | webmaster, volle rij | ongewijzigd | foto-vorm + alle flag-velden (incl. melder) |
| `ratings.listForPhoto` | geen auth, volle rij | foto-toegang | alleen de eigen rating van de caller (A-keuze 1) |
| `features.getById` / `list` | geen auth | ingelogd | feature-vorm. `problem` alleen voor indiener + webmaster (A-keuze 5) |
| `features.hasUpvoted` | boolean | ongewijzigd | ongewijzigd |
| `invites.getByToken` | anoniem (bewust), invite-spread + volle groep | ongewijzigd (token = toegangsbewijs) | alleen wat de landingspagina nodig heeft: status, verlopen-vlag, rol, groep-id + naam + omschrijving, inviter (naam + profielfoto). Geen invitee-email, `invitedBy`-id, `bouncedAt`, token-echo of volle groep-rij (A-keuze 6) |
| `invites.listPendingForEmail` | **anoniem, geeft volle invites incl. token** | geen publieke query meer, intern of weg (A-keuze 7) | — |
| `invites.hasPendingForEmail` | anoniem, boolean (email-orakel: "is dit adres uitgenodigd?") | geen publieke query meer, intern of weg (A-keuze 7) | — |
| `invites.listMine` | eigen verstuurde invites, spread | ongewijzigd | invite-vorm, zonder token (A-keuze 8) |

Vormen (groep, album, foto, rating, feature, invite) legt A vast in §Spec-criticus. Uitgangspunt per vorm: alleen velden die een scherm in de oude app toont of die de app voor gedrag nodig heeft. Aandachtspunten:
- **foto-vorm**: `flaggedBy` (wie meldde) is melder-identiteit — niet voor gewone leden en niet voor de eigenaar. Precieze `latitude`/`longitude` toetsen: toont de oude app een kaart, of alleen `locationLabel`? `filename` toetsen.
- **groep-/album-vorm**: `createdBy` is een user-id, geen PII; mag blijven als een scherm "gemaakt door" toont.

## Edge cases + scope-uitsluitingen

- **In scope**:
  - Alle publieke queries uit de tabel, auth + whitelist.
  - Bestaande unit-tests die nu anoniem lezen, aanpassen (A): `tests/users/crud`, `users/profile`, `groups/crud`, `photos/crud`, `ratings/crud`, `features/crud`, `invites/publicGet`, `invites/bouncedHandler`.
  - Integration-test `tests/integration/uploads/uploadRoundtrip.test.ts` pollt `photos.getById` zonder auth: A zet de JWT vóór het pollen (A, niet B — test-file).
  - Foto in meerdere albums/groepen: toegang als caller lid is van minstens één van die groepen.
  - Lid verlaat groep: verliest per direct toegang tot groep-, album- en foto-reads van die groep (behalve eigen foto's).
- **Bewust niet**:
  - `convex/_test.ts`-queries: al gegated op `INTEGRATION_TEST_ENABLED`, inert op prod.
  - Mutations, httpActions, internal functions.
  - Foto-URL's / storage-toegang (`getUrl`): komt in WP17.
  - Zichtbaarheid van geflagde foto's voor andere leden (gedragswijziging, hoort bij WP20).
  - Webmaster-bypass op lid-reads: webmaster leest groepen alleen als lid, zoals nu.

## Risico-assessment

- **security/privacy**: hoog — PII (email, Clerk-subject, GPS, melder-identiteit) en auth-grenzen op elke read. Setup 2 + adversarial houding in audit.
- **ops**: laag — geen externe calls, geen nieuwe failure-modes; fout = te streng (scherm leeg) of te ruim (lek), beide in tests zichtbaar.
- **external deps**: laag — geen.
- **multi-user/concurrency**: laag — reads only; membership-wijziging werkt via Convex-reactiviteit direct door.
- **data/schema-evolutie**: laag — geen schema-wijziging, geen data-migratie.
- **ops-runbook-impact**: geen nieuwe env-vars of deploy-config. Wel doc-deliverable: `docs/migratie-plan-convex.md` §RBAC krijgt een korte regel "reads: auth + whitelist per query, zie WP23" (B co-commit).

## Cross-refs

- migratie-plan: §Webmaster-rol (RBAC)
- invites.getByToken audit-8-precedent (inviter-whitelist)
- WP16 (ledenlijst): gebruikt `groups.listMembers` → publiek profiel
- WP17 (foto's bekijken): gebruikt `albums.listPhotos`, `photos.getById` → foto-vorm
- oude code (alleen A): oude app `clubalmanac-app` — profiel-, leden-, foto-detail-, rating- en feature-schermen; AWS `blob-images-api-user` (welke user-velden gaf de oude API aan anderen terug?)

## Acceptance

- Tests per query in de tabel: niet-ingelogd, ingelogd-zonder-toegang (incl. geen bestaans-orakel), met toegang. Met toegang: de response bevat exact de whitelist-velden — niet meer.
- Minstens één test per geneste vorm (owner in foto, user in ledenlijst, cover in groep/album) die bewijst dat email/subject er niet in zitten.
- Volledige unit-suite groen, `npx tsc` schoon (convex + app).
- App: `users.current` werkt nog (HomeScreen toont naam + email). Typecheck van `app/` volstaat; geen simulator-gate nodig, er verandert geen scherm.
- Integration-test upload: aangepast door A; draaien door Wouter lokaal (niet in CI).

## Kickoff (regie, 2026-11-02)

- **Setup**: 2 (spec-criticus A) + B + audit met adversarial opdracht. Security = hoog.
- **Uitvoering**: rollen als sub-agent (Agent-tool) vanuit een regie-sessie die zelf door een andere sessie is gestart; aparte rol-sessies kon deze sessie niet starten. Afwijking van de default "eigen sessie per rol" voor hoog-risico; gecompenseerd door regie-review na elke rol en verbatim-quotes van audit-findings in de closeout.

---

## Spec-criticus aanvullingen (A)

Bronnen (alleen A): oude app `clubalmanac-app` (Profile + PersonalHeader, GroupMembersSub, PhotoDetail, AlbumPhotos, MyPhotos, AlbumMap, Inappropriate(Admin), LoginInvite + Invited), oude API `blob-images-api-{user,groups,photos,invites}` (getUser, listMembers, getPhoto + `getPhotoById`, getRating, listFlagged, listAllFlagged, publicGetInvite), `blob-images-features`, `blob-common/core/dbClean.js`, plus de pariteit-tabel in WP13.

### Wat de oude code deed

- De oude API haalde alleen vier interne keys weg (`cleanRecord`) en gaf de rest terug. Foto's, de ledenlijst en features droegen een **gedenormaliseerde volle user-rij mee, inclusief email**. Het lek bestond in v1 al. Er is dus geen pariteit om te bewaren.
- Foto-toegang was eigenaar, of lid van een groep met een publicatie van de foto. Dat is gelijk aan de definitie hierboven.
- Ratings: de oude API gaf alleen de **eigen** rating van de caller terug. De oude app had geen rating-scherm.
- Probleemmeldingen werden alleen gemaild en nooit gelijst. De feature-lijst gaf een `userIsOwner`-vlag (en daarnaast toch de volle user-rij).
- Het album-scherm toonde gemelde foto's bewust niet als gemeld. Alleen Mijn foto's en Ongepast toonden de flag-status, en dan alleen datums: geen reden, geen melder.
- Het kaart-scherm gebruikte GPS van alle foto's in een album. Kaart en foto-locatie hebben in v2 geen WP (WP13).
- De invite-landing toonde groepsnaam, inviter-naam, het bericht, en naam + email van de genodigde. Accepteren navigeerde naar de groep, dus de app had de groep-id nodig.

### Vormen (veldlijsten)

Regels voor alle vormen:
- `_creationTime` zit in geen enkele vorm.
- Een optioneel veld mag ontbreken als het in de rij ontbreekt. Een veld dat niet in de lijst staat, is fout.
- Een geneste user is altijd een publiek profiel, een geneste foto altijd de foto-vorm.

| Vorm | Velden | Bewust niet |
|---|---|---|
| publiek profiel | `_id`, `name`, `profilePhotoStorageId` | `email`, `subject`, `photoCount`, `photoLimit`, `lastVisitAt`, `createdAt` |
| eigen profiel | `_id`, `email`, `name`, `profilePhotoStorageId`, `photoCount`, `createdAt`, `lastVisitAt` | `subject`, `photoLimit` (A-keuze 10) |
| groep | `_id`, `name`, `description`, `coverPhotoId`, `createdBy`, `createdAt` | — |
| membership | `_id`, `userId`, `groupId`, `role`, `joinedAt` | — |
| album | `_id`, `groupId`, `name`, `description`, `coverPhotoId`, `createdBy`, `createdAt` | — |
| albumPhoto | `_id`, `albumId`, `photoId`, `groupId`, `addedAt`, `addedBy` | — |
| foto | `_id`, `ownerId`, `storageId`, `width`, `height`, `takenAt`, `locationLabel`, `exifOrientation`, `ratingAverage`, `ratingCount`, `createdAt` | `filename`, `mimeType`, `latitude`, `longitude`, alle flag-velden |
| eigen flag-velden | `flaggedAt`, `flaggedDeleteDate`, `flaggedAppealDate`, `flaggedAppealDenyDate` | `flaggedBy`, `flagReason` |
| alle flag-velden | eigen flag-velden + `flaggedBy`, `flagReason` | — |
| rating | `photoId`, `value` | `userId` (is altijd de caller), tijden |
| feature | `_id`, `type`, `title`, `description`, `status`, `upvoteCount`, `createdAt` | `submittedBy` |
| invite (afzender) | `_id`, `email`, `groupId`, `role`, `status`, `expiresAt`, `createdAt` | `token`, `invitedBy`, `respondedAt`, `bouncedAt` |
| invite-landing | `status`, `isExpired`, `role`, `group`, `inviter` | `email`, `token`, `invitedBy`, `bouncedAt`, `_id`, tijden |
| `group` in landing | `_id`, `name`, `description`, of `null` | `coverPhotoId`, `createdBy`, `createdAt` |
| `inviter` in landing | `name`, `profilePhotoStorageId`, of `null` | `_id` (precedent audit-8) |

### Response per query

- `users.getById`: publiek profiel, ook voor zichzelf. `users.current`: eigen profiel of `null`.
- `groups.getById`: groep. `groups.getWithCover`: groep + `cover` (foto of `null`). `groups.listMine`: per item groep + `role`.
- `groups.listMembers`: per item `{ membership, user }`, met membership-vorm en publiek profiel (`null` als de users-rij ontbreekt).
- `albums.getById` en `listByGroup`: album. `listByGroupWithUnread`: album + `unreadCount`. `getWithGroup`: album + `group` (groep). `getWithCover`: album + `cover` (foto of `null`).
- `albums.listPhotos`: per item `{ albumPhoto, photo }`, met albumPhoto-vorm en foto (`null` als de foto ontbreekt).
- `photos.getById` en `listByOwner`: foto. `getWithOwner`: foto + `owner` (publiek profiel of `null`).
- `photos.listMyFlagged`: foto + eigen flag-velden. `listAllFlagged`: foto + alle flag-velden.
- `ratings.listForPhoto`: lijst met hooguit één rating, die van de caller.
- `features.getById`: feature of `null`. `features.list`: features. Een `problem` alleen voor de indiener en de webmaster.
- `invites.getByToken`: invite-landing of `null`. `invites.listMine`: invite (afzender).
- `features.hasUpvoted` en `smoke.ping`: ongewijzigd.

Auth, aanvullend op de tabel:
- Een identity zonder users-rij telt als niet-ingelogd: throw bij de gegate queries, `null`/`[]` bij `users.current`, `groups.listMine` en `invites.listMine`.
- `photos.listByOwner` met een andere `ownerId` dan de caller geeft geen data (throw of lege lijst). Geen scherm toont foto's van een ander per eigenaar.
- `features.getById` op een probleem van een ander geeft hetzelfde als een onbekend id.

### Aanvullende invarianten

7. **De lijst publieke queries ligt vast.** Een test somt alle publieke queries in `convex/` op en vergelijkt met de tabel. Een nieuwe publieke query faalt tot iemand die lijst bewust bijwerkt. `convex/_test.ts` valt erbuiten.
8. **Elke publieke query heeft een return-validator zonder `any`** (A-keuze 11). Convex weigert dan een response met een veld buiten de validator. Een spread of een nieuw schema-veld faalt luid in plaats van stil te lekken. Zo is invariant 2 structureel.
9. **Melder-identiteit** (`flaggedBy`, `flagReason`) gaat alleen naar de webmaster.

### Edge cases (gepind in RED-tests)

- Foto in albums van twee groepen, caller is lid van één van de twee: toegang.
- Lid verlaat een groep: direct geen groep-, album- en foto-reads meer. `users.getById` op leden van die groep faalt ook, tenzij er nog een andere gedeelde groep is. Eigen foto's blijven leesbaar.
- Eigen foto die in geen enkel album staat: leesbaar voor de eigenaar, voor niemand anders.
- Webmaster zonder lidmaatschap: geen groep-, album- of foto-reads (geen bypass). Wel `listAllFlagged` en alle features.
- Gemelde foto als cover of in een album: leden zien de foto-vorm zonder flag-velden. De eigenaar ziet geen melder en geen reden.
- Invite die geaccepteerd, verlopen of gebounced is: de landing-vorm, zonder `bouncedAt` en zonder email.
- Geen bestaans-orakel: zelfde caller, onbekend id tegenover bestaand id zonder toegang, geeft een identieke uitkomst (zelfde error-tekst, of allebei `null`/`[]`). De test schrijft niet voor welke van de twee.

### A-keuzes ter bevestiging

1. **Ratings: alleen de eigen rating.** De oude API gaf alleen de eigen rating terug en de oude app toonde geen ratings (WP13 open vraag 1). Wie wat gaf, is sociaal gevoelig. Het aggregaat (`ratingAverage`, `ratingCount`) zit in de foto-vorm. Een scherm dat raters wil tonen, voegt dat bewust toe, met publiek profiel.
2. **Geen GPS (`latitude`, `longitude`) in de foto-vorm.** De oude app had een kaart, maar kaart en foto-locatie hebben in v2 geen WP. `locationLabel` blijft, want fotodetail toont het. Komt de kaart terug, dan voegt die WP de coördinaten toe.
3. **Geen `filename` en `mimeType`.** Geen scherm toonde ze, en een bestandsnaam kan een naam bevatten.
4. **De eigenaar ziet geen `flagReason`.** Dat is vrije tekst van de melder (nieuw in v2) en kan de melder herleidbaar maken. De eigenaar ziet de datums die het bezwaar-scherm in de oude app toonde.
5. **Een `problem` alleen voor indiener en webmaster, en geen `submittedBy` in de feature-vorm.** De oude flow mailde problemen alleen, en toonde geen indiener van features.
6. **Invite-landing zonder email van de genodigde, wel `group._id`.** De oude landing toonde naam + email en vulde die in bij aanmelden. Een token staat in URL's en doorgestuurde mails, dus zonder email is strenger. De user typt bij login zelf zijn email (raakt WP19/WP22). `group._id` blijft: "accepteren, dan naar de groep" heeft het nodig (`invites.accept` geeft niets terug), en voor een niet-lid ontsluit het niets.
7. **`listPendingForEmail` en `hasPendingForEmail` niet publiek.** Geen client gebruikt ze: de pre-signup-gate is bewust niet gebouwd (WP6) en de app roept ze niet aan. Het Uitnodigingen-scherm (WP19) heeft wel een lijst ontvangen uitnodigingen nodig, maar voor de ingelogde caller, niet op een vrij email-argument. Dat wordt een nieuwe read in WP19.
8. **`invites.listMine` zonder `token`, `respondedAt` en `bouncedAt`.** De oude app kende geen "link opnieuw delen" en geen bounce-weergave.
9. **`users.getById` geeft ook voor zichzelf het publiek profiel.** Het eigen profiel loopt via `users.current`. Eén vorm per query houdt de return-validator simpel.
10. **Eigen profiel zonder `photoLimit`.** Geen scherm toonde de limiet; de server bewaakt hem. WP18 kan hem toevoegen als de upload-teller hem nodig heeft.
11. **Return-validator verplicht** (invariant 8). De voorkeur uit invariant 2 wordt hiermee een eis, met een test per publieke query.

### Buiten scope, wel gezien (voor regie)

- **Mutations zonder foto-toegang.** `photos.flag` en `ratings.upsert` checken alleen "ingelogd" en "foto bestaat". Elk account met een photo-id kan melden of raten, en "Foto bestaat niet" is een bestaans-orakel. Invariant 6 houdt dit buiten WP23; kandidaat voor WP17/WP20 of een mini-WP.
- **Reads die latere WP's nodig hebben**, elk met een eigen whitelist: openstaande uitnodigingen van een groep, met email, in de ledenlijst (WP16, de oude app toonde dit); ledenaantal en "sinds" per groep (WP16); "staat in deze albums" (WP17); ontvangen uitnodigingen van de caller (WP19); een webmaster-vlag voor het profielmenu (WP15/WP20).

### Test-strategie

- Eén seed-wereld met alle optionele velden gevuld, zodat "precies deze velden" deterministisch is. De test vergelijkt de set gedefinieerde keys.
- Elke response wordt geserialiseerd en gescand: geen `email` of `subject` van enige user erin, behalve de eigen email in het eigen profiel.
- Het orakel wordt getest als vergelijking van uitkomsten, niet als voorgeschreven error-vorm.
- De lijst publieke queries en de return-validators worden gelezen van de geëxporteerde functies. convex-test maakt zelf geen onderscheid tussen publiek en intern.
- Integration-test upload: JWT vóór het pollen. De test checkt `takenAt` en `locationLabel` (een label bewijst dat GPS uitgelezen en gegeocodeerd is) en dat `latitude`/`longitude` níet in de response staan.

---

## Audit-ronde 1 → fix-cyclus (regie, 2026-11-02)

Audit vond dat een cover-join de foto-toegang overslaat. Na vertrek van een lid blijft diens foto als cover zichtbaar voor de achterblijvers. En een groep- of album-admin kan elk photo-id als cover zetten en het dan lezen. Dat valt binnen de scope: het gaat om reads.

**Invariant 10.** Een geneste foto (`cover` in `groups.getWithCover` en `albums.getWithCover`) volgt dezelfde foto-toegang als `photos.getById`. Zonder foto-toegang is `cover` gelijk aan `null`, ook als `coverPhotoId` gezet is. De groep- of album-vorm zelf blijft leesbaar; `coverPhotoId` mag daarin blijven staan, want een id zonder toegang ontsluit niets.

Daarnaast in deze cyclus:
- **Tests (A)**:
  - beide cover-paden: een vertrokken lid, en een cover met een photo-id waar de caller geen toegang toe heeft;
  - de `null`-takken van `groups.listMembers` (users-rij ontbreekt) en `albums.listPhotos` (foto ontbreekt);
  - geen webmaster-bypass op `albums.*` en `groups.listMembers`;
  - `inventory.test.ts` laat geen open-key-validators toe (`v.record`, `v.any`).
- **Impl (B)**: invariant 10. Daarnaast: koppel de veld-whitelist van `pick` aan de tabel van de rij. Een whitelist met een veld dat niet in de tabel bestaat, moet dan bij compile-time falen.

**Write-gates, niet in deze cyclus.** Mutations kunnen de state zetten waar foto-toegang op leunt, en checken zelf geen foto-toegang:
- `albums.addPhoto`
- `coverPhotoId` in `groups.update` en `albums.update`
- `photos.flag` en `ratings.upsert`

Daarbij komen bestaans-orakels in `albums.addPhoto`, `photos.flag`, `albums.markSeen` en `features.upvote` (die laatste raakt ook verborgen problemen). Een aanvaller die ooit een photo-id zag, kan via een eigen groep weer toegang krijgen. Invariant 6 houdt mutations buiten WP23. Dit moet af vóór WP17, want dan levert `getUrl` de beeldbytes. Besluit Wouter: WP23 uitbreiden of een eigen WP.
