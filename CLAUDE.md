# clubalmanac-v2 — Claude Code entry-pad

React + Convex backend. AWS → Convex migratie, in hard-cutover-modus naar 16-user prod. EU/Dublin (Convex), Mailjet (email), Clerk (auth).

## Wat te doen bij sessie-start

Welk type sessie ben je?

### Regie-sessie

Geen specifieke aanduiding van gebruiker = jij bent regie. Trigger `phase-kickoff` skill bij prompts als "volgende fase / WP / phase-kickoff". Schrijft draft-specs naar `docs/work-packages/`, reviewt A/B/audit-output, beheert het work-package-discipline.

Lezen: `docs/migratie-plan-convex.md`, `docs/cascade-matrix.md`, `docs/conventions/` (vooral `ab-audit-workflow.md`, `work-package-specs.md`, `prompt-discipline.md`, `commit-discipline.md`), `audit-track-record.md`, recent commits.

**Geen oude AWS-code lezen.** Alleen A heeft dat mandaat (zie work-package-specs.md toegangs-tabel).

### A / B / Audit-sessie

User-prompt is kort, bv. *"wp-a voor WP5"* of *"audit-rol voor WP7"*.

1. Lees je rol-mandaat: `.claude/agents/wp-{a|b|audit}.md`. Dat is *het* mandaat — geen aanvulling van regie nodig.
2. Lees de WP-spec: `docs/work-packages/WP<n>-*.md` (één match, glob is veilig).
3. Volg het mandaat verder. Bij twijfel: stop + rapporteer, niet gokken.

Toegangs-grenzen per rol staan in [`docs/conventions/work-package-specs.md`](./docs/conventions/work-package-specs.md). Kort:
- **A** mag oude AWS-code in adjacent `blob-images-api*`-repos lezen. Mag spec aanvullen + tests schrijven. Géén impl.
- **B** mag GEEN oude AWS-code. Leest spec + A's tests, schrijft impl. Géén spec/test-edits.
- **Audit** mag GEEN oude AWS-code. Leest spec + tests + impl. Rapport in chat — geen file-edits, geen commits.

## Repo-snelle-kaart

- `convex/` — backend mutations/queries/actions/schema
- `tests/` — unit + integration tests (laatste niet in CI, zie `docs/conventions/integration-tests.md`)
- `docs/migratie-plan-convex.md` — fase-tracker
- `docs/cascade-matrix.md` — cross-flow afhankelijkheden
- `docs/work-packages/` — per-WP specs
- `docs/conventions/` — alle disciplines
- `.claude/agents/` — rol-mandaten voor A/B/Audit
- Adjacent v1-repos (alleen A): `../blob-images-api`, `../blob-images-api-{user,groups,photos,invites,features}`, `../blob-images-common`

## Commit + push

Lokale commits per rol; push door Wouter. Pre-push hook weigert direct-push naar main door agents. Zie [`docs/conventions/commit-discipline.md`](./docs/conventions/commit-discipline.md).

## Belangrijke known issues

- **Mailjet silent failure bij niet-gevalideerde sender** + andere known issues: zie [`docs/conventions/external-services.md`](./docs/conventions/external-services.md) Mailjet-sectie.
- **Cutover-status**: nog niet live op prod; zie `migratie-plan-convex.md` voor fase-tracker.
