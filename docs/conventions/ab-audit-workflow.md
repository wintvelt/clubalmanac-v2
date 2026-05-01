# A→B→audit workflow voor backend werkpakketten

Voor elk backend werkpakket in clubalmanac-v2 migratie volgen drie aparte Claude Code (of Cowork) sessies.

## Rollen

**A — test author**
- Leest oude AWS handlers + plan-doc + cascade matrix
- Schrijft RED tests die het verwachte gedrag pinnen
- Mag `docs/migratie-plan-convex.md` en `docs/cascade-matrix.md` updaten
- NIET de implementatie aanraken
- Commit + push aan einde

**B — implementer**
- Leest A's tests + plan-doc
- Leest NIET de oude AWS code (om bias te vermijden)
- Implementeert tot tests groen zijn
- Conflict protocol: bij twijfel over A's spec → stop en rapporteer
- Commit + push aan einde

**Auditor**
- Leest huidige implementatie + tests naast elkaar
- Rapporteert bias-signalen en verdachte plekken in chat
- Geen file-edits, geen commit
- Output is een tekst-rapport

## Wanneer toepassen

Voor elk nieuw werkpakket: schrijf eerst A-prompt, daarna B-prompt na A's commit, daarna audit-prompt na B's commit. Audit-bevindingen leiden vaak tot mini A→B fix-cyclus.

Voor backend = fundament: discipline aanhouden. Voor frontend werk later (fase 4) kan lichter want backend is dan al solid.

## Waarom

Tussen 2026-04 en 2026-05 hebben 13 audit-cycli op clubalmanac-v2 backend 7 productie-bugs ontdekt en gefixt vóór cutover. Voor 16-user app met hard cutover (geen parallel draaien) is pre-cutover bug-vangst cruciaal. Discipline werkt aantoonbaar — zie [`audit-track-record.md`](./audit-track-record.md).
