# WP31: Overstap naar prod (fase 5, hard cutover)

> Draft regie 2026-11-15. A vult onderaan aan. Dit WP levert vooral een draaiboek en controles; code alleen waar het draaiboek een gat heeft (bv. de cutover-groep in de transform, een preview-modus).

## Productdoel

Op T0 installeren de ~20 leden de nieuwe app, loggen in met hun eigen e-mailadres en zien precies hun eigen groepen, albums, foto's, profielfoto's en (in Blob bibliotheek) de films, zoals ze die in de oude app zagen. Er gaat niets verloren dat vóór de stop in de oude app stond, en niemand ziet iets wat hij daar niet zag.

## Invarianten

1. **Niets verloren.** Elke groep, elk album, elke foto, elk lidmaatschap en elke openstaande uitnodiging die bij de stop in de oude backend stond, staat na T0 op prod (of staat op een lijst met een besluit van Wouter, zoals de likes van WP19a). "Elke" betekent ook: foto's van ex-leden die nog in een groep gepubliceerd staan, covers, gemelde foto's, profielfoto's.
2. **Geen schrijfactie na de laatste export.** De oude backend weigert schrijfacties vóórdat de laatste `extract` begint. Wat daarna nog geschreven had kunnen worden, kan niet.
3. **Niemand ziet meer dan vroeger.** Elke user ziet op prod alleen de groepen waarvan hij in de oude backend lid was. Het review-account van Apple ziet alleen demo-inhoud, nooit ledendata.
4. **De nieuwe app bereikt leden pas op T0.** Tussen goedkeuring door Apple en T0 kan geen lid de nieuwe app installeren of bijwerken en op een lege of halfgevulde prod uitkomen.
5. **Terug kan tot het punt zonder terugkeer.** Tot de app vrijgegeven is, kan de overstap stoppen zonder dat leden iets merken: de oude app werkt weer (schrijven aan), prod blijft dicht. Het punt zonder terugkeer staat expliciet in het draaiboek.
6. **Geen stille fout.** Elke stap heeft een controle met een verwacht resultaat (aantal, statuscode, mail ontvangen). Bij afwijking stopt het draaiboek; er is geen "waarschijnlijk goed".
7. **Prod-sleutels alleen waar ze horen.** Live-sleutels (Clerk, Mailjet, S3-films, Convex deploy-key) staan alleen in de prod-env of in de lokale gitignored config van de migratie, en die config wordt na T0 opgeruimd. Geen test-functies op prod (WP26).
8. **Geen mail naar leden vóór T0.** Pre-create van Clerk-users en het laden van uitnodigingen sturen geen mail. De eerste mail die een lid krijgt, is de inlogcode die hij zelf aanvraagt.
9. **Kosten.** Prod blijft binnen €15 per maand (Convex, Clerk, Mailjet, AWS samen), ook met 5,6 GB foto's plus formaten.

## Scope

- **In scope:** het hele stappenplan van [`migratie-status.md` §Cutover stappenplan](../migratie-status.md), van T-4 weken tot T+30; de volgorde en controles; een generale repetitie; teksten voor de leden; de backup-keuze.
- **Bewust niet:** een nieuwe webapp (na T0, besluit 2026-11-15); R2 voor de films; parallel draaien of dual-write (plan: hard cut).

## Open vragen voor A (oude backend lezen, rapporteren aan regie)

1. **Schrijfstop.** Hoe zet je de oude backend op alleen-lezen: feature-flag in `blob-images-common`, IAM op DynamoDB, of iets anders? Wat merkt een lid in de oude app? Blokkeert het ook uploads naar S3, aanmelden via Cognito, en uitnodigingen accepteren? Is het terug te draaien in minuten?
2. **Cutover-groep.** Hoe ziet een groep met cover en lidmaatschap eruit in DynamoDB, en verschijnt hij zonder app-update bij iedereen? Belangrijk: hoe houden we hem buiten de `extract`/`transform`, zodat hij niet mee naar prod gaat?
3. **Volgorde op T0.** Het huidige stappenplan zet de schrijfstop ná de laatste `extract`. Klopt de volgorde in [`wp12-data-migratie.md`](../runbooks/wp12-data-migratie.md) met invariant 2?
4. **Demo-account voor Apple.** De review vraagt een account met zichtbare inhoud op prod, vóór T0. Hoe past demo-data op prod met `load-records` en `verify` (die tellen rijen tegen de bron)? Alternatief: review tegen een aparte omgeving, of demo-data die `verify` kent.
5. **Vrijgave.** Kan App Store Connect een goedgekeurde versie vasthouden tot een handmatige release op T0 (invariant 4)? Wat gebeurt er met de oude app op toestellen van leden die automatisch bijwerken?
6. **Clerk pre-create.** Welke e-mailadressen (Cognito vs DynamoDB), dubbelen, hoofdletters, en leden zonder bevestigd adres? Gaat er geen mail uit (invariant 8)?
7. **Uitnodigingen in de lucht.** Openstaande uitnodigingen van de oude backend: gaan ze mee, en werkt de link uit een oude mail na T0 nog of niet? Wat ziet de ontvanger?
8. **Generale repetitie.** Waar draaien we de volledige T-2 + T0-run vóór prod: een tweede Convex-project of een extra deployment, met welke Clerk-instance? Wat kost dat? Tel ook opnieuw (doorvoer upload, aantallen; [`data-migration-preflight.md`](../conventions/data-migration-preflight.md) §Re-verificatie).
9. **Backup.** Convex Starter heeft alleen handmatige back-ups (max 2). Vaste export-routine na T0 of Pro? Kosten van Pro tegen het budget.
10. **Kosten prod.** Reken Convex (opslag foto's + formaten, bandbreedte voor ~20 leden), Clerk (prod, aantal MAU), Mailjet (limiet per dag) en de AWS-resten (S3 tot T+90, films) uit tegen €15 per maand.

## Risico-assessment

- **security/privacy: hoog** — echte ledendata en foto's naar prod; live sleutels in vier accounts; een review-account van buiten; pre-create van users.
- **ops: hoog** — eenmalige overstap met stille foutmodi (Mailjet zonder gevalideerde afzender, Clerk-instellingen die op dev anders staan, crons die op een lege prod alarm slaan); Apple-review met onzekere doorlooptijd.
- **external deps: hoog** — Apple (app uit de verkoop, nieuwe versie), Clerk prod, Mailjet prod, Convex prod, AWS (schrijfstop, cutover-groep, films). Alle schrijfacties daar doet Wouter zelf.
- **multi-user/concurrency: middel** — leden die rond T0 nog uploaden of uitnodigen; volgorde schrijfstop en export.
- **data/schema-evolutie: hoog** — onomkeerbare import op prod. Pre-flight per [`data-migration-preflight.md`](../conventions/data-migration-preflight.md); generale repetitie is een harde gate vóór de prod-run.
- **ops-runbook-impact:** alles landt in `migratie-status.md` §Cutover stappenplan en [`wp12-data-migratie.md`](../runbooks/wp12-data-migratie.md); env-vars per service in [`external-services.md`](../conventions/external-services.md).

## Aanpak

Setup 2 + 6 + 5: A (spec-criticus, leest de oude backend) → besluiten Wouter → draaiboek en eventuele code (B) → red-team op het draaiboek ("wat als stap N halverwege faalt") → generale repetitie → T-4 weken en verder met Wouter als uitvoerder.

## Cross-refs

- [`migratie-status.md`](../migratie-status.md) §Fase 5 (mechanieken, stappenplan), §Monitoring & backup
- [`migratie-plan-convex.md`](../migratie-plan-convex.md) §Cutover-mechanieken
- [`wp12-data-migratie.md`](../runbooks/wp12-data-migratie.md) (Run 2 — prod), [`wp5-mailjet-empirical-gates.md`](../runbooks/wp5-mailjet-empirical-gates.md), [`wp6-clerk-empirical-gates.md`](../runbooks/wp6-clerk-empirical-gates.md)
- WP12/WP12b (migratie), WP25 (formaten), WP19a (likes), WP21 (films, bucket dicht), WP26 (test-functies), WP29 (`CLERK_SECRET_KEY`), WP15a (sessieduur)
- Oude AWS-code (alleen A): `blob-images-common`, `blob-images-api*`, oude app `clubalmanac-app`

## Acceptance

- Draaiboek met per stap: wie, wat, verwachte uitkomst, en wat te doen bij afwijking. Het punt zonder terugkeer staat erin.
- Red-team op het draaiboek gedaan; bevindingen verwerkt of door Wouter geaccepteerd.
- Generale repetitie groen: volledige run op een aparte omgeving, `verify` groen, inloggen als een gemigreerde test-user toont de juiste groepen.
- Op T0: `verify` groen, alle leden kunnen inloggen (T+1), de films spelen, de bucket is dicht.

---

## Spec-criticus aanvullingen (A vult in)

(Leeg in draft.)
