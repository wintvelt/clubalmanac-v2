# Commit discipline

A en B doen elk een commit + push aan einde van hun werk. Auditor doet géén commit (alleen rapport in chat).

## Hoe toepassen

In A en B prompts laatste sectie: instructeer commit + push. Voor auditor-prompt expliciet "geen file-edits, alleen rapport".

Twee commits per A→B cyclus:
1. A's tests + doc-updates
2. B's implementatie

Audit-fixes komen in volgende mini-A→B cyclus met eigen commits.

## Push hook

Repo heeft een pre-push hook die direct push naar main blokkeert. A en B sessies kunnen dus wel committen, niet pushen.

A en B instructies zeggen: "commit lokaal, push wordt geweigerd door hook → laat staan, Wouter pusht handmatig". Niet proberen te overriden, hook bestaat met reden.

Workflow: A of B doet `git add -A && git commit -m "..."`. Push faalt. Sessie eindigt met "commit X gedaan, niet gepusht — Wouter pusht handmatig". Wouter doet dan zelf `git push origin main` lokaal.

## Waarom

Voorkomt ophoping van werktree changes. Per A→B cyclus committen geeft cleaner git-history. Auditor produceert tekst, niet code → niets te committen. Pre-push hook is bewuste safeguard tegen accidentele direct-pushes.
