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
| `users.getById` | geen auth, volle rij | ingelogd én (zichzelf óf deelt minstens één groep met target) | publiek profiel (zichzelf: eigen profiel) |
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
| `photos.listByOwner` | geen auth | ingelogd; alleen eigen foto's (A toetst of een scherm foto's van een ander per owner toont) | foto-vorm |
| `photos.listMyFlagged` | eigen, volle rij | ongewijzigd | foto-vorm + flag-velden die de eigenaar nodig heeft voor bezwaar |
| `photos.listAllFlagged` | webmaster, volle rij | ongewijzigd | foto-vorm + alle flag-velden (incl. melder) |
| `ratings.listForPhoto` | geen auth, volle rij | foto-toegang | rating-vorm (wie, waarde) |
| `features.getById` / `list` | geen auth | ingelogd | feature-vorm. Open vraag: zijn `problem`-meldingen zichtbaar voor iedereen of alleen voor melder + webmaster? |
| `features.hasUpvoted` | boolean | ongewijzigd | ongewijzigd |
| `invites.getByToken` | anoniem (bewust), invite-spread + volle groep | ongewijzigd (token = toegangsbewijs) | alleen wat de landingspagina nodig heeft: status, verlopen-vlag, rol, groepsnaam (+ omschrijving), inviter als publiek profiel. Geen `invitedBy`-id, `bouncedAt`, token-echo of volle groep-rij |
| `invites.listPendingForEmail` | **anoniem, geeft volle invites incl. token** | geen publieke query meer (intern of weg) tenzij A een client-gebruik vindt | — |
| `invites.hasPendingForEmail` | anoniem, boolean (email-orakel: "is dit adres uitgenodigd?") | A toetst tegen WP13-login en oude signup-flow; zonder client-behoefte: niet publiek | — |
| `invites.listMine` | eigen verstuurde invites, spread | ongewijzigd | invite-vorm (eigen data; token mag erin als de afzender de link opnieuw moet kunnen delen) |

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

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft.)
