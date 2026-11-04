# Remote werkplek (Mac-server)

Advies, 2026-11-04. Nog niets geïnstalleerd of ingesteld. Doel: regie-, A-, B- en audit-sessies lopen door als de laptop dicht is.

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
| Deny-regels | Blokkeren in elke mode, ook `bypassPermissions` | `Bash(git push:*)` staat al in de repo. Voeg op de server in `~/.claude/settings.json` toe: `eas build`, `eas submit`, `eas credentials`, `npx convex deploy`, `gh auth` |
| Simulator-toestel | Eenmalige toestemming per toestel, daarna geen vragen | Bij de installatie, via schermdelen |

`bypassPermissions` is af te raden: de server heeft echte logins (Convex, Expo, GitHub).

## Installatie-checklist

Wouter voert dit zelf uit. Versies komen uit de repo en de laptop van 2026-11-04.

1. Server-Mac: Apple Silicon, macOS die Xcode 27.2 draait (laptop: macOS 27.2). Ongeveer 80 GB vrij voor Xcode, simulators en `node_modules`.
2. macOS-instellingen: niet automatisch slapen, opnieuw starten na stroomuitval, Extern inloggen (SSH) en Scherm delen aan. Beslis over automatisch inloggen (zie Risico's).
3. Toegang van buiten huis: bv. Tailscale, voor SSH en Scherm delen.
4. Xcode 27.2 met het iOS-platform. Daarna `sudo xcode-select -s /Applications/Xcode.app`, `sudo xcodebuild -license accept`, `xcodebuild -runFirstLaunch`.
5. Homebrew, daarna `brew install fnm gh cocoapods tmux`. Git komt mee met Xcode.
6. Node via fnm, zoals in [`external-services.md`](./external-services.md) §EAS-build stap 1. Gebruik `24.22.1`, de versie uit `app/eas.json` `build.base.node`.
7. `npm install -g eas-cli@<versie>`. Kies eerst de versie: het runbook pint 25.3.0, de laptop heeft 27.4.1.
8. Repo clonen (publiek, geen login nodig). Daarna `npm ci` in de root en in `app/`. Check: `npm run typecheck` en `npm test` op beide plekken, net als `.github/workflows/ci.yml`.
9. Convex CLI: geen aparte installatie, `npx convex` uit de repo (1.45.0).
10. Claude-desktop-app installeren en inloggen. Zet **Connect new sessions to Remote Control** aan. Open de repo als project.
11. Proef: laat een sessie `npx expo run:ios` in `app/` draaien en het simulator-toestel toestaan.
12. Proef: start vanaf de laptop een regie-sessie op de server, laat die een sub-sessie starten, en controleer dat de sub-sessie op de telefoon verschijnt.
13. Niet nodig op de server: AWS CLI en het AWS-profiel. De AWS-SDK zit in de devDependencies en is alleen voor `scripts/migrate`.

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
| GitHub | `gh` in de sleutelhanger (account `wintvelt`, scopes `repo`, `workflow`, …) | Alleen voor push | Zie Risico's: push-route is een besluit |

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

- **Push.** De deny-regel `Bash(git push:*)` geldt ook op de server. Wouter pusht vanuit zijn eigen SSH-terminal op de server, of haalt de commits naar de laptop en pusht daar.
- **CLI-schrijfacties op externe accounts**: `eas build`, `eas submit`, `eas env:set`, `npx convex login`, `npx convex deploy` naar prod, Convex-env-vars, dashboards.
- **TestFlight en de gate op de iPhone.** De server bouwt niets voor het toestel; EAS bouwt in de cloud.
- **Geen geheimen in de repo of EAS-env.** `.env`-bestanden gaan per `scp`, tokens in de sleutelhanger van de server.
- **macOS-instellingen en rechten** op de server (slaap, SSH, Scherm delen, Toegankelijkheid).

## Risico's en open vragen

| Risico of vraag | Toelichting | Beslissing door |
|---|---|---|
| Push-route | (a) GitHub-token op de server: snel, maar elke sessie kan `gh auth token` lezen. Beperk met een fine-grained token voor alleen deze repo en een deny op `gh auth`. (b) Geen GitHub-schrijfrecht op de server: de laptop haalt de commits op via SSH (`git fetch server main`) en pusht. Veiliger, maar de laptop moet aan | Wouter |
| Sub-sessies en Remote Control | De docs zeggen niet expliciet dat sub-sessies die regie start automatisch aan Remote Control hangen. Test in checklist-stap 12 | Test |
| Herstart van de server | Na een update of stroomuitval moet iemand inloggen, anders draait de desktop-app niet. Automatisch inloggen werkt niet met FileVault aan. Kies: FileVault aan + na herstart via Scherm delen inloggen, of FileVault uit | Wouter |
| Sleutelhanger via SSH | Via SSH is de login-sleutelhanger vaak op slot (`gh`, `EXPO_TOKEN`). Dan eerst `security unlock-keychain` | Bij installatie |
| Twee checkouts | Laptop en server lopen uit elkaar. Werk op één plek tegelijk; pull op de laptop pas na de push | Discipline |
| Versie eas-cli | Runbook pint 25.3.0, de laptop draait 27.4.1. Kies één versie en pas het runbook aan | Regie |
| Deny-syntax | De docs tonen `Bash(git push *)`, de repo gebruikt `Bash(git push:*)`. Controleer op de server dat `git push` geweigerd wordt | Test |
| Gebruik | Meer parallelle sessies, ook 's nachts, telt mee in de limiet van het Claude-abonnement | Wouter |
| Nachtwerk zonder antwoord | Een sessie die op een vraag wacht, staat stil tot Wouter antwoordt. Push-meldingen helpen; `auto`-mode vermindert het aantal vragen | Wouter |
| Toegangs-grenzen per rol | A mag oude code lezen. Die repo's staan in `/Users/wintvelt/Documents/DEV/DEV/` op de laptop. Clone ze op de server op hetzelfde pad, of laat A op de laptop | Regie |

## Bronnen

- Claude Code, Remote Control: <https://code.claude.com/docs/en/remote-control>
- Claude Code, desktop-app (SSH-sessies, cloud, Remote Control): <https://code.claude.com/docs/en/desktop>
- Claude Code, iOS-simulator-pane (alleen lokale sessies): <https://code.claude.com/docs/en/desktop-ios-simulator>
- Claude Code, permissie-modes: <https://code.claude.com/docs/en/permission-modes>
- Claude Code, cloud-sessies: <https://code.claude.com/docs/en/claude-code-on-the-web>
- Expo, builds vanuit CI (`--non-interactive`, `EXPO_TOKEN`, `EXPO_ASC_*`): <https://docs.expo.dev/build/building-on-ci/>
- Expo, `eas submit` voor iOS: <https://docs.expo.dev/submit/ios/>
- Expo, access tokens en robot users: <https://docs.expo.dev/accounts/programmatic-access/>
