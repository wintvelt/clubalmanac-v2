# Commit discipline

A en B doen elk een commit aan einde van hun werk. Push gebeurt door Wouter. Auditor doet géén commit (alleen rapport in chat).

## Hoe toepassen

In A en B prompts laatste sectie: instructeer **commit lokaal, niet pushen**. Voor auditor-prompt expliciet "geen file-edits, alleen rapport".

Twee commits per A→B cyclus:
1. A's tests + doc-updates
2. B's implementatie

Audit-fixes komen in volgende mini-A→B cyclus met eigen commits.

## Push-discipline (mandaat-based, niet hook-enforced)

Er staat **geen** pre-push hook in deze repo. Eerdere versie van dit doc claimde van wel; dat was een ongedekte cheque, gevangen tijdens WP5(B) toen B's sessie wél kon pushen.

De werkelijke twee gates:
1. **Agent-mandaat** (`.claude/agents/wp-a.md`, `wp-b.md`): laatste sectie zegt expliciet "commit lokaal, push wordt door Wouter gedaan". Agenten die het mandaat respecteren pushen niet.
2. **Claude Code permission-systeem** (per sessie): `Bash(git push)` triggert standaard een permission-prompt. Wouter approve/weigert per call.

Geen van beide is een harde technische barrière — discipline + permission-prompt-vigilance. Voor solo-dev-16-user-app acceptabel. Bij escalatie (meerdere committers of CI-deploy-key-leak): installeer dan pas een echte hook via `core.hooksPath = .githooks/` (versionable, surviving fresh clones).

Workflow: A of B doet `git add -A && git commit -m "..."`. Sessie eindigt met "commit X gedaan, niet gepusht — Wouter pusht handmatig". Wouter doet dan zelf `git push origin main` lokaal.

## Waarom

Voorkomt ophoping van werktree changes. Per A→B cyclus committen geeft cleaner git-history. Auditor produceert tekst, niet code → niets te committen. Push centraal bij Wouter houdt CI-rood-vensters (verwacht tussen A en B) onder regie.
