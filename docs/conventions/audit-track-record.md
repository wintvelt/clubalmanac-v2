# Audit track record

Tussen 2026-04 en 2026-05 hebben 14 audit-cycli op clubalmanac-v2 backend de volgende productie-bugs ontdekt en gefixt vóór cutover.

## 9 productie-bugs gevonden

1. **U8** (audit-2): user-delete miste M2-cascade (founder/admin succession + group cleanup) — pure record-delete zonder downstream effect
2. **AP4** (audit-4): album-photo delete miste group-cover cleanup — dangling cover-refs mogelijk
3. **requireWebmaster case-sensitivity** (audit-7): Clerk normaliseert email naar lowercase, env-var `Wouter@me.com` lockt webmaster uit
4. **features.update/remove RBAC drift** (audit-7): submitter-only ipv webmaster-only conform plan
5. **convex/http.ts ontbrak** (audit-8): IB1 bounce-handler in productie dood — webhook endpoint niet aangemaakt
6. **users.ts email normalization** (audit-8): mixed-case duplicates + invite-gate failures
7. **decline order-bug** (audit-8): idempotency werkte niet bij verkeerde caller
8. **CLUBALMANAC_APP_URL silent prod-fallback** (WP5-audit S-3): dev-deployment zonder env-var → invite-links naar prod-host → 404 bij klik. Fix: fail-loud throw bij unset.
9. **CLUBALMANAC_STAGE silent "dev"-fallback** (WP5-audit S-3): prod-deployment zonder env-var → problem-reports met label "dev" → urgency-mis-routing. Fix: fail-loud throw bij unset.

## Plus

- Dead code geëlimineerd (U9)
- Test-coverage substantieel uitgebreid
- Design-doc en code synchroon gemaakt
- Comment-bias-patronen weggepoetst
- Reservation pattern voor uploads (cyclus 1 architectuur-rewrite)
- EXIF/geocoding hardening + Photon switch (cyclus 2)
- WP5 (Mailjet): verified-sender hard gate fail-closed, Bearer-auth webhook, NL-templates 1:1 oude SES, PII-guard structureel via template-signatures
- WP5-audit follow-up afgesloten 2026-05-18 (commit `9654f81`): webhook-auth strict-equality regression-guards (S-1), end-to-end replay-test (S-2), STAGE+APP_URL fail-loud (S-3), Mailjet-creds fail-fast vóór fetch (N-1). 445 tests groen, CI groen, geen blockers.
- **WP5 deferred naar pre-cutover** (uit oorspronkelijke WP5-spec, niet in deze cyclus): integration-tests `tests/integration/mailjet/sendRoundtrip.test.ts` (niet in CI), en twee empirische mens-gates — Gate 1 send-roundtrip naar test-inbox (verified-sender silent-failure proof), Gate 2 bounce via Mailjet dashboard Event API "Test event"-knop met 4-punts verificatie. Wouter draait beide handmatig vóór cutover.

## Recurring-pattern: env-var-runbook-gap

Twee audits op rij (WP4 `INTEGRATION_TEST_ENABLED`, WP5 vijf nieuwe env-vars) wezen op zelfde gat: nieuwe env-vars werden in code geïntroduceerd zonder runbook-entry, met silent fallbacks die foutgevoelig bleken. Gepromoveerd naar standing rule in [`work-package-specs.md` §Ops-runbook-impact](./work-package-specs.md) en als verplicht risico-veld in [`_template.md`](../work-packages/_template.md). Default-fallbacks worden afgewezen tenzij hard gemotiveerd of fail-loud.

## Backlog (uit audits, niet meegelopen in eigen WP)

- **WP5 N-2**: `invite.email` lowercase doorgegeven aan bounce-notify-template (origineel "Bob@X.com" wordt "bob@x.com"). UX-detail. Past in future "email-template polish" mini-WP indien ooit gewenst.
- **WP5 N-3**: `console.log` free-form structurering in graceful-skip-paths. Niet grep-baar. Past in cross-cutting observability/logging-werkpakket (zie [`migratie-plan-convex.md` §Monitoring & backup](../migratie-plan-convex.md)).

## Wanneer twijfel: doe de audit

Wanneer Wouter twijfelt of A→B + audit voor een werkpakket de moeite is: ja. Alle audits hebben minstens iets opgeleverd, vaak meer dan verwacht.

Voor 16-user app met hard cutover (geen parallel draaien) is pre-cutover bug-vangst cruciaal. Discipline werkt aantoonbaar.

## Recurring-pattern detection

Elke ~5 audit-cycli (of na een grote vondst): scan deze log + de bug-lijst hierboven op herhalend patroon. Zaken die twee of meer audits independent flaggen zijn kandidaat voor promotie naar een standing rule in een van de conventions — meestal [`prompt-discipline.md`](./prompt-discipline.md), [`ab-audit-workflow.md`](./ab-audit-workflow.md), of een nieuwe convention waar het patroon zinvol thuishoort. Voorbeelden van wat een patroon kan zijn: een type vondst dat audits steeds te laat vinden, een gat dat tests systematisch missen, of een prompt-stijl die bias inbouwt.

Het doel is dat de audit-pas zelf goedkoper wordt — niet door minder grondig te zijn, maar door het herhalend werk uit de audit-output naar de impl-prompt te trekken (waar 't preventief werkt).

## Cross-cutting gaps

Per-werkpakket A→B→audit vangt functional correctness en security-per-surface uitstekend. Maar accessibility, GDPR-lifecycle, deployment-headers en architectuur-niveau duplicatie passen niet in één werkpakket en blijven structureel buiten beeld. Vóór cutover (of een latere uitbreiding van user-set) draait daarom een [cross-cutting review](./cross-cutting-review.md): vier verse perspectief-reviews in parallel die deze laag dichten.
