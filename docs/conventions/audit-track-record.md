# Audit track record

Tussen 2026-04 en 2026-05 hebben 13 audit-cycli op clubalmanac-v2 backend de volgende productie-bugs ontdekt en gefixt vóór cutover.

## 7 productie-bugs gevonden

1. **U8** (audit-2): user-delete miste M2-cascade (founder/admin succession + group cleanup) — pure record-delete zonder downstream effect
2. **AP4** (audit-4): album-photo delete miste group-cover cleanup — dangling cover-refs mogelijk
3. **requireWebmaster case-sensitivity** (audit-7): Clerk normaliseert email naar lowercase, env-var `Wouter@me.com` lockt webmaster uit
4. **features.update/remove RBAC drift** (audit-7): submitter-only ipv webmaster-only conform plan
5. **convex/http.ts ontbrak** (audit-8): IB1 bounce-handler in productie dood — webhook endpoint niet aangemaakt
6. **users.ts email normalization** (audit-8): mixed-case duplicates + invite-gate failures
7. **decline order-bug** (audit-8): idempotency werkte niet bij verkeerde caller

## Plus

- Dead code geëlimineerd (U9)
- Test-coverage substantieel uitgebreid
- Design-doc en code synchroon gemaakt
- Comment-bias-patronen weggepoetst
- Reservation pattern voor uploads (cyclus 1 architectuur-rewrite)
- EXIF/geocoding hardening + Photon switch (cyclus 2)

## Wanneer twijfel: doe de audit

Wanneer Wouter twijfelt of A→B + audit voor een werkpakket de moeite is: ja. Alle audits hebben minstens iets opgeleverd, vaak meer dan verwacht.

Voor 16-user app met hard cutover (geen parallel draaien) is pre-cutover bug-vangst cruciaal. Discipline werkt aantoonbaar.

## Recurring-pattern detection

Elke ~5 audit-cycli (of na een grote vondst): scan deze log + de bug-lijst hierboven op herhalend patroon. Zaken die twee of meer audits independent flaggen zijn kandidaat voor promotie naar een standing rule in een van de conventions — meestal [`prompt-discipline.md`](./prompt-discipline.md), [`ab-audit-workflow.md`](./ab-audit-workflow.md), of een nieuwe convention waar het patroon zinvol thuishoort. Voorbeelden van wat een patroon kan zijn: een type vondst dat audits steeds te laat vinden, een gat dat tests systematisch missen, of een prompt-stijl die bias inbouwt.

Het doel is dat de audit-pas zelf goedkoper wordt — niet door minder grondig te zijn, maar door het herhalend werk uit de audit-output naar de impl-prompt te trekken (waar 't preventief werkt).

## Cross-cutting gaps

Per-werkpakket A→B→audit vangt functional correctness en security-per-surface uitstekend. Maar accessibility, GDPR-lifecycle, deployment-headers en architectuur-niveau duplicatie passen niet in één werkpakket en blijven structureel buiten beeld. Vóór cutover (of een latere uitbreiding van user-set) draait daarom een [cross-cutting review](./cross-cutting-review.md): vier verse perspectief-reviews in parallel die deze laag dichten.
