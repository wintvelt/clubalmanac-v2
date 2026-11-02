# WP24: Write-gates op foto-toegang

## Productdoel

Een clublid kan een foto alleen in een album zetten, als cover kiezen, melden of beoordelen als die de foto al mag zien. Wie ooit een photo-id zag, krijgt via een mutation geen toegang terug.

## Aanleiding

WP23 gaf elke publieke read auth en een veld-whitelist. Foto-toegang (`convex/lib/photoAccess.ts`) leunt op state die mutations schrijven: `albumPhotos` en `coverPhotoId`. Die mutations checken zelf geen foto-toegang. Aanval: een account maakt een eigen groep, zet een bekend photo-id in een eigen album, en leest de foto weer. Vanaf WP17 levert `getUrl` dan de beeldbytes. Zie WP23 §Audit-ronde 1 en §Closeout, en `audit-track-record.md` §Recurring-pattern-kandidaten (read-gate zonder write-gate). Besluit Wouter 2026-11-02: eigen WP, af vóór WP17.

## Begrippen

Zoals in WP23 §Begrippen. Kort:

| Term | Betekenis |
|---|---|
| ingelogd | Clerk-identity én users-rij |
| lid | ingelogd én membership in de groep |
| foto-toegang | ingelogd én (eigenaar, óf lid van een groep waarin de foto in een album staat). Eén definitie: `canAccessPhoto` |

## Invarianten

1. **Geen toegang via schrijven.** Na elke publieke mutation geldt: wie vóór de mutation geen foto-toegang had, heeft die erna ook niet. Geen enkele mutation maakt een foto zichtbaar voor de caller of diens groepen zonder dat de caller al foto-toegang had.
2. **Write-gate per mutation.** Deze mutations vereisen foto-toegang van de caller tot de foto die ze raken, bovenop hun bestaande rol-check:
   - `albums.addPhoto`
   - `groups.update` en `albums.update`, als `coverPhotoId` wordt gezet
   - `photos.flag`
   - `ratings.upsert`
3. **Geen bestaans-orakel in mutations.** "Bestaat niet" en "bestaat, maar geen toegang" geven dezelfde uitkomst (zelfde error-tekst). Dit geldt voor het photo-id in de mutations van invariant 2, het album-id in `albums.markSeen`, en het feature-id in `features.upvote` en `features.removeUpvote`.
4. **Verborgen problemen blijven verborgen.** Een `problem` van een ander (WP23 A-keuze 5) gedraagt zich in `features.upvote`/`removeUpvote` als een onbekend id. De `upvoteCount` van zo'n probleem verandert niet door een ander dan indiener of webmaster.
5. **Webmaster-check dwingt de users-rij zelf af.** `isWebmaster` geeft `false` voor een identity met een webmaster-email maar zonder users-rij, ook als de aanroeper dat niet vooraf checkt.
6. **Geen webmaster-bypass.** Ook de webmaster heeft voor de mutations uit invariant 2 gewone foto-toegang nodig (lijn van WP23).
7. **Bestaand gedrag met toegang verandert niet.** Wie toegang heeft, kan wat die nu kan. Bestaande rol-checks (admin, creator, eigenaar-kan-eigen-foto-niet-melden) blijven.

## Edge cases + scope-uitsluitingen

- **In scope**:
  - De mutations uit invariant 2-4, plus `isWebmaster`.
  - Cover-pad via de mutation (WP23-closeout): een admin probeert een photo-id zonder toegang als cover te zetten via `groups.update` en `albums.update`. De cover-read blijft dan dicht, en de mutation weigert.
  - Een foto in albums van twee groepen; caller is lid van één: toegang, dus toevoegen aan een album van een andere eigen groep mag (zie open vraag 1).
  - Lid verlaat een groep: mag daarna die foto's niet meer toevoegen, als cover zetten, melden of beoordelen (behalve eigen foto's).
  - Een eigen foto die in geen album staat: de eigenaar mag hem toevoegen, als cover zetten en beoordelen (zie open vraag 3).
- **Open vragen voor A (toetsen tegen oude code, rapporteren aan regie)**:
  1. Mocht in de oude app iedereen met toegang een foto in een album zetten, of alleen de eigenaar? Was het strenger, rapporteer dan; regie legt het voor aan Wouter.
  2. Moet een cover een foto zijn die in dát album (album-cover) of in een album van díe groep (groep-cover) staat? De cascades AP4 (cover wissen als de publicatie verdwijnt) gaan daar al van uit. Zo ja, dan is dat strenger dan foto-toegang en volgt foto-toegang eruit.
  3. Mocht de eigenaar de eigen foto beoordelen?
  4. Andere publieke mutations met een bestaans-orakel op een id (bv. `photos.rotate`/`update`/`remove`/`appeal`, `groups.*`). Inventariseer; regie beslist of ze meegaan.
- **Bewust niet**:
  - Reads: die zijn in WP23 afgedekt.
  - Een cover wissen via `update` (kan nu niet, `undefined` betekent "niet wijzigen"). Hoort bij WP16/WP17 als een scherm het nodig heeft.
  - `pick` dat een `any`-rij stil accepteert (WP23-nit, geen gat vandaag).
  - Validatie van rating-waarden en flag-reden-lengte. Melden als A het ziet, niet meenemen.
  - Internal mutations en de migratie (`convex/migration.ts`): die schrijven geen user-input.

## Risico-assessment

- **security/privacy**: hoog — auth-grens op schrijfpaden die de read-toegang van WP23 bepalen. Setup 2 + adversarial houding in audit, met mutatie-check per gate.
- **ops**: laag — geen externe calls, geen nieuwe failure-modes. Te streng = knop faalt (zichtbaar), te ruim = lek (in tests zichtbaar).
- **external deps**: laag — geen.
- **multi-user/concurrency**: laag — Convex-mutations zijn transactioneel; check en schrijf in één transactie.
- **data/schema-evolutie**: laag — geen schema-wijziging. Wel: bestaande data kan albumPhotos of covers bevatten die de nieuwe gate niet zou toelaten (migratie uit v1). Geen backfill; de read-gate van WP23 houdt die dicht. A noteert of v1-data dit kan bevatten.
- **ops-runbook-impact**: geen nieuwe env-vars of deploy-config. Doc-deliverable: `docs/migratie-plan-convex.md` §RBAC krijgt een regel "writes die foto-toegang bepalen, checken foto-toegang, zie WP24" (B co-commit).

## Cross-refs

- WP23 (`docs/work-packages/WP23-read-whitelist.md`): §Begrippen, invariant 4 en 10, §Audit-ronde 1, §Closeout.
- `convex/lib/photoAccess.ts`: de ene definitie van foto-toegang.
- cascade-matrix: AP3 (ratings opruimen bij toegangsverlies), AP4 (covers wissen), FL2 (flag).
- WP17 (foto's bekijken) wacht op deze WP.
- oude code (alleen A): `blob-images-api-photos` (flag, rating), `blob-images-api-groups` (album-foto toevoegen, covers), `blob-images-api-features` (upvote), oude app `clubalmanac-app` (wie kon wat toevoegen, als cover kiezen, melden).

## Acceptance

- Tests per mutation uit invariant 2: niet-ingelogd, ingelogd zonder foto-toegang, met toegang. Zonder toegang: de mutation faalt én de state is ongewijzigd (geen albumPhoto, geen cover, geen flag-velden, geen rating, geen aggregaat-wijziging).
- Minstens één end-to-end aanvalstest: aanvaller met eigen groep en een bekend photo-id probeert elk pad, en kan de foto daarna via geen enkele read lezen.
- Orakel-tests: zelfde caller, onbekend id tegenover bestaand id zonder toegang, geeft een identieke uitkomst.
- `isWebmaster`: identity met webmaster-email zonder users-rij geeft `false`.
- Volledige unit-suite groen, `npx tsc` schoon (convex + app).
- Audit: mutatie-check per nieuwe gate (zet de gate uit, er valt een test om).

## Kickoff (regie, 2026-11-02)

- **Productdoel**: zie boven.
- **Risico**: security hoog, rest laag.
- **Setup**: 2 (spec-criticus A) + B + audit met adversarial opdracht en verplichte mutatie-check per gate.
- **Uitvoering**: rollen als sub-agent (Agent-tool) vanuit deze regie-sessie, zoals WP23. Deze sessie is door een andere sessie gestart en kan geen rol-sessies starten. Afwijking van de default "eigen sessie per rol" bij hoog risico; gecompenseerd door regie-review na elke rol en verbatim-quotes van audit-findings in de closeout. Go-ahead: besluit Wouter 2026-11-02 (eigen WP24, af vóór WP17) plus de opdracht van de startende sessie.
- **Werkboom**: WP15a-sessies werken tegelijk in dezelfde checkout (`app/`). Elke rol commit met pathspec.

---

## Spec-criticus aanvullingen (A)

(Leeg in draft. A vult hier aan.)
