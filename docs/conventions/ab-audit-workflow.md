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

Voor de operationele rolverdeling per WP (toegangs-tabel + spec-doc-template + subagent-configs in `.claude/agents/`) zie [`work-package-specs.md`](./work-package-specs.md).

Voor backend = fundament: discipline aanhouden. Voor frontend werk later (fase 4) kan lichter want backend is dan al solid.

## Anti-pattern: gedeelde bron tussen controle en gecontroleerde

Eén regel, twee verschijningsvormen. De regel:

> Een controle — en óók de fixture waarmee die controle getest wordt — mag zijn verwachting niet afleiden met code of data die hij deelt met wat hij controleert. De verwachting komt uit de eerdere, onafhankelijke artefact-laag of uit een handmatig opgesomde oracle.

### Vorm 1 — gedeelde lookup-tabel


Wanneer een WP een waarheidstabel of arithmetiek-mapping bevat (EXIF-tabel, status-overgangs-matrix, permission-matrix, etc.), en A de tabel uit de spec in de test plaatst terwijl B diezelfde tabel in de impl her-codeert, valideert A→B alleen interne consistentie. Een wrong-but-self-consistent tabel passeert alle tests omdat test én impl dezelfde bron delen. Groep-structuur-behoudende verwisselingen (bv. label-swap tussen twee equivalent-getransformeerde toestanden) overleven zelfs delta-pins en inverse-checks, omdat die de structuur testen, niet de externe correctheid.

Mitigatie: bij elke WP met arithmetiek of lookup-tabellen moet A minstens enkele cellen pinnen tegen een *onafhankelijke* oracle:
- eerste-principes-afleiding in de test zelf (bv. matrix-compositie voor EXIF-rotaties), óf
- een tweede referentie die niet uit dezelfde spec-tabel komt als wat B implementeert

De rest van de tabel mag dan als interne-consistentie-toets blijven staan; de paar oracle-pins zijn het anker dat een gekopieerde verkeerde tabel laat falen. Audit moet dit checken: zijn er pins die de tabel falen tegen iets buiten zichzelf, of valideert alles tegen dezelfde bron?

Geboren uit WP8-audit (EXIF-arithmetiek 5↔7-verwisseling, oriëntaties transpose en transverse omgewisseld in zowel A's tabel als B's impl, alle 84 tests groen tot de auditor de tabel onafhankelijk afleidde).

### Vorm 2 — afgeleide verwachting

Wanneer een verificatiestap (`verify`, een integriteitscheck, een dekkings-gate) berekent wat hij verwacht met dezelfde functie die de te controleren stap gebruikt, meet hij niets. Verwacht 0, gevonden 0, dus groen — terwijl beide kanten dezelfde blinde vlek hebben. Hetzelfde geldt voor de fixture: bouwt die zijn testdata met de productiefunctie, dan is een defect in die functie voor de hele suite onzichtbaar.

Mitigatie: de verwachting komt uit een eerdere, onafhankelijke laag — het artefact dat vóór de te controleren stap is weggeschreven — of uit een met de hand opgesomde lijst in de test. Nooit uit de stap zelf.

Audit moet dit checken met een geïnjecteerde regressie: haal één blok uit de gedeelde functie en kijk of er iets omvalt. Blijft alles groen, dan valideert de controle zichzelf.

**Vaste auditstap:** elke nieuw toegevoegde bescherming krijgt één mutatie-check vóór de merge — zet hem uit en kijk of er iets omvalt. In WP12 werden vier bevindingen op rij zo gevonden, en geen ervan was uit lezen alleen zichtbaar: de code klopte telkens, alleen hield niets hem vast.

Geboren uit WP12-audit, twee instanties binnen één werkpakket. Cyclus 1: `verify` leidde zijn verwachting af met dezelfde `applyStorageMap` die `load-records` gebruikte, waardoor stil verlies van álle foto's een groene uitslag gaf. Cyclus 2: na die fix deelden de dekkings-gate én de fixture die hem testte `referencedStorageKeys`, waardoor het weglaten van het profielfoto-blok twee foto's liet verdwijnen met 103 tests groen.

## Waarom

Tussen 2026-04 en 2026-06 hebben 18 audit-cycli op clubalmanac-v2 backend 10 productie-bugs ontdekt en gefixt vóór cutover. Voor 16-user app met hard cutover (geen parallel draaien) is pre-cutover bug-vangst cruciaal. Discipline werkt aantoonbaar — zie [`audit-track-record.md`](./audit-track-record.md).
