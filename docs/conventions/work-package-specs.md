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

## Ops-runbook-impact (verplicht bij elke WP)

Recurring-pattern vondst (WP4 + WP5 audits, audit-track-record.md): werkpakketten introduceren nieuwe env-vars of deploy-config zonder runbook-entry, waardoor cutover en rotation foutgevoelig worden.

Standing rule: in elke WP-spec onder §Risico-assessment een expliciete `ops-runbook-impact`-regel opnemen die noemt welke nieuwe env-vars / deploy-flags / dashboard-config de WP introduceert + waar ze landen (meestal [`external-services.md`](./external-services.md), soms cutover-runbook). B's commit moet de runbook-entry meeleveren, niet alleen de code. Audit toetst of de runbook-update er is — gat = should-fix.

Default-fallbacks op env-vars worden actief afgewezen tenzij ze óf hard gedocumenteerd óf fail-loud zijn. Stille prod-defaults (à la WP5-S3: `CLUBALMANAC_APP_URL` fell back naar prod-host op dev) verbergen gedragsfouten die pas in productie opduiken.

## Subagent-configs

In [`.claude/agents/`](../../.claude/agents/) staan drie rol-definities: `wp-a.md`, `wp-b.md`, `wp-audit.md`. Twee gebruiks-vormen:

1. **Eigen Claude Code-sessie per rol** (default voor non-triviale WPs): open nieuwe sessie, eerste prompt is minimaal — bijvoorbeeld *"wp-a voor WP5"* of *"audit-rol voor WP7"*. De repo's [`CLAUDE.md`](../../CLAUDE.md) instrueert Claude bij sessie-start om eerst `.claude/agents/wp-<rol>.md` te lezen + de WP-spec in `docs/work-packages/`. Geen langere prompt nodig. Voor langer-lopend of iteratief werk waar je tussendoor wilt sturen.
2. **Sub-agent via Agent-tool** (optie voor simpele WPs): regie spawnt met `Agent` tool, `subagent_type: "wp-a"`. Single-shot werk dat klaar is na één run. Geen continuation-feature in stable Claude Code; voor follow-up val terug op eigen-sessie.

Default voor de eerste WPs met deze flow: **eigen-sessie per rol**. Spawn-route gebruiken zodra je vertrouwt dat een specifieke rol single-shot kan.

## Spawn-autoriteit: alleen regie

**Alleen regie-sessies mogen sub-agents spawnen via de Agent-tool.** Discriminator = de initiële user-prompt bevat expliciet het woord *"regie"*. Een sessie waarvan de openingsinstructie dat woord niet noemt (bv. *"wp-a voor WP5"*, *"audit-rol voor WP7"*, of een willekeurige ad-hoc taak) heeft géén mandaat om de Agent-tool aan te roepen — ook niet voor parallel-search, ook niet voor "even iets uitzoeken".

Reden: spawn-route vermenigvuldigt context-switches en kost prompt-overhead. Voor regie is dat verdedigbaar (orchestratie ís delegation). Voor een rol-sessie of een ad-hoc taak is het bijna altijd dubbel-werk — de sessie is al de uitvoerder.

Praktijk:
- Regie-sessie: mag `Agent(subagent_type: "wp-a")`, `Agent(subagent_type: "Explore")`, etc. spawnen.
- Niet-regie-sessie: leest/schrijft/grept zelf. Bij onvoldoende capability: stop en rapporteer aan Wouter, niet zelf delegeren.

Voor hoog-risico WPs (Setup 2 + Setup 6, of dimensies = hoog): default = eigen Claude Code-sessie per rol, ook voor audit. Spawn-route is dan extra ongewenst omdat je de iteratie-loop met de auditor verliest (rapport komt alleen via Agent-tool-result, niet als interactieve sessie waar je verbatim-quotes kunt opvragen).

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
