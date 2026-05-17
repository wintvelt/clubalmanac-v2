# Work-package specs + rolverdeling

Aanvulling op [`ab-audit-workflow.md`](./ab-audit-workflow.md). Voor elk werkpakket bestaat een spec-doc in [`docs/work-packages/`](../work-packages/) dat regie + A samen aanvullen vóór B begint.

## Waarom een aparte spec-doc

`docs/migratie-plan-convex.md` is high-level fase-tracker, niet de operationele werk-spec. Per WP een eigen `docs/work-packages/WP<n>-<naam>.md` houdt:
- Regie's intentie-werk gescheiden van fase-tracker
- A's spec-criticus-aanvulling traceerbaar (commit-history op die file)
- B en Audit lezen één bron — geen "wat stond in chat" of "wat was de Mailjet-discussie weer"

## Rolverdeling — toegangs- en output-tabel

| Rol | Oude AWS-code | Wat doet | Output naar |
|---|---|---|---|
| Regie | ❌ | schrijft draft-spec + reviewt A/B/audit | `docs/work-packages/WP<n>.md` (eerste commit) |
| A | ✅ | spec-criticus + RED tests | spec-edit + tests in repo (twee commits) |
| B | ❌ | impl tot tests groen | impl in `convex/`, één commit |
| Audit | ❌ | beoordeelt geheel | tekst-rapport in chat, geen commits |

Het toegangs-onderscheid (oude AWS) is bias-vermijding. Alleen A vertaalt oude flows; B en Audit toetsen tegen de spec, niet tegen de legacy.

## Spec-template

Gebruik [`docs/work-packages/_template.md`](../work-packages/_template.md) als startpunt. Kopieer naar `WP<n>-<naam>.md` en vul in. Houd intentie-niveau: gedrag/invarianten, geen pseudo-code (zie [`prompt-discipline.md`](./prompt-discipline.md)).

## Subagent-configs

In [`.claude/agents/`](../../.claude/agents/) staan drie rol-definities: `wp-a.md`, `wp-b.md`, `wp-audit.md`. Twee gebruiks-vormen:

1. **Eigen Claude Code-sessie per rol** (default voor non-triviale WPs): open nieuwe sessie, eerste prompt = "Volg `.claude/agents/wp-a.md` mandaat voor WP<n>". Claude leest het mandaat, jij geeft pad naar oude AWS-code (alleen voor A), Claude doet werk + commit. Voor langer-lopend of iteratief werk waar je tussendoor wilt sturen.
2. **Sub-agent via Agent-tool** (optie voor simpele WPs): regie spawnt met `Agent` tool, `subagent_type: "wp-a"`. Single-shot werk dat klaar is na één run. Geen continuation-feature in stable Claude Code; voor follow-up val terug op eigen-sessie.

Default voor de eerste WPs met deze flow: **eigen-sessie per rol**. Spawn-route gebruiken zodra je vertrouwt dat een specifieke rol single-shot kan.

## Volgorde per WP

1. **Regie**: trigger `phase-kickoff` skill, doe risico-assessment, schrijf draft `docs/work-packages/WP<n>.md`, commit + push.
2. **A-sessie**: pak `wp-a` mandaat. Vult spec aan + commit. Schrijft RED tests + commit. Stopt.
3. **Regie**: review A's commits. Eventueel spec-aanpassing als gat is gevonden.
4. **B-sessie**: pak `wp-b` mandaat. Implementeert tot groen + commit. Stopt.
5. **Regie**: review B's commit. Beslis: audit-go of mini-fix-eerst.
6. **Audit-sessie**: pak `wp-audit` mandaat. Rapport in chat, geen commit.
7. **Regie**: review audit-rapport. Bij blockers → mini A→B-cyclus. Bij groen → WP klaar, log-entry in [`audit-track-record.md`](./audit-track-record.md).

## Conflict-protocollen

Alle drie de rollen volgen "stop + rapporteer" bij ambiguïteit, in plaats van te gokken. Verzameld uit [`prompt-discipline.md`](./prompt-discipline.md) en [`ab-audit-workflow.md`](./ab-audit-workflow.md):

- A vindt spec-gap die niet uit oude code op te lossen is → stop, vraag regie
- B vindt tegenstrijdige tests of test die fout lijkt → stop, vraag regie (niet zelf aanpassen)
- Audit vindt iets onverwacht buiten WP-scope → meld als "recurring pattern" voor [`audit-track-record.md`](./audit-track-record.md) §Recurring-pattern, niet meeslepen in dit audit-rapport
