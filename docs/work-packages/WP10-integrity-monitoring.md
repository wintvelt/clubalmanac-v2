# WP10: Integrity-check / monitoring

> Regie-draft. A vult onderaan aan (spec-criticus). Daarna RED tests.

## Productdoel

Stille datakorruptie blijft niet lang stil — een drift tussen DB-aggregates en de werkelijkheid, een orphan storage-bestand, of een dangling foreign-key valt automatisch op zonder dat de webmaster actief hoeft te speuren.

## Invarianten

1. **Scan-frequentie**: dagelijks runt een scheduled function (04:30 UTC, gespreid na IB2 04:00) die de DB-staat valideert.

2. **Scan-scope** — vier categorieën, allen detecteren-niet-fixen:
   - **(a) Storage-orphans**: elke entry in Convex storage moet matchen op een bekende storage-referentie. **[A-correctie]** Niet alleen `photos.storageId` — óók `users.profilePhotoStorageId` (schema r.21) is een legitieme referentie. Een storage-entry is pas orphan als hij in géén van beide voorkomt. Orphan-set = `alle _storage-ids` − (`{photos.storageId}` ∪ `{users.profilePhotoStorageId waar gezet}`). Enumeratie van storage via `ctx.db.system.query("_storage")`.
   - **(b) Aggregate-drift**: denormalized counters matchen live-recompute:
     - `users.photoCount` vs `count(photos waar ownerId === user._id)`
     - `photos.ratingAverage` + `photos.ratingCount` vs `ratings`-aggregaat per photo
     - `features.upvoteCount` vs `count(featureUpvotes waar featureId === feature._id)`
   - **(c) FK-integriteit**: alle foreign keys verwijzen naar bestaande records. **[A: volledige lijst na schema-scan]** — onderverdeeld in verplicht en optioneel. **Optionele FKs (`v.optional(v.id(...))`) zijn alleen drift wanneer ze gezet zijn én niet resolven** — een ongezette optionele FK is géén dangling FK.
     - Verplicht (altijd resolven):
       - `groups.createdBy` → `users`
       - `memberships.userId` → `users`
       - `memberships.groupId` → `groups`
       - `albums.groupId` → `groups`
       - `albums.createdBy` → `users`
       - `albumPhotos.albumId` → `albums`
       - `albumPhotos.photoId` → `photos`
       - `albumPhotos.groupId` → `groups`
       - `albumPhotos.addedBy` → `users`
       - `photos.ownerId` → `users`
       - `uploadIdempotency.ownerId` → `users`
       - `ratings.photoId` → `photos`
       - `ratings.userId` → `users`
       - `invites.invitedBy` → `users`
       - `features.submittedBy` → `users`
       - `featureUpvotes.featureId` → `features`
       - `featureUpvotes.userId` → `users`
       - `albumLastSeen.userId` → `users`
       - `albumLastSeen.albumId` → `albums`
     - Optioneel (alleen drift bij gezet + niet-resolvend):
       - `groups.coverPhotoId` → `photos`
       - `albums.coverPhotoId` → `photos`
       - `photos.flaggedBy` → `users`
       - `uploadIdempotency.photoId` → `photos`
       - `invites.groupId` → `groups`
     - Géén FK (eigen orphan-categorie 2a, niet hier): `photos.storageId`, `users.profilePhotoStorageId` → `_storage`.
   - **(d) Geen self-healing**: monitor detecteert + alerteert, fixt nooit. Buggy self-healer vermenigvuldigt schade — bewuste niet-scope (zie §scope-uitsluitingen).

3. **Tolerantie**: drift wordt gerapporteerd bij élk verschil, geen race-marge. **[A-verfijning]** "Verschil ≥ 1" is correct voor de integer-counters (`photoCount`, `ratingCount`, `upvoteCount`): die kunnen alleen met gehele stappen driften, dus ≥1 == elk nonzero verschil. Maar `photos.ratingAverage` is een **float** in [1,5] — een ≥1-drempel zou een stille drift van bv. opgeslagen 4.5 vs werkelijk 3.7 (Δ 0.8) missen, wat juist een monitor-blind-spot is. Daarom: `ratingAverage`-drift = exacte mismatch met float-epsilon (`Math.abs(stored − recompute) > 1e-9`), niet ≥1. Undefined-semantiek: stored `undefined` ⇔ recompute `undefined` (count 0) = match; één van beide gezet en de ander niet = drift. FK- en storage-checks zijn binair (resolved/orphan), geen drempel.

4. **Alert-dedup via state-tabel**: nieuwe `monitoringRuns`-tabel houdt per-run een `driftSignature` (hash van drift-rijen). Drift-email gaat uitsluitend wanneer de signature van de huidige run verschilt van de signature van de laatste run waarin daadwerkelijk een email is verstuurd (latest row met `emailSent === true`). Persistente drift over meerdere runs = één email, geen storm. Geen apart "laatst-gealert-veld" nodig — de dedup-referentie is afleidbaar uit de run-historie zelf.

5. **Dashboard-log altijd autoritatief**: elke run logt naar Convex dashboard (via `console.log`), ook OK-runs. Dashboard-log is bron-van-waarheid voor "monitor draait"; email is convenience-amplifier voor drift-alerting.

6. **Maandelijkse heartbeat-email**: één keer per 30 dagen stuurt monitor een "alive"-email naar `WEBMASTER_EMAILS`, ongeacht drift-status. Passive meta-monitoring zodat afwezigheid-van-email niet automatisch als "geen drift" wordt geïnterpreteerd. Implementatie-keuze (A): aparte cron of state-check binnen dezelfde monitor-mutation ("als 30+ dagen sinds laatste mail, stuur heartbeat ook bij OK-run").

7. **Email-bestemming**: alle alerts (drift + heartbeat) naar `WEBMASTER_EMAILS` env-var, via bestaand `sendEmail`-action-pad (consistent met problem-report). Geen direct `fetch`, geen nieuwe email-helper.

8. **Eén samenvattende email per run**: bij drift één email met alle gevonden drift-rijen samengevat (table-namen + counts + IDs), niet één-per-drift-cell. Mailjet rate-limit irrelevant op dit volume maar pin't de email-design-keuze.

9. **PII-grens in alert-email**: alleen IDs + counts + table-namen. Geen user-content (geen photo-bytes, geen invite-emails, geen rating-comments, geen feature-text, geen names/photoUrls).

10. **Read-only-discipline**: monitor-mutation doet **uitsluitend** writes naar `monitoringRuns` (eigen state-tabel) en queue't `sendEmail`-action. Géén writes naar `photos`/`users`/`ratings`/etc.

11. **Race-resistente scan**: aggregate-cel-check (denormalized vs live-recompute) gebeurt binnen één Convex transactie per rij — zo voorkomt een gelijktijdige user-mutation een vals-positief op precies die rij.

## Edge cases + scope-uitsluitingen

**In scope:**
- Dagelijkse cron `"integrity check"` 04:30 UTC
- Vier scan-categorieën (storage-orphans, aggregate-drift, FK-integriteit, geen self-healing)
- Nieuwe `monitoringRuns`-tabel (additive) met velden: `runAt` (number), `driftFound` (boolean), `driftSignature` (string, hash van drift-rijen), `emailSent` (boolean), `lastHeartbeatAt` (number, voor maandelijkse heartbeat-tracking)
- Heartbeat-mechanisme (≥30 dagen sinds laatste email = stuur heartbeat ook bij OK-run)
- Cron-registration-pin in `tests/crons/registration.test.ts` uitgebreid (FL1+UI1+IB2+monitor = 4 crons)
- Time-mocking discipline voor tests (`vi.setSystemTime`, UI1/IB2-precedent)
- `external-services.md` Mailjet-sectie krijgt twee nieuwe templates: `monitor-drift-alert` + `monitor-heartbeat` (geen i18n nodig — webmaster-only, NL of EN naar A's keuze)

**Bewust niet (voor deze WP):**
- **Self-healing**: monitor detecteert, fixt nooit. Auto-correct = aparte risico-WP later (of nooit; webmaster lost handmatig op na root-cause-analyse).
- **Cleanup van drift**: storage-orphans, dangling FKs, drift-aggregates — alle worden gerapporteerd, niets gedeletet/gepatcht door deze monitor.
- **Geen nieuwe externe deps**: alleen bestaand Mailjet-pad. Geen Slack-webhooks, Sentry, PagerDuty.
- **Geen UI / admin-screen**: webmaster ziet drift via email + Convex dashboard-log. Frontend-werk past niet bij deze WP.
- **Geen tolerance-marge**: drift-rapport bij verschil ≥ 1, geen ±N race-marge. Race-resistente scan (invariant 11) maakt marge overbodig.
- **Geen real-time alerts**: dagelijkse cron volstaat. Geen "binnen N minuten na drift"-eis.
- **Geen per-cell email-storm**: één samenvattende email per run (invariant 8).
- **Geen scan tijdens andere crons**: 04:30 UTC zit ruim na FL1 (03:00), UI1 (03:30), IB2 (04:00). Geen runtime-overlap.

## Risico-assessment

- **security/privacy: laag** — internal scheduled, geen user-endpoint, PII-grens hard gepind (invariant 9), bestemming via bestaande `WEBMASTER_EMAILS`.
- **ops: medium** — silent-failure-vector blijft: monitor zelf kapot = niemand merkt 't direct. Mitigaties: maandelijkse heartbeat-email (invariant 6) + dashboard-log-altijd (invariant 5) + Convex's eigen function-error-tracking. Niet volledig dichtgespijkerd: heartbeat-pijp kan zelf kapot zijn, maar dat is vergelijkbaar risico met de bestaande problem-report-pijp en geen nieuwe surface.
- **external deps: medium** — Mailjet als bestaande consumer; één-email-per-run pin't rate-limit-risico (invariant 8). Geen nieuwe externe deps.
- **multi-user/concurrency: laag** — single-runtime scheduled, read-only-discipline (invariant 10), per-rij-transactie tegen race-vals-positief (invariant 11).
- **data/schema-evolutie: laag-medium** — nieuwe `monitoringRuns`-tabel additive (geen backfill, geen wijziging bestaande tables, geen NOT-NULL-bumps). Eén index `by_runAt` voor "laatste run"-query. Per `phase-kickoff` skill: laag-medium triggert geen pre-flight sub-fase want geen bestaande-data-transform.
- **ops-runbook-impact**: nieuwe alert-email-templates (`monitor-drift-alert` + `monitor-heartbeat`) toevoegen aan `external-services.md` Mailjet-sectie naast bestaande templates. Geen nieuwe env-vars (`WEBMASTER_EMAILS` is bestaand). B levert runbook-entry mee in commit, audit toetst.

## Cross-refs

- **migratie-plan-convex.md** §3 Data integriteit monitoring (r.835): high-level intent dat deze WP concretiseert
- **migratie-status.md** §Cyclus-2 backlog "Integrity-check storage orphans" (audit-10 + audit-12 §5 gap) + §Monitoring & backup (vier ongoing items waarvan deze WP de "Integriteits-checks" en "Alerting" bullets dichttrekt)
- **cascade-matrix.md** — aggregate-velden per cat-2 rows: R1 (ratings → photo.ratingAverage/ratingCount), P6 (photo.create → user.photoCount++), P7 (photo.remove → user.photoCount--). Plus FK-grenzen impliciet in elke cascade-rij
- **audit-precedenten**:
  - audit-10 + audit-12 §5 (audit-track-record): waarom storage-orphans-gap bestaat (U7 best-effort `cleanupStorage`-action kan faalen → orphan blob blijft)
  - WP9 (audit-track-record): cron-registration-pin-discipline + fake-timer-tests-precedent
- **oude AWS-code (alleen A leest)**: **n.v.t.** — geen DynamoDB-stream-handler equivalent. Oude AWS had geen monitoring-loop.
- **externe service**: [`external-services.md`](../conventions/external-services.md) Mailjet-sectie — twee nieuwe templates erbij

## Acceptance — hoe weten we dat het klaar is

**Tests** (`tests/monitoring/integrity.test.ts`, A schrijft RED):

- **Storage-orphans-detectie**: scan met 0 orphans → OK-log, geen email; scan met 1+ orphans → drift-signature, email queued
- **Aggregate-drift per veld** (3 sub-suites):
  - `users.photoCount`: clean → OK; gemanipuleerd → drift
  - `photos.ratingAverage`/`ratingCount`: clean → OK; gemanipuleerd → drift
  - `features.upvoteCount`: clean → OK; gemanipuleerd → drift
- **FK-integriteit** per FK (`albumPhotos.photoId`, `memberships.userId`, etc., volle lijst zie invariant 2c): clean → OK; orphan FK → drift
- **Tolerantie strict**: verschil van exact 1 triggert drift; 0-drift = OK-run
- **State-tabel dedup**: drift-run-A → email; identieke drift-run-B (zelfde signature) → géén tweede email; gewijzigde drift-run-C → wel nieuwe email
- **Heartbeat-trigger**: ≥30 dagen sinds laatste email + OK-run → heartbeat-email queued; <30 dagen + OK-run → geen email
- **PII-grens** in email-body (invariant 9): email-payload bevat IDs/counts/table-namen, géén user-content velden (assert via mock van `sendEmail`-action input)
- **Read-only-discipline**: monitor-run muteert niets buiten `monitoringRuns` (assert via spy op `ctx.db.patch`/`ctx.db.delete`/`ctx.db.insert` voor andere tables)
- **Race-resistente scan** (invariant 11): aggregate-recompute van één-rij gebeurt binnen één tx (A's call hoe dit testbaar te pinnen; mogelijk via assertions op transactie-grenzen of integratietest met gelijktijdige mutation)
- **Eén-samenvattende-email**: 5 drift-rijen in één scan → 1 email-action gequeue'd, niet 5 (assert via call-count op `ctx.scheduler.runAfter`)

**Cron-registration-pin** (`tests/crons/registration.test.ts`, uitbreiden):
- Bestaande pins voor FL1 + UI1 + IB2 + nieuwe pin voor `"integrity check"` 04:30 UTC → `internal.monitoring.integrityCheck`

**Doc-deliverables** (B levert mee in commit per commit-discipline standing rule):
- `docs/conventions/external-services.md` Mailjet-sectie krijgt twee nieuwe template-entries (`monitor-drift-alert` + `monitor-heartbeat`) met subject + body-template-signature
- `docs/cascade-matrix.md` — zie A's call: niet evidente cascade-categorie. Mogelijk geen rij (n.v.t. — monitor is geen cascade, geen trigger). Of een meta-rij in een nieuwe sectie "Monitoring". A beslist.

**Geen integration-test**: bestaand Mailjet-pad, geen nieuw service-contract.

**Geen empirische gate**: outputs zijn observable via Convex dashboard log + (op vrijwilligheidsbasis) een dev-run met gemockte drift om te verifiëren dat email aankomt. Niet WP-blokkerend.

---

## Spec-criticus aanvullingen (A vult in)

A leest spec + relevante repo-conventies (`commit-discipline.md`, `external-services.md`, `convex-runtimes.md`) + cascade-matrix + relevante `convex/`-modules indien strikt nodig voor schema-FK-inventarisatie. Geen oude AWS-code (was er niet voor deze WP).

### Architectuur (A's vorm-keuze, geen impl-detail)

Eén `internal.monitoring.integrityCheck` **internalMutation** (geen action) doet de volledige scan + state-write + email-besluit. Eén Convex-mutation = één transactie = één consistente snapshot van álle tabellen → dat geeft invariant 11 (race-resistentie) **structureel** cadeau: er is geen tussen-read waarin een gelijktijdige user-mutation een vals-positief kan injecteren. De daadwerkelijke Mailjet-send gebeurt in een aparte `internal.monitoring.sendMonitoringAlert` **internalAction**, gequeue'd via `ctx.scheduler.runAfter(0, …)` — exact het `sendProblemReport`-patroon (mutation queue't action; action doet de externe call). De mutation logt áltijd via `console.log` (invariant 5) en schrijft één `monitoringRuns`-rij.

> **[A-correctie op spec-terminologie]** De spec spreekt van "het bestaande `sendEmail`-action-pad". Er bestaat géén generieke `sendEmail`-action; het bestaande patroon is een **per-mail-kind internalAction** (`sendProblemReport`, `sendInviteEmail`) die een template bouwt en `sendMailjetMessage` (`convex/lib/mailjet.ts`) aanroept met `from: { email: INFO_SENDER }`. WP10 volgt dat: nieuwe `sendMonitoringAlert`-action, `INFO_SENDER` (`info@clubalmanac.com`, consistent met problem-report), recipients uit `getWebmasterEmails()` (`convex/lib/auth.ts`). `WEBMASTER_EMAILS` leeg/ontbreekt → no-op zonder throw (action mag scheduler niet stuk maken), gelijk aan `sendProblemReport`.

### Ontbrekende invarianten / correcties op de draft

- **Storage-orphan referentie-set onvolledig** (invariant 2a) — `users.profilePhotoStorageId` ontbrak; zónder deze fix wordt élke profielfoto een vals-positief orphan. Gecorrigeerd inline + RED-test pint het.
- **`ratingAverage`-drempel** (invariant 3) — float, niet integer; ≥1-drempel mist sub-1.0-drift. Gecorrigeerd naar epsilon-mismatch + undefined-semantiek inline. RED-test pint een Δ0.5-drift als drift (oracle-anker, zie hieronder).
- **FK-lijst** (invariant 2c) — van 10 indicatief naar 24 volledig, gesplitst verplicht/optioneel met "optioneel-ongezet = géén drift"-semantiek. Inline gecorrigeerd.
- **`emailSent` betekent "gequeue'd", niet "afgeleverd"** — de mutation zet `emailSent` op basis van of zij de action queue't; Mailjet-falen in de action draait dat niet terug (best-effort, consistent met alle bestaande mail-paden). Spec-acceptance "email queued" is dus de testbare grens, niet "aangekomen".

### Gemiste edge cases (in RED-tests gepind)

- **Lege DB** → OK-run, geen email, geen throw (mirror van naturalExpiry "lege dataset").
- **Optionele FK ongezet** (bv. `photos.flaggedBy === undefined`) → géén drift; alleen gezet-én-dangling telt.
- **Cover-photo dangling** (`groups.coverPhotoId`/`albums.coverPhotoId` → verwijderde photo) → drift; veelvoorkomend reëel scenario (photo-delete liet cover-ref achter).
- **`ratingAverage` undefined-grens** — count 0 + stored `undefined` = OK; count 0 + stored getal = drift; count>0 + stored `undefined` = drift.
- **Persistente deduped-drift + heartbeat** — zie heartbeat-besluit hieronder.

### Heartbeat-implementatie — A's keuze: **inline state-check in de monitor-mutation** (géén aparte cron)

Motivatie: een aparte heartbeat-cron is zélf een silent-failure-surface (precies wat de heartbeat moet bewaken) én vereist een eigen registration-pin. Inline is goedkoper en robuuster: de mutation leest tóch al de laatste `monitoringRuns`-rij voor dedup; één extra vergelijking `now − lastHeartbeatAt ≥ 30d` volstaat.

Regel (superset van de acceptance-spec): aan het eind van elke run — **als deze run géén (drift-)email queue'de én `now − lastHeartbeatAt ≥ 30d`, queue een heartbeat-email**. `lastHeartbeatAt` reset bij élke monitor-email (drift óf heartbeat). Dit voldoet exact aan de acceptance-cases (OK-run +≥30d → heartbeat; OK-run +<30d → niets) én dekt bovendien **persistente deduped-drift**: bij een drift-run die door signature-dedup géén email stuurt, vuurt na 30d alsnog de heartbeat — anders zou een al-30-dagen-stille-maar-driftende monitor onterecht als "alle emails = geen drift" gelezen worden. Zie open vraag 1.

### Cascade-matrix — A's keuze: **één meta-rij in de system-events-sectie**

De monitor is géén cascade (geen trigger, geen downstream-writes buiten `monitoringRuns`). Maar FL1/UI1/IB2 staan óók als daily system-event-crons in de cascade-matrix (categorie "system events"). Voor consistentie krijgt de integrity-check een rij in diezelfde sectie, expliciet gemarkeerd **"detect-only — geen cascade, leest alles, schrijft alleen `monitoringRuns` + queue't alert-action"**. B levert deze doc-edit mee (per commit-discipline standing rule); audit toetst.

### Risico-dimensie die regie over/onder-schatte

- **Onderschat: false-positive-storm bij eerste prod-run.** Als de orphan-set-fix (profilePhotoStorageId) níét landt, alarmeert run-1 op élke profielfoto. De RED-test dekt dit, maar het pint ook hoe kritisch de volledige referentie-set is — niet "indicatief".
- **Correct ingeschat: ops-silent-failure.** Heartbeat + dashboard-log-altijd is de juiste mitigatie; A's inline-heartbeat sluit de persistente-deduped-drift-gat-variant extra.
- **`ctx.db.system.query("_storage")`-afhankelijkheid** — orphan-detectie staat of valt met deze API. Bevestigd dat `convex-test` `_storage` als system-tabel ondersteunt (blobs via `ctx.storage.store` belanden in dezelfde store; system-query leest ze). In prod is dit de officiële storage-enumeratie-API. Geen blind-spot, maar wel een harde dependency die B in een query-helper moet isoleren.

### Test-strategie voor de lastige invarianten

- **Read-only-discipline (inv. 10) + geen-self-healing (2d)** — niet via een `ctx.db.patch`-spy (niet observeerbaar van buiten convex-test), maar **behavioraal**: seed bewuste drift (bv. `photoCount` te hoog), draai de monitor, assert dat de gedrifte bron-waarde **onveranderd** blijft (monitor "fixt" niet) én dat geen enkele andere tabel dan `monitoringRuns` muteert (rij-counts vóór/na). Mirror van de naturalExpiry-idempotency-aanpak.
- **Race-resistentie (inv. 11)** — convex-test is single-threaded en kan de concurrent-mutation-race niet simuleren. Géén nep-test die om de verkeerde reden rood is. In plaats daarvan: een **structurele pin + comment** dat de hele scan in één `internalMutation` (= één transactie/snapshot) draait; B's afwijking hiervan (scan opsplitsen over meerdere mutations/actions) zou de invariant breken en moet in B's commit gemotiveerd. Plus de "alles in één run consistent"-assertie die impliciet volgt uit de andere tests.
- **Oracle-anker (ab-audit-workflow §anti-pattern)** — `ratingAverage`-recompute deelt anders dezelfde `sum/count`-formule in test én impl (interne-consistentie-val). Anker: minstens één aggregate-test met een **handberekende** verwachte waarde (ratings [4,5] → avg 4.5, count 2) i.p.v. recompute-vs-recompute, plus de Δ0.5-drift-pin die tegen een onafhankelijk getal valt.

### Open product-vragen voor regie/Wouter

1. **Heartbeat bij persistente deduped-drift** — A koos de superset-regel (heartbeat vuurt ook op een drift-run die door dedup géén email stuurt). Akkoord, of strikt-literal "alleen op OK-run" (laat dan een 30d+-gat bij stille aanhoudende drift)? RED-tests pinnen vooralsnog de acceptance-cases die in beide lezingen gelijk zijn; de persistente-deduped-drift-case markeer ik als A's voorkeur, makkelijk om te draaien.
2. **`monitoringRuns`-retentie** — de tabel groeit 1 rij/dag, onbegrensd. Buiten WP10-scope? (Geen cleanup-cron gespecificeerd; 365 rijen/jaar × 16-user-app is verwaarloosbaar, maar de "monitor schrijft onbegrensd"-ironie verdient een expliciet ja/nee.) A laat het buiten scope tenzij regie anders beslist.
3. **Drift-IDs in email bij grote drift-set** — invariant 8 ("één samenvattende email") + invariant 9 (IDs toegestaan). Bij een echte ramp (honderden orphans) wordt de mail enorm. Cap op N IDs per categorie met "+M meer"-suffix? A pint vooralsnog géén cap (16-user-volume), maar markeert het.
