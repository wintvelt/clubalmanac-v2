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
