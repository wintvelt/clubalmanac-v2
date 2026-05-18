# Commit discipline

A en B doen elk een commit aan einde van hun werk. Push gebeurt door Wouter. Auditor doet géén commit (alleen rapport in chat).

## Hoe toepassen

In A en B prompts laatste sectie: instructeer **commit lokaal, niet pushen**. Voor auditor-prompt expliciet "geen file-edits, alleen rapport".

Twee commits per A→B cyclus:
1. A's tests + doc-updates
2. B's implementatie

Audit-fixes komen in volgende mini-A→B cyclus met eigen commits.

## Doc-deliverable-checklist (post-WP5+WP6 recurring-pattern)

WP5-audit en WP6-audit beide flagden hetzelfde gat: spec-genoemde doc-deliverables (cascade-matrix-rij-update, external-services env-var-tabel, runbook-entries) liepen achter op de code-commit. Audit moest ze achteraf alsnog laten landen.

Standing rule: **B's implementatie-commit moet expliciet de spec-genoemde doc-deliverables co-committen, of in commit-message verklaren waarom niet (bv. "doc-update volgt in regie-closeout"-marker)**. Spec-aanvulling §"Doc-deliverables" of §"Cross-refs" is bron-van-waarheid voor wat moet meekomen.

Audit toetst dit als should-fix. Een mini-checkbox in B's commit-message voorkomt 't preventief:

```
Doc-deliverables (spec §X):
- [x] cascade-matrix-rij Y geüpdatet
- [x] external-services.md tabel bijgewerkt
- [ ] integration-test deferred — gemarkeerd in spec, niet aangemaakt
```

## Push-blokkade (settings.json deny-rule)

Sinds WP5(B) — waar de B-sessie pushte ondanks "Wouter pusht handmatig"-mandaat — staat `Bash(git push:*)` in `.claude/settings.json` als deny-rule. Deze geldt voor **elke** Claude Code-sessie in deze repo (zowel Wouter's hoofd-sessie als rol-sessies à la wp-a/wp-b/wp-audit). Sub-agents die via `Agent(subagent_type: ...)` worden gespawned erven dezelfde deny.

Workflow: A of B doet `git add -A && git commit -m "..."`. `git push` faalt met permission-denied. Sessie eindigt met "commit X gedaan, push geweigerd door settings.json". **Wouter pusht vanuit zijn eigen terminal** (`cd <repo> && git push origin main`) — niet vanuit een Claude Code-sessie.

Als Wouter incidenteel tóch vanuit Claude Code wil pushen: voeg lokaal `Bash(git push:*)` toe aan `.claude/settings.local.json` allow-list (gitignored, alleen per-checkout). Deny gaat normaal voor allow, maar local-allow overruled global-deny binnen settings-precedence.

Eerdere versie van dit doc claimde een pre-push hook; die bestond niet (`.git/hooks/pre-push` ontbrak, `core.hooksPath` unset). Permission-deny is de simpelere oplossing — geen extra files in versie-control, geen fresh-clone-setup nodig.

## Waarom

Voorkomt ophoping van werktree changes. Per A→B cyclus committen geeft cleaner git-history. Auditor produceert tekst, niet code → niets te committen. Push centraal bij Wouter houdt CI-rood-vensters (verwacht tussen A en B) onder regie.
