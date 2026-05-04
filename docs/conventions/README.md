# Conventions

Werkdiscipline en architectuur-keuzes voor clubalmanac-v2 backend werk. Tijdens de migratie van AWS naar Convex zijn deze conventies door audits gevalideerd en aantoonbaar waardevol gebleken (7 productie-bugs gevonden vóór cutover).

Files in deze folder:

- [`ab-audit-workflow.md`](./ab-audit-workflow.md) — A→B→audit discipline voor backend werkpakketten
- [`commit-discipline.md`](./commit-discipline.md) — Wie committed wanneer, push-hook gedrag
- [`prompt-discipline.md`](./prompt-discipline.md) — Geen pseudo-code in B-prompts (bias-vermijding)
- [`external-services.md`](./external-services.md) — Photon (geocoding) / Mailjet (email) / Clerk (auth) keuzes
- [`integration-tests.md`](./integration-tests.md) — Aparte test-laag tegen echte externe services (productie-blind-spots)
- [`audit-track-record.md`](./audit-track-record.md) — Productie-bugs gevonden door audit-pas (bewijs voor discipline-waarde)
