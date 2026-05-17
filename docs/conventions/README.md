# Conventions

Werkdiscipline en architectuur-keuzes voor clubalmanac-v2 backend werk. Tijdens de migratie van AWS naar Convex zijn deze conventies door audits gevalideerd en aantoonbaar waardevol gebleken (7 productie-bugs gevonden vóór cutover).

Files in deze folder:

- [`ab-audit-workflow.md`](./ab-audit-workflow.md) — A→B→audit discipline voor backend werkpakketten
- [`work-package-specs.md`](./work-package-specs.md) — Per-WP spec-doc, rolverdeling + toegangs-tabel, subagent-configs
- [`commit-discipline.md`](./commit-discipline.md) — Wie committed wanneer, push-hook gedrag
- [`prompt-discipline.md`](./prompt-discipline.md) — Geen pseudo-code in B-prompts (bias-vermijding)
- [`external-services.md`](./external-services.md) — Photon (geocoding) / Mailjet (email) / Clerk (auth) keuzes
- [`integration-tests.md`](./integration-tests.md) — Aparte test-laag tegen echte externe services (productie-blind-spots)
- [`data-migration-preflight.md`](./data-migration-preflight.md) — 0e sub-fase vóór schema/data-werk: tag + snapshot + count-query + strategie
- [`cross-cutting-review.md`](./cross-cutting-review.md) — Vier-perspectief-pas vóór cutover (a11y / security / GDPR / architectuur)
- [`audit-track-record.md`](./audit-track-record.md) — Productie-bugs gevonden door audit-pas (bewijs voor discipline-waarde)
