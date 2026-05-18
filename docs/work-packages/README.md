# Work packages

Per-WP spec-docs die regie + A samen aanvullen vóór B begint. Zie [`docs/conventions/work-package-specs.md`](../conventions/work-package-specs.md) voor de rolverdeling en flow.

Bestand-conventie: `WP<n>-<korte-naam>.md`. Voorbeelden: `WP6-features.md`, `WP7-album-cover-cascade.md`.

Begin altijd vanuit [`_template.md`](./_template.md).

## Afgeronde WPs

WP1-WP4 liepen vóór de formele spec-doc-discipline (geen WP-file). Status uit commit-history + [`audit-track-record.md`](../conventions/audit-track-record.md) gereconstrueerd:

| WP | Onderwerp | Spec-doc | Status |
|---|---|---|---|
| WP1 | Photon reverse-geocoding (EU geocoding-switch + integration-test) | — (pre-discipline) | ✅ landed |
| WP2 | Convex storage roundtrip + content-type fix | — (pre-discipline) | ✅ landed |
| WP3 | (overgeslagen — nummer niet gebruikt) | — | — |
| WP4 | Clerk JWT roundtrip + `whoami` httpAction + upload 401-hardening | — (pre-discipline) | ✅ landed |
| WP5 | Mailjet email (invite/accept/decline/bounce/flag-decide/problem-report) + bounce-webhook | [`WP5-email.md`](./WP5-email.md) | ✅ landed (gates 2026-05-18 dev) |

## Open WPs (volgorde indicatief, regie beslist per kickoff)

| WP | Onderwerp | Spec-doc | Status |
|---|---|---|---|
| WP6 | Upload-pipeline empirische gates + integration-test (geen nieuwe impl; bewijs van pipeline op echte iPhone-foto's met EXIF/GPS) | (te schrijven) | 🆕 |
| WP7 | Photo rotation (`photos.rotate` mutation + sharp scheduled action) + EXIF Orientation upstream | (te schrijven) | 🆕 |
| TBD | Crons-bundel: `expirePendingInvites` (IB2), eventueel andere scheduled functions | — | open |
| TBD | Auth: Clerk pre-signup webhook | — | partially landed (defense-in-depth via users.register al gepind) |
| TBD | Email Gate 1 happy-path + integration-test `tests/integration/mailjet/sendRoundtrip.test.ts` als follow-up van WP5 deferred-items | — | open |
| Phase 3 | Data migratie tooling (DynamoDB → Convex) | — | uit fase 2-scope |
| Phase 4 | Clients (iPhone app SDK upgrade + Convex integratie; webapp) | — | uit fase 2-scope |
| Phase 5 | Hard cutover | — | uit fase 2-scope |

Per WP-start: trigger [`phase-kickoff`](https://github.com/anthropics/claude-code) skill in een regie-sessie, draft-spec hier neerzetten, A→B→audit-flow doorlopen.

WP-nummering is sequentieel maar gaten zijn OK (zie WP3). Update deze tabel bij elke afsluiting + nieuwe kickoff.
