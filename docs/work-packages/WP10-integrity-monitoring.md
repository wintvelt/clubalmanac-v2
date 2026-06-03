# WP10: Integrity-check / monitoring

> Regie-draft. A vult onderaan aan (spec-criticus). Daarna RED tests.

## Productdoel

Stille datakorruptie blijft niet lang stil — een drift tussen DB-aggregates en de werkelijkheid, een orphan storage-bestand, of een dangling foreign-key valt automatisch op zonder dat de webmaster actief hoeft te speuren.

## Invarianten

1. **Scan-frequentie**: dagelijks runt een scheduled function (04:30 UTC, gespreid na IB2 04:00) die de DB-staat valideert.

2. **Scan-scope** — vier categorieën, allen detecteren-niet-fixen:
   - **(a) Storage-orphans**: elke entry in Convex storage moet matchen op een `photos.storageId`. Orphans (storage-entries zonder photo-record) zijn drift.
   - **(b) Aggregate-drift**: denormalized counters matchen live-recompute:
     - `users.photoCount` vs `count(photos waar ownerId === user._id)`
     - `photos.ratingAverage` + `photos.ratingCount` vs `ratings`-aggregaat per photo
     - `features.upvoteCount` vs `count(featureUpvotes waar featureId === feature._id)`
   - **(c) FK-integriteit**: alle foreign keys verwijzen naar bestaande records. Indicatieve lijst (A vult aan na schema-scan):
     - `albumPhotos.photoId` → `photos`
     - `albumPhotos.albumId` → `albums`
     - `memberships.userId` → `users`
     - `memberships.groupId` → `groups`
     - `photos.ownerId` → `users`
     - `ratings.photoId` → `photos`
     - `ratings.userId` → `users`
     - `albumLastSeen.userId` → `users`
     - `albumLastSeen.albumId` → `albums`
     - `albums.groupId` → `groups`
   - **(d) Geen self-healing**: monitor detecteert + alerteert, fixt nooit. Buggy self-healer vermenigvuldigt schade — bewuste niet-scope (zie §scope-uitsluitingen).

3. **Tolerantie**: drift wordt gerapporteerd bij verschil ≥ 1. Strikt, geen race-marge.

4. **Alert-dedup via state-tabel**: nieuwe `monitoringRuns`-tabel houdt `lastAlertedDriftSignature` bij. Drift-email gaat uitsluitend wanneer de signature verschilt van vorige alert. Persistente drift over meerdere runs = één email, geen storm.

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

A vult hier aan:

- Ontbrekende invarianten: ...
- Gemiste edge cases: ...
- FK-lijst (invariant 2c) volledig gemaakt na schema-scan: ...
- Risico-dimensie die regie overschatte/onderschatte: ...
- Heartbeat-implementatie: aparte cron of inline-state-check in monitor-mutation — A's keuze met motivatie
- Cascade-matrix-keuze: nieuwe meta-rij/sectie, of n.v.t. — A's call
- Open product-vragen voor regie/Wouter: ...

(Leeg in draft. A commit edits hier.)
