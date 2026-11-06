# Remote werkplek (Mac-server)

Advies, 2026-11-04. Nog niets geïnstalleerd of ingesteld. Doel: regie-, A-, B- en audit-sessies lopen door als de laptop dicht is.

## Besluiten Wouter (2026-11-04)

| Vraag | Besluit |
|---|---|
| Push-route | GitHub-token op de server. Sinds 2026-11-06: `git push` is een ask-regel; regie pusht na Wouters goedkeuring op de iPhone |
| Herstart server | Na een herstart logt Wouter opnieuw in via Scherm delen. Geen automatisch inloggen; FileVault mag aan |
| eas-cli | Nieuwere versie op de server is goed: dezelfde als de laptop (27.4.1). `app/eas.json` eist `>= 25.0.0` |
| Oude repo's voor A | Ook clonen op de server |
| Hoofdtest | Kan regie op de server zelf sub-sessies starten, in een dialoog via Remote Control? Zie §Testplan |

## Kan het?

Ja. Aanbevolen: **de Claude-desktop-app draait op de server-Mac zelf, met Remote Control aan.** Wouter stuurt de sessies vanaf laptop, telefoon of browser.

| Optie | Loopt door met laptop dicht? | iOS-simulator voor B | Sub-sessies (regie start A/B/audit) | Oordeel |
|---|---|---|---|---|
| **Desktop-app op de server + Remote Control** | Ja, zolang de server aan staat en de app draait | Ja: de simulator-pane werkt in lokale sessies | Ja, zoals nu | **Aanbevolen** |
| SSH-sessie vanuit de desktop-app op de laptop | Tijdelijk. De taak stopt als de Claude-login verloopt, soms na een paar minuten | Nee: de pane werkt alleen in lokale sessies | Ja, maar die zijn dan ook SSH | Niet voor nachtwerk |
| Cloud-sessie | Ja | Nee: draait op een Linux-VM van Anthropic | Ja | Past niet: geen simulator, geen `.env`-bestanden, de sessie pusht zelf branches |
| `claude remote-control` in tmux op de server (CLI) | Ja | Alleen via computer use (macOS-rechten voor Toegankelijkheid en Schermopname nodig) | Geen app-sub-sessies; wel Agent-tool-subagents, en Wouter start nieuwe sessies vanaf telefoon of web (`--spawn worktree`) | Terugvaloptie |

Waarom de aanbevolen opzet werkt:
- Sessies draaien lokaal op de server. De desktop-app vernieuwt zelf de login, dus geen verloop zoals bij SSH.
- Met **Settings → Claude Code → Connect new sessions to Remote Control** verschijnt elke nieuwe sessie in claude.ai/code, de Claude-app op de iPhone en de desktop-app op de laptop.
- Permissie-vragen en `AskUserQuestion` gaan naar het toestel waarop Wouter kijkt. Met **Push when actions required** krijgt hij een melding.
- Valt het netwerk weg of slaapt de laptop: de sessie op de server gaat door en Remote Control verbindt opnieuw.

## Goedkeuren op afstand

Schermdelen is alleen nodig bij de eerste installatie (login, macOS-rechten, eerste toegang tot een simulator-toestel). Daarna:

| Middel | Wat het doet | Waar |
|---|---|---|
| Remote Control | Permissie-vragen beantwoorden vanaf telefoon of laptop | Desktop-app op de server, instelling hierboven |
| Permissie-mode `auto` | Minder vragen; een classifier toetst elke actie. Deny-regels blijven gelden | `~/.claude/settings.json` op de server, `"permissions": {"defaultMode": "auto"}`. In `.claude/settings.json` van de repo heeft `auto` geen effect |
| Deny-regels | Blokkeren in elke mode, ook `bypassPermissions` | Voeg op de server in `~/.claude/settings.json` toe: `eas build`, `eas submit`, `eas credentials`, `npx convex deploy`, `gh auth`, `gh api` |
| Simulator-toestel | Eenmalige toestemming per toestel, daarna geen vragen | Bij de installatie, via schermdelen |

`bypassPermissions` is af te raden: de server heeft echte logins (Convex, Expo, GitHub).

## Installatie-checklist

Wouter voert dit zelf uit. Versies komen uit de repo en de laptop van 2026-11-04.

1. Server-Mac: Apple Silicon, macOS die Xcode 27.2 draait (laptop: macOS 27.2). Ongeveer 80 GB vrij voor Xcode, simulators en `node_modules`.
2. De gebruiker op de server is `macserver` (vastgesteld 2026-11-04), dus de paden zijn `/Users/macserver/…`. Het pad naar de oude repo's in `CLAUDE.md` en de naam van de memory-map (`-Users-macserver-Code-clubalmanac-v2`) wijken daardoor af; los dat op vóór A op de server draait. macOS-instellingen: niet automatisch slapen, opnieuw starten na stroomuitval, Extern inloggen (SSH) en Scherm delen aan.
3. Adres van de server in het thuisnetwerk: `macserver@macserver.home` (staat bij **Extern inloggen**). Kopiëren gaat met `scp` vanaf de laptop. Toegang van buiten huis: bv. Tailscale, voor SSH en Scherm delen.
4. Xcode 27.2 met het iOS-platform. Daarna `sudo xcode-select -s /Applications/Xcode.app`, `sudo xcodebuild -license accept`, `xcodebuild -runFirstLaunch`.
5. Homebrew, daarna `brew install fnm gh cocoapods tmux`. Git komt mee met Xcode.
6. Node via fnm, zoals in [`external-services.md`](./external-services.md) §EAS-build stap 1. Gebruik `24.22.1`, de versie uit `app/eas.json` `build.base.node`. Op de server staat ook een andere Node (v26) op het pad. `node -v` toont pas v24.22.1 in een nieuw tabblad na `fnm default`. Sluit daarna de Claude-app (Cmd+Q) en open hem opnieuw: sessies erven de shell-omgeving van de app.

> **Herstart van de Claude-app kost iets.** Lopende sessies hangen daarna niet meer aan Remote Control, tot je ze elk een bericht stuurt (2026-11-04: ~12 sessies). Herstart alleen voor een nieuwe shell-omgeving. Voor `~/.claude/settings.json` volstaat een nieuwe sessie.
7. `npm install -g eas-cli@27.4.1`.
8. GitHub-token: maak een fine-grained token voor alleen `wintvelt/clubalmanac-v2` (Contents: lezen en schrijven). Een fine-grained token geeft alle gekozen repo's dezelfde rechten; daarom gaat `clubalmanac-app` niet via het token (zie stap 10). Daarna `gh auth login` met dat token en `gh auth setup-git`. Gedaan 2026-11-04: er stond al een oudere `gh`-login voor `wintvelt` op de server; die is vervangen door het nieuwe token (`github_pat_…`). `git push --dry-run` vanuit Wouters terminal werkt.
9. Repo clonen naar `/Users/wintvelt/Code/clubalmanac-v2` (zelfde pad als de laptop). Daarna `npm ci` in de root en in `app/`. Check: `npm run typecheck` en `npm test` op beide plekken, net als `.github/workflows/ci.yml`. Op de server groen op 2026-11-04.
10. Oude repo's clonen naar `~/Documents/DEV/DEV/` op de server: `blob-images-api`, `blob-images-api-user`, `-groups`, `-photos`, `-invites`, `-features`, `blob-images-common` (alle publiek) en `clubalmanac-app` (privé, dus niet via het token). `Documents` op de laptop staat in iCloud en de meeste bestanden van de oude app staan alleen daar; `scp` en `git bundle` falen daarop. Werkende route: op de laptop clonen uit GitHub naar `~/Code`, daarvan een `git bundle` maken, die met `scp` naar de server sturen en daar clonen. Gedaan 2026-11-04. `Documents` op de server staat niet in iCloud (`xattr ~/Documents` is leeg). Let op: `blob-images-api-features` en `blob-images-common` staan nu níet op de laptop, wel op GitHub.
11. Memory kopiëren: `~/.claude/projects/-Users-wintvelt-Code-clubalmanac-v2/memory/` van de laptop naar `~/.claude/projects/-Users-macserver-Code-clubalmanac-v2/memory/` op de server. Anders mist de server de feedback-regels. Gedaan 2026-11-04, net als de oude repo's.
12. Convex CLI: geen aparte installatie, `npx convex` uit de repo (1.45.0).
13. Claude-desktop-app installeren en inloggen. Zet **Connect new sessions to Remote Control** aan. Maak een environment aan: selector onder het invoerveld → **New environment** → tab **Local** → map `~/Code/clubalmanac-v2` → **Create environment**. Een Local-environment is een opgeslagen "draai op deze Mac, in deze map". Zet in `~/.claude/settings.json` de deny-regels uit §Goedkeuren op afstand. Stand 2026-11-04: app, login, environment, `defaultMode: auto` en de deny-regels klaar (getest: nieuwe sessie start in Auto, `eas build --help` geweigerd). Ook klaar: `.env.local` en `app/.env.local` gekopieerd, `npx convex login`, `eas login` (`eas whoami` = `wintvelt`).
14. Proef: laat een sessie `npx expo run:ios` in `app/` draaien en sta het simulator-toestel toe (via Scherm delen). Eerste poging 2026-11-04: `pod install` crashte met `Unicode Normalization not appropriate for ASCII-8BIT`, omdat `LANG` leeg is in de sessies van de app. Oplossing zonder herstart van de app: `"env": {"LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8"}` in `~/.claude/settings.json` (geldt vanaf een nieuwe sessie). De toegang tot het toestel geef je in de simulator-pane met **Let Claude use it**. De pane open je met het **telefoon-icoontje** rechts in de titelbalk van de sessie (geen tekstknop).
15. Daarna het §Testplan.
16. Niet nodig op de server: AWS CLI en het AWS-profiel. De AWS-SDK zit in de devDependencies en is alleen voor `scripts/migrate`.

## Testplan: regie start sub-sessies op afstand

Doe dit met de laptop dicht, alleen met de Claude-app op de iPhone. Gebruik een proef-opdracht zonder echte WP, zodat er niets in de historie komt.

| # | Stap | Geslaagd als |
|---|---|---|
| 1 | Start vanaf de iPhone een regie-sessie op de server (environment **Clubalmanac-v2**) | De sessie staat in de lijst op de iPhone en reageert |
| 2 | Typ op de iPhone: *"regie: start een sub-sessie wp-a die alleen `git status` draait en rapporteert"* | De sub-sessie start zonder klik in de desktop-app, want de opdracht staat in Wouters eigen woorden |
| 3 | Kijk in de sessielijst op de iPhone | De sub-sessie staat er ook in, apart te openen |
| 4 | Laat de sub-sessie iets doen dat om toestemming vraagt (bv. een bestand schrijven in Manual-mode) | De vraag komt als melding op de iPhone en is daar te beantwoorden |
| 5 | Wacht tot de sub-sessie klaar is | Regie krijgt het rapport en gaat zelf verder |
| 6 | Vraag regie om een sub-sessie *voor te stellen* in plaats van te starten | De voorstel-kaart met knoppen is op de iPhone zichtbaar en werkt. Zo niet: dan typt Wouter de start-opdracht altijd expliciet (stap 2) |
| 7 | Laat een sub-sessie `git push --dry-run` proberen | Er komt een goedkeuringsvraag op de iPhone |
| 8 | Laat een sub-sessie B de app in de simulator openen | De build loopt en Claude ziet het scherm. Kijken kan alleen via Scherm delen; Remote Control toont de pane niet |
| 9 | Laat een sessie een uur doorlopen met de laptop dicht | Werk gaat door; de iPhone ziet de voortgang |

**Uitkomst 2026-11-04 (stap 1–5): geslaagd.** Regie op de server startte vanaf de iPhone een sub-sessie (`start_session`) zonder klik in de desktop-app. De sub-sessie stond apart in de lijst op de iPhone. Permissie-vragen van beide sessies kwamen op de iPhone en waren daar goed te keuren. Regie kreeg het rapport vanzelf. In mode Manual vraagt elke sessie ook toestemming voor Bash-commando's zoals `git status`; `auto` in `~/.claude/settings.json` scheelt die vragen.

**Stap 6: werkt niet op afstand.** Een voorstel-kaart (sub-sessie voorstellen zonder te starten) weigert de app als je via Remote Control werkt: er zit niemand achter de desktop-app om de kaart te beantwoorden. Regel daarom: **zeg op afstand altijd expliciet "start"**. Regie mag dan direct starten.

**Stap 7: geslaagd met de oude deny-regel (2026-11-04).** Sinds 2026-11-06 is het een ask-regel; hertest stap 7.

**Stap 8: geslaagd, met een omweg (2026-11-04).** Met UTF-8 in de sessie lukten `pod install` en de build; de app toonde het inlogscherm in de iPhone 18 Pro-simulator (iOS 27.2). Na de installatie stopte `expo run:ios`, omdat de sessie System Events niet mag besturen (macOS-toestemming **Automatisering**); de sessie startte Metro daarna apart en opende de app met `xcrun simctl`. Toestemming geven: Apple-menu → **Systeeminstellingen** → **Privacy en beveiliging** → **Automatisering**, of **Sta toe** in de vraag die macOS toont bij de volgende `expo run:ios` (via Scherm delen). Gedaan 2026-11-04: Claude → System Events staat aan, net als **Let Claude use it** in de pane.

**Stap 9: geslaagd (2026-11-05).** Wouter werkte ruim een uur vanaf de iPhone in een sessie op de server, met de laptop uit. Een nieuwe sessie starten vanaf de iPhone, zonder Scherm delen, werkt ook (getest 2026-11-06).

Faalt stap 2 of 3: dan is de terugvaloptie dat Wouter elke rol-sessie zelf start vanaf de iPhone. Regie schrijft dan alleen de prompt.

## Credentials

Alleen namen, geen waarden. Geen enkele komt in de repo of in de EAS-env.

| Credential | Nu op de laptop | Nodig op de server? | Zo komt hij daar |
|---|---|---|---|
| Claude-account | Desktop-app-login | Ja | Wouter logt in via Scherm delen |
| Convex CLI-login | `~/.convex/config.json` (via `npx convex login`) | Ja, voor `npx convex dev` op dev | Wouter draait `npx convex login` op de server. Prod-sleutels niet op de server |
| `CONVEX_DEPLOYMENT`, `CONVEX_URL`, `CONVEX_SITE_URL` | root-`.env.local` | Ja | Geen geheimen; maakt `npx convex dev` zelf aan, of kopiëren |
| `EXPO_PUBLIC_CONVEX_URL`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `app/.env.local` | Ja, voor de simulator | Kopiëren (publiek, wel gitignored) |
| `.env.integration` (`CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_TEST_USER_*`, `UPLOAD_GATE_PHOTO_PATH`; volgens het sjabloon ook `MAILJET_*`, `CLERK_WEBHOOK_SECRET`) | root-`.env.integration` | Alleen als integratie-tests op de server draaien | Wouter kopieert het bestand met `scp`. Alleen dev-waarden |
| `.env.migrate` (`MIGRATE_CONVEX_URL_DEV`, `MIGRATE_CONVEX_ADMIN_KEY_DEV`) | root-`.env.migrate` | Nee, tenzij migratiewerk naar de server gaat | Op de laptop laten |
| AWS-profiel `clubalmanac` (statische sleutels) | `~/.aws/credentials` | Nee | Op de laptop laten. Nodig toch: aparte read-only IAM-user voor de server, intrekken bij T+30 |
| Expo-login | `~/.expo/state.json` (via `eas login`) | Ja, voor `eas build`/`eas submit` | `eas login` op de server, of `EXPO_TOKEN` (zie hieronder) |
| `EXPO_TOKEN` | bestaat nog niet | Alleen voor builds zonder vragen | Wouter maakt een personal access token op expo.dev (Limit access: alleen account `wintvelt`). Bewaar in de macOS-sleutelhanger, niet in `~/.zshrc` |
| Distributiecertificaat + provisioning profile | EAS-managed, op EAS-servers | Nee | Blijft bij EAS. Verloopt 2027-10-25 |
| ASC-API-key voor `eas submit` | EAS-managed, op EAS-servers (aangemaakt in WP14) | Nee | Blijft bij EAS. Check met `eas credentials -p ios` |
| ASC-API-key `.p8` + `EXPO_ASC_*`, `EXPO_APPLE_TEAM_ID` | niet aanwezig | Alleen als EAS zonder vragen certificaten moet herstellen | Niet aanmaken. Bij verloop draait Wouter één build met vragen |
| Clerk- en Mailjet-geheimen | Convex-env-vars (dashboard) | Nee | Blijven in Convex |
| GitHub | `gh` in de sleutelhanger (account `wintvelt`, scopes `repo`, `workflow`, …) | Ja: push door Wouter | Nieuw fine-grained token, alleen voor `clubalmanac-v2` (checklist-stap 8). Niet het laptop-token kopiëren |

## EAS zonder vragen

Kan, volgens de Expo-docs:

| Stap | Commando of instelling |
|---|---|
| Login zonder `eas login` | `EXPO_TOKEN` in de omgeving |
| Build | `eas build -p ios --profile dev --non-interactive --no-wait`. Gebruikt de credentials die al op EAS staan. Er komt geen Apple-login |
| Submit | `eas submit -p ios --profile dev --latest --non-interactive`. Werkt omdat `ascAppId` in `app/eas.json` staat en de ASC-key op EAS staat. Zonder key stopt hij met *"App Store Connect API Keys cannot be set up in --non-interactive mode"* |
| In één keer | `eas build ... --auto-submit` doet de submit na de build |

Het blijft een schrijfactie op een extern account, dus **Wouter draait het zelf**, nu met één commando vanuit een SSH-terminal op de telefoon. Claude krijgt `EXPO_TOKEN` niet in zijn omgeving en de deny-regels voor `eas build`/`eas submit` staan op de server.

## Wat bij Wouter blijft

- **Goedkeuren van elke push.** `git push` is een ask-regel; zie [`commit-discipline.md`](./commit-discipline.md).
- **CLI-schrijfacties op externe accounts**: `eas build`, `eas submit`, `eas env:set`, `npx convex login`, `npx convex deploy` naar prod, Convex-env-vars, dashboards.
- **TestFlight en de gate op de iPhone.** De server bouwt niets voor het toestel; EAS bouwt in de cloud.
- **Geen geheimen in de repo of EAS-env.** `.env`-bestanden gaan per `scp`, tokens in de sleutelhanger van de server.
- **macOS-instellingen en rechten** op de server (slaap, SSH, Scherm delen, Toegankelijkheid).

## Risico's en open vragen

| Risico of vraag | Toelichting | Beslissing door |
|---|---|---|
| GitHub-token op de server | Elke sessie kan het token gebruiken, ook buiten `git push` om (bv. `gh api`). De ask-regel vangt alleen `git push`. Beperking: token alleen voor `clubalmanac-v2`, deny op `gh auth` en `gh api`. Restrisico: een push naar `clubalmanac-v2` via een omweg | Geaccepteerd |
| Sub-sessies via Remote Control | De docs zeggen niet expliciet dat sub-sessies en voorstel-kaarten op afstand werken | §Testplan |
| Herstart van de server | Tot Wouter inlogt, draait er geen sessie. Lopend werk stopt | Geaccepteerd |
| Sleutelhanger via SSH | Via SSH is de login-sleutelhanger vaak op slot (`gh`, `EXPO_TOKEN`). Dan eerst `security unlock-keychain` | Bij installatie |
| Twee checkouts | Laptop en server lopen uit elkaar. Werk op één plek tegelijk; pull op de laptop pas na de push | Discipline |
| Vaste laptop-paden | `CLAUDE.md`, `.claude/agents/wp-{a,b,audit}.md` en `work-package-specs.md` noemen `/Users/wintvelt/Documents/DEV/DEV/`. Op de server is dat `/Users/macserver/…`. Voorstel: overal `~/Documents/DEV/DEV/` | Regie |
| eas-cli-pin in het runbook | [`external-services.md`](./external-services.md) §EAS-build stap 2 pint nog 25.3.0; de praktijk is 27.4.1 | Regie |
| Gebruik | Meer parallelle sessies, ook 's nachts, telt mee in de limiet van het Claude-abonnement | Wouter |
| Nachtwerk zonder antwoord | Een sessie die op een vraag wacht, staat stil tot Wouter antwoordt. Push-meldingen helpen; `auto`-mode vermindert het aantal vragen | Wouter |

## Bronnen

- Claude Code, Remote Control: <https://code.claude.com/docs/en/remote-control>
- Claude Code, desktop-app (SSH-sessies, cloud, Remote Control): <https://code.claude.com/docs/en/desktop>
- Claude Code, iOS-simulator-pane (alleen lokale sessies): <https://code.claude.com/docs/en/desktop-ios-simulator>
- Claude Code, permissie-modes: <https://code.claude.com/docs/en/permission-modes>
- Claude Code, cloud-sessies: <https://code.claude.com/docs/en/claude-code-on-the-web>
- Expo, builds vanuit CI (`--non-interactive`, `EXPO_TOKEN`, `EXPO_ASC_*`): <https://docs.expo.dev/build/building-on-ci/>
- Expo, `eas submit` voor iOS: <https://docs.expo.dev/submit/ios/>
- Expo, access tokens en robot users: <https://docs.expo.dev/accounts/programmatic-access/>
