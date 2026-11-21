# App Store Connect: versie 2.0.1

Alleen wat verandert ten opzichte van [2.0.0](./app-store-2.0.0.md). Inhoud (besluit Wouter 2026-11-21): de iPad liggend met de zijkolom (PR 50), de nieuwe naam en de Engelse teksten. Overige wensen in 2.0.2. Naam en ondertitel kun je alleen wijzigen terwijl er een nieuwe versie in *Prepare for Submission* staat. Indienen pas als de build van 2.0.1 er is. Kies dan opnieuw *Manually release this version*: een nieuwe versie staat standaard op automatisch.

## Stap 1: nieuwe versie aanmaken

Distribution → links naast **iOS App** het **+**-teken → versie `2.0.1`.

## Stap 2: naam en ondertitel (General → App Information)

Per taal: kies de taal rechtsboven, onder *Localizable Information*.

| | Nederlands | English (U.S.) |
|---|---|---|
| **Name** (max. 30) | `Clubalmanac` | `Clubalmanac` |
| **Subtitle** (max. 30) | `Het fotoalbum van je club` | `Your club's photo album` |

Is de naam al bezet, dan geeft App Store Connect een melding. Kies dan `Clubalmanac fotoalbum`.

## Stap 3: teksten van de versie (iOS App → 2.0.1)

**Nederlands:** de *Description* van 2.0.0 blijft, met één regel extra onderaan:

```
Ook in je browser, op app.clubalmanac.com.
```

**English (U.S.):** taal rechtsboven.

*Promotional Text*

```
A completely rebuilt app. All your groups, albums and photos are back. Sign in with your email address and a code by email.
```

*Description*

```
Clubalmanac is your club's photo album. Share photos in a private group, only with the people who were invited.

Groups and albums
Each group has albums, sorted by year. You see right away which albums have new photos.

Sharing photos
Add photos from your photo library to an album, with date and place. View them full screen, rotate them, or share them via the share sheet. The map of an album shows where the photos were taken. My photos shows everything you shared yourself.

Invitation only
A group admin invites you by email. You sign in with your email address and a code, without a password. What you share is only visible to the members of your groups.

Report and contribute
If a photo doesn't belong, report it. Share ideas and problems in the app.

No ads and no tracking. You can delete your account and all your data yourself, under Profile.

Also in your browser, at app.clubalmanac.com. The app is in Dutch.
```

*Keywords* (max. 100)

```
photo album,club,association,group,photo sharing,private,friends,family,memories
```

*What's New*

```
- On iPad in landscape: the group and album with the cover in a column on the left.
- Small improvements.
```

**Nederlands**, *What's New*:

```
- Op de iPad liggend: de groep en het album met de cover in een kolom links.
- Kleine verbeteringen.
```

## Stap 4: bouwen en uploaden (op de server)

Na de merge van de 2.0.1-PR. Duurt ongeveer een half uur; tmux houdt hem draaiend als de verbinding wegvalt.

```
tmux new -s build "cd ~/Code/clubalmanac-v2-release && git pull --ff-only && cd app && npm ci && npx eas-cli build --platform ios --profile production --local --output ../builds/2.0.1.ipa; exec zsh"
```

```
cd ~/Code/clubalmanac-v2-release/app && npx eas-cli submit --platform ios --profile production --path ../builds/2.0.1.ipa
```

## Stap 5: testen in TestFlight

Op de iPhone en de iPad, tegen prod:
- inloggen, groep en album openen, een foto schermvullend en swipen;
- een foto uploaden en weer verwijderen;
- profielfoto wijzigen: de nieuwe staat er meteen;
- iPad: liggend de zijkolom op Groep en Album, rechtop zoals 2.0.0; draaien zonder naad in de cover.

## Stap 6: indienen

iOS App → 2.0.1 → *Build*: de nieuwe build kiezen → *Manually release this version* → **Add for Review**. Na goedkeuring **Release This Version**.
