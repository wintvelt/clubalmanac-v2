# WP22: code uit de login-mail

> Besluit Wouter 2026-11-09. Verplicht vóór T0. Account verwijderen is apart: WP29.

## Besluit

- Clerk blijft de login-mail sturen, met alleen de code. Dat kan op het gratis plan.
- Er komt geen link in de mail. Dat zou Clerk Pro vragen, en de eis is: niets erbij dat meer kost dan €15 per maand.
- De eis uit WP13 (invariant 19, "link opent de app") vervalt.
- Wie de mail in de Mail-app van de iPhone leest, krijgt de code boven het toetsenbord als suggestie (iOS). Het codeveld staat daar al op ingesteld.
- Wie een andere mail-app gebruikt, typt de code over.

## Gate (iPhone, echt e-mailadres, geen `+clerk_test`)

1. Code aanvragen → de code verschijnt als suggestie boven het toetsenbord; één tik logt in.
2. Verlopen code → een leesbare melding met "Stuur een nieuwe code" (WP13 gate 4a).

Faalt de gate, dan volgt pas een A → B → audit.
