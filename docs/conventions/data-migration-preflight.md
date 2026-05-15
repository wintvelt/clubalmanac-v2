# Data-migration pre-flight

Voor werkpakketten die productie-data raken (schema-velden schrappen of hernoemen, NOT-NULL toevoegen op bestaande data, AWS→Convex cutover-batch, irreversibele transforms): doe een aparte **0e sub-fase** vóór één regel impl-code.

## Wanneer toepassen

Bij elke wijziging waarbij de baseline-data niet onaangetast hoeft te blijven. Schema-additieve velden (`v.optional()` toevoegen) zijn laag risico en hoeven geen pre-flight. Velden schrappen, types wijzigen, bulk-transforms, en de AWS→Convex cutover-batches wél.

## De 0e stap — alleen meten, niet wijzigen

1. **Git tag** op pre-fase commit + push naar origin. Bijvoorbeeld `git tag pre-WP9.1 && git push origin pre-WP9.1`. Lokale rollback-anker als deploy onverwacht stuk gaat.
2. **Convex snapshot** van prod-data: `npx convex export --prod --path ./backups/<wp-name>.zip`. Maak `backups/` aan (lokaal, niet in repo — voeg toe aan `.gitignore` als nog niet aanwezig). Maak een tweede kopie via Convex dashboard → Settings → Snapshot export, voor twee onafhankelijke fallbacks.
3. **Count-query** per te-migreren of te-schrappen veld: hoeveel rijen hebben non-null/non-undefined waarden? Resultaat bepaalt zorgvuldigheid — 0 rijen = blind schrappen veilig, veel rijen = bewuste data-actie (mogelijk GDPR-relevant bij PII).
4. **Lib-versie + JSDoc-check** als externe library betrokken is (`@clerk/backend`, `convex` zelf). Changelog scannen sinds laatste touch, JSDoc-claims kruisbevestigen met runtime-paden in lib-source.
5. **CLI-docs herverifiëren** als migratie-tool wordt gebruikt (`convex import --replace`-semantiek, atomaire-vs-niet, multi-table behavior).
6. **Migratie-strategie schrijven**: vooruit-compat? Backfill-mutation? Rollback-pad? Bij multi-step: tabel "staat van data/schema/code tussen stap N en N+1" — drie kolommen, één rij per tussenwindow.

Output van 0e sub-fase is een korte status (counts + versies + strategie) en een go/no-go beslissing voor de impl-stap. Geen schema-edit, geen code-aanpassing.

## Re-verificatie bij tijdgap

Als er meer dan een week ligt tussen 0e sub-fase en impl-start: herhaal de count-query. Lib-updates, edge-cases of nieuw verkeer kan iets hebben geschreven sinds de baseline-meting.

## Data-mutations: count-return + preview-run

Cleanup of migration-mutations retourneren altijd een gestructureerd object `{ per-table-count, total }`. Run eerst op de dev-deployment, vergelijk met snapshot-baseline. Run dan opnieuw — idempotente cleanup geeft identieke counts. Post-snapshot bevestigt 0-presence van de gestripte velden.

**Idempotent ≠ correct**. Een filter-bug raakt verkeerde rijen ongeacht idempotentie. Preview-run met meetbaar bewijs is een hard gate vóór prod-run, niet een nice-to-have.

## Volgorde van operaties

Schema-validatie in Convex weigert een schema-push als één bestaande rij niet voldoet. Dat is een vangnet, geen blocker — maar volgorde matters:

1. Schema → `v.optional()` voor te-schrappen velden (writes blijven werken met of zonder)
2. Code stopt met het veld te schrijven
3. Cleanup-mutation patcht bestaande rijen `<veld>: undefined`
4. Schema-veld weg

Code-stop vóór schema-optional creëert een race-window waarin nieuwe writes falen op de nog-required schema. Documenteer de volgorde expliciet in de A-prompt.

## Waarom

Voor clubalmanac-v2's AWS→Convex cutover-batches (en latere schema-cleanups in productie) is rollback uit snapshot duur, en stille corruptie nog duurder. Een 0e sub-fase die alleen meet kost 30 minuten en vangt de "we dachten dat 't leeg was"-verrassingen af. Plus: het migratie-strategie-document zelf is auditbaar — een verse auditor kan voor één regel code al gaten in de aanpak vinden.
