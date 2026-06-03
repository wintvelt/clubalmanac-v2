# Cross-cutting review

Vóór de cutover en pre-launch met externe users: vier verse onafhankelijke sub-agents in parallel die elk een ander perspectief afdekken. Vangt wat per-werkpakket A→B→audit cycli structureel niet pakken.

## Wanneer toepassen

- **Vóór cutover** (hard cutover, 16-user prod) — minimaal één pas.
- **Vóór elke uitbreiding van user-set** buiten de oorspronkelijke kern (bijvoorbeeld: van interne 16 naar bredere club-deployment).
- **Na een feature-compleet milestone** waar lang aan één spoor is gewerkt — accumulatieve drift vangen.

Niet voor elk werkpakket. Per-werkpakket A→B→audit blijft de norm voor functional correctness; cross-cutting review is een aparte gate op niveau van het hele systeem.

## De vier perspectieven

1. **Accessibility (WCAG 2.1 AA + EAA per juni 2025)** — keyboard-navigatie, focus-management, ARIA, color contrast, screen-reader semantiek, reduced motion, touch-target size, form-accessibility. Voor B2B/SaaS in EU is dit niet vrijblijvend.
2. **Security holistisch (OWASP + auth + headers + dependencies)** — session-management, token-storage, CSRF, security-headers in deploy-config, `npm audit`, rate-limiting, auth-boundary completeness (gap-analysis tabel van alle mutations × access-check), sensitive data in logs/errors, env-var exposure.
3. **GDPR completeness** — PII-inventarisatie per tabel (grondslag + retention), data-lifecycle (auth-tables, soft-deletes, niet-geconsumeerde tokens), user-rights (Art 15 inzage / Art 17 deletion / Art 20 export), DPA-keten (Convex/Clerk/Mailjet — vooral data-locatie!), audit-trail, cookies/tracking, privacy policy + ToS, breach-notification readiness.
4. **Code-architectuur + documentatie** — duplicatie (componenten/helpers/Convex-side patterns die ≥90% overlap hebben), dead code, coupling, patterns consistency, in-code comments (WAAROM vs WAT), doc-folder samenhang (README → conventions → migratie-plan), onboarding-friendliness, LICENSE/CONTRIBUTING. Geen test-coverage metrics tenzij expliciet gevraagd.

## Discipline

- **Verse context per sub-agent.** Geen toegang tot `migratie-plan-convex.md`, `audit-track-record.md`, of A→B→audit prompt-history. Zien wat een nieuwe engineer op dag 1 ziet. Wel: alle code, README, conventions, runbooks, package.json, deploy-configs.
- **Parallel uitvoeren via Claude Code Agent-tool** met `run_in_background: true`. Notification per agent bij completion. Geen polling.
- **Uniform output-format** per review: Blockers / Should-fix / Future / Algemene observatie. Plus per perspectief: één concrete tabel waar dat zinvol is (PII-inventarisatie voor GDPR, auth-boundary gap-analysis voor security).
- **Geen interpretatie-filter door implementor.** Findings komen verbatim terug. Wouter beslist over severity, niet de partij die het werk heeft gemaakt.

## Output integreren

Na de vier reviews binnen:

1. **Cross-overlap detecteren.** Wanneer twee perspectieven onafhankelijk hetzelfde vinden (bv. PII in logs → security + GDPR), is dat sterk signaal voor prioriteit.
2. **Tier-indeling**: release-blockers vóór cutover, should-fix binnen weken na cutover, architectuur-refactor binnen maanden, future / nice-to-have.
3. **Meta-vraag**: welke perspectief vond verreweg de meeste blockers? Dat is signal over waar de A→B→audit-discipline blind voor is.

## Local-only outputfile

Het integratie-rapport bevat per definitie een ranked vulnerability-lijst, GDPR-gaps en juridische zorgen. Niet op remote. Schrijf naar `docs/cross-cutting-review-<datum>.md` en voeg `docs/cross-cutting-review-*.md` toe aan `.gitignore`. Verwijs naar het bestand vanuit `audit-track-record.md` zodat een latere lezer weet dat 't bestaat zonder dat de findings public zijn.

## Waarom

A→B→audit per werkpakket vangt functional correctness en security-per-surface uitstekend (zie [`audit-track-record.md`](./audit-track-record.md): 10 productie-bugs gefixt vóór cutover). Maar cross-cutting concerns — accessibility, GDPR-lifecycle, deployment-headers, codebase-niveau duplicatie — passen niet in één werkpakket en blijven daardoor structureel onaangeraakt. Eén losse sessie met vier parallel sub-agents kost ~30 minuten setup + 5-10 minuten run-tijd en levert routinematig 10-20 blockers op die anders pas in productie zichtbaar worden. Voor een hard-cutover-deployment naar externe gebruikers is dat een goedkope verzekering.
