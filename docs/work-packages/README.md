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
| WP8 | Photo rotation (`photos.rotate` mutation, EXIF-only — geen sharp/action) — DB-`exifOrientation` als bron-van-waarheid, client past CSS-transform toe (Phase-4 contract) | [`WP8-photo-rotation.md`](./WP8-photo-rotation.md) | ✅ landed (cyclus 1 + audit-bug #10 fix-cyclus 2026-06-03) |
| WP9 | IB2 cron: `expirePendingInvites` daily — natural-expiry pad voor invites (los van bounce-pad IB1 uit WP5), stille expiry zonder email, fingerprint `expired` ∧ geen `bouncedAt` ∧ geen `respondedAt` | [`WP9-ib2-natural-expiry.md`](./WP9-ib2-natural-expiry.md) | ✅ landed 2026-06-03 |

## Open WPs (volgorde indicatief, regie beslist per kickoff)

| WP | Onderwerp | Spec-doc | Status |
|---|---|---|---|
| WP10 | Integrity-check / monitoring: dagelijkse scheduled function 04:30 UTC die storage-orphans + aggregate-drift + FK-integriteit detecteert. Alert-pad: Convex dashboard-log altijd (incl. OK-runs), email naar webmaster bij drift (dedup via `monitoringRuns`-state-tabel), maandelijkse heartbeat-email als meta-monitoring. Geen self-healing. | [`WP10-integrity-monitoring.md`](./WP10-integrity-monitoring.md) | 🆕 draft (regie 2026-06-03), klaar voor A |
| TBD | Email Gate 1 happy-path + integration-test `tests/integration/mailjet/sendRoundtrip.test.ts` als follow-up van WP5 deferred-items | — | open |
| TBD | Clerk Invitations API integratie (pre-create Clerk-user bij Convex `invites.create`, `users.status: "invited" \| "active"` voor visibility) — alternatief design op WP6, kan als upgrade later | — | open, design-discussie |
| Phase 3 | Data migratie tooling (DynamoDB → Convex) | — | uit fase 2-scope |
| Phase 4 | Clients (iPhone app SDK upgrade + Convex integratie; webapp) | — | uit fase 2-scope |
| Phase 5 | Hard cutover | — | uit fase 2-scope |

Per WP-start: trigger [`phase-kickoff`](https://github.com/anthropics/claude-code) skill in een regie-sessie, draft-spec hier neerzetten, A→B→audit-flow doorlopen.

WP-nummering is sequentieel maar gaten zijn OK (zie WP3). Update deze tabel bij elke afsluiting + nieuwe kickoff.
