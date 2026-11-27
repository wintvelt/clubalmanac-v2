# Convex-dev-stapel

Een Convex-deploy zet de hele map `convex/` neer; wat er stond, verdwijnt. Met meerdere WP's tegelijk haalt een deploy vanaf één WP-branch dus de backend van de andere van dev. Besluit Wouter 2026-11-27: dev komt alleen nog van de stapel.

## Afspraak

- **Niemand deployt dev vanaf een WP-branch.** Geen `npx convex dev` (ook niet `--once` of in meekijkmodus) en geen `npm run convex:dev` in een WP-worktree. Dat geldt voor A, B, audit, red-team en regie.
- **Dev komt van de stapel**: origin/main plus de open WP-branches die `convex/` raken, samengevoegd in de worktree `~/Code/clubalmanac-v2-convex-dev` op branch `convex-dev-stapel`. Die branch wordt nooit gepusht.
- **Deployen**: `npm run deploy:convex-dev` in die worktree. Het script bouwt de stapel elke keer opnieuw vanaf origin/main, voegt de branches uit `.convex-dev-stapel` samen (één per regel, in die volgorde), draait typecheck en tests, en deployt pas als alles groen is. Wouter draait het, of regie met zijn OK. `npm run deploy:convex-dev -- --zonder-deploy` doet alles behalve de deploy.
- **Conflict**: het script stopt vóór de deploy. Regie lost het op in de stapel-worktree en commit; git rerere onthoudt de oplossing, zodat de volgende run hem zelf toepast. Nooit oplossen in de WP-branches zelf.
- **Lijst bijhouden (regie)**: een WP die `convex/` raakt en op dev moet, komt erbij bij de start van zijn gate; na de merge naar main gaat hij eraf. Alleen gecommitte code komt mee.
- **Prod** blijft zoals in het draaiboek van WP31: `npm run deploy:prod` in `~/Code/clubalmanac-v2-release`.

## Eenmalig opzetten

```bash
git worktree add -b convex-dev-stapel ~/Code/clubalmanac-v2-convex-dev origin/main
cd ~/Code/clubalmanac-v2-convex-dev
git config extensions.worktreeConfig true && git config --worktree rerere.enabled true && git config --worktree rerere.autoupdate true
cp ~/Code/clubalmanac-v2/.env.local .
```

Daarna `.convex-dev-stapel` vullen met de branches.
