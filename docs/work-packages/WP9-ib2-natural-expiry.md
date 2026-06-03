# WP9: IB2 — natural-expiry cron voor pending invites

> Regie-draft. A vult onderaan aan (spec-criticus). Daarna RED tests.

## Productdoel

Een invite waarvan de `expiresAt`-deadline gepasseerd is mag niet meer als "openstaand" worden gezien — de natuurlijke expiry-staat is daarmee semantisch consistent gesloten en onderscheidbaar van het bounce-pad (IB1).

## Invarianten

Gedrag dat altijd waar moet zijn — user-truth, geen impl-vorm.

1. **Expiry-transitie**: een invite met `status === "pending"` en `expiresAt <= now` is binnen één dag-tick van de cron gepatcht naar `status === "expired"`. Boundary `<=` is identiek aan FL1 (audit-9 hardening) en aan het invites-accept-pad.
2. **Status-filter exclusiviteit**: IB2 raakt uitsluitend rijen waar `status === "pending"`. Rijen met status `accepted` / `declined` / reeds `expired` (ongeacht of dat natural- of bounce-expired is) worden niet aangeraakt, ongeacht `expiresAt`-waarde. *(`invites.status`-union is `pending | accepted | declined | expired`; bounce-pad zet óók `expired` + `bouncedAt`, geen aparte `bounced`-status.)*
3. **bouncedAt-grens**: natural-expiry-pad zet `status="expired"` zonder ooit `bouncedAt` te schrijven of te wijzigen. Een rij die na IB2 als `expired` in de DB staat en geen `bouncedAt` heeft, is per definitie natural-expired (niet via bounce). Maakt achteraf-query "bounced vs natural expired" mogelijk.
4. **Stille expiry**: geen email-side-effect. Inviter ontvangt geen notify-mail bij natural expiry — alleen IB1 (bounce-pad) verstuurt notify. Eerste-run op een bestaande dataset met stale pending invites veroorzaakt daarmee geen email-storm.
5. **Idempotency over runs**: herhaalde runs op dezelfde dataset zijn no-op na de eerste run die de grens passeert. Een tweede cron-tick op een al-gepatchte rij produceert nul writes.
6. **Auth-boundary**: uitsluitend bereikbaar via de Convex cron-runtime + `internal.invites.expirePendingInvites`. Geen `api`-export, geen user-facing endpoint.
7. **Cascade-vrijheid**: IB2 raakt geen andere tabel. Geen storage-touch, geen membership-touch, geen `inviteBounceEvents`-write. Single-row-patch op `invites`.
8. **respondedAt-grens** (A toegevoegd): natural-expiry-pad zet `status="expired"` zonder ooit `respondedAt` te schrijven of te wijzigen. Per bestaande code-conventie is `respondedAt` exclusief voor user-initiated accept/decline; system-events (bounce → `bouncedAt`) raken 't nooit. Natural-expiry is óók een system-event. De volledige natural-expiry-fingerprint is daarmee: `status==="expired"` ∧ `bouncedAt===undefined` ∧ `respondedAt===undefined`. Samen met invariant 3 maakt dit drie terminal-herkomsten onderscheidbaar (natural / bounce / nooit-expired-via-accept-decline). Rationale in §Spec-criticus aanvullingen.

## Edge cases + scope-uitsluitingen

**In scope:**
- Daily cron, **04:00 UTC** (gespreid na FL1 03:00 + UI1 03:30, geen runtime-overlap-risico)
- Patch `status="pending"` → `"expired"` waar `expiresAt <= now`
- Cron-registration-pin in `tests/crons/registration.test.ts` uitgebreid met `expirePendingInvites`-entry
- Time-mocking discipline: tests gebruiken `vi.useFakeTimers()` + `vi.setSystemTime(FIXED_NOW)` voor boundary-pins (`expiresAt - 1ms`, `expiresAt`, `expiresAt + 1ms`) — geen `Date.now()`-slop. Zelfde discipline als UI1 (audit-12 follow-up)

**Bewust niet (voor deze WP):**
- **Notify-mail**: stilte. Natural expiry is verwacht-gedrag; inviter krijgt geen closure-mail. Wel: bestaande `sendInviteEmail({kind:"bounced"})`-pad blijft IB1-exclusief.
- **Cascade-cleanup**: invites raken geen storage en geen andere tabellen; geen downstream effecten te wissen.
- **Eerste-run-storm-protection**: niet relevant — geen mail-side-effect (zie boven). DB-patch op N bestaande stale rijen tegelijk is veilig bij 16-user schaal.
- **`.take(N)` batch-guard**: bij verwachte 16-user volume nooit problematisch (Convex-tx-limit ~16k docs ≥ realistisch invite-volume × decennia). Bij toekomstige groei → integrity-check werkpakket (TBD).
- **`bouncedAt`-clear of overwrite**: terminal-state, hands off. IB2 raakt 't veld nooit.
- **Schema-wijziging**: gebruikt bestaande `invites.expiresAt` + `invites.status` velden. Geen index-additie nodig — bestaande `by_status`-index (of vergelijkbaar) volstaat. (A: verifieer in schema; indien geen geschikte index → A's call of impl een scan rechtvaardigt of nieuwe index nodig is.)

## Risico-assessment

Per dimensie laag / medium / hoog + reden.

- **security/privacy: laag** — `internalMutation`, geen auth-boundary die door user bereikt wordt, geen PII-surface, geen email-side-effect (stilte).
- **ops: laag** — silent-failure beperkt mogelijk: als cron niet draait blijven pending invites pending. Niet direct gevaarlijk (invites worden niet "vals positief" geldig), wel observability-relevant. Convex dashboard cron-status panel + statische cron-registration-pin in `tests/crons/registration.test.ts` dekken regression op "cron niet meer geregistreerd".
- **external deps: laag** — geen. Pure DB-scan + DB-patch.
- **multi-user/concurrency: laag** — daily single-runtime cron, geen concurrent runs verwacht. Convex serialiseert mutations per document; race tussen IB2 en bijv. een gelijktijdige `invites.accept` is mogelijk maar onschadelijk (laatste write wint; accept-na-expiry = product-OK want grace-period was al weg).
- **data/schema-evolutie: laag** — geen schema-change, geen backfill, geen migratie-tooling. Bestaande pending+expired-rijen worden bij eerste run gepatcht. Intended cleanup, geen reversibele transformatie nodig.
- **ops-runbook-impact: geen** — geen nieuwe env-vars, geen nieuwe deploy-flags, geen dashboard-config. Convex's standaard cron-status panel volstaat. Geen `external-services.md`-update nodig.

## Cross-refs

- **migratie-plan-convex.md** — §Invites domain, §Monitoring & backup (cron als onderdeel van scheduled-functions)
- **cascade-matrix.md** — rij IB2 onder "Trigger: Invites (system events)". A: cat-categorisatie is daar `3` (cascade delete) maar IB2 doet status-patch zonder cascade — mag bij spec-edit corrigeren naar cat 2 (transactional state-transition) of expliciet motiveren waarom cat 3 blijft.
- **audit-precedenten**:
  - FL1 boundary `<=` (audit-9 hardening, audit-track-record §FL1) — direct precedent voor invariant 1
  - UI1 fake-timer-discipline (audit-12 follow-up, audit-track-record §UI1) — direct precedent voor in-scope time-mocking
- **oude AWS-code (alleen A leest)**: **n.v.t.** — natural-expiry was geen DynamoDB-stream-handler (cascade-matrix IB2: "nieuw, niet uit AWS"). A hoeft geen `blob-images-api*`-repos te lezen voor deze WP.
- **externe service**: **n.v.t.** — geen Mailjet, geen Clerk, geen Photon touch.

## Acceptance — hoe weten we dat het klaar is

**Tests** (`tests/invites/naturalExpiry.test.ts`, A schrijft RED):
- Boundary-pins met fake-timer: `expiresAt = now + 1ms` (blijft pending), `expiresAt = now` (expired), `expiresAt = now - 1ms` (expired)
- Status-filter exclusiviteit: rijen met status ∈ {`accepted`, `declined`, `expired`} blijven onaangeraakt, ook als `expiresAt < now`. Bounce-expired rijen (`status="expired"` + `bouncedAt` gezet) blijven óók onaangeraakt — `pending`-filter sluit ze al uit.
- `bouncedAt`-grens: na IB2-patch is `bouncedAt` op de gepatchte rij ongezet (of behoudt eventueel pre-existing waarde, A's keuze afhankelijk van bestaande schema-semantiek — maar IB2 zelf schrijft 't veld niet)
- `respondedAt`-grens (invariant 8): na IB2-patch is `respondedAt` op de gepatchte rij ongezet. IB2 schrijft 't veld nooit.
- Stille expiry: geen email-action gequeue'd na IB2-run
- Idempotency: tweede run op zelfde dataset doet nul writes (mutation kan dit aantonen via return-count of via spy op `ctx.db.patch`)
- Cascade-vrijheid: geen writes op andere tabellen tijdens IB2-run

**Cron-registration-pin** (`tests/crons/registration.test.ts`, uitbreiden):
- Bestaande pin voor FL1 + UI1 + nieuwe pin voor IB2 (`expirePendingInvites` + schedule 04:00 UTC + target `internal.invites.expirePendingInvites`)

**Geen integration-test**: cron-runtime + DB-patch is volledig in-process; geen externe roundtrip te bewijzen.

**Geen empirische gate**: niets observable buiten DB-state + Convex dashboard cron-registratie (laatste is statisch gepind via test).

---

## Spec-criticus aanvullingen (A vult in)

**Oude AWS-code: niet gelezen.** Cascade-matrix IB2 bevestigt "nieuw, niet uit AWS" — geen `blob-images-api*`-repo relevant. Spec-criticus puur tegen bestaande Convex-code (IB1 `handleBounce`, FL1 `cleanupFlaggedPhotos`, UI1 `cleanupOld`) + cascade-matrix + de invite-accept/create-boundary-polariteit.

### Ontbrekende invariant: respondedAt-grens (invariant 8)

De draft dekte `bouncedAt` (invariant 3) maar niet `respondedAt`. `invites` heeft beide optionele timestamp-velden. Per bestaande conventie (zie `bouncedHandler.test.ts`-kop + `accept`/`decline` in `invites.ts`) is `respondedAt` exclusief voor user-initiated accept/decline; het bounce-system-event gebruikt bewust `bouncedAt`, niet `respondedAt`. Natural-expiry is óók een system-event en moet dus consistent `respondedAt` ongemoeid laten. Toegevoegd als invariant 8 + acceptance-test. Geen scope-uitbreiding — explicitering van bestaand gedrag. (Notitie voor regie ter info.)

### Index-check op `invites`-tabel

`invites` heeft `by_status` index op `["status"]` — single-field, géén composite met `expiresAt`. IB2 kan daarom NIET range-querien zoals FL1 (`by_flagged_delete` `.lte()`) of UI1 (`by_status_and_createdAt` `.eq().lte()`). Correct patroon: `withIndex("by_status", q => q.eq("status","pending")).collect()` → in-memory filter `expiresAt <= now`. Identiek aan IB1 `handleBounce` (collect via `by_email` → in-memory status-filter). **Geen index-additie nodig** op 16-user schaal: de pending-set is klein, en elke run sluit gepasseerde rijen zodat de scan-set niet groeit. Bij toekomstige groei zou een `by_status_and_expiresAt`-composite + `.lte()` de scan-set verkleinen — valt onder het integrity-check/scaling-WP (TBD), niet deze WP. B mag `by_status` gebruiken; een full-table scan zónder status-index wordt afgekeurd (status-filter hoort via index, niet in-memory over álle invites).

### Cascade-matrix cat-correctie: 3 → n.v.t.

Noch cat 2 (transactional **aggregate**) noch cat 3 (**cascade delete**) past de legenda: IB2 doet géén delete, géén cascade, géén aggregate-herrekening — het is een self-contained single-row status-patch. De draft opperde cat 2, maar de matrix-legenda definieert cat 2 strikt als aggregate-herrekening; dat label zou misleiden. Correcte analoog is P8 (`n.v.t. (single-row mutation, geen cascade)`) en FL2 (`n.v.t. (action, geen cascade)`). **Cat in cascade-matrix gezet op `n.v.t. (single-row state-transition, geen cascade)`.** Tevens daar de effect-tekst boundary-correctie `expiresAt < now` → `expiresAt <= now` (harmoniseert met invariant 1 + FL1 + accept).

### Cron-registratie-naam pinning

Bestaande crons gebruiken descriptieve sleutels ("cleanup flagged photos", "cleanup old upload idempotency"). A pint de IB2-cron-sleutel op **`"expire pending invites"`** — 04:00 UTC → `internal.invites.expirePendingInvites`. Contract voor B: exact deze naam + schedule + function-ref. De "exact N crons"-test in `tests/crons/registration.test.ts` gaat van 2 → 3.

### Idempotency / "nul writes" — observable

"Nul writes bij tweede run" is niet direct meetbaar in convex-test (geen patch-spy op de interne `ctx.db`). De test pint het observeerbare equivalent: na een tweede run is (a) de rij ongewijzigd (status `expired`, géén nieuwe `bouncedAt`/`respondedAt`) en (b) de `_scheduled_functions`-count gelijk. Het garanderende mechanisme is de status-filter (invariant 2): een al-`expired` rij matcht niet meer. De tests hangen NIET aan de return-shape — B mag een count teruggeven of `void`, beide blijven groen.

### Risico-dimensies

Akkoord met regie's assessment (alles laag). Eén nuance op **ops**: de cron-registration-pin (statisch) dekt "cron verdween uit registratie", maar niet "cron geregistreerd maar faalt at runtime" — dat blijft observability via het Convex dashboard cron-status-panel, zoals de spec al noemt. Geen extra test mogelijk in-process; akkoord.

### Geen open product-vragen

Alle ambiguïteiten resolvable tegen bestaande code-conventies + cascade-matrix. Geen stop-en-rapporteer nodig.
