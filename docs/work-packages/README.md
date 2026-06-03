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
| WP6 | Clerk session-webhook + atomic onboarding (server-to-server `session.created` → idempotent users-row + invite-accept + membership in één Convex-transactie) | [`WP6-clerk-session-webhook.md`](./WP6-clerk-session-webhook.md) | ✅ landed (gates 2026-05-18 dev) |
| WP7 | Upload-pipeline empirische gates + integration-test (bewijs van pipeline op echte iPhone-foto's met EXIF/GPS) | [`runbooks/wp7-upload-gate.md`](../runbooks/wp7-upload-gate.md) + `tests/integration/uploads/uploadRoundtrip.test.ts` | ✅ landed (gate dev 2026-05-18 + 2 productie-bugs gefixed) |

## Open WPs (volgorde indicatief, regie beslist per kickoff)

| WP | Onderwerp | Spec-doc | Status |
|---|---|---|---|
| WP8 | Photo rotation (`photos.rotate` mutation + sharp scheduled action) — EXIF Orientation upstream al af in cyclus-2 hardening | [`WP8-photo-rotation.md`](./WP8-photo-rotation.md) | 🆕 draft |
| TBD | Crons-bundel: `expirePendingInvites` (IB2), eventueel andere scheduled functions | — | open |
| TBD | Email Gate 1 happy-path + integration-test `tests/integration/mailjet/sendRoundtrip.test.ts` als follow-up van WP5 deferred-items | — | open |
| TBD | Clerk Invitations API integratie (pre-create Clerk-user bij Convex `invites.create`, `users.status: "invited" \| "active"` voor visibility) — alternatief design op WP6, kan als upgrade later | — | open, design-discussie |
| Phase 3 | Data migratie tooling (DynamoDB → Convex) | — | uit fase 2-scope |
| Phase 4 | Clients (iPhone app SDK upgrade + Convex integratie; webapp) | — | uit fase 2-scope |
| Phase 5 | Hard cutover | — | uit fase 2-scope |

Per WP-start: trigger [`phase-kickoff`](https://github.com/anthropics/claude-code) skill in een regie-sessie, draft-spec hier neerzetten, A→B→audit-flow doorlopen.

WP-nummering is sequentieel maar gaten zijn OK (zie WP3). Update deze tabel bij elke afsluiting + nieuwe kickoff.
